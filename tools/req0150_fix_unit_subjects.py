#!/usr/bin/env python3
"""REQ-0150 §3 -- unit subjects, round 2. The style landed; SEVEN of eleven did not.

Round 1 followed two rules, and both were right as far as they went:
  - the Art Golden's "plain, simple names";
  - "no GEAR nouns" (proved this session: "dagger", "belts and pouches", "leather
    armor" widen the shot out of a bust because they name things below the
    shoulders).
Obeying both, 7 of 11 units still missed. So the rules were incomplete. Two things
are actually going on, and they pull in opposite directions:

1. ANY noun implying something OUTSIDE THE HEAD drags it into frame and widens the
   shot -- not just KIT, but also STATURE and RELATION.
     unit-dwarf        "dwarf"               -> gnome-like little men, FULL BODY 2/4,
                                                with no gear noun anywhere. "dwarf"
                                                is a STATURE word.
     unit-lightcavalry "light cavalry rider" -> a HORSE, 4/4, full body. "rider" is
                                                a RELATIONAL word; it drags the
                                                mount in with it.

2. THE ANIME TEMPLATE DRIFTS MODERN. Its "shounen, seinen" tokens, given a subject
   with no fantasy iconography of its own, produce a generic contemporary anime
   character:
     unit-angel     "angel"          -> blonde girls, NO wings, NO halo; one in a
                                        blazer and tie.
     unit-princess  "little princess"-> schoolgirls, 3/4. Only c3 had a tiara.
     unit-berserker "berserker"      -> young men in tank tops. No beard, no fur.
     unit-watcher   "hooded watcher" -> men in modern HOODIES.
     unit-squire    "young squire"   -> boys in school/cadet uniforms.

   The four that LANDED (elf, thief, shieldmaiden, priest) all carry their own
   fantasy iconography ABOVE THE SHOULDERS: pointed ears; a hood the prompt calls
   a "fantasy rogue"'s; plate pauldrons; a cowl and a tonsure. That is the rule.

So a unit subject must (a) state its identity in FACE-AND-SHOULDER terms -- wings,
halo, crown, beard, helm, fur, cowl: things that are actually IN a bust -- and
(b) pin the framing explicitly where the identity is bodily. `portrait` alone is
demonstrably not enough; it was present in every prompt of round 1.

Untouched, because they landed: elf, thief, shieldmaiden, priest.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import art_style as STYLE  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFS = os.path.join(REPO, "content/batches/units-002-roster-flux2/unit_defs.json")

FIXED = {
    "unit-dwarf": "a dwarf blacksmith with a thick braided iron-grey beard, a heavy "
                  "brow and a forge-scarred face, riveted steel pauldrons, "
                  "bust, head and shoulders",
    "unit-angel": "an angel with large white feathered wings rising behind the "
                  "shoulders and a golden halo, silvered breastplate, serene face, "
                  "bust, head and shoulders",
    "unit-princess": "a young princess wearing a golden crown and a jewelled royal "
                     "collar, high-collared court gown, composed noble face, "
                     "bust, head and shoulders",
    "unit-lightcavalry": "a light cavalry soldier wearing a plumed open-faced steel "
                         "helmet, boiled-leather lamellar collar, wind-burned face, "
                         "bust, head and shoulders",
    "unit-berserker": "a viking berserker with a wild braided red-brown beard and "
                      "shaved temples, a dark bear pelt over bare shoulders, an iron "
                      "arm ring, fierce battle-scarred face, bust, head and shoulders",
    "unit-watcher": "a mysterious hooded watcher in a long grey wool travel cloak, "
                    "face lost in shadow under the hood, a faintly glowing lantern "
                    "amulet at the throat, bust, head and shoulders",
    "unit-squire": "a young squire in a padded gambeson and a mail collar, holding a "
                   "polished steel kettle helm, earnest hopeful face, "
                   "bust, head and shoulders",
}
SUFFIX = ", portrait, looking at viewer, white background"


def main():
    d = json.load(open(DEFS))
    for e in d["entries"]:
        if e["id"] in FIXED:
            e["gen_prompt"] = FIXED[e["id"]] + SUFFIX
            print("%-18s -> %s" % (e["id"], e["gen_prompt"][:76]))
    json.dump(d, open(DEFS, "w"), indent=2)
    print("\n%d unit subjects rewritten; 4 left alone (elf, thief, shieldmaiden, "
          "priest -- they landed)" % len(FIXED))
    print("ids:", ",".join(FIXED))


if __name__ == "__main__":
    main()
