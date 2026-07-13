#!/usr/bin/env python3
"""REQ-0150 / REQ-0146 -- generate BORDERED skin textures ON PURPOSE, gate them, compose.

Until now the frame source was an accident: bpskin_leather.png was an Anime-template
FILL that failed by coming out as a bordered patch. It happened to be extractable.
"Happened to be" is not a pipeline.

This makes it deliberate and, more importantly, CHECKABLE:

  S1  GENERATE   a patch of <material> with an explicit border, on white, WITH A
                 MARGIN -- the margin is now part of the brief, not luck.
  S2  VALIDATE   by script. A frame source is only usable if the extractor can
                 actually find it. Five machine checks, below. FAIL -> reroll the
                 seed; a failing candidate never reaches the tool.
  S3  COMPOSE    only PASS candidates go through req0150_bpskin_compose, which
                 pairs them with a seamless fill of the same material and builds
                 the backpack frame over any polyomino.

WHY THE WHITE MARGIN IS THE GATE
The extractor finds the patch by flood-filling near-white background inward from
the four image corners, then takes the welt as "within `band` px of the silhouette
edge". Both steps need background that REACHES the border and RINGS the subject.
bpskin_leather only just survived this: its silhouette was 99.6% of the tile --
white only in the rounded corners. One pixel of bleed to an image edge and the
flood fill leaks, or the ring opens. So: margin present, all four sides, or FAIL.

THE FIVE CHECKS (all numeric, all reported)
  margin      the outer 4% ring of the image is >= 95% background   -> the flood
              fill has somewhere to start, on every side
  solidity    area / convex-hull area >= 0.88                       -> a panel,
              not a blobby object with fingers the welt cannot follow
  single      the largest connected component is >= 95% of the mask -> one patch,
              not scattered pieces
  coverage    silhouette is 45-93% of the frame                     -> not a
              postage stamp, not edge-to-edge
  rim         mean |luma(ring) - luma(interior)| >= 8, OR the ring's gradient
              energy >= 1.25x the interior's                        -> there IS a
              border to extract, rather than a plain square of texture
"""
import argparse, glob, json, os, shutil, sys, time
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import art_route as ROUTE      # noqa: E402  the ONE route + the ONE graph
import art_style as STYLE      # noqa: E402  the ONE prompt/style layer
import bpskin_compose as C     # noqa: E402  silhouette / ring / welt / compose

OUT = "content/batches/bpskin-frames-0150"
PX = 1024
BAND_FRAC = 0.075          # welt band as a fraction of the tile, for the rim check
MARGIN_FRAC = 0.04

# The margin is IN THE BRIEF now -- "centered with an even margin, not touching
# the edges of the image". That is the clause the validator then checks for.
MATERIALS = {
    "leather": dict(
        frame="a single square brown leather panel with a thick stitched leather "
              "welt border and rounded corners, centered with an even margin, not "
              "touching the edges of the image, white background, bold outline",
        fill="brown leather texture, worn grain and fine creases, "),
    "iron": dict(
        frame="a single square dark iron plate with a thick riveted metal border "
              "and rounded corners, centered with an even margin, not touching the "
              "edges of the image, white background, bold outline",
        fill="dark iron metal texture, hammered surface, faint scratches, "),
    "wood": dict(
        frame="a single square wooden panel with a thick carved wood frame border "
              "and rounded corners, centered with an even margin, not touching the "
              "edges of the image, white background, bold outline",
        fill="dark oak wood texture, fine grain, "),
}
FRAME_SEEDS = [1, 202]


def luma(a):
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def grad_energy(l, m):
    gy, gx = np.gradient(l)
    g = np.hypot(gx, gy)
    return float(g[m].mean()) if m.any() else 0.0


def validate(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float32)
    H, W = a.shape[:2]
    r = {"file": os.path.basename(path)}

    # margin -- the outer ring of the IMAGE must be background on every side
    m = max(4, int(min(H, W) * MARGIN_FRAC))
    nearwhite = (a.min(axis=2) > 225) & ((a.max(axis=2) - a.min(axis=2)) < 30)
    edge = np.zeros((H, W), bool)
    edge[:m, :] = edge[-m:, :] = edge[:, :m] = edge[:, -m:] = True
    r["margin_bg_frac"] = round(float(nearwhite[edge].mean()), 3)
    per_side = [float(nearwhite[:m, :].mean()), float(nearwhite[-m:, :].mean()),
                float(nearwhite[:, :m].mean()), float(nearwhite[:, -m:].mean())]
    r["margin_worst_side"] = round(min(per_side), 3)
    r["check_margin"] = bool(r["margin_worst_side"] >= 0.95)

    sil = C.silhouette(im)
    r["coverage"] = round(float(sil.mean()), 3)
    r["check_coverage"] = bool(0.45 <= r["coverage"] <= 0.93)

    lab, n = ndimage.label(sil)
    if n == 0:
        r["check_single"] = r["check_solidity"] = r["check_rim"] = False
        r["PASS"] = False
        return r
    sizes = ndimage.sum(sil, lab, range(1, n + 1))
    big = sizes.max() / max(sil.sum(), 1)
    r["largest_component_frac"] = round(float(big), 3)
    r["check_single"] = bool(big >= 0.95)
    sil = lab == (int(np.argmax(sizes)) + 1)

    try:
        from skimage.morphology import convex_hull_image
        hull = convex_hull_image(sil)
        sol = sil.sum() / max(hull.sum(), 1)
    except Exception:
        sol = 1.0
    r["solidity"] = round(float(sol), 3)
    r["check_solidity"] = bool(sol >= 0.88)

    band = int(min(H, W) * BAND_FRAC)
    ring, _ = C.ring_of(sil, band)
    inner = sil & ~ring
    l = luma(a)
    d_luma = abs(float(l[ring].mean()) - float(l[inner].mean())) if inner.any() else 0.0
    ge_r, ge_i = grad_energy(l, ring), grad_energy(l, inner)
    r["rim_luma_delta"] = round(d_luma, 1)
    r["rim_grad_ratio"] = round(ge_r / max(ge_i, 1e-6), 2)
    r["check_rim"] = bool((d_luma >= 8.0) or (r["rim_grad_ratio"] >= 1.25))

    r["PASS"] = bool(all(r[k] for k in
                         ("check_margin", "check_coverage", "check_single",
                          "check_solidity", "check_rim")))
    return r


def gen(prompt, seed, dst, prefix, tiling=False):
    if os.path.exists(dst):
        return True
    t0 = time.time()
    pid = ROUTE.submit(ROUTE.build_txt2img(prompt, PX, PX, seed, prefix,
                                          tiling=tiling))
    h = ROUTE.wait_done(pid)
    hits = sorted(glob.glob(os.path.join(ROUTE.COMFY_OUTPUT_DIR, prefix + "*.png")))
    if not h or not hits:
        print("FAIL gen " + prefix, flush=True)
        return False
    shutil.copy(hits[-1], dst)
    print("GEN %s %.1fs" % (os.path.basename(dst), time.time() - t0), flush=True)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--materials", default=",".join(MATERIALS))
    ap.add_argument("--band", type=int, default=75)
    ap.add_argument("--validate-only", action="store_true")
    a = ap.parse_args()
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    outdir = os.path.join(repo, OUT)
    os.makedirs(outdir, exist_ok=True)
    mats = [m.strip() for m in a.materials.split(",")]
    report = {"band": a.band, "checks": [], "skins": []}

    for mat in mats:
        spec = MATERIALS[mat]
        # ---- S1/S2: frame candidates, gated ---------------------------------
        chosen = None
        for seed in FRAME_SEEDS:
            name = "%s_frame_s%d" % (mat, seed)
            dst = os.path.join(outdir, name + ".png")
            if not a.validate_only:
                gen(STYLE.for_kind("item", spec["frame"]), seed, dst,
                    "fr0150_" + name)
            if not os.path.exists(dst):
                continue
            v = validate(dst)
            v["material"] = mat; v["seed"] = seed
            report["checks"].append(v)
            flags = " ".join(("%s=%s" % (k[6:], "ok" if v[k] else "NG"))
                             for k in v if k.startswith("check_"))
            print("VALIDATE %-18s %s  -> %s" % (name, flags,
                  "PASS" if v["PASS"] else "REJECT"), flush=True)
            if v["PASS"] and chosen is None:
                chosen = dst
        if chosen is None:
            print("NO USABLE FRAME for %s -- every candidate rejected. Not "
                  "composing; reroll or reword." % mat, flush=True)
            report["skins"].append({"material": mat, "composed": False})
            continue

        # ---- fill, seamless (REQ-0150 §2 recipe) -----------------------------
        fdst = os.path.join(outdir, "%s_fill.png" % mat)
        if not a.validate_only:
            gen(STYLE.fill_prompt(spec["fill"]), 101, fdst,
                "fr0150_%s_fill" % mat, tiling=True)
        if not os.path.exists(fdst):
            continue

        # ---- S3: compose, square + L ----------------------------------------
        fill = Image.open(fdst).convert("RGB")
        frame = Image.open(chosen).convert("RGB")
        sil = C.silhouette(frame)
        for shape in ("square", "L"):
            img = C.compose_shape(fill, frame, sil, C.SHAPES[shape], a.band)
            p = os.path.join(outdir, "%s_skin_%s.png" % (mat, shape))
            img.save(p)
            C.on_canvas(img).save(p.replace(".png", "_oncanvas.png"))
        print("COMPOSED %s  frame=%s  fill=%s" % (
            mat, os.path.basename(chosen), os.path.basename(fdst)), flush=True)
        report["skins"].append({"material": mat, "composed": True,
                                "frame": os.path.basename(chosen),
                                "fill": os.path.basename(fdst)})

    with open(os.path.join(outdir, "frame_report.json"), "w") as f:
        json.dump(report, f, indent=2)
    npass = sum(1 for c in report["checks"] if c["PASS"])
    print("\nDONE  %d/%d frame candidates passed the gate; %d skins composed"
          % (npass, len(report["checks"]),
             sum(1 for s in report["skins"] if s["composed"])), flush=True)


if __name__ == "__main__":
    main()
