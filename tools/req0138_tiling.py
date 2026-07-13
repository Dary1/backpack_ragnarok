#!/usr/bin/env python3
# =============================================================================
# DEPRECATED (REQ-0150, 2026-07-13). NOT part of the pipeline. Do not extend it,
# do not copy from it, do not cite it as precedent.
#
# SDXL seamless-tiling recipe (SeamlessTile + CircularVAEDecode). SeamlessTile is a NO-OP on FLUX (REQ-0150 §2, proved bit-identical 4/4). Use art_route.build_txt2img(tiling=True).
#
# The pipeline is now:
#   tools/art_route.py       the ONE route (FLUX.2 klein) and the ONE graph
#   tools/art_style.py       the ONE prompt/style layer (ratified art direction)
#   tools/gen_item_icons.py  item + unit icons (defs-driven)
#   tools/gen_monster_art.py monster illustrations
#   tools/gen_bpskin.py      backpack skins: generate -> GATE -> compose
#   tools/bpskin_compose.py  fill + welt -> skin, over any polyomino
# Kept only so old batches can be read back. See docs/llm_managed/*_pipeline.md.
# =============================================================================

"""REQ-0138 seamless fill_texture tiling recipe validation.

Recipe under test (spinagon/ComfyUI-seamless-tiling):
  CheckpointLoaderSimple -> SeamlessTile (model patch, tiling=enable)
  -> KSampler -> CircularVAEDecode (decode-side circular padding)
Control leg: same prompt/seed WITHOUT the two tiling nodes (seam expected).

Verification per REQ-0138 gate:
  1. OffsetImage-equivalent half-shift (done in PIL, both axes) -- must show
     zero visible seam; the shifted image is written for the human gallery.
  2. Numeric seam metric: mean |dpixel| across the wrap edge vs interior
     baseline (ratio ~ 1.0 => seamless); recorded to findings.json.
  3. 2x2 tiled contact sheet for eyeball check.

Motifs: elven / barbarian (2 contrasting, per REQ). 1024px tiles (SDXL
native; REQ range 512-1024). Checkpoint: incumbent V9 (SDXL family --
REQ-0136 winner slot-compatible: SeamlessTile patches any SDXL model).

Usage: req0138_tiling.py [--seeds 101,202] [--out content/batches/bpskin-tiling-0138]
"""
import argparse
import glob
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_item_icons as G  # noqa: E402  submit/wait_done/COMFY dirs
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

CKPT = "JuggernautXL_RunDiffusionPhoto2_V9_Final.safetensors"

STYLE = ("seamless repeating allover pattern, flat textile texture fill, "
         "stylized painterly dark-fantasy game texture, hand-painted "
         "illustration, digital painting, soft cel-shading, matte finish, "
         "muted desaturated palette, Norse mythology aesthetic, flat even "
         "lighting, uniform pattern density edge to edge, no focal object, "
         "no border, no frame, no vignette, high detail, sharp focus")

NEG = ("photograph, photorealistic, 3d render, cgi, glossy, text, letters, "
       "watermark, signature, logo, frame, border, panel, vignette, "
       "gradient, spotlight, central object, single object, scenery, "
       "horizon, perspective, depth of field, blurry, low quality, "
       "jpeg artifacts, seam, visible seam line")

MOTIFS = {
    "elven": ("elven forest brocade, interwoven silver leaf filigree and "
              "pale sage vines over deep moss-green woven fabric, delicate "
              "knotwork tracery, tarnished gold thread accents, "),
    "barbarian": ("barbarian war-hide patchwork, rough stitched leather "
                  "patches and dark fur bands, hammered iron studs and "
                  "rivets, crossed rawhide straps and bone toggles, "),
}


def wf(motif_prompt, seed, prefix, seamless):
    g = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "CLIPTextEncode",
              "inputs": {"text": motif_prompt + STYLE, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage",
              "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
    }
    model_ref = ["1", 0]
    if seamless:
        g["10"] = {"class_type": "SeamlessTile", "inputs": {
            "model": ["1", 0], "tiling": "enable", "copy_model": "Make a copy"}}
        model_ref = ["10", 0]
    g["5"] = {"class_type": "KSampler", "inputs": {
        "model": model_ref, "positive": ["2", 0], "negative": ["3", 0],
        "latent_image": ["4", 0], "seed": seed, "steps": 30, "cfg": 6.5,
        "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0}}
    if seamless:
        g["6"] = {"class_type": "CircularVAEDecode", "inputs": {
            "samples": ["5", 0], "vae": ["1", 2], "tiling": "enable"}}
    else:
        g["6"] = {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}}
    g["7"] = {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}}
    return g


def seam_metric(img):
    """Wrap-edge discontinuity vs interior baseline; ~1.0 == invisible."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    wrap_x = np.abs(a[:, 0] - a[:, -1]).mean()
    wrap_y = np.abs(a[0, :] - a[-1, :]).mean()
    int_x = np.abs(np.diff(a, axis=1)).mean()
    int_y = np.abs(np.diff(a, axis=0)).mean()
    return {"wrap_x": float(wrap_x), "wrap_y": float(wrap_y),
            "interior_x": float(int_x), "interior_y": float(int_y),
            "ratio_x": float(wrap_x / max(int_x, 1e-6)),
            "ratio_y": float(wrap_y / max(int_y, 1e-6))}


def artifacts(base, img):
    w, h = img.size
    off = Image.new("RGB", (w, h))
    half = img.crop((w // 2, 0, w, h)); rest = img.crop((0, 0, w // 2, h))
    off.paste(half, (0, 0)); off.paste(rest, (w // 2, 0))
    top = off.crop((0, h // 2, w, h)); bot = off.crop((0, 0, w, h // 2))
    off2 = Image.new("RGB", (w, h)); off2.paste(top, (0, 0)); off2.paste(bot, (0, h // 2))
    off2.save(base + "_offset.png")
    sheet = Image.new("RGB", (w, h))
    q = img.resize((w // 2, h // 2), Image.LANCZOS)
    for dx in (0, w // 2):
        for dy in (0, h // 2):
            sheet.paste(q, (dx, dy))
    sheet.save(base + "_tiled2x2.png")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="101,202")
    ap.add_argument("--out", default="content/batches/bpskin-tiling-0138")
    args = ap.parse_args()
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(repo_root, args.out)
    os.makedirs(outdir, exist_ok=True)
    findings = {"checkpoint": CKPT, "tile_px": 1024, "legs": [],
                "started": time.strftime("%Y-%m-%d %H:%M:%S")}

    for motif, mp in MOTIFS.items():
        for seed in [int(s) for s in args.seeds.split(",")]:
            for seamless in (True, False):
                tag = "seamless" if seamless else "control"
                base = os.path.join(outdir, f"{motif}_s{seed}_{tag}")
                if not os.path.exists(base + ".png"):
                    prefix = f"req0138_{motif}_{seed}_{tag}"
                    t0 = time.time()
                    pid = G.submit(wf(mp, seed, prefix, seamless))
                    hist = G.wait_done(pid, timeout_s=1200)
                    if not hist or hist.get("status", {}).get("status_str") == "error":
                        print(f"FAIL {motif} s{seed} {tag}", flush=True)
                        continue
                    hits = sorted(glob.glob(os.path.join(
                        G.COMFY_OUTPUT_DIR, prefix + "*.png")))
                    if not hits:
                        print(f"FAIL {motif} s{seed} {tag}: no output", flush=True)
                        continue
                    shutil.copy(hits[-1], base + ".png")
                    print(f"GEN {motif} s{seed} {tag} {time.time()-t0:.1f}s",
                          flush=True)
                img = Image.open(base + ".png")
                artifacts(base, img)
                m = seam_metric(img)
                m.update({"motif": motif, "seed": seed, "leg": tag})
                findings["legs"].append(m)
                print(f"SEAM {motif} s{seed} {tag} "
                      f"rx={m['ratio_x']:.2f} ry={m['ratio_y']:.2f}", flush=True)

    with open(os.path.join(outdir, "findings.json"), "w") as f:
        json.dump(findings, f, indent=2)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
