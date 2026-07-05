# -*- coding: utf-8 -*-
"""
build_dungeon_preview.py -- REQ-0041 item (e): deterministic dungeon-pilot
preview page generator for batch-002-dungeon-pilot.

Unlike tools/build_preview.py (which renders an ITEM-GALLERY page from a
flat draft.json of PO/SI entries -- batch-001's shape), batch-002 is a
"dungeon pilot" whose content is spread across several typed JSON files
(items.json, enemies.json, skills.json, entities.json, formations.json,
dungeon.json) -- there is no single draft.json to reuse that generator
against. This is therefore a SEPARATE, purpose-built generator for this
content shape, not a reimplementation/fork of build_preview.py (no shared
code was force-fit between the two; each renders what its own content
shape actually has).

Deterministic: same inputs -> byte-identical output (no timestamps, no
non-deterministic dict/set ordering -- every iteration below is over a
JSON array, already author-ordered, or a sorted() call).

Usage:
    python3 tools/build_dungeon_preview.py \
        --batch-dir content/batches/batch-002-dungeon-pilot \
        --out web/preview/batch-002/index.html
"""
import argparse
import json
import os
import re

RARITY_COLOR = {
    "common": "#9aa5ad",
    "uncommon": "#5cb573",
    "rare": "#6c95e0",
    "Common": "#9aa5ad",
    "Uncommon": "#5cb573",
    "Rare": "#6c95e0",
}

FIELD_COLS = 25  # A..Y (fieldGeometry.ts's FIELD_COLS)
FIELD_ROWS = 18  # fieldGeometry.ts's FIELD_ROWS
CELL_PX = 14


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def esc(s):
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def col_letter_to_index(letter):
    # matches client/src/schedule/fieldGeometry.ts's colLetterToIndex
    idx = 0
    for ch in letter.upper():
        idx = idx * 26 + (ord(ch) - ord('A') + 1)
    return idx


def parse_box(box):
    """Parses a box like "F2:M9" -> (col0,row0,col1,row1), 1-based
    inclusive -- matches fieldGeometry.ts's parseBoxToPixelRect parsing
    convention."""
    tl, br = box.split(":")
    m1 = re.match(r"^([A-Za-z]+)(\d+)$", tl)
    m2 = re.match(r"^([A-Za-z]+)(\d+)$", br)
    c0, r0 = col_letter_to_index(m1.group(1)), int(m1.group(2))
    c1, r1 = col_letter_to_index(m2.group(1)), int(m2.group(2))
    return c0, r0, c1, r1


def render_field_grid():
    """Base A..Y x 1..18 field grid lines, shared by every formation
    diagram (drawn once per diagram for a fully self-contained inline
    <svg>, matching the sprite-embedding "no external asset fetch"
    convention build_preview.py already uses for this static-page
    generator family)."""
    w = FIELD_COLS * CELL_PX
    h = FIELD_ROWS * CELL_PX
    parts = [f'<rect x="0" y="0" width="{w}" height="{h}" fill="#241f16" stroke="#3a3222"/>']
    for c in range(1, FIELD_COLS):
        x = c * CELL_PX
        parts.append(f'<line x1="{x}" y1="0" x2="{x}" y2="{h}" stroke="#3a3222" stroke-width="0.5"/>')
    for r in range(1, FIELD_ROWS):
        y = r * CELL_PX
        parts.append(f'<line x1="0" y1="{y}" x2="{w}" y2="{y}" stroke="#3a3222" stroke-width="0.5"/>')
    return parts, w, h


UNIT_COLORS = {
    "unit1": "#c9a227",
    "unit2": "#6c95e0",
    "unit3": "#5cb573",
    "unit4": "#e07a5f",
}


def render_formation_diagram(formation):
    parts, w, h = render_field_grid()
    for unit_key, box in formation["canvases"].items():
        c0, r0, c1, r1 = parse_box(box)
        x = (c0 - 1) * CELL_PX
        y = (r0 - 1) * CELL_PX
        bw = (c1 - c0 + 1) * CELL_PX
        bh = (r1 - r0 + 1) * CELL_PX
        color = UNIT_COLORS.get(unit_key, "#9aa5ad")
        parts.append(
            f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" fill="{color}" fill-opacity="0.28" '
            f'stroke="{color}" stroke-width="2"/>'
        )
        parts.append(
            f'<text x="{x + bw/2}" y="{y + bh/2}" fill="{color}" font-size="11" font-weight="bold" '
            f'text-anchor="middle" dominant-baseline="middle">{esc(unit_key)}</text>'
        )
    svg = f'<svg class="field-diagram" viewBox="0 0 {w} {h}" width="{w}" height="{h}">' + "".join(parts) + "</svg>"
    name_ja = formation.get("i18n", {}).get("ja", {}).get("name", formation["id"])
    name_en = formation.get("i18n", {}).get("en", {}).get("name", formation["id"])
    return (
        '<div class="formation-card">'
        f'<div class="formation-name"><span class="i18n"><span lang="ja">{esc(name_ja)}</span>'
        f'<span lang="en">{esc(name_en)}</span></span> <span class="formation-id">({esc(formation["id"])})</span></div>'
        f'{svg}'
        f'<div class="formation-note">{esc(formation.get("note", ""))}</div>'
        "</div>"
    )


def edge_label(edge_list):
    return "/".join(edge_list) if edge_list else "-"


def telegraph_summary(skill):
    """Renders a skill's ATTACK TELEGRAPH -- the pre-hit "warning" info a
    player reads before a ray actually fires: trigger cadence (when it
    fires), edge+direction (where from), penetration/aoe (how it spreads),
    any inflicted status. This is a textual telegraph summary (static
    preview page, no animated ray), but names every field the real
    MonitorRenderer.ts's own ray_fire/ray_step/ray_bounce animation would
    visualize for this exact skill, so a reader can map "what will this
    attack do" onto what they would later see animate in a real run."""
    trig = skill.get("trigger", {})
    if trig.get("t") == "every_secs":
        lo, hi = trig.get("s", [0, 0])
        trig_txt = f"every {lo}-{hi}s"
    else:
        trig_txt = trig.get("t", "?")
    verb = skill.get("verb", {})
    verb_t = verb.get("t", "?")
    verb_txt = verb_t
    if "n" in verb:
        lo, hi = verb["n"]
        verb_txt = f"{verb_t} {lo}-{hi}"
    ap = skill.get("attack_profile", {})
    edge = edge_label(ap.get("edge", []))
    direction = ap.get("direction", "-")
    pen = ap.get("penetration", 0)
    aoe = ap.get("aoe", 0)
    bounce = ap.get("bounce_budget")
    status_bits = []
    # A skill's status-inflicting verb is verb.t == 'apply_status', with a
    # PLAIN STRING status id, e.g. {"t":"apply_status","status":"Chill",
    # "n":[3,5]} -- see content/batches/batch-002-dungeon-pilot/skills.json
    # (chilling_word / frost_roar / stalker_bleed_bite / hrim_deep_freeze),
    # not a {"status":{...}} object nested under a 'strike' verb.
    status_val = verb.get("status")
    if verb_t == "apply_status" and isinstance(status_val, str):
        status_bits.append(f"inflicts {status_val}")
    elif isinstance(status_val, dict):
        # Defensive: tolerate a future/alternate object-shaped status too.
        status_bits.append(f'inflicts {status_val.get("id", "?")}')
    bits = [
        f'<span class="tg-chip tg-trigger">&#9201; {esc(trig_txt)}</span>',
        f'<span class="tg-chip tg-verb">{esc(verb_txt)}</span>',
        f'<span class="tg-chip tg-edge">edge:{esc(edge)} ({esc(direction)})</span>',
    ]
    if pen:
        bits.append(f'<span class="tg-chip tg-pen">pen:{pen}</span>')
    if aoe:
        bits.append(f'<span class="tg-chip tg-aoe">aoe:{aoe}</span>')
    if bounce:
        bits.append(f'<span class="tg-chip tg-bounce">bounce:{bounce}</span>')
    for s in status_bits:
        bits.append(f'<span class="tg-chip tg-status">{esc(s)}</span>')
    return "".join(bits)


def render_skill_row(skill):
    name_ja = skill.get("name_ja", skill.get("name", skill["id"]))
    name_en = skill.get("name_en", skill.get("name", skill["id"]))
    return (
        '<div class="skill-row">'
        f'<div class="skill-name"><span class="i18n"><span lang="ja">{esc(name_ja)}</span>'
        f'<span lang="en">{esc(name_en)}</span></span> <span class="skill-id">({esc(skill["id"])})</span></div>'
        f'<div class="skill-telegraph">{telegraph_summary(skill)}</div>'
        "</div>"
    )


def render_enemy_card(enemy, skills_by_id):
    name_ja = enemy.get("i18n", {}).get("ja", {}).get("name", enemy["name"])
    name_en = enemy.get("i18n", {}).get("en", {}).get("name", enemy["name"])
    rarity = enemy.get("rarity", "common")
    color = RARITY_COLOR.get(rarity, "#9aa5ad")
    hp = enemy.get("hp")
    hp_txt = f"{hp[0]}-{hp[1]}" if isinstance(hp, list) else str(hp)
    fw, fh = enemy.get("footprint", [1, 1])
    skill_rows = "".join(
        render_skill_row(skills_by_id[sid]) for sid in enemy.get("skills", []) if sid in skills_by_id
    )
    return (
        '<div class="enemy-card">'
        f'<div class="enemy-name" style="color:{color}"><span class="i18n"><span lang="ja">{esc(name_ja)}</span>'
        f'<span lang="en">{esc(name_en)}</span></span></div>'
        '<div class="enemy-meta">'
        f'<span class="chip">HP {esc(hp_txt)}</span>'
        f'<span class="chip">{fw}x{fh}</span>'
        f'<span class="chip" style="color:{color}">{esc(rarity)}</span>'
        f'<span class="chip">{esc(enemy.get("pack_role", "-"))}</span>'
        "</div>"
        f'<div class="enemy-skills">{skill_rows}</div>'
        "</div>"
    )


def render_entity_card(entity, skills_by_id):
    name_ja = entity.get("i18n", {}).get("ja", {}).get("name", entity["name"])
    name_en = entity.get("i18n", {}).get("en", {}).get("name", entity["name"])
    masked = entity.get("masked", False)
    fw, fh = entity.get("footprint", [1, 1])
    skill_rows = "".join(
        render_skill_row(skills_by_id[sid]) for sid in entity.get("skills", []) if sid in skills_by_id
    )
    masked_badge = (
        '<span class="chip chip-masked">&#63; masked until discovered</span>' if masked else ""
    )
    return (
        '<div class="enemy-card entity-card">'
        f'<div class="enemy-name"><span class="i18n"><span lang="ja">{esc(name_ja)}</span>'
        f'<span lang="en">{esc(name_en)}</span></span></div>'
        '<div class="enemy-meta">'
        f'<span class="chip">{esc(entity.get("type", "-"))}</span>'
        f'<span class="chip">{esc(entity.get("mode", "-"))}</span>'
        f'<span class="chip">HP {entity.get("hp", "-")}</span>'
        f'<span class="chip">{fw}x{fh}</span>'
        f'<span class="chip">timeout {entity.get("timeout_secs", "-")}s</span>'
        f'{masked_badge}'
        "</div>"
        f'<div class="enemy-skills">{skill_rows}</div>'
        "</div>"
    )


def render_pilot_item_card(item):
    name_ja = item.get("i18n", {}).get("ja", {}).get("name", item.get("name_ja", item["name"]))
    name_en = item["name"]
    rarity = item.get("rarity", "Common")
    color = RARITY_COLOR.get(rarity, "#9aa5ad")
    icon = item.get("icon", "")
    is_placeholder = "placeholder" in icon
    icon_note = (
        (
            '<div class="icon-placeholder-note">'
            '<span class="i18n"><span lang="ja">&#9888; プレースホルダーアイコン -- '
            '本番アートは今後のS5アイコンパイプラインで差し替え予定</span>'
            '<span lang="en">&#9888; placeholder icon -- real art lands later via the S5 icon pipeline</span></span>'
            "</div>"
        )
        if is_placeholder
        else ""
    )
    modes = ", ".join(item.get("modes", []))
    eff_txts = []
    for e in item.get("effects", []):
        v = e.get("verb", {})
        v_txt = v.get("t", "?")
        if "n" in v:
            lo, hi = v["n"]
            v_txt = f"{v_txt} {lo}-{hi}"
        trig = e.get("trigger", {})
        if trig.get("t") == "every_secs":
            lo, hi = trig.get("s", [0, 0])
            trig_txt = f"every {lo}-{hi}s"
        else:
            trig_txt = trig.get("t", "?")
        eff_txts.append(f"{v_txt} ({trig_txt})")
    flavor_ja = item.get("i18n", {}).get("ja", {}).get("flavor", "")
    return (
        '<div class="card pilot-item-card">'
        f'<div class="card-name-ja" style="color:{color}">{esc(name_ja)}</div>'
        f'<div class="card-name-en">{esc(name_en)}</div>'
        f'{icon_note}'
        f'<div class="card-chips"><span class="chip">{esc(rarity)}</span>'
        f'<span class="chip chip-mode">modes: {esc(modes)}</span></div>'
        f'<div class="eff">{esc("; ".join(eff_txts))}</div>'
        f'<div class="flavor"><span class="i18n"><span lang="ja">{esc(flavor_ja)}</span>'
        f'<span lang="en">{esc(item.get("flavor", ""))}</span></span></div>'
        "</div>"
    )


ENCOUNTER_TYPE_LABEL = {
    "pack": ("&#9876;", "Battle pack"),
    "trap": ("&#9888;", "Trap (detection)"),
    "door": ("&#128274;", "Door"),
    "chest": ("&#128176;", "Chest"),
    "boss": ("&#128128;", "Boss"),
}


def render_dungeon_sequence(dungeon, enemies_by_id):
    rows = []
    for i, enc in enumerate(dungeon["encounters"], start=1):
        icon, label = ENCOUNTER_TYPE_LABEL.get(enc["type"], ("&#8226;", enc["type"]))
        if "enemyPack" in enc:
            names = []
            for eid in enc["enemyPack"]["enemyIds"]:
                e = enemies_by_id.get(eid)
                names.append(e["name"] if e else eid)
            content = ", ".join(names)
        elif "entityDef" in enc:
            content = enc["entityDef"]["name"]
        else:
            content = ""
        rewards = ", ".join(enc.get("rewardItems", [])) or "-"
        deadline = enc.get("deadline_secs", "-")
        rows.append(
            '<div class="seq-row">'
            f'<div class="seq-step">{i}</div>'
            f'<div class="seq-type">{icon} {esc(label)}</div>'
            f'<div class="seq-content">{esc(content)}</div>'
            f'<div class="seq-deadline">&#8987; {deadline}s</div>'
            f'<div class="seq-reward">{esc(rewards)}</div>'
            "</div>"
        )
    return "".join(rows)


PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8"/><title>{batch_id} preview / プレビュー</title>
<style>
:root {{
  --bg: #14110d; --panel: #1d1912; --panel2: #241f16; --border: #3a3222;
  --text: #e8d9b0; --muted: #8a8270; --gold: #c9a227;
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; padding: 32px; background: var(--bg); color: var(--text); font-family: Georgia, 'Times New Roman', serif; }}
h1 {{ color: var(--gold); letter-spacing: 0.06em; text-transform: uppercase; font-size: 22px;
     border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 24px; }}
h2 {{ color: var(--gold); font-size: 16px; letter-spacing: 0.04em; text-transform: uppercase;
     margin-top: 40px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }}
.meta {{ color: var(--muted); font-size: 13px; margin-bottom: 24px; }}
.pipeline-note {{ background: var(--panel); border: 1px solid var(--gold); border-radius: 6px; padding: 10px 14px;
  font-size: 12px; color: var(--text); margin-bottom: 20px; }}
.gallery {{ display: flex; flex-wrap: wrap; gap: 18px; margin-top: 16px; }}
.card {{ background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; width: 260px;
  display: flex; flex-direction: column; gap: 6px; }}
.icon-placeholder-note {{ font-size: 11px; color: #e0a75f; background: #2a2013; border: 1px solid #5a4413;
  border-radius: 4px; padding: 4px 8px; }}
.card-name-ja {{ font-size: 17px; font-weight: bold; line-height: 1.25; }}
.card-name-en {{ font-size: 11px; color: var(--muted); letter-spacing: 0.02em; }}
.card-chips {{ display: flex; flex-wrap: wrap; gap: 4px; }}
.chip {{ font-size: 10px; padding: 2px 7px; border-radius: 10px; background: var(--panel2);
  border: 1px solid var(--border); color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; }}
.chip-mode {{ color: #7ecbe8; }}
.chip-masked {{ color: #e0a75f; }}
.eff {{ font-size: 12px; line-height: 1.4; color: var(--text); }}
.flavor {{ font-size: 11px; font-style: italic; color: var(--muted); }}

.enemy-card {{ background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px;
  width: 320px; display: flex; flex-direction: column; gap: 8px; }}
.enemy-name {{ font-size: 15px; font-weight: bold; }}
.enemy-meta {{ display: flex; flex-wrap: wrap; gap: 4px; }}
.enemy-skills {{ display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }}
.skill-row {{ background: var(--panel2); border-radius: 6px; padding: 6px 8px; }}
.skill-name {{ font-size: 12px; font-weight: bold; color: var(--text); }}
.skill-id {{ color: var(--muted); font-weight: normal; font-size: 10px; }}
.skill-telegraph {{ margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }}
.tg-chip {{ font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #2a2416; border: 1px solid var(--border); color: var(--text); }}
.tg-status {{ color: #d47ee0; }}
.tg-pen {{ color: #e07a5f; }}
.tg-aoe {{ color: #f4d35e; }}

.formation-gallery {{ display: flex; flex-wrap: wrap; gap: 24px; margin-top: 16px; }}
.formation-card {{ background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; }}
.formation-name {{ font-size: 14px; font-weight: bold; margin-bottom: 8px; }}
.formation-id {{ color: var(--muted); font-weight: normal; font-size: 11px; }}
.formation-note {{ font-size: 11px; color: var(--muted); margin-top: 8px; max-width: 360px; }}
.field-diagram {{ display: block; }}

.seq-list {{ display: flex; flex-direction: column; gap: 6px; margin-top: 16px; }}
.seq-row {{ display: grid; grid-template-columns: 32px 160px 1fr 100px 220px; align-items: center; gap: 10px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-size: 12px; }}
.seq-step {{ color: var(--gold); font-weight: bold; text-align: center; }}
.seq-type {{ color: var(--text); }}
.seq-content {{ color: var(--text); }}
.seq-deadline {{ color: var(--muted); }}
.seq-reward {{ color: #7ecbe8; font-size: 11px; }}

.section-muted {{ opacity: 0.85; }}

.i18n span[lang="en"] {{ display: none; }}
.i18n span[lang="ja"] {{ display: inline; }}
body.lang-en .i18n span[lang="en"] {{ display: inline; }}
body.lang-en .i18n span[lang="ja"] {{ display: none; }}
body.lang-en .card-name-en {{ display: none; }}

#lang-toggle {{
  position: fixed; top: 18px; right: 18px; z-index: 100;
  background: var(--panel); border: 1px solid var(--border); color: var(--text);
  font-size: 20px; line-height: 1; padding: 10px 14px; border-radius: 999px;
  cursor: pointer; box-shadow: 0 2px 10px rgba(0,0,0,0.4); font-family: inherit;
}}
#lang-toggle:hover {{ border-color: var(--gold); }}
</style></head><body>
<button id="lang-toggle" title="Switch language / 言語切り替え" data-lang="ja">\U0001f1ef\U0001f1f5</button>
<h1><span class="i18n"><span lang="ja">{name_ja} -- ダンジョンパイロット プレビュー</span>
<span lang="en">{name_en} -- Dungeon Pilot Preview</span></span></h1>
<div class="meta"><span class="i18n">
<span lang="ja">{batch_id} - tools/build_dungeon_preview.py で生成 - {n_enemies} 体の敵、{n_skills} 件のスキル、{n_entities} 件のトラップ/ドア/チェスト、{n_formations} 種の陣形、{n_encounters} ステップのダンジョン進行</span>
<span lang="en">{batch_id} - generated by tools/build_dungeon_preview.py - {n_enemies} enemies, {n_skills} skills, {n_entities} traps/doors/chests, {n_formations} formations, {n_encounters}-step dungeon sequence</span>
</span></div>
<div class="pipeline-note"><span class="i18n">
<span lang="ja">パイプライン段階: S1-lite（手作業）。S2-S7は未実施（バリデーター無し、アイコン本番アート無し、S7ユーザーレビュー未実施）。content/registry.json には未登録。lockpick / spyglass はプレースホルダーアイコンです。</span>
<span lang="en">Pipeline stage: S1-lite (hand-authored). S2-S7 not yet run (no validator, no final icon art, no S7 user review). Not registered in content/registry.json. lockpick / spyglass carry placeholder icons.</span>
</span></div>

<h2><span class="i18n"><span lang="ja">パイロットプレイヤーアイテム</span><span lang="en">Pilot Player Items</span></span></h2>
<div class="gallery">{items_html}</div>

<h2><span class="i18n"><span lang="ja">敵ロスター</span><span lang="en">Enemy Roster</span></span></h2>
<div class="gallery">{enemies_html}</div>

<h2><span class="i18n"><span lang="ja">トラップ / ドア / チェスト</span><span lang="en">Traps / Doors / Chests</span></span></h2>
<div class="gallery">{entities_html}</div>

<h2><span class="i18n"><span lang="ja">陣形（4種）</span><span lang="en">Formations (4)</span></span></h2>
<div class="formation-gallery">{formations_html}</div>

<h2><span class="i18n"><span lang="ja">ダンジョン進行</span><span lang="en">Dungeon Sequence</span></span></h2>
<div class="seq-list">{sequence_html}</div>

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
    ap = argparse.ArgumentParser(description="Deterministic dungeon-pilot preview page builder")
    ap.add_argument("--batch-dir", required=True, help="e.g. content/batches/batch-002-dungeon-pilot")
    ap.add_argument("--out", required=True, help="output HTML path")
    args = ap.parse_args()

    items = load_json(os.path.join(args.batch_dir, "items.json"))["entries"]
    enemies = load_json(os.path.join(args.batch_dir, "enemies.json"))["entries"]
    skills = load_json(os.path.join(args.batch_dir, "skills.json"))["entries"]
    entities = load_json(os.path.join(args.batch_dir, "entities.json"))["entries"]
    formations = load_json(os.path.join(args.batch_dir, "formations.json"))["entries"]
    dungeon = load_json(os.path.join(args.batch_dir, "dungeon.json"))

    skills_by_id = {s["id"]: s for s in skills}
    enemies_by_id = {e["id"]: e for e in enemies}

    items_html = "".join(render_pilot_item_card(i) for i in items)
    enemies_html = "".join(render_enemy_card(e, skills_by_id) for e in enemies)
    entities_html = "".join(render_entity_card(e, skills_by_id) for e in entities)
    formations_html = "".join(render_formation_diagram(f) for f in formations)
    sequence_html = render_dungeon_sequence(dungeon, enemies_by_id)

    name_ja = dungeon.get("i18n", {}).get("ja", {}).get("name", dungeon["name"])
    name_en = dungeon.get("i18n", {}).get("en", {}).get("name", dungeon["name"])
    batch_id = os.path.basename(os.path.normpath(args.batch_dir))

    html = PAGE_TEMPLATE.format(
        batch_id=esc(batch_id),
        name_ja=esc(name_ja),
        name_en=esc(name_en),
        n_enemies=len(enemies),
        n_skills=len(skills),
        n_entities=len(entities),
        n_formations=len(formations),
        n_encounters=len(dungeon["encounters"]),
        items_html=items_html,
        enemies_html=enemies_html,
        entities_html=entities_html,
        formations_html=formations_html,
        sequence_html=sequence_html,
    )

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)

    print(
        f"Wrote {args.out} ({len(html)} bytes, {len(enemies)} enemies, {len(skills)} skills, "
        f"{len(entities)} entities, {len(formations)} formations, {len(dungeon['encounters'])} encounter steps)"
    )


if __name__ == "__main__":
    main()
