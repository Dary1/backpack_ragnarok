#!/usr/bin/env python3
"""REQ-0272 -- gen_context pack-builder tests (stdlib, plain python3).

Runs OFFLINE. Exemplar assertions use a COMMITTED synthetic corpus fixture
(tools/tests/fixtures/gen_context/fixture-corpus.json) rather than the
gitignored data/corpus artifact, so the test is deterministic and mergeable.
The constraint/dialect/band/live-neighbor assertions read the committed
content/vocab.json, content/corpus_stats.json and content/live/*.json.

Covered:
  1. deterministic pack: build_pack / render_md twice -> byte-identical
  2. exemplar filtering: rarity match, verb filter, theme filter, ranking,
     top-up note, and the mapped-verb -> damage-number FALLBACK flag
  3. constraint correctness (item + skill): schema, dialect casing, domain-
     filtered triggers, deprecated verbs excluded, DO-NOT list, band warn_hi
  4. live neighbors: rarity match + gen_* fields trimmed
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
FIX = os.path.join(HERE, "fixtures", "gen_context", "fixture-corpus.json")
sys.path.insert(0, TOOLS)

import gen_context as GC  # noqa: E402

# Point the exemplar loader at the committed fixture (not gitignored data/).
GC.CORPUS_GLOB = FIX

_pass = 0
_fail = 0


def check(name, cond, detail=""):
    global _pass, _fail
    if cond:
        print("PASS  " + name)
        _pass += 1
    else:
        print("FAIL  " + name + ((" -- " + str(detail)) if detail else ""))
        _fail += 1


# --- 1. determinism ----------------------------------------------------------
p1 = GC.build_pack("skill", "common", None, None)
p2 = GC.build_pack("skill", "common", None, None)
check("build_pack deterministic (json equal)",
      json.dumps(p1, sort_keys=True) == json.dumps(p2, sort_keys=True))
check("render_md deterministic",
      GC.render_md(GC.build_pack("item", "common", None, None))
      == GC.render_md(GC.build_pack("item", "common", None, None)))

# --- 2. exemplar filtering ---------------------------------------------------
entries = GC.load_corpus_entries()
check("fixture corpus loaded (5 entries)", len(entries) == 5, len(entries))

ex, fb, notes = GC.select_exemplars("item", "common", entries, None, None)
check("common exemplars only rarity_norm Common",
      all(e["rarity_norm"] == "Common" for e in ex), [e["rarity_norm"] for e in ex])
check("common exemplar ranking: most mapped verbs first (Fang)",
      ex and ex[0]["name"] == "Fixture Fang", [e["name"] for e in ex])
check("common exemplars NOT a fallback (mapped verbs exist)", fb is False, fb)
check("top-up note present (fewer than MIN mapped-verb entries)",
      any("topped up" in n for n in notes), notes)

exv, _, notesv = GC.select_exemplars("item", "common", entries, "strike", None)
check("verb filter keeps only strike-mapped exemplars",
      exv and all("strike" in e["verbs_mapped"] for e in exv)
      and {e["name"] for e in exv} == {"Fixture Blade", "Fixture Fang"},
      [e["name"] for e in exv])

ext, _, _ = GC.select_exemplars("item", "common", entries, None, "fang")
check("theme filter keeps only name/effect substring matches",
      [e["name"] for e in ext] == ["Fixture Fang"], [e["name"] for e in ext])

exu, fbu, notesu = GC.select_exemplars("item", "uncommon", entries, None, None)
check("uncommon slot has ONLY damage-number entries -> fallback True", fbu is True, fbu)
check("fallback note present", any("FALLBACK" in n for n in notesu), notesu)
check("uncommon fallback exemplar is the damage-only entry",
      [e["name"] for e in exu] == ["Fixture Unc Only"], [e["name"] for e in exu])

# --- 3. constraint correctness (item) ----------------------------------------
ci = GC.build_pack("item", "common", None, None)["constraints"]
check("item schema po/2", ci["schema"] == "po/2", ci["schema"])
check("item dialect name_field name, rarity_case exact",
      ci["dialect"]["name_field"] == "name" and ci["dialect"]["rarity_case"] == "exact", ci["dialect"])
check("item domain PO", ci["domain"] == "PO", ci["domain"])
check("item allowed triggers include every_secs+adjacent, exclude on_kill (Unit-only)",
      "every_secs" in ci["allowed_triggers"] and "adjacent" in ci["allowed_triggers"]
      and "on_kill" not in ci["allowed_triggers"], ci["allowed_triggers"])
check("deprecated verbs excluded from allowed_verbs (pulse/buff_linked)",
      "pulse" not in ci["allowed_verbs"] and "buff_linked" not in ci["allowed_verbs"], None)
check("damage verbs are strike/multi_strike/charge_strike",
      ci["damage_verbs"] == ["strike", "multi_strike", "charge_strike"], ci["damage_verbs"])
check("DO-NOT excluded_attested includes gold_pickup",
      "gold_pickup" in ci["do_not"]["excluded_attested"], ci["do_not"]["excluded_attested"])
check("DO-NOT deprecated includes pulse", "pulse" in ci["do_not"]["deprecated"], ci["do_not"]["deprecated"])
check("item Common band warn_hi 12.0 basis corpus_ratio",
      ci["band"]["warn_hi"] == 12.0 and ci["band"]["basis"] == "corpus_ratio" and ci["band"]["provisional"] is True,
      ci["band"])
check("dps_proxy_formula mentions midpoint", "midpoint" in ci["dps_proxy_formula"], None)

# --- 3b. constraint correctness (skill) --------------------------------------
cs = GC.build_pack("skill", "rare", None, None)["constraints"]
check("skill schema skill/1", cs["schema"] == "skill/1", cs["schema"])
check("skill dialect name_field name_en", cs["dialect"]["name_field"] == "name_en", cs["dialect"])
check("skill domain EnemySkill", cs["domain"] == "EnemySkill", cs["domain"])
check("skill triggers include every_secs+battle_start+on_hp_below, exclude adjacent (PO-only)",
      "every_secs" in cs["allowed_triggers"] and "battle_start" in cs["allowed_triggers"]
      and "on_hp_below" in cs["allowed_triggers"] and "adjacent" not in cs["allowed_triggers"],
      cs["allowed_triggers"])
check("skill Rare band warn_hi 19.7 basis corpus_ratio_isotonic",
      cs["band"]["warn_hi"] == 19.7 and cs["band"]["basis"] == "corpus_ratio_isotonic", cs["band"])

# --- 4. live neighbors -------------------------------------------------------
def no_gen_keys(obj):
    if isinstance(obj, dict):
        return all(not k.startswith("gen_") and no_gen_keys(v) for k, v in obj.items())
    if isinstance(obj, list):
        return all(no_gen_keys(v) for v in obj)
    return True


item_pack = GC.build_pack("item", "common", None, None)
nbr = item_pack["live_neighbors"]
check("item common live neighbors are all rarity Common",
      len(nbr) > 0 and all(n.get("rarity") == "Common" for n in nbr), [n.get("rarity") for n in nbr])
check("item live neighbors have gen_* fields trimmed", all(no_gen_keys(n) for n in nbr), None)

enemy_pack = GC.build_pack("enemy", "common", None, None)
enbr = enemy_pack["live_neighbors"]
check("enemy common live neighbors are all rarity common (lowercase dialect)",
      len(enbr) > 0 and all(n.get("rarity") == "common" for n in enbr), [n.get("rarity") for n in enbr])

skill_pack = GC.build_pack("skill", "common", None, None)
check("skill live neighbors present + note about no rarity dimension",
      len(skill_pack["live_neighbors"]) > 0
      and any("no rarity" in n for n in skill_pack["notes"]), skill_pack["notes"])

print("\n%d passed, %d failed" % (_pass, _fail))
sys.exit(1 if _fail else 0)
