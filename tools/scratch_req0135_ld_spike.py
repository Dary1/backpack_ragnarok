#!/usr/bin/env python3
"""REQ-0135 spike: LayerDiffuse (route B) candidate generator.

Same checkpoint / seeds / steps / cfg / sampler as the current production
route (tools/gen_item_icons.py), but with LayeredDiffusionApply patched onto
the model and LayeredDiffusionDecodeRGBA producing the alpha AT diffusion
time -- no rembg, no border-key fallback, no post-hoc separation of any kind.

Writes candidates in the exact <id>_c<k>_s<seed>.png / _alpha.png naming
convention of gen_item_icons.py so tools/tool_icon_score.py runs unchanged
on the output directory:
  <id>_c<k>_s<seed>.png        RGB, RGBA flattened onto white (display raw)
  <id>_c<k>_s<seed>_alpha.png  RGBA at target_px, alpha = LayerDiffuse output

Spike-only scratch tool (docs/REQ/*/REQ-0135-layerdiffuse-matting-spike.md).
Not part of the production route unless the REQ goes green.
"""
import argparse
import glob
import os
import subprocess
import sys
import threading
import time

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS_DIR)
import gen_item_icons as G  # noqa: E402  (submit/wait_done/CKPT/coverage reuse)
from PIL import Image  # noqa: E402

LD_CONFIG = "SDXL, Attention Injection"  # layer_xl_transparent_attn
LD_WEIGHT = 1.0


def build_ld_workflow(pos_prompt, neg_prompt, gen_w, gen_h, seed, steps, cfg,
                      sampler, scheduler):
    """Identical graph to gen_item_icons.build_workflow() minus the optional
    ConditioningSetMask (no spike subject uses mask_cells), plus LayerDiffuse:
    Apply between checkpoint and KSampler, and a decode->join tail that emits
    RGBA between VAEDecode and SaveImage.

    NOTE (2026-07-12): we deliberately do NOT use LayeredDiffusionDecodeRGBA.
    That node is broken against this ComfyUI build -- its decode() calls
    JoinImageWithAlpha().join_image_with_alpha(), but ComfyUI core migrated
    JoinImageWithAlpha to the v3 schema API (a classmethod execute() on
    io.ComfyNode), so the old instance method no longer exists:
        AttributeError: 'JoinImageWithAlpha' object has no attribute
                        'join_image_with_alpha'
    Upstream ComfyUI-layerdiffuse (HEAD b4f6a9e) has not caught up. This made
    every route-B job fail (10/10) on the first real run, 2026-07-12.

    Rather than patch the HANDS-OFF art ComfyUI tree (PROJECT.md: third-party
    checkouts are infrastructure -- use them, do not modify), we rebuild the
    RGBA join in the GRAPH from core nodes, which are unaffected by the
    Python-level API drift. Equivalence is exact: the broken node computed
    alpha = 1.0 - mask and handed that to core's join, whose "alpha" input is
    itself a mask that it inverts again -- so the alpha actually emitted was
    just `mask`. InvertMask + JoinImageWithAlpha reproduces that same double
    inversion node-for-node."""
    wf = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": G.CKPT}},
        "9": {"class_type": "LayeredDiffusionApply",
              "inputs": {"model": ["1", 0], "config": LD_CONFIG, "weight": LD_WEIGHT}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": pos_prompt, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg_prompt, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage",
              "inputs": {"width": gen_w, "height": gen_h, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {
            "model": ["9", 0], "positive": ["2", 0], "negative": ["3", 0],
            "latent_image": ["4", 0], "seed": seed, "steps": steps, "cfg": cfg,
            "sampler_name": sampler, "scheduler": scheduler, "denoise": 1.0}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "8": {"class_type": "LayeredDiffusionDecode", "inputs": {
            "samples": ["5", 0], "images": ["6", 0],
            "sd_version": "SDXL", "sub_batch_size": 16}},
        "10": {"class_type": "InvertMask", "inputs": {"mask": ["8", 1]}},
        "11": {"class_type": "JoinImageWithAlpha", "inputs": {
            "image": ["8", 0], "alpha": ["10", 0]}},
    }
    prefix = f"req0135_ld_{seed}_{int(time.time() * 1000) % 100000}"
    wf["7"] = {"class_type": "SaveImage",
               "inputs": {"images": ["11", 0], "filename_prefix": prefix}}
    return wf, prefix


class VramWatcher:
    """Samples nvidia-smi memory.used every poll_s seconds on a daemon
    thread; .peak_mib holds the max seen since the last reset()."""

    def __init__(self, poll_s=2.0):
        self.poll_s = poll_s
        self.peak_mib = 0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()

    def _run(self):
        while not self._stop.is_set():
            try:
                out = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=5).stdout.strip()
                mib = int(out.splitlines()[0])
                if mib > self.peak_mib:
                    self.peak_mib = mib
            except Exception:
                pass
            self._stop.wait(self.poll_s)

    def reset(self):
        self.peak_mib = 0

    def stop(self):
        self._stop.set()


def main():
    ap = argparse.ArgumentParser(description="REQ-0135 LayerDiffuse route-B spike generator")
    ap.add_argument("--defs", required=True)
    ap.add_argument("--ids", default=None)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--candidates", type=int, default=2)
    ap.add_argument("--seeds", default="101,202")
    ap.add_argument("--steps", type=int, default=30)
    ap.add_argument("--cfg", type=float, default=6.5)
    ap.add_argument("--sampler", default="dpmpp_2m")
    ap.add_argument("--scheduler", default="karras")
    ap.add_argument("--timeout", type=int, default=1200,
                    help="per-job wait (first job also downloads LD models)")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    seeds = [int(s) for s in a.seeds.split(",") if s.strip()][: a.candidates]
    id_filter = set(a.ids.split(",")) if a.ids else None

    entries = G.entries_with_gen_fields(G.load_defs(a.defs), id_filter)
    if not entries:
        print("No entries with gen fields (nothing to do).", flush=True)
        sys.exit(0)

    os.makedirs(a.outdir, exist_ok=True)
    watcher = VramWatcher()
    any_failed = False
    total = len(entries) * len(seeds)
    n = 0

    for entry in entries:
        eid = entry["id"]
        render = entry["gen_render"]
        gen_w, gen_h = render["gen_px"]
        target_w, target_h = render["target_px"]

        for k, seed in enumerate(seeds, start=1):
            n += 1
            raw_path = os.path.join(a.outdir, f"{eid}_c{k}_s{seed}.png")
            alpha_path = os.path.join(a.outdir, f"{eid}_c{k}_s{seed}_alpha.png")
            if not a.force and os.path.exists(raw_path) and os.path.exists(alpha_path):
                print(f"[{n}/{total}] SKIP (exists) {os.path.basename(raw_path)}", flush=True)
                continue

            print(f"[{n}/{total}] START id={eid} c={k} seed={seed} "
                  f"gen_px={gen_w}x{gen_h} -> target_px={target_w}x{target_h} (LD)", flush=True)
            watcher.reset()
            t0 = time.time()
            try:
                wf, prefix = build_ld_workflow(
                    entry["gen_prompt"], entry.get("gen_negative", ""),
                    gen_w, gen_h, seed, a.steps, a.cfg, a.sampler, a.scheduler)
                pid = G.submit(wf)
                result = G.wait_done(pid, timeout_s=a.timeout)
                if not result:
                    print(f"[{n}/{total}] FAIL (timeout) id={eid} seed={seed}", flush=True)
                    any_failed = True
                    continue
                if result.get("status", {}).get("status_str") == "error":
                    print(f"[{n}/{total}] FAIL (comfy error) id={eid} seed={seed}: "
                          f"{result['status']}", flush=True)
                    any_failed = True
                    continue

                matches = sorted(glob.glob(os.path.join(G.COMFY_OUTPUT_DIR, f"{prefix}*.png")),
                                 key=os.path.getmtime)
                if not matches:
                    print(f"[{n}/{total}] FAIL (no output) id={eid} seed={seed}", flush=True)
                    any_failed = True
                    continue

                im = Image.open(matches[-1]).convert("RGBA")
                im = im.resize((target_w, target_h), Image.LANCZOS)
                im.save(alpha_path)
                flat = Image.new("RGB", im.size, (255, 255, 255))
                flat.paste(im, mask=im.split()[3])
                flat.save(raw_path)

                cov = G.alpha_coverage_fraction(alpha_path)
                dt = time.time() - t0
                print(f"[{n}/{total}] DONE id={eid} c={k} seed={seed} "
                      f"coverage={cov * 100:.2f}% time={dt:.1f}s "
                      f"vram_peak={watcher.peak_mib}MiB", flush=True)
            except Exception as e:
                print(f"[{n}/{total}] FAIL (exception) id={eid} seed={seed}: {e}", flush=True)
                any_failed = True

    watcher.stop()
    print("ALL DONE", flush=True)
    sys.exit(1 if any_failed else 0)


if __name__ == "__main__":
    main()
