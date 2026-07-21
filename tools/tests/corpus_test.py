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
  6. PAVA isotonic clamp: hand-computed weighted pooling (both the low-level
     _pava_isotonic primitive and an end-to-end non-monotonic synthetic
     corpus through compute_stats), plus the Common-anchor pin
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
# CHANGED (REQ-0271): the precision mapper + icon substitution now fully map
# Bloodthorne -- "Convert 1 Regeneration into 1 Vampirism ..." -> lifesteal
# (the vampiris keyword) and "Deals +1 damage per ..." -> strike -- so there
# is no residual unmapped phrase for this item any more. The "unmappable
# phrases are preserved, not dropped" property is now covered by the
# auto-layer test in the REQ-0271 block below (map_verbs on an inscrutable
# clause).
check("bloodthorne now fully mapped (no residual unmapped) [CHANGED REQ-0271]",
      len(blood["unmapped"]) == 0, blood["unmapped"])
check("bloodthorne maps lifesteal from Vampirism convert [REQ-0271]",
      "lifesteal" in blood["verbs_mapped"], blood["verbs_mapped"])
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
# already-monotonic sequence (Common 1.0 <= Rare 2.0): PAVA is a no-op here,
# ratio_raw is preserved and equals the (unpooled) ratio.
check("band Common ratio_raw == ratio_raw == 1.0",
      bands["Common"]["ratio_raw"] == 1.0, bands["Common"])
check("band Rare ratio_raw == 2.0 (unpooled, equals ratio)",
      bands["Rare"]["ratio_raw"] == 2.0 and bands["Rare"]["ratio"] == 2.0,
      bands["Rare"])
# median/percentile sanity on the controlled corpus
com = st["pooled"]["metrics"]["dps_proxy"]["Common"]
check("Common dps median == 10", com["median"] == 10.0, com)
check("Common dps n == 3", com["n"] == 3, com)

# --- 6. PAVA isotonic clamp (hand-computed) ---------------------------------
# 6a. low-level _pava_isotonic: two adjacent tiers violate monotonicity and
# must pool into their weighted mean; the rest of the sequence is untouched.
# values (tier order) = [1.0, 3.0, 2.0, 5.0], weights = [10, 3, 5, 1].
# index 1 (3.0) > index 2 (2.0) violates -> pool: weighted mean =
# (3.0*3 + 2.0*5) / (3+5) = (9 + 10) / 8 = 19/8 = 2.375 (exact in binary fp).
# Common (index 0, anchor) does not violate against the pooled block
# (1.0 <= 2.375) so it is untouched; index 3 (5.0) does not violate either.
fitted, groups = CS._pava_isotonic([1.0, 3.0, 2.0, 5.0], [10, 3, 5, 1],
                                    anchor_idx=0)
check("PAVA hand-computed pooled mean == 19/8 == 2.375",
      fitted[1] == 2.375 and fitted[2] == 2.375, fitted)
check("PAVA leaves the anchor tier at its own value (no violation)",
      fitted[0] == 1.0, fitted)
check("PAVA leaves an unviolated trailing tier untouched",
      fitted[3] == 5.0, fitted)
check("PAVA final sequence is non-decreasing",
      all(fitted[i] <= fitted[i + 1] for i in range(len(fitted) - 1)), fitted)
check("PAVA pooled indices 1 and 2 share a group, 0 and 3 do not",
      groups[1] == groups[2] and groups[0] != groups[1]
      and groups[3] != groups[2], groups)

# 6b. low-level _pava_isotonic: Common-anchor pin. Without pinning, Common
# (1.0, w=10) pooling with index 1 (0.5, w=4) would weighted-average to
# (1.0*10 + 0.5*4) / 14 = 12/14 = 0.857142... -- but Common is pinned, so the
# pooled block is forced to exactly 1.0 (others clamped UP to the anchor, the
# anchor is never dragged down), then index 2 (0.8) also violates against
# that pinned 1.0 and joins the same pinned block.
fitted2, groups2 = CS._pava_isotonic([1.0, 0.5, 0.8, 2.0], [10, 4, 4, 1],
                                     anchor_idx=0)
check("PAVA anchor pin clamps violators to exactly 1.0 (not averaged down)",
      fitted2 == [1.0, 1.0, 1.0, 2.0], fitted2)
check("PAVA anchor-pinned block groups 0,1,2 together",
      groups2[0] == groups2[1] == groups2[2] != groups2[3], groups2)

# 6c. end-to-end: a synthetic corpus reproducing a non-monotonic corpus ratio
# curve (Uncommon median dps-proxy > Rare's -- a small-n sampling artifact,
# same shape as the real REQ-0268 corpus) must come out of compute_stats
# fully monotonic, with the pre-clamp values preserved in ratio_raw.
# Common dps=10 (n=5) -> ratio_raw 1.0 (anchor).
# Uncommon dps=30 (n=3) -> ratio_raw 3.0.
# Rare dps=20 (n=5) -> ratio_raw 2.0 (violates: 3.0 > 2.0).
# Relic dps=50 (n=2) -> ratio_raw 5.0 (no violation once Uncommon/Rare pool).
# Pooled Uncommon/Rare weighted mean = (3.0*3 + 2.0*5) / 8 = 19/8 = 2.375,
# same hand-computed pool as 6a (deliberately -- same weights/ratios).
pava_corpora = {"s": {"license": "CC-BY-SA", "entries": (
    [synth("Common", 10)] * 5 + [synth("Uncommon", 30)] * 3 +
    [synth("Rare", 20)] * 5 + [synth("Relic", 50)] * 2
)}}
pst = CS.compute_stats(pava_corpora, anchor2)
pbands = pst["bands"]
check("e2e ratio_raw Common/Uncommon/Rare/Relic == 1.0/3.0/2.0/5.0",
      pbands["Common"]["ratio_raw"] == 1.0
      and pbands["Uncommon"]["ratio_raw"] == 3.0
      and pbands["Rare"]["ratio_raw"] == 2.0
      and pbands["Relic"]["ratio_raw"] == 5.0, pbands)
check("e2e pooled ratio Uncommon == Rare == 2.375",
      pbands["Uncommon"]["ratio"] == 2.375
      and pbands["Rare"]["ratio"] == 2.375, pbands)
check("e2e pooled tiers get basis corpus_ratio_isotonic",
      pbands["Uncommon"]["basis"] == "corpus_ratio_isotonic"
      and pbands["Rare"]["basis"] == "corpus_ratio_isotonic", pbands)
check("e2e untouched tiers keep basis corpus_ratio",
      pbands["Common"]["basis"] == "corpus_ratio"
      and pbands["Relic"]["basis"] == "corpus_ratio", pbands)
check("e2e warn_hi Common=12.0, Uncommon=Rare=28.5, Relic=60.0",
      pbands["Common"]["warn_hi"] == 12.0
      and pbands["Uncommon"]["warn_hi"] == 28.5
      and pbands["Rare"]["warn_hi"] == 28.5
      and pbands["Relic"]["warn_hi"] == 60.0, pbands)
check("e2e final band sequence is non-decreasing across all four tiers",
      pbands["Common"]["warn_hi"] <= pbands["Uncommon"]["warn_hi"]
      <= pbands["Rare"]["warn_hi"] <= pbands["Relic"]["warn_hi"], pbands)

# ============================================================================
# REQ-0271 -- effect-semantics: the four audited normalizer defect fixes,
# curated-table application, and stats provenance. Auto-layer assertions pass
# verb_map=[] so they are independent of the shipped recall table. (Inline
# wikitext omits the '' '' '' bold markers that strip_wikitext discards anyway.)
# ============================================================================
_VOCAB = json.load(open(os.path.join(REPO, "content", "vocab.json"),
                       encoding="utf-8"))
_VERBSET = set(_VOCAB["verbs"])
_TRIGSET = set(_VOCAB["triggers"])


def mkpage(source, title, wikitext, cats=None):
    return {"source": source, "title": title, "categories": cats or [],
            "wikitext": wikitext}


# -- defect (a): Backpack Hero Legendary -> Relic (was -> None) ---------------
bh_leg = CN.normalize_page(mkpage(
    "backpack-hero", "Legend Blade",
    "{{Item|title=Legend Blade|type=Weapon|rarity=Legendary|"
    "effects=On use, Deals 20 Damage|image=x.png}}"),
    "backpack-hero", verb_map=[])
check("REQ-0271(a) BH Legendary -> Relic",
      bh_leg["rarity_norm"] == "Relic", bh_leg["rarity_norm"])
check("REQ-0271(a) BH rarity_raw preserved as Legendary",
      bh_leg["rarity_raw"] == "Legendary", bh_leg["rarity_raw"])
check("REQ-0271(a) dead 'relic' key removed from BH rarity map",
      "relic" not in CN.RARITY_MAPS["backpack-hero"],
      CN.RARITY_MAPS["backpack-hero"])
check("REQ-0271(a) BH map now has legendary -> Relic",
      CN.RARITY_MAPS["backpack-hero"].get("legendary") == "Relic")

# -- defect (b): icon markup carries meaning (alt / Pic arg substituted) ------
check("REQ-0271(b) File-icon alt substituted (not dropped)",
      CN.strip_wikitext(
          "Gain 1 [[File:Icon Poison.png|alt=Poison|15x15px]]").strip()
      .startswith("Gain 1 Poison"),
      CN.strip_wikitext("Gain 1 [[File:Icon Poison.png|alt=Poison|15x15px]]"))
check("REQ-0271(b) {{Pic|NAME}} first-arg substituted",
      "Empower" in CN.strip_wikitext("Gain 1 {{Pic|Empower|20}}."),
      CN.strip_wikitext("Gain 1 {{Pic|Empower|20}}."))
icon = CN.normalize_page(mkpage(
    "backpack-battles", "Iconic",
    "{{Item_Template|Item_name=Iconic|Item_effect1=On hit: Gain 1 "
    "[[File:Icon Empower.png|15x15px|alt=Empower|link=x]].|Rarity=Rare|"
    "Type=Trinket}}"), "backpack-battles", verb_map=[])
check("REQ-0271(b) no dangling 'Gain 1 .' fragment",
      "Empower" in icon["effect_text"] and "Gain 1 ." not in icon["effect_text"],
      icon["effect_text"])

# -- defect (c): trigger header stays attached to its clause ------------------
clauses = CN.split_clauses(
    "Start of battle: Reduce damage taken by 25%. On hit: gain 2 armor.")
check("REQ-0271(c) trigger header not split from its clause",
      clauses == ["Start of battle: Reduce damage taken by 25%.",
                  "On hit: gain 2 armor."], clauses)
check("REQ-0271(c) no standalone bare trigger-header clause",
      not any(c.strip() in ("On hit:", "Start of battle:") for c in clauses),
      clauses)

# -- defect (d): clause-scoped, target-aware verb mapping --------------------
# Citrine adjacency aura: buff_adjacent, NOT strike (audit false positive).
citrine = CN.normalize_page(mkpage(
    "backpack-hero", "Citrine",
    "{{Item|title=Citrine|type=Gem,accessory|rarity=Uncommon|"
    "effects=Adjacent item below gets +3 Damage|image=Citrine.png}}"),
    "backpack-hero", verb_map=[])
check("REQ-0271(d) Citrine adjacency -> buff_adjacent, not strike",
      "buff_adjacent" in citrine["verbs_mapped"]
      and "strike" not in citrine["verbs_mapped"], citrine["verbs_mapped"])
# Plate Armor "Adds 1 Slow to self": self-slow is NOT slow_enemy (audit).
plate = CN.normalize_page(mkpage(
    "backpack-hero", "Plate Armor",
    "{{Item|title=Plate Armor|type=Armor|rarity=Rare|"
    "effects=Each turn, Adds 8 block Adds 1 Slow to self|image=x.png}}"),
    "backpack-hero", verb_map=[])
check("REQ-0271(d) Plate self-slow is NOT slow_enemy",
      "slow_enemy" not in plate["verbs_mapped"], plate["verbs_mapped"])
check("REQ-0271(d) Plate 'Adds 8 block' -> block",
      "block" in plate["verbs_mapped"], plate["verbs_mapped"])
# Cap of Resilience "Reduce damage taken": damage_reduction, NOT strike.
cap = CN.normalize_page(mkpage(
    "backpack-battles", "Cap of Resilience",
    "{{Item_Template|Item_name=Cap of Resilience|Item_effect1=Start of "
    "battle: Reduce damage taken by 25% for 3s.|Rarity=Epic|Type=Helmet}}"),
    "backpack-battles", verb_map=[])
check("REQ-0271(d) Cap 'Reduce damage taken' -> damage_reduction, not strike",
      "damage_reduction" in cap["verbs_mapped"]
      and "strike" not in cap["verbs_mapped"], cap["verbs_mapped"])
# Spiked Shield "prevent 4 damage": damage_reduction, not strike (reflect audit).
spiked = CN.normalize_page(mkpage(
    "backpack-battles", "Spiked Shield",
    "{{Item_Template|Item_name=Spiked Shield|Item_effect1=On attacked "
    "(Melee): 35% chance to prevent 4 damage, remove 0.4 stamina from "
    "opponent, and gain 1 [[File:Icon Spikes.png|alt=Spikes|15x15px]] (up to "
    "3).|Rarity=Rare|Type=Shield}}"), "backpack-battles", verb_map=[])
check("REQ-0271(d) Spiked Shield 'prevent N damage' -> damage_reduction",
      "damage_reduction" in spiked["verbs_mapped"]
      and "strike" not in spiked["verbs_mapped"], spiked["verbs_mapped"])
# strike DOES map when the item itself attacks (own Damage stat).
sword = CN.normalize_page(mkpage(
    "backpack-battles", "Sword",
    "{{Item_Template|Item_name=Sword|Damage=5-9|Cooldown=2s|Rarity=Common|"
    "Type=Melee Weapon}}"), "backpack-battles", verb_map=[])
check("REQ-0271(d) own Damage stat -> strike",
      "strike" in sword["verbs_mapped"], sword["verbs_mapped"])
# ... and from prose "deals N damage".
check("REQ-0271(d) 'deals N damage' -> strike",
      CN.map_verbs("On use, Deals 7 damage.", False)[0] == ["strike"],
      CN.map_verbs("On use, Deals 7 damage.", False))
# a genuinely unmappable clause is preserved in unmapped (auto layer).
odd = CN.map_verbs("Do a completely inscrutable thing.", False)
check("REQ-0271(d) unmappable clause preserved in unmapped",
      odd[0] == [] and odd[1] == ["Do a completely inscrutable thing."], odd)

# -- curated table application: exact / prefix / contains + class routing ----
tbl = [
    {"phrase": "start of battle: gain 2 spikes", "match": "prefix",
     "class": "verb", "verbs": ["reflect_damage"], "trigger": "battle_start"},
    {"phrase": "triggers extra attack", "match": "contains", "class": "verb",
     "verbs": ["multi_strike"]},
    {"phrase": "this item is conductive.", "match": "exact",
     "class": "no_model", "no_model_reason": "mana_conductivity"},
    {"phrase": "shop entered", "match": "contains", "class": "noise"},
]
tv, tu = CN.apply_verb_map(
    [],
    ["Start of battle: Gain 2 Spikes and more", "On stun: Triggers extra attack.",
     "This item is conductive.", "Shop entered: buy stuff", "leftover clause"],
    tbl)
check("REQ-0271 table prefix match -> verb", "reflect_damage" in tv, tv)
check("REQ-0271 table contains match -> verb", "multi_strike" in tv, tv)
check("REQ-0271 table exact no_model removes from unmapped",
      "This item is conductive." not in tu, tu)
check("REQ-0271 table noise (contains) removes from unmapped",
      not any("shop entered" in x.lower() for x in tu), tu)
check("REQ-0271 table leaves unmatched clause in unmapped",
      tu == ["leftover clause"], tu)
check("REQ-0271 empty table is a no-op",
      CN.apply_verb_map(["strike"], ["x"], []) == (["strike"], ["x"]))

# -- shipped table invariants (closed vocab only) ----------------------------
vm = CN.load_verb_map()
check("REQ-0271 shipped table is non-empty", len(vm) > 0, len(vm))
tbl_verbs = set()
for e in vm:
    tbl_verbs |= set(e.get("verbs", []))
check("REQ-0271 shipped-table verbs are all closed-vocab",
      tbl_verbs <= _VERBSET, tbl_verbs - _VERBSET)
check("REQ-0271 shipped-table triggers are all closed-vocab",
      all(e.get("trigger") in _TRIGSET for e in vm if e.get("trigger")),
      [e.get("trigger") for e in vm if e.get("trigger")])
check("REQ-0271 shipped-table classes valid",
      all(e["class"] in ("verb", "excluded", "no_model", "noise") for e in vm))
check("REQ-0271 no_model entries carry a reason",
      all(e.get("no_model_reason") for e in vm if e["class"] == "no_model"))
check("REQ-0271 verb entries carry closed verbs",
      all(e.get("verbs") and set(e["verbs"]) <= _VERBSET
          for e in vm if e["class"] == "verb"))

# -- stats provenance: per-tier n / provisional + generated_from hash --------
prov = CS.compute_stats(synth_corpora, anchor2)
check("REQ-0271 stats generated_from is a content hash",
      isinstance(prov.get("generated_from"), str)
      and prov["generated_from"].startswith("sha256:"), prov.get("generated_from"))
check("REQ-0271 every band carries n and provisional",
      all("n" in prov["bands"][t] and "provisional" in prov["bands"][t]
          for t in ("Common", "Uncommon", "Rare", "Relic")), prov["bands"])
check("REQ-0271 band n reflects dps-proxy sample size (Common=Rare=3)",
      prov["bands"]["Common"]["n"] == 3 and prov["bands"]["Rare"]["n"] == 3,
      prov["bands"])
check("REQ-0271 provisional True when n<30",
      prov["bands"]["Common"]["provisional"] is True,
      prov["bands"]["Common"])
check("REQ-0271 vocab_fallback tier (no dps data) has n=0 provisional True",
      prov["bands"]["Uncommon"]["n"] == 0
      and prov["bands"]["Uncommon"]["provisional"] is True,
      prov["bands"]["Uncommon"])
check("REQ-0271 generated_from deterministic across identical inputs",
      CS.compute_stats(synth_corpora, anchor2)["generated_from"]
      == prov["generated_from"])
big_corpora = {"s": {"license": "CC-BY-SA", "entries": (
    [synth("Common", 10)] * 35 + [synth("Rare", 20)] * 35)}}
bigst = CS.compute_stats(big_corpora, anchor2)
check("REQ-0271 band NOT provisional when n>=30",
      bigst["bands"]["Common"]["provisional"] is False
      and bigst["bands"]["Common"]["n"] == 35, bigst["bands"]["Common"])
check("REQ-0271 generated_from changes when corpus content changes",
      bigst["generated_from"] != prov["generated_from"])


# ----------------------------------------------------------------------------
print("\n%d passed, %d failed" % (_pass, _fail))
sys.exit(1 if _fail else 0)
