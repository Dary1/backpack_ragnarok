#!/usr/bin/env python3
"""REQ-0268 -- corpus_normalize: parse cached wikitext into one schema.

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

# --- rarity ladders (source tier -> our 4 tiers) ----------------------------
# Our tiers: Common < Uncommon < Rare < Relic (content/vocab.json `rarities`).
# Backpack Hero uses exactly those four. Backpack Battles has a FIVE-rung ladder
# (Common < Rare < Epic < Legendary < Godly); we map it rank-preservingly onto
# our four, collapsing the top two (Legendary, Godly) into Relic. Documented as
# a corpus design decision -- our vocab is never widened to match a source.
RARITY_MAPS = {
    "backpack-hero": {
        "common": "Common", "uncommon": "Uncommon",
        "rare": "Rare", "relic": "Relic",
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

# --- effect phrase -> our closed verb (confident keyword mappings only) ------
# Only high-confidence keyword hits map. Everything else stays in `unmapped`
# with its raw phrase text. multi_strike is tested before strike.
VERB_KEYWORDS = [
    (re.compile(r"\bvampiris|\blifesteal|\bleech"), "lifesteal"),
    (re.compile(r"\bthorns?\b|\breflect"), "reflect_damage"),
    (re.compile(r"\bmulti[- ]?strike|\b\d+\s+times"), "multi_strike"),
    (re.compile(r"\bdamage\b"), "strike"),
    (re.compile(r"\bheal"), "heal_ally"),
    (re.compile(r"\bblock\b"), "block"),
    (re.compile(r"\bshield\b"), "grant_shield"),
    (re.compile(r"\bcleanse\b"), "cleanse"),
    (re.compile(r"\bhaste|\battack speed|\bspeed up"), "haste"),
    (re.compile(r"\bweaken?\b|\bslow\b"), "slow_enemy"),
    (re.compile(r"\bpoison|\bburn|\bblind|\bstun|\bfreeze"), "apply_status"),
]

# infobox fields whose value carries effect prose
EFFECT_FIELD_KEYS = {"onuse", "onsummon", "additionalfx", "onhit", "effect",
                     "effects", "onequip", "onopen", "onpickup"}


def strip_wikitext(s):
    """Best-effort wikitext -> plain text (drops file links/templates/markup)."""
    if not s:
        return ""
    t = s
    t = re.sub(r"<!--.*?-->", " ", t, flags=re.S)
    # drop File/Image links entirely (decorative status icons etc.)
    t = re.sub(r"\[\[(?:File|Image):[^\]]*\]\]", " ", t, flags=re.I)
    # [[a|b]] -> b ; [[a]] -> a
    t = re.sub(r"\[\[[^\]|]*\|([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    # drop templates {{...}} (two passes to catch one level of nesting)
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


def map_verbs(effect_text):
    verbs = []
    unmapped = []
    if not effect_text:
        return verbs, unmapped
    phrases = re.split(r"(?<=[.;:])\s+|\n+", effect_text)
    for ph in phrases:
        p = ph.strip()
        if not p:
            continue
        low = p.lower()
        matched = []
        for rx, verb in VERB_KEYWORDS:
            if rx.search(low) and verb not in matched:
                matched.append(verb)
        if matched:
            for v in matched:
                if v not in verbs:
                    verbs.append(v)
        elif re.search(r"[a-z]", low):
            unmapped.append(p)
    return verbs, unmapped


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


def normalize_page(page, source):
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
    verbs_mapped, unmapped = map_verbs(effect_text)
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
    for e in entries:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
        mapped += len(e["verbs_mapped"])
        unmapped += len(e["unmapped"])
    print("[%s] entries=%d kinds=%s verbs_mapped=%d unmapped_phrases=%d -> %s"
          % (source, len(entries), kinds, mapped, unmapped, out_path))
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
