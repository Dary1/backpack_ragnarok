#!/usr/bin/env python3
# =============================================================================
# DEPRECATED (REQ-0150, 2026-07-13). NOT part of the pipeline. Do not extend it,
# do not copy from it, do not cite it as precedent.
#
# One-off fix during the bakeoff. History only.
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

"""REQ-0136: is FLUX's 9.5 min/image intrinsic, or a misconfiguration?

REQ-0136's own scope says of the FLUX contender: "GGUF-quantized -- reported to
run within 8 GB VRAM at few-step speed. VERIFY LOCALLY BEFORE JUDGING." That
verification never happened. What we actually built is:

    UNet          flux-2-klein-4b-Q8_0.gguf        4.30 GB   (quantized)
    text encoder  qwen_3_4b.safetensors            8.04 GB   (fp16, NOT quantized)
    VAE           flux2-vae.safetensors            0.34 GB

The RTX 2080 has 8 GB total / ~6.2 GB usable. The TEXT ENCODER ALONE IS BIGGER
THAN THE WHOLE CARD. So every generation streams an 8 GB fp16 encoder through
VRAM, evicts it, loads the UNet, and thrashes -- which is what the ~570 s/image
is. That is not FLUX being slow; that is us never having built the low-VRAM
configuration the REQ told us to verify.

The fix needs no download and no new node: ComfyUI's CLIPLoader takes a
`device` argument, already present in our graph as "default". Pin it to "cpu"
and the encoder runs in system RAM (20 GB free) -- prompt encoding is a few
seconds of CPU for a short prompt -- leaving the entire 8 GB of VRAM to the
UNet, which fits with room to spare.

This probe measures FLUX both ways, back to back, same box, same prompt, cold
load discarded. If the CPU-encoder leg lands anywhere near SDXL speeds, the
speed objection to FLUX evaporates and the bakeoff verdict is decided on style
alone -- where FLUX already wins on brief compliance 16/16 vs 5/16 (v9) and
1/16 (dsxl).
"""
import json
import os
import statistics as st
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_item_icons as G          # noqa: E402
import req0136_bakeoff as B         # noqa: E402

REPO = os.path.dirname(HERE)
OUT = os.path.join(REPO, "content/batches/bakeoff-0136/fluxfix")
SEEDS = [9101, 9102, 9103]          # first = cold load, discarded


def vram():
    try:
        return int(subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10).stdout.split()[0])
    except Exception:
        return 0


def wf(c, pos, w, h, seed, prefix, te_device):
    g = B.wf_flux2(c, pos, w, h, seed, prefix)
    g["2"]["inputs"]["device"] = te_device      # <-- the entire fix
    return g


def leg(te_device, subj):
    c = B.CONTENDERS["flux"]
    w, h = subj["gen_render"]["gen_px"]
    secs, peak = [], 0
    for i, seed in enumerate(SEEDS):
        p = f"fluxfix_{te_device}_{seed}"
        t0 = time.time()
        hist = G.wait_done(G.submit(wf(c, subj["gen_prompt"], w, h, seed, p,
                                       te_device)), timeout_s=2400)
        dt = time.time() - t0
        peak = max(peak, vram())
        ok = bool(hist) and hist.get("status", {}).get("status_str") != "error"
        print(f"  TE={te_device:<7} s{seed} {'COLD' if not i else 'warm'} "
              f"{dt:7.1f}s ok={ok}", flush=True)
        if ok and i:
            secs.append(dt)
    return {"te_device": te_device,
            "warm_s": [round(x, 1) for x in secs],
            "warm_median_s": round(st.median(secs), 1) if secs else None,
            "vram_peak_mib": peak}


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    # seq8 already measured the "default" (broken) config on the same quiet
    # box; re-running it here would burn ~28 min of GPU to reprint a number we
    # have. Default to measuring only the fix.
    ap.add_argument("--devices", default="cpu")
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    subj = B.load_subjects(REPO, ["unit-elf"])[0]
    res = {}
    for dev in args.devices.split(","):
        print(f"== flux text-encoder device = {dev}", flush=True)
        res[dev] = leg(dev, subj)
        B.free_models()
        time.sleep(5)

    if "default" in res and "cpu" in res:
        base = res["default"]["warm_median_s"]
        fix = res["cpu"]["warm_median_s"]
        if base and fix:
            res["speedup_x"] = round(base / fix, 1)
    json.dump(res, open(os.path.join(OUT, "fluxfix.json"), "w"), indent=2)
    print("\n" + json.dumps(res, indent=2))
