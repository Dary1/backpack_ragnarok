#!/usr/bin/env python3
"""
tools/build_batch003_report.py -- batch-003 item-icon report page builder (REQ-0073).

Deterministic report/build script, same "read results, render static HTML"
pattern as tools/build_fit_report.py, but for the REQ-0073 AI-icon-generation
route rather than the live-SVG fit-check route. This script does NOT import
tool_fit_check.py or tool_icon_score.py and does NOT recompute anything --
every number shown (score, per-term breakdown, feasible flag, chosen
rot/flip/scale) is read verbatim from the already-produced
content/batches/batch-003-item-icons/scores.json (written by
tools/tool_icon_score.py). This script only reads existing artifacts, copies
image files into a self-contained web/preview/batch-003/ directory, and
renders index.html. It never touches live_items.json, gen_item_icons.py,
tool_icon_score.py, or any monster/footprint/proposal content.

Inputs (read-only):
    content/live/live_items.json                          (id/name/i18n/shape)
    content/batches/batch-003-item-icons/scores.json       (scores + winners)
    content/batches/batch-003-item-icons/candidates/       (raw + _alpha PNGs)
    content/batches/batch-003-item-icons/fit_renders/      (fitted-placement PNGs)
    content/batches/batch-003-item-icons/selected/         (winning PNG per item)

Output (fully self-contained; only files this script writes):
    web/preview/batch-003/index.html
    web/preview/batch-003/img/candidates/...   (copied raw + _alpha PNGs)
    web/preview/batch-003/img/fit_renders/...  (copied fit-render PNGs)
    web/preview/batch-003/img/selected/...     (copied winner PNGs)

All <img src="..."> in the generated page are relative paths into that same
img/ subtree -- no CDN, no absolute host paths, so the directory can be
copied/served standalone (per REQ-0073 report goal).

Usage (run under the project venv):
    ~/backpack_ragnarok/.venv/bin/python tools/build_batch003_report.py

No CLI args: paths are fixed project-relative constants (see CONFIG below),
matching tools/build_fit_report.py's own no-args convention.
"""
import os
import sys
import json
import shutil
import datetime

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(TOOLS_DIR)

# ---------------------------------------------------------------------
# CONFIG -- fixed project-relative paths (REQ-0073 batch-003 layout).
# ---------------------------------------------------------------------
DEFS_PATH = os.path.join(PROJECT_ROOT, "content", "live", "live_items.json")
BATCH_DIR = os.path.join(PROJECT_ROOT, "content", "batches", "batch-003-item-icons")
SCORES_PATH = os.path.join(BATCH_DIR, "scores.json")
CANDIDATES_DIR = os.path.join(BATCH_DIR, "candidates")
FIT_RENDERS_DIR = os.path.join(BATCH_DIR, "fit_renders")
SELECTED_DIR = os.path.join(BATCH_DIR, "selected")

OUT_DIR = os.path.join(PROJECT_ROOT, "web", "preview", "batch-003")
IMG_CANDIDATES_DIR = os.path.join(OUT_DIR, "img", "candidates")
IMG_FIT_RENDERS_DIR = os.path.join(OUT_DIR, "img", "fit_renders")
IMG_SELECTED_DIR = os.path.join(OUT_DIR, "img", "selected")

# Relative path from web/preview/batch-003/index.html up to the project-root
# docs/ file (three levels up: batch-003 -> preview -> web -> root), so the
# link actually resolves both when this directory is opened locally and when
# served from a document root that mirrors the repo layout.
SPEC_LINK = "../../../docs/REQ-0073-item-icon-gen.md"

# Generation constants (REQ-0073 batch-003 job parameters). These are fixed,
# documented facts about how the batch was generated -- read from the spec /
# tools/gen_item_icons.py header, not invented. If the generation script's
# own constants ever change, update these two lines to match.
MODEL_NAME = "JuggernautXL_RunDiffusionPhoto2_V9_Final"
SEEDS = [101, 202, 303, 404]

# Score weights are READ from scores.json's own "weights" field at runtime
# (never hardcoded here) so this report can never silently drift out of
# sync with tools/tool_icon_score.py's real WEIGHT_SCALE/WEIGHT_COVERAGE/
# WEIGHT_UNIFORMITY constants -- see load_scores() / header_html().

TOOL_PROVENANCE = ("tools/build_batch003_report.py -- REQ-0073 batch-003 report; "
                    "reads tools/tool_icon_score.py's scores.json verbatim, "
                    "recomputes nothing")


# ---------------------------------------------------------------------
# HTML escaping (same minimal helper as build_fit_report.py)
# ---------------------------------------------------------------------
def esc(s):
    if s is None:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


# ---------------------------------------------------------------------
# Load defs (id -> name/i18n/shape), read-only.
# ---------------------------------------------------------------------
def load_item_defs(defs_path):
    with open(defs_path, encoding="utf-8") as f:
        data = json.load(f)
    entries = data.get("entries", []) if isinstance(data, dict) else data
    by_id = {}
    for e in entries:
        eid = e.get("id")
        if eid:
            by_id[eid] = e
    return by_id


def item_name_en(entry):
    return entry.get("name") or entry.get("id")


def item_name_ja(entry):
    i18n = entry.get("i18n") or {}
    ja = i18n.get("ja") or {}
    return ja.get("name")


def item_cells(entry):
    """[row,col] cell list -- prefer gen_render.cells (REQ-0073), fall back
    to the plain shape field, same resolution order tool_icon_score.py's own
    resolve_cells() uses (see that module) -- this mirrors that fallback for
    display purposes only, does not affect scoring."""
    gen_render = entry.get("gen_render") or {}
    if gen_render.get("cells"):
        return gen_render["cells"]
    return entry.get("shape") or []


def cells_to_bbox_grid(cells):
    """[row,col] cells -> (rows, cols, owned-set normalized to origin, in
    (row,col) form) for the mini shape diagram. Same [row,col] convention
    used throughout this project (tool_fit_check.shape_to_cellset,
    tools/build_preview.py's shape_bbox_cells) -- REQ-0029."""
    if not cells:
        return 0, 0, set()
    rows = [r for r, c in cells]
    cols = [c for r, c in cells]
    r0, c0 = min(rows), min(cols)
    owned = {(r - r0, c - c0) for r, c in cells}
    return (max(rows) - r0 + 1), (max(cols) - c0 + 1), owned


# ---------------------------------------------------------------------
# Load scores.json (read-only; every number in the report comes from here).
# ---------------------------------------------------------------------
def load_scores(scores_path):
    with open(scores_path, encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------------
# File copying -- build a self-contained img/ tree under OUT_DIR. Every
# copy target path is returned so the HTML renderer can emit relative
# <img src="..."> paths without ever touching an absolute/CDN URL.
# ---------------------------------------------------------------------
def reset_out_dirs():
    """Deterministic rebuild: wipe only the img/ subtree this script owns,
    never the whole OUT_DIR (index.html gets overwritten in place below;
    no other files under web/preview/batch-003/ are touched)."""
    for d in (IMG_CANDIDATES_DIR, IMG_FIT_RENDERS_DIR, IMG_SELECTED_DIR):
        if os.path.isdir(d):
            shutil.rmtree(d)
        os.makedirs(d, exist_ok=True)


def copy_candidate_images(item_id, candidate_file_rel):
    """candidate_file_rel: path from scores.json's candidates[].file field,
    project-root-relative -- tool_icon_score.py's --pattern is "<id>_c*_
    alpha.png" (see that tool's DEFAULT_PATTERN / score_item()'s glob), so
    this IS the already-matted _alpha PNG (e.g. 'content/batches/batch-003-
    item-icons/candidates/blade_c1_s101_alpha.png'), NOT the plain raw file
    -- confirmed against a live scores.json entry. The sibling RAW PNG
    (same stem with the trailing '_alpha' REMOVED) lives alongside it in
    the same candidates/ directory (see tools/gen_item_icons.py, which
    writes both '<id>_c<k>_s<seed>.png' (raw) and '<id>_c<k>_s<seed>_
    alpha.png' (matted) per candidate). Copies BOTH into img/candidates/.
    Returns (raw_rel_src_or_None, alpha_rel_src) -- paths relative to
    OUT_DIR for use as <img src>."""
    alpha_abs = os.path.join(PROJECT_ROOT, candidate_file_rel)
    alpha_name = os.path.basename(alpha_abs)
    alpha_dst = os.path.join(IMG_CANDIDATES_DIR, alpha_name)
    if not os.path.isfile(alpha_dst):
        shutil.copyfile(alpha_abs, alpha_dst)
    alpha_rel = os.path.relpath(alpha_dst, OUT_DIR).replace(os.sep, "/")

    stem, ext = os.path.splitext(alpha_name)
    if not stem.endswith("_alpha"):
        # Defensive fallback (shouldn't happen given the pattern above):
        # if this ever isn't an _alpha file, there's no raw sibling to find.
        return None, alpha_rel
    raw_stem = stem[: -len("_alpha")]
    raw_name = f"{raw_stem}{ext}"
    raw_abs = os.path.join(os.path.dirname(alpha_abs), raw_name)
    raw_rel = None
    if os.path.isfile(raw_abs):
        raw_dst = os.path.join(IMG_CANDIDATES_DIR, raw_name)
        if not os.path.isfile(raw_dst):
            shutil.copyfile(raw_abs, raw_dst)
        raw_rel = os.path.relpath(raw_dst, OUT_DIR).replace(os.sep, "/")

    return raw_rel, alpha_rel


def copy_fit_render(render_file_rel):
    """render_file_rel: scores.json candidates[].render field (project-root-
    relative), or None if this candidate was infeasible (no render written).
    Returns rel-to-OUT_DIR src, or None."""
    if not render_file_rel:
        return None
    src_abs = os.path.join(PROJECT_ROOT, render_file_rel)
    if not os.path.isfile(src_abs):
        return None
    name = os.path.basename(src_abs)
    dst = os.path.join(IMG_FIT_RENDERS_DIR, name)
    if not os.path.isfile(dst):
        shutil.copyfile(src_abs, dst)
    return os.path.relpath(dst, OUT_DIR).replace(os.sep, "/")


def copy_selected(item_id):
    """selected/<id>.png -- winner copy tool_icon_score.py's --select-dir
    already produced. Returns rel-to-OUT_DIR src, or None if missing."""
    src_abs = os.path.join(SELECTED_DIR, f"{item_id}.png")
    if not os.path.isfile(src_abs):
        return None
    dst = os.path.join(IMG_SELECTED_DIR, f"{item_id}.png")
    if not os.path.isfile(dst):
        shutil.copyfile(src_abs, dst)
    return os.path.relpath(dst, OUT_DIR).replace(os.sep, "/")


# ---------------------------------------------------------------------
# Shape mini-diagram (pure CSS grid; [row,col] convention, REQ-0029).
# ---------------------------------------------------------------------
def shape_diagram_html(cells):
    rows, cols, owned = cells_to_bbox_grid(cells)
    if rows == 0 or cols == 0:
        return '<div class="shape-none">n/a</div>'
    cells_html = []
    for r in range(rows):
        for c in range(cols):
            cls = "shape-cell shape-owned" if (r, c) in owned else "shape-cell shape-empty"
            cells_html.append(f'<div class="{cls}"></div>')
    style = f'grid-template-columns: repeat({cols}, 22px); grid-template-rows: repeat({rows}, 22px);'
    return f'<div class="shape-grid" style="{esc(style)}">{"".join(cells_html)}</div>'


# ---------------------------------------------------------------------
# Per-candidate card fragment
# ---------------------------------------------------------------------
def orientation_text(cand):
    """Human-readable chosen rot/flip/scale line, straight from scores.json
    fields (rot, deg, flip, scale) -- no recomputation."""
    if not cand.get("feasible"):
        return None
    scale_pct = cand["scale"] * 100.0 if cand.get("scale") is not None else None
    bits = []
    if cand.get("rot") is not None:
        bits.append(f'rotate {cand["rot"]}&deg;')
    elif cand.get("deg") is not None:
        bits.append(f'rotate {cand["deg"]:.1f}&deg;')
    bits.append(f'flip {cand.get("flip")}')
    if scale_pct is not None:
        bits.append(f'scale {scale_pct:.2f}%')
    return " &middot; ".join(bits)


def terms_html(cand):
    terms = cand.get("terms") or {}
    if not cand.get("feasible"):
        reason = cand.get("reason", "infeasible")
        return f'<div class="terms-infeasible">INFEASIBLE<br/><span class="terms-reason">{esc(reason)}</span></div>'
    scale_t = terms.get("scale_term", 0.0)
    cov_t = terms.get("coverage_term", 0.0)
    uni_t = terms.get("uniformity_term", 0.0)
    return (
        '<div class="terms-grid">'
        f'<div class="term-row"><span class="term-label">scale</span><span class="term-val">{scale_t:.3f}</span></div>'
        f'<div class="term-row"><span class="term-label">coverage</span><span class="term-val">{cov_t:.3f}</span></div>'
        f'<div class="term-row"><span class="term-label">uniformity</span><span class="term-val">{uni_t:.3f}</span></div>'
        '</div>'
    )


def candidate_card_html(item_id, idx, cand, is_winner):
    raw_rel, alpha_rel = copy_candidate_images(item_id, cand["file"])
    fit_rel = copy_fit_render(cand.get("render"))

    raw_img = (f'<img src="{esc(raw_rel)}" alt="{esc(item_id)} candidate {idx} raw" loading="lazy"/>'
               if raw_rel else '<div class="img-missing">no raw</div>')
    alpha_img = (f'<img src="{esc(alpha_rel)}" alt="{esc(item_id)} candidate {idx} alpha" loading="lazy"/>'
                 if alpha_rel else '<div class="img-missing">no alpha</div>')
    fit_img = (f'<img src="{esc(fit_rel)}" alt="{esc(item_id)} candidate {idx} fit render" loading="lazy"/>'
               if fit_rel else '<div class="img-missing">no render (infeasible)</div>')

    winner_badge = '<div class="winner-badge">WINNER</div>' if is_winner else ""
    score = cand.get("score", 0.0)
    feasible_chip = ('<span class="chip chip-feasible">feasible</span>' if cand.get("feasible")
                      else '<span class="chip chip-infeasible">infeasible</span>')
    orient = orientation_text(cand)
    orient_html = f'<div class="cand-orient">{orient}</div>' if orient else ""

    seed = SEEDS[idx] if idx < len(SEEDS) else "?"

    return f'''<div class="cand-card {'cand-winner' if is_winner else ''}">
  {winner_badge}
  <div class="cand-head">
    <span class="cand-idx">c{idx + 1}</span>
    <span class="cand-seed">seed {seed}</span>
    {feasible_chip}
  </div>
  <div class="cand-imgs">
    <div class="cand-img-block"><div class="cand-img-label">raw</div>{raw_img}</div>
    <div class="cand-img-block cand-img-checker"><div class="cand-img-label">alpha</div>{alpha_img}</div>
    <div class="cand-img-block cand-img-dark"><div class="cand-img-label">fit render</div>{fit_img}</div>
  </div>
  <div class="cand-score">{score:.1f}</div>
  {terms_html(cand)}
  {orient_html}
</div>'''


# ---------------------------------------------------------------------
# Per-item card
# ---------------------------------------------------------------------
def item_card_html(item_id, entry, item_score):
    name_en = item_name_en(entry)
    name_ja = item_name_ja(entry)
    cells = item_cells(entry)
    diagram = shape_diagram_html(cells)

    status = item_score.get("status")
    if status == "SKIPPED":
        reason = item_score.get("reason", "")
        return f'''<div class="item-card item-skipped">
  <div class="item-head">
    <div class="item-name-en">{esc(name_en)}</div>
    <div class="item-name-ja">{esc(name_ja) if name_ja else ""}</div>
  </div>
  {diagram}
  <div class="item-skip-reason">SKIPPED: {esc(reason)}</div>
</div>'''

    candidates = item_score.get("candidates", [])
    winner = item_score.get("winner")
    winner_idx = winner["candidate_index"] if winner else None

    cand_cards = "\n".join(
        candidate_card_html(item_id, i, c, i == winner_idx)
        for i, c in enumerate(candidates)
    )

    winner_line = ""
    if winner:
        # Also copy selected/<id>.png (tool_icon_score.py's --select-dir
        # output) into the self-contained img/ tree, per REQ-0073's report
        # inputs list -- even though it's pixel-identical to the winning
        # candidate's own alpha file already shown above, this is the
        # canonical "adopted" copy and this report reads it explicitly.
        selected_rel = copy_selected(item_id)
        selected_note = ""
        if selected_rel:
            selected_note = (f' &middot; adopted copy: '
                              f'<a href="{esc(selected_rel)}">{esc(os.path.basename(selected_rel))}</a>')
        winner_line = (f'<div class="item-winner-line">winner: candidate c{winner_idx + 1} '
                       f'&middot; score {winner["score"]:.1f}{selected_note}</div>')

    return f'''<div class="item-card">
  <div class="item-head">
    <div class="item-name-block">
      <div class="item-name-en">{esc(name_en)}</div>
      <div class="item-name-ja">{esc(name_ja) if name_ja else ""}</div>
      <div class="item-id">{esc(item_id)}</div>
    </div>
    {diagram}
  </div>
  {winner_line}
  <div class="cand-row">
{cand_cards}
  </div>
</div>'''


# ---------------------------------------------------------------------
# Header / explainer HTML
# ---------------------------------------------------------------------
def header_html(scores_doc, generated_at):
    weights = scores_doc.get("weights", {})
    w_scale = weights.get("scale", 0.0)
    w_cov = weights.get("coverage", 0.0)
    w_uni = weights.get("uniformity", 0.0)
    any_angle = scores_doc.get("any_angle", False)

    seeds_txt = "/".join(str(s) for s in SEEDS)

    formula = (
        f'score = 100 &times; ({w_scale:.2f}&middot;scale_term + '
        f'{w_cov:.2f}&middot;coverage_term + {w_uni:.2f}&middot;uniformity_term), '
        f'or 0 if infeasible'
    )

    return f'''<h1>batch-003 item icons -- REQ-0073</h1>
<div class="provenance">{esc(TOOL_PROVENANCE)}</div>
<div class="meta">
  model <b>{esc(MODEL_NAME)}</b> &middot; seeds <b>{esc(seeds_txt)}</b> &middot;
  generated <b>{esc(generated_at)}</b> &middot; scores.json generated <b>{esc(scores_doc.get("generated", ""))}</b>
  {' &middot; any-angle mode' if any_angle else ''}
</div>
<div class="formula-box">
  <div class="formula-label">score formula</div>
  <div class="formula-text">{formula}</div>
  <div class="formula-weights">
    <span class="chip chip-w">scale &times;{w_scale:.2f}</span>
    <span class="chip chip-w">coverage &times;{w_cov:.2f}</span>
    <span class="chip chip-w">uniformity &times;{w_uni:.2f}</span>
  </div>
</div>
<div class="explainer">
  <div class="explainer-title">how the fit tool works</div>
  <div class="explainer-body">
    Each candidate's alpha silhouette is searched for its best placement inside
    the item's owned backpack cells: <b>4 rotations (0&deg;/90&deg;/180&deg;/270&deg;) &times; 2 flips</b>
    (8 orientations total{', plus an arbitrary-angle mode' if any_angle else ''}), each tried at its own
    <b>maximum feasible scale</b>, then placed via a <b>centered-placement</b> policy
    (closest feasible position to the allowed region's centroid). The score is
    <b>geometry only</b> -- scale achieved, per-cell coverage, and cross-cell
    coverage uniformity. There is deliberately <b>no aesthetic or subject-matter
    term</b>: composition, color, and style-guide adherence are not scored here
    (per user directive, REQ-0073 goal 3).
  </div>
</div>'''


# ---------------------------------------------------------------------
# Full-page HTML template -- dark theme tokens copied from
# web/preview/batch-001/index.html / batch-002/index.html (--bg/--panel/
# --panel2/--border/--text/--muted/--gold), extended with this report's own
# component classes (cand-card, terms-grid, shape-grid, etc.) only.
# ---------------------------------------------------------------------
HTML_TEMPLATE = '''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>batch-003 item icons preview (REQ-0073)</title>
<style>
:root {{
  --bg: #14110d;
  --panel: #1d1912;
  --panel2: #241f16;
  --border: #3a3222;
  --text: #e8d9b0;
  --muted: #8a8270;
  --gold: #c9a227;
  --green: #5cb573;
  --red: #d62828;
  --blue: #7ecbe8;
  --amber: #d69e2e;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; padding: 32px;
  background: var(--bg); color: var(--text);
  font-family: Georgia, 'Times New Roman', serif;
}}
h1 {{ color: var(--gold); letter-spacing: 0.06em; text-transform: uppercase; font-size: 22px;
     border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 12px; }}
.provenance {{ color: var(--muted); font-size: 12px; margin-bottom: 4px; font-style: italic; }}
.meta {{ color: var(--muted); font-size: 13px; margin-bottom: 18px; }}
.meta b {{ color: var(--text); }}

.formula-box {{
  background: var(--panel); border: 1px solid var(--gold); border-radius: 8px;
  padding: 14px 18px; margin-bottom: 16px;
}}
.formula-label {{ font-size: 10px; color: var(--muted); text-transform: uppercase;
  letter-spacing: 0.05em; margin-bottom: 6px; }}
.formula-text {{ font-size: 14px; color: var(--text); margin-bottom: 10px; }}
.formula-weights {{ display: flex; gap: 8px; flex-wrap: wrap; }}
.chip {{ font-size: 10px; padding: 2px 9px; border-radius: 10px; background: var(--panel2);
  border: 1px solid var(--border); color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }}
.chip-w {{ color: var(--blue); }}
.chip-feasible {{ color: var(--green); border-color: #2f5c3b; }}
.chip-infeasible {{ color: #ff8a8a; border-color: #6e2626; }}

.explainer {{
  background: var(--panel2); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px 18px; margin-bottom: 32px; max-width: 900px;
}}
.explainer-title {{ font-size: 11px; color: var(--gold); text-transform: uppercase;
  letter-spacing: 0.05em; margin-bottom: 6px; }}
.explainer-body {{ font-size: 13px; line-height: 1.55; color: var(--text); }}
.explainer-body b {{ color: var(--gold); }}

.item-grid {{ display: flex; flex-direction: column; gap: 22px; }}
.item-card {{
  background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 18px;
}}
.item-skipped {{ opacity: 0.7; }}
.item-head {{ display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
  border-bottom: 1px solid var(--border); padding-bottom: 12px; margin-bottom: 10px; }}
.item-name-block {{ display: flex; flex-direction: column; gap: 2px; }}
.item-name-en {{ font-size: 17px; font-weight: bold; color: var(--text); }}
.item-name-ja {{ font-size: 14px; color: var(--gold); }}
.item-id {{ font-size: 11px; color: var(--muted); font-family: monospace; }}
.item-skip-reason {{ font-size: 12px; color: var(--red); margin-top: 6px; }}
.item-winner-line {{ font-size: 12px; color: var(--green); margin-bottom: 10px; }}
.item-winner-line a {{ color: var(--blue); }}

.shape-grid {{ display: grid; gap: 2px; }}
.shape-cell {{ width: 22px; height: 22px; border-radius: 2px; }}
.shape-owned {{ background: var(--gold); border: 1px solid #5a4413; }}
.shape-empty {{ background: none; }}
.shape-none {{ font-size: 11px; color: var(--muted); font-style: italic; }}

.cand-row {{ display: flex; flex-wrap: wrap; gap: 14px; }}
.cand-card {{
  position: relative;
  background: var(--panel2); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; width: 300px; display: flex; flex-direction: column; gap: 8px;
}}
.cand-winner {{ border-color: var(--gold); box-shadow: 0 0 0 1px var(--gold); }}
.winner-badge {{
  position: absolute; top: -10px; right: 10px;
  background: var(--gold); color: #221c15; font-size: 10px; font-weight: bold;
  letter-spacing: 0.05em; text-transform: uppercase; padding: 3px 10px; border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.4);
}}
.cand-head {{ display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); }}
.cand-idx {{ font-weight: bold; color: var(--text); }}
.cand-seed {{ font-family: monospace; }}

.cand-imgs {{ display: flex; gap: 6px; }}
.cand-img-block {{ flex: 1; min-width: 0; background: #100d09; border-radius: 6px; padding: 5px; text-align: center; }}
.cand-img-label {{ font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 3px; }}
.cand-img-block img {{ max-width: 100%; height: auto; border-radius: 4px; border: 1px solid var(--border); }}
.cand-img-checker img {{
  background-image: linear-gradient(45deg, #3a3a3a 25%, transparent 25%),
                     linear-gradient(-45deg, #3a3a3a 25%, transparent 25%),
                     linear-gradient(45deg, transparent 75%, #3a3a3a 75%),
                     linear-gradient(-45deg, transparent 75%, #3a3a3a 75%);
  background-size: 12px 12px; background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-color: #2a2a2a;
}}
.cand-img-dark img {{ background: #0a0806; }}
.img-missing {{ font-size: 10px; color: var(--muted); font-style: italic; padding: 20px 4px; }}

.cand-score {{ font-size: 22px; font-weight: bold; color: var(--gold); text-align: center; }}

.terms-grid {{ display: flex; flex-direction: column; gap: 2px; }}
.term-row {{ display: flex; justify-content: space-between; font-size: 11px; }}
.term-label {{ color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }}
.term-val {{ color: var(--text); font-family: monospace; }}
.terms-infeasible {{ font-size: 12px; color: var(--red); text-align: center; }}
.terms-reason {{ font-size: 10px; color: var(--muted); font-style: italic; }}

.cand-orient {{ font-size: 11px; color: var(--blue); text-align: center; }}

footer {{ margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--border);
  font-size: 12px; color: var(--muted); }}
footer a {{ color: var(--blue); }}
</style></head><body>

{header}

<h2 style="color: var(--gold); font-size: 16px; letter-spacing: 0.04em; text-transform: uppercase;
     margin-top: 30px; border-bottom: 1px solid var(--border); padding-bottom: 8px;">items ({item_count})</h2>
<div class="item-grid">
{item_cards}
</div>

<footer>spec: <a href="{spec_href}">{spec_href}</a></footer>

</body></html>
'''


def build():
    reset_out_dirs()

    item_defs = load_item_defs(DEFS_PATH)
    scores_doc = load_scores(SCORES_PATH)
    items = scores_doc.get("items", {})

    generated_at = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    header = header_html(scores_doc, generated_at)

    # Deterministic order: iterate defs in their own file order, restricted
    # to entries that actually have a gen_render/scores entry, so the
    # report order matches the item DB's authored order rather than
    # scores.json's dict insertion order.
    ordered_ids = [eid for eid in item_defs.keys() if eid in items]
    # include any scored ids not found in defs (shouldn't happen, but keep
    # deterministic + complete rather than silently dropping them)
    for eid in items.keys():
        if eid not in ordered_ids:
            ordered_ids.append(eid)

    cards = []
    for eid in ordered_ids:
        entry = item_defs.get(eid, {"id": eid})
        cards.append(item_card_html(eid, entry, items[eid]))

    html = HTML_TEMPLATE.format(
        header=header,
        item_count=len(ordered_ids),
        item_cards="\n".join(cards),
        spec_href=esc(SPEC_LINK),
    )

    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, "index.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Wrote {out_path}")
    print(f"items={len(ordered_ids)}")
    for eid in ordered_ids:
        r = items[eid]
        if r.get("status") == "SKIPPED":
            print(f"  SKIPPED {eid:24s} {r.get('reason')}")
        else:
            w = r.get("winner")
            wtxt = f"winner={w['file']} score={w['score']:.2f}" if w else "winner=None"
            print(f"  SCORED  {eid:24s} candidates={len(r.get('candidates', []))} {wtxt}")


if __name__ == "__main__":
    build()
