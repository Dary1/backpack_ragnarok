#!/usr/bin/env python3
"""REQ-0268 -- corpus tool tests (stdlib, plain python3, assert-style).

Runs OFFLINE against committed fixtures under tools/tests/fixtures/corpus/
(real trimmed wiki pages, CC-BY-SA, see that dir's README). Exits non-zero on
any failure. No network, no third-party deps -- runnable under bare `python3`.

Covered:
  1. normalizer maps a known item (name / rarity / damage / cadence / verbs)
  2. excluded_attested features are bucketed (not silently dropped)
  3. an unparseable / infobox-less page -> kind "other", no crash; unmappable
     effect phrases land in `unmapped`
  4. stats determinism: compute_stats twice on the fixtures -> byte-identical
  5. band derivation matches hand-computed values
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
FIX = os.path.join(HERE, "fixtures", "corpus")
sys.path.insert(0, TOOLS)

import corpus_normalize as CN  # noqa: E402
import corpus_stats as CS  # noqa: E402

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


def load_fixture(fn):
    with open(os.path.join(FIX, fn), encoding="utf-8") as f:
        return json.load(f)


def norm(fn):
    page = load_fixture(fn)
    return CN.normalize_page(page, page["source"])


# --- 1. known-item mapping ---------------------------------------------------
blood = norm("bb_bloodthorne.json")
check("bloodthorne name", blood["name"] == "Bloodthorne", blood["name"])
check("bloodthorne rarity Godly->Relic", blood["rarity_norm"] == "Relic",
      blood["rarity_norm"])
check("bloodthorne rarity_raw preserved", blood["rarity_raw"] == "Godly",
      blood["rarity_raw"])
check("bloodthorne damage [4,8]", blood["numbers"]["damage"] == [4.0, 8.0],
      blood["numbers"]["damage"])
check("bloodthorne cadence [1.6,1.6]",
      blood["numbers"]["cadence_secs"] == [1.6, 1.6],
      blood["numbers"]["cadence_secs"])
check("bloodthorne verbs_mapped has strike",
      "strike" in blood["verbs_mapped"], blood["verbs_mapped"])
check("bloodthorne kind item", blood["kind"] == "item", blood["kind"])

banana = norm("bb_banana.json")
check("banana rarity Common", banana["rarity_norm"] == "Common",
      banana["rarity_norm"])
check("banana cadence from 'Every 5s'",
      banana["numbers"]["cadence_secs"] == [5.0, 5.0],
      banana["numbers"]["cadence_secs"])
check("banana heal parsed", banana["numbers"]["heal"] == [4.0, 4.0],
      banana["numbers"]["heal"])
check("banana verbs_mapped has heal_ally",
      "heal_ally" in banana["verbs_mapped"], banana["verbs_mapped"])

carved = norm("bh_carved_blade.json")
check("carved blade name from BH infobox", carved["name"] == "Carved Blade",
      carved["name"])
check("carved blade rarity Uncommon", carved["rarity_norm"] == "Uncommon",
      carved["rarity_norm"])
check("carved blade damage from prose (15)",
      carved["numbers"]["damage"] == [15.0, 15.0], carved["numbers"]["damage"])
check("carved blade verbs_mapped has strike",
      "strike" in carved["verbs_mapped"], carved["verbs_mapped"])

# --- 2. excluded_attested bucketing -----------------------------------------
check("bloodthorne excludes accuracy_crit",
      "accuracy_crit" in blood["excluded"], blood["excluded"])
check("bloodthorne excludes stamina_cost",
      "stamina_cost" in blood["excluded"], blood["excluded"])
check("bloodthorne excludes recipe_craft",
      "recipe_craft" in blood["excluded"], blood["excluded"])
check("banana excludes stamina_cost",
      "stamina_cost" in banana["excluded"], banana["excluded"])
check("carved blade excludes energy_cost",
      "energy_cost" in carved["excluded"], carved["excluded"])
# every excluded key must be a real vocab excluded_attested feature
allexc = set(blood["excluded"]) | set(banana["excluded"]) | set(carved["excluded"])
check("excluded keys are valid vocab features",
      allexc <= CN.EXCLUDED_KEYS, allexc - CN.EXCLUDED_KEYS)

# --- 3. unparseable / weird page robustness ---------------------------------
acc = norm("bb_accessory_index.json")
check("accessory index -> kind other", acc["kind"] == "other", acc["kind"])
check("accessory index does not crash / no rarity",
      acc["rarity_norm"] is None, acc["rarity_norm"])
# unmappable effect phrases are preserved, not dropped
check("bloodthorne keeps unmapped phrases", len(blood["unmapped"]) > 0,
      blood["unmapped"])
# a genuinely malformed template (unbalanced braces) must not raise
broken = {"source": "backpack-battles", "title": "Broken",
          "categories": [],
          "wikitext": "{{Item_Template|Item_name=Broken|Damage=3-5|Rarity=Rare"}
try:
    b = CN.normalize_page(broken, "backpack-battles")
    check("malformed page normalizes without crash", b["kind"] == "other", b)
except Exception as e:  # noqa: BLE001
    check("malformed page normalizes without crash", False, repr(e))

# --- 4. stats determinism ----------------------------------------------------
fixtures = ["bb_bloodthorne.json", "bb_banana.json", "bh_carved_blade.json",
            "bh_daisy_blade.json", "bb_accessory_index.json"]
corpora = {"backpack-battles": {"license": "CC-BY-SA", "entries": []},
           "backpack-hero": {"license": "CC-BY-SA", "entries": []}}
for fn in fixtures:
    page = load_fixture(fn)
    corpora[page["source"]]["entries"].append(CN.normalize_page(page, page["source"]))

with open(os.path.join(REPO, "content", "vocab.json"), encoding="utf-8") as f:
    anchor = json.load(f)["dps_ceiling_warn"]

j1 = CS.canonical_json(CS.compute_stats(corpora, anchor))
j2 = CS.canonical_json(CS.compute_stats(corpora, anchor))
check("stats compute is byte-identical across reruns", j1 == j2)
check("stats has no wall-clock timestamp", "T00:" not in j1 and "date" not in
      json.loads(j1))

# --- 5. band derivation matches hand-computed values ------------------------
# Controlled corpus: Common dps=10 (dmg 10 / cad 1), Rare dps=20 (dmg 20 / cad 1).
def synth(rarity, dmg):
    return {"page": rarity, "kind": "item", "name": rarity,
            "rarity_raw": rarity, "rarity_norm": rarity,
            "numbers": {"damage": [dmg, dmg], "cadence_secs": [1.0, 1.0],
                        "hp": None, "armor": None, "heal": None, "price": None},
            "effect_text": "", "verbs_mapped": ["strike"], "unmapped": [],
            "excluded": [], "tags": []}

synth_corpora = {"s": {"license": "CC-BY-SA", "entries": [
    synth("Common", 10), synth("Common", 10), synth("Common", 10),
    synth("Rare", 20), synth("Rare", 20), synth("Rare", 20),
]}}
anchor2 = {"Common": 12, "Uncommon": 15, "Rare": 18, "Relic": 24}
st = CS.compute_stats(synth_corpora, anchor2)
ratio = st["pooled"]["rarity_ratio_dps"]
bands = st["bands"]
check("ratio Common == 1.0", ratio["Common"] == 1.0, ratio)
check("ratio Rare == 2.0", ratio["Rare"] == 2.0, ratio)
check("band Common warn_hi == 12.0 (12 * 1.0)",
      bands["Common"]["warn_hi"] == 12.0, bands["Common"])
check("band Rare warn_hi == 24.0 (12 * 2.0)",
      bands["Rare"]["warn_hi"] == 24.0, bands["Rare"])
check("band Rare basis corpus_ratio", bands["Rare"]["basis"] == "corpus_ratio",
      bands["Rare"])
check("band Uncommon falls back to vocab (no data)",
      bands["Uncommon"]["basis"] == "vocab_fallback"
      and bands["Uncommon"]["warn_hi"] == 15.0, bands["Uncommon"])
# median/percentile sanity on the controlled corpus
com = st["pooled"]["metrics"]["dps_proxy"]["Common"]
check("Common dps median == 10", com["median"] == 10.0, com)
check("Common dps n == 3", com["n"] == 3, com)

# ----------------------------------------------------------------------------
print("\n%d passed, %d failed" % (_pass, _fail))
sys.exit(1 if _fail else 0)
