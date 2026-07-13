#!/usr/bin/env python3
"""REQ-0152 -- the inspection-kit library (pure functions).

A kit is a PURE function of (render PNG bytes + declared params): nothing it
reads is unreproducible from the render row. Each kit returns the unified
shape {verdict, metrics, checks, notes}; identity/version/routing live in
tools/inspect_kits.json (the single registry, read by both this runner and the
Node queue). tools/inspect_job.py is the CLI boundary the Node job runner
spawns; it stamps kit_version + kit_input_sha256 onto the row.

Verdict semantics (spec): FAIL is meaningful ONLY for the one blocking kit
(bpskin.frame_gate); every advisory kit tops out at WARN and never blocks
adoption. Metric naming uses the three DISAMBIGUATED coverage names:
  image_alpha_coverage  -- whole-image alpha>8 fraction (matte band; and the
                           non-near-white proxy for RGB-only renders)
  cell_content_coverage -- per-owned-cell content fraction (po packing/fit)
  silhouette_coverage   -- frame-silhouette fraction (bpskin gate)

Kits reuse the EXISTING measurement code by import (never fork): bpskin uses
gen_bpskin.validate(); matte uses gen_item_icons.matte_alpha_data(); po uses
tool_icon_score.score_candidate(); tiling uses inspect_seam.seam_metric().
monster.render_sanity and si.subject_frame are authored fresh (thresholds
below are IMPLEMENTER-PROPOSED, pending user S7 ratification on real renders)."""
import os
import sys
import json

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# Near-white background test shared with gen_bpskin.validate's margin check
# (min channel > 225 and low chroma): a pixel is "background" if it is that.
WHITE_MIN = 225
WHITE_CHROMA = 30
ALPHA_OPAQUE_T = 8  # matches gen_item_icons.ALPHA_OPAQUE_T

# ---- monster.render_sanity thresholds (FRESH -- S7 ratifies) ----
MON_CONTENT_MIN = 0.02   # subject must occupy >= 2% of the canvas
MON_CONTENT_MAX = 0.92   # <= 92% -> a white background still exists (not full-bleed)
MON_WHITE_MIN = 0.05     # >= 5% near-white background present

# ---- si.subject_frame thresholds (FRESH -- S7 ratifies) ----
SI_CONTENT_MIN = 0.03    # subject present
SI_CONTENT_MAX = 0.92    # not full-bleed
SI_SINGLE_MIN = 0.80     # largest connected component >= 80% of subject (single subject)
SI_CENTER_MAX = 0.25     # subject centroid within 25% of half-diagonal of the center
SI_MARGIN_MIN = 0.02     # subject bbox keeps a >= 2% margin off the canvas edge


def _load_rgba(path):
    return Image.open(path).convert("RGBA")


def _has_real_alpha(rgba_arr):
    """True if the alpha channel actually carries transparency (a genuine
    matte), not a fully-opaque channel PIL synthesised from an RGB PNG."""
    return bool(rgba_arr[:, :, 3].min() < 250)


def _nearwhite_mask(rgb_arr):
    lo = rgb_arr.min(axis=2)
    hi = rgb_arr.max(axis=2)
    return (lo > WHITE_MIN) & ((hi - lo) < WHITE_CHROMA)


def _subject_mask(rgba_arr):
    """Boolean subject mask: alpha>8 when a real matte is present, else the
    non-near-white pixels (the RGB-only white-background proxy)."""
    if _has_real_alpha(rgba_arr):
        return rgba_arr[:, :, 3] > ALPHA_OPAQUE_T
    rgb = rgba_arr[:, :, :3].astype(np.int16)
    return ~_nearwhite_mask(rgb)


def _cells_from_shape(shape):
    """po shape -> [[row,col],...] cell list for tool_fit_check. Accepts a
    {mask: 5x5 bool} (admin shape) or a raw [[r,c],...] list (golden vector)."""
    if shape is None:
        return None
    if isinstance(shape, dict) and "mask" in shape:
        cells = []
        for r, row in enumerate(shape["mask"]):
            for c, on in enumerate(row):
                if on:
                    cells.append([r, c])
        return cells or None
    if isinstance(shape, list):
        return shape or None
    return None


def _round_metrics(d):
    out = {}
    for k, v in d.items():
        out[k] = round(float(v), 6) if isinstance(v, (int, float)) else v
    return out


# =====================================================================
# bpskin.frame_gate -- normalize gen_bpskin.validate()'s 5-check report.
# blocking kit: verdict may be FAIL. KEPT AS-IS (flux2-native); this kit
# only maps its report into the unified shape (silhouette_coverage rename).
# =====================================================================
def kit_bpskin_frame_gate(ctx):
    import gen_bpskin as BP
    params = ctx.get("params") or {}
    rep = params.get("bpskin_frame_report")
    # A real validate() report carries check_margin; the REQ-0151 mock stub
    # ({"mocked":true,...}) does not -- in that case run validate() on the PNG.
    if isinstance(rep, dict) and "check_margin" in rep:
        r = rep
    else:
        r = BP.validate(ctx["png_path"])
    checks = [
        {"name": "margin", "ok": bool(r["check_margin"]),
         "value": r.get("margin_worst_side"), "threshold": ">= 0.95"},
        {"name": "silhouette_coverage", "ok": bool(r["check_coverage"]),
         "value": r.get("coverage"), "threshold": "0.45 .. 0.93"},
        {"name": "single_component", "ok": bool(r["check_single"]),
         "value": r.get("largest_component_frac"), "threshold": ">= 0.95"},
        {"name": "solidity", "ok": bool(r["check_solidity"]),
         "value": r.get("solidity"), "threshold": ">= 0.88"},
        {"name": "rim", "ok": bool(r["check_rim"]),
         "value": r.get("rim_luma_delta"), "threshold": "luma>=8 OR grad>=1.25"},
    ]
    metrics = _round_metrics({
        "silhouette_coverage": r.get("coverage", 0.0),
        "margin_worst_side": r.get("margin_worst_side", 0.0),
        "margin_bg_frac": r.get("margin_bg_frac", 0.0),
        "largest_component_frac": r.get("largest_component_frac", 0.0),
        "solidity": r.get("solidity", 0.0),
        "rim_luma_delta": r.get("rim_luma_delta", 0.0),
        "rim_grad_ratio": r.get("rim_grad_ratio", 0.0),
    })
    passed = bool(r.get("PASS"))
    notes = ["bpskin frame-source gate (5-check). Blocking INSIDE the "
             "generation recipe (compose consumes only PASS frames); advisory "
             "here -- never gates adoption."]
    if not passed:
        notes.append("FAIL checks: " + ", ".join(c["name"] for c in checks if not c["ok"]))
    return {"verdict": "PASS" if passed else "FAIL", "metrics": metrics,
            "checks": checks, "notes": notes}


# =====================================================================
# matte.coverage_band -- gen_item_icons.matte_alpha_data() coverage band.
# advisory: PASS in-band, WARN out-of-band. Never rejects.
# =====================================================================
def kit_matte_coverage_band(ctx):
    import gen_item_icons as GI
    src = ctx.get("alpha_path") or ctx["png_path"]
    arr = np.array(_load_rgba(src))
    method_env = os.environ.get("ART_KIT_MATTE_METHOD", "auto")
    if _has_real_alpha(arr):
        # Already matted (e.g. a recorded *_alpha.png, or an alpha render):
        # measure the provided alpha directly -- pure, no model needed.
        cov = GI._coverage(arr)
        method = "provided"
    else:
        rgb = Image.open(ctx["png_path"]).convert("RGB")
        if method_env == "borderkey":
            # Force the pure-numpy border-key path (no birefnet model) -- used
            # by e2e for a fast, model-free, deterministic run.
            img = GI._matte_border_key(rgb)
            cov = GI._coverage(np.array(img))
            method = "borderkey"
        else:
            d = GI.matte_alpha_data(rgb)  # birefnet primary, border-key fallback
            cov = d["image_alpha_coverage"]
            method = d["method"]
    in_band = GI._in_band(cov)
    metrics = _round_metrics({"image_alpha_coverage": cov})
    checks = [{"name": "in_band", "ok": bool(in_band), "value": round(float(cov), 6),
               "threshold": "0.02 .. 0.90"}]
    notes = ["matte method=" + method + "; validity band 0.02-0.90 "
             "(gen_item_icons matte_alpha). Advisory: out-of-band -> WARN, never rejects."]
    return {"verdict": "PASS" if in_band else "WARN", "metrics": metrics,
            "checks": checks, "notes": notes}


# =====================================================================
# po.cell_packing -- tool_icon_score.score_candidate() metrics. winner
# DEMOTED to an advisory note (art_pipeline.md §7: scoring FILTERS; the human
# adopts). advisory: PASS if feasible, WARN if content-too-small/infeasible.
# =====================================================================
def kit_po_cell_packing(ctx):
    import tool_icon_score as SC
    import tool_fit_check as fit
    cells = _cells_from_shape(ctx.get("shape"))
    if not cells:
        return {"verdict": "WARN", "metrics": {}, "checks": [],
                "notes": ["po.cell_packing: no shape cells on this artwork; cannot score."]}
    cellset, rows, cols = fit.shape_to_cellset(cells)
    allowed = fit.build_region(cellset)
    path = ctx.get("alpha_path") or ctx["png_path"]
    r = SC.score_candidate(path, allowed, cellset)
    advisory = ("Advisory (art_pipeline.md §7): the score FILTERS candidates; "
                "the human adopts. This kit does NOT pick a batch winner.")
    if not r["feasible"]:
        metrics = _round_metrics({"score": 0.0, "content_frac": r.get("content_frac") or 0.0,
                                  "cell_content_coverage": 0.0})
        checks = [{"name": "content_present", "ok": False,
                   "value": r.get("content_frac"), "threshold": ">= 0.02"}]
        return {"verdict": "WARN", "metrics": metrics, "checks": checks,
                "notes": ["infeasible: " + str(r.get("reason")), advisory]}
    t = r["terms"]
    metrics = _round_metrics({
        "score": r["score"],
        "cell_content_coverage": t["coverage_term"],
        "scale": r["scale"],
        "scale_term": t["scale_term"],
        "uniformity_term": t["uniformity_term"],
        "reference_scale": t["reference_scale"],
        "content_frac": r["content_frac"],
    })
    checks = [{"name": "content_present", "ok": True,
               "value": r["content_frac"], "threshold": ">= 0.02"}]
    notes = ["per_cell_coverage=" + json.dumps(r["per_cell_coverage"]),
             "fit: scale=%s rot=%s flip=%s" % (r["scale"], r.get("rot"), r.get("flip")),
             advisory]
    return {"verdict": "PASS", "metrics": metrics, "checks": checks, "notes": notes}


# =====================================================================
# tiling.seam -- inspect_seam.seam_metric() wrap/interior ratio, banded by
# REQ-0138. advisory: PASS in-band else WARN + MANDATORY half-shift eyeball.
# =====================================================================
def kit_tiling_seam(ctx):
    import inspect_seam as SEAM
    m = SEAM.seam_metric(Image.open(ctx["png_path"]))
    rx, ry = m["ratio_x"], m["ratio_y"]
    lo, hi = SEAM.SEAM_BAND_LO, SEAM.SEAM_BAND_HI
    ok_x = lo <= rx <= hi
    ok_y = lo <= ry <= hi
    in_band = ok_x and ok_y
    metrics = _round_metrics({
        "seam_ratio_x": rx, "seam_ratio_y": ry,
        "wrap_x": m["wrap_x"], "wrap_y": m["wrap_y"],
        "interior_x": m["interior_x"], "interior_y": m["interior_y"],
    })
    band = "%.2f .. %.2f" % (lo, hi)
    checks = [{"name": "seam_ratio_x", "ok": bool(ok_x), "value": round(rx, 4), "threshold": band},
              {"name": "seam_ratio_y", "ok": bool(ok_y), "value": round(ry, 4), "threshold": band}]
    notes = ["MANDATORY half-shift eyeball: verify the wrap seam visually on a "
             "half-shift offset -- the ratio reads high on low-contrast tiles "
             "(REQ-0150 spike finding), so this metric alone is not decisive."]
    return {"verdict": "PASS" if in_band else "WARN", "metrics": metrics,
            "checks": checks, "notes": notes}


# =====================================================================
# monster.render_sanity -- FRESH (monsters had ZERO inspection). White-bg
# fraction + subject presence (non-white content fraction + bbox vs canvas).
# advisory: PASS in band, else WARN. Thresholds S7-pending.
# =====================================================================
def kit_monster_render_sanity(ctx):
    arr = np.array(_load_rgba(ctx["png_path"]))
    H, W = arr.shape[:2]
    subject = _subject_mask(arr)
    rgb = arr[:, :, :3].astype(np.int16)
    white = _nearwhite_mask(rgb)
    content = float(subject.sum()) / subject.size
    white_frac = float(white.sum()) / white.size
    ys, xs = np.where(subject)
    if len(ys) == 0:
        bbox_fill = 0.0
    else:
        bbox_fill = float((ys.max() - ys.min() + 1) * (xs.max() - xs.min() + 1)) / float(H * W)
    subject_present = content >= MON_CONTENT_MIN
    not_full_bleed = content <= MON_CONTENT_MAX
    has_white_bg = white_frac >= MON_WHITE_MIN
    metrics = _round_metrics({
        "image_alpha_coverage": content,
        "white_bg_fraction": white_frac,
        "subject_bbox_fill": bbox_fill,
    })
    checks = [
        {"name": "subject_present", "ok": bool(subject_present), "value": round(content, 6),
         "threshold": ">= %.2f" % MON_CONTENT_MIN},
        {"name": "not_full_bleed", "ok": bool(not_full_bleed), "value": round(content, 6),
         "threshold": "<= %.2f" % MON_CONTENT_MAX},
        {"name": "has_white_background", "ok": bool(has_white_bg), "value": round(white_frac, 6),
         "threshold": ">= %.2f" % MON_WHITE_MIN},
    ]
    ok = subject_present and not_full_bleed and has_white_bg
    notes = ["monster.render_sanity FRESH kit -- thresholds implementer-proposed, "
             "pending user S7 ratification on real renders."]
    if not ok:
        notes.append("WARN checks: " + ", ".join(c["name"] for c in checks if not c["ok"]))
    return {"verdict": "PASS" if ok else "WARN", "metrics": metrics,
            "checks": checks, "notes": notes}


# =====================================================================
# si.subject_frame -- FRESH (cell kits cannot serve SI: no shape). Single
# centered subject + margin for 256x256 SIs. advisory: PASS/WARN. S7-pending.
# =====================================================================
def kit_si_subject_frame(ctx):
    from scipy import ndimage
    arr = np.array(_load_rgba(ctx["png_path"]))
    H, W = arr.shape[:2]
    subject = _subject_mask(arr)
    content = float(subject.sum()) / subject.size
    # single-subject: largest connected component fraction of the subject
    lab, n = ndimage.label(subject)
    if n == 0:
        largest_frac = 0.0
        center_off = 1.0
        margin = 0.0
    else:
        sizes = ndimage.sum(subject, lab, range(1, n + 1))
        largest_frac = float(sizes.max()) / max(float(subject.sum()), 1.0)
        ys, xs = np.where(subject)
        cy, cx = ys.mean(), xs.mean()
        # centroid offset from canvas center, as a fraction of the half-diagonal
        half_diag = 0.5 * float(np.hypot(H, W))
        center_off = float(np.hypot(cy - H / 2.0, cx - W / 2.0)) / max(half_diag, 1.0)
        margin = float(min(ys.min(), H - 1 - ys.max(), xs.min(), W - 1 - xs.max())) / float(min(H, W))
    subject_present = SI_CONTENT_MIN <= content <= SI_CONTENT_MAX
    single_subject = largest_frac >= SI_SINGLE_MIN
    centered = center_off <= SI_CENTER_MAX
    margin_present = margin >= SI_MARGIN_MIN
    metrics = _round_metrics({
        "image_alpha_coverage": content,
        "largest_component_frac": largest_frac,
        "centroid_offset": center_off,
        "subject_margin_frac": margin,
    })
    checks = [
        {"name": "subject_present", "ok": bool(subject_present), "value": round(content, 6),
         "threshold": "%.2f .. %.2f" % (SI_CONTENT_MIN, SI_CONTENT_MAX)},
        {"name": "single_subject", "ok": bool(single_subject), "value": round(largest_frac, 6),
         "threshold": ">= %.2f" % SI_SINGLE_MIN},
        {"name": "centered", "ok": bool(centered), "value": round(center_off, 6),
         "threshold": "<= %.2f" % SI_CENTER_MAX},
        {"name": "margin_present", "ok": bool(margin_present), "value": round(margin, 6),
         "threshold": ">= %.2f" % SI_MARGIN_MIN},
    ]
    ok = subject_present and single_subject and centered and margin_present
    notes = ["si.subject_frame FRESH kit -- thresholds implementer-proposed, "
             "pending user S7 ratification on real renders."]
    if not ok:
        notes.append("WARN checks: " + ", ".join(c["name"] for c in checks if not c["ok"]))
    return {"verdict": "PASS" if ok else "WARN", "metrics": metrics,
            "checks": checks, "notes": notes}


KITS = {
    "bpskin.frame_gate": kit_bpskin_frame_gate,
    "matte.coverage_band": kit_matte_coverage_band,
    "po.cell_packing": kit_po_cell_packing,
    "tiling.seam": kit_tiling_seam,
    "monster.render_sanity": kit_monster_render_sanity,
    "si.subject_frame": kit_si_subject_frame,
}


def _registry():
    with open(os.path.join(HERE, "inspect_kits.json"), encoding="utf-8") as f:
        return json.load(f)["kits"]


def kit_version(kit_id):
    for k in _registry():
        if k["kit_id"] == kit_id:
            return k["kit_version"]
    return None


def run_kit(kit_id, ctx):
    """Dispatch one kit by id -> {verdict, metrics, checks, notes}. Raises
    KeyError for an unknown kit_id (the runner turns that into a failed row)."""
    fn = KITS[kit_id]
    return fn(ctx)
