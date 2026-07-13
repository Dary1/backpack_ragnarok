#!/usr/bin/env python3
# =============================================================================
# DEPRECATED (REQ-0150, 2026-07-13). NOT part of the pipeline. Do not extend it,
# do not copy from it, do not cite it as precedent.
#
# REQ-0135 scratch.
#
# The pipeline is now:
#   tools/art_route.py       the ONE route (FLUX.2 klein) and the ONE graph
#   tools/art_style.py       the ONE prompt/style layer (ratified art direction)
#   tools/gen_item_icons.py  item + unit icons (defs-driven)
#   tools/gen_monster_art.py monster illustrations
#   tools/gen_bpskin.py      backpack skins: generate -> GATE -> compose
#   tools/bpskin_compose.py  fill + welt -> skin, over any polyomino
# Kept only so old batches can be read back. See docs/llm_managed/*_pipeline.md.
# =============================================================================

"""REQ-0135 spike: build spike_defs.json.

Subjects biased to the worst matte cases named by the REQ:
  hilt   (live defs)  -- verified pain: 10.99% birefnet coverage, 1x1
  blade  (live defs)  -- thin blade, 1x2 vertical
  dagger (live defs)  -- thin blade + fine tip, 1x2 vertical
  wing   (custom)     -- feather/wing: fine wispy feather tips, 1x1
  elf_bust (custom)   -- unit hair: fine loose hair strands, 1x1
                          (unit_icon_pipeline S2 style: bust, 1x1)

hilt/blade/dagger are copied verbatim from content/live/live_items.json so
route A is byte-identical to production prompts. The two custom subjects
follow the batch-003 style-guide template (stylization front-loaded,
near-white background clause kept for A/B fairness on both routes).
"""
import json
import sys

LIVE = sys.argv[1]   # content/live/live_items.json
OUT = sys.argv[2]    # .../spike_defs.json

STYLE_TAIL = (
    "stylized painterly dark-fantasy game item icon, hand-painted illustration, "
    "digital painting, concept art, soft cel-shading, matte finish, "
    "weathered forged materials, muted desaturated palette of aged iron grey "
    "worn leather and tarnished gold, Norse mythology aesthetic, grim and ancient, "
    "gentle top-left key light, subtle cool rim light, crisp readable silhouette, "
    "single centered object, plain uniform near-white background, clean flat backdrop, "
    "no shadow, no gradient, high detail, sharp focus"
)
CHAR_TAIL = STYLE_TAIL.replace("game item icon", "game character icon")
NEG = (
    "photograph, photorealistic, realistic, 3d render, cgi, octane render, "
    "ray tracing, product photography, studio lighting, glossy, plastic, "
    "hyperreal, text, letters, numbers, words, watermark, signature"
)
RENDER_1X1 = {"cell_px": 256, "cells": [[0, 0]], "bbox_cells": [1, 1],
              "target_px": [256, 256], "gen_px": [1024, 1024]}

CUSTOM = [
    {
        "id": "wing",
        "name": "Feathered Wing",
        "shape": [[0, 0]],
        "gen_render": RENDER_1X1,
        "gen_prompt": (
            "a single outstretched feathered wing, layered pale ivory and "
            "grey feathers with fine wispy feather tips and soft downy edges, "
            "weathered and ancient, compact single object centered, filling "
            "the square frame with a small even margin, " + STYLE_TAIL),
        "gen_negative": NEG,
    },
    {
        "id": "elf_bust",
        "name": "Elf Ranger (unit-hair probe)",
        "shape": [[0, 0]],
        "gen_render": RENDER_1X1,
        "gen_prompt": (
            "an elf ranger character bust portrait, elegant sharp face with "
            "pointed ears, long flowing silver hair with fine loose flyaway "
            "strands, worn leather jerkin and muted green cloak, compact bust "
            "portrait centered, filling the square frame with a small even "
            "margin, " + CHAR_TAIL),
        "gen_negative": NEG,
    },
]

live = json.load(open(LIVE))
keep = {"id", "name", "shape", "gen_render", "gen_prompt", "gen_negative"}
entries = [{k: v for k, v in e.items() if k in keep}
           for e in live["entries"] if e["id"] in ("hilt", "blade", "dagger")]
entries += CUSTOM

json.dump({"entries": entries}, open(OUT, "w"), indent=2)
print("wrote", OUT, "subjects:", [e["id"] for e in entries])
