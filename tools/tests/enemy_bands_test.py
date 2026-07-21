#!/usr/bin/env python3
"""REQ-0275 -- enemy_bands tests (stdlib, plain python3, assert-style).

Runs OFFLINE on hand-built fixtures. Asserts:
  1. def_dps parity with tools/check_stat_bands.cjs (strike / multi_strike /
     non-damage / bare-skill shapes)
  2. _percentile matches hand values
  3. band math: warn_lo=min*0.75, warn_hi=max*1.25, flag_multiple=2.0
  4. compute_bands on a small synthetic corpus == hand-computed numbers
  5. provisional flips at n<30; skill_dps n_na counting
  6. two computes are byte-identical (determinism), no timestamp

No network, no third-party deps -- runnable under bare `python3`.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
sys.path.insert(0, TOOLS)

import enemy_bands as EB  # noqa: E402

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


# ---- 1. def_dps parity ----------------------------------------------------
strike = {"trigger": {"t": "every_secs", "s": [1.8, 2.2]},
          "verb": {"t": "strike", "n": [8, 12]}}
dps, counted = EB.def_dps(strike)
check("def_dps strike 10/2.0 = 5.0", abs(dps - 5.0) < 1e-9 and counted == 1,
      (dps, counted))

multi = {"trigger": {"t": "every_secs", "s": [1, 1]},
         "verb": {"t": "multi_strike", "n": [4, 6]}}
dps, counted = EB.def_dps(multi)
check("def_dps multi_strike 5/1 = 5.0", abs(dps - 5.0) < 1e-9 and counted == 1,
      (dps, counted))

heal = {"trigger": {"t": "every_secs", "s": [2, 2]},
        "verb": {"t": "heal_ally", "n": [5, 5]}}
dps, counted = EB.def_dps(heal)
check("def_dps non-damage verb -> counted 0", counted == 0 and dps == 0.0,
      (dps, counted))

nontick = {"trigger": {"t": "on_hit"}, "verb": {"t": "strike", "n": [10, 10]}}
_, counted = EB.def_dps(nontick)
check("def_dps non-every_secs trigger -> counted 0", counted == 0)

# effects[] shape sums (item-like)
item = {"effects": [strike, multi, heal]}
dps, counted = EB.def_dps(item)
check("def_dps sums over effects (5+5, heal skipped) = 10, counted 2",
      abs(dps - 10.0) < 1e-9 and counted == 2, (dps, counted))

# ---- 2. percentile hand values --------------------------------------------
vals = [20.0, 50.0]
check("percentile p25 [20,50] = 27.5", EB._percentile(vals, 25) == 27.5)
check("percentile p50 [20,50] = 35.0", EB._percentile(vals, 50) == 35.0)
check("percentile p75 [20,50] = 42.5", EB._percentile(vals, 75) == 42.5)

# ---- 3. band math ---------------------------------------------------------
g = EB._group_stats([20.0, 50.0])
check("band warn_lo = min*0.75 = 15.0", g["band"]["warn_lo"] == 15.0, g["band"])
check("band warn_hi = max*1.25 = 62.5", g["band"]["warn_hi"] == 62.5, g["band"])
check("band flag_multiple = 2.0", g["band"]["flag_multiple"] == 2.0, g["band"])
check("group min/max/median", g["min"] == 20.0 and g["max"] == 50.0
      and g["median"] == 35.0, g)
check("empty group -> band null, n 0",
      EB._group_stats([])["band"] is None and EB._group_stats([])["n"] == 0)

# ---- 5. provisional + n_na ------------------------------------------------
check("provisional true at n=29", EB._group_stats([1.0] * 29)["provisional"] is True)
check("provisional false at n=30", EB._group_stats([1.0] * 30)["provisional"] is False)

# ---- 4. compute_bands on a synthetic corpus -------------------------------
skills = [
    {"id": "s_strike", "trigger": {"t": "every_secs", "s": [1.8, 2.2]},
     "verb": {"t": "strike", "n": [8, 12]}},                    # dps 5.0
    {"id": "s_big", "trigger": {"t": "every_secs", "s": [2, 2]},
     "verb": {"t": "strike", "n": [20, 20]}},                   # dps 10.0
    {"id": "s_multi", "trigger": {"t": "every_secs", "s": [1, 1]},
     "verb": {"t": "multi_strike", "n": [4, 6]}},               # dps 5.0
    {"id": "s_heal", "trigger": {"t": "every_secs", "s": [2, 2]},
     "verb": {"t": "heal_ally", "n": [5, 5]}},                  # na
]
enemies = [
    {"id": "e1", "rarity": "common", "hp": [10, 30], "skills": ["s_strike"]},
    {"id": "e2", "rarity": "common", "hp": [40, 60],
     "skills": ["s_big", "s_heal"]},
    {"id": "e3", "rarity": "rare", "hp": [100, 200], "skills": ["s_multi"]},
]
b = EB.compute_bands(enemies, skills)

check("schema/basis fields", b["schema"] == "enemy_bands/1"
      and b["basis"] == "live_self", (b["schema"], b["basis"]))
check("generated_from is sha256", isinstance(b["generated_from"], str)
      and b["generated_from"].startswith("sha256:"))

hp_c = b["enemy_hp"]["common"]
check("enemy_hp common n=2 hp mids [20,50]",
      hp_c["n"] == 2 and hp_c["min"] == 20.0 and hp_c["max"] == 50.0, hp_c)
check("enemy_hp common band 15..62.5",
      hp_c["band"]["warn_lo"] == 15.0 and hp_c["band"]["warn_hi"] == 62.5,
      hp_c["band"])
hp_r = b["enemy_hp"]["rare"]
check("enemy_hp rare single value 150 band 112.5..187.5",
      hp_r["n"] == 1 and hp_r["median"] == 150.0
      and hp_r["band"]["warn_lo"] == 112.5 and hp_r["band"]["warn_hi"] == 187.5,
      hp_r)
# rarities with no enemies still present, empty
check("empty rarities present with n=0",
      b["enemy_hp"]["uncommon"]["n"] == 0
      and b["enemy_hp"]["relic"]["n"] == 0)

dps_c = b["enemy_total_dps"]["common"]
check("enemy_total_dps common values [5,10] band 3.75..12.5",
      dps_c["min"] == 5.0 and dps_c["max"] == 10.0
      and dps_c["band"]["warn_lo"] == 3.75 and dps_c["band"]["warn_hi"] == 12.5,
      dps_c)
dps_r = b["enemy_total_dps"]["rare"]
check("enemy_total_dps rare single 5.0 (multi_strike) band 3.75..6.25",
      dps_r["min"] == 5.0 and dps_r["max"] == 5.0
      and dps_r["band"]["warn_hi"] == 6.25, dps_r)

sd = b["skill_dps"]
check("skill_dps pooled n=3 n_na=1 (heal excluded)",
      sd["n"] == 3 and sd["n_na"] == 1, sd)
check("skill_dps values sorted [5,5,10] -> min5 max10 median5 p75 7.5",
      sd["min"] == 5.0 and sd["max"] == 10.0 and sd["median"] == 5.0
      and sd["p75"] == 7.5, sd)
check("skill_dps band 3.75..12.5", sd["band"]["warn_lo"] == 3.75
      and sd["band"]["warn_hi"] == 12.5, sd["band"])
check("skill_dps provisional true at n=3", sd["provisional"] is True)

# ---- 6. determinism / no timestamp ----------------------------------------
j1 = EB.canonical_json(EB.compute_bands(enemies, skills))
j2 = EB.canonical_json(EB.compute_bands(enemies, skills))
check("compute_bands byte-identical across reruns", j1 == j2)
check("no wall-clock timestamp in output",
      "T00:" not in j1 and "generatedAt" not in j1 and "date" not in j1)

print("\n%d passed, %d failed" % (_pass, _fail))
sys.exit(1 if _fail else 0)
