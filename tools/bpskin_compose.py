#!/usr/bin/env python3
"""REQ-0150 / REQ-0146 -- compose a backpack skin from a FILL and a FRAME source.

The user's brief (2026-07-13, with a hand-edited mock-up): the seamless leather
fill is not the finished asset. The finished asset is fill + a proper EDGE, and
the edging must be produced BY SCRIPT, not by hand in an image editor.

Where the two halves come from:
  FILL  -- content/batches/flux2-parity-0150/bpskin_leather_fill_a.png
           seamless (REQ-0150 §2: CircularVAEDecode; seam ratio 0.93 / 1.00)
  FRAME -- content/batches/flux2-parity-0150/bpskin_leather.png
           the "failed" Anime-template render: a rounded, stitched, black-outlined
           leather PATCH on white. Useless as a fill -- exactly right as an edge
           source, which is the user's own read of it.

How the frame is extracted (no hand-editing, no magic numbers baked in):
  1. SILHOUETTE. Flood-fill the near-white background inward from the four
     corners. Only background CONNECTED TO THE BORDER is removed, so white specks
     inside the leather are not punched out. What remains is the patch.
  2. RING. Euclidean distance transform of the silhouette -> every pixel knows how
     far it is from the patch edge. ring = silhouette AND distance <= --band.
     That is the black outline + the leather welt + the stitch line, and nothing
     else. --band is the ONE tunable; it is swept, not guessed.
  3. COMPOSE. fill inside (silhouette minus ring), frame ring on top, feathered
     over a couple of pixels so the join does not alias. Outside the silhouette:
     transparent -- the rounded corners and the side keeper-tabs survive as alpha,
     which is what lets this sit on any canvas.

And because a backpack is an arbitrary POLYOMINO (REQ-0126: I, L, T, S/Z,
inner-corner, holed), the square compose is only the demo. `--shape` builds the
same skin over a real polyomino: the fill is TILED across the cell interiors and
the ring is re-derived from the polyomino's own silhouette, so straights, outer
corners and inner corners all fall out of the distance transform for free -- no
tile atlas, no autotile lookup table, no renderer rotation.
"""
import argparse, os, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
BATCH = os.path.join(REPO, "content/batches/flux2-parity-0150")
CELL = 128

SHAPES = {
    "square":  ["########"] * 8,
    "L":       ["####....",
                "####....",
                "####....",
                "####....",
                "########",
                "########",
                "########",
                "########"],
    "T":       ["########",
                "########",
                "..####..",
                "..####..",
                "..####..",
                "..####..",
                "........",
                "........"],
    "holed":   ["########",
                "########",
                "##....##",
                "##....##",
                "##....##",
                "##....##",
                "########",
                "########"],
}


def silhouette(patch_rgb):
    """Near-white background, but ONLY the part connected to the image border."""
    a = np.asarray(patch_rgb, dtype=np.int16)
    nearwhite = (a.min(axis=2) > 225) & ((a.max(axis=2) - a.min(axis=2)) < 30)
    lab, n = ndimage.label(nearwhite)
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    outer = np.isin(lab, list(border))
    return ~outer


def ring_of(mask, band):
    """Everything within `band` px of the silhouette's edge.

    The mask is PADDED with background before the distance transform. Without
    this, a patch that runs to the image border has no background pixel next to
    it there, so the EDT measures the distance to the far-away corner white
    instead, and the ring only materialises at the rounded corners. That is
    exactly the bug this first produced: a black keyline and leather welt in the
    four corners and nothing along the four sides."""
    pad = int(band) + 2
    m = np.pad(mask, pad, mode="constant", constant_values=False)
    dist = ndimage.distance_transform_edt(m)[pad:-pad, pad:-pad]
    return mask & (dist <= band), dist


def feather(mask, px):
    m = Image.fromarray((mask * 255).astype(np.uint8), "L")
    if px > 0:
        m = m.filter(ImageFilter.GaussianBlur(px))
    return np.asarray(m, dtype=np.float32)[..., None] / 255.0


def tile_fill(fill_img, w, h):
    fw, fh = fill_img.size
    out = Image.new("RGB", (w, h))
    for y in range(0, h, fh):
        for x in range(0, w, fw):
            out.paste(fill_img, (x, y))
    return out


def compose(fill_img, frame_rgb, sil, band, soft=2):
    h, w = sil.shape
    ring, _ = ring_of(sil, band)
    inner = sil & ~ring
    fill = np.asarray(tile_fill(fill_img, w, h), dtype=np.float32)
    frame = np.asarray(frame_rgb.resize((w, h), Image.LANCZOS), dtype=np.float32)
    wr = feather(ring, soft)
    rgb = fill * (1 - wr) + frame * wr
    alpha = (feather(sil, soft) * 255).astype(np.uint8)[..., 0]
    out = np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), alpha])
    return Image.fromarray(out, "RGBA")


def shape_mask(rows, cell=CELL):
    gh, gw = len(rows), len(rows[0])
    m = np.zeros((gh * cell, gw * cell), dtype=bool)
    for r, line in enumerate(rows):
        for c, ch in enumerate(line):
            if ch == "#":
                m[r*cell:(r+1)*cell, c*cell:(c+1)*cell] = True
    return m


def _mirror(i, L):
    """Reflect index into [0, L) -- mirror-tiling, so a repeated welt run has no
    hard seam where it wraps."""
    per = max(2 * L - 2, 1)
    i = np.mod(i, per)
    return np.where(i < L, i, per - i)


def welt_strips(frame_rgb, src_sil, band):
    """Cut two DIRECTIONAL welt strips out of the source patch: one from a clean
    run of its top edge, one from a clean run of its left edge. Rows/cols are
    ordered OUTER -> INNER, so `depth` indexes them directly on any side.

    The first version of this tiled a single band x band swatch isotropically
    across the whole canvas. It read as a repeating chain of blobs, not a leather
    welt, because a welt has a DIRECTION and a swatch does not."""
    a = np.asarray(frame_rgb, dtype=np.float32)
    H, W = src_sil.shape
    top = np.where(src_sil[:, W // 2])[0].min()
    left = np.where(src_sil[H // 2, :])[0].min()
    h = a[top:top + band, int(W * 0.30):int(W * 0.70)]           # (band, Lh, 3)
    v = a[int(H * 0.30):int(H * 0.70), left:left + band]         # (Lv, band, 3)
    return h, v


def welt_render(mask, band, frame_rgb, src_sil):
    """Paint the welt around an arbitrary polyomino.

    For every ring pixel, scipy's feature transform gives the NEAREST background
    pixel. The offset to it yields two things for free:
      depth  -- how far in from the edge the pixel is  -> which row of the strip
      normal -- whether the nearest edge is horizontal or vertical -> which strip
    So straights, outer corners, inner corners and holes are all handled by the
    same three lines; there is no autotile atlas and no lookup table."""
    h, v = welt_strips(frame_rgb, src_sil, band)
    Lh, Lv = h.shape[1], v.shape[0]
    pad = int(band) + 2
    m = np.pad(mask, pad, mode="constant", constant_values=False)
    dist, idx = ndimage.distance_transform_edt(m, return_indices=True)
    dist = dist[pad:-pad, pad:-pad]
    by = idx[0][pad:-pad, pad:-pad] - pad
    bx = idx[1][pad:-pad, pad:-pad] - pad

    H, W = mask.shape
    yy, xx = np.mgrid[0:H, 0:W]
    dy, dx = yy - by, xx - bx
    depth = np.clip(dist.astype(int), 0, band - 1)
    horiz = np.abs(dy) >= np.abs(dx)          # nearest edge runs horizontally

    ih = _mirror(xx, Lh)
    iv = _mirror(yy, Lv)
    out = np.where(horiz[..., None],
                   h[depth, ih],              # (band, Lh, 3) -> per-pixel
                   v[iv, depth])              # (Lv, band, 3) -> per-pixel
    return out.astype(np.float32)


def compose_shape(fill_img, frame_rgb, src_sil, rows, band, soft=2):
    m = shape_mask(rows)
    h, w = m.shape
    ring, _ = ring_of(m, band)
    fill = np.asarray(tile_fill(fill_img, w, h), dtype=np.float32)
    welt = welt_render(m, band, frame_rgb, src_sil)
    wr = feather(ring, soft)
    rgb = fill * (1 - wr) + welt * wr
    # a dark keyline exactly on the silhouette edge, the way the source patch has one
    edge, _ = ring_of(m, max(2, band // 14))
    we = feather(edge, 1)
    rgb = rgb * (1 - we * 0.8) + np.array([26, 20, 16], dtype=np.float32) * (we * 0.8)
    alpha = (feather(m, soft) * 255).astype(np.uint8)[..., 0]
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), alpha]), "RGBA")


def checker(size, a=(58, 58, 64), b=(44, 44, 50), s=32):
    w, h = size
    im = Image.new("RGB", (w, h), a)
    px = im.load()
    for y in range(h):
        for x in range(w):
            if ((x // s) + (y // s)) % 2:
                px[x, y] = b
    return im


def on_canvas(rgba):
    bg = checker(rgba.size)
    bg.paste(rgba, (0, 0), rgba)
    return bg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fill",  default=os.path.join(BATCH, "bpskin_leather_fill_a.png"))
    ap.add_argument("--frame", default=os.path.join(BATCH, "bpskin_leather.png"))
    ap.add_argument("--bands", default="45,60,75,95")
    ap.add_argument("--shape", default=None, choices=sorted(SHAPES))
    ap.add_argument("--band",  type=int, default=60)
    ap.add_argument("--out",   default=os.path.join(BATCH, "compose"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    fill = Image.open(a.fill).convert("RGB")
    frame = Image.open(a.frame).convert("RGB")
    sil = silhouette(frame)
    print("frame silhouette: %.1f%% of the tile" % (100 * sil.mean()), flush=True)

    if a.shape:
        img = compose_shape(fill, frame, sil, SHAPES[a.shape], a.band)
        p = os.path.join(a.out, "shape_%s_band%d.png" % (a.shape, a.band))
        img.save(p); on_canvas(img).save(p.replace(".png", "_oncanvas.png"))
        print("WROTE", p, flush=True)
        return

    for band in [int(x) for x in a.bands.split(",")]:
        img = compose(fill, frame, sil, band)
        p = os.path.join(a.out, "square_band%d.png" % band)
        img.save(p); on_canvas(img).save(p.replace(".png", "_oncanvas.png"))
        print("WROTE %s (band=%d px)" % (p, band), flush=True)


if __name__ == "__main__":
    main()
