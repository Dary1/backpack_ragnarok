#!/usr/bin/env python3
"""REQ-0187 -- fit meter v3: cell-center statistics on top of the fit machinery.

v1 (long-part PCA) misread a curved blade edge as a misaligned part; v2 (naive
scale+translate grid search) clipped content off-canvas and left no padding.
v3 follows the user's direction: build on the EXISTING fit machinery
(tools/tool_fit_check.py, REQ-0020 reference port; imported, never forked --
the tool_icon_score.py pattern):

  - build_region(cellset)  allowed region WITH the no-contact pad already
    subtracted on outer faces -> "gichi-gichi" (edge-touching) is impossible.
  - solve()-style search    feasible placements only (content wholly inside
    the allowed region) -> CLIPPING is impossible by construction.
    4 rotations x 2 flips are searched: 90-degree steps are grid-legal (the
    game itself rotates items in the backpack).

What v3 changes vs centered_position(): the placement objective. REQ-0023's
centered_position picks the feasible position closest to the ALLOWED-REGION
centroid; here every feasible (orientation, scale, position) is scored by the
user's v2 statistic -- painted-pixel distance from EACH OWNED CELL's center
(per-cell, NOT the image center): fill fraction, median distance, min distance
(normalized by half-cell). Violations map directly:

  empty cell       fill low
  border-skimming  min_d large (nothing near that cell's center) + median_d large
  spill            impossible in packed placements; scored on the identity
                   placement only (deep overflow heavy, shallow light)

score = max(0, 100 - penalties). Weights exist to RANK and OPTIMIZE, not to
gate (S7: the human adopts). Axis alignment is deliberately NOT measured
(user ruling: the prompt owns it, the eyeball catches it; v1 proved detection
is error-prone).

Outputs per render: identity score (as generated), best packed placement
(scale/rot/flip/pos + score), and the transformed image at gen resolution for
the human eyeball -- the meter's optimum is itself under S7 review.

Usage:
  req0187_fit_meter.py --name req0187_l_axe --seeds 1,11,12,21 --outdir /tmp/x
Requires the kit python (numpy/scipy/PIL + birefnet via gen_item_icons).
"""
import argparse, io, json, os, sys, urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from PIL import Image
import tool_fit_check as fit
import gen_item_icons as GI

try:
    from scipy.signal import fftconvolve
    HAVE_SCIPY = True
except Exception:
    HAVE_SCIPY = False

API = os.environ.get("ART_API", "http://127.0.0.1:8802")
C, PAD, ALPHA_T = fit.CELL, fit.PAD, 8
GEN_CELL = 256                      # production po render resolution per cell

# v4 GOLDEN (user, 2026-07-15): "discomfort is decided by the WORST spot, not
# the average -- one cell\'s grave violation is not diluted by the other cells\'
# goodness." Aggregation is therefore worst-dominated, never averaging:
#   within a cell : probabilistic OR  v_cell = 1 - prod(1 - v_i)
#                   (largest violation dominates; co-occurring violations
#                   compound; nothing cancels)
#   across cells  : p-norm with p=6 (~max, but several bad cells read worse
#                   than one)
# Score = 100 * (1 - V_total). Positive averaging is only meaningful for
# additive experiences; fit-feel is negative-elimination.
FILL_SOFT_TARGET = 0.20   # below this an owned cell reads starved (was 0.45:
                          # over-punished slim-but-correct subjects, user-ranked
                          # best render sank to mid-table)
MEDIAN_D_OK = 0.80        # uniform-filled cell ~0.77, centered disk ~0.67
MIN_D_OK = 0.35
CELL_AGG_P = 6.0
DEEP_FULL_AT = 0.02       # deep overflow of 2% of one cell = total violation
SCALE_STEPS = (1.0, 0.95, 0.9, 0.85, 0.8, 0.75)   # fractions of each orientation smax
POS_STRIDE = 3                      # feasible-position subsampling (px at CELL grid)


def get(url):
    with urllib.request.urlopen(API + url) as r:
        return r.read()


def mask_to_cells(mask):
    return [[r, c] for r in range(len(mask)) for c in range(len(mask[r])) if mask[r][c]]


_yy, _xx = np.mgrid[0:C, 0:C]
_DIST = np.sqrt((_yy - (C - 1) / 2.0) ** 2 + (_xx - (C - 1) / 2.0) ** 2) / (C / 2.0)


def cell_stats(content, cellset):
    out = {}
    for (r, cc) in sorted(cellset):
        cell = content[r * C:(r + 1) * C, cc * C:(cc + 1) * C]
        n = int(cell.sum())
        key = "(%d,%d)" % (r, cc)
        if n == 0:
            out[key] = {"fill": 0.0, "median_d": None, "min_d": None}
            continue
        d = _DIST[cell]
        out[key] = {"fill": round(n / float(C * C), 4),
                    "median_d": round(float(np.median(d)), 3),
                    "min_d": round(float(d.min()), 3)}
    return out


def cell_violation(st):
    """One cell\'s violation components -> OR-combined [0,1]."""
    if st["median_d"] is None:
        return 1.0, {"empty": 1.0, "center": 1.0, "void": 1.0}
    v_empty = min(1.0, max(0.0, FILL_SOFT_TARGET - st["fill"]) / FILL_SOFT_TARGET)
    v_center = min(1.0, max(0.0, st["median_d"] - MEDIAN_D_OK) / (1.414 - MEDIAN_D_OK))
    v_void = min(1.0, max(0.0, st["min_d"] - MIN_D_OK) / (1.414 - MIN_D_OK))
    v = 1.0 - (1.0 - v_empty) * (1.0 - v_center) * (1.0 - v_void)
    return v, {"empty": round(v_empty, 3), "center": round(v_center, 3),
               "void": round(v_void, 3)}


def violation_from_stats(stats):
    """Across cells: p-norm (~max). Returns (V_cells, per-cell detail)."""
    vs, detail = [], {}
    for key, st in stats.items():
        v, comps = cell_violation(st)
        vs.append(v)
        detail[key] = {"v": round(v, 3), "comps": comps}
    V = float(np.mean([v ** CELL_AGG_P for v in vs])) ** (1.0 / CELL_AGG_P)
    return V, detail


def score_identity(content, cellset, rows, cols):
    """As-generated placement: cell stats + overflow (spill is possible here)."""
    allowed = fit.build_region(cellset)
    overflow = content & (~allowed)
    deep = 0
    for r in range(rows):
        for c in range(cols):
            co = overflow[r * C:(r + 1) * C, c * C:(c + 1) * C].copy()
            co[:PAD, :] = False; co[-PAD:, :] = False
            co[:, :PAD] = False; co[:, -PAD:] = False
            deep += int(co.sum())
    shallow = int(overflow.sum()) - deep
    stats = cell_stats(content, cellset)
    V_cells, detail = violation_from_stats(stats)
    v_deep = min(1.0, deep / (DEEP_FULL_AT * C * C))
    v_shallow = min(1.0, 0.3 * shallow / (C * C))
    V = 1.0 - (1.0 - V_cells) * (1.0 - v_deep) * (1.0 - v_shallow)
    return {"score": round(100.0 * (1.0 - V), 2),
            "violations": {"cells": round(V_cells, 3), "deep": round(v_deep, 3),
                           "shallow": round(v_shallow, 3)},
            "cell_detail": detail, "cells": stats, "deep_overflow_px": deep}


def score_placement(canvas_shape, kern, pos, cellset):
    H, W = canvas_shape
    canvas = np.zeros((H, W), dtype=bool)
    y, x = pos
    canvas[y:y + kern.shape[0], x:x + kern.shape[1]] = kern
    stats = cell_stats(canvas, cellset)
    V_cells, detail = violation_from_stats(stats)
    return {"score": round(100.0 * (1.0 - V_cells), 2),
            "violations": {"cells": round(V_cells, 3)},
            "cell_detail": detail, "cells": stats}, canvas


def feasible_positions(allowed, kern):
    """All zero-overlap top-left positions -- the reference find_placement()
    conv, enumerating every match instead of argwhere(...)[0], exactly the
    centered_position() pattern."""
    kh, kw = kern.shape
    H, W = allowed.shape
    if kh > H or kw > W:
        return np.empty((0, 2), dtype=int)
    blocked = (~allowed).astype(np.float32)
    if HAVE_SCIPY:
        conv = fftconvolve(blocked, kern[::-1, ::-1].astype(np.float32), mode="valid")
    else:
        conv = fit._fftconvolve_valid_numpy(blocked.astype(np.float64),
                                            kern[::-1, ::-1].astype(np.float64))
    return np.argwhere(conv < 0.5)


def best_packed(content, cellset, rows, cols):
    """Search orientation x scale x feasible position for the max cell-center
    score. Containment (hence padding, hence no clipping) is guaranteed by
    searching feasible positions only."""
    allowed = fit.build_region(cellset)
    cropped = fit.crop_to_content(content)
    best = None
    for flipv in (False, True):
        m0 = cropped[:, ::-1] if flipv else cropped
        for k in (0, 1, 2, 3):
            m = np.rot90(m0, k)
            r = fit.max_scale(allowed, m)
            if r is None:
                continue
            smax = r[0]
            for frac in SCALE_STEPS:
                s = smax * frac
                kern = fit.scaled(m, s)
                pos_all = feasible_positions(allowed, kern)
                if len(pos_all) == 0:
                    continue
                sub = pos_all[::max(1, len(pos_all) // 400)]
                sub = sub[(sub[:, 0] % POS_STRIDE == 0) | (sub[:, 1] % POS_STRIDE == 0)] \
                    if len(sub) > 60 else sub
                for (y, x) in sub:
                    sc, _ = score_placement(allowed.shape, kern, (int(y), int(x)), cellset)
                    if best is None or sc["score"] > best["result"]["score"]:
                        best = {"result": sc, "scale": float(s), "rot": k * 90,
                                "flip": flipv, "pos": (int(y), int(x)),
                                "kern_shape": kern.shape}
    return best


def emit_packed_image(rgba, content, best, rows, cols, out_path):
    """Apply best (flip, rot, scale, pos) to the gen-res RGBA and composite on
    white at gen resolution (rows x cols cells, GEN_CELL px/cell)."""
    ys, xs = np.nonzero(content)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    F = GEN_CELL / float(C)
    gy0, gy1 = int(y0 * F), int(np.ceil(y1 * F))
    gx0, gx1 = int(x0 * F), int(np.ceil(x1 * F))
    piece = rgba.crop((gx0, gy0, gx1, gy1))
    if best["flip"]:
        piece = piece.transpose(Image.FLIP_LEFT_RIGHT)
    for _ in range(best["rot"] // 90):
        piece = piece.transpose(Image.ROTATE_90)
    kh, kw = best["kern_shape"]
    piece = piece.resize((max(1, int(round(kw * F))), max(1, int(round(kh * F)))),
                         Image.LANCZOS)
    canvas = Image.new("RGBA", (cols * GEN_CELL, rows * GEN_CELL), (0, 0, 0, 0))
    canvas.paste(piece, (int(best["pos"][1] * F), int(best["pos"][0] * F)), piece)
    white = Image.new("RGB", canvas.size, (255, 255, 255))
    white.paste(canvas, (0, 0), canvas)
    white.save(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--seeds", required=True)
    ap.add_argument("--outdir", required=True)
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)

    art = json.loads(get("/api/art/artworks/" + args.name))["artwork"]
    cells = mask_to_cells(art["shape"]["mask"])
    cellset, rows, cols = fit.shape_to_cellset(cells)

    results = []
    for seed in [int(s) for s in args.seeds.split(",")]:
        raw = get("/api/art/%s/renders/%d" % (args.name, seed))
        rgb = Image.open(io.BytesIO(raw)).convert("RGB")
        rgba = GI.matte_alpha_data(rgb)["image"]
        alpha = np.array(rgba)[:, :, 3]
        content = np.array(Image.fromarray(alpha, "L").resize(
            (cols * C, rows * C), Image.BILINEAR)) > ALPHA_T

        identity = score_identity(content, cellset, rows, cols)
        packed = best_packed(content, cellset, rows, cols)
        rec = {"seed": seed, "identity": identity}
        if packed:
            rec["packed"] = {"score": packed["result"]["score"],
                             "cell_detail": packed["result"]["cell_detail"],
                             "cells": packed["result"]["cells"],
                             "scale": round(packed["scale"], 4),
                             "rot": packed["rot"], "flip": packed["flip"],
                             "pos": list(packed["pos"])}
            emit_packed_image(rgba, content, packed, rows, cols,
                              os.path.join(args.outdir,
                                           "%s_s%d_packed.png" % (args.name, seed)))
            print("seed %-3d identity %6.2f -> packed %6.2f (s=%.3f rot=%d flip=%s pos=%s)"
                  % (seed, identity["score"], packed["result"]["score"],
                     packed["scale"], packed["rot"], packed["flip"], packed["pos"]),
                  flush=True)
        else:
            print("seed %-3d identity %6.2f -> NO feasible packing" %
                  (seed, identity["score"]), flush=True)
        results.append(rec)

    results.sort(key=lambda r: -r["identity"]["score"])
    with open(os.path.join(args.outdir, "findings.json"), "w") as f:
        json.dump({"artwork": args.name,
                   "grid": {"rows": rows, "cols": cols, "cell": C, "pad": PAD},
                   "v4": {"fill_target": FILL_SOFT_TARGET, "median_ok": MEDIAN_D_OK,
                          "min_ok": MIN_D_OK, "agg_p": CELL_AGG_P,
                          "deep_full_at": DEEP_FULL_AT},
                   "results": results}, f, indent=1)
    print("\nidentity ranking:", [(r["seed"], r["identity"]["score"]) for r in results])
    print("packed ranking:  ", sorted([(r["seed"], r["packed"]["score"])
                                       for r in results if "packed" in r],
                                      key=lambda t: -t[1]))


if __name__ == "__main__":
    main()
