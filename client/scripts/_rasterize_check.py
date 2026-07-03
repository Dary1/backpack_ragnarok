#!/usr/bin/env python3
"""Rasterization helper for client/scripts/check_sprites.mjs (REQ-0026 follow-up).

Takes a manifest JSON (list of {id, viewBox, width, height, svgPath}) produced
by check_sprites.mjs, rasterizes each standalone SVG file with cairosvg (the
same library tools/tool_fit_check.py uses as the known-good reference), and
reports per-symbol alpha-channel pixel counts + a rough aspect-ratio sanity
check (rendered canvas aspect vs the symbol's own viewBox aspect -- they
should always match exactly since standaloneSvgString sizes width/height
directly from the viewBox with no extra scaling).

Prints a JSON array of {id, alphaCount, aspectOk, error?} to stdout.
"""
import io
import json
import sys

import cairosvg
import numpy as np
from PIL import Image


def rasterize_alpha_count(svg_path: str):
    with open(svg_path, "rb") as f:
        svg_bytes = f.read()
    png_bytes = cairosvg.svg2png(bytestring=svg_bytes, background_color="rgba(0,0,0,0)")
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    arr = np.array(img)
    alpha = arr[:, :, 3]
    return int((alpha > 0).sum()), img.width, img.height


def main():
    manifest_path = sys.argv[1]
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    results = []
    for entry in manifest:
        sym_id = entry["id"]
        try:
            alpha_count, out_w, out_h = rasterize_alpha_count(entry["svgPath"])
            expected_aspect = entry["width"] / entry["height"]
            actual_aspect = out_w / out_h
            aspect_ok = abs(expected_aspect - actual_aspect) < 0.01
            results.append({
                "id": sym_id,
                "alphaCount": alpha_count,
                "aspectOk": aspect_ok,
            })
        except Exception as e:  # noqa: BLE001 -- report every symbol, don't abort the batch
            results.append({"id": sym_id, "alphaCount": 0, "aspectOk": False, "error": str(e)})

    print(json.dumps(results))


if __name__ == "__main__":
    main()
