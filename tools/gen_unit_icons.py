#!/usr/bin/env python3
"""REQ-0127 Unit-icon generator -- thin wrapper over tools/gen_item_icons.py
(unit_icon_pipeline.md S3: same ComfyUI route, defs-driven).

Differences from the item invocation, all defaulted here:
  --defs   content/batches/units-001-roster/unit_defs.json
  --outdir content/batches/units-001-roster/candidates
Everything else (4 candidates, seeds 101/202/303/404, 30 steps, cfg 6.5,
dpmpp_2m/karras, birefnet matte + border-key fallback, --rematte-only)
is inherited unchanged from gen_item_icons.py.

--ckpt NAME overrides the SDXL checkpoint (REQ-0136 winner slot). NOTE: if
REQ-0136 ratifies FLUX.2 klein (non-SDXL), this wrapper does NOT cover it;
the route port is then part of REQ-0136's implementation.

`make-defs` subcommand rebuilds unit_defs.json from the style-guide roster
concepts (kept in one place here; style_guide.md quotes the same table).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BATCH = os.path.join(REPO, "content/batches/units-001-roster")
DEFS = os.path.join(BATCH, "unit_defs.json")

TEMPLATE_PRE = "bust portrait of "
TEMPLATE_POST = (
    ", head and shoulders only, single character centered, filling the "
    "square frame with a small even margin,\n"
    "stylized painterly dark-fantasy game character icon, hand-painted "
    "illustration, digital painting, concept art, soft cel-shading, matte "
    "finish, weathered materials, muted desaturated palette of aged iron "
    "grey worn leather and tarnished gold, Norse mythology aesthetic, grim "
    "and ancient, gentle top-left key light, subtle cool rim light, crisp "
    "readable silhouette, plain uniform near-white background, clean flat "
    "backdrop, no shadow, no gradient, high detail, sharp focus")
NEG = (
    "photograph, photorealistic, realistic, 3d render, cgi, octane render, "
    "ray tracing, product photography, studio lighting, glossy, plastic, "
    "hyperreal, text, letters, numbers, words, watermark, signature, logo, "
    "label, frame, border, panel, card, ui, inset, rounded corners, cast "
    "shadow, drop shadow, background gradient, vignette, scenery, "
    "background objects, multiple people, duplicate, collage, cropped, out "
    "of frame, cut off, full body, legs, feet, blurry, low quality, jpeg "
    "artifacts, deformed, extra limbs, extra fingers, cartoon, chibi, "
    "anime, neon, oversaturated")
RENDER = {"cell_px": 256, "cells": [[0, 0]], "bbox_cells": [1, 1],
          "target_px": [256, 256], "gen_px": [1024, 1024]}

CONCEPTS = {
    "unit-elf": ("elf", "a slender sharp-featured elf woman with long pale "
                 "silver hair and pointed ears, weathered green hooded cloak "
                 "over worn leather armor with muted tarnished gold clasps, "
                 "calm piercing gaze"),
    "unit-dwarf": ("dwarf", "a stocky dwarf warrior with a braided iron-grey "
                   "beard and a heavy brow, riveted steel pauldrons over a "
                   "leather apron, a forge-scarred face, stern deep-set eyes"),
    "unit-thief": ("thief", "a wiry hooded thief with a half-masked face and "
                   "sharp amused eyes, dark oiled-leather armor with crossed "
                   "belts and small knives, a loose grey scarf"),
    "unit-angel": ("angel", "a solemn armored angel with folded "
                   "pale-feathered wings behind the shoulders, a plain steel "
                   "circlet and silvered breastplate, serene downcast gaze"),
    "unit-shieldmaiden": ("shieldmaiden", "a fierce shieldmaiden with tight "
                          "blond braids and a painted round shield at her "
                          "shoulder, chainmail over a wool tunic, a thin "
                          "scar across her cheek"),
    "unit-priest": ("priest", "an aged priest with a shaved crown and a "
                    "heavy wool cowl, a tarnished gold holy pendant, "
                    "weathered kind face, hands hidden in wide sleeves"),
    "unit-princess": ("princess", "a young royal princess with a modest "
                      "aged-gold crown over dark braided hair, a "
                      "high-collared layered court dress in muted deep "
                      "blue, composed watchful expression"),
    "unit-lightcavalry": ("light cavalry", "a light cavalry rider with a "
                          "plumed open-faced helm and a short lance over "
                          "the shoulder, boiled-leather lamellar coat, "
                          "wind-burned face"),
    "unit-berserker": ("berserker", "a massive scarred warrior with a wild "
                       "braided red-brown beard and shaved temples, bare "
                       "shoulders draped in a dark bear pelt, iron arm ring "
                       "and a worn leather baldric, fierce battle-hardened "
                       "expression"),
    "unit-watcher": ("watcher", "a hooded watcher with an unreadable "
                     "shadowed face and a single faintly glowing "
                     "lantern-amulet at the throat, long grey travel cloak"),
    "unit-squire": ("squire", "a young earnest squire with cropped hair and "
                    "an oversized padded gambeson, a polished kettle helm "
                    "under one arm, hopeful steady gaze"),
}


def make_defs():
    entries = []
    for uid, (name, concept) in CONCEPTS.items():
        entries.append({
            "id": uid, "name": name,
            "gen_prompt": TEMPLATE_PRE + concept + TEMPLATE_POST,
            "gen_negative": NEG,
            "gen_render": RENDER,
        })
    os.makedirs(BATCH, exist_ok=True)
    with open(DEFS, "w") as f:
        json.dump({"entries": entries}, f, indent=2)
    print(f"wrote {DEFS} ({len(entries)} units)")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "make-defs":
        make_defs()
        return
    if not os.path.exists(DEFS):
        make_defs()
    argv = sys.argv[1:]
    if "--ckpt" in argv:
        i = argv.index("--ckpt")
        ckpt = argv[i + 1]
        del argv[i:i + 2]
    else:
        ckpt = None
    if "--defs" not in argv:
        argv += ["--defs", DEFS]
    if "--outdir" not in argv:
        argv += ["--outdir", os.path.join(BATCH, "candidates")]
    sys.path.insert(0, HERE)
    import gen_item_icons as G
    if ckpt:
        G.CKPT = ckpt
        print(f"checkpoint override: {ckpt}")
    sys.argv = ["gen_item_icons.py"] + argv
    G.main()


if __name__ == "__main__":
    main()
