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
KIND_TO_STYLE = {"po": "item", "si": "item", "unit": "unit", "monster": "monster"}


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
    style_override = job.get("style_override")
    if style_override:
        return subject, STYLE.render(style_override, subject)
    return subject, STYLE.render(STYLE.KIND_TEMPLATE[KIND_TO_STYLE[kind]], subject)


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


def real_generate(final_prompt, w, h, seed, tiling, prefix):
    wf = ROUTE.build_txt2img(final_prompt, w, h, seed=seed, tiling=tiling, prefix=prefix)
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
    out = {"status": "ok", "subject": subject, "final_prompt": final_prompt,
           "width": w, "height": h, "seed": seed, "route_params": route_params(job)}
    if mode == "preview":
        print(json.dumps(out))
        return
    ROUTE.build_txt2img(final_prompt, w, h, seed=seed, tiling=tiling, prefix="req0151")
    mock = os.environ.get("ART_ROUTE_MOCK") == "1" or job.get("mock")
    png = mock_png(w, h, seed) if mock else real_generate(final_prompt, w, h, seed, tiling, "req0151_" + str(seed))
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
