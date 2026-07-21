#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""REQ-0270/0277 -- corpus_browser tests (stdlib, plain python3, assert-style).

Runs OFFLINE. Builds the THREE static browser pages (index / items / monsters)
into a temp dir from a small SYNTHETIC normalized corpus (constructed in-test)
plus the real, committed content/corpus_stats.json + content/enemy_bands.json +
live content, and asserts:

  1. three-page presence (index.html / items.html / monsters.html) under --out
  2. per-page content isolation:
       - items.html live section carries ONLY item rows; no enemy/skill rows,
         no enemy-band tables, no enemy_bands in its curves slice
       - monsters.html carries ONLY skill+enemy live rows; no item-band table,
         no corpus entries table, no item live rows
       - index.html carries neither entries/live/curves nor those tables, and
         links prominently to both kind pages
  3. corpus entry rows / values present on items.html
  4. per-source normalization-quality counts correct on index.html
  5. the item bands table values match content/corpus_stats.json (items.html)
  6. enemy-side bands (basis live_self) match content/enemy_bands.json
     (monsters.html); live skills vs pooled skill_dps band; enemy = SUM of its
     skills' dps-proxies vs its rarity's enemy_total_dps band
  7. dps-proxy parity with tools/check_stat_bands.cjs hand-computed values
  8. two builds on the same inputs are byte-identical PER PAGE

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
ENEMY_BANDS_PATH = os.path.join(REPO, "content", "enemy_bands.json")

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
# null-rarity item (-> unmapped bucket), and a non-item "other" page (an
# item-page derivative that stays on items.html and is labelled "other").
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
    out_paths = CB.run(
        data_dir, out_dir, STATS_PATH,
        items_path=os.path.join(REPO, "content", "live", "live_items.json"),
        skills_path=os.path.join(REPO, "content", "live", "dungeon",
                                 "skills.json"),
        enemies_path=os.path.join(REPO, "content", "live", "dungeon",
                                  "enemies.json"),
        enemy_bands_path=ENEMY_BANDS_PATH)
    return out_dir, out_paths


def main():
    tmp = tempfile.mkdtemp(prefix="corpus_browser_test_")
    try:
        out_dir, out_paths = build_into(tmp)

        # 1. three-page presence, each under the given --out
        for name in ("index", "items", "monsters"):
            check("%s.html under --out" % name,
                  out_paths.get(name) == os.path.join(out_dir, name + ".html")
                  and os.path.exists(out_paths[name]), out_paths.get(name))

        index_html = open(out_paths["index"], encoding="utf-8").read()
        items_html = open(out_paths["items"], encoding="utf-8").read()
        monsters_html = open(out_paths["monsters"], encoding="utf-8").read()
        index = extract_blob(index_html)
        items = extract_blob(items_html)
        monsters = extract_blob(monsters_html)

        # ------------------------------------------------------------------
        # 2. per-page content isolation
        # ------------------------------------------------------------------
        # index: quality + attribution only; no entries/live/curves
        check("index carries no entries/live/curves slice",
              "entries" not in index and "live" not in index
              and "curves" not in index, list(index.keys()))
        check("index links prominently to items.html and monsters.html",
              'href="items.html"' in index_html
              and 'href="monsters.html"' in index_html)
        check("index has no entries table / band tables",
              'id="e-body"' not in index_html
              and 'id="c-bands"' not in index_html
              and 'id="c-enemy-bands"' not in index_html)

        # items: item entries + item curves + item live only
        item_live_kinds = set(r["kind"] for r in items["live"]["rows"])
        check("items live rows are ALL kind=item (no enemy/skill)",
              item_live_kinds == {"item"} or item_live_kinds == set(),
              item_live_kinds)
        check("items curves slice carries NO enemy_bands",
              "enemy_bands" not in items["curves"], list(items["curves"]))
        check("items.html has NO enemy-band tables",
              'id="c-enemy-bands"' not in items_html
              and 'id="c-eb-hp"' not in items_html
              and 'id="c-eb-skill"' not in items_html)
        check("items page nav links to both other pages (relative)",
              'href="index.html"' in items_html
              and 'href="monsters.html"' in items_html)

        # monsters: enemy bands + skill/enemy live only
        mon_live_kinds = set(r["kind"] for r in monsters["live"]["rows"])
        check("monsters live rows are ONLY skill/enemy (no item)",
              mon_live_kinds.issubset({"skill", "enemy"})
              and "item" not in mon_live_kinds, mon_live_kinds)
        check("monsters carries no entries/curves slice",
              "entries" not in monsters and "curves" not in monsters,
              list(monsters.keys()))
        check("monsters.html has NO item-band table nor entries table",
              'id="c-bands"' not in monsters_html
              and 'id="e-body"' not in monsters_html)
        check("monsters page nav links to both other pages (relative)",
              'href="index.html"' in monsters_html
              and 'href="items.html"' in monsters_html)

        # ------------------------------------------------------------------
        # 3. corpus entry rows / values present on items.html
        # ------------------------------------------------------------------
        check("all synthetic entries on items.html",
              items["meta"]["total_entries"] == 4
              and len(items["entries"]) == 4)
        blade = next((e for e in items["entries"]
                      if e["name"] == "Test Blade"), None)
        check("Test Blade row present", blade is not None)
        check("Test Blade name in items.html text", "Test Blade" in items_html)
        check("Test Blade rarity_norm Relic (raw Godly)",
              blade and blade["rarity_norm"] == "Relic"
              and blade["rarity_raw"] == "Godly")
        check("Test Blade damage_mid=15", blade and blade["damage_mid"] == 15.0,
              blade and blade["damage_mid"])
        check("Test Blade cadence_mid=5", blade and blade["cadence_mid"] == 5.0,
              blade and blade["cadence_mid"])
        check("Test Blade dps_proxy=3.0 (damage_mid/cadence_mid)",
              blade and blade["dps_proxy"] == 3.0, blade and blade["dps_proxy"])
        check("Test Blade carries excluded=stamina_cost",
              blade and blade["excluded"] == ["stamina_cost"])
        charm = next((e for e in items["entries"]
                      if e["name"] == "Test Charm"), None)
        check("Test Charm has 2 unmapped phrases",
              charm and len(charm["unmapped"]) == 2, charm and charm["unmapped"])
        rock = next((e for e in items["entries"]
                     if e["name"] == "Mystery Rock"), None)
        check("null-rarity entry has rarity_norm None (unmapped bucket)",
              rock and rock["rarity_norm"] is None)
        other = next((e for e in items["entries"]
                      if e["name"] == "Index"), None)
        check("non-item 'other' derivative stays on items.html labelled other",
              other and other["kind"] == "other")

        # ------------------------------------------------------------------
        # 4. per-source quality counts correct on index.html
        # ------------------------------------------------------------------
        check("index has exactly one quality card (one synthetic source)",
              len(index["quality"]["per_source"]) == 1,
              len(index["quality"]["per_source"]))
        q = index["quality"]["per_source"][0]
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
        tu = {u["phrase"]: u["count"] for u in index["quality"]["top_unmapped"]}
        check("top unmapped 'Start of battle:' count==2",
              tu.get("Start of battle:") == 2, tu)

        # ------------------------------------------------------------------
        # 5. item bands table matches content/corpus_stats.json (items.html)
        # ------------------------------------------------------------------
        stats = json.load(open(STATS_PATH, encoding="utf-8"))
        want = stats["bands"]
        got = {b["rarity"]: b for b in items["curves"]["bands"]}
        ok_bands = True
        for tier, b in want.items():
            g = got.get(tier)
            if not g or g["ratio_raw"] != b["ratio_raw"] \
                    or g["ratio"] != b["ratio"] \
                    or g["warn_hi"] != b["warn_hi"] \
                    or g["basis"] != b["basis"]:
                ok_bands = False
                break
        check("item bands table matches corpus_stats.json", ok_bands,
              {"want": want, "got": got})
        check("warn_hi 19.7 (Rare) present in items.html",
              '"warn_hi":19.7' in items_html)
        check("bands_formula present in items.html",
              stats["bands_formula"][:40] in items_html)
        check("curves.bands_scope == item",
              items["curves"].get("bands_scope") == "item",
              items["curves"].get("bands_scope"))

        # live items carry scope=item
        item_rows = items["live"]["rows"]
        check("live item rows scope=item",
              (all(r["scope"] == "item" for r in item_rows)
               if item_rows else True), item_rows[:1])

        # ------------------------------------------------------------------
        # 6. enemy-side bands + skill/enemy live (monsters.html)
        # ------------------------------------------------------------------
        ebj = json.load(open(ENEMY_BANDS_PATH, encoding="utf-8"))
        eb = monsters["enemy_bands"]
        check("enemy_bands present, basis live_self",
              eb.get("present") is True and eb.get("basis") == "live_self",
              eb.get("basis"))
        hp_common = next((r for r in eb.get("hp_rows", [])
                          if r["key"] == "common"), None)
        check("enemy hp common band matches enemy_bands.json",
              hp_common
              and hp_common["warn_hi"] == ebj["enemy_hp"]["common"]["band"]["warn_hi"]
              and hp_common["warn_lo"] == ebj["enemy_hp"]["common"]["band"]["warn_lo"],
              hp_common)
        check("enemy_bands skill_row warn_hi matches file",
              eb.get("skill_row", {}).get("warn_hi")
              == ebj["skill_dps"]["band"]["warn_hi"], eb.get("skill_row"))
        check("enemy-side bands section + live_self label in monsters.html",
              'id="c-enemy-bands"' in monsters_html
              and "live_self" in monsters_html)
        check("monsters.html states the corpus has ZERO enemy entries",
              "ZERO enemy entries" in monsters_html
              and monsters["meta"]["corpus_enemy_entries"] == 0)

        skill_rows = [r for r in monsters["live"]["rows"]
                      if r["kind"] == "skill"]
        enemy_rows = [r for r in monsters["live"]["rows"]
                      if r["kind"] == "enemy"]
        want_sw = ebj["skill_dps"]["band"]["warn_hi"]
        check("live skill rows scope=skill basis=live_self vs skill_dps band",
              len(skill_rows) > 0 and all(
                  r["scope"] == "skill" and r["basis"] == "live_self"
                  and r["warn_hi"] == want_sw for r in skill_rows),
              skill_rows[:1])
        check("live enemy rows present, scope=enemy basis=live_self",
              len(enemy_rows) > 0 and all(
                  r["scope"] == "enemy" and r["basis"] == "live_self"
                  for r in enemy_rows), enemy_rows[:1])
        check("all monsters live rows are banded (na==0)",
              monsters["live"]["summary"]["na"] == 0,
              monsters["live"]["summary"])

        # ------------------------------------------------------------------
        # 6b. per-kind live builders in isolation (synthetic, data-free)
        # ------------------------------------------------------------------
        sk_doc = {"entries": [
            {"id": "s_hit", "name": "Hit",
             "trigger": {"t": "every_secs", "s": [2, 2]},
             "verb": {"t": "strike", "n": [10, 10]}},        # dps 5
            {"id": "s_heal", "name": "Heal",
             "trigger": {"t": "every_secs", "s": [2, 2]},
             "verb": {"t": "heal_ally", "n": [5, 5]}},        # counted 0
        ]}
        en_doc = {"entries": [
            {"id": "e1", "name": "E1", "rarity": "common",
             "skills": ["s_hit", "s_heal"]},                 # total dps 5
            {"id": "e2", "name": "E2", "rarity": "common",
             "skills": ["s_heal"]},                          # counted 0 -> skip
        ]}
        eb_syn = {"skill_dps": {"band": {"warn_hi": 17.361, "flag_multiple": 2}},
                  "enemy_total_dps": {"common": {"band": {"warn_hi": 10.0,
                                                          "flag_multiple": 2}}}}
        ml = CB.build_monster_live(sk_doc, en_doc, eb_syn)
        ml_sk = [r for r in ml["rows"] if r["kind"] == "skill"]
        ml_en = [r for r in ml["rows"] if r["kind"] == "enemy"]
        check("build_monster_live: 1 damage skill row (heal skipped)",
              len(ml_sk) == 1 and ml_sk[0]["id"] == "s_hit"
              and ml_sk[0]["dps"] == 5.0, ml_sk)
        check("build_monster_live: enemy dps = SUM of its skills' dps-proxies",
              len(ml_en) == 1 and ml_en[0]["id"] == "e1"
              and ml_en[0]["dps"] == 5.0
              and ml_en[0]["scope"] == "enemy"
              and ml_en[0]["status"] == "OK", ml_en)
        check("build_monster_live: enemy with no damage skill is omitted",
              all(r["id"] != "e2" for r in ml["rows"]))
        check("build_monster_live: no item rows produced",
              all(r["kind"] != "item" for r in ml["rows"]))

        it_doc = {"entries": [
            {"id": "it1", "name": "Blade", "rarity": "Rare",
             "effects": [{"trigger": {"t": "every_secs", "s": [2, 2]},
                          "verb": {"t": "strike", "n": [40, 40]}}]},  # dps 20
        ]}
        il = CB.build_item_live(
            it_doc, {"Rare": {"warn_hi": 19.7,
                              "basis": "corpus_ratio_isotonic"}})
        check("build_item_live: only item rows, scope=item, OVER band",
              len(il["rows"]) == 1 and il["rows"][0]["kind"] == "item"
              and il["rows"][0]["scope"] == "item"
              and il["rows"][0]["dps"] == 20.0
              and il["rows"][0]["status"] == "OVER", il["rows"])

        # ------------------------------------------------------------------
        # 7. dps-proxy parity with check_stat_bands hand values
        # ------------------------------------------------------------------
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
        heal_def = {"rarity": "Common", "effects": [
            {"trigger": {"t": "every_secs", "s": [2, 2]},
             "verb": {"t": "heal_ally", "n": [5, 5]}}]}
        _, counted_heal = CB.live_def_dps(heal_def)
        check("live dps: non-damage verb not counted", counted_heal == 0)
        skill_def = {"trigger": {"t": "every_secs", "s": [2, 2]},
                     "verb": {"t": "strike", "n": [6, 10]}}
        dps3, counted3 = CB.live_def_dps(skill_def)
        check("live dps parity: bare skill shape 8/2.0 = 4.0",
              abs(dps3 - 4.0) < 1e-9 and counted3 == 1, (dps3, counted3))
        check("live rarity_of lowercases/caps like check_stat_bands",
              CB.live_rarity_of({"rarity": "uncommon"}) == "Uncommon"
              and CB.live_rarity_of({}) is None)

        # ------------------------------------------------------------------
        # 8. two builds byte-identical PER PAGE
        # ------------------------------------------------------------------
        tmp2 = tempfile.mkdtemp(prefix="corpus_browser_test2_")
        try:
            _, p2 = build_into(tmp2, out_sub="out2")
            for name in ("index", "items", "monsters"):
                a = open(out_paths[name], "rb").read()
                b = open(p2[name], "rb").read()
                check("two builds byte-identical: %s.html" % name, a == b,
                      "len %d vs %d" % (len(a), len(b)))
        finally:
            shutil.rmtree(tmp2, ignore_errors=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d passed, %d failed" % (_pass, _fail))
    return 1 if _fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
