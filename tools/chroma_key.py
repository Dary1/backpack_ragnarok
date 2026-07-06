#!/usr/bin/env python3
"""
chroma_key.py -- Simple flat-background chroma-key + despill, PIL+numpy only.

Turns a flat-background illustration into a transparent RGBA PNG. The exact
background hue the checkpoint renders for a "solid X background" clause is
not guaranteed to be pure -- it often drifts toward whatever the prompt's
overall palette biases it to (e.g. cyan/teal for an icy scene). --auto-key
samples the four corner pixels and uses their average as the key color
instead of assuming pure green.

Not a general-purpose keyer -- assumes a fairly uniform flat backdrop; fine
for cel-shaded/bold-outline styles. Revisit with a proper matting model
(e.g. rembg/U2Net, already cached at ~/.u2net/u2net.onnx) if a softer-edged
style needs it later.

Usage:
  python3 tools/chroma_key.py --in path/in.png --out path/out.png --auto-key
  python3 tools/chroma_key.py --in path/in.png --out path/out.png --key 0,255,0
"""
import argparse
import numpy as np
from PIL import Image


def sample_corner_key(im, margin=6):
    w, h = im.size
    pts = [(margin, margin), (w - 1 - margin, margin),
           (margin, h - 1 - margin), (w - 1 - margin, h - 1 - margin)]
    cols = [im.getpixel(p) for p in pts]
    r = sum(c[0] for c in cols) / len(cols)
    g = sum(c[1] for c in cols) / len(cols)
    b = sum(c[2] for c in cols) / len(cols)
    return (r, g, b)


def chroma_key(path_in, path_out, key=None, tol=60.0, edge=40.0):
    im = Image.open(path_in).convert("RGB")
    if key is None:
        key = sample_corner_key(im)
    arr = np.array(im).astype(np.float32)
    kr, kg, kb = key
    diff = np.sqrt((arr[..., 0] - kr) ** 2 + (arr[..., 1] - kg) ** 2 + (arr[..., 2] - kb) ** 2)
    alpha = np.clip((diff - tol) / edge, 0.0, 1.0) * 255.0

    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    out_g, out_b = g, b
    kmin = min(kr, kg, kb)
    if kg - kmin > 20:
        avg_rb = (r + b) / 2.0
        out_g = np.where(g > avg_rb, avg_rb, g)
    if kb - kmin > 20:
        avg_rg = (r + out_g) / 2.0
        out_b = np.where(b > avg_rg, avg_rg, b)

    out = np.stack([r, out_g, out_b, alpha], axis=-1)
    out = np.clip(out, 0, 255).astype(np.uint8)
    Image.fromarray(out, mode="RGBA").save(path_out)
    return key


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--key", default=None)
    ap.add_argument("--auto-key", action="store_true")
    ap.add_argument("--tol", type=float, default=60.0)
    ap.add_argument("--edge", type=float, default=40.0)
    a = ap.parse_args()
    key = None if (a.auto_key or not a.key) else tuple(int(x) for x in a.key.split(","))
    used = chroma_key(a.inp, a.out, key=key, tol=a.tol, edge=a.edge)
    print(f"OK {a.inp} -> {a.out} (key={tuple(round(x,1) for x in used)})")


if __name__ == "__main__":
    main()
