#!/usr/bin/env python3
# =============================================================================
# DEPRECATED (REQ-0150, 2026-07-13). NOT part of the pipeline. Do not extend it,
# do not copy from it, do not cite it as precedent.
#
# SDXL backpack-skin spike. The route is retired; skins are REQ-0150 §2 + tools/gen_bpskin.py.
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

"""REQ-0131 bpskin tiling spike: motif-sheet -> edge-tile cutting ->
clip_mask autotrace -> minimal S3 harness on the validation shape suite.

Per the 2026-07-12 re-scope (REQ-0138): fill_texture seamlessness is
de-risked (circular padding recipe); THIS spike spends its budget on
(b) edge tiles and (c) clip_mask integrity. Deliverable = findings, not
shipping assets.

Pipeline:
  gen      GPU: per motif, generate a FRAME SHEET (ornate square frame,
           uniform border band on all 4 edges, empty near-white center,
           1024x1024, V9 + painterly tokens). The sheet is the "motif
           sheet (border strip samples)" of skin pipeline S2.
  cut      CPU: key out near-white -> art mask; measure band thickness;
           cut master tiles at 256 px cell scale:
             straight     = top-band center crop
             outer corner = top-left corner crop
             inner corner = PROCEDURAL miter of two straights (frame
                            sheets have no concave corners -- finding:
                            inner corners are authored/derived, not
                            generated directly)
           clip_mask per tile = flood fill of non-art pixels from the
           tile's interior side (alpha-channel encoding, ratified §7.5).
  harness  CPU: composite canvas bg -> fill_texture (REQ-0138 seamless
           output) clipped by (cell interiors + clip_masks) -> edge art,
           on the validation shape suite incl. inner-corner and holed
           shapes, over 3 contrasting backgrounds; per-composite leakage
           metric (fill pixels visible outside the skin silhouette).
           E/S/W tiles are 90-degree rotations of the N masters (BS-G5
           exception, edge tiles only).

Usage:
  req0131_spike.py gen [--seeds 101]
  req0131_spike.py cut
  req0131_spike.py harness [--fills DIR]   # DIR = REQ-0138 output dir
  req0131_spike.py all
Outputs under content/batches/bpskin-spike-0131/.
"""
import argparse
import glob
import json
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_item_icons as G  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageFilter  # noqa: E402
from scipy import ndimage  # noqa: E402

CKPT = "JuggernautXL_RunDiffusionPhoto2_V9_Final.safetensors"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "content/batches/bpskin-spike-0131")
CELL = 256          # master tile edge (px)
BAND_TARGET = 64    # border band width at cell scale (25% -- BS-G2 TBD)

STYLE = ("stylized painterly dark-fantasy game ornament, hand-painted "
         "illustration, digital painting, soft cel-shading, matte finish, "
         "weathered forged materials, muted desaturated palette, Norse "
         "mythology aesthetic, gentle flat lighting, crisp silhouette, "
         "plain uniform near-white background inside and outside the "
         "frame, no shadow, no gradient, high detail, sharp focus")
NEG = ("photograph, photorealistic, 3d render, cgi, glossy, text, letters, "
       "watermark, signature, central object, filled center, picture "
       "inside frame, painting inside frame, scenery, vignette, gradient, "
       "cast shadow, blurry, low quality, jpeg artifacts, cropped, "
       "asymmetric, broken border")

MOTIFS = {
    "elven": ("an ornate square elven frame border, a uniform decorative "
              "band of interwoven silver leaf filigree and pale sage vines "
              "with knotwork tracery on deep moss-green, running evenly "
              "along all four edges of the image, perfectly empty "
              "near-white center, "),
    "barbarian": ("an ornate square barbarian frame border, a uniform "
                  "rugged band of stitched dark leather, fur trim, "
                  "hammered iron studs and rawhide straps, running evenly "
                  "along all four edges of the image, perfectly empty "
                  "near-white center, "),
}

# validation shape suite (BS-G4: incl. inner corner + holed)
SHAPES = {
    "single": [(0, 0)],
    "I3": [(0, 0), (0, 1), (0, 2)],
    "L": [(0, 0), (1, 0), (2, 0), (2, 1)],
    "T": [(0, 0), (0, 1), (0, 2), (1, 1)],
    "Z": [(0, 0), (0, 1), (1, 1), (1, 2)],
    "plus": [(0, 1), (1, 0), (1, 1), (1, 2), (2, 1)],
    "holed": [(r, c) for r in range(3) for c in range(3) if (r, c) != (1, 1)],
}
BGS = {"dark": (19, 24, 32), "light": (233, 227, 211), "moss": (74, 93, 58)}


# ---------------------------------------------------------------- gen
def cmd_gen(seeds):
    os.makedirs(os.path.join(OUT, "sheets"), exist_ok=True)
    for motif, mp in MOTIFS.items():
        for seed in seeds:
            base = os.path.join(OUT, "sheets", f"{motif}_s{seed}.png")
            if os.path.exists(base):
                print(f"SKIP sheet {motif} s{seed}", flush=True)
                continue
            prefix = f"req0131_{motif}_{seed}"
            wf = {
                "1": {"class_type": "CheckpointLoaderSimple",
                      "inputs": {"ckpt_name": CKPT}},
                "2": {"class_type": "CLIPTextEncode",
                      "inputs": {"text": mp + STYLE, "clip": ["1", 1]}},
                "3": {"class_type": "CLIPTextEncode",
                      "inputs": {"text": NEG, "clip": ["1", 1]}},
                "4": {"class_type": "EmptyLatentImage", "inputs": {
                    "width": 1024, "height": 1024, "batch_size": 1}},
                "5": {"class_type": "KSampler", "inputs": {
                    "model": ["1", 0], "positive": ["2", 0],
                    "negative": ["3", 0], "latent_image": ["4", 0],
                    "seed": seed, "steps": 30, "cfg": 6.5,
                    "sampler_name": "dpmpp_2m", "scheduler": "karras",
                    "denoise": 1.0}},
                "6": {"class_type": "VAEDecode",
                      "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
                "7": {"class_type": "SaveImage",
                      "inputs": {"images": ["6", 0],
                                 "filename_prefix": prefix}},
            }
            t0 = time.time()
            pid = G.submit(wf)
            hist = G.wait_done(pid, timeout_s=2400)
            if not hist or hist.get("status", {}).get("status_str") == "error":
                print(f"FAIL sheet {motif} s{seed}", flush=True)
                continue
            hits = sorted(glob.glob(
                os.path.join(G.COMFY_OUTPUT_DIR, prefix + "*.png")))
            if hits:
                shutil.copy(hits[-1], base)
                print(f"GEN sheet {motif} s{seed} {time.time()-t0:.1f}s",
                      flush=True)


# ---------------------------------------------------------------- cut
def art_mask(img_rgb, thresh=36.0):
    """Near-white key: distance from the median border-ring color."""
    a = np.asarray(img_rgb, dtype=np.float32)
    ring = np.concatenate([a[2:8].reshape(-1, 3), a[-8:-2].reshape(-1, 3),
                           a[:, 2:8].reshape(-1, 3),
                           a[:, -8:-2].reshape(-1, 3)])
    bgcol = np.median(ring, axis=0)
    dist = np.sqrt(((a - bgcol) ** 2).sum(-1))
    m = dist > thresh
    m = ndimage.binary_opening(m, iterations=2)
    m = ndimage.binary_closing(m, iterations=3)
    return m


def band_thickness(mask):
    """Median per-column thickness of the top border band."""
    h = mask.shape[0]
    th = []
    for c in range(mask.shape[1]):
        col = mask[: h // 2, c]
        idx = np.where(col)[0]
        if len(idx):
            th.append(idx.max() - idx.min() + 1)
    return int(np.median(th)) if th else 0


def tile_rgba(sheet, mask, box):
    x0, y0, x1, y1 = box
    t = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
    t[..., :3] = np.asarray(sheet)[y0:y1, x0:x1]
    t[..., 3] = (mask[y0:y1, x0:x1] * 255).astype(np.uint8)
    return t


def clip_from_art(alpha, interior_from):
    """clip_mask = flood fill of non-art pixels reachable from the tile's
    interior side ('bottom' | 'bottomright' | 'topleft-open')."""
    free = alpha < 16
    lab, n = ndimage.label(free)
    h, w = alpha.shape
    seeds = {"bottom": [(h - 2, w // 2), (h - 2, 4), (h - 2, w - 5)],
             "bottomright": [(h - 2, w - 2), (h - 2, w // 2), (h // 2, w - 2)],
             }[interior_from]
    keep = {lab[r, c] for r, c in seeds if lab[r, c] != 0}
    clip = np.isin(lab, list(keep))
    return (clip * 255).astype(np.uint8)


def cmd_cut():
    os.makedirs(os.path.join(OUT, "tiles"), exist_ok=True)
    report = {}
    for motif in MOTIFS:
        sheets = sorted(glob.glob(os.path.join(OUT, "sheets", motif + "_s*.png")))
        sheets = [s for s in sheets if "_offset" not in s]
        if not sheets:
            print(f"NO SHEET for {motif}", flush=True)
            continue
        sheet = Image.open(sheets[0]).convert("RGB")
        mask = art_mask(sheet)
        th = band_thickness(mask)
        # rescale so band ~= BAND_TARGET at CELL scale
        scale = BAND_TARGET / max(th, 1)
        nw = max(int(sheet.width * scale), 2 * CELL)
        sheet2 = sheet.resize((nw, nw), Image.LANCZOS)
        mask2 = np.asarray(
            Image.fromarray((mask * 255).astype(np.uint8)).resize(
                (nw, nw), Image.LANCZOS)) > 127
        c = nw // 2
        straight = tile_rgba(sheet2, mask2, (c - CELL // 2, 0,
                                             c + CELL // 2, CELL))
        outer = tile_rgba(sheet2, mask2, (0, 0, CELL, CELL))
        # inner corner: procedural miter of two straights (finding: frame
        # sheets cannot express concave corners; derivation is the route)
        s_top = straight.copy()                       # band along top
        s_left = np.rot90(straight, k=1).copy()       # band along left
        inner = s_top.copy()
        tri = np.tri(CELL, CELL, -1, dtype=bool)      # below diagonal
        inner[tri] = s_left[tri]
        for name, t, interior in (("straight", straight, "bottom"),
                                  ("outer", outer, "bottomright"),
                                  ("inner", inner, "bottomright")):
            im = Image.fromarray(t)
            im.save(os.path.join(OUT, "tiles", f"{motif}_{name}.png"))
            clip = clip_from_art(t[..., 3], interior)
            if name == "inner":
                # inner corner clips fill on BOTH open sides of the notch
                clip = np.maximum(clip, np.rot90(clip, 2))
            Image.fromarray(clip).save(
                os.path.join(OUT, "tiles", f"{motif}_{name}_clip.png"))
        report[motif] = {"sheet": os.path.basename(sheets[0]),
                         "band_px_raw": th,
                         "band_px_cell": BAND_TARGET, "cell_px": CELL}
        print(f"CUT {motif}: band {th}px raw -> {BAND_TARGET}px @cell",
              flush=True)
    with open(os.path.join(OUT, "cut_report.json"), "w") as f:
        json.dump(report, f, indent=2)


# ------------------------------------------------------------- harness
def load_tiles(motif):
    t = {}
    for name in ("straight", "outer", "inner"):
        t[name] = np.asarray(Image.open(
            os.path.join(OUT, "tiles", f"{motif}_{name}.png")).convert("RGBA"))
        t[name + "_clip"] = np.asarray(Image.open(
            os.path.join(OUT, "tiles", f"{motif}_{name}_clip.png")).convert("L"))
    return t


def rot(a, k):
    return np.ascontiguousarray(np.rot90(a, k))


def composite_shape(shape, tiles, fill_img, bg, cell=CELL):
    cells = set(shape)
    rows = max(r for r, _ in cells) + 1
    cols = max(c for _, c in cells) + 1
    pad = cell // 2
    W, H = cols * cell + 2 * pad, rows * cell + 2 * pad
    canvas = np.zeros((H, W, 3), dtype=np.float32)
    canvas[:] = bg

    fill = np.asarray(fill_img.resize((cell, cell), Image.LANCZOS),
                      dtype=np.float32)[..., :3]
    # global fill mask (uint8 0..255): starts opaque on cells, band regions
    # replaced by edge clip_masks; edge art composited after fill.
    fmask = np.zeros((H, W), dtype=np.float32)
    for (r, c) in cells:
        y, x = pad + r * cell, pad + c * cell
        fmask[y:y + cell, x:x + cell] = 255.0

    art_layers = []
    B = BAND_TARGET
    for (r, c) in cells:
        y, x = pad + r * cell, pad + c * cell
        nb = {"N": (r - 1, c) in cells, "S": (r + 1, c) in cells,
              "W": (r, c - 1) in cells, "E": (r, c + 1) in cells}
        dg = {"NW": (r - 1, c - 1) in cells, "NE": (r - 1, c + 1) in cells,
              "SW": (r + 1, c - 1) in cells, "SE": (r + 1, c + 1) in cells}
        # straight edges (rotate N master: N=0, W=k1, S=k2, E=k3 -- BS-G5)
        for side, k in (("N", 0), ("W", 1), ("S", 2), ("E", 3)):
            if not nb[side]:
                art = rot(tiles["straight"], k)
                clip = rot(tiles["straight_clip"], k)
                fmask[y:y + cell, x:x + cell] = np.minimum(
                    fmask[y:y + cell, x:x + cell], clip.astype(np.float32))
                art_layers.append((y, x, art))
        # outer corners (two open sides meeting): NW=0, SW=1, SE=2, NE=3
        for cnr, (s1, s2, k) in {"NW": ("N", "W", 0), "SW": ("S", "W", 1),
                                 "SE": ("S", "E", 2), "NE": ("N", "E", 3)}.items():
            if not nb[s1] and not nb[s2]:
                art = rot(tiles["outer"], k)
                clip = rot(tiles["outer_clip"], k)
                fmask[y:y + cell, x:x + cell] = np.minimum(
                    fmask[y:y + cell, x:x + cell], clip.astype(np.float32))
                art_layers.append((y, x, art))
        # inner corners (both sides closed, diagonal open)
        for cnr, (s1, s2, k) in {"NW": ("N", "W", 0), "SW": ("S", "W", 1),
                                 "SE": ("S", "E", 2), "NE": ("N", "E", 3)}.items():
            if nb[s1] and nb[s2] and not dg[cnr]:
                art = rot(tiles["inner"], k)
                art_layers.append((y, x, art))

    # fill layer (texture continues across cells: global tiling offset)
    for (r, c) in cells:
        y, x = pad + r * cell, pad + c * cell
        m = (fmask[y:y + cell, x:x + cell] / 255.0)[..., None]
        canvas[y:y + cell, x:x + cell] = (
            canvas[y:y + cell, x:x + cell] * (1 - m) + fill * m)
    # edge art on top
    for (y, x, art) in art_layers:
        a = (art[..., 3:4].astype(np.float32)) / 255.0
        canvas[y:y + cell, x:x + cell] = (
            canvas[y:y + cell, x:x + cell] * (1 - a)
            + art[..., :3].astype(np.float32) * a)

    # leakage metric: fill visible OUTSIDE the skin silhouette
    # silhouette = union(cells) with band regions limited to clip|art
    leak = 0
    for (r, c) in cells:
        y, x = pad + r * cell, pad + c * cell
        m = fmask[y:y + cell, x:x + cell] > 8
        outside = np.zeros((cell, cell), dtype=bool)
        # any fill drawn where BOTH clip said no is impossible by
        # construction; approximate leak check = fill alpha in the outer
        # 2px ring of open sides beyond art coverage
        nbN = (r - 1, c) in cells
        if not nbN:
            artcov = np.zeros((cell, cell), dtype=bool)
            for (yy, xx, art) in art_layers:
                if yy == y and xx == x:
                    artcov |= art[..., 3] > 8
            outside[:2, :] = m[:2, :] & ~artcov[:2, :]
        leak += int(outside.sum())
    return Image.fromarray(canvas.astype(np.uint8)), leak


def cmd_harness(fills_dir):
    os.makedirs(os.path.join(OUT, "harness"), exist_ok=True)
    results = []
    for motif in MOTIFS:
        try:
            tiles = load_tiles(motif)
        except FileNotFoundError:
            print(f"NO TILES for {motif} (run cut first)", flush=True)
            continue
        fill_glob = sorted(glob.glob(
            os.path.join(fills_dir, f"{motif}_s*_seamless.png")))
        if not fill_glob:
            print(f"NO FILL for {motif} in {fills_dir}", flush=True)
            continue
        fill = Image.open(fill_glob[0]).convert("RGB")
        for sname, shape in SHAPES.items():
            for bgname, bg in BGS.items():
                img, leak = composite_shape(shape, tiles, fill, bg)
                fn = f"{motif}_{sname}_{bgname}.png"
                img.save(os.path.join(OUT, "harness", fn))
                results.append({"motif": motif, "shape": sname,
                                "bg": bgname, "leak_px": leak})
        print(f"HARNESS {motif} done", flush=True)
    with open(os.path.join(OUT, "harness", "results.json"), "w") as f:
        json.dump(results, f, indent=2)
    bad = [r for r in results if r["leak_px"] > 0]
    print(f"HARNESS composites={len(results)} leaking={len(bad)}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gen", "cut", "harness", "all"])
    ap.add_argument("--seeds", default="101")
    ap.add_argument("--fills",
                    default=os.path.join(
                        REPO, "../req-0138-bpskin-fill-tiling-recipe/"
                        "content/batches/bpskin-tiling-0138"))
    args = ap.parse_args()
    seeds = [int(s) for s in args.seeds.split(",")]
    if args.cmd in ("gen", "all"):
        cmd_gen(seeds)
    if args.cmd in ("cut", "all"):
        cmd_cut()
    if args.cmd in ("harness", "all"):
        cmd_harness(os.path.abspath(args.fills))


if __name__ == "__main__":
    main()
