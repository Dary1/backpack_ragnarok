#!/usr/bin/env python3
"""REQ-0150 §3 -- rebuild every defs file onto the ratified art direction.

The old defs are unusable as they stand, for three independent reasons:
  1. their `gen_prompt` carries the RETIRED Norse painterly style paragraph
     baked into the string. Style now lives in tools/art_style.py, and the defs
     carry the SUBJECT ONLY.
  2. their `gen_negative` is DEAD (this route has no negative). It is not copied
     forward -- REQ-0150 is explicit that a ported prompt leaning on gen_negative
     must be REWRITTEN, not copied.
  3. their `gen_px` is a square ~1MP frame that is then downscaled. Retired: the
     generation size now matches the CELL FOOTPRINT'S ASPECT RATIO. That is the
     change that made the user's 1x3 sword fill its own icon instead of floating
     in the middle of it.

Plain, simple subjects -- the Art Golden says so ("gorgeous names do not yield
better art"), and the user's own ratified prompts are exactly that short.

UNITS: no gear nouns. Proved with a falsifier this session -- "dagger", "belts and
pouches", "leather armor" name things below the shoulders and the model widens the
shot out of a bust to show them, even with `portrait` present. Name the CHARACTER,
not the kit. (Cost, stated: the kit stops being visible.)
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import art_style as STYLE

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- items: subject only. bbox_cells is [w, h] (shape entries are [row, col]).
ITEM_SUBJECTS = {
    "blade":        "longsword blade",
    "hilt":         "sword hilt",
    "flame_tablet": "flame rune tablet",
    "oil_flask":    "oil flask",
    "dagger":       "dagger",
    "herb_pouch":   "herb pouch",
    "tower_shield": "tower shield",
    "beast_jaw":    "beast jaw",
}
ITEM_SUFFIX = ", white background, bold outline"     # the user's item prompt shape
ITEM_PX_PER_CELL = 256                                # the user's item resolution

# --- units: plain concept, NO GEAR NOUNS, the user's unit prompt shape.
UNIT_SUBJECTS = {
    "unit-elf":          "female elf",
    "unit-dwarf":        "dwarf",
    "unit-thief":        "female thief, fantasy rogue, hooded",
    "unit-angel":        "angel",
    "unit-shieldmaiden": "shieldmaiden",
    "unit-priest":       "old priest",
    "unit-princess":     "little princess",
    "unit-lightcavalry": "light cavalry rider",
    "unit-berserker":    "berserker",
    "unit-watcher":      "hooded watcher",
    "unit-squire":       "young squire",
}
UNIT_SUFFIX = ", portrait, looking at viewer, white background"
UNIT_PX = [512, 512]

# --- monsters: subject + a cell footprint chosen by BODY PLAN.
# Illustration-first (Art Golden): the real footprint is DERIVED from the approved
# art afterwards. These are generation ASPECT hints only, not a data commitment.
MON_PX_PER_CELL = 128
MONSTERS = [
    # id                subject                cells (w,h)   why
    ("goblin",          "goblin",              (3, 4)),   # humanoid
    ("goblin_shaman",   "goblin shaman",       (3, 4)),
    ("gnoll",           "gnoll",               (3, 4)),
    ("ogre",            "ogre",                (4, 4)),   # bulky humanoid
    ("wight",           "wight",               (3, 4)),
    ("cockatrice",      "cockatrice",          (3, 4)),   # bipedal
    ("boar",            "wild boar",           (4, 3)),   # quadruped, landscape
    ("giant_rat",       "giant rat",           (4, 3)),
    ("chimera",         "chimera",             (6, 4)),   # large beast
    ("giant_snake",     "giant snake",         (4, 4)),   # coiled
    ("mimic",           "mimic treasure chest", (4, 3)),
    ("ancient_dragon",  "ancient dragon",      (10, 10)), # boss
]


def main():
    # ---------- items ----------
    live = json.load(open(os.path.join(REPO, "content/live/live_items.json")))
    entries = []
    for e in live["entries"]:
        eid = e["id"]
        if eid not in ITEM_SUBJECTS:
            print("SKIP item", eid, "(no subject authored)"); continue
        old = e.get("gen_render", {})
        bw, bh = old["bbox_cells"]
        gw, gh = STYLE.gen_size(bw, bh, ITEM_PX_PER_CELL)
        cell = old.get("cell_px", 256)
        entries.append({
            "id": eid, "name": e.get("name", eid), "kind": "item",
            "gen_prompt": ITEM_SUBJECTS[eid] + ITEM_SUFFIX,
            "gen_render": {
                "cell_px": cell,
                "cells": old["cells"],
                "bbox_cells": [bw, bh],
                "mask_cells": old.get("mask_cells"),
                "gen_px": [gw, gh],
                "target_px": [bw * cell, bh * cell],
            },
        })
        print("item  %-14s %dx%d cells -> gen %dx%d" % (eid, bw, bh, gw, gh))
    out = os.path.join(REPO, "content/batches/batch-004-item-icons-flux2")
    os.makedirs(out, exist_ok=True)
    json.dump({"schema": "itemdefs/2", "entries": entries},
              open(os.path.join(out, "item_defs.json"), "w"), indent=2)

    # ---------- units ----------
    old = json.load(open(os.path.join(
        REPO, "content/batches/units-001-roster/unit_defs.json")))
    uents = []
    for e in old["entries"]:
        uid = e["id"]
        uents.append({
            "id": uid, "name": e.get("name", uid), "kind": "unit",
            "gen_prompt": UNIT_SUBJECTS[uid] + UNIT_SUFFIX,
            "gen_render": {"cell_px": 256, "cells": [[0, 0]], "bbox_cells": [1, 1],
                           "gen_px": UNIT_PX, "target_px": [256, 256]},
        })
        print("unit  %-18s %s" % (uid, UNIT_SUBJECTS[uid]))
    out = os.path.join(REPO, "content/batches/units-002-roster-flux2")
    os.makedirs(out, exist_ok=True)
    json.dump({"schema": "unitdefs/2", "entries": uents},
              open(os.path.join(out, "unit_defs.json"), "w"), indent=2)

    # ---------- monsters ----------
    jobs = []
    for mid, subject, (cw, ch) in MONSTERS:
        gw, gh = STYLE.gen_size(cw, ch, MON_PX_PER_CELL)
        for seed in (1, 202):
            jobs.append({"name": "%s_s%d" % (mid, seed),
                         "positive": subject + ", white background",
                         "width": gw, "height": gh, "seed": seed,
                         "cells_hint": [cw, ch]})
        print("mon   %-16s %dx%d cells -> gen %dx%d" % (mid, cw, ch, gw, gh))
    out = os.path.join(REPO, "content/batches/monsters-003-flux2")
    os.makedirs(out, exist_ok=True)
    json.dump(jobs, open(os.path.join(out, "jobs.json"), "w"), indent=2)

    print("\n%d items, %d units, %d monster jobs" % (len(entries), len(uents), len(jobs)))
    print("\nsample rendered prompts:")
    print("  item :", STYLE.for_kind("item", entries[0]["gen_prompt"]))
    print("  unit :", STYLE.for_kind("unit", uents[0]["gen_prompt"]))
    print("  mon  :", STYLE.for_kind("monster", jobs[0]["positive"]))


if __name__ == "__main__":
    main()
