#!/usr/bin/env python3
"""REQ-0150 §5 -- the flux2-all gallery. The point of the whole REQ.

ONE page where the user can see EVERY image-generation pipeline's output,
regenerated on flux2 with the ratified art direction, and rule on it.

Per the REQ:
  - every candidate at 256 px AND 64 px (golden G4), NUMBERED, so a verdict can
    be given by key rather than by description;
  - where an SDXL-era predecessor exists, it is shown NEXT TO the flux2 version.
    A migration is judged against what it replaced, not in a vacuum;
  - auto-FAIL (coverage < 20%) is FLAGGED and greyed, never silently dropped;
  - matte quality visible (checkerboard behind the alpha).

Self-contained: images are copied in, no external CSS/JS. Deploys to
web/preview/flux2-all/ on backpack-dev.

STOP AT S7. Nothing here goes to content/live/.
"""
import argparse, glob, json, os, re, shutil, sys
import numpy as np
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "web/preview/flux2-all")
RAW_RE = re.compile(r"^(?P<id>.+)_c(?P<k>\d+)_s(?P<seed>\d+)\.png$")
COVERAGE_MIN = 0.20          # the Art Golden coverage floor. FILTER, not a verdict.


def coverage(alpha_path):
    if not os.path.exists(alpha_path):
        return None
    a = np.asarray(Image.open(alpha_path).convert("RGBA"))[..., 3]
    return float((a > 8).mean())


def collect_icons(cand_dir, kind):
    """gen_item_icons writes <id>_c<k>_s<seed>.png + a paired _alpha.png."""
    out = {}
    for p in sorted(glob.glob(os.path.join(cand_dir, "*.png"))):
        m = RAW_RE.match(os.path.basename(p))
        if not m:
            continue
        eid = m.group("id")
        alpha = p[:-4] + "_alpha.png"
        out.setdefault(eid, []).append({
            "raw": p, "alpha": alpha if os.path.exists(alpha) else None,
            "seed": int(m.group("seed")), "k": int(m.group("k")),
            "coverage": coverage(alpha), "kind": kind})
    for v in out.values():
        v.sort(key=lambda c: c["k"])
    return out


def collect_monsters(cand_dir):
    out = {}
    for p in sorted(glob.glob(os.path.join(cand_dir, "*.png"))):
        b = os.path.basename(p)[:-4]
        mid, _, seed = b.rpartition("_s")
        if not mid:
            mid, seed = b, "0"
        out.setdefault(mid, []).append(
            {"raw": p, "alpha": None, "seed": int(seed or 0),
             "k": len(out.get(mid, [])), "coverage": None, "kind": "monster"})
    return out


def predecessors():
    """The SDXL-era art each new asset replaces. A migration is judged against
    what it replaced."""
    pred = {}
    for p in glob.glob(os.path.join(
            REPO, "content/batches/batch-003-item-icons/candidates/*.png")):
        b = os.path.basename(p)
        if b.endswith("_alpha.png"):
            continue
        m = RAW_RE.match(b)
        if m and m.group("k") == "1":
            pred.setdefault(m.group("id"), p)
    for p in glob.glob(os.path.join(
            REPO, "content/batches/units-001-roster/candidates/*.png")):
        b = os.path.basename(p)
        if b.endswith("_alpha.png"):
            continue
        m = RAW_RE.match(b)
        if m and m.group("k") == "1":
            pred.setdefault(m.group("id"), p)
    for d in ("monsters-002/out_rpg_batch2", "monsters-002/out_rpg_test"):
        for p in glob.glob(os.path.join(REPO, "content/batches", d, "*.png")):
            pred.setdefault(os.path.basename(p)[:-4].replace("_rpg", ""), p)
    return pred


CSS = """
:root{--bg:#15151a;--panel:#1e1e25;--line:#2e2e38;--ink:#e6e6ec;--dim:#8d8d9c;--warn:#e0a33a;--bad:#c85a5a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header{padding:20px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
h1{margin:0 0 4px;font-size:19px}
.sub{color:var(--dim);font-size:13px}
.bar{margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
button{background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
button.on{background:#3a4d6b;border-color:#5578a8}
section{padding:20px 24px}
h2{font-size:15px;margin:0 0 12px;color:var(--warn);text-transform:uppercase;letter-spacing:.06em}
.row{display:flex;gap:14px;align-items:flex-start;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--panel);margin-bottom:12px;flex-wrap:wrap}
.name{width:150px;flex:none}
.name b{display:block}
.name span{color:var(--dim);font-size:12px}
.old{flex:none;text-align:center}
.cards{display:flex;gap:10px;flex-wrap:wrap}
.card{text-align:center}
.thumb{background:var(--panel);border:1px solid var(--line);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.checker{background-image:linear-gradient(45deg,#33333c 25%,transparent 25%),linear-gradient(-45deg,#33333c 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#33333c 75%),linear-gradient(-45deg,transparent 75%,#33333c 75%);background-size:16px 16px;background-position:0 0,0 8px,8px -8px,-8px 0}
.thumb img{max-width:100%;max-height:100%;display:block;image-rendering:auto}
.k{font-size:12px;color:var(--dim);margin-top:4px}
.key{color:var(--ink);font-weight:600}
.fail{opacity:.35;outline:2px solid var(--bad)}
.failtag{color:var(--bad);font-size:11px;display:block}
.px64 .thumb{width:64px;height:64px}
.px64 img{image-rendering:pixelated}
.legend{color:var(--dim);font-size:12px;margin-bottom:14px}
"""

JS = """
let PX=256, ALPHA=false;
function paint(){
  document.querySelectorAll('img[data-r256]').forEach(i=>{
    const a = PX===64 ? i.dataset.a64 : i.dataset.a256;
    const r = PX===64 ? i.dataset.r64 : i.dataset.r256;
    const use = (ALPHA && a) ? a : r;
    if(i.getAttribute('src') !== use) i.src = use;
    i.parentElement.classList.toggle('checker', !!(ALPHA && a));
  });
  document.querySelectorAll('.cards').forEach(c=>c.classList.toggle('px64', PX===64));
  document.querySelectorAll('.thumb').forEach(t=>{
    if(!t.classList.contains('oldt')){ t.style.width=PX+'px'; t.style.height=PX+'px'; }
  });
  document.getElementById('b256').classList.toggle('on', PX===256);
  document.getElementById('b64').classList.toggle('on', PX===64);
  document.getElementById('balpha').classList.toggle('on', ALPHA);
}
function setpx(n){ PX=n; paint(); }
function setalpha(on){ ALPHA=on; paint(); }
paint();
"""


def card(n, c, relpath):
    fail = c["coverage"] is not None and c["coverage"] < COVERAGE_MIN
    cov = ("cov %.0f%%" % (100 * c["coverage"])) if c["coverage"] is not None else ""
    a256 = relpath(c["alpha"], 256) if c["alpha"] else ""
    a64 = relpath(c["alpha"], 64) if c["alpha"] else ""
    return (
        '<div class="card"><div class="thumb%s" style="width:256px;height:256px">'
        '<img data-r256="%s" data-r64="%s" data-a256="%s" data-a64="%s" '
        'src="%s" loading="lazy"></div>'
        '<div class="k"><span class="key">%d</span> · s%d %s%s</div></div>'
        % (" fail" if fail else "", relpath(c["raw"], 256), relpath(c["raw"], 64),
           a256, a64, relpath(c["raw"], 256),
           n, c["seed"], cov,
           '<span class="failtag">AUTO-FAIL &lt;20%</span>' if fail else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    img_dir = os.path.join(a.out, "img")
    os.makedirs(img_dir, exist_ok=True)
    copied = {}

    def rel(p, px=256):
        """Emit a PRE-RENDERED thumbnail, not the full-size original.

        The first version of this served the originals (208 PNGs, up to 1280x1280,
        41 MB) and let CSS scale them to 256 px. Chrome's renderer FROZE opening
        the page -- 41 MB of PNG to fetch and decode before anything is visible.
        The existing galleries (bakeoff-0136 etc.) already did this right: they
        ship `_256.png` and `_64.png` next to the source. Same here. Alpha is
        preserved (RGBA), so the matte toggle still shows a real matte."""
        if p is None:
            return ""
        key = (p, px)
        if key not in copied:
            n = "%03d_%s_%d.png" % (len(copied), os.path.splitext(os.path.basename(p))[0], px)
            im = Image.open(p)
            im = im.convert("RGBA") if im.mode in ("RGBA", "LA", "P") else im.convert("RGB")
            im.thumbnail((px, px), Image.LANCZOS)
            im.save(os.path.join(img_dir, n), optimize=True)
            copied[key] = "img/" + n
        return copied[key]

    groups = [
        ("items", collect_icons(os.path.join(
            REPO, "content/batches/batch-004-item-icons-flux2/candidates"), "item")),
        ("units", collect_icons(os.path.join(
            REPO, "content/batches/units-002-roster-flux2/candidates"), "unit")),
        ("monsters", collect_monsters(os.path.join(
            REPO, "content/batches/monsters-003-flux2/candidates"))),
    ]
    skins = sorted(glob.glob(os.path.join(
        REPO, "content/batches/bpskin-frames-0150/*_skin_*_oncanvas.png")))
    pred = predecessors()

    n = 0
    body, index = [], []
    for title, g in groups:
        if not g:
            continue
        rows = []
        for eid, cands in sorted(g.items()):
            base = eid.rsplit("_s", 1)[0] if title == "monsters" else eid
            old = pred.get(base) or pred.get(base.replace("unit-", ""))
            cards = []
            for c in cands:
                n += 1
                index.append({"key": n, "group": title, "id": eid,
                              "seed": c["seed"], "file": os.path.basename(c["raw"]),
                              "coverage": c["coverage"]})
                cards.append(card(n, c, rel))
            oldhtml = ('<div class="old"><div class="thumb oldt" style="width:128px;'
                       'height:128px"><img src="%s" loading="lazy"></div>'
                       '<div class="k">was (SDXL)</div></div>' % rel(old, 128)) if old else \
                      '<div class="old"><div class="k" style="width:128px">no predecessor</div></div>'
            rows.append('<div class="row"><div class="name"><b>%s</b><span>%s</span>'
                        '</div>%s<div class="cards">%s</div></div>'
                        % (eid, title, oldhtml, "".join(cards)))
        body.append("<section><h2>%s (%d)</h2>%s</section>" % (title, len(g), "".join(rows)))

    if skins:
        cards = []
        for p in skins:
            n += 1
            index.append({"key": n, "group": "backpack skins",
                          "id": os.path.basename(p)[:-14], "seed": 1,
                          "file": os.path.basename(p), "coverage": None})
            cards.append('<div class="card"><div class="thumb" style="width:256px;'
                         'height:256px"><img data-r256="%s" data-r64="%s" data-a256="" '
                         'data-a64="" src="%s" loading="lazy"></div>'
                         '<div class="k"><span class="key">%d</span> · %s</div></div>'
                         % (rel(p, 256), rel(p, 64), rel(p, 256), n,
                            os.path.basename(p)[:-14]))
        body.append('<section><h2>backpack skins (%d)</h2><div class="row">'
                    '<div class="name"><b>fill + welt</b><span>composed by script</span></div>'
                    '<div class="cards">%s</div></div></section>' % (len(skins), "".join(cards)))

    html = """<!doctype html><meta charset="utf-8"><title>REQ-0150 — flux2, everything</title>
<style>%s</style>
<header>
<h1>REQ-0150 — every pipeline, regenerated on flux2</h1>
<div class="sub">FLUX.2 klein 4B · euler · 30 steps · cfg 1.0 · no LoRAs · no negative ·
generation size matched to the cell footprint. Art direction ratified 2026-07-13.
<b>S7 STOP: nothing is in content/live/. Give verdicts by KEY NUMBER.</b></div>
<div class="bar">
<button id="b256" onclick="setpx(256)">256 px</button>
<button id="b64" onclick="setpx(64)">64 px (in-game)</button>
<button id="balpha" onclick="setalpha(!this.classList.contains('on'))">show matte (alpha)</button>
</div>
</header>
<section><div class="legend">Each row: the SDXL-era predecessor on the left (128 px, where one exists),
then the flux2 candidates. Numbers are the verdict keys. Candidates below the 20%% coverage
floor are outlined red and greyed — flagged, never silently dropped.</div></section>
%s
<script>%s</script>
""" % (CSS, "".join(body), JS)

    with open(os.path.join(a.out, "index.html"), "w") as f:
        f.write(html)
    with open(os.path.join(a.out, "index.json"), "w") as f:
        json.dump({"keys": index, "coverage_floor": COVERAGE_MIN}, f, indent=2)
    nfail = sum(1 for i in index if i["coverage"] is not None and i["coverage"] < COVERAGE_MIN)
    total = sum(os.path.getsize(os.path.join(img_dir, f))
                for f in os.listdir(img_dir))
    print("gallery: %d keys, %d thumbnails, %.1f MB, %d auto-FAIL -> %s"
          % (len(index), len(copied), total / 1e6, nfail, a.out))


if __name__ == "__main__":
    main()
