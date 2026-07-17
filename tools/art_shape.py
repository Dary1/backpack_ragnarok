#!/usr/bin/env python3
"""PO shape conditioning inputs -- the production scaffold builder.

REQ-0183, promoted from the REQ-0153 spike's tools/spikes/req0153_shape_scaffold.py
after that spike's GREEN verdict (Arm C = ReferenceLatent + SetLatentNoiseMask,
dilation D=8).

From a PO artwork's 5x5 boolean mask (the REQ-0151 editor's shape.mask, exactly
as stored), render the three images the shape-conditioned route consumes:

  (a) SCAFFOLD     -- a mid-gray (REQ-0153 Q1 ruling) flat silhouette of the
                      owned cells on white, at generation resolution. This is
                      the "gray shape" the edit-instruction prompt refers to,
                      fed in as a ReferenceLatent.
  (b) HARD MASK    -- white inside the shape dilated by D px, black elsewhere.
                      Fed LoadImage -> ImageToMask -> SetLatentNoiseMask so
                      nothing renders outside the (dilated) cells.
  (c) WHITE CANVAS -- pure white at gen resolution; the masked init latent.

PIL ONLY -- no numpy, no scipy. This is a HARD constraint, not a preference:
the generation worker runs under art_jobs.cjs jobPython() (ART_JOB_PYTHON, else
bare `python3`), which carries PIL but NOT the kit venv's numpy/scipy. The spike
could import scipy because it ran under the venv; this module cannot.

Dilation is nevertheless EXACT, not an approximation. The spike dilated with a
disc structuring element (scipy.ndimage.binary_dilation over a circular
struct). Our shape is a union of axis-aligned cell rectangles; the disc dilation
of a rectangle is precisely that rectangle expanded by D on every side with its
corners rounded at radius D -- i.e. a rounded rectangle. Dilation distributes
over union, so drawing each owned cell as a rounded rectangle (expanded by D,
corner radius D) and unioning reproduces the spike's disc dilation exactly,
with ImageDraw alone.

Cell -> px geometry follows the ratified sizing law: gen size is
art_style.gen_size(cols, rows, 256) over the mask's BOUNDING BOX -- the same
derivation server/services/art_sizing.cjs deriveSize('po', shape) performs when
it stamps the artwork's gen_width/gen_height. Cell rects are laid out
proportionally in that gen space, so the scaffold always registers with the
size the artwork was created at.
"""
import os
import sys

from PIL import Image, ImageDraw

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)
import art_style as STYLE  # noqa: E402  gen_size -- the ratified sizing law

PX_PER_CELL = 256         # PO resolution knob (art_sizing.cjs deriveSize uses 256)
GRAY = 128                # REQ-0153 Q1 ruling: mid-gray scaffold tone
WHITE = 255
BLACK = 0
DEFAULT_DILATION_PX = 8   # REQ-0153 verdict: Arm C @ D=8
# REQ-0186: the operator may tune the slack, but only inside the band REQ-0153
# actually built masks for ({0, 8, 16}). NOTE only D=8 was ever SCORED for image
# quality -- the sweep's other legs were rendered, not judged -- so 0 and 16 are
# "supported and bounded", not "validated". Beyond 16 is unexplored, and at 256
# px/cell a big enough D dissolves the shape into its own bounding box, which is
# just `off` with extra steps.
MAX_DILATION_PX = 16


def mask_to_cells(mask):
    """5x5 row-major bool mask -> sorted [[row, col], ...] of owned cells."""
    if not isinstance(mask, (list, tuple)):
        raise ValueError('po shape.mask must be a 5x5 array')
    cells = []
    for r, row in enumerate(mask):
        if not isinstance(row, (list, tuple)):
            raise ValueError('po shape.mask must be a 5x5 array')
        for c, on in enumerate(row):
            if on:
                cells.append([r, c])
    if not cells:
        raise ValueError('po shape.mask must have at least one active cell')
    return cells


def bbox_cells(cells):
    """cells -> (rows, cols, normalized cells) trimmed to their bounding box.

    Mirrors tool_fit_check.shape_to_cellset's normalization ([row, col], origin
    at the bbox min) and art_sizing.cjs poBoundingBox's extent.
    """
    rs = [r for r, _c in cells]
    cs = [c for _r, c in cells]
    r0, c0 = min(rs), min(cs)
    rows = max(rs) - r0 + 1
    cols = max(cs) - c0 + 1
    return rows, cols, [[r - r0, c - c0] for r, c in cells]


SHAPE_LOCKS = ('auto', 'off', 'guide', 'strict')
DEFAULT_SHAPE_LOCK = 'auto'


def resolve_lock(lock, mask):
    """The effective mechanism for a (lock, shape) pair: 'off' | 'guide' | 'strict'.

    `auto` (the default) resolves to strict for EVERY po shape.

    REQ-0186 used to split here -- strict on an underfilled bbox (L, T), off on
    a full rectangle -- on the claim that strict flattens a rectangle's subject
    ("a heater shield becomes a plain disc"). REQ-0187's S7 verification tested
    exactly that on the production route and refuted it: on a 2x2 `round shield`
    strict OUT-FIT off (median fit 81.3 vs 71.8, worst-cell 0.21 vs 0.32, 3/3
    PASS both) while KEEPING subject character (boss, riveted rim, plank
    texture); off merely drew heater silhouettes that underfill the square. The
    awkward half of the rule HELD (L-tromino: strict 68.3 vs off 32.5, one off
    seed spilling 123 px of deep-overflow), so nothing here questions strict on
    a notched shape.

    That left wall time as off's only remaining argument, and REQ-0220 found it
    rests on REQ-0153's SPIKE numbers (76-130 s conditioned vs 15-50 s plain).
    REQ-0187 V5 re-measured on THIS route -- which runs matting as a separate
    CPU inspection job instead of co-resident on the GPU -- and the gap is gone:
    warm conditioned 512x512 ~60-150 s vs plain off 512 ~90-120 s. With neither
    the pictures nor the cost favouring off, the split had no basis left.
    User ruling 2026-07-17; full write-up in docs/REQ/*/REQ-0220-*.md.

    `mask` is now unused but stays in the signature: `auto` remains a distinct
    STORED value rather than a migration of every artwork to 'strict', so a
    future shape-dependent rule can re-enter here without touching data or
    callers. An operator who wants off on a given item sets it explicitly or
    uses the one-shot per-render override.
    """
    lock = lock or DEFAULT_SHAPE_LOCK
    if lock not in SHAPE_LOCKS:
        raise ValueError('unknown shape_lock: %r (expected one of %s)'
                         % (lock, ', '.join(SHAPE_LOCKS)))
    if lock != 'auto':
        return lock
    return 'strict'


def gen_size_for_mask(mask, px_per_cell=PX_PER_CELL):
    """(w, h) for a 5x5 mask via the ratified art_style.gen_size()."""
    rows, cols, _cells = bbox_cells(mask_to_cells(mask))
    return STYLE.gen_size(cols, rows, px_per_cell=px_per_cell)


def _cell_rects(mask, gen_wh):
    """Owned cells as inclusive pixel rects [(x0, y0, x1, y1), ...] in gen space."""
    rows, cols, cells = bbox_cells(mask_to_cells(mask))
    gw, gh = gen_wh
    rects = []
    for r, c in cells:
        x0 = int(round(c * gw / float(cols)))
        x1 = int(round((c + 1) * gw / float(cols)))
        y0 = int(round(r * gh / float(rows)))
        y1 = int(round((r + 1) * gh / float(rows)))
        rects.append((x0, y0, x1 - 1, y1 - 1))
    return rects


def build_scaffold(mask, gen_wh, out_path):
    """(a) mid-gray flat silhouette on white, at gen resolution. RGB PNG."""
    img = Image.new('RGB', gen_wh, (WHITE, WHITE, WHITE))
    d = ImageDraw.Draw(img)
    for rect in _cell_rects(mask, gen_wh):
        d.rectangle(rect, fill=(GRAY, GRAY, GRAY))
    img.save(out_path)
    return out_path


def build_hard_mask(mask, gen_wh, out_path, d_px=DEFAULT_DILATION_PX):
    """(b) white inside the shape dilated by d_px, black elsewhere. RGB PNG.

    RGB (not L) because the graph reads it back with ImageToMask(channel=red).
    A rounded rectangle per cell IS the exact disc dilation (see module docs).
    """
    img = Image.new('RGB', gen_wh, (BLACK, BLACK, BLACK))
    d = ImageDraw.Draw(img)
    for (x0, y0, x1, y1) in _cell_rects(mask, gen_wh):
        if d_px <= 0:
            d.rectangle((x0, y0, x1, y1), fill=(WHITE, WHITE, WHITE))
        else:
            d.rounded_rectangle((x0 - d_px, y0 - d_px, x1 + d_px, y1 + d_px),
                                radius=d_px, fill=(WHITE, WHITE, WHITE))
    img.save(out_path)
    return out_path


def build_white_canvas(gen_wh, out_path):
    """(c) pure-white RGB canvas at gen resolution -- the masked init latent."""
    Image.new('RGB', gen_wh, (WHITE, WHITE, WHITE)).save(out_path)
    return out_path


def prepare_inputs(mask, gen_wh, input_dir, tag, d_px=DEFAULT_DILATION_PX):
    """Write the three conditioning images into ComfyUI's input dir.

    Returns {'reference_image', 'shape_mask_image', 'mask_init_image'} as bare
    filenames -- what LoadImage takes. `tag` namespaces them per job so repeat
    or concurrent jobs cannot read each other's scaffolds.
    """
    os.makedirs(input_dir, exist_ok=True)
    ref = 'shape_%s_scaffold.png' % tag
    msk = 'shape_%s_mask_d%d.png' % (tag, d_px)
    wht = 'shape_%s_white.png' % tag
    build_scaffold(mask, gen_wh, os.path.join(input_dir, ref))
    build_hard_mask(mask, gen_wh, os.path.join(input_dir, msk), d_px)
    build_white_canvas(gen_wh, os.path.join(input_dir, wht))
    return {'reference_image': ref, 'shape_mask_image': msk, 'mask_init_image': wht}
