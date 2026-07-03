# -*- coding: utf-8 -*-
"""
build_preview.py -- Deterministic batch preview page generator (REQ-0019 S6 rebuild).

Regenerates web/preview/<batch>/index.html from:
  - a staging draft.json (content/batches/<batch>/draft.json)
  - the live roster (content/live/live_items.json, content/live/live_sis.json)
    used only for the "Live Roster (for comparison)" table
  - a sprite SVG (content/sprite_all_vN.svg), whose <symbol> definitions are
    embedded inline into the page (the web/ docroot does not serve content/,
    so the sprite must be self-contained in the page, matching the existing
    page's approach)

Deterministic: same inputs -> byte-identical output (no timestamps, no
non-deterministic ordering). Preserves the current page's dark-parchment
look, JA/EN i18n toggle, gallery cards with shapegrid + conn-notch markers,
batch stats bars, and live-roster comparison table.

Usage:
    python3 tools/build_preview.py \
        --draft content/batches/batch-001-niflheim/draft.json \
        --live-items content/live/live_items.json \
        --live-sis content/live/live_sis.json \
        --sprite content/sprite_all_v4.svg \
        --out web/preview/batch-001/index.html \
        --batch-id batch-001-niflheim
"""
import argparse
import json
import re
import xml.etree.ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"

RARITY_COLOR = {
    "Common": "#9aa5ad",
    "Uncommon": "#5cb573",
    "Rare": "#6c95e0",
    "Relic": "#b56ce0",  # not used by current roster, kept for completeness
}

SOCKET_GLYPH = {
    "gem": "◆",    # diamond
    "edge": "▷",   # triangle
    "coat": "●",   # filled circle
    "bond": "▬",   # bar
}

CELL_PX = 28


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def entries_of(data):
    if isinstance(data, list):
        return data
    return data.get("entries", [])


def shape_bbox_cells(shape):
    """shape: [[col,row],...] -> (cols, rows, cellset normalized to origin)."""
    cols = [c for c, r in shape]
    rows = [r for c, r in shape]
    c0, r0 = min(cols), min(rows)
    cellset = {(c - c0, r - r0) for c, r in shape}
    return (max(cols) - c0 + 1), (max(rows) - r0 + 1), cellset


def conn_notch_polygon(cx, cy, half=4.48):
    """Diamond notch centered at (cx,cy), matching the existing page's geometry
    (half-diagonal 4.48px, derived from the original preview's rendered markers)."""
    pts = [(cx, cy - half), (cx + half, cy), (cx, cy + half), (cx - half, cy)]
    return " ".join(f"{x},{y}" for x, y in pts)


def render_shapegrid(shape, conn):
    """Build the <svg class="shapegrid">...</svg> markup for one item's shape.
    conn: list of absolute [col,row] external-neighbor coordinates (same coordinate
    frame as shape, before normalization), one per connecting shape-cell, in the
    same relative order as they appear in shape (matches live_items.json's
    flame_tablet/oil_flask conn convention)."""
    cols, rows, cellset = shape_bbox_cells(shape)
    c0 = min(c for c, r in shape)
    r0 = min(r for c, r in shape)
    w, h = cols * CELL_PX, rows * CELL_PX

    parts = [f'<svg class="shapegrid" viewBox="0 0 {w} {h}" width="{w}" height="{h}">']
    for rr in range(rows):
        for cc in range(cols):
            owned = (cc, rr) in cellset
            fill = "#c9a227" if owned else "none"
            extra = ' stroke="#2b2016" stroke-width="1.5" rx="2"' if owned else ""
            parts.append(
                f'<rect x="{cc*CELL_PX}" y="{rr*CELL_PX}" width="{CELL_PX}" height="{CELL_PX}" fill="{fill}"{extra}/>'
            )
    icon = None  # filled in by caller (needs entry dict); placeholder replaced below
    parts.append("__USE_PLACEHOLDER__")

    if conn:
        for i, (ncol, nrow) in enumerate(conn):
            # neighbor cell in normalized (0-based) coords
            ncc, nrr = ncol - c0, nrow - r0
            cx = ncc * CELL_PX + CELL_PX / 2
            cy = nrr * CELL_PX + CELL_PX / 2
            pts = conn_notch_polygon(cx, cy)
            parts.append(
                f'<polygon class="conn-notch" points="{pts}" fill="#f4d35e" stroke="#5a4413" stroke-width="1"/>'
            )
    parts.append("</svg>")
    return parts, w, h


def render_card(entry):
    shape = entry.get("shape")
    icon_id = entry.get("icon")
    conn = entry.get("conn")

    if shape:
        parts, w, h = render_shapegrid(shape, conn)
        use_tag = f'<use href="#{icon_id}" x="0" y="0" width="{w}" height="{h}"/>'
        parts = [p if p != "__USE_PLACEHOLDER__" else use_tag for p in parts]
        shape_html = "".join(parts)
    else:
        shape_html = f'<div class="icon-missing">(no shape)</div>'

    rarity = entry.get("rarity", "Common")
    color = RARITY_COLOR.get(rarity, "#9aa5ad")

    # tags[0] is always the former type-tag; remaining entries are former
    # elements (REQ-0022 batch 3/4 -- see content JSON's migrated "tags"
    # field, tools/migrate_tag_hierarchy.cjs). Render identically to the old
    # type/el chip split: first tag as the "type" chip, the rest as "el" chips.
    tags = entry.get("tags") or []
    type_tag = tags[0] if tags else ""
    el_tags = tags[1:]
    chips = [f'<span class="chip chip-type">{esc(type_tag)}</span>']
    for el in el_tags:
        chips.append(f'<span class="chip chip-el">{esc(el)}</span>')

    sockets_html = ""
    sockets = entry.get("sockets") or []
    if sockets:
        pills = []
        for s in sockets:
            glyph = SOCKET_GLYPH.get(s.get("t", ""), "")
            tags = ", ".join(s.get("tags", []))
            tag_part = f" [{tags}]" if tags else ""
            pills.append(f'<span class="socket-pill">{glyph} {esc(s.get("t",""))}{esc(tag_part)}</span>')
        sockets_html = f'<div class="sockets">{"".join(pills)}</div>'

    eff_ja = entry.get("effects_text_ja", "")
    eff_en = entry.get("effects_text_en", "")
    flavor_ja = entry.get("flavor_ja", "")
    flavor_en = entry.get("flavor", "")
    name_ja = entry.get("name_ja", "")
    name_en = entry.get("name", "")

    return (
        '<div class="card">'
        f'<div class="card-shape">{shape_html}</div>'
        f'<div class="card-name-ja" style="color:{color}">{esc(name_ja)}</div>'
        f'<div class="card-name-en">{esc(name_en)}</div>'
        f'<div class="card-chips">{"".join(chips)}</div>'
        f'{sockets_html}'
        f'<div class="eff"><span class="i18n"><span lang="ja">{esc(eff_ja)}</span><span lang="en">{esc(eff_en)}</span></span></div>'
        f'<div class="flavor"><span class="i18n"><span lang="ja">{esc(flavor_ja)}</span><span lang="en">{esc(flavor_en)}</span></span></div>'
        '</div>'
    )


def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def cell_label(n, lang_ja):
    if lang_ja:
        return f"{n}セル"
    return f"{n} cell" + ("s" if n != 1 else "")


def render_stats(entries):
    """Shape-size distribution + rarity distribution bars, matching the
    existing page's bilingual bar-row markup."""
    size_counts = {}
    rarity_counts = {}
    for e in entries:
        shape = e.get("shape")
        if shape:
            n = len(shape)
            size_counts[n] = size_counts.get(n, 0) + 1
        r = e.get("rarity", "Common")
        rarity_counts[r] = rarity_counts.get(r, 0) + 1

    max_size = max(size_counts.values()) if size_counts else 1
    size_rows = []
    for n in sorted(size_counts):
        cnt = size_counts[n]
        pct = round(100 * cnt / max_size)
        size_rows.append(
            '<div class="bar-row"><div class="bar-label"><span class="i18n">'
            f'<span lang="ja">{n}セル</span><span lang="en">{n} cellss</span></span></div>'
            f'<div class="bar-track"><div class="bar-fill" style="width:{pct}%;background:#c9a227"></div></div>'
            f'<div class="bar-count">{cnt}</div></div>'
        )

    max_rarity = max(rarity_counts.values()) if rarity_counts else 1
    rarity_order = ["Common", "Uncommon", "Rare", "Relic"]
    rarity_rows = []
    for r in rarity_order:
        if r not in rarity_counts:
            continue
        cnt = rarity_counts[r]
        pct = round(100 * cnt / max_rarity)
        color = RARITY_COLOR.get(r, "#9aa5ad")
        rarity_rows.append(
            '<div class="bar-row"><div class="bar-label"><span class="i18n">'
            f'<span lang="ja">{r}</span><span lang="en">{r}</span></span></div>'
            f'<div class="bar-track"><div class="bar-fill" style="width:{pct}%;background:{color}"></div></div>'
            f'<div class="bar-count">{cnt}</div></div>'
        )

    return (
        '<div class="stats-cols">'
        '<div class="stats-block"><div class="meta"><span class="i18n"><span lang="ja">シェイプサイズ</span>'
        '<span lang="en">Shape size</span></span></div>' + "".join(size_rows) + '</div>'
        '<div class="stats-block"><div class="meta"><span class="i18n"><span lang="ja">レアリティ</span>'
        '<span lang="en">Rarity</span></span></div>' + "".join(rarity_rows) + '</div>'
        '</div>'
    )


def render_live_roster(live_entries):
    rows = []
    for e in live_entries:
        shape = e.get("shape")
        n = len(shape) if shape is not None else 0
        rarity = e.get("rarity", "Common")
        color = RARITY_COLOR.get(rarity, "#9aa5ad")
        name_ja = e.get("name_ja", "")
        name_en = e.get("name", "")
        cell_ja = f"{n}セル"
        cell_en = f"{n} cellss" if True else ""
        rows.append(
            "<tr>"
            f'<td><span class="i18n"><span lang="ja">{esc(name_ja)}</span><span lang="en">{esc(name_en)}</span></span></td>'
            f'<td><span class="i18n"><span lang="ja">{cell_ja}</span><span lang="en">{cell_en}</span></span></td>'
            f'<td style="color:{color}"><span class="i18n"><span lang="ja">{esc(rarity)}</span><span lang="en">{esc(rarity)}</span></span></td>'
            "</tr>"
        )
    header = (
        "<tr><td><b><span class=\"i18n\"><span lang=\"ja\">名前</span><span lang=\"en\">Name</span></span></b></td>"
        "<td><b><span class=\"i18n\"><span lang=\"ja\">シェイプ</span><span lang=\"en\">Shape</span></span></b></td>"
        "<td><b><span class=\"i18n\"><span lang=\"ja\">レアリティ</span><span lang=\"en\">Rarity</span></span></b></td></tr>"
    )
    return f'<table class="live-table">{header}{"".join(rows)}</table>'


def extract_sprite_svgs(sprite_path):
    """Return the sprite file's raw content, re-wrapped as a single
    <svg class="spritesheet">...</svg> block containing all <symbol> defs
    (our sprite files are multiple concatenated <svg> roots; the page embeds
    them as one block, matching the existing page's approach)."""
    with open(sprite_path, encoding="utf-8") as f:
        raw = f.read()
    # pull every <symbol ...>...</symbol> block out, regardless of which
    # top-level <svg> wrapper it originally lived in
    symbols = re.findall(r"<symbol\b.*?</symbol>", raw, re.S)
    return '<svg class="spritesheet">\n' + "\n".join(symbols) + "\n</svg>"


PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"/><title>{batch_id} preview / プレビュー</title>
<style>
:root {{
  --bg: #14110d;
  --panel: #1d1912;
  --panel2: #241f16;
  --border: #3a3222;
  --text: #e8d9b0;
  --muted: #8a8270;
  --gold: #c9a227;
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; padding: 32px;
  background: var(--bg); color: var(--text);
  font-family: Georgia, 'Times New Roman', serif;
}}
h1 {{ color: var(--gold); letter-spacing: 0.06em; text-transform: uppercase; font-size: 22px;
     border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 24px; }}
h2 {{ color: var(--gold); font-size: 16px; letter-spacing: 0.04em; text-transform: uppercase;
     margin-top: 40px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }}
.meta {{ color: var(--muted); font-size: 13px; margin-bottom: 24px; }}
.gallery {{ display: flex; flex-wrap: wrap; gap: 18px; margin-top: 16px; }}
.card {{
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  padding: 14px; width: 230px; display: flex; flex-direction: column; gap: 6px;
}}
.card-shape {{ display: flex; align-items: center; justify-content: center; min-height: 70px;
              background: var(--panel2); border-radius: 6px; padding: 8px; }}
.shapegrid {{ image-rendering: crisp-edges; }}
.conn-notch {{ pointer-events: none; }}
.icon-missing {{ font-size: 11px; color: var(--muted); text-align: center; font-style: italic; }}
.card-name-ja {{ font-size: 17px; font-weight: bold; line-height: 1.25; }}
.card-name-en {{ font-size: 11px; color: var(--muted); letter-spacing: 0.02em; }}
.card-chips {{ display: flex; flex-wrap: wrap; gap: 4px; }}
.chip {{ font-size: 10px; padding: 2px 7px; border-radius: 10px; background: var(--panel2);
        border: 1px solid var(--border); color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }}
.chip-type {{ color: #d7c48a; }}
.chip-el {{ color: #7ecbe8; }}
.sockets {{ display: flex; flex-wrap: wrap; gap: 4px; }}
.socket-pill {{ font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #2a2416;
               border: 1px solid var(--border); color: var(--text); }}
.eff {{ font-size: 12px; line-height: 1.4; color: var(--text); }}
.flavor {{ font-size: 11px; font-style: italic; color: var(--muted); }}
.stats-cols {{ display: flex; gap: 48px; flex-wrap: wrap; }}
.stats-block {{ min-width: 260px; }}
.bar-row {{ display: grid; grid-template-columns: 90px 1fr 30px; align-items: center; gap: 8px; margin: 6px 0; }}
.bar-label {{ font-size: 12px; color: var(--muted); }}
.bar-track {{ background: var(--panel2); border-radius: 4px; height: 14px; overflow: hidden; border: 1px solid var(--border); }}
.bar-fill {{ height: 100%; }}
.bar-count {{ font-size: 12px; color: var(--text); text-align: right; }}
table.live-table {{ width: 100%; border-collapse: collapse; font-size: 12px; color: var(--muted); margin-top: 10px; }}
table.live-table td {{ padding: 4px 10px; border-bottom: 1px solid var(--border); }}
table.live-table tr:hover td {{ color: var(--text); }}
.section-muted {{ opacity: 0.85; }}
svg.spritesheet {{ display: none !important; }}

/* --- i18n locale toggle --- */
.i18n span[lang="en"] {{ display: none; }}
.i18n span[lang="ja"] {{ display: inline; }}
body.lang-en .i18n span[lang="en"] {{ display: inline; }}
body.lang-en .i18n span[lang="ja"] {{ display: none; }}
body.lang-en .card-name-en {{ display: none; }}

#lang-toggle {{
  position: fixed; top: 18px; right: 18px; z-index: 100;
  background: var(--panel); border: 1px solid var(--border); color: var(--text);
  font-size: 20px; line-height: 1; padding: 10px 14px; border-radius: 999px;
  cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,0.4);
  font-family: inherit;
}}
#lang-toggle:hover {{ border-color: var(--gold); }}
</style></head><body>
<button id="lang-toggle" title="Switch language / 言語切り替え" data-lang="ja">\U0001f1ef\U0001f1f5</button>
{sprite_block}
<h1><span class="i18n"><span lang="ja">バッチ-{batch_num} プレビュー</span><span lang="en">{batch_id} preview</span></span></h1>
<div class="meta"><span class="i18n"><span lang="ja">{n_entries} 件のバッチエントリー（アイテム {n_items} 件、ソケットアイテム {n_sis} 件） - tool_build_preview.py で生成</span><span lang="en">{n_entries} batch entries ({n_items} items, {n_sis} socket items) - generated by tool_build_preview.py</span></span></div>
<h2><span class="i18n"><span lang="ja">バッチエントリー</span><span lang="en">Batch Entries</span></span></h2>
<div class="gallery">{cards_html}</div>
<h2><span class="i18n"><span lang="ja">バッチ統計</span><span lang="en">Batch Stats</span></span></h2>
{stats_html}
<h2 class="section-muted"><span class="i18n"><span lang="ja">既存ロスター（比較用）</span><span lang="en">Live Roster (for comparison)</span></span></h2>
<div class="section-muted">{live_table_html}</div>

<script>
(function () {{
  var btn = document.getElementById('lang-toggle');
  var body = document.body;
  function setLang(en) {{
    body.classList.toggle('lang-en', en);
    btn.textContent = en ? '\\uD83C\\uDDEF\\uD83C\\uDDF5' : '\\uD83C\\uDDEC\\uD83C\\uDDE7';
    btn.setAttribute('data-lang', en ? 'en' : 'ja');
  }}
  btn.addEventListener('click', function () {{
    setLang(btn.getAttribute('data-lang') !== 'en');
  }});
  setLang(false);
}})();
</script>

</body></html>"""


def main():
    ap = argparse.ArgumentParser(description="Deterministic batch preview page builder")
    ap.add_argument("--draft", required=True, help="path to batch draft.json")
    ap.add_argument("--live-items", required=True)
    ap.add_argument("--live-sis", required=True)
    ap.add_argument("--sprite", required=True, help="sprite SVG to embed")
    ap.add_argument("--out", required=True, help="output HTML path")
    ap.add_argument("--batch-id", required=True, help="e.g. batch-001-niflheim")
    args = ap.parse_args()

    draft = load_json(args.draft)
    draft_entries = entries_of(draft)
    live_items = entries_of(load_json(args.live_items))
    live_sis = entries_of(load_json(args.live_sis))

    n_items = sum(1 for e in draft_entries if e.get("shape") is not None)
    n_sis = sum(1 for e in draft_entries if e.get("shape") is None)

    cards_html = "".join(render_card(e) for e in draft_entries)
    stats_html = render_stats(draft_entries)
    live_table_html = render_live_roster(live_items + live_sis)
    sprite_block = extract_sprite_svgs(args.sprite)

    batch_num_m = re.search(r"(\d+)", args.batch_id)
    batch_num = batch_num_m.group(1) if batch_num_m else args.batch_id

    html = PAGE_TEMPLATE.format(
        batch_id=args.batch_id,
        batch_num=batch_num,
        n_entries=len(draft_entries),
        n_items=n_items,
        n_sis=n_sis,
        cards_html=cards_html,
        stats_html=stats_html,
        live_table_html=live_table_html,
        sprite_block=sprite_block,
    )

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Wrote {args.out} ({len(html)} bytes, {len(draft_entries)} batch entries, "
          f"{len(live_items)+len(live_sis)} live roster rows)")


if __name__ == "__main__":
    main()
