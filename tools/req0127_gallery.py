#!/usr/bin/env python3
"""REQ-0127 unit roster gallery -> web/preview/units-001/index.html

Golden G4: every candidate at 256 px AND 64 px, side by side, NUMBERED, so the
S7 verdict can be given by key (e.g. "unit-elf-202 green", or "elf: 303").

Scoring is a FILTER ONLY (ratified golden deviation from the item route): a
candidate under 20 % coverage is flagged FAIL and greyed, but the gallery never
picks a winner -- the user's verdict does. A flagged candidate is still shown,
because the reason it failed is often visible and worth seeing.
"""
import glob
import json
import os
import re
import shutil
import sys

import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BATCH = os.path.join(REPO, "content/batches/units-001-roster")
SRC = os.path.join(BATCH, "candidates")
OUT = os.path.join(REPO, "web/preview/units-001")
DEFS = os.path.join(BATCH, "unit_defs.json")

COVERAGE_MIN = 20.0          # art_golden auto-FAIL threshold (filter only)
RAW = re.compile(r"^(?P<id>.+)_c(?P<c>\d+)_s(?P<seed>\d+)\.png$")


def coverage(alpha_path):
    if not os.path.exists(alpha_path):
        return None
    a = np.asarray(Image.open(alpha_path).convert("RGBA"))
    return float((a[..., 3] > 200).mean() * 100)


def main():
    os.makedirs(OUT, exist_ok=True)
    order = [e["id"] for e in json.load(open(DEFS))["entries"]]

    rows, n, fails = [], 0, 0
    for uid in order:
        cells = []
        for p in sorted(glob.glob(os.path.join(SRC, f"{uid}_c*_s*.png"))):
            m = RAW.match(os.path.basename(p))
            if not m:
                continue
            seed = m.group("seed")
            alpha = p[:-4] + "_alpha.png"
            cov = coverage(alpha)
            n += 1
            key = f"{uid}-{seed}"

            # publish the matted 256 + 64 next to index.html
            src_img = alpha if os.path.exists(alpha) else p
            im = Image.open(src_img).convert("RGBA")
            b256, b64 = f"{key}_256.png", f"{key}_64.png"
            im.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, b256))
            im.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, b64))
            shutil.copy(p, os.path.join(OUT, f"{key}_raw.png"))

            bad = cov is not None and cov < COVERAGE_MIN
            fails += bad
            tag = (f'<div class="cov fail">FAIL coverage {cov:.1f}%</div>'
                   if bad else
                   f'<div class="cov">coverage {cov:.1f}%</div>'
                   if cov is not None else '<div class="cov">no matte</div>')
            cells.append(
                f'<td class="{"bad" if bad else ""}">'
                f'<div class="key">{key}</div>'
                f'<a href="{key}_raw.png"><img class="i256" src="{b256}"></a>'
                f'<img class="i64" src="{b64}">{tag}</td>')
        if cells:
            rows.append(f'<tr><th>{uid}</th>{"".join(cells)}</tr>')

    html = f"""<!doctype html><meta charset="utf-8">
<title>REQ-0127 unit roster 001 (flux2)</title>
<style>
body{{background:#131820;color:#E9E3D3;font:14px/1.5 system-ui;margin:20px}}
table{{border-collapse:collapse}}
td,th{{border:1px solid #3D434C;padding:8px;vertical-align:top;text-align:left}}
.i256{{width:256px;height:256px;display:block;background:
  repeating-conic-gradient(#28313E 0% 25%,#1a2028 0% 50%) 0 0/32px 32px}}
.i64{{width:64px;height:64px;display:block;margin-top:6px;background:
  repeating-conic-gradient(#28313E 0% 25%,#1a2028 0% 50%) 0 0/16px 16px}}
.key{{color:#C9A959;font-weight:600;margin-bottom:6px}}
.cov{{color:#A8A193;font-size:12px;margin-top:4px}}
.cov.fail{{color:#E25822;font-weight:600}}
td.bad{{background:#2a1a1a}}
h1{{color:#C9A959}} b{{color:#7FB069}}
</style>
<h1>REQ-0127 — unit roster 001</h1>
<p>Route: <b>flux2</b> (FLUX.2 klein 4B distilled, GGUF Q8_0) — the checkpoint
ratified by REQ-0136. 12 units x 4 seeds (101/202/303/404) = {n} candidates.
Matte: birefnet-general + border-key fallback.</p>
<p><b>This is the S7 stop.</b> Nothing here has entered <code>content/live/</code>.
Give the verdict by key, e.g. <b>"unit-elf-202 green"</b>, or per unit
(<b>"elf: 303"</b>). Click a 256 px image for the raw 1024 px generation.</p>
<p>Scoring is a <b>filter only</b>: coverage &lt; {COVERAGE_MIN:.0f}% is flagged
FAIL (red) and never enters the roster, but the score does NOT pick winners —
your verdict does. Flagged candidates are still shown, because the reason is
usually visible. Auto-FAILed: <b>{fails}</b> of {n}.</p>
<p><small>Note on this route: the negative prompt is inactive at cfg 1.0, so
style is steered from the positive prompt only. Seeds vary less than they did on
SDXL — the 4 candidates are close variants rather than 4 alternatives. If none
of a unit's four work, the re-roll lever is the PROMPT, not the seed.</small></p>
<table>
<tr><th>unit</th><th>seed 101</th><th>seed 202</th><th>seed 303</th><th>seed 404</th></tr>
{chr(10).join(rows)}
</table>
"""
    with open(os.path.join(OUT, "index.html"), "w") as f:
        f.write(html)
    print(f"gallery: {OUT}/index.html  ({n} candidates, {fails} auto-FAIL)")


if __name__ == "__main__":
    main()
