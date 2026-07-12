#!/usr/bin/env python3
"""REQ-0135 spike: build the numbered side-by-side gallery.

For every (subject, seed) pair, emits one numbered row:
route A raw / A matte 256 / A matte 64(+4x blowup) / B RGBA 256 / B 64(+4x)
and, when the optional third arm is supplied, C RGBA 256 / C 64(+4x).

  A = production: prompt WITH a near-white-background clause, background then
      separated post-hoc by rembg (birefnet-general + edge-key fallback).
  B = LayerDiffuse, prompt UNCHANGED (background clause still in). This is the
      arm as originally specced "for A/B fairness".
  C = LayerDiffuse, background clause STRIPPED from the positive prompt. See
      scratch_req0135_build_nobg_defs.py: telling LD to paint a backdrop makes
      it paint one and call it opaque, which forecloses the very thing the REQ
      set out to measure. C is the arm that actually tests latent transparency.

Self-contained HTML, relative paths, dark theme, checkerboard behind
transparent images (item pipeline S6 style).

Usage:
  scratch_req0135_build_gallery.py BASE_DIR LD_DIR BASE_LOG LD_LOG OUT_DIR
                                   [LD_NOBG_DIR LD_NOBG_LOG]
"""
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_item_icons as G  # noqa: E402  (alpha_coverage_fraction, RAW_CANDIDATE_RE)
from PIL import Image  # noqa: E402

base_dir, ld_dir, base_log, ld_log, out_dir = sys.argv[1:6]
nobg_dir = sys.argv[6] if len(sys.argv) > 6 else None
nobg_log = sys.argv[7] if len(sys.argv) > 7 else None
HAS_C = bool(nobg_dir and os.path.isdir(nobg_dir))

img_dir = os.path.join(out_dir, "img")
os.makedirs(img_dir, exist_ok=True)

# --- parse logs -------------------------------------------------------------
# route A matte method:  "MATTE <file> method=<m> coverage=<c>%"
method_a = {}
for m in re.finditer(r"MATTE (\S+_alpha\.png) method=(\S+) coverage=([\d.]+)%",
                     open(base_log).read()):
    method_a[m.group(1)] = m.group(2)

# per-job wall time:  "DONE id=<id> c=<k> seed=<s> ... (<t>s)" (route A)
#                     "DONE id=<id> c=<k> seed=<s> coverage=... time=<t>s vram_peak=<v>MiB" (LD)
LD_DONE = (r"DONE id=(\S+) c=(\d+) seed=(\d+) coverage=[\d.]+% "
           r"time=([\d.]+)s vram_peak=(\d+)MiB")

time_a = {}
for m in re.finditer(r"DONE id=(\S+) c=(\d+) seed=(\d+) -> \S+ \(([\d.]+)s\)",
                     open(base_log).read()):
    time_a[(m.group(1), m.group(2), m.group(3))] = float(m.group(4))


def parse_ld(path):
    t, v = {}, {}
    if not path or not os.path.exists(path):
        return t, v
    for m in re.finditer(LD_DONE, open(path).read()):
        key = (m.group(1), m.group(2), m.group(3))
        t[key] = float(m.group(4))
        v[key] = int(m.group(5))
    return t, v


time_b, vram_b = parse_ld(ld_log)
time_c, vram_c = parse_ld(nobg_log)

# --- collect pairs ----------------------------------------------------------
pairs = []
for f in sorted(os.listdir(base_dir)):
    mm = G.RAW_CANDIDATE_RE.match(f)
    if not mm:
        continue
    eid, k, seed = mm.group("id"), mm.group("k"), mm.group("seed")
    alpha = f"{eid}_c{k}_s{seed}_alpha.png"
    if os.path.exists(os.path.join(ld_dir, alpha)):
        pairs.append((eid, k, seed, f, alpha))

SUBJECT_ORDER = ["hilt", "blade", "dagger", "wing", "elf_bust"]
pairs.sort(key=lambda p: (SUBJECT_ORDER.index(p[0]) if p[0] in SUBJECT_ORDER else 99, p[2]))


def emit(src, name):
    shutil.copyfile(src, os.path.join(img_dir, name))


def emit_64(src, name):
    im = Image.open(src)
    im64 = im.resize((im.width // 4, im.height // 4), Image.LANCZOS)
    im64.save(os.path.join(img_dir, name))


rows = []
for i, (eid, k, seed, raw, alpha) in enumerate(pairs, start=1):
    a_raw, a_alpha = os.path.join(base_dir, raw), os.path.join(base_dir, alpha)
    b_alpha = os.path.join(ld_dir, alpha)
    n = f"{i:02d}_{eid}_s{seed}"
    emit(a_raw, f"{n}_a_raw.png")
    emit(a_alpha, f"{n}_a_256.png")
    emit_64(a_alpha, f"{n}_a_64.png")
    emit(b_alpha, f"{n}_b_256.png")
    emit_64(b_alpha, f"{n}_b_64.png")
    key = (eid, k, seed)
    row = dict(
        i=i, eid=eid, seed=seed, n=n,
        cov_a=G.alpha_coverage_fraction(a_alpha) * 100,
        cov_b=G.alpha_coverage_fraction(b_alpha) * 100,
        cov_c=None, t_c=None, vram_c=None,
        meth_a=method_a.get(alpha, "?"),
        t_a=time_a.get(key), t_b=time_b.get(key), vram=vram_b.get(key),
        tall=Image.open(a_alpha).height > Image.open(a_alpha).width)

    if HAS_C:
        c_alpha = os.path.join(nobg_dir, alpha)
        if os.path.exists(c_alpha):
            emit(c_alpha, f"{n}_c_256.png")
            emit_64(c_alpha, f"{n}_c_64.png")
            row["cov_c"] = G.alpha_coverage_fraction(c_alpha) * 100
            row["t_c"] = time_c.get(key)
            row["vram_c"] = vram_c.get(key)
    rows.append(row)

# --- html -------------------------------------------------------------------
CSS = """
body{background:#131820;color:#E9E3D3;font:14px/1.5 system-ui,sans-serif;margin:24px}
h1{font-size:20px;color:#C9A959} .sub{color:#A8A193;max-width:70em}
table{border-collapse:collapse;margin-top:16px}
td,th{border:1px solid #3D434C;padding:8px;text-align:center;vertical-align:top}
th{background:#28313E;color:#C9A959}
.num{font-size:18px;font-weight:700;color:#C9A959}
.cb{background:repeating-conic-gradient(#555 0 25%,#777 0 50%) 0 0/16px 16px;display:inline-block;line-height:0}
.px{image-rendering:pixelated}
.meta{color:#A8A193;font-size:12px;margin-top:4px}
.bad{color:#E25822}.ok{color:#9c6}
.note{background:#28313E;border-left:3px solid #C9A959;padding:10px 14px;margin-top:14px;max-width:70em}
img{display:block}
"""


def cell(name, w, cls=""):
    return f'<span class="cb"><img class="{cls}" src="img/{name}" width="{w}"></span>'


html = ["<!doctype html><meta charset='utf-8'><title>REQ-0135 LayerDiffuse spike</title>"
        f"<style>{CSS}</style>",
        "<h1>REQ-0135b — LayerDiffuse matting spike</h1>",
        "<p class='sub'>Same checkpoint (JuggernautXL V9), same seeds (101/202), same "
        "sampler settings (30 steps, cfg 6.5, dpmpp_2m/karras). Checkerboard = "
        "transparency. The 64&nbsp;px column is the board-cell render (G4 readability), "
        "shown 1:1 and blown up 4x nearest-neighbour so edges are inspectable.</p>",
        "<ul class='sub'>"
        "<li><b>A</b> — production: prompt <i>with</i> the near-white-background clause; "
        "background separated afterwards by rembg (birefnet-general + edge-key fallback).</li>"
        "<li><b>B</b> — LayerDiffuse, prompt <i>unchanged</i> (background clause still in). "
        "This is the arm as originally specced.</li>"]
if HAS_C:
    html.append("<li><b>C</b> — LayerDiffuse, background clause <i>stripped</i> from the "
                "positive prompt. This is the arm that actually tests latent transparency.</li>")
html.append("</ul>")

if HAS_C:
    html.append(
        "<p class='note'><b>Read B and C together.</b> Keeping the background clause was "
        "described in the spec as &ldquo;A/B fairness&rdquo;, but it is the one instruction "
        "that forecloses what the REQ set out to measure: told to paint a near-white "
        "backdrop, LayerDiffuse paints one and marks it opaque, so its alpha comes back "
        "essentially solid (column B). Column C removes only that clause. If C&rsquo;s "
        "edges beat A&rsquo;s on the fine silhouettes (wing feathers, elf hair, blade tip), "
        "latent transparency wins and B is simply a misconfiguration, not a verdict on the "
        "technique.</p>")

html.append("<p class='sub'>Verdict per NUMBER please (green/fix/cut), or one verdict for "
            "the whole spike.</p>")

hdr = ["<table><tr><th>#</th><th>subject / seed</th><th>A raw (gen)</th>",
       "<th>A matte 256</th><th>A matte 64 + 4x</th>",
       "<th>B LD (bg clause) 256</th><th>B 64 + 4x</th>"]
if HAS_C:
    hdr.append("<th>C LD (no bg) 256</th><th>C 64 + 4x</th>")
hdr.append("<th>numbers</th></tr>")
html.append("".join(hdr))

for r in rows:
    w256 = 192 if r["tall"] else 256
    w64 = w256 // 4
    cls_a = "ok" if 2 <= r["cov_a"] <= 90 else "bad"
    cls_b = "ok" if 2 <= r["cov_b"] <= 90 else "bad"
    ta = f"{r['t_a']:.0f}s" if r["t_a"] else "—"
    tb = f"{r['t_b']:.0f}s" if r["t_b"] else "—"
    vr = f"{r['vram']}MiB" if r["vram"] else "—"

    tds = [f"<tr><td class='num'>{r['i']}</td>",
           f"<td>{r['eid']}<div class='meta'>seed {r['seed']}</div></td>",
           f"<td><img src='img/{r['n']}_a_raw.png' width='{w256}'></td>",
           f"<td>{cell(r['n'] + '_a_256.png', w256)}</td>",
           f"<td>{cell(r['n'] + '_a_64.png', w64)}<br><br>{cell(r['n'] + '_a_64.png', w256, 'px')}</td>",
           f"<td>{cell(r['n'] + '_b_256.png', w256)}</td>",
           f"<td>{cell(r['n'] + '_b_64.png', w64)}<br><br>{cell(r['n'] + '_b_64.png', w256, 'px')}</td>"]

    nums = (f"A: <span class='{cls_a}'>{r['cov_a']:.1f}%</span> ({r['meth_a']}, {ta})<br>"
            f"B: <span class='{cls_b}'>{r['cov_b']:.1f}%</span> (latent, {tb}, peak {vr})")

    if HAS_C:
        if r["cov_c"] is None:
            tds.append("<td class='meta'>—</td><td class='meta'>—</td>")
        else:
            cls_c = "ok" if 2 <= r["cov_c"] <= 90 else "bad"
            tc = f"{r['t_c']:.0f}s" if r["t_c"] else "—"
            vc = f"{r['vram_c']}MiB" if r["vram_c"] else "—"
            tds.append(f"<td>{cell(r['n'] + '_c_256.png', w256)}</td>")
            tds.append(f"<td>{cell(r['n'] + '_c_64.png', w64)}<br><br>"
                       f"{cell(r['n'] + '_c_64.png', w256, 'px')}</td>")
            nums += (f"<br>C: <span class='{cls_c}'>{r['cov_c']:.1f}%</span> "
                     f"(latent, {tc}, peak {vc})")

    tds.append(f"<td class='meta'>{nums}</td></tr>")
    html.append("".join(tds))

html.append("</table>")
open(os.path.join(out_dir, "index.html"), "w").write("\n".join(html))
print(f"gallery: {out_dir}/index.html rows={len(rows)} arms={'A/B/C' if HAS_C else 'A/B'}")
