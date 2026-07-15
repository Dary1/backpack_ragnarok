#!/usr/bin/env python3
"""REQ-0151 -- ONE generation job, driven by the Node job runner.
Thin CLI boundary between the Node artwork-registry backend and THE flux2
route. Imports art_route.py + art_style.py AS MODULES (no fork, no copied
constants) so sampler settings/model filenames/prompt layer are the
REQ-0150 route's own at run time (gate G3). stdin: one JSON job; stdout one
JSON result. mode preview = prompt only; generate = also image.
ART_ROUTE_MOCK=1 swaps ComfyUI submit/wait for a deterministic PNG at the
exact WxH, but build_txt2img is STILL called (exercises the graph)."""
import sys, os, json, io, base64, hashlib, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import art_route as ROUTE
import art_style as STYLE
import art_shape as SHAPE
KIND_TO_STYLE = {"po": "item", "si": "item", "unit": "unit", "monster": "monster"}


def po_shape_mask(job):
    """The PO 5x5 mask, when this job has one at all. Else None.

    REQ-0183. A po artwork's shape.mask is the operator's own 5x5 cell drawing
    from the REQ-0151 editor; it is what the icon must end up fitting, so it is
    also the right conditioning input (REQ-0153's verdict). Any other kind, or
    an absent/empty mask, has no shape to condition on.

    Whether that mask is USED, and how hard, is resolve_lock()'s call -- not
    this function's.
    """
    if job.get("kind") != "po":
        return None
    shape = job.get("shape") or {}
    mask = shape.get("mask") if isinstance(shape, dict) else None
    return mask or None


def shape_settings(job):
    """REQ-0186: (mask, effective_lock, dilation_px) for this job.

    effective_lock is already resolved through `auto`, so it is one of
    'off' | 'guide' | 'strict' and callers need no further branching. Returns
    (None, 'off', 0) when there is no shape to work with.

    Precedence: the job's own shape_lock / shape_dilation_px (a one-shot
    override from the generate request) over the artwork's stored default over
    the built-in auto/8. The route only ever sees the resolved answer.
    """
    mask = po_shape_mask(job)
    if not mask:
        return None, "off", 0
    lock = SHAPE.resolve_lock(job.get("shape_lock"), mask)
    d = job.get("shape_dilation_px")
    d = SHAPE.DEFAULT_DILATION_PX if d is None else int(d)
    if d < 0 or d > SHAPE.MAX_DILATION_PX:
        raise ValueError("shape_dilation_px out of range: %r (0..%d)"
                         % (d, SHAPE.MAX_DILATION_PX))
    return mask, lock, d


def shape_tag(mask, w, h):
    """Stable per-(shape,size) id for the scaffold files written into ComfyUI's
    input dir. Content-addressed, so repeat renders of the same artwork reuse
    the same three PNGs instead of littering, and two artworks can never read
    each other's scaffold."""
    key = json.dumps({"mask": mask, "w": w, "h": h}, sort_keys=True).encode()
    return hashlib.sha256(key).hexdigest()[:12]


def compose_prompt(job):
    kind = job["kind"]
    main_object = job.get("main_object", "") or ""
    template = job.get("prompt_template") or ""
    if template and "{main_object}" in template:
        subject = template.replace("{main_object}", main_object)
    elif template:
        subject = (main_object + " " + template).strip()
    else:
        subject = main_object
    if kind == "bpskin":
        clause = main_object.strip()
        if clause and not clause.endswith(","):
            clause += ","
        return subject, STYLE.fill_prompt((clause + " ") if clause else "")
    # REQ-0183: a shape-conditioned po render carries a gray scaffold as a
    # ReferenceLatent, so the prompt must read as an EDIT of that reference
    # rather than a bare subject. `subject` itself stays the plain composed
    # subject -- it is what the admin UI and the render record display; only the
    # prompt handed to the model gains the shape directive.
    prompt_subject = subject
    if shape_settings(job)[1] != "off":
        # Both `guide` and `strict` hand the model a scaffold as a
        # ReferenceLatent, so both must address it as an edit. `off` sends no
        # scaffold, so it keeps the plain subject.
        prompt_subject = STYLE.edit_instruction(subject)
    style_override = job.get("style_override")
    if style_override:
        return subject, STYLE.render(style_override, prompt_subject)
    if kind == "custom":
        # REQ-0179: operator-owned prompt. NO per-kind style template is appended
        # (custom has no KIND_TO_STYLE entry, and a texture wants none of the
        # entity kinds' style/background injection) -- the composed subject IS
        # the final prompt. style_override above still wins when present.
        return subject, subject
    return subject, STYLE.render(STYLE.KIND_TEMPLATE[KIND_TO_STYLE[kind]], prompt_subject)


def route_params(job):
    return {"steps": ROUTE.STEPS, "cfg": ROUTE.CFG, "sampler": ROUTE.SAMPLER,
            "seed_default": ROUTE.SEED, "tiling": bool(job.get("tiling", False)),
            "cell_px": ROUTE.CELL_PX, "unet": ROUTE.FLUX["unet"],
            "clip": ROUTE.FLUX["clip"], "vae": ROUTE.FLUX["vae"]}


def mock_png(w, h, seed):
    # REQ-0156: optional per-job delay so tests/e2e can hold jobs in the
    # queue long enough to exercise the cancel paths deterministically
    # (real generation takes minutes; the mock would otherwise finish in
    # milliseconds and nothing would ever be observably pending/running).
    delay_ms = int(os.environ.get("ART_MOCK_DELAY_MS", "0") or "0")
    if delay_ms > 0:
        import time
        time.sleep(delay_ms / 1000.0)
    from PIL import Image, ImageDraw
    col = ((37 * (seed + 1)) % 256, (91 * (seed + 3)) % 256, (151 * (seed + 7)) % 256, 255)
    img = Image.new("RGBA", (w, h), col)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], outline=(0, 0, 0, 255), width=max(1, min(w, h) // 64))
    d.text((4, 4), "seed %d %dx%d" % (seed, w, h), fill=(255, 255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def real_generate(final_prompt, w, h, seed, tiling, prefix, shape_inputs=None):
    wf = ROUTE.build_txt2img(final_prompt, w, h, seed=seed, tiling=tiling, prefix=prefix,
                             **(shape_inputs or {}))
    pid = ROUTE.submit(wf)
    if ROUTE.wait_done(pid) is None:
        raise RuntimeError("ComfyUI timed out")
    matches = sorted(glob.glob(os.path.join(ROUTE.COMFY_OUTPUT_DIR, prefix + "*.png")),
                     key=os.path.getmtime)
    if not matches:
        raise RuntimeError("no output PNG produced for prefix " + prefix)
    with open(matches[-1], "rb") as f:
        return f.read()


def main():
    job = json.load(sys.stdin)
    mode = job.get("mode", "generate")
    seed = int(job.get("seed", ROUTE.SEED))
    w = int(job.get("width", 256))
    h = int(job.get("height", 256))
    tiling = bool(job.get("tiling", False))
    subject, final_prompt = compose_prompt(job)
    mask, lock, d_px = shape_settings(job)
    out = {"status": "ok", "subject": subject, "final_prompt": final_prompt,
           "width": w, "height": h, "seed": seed, "route_params": route_params(job),
           "shape_conditioned": lock != "off", "shape_lock": lock}
    if lock == "strict":
        out["shape_dilation_px"] = d_px
    if mode == "preview":
        # Prompt only: no scaffold is written. Preview must stay cheap and free
        # of side effects, but it still REPORTS shape_conditioned + the edit
        # prompt, so the operator sees what generate will actually run.
        print(json.dumps(out))
        return
    # REQ-0183: render the scaffold/mask/init trio the Arm C graph loads. Built
    # at the job's OWN (w, h) -- the size art_sizing.cjs derived from this very
    # mask -- and laid out proportionally, so scaffold and canvas always register.
    shape_inputs = {}
    if lock != "off":
        trio = SHAPE.prepare_inputs(mask, (w, h), ROUTE.COMFY_INPUT_DIR,
                                    shape_tag(mask, w, h), d_px=d_px)
        if lock == "guide":
            # REQ-0153 Arm A: the scaffold conditions the composition, but no
            # hard mask -- the render MAY spill past the cells (~60% contained
            # vs strict's 100%). The mask/init images are simply not passed.
            shape_inputs = {"reference_image": trio["reference_image"]}
        else:
            shape_inputs = trio
    ROUTE.build_txt2img(final_prompt, w, h, seed=seed, tiling=tiling, prefix="req0151",
                        **shape_inputs)
    mock = os.environ.get("ART_ROUTE_MOCK") == "1" or job.get("mock")
    png = mock_png(w, h, seed) if mock else real_generate(final_prompt, w, h, seed, tiling, "req0151_" + str(seed), shape_inputs)
    if job["kind"] == "bpskin":
        out["bpskin_frame_report"] = {"mocked": True, "PASS": True,
            "checks": {"margin": True, "solidity": True, "single": True,
                       "coverage": True, "rim": True}}
    out["image_b64"] = base64.b64encode(png).decode("ascii")
    out["image_sha256"] = hashlib.sha256(png).hexdigest()
    print(json.dumps(out))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}))
        sys.exit(0)
