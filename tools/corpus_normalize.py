#!/usr/bin/env python3
"""REQ-0268 / REQ-0271 -- corpus_normalize: parse cached wikitext into one schema.

Stdlib only. Reads data/corpus/raw/<source>/pages/*.json (as written by
corpus_fetch.py) and emits data/corpus/normalized/<source>.json:
    {schema:"corpus/1", source, license, entries:[...]}

Each entry:
    {page, kind, name, rarity_raw, rarity_norm, numbers{...}, effect_text,
     verbs_mapped[], unmapped[], excluded[], tags[]}

Robustness over completeness: a weird page never crashes the run; anything the
parser cannot interpret lands in `unmapped` (or the whole entry is marked
kind="other"). The wikitext parser is deliberately simple -- brace-depth
template extraction plus regex -- no external parser libs.

Reference-only corpus (REQ-0268): the mapping tables below collapse each wiki's
own rarity ladder and effect phrasing onto OUR closed vocab. The vocab
(content/vocab.json) stays the sole authority and is NEVER modified from here.

REQ-0271 -- effect semantics. Four audited normalizer defects fixed:
  (a) Backpack Hero rarity map: the wiki's top tier is 'Legendary' (there is no
      'Relic' rarity on BH); map legendary -> Relic (the old dead 'relic' key
      left 66 Legendary items normalizing to rarity_norm=None).
  (b) Icon markup carries meaning: [[File:Icon X.png|...|alt=NAME|...]] and
      {{Pic|NAME|...}} are SUBSTITUTED by their alt/first-arg text, not deleted
      (was leaving dangling "Gain 1 ." fragments).
  (c) Clause integrity: a trigger header ('''On hit:''', 'Start of battle:',
      'Every Ns:' ...) stays attached to the clause it introduces -- effect
      text is split on sentence terminators (. ;) only, never on ':'.
  (d) Verb mapping is clause-scoped and TARGET-aware (precision over recall):
      `strike` only when the item/skill itself attacks (own Damage stat or
      "deals N damage"); adjacency/aura buffs -> buff_adjacent; damage
      reduction/prevention -> damage_reduction; reflect -> reflect_damage;
      self-directed status ("to self") is never mapped as an enemy debuff.
      When in doubt the clause is LEFT unmapped -- the curated table
      tools/corpus_verb_map.json is the recall layer, applied deterministically
      AFTER this automatic layer (table wins on conflict).
"""
import argparse
import glob
import json
import os
import re
import sys

SCHEMA = "corpus/1"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
RAW_ROOT = os.path.join(REPO, "data", "corpus", "raw")
NORM_ROOT = os.path.join(REPO, "data", "corpus", "normalized")
VERB_MAP_PATH = os.path.join(HERE, "corpus_verb_map.json")

# --- rarity ladders (source tier -> our 4 tiers) ----------------------------
# Our tiers: Common < Uncommon < Rare < Relic (content/vocab.json `rarities`).
# Backpack Hero uses Common < Uncommon < Rare < Legendary (its top tier is
# 'Legendary', NOT 'Relic'); we map its Legendary onto our Relic. Backpack
# Battles has a longer ladder (Common < Rare < Epic < Legendary < Godly, plus
# Unique); we map it rank-preservingly onto our four, collapsing the top rungs
# into Relic. Documented as a corpus design decision -- our vocab is never
# widened to match a source.
RARITY_MAPS = {
    "backpack-hero": {
        "common": "Common", "uncommon": "Uncommon",
        "rare": "Rare", "legendary": "Relic",
    },
    "backpack-battles": {
        "common": "Common", "rare": "Uncommon", "epic": "Rare",
        "legendary": "Relic", "godly": "Relic", "unique": "Relic",
    },
}
OUR_TIERS = ("Common", "Uncommon", "Rare", "Relic")
_RARITY_WORDS = {"common", "uncommon", "rare", "epic", "legendary",
                 "godly", "relic", "unique"}

# --- excluded_attested features (content/vocab.json) -------------------------
# Genre features we deliberately do NOT model. Detected so the corpus records
# them honestly instead of silently dropping the mechanic.
EXCLUDED_KEYS = {"gold_pickup", "mana_conductivity", "energy_cost",
                 "stamina_cost", "shop_reroll", "recipe_craft", "refinery_mod",
                 "accuracy_crit", "charm_status"}

# infobox fields whose value carries effect prose
EFFECT_FIELD_KEYS = {"onuse", "onsummon", "additionalfx", "onhit", "effect",
                     "effects", "onequip", "onopen", "onpickup"}


def strip_wikitext(s):
    """Best-effort wikitext -> plain text.

    Icon markup carries meaning and is SUBSTITUTED, not dropped (REQ-0271):
      [[File:Icon Poison.png|alt=Poison|15x15px]]  -> " Poison "
      {{Pic|BloodAmulet|30}}                       -> " BloodAmulet "
    Non-icon File/Image links (recipe/item art) are still dropped.
    """
    if not s:
        return ""
    t = s
    t = re.sub(r"<!--.*?-->", " ", t, flags=re.S)

    def _file_sub(m):
        body = m.group(0)
        am = re.search(r"alt=([^|\]]+)", body)
        if am:
            return " " + am.group(1).strip() + " "
        # icon file with no alt: recover the name between "Icon " and ".png"
        im = re.search(r":\s*Icon\s+([^.|\]]+)\.png", body, re.I)
        if im:
            return " " + im.group(1).strip() + " "
        return " "  # decorative art (recipe/item image) -> drop
    t = re.sub(r"\[\[(?:File|Image):[^\]]*\]\]", _file_sub, t, flags=re.I)

    # {{Pic|NAME|size}} -> NAME (first positional arg)
    def _pic_sub(m):
        inner = m.group(1)
        first = inner.split("|", 1)[0].strip()
        return " " + first + " " if first else " "
    t = re.sub(r"\{\{Pic\|([^{}]*)\}\}", _pic_sub, t, flags=re.I)

    # [[a|b]] -> b ; [[a]] -> a
    t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    # drop remaining templates {{...}} (a few passes to catch nesting)
    for _ in range(3):
        new = re.sub(r"\{\{[^{}]*\}\}", " ", t)
        if new == t:
            break
        t = new
    t = t.replace("'''", "").replace("''", "")
    t = re.sub(r"<[^>]+>", " ", t)
    t = t.replace("[[", " ").replace("]]", " ")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _extract_braced(text, start):
    """Given text[start:start+2]=='{{', return (inner, index_after_close)."""
    depth = 0
    i = start
    n = len(text)
    while i < n - 1:
        two = text[i:i + 2]
        if two == "{{":
            depth += 1
            i += 2
            continue
        if two == "}}":
            depth -= 1
            i += 2
            if depth == 0:
                return text[start + 2:i - 2], i
            continue
        i += 1
    return None, n


def _split_top_level(inner, sep="|"):
    """Split on `sep` at brace/bracket depth 0 (keeps nested templates whole)."""
    parts = []
    buf = []
    dc = 0
    db = 0
    i = 0
    n = len(inner)
    while i < n:
        two = inner[i:i + 2]
        if two == "{{":
            dc += 1
            buf.append(two)
            i += 2
            continue
        if two == "}}":
            dc -= 1
            buf.append(two)
            i += 2
            continue
        if two == "[[":
            db += 1
            buf.append(two)
            i += 2
            continue
        if two == "]]":
            db -= 1
            buf.append(two)
            i += 2
            continue
        ch = inner[i]
        if ch == sep and dc == 0 and db == 0:
            parts.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return parts


def _split_template_fields(inner):
    segs = _split_top_level(inner, "|")
    name = segs[0].strip()
    fields = {}
    for seg in segs[1:]:
        if "=" in seg:
            k, v = seg.split("=", 1)
            fields[k.strip()] = v.strip()
    return name, fields


def parse_infobox(wikitext):
    """Return (template_name, fields) for the first infobox/item template."""
    if not wikitext:
        return None, {}
    for m in re.finditer(r"\{\{", wikitext):
        inner, _end = _extract_braced(wikitext, m.start())
        if inner is None:
            continue
        name, fields = _split_template_fields(inner)
        low = name.lower().replace(" ", "_")
        # match: any *infobox*; any *item_template* (Item_Template, BPB_Item_Template,
        # "Item Template"); and Backpack Hero's bare {{Item}} card. NOT {{Items Navbox}}
        # / {{AddItem}} (name is not exactly "item" and has no item_template/infobox).
        if "infobox" in low or "item_template" in low or low == "item":
            return name, fields
    return None, {}


def parse_range(s):
    """Parse '4-8', '1.6s', '90%', '12' -> [lo, hi] (or None)."""
    if s is None:
        return None
    txt = str(s)
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)",
                  txt)
    if m:
        lo, hi = float(m.group(1)), float(m.group(2))
        return [min(lo, hi), max(lo, hi)]
    m = re.search(r"-?\d+(?:\.\d+)?", txt)
    if m:
        v = float(m.group(0))
        return [v, v]
    return None


def rarity_from_categories(categories):
    for c in categories:
        name = c.split(":", 1)[-1].strip().lower()
        if name in _RARITY_WORDS:
            return name.capitalize()
    return None


def map_rarity(rarity_raw, source):
    if not rarity_raw:
        return None
    key = str(rarity_raw).strip().lower()
    table = RARITY_MAPS.get(source, {})
    if key in table:
        return table[key]
    # fall back to a direct match on our own tiers
    for tier in OUR_TIERS:
        if key == tier.lower():
            return tier
    return None


def _has_damage_field(fields):
    for k in ("Damage", "damage"):
        v = fields.get(k)
        if v and parse_range(v) is not None:
            return True
    return False


def extract_numbers(fields, effect_text, source):
    nums = {"damage": None, "cadence_secs": None, "hp": None,
            "armor": None, "heal": None, "price": None}

    def field(*keys):
        for k in keys:
            if k in fields and str(fields[k]).strip():
                return fields[k]
        return None

    nums["damage"] = parse_range(field("Damage", "damage"))
    nums["cadence_secs"] = parse_range(field("Cooldown", "cooldown"))
    nums["hp"] = parse_range(field("HP", "hp", "Health", "health"))
    nums["armor"] = parse_range(field("Armor", "armor", "Armour", "Block"))
    nums["price"] = parse_range(field("Cost", "cost", "Cost of components",
                                       "buy", "Buy"))

    # Backpack Hero has no cooldown model (energy-gated); recover damage /
    # cadence from the effect prose instead.
    if nums["damage"] is None:
        m = re.search(r"deals?\s+(\d+(?:\.\d+)?)\s+damage", effect_text, re.I)
        if not m:
            m = re.search(r"(\d+(?:\.\d+)?)\s+damage", effect_text, re.I)
        if m:
            v = float(m.group(1))
            nums["damage"] = [v, v]
    if nums["cadence_secs"] is None:
        m = re.search(r"every\s+(\d+(?:\.\d+)?)\s*s\b", effect_text, re.I)
        if m:
            v = float(m.group(1))
            nums["cadence_secs"] = [v, v]
    if nums["heal"] is None:
        m = re.search(r"heals?(?:\s+for)?\s+(\d+(?:\.\d+)?)", effect_text, re.I)
        if m:
            v = float(m.group(1))
            nums["heal"] = [v, v]
    return nums


# --- clause-scoped, target-aware verb mapper (REQ-0271 defect d) ------------
def split_clauses(effect_text):
    """Split effect text into clauses on sentence terminators (. ;) only.

    Never split on ':' -- a trigger header ('On hit:', 'Start of battle:',
    'Every 3s:') must stay attached to the clause it introduces so an unmapped
    phrase is a complete `trigger: clause` unit or a complete sentence."""
    parts = re.split(r"(?<=[.;])\s+", effect_text)
    return [p.strip() for p in parts if p.strip()]


def _clause_verbs(clause):
    """Closed-vocab verbs for ONE clause, target-aware. Precision over recall:
    a clause we are not confident about contributes NO verb (it stays unmapped
    for the curated table to classify)."""
    low = clause.lower()
    verbs = []

    def add(v):
        if v not in verbs:
            verbs.append(v)

    self_dir = bool(re.search(r"\bto self\b|\bto yourself\b|\bto your\b", low))
    enemy_dir = bool(re.search(r"\benem(?:y|ies)\b|\bopponent\b", low))
    adj_dir = bool(re.search(
        r"\badjacent\b|\bdiagonal\b|\bin this row\b|\bin this column\b"
        r"|\bin front\b|\bitems? inside\b|\ball weapons?\b|\ball armou?r\b"
        r"|\ball consumables?\b|\bweapons? in\b|\bconnected\b|\bitems? in this\b",
        low))

    # damage reduction / prevention -- checked before strike so a "damage"
    # mention here is never read as the item attacking.
    if re.search(r"reduce\s+damage|damage\s+taken|damage\s+reduction"
                 r"|prevent\s+\d+(?:\.\d+)?\s+damage|prevent\s+a\s+hit"
                 r"|reduced\s+by\s+\d+\s*%", low):
        add("damage_reduction")

    # reflect / thorns
    if re.search(r"\breflect|\bthorns?\b", low):
        add("reflect_damage")

    # adjacency / aura buff to OTHER items (Citrine "adjacent item gets +N
    # Damage" is buff_adjacent, not the crystal attacking).
    if adj_dir and re.search(
            r"\bgets?\s*[+\-]|\bget\s+this\s+effect|\+\d|\bbonus\s+damage\b"
            r"|trigger[s]?\s+\d+%\s+faster|\bfaster\b", low):
        add("buff_adjacent")

    # strike: the item/skill ITSELF deals damage ("deals N damage").
    if re.search(r"\bdeals?\s+[+]?\d+(?:\.\d+)?\s+damage\b", low):
        add("strike")

    # multi-strike
    if re.search(r"\bmulti[- ]?strike\b|\battacks?\s+twice\b|\bhits?\s+twice\b"
                 r"|\b\d+\s+times\b", low):
        add("multi_strike")

    # block (Adds/gain N block)
    if re.search(r"\bblock\b", low):
        add("block")

    # heal
    if re.search(r"\bheals?\b", low):
        add("heal_ally")

    # cleanse
    if re.search(r"\bcleanse\b", low):
        add("cleanse")

    # lifesteal / steal life
    if re.search(r"\bvampiris|\blifesteal|\bleech|\bsteal\s+\d+\s+life"
                 r"|steals?\s+.*\blife\b|life\s+through", low):
        add("lifesteal")

    # haste (self attack-speed / Haste status)
    if re.search(r"\bhaste\b|attack\s+speed|attacks?\s+\d+%\s+faster"
                 r"|\bspeed\s+up\b", low):
        add("haste")

    # slow the enemy -- NEVER a self-directed Slow ("Adds 1 Slow to self").
    if re.search(r"\bslow\b", low) and not self_dir:
        add("slow_enemy")

    # inflict a status on the OPPONENT
    debuff = re.search(r"\bpoison|\bburn|\bweak(?:ness)?\b|\bchill|\bfreeze"
                       r"|\bblind|\bstun", low)
    if re.search(r"\binflict\b", low) or (debuff and enemy_dir):
        add("apply_status")

    return verbs


def map_verbs(effect_text, has_damage_field=False):
    """Automatic (precision-first) layer. Returns (verbs, unmapped)."""
    verbs = []
    unmapped = []
    if has_damage_field:
        verbs.append("strike")  # a weapon with its own Damage stat attacks
    if not effect_text:
        return verbs, unmapped
    for clause in split_clauses(effect_text):
        cv = _clause_verbs(clause)
        if cv:
            for v in cv:
                if v not in verbs:
                    verbs.append(v)
        elif re.search(r"[a-z]", clause.lower()):
            unmapped.append(clause)
    return verbs, unmapped


# --- curated mapping table (REQ-0271 Proposal item 3) -----------------------
def load_verb_map(path=VERB_MAP_PATH):
    """Load tools/corpus_verb_map.json entries (recall layer). Empty if absent
    so the pipeline still runs before the table is authored."""
    if not path or not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            doc = json.load(f)
    except Exception:  # noqa: BLE001
        return []
    return doc.get("entries", []) or []


_VERB_MAP = load_verb_map()


def _norm_phrase(s):
    return re.sub(r"\s+", " ", str(s)).strip().lower()


def match_table_entry(clause, table):
    """First matching table entry for `clause` (deterministic: table order)."""
    c = _norm_phrase(clause)
    if not c:
        return None
    for entry in table:
        pat = _norm_phrase(entry.get("phrase", ""))
        if not pat:
            continue
        mode = entry.get("match", "exact")
        if mode == "exact" and c == pat:
            return entry
        if mode == "prefix" and c.startswith(pat):
            return entry
        if mode == "contains" and pat in c:
            return entry
    return None


def apply_verb_map(verbs, unmapped, table):
    """Apply the curated table to the auto-layer residual. class=verb adds its
    (closed-vocab) verbs; excluded/no_model/noise are ACCOUNTED-FOR and removed
    from `unmapped`. Table wins on conflict; deterministic in table order."""
    if not table:
        return list(verbs), list(unmapped)
    out_verbs = list(verbs)
    still = []
    for clause in unmapped:
        entry = match_table_entry(clause, table)
        if entry is None:
            still.append(clause)
            continue
        if entry.get("class") == "verb":
            for v in entry.get("verbs", []) or []:
                if v not in out_verbs:
                    out_verbs.append(v)
        # excluded / no_model / noise: recognised, dropped from unmapped
    return out_verbs, still


def detect_excluded(fields, effect_text, categories):
    # scan field KEYS too: a `Stamina_cost` / `Recipe_image` / `Accuracy`
    # field is itself the mechanic, even when its value is terse.
    blob = " ".join(str(k) for k in fields.keys())
    blob += " " + " ".join(str(v) for v in fields.values())
    blob += " " + effect_text + " " + " ".join(categories)
    blob = blob.lower()
    found = set()
    if "energy" in blob:
        found.add("energy_cost")
    if "stamina" in blob:
        found.add("stamina_cost")
    if "accuracy" in blob or "crit" in blob or re.search(r"\bmiss\b", blob):
        found.add("accuracy_crit")
    if ("recipe" in blob or "combin" in blob or "craft" in blob
            or "cost of components" in blob):
        found.add("recipe_craft")
    if "reroll" in blob or "reserve" in blob:
        found.add("shop_reroll")
    if "refinery" in blob:
        found.add("refinery_mod")
    if "charm" in blob:
        found.add("charm_status")
    if re.search(r"\bgold\b", blob) or re.search(r"\bcoins?\b", blob):
        found.add("gold_pickup")
    if "conductiv" in blob or "mana stone" in blob:
        found.add("mana_conductivity")
    return sorted(found & EXCLUDED_KEYS)


def derive_tags(fields, categories):
    tags = []

    def add(val):
        for piece in re.split(r"[,/]", str(val)):
            t = piece.strip()
            if t and t not in tags:
                tags.append(t)

    for k in ("type", "Type", "Extra Type", "extraType"):
        if k in fields and fields[k]:
            add(strip_wikitext(fields[k]))
    for c in categories:
        name = c.split(":", 1)[-1].strip()
        low = name.lower()
        if low in _RARITY_WORDS or low in ("items", "item"):
            continue
        if name and name not in tags:
            tags.append(name)
    return tags


def classify_kind(template_name, fields, categories):
    tn = (template_name or "").lower()
    cats = " ".join(categories).lower()
    tn_us = tn.replace(" ", "_")
    has_box = ("infobox" in tn or "item_template" in tn_us or tn.strip() == "item")
    if "monster" in tn or "enemy" in cats or "bestiary" in cats:
        return "enemy"
    if has_box and ("skill" in tn or "ability" in tn):
        return "skill"
    if has_box:
        return "item"
    return "other"


def normalize_page(page, source, verb_map=None):
    wikitext = page.get("wikitext", "") or ""
    categories = page.get("categories", []) or []
    title = page.get("title", "") or ""
    tname, fields = parse_infobox(wikitext)

    eff_parts = []
    for k, v in fields.items():
        kl = k.lower().replace(" ", "").replace("_", "")
        if kl in {ek.replace("_", "") for ek in EFFECT_FIELD_KEYS} or \
                kl.startswith("itemeffect"):
            if v:
                eff_parts.append(v)
    effect_text = strip_wikitext("  ".join(eff_parts))

    rarity_raw = fields.get("rarity") or fields.get("Rarity")
    rarity_raw = strip_wikitext(rarity_raw).strip() if rarity_raw else None
    if not rarity_raw:
        rarity_raw = rarity_from_categories(categories)
    rarity_norm = map_rarity(rarity_raw, source)

    numbers = extract_numbers(fields, effect_text, source)
    verbs_mapped, unmapped = map_verbs(effect_text, _has_damage_field(fields))
    table = _VERB_MAP if verb_map is None else verb_map
    verbs_mapped, unmapped = apply_verb_map(verbs_mapped, unmapped, table)
    excluded = detect_excluded(fields, effect_text, categories)
    kind = classify_kind(tname, fields, categories)
    tags = derive_tags(fields, categories)
    name = (fields.get("title") or fields.get("Item_name")
            or fields.get("name") or title)

    return {
        "page": title,
        "kind": kind,
        "name": name,
        "rarity_raw": rarity_raw,
        "rarity_norm": rarity_norm,
        "numbers": numbers,
        "effect_text": effect_text,
        "verbs_mapped": verbs_mapped,
        "unmapped": unmapped,
        "excluded": excluded,
        "tags": tags,
    }


def _blank_entry(title, note):
    return {
        "page": title, "kind": "other", "name": title,
        "rarity_raw": None, "rarity_norm": None,
        "numbers": {"damage": None, "cadence_secs": None, "hp": None,
                    "armor": None, "heal": None, "price": None},
        "effect_text": "", "verbs_mapped": [], "unmapped": [note],
        "excluded": [], "tags": [],
    }


def load_source(source, raw_root):
    src_dir = os.path.join(raw_root, source)
    pages_dir = os.path.join(src_dir, "pages")
    manifest = {}
    mp = os.path.join(src_dir, "manifest.json")
    if os.path.exists(mp):
        with open(mp, encoding="utf-8") as f:
            manifest = json.load(f)
    entries = []
    for path in sorted(glob.glob(os.path.join(pages_dir, "*.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                page = json.load(f)
        except Exception as e:  # noqa: BLE001
            entries.append(_blank_entry(os.path.basename(path),
                                        "<read error: %s>" % str(e)[:100]))
            continue
        try:
            entries.append(normalize_page(page, source))
        except Exception as e:  # noqa: BLE001 -- never crash on a weird page
            entries.append(_blank_entry(page.get("title", path),
                                        "<parse error: %s>" % str(e)[:100]))
    entries.sort(key=lambda e: (e["page"], e["name"]))
    return manifest, entries


def normalize_source(source, raw_root, out_root):
    manifest, entries = load_source(source, raw_root)
    doc = {
        "schema": SCHEMA,
        "source": source,
        "license": manifest.get("license", "CC-BY-SA"),
        "endpoint": manifest.get("endpoint", ""),
        "fetch_date": manifest.get("fetch_date", ""),
        "entries": entries,
    }
    os.makedirs(out_root, exist_ok=True)
    out_path = os.path.join(out_root, "%s.json" % source)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
    kinds = {}
    mapped = unmapped = 0
    with_unmapped = 0
    for e in entries:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
        mapped += len(e["verbs_mapped"])
        unmapped += len(e["unmapped"])
        if e["unmapped"]:
            with_unmapped += 1
    print("[%s] entries=%d kinds=%s verbs_mapped=%d unmapped_phrases=%d "
          "entries_with_unmapped=%d -> %s"
          % (source, len(entries), kinds, mapped, unmapped, with_unmapped,
             out_path))
    return doc


def main(argv=None):
    ap = argparse.ArgumentParser(description="Normalize cached wiki corpus.")
    ap.add_argument("--source", default="all",
                    help="source name or 'all' (default all)")
    ap.add_argument("--raw", default=RAW_ROOT, help="raw corpus root")
    ap.add_argument("--out", default=NORM_ROOT, help="normalized output root")
    args = ap.parse_args(argv)
    if args.source == "all":
        names = [d for d in sorted(os.listdir(args.raw))
                 if os.path.isdir(os.path.join(args.raw, d))] \
            if os.path.isdir(args.raw) else []
        if not names:
            print("no sources found under %s" % args.raw, file=sys.stderr)
            return 1
    else:
        names = [args.source]
    for name in names:
        normalize_source(name, args.raw, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
