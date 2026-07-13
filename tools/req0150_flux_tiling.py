#!/usr/bin/env python3
"""REQ-0150 §2 -- seamless tiling on FLUX.2. BLOCKING SPIKE.

REQ-0138 solved seamless fill_texture on SDXL with
  CheckpointLoaderSimple -> SeamlessTile (model patch) -> KSampler -> CircularVAEDecode
and measured: seam ratio 0.83-1.09 seamless vs 2.76-3.77 control (2 motifs x 2
seeds, zero overlap). REQ-0150 retires SDXL, so that recipe has to be re-solved
on FLUX.2 klein or declared dead WITH NUMBERS.

Same metric, same motifs, same seeds, same 1024px tile as REQ-0138 -- the
comparison is worthless otherwise. seam_metric() below is copied verbatim from
tools/req0138_tiling.py.

The negative prompt is DROPPED, not ported: on flux2 (distilled klein, cfg 1.0,
ConditioningZeroOut) it is inactive. REQ-0138's STYLE positive already carries
the constraints that mattered ("no focal object, no border, no frame, no
vignette, uniform pattern density edge to edge"), so the positive is byte-for-
byte REQ-0138's.

LEGS
  control   flux2, plain VAEDecode.                      (expect a seam)
  vae_circ  flux2 + CircularVAEDecode.                   (VAE-side circular pad only)
  seamless  flux2 + SeamlessTile + CircularVAEDecode.    (REQ-0138's recipe, verbatim)
            -> vae_circ vs seamless is the KEY test. SeamlessTile patches
               torch.nn.Conv2d modules. FLUX.2's denoiser is a DiT (patch-embed
               is Linear, attention is Linear) -- if it holds no Conv2d, the
               model patch is a NO-OP and the two legs come out BIT-IDENTICAL.
               That identity check is evidence, not inference (PROJECT.md).
  blend     flux2 generated OVERSIZE (1024+256) then wrap-crossfaded down to
            1024. Model-agnostic by construction: it cannot fail the metric, so
            the only real question is how much ghosting the crossfade band costs.
  inpaint   flux2 control, offset by half (the wrap seam is now the centre
            cross), the seam cross INPAINTED by flux2, then the untouched region
            composited back through a feathered mask so the new wrap edge is
            bit-identical to the original's interior. Model-agnostic too, but
            the seam band is real generated content, not a crossfade.

Usage: req0150_flux_tiling.py [--seeds 101,202] [--out content/batches/bpskin-flux2-0150]
"""
import argparse
import glob
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_item_icons as G  # noqa: E402  submit/wait_done/COMFY dirs/FLUX route
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

TILE = 1024
OVERLAP = 256          # blend leg: crossfade band width
INPAINT_HALF = 112     # inpaint leg: half-width of the seam cross band
INPAINT_FEATHER = 40   # composite feather, px
INPAINT_STEPS = 8
INPAINT_DENOISE = 0.75

# --- REQ-0138's prompt, unchanged (the negative is inactive on flux2, dropped) -
STYLE = ("seamless repeating allover pattern, flat textile texture fill, "
         "stylized painterly dark-fantasy game texture, hand-painted "
         "illustration, digital painting, soft cel-shading, matte finish, "
         "muted desaturated palette, Norse mythology aesthetic, flat even "
         "lighting, uniform pattern density edge to edge, no focal object, "
         "no border, no frame, no vignette, high detail, sharp focus")

MOTIFS = {
    "elven": ("elven forest brocade, interwoven silver leaf filigree and "
              "pale sage vines over deep moss-green woven fabric, delicate "
              "knotwork tracery, tarnished gold thread accents, "),
    "barbarian": ("barbarian war-hide patchwork, rough stitched leather "
                  "patches and dark fur bands, hammered iron studs and "
                  "rivets, crossed rawhide straps and bone toggles, "),
}


# --- metric: copied verbatim from tools/req0138_tiling.py --------------------
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
    """REQ-0138's half-shift offset + 2x2 contact sheet, for the human check."""
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


# --- flux2 graphs ------------------------------------------------------------
def _flux_common(prompt, w, h, seed, steps, prefix):
    return {
        "1": {"class_type": "UnetLoaderGGUF",
              "inputs": {"unet_name": G.FLUX["unet"]}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": G.FLUX["clip"], "type": "flux2",
                         "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": G.FLUX["vae"]}},
        "4": {"class_type": "CLIPTextEncode",
              "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["4", 0]}},
        "7": {"class_type": "KSamplerSelect",
              "inputs": {"sampler_name": G.FLUX["sampler"]}},
        "8": {"class_type": "Flux2Scheduler",
              "inputs": {"steps": steps, "width": w, "height": h}},
        "9": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
    }


def wf_txt2img(prompt, w, h, seed, prefix, patch_model, circular_vae):
    """control / vae_circ / seamless -- one graph, two switches."""
    wf = _flux_common(prompt, w, h, seed, G.FLUX["steps"], prefix)
    model_ref = ["1", 0]
    if patch_model:
        wf["20"] = {"class_type": "SeamlessTile",
                    "inputs": {"model": ["1", 0], "tiling": "enable",
                               "copy_model": "Make a copy"}}
        model_ref = ["20", 0]
    wf["6"] = {"class_type": "EmptyFlux2LatentImage",
               "inputs": {"width": w, "height": h, "batch_size": 1}}
    wf["13"] = {"class_type": "CFGGuider",
                "inputs": {"model": model_ref, "positive": ["4", 0],
                           "negative": ["5", 0], "cfg": G.FLUX["cfg"]}}
    wf["14"] = {"class_type": "SamplerCustomAdvanced",
                "inputs": {"noise": ["9", 0], "guider": ["13", 0],
                           "sampler": ["7", 0], "sigmas": ["8", 0],
                           "latent_image": ["6", 0]}}
    if circular_vae:
        wf["15"] = {"class_type": "CircularVAEDecode",
                    "inputs": {"samples": ["14", 0], "vae": ["3", 0],
                               "tiling": "enable"}}
    else:
        wf["15"] = {"class_type": "VAEDecode",
                    "inputs": {"samples": ["14", 0], "vae": ["3", 0]}}
    wf["16"] = {"class_type": "SaveImage",
                "inputs": {"images": ["15", 0], "filename_prefix": prefix}}
    return wf


def wf_inpaint(prompt, w, h, seed, prefix, img_name, mask_name):
    wf = _flux_common(prompt, w, h, seed, INPAINT_STEPS, prefix)
    wf["8"]["inputs"]["steps"] = INPAINT_STEPS
    wf["10"] = {"class_type": "LoadImage", "inputs": {"image": img_name}}
    wf["11"] = {"class_type": "LoadImage", "inputs": {"image": mask_name}}
    wf["12"] = {"class_type": "ImageToMask",
                "inputs": {"image": ["11", 0], "channel": "red"}}
    wf["17"] = {"class_type": "VAEEncode",
                "inputs": {"pixels": ["10", 0], "vae": ["3", 0]}}
    wf["18"] = {"class_type": "SetLatentNoiseMask",
                "inputs": {"samples": ["17", 0], "mask": ["12", 0]}}
    wf["19"] = {"class_type": "SplitSigmasDenoise",
                "inputs": {"sigmas": ["8", 0], "denoise": INPAINT_DENOISE}}
    wf["13"] = {"class_type": "CFGGuider",
                "inputs": {"model": ["1", 0], "positive": ["4", 0],
                           "negative": ["5", 0], "cfg": G.FLUX["cfg"]}}
    wf["14"] = {"class_type": "SamplerCustomAdvanced",
                "inputs": {"noise": ["9", 0], "guider": ["13", 0],
                           "sampler": ["7", 0],
                           "sigmas": ["19", 1],       # low_sigmas = partial denoise
                           "latent_image": ["18", 0]}}
    wf["15"] = {"class_type": "VAEDecode",
                "inputs": {"samples": ["14", 0], "vae": ["3", 0]}}
    wf["16"] = {"class_type": "SaveImage",
                "inputs": {"images": ["15", 0], "filename_prefix": prefix}}
    return wf


def run(wf, prefix, dst):
    if os.path.exists(dst):
        return True
    t0 = time.time()
    pid = G.submit(wf)
    hist = G.wait_done(pid, timeout_s=1800)
    if not hist or hist.get("status", {}).get("status_str") == "error":
        print(f"FAIL {prefix}", flush=True)
        if hist:
            for m in hist.get("status", {}).get("messages", [])[-3:]:
                print("   ", str(m)[:300], flush=True)
        return False
    hits = sorted(glob.glob(os.path.join(G.COMFY_OUTPUT_DIR, prefix + "*.png")))
    if not hits:
        print(f"FAIL {prefix}: no output", flush=True)
        return False
    shutil.copy(hits[-1], dst)
    print(f"GEN {os.path.basename(dst)} {time.time()-t0:.1f}s", flush=True)
    return True


# --- post-process legs -------------------------------------------------------
def wrap_crossfade(img, n=TILE, o=OVERLAP):
    """Oversize (n+o) -> tileable n. For i<o, crossfade column i against column
    n+i (its natural continuation): T[i] = (i/o)*A[i] + (1-i/o)*A[n+i]. At i=0
    the tile starts on exactly the content that follows column n-1, so the wrap
    join is continuous by construction; at i=o it is back to the original."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    assert a.shape[0] >= n + o and a.shape[1] >= n + o, a.shape
    t = a[:n + o, :n + o].copy()
    r = (np.arange(o, dtype=np.float32) / o)[None, :, None]        # x ramp
    t[:, :o] = r * t[:, :o] + (1.0 - r) * t[:, n:n + o]
    t = t[:, :n]
    r = (np.arange(o, dtype=np.float32) / o)[:, None, None]        # y ramp
    t[:o, :] = r * t[:o, :] + (1.0 - r) * t[n:n + o, :]
    t = t[:n, :]
    return Image.fromarray(np.clip(t, 0, 255).astype(np.uint8))


def offset_half(img):
    a = np.asarray(img.convert("RGB"))
    h, w = a.shape[:2]
    return Image.fromarray(np.roll(np.roll(a, w // 2, axis=1), h // 2, axis=0))


def cross_mask(w, h, half=INPAINT_HALF):
    """White cross over the centre lines -- where the wrap seam lands after a
    half-offset. Everything else black (keep)."""
    m = np.zeros((h, w), dtype=np.uint8)
    m[:, w // 2 - half: w // 2 + half] = 255
    m[h // 2 - half: h // 2 + half, :] = 255
    return Image.fromarray(np.stack([m] * 3, axis=-1))


def feathered_composite(orig, gen, mask_img, feather=INPAINT_FEATHER):
    """Keep the model's pixels inside the mask, the ORIGINAL's outside, with a
    feathered ramp between. The wrap edge is therefore bit-identical to the
    original's interior -- the VAE round-trip cannot smuggle a new seam in."""
    from PIL import ImageFilter
    m = mask_img.convert("L").filter(ImageFilter.GaussianBlur(feather))
    a = np.asarray(orig.convert("RGB"), dtype=np.float32)
    b = np.asarray(gen.convert("RGB"), dtype=np.float32)
    w = (np.asarray(m, dtype=np.float32) / 255.0)[..., None]
    return Image.fromarray(np.clip(a * (1 - w) + b * w, 0, 255).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="101,202")
    ap.add_argument("--out", default="content/batches/bpskin-flux2-0150")
    args = ap.parse_args()
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(repo, args.out)
    os.makedirs(outdir, exist_ok=True)
    seeds = [int(s) for s in args.seeds.split(",")]

    findings = {
        "req": "REQ-0150 §2", "route": "flux2",
        "unet": G.FLUX["unet"], "clip": G.FLUX["clip"], "vae": G.FLUX["vae"],
        "steps": G.FLUX["steps"], "cfg": G.FLUX["cfg"],
        "tile_px": TILE, "overlap_px": OVERLAP,
        "inpaint": {"half": INPAINT_HALF, "feather": INPAINT_FEATHER,
                    "steps": INPAINT_STEPS, "denoise": INPAINT_DENOISE},
        "req0138_baseline_sdxl": {"seamless": [0.83, 1.09], "control": [2.76, 3.77]},
        "legs": [], "identity_checks": [],
        "started": time.strftime("%Y-%m-%d %H:%M:%S"),
    }

    def record(motif, seed, leg, path):
        img = Image.open(path)
        artifacts(os.path.splitext(path)[0], img)
        m = seam_metric(img)
        m.update({"motif": motif, "seed": seed, "leg": leg})
        findings["legs"].append(m)
        print(f"SEAM {motif:10s} s{seed} {leg:9s} "
              f"rx={m['ratio_x']:.2f} ry={m['ratio_y']:.2f}", flush=True)

    for motif, mp in MOTIFS.items():
        prompt = mp + STYLE
        for seed in seeds:
            tag = f"{motif}_s{seed}"

            # --- legs on the model itself
            for leg, patch, circ in (("control", False, False),
                                     ("vae_circ", False, True),
                                     ("seamless", True, True)):
                dst = os.path.join(outdir, f"{tag}_{leg}.png")
                pfx = f"r0150_{tag}_{leg}"
                if run(wf_txt2img(prompt, TILE, TILE, seed, pfx, patch, circ),
                       pfx, dst):
                    record(motif, seed, leg, dst)

            # --- is SeamlessTile a no-op on the FLUX DiT? bit-compare.
            p_v = os.path.join(outdir, f"{tag}_vae_circ.png")
            p_s = os.path.join(outdir, f"{tag}_seamless.png")
            if os.path.exists(p_v) and os.path.exists(p_s):
                av = np.asarray(Image.open(p_v).convert("RGB"), dtype=np.int16)
                as_ = np.asarray(Image.open(p_s).convert("RGB"), dtype=np.int16)
                d = np.abs(av - as_)
                chk = {"motif": motif, "seed": seed,
                       "pair": "vae_circ vs seamless",
                       "identical": bool(d.max() == 0),
                       "max_abs_diff": int(d.max()),
                       "mean_abs_diff": float(d.mean())}
                findings["identity_checks"].append(chk)
                print(f"IDENT {motif:10s} s{seed} vae_circ vs seamless: "
                      f"identical={chk['identical']} maxdiff={chk['max_abs_diff']}",
                      flush=True)

            # --- blend leg: oversize generation, wrap crossfade
            big = os.path.join(outdir, f"{tag}_oversize.png")
            pfx = f"r0150_{tag}_oversize"
            if run(wf_txt2img(prompt, TILE + OVERLAP, TILE + OVERLAP, seed, pfx,
                              False, False), pfx, big):
                dst = os.path.join(outdir, f"{tag}_blend.png")
                if not os.path.exists(dst):
                    wrap_crossfade(Image.open(big)).save(dst)
                record(motif, seed, "blend", dst)

            # --- inpaint leg: offset -> inpaint the seam cross -> composite back
            ctrl = os.path.join(outdir, f"{tag}_control.png")
            dst = os.path.join(outdir, f"{tag}_inpaint.png")
            if os.path.exists(ctrl) and not os.path.exists(dst):
                rolled = offset_half(Image.open(ctrl))
                mask = cross_mask(TILE, TILE)
                in_img = f"r0150_{tag}_rolled.png"
                in_msk = f"r0150_{tag}_mask.png"
                rolled.save(os.path.join(G.COMFY_INPUT_DIR, in_img))
                mask.save(os.path.join(G.COMFY_INPUT_DIR, in_msk))
                rolled.save(os.path.join(outdir, f"{tag}_rolled.png"))
                pfx = f"r0150_{tag}_inpaint_raw"
                raw = os.path.join(outdir, f"{tag}_inpaint_raw.png")
                if run(wf_inpaint(prompt, TILE, TILE, seed + 7, pfx,
                                  in_img, in_msk), pfx, raw):
                    feathered_composite(rolled, Image.open(raw), mask).save(dst)
            if os.path.exists(dst):
                record(motif, seed, "inpaint", dst)

    findings["finished"] = time.strftime("%Y-%m-%d %H:%M:%S")

    # --- verdict ------------------------------------------------------------
    by_leg = {}
    for m in findings["legs"]:
        by_leg.setdefault(m["leg"], []).extend([m["ratio_x"], m["ratio_y"]])
    findings["summary"] = {
        leg: {"min": round(min(v), 2), "max": round(max(v), 2),
              "mean": round(sum(v) / len(v), 2), "n": len(v)}
        for leg, v in by_leg.items()}
    base_hi = 1.09   # REQ-0138 seamless upper bound
    findings["verdict"] = {
        leg: ("PASS (meets REQ-0138 seamless band)" if s["max"] <= base_hi
              else "FAIL (worse than REQ-0138's seamless band)")
        for leg, s in findings["summary"].items()}

    with open(os.path.join(outdir, "findings.json"), "w") as f:
        json.dump(findings, f, indent=2)

    print("\n=== SUMMARY (seam ratio; REQ-0138 SDXL: seamless 0.83-1.09, "
          "control 2.76-3.77) ===", flush=True)
    for leg in ("control", "vae_circ", "seamless", "blend", "inpaint"):
        if leg in findings["summary"]:
            s = findings["summary"][leg]
            print(f"  {leg:9s} min={s['min']:5.2f} max={s['max']:5.2f} "
                  f"mean={s['mean']:5.2f}  {findings['verdict'][leg]}", flush=True)
    for c in findings["identity_checks"]:
        print(f"  IDENT {c['motif']} s{c['seed']}: SeamlessTile no-op="
              f"{c['identical']} (maxdiff {c['max_abs_diff']})", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
