#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-0270 -- corpus_browser tests (stdlib, plain python3, assert-style).

Runs OFFLINE. Builds the static browser into a temp dir from a small SYNTHETIC
normalized corpus (constructed in-test) plus the real, committed
content/corpus_stats.json, and asserts:

  1. expected entry rows / values are present in the emitted HTML
  2. per-source normalization-quality counts are correct
  3. the bands table values match content/corpus_stats.json
  4. dps-proxy parity with tools/check_stat_bands.cjs hand-computed values
     (strike n:[22,38] every_secs s:[1.8,2.2] -> 30/2.0 = 15; the
     check_stat_bands self-test fixture n:[8,12] s:[1.8,2.2] -> 10/2.0 = 5)
  5. two builds on the same inputs are byte-identical
  6. output lands under the given --out (as <out>/index.html)

No network, no third-party deps -- runnable under bare `python3`.
"""
import json
import os
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)

import build_corpus_browser as CB  # noqa: E402

STATS_PATH = os.path.join(REPO, "content", "corpus_stats.json")

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


# --------------------------------------------------------------------------
# Synthetic normalized corpus (schema corpus/1). Covers: a damage+cadence item
# (dps-proxy computable), an item with unmapped phrases + excluded features, a
# null-rarity item (-> unmapped bucket), and a non-item "other" page.
# --------------------------------------------------------------------------
def synthetic_corpus():
    return {
        "schema": "corpus/1",
        "source": "test-wiki",
        "license": "CC-BY-SA",
        "endpoint": "https://test-wiki.fandom.com/api.php",
        "fetch_date": "2026-07-21",
        "entries": [
            {
                "page": "Test Blade", "kind": "item", "name": "Test Blade",
                "rarity_raw": "Godly", "rarity_norm": "Relic",
                "numbers": {"damage": [10, 20], "cadence_secs": [4, 6],
                            "hp": None, "price": [9, 9]},
                "effect_text": "Deals 10-20 damage every few seconds.",
                "verbs_mapped": ["strike"], "unmapped": [],
                "excluded": ["stamina_cost"], "tags": ["Weapon"],
            },
            {
                "page": "Test Charm", "kind": "item", "name": "Test Charm",
                "rarity_raw": "Common", "rarity_norm": "Common",
                "numbers": {"damage": None, "cadence_secs": None,
                            "hp": None, "price": None},
                "effect_text": "Start of battle: gain something odd.",
                "verbs_mapped": ["heal_ally"],
                "unmapped": ["Start of battle:", "gain something odd"],
                "excluded": [], "tags": ["Trinket"],
            },
            {
                "page": "Mystery Rock", "kind": "item", "name": "Mystery Rock",
                "rarity_raw": None, "rarity_norm": None,
                "numbers": {"damage": None, "cadence_secs": None,
                            "hp": None, "price": None},
                "effect_text": "",
                "verbs_mapped": [], "unmapped": ["Start of battle:"],
                "excluded": [], "tags": [],
            },
            {
                "page": "Index", "kind": "other", "name": "Index",
                "rarity_raw": None, "rarity_norm": None,
                "numbers": {"damage": None, "cadence_secs": None,
                            "hp": None, "price": None},
                "effect_text": "", "verbs_mapped": [], "unmapped": [],
                "excluded": [], "tags": [],
            },
        ],
    }


def extract_blob(html):
    m = re.search(
        r'<script id="corpus-data" type="application/json">(.*?)</script>',
        html, re.S)
    blob = m.group(1).replace("<\\/", "</")
    return json.loads(blob)


def build_into(tmp, out_sub="out"):
    data_dir = os.path.join(tmp, "data", "corpus")
    norm = os.path.join(data_dir, "normalized")
    os.makedirs(norm, exist_ok=True)
    with open(os.path.join(norm, "test-wiki.json"), "w", encoding="utf-8") as f:
        json.dump(synthetic_corpus(), f)
    out_dir = os.path.join(tmp, out_sub)
    out_path = CB.run(data_dir, out_dir, STATS_PATH,
                      items_path=os.path.join(REPO, "content", "live",
                                              "live_items.json"),
                      skills_path=os.path.join(REPO, "content", "live",
                                               "dungeon", "skills.json"))
    return out_dir, out_path


def main():
    tmp = tempfile.mkdtemp(prefix="corpus_browser_test_")
    try:
        out_dir, out_path = build_into(tmp)

        # 6. output lands under the given --out
        check("output is <out>/index.html",
              out_path == os.path.join(out_dir, "index.html")
              and os.path.exists(out_path), out_path)

        html = open(out_path, encoding="utf-8").read()
        data = extract_blob(html)

        # 1. expected entry rows / values present
        check("all synthetic entries present", data["meta"]["total_entries"] == 4)
        blade = next((e for e in data["entries"]
                      if e["name"] == "Test Blade"), None)
        check("Test Blade row present", blade is not None)
        check("Test Blade name in HTML text", "Test Blade" in html)
        check("Test Blade rarity_norm Relic (raw Godly)",
              blade and blade["rarity_norm"] == "Relic"
              and blade["rarity_raw"] == "Godly")
        # damage_mid = 15, cadence_mid = 5, dps_proxy = 15/5 = 3.0
        check("Test Blade damage_mid=15", blade and blade["damage_mid"] == 15.0,
              blade and blade["damage_mid"])
        check("Test Blade cadence_mid=5", blade and blade["cadence_mid"] == 5.0,
              blade and blade["cadence_mid"])
        check("Test Blade dps_proxy=3.0 (damage_mid/cadence_mid)",
              blade and blade["dps_proxy"] == 3.0, blade and blade["dps_proxy"])
        check("Test Blade carries excluded=stamina_cost",
              blade and blade["excluded"] == ["stamina_cost"])
        charm = next((e for e in data["entries"]
                      if e["name"] == "Test Charm"), None)
        check("Test Charm has 2 unmapped phrases",
              charm and len(charm["unmapped"]) == 2, charm and charm["unmapped"])
        rock = next((e for e in data["entries"]
                     if e["name"] == "Mystery Rock"), None)
        check("null-rarity entry has rarity_norm None (unmapped bucket)",
              rock and rock["rarity_norm"] is None)

        # 2. per-source quality counts correct
        q = data["quality"]["per_source"][0]
        check("quality source is test-wiki", q["source"] == "test-wiki")
        check("quality pages == 4", q["pages"] == 4 and q["n_entries"] == 4)
        kinds = {k["kind"]: k["count"] for k in q["kinds"]}
        check("quality kind counts item=3 other=1",
              kinds.get("item") == 3 and kinds.get("other") == 1, kinds)
        check("quality mapped verb tokens == 2 (strike + heal_ally)",
              q["mapped_tokens"] == 2, q["mapped_tokens"])
        check("quality unmapped phrases == 3", q["unmapped_phrases"] == 3,
              q["unmapped_phrases"])
        check("quality excluded features == 1", q["excluded_count"] == 1,
              q["excluded_count"])
        rmap = {(r["raw"], r["norm"]): r["count"] for r in q["rarity_map"]}
        check("rarity map Godly->Relic x1",
              rmap.get(("Godly", "Relic")) == 1, rmap)
        check("rarity map (none)->(unmapped) x2",
              rmap.get((None, None)) == 2, rmap)
        # top unmapped phrase pooled: "Start of battle:" appears twice
        tu = {u["phrase"]: u["count"] for u in data["quality"]["top_unmapped"]}
        check("top unmapped 'Start of battle:' count==2",
              tu.get("Start of battle:") == 2, tu)

        # 3. bands table values match content/corpus_stats.json
        stats = json.load(open(STATS_PATH, encoding="utf-8"))
        want = stats["bands"]
        got = {b["rarity"]: b for b in data["curves"]["bands"]}
        ok_bands = True
        for tier, b in want.items():
            g = got.get(tier)
            if not g or g["ratio_raw"] != b["ratio_raw"] \
                    or g["ratio"] != b["ratio"] \
                    or g["warn_hi"] != b["warn_hi"] \
                    or g["basis"] != b["basis"]:
                ok_bands = False
                break
        check("bands table matches corpus_stats.json", ok_bands,
              {"want": want, "got": got})
        # and the numbers are literally present in the HTML blob text
        check("warn_hi 19.7 (Rare) present in HTML", '"warn_hi":19.7' in html)
        check("bands_formula present in HTML",
              stats["bands_formula"][:40] in html)

        # 4. dps-proxy parity with check_stat_bands hand values
        blade_def = {"rarity": "Common", "effects": [
            {"trigger": {"t": "every_secs", "s": [1.8, 2.2]},
             "verb": {"t": "strike", "n": [22, 38]}}]}
        dps, counted = CB.live_def_dps(blade_def)
        check("live dps parity: strike 30/2.0 = 15.0",
              abs(dps - 15.0) < 1e-9 and counted == 1, (dps, counted))
        selftest_def = {"rarity": "Common", "effects": [
            {"trigger": {"t": "every_secs", "s": [1.8, 2.2]},
             "verb": {"t": "strike", "n": [8, 12]}}]}
        dps2, _ = CB.live_def_dps(selftest_def)
        check("live dps parity: check_stat_bands self-test 10/2.0 = 5.0",
              abs(dps2 - 5.0) < 1e-9, dps2)
        # non-damage verb + non-cadence trigger -> counted 0 (skipped)
        heal_def = {"rarity": "Common", "effects": [
            {"trigger": {"t": "every_secs", "s": [2, 2]},
             "verb": {"t": "heal_ally", "n": [5, 5]}}]}
        _, counted_heal = CB.live_def_dps(heal_def)
        check("live dps: non-damage verb not counted", counted_heal == 0)
        # bare skill/1 shape (top-level trigger/verb) works too
        skill_def = {"trigger": {"t": "every_secs", "s": [2, 2]},
                     "verb": {"t": "strike", "n": [6, 10]}}
        dps3, counted3 = CB.live_def_dps(skill_def)
        check("live dps parity: bare skill shape 8/2.0 = 4.0",
              abs(dps3 - 4.0) < 1e-9 and counted3 == 1, (dps3, counted3))
        check("live rarity_of lowercases/caps like check_stat_bands",
              CB.live_rarity_of({"rarity": "uncommon"}) == "Uncommon"
              and CB.live_rarity_of({}) is None)

        # 5. two builds byte-identical
        tmp2 = tempfile.mkdtemp(prefix="corpus_browser_test2_")
        try:
            _, p2 = build_into(tmp2, out_sub="out2")
            a = open(out_path, "rb").read()
            b = open(p2, "rb").read()
            check("two builds are byte-identical", a == b,
                  "len %d vs %d" % (len(a), len(b)))
        finally:
            shutil.rmtree(tmp2, ignore_errors=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d passed, %d failed" % (_pass, _fail))
    return 1 if _fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
