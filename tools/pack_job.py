#!/usr/bin/env python3
"""REQ-0192 -- ONE repack job, driven by the Node job runner (art_jobs.cjs).

stdin: {png_b64, shape} -- the SOURCE render PNG (white-background raster,
as stored) and the artwork's po shape (5x5 mask). stdout: one JSON result:
  {status:"ok", png_b64, transform:{scale,rot,flip,pos},
   identity_score, packed_score}
or {status:"failed", error}.

Pipeline: matte (gen_item_icons two-strategy; ART_KIT_MATTE_METHOD=borderkey
forces the model-free path for tests) -> cell grid content -> identity score
(tool_cell_fit v5: shifted centers, worst-spot aggregation) -> pack_search
(feasible placements only: containment + pad guaranteed, 4x90 rotations +
flips) -> apply_pack -> TRANSPARENT RGBA PNG at gen resolution (REQ-0193: the white composite was dropped -- a repack carries the
cutout its matte already produced).

Same stdout hygiene as inspect_job.py: matting libraries print PERFORMANCE
WARNINGs to stdout, so all in-run stdout routes to stderr and only the final
JSON touches the real stdout."""
import base64
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def do_pack(job):
    import numpy as np
    from PIL import Image
    import gen_item_icons as GI
    import tool_fit_check as fit
    import tool_cell_fit as CF

    mask = (job.get("shape") or {}).get("mask")
    if not mask:
        return {"status": "failed", "error": "no shape.mask in job"}
    cells = [[r, c] for r in range(len(mask)) for c in range(len(mask[r])) if mask[r][c]]
    if not cells:
        return {"status": "failed", "error": "shape.mask has no active cells"}
    cellset, rows, cols = fit.shape_to_cellset(cells)

    raw = base64.b64decode(job["png_b64"])
    rgb = Image.open(io.BytesIO(raw)).convert("RGB")
    if os.environ.get("ART_KIT_MATTE_METHOD", "auto") == "borderkey":
        rgba = GI._matte_border_key(rgb)
    else:
        rgba = GI.matte_alpha_data(rgb)["image"]
    alpha = Image.fromarray(np.array(rgba)[:, :, 3], "L")
    content = CF.content_from_alpha(alpha, rows, cols)
    if not content.any():
        return {"status": "failed", "error": "matte produced empty content"}

    identity = CF.score_content(content, cellset, rows, cols)
    best = pack = CF.pack_search(content, cellset, rows, cols)
    if pack is None:
        return {"status": "failed", "error": "no feasible packed placement"}

    # gen resolution: the source render is rows x cols cells; use its own
    # per-cell pixel size so the packed image matches the source resolution.
    gen_cell = max(16, int(round(rgba.size[0] / float(cols))))
    out_img = CF.apply_pack(rgba, content, best, rows, cols, gen_cell=gen_cell)
    buf = io.BytesIO()
    out_img.save(buf, format="PNG")
    return {"status": "ok",
            "png_b64": base64.b64encode(buf.getvalue()).decode(),
            "transform": {"scale": round(best["scale"], 4), "rot": best["rot"],
                          "flip": best["flip"], "pos": list(best["pos"])},
            "identity_score": identity["score"],
            "packed_score": pack["result"]["score"]}


def main():
    job = json.load(sys.stdin)
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        out = do_pack(job)
    finally:
        sys.stdout = real_stdout
    print(json.dumps(out))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"status": "failed", "error": str(e)[:300]}))
        sys.exit(0)
