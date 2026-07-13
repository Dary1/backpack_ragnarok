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
  - Also produces a background-removed "_alpha" version per candidate via
    matte_alpha() (see below), so scoring (tools/tool_icon_score.py) can run
    tool_fit_check.load_content-style alpha analysis without a separate
    manual matting pass.
  - Optionally biases subject placement into gen_render.mask_cells via
    ComfyUI's ConditioningSetMask (regional conditioning on the positive
    prompt only) -- best-effort placement hint, NOT a placement guarantee;
    downstream fit-scoring (tool_icon_score.py / tool_fit_check.py) remains
    mandatory regardless of masking.

matte_alpha() model choice / history (post-mortem, batch-003):
Originally this reused matte_transparent.py's model choice (isnet-anime),
on the reasoning that item icons are photoreal-styled (JuggernautXL)
product-shot renders on a near-white backdrop that is not guaranteed pure
single-RGB and can have soft edges (metal specular falloff, fabric
fringing) -- the case matte_transparent.py's own docstring says chroma-key
handles poorly, and isnet-anime had been measurably as good as
birefnet-general on monster art at 8x the speed. That reasoning held for
monster art but broke for batch-003: several JuggernautXL candidates came
out on a DARK charcoal backdrop instead of the mandated near-white (a
generation-side inconsistency, not a matting bug per se), and isnet-anime
-- tuned against the assumption of a bright/near-white backdrop -- then
classified the ENTIRE frame (subject included) as background, producing
near-empty alpha (e.g. blade_c3_s303_alpha.png came out ~0.01% opaque
while blade_c3_s303.png is a perfectly good sword on a dark bg).

matte_alpha() is now a two-strategy matte, robust to that failure mode:

  1. PRIMARY -- rembg with the "birefnet-general" session (alpha_matting +
     post_process_mask on). BiRefNet is a general salient-object detector,
     not tuned to any particular backdrop brightness/color the way
     isnet-anime is, so it is robust to the dark-backdrop case that broke
     isnet-anime. This is the accuracy-over-speed tradeoff batch-003's
     defect forced: birefnet-general is slower per image (CPU: ~5-20s vs
     isnet-anime's sub-3s) but does not silently collapse to near-empty
     alpha on an off-spec backdrop.
  2. VALIDITY BAND -- opaque coverage = fraction of pixels with alpha > 8,
     accepted if 0.02 <= coverage <= 0.90. Below 0.02 means the matte ate
     the subject (the isnet-anime failure mode above); above 0.90 means
     the matte kept the backdrop (matte did nothing / inverted).
  3. FALLBACK (only if primary is out-of-band) -- border-color keying:
     sample a thin band around all 4 image edges, take the median RGB as
     the presumed backdrop color (whatever it actually is, bright or
     dark), build a soft per-pixel alpha from color-distance-to-that-median
     (smoothstep feather, not a hard cutoff, to avoid the fringing/halo a
     hard chroma-key produces), then a small morphological opening to
     kill speckle noise. This is deliberately NOT a fixed-color chroma-key
     (chroma_key.py's own docstring flags that it assumes a known uniform
     flat backdrop) -- it derives the key color per-image from the actual
     borders, so it degrades gracefully regardless of which backdrop
     color a given render actually landed on.
  4. If BOTH methods are out-of-band, keep whichever result is CLOSER to
     the band (smaller distance from the nearest band edge) and log a
     WARN line -- there is no third fallback; a human has to look at that
     candidate.

isnet-anime remains cached and importable but is no longer used by this
tool. get_rembg_session_birefnet() is a lazily-initialized global (session
objects are not free to construct) so it's only loaded once and reused
across all files in a run.

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

  # Re-run ONLY the matte step against already-generated raw candidates
  # (no ComfyUI calls at all) -- e.g. after a matte_alpha() fix:
  python3 tools/gen_item_icons.py --defs content/live/live_items.json \
      --outdir content/batches/batch-003-item-icons/candidates \
      --rematte-only
  python3 tools/gen_item_icons.py --defs content/live/live_items.json \
      --outdir content/batches/batch-003-item-icons/candidates \
      --rematte-only --ids blade,flame_tablet

Background (mandatory for anything more than a single-image smoke test --
8GB VRAM card, sequential jobs, 20-40s/image, a full batch can run minutes;
--rematte-only doesn't touch ComfyUI but birefnet-general on CPU is still
~5-20s/image, so it's worth backgrounding too for a full batch):
  cd ~/backpack_ragnarok && setsid nohup .venv/bin/python tools/gen_item_icons.py \
      --defs content/live/live_items.json \
      --outdir content/batches/batch-003-item-icons/candidates \
      > tmp/gen_item_icons.log 2>&1 &
"""
import argparse
import glob
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage

# rembg's model download/session machinery is identical to
# tools/matte_transparent.py -- imported (not reimplemented) per REQ-0073's
# "study and reuse" instruction.
from rembg import remove, new_session

COMFY = "http://127.0.0.1:8188"

# ---------------------------------------------------------------------------
# Generation route. THE ONLY PRODUCTION ROUTE: flux2 (REQ-0136 bakeoff, user
# verdict 2026-07-12; REQ-0150 flux2化, user 2026-07-13). FLUX.2 klein 4B beat
# JuggernautXL V9 and DreamShaperXL Turbo on every axis the bakeoff tested:
# brief compliance (near-white background 16/16 vs 5/16 and 1/16), painterly
# style, warm speed (10 s vs 40 s and 20 s) and licence (Apache 2.0).
#
# THE "sdxl" ROUTE IS FROZEN (REQ-0150). It is NOT a production route and NOT a
# fallback. It stays runnable for exactly one purpose: reproducing historical
# pre-flux2 batches. Nothing may reach it implicitly -- it is never a default,
# no wrapper selects it, and no doc points at it except as history. Selecting it
# takes an explicit `--route sdxl` and prints a FROZEN banner. Re-instating SDXL
# as a production route takes an explicit, fresh user decision.
ROUTE = "flux2"                  # "flux2" (production) | "sdxl" (FROZEN)

# FROZEN -- sdxl route only. See the banner in main().
CKPT = "JuggernautXL_RunDiffusionPhoto2_V9_Final.safetensors"   # sdxl (FROZEN)

FLUX = {
    "unet": "flux-2-klein-4b-Q8_0.gguf",      # Apache 2.0, unsloth GGUF Q8_0
    "clip": "qwen_3_4b.safetensors",
    "vae": "flux2-vae.safetensors",
    "steps": 4, "cfg": 1.0, "sampler": "euler",
}

# Per-route sampler defaults; the CLI's --steps/--cfg still override.
ROUTE_DEFAULTS = {
    "flux2": {"steps": 4, "cfg": 1.0, "sampler": "euler", "scheduler": None},
    "sdxl": {"steps": 30, "cfg": 6.5, "sampler": "dpmpp_2m",
             "scheduler": "karras"},
}
DEFAULT_SEEDS = [101, 202, 303, 404]
COMFY_INPUT_DIR = os.path.expanduser("~/ComfyUI/input")
COMFY_OUTPUT_DIR = os.path.expanduser("~/ComfyUI/output")

# Raw candidate filename pattern used by both the generation path (below)
# and --rematte-only's directory scan: "<id>_c<k>_s<seed>.png", explicitly
# NOT matching the paired "*_alpha.png" output.
RAW_CANDIDATE_RE = re.compile(r"^(?P<id>.+)_c(?P<k>\d+)_s(?P<seed>\d+)\.png$")

# matte_alpha() validity band: fraction of pixels with alpha > ALPHA_OPAQUE_T
# must fall in [COVERAGE_MIN, COVERAGE_MAX] for a matte to be accepted
# outright. Below MIN => matte ate the subject (isnet-anime-on-dark-bg
# failure mode); above MAX => matte kept the backdrop / did nothing.
ALPHA_OPAQUE_T = 8
COVERAGE_MIN = 0.02
COVERAGE_MAX = 0.90

# Border-key fallback tuning.
BORDER_BAND_PX = 6
BORDER_KEY_FEATHER_LO = 18.0   # color distance below this -> fully transparent
BORDER_KEY_FEATHER_HI = 40.0   # color distance above this -> fully opaque ("keep")
BORDER_KEY_OPEN_ITER = 1       # morphological-open iterations (speckle cleanup)

_rembg_session_birefnet = None


def get_rembg_session_birefnet():
    """Lazily-constructed rembg session for the primary matte model
    (birefnet-general -- see module docstring for why this replaced
    isnet-anime as the default). Session construction loads the onnx model
    into memory, so this is only done once and reused across all files."""
    global _rembg_session_birefnet
    if _rembg_session_birefnet is None:
        _rembg_session_birefnet = new_session("birefnet-general")
    return _rembg_session_birefnet


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
    """Dispatch on the active ROUTE. Same (wf, prefix) contract either way."""
    if ROUTE == "flux2":
        return _wf_flux2(pos_prompt, neg_prompt, gen_w, gen_h, seed, steps,
                         cfg, sampler, mask_image_filename)
    return _wf_sdxl(pos_prompt, neg_prompt, gen_w, gen_h, seed, steps, cfg,
                    sampler, scheduler, mask_image_filename)


def _wf_flux2(pos_prompt, neg_prompt, gen_w, gen_h, seed, steps, cfg,
              sampler, mask_image_filename=None):
    """FLUX.2 klein 4B distilled, GGUF. Mirrors ComfyUI's official
    "Text to Image (Flux.2 Klein 4B Distilled)" template with UNETLoader
    swapped for UnetLoaderGGUF. Proven by REQ-0136 (16/16 on brief).

    THE NEGATIVE PROMPT IS INACTIVE HERE. Distilled klein samples at cfg 1.0,
    where the guider applies no classifier-free guidance, and the official
    graph feeds a ConditioningZeroOut of the POSITIVE in as the negative. A
    caller's neg_prompt is accepted and DISCARDED -- style must be steered from
    the POSITIVE prompt. Warned once per process on purpose: silently accepting
    a negative that does nothing is how a style regression hides for a month.
    """
    if neg_prompt and not getattr(_wf_flux2, "_warned", False):
        print("NOTE flux2 route: the negative prompt is INACTIVE at cfg 1.0 "
              "(zeroed conditioning, official distilled graph). Steer style "
              "from the POSITIVE prompt.", flush=True)
        _wf_flux2._warned = True

    prefix = f"gen_{seed}_{os.getpid()}"
    wf = {
        "1": {"class_type": "UnetLoaderGGUF",
              "inputs": {"unet_name": FLUX["unet"]}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": FLUX["clip"], "type": "flux2",
                         "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": FLUX["vae"]}},
        "4": {"class_type": "CLIPTextEncode",
              "inputs": {"text": pos_prompt, "clip": ["2", 0]}},
    }
    positive_ref = ["4", 0]
    if mask_image_filename:
        # Same subject-placement bias as the SDXL route: mask the POSITIVE
        # conditioning only. The negative is a zero-out of the UNMASKED
        # positive -- zeroing the masked one would leave everything outside the
        # mask unguided.
        wf["10"] = {"class_type": "LoadImage",
                    "inputs": {"image": mask_image_filename}}
        wf["11"] = {"class_type": "ImageToMask",
                    "inputs": {"image": ["10", 0], "channel": "red"}}
        wf["12"] = {"class_type": "ConditioningSetMask",
                    "inputs": {"conditioning": ["4", 0], "mask": ["11", 0],
                               "strength": 1.0, "set_cond_area": "default"}}
        positive_ref = ["12", 0]

    wf["5"] = {"class_type": "ConditioningZeroOut",
               "inputs": {"conditioning": ["4", 0]}}
    wf["6"] = {"class_type": "EmptyFlux2LatentImage",
               "inputs": {"width": gen_w, "height": gen_h, "batch_size": 1}}
    wf["7"] = {"class_type": "KSamplerSelect",
               "inputs": {"sampler_name": sampler or FLUX["sampler"]}}
    wf["8"] = {"class_type": "Flux2Scheduler",
               "inputs": {"steps": steps or FLUX["steps"],
                          "width": gen_w, "height": gen_h}}
    wf["9"] = {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}}
    wf["13"] = {"class_type": "CFGGuider",
                "inputs": {"model": ["1", 0], "positive": positive_ref,
                           "negative": ["5", 0],
                           "cfg": cfg if cfg is not None else FLUX["cfg"]}}
    wf["14"] = {"class_type": "SamplerCustomAdvanced",
                "inputs": {"noise": ["9", 0], "guider": ["13", 0],
                           "sampler": ["7", 0], "sigmas": ["8", 0],
                           "latent_image": ["6", 0]}}
    wf["15"] = {"class_type": "VAEDecode",
                "inputs": {"samples": ["14", 0], "vae": ["3", 0]}}
    wf["16"] = {"class_type": "SaveImage",
                "inputs": {"images": ["15", 0], "filename_prefix": prefix}}
    return wf, prefix


def _wf_sdxl(pos_prompt, neg_prompt, gen_w, gen_h, seed, steps, cfg,
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


def _coverage(rgba_array):
    """Fraction of pixels with alpha > ALPHA_OPAQUE_T, given an HxWx4
    uint8 numpy array."""
    a = rgba_array[:, :, 3]
    return float((a > ALPHA_OPAQUE_T).sum()) / a.size


def _in_band(coverage):
    return COVERAGE_MIN <= coverage <= COVERAGE_MAX


def _band_distance(coverage):
    """0.0 if inside the validity band, else distance to the nearer edge --
    used only to pick the "closer to band" result when BOTH methods land
    out-of-band (step 1.d)."""
    if coverage < COVERAGE_MIN:
        return COVERAGE_MIN - coverage
    if coverage > COVERAGE_MAX:
        return coverage - COVERAGE_MAX
    return 0.0


def _matte_birefnet(im_rgb):
    """PRIMARY strategy: rembg with the birefnet-general session,
    alpha_matting + post_process_mask on. Returns an RGBA PIL Image.

    birefnet-general is a general salient-object detector -- not tuned to
    any assumed backdrop brightness the way isnet-anime is -- so it does
    not collapse to near-empty alpha on an off-spec (e.g. dark charcoal)
    backdrop the way isnet-anime did (see module docstring post-mortem)."""
    out = remove(
        im_rgb,
        session=get_rembg_session_birefnet(),
        alpha_matting=True,
        alpha_matting_foreground_threshold=250,
        alpha_matting_background_threshold=5,
        alpha_matting_erode_size=5,
        post_process_mask=True,
    )
    return out.convert("RGBA")


def _smoothstep(x, lo, hi):
    """Standard smoothstep, clamped: 0 below lo, 1 above hi, cubic ease
    between -- used so the border-key fallback produces a soft feathered
    edge rather than a hard chroma-key cutoff (which fringes/haloes)."""
    t = np.clip((x - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def _matte_border_key(im_rgb):
    """FALLBACK strategy: border-color keying. Samples a thin band around
    all 4 edges of the image, takes the median RGB as the presumed
    backdrop color (derived from the actual image, not assumed to be any
    particular fixed color -- this is what makes it robust to the
    dark-vs-near-white backdrop inconsistency that broke isnet-anime),
    builds a soft per-pixel alpha from color distance to that median via
    smoothstep (feather band BORDER_KEY_FEATHER_LO..HI), then applies a
    small morphological opening to remove speckle noise before returning
    an RGBA PIL Image.

    Deliberately not a fixed known-color chroma-key: chroma_key.py's own
    docstring flags that approach as assuming a known uniform flat
    backdrop. Sampling the median from this image's own borders lets the
    key work regardless of which color a given render actually landed on."""
    arr = np.array(im_rgb.convert("RGB"), dtype=np.float64)
    h, w = arr.shape[:2]
    b = min(BORDER_BAND_PX, h // 2, w // 2) or 1
    border_px = np.concatenate([
        arr[:b, :, :].reshape(-1, 3),
        arr[-b:, :, :].reshape(-1, 3),
        arr[:, :b, :].reshape(-1, 3),
        arr[:, -b:, :].reshape(-1, 3),
    ], axis=0)
    median_color = np.median(border_px, axis=0)

    dist = np.sqrt(((arr - median_color) ** 2).sum(axis=2))
    # Far from the backdrop median -> subject -> keep (alpha 1). Close to
    # the backdrop median -> background -> alpha 0. Feather between.
    alpha_f = _smoothstep(dist, BORDER_KEY_FEATHER_LO, BORDER_KEY_FEATHER_HI)

    # Small morphological opening (erode then dilate) on a binarized view
    # of the soft mask to kill isolated speckle without recreating the
    # hard-edge problem in the real feathered band -- applied as a
    # multiplicative cleanup mask, not a replacement for alpha_f itself.
    binary = alpha_f > 0.5
    opened = ndimage.binary_opening(binary, iterations=BORDER_KEY_OPEN_ITER)
    # Pixels that were "on" but got opened away are speckle -> zero them;
    # everything else keeps its original feathered alpha value.
    speckle = binary & ~opened
    alpha_f[speckle] = 0.0

    alpha_u8 = np.clip(alpha_f * 255.0, 0, 255).astype(np.uint8)
    rgba = np.dstack([np.array(im_rgb.convert("RGB")), alpha_u8])
    return Image.fromarray(rgba, mode="RGBA")


def matte_alpha(src_path, dst_path, log_label=None):
    """Two-strategy matte -- see module docstring for full rationale.

    1. Primary: rembg birefnet-general (alpha_matting + post_process_mask
       on) -- robust to any backdrop color/brightness.
    2. Validity band: accept if COVERAGE_MIN <= opaque_fraction <=
       COVERAGE_MAX.
    3. Fallback if primary is out-of-band: border-color keying (median of
       a thin border band, smoothstep color-distance alpha, small
       morphological open for speckle).
    4. If BOTH are out-of-band: keep whichever is closer to the band and
       log a WARN -- there is no further automatic fallback.

    Logs exactly one line per file: file, method used (birefnet|
    borderkey), coverage%. log_label defaults to the basename of dst_path.

    Same signature as before (src_path, dst_path) plus an optional
    log_label kwarg -- existing callers that only pass two positional
    args are unaffected.
    """
    label = log_label if log_label is not None else os.path.basename(dst_path)

    im = Image.open(src_path).convert("RGB")

    primary_img = _matte_birefnet(im)
    primary_cov = _coverage(np.array(primary_img))

    if _in_band(primary_cov):
        primary_img.save(dst_path)
        print(f"MATTE {label} method=birefnet coverage={primary_cov * 100:.2f}%", flush=True)
        return

    fallback_img = _matte_border_key(im)
    fallback_cov = _coverage(np.array(fallback_img))

    if _in_band(fallback_cov):
        fallback_img.save(dst_path)
        print(f"MATTE {label} method=borderkey coverage={fallback_cov * 100:.2f}%", flush=True)
        return

    # Both out-of-band: keep whichever is closer to the validity band.
    if _band_distance(primary_cov) <= _band_distance(fallback_cov):
        chosen_img, chosen_method, chosen_cov = primary_img, "birefnet", primary_cov
    else:
        chosen_img, chosen_method, chosen_cov = fallback_img, "borderkey", fallback_cov

    chosen_img.save(dst_path)
    print(f"MATTE {label} method={chosen_method} coverage={chosen_cov * 100:.2f}%", flush=True)
    print(f"WARN {label} coverage={chosen_cov * 100:.2f}% method={chosen_method} OUT-OF-BAND", flush=True)


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
# --rematte-only path: re-run matte_alpha() over existing raw candidates
# without touching ComfyUI at all.
# =====================================================================
def find_raw_candidates(outdir, id_filter=None):
    """Scan outdir for files matching RAW_CANDIDATE_RE (raw candidates only,
    e.g. "blade_c3_s303.png" -- explicitly excludes "*_alpha.png" via the
    explicit endswith check below, applied before the regex match). Returns
    a sorted list of (id, k, seed, raw_path) tuples, optionally filtered to
    id_filter."""
    found = []
    for name in sorted(os.listdir(outdir)):
        if not name.endswith(".png") or name.endswith("_alpha.png"):
            continue
        m = RAW_CANDIDATE_RE.match(name)
        if not m:
            continue
        eid = m.group("id")
        if id_filter is not None and eid not in id_filter:
            continue
        found.append((eid, int(m.group("k")), int(m.group("seed")), os.path.join(outdir, name)))
    return found


def run_rematte_only(outdir, id_filter=None):
    """--rematte-only entry point: skips generation entirely. For every
    existing raw candidate PNG in outdir (pattern <id>_c<k>_s<seed>.png,
    NOT *_alpha.png), regenerate its paired _alpha.png via the current
    matte_alpha(). Respects --ids filtering. Returns True if any file
    ended up logged as OUT-OF-BAND (mirrors main()'s any_failed exit-code
    convention, so a caller scripting this can still detect trouble via
    exit code without parsing the log)."""
    candidates = find_raw_candidates(outdir, id_filter)
    if not candidates:
        print(f"--rematte-only: no raw candidate PNGs found in {outdir} (nothing to do).", flush=True)
        return False

    print(f"--rematte-only: found {len(candidates)} raw candidate(s) in {outdir}; rematting each.", flush=True)
    any_out_of_band = False
    for i, (eid, k, seed, raw_path) in enumerate(candidates, start=1):
        raw_name = os.path.basename(raw_path)
        alpha_name = raw_name[:-4] + "_alpha.png"
        alpha_path = os.path.join(outdir, alpha_name)
        print(f"[{i}/{len(candidates)}] REMATTE id={eid} c={k} seed={seed} {raw_name} -> {alpha_name}", flush=True)
        t0 = time.time()
        try:
            matte_alpha(raw_path, alpha_path, log_label=alpha_name)
        except Exception as e:
            print(f"[{i}/{len(candidates)}] FAIL (exception) {raw_name}: {e}", flush=True)
            any_out_of_band = True
            continue
        dt = time.time() - t0
        print(f"[{i}/{len(candidates)}] DONE {alpha_name} ({dt:.1f}s)", flush=True)

    print("ALL DONE (--rematte-only)", flush=True)
    return any_out_of_band


# =====================================================================
# Main per-item-per-seed job driver
# =====================================================================
def main():
    global ROUTE
    ap = argparse.ArgumentParser(description="ComfyUI item-icon candidate generator (REQ-0073)")
    ap.add_argument("--defs", default="content/live/live_items.json")
    ap.add_argument("--ids", default=None, help="comma-separated id filter, e.g. blade,hilt")
    ap.add_argument("--outdir", default="content/batches/batch-003-item-icons/candidates")
    ap.add_argument("--candidates", type=int, default=4, help="number of candidates per item (<= len(--seeds))")
    ap.add_argument("--seeds", default="101,202,303,404")
    ap.add_argument("--route", default=ROUTE, choices=("flux2", "sdxl"),
                    help="generation route. Default and ONLY production route: "
                         "flux2. 'sdxl' is FROZEN (REQ-0150) -- historical "
                         "reproduction only, never for new production art.")
    # Sampler defaults are RESOLVED FROM THE ROUTE after parsing, not hardcoded
    # here. 30 steps / cfg 6.5 are SDXL numbers.
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--cfg", type=float, default=None)
    ap.add_argument("--sampler", default=None)
    ap.add_argument("--scheduler", default=None)
    ap.add_argument("--no-mask", action="store_true", help="disable ConditioningSetMask regional bias even if mask_cells is present")
    ap.add_argument("--force", action="store_true", help="regenerate even if output files already exist")
    ap.add_argument("--no-matte", action="store_true",
                    help="GENERATION PHASE: write raw candidates only, skip the "
                         "inline matte. Pair with a later --rematte-only run "
                         "made with ComfyUI STOPPED. Required for big batches: "
                         "rembg alpha_matting peaks at 12-13 GB RSS and will "
                         "not fit alongside a resident model (~11 GB) on the "
                         "23 GB box -- co-residency OOM-kills the run. "
                         "(REQ-0135b and REQ-0136 hit this independently.)")
    ap.add_argument("--rematte-only", action="store_true",
                     help="skip generation entirely; regenerate _alpha.png for every existing raw "
                          "candidate PNG in --outdir via the current matte_alpha() (respects --ids)")
    a = ap.parse_args()

    ROUTE = a.route
    if ROUTE == "sdxl":
        print("=" * 72, flush=True)
        print("WARNING  the 'sdxl' route is FROZEN (REQ-0150, user decision "
              "2026-07-13).", flush=True)
        print("         NOT a production route, NOT a fallback. Its only "
              "sanctioned use is", flush=True)
        print("         reproducing historical pre-flux2 batches. Do not ship "
              "art from it, and", flush=True)
        print("         do not use it to work around a flux2 problem -- fix "
              "flux2 or escalate.", flush=True)
        print("=" * 72, flush=True)
    _d = ROUTE_DEFAULTS[ROUTE]
    for _k in ("steps", "cfg", "sampler", "scheduler"):
        if getattr(a, _k) is None:
            setattr(a, _k, _d[_k])
    print(f"route: {ROUTE}  steps={a.steps} cfg={a.cfg} "
          f"sampler={a.sampler} scheduler={a.scheduler}", flush=True)
    print(f"  unet={FLUX['unet']} clip={FLUX['clip']}" if ROUTE == "flux2"
          else f"  ckpt={CKPT}", flush=True)

    if a.rematte_only:
        # No ComfyUI, no --defs read needed for this path -- it operates
        # purely off whatever raw candidate PNGs already exist on disk.
        id_filter = set(a.ids.split(",")) if a.ids else None
        any_out_of_band = run_rematte_only(a.outdir, id_filter)
        sys.exit(1 if any_out_of_band else 0)

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

            # A candidate is already done if its RAW exists -- and, only when
            # this run would also matte it, if its alpha exists too. Requiring
            # the alpha unconditionally makes --no-matte resumes regenerate
            # everything, because --no-matte never writes an alpha.
            done_here = os.path.exists(raw_path) and (
                a.no_matte or os.path.exists(alpha_path))
            if not a.force and done_here:
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
                if a.no_matte:
                    print(f"[{done_jobs}/{total_jobs}] SKIP-MATTE {alpha_name} "
                          f"(matte deferred: run --rematte-only with ComfyUI "
                          f"stopped)", flush=True)
                else:
                    matte_alpha(raw_path, alpha_path, log_label=alpha_name)

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
