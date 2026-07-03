# -*- coding: utf-8 -*-
"""
REQ-0029 follow-up (step 3): apply translate+uniform-scale-only fixes to the
4 batch-001-niflheim items that still show overflow after the draft.json
shape/ports transposition (hoarfrost_creep, glacier_cleaver, permafrost_ward,
niflheim_crown). rime_shard and frost_nail already PASS with zero overflow at
natural mapping post-transposition and need no sprite change.

Per policy: v9 is left untouched (append-only sprite history) -- this script
reads sprite_all_v9.svg and writes sprite_all_v10.svg. No rotation/flip is
ever applied (fix_icon()'s structural guard, REQ-0029b, would refuse and
ESCALATE instead of returning SOLVED if one were required -- verified via
`tool_fit_check.py fix` beforehand: all 4 solve at rot=0/flip=False).

Derivation mirrors tools/tests-adjacent fix_v7.py methodology used for prior
sprite versions: solve() -> centered_position() -> convert the raster-space
translate/scale into the symbol's own viewBox-space transform, wrapped as
<g data-fit-wrap="1" transform="translate(dx dy) scale(s)">, with iterative
epsilon-shrink correction if verification still shows any overflow (handles
sub-pixel AA bleed across the pad boundary, same as blade's 0.5% margin in v9).
"""
import sys
import re
import json
import shutil

sys.path.insert(0, "tools")
import tool_fit_check as fit

SRC_SPRITE = "content/sprite_all_v9.svg"
OUT_SPRITE = "content/sprite_all_v10.svg"
DEFS = ["content/batches/batch-001-niflheim/draft.json"]

MAX_CORRECTION_STEPS = 60
EPSILON = 0.997

TARGET_IDS = ["hoarfrost_creep", "glacier_cleaver", "permafrost_ward", "niflheim_crown"]


def load_entries():
    entries = []
    for p in DEFS:
        entries.extend(fit.load_defs(p))
    return entries


def get_entry(entries, eid):
    for e in entries:
        if e.get("id") == eid:
            return e
    raise KeyError(eid)


def rasterize_current(sprite_path, entry):
    sprite_root = fit.load_sprite_tree(sprite_path)
    icon_id = entry["icon"]
    sym, viewbox = fit.extract_symbol(sprite_root, icon_id)
    if sym is None:
        raise RuntimeError("symbol not found: " + icon_id)
    cellset, rows, cols = fit.shape_to_cellset(entry["shape"])
    allowed = fit.build_region(cellset)
    H, W = allowed.shape
    content_natural = fit.rasterize_symbol(sym, viewbox, W, H)
    return allowed, content_natural, viewbox, W, H


def derive_base_transform(entry, sprite_path):
    allowed, content_natural, viewbox, W, H = rasterize_current(sprite_path, entry)
    ys, xs = fit.np.where(content_natural)
    if len(ys) == 0:
        raise RuntimeError("EMPTY_CONTENT")
    y0, x0 = int(ys.min()), int(xs.min())
    content = content_natural[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

    best = fit.solve(allowed, content)
    if best is None:
        raise RuntimeError("INFEASIBLE")
    if best["rot"] != 0 or best["flip"] is not False:
        raise RuntimeError("UNSUPPORTED rot/flip: rot=%s flip=%s" % (best["rot"], best["flip"]))

    placed_kernel = fit.scaled(best["mask"], best["scale"])
    pos_first_yx = tuple(best["pos"])
    pos_centered_yx = fit.centered_position(allowed, placed_kernel) or pos_first_yx

    s = best["scale"]
    y, x = pos_centered_yx
    dx_raster = x - x0 * s
    dy_raster = y - y0 * s

    minx, miny, vw, vh = viewbox
    dx_vb = dx_raster * (vw / W)
    dy_vb = dy_raster * (vh / H)

    return dict(
        scale=s, dx_vb=dx_vb, dy_vb=dy_vb, rot=best["rot"], flip=best["flip"],
        viewbox=viewbox, pos_centered=(int(x), int(y)), pos_first=pos_first_yx,
        content_bbox=(x0, y0, content.shape[1], content.shape[0]),
        W=W, H=H, target_x=int(x), target_y=int(y),
    )


def write_symbol_wrapper(sprite_path, icon_id, dx, dy, s):
    with open(sprite_path, encoding="utf-8") as f:
        raw = f.read()

    pattern = re.compile(
        r'(<symbol\b[^>]*\bid="' + re.escape(icon_id) + r'"[^>]*>)(.*?)(</symbol>)',
        re.DOTALL,
    )
    m = pattern.search(raw)
    if not m:
        raise RuntimeError("could not locate symbol block: " + icon_id)

    open_tag, inner, close_tag = m.group(1), m.group(2), m.group(3)
    inner = inner.strip()

    wrap_re = re.compile(r'^<g data-fit-wrap="1" transform="[^"]*">(.*)</g>$', re.DOTALL)
    wm = wrap_re.match(inner)
    if wm:
        inner = wm.group(1).strip()

    new_wrapper = '<g data-fit-wrap="1" transform="translate(%.6f %.6f) scale(%.8f)">%s</g>' % (dx, dy, s, inner)
    new_block = open_tag + "\n    " + new_wrapper + "\n  " + close_tag
    new_raw = raw[:m.start()] + new_block + raw[m.end():]
    with open(sprite_path, "w", encoding="utf-8") as f:
        f.write(new_raw)


def verify_icon(entry, sprite_path):
    sprite_root = fit.load_sprite_tree(sprite_path)
    r = fit.check_icon(sprite_root, entry)
    return r


def fix_one(entry, sprite_path):
    eid = entry["id"]
    t = derive_base_transform(entry, sprite_path)

    s = t["scale"]
    dx, dy = t["dx_vb"], t["dy_vb"]
    minx, miny, vw, vh = t["viewbox"]
    W, H = t["W"], t["H"]

    write_symbol_wrapper(sprite_path, entry["icon"], dx, dy, s)
    v = verify_icon(entry, sprite_path)

    steps = 0
    while v["status"] != "PASS" and steps < MAX_CORRECTION_STEPS:
        steps += 1
        s *= EPSILON
        x0, y0, cw, ch = t["content_bbox"]
        tx, ty = t["target_x"], t["target_y"]
        dx_raster = tx - x0 * s
        dy_raster = ty - y0 * s
        dx = dx_raster * (vw / W)
        dy = dy_raster * (vh / H)
        write_symbol_wrapper(sprite_path, entry["icon"], dx, dy, s)
        v = verify_icon(entry, sprite_path)

    return dict(
        id=eid, icon=entry["icon"], final_status=v["status"],
        scale_pct=round(s * 100, 2), rot=t["rot"], flip=t["flip"],
        pos_centered_xy=list(t["pos_centered"]),
        correction_steps=steps,
        coverage=v.get("coverage"), overflow_px_after=v.get("overflow_px"),
        violated_faces=v.get("violated_faces"),
    )


def run_all():
    shutil.copyfile(SRC_SPRITE, OUT_SPRITE)
    entries = load_entries()

    report = []
    for eid in TARGET_IDS:
        entry = get_entry(entries, eid)
        try:
            r = fix_one(entry, OUT_SPRITE)
        except RuntimeError as e:
            print("UNFIXABLE " + eid + ": " + str(e))
            report.append(dict(id=eid, status="UNFIXABLE", reason=str(e)))
            continue

        ok = (r["final_status"] == "PASS")
        cov_vals = list((r.get("coverage") or {}).values())
        cov_str = ("%.1f-%.1f%%" % (min(cov_vals), max(cov_vals))) if cov_vals else "n/a"
        print("%-14s %-20s scale=%.2f%% rot=%sdeg flip=%s pos_centered(x,y)=%s coverage=%s corr_steps=%s overflow_px_after=%s" % (
            ("VERIFIED-PASS" if ok else "STILL-FAIL"), eid, r["scale_pct"], r["rot"], r["flip"],
            r["pos_centered_xy"], cov_str, r["correction_steps"], r["overflow_px_after"]))
        report.append(r)
        if not ok:
            raise SystemExit("FIX VERIFICATION FAILED for " + eid)

    print()
    print("=== SUMMARY (JSON) ===")
    print(json.dumps(report, indent=2, default=str))


if __name__ == "__main__":
    run_all()
