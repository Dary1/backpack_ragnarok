#!/usr/bin/env python3
"""
gen_monster_art.py -- ComfyUI txt2img illustration generator (NO 3D/rig/animation).

Static illustrations only (art_golden v3.4 / REQ-0044 scope: art only, no
stats/footprints/wiring). Reads a batch job-list JSON and generates one
illustration per job via the local ComfyUI API, saving clean-named copies to
--outdir.

ROUTE (REQ-0150, user decision 2026-07-13 "一旦全て Flux2 にしましょう")
------------------------------------------------------------------------
This tool used to be pure SDXL/SD1.5 (CheckpointLoaderSimple + LoraLoader chain
+ KSampler, 30 steps / cfg 7.0 / dpmpp_2m / karras). It is now flux2 by default,
on the SAME route object as gen_item_icons.py -- the model names and sampler
defaults are imported from gen_item_icons.FLUX / .ROUTE_DEFAULTS so the program
has exactly ONE definition of "the route".

The "sdxl" route is FROZEN: still runnable via `--route sdxl` for reproducing
historical batches (monsters-001, monsters-002), never for new production art.

THE LoRA QUESTION -- ANSWERED (REQ-0150 §1)
-------------------------------------------
The SDXL/SD1.5 LoRAs in the historical job defs do NOT load on FLUX (different
architecture, different loader), so the port had to decide: port them, find FLUX
equivalents, drop them, or escalate.

DROPPED. They are safe to drop because of WHAT they are. The monster jobs use
exactly two LoRAs -- `detail_tweaker` (a generic sharpness/detail booster) and
`cel_shaded_art_style` (a generic cel-shading style LoRA). Neither is a
character-identity LoRA; neither encodes any monster's identity. They were
compensating for rpg_v5/SD1.5's weak prompt adherence -- doing in weights what a
stronger text encoder does from the prompt. FLUX.2 klein (Qwen3-4B text encoder)
follows "cel shading, line art, flat colour, white background" from the POSITIVE
prompt directly, which is where the style has to live on this route anyway (see
below). So no monster loses its identity by dropping them; what changes is the
rendering style, and that is exactly what the user is being shown in the REQ-0150
gallery to rule on. If the flux2 look is rejected there, the answer is a prompt
change or a FLUX-native style LoRA -- NOT a quiet return to SDXL.

(Character-identity LoRA work is REQ-0137's, and it is unaffected by this: it was
never these two LoRAs. But REQ-0137 must now train on FLUX, not SDXL.)

On flux2, `job["loras"]` is REFUSED, not silently ignored -- a job that asks for
a LoRA gets a hard error naming this decision, because a silently-dropped style
LoRA is exactly how a style regression hides for a month.

THE NEGATIVE PROMPT IS INACTIVE ON flux2
----------------------------------------
Distilled klein samples at cfg 1.0 with a ConditioningZeroOut of the positive as
the negative -- `job["negative"]` does nothing. Steer style from the POSITIVE.
A job carrying a negative is warned about, loudly, once.

HIRES-FIX IS AN SDXL-ERA CONSTRUCT
----------------------------------
The old graph rendered small (640x832) then latent-upscaled + re-sampled, because
SDXL degrades away from its trained ~1MP. FLUX.2 is native at ~1MP and up: set
width/height to the size you actually want. `job["hires"]` is IGNORED on flux2
(warned), not emulated.

Job dict fields:
  name (required), positive (required),
  width (640), height (832), seed (1234),
  steps/cfg/sampler (default: resolved from the ROUTE, not hardcoded here),
  negative      -- sdxl only; INACTIVE on flux2 (warned)
  ckpt          -- sdxl only (FROZEN route); ignored on flux2
  loras         -- sdxl only (FROZEN route); REFUSED on flux2 (see above)
  hires, hires_scale, hires_denoise -- sdxl only; ignored on flux2 (warned)

Usage:
  python3 tools/gen_monster_art.py --config content/batches/monsters-003-flux2/jobs.json \
      --outdir content/batches/monsters-003-flux2/candidates
  # historical reproduction only:
  python3 tools/gen_monster_art.py --route sdxl --config .../monsters-002/jobs.json ...
"""
import json
import urllib.request
import time
import os
import sys
import glob
import shutil
import argparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# The route lives in ONE place (REQ-0150 §1: "no tool may keep an implicit SDXL
# default"). Model filenames and per-route sampler defaults are gen_item_icons'.
import gen_item_icons as G  # noqa: E402

COMFY = "http://127.0.0.1:8188"

ROUTE = "flux2"                 # "flux2" (production) | "sdxl" (FROZEN)


def submit(wf):
    data = json.dumps({"prompt": wf}).encode()
    req = urllib.request.Request(
        COMFY + "/prompt", data=data, headers={"Content-Type": "application/json"}
    )
    r = json.load(urllib.request.urlopen(req, timeout=30))
    return r["prompt_id"]


def wait_done(pid, timeout_s=600):
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


def _warn_once(key, msg):
    seen = _warn_once.__dict__.setdefault("_seen", set())
    if key not in seen:
        seen.add(key)
        print(msg, flush=True)


def build_workflow(job, steps=None, cfg=None, sampler=None):
    if ROUTE == "flux2":
        return _wf_flux2(job, steps, cfg, sampler)
    return _wf_sdxl(job, steps, cfg, sampler)


def _wf_flux2(job, steps=None, cfg=None, sampler=None):
    """FLUX.2 klein 4B distilled, GGUF -- the same graph gen_item_icons uses
    (UnetLoaderGGUF + CLIPLoader(flux2) + VAELoader -> CFGGuider ->
    SamplerCustomAdvanced), sized for a portrait illustration instead of a
    square icon. Proven by REQ-0136 (16/16 on brief) and REQ-0127 (S7 green)."""
    if job.get("loras"):
        raise SystemExit(
            f"ERROR job '{job['name']}' requests loras "
            f"{[l.get('name') for l in job['loras']]}, but the flux2 route "
            f"cannot load SDXL/SD1.5 LoRAs (different architecture).\n"
            f"REQ-0150 decided this deliberately: those LoRAs are generic "
            f"style/detail boosters, not identity LoRAs, and are DROPPED -- "
            f"their job is done by the flux2 POSITIVE prompt instead.\n"
            f"Fix the job def: remove \"loras\" and fold the style it was "
            f"buying into \"positive\". Do NOT reach for --route sdxl to keep "
            f"them; that route is frozen.")
    if job.get("negative"):
        _warn_once("neg", "NOTE flux2 route: the negative prompt is INACTIVE "
                          "at cfg 1.0 (zeroed conditioning, official distilled "
                          "graph). Jobs carrying `negative` have it DISCARDED "
                          "-- steer style from the POSITIVE prompt.")
    if job.get("hires"):
        _warn_once("hires", "NOTE flux2 route: `hires` is IGNORED. It was an "
                            "SDXL workaround for rendering away from ~1MP. "
                            "FLUX.2 is native at ~1MP+ -- set width/height to "
                            "the size you actually want.")
    if job.get("ckpt"):
        _warn_once("ckpt", "NOTE flux2 route: `ckpt` is IGNORED (the flux2 "
                           "route pins UNET+CLIP+VAE in gen_item_icons.FLUX). "
                           "It applies only to the frozen sdxl route.")

    pos = job["positive"]
    w = job.get("width", 640)
    h = job.get("height", 832)
    seed = job.get("seed", 1234)
    d = G.ROUTE_DEFAULTS["flux2"]
    steps = steps or job.get("steps") or d["steps"]
    cfg = cfg if cfg is not None else job.get("cfg", d["cfg"])
    sampler = sampler or job.get("sampler") or d["sampler"]
    prefix = "m3_" + job["name"]

    wf = {
        "1": {"class_type": "UnetLoaderGGUF",
              "inputs": {"unet_name": G.FLUX["unet"]}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": G.FLUX["clip"], "type": "flux2",
                         "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": G.FLUX["vae"]}},
        "4": {"class_type": "CLIPTextEncode",
              "inputs": {"text": pos, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut",
              "inputs": {"conditioning": ["4", 0]}},
        "6": {"class_type": "EmptyFlux2LatentImage",
              "inputs": {"width": w, "height": h, "batch_size": 1}},
        "7": {"class_type": "KSamplerSelect",
              "inputs": {"sampler_name": sampler}},
        "8": {"class_type": "Flux2Scheduler",
              "inputs": {"steps": steps, "width": w, "height": h}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "13": {"class_type": "CFGGuider",
               "inputs": {"model": ["1", 0], "positive": ["4", 0],
                          "negative": ["5", 0], "cfg": cfg}},
        "14": {"class_type": "SamplerCustomAdvanced",
               "inputs": {"noise": ["9", 0], "guider": ["13", 0],
                          "sampler": ["7", 0], "sigmas": ["8", 0],
                          "latent_image": ["6", 0]}},
        "15": {"class_type": "VAEDecode",
               "inputs": {"samples": ["14", 0], "vae": ["3", 0]}},
        "16": {"class_type": "SaveImage",
               "inputs": {"images": ["15", 0], "filename_prefix": prefix}},
    }
    return wf, prefix


def _wf_sdxl(job, steps=None, cfg=None, sampler=None):
    """FROZEN (REQ-0150). Historical reproduction of monsters-001/monsters-002
    only -- never for new production art. Left byte-identical in behaviour to the
    pre-REQ-0150 graph so old batches reproduce: checkpoint + LoRA chain +
    KSampler (+ optional latent-upscale hires-fix)."""
    ckpt = job["ckpt"]
    pos = job["positive"]
    neg = job.get("negative", "")
    w = job.get("width", 640)
    h = job.get("height", 832)
    seed = job.get("seed", 1234)
    d = G.ROUTE_DEFAULTS["sdxl"]
    steps = steps or job.get("steps", 30)
    cfg = cfg if cfg is not None else job.get("cfg", 7.0)
    sampler = sampler or job.get("sampler", d["sampler"])
    scheduler = job.get("scheduler", d["scheduler"])
    hires = job.get("hires", True)
    loras = job.get("loras", [])
    prefix = "m2_" + job["name"]

    wf = {"1": {"class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": ckpt}}}
    model_ref, clip_ref, vae_ref = ["1", 0], ["1", 1], ["1", 2]
    next_id = 20
    for lora in loras:
        nid = str(next_id)
        strength = lora.get("strength", 1.0)
        wf[nid] = {"class_type": "LoraLoader", "inputs": {
            "model": model_ref, "clip": clip_ref, "lora_name": lora["name"],
            "strength_model": lora.get("strength_model", strength),
            "strength_clip": lora.get("strength_clip", strength)}}
        model_ref, clip_ref = [nid, 0], [nid, 1]
        next_id += 1

    wf["2"] = {"class_type": "CLIPTextEncode", "inputs": {"text": pos, "clip": clip_ref}}
    wf["3"] = {"class_type": "CLIPTextEncode", "inputs": {"text": neg, "clip": clip_ref}}
    wf["4"] = {"class_type": "EmptyLatentImage",
               "inputs": {"width": w, "height": h, "batch_size": 1}}
    wf["5"] = {"class_type": "KSampler", "inputs": {
        "model": model_ref, "positive": ["2", 0], "negative": ["3", 0],
        "latent_image": ["4", 0], "seed": seed, "steps": steps, "cfg": cfg,
        "sampler_name": sampler, "scheduler": scheduler, "denoise": 1.0}}
    if hires:
        scale = job.get("hires_scale", 1.5)
        hw, hh = (int(w * scale) // 8) * 8, (int(h * scale) // 8) * 8
        wf["6"] = {"class_type": "LatentUpscale", "inputs": {
            "samples": ["5", 0], "upscale_method": "nearest-exact",
            "width": hw, "height": hh, "crop": "disabled"}}
        wf["7"] = {"class_type": "KSampler", "inputs": {
            "model": model_ref, "positive": ["2", 0], "negative": ["3", 0],
            "latent_image": ["6", 0], "seed": seed + 1, "steps": steps,
            "cfg": cfg, "sampler_name": sampler, "scheduler": scheduler,
            "denoise": job.get("hires_denoise", 0.5)}}
        wf["8"] = {"class_type": "VAEDecode",
                   "inputs": {"samples": ["7", 0], "vae": vae_ref}}
        wf["9"] = {"class_type": "SaveImage",
                   "inputs": {"images": ["8", 0], "filename_prefix": prefix}}
    else:
        wf["6"] = {"class_type": "VAEDecode",
                   "inputs": {"samples": ["5", 0], "vae": vae_ref}}
        wf["7"] = {"class_type": "SaveImage",
                   "inputs": {"images": ["6", 0], "filename_prefix": prefix}}
    return wf, prefix


def main():
    global ROUTE
    ap = argparse.ArgumentParser(
        description="ComfyUI monster illustration generator (flux2)")
    ap.add_argument("--config", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--route", default=ROUTE, choices=("flux2", "sdxl"),
                    help="generation route. Default and ONLY production route: "
                         "flux2. 'sdxl' is FROZEN (REQ-0150) -- historical "
                         "reproduction only, never for new production art.")
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--cfg", type=float, default=None)
    ap.add_argument("--sampler", default=None)
    ap.add_argument("--only", default=None,
                    help="comma-separated job names; skip the rest")
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
    d = G.ROUTE_DEFAULTS[ROUTE]
    print(f"route: {ROUTE}  steps={a.steps or d['steps']} "
          f"cfg={a.cfg if a.cfg is not None else d['cfg']} "
          f"sampler={a.sampler or d['sampler']}", flush=True)
    if ROUTE == "flux2":
        print(f"  unet={G.FLUX['unet']} clip={G.FLUX['clip']} "
              f"vae={G.FLUX['vae']}", flush=True)

    jobs = json.load(open(a.config, encoding="utf-8"))
    if a.only:
        keep = {s.strip() for s in a.only.split(",")}
        jobs = [j for j in jobs if j["name"] in keep]
    os.makedirs(a.outdir, exist_ok=True)
    out_native = os.path.expanduser("~/ComfyUI/output")
    os.makedirs(out_native, exist_ok=True)

    ok = fail = 0
    for job in jobs:
        print(f"=== JOB START name={job['name']} route={ROUTE} ===", flush=True)
        t0 = time.time()
        wf, prefix = build_workflow(job, a.steps, a.cfg, a.sampler)
        pid = submit(wf)
        print(f"submitted pid={pid}", flush=True)
        result = wait_done(pid)
        if not result or result.get("status", {}).get("status_str") == "error":
            print(f"JOB TIMEOUT/FAIL name={job['name']}", flush=True)
            fail += 1
            continue
        matches = sorted(glob.glob(os.path.join(out_native, prefix + "*.png")),
                         key=os.path.getmtime)
        if not matches:
            print(f"JOB NO OUTPUT FILE name={job['name']}", flush=True)
            fail += 1
            continue
        dst = os.path.join(a.outdir, f"{job['name']}.png")
        shutil.copy(matches[-1], dst)
        ok += 1
        print(f"JOB DONE name={job['name']} -> {dst} "
              f"({time.time()-t0:.1f}s)", flush=True)

    print(f"ALL DONE  ok={ok} fail={fail}", flush=True)


if __name__ == "__main__":
    main()
