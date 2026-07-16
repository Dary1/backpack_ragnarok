# -*- coding: utf-8 -*-
"""tool_cell_fit.py -- REQ-0187 cell-fit scoring core (the "fit meter").

Encodes the user-articulated fit doctrine (item_content_pipeline.md S0.2) as a
reusable scoring module. Consumed by BOTH the po.cell_fit inspection kit
(tools/inspect_kits.py) and the REQ-0187 spike driver
(tools/spikes/req0187_fit_meter.py) -- imported, never forked, the
tool_fit_check pattern.

Scoring model (v5, all user-validated on real renders 2026-07-15):

GOLDEN aggregation (user): "discomfort is decided by the WORST spot, not the
average -- one cell's grave violation is not diluted by the other cells'
goodness." Within a cell, violations OR-combine (largest dominates, co-
occurring ones compound, nothing cancels); across cells a p=6 norm (~max).
Fit-feel is negative-elimination, so averaging is meaningless.

Shifted expectation centers (user): a face shared with an adjacent owned cell
is covered by CONTINUITY (the neighbor's mass reads as the same object
crossing the boundary); an EXPOSED face is where the eye checks the item
reaches its wall. Each cell's distance-field origin therefore shifts
CENTER_SHIFT_FRAC (10%) of a cell toward the sum of its exposed faces'
outward normals; opposite exposed faces cancel (a cross's center cell -- all
four faces connected -- shifts zero; an L's tip cell shifts toward the tip).
Measured effect: the diagonal composition fell from mid-table to LAST, and
the meter now reproduces the user's S7 ranking end to end.

Per-cell violation components on the painted-pixel distance distribution
(normalized by half-cell) from the shifted center:
  v_empty   fill below FILL_SOFT_TARGET (a starved owned cell -- the notch's
            justification collapses)
  v_center  median distance beyond MEDIAN_D_OK (mass far from the expectation
            point; border-skimming reads owned-by-no-cell)
  v_void    min distance beyond MIN_D_OK (nothing near the expectation point)
Global violations OR-combined on top: deep overflow (spill past the PAD band
into unowned territory, full violation at DEEP_FULL_AT of a cell) and shallow
overflow (light).

score = 100 * (1 - V_total). Scores RANK candidates and drive placement
optimization; they never gate adoption (art_pipeline.md S7: the human adopts).
NO axis-alignment term, deliberately: v1 of the meter tried long-part PCA and
misread a curved blade edge as a misaligned part; per user ruling alignment is
the PROMPT's job and the eyeball's catch.
"""
import numpy as np

import tool_fit_check as fit

C = fit.CELL
PAD = fit.PAD
ALPHA_T = 8

CENTER_SHIFT_FRAC = 0.10
FILL_SOFT_TARGET = 0.20
MEDIAN_D_OK = 0.80          # uniform-filled cell ~0.77, centered disk ~0.67
MIN_D_OK = 0.35
CELL_AGG_P = 6.0
DEEP_FULL_AT = 0.02

_yy, _xx = np.mgrid[0:C, 0:C]
_DIST_CACHE = {}


def _dist_field(shift_yx):
    key = (round(shift_yx[0], 1), round(shift_yx[1], 1))
    if key not in _DIST_CACHE:
        cy = (C - 1) / 2.0 + shift_yx[0]
        cx = (C - 1) / 2.0 + shift_yx[1]
        _DIST_CACHE[key] = np.sqrt((_yy - cy) ** 2 + (_xx - cx) ** 2) / (C / 2.0)
    return _DIST_CACHE[key]


def cell_shifts(cellset):
    """Per owned cell: CENTER_SHIFT_FRAC*C x (sum of exposed-face outward normals)."""
    shifts = {}
    for (r, c) in cellset:
        dy = dx = 0.0
        for (dr, dc) in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            if (r + dr, c + dc) not in cellset:
                dy += dr
                dx += dc
        shifts[(r, c)] = (CENTER_SHIFT_FRAC * C * dy, CENTER_SHIFT_FRAC * C * dx)
    return shifts


def cell_stats(content, cellset):
    """Per owned cell: painted fraction + distance stats from the SHIFTED center."""
    shifts = cell_shifts(cellset)
    out = {}
    for (r, cc) in sorted(cellset):
        cell = content[r * C:(r + 1) * C, cc * C:(cc + 1) * C]
        n = int(cell.sum())
        key = "(%d,%d)" % (r, cc)
        if n == 0:
            out[key] = {"fill": 0.0, "median_d": None, "min_d": None}
            continue
        d = _dist_field(shifts[(r, cc)])[cell]
        out[key] = {"fill": round(n / float(C * C), 4),
                    "median_d": round(float(np.median(d)), 3),
                    "min_d": round(float(d.min()), 3)}
    return out


def cell_violation(st):
    """One cell's components -> OR-combined [0,1]."""
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


def deep_overflow(content, cellset, rows, cols):
    """(deep_px, shallow_px) vs the allowed region -- REQ-0153 semantics."""
    allowed = fit.build_region(cellset)
    overflow = content & (~allowed)
    deep = 0
    for r in range(rows):
        for c in range(cols):
            co = overflow[r * C:(r + 1) * C, c * C:(c + 1) * C].copy()
            co[:PAD, :] = False; co[-PAD:, :] = False
            co[:, :PAD] = False; co[:, -PAD:] = False
            deep += int(co.sum())
    return deep, int(overflow.sum()) - deep


def score_content(content, cellset, rows, cols, with_overflow=True):
    """Full v5 score for a boolean content mask on the cell grid."""
    stats = cell_stats(content, cellset)
    V_cells, detail = violation_from_stats(stats)
    deep = shallow = 0
    if with_overflow:
        deep, shallow = deep_overflow(content, cellset, rows, cols)
    v_deep = min(1.0, deep / (DEEP_FULL_AT * C * C))
    v_shallow = min(1.0, 0.3 * shallow / (C * C))
    V = 1.0 - (1.0 - V_cells) * (1.0 - v_deep) * (1.0 - v_shallow)
    return {"score": round(100.0 * (1.0 - V), 2),
            "violations": {"cells": round(V_cells, 3), "deep": round(v_deep, 3),
                           "shallow": round(v_shallow, 3)},
            "cell_detail": detail, "cells": stats,
            "deep_overflow_px": deep, "overflow_px": deep + shallow}


def content_from_alpha(alpha_img, rows, cols):
    """PIL L-mode alpha (any size) -> boolean content mask on the cell grid."""
    from PIL import Image
    im = alpha_img.resize((cols * C, rows * C), Image.BILINEAR)
    return np.array(im) > ALPHA_T


# ---------------------------------------------------------------------------
# Packing search (REQ-0192; promoted from tools/spikes/req0187_fit_meter.py).
# Feasible placements only (content wholly inside build_region's allowed
# area), so clipping is impossible and the no-contact pad is respected by
# construction. 4x90-degree rotations + flips are grid-legal (the game itself
# rotates items in the backpack). The placement objective is score_content's
# cell-center statistic (worst-spot aggregation), NOT region-centroid
# proximity -- that is the whole point vs tool_fit_check.centered_position.
# ---------------------------------------------------------------------------
PACK_SCALE_STEPS = (1.0, 0.95, 0.9, 0.85, 0.8, 0.75)   # fractions of each orientation's max scale


def feasible_positions(allowed, kern):
    """All zero-overlap top-left positions -- the reference find_placement()
    conv, enumerating every match instead of argwhere(...)[0] (the
    centered_position() pattern)."""
    kh, kw = kern.shape
    H, W = allowed.shape
    if kh > H or kw > W:
        return np.empty((0, 2), dtype=int)
    blocked = (~allowed).astype(np.float32)
    try:
        from scipy.signal import fftconvolve
        conv = fftconvolve(blocked, kern[::-1, ::-1].astype(np.float32), mode="valid")
    except Exception:
        conv = fit._fftconvolve_valid_numpy(blocked.astype(np.float64),
                                            kern[::-1, ::-1].astype(np.float64))
    return np.argwhere(conv < 0.5)


def pack_search(content, cellset, rows, cols):
    """Best (scale, rot, flip, pos) by cell-fit score over feasible placements.
    Returns {result, scale, rot, flip, pos, kern_shape} or None."""
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
            for frac in PACK_SCALE_STEPS:
                s = smax * frac
                kern = fit.scaled(m, s)
                pos_all = feasible_positions(allowed, kern)
                if len(pos_all) == 0:
                    continue
                sub = pos_all[::max(1, len(pos_all) // 400)]
                for (y, x) in sub:
                    H, W = allowed.shape
                    canvas = np.zeros((H, W), dtype=bool)
                    canvas[y:y + kern.shape[0], x:x + kern.shape[1]] = kern
                    sc = score_content(canvas, cellset, rows, cols, with_overflow=False)
                    if best is None or sc["score"] > best["result"]["score"]:
                        best = {"result": sc, "scale": float(s), "rot": k * 90,
                                "flip": bool(flipv), "pos": (int(y), int(x)),
                                "kern_shape": kern.shape}
    return best


def apply_pack(rgba, content, best, rows, cols, gen_cell=256):
    """Apply (flip, rot, scale, pos) to a gen-resolution RGBA; returns the
    packed image as a TRANSPARENT RGBA PIL Image (rows x cols cells at
    gen_cell px/cell).

    REQ-0193: the trailing white composite was dropped -- a repack now carries
    the cutout its own matte already produced (user directive: repack must cut
    the background out automatically). The alpha here is the matte pack_job
    fed in, so no second matte runs."""
    from PIL import Image
    ys, xs = np.nonzero(content)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    F = gen_cell / float(C)
    piece = rgba.crop((int(x0 * F), int(y0 * F), int(np.ceil(x1 * F)), int(np.ceil(y1 * F))))
    if best["flip"]:
        piece = piece.transpose(Image.FLIP_LEFT_RIGHT)
    for _ in range(best["rot"] // 90):
        piece = piece.transpose(Image.ROTATE_90)
    kh, kw = best["kern_shape"]
    piece = piece.resize((max(1, int(round(kw * F))), max(1, int(round(kh * F)))), Image.LANCZOS)
    canvas = Image.new("RGBA", (cols * gen_cell, rows * gen_cell), (0, 0, 0, 0))
    canvas.paste(piece, (int(best["pos"][1] * F), int(best["pos"][0] * F)), piece)
    return canvas
