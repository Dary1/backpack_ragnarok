#!/usr/bin/env python3
"""REQ-0153 -- machine scoring + gallery for the shape-control spike.

Reads the generation runlog + matted alphas, scores every render, writes
findings.json (established spike format: legs, per-arm summary tables,
verdict), montage contact-sheets (one small PNG per arm -- the committed set
stays small), and gallery.html for the S7 eyeball.

Metrics per render (spec):
  identity_feasible   the silhouette fits the cells with NO transform, judged
                      as ZERO deep overflow -- content pushed into the deep
                      interior (beyond the PAD band) of a cell the shape does
                      not own. This is the GREEN gate's "zero deep_overflow".
  overflow_px         total content outside the allowed region at identity.
  deep_overflow_px    the deep-interior overflow that gates identity_feasible.
  best_fit_score      tool_icon_score.score_candidate on the matted alpha --
                      the full solve() transform search (the fit machinery,
                      imported not forked).
  cell_content_coverage  per owned cell, content px / cell px at identity.
  white_bg_purity     fraction of the non-subject background that is near-white.
  bg_gray_frac        fraction of the non-subject background that is mid-gray
                      (the scaffold-ghosting signal: a clean white bg is ~0).

Identity fit vs the fit machinery: the identity metrics rasterise the matted
alpha onto the shape's cell grid at fit.CELL px/cell exactly like
tool_fit_check.check_icon does (resize to WxH = cols*CELL x rows*CELL, then
overflow = content & ~allowed). deep_overflow extends check_icon's per-cell
interior test across the FULL bbox (owned + blank cells), so content spilling
into a shape's empty quadrant is counted -- that is the exact failure this
spike is trying to prevent.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import tool_fit_check as fit          # noqa: E402
import tool_icon_score as icon        # noqa: E402
import req0153_shape_scaffold as SCAF  # noqa: E402
import req0153_spike as SP            # noqa: E402  (MATRIX, dirs, SEEDS)

import numpy as np                    # noqa: E402
from PIL import Image, ImageDraw      # noqa: E402

REPO = SP.REPO
RAWS = SP.RAWS
ALPHAS = SP.ALPHAS
BATCH = SP.BATCH
RUNLOG = SP.RUNLOG
C = fit.CELL
PAD = fit.PAD
ALPHA_T = 8


def load_ok_records():
    recs = {}
    if not os.path.exists(RUNLOG):
        return []
    for line in open(RUNLOG):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if r.get("status") == "ok":
            recs[r["tag"]] = r          # last ok wins
    return list(recs.values())


def shape_allowed(shape_name):
    shape = SCAF.SHAPES[shape_name]
    cellset, rows, cols = fit.shape_to_cellset(shape)
    allowed = fit.build_region(cellset)
    return shape, cellset, rows, cols, allowed


def identity_metrics(alpha_path, shape_name):
    shape, cellset, rows, cols, allowed = shape_allowed(shape_name)
    H, W = allowed.shape
    a = np.array(Image.open(alpha_path).convert("RGBA"))[:, :, 3]
    im = Image.fromarray(a, mode="L").resize((W, H), Image.BILINEAR)
    content = np.array(im) > ALPHA_T
    overflow = content & (~allowed)
    overflow_px = int(overflow.sum())
    deep_px = 0
    for r in range(rows):
        for c in range(cols):
            co = overflow[r * C:(r + 1) * C, c * C:(c + 1) * C].copy()
            co[:PAD, :] = False
            co[-PAD:, :] = False
            co[:, :PAD] = False
            co[:, -PAD:] = False
            deep_px += int(co.sum())
    coverage = {}
    for (r, cc) in sorted(cellset):
        cell = content[r * C:(r + 1) * C, cc * C:(cc + 1) * C]
        coverage["(%d,%d)" % (r, cc)] = round(float(cell.sum()) / (C * C), 4)
    return dict(overflow_px=overflow_px, deep_overflow_px=deep_px,
                identity_feasible=bool(deep_px == 0),
                clean_fit=bool(overflow_px == 0),
                cell_content_coverage=coverage,
                content_px=int(content.sum()))


def bestfit(alpha_path, shape_name):
    shape, cellset, rows, cols, allowed = shape_allowed(shape_name)
    r = icon.score_candidate(alpha_path, allowed, cellset)
    return dict(best_fit_score=r["score"], best_fit_feasible=bool(r["feasible"]),
                best_fit_scale=r.get("scale"), best_fit_rot=r.get("rot"),
                best_fit_reason=r.get("reason"))


def hygiene(raw_path, alpha_path):
    raw = np.array(Image.open(raw_path).convert("RGB")).astype(np.int16)
    a = np.array(Image.open(alpha_path).convert("RGBA"))[:, :, 3]
    if a.shape != raw.shape[:2]:
        a = np.array(Image.fromarray(a, mode="L").resize(
            (raw.shape[1], raw.shape[0]), Image.NEAREST))
    subject = a > ALPHA_T
    bg = ~subject
    mn = raw.min(axis=2)
    mx = raw.max(axis=2)
    luma = (0.299 * raw[:, :, 0] + 0.587 * raw[:, :, 1] + 0.114 * raw[:, :, 2])
    near_white = mn > 235
    mid_gray = (luma >= 100) & (luma <= 180) & ((mx - mn) < 25)
    bg_n = int(bg.sum()) or 1
    return dict(white_bg_purity=round(float((near_white & bg).sum()) / bg_n, 4),
                bg_gray_frac=round(float((mid_gray & bg).sum()) / bg_n, 4),
                mid_gray_frac_all=round(float(mid_gray.sum()) / mid_gray.size, 4))


def score_all():
    recs = load_ok_records()
    legs = []
    for rec in recs:
        tag = rec["tag"]
        raw = os.path.join(RAWS, tag + ".png")
        alpha = os.path.join(ALPHAS, tag + "_alpha.png")
        if not (os.path.exists(raw) and os.path.exists(alpha)):
            continue
        leg = dict(arm=rec["arm"], shape=rec["shape"], subject=rec["subject"],
                   seed=rec["seed"], denoise=rec.get("denoise"), dilate=rec.get("dilate"),
                   tag=tag, gen_w=rec["gen_w"], gen_h=rec["gen_h"],
                   wall_s=rec.get("wall_s"), vram_peak_mb=rec.get("vram_peak_mb"))
        try:
            leg.update(identity_metrics(alpha, rec["shape"]))
            leg.update(bestfit(alpha, rec["shape"]))
            leg.update(hygiene(raw, alpha))
        except Exception as e:
            leg["error"] = str(e)[:300]
        legs.append(leg)
    return legs


def arm_label(leg):
    a = leg["arm"]
    if a == "B" and leg.get("denoise") is not None:
        return "B@dn%s" % str(leg["denoise"]).replace(".", "")
    if a == "C" and leg.get("dilate") is not None:
        return "C@d%d" % leg["dilate"]
    return a


def summarize(legs):
    groups = {}
    for leg in legs:
        groups.setdefault(arm_label(leg), []).append(leg)
    summary = {}
    for name, gl in sorted(groups.items()):
        feas = [1 if l.get("identity_feasible") else 0 for l in gl]
        deep = [l.get("deep_overflow_px", 0) for l in gl]
        scores = sorted(l.get("best_fit_score", 0.0) for l in gl)
        purity = [l.get("white_bg_purity", 0.0) for l in gl]
        gray = [l.get("bg_gray_frac", 0.0) for l in gl]
        walls = [l.get("wall_s") for l in gl if l.get("wall_s") is not None]
        vrams = [l.get("vram_peak_mb") for l in gl if l.get("vram_peak_mb")]
        n = len(gl)
        med = scores[n // 2] if n else 0.0
        summary[name] = dict(
            n=n,
            identity_feasible_pct=round(100.0 * sum(feas) / n, 1) if n else 0.0,
            zero_deep_pct=round(100.0 * sum(1 for d in deep if d == 0) / n, 1) if n else 0.0,
            median_best_fit=round(med, 2),
            mean_best_fit=round(sum(scores) / n, 2) if n else 0.0,
            median_white_bg_purity=round(sorted(purity)[n // 2], 3) if n else 0.0,
            median_bg_gray_frac=round(sorted(gray)[n // 2], 4) if n else 0.0,
            max_bg_gray_frac=round(max(gray), 4) if gray else 0.0,
            median_wall_s=round(sorted(walls)[len(walls) // 2], 1) if walls else None,
            max_vram_mb=max(vrams) if vrams else None,
        )
    return summary


def verdict(summary):
    base = summary.get("0")
    if not base:
        return dict(verdict="INCONCLUSIVE", reason="no Arm 0 baseline scored")
    lines = []
    green = []
    for name, s in summary.items():
        if name == "0":
            continue
        beats_base = s["median_best_fit"] > base["median_best_fit"] + 1.0
        feasible70 = s["identity_feasible_pct"] >= 70.0
        beats_feas = s["identity_feasible_pct"] > base["identity_feasible_pct"]
        # ghosting: bg stays white-ish; flag if median bg gray clearly above baseline
        ghost_ok = s["median_bg_gray_frac"] <= max(0.01, base["median_bg_gray_frac"] * 3 + 0.005)
        is_green = feasible70 and beats_base and beats_feas and ghost_ok
        lines.append(dict(arm=name, identity_feasible_pct=s["identity_feasible_pct"],
                          median_best_fit=s["median_best_fit"],
                          beats_baseline_fit=beats_base, feasible_ge70=feasible70,
                          beats_baseline_feasible=beats_feas, ghost_ok=ghost_ok,
                          green=is_green))
        if is_green:
            green.append(name)
    if green:
        v = "GREEN-with-recipe"
    elif any(l["identity_feasible_pct"] >= 55 for l in lines):
        v = "AMBER"
    else:
        v = "RED"
    return dict(verdict=v, baseline=base, green_arms=green, arm_gates=lines)


# ---------------------------------------------------------------------------
# Montage contact-sheets (one small PNG per arm-group) + gallery.html
# ---------------------------------------------------------------------------
TILE = 130
LABEL_H = 26


def montage_for(legs, name, out_png, source="raw"):
    order = {sh: i for i, (sh, _s) in enumerate(dict.fromkeys(
        [(sh, None) for sh, _ in SP.MATRIX]))}
    gl = [l for l in legs if arm_label(l) == name]
    gl.sort(key=lambda l: (list(SCAF.SHAPES).index(l["shape"]), l["subject"], l["seed"]))
    if not gl:
        return None
    ncol = max(len(SP.SEEDS), 4)
    nrow = (len(gl) + ncol - 1) // ncol
    W = ncol * TILE
    Hh = nrow * (TILE + LABEL_H)
    canvas = Image.new("RGB", (W, Hh), (245, 245, 245))
    dr = ImageDraw.Draw(canvas)
    for i, leg in enumerate(gl):
        col = i % ncol
        row = i // ncol
        x0 = col * TILE
        y0 = row * (TILE + LABEL_H)
        src = os.path.join(RAWS if source == "raw" else ALPHAS,
                           leg["tag"] + (".png" if source == "raw" else "_alpha.png"))
        try:
            im = Image.open(src).convert("RGB")
            im.thumbnail((TILE - 8, TILE - 8))
            canvas.paste(im, (x0 + 4, y0 + 4))
        except Exception:
            pass
        ok = leg.get("identity_feasible")
        color = (32, 160, 32) if ok else (200, 40, 40)
        dr.rectangle([x0 + 1, y0 + 1, x0 + TILE - 2, y0 + TILE - 2], outline=color, width=2)
        lab = "%s s%d" % (leg["subject"][:10], leg["seed"])
        dr.text((x0 + 4, y0 + TILE), lab, fill=(20, 20, 20))
        dr.text((x0 + 4, y0 + TILE + 12),
                "fit=%.0f dov=%d" % (leg.get("best_fit_score", 0), leg.get("deep_overflow_px", 0)),
                fill=(80, 80, 80))
    canvas.save(out_png)
    return os.path.relpath(out_png, BATCH)


def build_gallery(legs, summary, vdict):
    os.makedirs(BATCH, exist_ok=True)
    assets = os.path.join(BATCH, "montages")
    os.makedirs(assets, exist_ok=True)
    names = sorted({arm_label(l) for l in legs})
    montages = []
    for name in names:
        rel = montage_for(legs, name, os.path.join(assets, "arm_%s.png" % name.replace("@", "_").replace(".", "")))
        if rel:
            montages.append((name, rel))
    rows = ""
    order = ["0", "A"] + [n for n in names if n not in ("0", "A")]
    for name in order:
        s = summary.get(name)
        if not s:
            continue
        rows += ("<tr><td>%s</td><td>%d</td><td>%.1f%%</td><td>%.2f</td>"
                 "<td>%.2f</td><td>%.3f</td><td>%.4f</td><td>%s</td><td>%s</td></tr>\n"
                 % (name, s["n"], s["identity_feasible_pct"], s["median_best_fit"],
                    s["mean_best_fit"], s["median_white_bg_purity"], s["median_bg_gray_frac"],
                    s["median_wall_s"], s["max_vram_mb"]))
    mhtml = ""
    for name, rel in montages:
        mhtml += "<h3>Arm %s</h3><img src='%s' style='max-width:100%%'>\n" % (name, rel)
    html = """<!doctype html><meta charset=utf-8>
<title>REQ-0153 shape-control spike</title>
<style>body{font-family:sans-serif;margin:20px;background:#fafafa;color:#111}
table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #ccc;padding:4px 8px;font-size:13px}
th{background:#eee}h3{margin-top:24px}.v{font-size:20px;font-weight:bold;padding:8px;background:#eef}</style>
<h1>REQ-0153 -- PO shape-control spike</h1>
<p class=v>VERDICT: %s</p>
<p>Green border = identity-fit feasible (zero deep_overflow). Red = deep overflow into non-owned cells.
Tile caption: best-fit score / deep_overflow px.</p>
<table><tr><th>arm</th><th>n</th><th>identity-fit feasible</th><th>median best-fit</th>
<th>mean best-fit</th><th>white-bg purity</th><th>bg gray (ghost)</th><th>median wall s</th><th>max VRAM MB</th></tr>
%s</table>
<h2>Contact sheets (raw renders)</h2>
%s
""" % (vdict["verdict"], rows, mhtml)
    with open(os.path.join(BATCH, "gallery.html"), "w") as f:
        f.write(html)


def main():
    os.makedirs(BATCH, exist_ok=True)
    legs = score_all()
    summary = summarize(legs)
    vdict = verdict(summary)
    findings = dict(
        req="REQ-0153", route="flux2-klein-4b",
        unet=SP.ROUTE.FLUX["unet"], clip=SP.ROUTE.FLUX["clip"], vae=SP.ROUTE.FLUX["vae"],
        steps=SP.ROUTE.STEPS, cfg=SP.ROUTE.CFG, sampler=SP.ROUTE.SAMPLER,
        seeds=SP.SEEDS, matrix=SP.MATRIX,
        green_criteria="identity-fit feasible (zero deep_overflow) >=70%, median best-fit beats Arm 0, no ghosting",
        n_legs=len(legs), summary=summary, verdict=vdict, legs=legs,
    )
    with open(os.path.join(BATCH, "findings.json"), "w") as f:
        json.dump(findings, f, indent=2)
    build_gallery(legs, summary, vdict)
    print("SCORED %d legs -> %s" % (len(legs), os.path.join(BATCH, "findings.json")))
    print("VERDICT:", vdict["verdict"])
    hdr = "%-8s %4s %10s %10s %10s %9s" % ("arm", "n", "feas%", "medFit", "wht_bg", "ghost")
    print(hdr)
    for name in ["0", "A"] + [n for n in sorted(summary) if n not in ("0", "A")]:
        s = summary.get(name)
        if not s:
            continue
        print("%-8s %4d %9.1f%% %10.2f %10.3f %9.4f"
              % (name, s["n"], s["identity_feasible_pct"], s["median_best_fit"],
                 s["median_white_bg_purity"], s["median_bg_gray_frac"]))


if __name__ == "__main__":
    main()
