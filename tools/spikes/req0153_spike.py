#!/usr/bin/env python3
"""REQ-0153 -- PO shape-control spike driver.

A SPIKE (verdict + recipe, not production wiring). Proves or kills up-front
shape conditioning for PO polyomino silhouettes on the FIXED Flux.2 Klein 4B
route. Every arm runs through art_route / art_style AS MODULES; the
spike-local graph extensions (ReferenceLatent, img2img init, SetLatentNoiseMask)
live here and DO NOT touch the production route.

Arms
  0  baseline   unconditioned t2i (exactly art_route.build_txt2img).
  A  primary    scaffold -> VAEEncode -> ReferenceLatent into positive cond;
                edit-instruction prompt + Anime template; EmptyFlux2LatentImage.
  B             scaffold img2img init, denoise sweep {0.65,0.75,0.85}; no ref.
  C  A + hard latent mask over the dilated shape on a white-canvas latent
                (SetLatentNoiseMask). D in {0,8,16}.
  C2 (opt)      C but DifferentialDiffusion + soft-gradient mask.

Phases (run separately -- ComfyUI UP for gen, DOWN for matte, per the
--no-matte -> --rematte sequencing that avoids the rembg co-residency OOM):
  gen     generate the matrix, write raws to data/req0153/raws + runlog.jsonl.
  matte   birefnet-matte every raw -> data/req0153/alphas (ComfyUI stopped).
  score   machine-score every render -> content/batches/req0153-shape-control/findings.json.

The box (art_route docstring): first image cold-loads 450-540 s; batch BY
PROMPT (this driver groups jobs so the two prompt texts per subject are
consecutive); single attempt per job, NO retry storms.
"""
import argparse
import glob
import json
import os
import shutil
import sys
import threading
import time
import subprocess

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import art_route as ROUTE            # noqa: E402  the route (models, submit, wait_done, graph)
import art_style as STYLE           # noqa: E402  templates + gen_size
import req0153_shape_scaffold as SCAF  # noqa: E402  scaffold/mask geometry

import numpy as np                  # noqa: E402
from PIL import Image               # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(REPO, "data", "req0153")          # gitignored full matrix
RAWS = os.path.join(DATA, "raws")
ALPHAS = os.path.join(DATA, "alphas")
SCAFDIR = os.path.join(DATA, "scaffolds")
BATCH = os.path.join(REPO, "content", "batches", "req0153-shape-control")  # committed (small)
RUNLOG = os.path.join(DATA, "runlog.jsonl")

# Subjects apt to each shape, from the ratified item vocabulary. 3 per shape.
MATRIX = [
    ("l_tromino",   "battle axe"),
    ("l_tromino",   "hooked blade"),
    ("l_tromino",   "sickle"),
    ("t_tetromino", "war hammer"),
    ("t_tetromino", "wooden mallet"),
    ("t_tetromino", "anvil"),
    ("v_1x3",       "spear"),
    ("v_1x3",       "wizard staff"),
    ("v_1x3",       "arrow"),
    ("sq_2x2",      "round shield"),
    ("sq_2x2",      "treasure chest"),
    ("sq_2x2",      "spell book"),
]
SEEDS = [1, 2, 3, 4]

CI = ROUTE.COMFY_INPUT_DIR
CO = ROUTE.COMFY_OUTPUT_DIR


def slug(s):
    return s.replace(" ", "_")


def base_prompt(subject):
    """Arm 0 / Arm B prompt: the ratified PO item shape + Anime template."""
    return STYLE.for_kind("item", "%s, white background, bold outline" % subject)


def edit_prompt(subject):
    """Arm A / Arm C edit-instruction prompt + Anime template."""
    instr = ("Turn the gray shape into %s. Keep the silhouette exactly. "
             "white background, bold outline" % subject)
    return STYLE.render("anime", instr)


# ---------------------------------------------------------------------------
# VRAM sampler: nvidia-smi memory.used peak, sampled in a daemon thread.
# ---------------------------------------------------------------------------
class Vram:
    def __init__(self, period=0.8):
        self.period = period
        self.peak = 0
        self._run = True
        self._t = threading.Thread(target=self._loop, daemon=True)
        self._t.start()

    def _loop(self):
        while self._run:
            try:
                out = subprocess.check_output(
                    ["nvidia-smi", "--query-gpu=memory.used",
                     "--format=csv,noheader,nounits"], timeout=5)
                mb = int(out.decode().strip().splitlines()[0])
                if mb > self.peak:
                    self.peak = mb
            except Exception:
                pass
            time.sleep(self.period)

    def reset(self):
        self.peak = 0

    def stop(self):
        self._run = False


# ---------------------------------------------------------------------------
# Graph builders (spike-local; reuse ROUTE.FLUX + ROUTE constants).
# ---------------------------------------------------------------------------
def _common(prompt, w, h, seed, steps):
    return {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": ROUTE.FLUX["unet"]}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": ROUTE.FLUX["clip"], "type": "flux2", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": ROUTE.FLUX["vae"]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
        "7": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": ROUTE.SAMPLER}},
        "8": {"class_type": "Flux2Scheduler", "inputs": {"steps": steps, "width": w, "height": h}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
    }


def _decode_save(wf, prefix, latent_node, model_node, positive, latent_image):
    wf["13"] = {"class_type": "CFGGuider",
                "inputs": {"model": model_node, "positive": positive,
                           "negative": ["5", 0], "cfg": ROUTE.CFG}}
    wf["14"] = {"class_type": "SamplerCustomAdvanced",
                "inputs": {"noise": ["9", 0], "guider": ["13", 0], "sampler": ["7", 0],
                           "sigmas": latent_node, "latent_image": latent_image}}
    wf["15"] = {"class_type": "VAEDecode", "inputs": {"samples": ["14", 0], "vae": ["3", 0]}}
    wf["16"] = {"class_type": "SaveImage", "inputs": {"images": ["15", 0], "filename_prefix": prefix}}
    return wf


def wf_arm0(subject, w, h, seed, prefix):
    return ROUTE.build_txt2img(base_prompt(subject), w, h, seed, prefix)


def wf_armA(subject, w, h, seed, prefix, scaffold_name):
    wf = _common(edit_prompt(subject), w, h, seed, ROUTE.STEPS)
    wf["6"] = {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": w, "height": h, "batch_size": 1}}
    wf["10"] = {"class_type": "LoadImage", "inputs": {"image": scaffold_name}}
    wf["11"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}}
    wf["12"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["4", 0], "latent": ["11", 0]}}
    return _decode_save(wf, prefix, ["8", 0], ["1", 0], ["12", 0], ["6", 0])


def wf_armB(subject, w, h, seed, prefix, scaffold_name, denoise):
    wf = _common(base_prompt(subject), w, h, seed, ROUTE.STEPS)
    wf["10"] = {"class_type": "LoadImage", "inputs": {"image": scaffold_name}}
    wf["11"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}}
    wf["19"] = {"class_type": "SplitSigmasDenoise", "inputs": {"sigmas": ["8", 0], "denoise": denoise}}
    return _decode_save(wf, prefix, ["19", 1], ["1", 0], ["4", 0], ["11", 0])


def wf_armC(subject, w, h, seed, prefix, scaffold_name, white_name, mask_name, diff=False):
    wf = _common(edit_prompt(subject), w, h, seed, ROUTE.STEPS)
    wf["10"] = {"class_type": "LoadImage", "inputs": {"image": scaffold_name}}
    wf["11"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}}
    wf["12"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["4", 0], "latent": ["11", 0]}}
    wf["17"] = {"class_type": "LoadImage", "inputs": {"image": white_name}}
    wf["18"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["17", 0], "vae": ["3", 0]}}
    wf["20"] = {"class_type": "LoadImage", "inputs": {"image": mask_name}}
    wf["21"] = {"class_type": "ImageToMask", "inputs": {"image": ["20", 0], "channel": "red"}}
    wf["22"] = {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["18", 0], "mask": ["21", 0]}}
    model_node = ["1", 0]
    if diff:
        wf["23"] = {"class_type": "DifferentialDiffusion", "inputs": {"model": ["1", 0]}}
        model_node = ["23", 0]
    return _decode_save(wf, prefix, ["8", 0], model_node, ["12", 0], ["22", 0])


# ---------------------------------------------------------------------------
# Generation phase
# ---------------------------------------------------------------------------
def _prep_inputs(shape_name, gen_wh, dilations):
    """Write scaffold / white / hard-mask / soft-mask into ComfyUI input dir and
    a copy into the data scaffolds dir. Returns dict of node filenames."""
    shape = SCAF.SHAPES[shape_name]
    names = {}
    scaf = "r0153_%s_scaffold.png" % shape_name
    white = "r0153_%s_white.png" % shape_name
    SCAF.build_scaffold(shape, gen_wh, os.path.join(CI, scaf))
    SCAF.build_white_canvas(gen_wh, os.path.join(CI, white))
    shutil.copy(os.path.join(CI, scaf), os.path.join(SCAFDIR, scaf))
    names["scaffold"] = scaf
    names["white"] = white
    names["mask"] = {}
    for d in dilations:
        mn = "r0153_%s_mask_d%d.png" % (shape_name, d)
        SCAF.build_hard_mask(shape, gen_wh, os.path.join(CI, mn), d)
        shutil.copy(os.path.join(CI, mn), os.path.join(SCAFDIR, mn))
        names["mask"][d] = mn
    soft = "r0153_%s_soft.png" % shape_name
    SCAF.build_soft_mask(shape, gen_wh, os.path.join(CI, soft), 16)
    names["soft"] = soft
    return names


def _run_job(rec, wf, prefix, out_name, vram, force):
    dst = os.path.join(RAWS, out_name)
    if os.path.exists(dst) and not force:
        rec["status"] = "skip-exists"
        return rec
    vram.reset()
    t0 = time.time()
    try:
        pid = ROUTE.submit(wf)
    except Exception as e:
        rec.update(status="submit-error", error=str(e)[:400], wall_s=round(time.time() - t0, 1))
        return rec
    hist = ROUTE.wait_done(pid, timeout_s=1800)
    rec["wall_s"] = round(time.time() - t0, 1)
    rec["vram_peak_mb"] = vram.peak
    if not hist:
        rec["status"] = "timeout"
        return rec
    st = hist.get("status", {})
    if st.get("status_str") == "error":
        msgs = st.get("messages", [])
        rec.update(status="comfy-error", error=str(msgs[-2:])[:600])
        return rec
    hits = sorted(glob.glob(os.path.join(CO, prefix + "*.png")), key=os.path.getmtime)
    if not hits:
        rec["status"] = "no-output"
        return rec
    shutil.copy(hits[-1], dst)
    rec["status"] = "ok"
    rec["raw"] = os.path.relpath(dst, REPO)
    return rec


def phase_gen(args):
    for d in (RAWS, SCAFDIR):
        os.makedirs(d, exist_ok=True)
    arms = args.arms.split(",")
    denoises = [float(x) for x in args.denoise.split(",")]
    dilations = [int(x) for x in args.dilate.split(",")]
    seeds = [int(x) for x in args.seeds.split(",")]
    pairs = MATRIX
    if args.pairs != "all":
        want = set(args.pairs.split(","))
        pairs = [(s, sub) for (s, sub) in MATRIX if s in want or slug(sub) in want]
    if args.smoke:
        pairs = pairs[:1]
        seeds = seeds[:1]

    vram = Vram()
    logf = open(RUNLOG, "a")
    n_done = 0
    # Group jobs so the two prompt texts per (shape,subject) are consecutive.
    jobs = []
    for shape_name, subject in pairs:
        gen_wh = SCAF.gen_size_for_shape(SCAF.SHAPES[shape_name], args.px_per_cell)
        names = _prep_inputs(shape_name, gen_wh, dilations)
        w, h = gen_wh
        sl = slug(subject)
        # base-prompt arms first (0, B), then edit-prompt arms (A, C)
        for seed in seeds:
            if "0" in arms:
                jobs.append(("0", shape_name, subject, seed, None, None, w, h, names))
            if "B" in arms:
                for dn in denoises:
                    jobs.append(("B", shape_name, subject, seed, dn, None, w, h, names))
        for seed in seeds:
            if "A" in arms:
                jobs.append(("A", shape_name, subject, seed, None, None, w, h, names))
            if "C" in arms:
                for dl in dilations:
                    jobs.append(("C", shape_name, subject, seed, None, dl, w, h, names))
            if "C2" in arms:
                jobs.append(("C2", shape_name, subject, seed, None, 16, w, h, names))

    total = len(jobs)
    print("PLAN: %d jobs (arms=%s pairs=%d seeds=%s denoise=%s dilate=%s)"
          % (total, arms, len(pairs), seeds, denoises, dilations), flush=True)
    t_start = time.time()
    for i, (arm, shape_name, subject, seed, dn, dl, w, h, names) in enumerate(jobs, 1):
        sl = slug(subject)
        tag = "%s_%s_%s_s%d" % (arm, shape_name, sl, seed)
        if dn is not None:
            tag += "_dn%s" % str(dn).replace(".", "")
        if dl is not None:
            tag += "_d%d" % dl
        prefix = "r0153_" + tag
        out_name = tag + ".png"
        rec = dict(arm=arm, shape=shape_name, subject=subject, seed=seed,
                   denoise=dn, dilate=dl, gen_w=w, gen_h=h, tag=tag,
                   ts=time.strftime("%H:%M:%S"))
        if arm == "0":
            wf = wf_arm0(subject, w, h, seed, prefix)
        elif arm == "A":
            wf = wf_armA(subject, w, h, seed, prefix, names["scaffold"])
        elif arm == "B":
            wf = wf_armB(subject, w, h, seed, prefix, names["scaffold"], dn)
        elif arm == "C":
            wf = wf_armC(subject, w, h, seed, prefix, names["scaffold"], names["white"], names["mask"][dl])
        elif arm == "C2":
            wf = wf_armC(subject, w, h, seed, prefix, names["scaffold"], names["white"], names["soft"], diff=True)
        else:
            continue
        rec = _run_job(rec, wf, prefix, out_name, vram, args.force)
        logf.write(json.dumps(rec) + "\n"); logf.flush()
        n_done += 1
        elapsed = time.time() - t_start
        eta = elapsed / n_done * (total - n_done)
        print("[%d/%d] %-28s %-11s wall=%ss vram=%sMB  ETA=%dmin"
              % (i, total, tag, rec["status"], rec.get("wall_s", "-"),
                 rec.get("vram_peak_mb", "-"), eta / 60), flush=True)
    vram.stop()
    logf.close()
    print("GEN DONE (%d jobs, %.1f min)" % (total, (time.time() - t_start) / 60), flush=True)


# ---------------------------------------------------------------------------
# Matte phase (ComfyUI must be STOPPED -- rembg alpha_matting peaks 12-13 GB RSS)
# ---------------------------------------------------------------------------
def phase_matte(args):
    os.makedirs(ALPHAS, exist_ok=True)
    import gen_item_icons as G  # lazy: imports rembg
    raws = sorted(glob.glob(os.path.join(RAWS, "*.png")))
    print("MATTE %d raws" % len(raws), flush=True)
    for i, raw in enumerate(raws, 1):
        name = os.path.basename(raw)
        alpha = os.path.join(ALPHAS, name[:-4] + "_alpha.png")
        if os.path.exists(alpha) and not args.force:
            continue
        t0 = time.time()
        try:
            G.matte_alpha(raw, alpha, log_label=name)
        except Exception as e:
            print("FAIL matte %s: %s" % (name, e), flush=True)
            continue
        print("[%d/%d] %s (%.1fs)" % (i, len(raws), name, time.time() - t0), flush=True)
    print("MATTE DONE", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", required=True, choices=["gen", "matte"])
    ap.add_argument("--arms", default="0,A,B,C")
    ap.add_argument("--seeds", default="1,2,3,4")
    ap.add_argument("--denoise", default="0.65,0.75,0.85")
    ap.add_argument("--dilate", default="0,8,16")
    ap.add_argument("--pairs", default="all")
    ap.add_argument("--px-per-cell", type=int, default=256)
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if args.phase == "gen":
        phase_gen(args)
    elif args.phase == "matte":
        phase_matte(args)
