# -*- coding: utf-8 -*-
"""
tool_icon_score.py -- Mechanical fit-based candidate icon scoring (REQ-0073).

IMPORTS tools/tool_fit_check.py (REQ-0020 reference port) as a module. Does
NOT fork, copy, or reimplement any of that tool's ported algorithms (build_
region_from_layout, load_content, scaled, find_placement, max_scale, solve,
rotate_mask, solve_any_angle, render_reference) -- every geometric decision
(allowed-region construction, max-scale/orientation search, placement
selection) comes directly from calling tool_fit_check's own functions,
exactly like tools/build_fit_report.py already does for the CHECK/FIX
report. See that file for the established "import as fit, never fork"
pattern this script follows.

Purpose (REQ-0073 goal 3): given AI-generated candidate icon PNGs (RGBA,
alpha channel = subject silhouette) for an item, mechanically score how well
each candidate fits the item's cell shape AFTER running it through the fit
tool's own transform search (solve() -- 4 rotations x 2 flips, max scale).
This is explicitly GEOMETRY ONLY. Per user directive there is NO aesthetic
term anywhere in the score -- composition, color, subject quality, style-
guide adherence, etc. are all out of scope for this tool. A photorealistic
render of the wrong subject and a scribble both get scored purely on how
well their alpha silhouette packs into the allowed cell region.

Reused tool_fit_check functions (exact signatures, see that module for full
docs):
    shape_to_cellset(shape) -> (cellset, rows, cols)
        Normalizes a [[row,col],...] cell list (same convention for both the
        live "shape" field and REQ-0073's new "gen_render.cells" field) into
        a 0-indexed, bbox-normalized {(row,col)} set.
    build_region(cellset) -> allowed (bool HxW at CELL=100 px/cell)
        Allowed-region mask (owned cells minus the no-contact pad on every
        face with no owned neighbor), sized exactly to the cellset's bbox.
    crop_to_content(mask) -> mask
        Bbox-crops a boolean mask down to its content extent (used here on
        our own alpha-derived mask, exactly as tool_fit_check itself already
        uses it on rasterize_symbol()'s alpha mask in fix_icon()).
    solve(allowed, content) -> dict(scale, rot, flip, pos, mask) or None
        Full 8-orientation (4 rotations x 2 flips) max-scale search.
    solve_any_angle(allowed, content, ...) -> dict(scale, deg, flip, pos, mask) or None
        Arbitrary-angle variant (--any-angle flag on this tool).
    scaled(mask, s) -> mask
        Nearest/bilinear-safe rescale (>=1px coverage counts as content).
    centered_position(allowed, kern) -> (y, x) or None
        Placement-selection policy (REQ-0023): re-enumerates solve()'s own
        feasible-position set for the already-chosen scale/rot/flip kernel
        and picks the one closest to the allowed region's centroid. Used
        here exactly like build_fit_report/fix_icon use it: solve() finds
        the orientation/scale, centered_position() finds where the final
        art actually gets placed for rendering/scoring purposes.
    render(allowed, cellset, mask, scale, pos, out_path)
        Writes the fitted-placement visualization PNG (white cells / pink
        pads / dark content / blue grid) -- used for --render-dir output.

NOT reused from tool_fit_check (deliberately): fix_icon()'s art_golden v3.3
policy guard, which refuses (escalates) any solve() result requiring a
nonzero rotation or flip. That guard exists for the live-sprite-editing
workflow, where existing hand-drawn SVG art must never be silently rotated/
flipped out from under the artist. It does NOT apply here: AI candidates are
freshly generated raster images with no prior "canonical orientation" to
preserve, and the REQ-0073 spec explicitly asks for the full 4-rotation x
2-flip search to count toward the score (a candidate that only fits after a
90-degree rotation is still a geometrically valid fit for scoring purposes).
So this tool calls solve()/solve_any_angle() directly and scores whatever
orientation they find, without fix_icon's escalation wrapper.

Content mask (alpha path): candidates are RGBA PNGs whose alpha channel IS
the subject silhouette (background matted to alpha=0, see tools/matte_
transparent.py). tool_fit_check.load_content() is NOT used for this, even
though the module docstring above describes it as "the raster content-mask
loader" -- load_content() does `Image.open(path).convert('L')` and
thresholds on grayscale value; PIL's RGBA->L conversion drops the alpha
channel entirely and computes luminance from RGB only (confirmed: an RGBA
pixel (0,0,0,0) -- fully transparent, RGB happens to be black -- converts to
L=0, which is BELOW load_content's gray<128 "is content" threshold, i.e. it
would be wrongly counted as content). load_content is correct for its own
designed input (scanned/photographed raster images with a light background
and no alpha channel at all), but silently wrong for alpha-matted PNGs with
dark-RGB transparent regions, which is an ordinary, expected shape for
matted output. So content extraction here reads the alpha channel directly
(`alpha > 0`) -- the exact same alpha-thresholding convention tool_fit_
check.py's OWN rasterize_symbol() already uses internally for SVG symbols
("alpha = arr[:,:,3]; return alpha > 0") -- and then reuses tool_fit_check's
own crop_to_content() (unchanged import, not forked) to bbox-crop it. This
is a project-specific input adapter, exactly the same category as
tool_fit_check's own build_region()/shape_to_cellset() adaptations (per that
module's docstring taxonomy of "reference-parity" vs "our adaptations");
it is not a fork of any ported algorithm.

SCORE (deterministic; every constant below is the complete set, tune here
only):

    WEIGHT_SCALE = 0.35
    WEIGHT_COVERAGE = 0.50
    WEIGHT_UNIFORMITY = 0.15

    if solve() (or solve_any_angle()) returns no feasible placement:
        score = 0.0
    else:
        score = 100 * (WEIGHT_SCALE * scale_term
                        + WEIGHT_COVERAGE * coverage_term
                        + WEIGHT_UNIFORMITY * uniformity_term)

    scale_term = min(1.0, achieved_scale / reference_scale)
        achieved_scale: solve()'s best['scale'] (or best['scale'] from
            solve_any_angle()).
        reference_scale: the scale that would make the (oriented) content
            mask's bbox exactly span the allowed region's bbox, i.e. the
            same upper bound tool_fit_check.max_scale() computes internally
            as `s_hi = min(H/h, W/w)` (that local variable is not exposed by
            the module, so this file recomputes the identical one-line
            formula against the SAME oriented mask shape solve() used --
            best['mask'].shape -- not the original unrotated content shape,
            since rotation by +/-90 swaps h/w and would otherwise make the
            ratio meaningless). scale_term saturates at 1.0: a candidate
            that could be scaled up beyond exactly spanning the allowed
            bbox gets no extra credit past "fills it exactly".

    coverage_term = mean per-owned-cell coverage at the fitted placement.
        Per-cell coverage uses the exact same formula tool_fit_check.
        check_icon() already uses for its (informational) coverage field --
        "content px in cell / cell px" -- applied here to the SOLVED
        placement instead of check_icon's natural/live placement: the
        oriented+scaled content mask (fit.scaled(best['mask'], best['scale']))
        is embedded into a zeroed (H,W) canvas at centered_position()'s
        chosen (y,x) (same embed-into-full-canvas technique build_fit_
        report.render_with_overflow_highlight already uses for its own,
        different, overflow-highlight purpose), then coverage is measured
        per owned cell against that canvas. coverage_term is the mean across
        owned cells, each expressed as a fraction in [0,1] (not the 0-100
        percent check_icon() reports -- rescaled here since it directly
        feeds the weighted score).

    uniformity_term = 1 - normalized_std(per_cell_coverage_fractions)
        normalized_std = std(coverage_fractions) clamped to [0,1]. Each
        coverage_fraction already lives in [0,1], so its population std is
        bounded above by 0.5 (the max-spread two-point case: one cell at
        1.0, another at 0.0); using that natural [0,1]-bounded std directly
        (instead of a coefficient-of-variation std/mean, which blows up or
        is undefined whenever mean coverage is near 0) keeps this term
        always defined and monotonic: identical coverage across every owned
        cell -> std=0 -> uniformity_term=1.0 (also the single-owned-cell
        case, where std of a length-1 sample is 0 by definition -- "1.0 when
        single cell" per spec, satisfied as a natural consequence of this
        formula, not a special-cased branch). Maximally uneven two-cell
        coverage (one cell entirely full, another entirely empty) ->
        std=0.5 -> uniformity_term=0.5.

Winner per item = argmax(score) over its candidates; ties -> lower candidate
index (stable sort on (-score, candidate_index)).

CLI:
    tool_icon_score.py
        [--defs content/live/live_items.json]
        [--candidates-dir content/batches/batch-003-item-icons/candidates]
        [--pattern "<id>_c*_alpha.png"]
        [--out content/batches/batch-003-item-icons/scores.json]
        [--render-dir content/batches/batch-003-item-icons/fit_renders]
        [--select-dir DIR]      (optional: copy winning candidate per item to
                                 <select-dir>/<id>.png)
        [--any-angle]           (use solve_any_angle() instead of solve())

Each defs entry needs an "id" and either a "gen_render" object (REQ-0073;
{"cells": [[row,col],...], ...} -- same [row,col] convention as "shape", see
tool_fit_check.shape_to_cellset's own docstring for the engine-convention
citation) or a plain "shape" field (falls back to it if gen_render/cells is
absent, so this tool also works against pre-REQ-0073 defs for testing).
Entries with neither are skipped (reported, not fatal).

--pattern is a glob (not regex) evaluated inside --candidates-dir with "<id>"
substituted for the entry's id, e.g. "beast_jaw_c*_alpha.png" matches
beast_jaw_c0_s12345_alpha.png, beast_jaw_c1_s67890_alpha.png, etc. Candidates
are processed in sorted-filename order; that sort order is the "candidate
index" used for the argmax tie-break (lower index wins ties).

Output scores.json:
{
  "generated": "<ISO timestamp>",
  "provenance": "tool_icon_score.py -- REQ-0073, imports tool_fit_check.py (REQ-0020)",
  "weights": {"scale": 0.35, "coverage": 0.50, "uniformity": 0.15},
  "any_angle": false,
  "items": {
    "<item_id>": {
      "candidates": [
        {"file": ..., "feasible": true, "scale": ..., "rot": 90, "flip": false,
         "pos": [y, x], "per_cell_coverage": [...], "terms": {"scale_term":...,
         "coverage_term":..., "uniformity_term":...}, "score": ...},
        ...
      ],
      "winner": {"file": ..., "candidate_index": 0, "score": ...} or null
    },
    ...
  }
}
"""
import os
import sys
import glob
import json
import shutil
import argparse
import datetime

import numpy as np
from PIL import Image

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, TOOLS_DIR)

import tool_fit_check as fit  # noqa: E402  (import as module -- do not fork its logic)

# ---------------------------------------------------------------------
# Score weights (SCORE constants -- the complete set; tune only here).
# ---------------------------------------------------------------------
WEIGHT_SCALE = 0.35
WEIGHT_COVERAGE = 0.50
WEIGHT_UNIFORMITY = 0.15
assert abs((WEIGHT_SCALE + WEIGHT_COVERAGE + WEIGHT_UNIFORMITY) - 1.0) < 1e-9

DEFAULT_DEFS = os.path.join(PROJECT_ROOT, "content", "live", "live_items.json")
DEFAULT_CANDIDATES_DIR = os.path.join(
    PROJECT_ROOT, "content", "batches", "batch-003-item-icons", "candidates")
DEFAULT_PATTERN = "<id>_c*_alpha.png"
DEFAULT_OUT = os.path.join(
    PROJECT_ROOT, "content", "batches", "batch-003-item-icons", "scores.json")
DEFAULT_RENDER_DIR = os.path.join(
    PROJECT_ROOT, "content", "batches", "batch-003-item-icons", "fit_renders")

TOOL_PROVENANCE = "tool_icon_score.py -- REQ-0073, imports tool_fit_check.py (REQ-0020)"


# ---------------------------------------------------------------------
# Content mask (alpha path) -- project-specific adapter, NOT a fork of
# tool_fit_check.load_content (see module docstring "Content mask (alpha
# path)" section for why load_content itself is unsafe for RGBA input).
# Composes tool_fit_check.crop_to_content (unchanged import) with the same
# `alpha > 0` thresholding tool_fit_check.rasterize_symbol already uses
# internally for SVG symbols.
# ---------------------------------------------------------------------
def load_content_alpha(path):
    """RGBA PNG -> boolean content mask, alpha>0, bbox-cropped via
    tool_fit_check.crop_to_content. NOTE on the all-transparent case:
    crop_to_content's own implementation is `ys, xs = np.where(mask); if
    len(ys) == 0: return mask` -- i.e. when there is NO content at all, it
    deliberately returns the ORIGINAL, uncropped, all-False mask unchanged
    (verified by reading that function; it does NOT return a (0,0) array).
    So callers MUST check emptiness via `not mask.any()`, never
    `mask.size == 0` -- see score_candidate(), which does this correctly.
    This docstring previously (incorrectly) claimed a (0,0)-shape return
    for the empty case; corrected after that assumption was caught by this
    tool's own synthetic-empty-alpha validation test."""
    img = Image.open(path).convert("RGBA")
    alpha = np.array(img)[:, :, 3]
    mask = alpha > 0
    return fit.crop_to_content(mask)


# ---------------------------------------------------------------------
# Cell-list resolution: prefer gen_render.cells (REQ-0073), fall back to
# the plain "shape" field (same [row,col] convention, see tool_fit_check.
# shape_to_cellset) so this tool also runs against pre-REQ-0073 defs.
# ---------------------------------------------------------------------
def resolve_cells(entry):
    gen_render = entry.get("gen_render")
    if gen_render and gen_render.get("cells"):
        return gen_render["cells"], "gen_render.cells"
    if entry.get("shape"):
        return entry["shape"], "shape"
    return None, None


# ---------------------------------------------------------------------
# Per-cell coverage at a solved placement -- same "content px in cell /
# cell px" formula tool_fit_check.check_icon() already uses for its own
# (informational) coverage field, applied here to the SOLVED placement
# (oriented+scaled mask embedded at centered_position()'s chosen (y,x))
# instead of check_icon's natural/live (scale=1, pos=(0,0)) placement.
# Fractions in [0,1], not the 0-100 percent check_icon() reports.
# ---------------------------------------------------------------------
def per_cell_coverage_fractions(allowed, cellset, mask, scale, pos):
    H, W = allowed.shape
    placed = fit.scaled(mask, scale) if scale != 1.0 else mask
    y, x = pos
    full = np.zeros((H, W), bool)
    ph, pw = placed.shape
    ph = min(ph, H - y)
    pw = min(pw, W - x)
    full[y:y + ph, x:x + pw] = placed[:ph, :pw]

    CELL = fit.CELL
    coverages = []
    for (r, c) in sorted(cellset):
        cell_content = full[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]
        coverages.append(float(cell_content.sum()) / (CELL * CELL))
    return coverages, full


def score_terms(allowed, best, cellset, any_angle):
    """best: solve()/solve_any_angle() result dict (scale, mask, pos, and
    either rot+flip or deg+flip). Returns (per_cell_coverage, terms, score,
    placed_full_canvas_mask)."""
    H, W = allowed.shape
    oriented_mask = best["mask"]
    h, w = oriented_mask.shape
    achieved_scale = best["scale"]

    # reference_scale: same s_hi = min(H/h, W/w) upper bound tool_fit_check.
    # max_scale() computes internally, recomputed here (not exposed by that
    # module) against the SAME oriented mask shape achieved_scale used.
    reference_scale = min(H / h, W / w)
    scale_term = min(1.0, achieved_scale / reference_scale)

    pos_first_yx = tuple(best["pos"])
    placed_kernel = fit.scaled(oriented_mask, achieved_scale)
    pos_centered_yx = fit.centered_position(allowed, placed_kernel) or pos_first_yx

    coverages, full = per_cell_coverage_fractions(
        allowed, cellset, oriented_mask, achieved_scale, pos_centered_yx)

    coverage_term = float(np.mean(coverages)) if coverages else 0.0

    if len(coverages) <= 1:
        uniformity_term = 1.0
    else:
        std = float(np.std(coverages))
        uniformity_term = 1.0 - min(1.0, max(0.0, std))

    score = 100.0 * (WEIGHT_SCALE * scale_term
                      + WEIGHT_COVERAGE * coverage_term
                      + WEIGHT_UNIFORMITY * uniformity_term)

    terms = dict(
        scale_term=scale_term,
        coverage_term=coverage_term,
        uniformity_term=uniformity_term,
        reference_scale=reference_scale,
    )

    result = dict(
        feasible=True,
        scale=achieved_scale,
        pos=[int(pos_centered_yx[0]), int(pos_centered_yx[1])],
        pos_first=[int(pos_first_yx[0]), int(pos_first_yx[1])],
        per_cell_coverage=[round(c, 4) for c in coverages],
        terms={k: round(v, 4) for k, v in terms.items()},
        score=round(score, 2),
    )
    if any_angle:
        result["rot"] = None
        result["deg"] = round(best["deg"], 2)
        result["flip"] = bool(best["flip"])
    else:
        result["rot"] = int(best["rot"])
        result["deg"] = None
        result["flip"] = bool(best["flip"])

    return result, oriented_mask, achieved_scale, pos_centered_yx


def infeasible_result(reason):
    return dict(
        feasible=False, reason=reason, scale=None, rot=None, deg=None, flip=None,
        pos=None, pos_first=None, per_cell_coverage=[],
        terms=dict(scale_term=0.0, coverage_term=0.0, uniformity_term=0.0),
        score=0.0,
    )


# ---------------------------------------------------------------------
# Per-candidate scoring
# ---------------------------------------------------------------------
def score_candidate(path, allowed, cellset, any_angle=False):
    content = load_content_alpha(path)
    # Must check `not content.any()`, NOT `content.size == 0`: tool_fit_
    # check.crop_to_content() returns the ORIGINAL (uncropped, full-size)
    # all-False mask when there's no content at all, never a (0,0) array
    # (see load_content_alpha's docstring). A size-only check would let an
    # all-transparent candidate silently reach solve() as an all-False
    # kernel, which trivially "fits" everywhere (nothing to collide with)
    # and would misreport as a feasible, average-scoring candidate instead
    # of the EMPTY_CONTENT case it actually is.
    if content.size == 0 or not content.any():
        return infeasible_result("EMPTY_CONTENT (no non-transparent alpha pixels)")

    if any_angle:
        best = fit.solve_any_angle(allowed, content)
    else:
        best = fit.solve(allowed, content)

    if best is None:
        return infeasible_result("INFEASIBLE (solve() found no placement at any scale/orientation)")

    result, oriented_mask, achieved_scale, pos_centered_yx = score_terms(
        allowed, best, cellset, any_angle)
    result["_oriented_mask"] = oriented_mask
    result["_achieved_scale"] = achieved_scale
    result["_pos_centered_yx"] = pos_centered_yx
    return result


def score_item(entry, candidates_dir, pattern, render_dir=None, any_angle=False):
    eid = entry.get("id")
    cells, cells_source = resolve_cells(entry)
    if cells is None:
        return dict(id=eid, status="SKIPPED",
                     reason="no gen_render.cells or shape field on this entry")

    cellset, rows, cols = fit.shape_to_cellset(cells)
    allowed = fit.build_region(cellset)

    glob_pattern = pattern.replace("<id>", eid)
    paths = sorted(glob.glob(os.path.join(candidates_dir, glob_pattern)))

    if not paths:
        return dict(id=eid, status="SKIPPED",
                     reason=f"no candidate files matched '{glob_pattern}' in {candidates_dir}")

    candidates = []
    best_idx = None
    best_score = None
    for idx, path in enumerate(paths):
        r = score_candidate(path, allowed, cellset, any_angle=any_angle)
        render_path = None
        if render_dir and r["feasible"]:
            os.makedirs(render_dir, exist_ok=True)
            render_path = os.path.join(render_dir, f"{eid}_c{idx}_fit.png")
            fit.render(allowed, cellset, r["_oriented_mask"], r["_achieved_scale"],
                       r["_pos_centered_yx"], render_path)
            render_path = os.path.relpath(render_path, PROJECT_ROOT)

        out = dict(
            file=os.path.relpath(path, PROJECT_ROOT),
            feasible=r["feasible"],
            scale=r["scale"],
            rot=r["rot"],
            deg=r["deg"],
            flip=r["flip"],
            pos=r["pos"],
            per_cell_coverage=r["per_cell_coverage"],
            terms=r["terms"],
            score=r["score"],
        )
        if not r["feasible"]:
            out["reason"] = r["reason"]
        if render_path:
            out["render"] = render_path
        candidates.append(out)

        # argmax with "ties -> lower candidate index": since idx increases
        # monotonically and we only replace on STRICT improvement, the first
        # candidate to reach the max score is kept on a tie.
        if best_score is None or out["score"] > best_score:
            best_score = out["score"]
            best_idx = idx

    winner = None
    if best_idx is not None:
        winner = dict(file=candidates[best_idx]["file"], candidate_index=best_idx,
                      score=candidates[best_idx]["score"])

    return dict(id=eid, status="SCORED", cells_source=cells_source,
                 candidates=candidates, winner=winner)


# ---------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------
def load_entries(defs_path):
    return fit.load_defs(defs_path)


def main():
    ap = argparse.ArgumentParser(
        description="Mechanically score AI-generated candidate icon PNGs against their "
                    "item's cell shape via tool_fit_check's solve() (REQ-0073). Geometry "
                    "only -- no aesthetic judgement.")
    ap.add_argument("--defs", default=DEFAULT_DEFS,
                    help=f"defs JSON (entries[] with id/shape/gen_render) (default: {DEFAULT_DEFS})")
    ap.add_argument("--candidates-dir", default=DEFAULT_CANDIDATES_DIR,
                    help=f"directory containing candidate PNGs (default: {DEFAULT_CANDIDATES_DIR})")
    ap.add_argument("--pattern", default=DEFAULT_PATTERN,
                    help=f'glob pattern with "<id>" placeholder (default: "{DEFAULT_PATTERN}")')
    ap.add_argument("--out", default=DEFAULT_OUT,
                    help=f"output scores JSON path (default: {DEFAULT_OUT})")
    ap.add_argument("--render-dir", default=DEFAULT_RENDER_DIR,
                    help=f"directory to write fitted-placement render PNGs (default: {DEFAULT_RENDER_DIR})")
    ap.add_argument("--select-dir", default=None,
                    help="optional: copy the winning candidate per item here as <id>.png")
    ap.add_argument("--any-angle", action="store_true",
                    help="use solve_any_angle() (arbitrary rotation) instead of solve() (4x90deg x flip)")
    args = ap.parse_args()

    entries = load_entries(args.defs)

    items = {}
    n_scored = n_skipped = 0
    for entry in entries:
        eid = entry.get("id")
        if not eid:
            continue
        r = score_item(entry, args.candidates_dir, args.pattern,
                        render_dir=args.render_dir, any_angle=args.any_angle)
        if r["status"] == "SKIPPED":
            n_skipped += 1
            items[eid] = r
            continue

        n_scored += 1
        items[eid] = r

        if args.select_dir and r["winner"]:
            os.makedirs(args.select_dir, exist_ok=True)
            src = os.path.join(PROJECT_ROOT, r["winner"]["file"])
            dst = os.path.join(args.select_dir, f"{eid}.png")
            shutil.copyfile(src, dst)
            r["winner"]["selected_to"] = os.path.relpath(dst, PROJECT_ROOT)

    out_doc = dict(
        generated=datetime.datetime.now().isoformat(),
        provenance=TOOL_PROVENANCE,
        weights=dict(scale=WEIGHT_SCALE, coverage=WEIGHT_COVERAGE, uniformity=WEIGHT_UNIFORMITY),
        any_angle=bool(args.any_angle),
        items=items,
    )

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out_doc, f, indent=2, ensure_ascii=False)

    print(f"Wrote {args.out}")
    print(f"scored={n_scored} skipped={n_skipped}")
    for eid, r in items.items():
        if r["status"] == "SKIPPED":
            print(f"  SKIPPED {eid:24s} {r['reason']}")
        else:
            w = r["winner"]
            wtxt = f"winner={w['file']} score={w['score']:.2f}" if w else "winner=None"
            print(f"  SCORED  {eid:24s} candidates={len(r['candidates'])} {wtxt}")


if __name__ == "__main__":
    main()
