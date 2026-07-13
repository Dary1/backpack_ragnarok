#!/usr/bin/env python3
"""REQ-0150 §3 -- item subjects, round 2. The style landed; five SUBJECTS did not.

Round 1 used the plain item names from live_items.json, per the Art Golden
("plain, simple names; gorgeous names do not yield better art"). That rule is
right, and it is not the problem. The problem is that five of these names are not
what the model thinks they are:

  hilt          "sword hilt"       -> a WHOLE SWORD, 4/4. "hilt" is not an object
                                      the model can render alone.
  tower_shield  "tower shield"     -> a STONE TOWER, 4/4. It read the compound
                                      noun as "tower".
  blade         "longsword blade"  -> a whole sword WITH a handle, 4/4.
  beast_jaw     "beast jaw"        -> a whole monster HEAD, 4/4.
  dagger        "dagger"           -> longswords. The 1x2 tall footprint is
                                      pulling the blade long.

The common thread: PART-OF nouns ("blade", "hilt", "jaw") and compound nouns the
model resolves to the wrong head word ("tower shield"). The fix is not a longer
style paragraph -- style is fine. It is to SAY WHAT THE OBJECT IS, positively,
because there is no negative prompt on this route to say what it is not.

Not touched: flame_tablet, oil_flask, herb_pouch -- they landed.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import art_style as STYLE  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFS = os.path.join(REPO, "content/batches/batch-004-item-icons-flux2/item_defs.json")

FIXED = {
    "blade": "a detached sword blade only, a bare steel blade with no handle and "
             "no grip, just the blade",
    "hilt": "a detached sword handle only, grip and crossguard and pommel, with "
            "no blade attached, just the handle",
    "tower_shield": "a large heavy rectangular shield, a tall wooden and iron "
                    "shield with a metal boss, medieval armour",
    "beast_jaw": "a monster jawbone, a detached fanged bone jaw trophy, bleached "
                 "bone with sharp teeth, no flesh, no head",
    "dagger": "a short dagger, a small knife with a short pointed blade",
}
SUFFIX = ", white background, bold outline"


def main():
    d = json.load(open(DEFS))
    n = 0
    for e in d["entries"]:
        if e["id"] in FIXED:
            e["gen_prompt"] = FIXED[e["id"]] + SUFFIX
            n += 1
            print("%-14s -> %s" % (e["id"], STYLE.for_kind("item", e["gen_prompt"])[:96]))
    json.dump(d, open(DEFS, "w"), indent=2)
    print("\n%d item subjects rewritten; 3 left alone (flame_tablet, oil_flask, herb_pouch)" % n)
    print("ids to regenerate:", ",".join(FIXED))


if __name__ == "__main__":
    main()
