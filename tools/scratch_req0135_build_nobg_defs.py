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

"""REQ-0135b: build spike_defs_nobg.json — the LayerDiffuse arm WITHOUT a
background clause in the positive prompt.

Why this exists
---------------
The ratified spike kept "plain uniform near-white background" / "clean flat
backdrop" in the positive prompt on BOTH routes, described as "for A/B
fairness". The 2026-07-12 smoke test showed that this clause is precisely what
defeats LayerDiffuse: told to paint a near-white background, SDXL+LD paints one
and reports it as opaque. The emitted alpha was ~fully opaque (mean 0.962,
96.6% of pixels > 0.5, coverage 99.93% vs route A's 11.50% on the same subject).

Keeping the clause is not fairness — it is the one instruction that forecloses
the thing REQ-0135b set out to measure ("alpha generated AT diffusion time
instead of separated afterwards; no background separation ever happens").
The honest comparison is:

  route A  : prompt WITH bg clause  -> SDXL paints a backdrop -> rembg separates it
  route C  : prompt WITHOUT bg clause -> LD emits native transparency, nothing to separate

Both still produce an RGBA icon from the same checkpoint/sampler/seeds, so the
matte-edge comparison the REQ asks for stays like-for-like. Route B (LD *with*
the clause) is retained as the evidence for this finding.

Only the positive prompt is touched. gen_negative is left byte-identical.
"""
import json
import pathlib
import re
import sys

SRC = pathlib.Path("content/batches/req-0135-layerdiffuse-spike/spike_defs.json")
DST = pathlib.Path("content/batches/req-0135-layerdiffuse-spike/spike_defs_nobg.json")

BG_RE = re.compile(r"background|backdrop", re.I)

d = json.loads(SRC.read_text())
changed = 0
for e in d["entries"]:
    p = e["gen_prompt"]
    # gen_prompt is a comma-separated clause list (with some newlines). Drop only
    # the clauses that instruct a background; keep everything else byte-identical.
    kept, dropped = [], []
    for seg in p.split(","):
        (dropped if BG_RE.search(seg) else kept).append(seg)
    if not dropped:
        print(f"  {e['id']}: no bg clause found (unchanged)")
        continue
    e["gen_prompt"] = ",".join(kept)
    changed += 1
    for seg in dropped:
        print(f"  {e['id']}: dropped -> {seg.strip()!r}")

if not changed:
    sys.exit("ABORT: nothing changed — check the clause regex")

d["_req0135b_note"] = (
    "LayerDiffuse arm: background/backdrop clauses stripped from gen_prompt. "
    "LD generates native transparency; instructing a backdrop makes it paint one "
    "and mark it opaque (smoke test 2026-07-12: alpha mean 0.962, coverage 99.93%). "
    "gen_negative untouched. Everything else identical to spike_defs.json."
)
DST.write_text(json.dumps(d, indent=2, ensure_ascii=False) + "\n")
print(f"\nwrote {DST} ({changed} entries changed)")
