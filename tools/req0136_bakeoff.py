#!/usr/bin/env python3
"""REQ-0136 icon checkpoint bakeoff generator.

Runs the SAME subjects (2 items + 2 unit busts) x the SAME seed discipline
(101/202/303/404, item-route default) across three contenders:

  v9    JuggernautXL V9 + current anti-photoreal prompting  (control)
  dsxl  DreamShaperXL Turbo v2.1 (stylized SDXL, OpenRAIL++)
  flux  FLUX.2 klein 4B distilled, GGUF Q8_0 (Apache 2.0), 4-step

Reuses the verified REQ-0073 route plumbing (submit/wait_done/matte_alpha)
from tools/gen_item_icons.py. Per-leg VRAM peak (nvidia-smi poll) and warm
s/image are recorded to runstats.json for the REQ-0136 findings table.

NOTE flux leg: distilled klein samples at cfg 1.0 with a ConditioningZeroOut
negative (official ComfyUI template graph) -- the negative prompt has NO
effect there; style control is positive-prompt-only. Record in findings.

Usage:
  req0136_bakeoff.py --contender v9   [--subjects hilt,tower_shield,...]
  req0136_bakeoff.py --contender dsxl
  req0136_bakeoff.py --contender flux
Outputs: content/batches/bakeoff-0136/candidates/<contender>/
  <id>_s<seed>.png (raw gen_px), _alpha.png (matte, gen_px),
  _256.png / _64.png (Lanczos, from alpha)
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import threading
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_item_icons as G  # noqa: E402  (route plumbing, REQ-0073)
from PIL import Image  # noqa: E402

SEEDS = [101, 202, 303, 404]

CONTENDERS = {
    "v9": {
        "kind": "sdxl",
        "ckpt": "JuggernautXL_RunDiffusionPhoto2_V9_Final.safetensors",
        "steps": 30, "cfg": 6.5, "sampler": "dpmpp_2m", "scheduler": "karras",
    },
    "dsxl": {
        "kind": "sdxl",
        "ckpt": "DreamShaperXL_Turbo_v2_1.safetensors",
        # DreamShaper XL v2 Turbo author guidance: 4-8 steps, cfg ~2, dpmpp_sde
        "steps": 8, "cfg": 2.5, "sampler": "dpmpp_sde", "scheduler": "karras",
    },
    "flux": {
        "kind": "flux2",
        "unet": "flux-2-klein-4b-Q8_0.gguf",
        "clip": "qwen_3_4b.safetensors",
        "vae": "flux2-vae.safetensors",
        # official distilled-klein template: 4 steps, cfg 1.0, euler
        "steps": 4, "cfg": 1.0, "sampler": "euler",
    },
}


def wf_sdxl(c, pos, neg, w, h, seed, prefix):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": c["ckpt"]}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": pos, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {
            "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0],
            "latent_image": ["4", 0], "seed": seed, "steps": c["steps"],
            "cfg": c["cfg"], "sampler_name": c["sampler"],
            "scheduler": c["scheduler"], "denoise": 1.0}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}},
    }


def wf_flux2(c, pos, w, h, seed, prefix):
    # Mirrors the official "Text to Image (Flux.2 Klein 4B Distilled)"
    # template subgraph, with UNETLoader swapped for UnetLoaderGGUF.
    return {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": c["unet"]}},
        "2": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": c["clip"], "type": "flux2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": c["vae"]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": pos, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
        "6": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "7": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": c["sampler"]}},
        "8": {"class_type": "Flux2Scheduler", "inputs": {"steps": c["steps"], "width": w, "height": h}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "10": {"class_type": "CFGGuider", "inputs": {
            "model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0], "cfg": c["cfg"]}},
        "11": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["9", 0], "guider": ["10", 0], "sampler": ["7", 0],
            "sigmas": ["8", 0], "latent_image": ["6", 0]}},
        "12": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["3", 0]}},
        "13": {"class_type": "SaveImage", "inputs": {"images": ["12", 0], "filename_prefix": prefix}},
    }


class VramPoller(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self.peak = 0
        self._stop = threading.Event()

    def run(self):
        while not self._stop.is_set():
            try:
                out = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=10).stdout.strip()
                self.peak = max(self.peak, int(out.splitlines()[0]))
            except Exception:
                pass
            self._stop.wait(2)

    def stop(self):
        self._stop.set()


def postprocess(base, tw, th, label):
    """Matte in an ISOLATED subprocess (rembg/onnxruntime+pymatting RSS can
    spike >10 GB -- an inline matte OOM-killed the whole leg on 2026-07-12,
    dmesg confirmed; per-image process isolation frees that RSS every time),
    then Lanczos-downscale 256/64 in-process (cheap)."""
    if not os.path.exists(base + "_alpha.png"):
        # inline matte (rembg session cached across images). Reverted from
        # per-image subprocess isolation 2026-07-12 once the box became
        # exclusive: sequential legs + /free keep RSS bounded, and the
        # per-subprocess birefnet cold load (~60-90 s/img) dominated wall
        # time. If OOM recurs, resume re-runs the missing mattes.
        # RAM guard: characters (hair/fur) push rembg alpha_matting's
        # pymatting solve past 10 GB RSS; with SDXL cached in ComfyUI the
        # 23 GB box thrashes (2 OOM events + 1 reboot on 2026-07-12).
        # Unload ComfyUI models before every matte; next gen reloads from
        # page cache (~30-40 s) -- safe > fast.
        try:
            if "unit-" not in label:
                raise RuntimeError("skip /free: item matte is RAM-light")
            import urllib.request as _u
            _u.urlopen(_u.Request(
                G.COMFY + "/free",
                data=b'{"unload_models":true,"free_memory":true}',
                headers={"Content-Type": "application/json"}),
                timeout=20).read()
            time.sleep(2)
        except Exception as e:
            print(f"WARN /free failed: {e}", flush=True)
        try:
            if "unit-" in label:
                matte_light(base + ".png", base + "_alpha.png", label)
            else:
                G.matte_alpha(base + ".png", base + "_alpha.png",
                              log_label=label)
        except Exception as e:
            print(f"MATTE-FAIL {label}: {e}", flush=True)
            return False
        if not os.path.exists(base + "_alpha.png"):
            print(f"MATTE-FAIL {label}: no output", flush=True)
            return False
    im = Image.open(base + "_alpha.png")
    im.resize((tw, th), Image.LANCZOS).save(base + "_256.png")
    im.resize((64, 64), Image.LANCZOS).save(base + "_64.png")
    return True


def matte_light(src, dst, label):
    """Character matte WITHOUT rembg alpha_matting refinement.

    alpha_matting's pymatting solve balloons past 13 GB RSS on 1024px
    character busts (large soft hair/fur trimap regions) -- it OOM-killed
    the leg twice on the shared 23 GB box (dmesg 2026-07-12 04:14, 04:33)
    even with ComfyUI models unloaded. Items stay on the incumbent
    G.matte_alpha. Finding recorded in REQ-0136/REQ-0127; the long-term
    fix is generation-time alpha (REQ-0135 LayerDiffuse).
    """
    import numpy as np
    from rembg import remove
    im = Image.open(src).convert("RGB")
    out = remove(im, session=G.get_rembg_session_birefnet(),
                 post_process_mask=True)
    arr = np.array(out)
    cov = float((arr[..., 3] > G.ALPHA_OPAQUE_T).mean())
    method = "birefnet-light"
    if not (G.COVERAGE_MIN <= cov <= G.COVERAGE_MAX):
        fb = G._matte_border_key(im)
        fcov = G._coverage(np.array(fb))
        if G._in_band(fcov):
            out, cov, method = fb, fcov, "borderkey"
    out.save(dst)
    print(f"MATTE {label} method={method} coverage={cov*100:.2f}%",
          flush=True)


def load_subjects(repo_root, ids):
    """Items from content/live/live_items.json; units from
    content/batches/bakeoff-0136/unit_defs.json (both carry
    gen_prompt/gen_negative/gen_render)."""
    out = {}
    for path in (os.path.join(repo_root, "content/live/live_items.json"),
                 os.path.join(repo_root, "content/batches/bakeoff-0136/unit_defs.json")):
        with open(path) as f:
            for e in json.load(f)["entries"]:
                if e.get("gen_prompt") and e.get("gen_render"):
                    out[e["id"]] = e
    missing = [i for i in ids if i not in out]
    if missing:
        raise SystemExit(f"unknown subject ids: {missing}")
    return [out[i] for i in ids]


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--matte-one":
        G.matte_alpha(sys.argv[2], sys.argv[3], log_label=sys.argv[4])
        return

    ap = argparse.ArgumentParser()
    ap.add_argument("--contender", required=True, choices=sorted(CONTENDERS))
    ap.add_argument("--subjects",
                    default="hilt,tower_shield,unit-elf,unit-berserker")
    ap.add_argument("--seeds", default=",".join(str(s) for s in SEEDS))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(repo_root,
                          "content/batches/bakeoff-0136/candidates",
                          args.contender)
    os.makedirs(outdir, exist_ok=True)
    c = CONTENDERS[args.contender]
    seeds = [int(s) for s in args.seeds.split(",")]
    subjects = load_subjects(repo_root, args.subjects.split(","))

    poller = VramPoller()
    poller.start()
    stats = {"contender": args.contender, "config": c, "images": [],
             "started": time.strftime("%Y-%m-%d %H:%M:%S")}

    for e in subjects:
        w, h = e["gen_render"]["gen_px"]
        tw, th = e["gen_render"]["target_px"]
        for seed in seeds:
            base = os.path.join(outdir, f'{e["id"]}_s{seed}')
            label = f'{args.contender}/{e["id"]}_s{seed}'
            if os.path.exists(base + ".png") and not args.force:
                # resume: raw exists; make sure postprocess is complete too
                postprocess(base, tw, th, label)
                print(f'SKIP {e["id"]} s{seed} (exists)', flush=True)
                continue
            prefix = f"bakeoff0136_{args.contender}_{e['id']}_{seed}"
            if c["kind"] == "sdxl":
                wf = wf_sdxl(c, e["gen_prompt"], e.get("gen_negative", ""),
                             w, h, seed, prefix)
            else:
                wf = wf_flux2(c, e["gen_prompt"], w, h, seed, prefix)
            t0 = time.time()
            pid = G.submit(wf)
            hist = G.wait_done(pid, timeout_s=1200)
            dt = time.time() - t0
            if not hist or hist.get("status", {}).get("status_str") == "error":
                msg = json.dumps(hist.get("status", {}))[:500] if hist else "timeout"
                print(f'FAIL {e["id"]} s{seed}: {msg}', flush=True)
                stats["images"].append({"id": e["id"], "seed": seed,
                                        "error": msg, "secs": round(dt, 1)})
                continue
            hits = sorted(glob.glob(
                os.path.join(G.COMFY_OUTPUT_DIR, prefix + "*.png")))
            if not hits:
                print(f'FAIL {e["id"]} s{seed}: no output file', flush=True)
                continue
            shutil.copy(hits[-1], base + ".png")
            postprocess(base, tw, th, label)
            stats["images"].append({"id": e["id"], "seed": seed,
                                    "secs": round(dt, 1)})
            print(f'OK {e["id"]} s{seed} {dt:.1f}s', flush=True)

    poller.stop()
    stats["vram_peak_mib"] = poller.peak
    done = [i["secs"] for i in stats["images"] if "error" not in i]
    # first image of a leg pays the model load; warm = the rest
    stats["warm_s_per_image"] = (round(sum(done[1:]) / max(len(done) - 1, 1), 1)
                                 if len(done) > 1 else None)
    stats["cold_first_image_s"] = done[0] if done else None
    statpath = os.path.join(os.path.dirname(outdir),
                            f"runstats_{args.contender}.json")
    with open(statpath, "w") as f:
        json.dump(stats, f, indent=2)
    print("STATS " + json.dumps({k: stats[k] for k in
          ("contender", "vram_peak_mib", "warm_s_per_image",
           "cold_first_image_s")}), flush=True)


if __name__ == "__main__":
    main()
