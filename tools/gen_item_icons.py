#!/usr/bin/env python3
"""
gen_item_icons.py -- ComfyUI txt2img item-icon candidate generator (REQ-0073, batch-003).

Adapted from tools/gen_monster_art.py (same ComfyUI API pattern: submit ->
poll /history/<prompt_id> -> copy the saved PNG out of ~/ComfyUI/output).
Unlike gen_monster_art.py (one static illustration per job, arbitrary size,
optional hires-fix), this tool is item-icon-specific per REQ-0073:

  - Reads item entries (gen_prompt/gen_negative/gen_render) from a defs JSON
    (schema: {"schema":..., "entries":[...]}), not a job-list JSON.
  - Generates N candidates per item at FIXED seeds (reproducible), not one
    single seed per job.
  - Renders at gen_render.gen_px (SDXL-friendly ~1MP size), then downscales
    (PIL Lanczos) to gen_render.target_px -- the final in-game icon canvas.
    The downscaled file IS the saved "raw" candidate (per REQ-0073 spec);
    the full gen_px frame is not kept.
  - Also produces a background-removed "_alpha" version per candidate, via
    the matte_transparent.py lineage (rembg + isnet-anime), so scoring
    (tools/tool_icon_score.py) can run tool_fit_check.load_content-style
    alpha analysis without a separate manual matting pass.
  - Optionally biases subject placement into gen_render.mask_cells via
    ComfyUI's ConditioningSetMask (regional conditioning on the positive
    prompt only) -- best-effort placement hint, NOT a placement guarantee;
    downstream fit-scoring (tool_icon_score.py / tool_fit_check.py) remains
    mandatory regardless of masking.

Why matting reuses matte_transparent.py's model choice (isnet-anime) rather
than chroma_key.py's flat-key approach: chroma_key.py's own docstring notes
it assumes a fairly uniform flat backdrop and explicitly flags rembg/isnet
as the fallback for "a softer-edged style". Item icons are photoreal-styled
(JuggernautXL) product-shot renders on a near-white backdrop that is not a
guaranteed-pure single RGB (same caveat chroma_key.py raises for its own
target case) and can have soft edges (metal specular falloff, fabric
fringing) -- exactly the case matte_transparent.py's docstring says
chroma-keying handles poorly. isnet-anime was chosen over u2net for
monster art because u2net (general photo/human segmentation) was deleting
real character geometry; the same generic-photo-segmentation risk applies
here (u2net could delete real object geometry, e.g. thin blade edges,
same failure mode as the thin ice-shard linework case). isnet-anime and
birefnet-general were the two viable alternatives there; isnet-anime is
reused here for consistency and because it was measurably as good as
birefnet-general at 8x the speed. If a future item style needs a different
matting model, change get_session()'s model name in one place.

ComfyUI mask injection: ConditioningSetMask takes a MASK tensor, but the
HTTP /prompt API has no way to hand it a raw numpy array directly. Standard
ComfyUI-API workaround (same one the "load a mask from disk" examples in
ComfyUI's own docs use): write the mask as a grayscale PNG straight into
~/ComfyUI/input/ (same filesystem, no need for the /upload/image endpoint),
then LoadImage that file -> ImageToMask(channel=red) -> MASK. A grayscale
PNG loaded by LoadImage decodes to equal R=G=B, so "red" channel == the
mask's own grayscale value.

Usage:
  python3 tools/gen_item_icons.py --defs content/live/live_items.json \
      --outdir content/batches/batch-003-item-icons/candidates

  python3 tools/gen_item_icons.py --defs tmp/req0073_stub_defs.json \
      --ids hilt --candidates 1 --outdir /tmp/smoke_test

Background (mandatory for anything more than a single-image smoke test --
8GB VRAM card, sequential jobs, 20-40s/image, a full batch can run minutes):
  cd ~/backpack_ragnarok && setsid nohup .venv/bin/python tools/gen_item_icons.py \
      --defs content/live/live_items.json \
      --outdir content/batches/batch-003-item-icons/candidates \
      > tmp/gen_item_icons.log 2>&1 &
"""
import argparse
import glob
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image

# rembg's model download/session machinery is identical to
# tools/matte_transparent.py -- imported (not reimplemented) per REQ-0073's
# "study and reuse" instruction. matte_transparent.py itself has no
# importable matte(path_in, path_out) signature we can call on in-memory
# PIL images without a disk round-trip, so we mirror its exact call here
# (same session/model/alpha-matting parameters) rather than shelling out to
# it per-file. If matte_transparent.py's parameters change, update both.
from rembg import remove, new_session

COMFY = "http://127.0.0.1:8188"
CKPT = "JuggernautXL_RunDiffusionPhoto2_V9_Final.safetensors"
DEFAULT_SEEDS = [101, 202, 303, 404]
COMFY_INPUT_DIR = os.path.expanduser("~/ComfyUI/input")
COMFY_OUTPUT_DIR = os.path.expanduser("~/ComfyUI/output")

_rembg_session = None


def get_rembg_session():
    global _rembg_session
    if _rembg_session is None:
        _rembg_session = new_session("isnet-anime")
    return _rembg_session


# =====================================================================
# ComfyUI API plumbing (same pattern as tools/gen_monster_art.py)
# =====================================================================
def submit(wf):
    data = json.dumps({"prompt": wf}).encode()
    req = urllib.request.Request(
        COMFY + "/prompt", data=data, headers={"Content-Type": "application/json"}
    )
    try:
        r = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ComfyUI /prompt rejected workflow: {e} -- {body}")
    if "error" in r:
        raise RuntimeError(f"ComfyUI /prompt error: {r['error']}")
    return r["prompt_id"]


def wait_done(pid, timeout_s=300):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(2)
        try:
            h = json.load(urllib.request.urlopen(COMFY + "/history/" + pid, timeout=20))
        except Exception:
            continue
        if pid in h and h[pid].get("status", {}).get("completed"):
            return h[pid]
        # ComfyUI marks failed jobs as completed=False with a status_str;
        # detect execution errors so callers don't spin the full timeout.
        if pid in h:
            status = h[pid].get("status", {})
            if status.get("status_str") == "error":
                return h[pid]
    return None


def check_conditioning_set_mask_available():
    """GET /object_info/ConditioningSetMask -- returns True if the core node
    is present in this ComfyUI install, False otherwise (never raises;
    caller logs a warning and proceeds unmasked on any failure, per spec)."""
    try:
        r = json.load(
            urllib.request.urlopen(COMFY + "/object_info/ConditioningSetMask", timeout=15)
        )
        return "ConditioningSetMask" in r
    except Exception:
        return False


# =====================================================================
# Mask-cells -> ComfyUI MASK conditioning
# =====================================================================
def build_cell_mask_image(mask_cells, bbox_cells, cell_px, gen_px, path_out):
    """Build a grayscale mask PNG at gen_px resolution: mask_cells cells get
    weight 1.0, all other cells get weight ~0.15 (soft bias, not a hard cut --
    ConditioningSetMask strength still applies on top, and this is a
    best-effort placement hint per REQ-0073, not a placement guarantee).

    mask_cells / bbox_cells use the same [row,col] convention as "shape"
    (see tool_fit_check.py's shape_to_cellset docstring -- [row,col], first
    index is row). bbox_cells = [w,h] cell bounding box (REQ-0073 field
    order), i.e. cols=bbox_cells[0], rows=bbox_cells[1].

    The mask is built at the CELL-GRID's native px (cols*cell_px x
    rows*cell_px) then resized (nearest, since it's a flat per-cell weight
    map, not photographic content) to the actual gen_px the KSampler will
    use -- gen_px is ~1MP and same-aspect as target_px per REQ-0073, but not
    necessarily an exact bbox_cells*cell_px multiple, so this resize step
    is required for the mask to line up with the latent's own resolution.
    """
    cols, rows = bbox_cells[0], bbox_cells[1]
    native_w, native_h = cols * cell_px, rows * cell_px
    grid = np.full((rows, cols), 0.15, dtype=np.float32)
    for cell in mask_cells:
        r, c = cell[0], cell[1]
        if 0 <= r < rows and 0 <= c < cols:
            grid[r, c] = 1.0
    # Upscale cell-grid to native px (nearest -- flat per-cell blocks).
    native = np.repeat(np.repeat(grid, cell_px, axis=0), cell_px, axis=1)
    im = Image.fromarray((native * 255).astype(np.uint8), mode="L")
    gw, gh = gen_px[0], gen_px[1]
    if (native_w, native_h) != (gw, gh):
        im = im.resize((gw, gh), Image.NEAREST)
    im.save(path_out)


# =====================================================================
# Workflow construction
# =====================================================================
def build_workflow(pos_prompt, neg_prompt, gen_w, gen_h, seed, steps, cfg,
                    sampler, scheduler, mask_image_filename=None):
    """Build a ComfyUI graph: ckpt -> CLIP encode (pos/neg) -> [optional
    ConditioningSetMask on positive only] -> EmptyLatentImage -> KSampler ->
    VAEDecode -> SaveImage. filename_prefix is unique per (seed) call so the
    caller can find its own output by glob without colliding with other
    concurrent candidates (this tool runs jobs sequentially, but the prefix
    also protects against stale files from a previous partial run)."""
    wf = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": pos_prompt, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg_prompt, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": gen_w, "height": gen_h, "batch_size": 1}},
    }

    positive_ref = ["2", 0]
    if mask_image_filename:
        # LoadImage the mask PNG (already written into ~/ComfyUI/input/) ->
        # ImageToMask(red channel; grayscale PNG decodes R=G=B) -> MASK ->
        # ConditioningSetMask applied to the POSITIVE conditioning only
        # (subject-placement bias must not affect the negative prompt).
        wf["10"] = {"class_type": "LoadImage", "inputs": {"image": mask_image_filename}}
        wf["11"] = {"class_type": "ImageToMask", "inputs": {"image": ["10", 0], "channel": "red"}}
        wf["12"] = {
            "class_type": "ConditioningSetMask",
            "inputs": {
                "conditioning": ["2", 0],
                "mask": ["11", 0],
                "strength": 1.0,
                "set_cond_area": "default",
            },
        }
        positive_ref = ["12", 0]

    wf["5"] = {
        "class_type": "KSampler",
        "inputs": {
            "model": ["1", 0], "positive": positive_ref, "negative": ["3", 0],
            "latent_image": ["4", 0], "seed": seed, "steps": steps, "cfg": cfg,
            "sampler_name": sampler, "scheduler": scheduler, "denoise": 1.0,
        },
    }
    wf["6"] = {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}}
    prefix = f"item_gen_{seed}_{int(time.time() * 1000) % 100000}"
    wf["7"] = {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}}
    return wf, prefix


# =====================================================================
# Post-processing: downscale + alpha matte
# =====================================================================
def downscale_lanczos(src_path, dst_path, target_w, target_h):
    im = Image.open(src_path).convert("RGB")
    im = im.resize((target_w, target_h), Image.LANCZOS)
    im.save(dst_path)


def matte_alpha(src_path, dst_path):
    """Same call shape as matte_transparent.py's matte(): rembg.remove with
    isnet-anime session, alpha_matting on (smooth antialiased edges, no
    halo), post_process_mask on (drops soft "ghost" partial-alpha regions)."""
    im = Image.open(src_path)
    out = remove(
        im,
        session=get_rembg_session(),
        alpha_matting=True,
        alpha_matting_foreground_threshold=250,
        alpha_matting_background_threshold=5,
        alpha_matting_erode_size=5,
        post_process_mask=True,
    )
    out.save(dst_path)


def alpha_coverage_fraction(path):
    """Fraction of pixels with alpha > 0 -- used only for the smoke-test
    sanity check (not part of the main generation path)."""
    im = Image.open(path)
    if im.mode != "RGBA":
        return None
    a = np.array(im)[:, :, 3]
    return float((a > 0).sum()) / a.size


# =====================================================================
# Defs loading
# =====================================================================
def load_defs(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "entries" in data:
        return data["entries"]
    raise ValueError(f"Unrecognized defs format in {path}")


def entries_with_gen_fields(entries, id_filter=None):
    """Filter to entries that actually carry gen_prompt/gen_render (REQ-0073
    additive fields) -- entries authored before REQ-0073 lands (or items
    outside batch-003's scope) are silently skipped with a printed reason,
    not treated as a fatal error, since defs files are shared/concurrently
    edited (see caller note: live_items.json may not have these fields yet
    for every entry)."""
    out = []
    for e in entries:
        eid = e.get("id")
        if id_filter is not None and eid not in id_filter:
            continue
        if not e.get("gen_prompt") or not e.get("gen_render"):
            print(f"SKIP id={eid}: missing gen_prompt/gen_render (not authored for REQ-0073 yet)", flush=True)
            continue
        out.append(e)
    return out


# =====================================================================
# Main per-item-per-seed job driver
# =====================================================================
def main():
    ap = argparse.ArgumentParser(description="ComfyUI item-icon candidate generator (REQ-0073)")
    ap.add_argument("--defs", default="content/live/live_items.json")
    ap.add_argument("--ids", default=None, help="comma-separated id filter, e.g. blade,hilt")
    ap.add_argument("--outdir", default="content/batches/batch-003-item-icons/candidates")
    ap.add_argument("--candidates", type=int, default=4, help="number of candidates per item (<= len(--seeds))")
    ap.add_argument("--seeds", default="101,202,303,404")
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--cfg", type=float, default=6.5)
    ap.add_argument("--sampler", default="dpmpp_2m")
    ap.add_argument("--scheduler", default="karras")
    ap.add_argument("--no-mask", action="store_true", help="disable ConditioningSetMask regional bias even if mask_cells is present")
    ap.add_argument("--force", action="store_true", help="regenerate even if output files already exist")
    a = ap.parse_args()

    seeds = [int(s) for s in a.seeds.split(",") if s.strip() != ""]
    if a.candidates > len(seeds):
        raise SystemExit(f"--candidates {a.candidates} exceeds available --seeds count {len(seeds)}")
    seeds = seeds[: a.candidates]

    id_filter = set(a.ids.split(",")) if a.ids else None

    entries = load_defs(a.defs)
    entries = entries_with_gen_fields(entries, id_filter)
    if not entries:
        print("No entries with gen_prompt/gen_render found (nothing to do).", flush=True)
        sys.exit(0)

    mask_available = check_conditioning_set_mask_available()
    if mask_available:
        print("ConditioningSetMask: AVAILABLE (regional mask conditioning enabled where mask_cells is set)", flush=True)
    else:
        print("WARNING: ConditioningSetMask NOT available on this ComfyUI install -- "
              "proceeding UNMASKED for all items regardless of mask_cells "
              "(scoring downstream handles placement anyway; see REQ-0073).", flush=True)

    os.makedirs(a.outdir, exist_ok=True)
    os.makedirs(COMFY_OUTPUT_DIR, exist_ok=True)
    os.makedirs(COMFY_INPUT_DIR, exist_ok=True)

    any_failed = False
    total_jobs = len(entries) * len(seeds)
    done_jobs = 0

    for entry in entries:
        eid = entry["id"]
        pos_prompt = entry["gen_prompt"]
        neg_prompt = entry.get("gen_negative", "")
        render = entry["gen_render"]
        gen_w, gen_h = render["gen_px"][0], render["gen_px"][1]
        target_w, target_h = render["target_px"][0], render["target_px"][1]
        cell_px = render.get("cell_px", 256)
        mask_cells = render.get("mask_cells") if not a.no_mask else None
        bbox_cells = render.get("bbox_cells")

        # Build the mask image once per item (seed-independent -- placement
        # bias is the same cell geometry regardless of which seed is running).
        mask_image_filename = None
        if mask_cells and mask_available:
            if not bbox_cells:
                print(f"WARNING id={eid}: mask_cells present but bbox_cells missing -- skipping mask for this item.", flush=True)
            else:
                mask_image_filename = f"gen_item_mask_{eid}.png"
                mask_path = os.path.join(COMFY_INPUT_DIR, mask_image_filename)
                build_cell_mask_image(mask_cells, bbox_cells, cell_px, (gen_w, gen_h), mask_path)
        elif mask_cells and not mask_available:
            print(f"NOTE id={eid}: mask_cells present but ConditioningSetMask unavailable -- generating unmasked.", flush=True)

        for k, seed in enumerate(seeds, start=1):
            done_jobs += 1
            raw_name = f"{eid}_c{k}_s{seed}.png"
            alpha_name = f"{eid}_c{k}_s{seed}_alpha.png"
            raw_path = os.path.join(a.outdir, raw_name)
            alpha_path = os.path.join(a.outdir, alpha_name)

            if not a.force and os.path.exists(raw_path) and os.path.exists(alpha_path):
                print(f"[{done_jobs}/{total_jobs}] SKIP (exists) {raw_name}", flush=True)
                continue

            print(f"[{done_jobs}/{total_jobs}] START id={eid} c={k} seed={seed} gen_px={gen_w}x{gen_h} -> target_px={target_w}x{target_h}"
                  f"{' masked' if mask_image_filename else ''}", flush=True)
            t0 = time.time()
            try:
                wf, prefix = build_workflow(
                    pos_prompt, neg_prompt, gen_w, gen_h, seed, a.steps, a.cfg,
                    a.sampler, a.scheduler, mask_image_filename=mask_image_filename,
                )
                pid = submit(wf)
                result = wait_done(pid)
                if not result:
                    print(f"[{done_jobs}/{total_jobs}] FAIL (timeout) id={eid} c={k} seed={seed}", flush=True)
                    any_failed = True
                    continue
                status = result.get("status", {})
                if status.get("status_str") == "error":
                    print(f"[{done_jobs}/{total_jobs}] FAIL (comfy error) id={eid} c={k} seed={seed}: {status}", flush=True)
                    any_failed = True
                    continue

                pattern = os.path.join(COMFY_OUTPUT_DIR, f"{prefix}*.png")
                matches = sorted(glob.glob(pattern), key=os.path.getmtime)
                if not matches:
                    print(f"[{done_jobs}/{total_jobs}] FAIL (no output file) id={eid} c={k} seed={seed}", flush=True)
                    any_failed = True
                    continue
                gen_src = matches[-1]

                # Downscale gen_px -> target_px (Lanczos). This resized file
                # IS the saved candidate raw output per REQ-0073 (the full
                # gen_px frame is not separately retained).
                downscale_lanczos(gen_src, raw_path, target_w, target_h)

                # Alpha matte from the SAME downscaled raw (matting at the
                # smaller target_px is faster and the final in-game asset
                # is target_px anyway, so edge quality at that resolution is
                # what actually matters).
                matte_alpha(raw_path, alpha_path)

                dt = time.time() - t0
                print(f"[{done_jobs}/{total_jobs}] DONE id={eid} c={k} seed={seed} -> {raw_name} ({dt:.1f}s)", flush=True)
            except Exception as e:
                print(f"[{done_jobs}/{total_jobs}] FAIL (exception) id={eid} c={k} seed={seed}: {e}", flush=True)
                any_failed = True
                continue

    print("ALL DONE", flush=True)
    sys.exit(1 if any_failed else 0)


if __name__ == "__main__":
    main()
