#!/usr/bin/env python3
"""
gen_monster_art.py -- Simple ComfyUI txt2img illustration generator (NO 3D/rig/animation).

Replaces the old golem/slime SD+stable-fast-3d+UniRig+Blender pipeline for the
illustration-first stage (art_golden v3.4): just checkpoint + prompt + optional
latent-upscale hires-fix + save. Static illustrations only, matching REQ-0044's
"art only, no stats/footprints/wiring" scope.

Reads a batch job-list JSON and generates one static illustration per job via the
local ComfyUI API (http://127.0.0.1:8188), saving clean-named copies to --outdir.

Job dict fields:
  name (required), ckpt (required), positive (required), negative (default ""),
  width (640), height (832), seed (1234), steps (30), cfg (7.0),
  sampler (dpmpp_2m), scheduler (karras),
  hires (true), hires_scale (1.5), hires_denoise (0.5)

Usage:
  python3 tools/gen_monster_art.py --config content/batches/monsters-002/jobs.json \
      --outdir content/proposals/monsters-002
"""
import json
import urllib.request
import time
import os
import glob
import shutil
import argparse

COMFY = "http://127.0.0.1:8188"


def submit(wf):
    data = json.dumps({"prompt": wf}).encode()
    req = urllib.request.Request(
        COMFY + "/prompt", data=data, headers={"Content-Type": "application/json"}
    )
    r = json.load(urllib.request.urlopen(req, timeout=30))
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
    return None


def build_workflow(job):
    ckpt = job["ckpt"]
    pos = job["positive"]
    neg = job.get("negative", "")
    w = job.get("width", 640)
    h = job.get("height", 832)
    seed = job.get("seed", 1234)
    steps = job.get("steps", 30)
    cfg = job.get("cfg", 7.0)
    sampler = job.get("sampler", "dpmpp_2m")
    scheduler = job.get("scheduler", "karras")
    hires = job.get("hires", True)

    wf = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": pos, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg, "clip": ["1", 1]}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}},
        "5": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0],
                "latent_image": ["4", 0], "seed": seed, "steps": steps, "cfg": cfg,
                "sampler_name": sampler, "scheduler": scheduler, "denoise": 1.0,
            },
        },
    }
    if hires:
        scale = job.get("hires_scale", 1.5)
        hw, hh = (int(w * scale) // 8) * 8, (int(h * scale) // 8) * 8
        wf["6"] = {
            "class_type": "LatentUpscale",
            "inputs": {"samples": ["5", 0], "upscale_method": "nearest-exact",
                       "width": hw, "height": hh, "crop": "disabled"},
        }
        wf["7"] = {
            "class_type": "KSampler",
            "inputs": {
                "model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0],
                "latent_image": ["6", 0], "seed": seed + 1, "steps": steps, "cfg": cfg,
                "sampler_name": sampler, "scheduler": scheduler,
                "denoise": job.get("hires_denoise", 0.5),
            },
        }
        wf["8"] = {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["1", 2]}}
        wf["9"] = {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "m2_" + job["name"]}}
    else:
        wf["6"] = {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}}
        wf["7"] = {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": "m2_" + job["name"]}}
    return wf


def main():
    ap = argparse.ArgumentParser(description="Simple ComfyUI monster illustration generator")
    ap.add_argument("--config", required=True)
    ap.add_argument("--outdir", required=True)
    a = ap.parse_args()

    jobs = json.load(open(a.config, encoding="utf-8"))
    os.makedirs(a.outdir, exist_ok=True)
    out_native = os.path.expanduser("~/ComfyUI/output")
    os.makedirs(out_native, exist_ok=True)

    for job in jobs:
        print(f"=== JOB START name={job['name']} ckpt={job['ckpt']} ===", flush=True)
        t0 = time.time()
        wf = build_workflow(job)
        pid = submit(wf)
        print(f"submitted pid={pid}", flush=True)
        result = wait_done(pid)
        if not result:
            print(f"JOB TIMEOUT/FAIL name={job['name']}", flush=True)
            continue
        pattern = os.path.join(out_native, f"m2_{job['name']}*.png")
        matches = sorted(glob.glob(pattern), key=os.path.getmtime)
        if not matches:
            print(f"JOB NO OUTPUT FILE name={job['name']}", flush=True)
            continue
        src = matches[-1]
        dst = os.path.join(a.outdir, f"{job['name']}.png")
        shutil.copy(src, dst)
        print(f"JOB DONE name={job['name']} -> {dst} ({time.time()-t0:.1f}s)", flush=True)

    print("ALL DONE", flush=True)


if __name__ == "__main__":
    main()
