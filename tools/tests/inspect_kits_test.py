#!/usr/bin/env python3
"""REQ-0152 gate G3 (golden vectors) + G2 (kit purity), Python side.

Each adopted kit REPLAYS a recorded, committed artifact bit-for-bit:
  bpskin.frame_gate  -- the wood_frame_s202 double-FAIL (margin 0.798,
                        rim_luma_delta 0.6) AND the 5 recorded PASSes from
                        content/batches/bpskin-frames-0150/frame_report.json.
  matte.coverage_band-- one recorded batch matte (blade_c1_s101_alpha) coverage.
  po.cell_packing    -- one recorded scores.json entry (blade_c1_s101, score
                        54.97 + terms + per-cell coverage).
  tiling.seam        -- one recorded findings.json leg (elven s101 seamless).
Plus purity: each kit run twice on the same input yields identical output.

REQ-0191 adds one CONTRACT check that is not a golden replay: po.cell_fit's
per-cell v numbers are published only inside its prose note, and the artadmin
cell backdrop (client/src/artadmin/CellBackdrop.tsx parseCellV) reads them
from there to tint the cells. That makes the note's wording a real interface.
The check below re-parses the note with the CLIENT'S OWN REGEX and demands the
numbers come back -- so rewording the note fails here, loudly, instead of
silently emptying the overlay on screen.

Run under the project venv (numpy/scipy/rembg/skimage/PIL):
  ~/backpack_ragnarok/.venv/bin/python tools/tests/inspect_kits_test.py"""
import os
import re
import sys
import json

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.dirname(TOOLS)
sys.path.insert(0, TOOLS)
os.chdir(REPO)

import inspect_kits as KITS  # noqa: E402

B = "content/batches"
FRAME_DIR = B + "/bpskin-frames-0150"
_pass = 0
_fail = 0


def check(name, cond, detail=""):
    global _pass, _fail
    if cond:
        _pass += 1
        print("PASS  " + name)
    else:
        _fail += 1
        print("FAIL  " + name + "  " + detail)


def approx(a, b, tol=1e-6):
    return abs(float(a) - float(b)) <= tol


def run(kit_id, ctx):
    return KITS.run_kit(kit_id, ctx)


# ---- G3 bpskin.frame_gate: replay frame_report.json (5 PASS + wood_s202 FAIL) ----
frame_report = json.load(open(FRAME_DIR + "/frame_report.json"))
for entry in frame_report["checks"]:
    fn = entry["file"]
    ctx = {"kind": "bpskin", "png_path": FRAME_DIR + "/" + fn, "params": {}}
    out = run("bpskin.frame_gate", ctx)
    exp_verdict = "PASS" if entry["PASS"] else "FAIL"
    check("bpskin.frame_gate %s verdict==%s" % (fn, exp_verdict), out["verdict"] == exp_verdict,
          "got " + out["verdict"])
    check("bpskin.frame_gate %s silhouette_coverage==%s" % (fn, entry["coverage"]),
          approx(out["metrics"]["silhouette_coverage"], entry["coverage"], 1e-3),
          "got %s" % out["metrics"]["silhouette_coverage"])

# targeted double-FAIL vector
wood = run("bpskin.frame_gate", {"kind": "bpskin", "png_path": FRAME_DIR + "/wood_frame_s202.png", "params": {}})
check("wood_s202 double-FAIL verdict", wood["verdict"] == "FAIL", wood["verdict"])
check("wood_s202 margin_worst_side==0.798", approx(wood["metrics"]["margin_worst_side"], 0.798, 1e-3))
check("wood_s202 rim_luma_delta==0.6", approx(wood["metrics"]["rim_luma_delta"], 0.6, 1e-3))
failed = [c["name"] for c in wood["checks"] if not c["ok"]]
check("wood_s202 failed checks are margin+rim", set(failed) == {"margin", "rim"}, str(failed))

# ---- G3 matte.coverage_band: blade_c1_s101_alpha recorded coverage ----
blade_alpha = B + "/batch-003-item-icons/candidates/blade_c1_s101_alpha.png"
m = run("matte.coverage_band", {"kind": "po", "png_path": blade_alpha, "params": {}})
check("matte.coverage_band blade_c1_s101 PASS", m["verdict"] == "PASS", m["verdict"])
check("matte.coverage_band image_alpha_coverage==0.114983",
      approx(m["metrics"]["image_alpha_coverage"], 0.114983, 1e-6),
      "got %s" % m["metrics"]["image_alpha_coverage"])

# ---- G3 po.cell_packing: blade_c1_s101 recorded scores.json entry ----
scores = json.load(open(B + "/batch-003-item-icons/scores.json"))
blade_c0 = scores["items"]["blade"]["candidates"][0]  # blade_c1_s101_alpha.png
p = run("po.cell_packing", {"kind": "po", "png_path": blade_alpha, "shape": [[0, 0], [1, 0]], "params": {}})
check("po.cell_packing blade_c1_s101 PASS", p["verdict"] == "PASS", p["verdict"])
check("po.cell_packing score==54.97", approx(p["metrics"]["score"], blade_c0["score"], 1e-9),
      "got %s vs %s" % (p["metrics"]["score"], blade_c0["score"]))
check("po.cell_packing scale_term matches", approx(p["metrics"]["scale_term"], blade_c0["terms"]["scale_term"], 1e-4))
check("po.cell_packing cell_content_coverage==coverage_term",
      approx(p["metrics"]["cell_content_coverage"], blade_c0["terms"]["coverage_term"], 1e-4))
check("po.cell_packing per_cell_coverage note matches recorded",
      json.dumps(blade_c0["per_cell_coverage"]) in " ".join(p["notes"]),
      str(p["notes"]))

# ---- G3 tiling.seam: elven s101 seamless recorded findings.json leg ----
findings = json.load(open(B + "/bpskin-flux2-0150/findings.json"))
leg = next(l for l in findings["legs"] if l["motif"] == "elven" and l["seed"] == 101 and l["leg"] == "seamless")
s = run("tiling.seam", {"kind": "bpskin", "png_path": B + "/bpskin-flux2-0150/elven_s101_seamless.png"})
check("tiling.seam elven s101 seamless ratio_x matches findings",
      approx(s["metrics"]["seam_ratio_x"], leg["ratio_x"], 1e-6),
      "got %s vs %s" % (s["metrics"]["seam_ratio_x"], leg["ratio_x"]))
check("tiling.seam ratio_y matches findings",
      approx(s["metrics"]["seam_ratio_y"], leg["ratio_y"], 1e-6))
check("tiling.seam in REQ-0138 band -> PASS", s["verdict"] == "PASS", s["verdict"])
check("tiling.seam carries mandatory half-shift eyeball note",
      any("half-shift" in n for n in s["notes"]))

# ---- REQ-0191 contract: po.cell_fit's note is the backdrop's wire format ----
# The artadmin cell backdrop tints each owned cell by its violation v. Those
# v's exist ONLY in this note (promoting them to metrics would bump kit_version
# and mark every stored inspection row stale), so the note IS an interface --
# pinned here with the exact regex the client uses, against the exact key form
# the client indexes by (bbox-normalized "(row,col)", shape_to_cellset's
# normalization). Keep the numbers in the note, or update BOTH sides.
CLIENT_CELL_V_RE = re.compile(r"\((\d+),\s*(\d+)\)\s*=\s*([0-9]*\.?[0-9]+)")
f = run("po.cell_fit", {"kind": "po", "png_path": blade_alpha,
                        "shape": [[0, 0], [1, 0]], "params": {}})
parsed = {m[0] + "," + m[1]: float(m[2])
          for m in CLIENT_CELL_V_RE.findall(" ".join(f["notes"]))}
check("po.cell_fit note carries a per-cell v the client regex can read",
      len(parsed) == 2, "parsed=%s from %s" % (parsed, f["notes"]))
check("po.cell_fit note keys are the BBOX-NORMALIZED cells the client indexes",
      set(parsed) == {"0,0", "1,0"}, str(set(parsed)))
check("po.cell_fit fit_score + worst_cell_violation stay NUMERIC metrics",
      isinstance(f["metrics"].get("fit_score"), (int, float))
      and isinstance(f["metrics"].get("worst_cell_violation"), (int, float)),
      str(f["metrics"]))
check("po.cell_fit worst_cell_violation == max parsed per-cell v (the "
      "backdrop's worst-cell tint and the metric agree)",
      approx(max(parsed.values()), f["metrics"]["worst_cell_violation"], 1e-2),
      "note=%s metric=%s" % (max(parsed.values()), f["metrics"]["worst_cell_violation"]))

# ---- G2 purity: same input -> same output (all four adopted kits) ----
for kid, ctx in [
    ("bpskin.frame_gate", {"kind": "bpskin", "png_path": FRAME_DIR + "/leather_frame_s1.png", "params": {}}),
    ("matte.coverage_band", {"kind": "po", "png_path": blade_alpha, "params": {}}),
    ("po.cell_packing", {"kind": "po", "png_path": blade_alpha, "shape": [[0, 0], [1, 0]], "params": {}}),
    ("po.cell_fit", {"kind": "po", "png_path": blade_alpha, "shape": [[0, 0], [1, 0]], "params": {}}),
    ("tiling.seam", {"kind": "bpskin", "png_path": B + "/bpskin-flux2-0150/elven_s101_seamless.png"}),
]:
    a = json.dumps(run(kid, ctx), sort_keys=True)
    b = json.dumps(run(kid, ctx), sort_keys=True)
    check("G2 purity %s deterministic" % kid, a == b)

print("\ninspect_kits_test: %d passed / %d failed" % (_pass, _fail))
sys.exit(1 if _fail else 0)
