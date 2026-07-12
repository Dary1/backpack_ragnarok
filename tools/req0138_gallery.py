#!/usr/bin/env python3
"""REQ-0138/0131 preview builders.

  req0138_gallery.py tiling   -> web/preview/bpskin-tiling-0138/index.html
     per motif x seed: seamless tile / half-offset check / 2x2 sheet /
     control (no tiling nodes), + numeric seam ratios table.
  req0138_gallery.py spike    -> web/preview/bpskin-spike-0131/index.html
     motif sheets, cut master tiles + clip masks, harness grid
     (shape suite x 3 canvas backgrounds), leakage table.

Self-contained galleries: images copied next to index.html, dark theme.
Run from the worktree that owns the batch dir (repo-root derived).
"""
import glob
import json
import os
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = """<style>
body{background:#131820;color:#E9E3D3;font:14px/1.5 system-ui;margin:20px}
table{border-collapse:collapse}
td,th{border:1px solid #3D434C;padding:8px;vertical-align:top;text-align:left}
img{display:block;background:
 repeating-conic-gradient(#28313E 0% 25%,#1a2028 0% 50%) 0 0/32px 32px}
.t512 img{width:384px;height:384px}
.t256 img{width:256px;height:256px}
h1,h2{color:#C9A959} small{color:#A8A193}
.ok{color:#7fbf7f}.bad{color:#E25822}
</style>"""


def cp(src, dstdir):
    fn = os.path.basename(src)
    shutil.copy(src, os.path.join(dstdir, fn))
    return fn


def tiling():
    src = os.path.join(REPO, "content/batches/bpskin-tiling-0138")
    out = os.path.join(REPO, "web/preview/bpskin-tiling-0138")
    os.makedirs(out, exist_ok=True)
    fj = json.load(open(os.path.join(src, "findings.json")))
    legs = {(l["motif"], l["seed"], l["leg"]): l for l in fj["legs"]}
    rows = []
    for (motif, seed, leg), m in sorted(legs.items()):
        if leg != "seamless":
            continue
        cells = []
        for suffix, label in ((".png", "tile"), ("_offset.png", "half-offset"),
                              ("_tiled2x2.png", "2x2")):
            p = os.path.join(src, f"{motif}_s{seed}_seamless{suffix}")
            cells.append(f'<td class="t512"><small>{label}</small>'
                         f'<img src="{cp(p, out)}"></td>'
                         if os.path.exists(p) else "<td>missing</td>")
        ctrl = os.path.join(src, f"{motif}_s{seed}_control_offset.png")
        cells.append(f'<td class="t512"><small>CONTROL offset (seam '
                     f'expected)</small><img src="{cp(ctrl, out)}"></td>'
                     if os.path.exists(ctrl) else "<td>control missing</td>")
        c = legs.get((motif, seed, "control"), {})
        verdict = ("ok" if m["ratio_x"] < 1.5 and m["ratio_y"] < 1.5
                   else "bad")
        rows.append(
            f'<tr><th>{motif} s{seed}<br>'
            f'<span class="{verdict}">wrap/interior ratio x={m["ratio_x"]:.2f} '
            f'y={m["ratio_y"]:.2f}</span><br>'
            f'<small>control x={c.get("ratio_x",0):.2f} '
            f'y={c.get("ratio_y",0):.2f}</small></th>' + "".join(cells) + "</tr>")
    html = (f'<!doctype html><meta charset="utf-8">'
            f'<title>REQ-0138 fill_texture tiling</title>{CSS}'
            f'<h1>REQ-0138 - seamless fill_texture recipe validation</h1>'
            f'<p>SeamlessTile model patch + CircularVAEDecode '
            f'(spinagon/ComfyUI-seamless-tiling), {fj["checkpoint"]}, '
            f'{fj["tile_px"]}px tiles. Ratio ~1.0 = wrap edge '
            f'indistinguishable from interior; control = same seed without '
            f'tiling nodes.</p><table>{"".join(rows)}</table>')
    open(os.path.join(out, "index.html"), "w").write(html)
    print("tiling gallery:", out)


def spike():
    src = os.path.join(REPO, "content/batches/bpskin-spike-0131")
    out = os.path.join(REPO, "web/preview/bpskin-spike-0131")
    os.makedirs(out, exist_ok=True)
    parts = ['<!doctype html><meta charset="utf-8">'
             '<title>REQ-0131 bpskin spike</title>', CSS,
             '<h1>REQ-0131 - edge tiles / clip_mask / harness spike</h1>']
    parts.append('<h2>1. Motif sheets (AI frame sheets, V9)</h2><table><tr>')
    for p in sorted(glob.glob(os.path.join(src, "sheets", "*.png"))):
        parts.append(f'<td class="t512"><small>{os.path.basename(p)}</small>'
                     f'<img src="{cp(p, out)}"></td>')
    parts.append("</tr></table>")
    parts.append('<h2>2. Master tiles + clip masks (alpha encoding)</h2>'
                 "<table>")
    for motif in ("elven", "barbarian"):
        cells = []
        for name in ("straight", "outer", "inner"):
            a = os.path.join(src, "tiles", f"{motif}_{name}.png")
            c = os.path.join(src, "tiles", f"{motif}_{name}_clip.png")
            if os.path.exists(a):
                cells.append(f'<td class="t256"><small>{name} art / clip'
                             f'</small><img src="{cp(a, out)}">'
                             f'<img src="{cp(c, out)}"></td>')
        parts.append(f"<tr><th>{motif}</th>{''.join(cells)}</tr>")
    parts.append("</table>")
    rj = os.path.join(src, "harness", "results.json")
    results = json.load(open(rj)) if os.path.exists(rj) else []
    leak = {(r["motif"], r["shape"], r["bg"]): r["leak_px"] for r in results}
    parts.append('<h2>3. Harness - validation shape suite x canvas '
                 "backgrounds (BS-G4)</h2><table>")
    shapes = ["single", "I3", "L", "T", "Z", "plus", "holed"]
    for motif in ("elven", "barbarian"):
        for bg in ("dark", "light", "moss"):
            cells = []
            for s in shapes:
                p = os.path.join(src, "harness", f"{motif}_{s}_{bg}.png")
                if os.path.exists(p):
                    lk = leak.get((motif, s, bg), "?")
                    cls = "ok" if lk == 0 else "bad"
                    cells.append(f'<td><small>{s} <span class="{cls}">'
                                 f'leak={lk}px</span></small>'
                                 f'<img src="{cp(p, out)}" '
                                 f'style="width:auto;max-width:340px"></td>')
            parts.append(f"<tr><th>{motif}<br>{bg}</th>{''.join(cells)}</tr>")
    parts.append("</table>")
    open(os.path.join(out, "index.html"), "w").write("".join(parts))
    print("spike gallery:", out)


if __name__ == "__main__":
    {"tiling": tiling, "spike": spike}[sys.argv[1]]()
