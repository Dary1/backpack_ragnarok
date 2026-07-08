# -*- coding: utf-8 -*-
"""
REQ-0104: align-aware padding flush (sprite side of REQ-0102).

For every PO in content/live/live_items.json that carries an `align` field, bake an
OUTER translate into its icon <symbol> so the art sits FLUSH against the aligned
viewBox edge -- removing the no-contact PAD that tool_fit_check reserves on exposed
faces. Combined with REQ-0102's render-time align (which anchors the icon box to the
footprint edge), the assembled Longsword blade (v:bottom) and hilt (v:top) meet with
zero gap.

Append-only sprite history: reads sprite_all_v11.svg, writes sprite_all_v12.svg.
Idempotent (re-run overwrites its own <g data-fit-align> layer; SRC is always v11).
Verified with the now align-aware tool_fit_check.check_icon.
"""
import sys, re, json, shutil
sys.path.insert(0, "tools")
import tool_fit_check as fit
import numpy as np

SRC = "content/sprite_all_v11.svg"
OUT = "content/sprite_all_v12.svg"
ITEMS = "content/live/live_items.json"

def targets():
    d = json.load(open(ITEMS, encoding="utf-8"))
    return [e for e in d["entries"] if e.get("align")]

def flush_translate(sprite_path, entry):
    tree = fit.load_sprite_tree(sprite_path)
    sym, viewbox = fit.extract_symbol(tree, entry["icon"])
    if sym is None:
        raise RuntimeError("symbol not found: " + entry["icon"])
    cellset, rows, cols = fit.shape_to_cellset(entry["shape"])
    allowed = fit.build_region(cellset, entry.get("align"))
    H, W = allowed.shape
    content = fit.rasterize_symbol(sym, viewbox, W, H)
    ys, xs = np.where(content)
    if len(ys) == 0:
        raise RuntimeError("EMPTY_CONTENT")
    minx, miny, vw, vh = viewbox
    al = entry.get("align") or {}
    dx = dy = 0.0
    if al.get("v") == "bottom":
        dy = (H - 1 - int(ys.max())) * (vh / H)
    elif al.get("v") == "top":
        dy = (0 - int(ys.min())) * (vh / H)
    if al.get("h") == "right":
        dx = (W - 1 - int(xs.max())) * (vw / W)
    elif al.get("h") == "left":
        dx = (0 - int(xs.min())) * (vw / W)
    pre = dict(top=round(int(ys.min())/H*100,1), bottom=round((H-1-int(ys.max()))/H*100,1),
               left=round(int(xs.min())/W*100,1), right=round((W-1-int(xs.max()))/W*100,1))
    return dx, dy, pre

def write_align_wrapper(sprite_path, icon_id, dx, dy):
    raw = open(sprite_path, encoding="utf-8").read()
    pat = re.compile(r'(<symbol\b[^>]*\bid="' + re.escape(icon_id) + r'"[^>]*>)(.*?)(</symbol>)', re.S)
    m = pat.search(raw)
    if not m:
        raise RuntimeError("symbol block not found: " + icon_id)
    open_tag, inner, close_tag = m.group(1), m.group(2).strip(), m.group(3)
    wm = re.match(r'^<g data-fit-align="1" transform="[^"]*">(.*)</g>$', inner, re.S)
    if wm:
        inner = wm.group(1).strip()
    wrapper = '<g data-fit-align="1" transform="translate(%.6f %.6f)">%s</g>' % (dx, dy, inner)
    block = open_tag + "\n    " + wrapper + "\n  " + close_tag
    open(sprite_path, "w", encoding="utf-8").write(raw[:m.start()] + block + raw[m.end():])

def run():
    shutil.copyfile(SRC, OUT)
    rep = []
    for e in targets():
        dx, dy, pre = flush_translate(OUT, e)
        write_align_wrapper(OUT, e["icon"], dx, dy)
        tree = fit.load_sprite_tree(OUT)
        r = fit.check_icon(tree, e)
        _, vb = fit.extract_symbol(tree, e["icon"])
        cs, _, _ = fit.shape_to_cellset(e["shape"])
        allowed = fit.build_region(cs, e.get("align"))
        H, W = allowed.shape
        content = fit.rasterize_symbol(*(fit.extract_symbol(tree, e["icon"])), W, H)
        ys, xs = np.where(content)
        post = dict(top=round(int(ys.min())/H*100,1), bottom=round((H-1-int(ys.max()))/H*100,1))
        print("%-8s %-12s align=%-20s dx=%+.3f dy=%+.3f  pre(T/B)=%s/%s post(T/B)=%s/%s  -> %s (overflow=%s)" % (
            e["id"], e["icon"], json.dumps(e.get("align")), dx, dy, pre["top"], pre["bottom"], post["top"], post["bottom"],
            r["status"], r.get("overflow_px")))
        rep.append((e["id"], r["status"]))
    bad = [x for x in rep if x[1] != "PASS"]
    if bad:
        raise SystemExit("VERIFY FAILED: " + str(bad))
    print("wrote", OUT, "-- all", len(rep), "aligned targets PASS")

if __name__ == "__main__":
    run()
