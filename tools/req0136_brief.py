#!/usr/bin/env python3
# =============================================================================
# DEPRECATED (REQ-0150, 2026-07-13). NOT part of the pipeline. Do not extend it,
# do not copy from it, do not cite it as precedent.
#
# Bakeoff brief. History only.
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

"""REQ-0136: off-brief detector.

Found by LOOKING at the gallery, not by any metric already in the pipeline:
v9/unit-berserker/s101 is not a bust on a near-white ground at all -- it is a
zoomed-in rock wall with several partial heads and loose fur. The matte then
did its honest best on that and produced a shredded, hole-punched icon. So the
failure is in GENERATION, not in matting (that distinction matters: matting is
REQ-0135's problem, and this is not that).

The pipeline could not catch this. `tool_icon_score.py` only auto-FAILs
coverage < 20%, and a full-frame rock wall gives HIGH coverage -- an off-brief
image sails through a coverage gate precisely because it fills the frame.

So measure the thing the style guide actually demands: a near-white background.
For each raw 1024px generation, take the median colour of a thin border ring.
On-brief => that ring is near-white (the subject is a centred bust/prop). A
dark ring means the model ignored the background instruction and painted a
scene -- which also means the matte has no clean key to work from.

Reported per contender as an off-brief RATE, which is a checkpoint-selection
signal in its own right: a checkpoint that wanders off-brief 1 time in 4 costs
a re-roll on every roster batch.
"""
import glob
import json
import os
import re

import numpy as np
from PIL import Image

CAND = os.path.expanduser(
    "~/backpack_ragnarok_worktrees/req-0136-icon-checkpoint-bakeoff"
    "/content/batches/bakeoff-0136/candidates")

# near-white per the unit/item style guide; a generous threshold so we only
# flag images that are plainly not on a light ground.
WHITE_MIN = 200.0


def ring_median(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    ring = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3),
                           a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    return float(np.median(ring.mean(axis=1)))


def coverage(path):
    p = path[:-4] + "_alpha.png"
    if not os.path.exists(p):
        return None
    a = np.asarray(Image.open(p).convert("RGBA"))
    return float((a[..., 3] > 200).mean() * 100)


rows, offs = {}, {}
for c in ("v9", "dsxl", "flux"):
    raws = sorted(p for p in glob.glob(os.path.join(CAND, c, "*.png"))
                  if not re.search(r"_(256|64|alpha)\.png$", p))
    bad = []
    for p in raws:
        bg = ring_median(p)
        cov = coverage(p)
        if bg < WHITE_MIN:
            bad.append((os.path.basename(p)[:-4], round(bg), round(cov or -1, 1)))
    rows[c] = (len(raws), len(bad))
    offs[c] = bad

print(f"{'leg':<6}{'n':>4}{'off-brief':>11}{'rate':>8}")
for c, (n, b) in rows.items():
    print(f"{c:<6}{n:>4}{b:>11}{b / n * 100:>7.0f}%")
print("\noff-brief candidates (background not near-white -> no clean matte key):")
for c, bad in offs.items():
    for name, bg, cov in bad:
        print(f"  {c}/{name:<22} bg_ring={bg:>3}/255  coverage={cov}%")

json.dump({"white_min": WHITE_MIN,
           "rates": {c: {"n": n, "off_brief": b} for c, (n, b) in rows.items()},
           "off_brief": {c: [x[0] for x in v] for c, v in offs.items()}},
          open(os.path.join(CAND, "..", "brief_check.json"), "w"), indent=2)
print("\nwrote brief_check.json")
