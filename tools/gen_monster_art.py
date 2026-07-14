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
import art_route as ROUTE   # noqa: E402  the ONE route + the ONE graph
import art_style as STYLE   # noqa: E402  the ONE prompt/style layer


def build_workflow(job):
    """flux2, via tools/art_route.py. The SDXL graph (CheckpointLoaderSimple +
    LoraLoader chain + KSampler + latent-upscale hires-fix) is GONE -- not frozen,
    gone. The route was retired by user decision (REQ-0150) and the monsters it
    produced are being regenerated on the new art direction, so it has nothing
    left to reproduce. It is in git history."""
    for dead, why in (
        ("loras", "SDXL/SD1.5 LoRAs do not load on FLUX, and the user's ratified "
                  "settings say NO LoRAs. The two this program used "
                  "(detail_tweaker, cel_shaded_art_style) were generic style/detail "
                  "boosters, not identity LoRAs -- fold the style into `positive`."),
        ("ckpt",  "There is no checkpoint on this route; the UNET/CLIP/VAE are "
                  "pinned in art_route.FLUX."),
        ("negative", "The negative prompt is inactive at cfg 1.0 (zeroed "
                     "conditioning). Fold it into `positive`."),
        ("hires", "An SDXL workaround for sampling away from ~1MP. FLUX.2 is "
                  "native there -- set width/height to the size you want."),
    ):
        if job.get(dead):
            raise SystemExit(
                "ERROR job '%s' sets `%s`, which does not exist on this route.\n%s"
                % (job.get("name", "?"), dead, why))

    subject = job["positive"]
    if job.get("apply_template", True):
        subject = STYLE.for_kind("monster", subject)
    prefix = "m3_" + job["name"]
    wf = ROUTE.build_txt2img(
        subject, job.get("width", 384), job.get("height", 512),
        job.get("seed", ROUTE.SEED), prefix,
        steps=job.get("steps", ROUTE.STEPS),
        cfg=job.get("cfg", ROUTE.CFG),
        sampler=job.get("sampler", ROUTE.SAMPLER))
    return wf, prefix


def main():
    ap = argparse.ArgumentParser(
        description="ComfyUI monster illustration generator (flux2)")
    ap.add_argument("--config", required=True)
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--cfg", type=float, default=None)
    ap.add_argument("--sampler", default=None)
    ap.add_argument("--only", default=None,
                    help="comma-separated job names; skip the rest")
    a = ap.parse_args()

    print("route: flux2  steps=%s cfg=%s sampler=%s" % (
        a.steps or ROUTE.STEPS, a.cfg if a.cfg is not None else ROUTE.CFG,
        a.sampler or ROUTE.SAMPLER), flush=True)
    print("  unet=%s clip=%s vae=%s" % (ROUTE.FLUX["unet"], ROUTE.FLUX["clip"],
                                        ROUTE.FLUX["vae"]), flush=True)

    jobs = json.load(open(a.config, encoding="utf-8"))
    if a.only:
        keep = {s.strip() for s in a.only.split(",")}
        jobs = [j for j in jobs if j["name"] in keep]
    os.makedirs(a.outdir, exist_ok=True)
    out_native = os.path.expanduser("~/ComfyUI/output")
    os.makedirs(out_native, exist_ok=True)

    ok = fail = 0
    for job in jobs:
        print(f"=== JOB START name={job['name']} route=flux2 ===", flush=True)
        t0 = time.time()
        wf, prefix = build_workflow(job)
        pid = ROUTE.submit(wf)
        print(f"submitted pid={pid}", flush=True)
        result = ROUTE.wait_done(pid)
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
