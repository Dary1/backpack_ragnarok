# -*- coding: utf-8 -*-
"""
tools/build_fit_report.py -- Fit-check RESULT visualization page builder (REQ-0022).

Deterministic report/build script. For every symbol with a "shape" def across
the project's live + draft defs files, runs the fit CHECK against the current
live sprite (content/sprite_all_v4.svg) by IMPORTING tool_fit_check.py as a
module -- it does not reimplement, fork, or duplicate any of that tool's
algorithmic logic. All allowed-region masks, content masks, coverage numbers,
and solve() prescriptions come directly from tool_fit_check's own functions.

For every checked icon (has both a shape and a sprite symbol) this script:
  1. Renders the CURRENT placement (content mask overlaid on the allowed
     region at its natural/live scale=1.0, pos=(0,0)) via tool_fit_check.render,
     then does a purely additive post-compose pass (own function, does not
     touch tool_fit_check) that recolors overflow/pad-violating content pixels
     red, so FAILs are visually obvious without altering render()'s own output
     semantics.
  2. For FAILs, also runs tool_fit_check.fix_icon (which calls the ported
     solve()) and renders the PRESCRIBED placement (scale/rot/flip/pos chosen
     by solve()) as a second PNG via the same tool_fit_check.render.
  3. Collects PASS/FAIL/SKIPPED status, overflow px, per-cell coverage %,
     and (for FAILs) the prescribed transform, into a single JSON-able list.

It then renders web/preview/batch-001/fit/index.html (dark theme consistent
with web/preview/batch-001/index.html) with one card per checked icon plus a
compact list of SKIPPED entries, and writes all PNGs into that same directory.

Usage (run under the project venv):
    ~/backpack_ragnarok/.venv/bin/python tools/build_fit_report.py

No CLI args: paths are fixed project-relative constants (see CONFIG below).
This script only ever WRITES inside web/preview/batch-001/fit/ and READS
existing project content -- it never modifies the sprite, defs, or
tool_fit_check.py itself.
"""
import os
import sys
import json
import datetime

import numpy as np
from PIL import Image

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, TOOLS_DIR)

import tool_fit_check as fit  # noqa: E402  (import as module -- do not fork its logic)

# ---------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------
# Sprite path is parameterizable via --sprite (REQ: v5 fit-report regen);
# defaults to v4 for backward compatibility with existing invocations.
DEFAULT_SPRITE_PATH = os.path.join(PROJECT_ROOT, "content", "sprite_all_v4.svg")
SPRITE_PATH = DEFAULT_SPRITE_PATH
DEFS_PATHS = [
    os.path.join(PROJECT_ROOT, "content", "live", "live_items.json"),
    os.path.join(PROJECT_ROOT, "content", "live", "live_sis.json"),
    os.path.join(PROJECT_ROOT, "content", "batches", "batch-001-niflheim", "draft.json"),
]
OUT_DIR = os.path.join(PROJECT_ROOT, "web", "preview", "batch-001", "fit")
TOOL_PROVENANCE = ("tool_fit_check.py -- full parity port of user-provided "
                    "fit_algorithm.py, REQ-0020")

CELL = fit.CELL  # 100 px/cell, from the ported tool -- not redefined here


# ---------------------------------------------------------------------
# Post-compose highlight: purely additive recoloring on top of
# tool_fit_check.render()'s own RGB output. Does not alter render(),
# build_region, check_icon, or any ported function -- it re-derives the
# overflow mask using the SAME allowed/content masks check_icon already
# computed, and only touches pixel color, never geometry/placement math.
# ---------------------------------------------------------------------
def render_with_overflow_highlight(allowed, cellset, mask, scale, pos, out_path):
    """Call the tool's own render(), then re-open the PNG and recolor pixels
    that are BOTH content and outside `allowed` (i.e. overflow/pad-violation
    pixels) to red. mask/scale/pos must be the exact placement already used
    for render() so the highlight lines up with what was drawn."""
    fit.render(allowed, cellset, mask, scale, pos, out_path)

    H, W = allowed.shape
    placed = fit.scaled(mask, scale) if scale != 1.0 else mask
    y, x = pos
    full = np.zeros((H, W), bool)
    ph, pw = placed.shape
    ph = min(ph, H - y)
    pw = min(pw, W - x)
    full[y:y + ph, x:x + pw] = placed[:ph, :pw]
    overflow = full & (~allowed)

    if overflow.any():
        img = Image.open(out_path).convert("RGB")
        arr = np.array(img)
        arr[overflow] = (214, 40, 40)
        Image.fromarray(arr).save(out_path)

    return bool(overflow.any())


def render_current_placement(sprite_root, entry, out_path):
    """Render the icon exactly as currently placed (natural mapping, scale=1,
    pos=(0,0)) -- same content mask check_icon() itself rasterizes -- with
    overflow pixels highlighted red."""
    icon_id = entry.get("icon")
    shape = entry.get("shape")
    sym, viewbox = fit.extract_symbol(sprite_root, icon_id)
    cellset, rows, cols = fit.shape_to_cellset(shape)
    allowed = fit.build_region(cellset)
    H, W = allowed.shape
    content_natural = fit.rasterize_symbol(sym, viewbox, W, H)
    had_overflow = render_with_overflow_highlight(
        allowed, cellset, content_natural, 1.0, (0, 0), out_path)
    return had_overflow


def render_prescribed_placement(sprite_root, entry, out_path):
    """Run fix_icon (-> ported solve()) and render its prescribed placement.
    Returns the fix_icon result dict (status SOLVED/INFEASIBLE/EMPTY_CONTENT/
    SKIPPED) with 'render' path attached on success."""
    r = fit.fix_icon(sprite_root, entry, any_angle=False)
    if r["status"] != "SOLVED":
        return r
    allowed = r["allowed"]
    cellset = r["cellset"]
    mask = r["mask"]
    scale = r["scale_pct"] / 100.0
    pos_xy = r["pos_xy"]
    pos = (pos_xy[1], pos_xy[0])  # tool stores pos as (row, col) internally; pos_xy is (x,y)
    render_with_overflow_highlight(allowed, cellset, mask, scale, pos, out_path)
    r["render"] = out_path
    return r


# ---------------------------------------------------------------------
# Report data collection
# ---------------------------------------------------------------------
def build_report(sprite_path=None):
    sprite_root = fit.load_sprite_tree(sprite_path or SPRITE_PATH)

    all_entries = []
    for defs_path in DEFS_PATHS:
        entries = fit.load_defs(defs_path)
        for e in entries:
            e["_source"] = os.path.relpath(defs_path, PROJECT_ROOT)
        all_entries.extend(entries)

    os.makedirs(OUT_DIR, exist_ok=True)

    results = []
    for entry in all_entries:
        eid = entry.get("id", entry.get("icon"))
        check = fit.check_icon(sprite_root, entry, render_dir=None)

        if check["status"] == "SKIPPED":
            results.append(dict(
                id=eid, icon=entry.get("icon"), source=entry.get("_source"),
                status="SKIPPED", reason=check.get("reason"),
            ))
            continue

        rec = dict(
            id=eid, icon=entry.get("icon"), source=entry.get("_source"),
            status=check["status"],
            overflow_px=check.get("overflow_px"),
            coverage=check.get("coverage"),
            violated_faces=check.get("violated_faces", []),
            escalate=check.get("escalate"),
            reason=check.get("reason"),
        )

        current_png = f"{eid}_current.png"
        try:
            render_current_placement(sprite_root, entry, os.path.join(OUT_DIR, current_png))
            rec["current_png"] = current_png
        except Exception as ex:
            rec["current_png"] = None
            rec["current_render_error"] = str(ex)

        if check["status"] == "FAIL":
            fixed_png = f"{eid}_fixed.png"
            try:
                fixr = render_prescribed_placement(sprite_root, entry, os.path.join(OUT_DIR, fixed_png))
                if fixr.get("status") == "SOLVED":
                    rec["fixed_png"] = fixed_png
                    rec["fix"] = dict(
                        solved=True,
                        scale_pct=fixr["scale_pct"],
                        rotation_deg=fixr["rotation_deg"],
                        flip=fixr["flip"],
                        pos_xy=fixr["pos_xy"],
                        content_size_px=fixr["content_size_px"],
                        rotation_only_feasible=(fixr["rotation_deg"] != 0),
                    )
                else:
                    rec["fixed_png"] = None
                    rec["fix"] = dict(solved=False, status=fixr.get("status"))
            except Exception as ex:
                rec["fixed_png"] = None
                rec["fix_error"] = str(ex)

        results.append(rec)

    return results


# ---------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------
def esc(s):
    if s is None:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def badge_html(status):
    cls = {"PASS": "badge-pass", "FAIL": "badge-fail", "SKIPPED": "badge-skip"}.get(status, "badge-skip")
    return f'<span class="badge {cls}">{status}</span>'


def coverage_table_html(coverage, violated_faces):
    if not coverage:
        return '<div class="cov-none">n/a</div>'
    bad_cells = set()
    for v in violated_faces or []:
        bad_cells.add(tuple(v["cell"]))
    rows = []
    for cell_key, pct in coverage.items():
        # cell_key looks like "(c,r)"
        inner = cell_key.strip("()")
        c_str, r_str = inner.split(",")
        c, r = int(c_str), int(r_str)
        low = pct < 30.0
        overflow_here = (c, r) in bad_cells
        cls = "cov-low" if low else "cov-ok"
        marker = " (low)" if low else ""
        overflow_span = '<span class="cov-of">overflow</span>' if overflow_here else ""
        rows.append(
            f'<div class="cov-cell {cls}"><span class="cov-xy">({c},{r})</span>'
            f'<span class="cov-pct">{pct:.1f}%{marker}</span>'
            f'{overflow_span}</div>'
        )
    return '<div class="cov-grid">' + "".join(rows) + '</div>'


def fix_text_html(rec):
    if rec["status"] != "FAIL":
        return ""
    if rec.get("escalate"):
        return (f'<div class="fix-text fix-escalate">ESCALATE ({esc(rec["escalate"])}): '
                f'{esc(rec.get("reason"))}<br/>'
                f'{fix_transform_line(rec)}</div>')
    if "fix" in rec and rec["fix"].get("solved"):
        f = rec["fix"]
        rot_note = ""
        if f.get("rotation_only_feasible"):
            rot_note = ' <span class="fix-rotnote">(only feasible with rotation)</span>'
        return (f'<div class="fix-text">'
                f'scale <b>{f["scale_pct"]:.2f}%</b> &middot; '
                f'rotate <b>{f["rotation_deg"]}&deg;</b> &middot; '
                f'flip <b>{f["flip"]}</b> &middot; '
                f'pos(x,y) <b>{f["pos_xy"]}</b>'
                f'{rot_note}</div>')
    if "fix" in rec:
        return f'<div class="fix-text fix-infeasible">solve(): {esc(rec["fix"].get("status"))}</div>'
    if "fix_error" in rec:
        return f'<div class="fix-text fix-infeasible">fix render error: {esc(rec["fix_error"])}</div>'
    return ""


def fix_transform_line(rec):
    if "fix" in rec and rec["fix"].get("solved"):
        f = rec["fix"]
        return (f'prescribed: scale {f["scale_pct"]:.2f}%, rotate {f["rotation_deg"]}&deg;, '
                f'flip {f["flip"]}, pos(x,y) {f["pos_xy"]}')
    return ""


def card_html(rec):
    status = rec["status"]
    name = rec["id"]
    icon = rec.get("icon")
    source = rec.get("source", "")

    overflow_line = ""
    if rec.get("overflow_px") is not None:
        overflow_line = f'<div class="stat-line">overflow: <b>{rec["overflow_px"]} px</b></div>'
    elif status == "FAIL" and rec.get("escalate"):
        overflow_line = '<div class="stat-line">overflow: <b>n/a (structural)</b></div>'

    current_img = ""
    if rec.get("current_png"):
        current_img = (f'<div class="img-block"><div class="img-label">current placement</div>'
                        f'<img src="{esc(rec["current_png"])}" alt="{esc(name)} current" loading="lazy"/></div>')
    elif rec.get("current_render_error"):
        current_img = f'<div class="img-block img-error">render error: {esc(rec["current_render_error"])}</div>'

    fixed_img = ""
    if status == "FAIL" and rec.get("fixed_png"):
        fixed_img = (f'<div class="img-block"><div class="img-label">prescribed fix</div>'
                     f'<img src="{esc(rec["fixed_png"])}" alt="{esc(name)} fixed" loading="lazy"/></div>')

    cov = coverage_table_html(rec.get("coverage"), rec.get("violated_faces"))

    return f'''<div class="card card-{status.lower()}">
  <div class="card-head">
    <div class="card-title">{esc(name)}</div>
    {badge_html(status)}
  </div>
  <div class="card-sub">icon={esc(icon)} &middot; source={esc(source)}</div>
  {overflow_line}
  <div class="card-imgs">
    {current_img}
    {fixed_img}
  </div>
  <div class="cov-section">
    <div class="cov-title">per-cell coverage (&lt;30% flagged -- binding art rule)</div>
    {cov}
  </div>
  {fix_text_html(rec)}
</div>'''


def skipped_row_html(rec):
    return (f'<tr><td>{esc(rec["id"])}</td><td>{esc(rec.get("icon"))}</td>'
            f'<td>{esc(rec.get("source"))}</td><td>{esc(rec.get("reason"))}</td></tr>')


HTML_TEMPLATE = '''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>batch-001 fit-check results</title>
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
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; padding: 32px;
  background: var(--bg); color: var(--text);
  font-family: Georgia, 'Times New Roman', serif;
}}
h1 {{ color: var(--gold); letter-spacing: 0.06em; text-transform: uppercase; font-size: 22px;
     border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 12px; }}
h2 {{ color: var(--gold); font-size: 16px; letter-spacing: 0.04em; text-transform: uppercase;
     margin-top: 40px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }}
.meta {{ color: var(--muted); font-size: 13px; margin-bottom: 6px; }}
.provenance {{ color: var(--muted); font-size: 12px; margin-bottom: 4px; font-style: italic; }}
.summary-bar {{ display: flex; gap: 14px; margin: 18px 0 8px 0; flex-wrap: wrap; }}
.summary-chip {{ padding: 8px 16px; border-radius: 8px; background: var(--panel);
  border: 1px solid var(--border); font-size: 14px; }}
.summary-chip b {{ font-size: 18px; }}
.chip-pass b {{ color: var(--green); }}
.chip-fail b {{ color: var(--red); }}
.chip-skip b {{ color: var(--muted); }}

.gallery {{ display: flex; flex-wrap: wrap; gap: 18px; margin-top: 16px; }}
.card {{
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px; width: 340px; display: flex; flex-direction: column; gap: 8px;
}}
.card-pass {{ border-color: #2f5c3b; }}
.card-fail {{ border-color: #6e2626; }}
.card-head {{ display: flex; align-items: center; justify-content: space-between; }}
.card-title {{ font-size: 17px; font-weight: bold; }}
.card-sub {{ font-size: 11px; color: var(--muted); }}
.stat-line {{ font-size: 12px; color: var(--text); }}

.badge {{ font-size: 11px; padding: 3px 10px; border-radius: 10px; text-transform: uppercase;
  letter-spacing: 0.04em; font-weight: bold; }}
.badge-pass {{ background: #1e3a24; color: var(--green); border: 1px solid #2f5c3b; }}
.badge-fail {{ background: #3a1e1e; color: #ff8a8a; border: 1px solid #6e2626; }}
.badge-skip {{ background: #2a2a2a; color: var(--muted); border: 1px solid #444; }}

.card-imgs {{ display: flex; gap: 8px; flex-wrap: wrap; }}
.img-block {{ flex: 1; min-width: 140px; background: var(--panel2); border-radius: 6px;
  padding: 6px; text-align: center; }}
.img-label {{ font-size: 10px; color: var(--muted); text-transform: uppercase;
  letter-spacing: 0.03em; margin-bottom: 4px; }}
.img-block img {{ max-width: 100%; height: auto; image-rendering: pixelated;
  border-radius: 4px; border: 1px solid var(--border); }}
.img-error {{ color: var(--red); font-size: 11px; }}

.cov-section {{ margin-top: 4px; }}
.cov-title {{ font-size: 10px; color: var(--muted); text-transform: uppercase;
  letter-spacing: 0.03em; margin-bottom: 4px; }}
.cov-grid {{ display: flex; flex-wrap: wrap; gap: 4px; }}
.cov-cell {{ font-size: 11px; padding: 3px 6px; border-radius: 4px; background: var(--panel2);
  border: 1px solid var(--border); display: flex; gap: 6px; align-items: center; }}
.cov-cell.cov-low {{ border-color: var(--red); background: #2a1414; color: #ff9c9c; }}
.cov-of {{ font-size: 9px; color: var(--red); text-transform: uppercase; }}
.cov-none {{ font-size: 11px; color: var(--muted); font-style: italic; }}

.fix-text {{ font-size: 12px; color: var(--blue); background: var(--panel2);
  border-radius: 6px; padding: 8px; border: 1px solid var(--border); }}
.fix-escalate {{ color: #ffb37e; }}
.fix-infeasible {{ color: var(--red); }}
.fix-rotnote {{ color: var(--gold); }}

table.skip-table {{ width: 100%; border-collapse: collapse; font-size: 12px; color: var(--muted); margin-top: 10px; }}
table.skip-table td, table.skip-table th {{ padding: 4px 10px; border-bottom: 1px solid var(--border); text-align: left; }}
table.skip-table th {{ color: var(--gold); text-transform: uppercase; font-size: 10px; letter-spacing: 0.03em; }}
table.skip-table tr:hover td {{ color: var(--text); }}
</style></head><body>

<h1>batch-001 fit-check results</h1>
<div class="provenance">{provenance}</div>
<div class="meta">generated {timestamp}</div>

<div class="summary-bar">
  <div class="summary-chip chip-pass">PASS: <b>{pass_count}</b></div>
  <div class="summary-chip chip-fail">FAIL: <b>{fail_count}</b></div>
  <div class="summary-chip chip-skip">SKIPPED: <b>{skip_count}</b></div>
  <div class="summary-chip">checked: <b>{checked_count}</b></div>
  <div class="summary-chip">total defs: <b>{total_count}</b></div>
</div>

<h2>checked icons</h2>
<div class="gallery">
{cards}
</div>

<h2>skipped ({skip_count})</h2>
<table class="skip-table">
<tr><th>id</th><th>icon</th><th>source</th><th>reason</th></tr>
{skip_rows}
</table>

</body></html>
'''


def render_html(results):
    checked = [r for r in results if r["status"] != "SKIPPED"]
    skipped = [r for r in results if r["status"] == "SKIPPED"]
    pass_count = sum(1 for r in checked if r["status"] == "PASS")
    fail_count = sum(1 for r in checked if r["status"] == "FAIL")

    cards_html = "\n".join(card_html(r) for r in checked)
    skip_rows_html = "\n".join(skipped_row_html(r) for r in skipped)

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S %z") or \
        datetime.datetime.now().isoformat()

    html = HTML_TEMPLATE.format(
        provenance=esc(TOOL_PROVENANCE),
        timestamp=esc(timestamp),
        pass_count=pass_count,
        fail_count=fail_count,
        skip_count=len(skipped),
        checked_count=len(checked),
        total_count=len(results),
        cards=cards_html,
        skip_rows=skip_rows_html,
    )
    return html


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Build fit-check result visualization page (REQ-0022)")
    ap.add_argument("--sprite", default=DEFAULT_SPRITE_PATH,
                    help="path to sprite SVG to check/render against (default: content/sprite_all_v4.svg)")
    args = ap.parse_args()

    results = build_report(sprite_path=args.sprite)
    html = render_html(results)
    out_path = os.path.join(OUT_DIR, "index.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    checked = [r for r in results if r["status"] != "SKIPPED"]
    skipped = [r for r in results if r["status"] == "SKIPPED"]
    print(f"Wrote {out_path}")
    print(f"checked={len(checked)} pass={sum(1 for r in checked if r['status']=='PASS')} "
          f"fail={sum(1 for r in checked if r['status']=='FAIL')} skipped={len(skipped)}")
    for r in results:
        if r["status"] == "SKIPPED":
            print(f"  SKIPPED {r['id']:24s} icon={r.get('icon')}")
        else:
            print(f"  {r['status']:7s} {r['id']:24s} icon={r.get('icon')} "
                  f"overflow_px={r.get('overflow_px')}")


if __name__ == "__main__":
    main()
