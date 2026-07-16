#!/usr/bin/env python3
"""REQ-0193 -- ONE background-cutout job, driven by the Node job runner
(art_jobs.cjs).

stdin: {png_b64} -- the SOURCE render PNG (white-background raster, as
stored). stdout: one JSON result:
  {status:"ok", png_b64, method, image_alpha_coverage}
or {status:"failed", error}.

Pipeline: matte -> RGBA PNG. Nothing else -- no crop, no resize, no
re-placement: the cutout is the source render with its background removed,
same pixel grid, so it stays directly comparable to its source.

The matte is NOT implemented here. gen_item_icons.matte_alpha_data() is the
one matte implementation in this tree (rembg `birefnet-general` primary +
pure-numpy border-key fallback) and every matte caller imports it; this job
does the same (user directive: do not re-implement background removal, use the
library). ART_KIT_MATTE_METHOD=borderkey forces the model-free path so tests
and e2e never touch the GPU model.

Same stdout hygiene as inspect_job.py / pack_job.py: matting libraries print
PERFORMANCE WARNINGs to stdout, so all in-run stdout routes to stderr and only
the final JSON touches the real stdout."""
import base64
import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def do_cutout(job):
    import numpy as np
    from PIL import Image
    import gen_item_icons as GI

    b64 = job.get("png_b64")
    if not b64:
        return {"status": "failed", "error": "no png_b64 in job"}
    src = Image.open(io.BytesIO(base64.b64decode(b64)))
    arr = np.array(src.convert("RGBA"))

    # Already matted (an alpha render, or a cutout of a cutout the route
    # should have refused): keep the provided alpha rather than re-matting a
    # transparent image, which birefnet reads as an empty subject.
    if arr[:, :, 3].min() < 250:
        rgba = Image.fromarray(arr, "RGBA")
        method = "provided"
    else:
        rgb = src.convert("RGB")
        if os.environ.get("ART_KIT_MATTE_METHOD", "auto") == "borderkey":
            rgba = GI._matte_border_key(rgb)
            method = "borderkey"
        else:
            d = GI.matte_alpha_data(rgb)  # birefnet primary, border-key fallback
            rgba = d["image"]
            method = d["method"]

    out = np.array(rgba.convert("RGBA"))
    cov = GI._coverage(out)
    if cov <= 0.0:
        return {"status": "failed", "error": "matte produced an empty cutout "
                                             "(method=" + method + ")"}
    buf = io.BytesIO()
    Image.fromarray(out, "RGBA").save(buf, format="PNG")
    return {"status": "ok",
            "png_b64": base64.b64encode(buf.getvalue()).decode(),
            "method": method,
            "image_alpha_coverage": round(float(cov), 6)}


def main():
    job = json.load(sys.stdin)
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        out = do_cutout(job)
    except Exception as e:  # a failed job is a row status, never a crash
        out = {"status": "failed", "error": type(e).__name__ + ": " + str(e)}
    finally:
        sys.stdout = real_stdout
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
