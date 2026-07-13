#!/usr/bin/env python3
"""REQ-0153 -- PO shape scaffold builder.

From a PO cell shape (a list of [row, col] owned cells, the exact same
convention as tool_fit_check.shape_to_cellset and the REQ-0151 PO editor's
5x5 mask), render the conditioning inputs the spike's arms consume:

  (a) SCAFFOLD  -- a mid-gray (Q1 ruling) flat silhouette of the owned cells
      on a white background, at generation resolution. The "gray shape" the
      Arm A / Arm C edit-instruction prompt refers to, and the Arm B init.
  (b) HARD MASK -- white where the shape is (optionally dilated by D px),
      black elsewhere. Arm C feeds it LoadImage -> ImageToMask ->
      SetLatentNoiseMask so nothing renders outside the (dilated) cells.
      D is swept over {0, 8, 16}.
  (c) WHITE CANVAS -- pure white at gen resolution, the Arm C init latent.
  (d) SOFT MASK -- feathered dilated mask for the Arm C2 DifferentialDiffusion
      variant.

Cell -> px geometry is resurrected from commit 8876225's
`build_cell_mask_image` (tools/gen_item_icons.py, SDXL era, since deleted on
the flux2 line): build the per-cell grid at a native cell px, then resize
(NEAREST -- flat per-cell blocks) to the actual gen_px the sampler uses. The
sizing law itself (aspect + /16 snap, 256 px/cell for items) is
art_style.gen_size() -- imported, not reimplemented, so this spike cannot
drift from the ratified route.
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

TOOLS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, TOOLS_DIR)
import art_style as STYLE            # noqa: E402  gen_size (the ratified sizing law)
import tool_fit_check as fit         # noqa: E402  shape_to_cellset (the cell convention)

NATIVE_CELL_PX = 256
GRAY = 128        # Q1 ruling: mid-gray scaffold tone.
WHITE = 255
BLACK = 0


def shape_grid(shape):
    """shape ([[row,col],...]) -> (bool grid[rows,cols], rows, cols) at 1 px/cell."""
    cellset, rows, cols = fit.shape_to_cellset(shape)
    grid = np.zeros((rows, cols), dtype=bool)
    for (r, c) in cellset:
        grid[r, c] = True
    return grid, rows, cols


def _native_mask(grid, cell_px=NATIVE_CELL_PX):
    return np.repeat(np.repeat(grid, cell_px, axis=0), cell_px, axis=1)


def _resize_bool(mask_bool, gen_wh):
    gw, gh = gen_wh
    im = Image.fromarray((mask_bool * 255).astype(np.uint8), mode="L")
    if im.size != (gw, gh):
        im = im.resize((gw, gh), Image.NEAREST)
    return np.array(im) > 127


def gen_size_for_shape(shape, px_per_cell=256):
    """gen (w,h) for a shape's cell bbox, via the ratified art_style.gen_size()."""
    _grid, rows, cols = shape_grid(shape)
    return STYLE.gen_size(cols, rows, px_per_cell=px_per_cell)


def shape_mask_at_gen(shape, gen_wh):
    grid, _rows, _cols = shape_grid(shape)
    return _resize_bool(_native_mask(grid), gen_wh)


def dilate_mask(mask_bool, d_px):
    if d_px <= 0:
        return mask_bool
    r = int(d_px)
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    struct = (xx * xx + yy * yy) <= r * r
    return ndimage.binary_dilation(mask_bool, structure=struct)


def build_scaffold(shape, gen_wh, out_path):
    """(a) mid-gray flat silhouette on white, at gen resolution. RGB PNG."""
    mask = shape_mask_at_gen(shape, gen_wh)
    gw, gh = gen_wh
    img = np.full((gh, gw, 3), WHITE, dtype=np.uint8)
    img[mask] = GRAY
    Image.fromarray(img, mode="RGB").save(out_path)
    return out_path


def build_hard_mask(shape, gen_wh, out_path, d_px=0):
    """(b) hard mask: white in the (dilated) shape region, black elsewhere."""
    mask = dilate_mask(shape_mask_at_gen(shape, gen_wh), d_px)
    img = np.where(mask, WHITE, BLACK).astype(np.uint8)
    Image.fromarray(img, mode="L").save(out_path)
    return out_path


def build_soft_mask(shape, gen_wh, out_path, d_px=16, feather=24):
    """(d) soft-gradient mask for the Arm C2 DifferentialDiffusion variant."""
    mask = dilate_mask(shape_mask_at_gen(shape, gen_wh), d_px).astype(np.float32)
    if feather > 0:
        mask = ndimage.gaussian_filter(mask, sigma=feather / 2.0)
        mask = np.clip(mask, 0.0, 1.0)
    img = (mask * 255).astype(np.uint8)
    Image.fromarray(img, mode="L").save(out_path)
    return out_path


def build_white_canvas(gen_wh, out_path):
    """(c) pure-white RGB canvas at gen resolution (Arm C init latent)."""
    gw, gh = gen_wh
    Image.fromarray(np.full((gh, gw, 3), WHITE, dtype=np.uint8), mode="RGB").save(out_path)
    return out_path


# The four spike shapes (ratified matrix). [row, col] owned cells.
SHAPES = {
    "l_tromino": [[0, 0], [1, 0], [1, 1]],            # bbox 2x2, an L
    "t_tetromino": [[0, 0], [0, 1], [0, 2], [1, 1]],  # bbox 3w x 2h, a T
    "v_1x3": [[0, 0], [1, 0], [2, 0]],                # bbox 1w x 3h, vertical bar
    "sq_2x2": [[0, 0], [0, 1], [1, 0], [1, 1]],       # bbox 2x2, control square
}


def main():
    ap = argparse.ArgumentParser(description="REQ-0153 shape scaffold builder")
    ap.add_argument("--out", default="/tmp/req0153_scaffolds")
    ap.add_argument("--px-per-cell", type=int, default=256)
    ap.add_argument("--dilations", default="0,8,16")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    dils = [int(x) for x in args.dilations.split(",")]
    for name, shape in SHAPES.items():
        gen_wh = gen_size_for_shape(shape, args.px_per_cell)
        build_scaffold(shape, gen_wh, os.path.join(args.out, name + "_scaffold.png"))
        build_white_canvas(gen_wh, os.path.join(args.out, name + "_white.png"))
        for d in dils:
            build_hard_mask(shape, gen_wh, os.path.join(args.out, "%s_mask_d%d.png" % (name, d)), d)
        build_soft_mask(shape, gen_wh, os.path.join(args.out, name + "_soft_d16.png"), 16)
        print("%s: gen_wh=%s" % (name, gen_wh))


if __name__ == "__main__":
    main()
