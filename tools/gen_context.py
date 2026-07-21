#!/usr/bin/env python3
"""REQ-0272 -- generation context pack builder (stdlib only).

Assembles the CONTEXT PACK an LLM (Claude in chat, or a future scheduled job)
reads before drafting a content candidate for a requested slot. This is the
S1 (Draft) grounding half of the pipeline: it does not generate content, it
gathers the constraints + genre exemplars + live neighbors a drafter needs so
the candidate lands in-vocab and in-band on the first try.

Usage:
  tools/gen_context.py --kind item|skill|enemy --rarity <tier>
      [--verb <verb>] [--theme <substr>] [--format md|json] [--out FILE]

A pack has three parts:
  CONSTRAINTS      -- exact schema fields (with dialect casing), the closed
                      verb/trigger vocab for the kind, the DO-NOT token list
                      (excluded_attested + deprecated), the rarity band limit
                      (corpus_stats warn_hi + basis) and the dps-proxy formula.
  GENRE EXEMPLARS  -- 5-10 reference-corpus entries for the rarity tier,
                      preferring entries with mapped verbs, falling back to
                      entries carrying a damage number (the fallback is noted).
  LIVE NEIGHBORS   -- 3-5 live defs of the same kind (+rarity where the dialect
                      has one), full JSON trimmed of gen_* art fields.

Determinism: no timestamps, stable sort keys throughout, so the same slot
inputs yield a byte-identical pack. The md format is what a human/LLM reads;
json is machine-consumable.

Dependency-free, Python stdlib only.
"""
import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

VOCAB_PATH = os.path.join(REPO, "content", "vocab.json")
STATS_PATH = os.path.join(REPO, "content", "corpus_stats.json")
CORPUS_GLOB = os.path.join(REPO, "data", "corpus", "normalized", "*.json")

DAMAGE_VERBS = ["strike", "multi_strike", "charge_strike"]
MIN_EXEMPLARS = 5
MAX_EXEMPLARS = 10
MAX_NEIGHBORS = 5

# Per-kind schema dialect + slot metadata. The dialect rows MIRROR the single
# source of truth, server/services/content_checks.cjs DIALECTS (po/2 = default:
# Capitalized rarity, name field `name`; skill/1: exact-case rarity, name field
# `name_en`, no rarity in practice; enemy/1: LOWERCASE rarity, `hp` is an
# integer roll range). tools/candidate_gate.cjs enforces the same table at
# gate time; this file only DISPLAYS it so a drafter writes the right casing.
KIND_META = {
    "item": {
        "schema": "po/2",
        "dialect": {"rarity_case": "exact", "name_field": "name", "range_fields": []},
        "domain": "PO",
        "has_rarity": True,
        "live": os.path.join(REPO, "content", "live", "live_items.json"),
        "live_schema": "po/2",
        "fields": [
            ("id", True, "unique string id"),
            ("name", True, "display name (EN)"),
            ("i18n.ja.name", True, "Japanese name (pipeline rule: MANDATORY on every live entry)"),
            ("rarity", True, "one of Common|Uncommon|Rare|Relic (Capitalized -- po/2 dialect)"),
            ("tags", True, "array of po_tags; tags[0] is the type root (a null-parent po_tag)"),
            ("shape", True, "non-empty array of [row,col] cells (the polyomino footprint)"),
            ("effects", True, "array of {trigger, verb, cond?}; closed-vocab effect AST"),
            ("sockets", False, "array of {t, tags?, ax?, ay?} socket seats"),
            ("stretch", False, "boolean; icon may fill its cell footprint"),
        ],
    },
    "skill": {
        "schema": "skill/1",
        "dialect": {"rarity_case": "exact", "name_field": "name_en", "range_fields": []},
        "domain": "EnemySkill",
        "has_rarity": False,
        "live": os.path.join(REPO, "content", "live", "dungeon", "skills.json"),
        "live_schema": "skill/1",
        "fields": [
            ("id", True, "unique string id"),
            ("name_en", True, "display name EN (skill/1 dialect spells the name `name_en`, not `name`)"),
            ("name_ja", True, "display name JA"),
            ("trigger", True, "{t, s?}; when the skill fires (top-level, not an effects[] array)"),
            ("verb", True, "{t, n?, status?}; what it does"),
            ("attack_profile", True, "{direction, edge[], aoe, penetration, aoe_statuses}"),
            ("modes", False, 'array, e.g. ["battle"]'),
        ],
    },
    "enemy": {
        "schema": "enemy/1",
        "dialect": {"rarity_case": "lower", "name_field": "name", "range_fields": ["hp"]},
        "domain": "EnemySkill",
        "has_rarity": True,
        "live": os.path.join(REPO, "content", "live", "dungeon", "enemies.json"),
        "live_schema": "enemy/1",
        "fields": [
            ("id", True, "unique string id"),
            ("name", True, "display name; i18n.en.name / i18n.ja.name also carried (dungeon {en,ja} dialect)"),
            ("rarity", True, "one of common|uncommon|rare|relic (LOWERCASE -- enemy/1 dialect)"),
            ("hp", True, "[lo,hi] INTEGER roll range, lo<=hi (enemy/1 range field)"),
            ("footprint", True, "[fh,fw] positive integers (grid cells occupied)"),
            ("skills", True, "array of skill ids (each must resolve to a live skill/1 def)"),
            ("pack_role", False, 'e.g. "line" | "backline"'),
        ],
    },
}

DPS_PROXY_FORMULA = (
    "dps_proxy(def) = SUM over effects that are BOTH a damage verb "
    "(strike|multi_strike|charge_strike) AND an every_secs trigger of "
    "(verb.n midpoint / trigger.s midpoint). Effects that are not a damage "
    "verb, or not on an every_secs cadence, contribute nothing (the proxy "
    "speaks only to sustained tick DPS, which is what the corpus bands measure)."
)


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def cap_rarity(r):
    """Normalize a rarity token to the Capitalized corpus/band key."""
    return r[:1].upper() + r[1:].lower() if r else r


def load_corpus_entries():
    """Every normalized corpus entry, tagged with its source. Sorted by
    (source, page) for a stable base ordering."""
    out = []
    for path in sorted(glob.glob(CORPUS_GLOB)):
        try:
            doc = load_json(path)
        except (OSError, ValueError):
            continue
        src = doc.get("source") or os.path.splitext(os.path.basename(path))[0]
        for e in doc.get("entries", []):
            e = dict(e)
            e["source"] = src
            out.append(e)
    out.sort(key=lambda e: (e.get("source", ""), str(e.get("page", ""))))
    return out


def trim_gen_fields(obj):
    """Recursively drop gen_* art fields from a live def (deterministic)."""
    if isinstance(obj, dict):
        return {k: trim_gen_fields(v) for k, v in obj.items() if not k.startswith("gen_")}
    if isinstance(obj, list):
        return [trim_gen_fields(v) for v in obj]
    return obj


def trim_text(s, limit=200):
    if not s:
        return ""
    s = " ".join(str(s).split())
    return s if len(s) <= limit else s[: limit - 1] + "…"


def build_constraints(kind, rarity, meta, vocab, stats):
    domain = meta["domain"]
    tdomains = vocab.get("trigger_domains", {})
    allowed_triggers = [t for t in vocab.get("triggers", []) if domain in tdomains.get(t, [])]
    deprecated = sorted(k for k in vocab.get("deprecated", {}) if k != "_doc")
    allowed_verbs = [v for v in vocab.get("verbs", []) if v not in deprecated]
    excluded = sorted(vocab.get("excluded_attested", {}).keys())

    # Band limit: corpus_stats bands are keyed by the Capitalized rarity token.
    R = cap_rarity(rarity)
    bands = stats.get("bands", {})
    band = bands.get(R)
    if band and isinstance(band.get("warn_hi"), (int, float)):
        band_info = {
            "rarity": R,
            "warn_hi": band["warn_hi"],
            "basis": band.get("basis"),
            "ratio": band.get("ratio"),
            "provisional": True,
            "source": "content/corpus_stats.json bands",
        }
    else:
        ceil = (vocab.get("dps_ceiling_warn") or {}).get(R)
        band_info = {
            "rarity": R,
            "warn_hi": ceil,
            "basis": "vocab_fallback",
            "ratio": None,
            "provisional": True,
            "source": "content/vocab.json dps_ceiling_warn",
        }

    return {
        "schema": meta["schema"],
        "dialect": meta["dialect"],
        "fields": [{"field": f, "required": req, "note": note} for (f, req, note) in meta["fields"]],
        "domain": domain,
        "allowed_triggers": allowed_triggers,
        "allowed_verbs": allowed_verbs,
        "damage_verbs": DAMAGE_VERBS,
        "do_not": {"excluded_attested": excluded, "deprecated": deprecated},
        "band": band_info,
        "dps_proxy_formula": DPS_PROXY_FORMULA,
    }


def select_exemplars(kind, rarity, entries, verb, theme):
    R = cap_rarity(rarity)
    slot = [e for e in entries if e.get("rarity_norm") == R]
    with_verbs = [e for e in slot if e.get("verbs_mapped")]
    with_dmg = [e for e in slot if (e.get("numbers") or {}).get("damage")]

    notes = []
    if with_verbs:
        base = list(with_verbs)
        fallback = False
        if len(base) < MIN_EXEMPLARS:
            seen = {(e.get("source"), e.get("page")) for e in base}
            extra = [e for e in with_dmg if (e.get("source"), e.get("page")) not in seen]
            if extra:
                base += extra
                notes.append(
                    "exemplar set topped up with damage-number entries (fewer than %d mapped-verb "
                    "entries for this slot)" % MIN_EXEMPLARS
                )
    else:
        base = list(with_dmg)
        fallback = True
        notes.append(
            "FALLBACK: no corpus entries with mapped verbs for this slot; exemplars are entries "
            "carrying a damage number instead (verb mapping is still being enriched -- REQ-0271)"
        )

    if verb:
        base = [e for e in base if verb in (e.get("verbs_mapped") or [])]
        notes.append('exemplars filtered to verb "%s"' % verb)
    if theme:
        tl = theme.lower()
        base = [e for e in base if tl in (str(e.get("name", "")) + " " + str(e.get("effect_text", ""))).lower()]
        notes.append('exemplars filtered to theme substring "%s"' % theme)

    # Deterministic ranking: most mapped verbs first, then name, then source.
    base.sort(key=lambda e: (-len(e.get("verbs_mapped") or []), str(e.get("name", "")), str(e.get("source", ""))))

    exemplars = []
    for e in base[:MAX_EXEMPLARS]:
        nums = e.get("numbers") or {}
        exemplars.append({
            "name": e.get("name"),
            "source": e.get("source"),
            "rarity_norm": e.get("rarity_norm"),
            "numbers": {k: nums.get(k) for k in ("damage", "cadence_secs", "hp", "price") if nums.get(k) is not None},
            "verbs_mapped": e.get("verbs_mapped") or [],
            "effect_text": trim_text(e.get("effect_text")),
        })
    return exemplars, fallback, notes


def select_live_neighbors(kind, rarity, meta):
    try:
        doc = load_json(meta["live"])
    except (OSError, ValueError):
        return [], ["live file not found: " + os.path.relpath(meta["live"], REPO)]
    entries = doc.get("entries", [])
    notes = []
    if kind == "item":
        pool = [e for e in entries if e.get("rarity") == cap_rarity(rarity)]
        if not pool:
            notes.append("no live item of rarity %s (live_items has %s)"
                         % (cap_rarity(rarity), sorted({str(e.get("rarity")) for e in entries})))
    elif kind == "enemy":
        pool = [e for e in entries if str(e.get("rarity", "")).lower() == rarity.lower()]
        if not pool:
            notes.append("no live enemy of rarity %s" % rarity.lower())
    else:  # skill: skill/1 carries no rarity dimension
        pool = list(entries)
        notes.append("skill/1 carries no rarity field; neighbors are representative live skills (any tier)")

    pool = sorted(pool, key=lambda e: str(e.get("id", "")))
    neighbors = [trim_gen_fields(e) for e in pool[:MAX_NEIGHBORS]]
    return neighbors, notes


def build_pack(kind, rarity, verb, theme):
    vocab = load_json(VOCAB_PATH)
    stats = load_json(STATS_PATH)
    meta = KIND_META[kind]
    constraints = build_constraints(kind, rarity, meta, vocab, stats)
    entries = load_corpus_entries()
    exemplars, fallback, ex_notes = select_exemplars(kind, rarity, entries, verb, theme)
    neighbors, nb_notes = select_live_neighbors(kind, rarity, meta)

    notes = [
        "Genre corpus is item-based (Backpack Battles / Backpack Hero). Exemplars ground the "
        "damage/cadence magnitudes for the %s tier; they are reference items, not our-schema %s entries."
        % (cap_rarity(rarity), kind),
    ]
    notes += ex_notes + nb_notes
    return {
        "schema": "gen_context/1",
        "slot": {"kind": kind, "rarity": rarity, "verb": verb, "theme": theme},
        "constraints": constraints,
        "exemplars": exemplars,
        "exemplar_fallback": fallback,
        "live_neighbors": neighbors,
        "notes": notes,
    }


def render_md(pack):
    slot = pack["slot"]
    c = pack["constraints"]
    L = []
    filt = []
    if slot.get("verb"):
        filt.append("verb=" + slot["verb"])
    if slot.get("theme"):
        filt.append('theme="' + slot["theme"] + '"')
    L.append("# Generation Context Pack -- %s / %s%s"
             % (slot["kind"], slot["rarity"], ("  (" + ", ".join(filt) + ")" if filt else "")))
    L.append("")
    L.append("_Generated by tools/gen_context.py (REQ-0272). Deterministic; grounds S1 drafting._")
    L.append("")

    L.append("## CONSTRAINTS")
    L.append("")
    L.append("### Schema fields -- `%s` (%s dialect)" % (c["schema"], c["dialect"].get("name_field")))
    for f in c["fields"]:
        L.append("- `%s` (%s) -- %s" % (f["field"], "required" if f["required"] else "optional", f["note"]))
    rf = c["dialect"].get("range_fields") or []
    L.append("- dialect: rarity_case=%s, name_field=%s, range_fields=%s"
             % (c["dialect"]["rarity_case"], c["dialect"]["name_field"], (", ".join(rf) if rf else "none")))
    L.append("")
    L.append("### Closed vocabulary (domain %s)" % c["domain"])
    L.append("- allowed triggers: %s" % ", ".join("`%s`" % t for t in c["allowed_triggers"]))
    vmarks = ["`%s`%s" % (v, "*" if v in c["damage_verbs"] else "") for v in c["allowed_verbs"]]
    L.append("- allowed verbs (`*` = damage verb): %s" % ", ".join(vmarks))
    L.append("")
    L.append("### DO-NOT emit these tokens")
    L.append("- excluded_attested: %s" % (", ".join(c["do_not"]["excluded_attested"]) or "(none)"))
    L.append("- deprecated: %s" % (", ".join(c["do_not"]["deprecated"]) or "(none)"))
    L.append("")
    b = c["band"]
    ratio = ("" if b.get("ratio") is None else ", ratio x%s" % b["ratio"])
    L.append("### Band limit -- %s" % b["rarity"])
    L.append("- dps-proxy warn_hi = **%s** (basis %s%s); PROVISIONAL (corpus-derived, %s)"
             % (b["warn_hi"], b["basis"], ratio, b["source"]))
    L.append("- %s" % c["dps_proxy_formula"])
    L.append("")

    L.append("## GENRE EXEMPLARS (%d; reference corpus, item-based)" % len(pack["exemplars"]))
    if pack["exemplar_fallback"]:
        L.append("")
        L.append("> FALLBACK: drawn from damage-number entries (no mapped-verb entries for this slot).")
    L.append("")
    for i, e in enumerate(pack["exemplars"], 1):
        nums = ", ".join("%s=%s" % (k, v) for k, v in e["numbers"].items()) or "(none)"
        L.append("%d. **%s** [%s] rarity=%s" % (i, e["name"], e["source"], e["rarity_norm"]))
        L.append("   - numbers: %s" % nums)
        L.append("   - verbs_mapped: %s" % (", ".join(e["verbs_mapped"]) or "(none)"))
        if e["effect_text"]:
            L.append('   - effect: "%s"' % e["effect_text"])
    if not pack["exemplars"]:
        L.append("_(no corpus exemplars matched this slot)_")
    L.append("")

    L.append("## LIVE NEIGHBORS (%d; %s, gen_* fields trimmed)"
             % (len(pack["live_neighbors"]), KIND_META[slot["kind"]]["live_schema"]))
    L.append("")
    L.append("```json")
    L.append(json.dumps(pack["live_neighbors"], ensure_ascii=False, indent=2, sort_keys=True))
    L.append("```")
    L.append("")

    if pack["notes"]:
        L.append("## NOTES")
        for n in pack["notes"]:
            L.append("- %s" % n)
        L.append("")
    return "\n".join(L)


def main(argv=None):
    ap = argparse.ArgumentParser(description="REQ-0272 generation context pack builder")
    ap.add_argument("--kind", required=True, choices=["item", "skill", "enemy"])
    ap.add_argument("--rarity", required=True, help="rarity tier (common/uncommon/rare/relic; case-insensitive)")
    ap.add_argument("--verb", default=None, help="optional: restrict exemplars to this mapped verb")
    ap.add_argument("--theme", default=None, help="optional: restrict exemplars to a name/effect substring")
    ap.add_argument("--format", default="md", choices=["md", "json"])
    ap.add_argument("--out", default=None, help="write to FILE instead of stdout")
    args = ap.parse_args(argv)

    valid = {"common", "uncommon", "rare", "relic"}
    if args.rarity.lower() not in valid:
        ap.error("rarity must be one of %s" % sorted(valid))

    pack = build_pack(args.kind, args.rarity, args.verb, args.theme)
    if args.format == "json":
        text = json.dumps(pack, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    else:
        text = render_md(pack) + "\n"

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        sys.stderr.write("[gen_context] wrote %s\n" % args.out)
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
