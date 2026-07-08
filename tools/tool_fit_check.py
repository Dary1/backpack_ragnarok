# -*- coding: utf-8 -*-
"""
tool_fit_check.py -- Icon <-> Cell Fit Check / Fix tool (REQ-0019, full port REQ-0020)

Full functional port of the reference algorithm `tools/reference/fit_algorithm_reference.py`
(user-provided, TRUSTED, NORMATIVE -- see REQ-0020). Every reference function is present
here with logic-identical behavior: build_region, load_content, scaled, find_placement,
max_scale, solve, rotate_mask, solve_any_angle, render. Comments are translated to English
(project language policy); the algorithms themselves are untouched. Per the binding trust
directive, if this port and the reference ever disagree, the port is wrong -- defects can
only live in our adaptations (SVG rasterization, alpha-mask extraction, layout/cellset
construction from our JSON shape format, coordinate mapping, CLI, CHECK-mode semantics),
never in the ported algorithm sections themselves.

Reference-parity functions (identical logic to tools/reference/fit_algorithm_reference.py):
  build_region_from_layout(layout)  -- reference build_region(layout, pad_outside=False)
  load_content(path, border=3)      -- verbatim raster-image content-mask loader
  scaled(mask, s)                   -- verbatim
  find_placement(allowed, kern)     -- verbatim (fftconvolve when scipy present; identical
                                        np.fft fallback otherwise, same 'valid'-mode math)
  max_scale(allowed, content, ...)  -- verbatim (descending coarse scan, non-monotonic
                                        feasibility, fine upward refinement, floor pruning)
  solve(allowed, content)           -- verbatim (4 rotations x 2 flips)
  rotate_mask(mask, deg)            -- verbatim (arbitrary-angle rotation + bbox crop)
  solve_any_angle(allowed, content, coarse_deg=5.0, refine=((4.0,1.0),(0.75,0.25)))
                                     -- verbatim (coarse full sweep, staged refinement,
                                        floor pruning)
  render(allowed, cellset, best, out) -- verbatim (white cells / pink pads / dark content /
                                        blue grid), best = dict(scale, mask, pos, ...)

Our adaptations (NOT reference functions; project-specific glue):
  build_region(cellset)             -- our cellset (from JSON "shape") -> allowed mask;
                                        thin wrapper that builds a synthetic layout and
                                        calls build_region_from_layout, so the padding
                                        logic itself is 100% reference code.
  shape_to_cellset / extract_symbol / rasterize_symbol / crop_to_content
                                     -- SVG symbol -> content mask (alpha-channel path),
                                        our sprite/defs format handling.
  check_icon / fix_icon / format_check_line / format_fix_line / render_wrapper
                                     -- CHECK/FIX report modes, our CLI semantics.
  centered_position(allowed, kern)  -- placement-selection policy (REQ-0023, adoption
                                        layer, user-confirmed 2026-07-03). solve()/
                                        max_scale()/find_placement() are UNCHANGED and
                                        still pick the reference's first (top-left-most,
                                        row-major) feasible position internally while
                                        searching for max scale. This function is an
                                        ADDITIVE post-step: given the already-chosen
                                        scale/rot/flip kernel, it re-enumerates the full
                                        feasible-position set (same conv/allowed math as
                                        find_placement) and selects the position closest
                                        to the allowed-region centroid (tie-break:
                                        smallest y then x). fix_icon() calls this and
                                        reports BOTH pos_first_xy (reference's own choice)
                                        and pos_centered_xy (this policy's choice, used for
                                        fix application and fit-report rendering).

Two modes:
  check <sprite.svg> <defs.json...>
      Rasterize each symbol (alpha-channel content mask) at its natural mapping
      onto its shape's cell grid and verify full containment inside the allowed
      region (owned cells minus a 2px no-contact pad on every face whose neighbor
      cell is not owned). Reports PASS/FAIL, overflow pixel count, violated
      pads/faces, and per-owned-cell coverage % (content px / cell px).
      Exits non-zero if any icon FAILs (gate usage).

  fix <sprite.svg> <defs.json...> [--any-angle]
      Runs solve() (4 rotations x flip, max-scale search) per FAILing icon and
      prints the prescribed transform (scale %, rotation, flip, pos_first,
      pos_centered). pos_centered comes from the additive centered_position()
      placement-selection policy (REQ-0023) applied to solve()'s own
      scale/rot/flip; pos_first is the reference's original top-left-most
      choice, kept for transparency. With --any-angle, runs solve_any_angle()
      instead (arbitrary-angle rotation search) and reports the same fields
      for degrees instead of a 90-degree-step rotation.
      Reporting mode only; does not modify the sprite file.

Content mask (SVG path, default): cairosvg rasterizes each <symbol> (wrapped in a
temporary standalone <svg> using the symbol's own viewBox) at CELL=100 px per
shape-bbox cell unit, transparent background. Content mask = alpha channel > 0.
For CHECK, the mask keeps its natural position (not bbox-cropped) because
position within the viewBox matters for containment. For FIX/solve, the mask
IS cropped to its content bounding box first (matches the reference algorithm,
which searches translations freely).

Content mask (raster path, --content-image): reference load_content() verbatim --
grayscale, scan-border cleanup (outer `border` px forced to white to strip
scanner noise), threshold gray<128, cropped to bbox. Use this to run fix/check
against a raw raster image (e.g. a photographed/scanned icon) instead of an SVG
symbol, exactly like the reference's own __main__ example.

CLI:
    tool_fit_check.py check <sprite.svg> <defs.json...> [--out report.txt]
                             [--render-dir DIR] [--tag PREFIX]
    tool_fit_check.py fix   <sprite.svg> <defs.json...> [--out report.txt]
                             [--any-angle]
    tool_fit_check.py fix   --content-image IMG.png --layout "row1,row2,..." [--any-angle]
                             (raster-input mode; layout rows use full-width JP '□'
                             cells like the reference's own __main__ layout, comma-joined
                             on the CLI, e.g. --layout "□ □,□□")

Each defs.json is either:
  - {"schema":..., "entries": [ {..., "icon": "icon-X", "shape": [[c,r],...]}, ...]}
  - a bare list of such entries
Entries without a "shape" field (plain socket items) are SKIPPED (reported).
Entries whose "icon" has no matching <symbol> in the sprite are SKIPPED (reported).
"""
import sys
import io
import json
import argparse
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image, ImageDraw
import cairosvg

try:
    from scipy.signal import fftconvolve
    HAVE_SCIPY = True
except Exception:
    HAVE_SCIPY = False

CELL = 100
PAD = 5
SVG_NS = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG_NS)


# =====================================================================
# Reference-parity section -- logic ported verbatim from
# tools/reference/fit_algorithm_reference.py. Comments translated to
# English; algorithms/formulas/control-flow UNCHANGED. Do not "improve".
# =====================================================================

# ---------- 1. Allowed-region mask construction (reference: build_region) ----------
def build_region_from_layout(layout, align=None):
    """layout: list of strings. '□' = fit cell, anything else = blank cell.
    Returns: allowed (bool HxW), cellset.

    Reference note (translated verbatim):
    Literal-reading implementation: padding applies to any face of an owned
    cell that has no owned neighbor cell -- whether that neighbor position is
    a blank cell or off the grid entirely, if there is no fit-cell there, the
    face gets padding.
    """
    rows = len(layout)
    cols = max(len(r) for r in layout)
    cellset = {(r, c) for r, row in enumerate(layout)
               for c, ch in enumerate(row) if ch == '□'}
    allowed = np.zeros((rows * CELL, cols * CELL), bool)

    def needs_pad(nr, nc):
        return (nr, nc) not in cellset

    av = (align or {}).get("v")
    ah = (align or {}).get("h")
    for r, c in cellset:
        a = np.ones((CELL, CELL), bool)
        # REQ-0104: a PO that declares an align on a side is meant to sit FLUSH
        # against that edge (a seam/join side), so the no-contact PAD is
        # intentionally NOT reserved there. Every other exposed face keeps its pad.
        if needs_pad(r - 1, c) and av != "top":
            a[:PAD, :] = False
        if needs_pad(r + 1, c) and av != "bottom":
            a[-PAD:, :] = False
        if needs_pad(r, c - 1) and ah != "left":
            a[:, :PAD] = False
        if needs_pad(r, c + 1) and ah != "right":
            a[:, -PAD:] = False
        allowed[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = a
    return allowed, cellset


# ---------- 2. Image -> content mask (reference: load_content) ----------
def load_content(path, border=3):
    g = np.array(Image.open(path).convert('L'))
    g[:border, :] = 255
    g[-border:, :] = 255   # strip scan-border noise
    g[:, :border] = 255
    g[:, -border:] = 255
    m = g < 128
    ys, xs = np.where(m)
    return m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


# ---------- 3. Scaling (safe side = >=1px coverage counts as content) ----------
def scaled(mask, s):
    h, w = mask.shape
    nh, nw = max(1, round(h * s)), max(1, round(w * s))
    im = Image.fromarray((mask * 255).astype(np.uint8)).resize((nw, nh), Image.BILINEAR)
    return np.array(im) > 0


# ---------- 4. Placement feasibility (correlation = sliding collision test) ----------
def find_placement(allowed, kern):
    kh, kw = kern.shape
    H, W = allowed.shape
    if kh > H or kw > W:
        return None
    blocked = (~allowed).astype(np.float32 if HAVE_SCIPY else np.float64)
    if HAVE_SCIPY:
        conv = fftconvolve(blocked, kern[::-1, ::-1].astype(np.float32), mode='valid')
    else:
        conv = _fftconvolve_valid_numpy(blocked, kern[::-1, ::-1].astype(np.float64))
    ok = np.argwhere(conv < 0.5)   # top-left coords with zero overlap on forbidden pixels
    return tuple(ok[0]) if len(ok) else None


# ---------- 5. Maximum-scale search ----------
# Note (reference, translated verbatim): due to grid-alignment conditions,
# feasible(s) is NON-monotonic in s. So we scan downward from the upper bound,
# take the first feasible s found, then refine upward from there in fine steps.
def max_scale(allowed, content, floor=0.0, coarse=0.002, fine=0.0002):
    H, W = allowed.shape
    h, w = content.shape
    s_hi = min(H / h, W / w)
    s = s_hi
    best = None
    while s > max(floor, 0.01):
        p = find_placement(allowed, scaled(content, s))
        if p is not None:
            best = (s, p)
            break
        s -= coarse
    if best is None:
        return None
    # Refinement: re-check in fine steps just above the found s.
    t = best[0] + fine
    while t < min(best[0] + coarse, s_hi + 1e-9):
        p = find_placement(allowed, scaled(content, t))
        if p is not None:
            best = (t, p)
        t += fine
    return best


# ---------- 6. Full search over 8 orientations (4 rotations x 2 flips) ----------
def solve(allowed, content):
    best = None
    for flip in (False, True):
        m0 = content[:, ::-1] if flip else content
        for k in (0, 3, 1, 2):   # counter-clockwise 90 deg x k
            m = np.rot90(m0, k)
            floor = best['scale'] if best else 0.0   # no need to search below the known best
            r = max_scale(allowed, m, floor=floor)
            if r and (best is None or r[0] > best['scale']):
                best = dict(scale=r[0], rot=k * 90, flip=flip, pos=r[1], mask=m)
    return best


# ---------- 6b. Arbitrary-angle rotation search ----------
def rotate_mask(mask, deg):
    """Arbitrary-angle rotation (counter-clockwise, safe side = >=1px coverage
    counts as content) + bbox crop."""
    im = Image.fromarray((mask * 255).astype(np.uint8))
    r = np.array(im.rotate(deg, resample=Image.BILINEAR, expand=True)) > 0
    ys, xs = np.where(r)
    return r[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def solve_any_angle(allowed, content, coarse_deg=5.0, refine=((4.0, 1.0), (0.75, 0.25))):
    """Optimization extended to arbitrary rotation angles.
    Coarse-angle-step full sweep -> fine-step refinement near the best angle.
    Sped up via floor pruning (known-best scale so far)."""
    best = None

    def attempt(deg, flip, floor):
        m0 = content[:, ::-1] if flip else content
        m = rotate_mask(m0, deg)
        r = max_scale(allowed, m, floor=floor)
        if r:
            return dict(scale=r[0], deg=deg % 360, flip=flip, pos=r[1], mask=m)
        return None

    for flip in (False, True):
        for deg in np.arange(0.0, 360.0, coarse_deg):
            cand = attempt(deg, flip, best['scale'] if best else 0.0)
            if cand and (best is None or cand['scale'] > best['scale']):
                best = cand
    for span, step in refine:
        if best is None:
            break
        center, flip = best['deg'], best['flip']
        for deg in np.arange(center - span, center + span + 1e-9, step):
            cand = attempt(deg, flip, best['scale'])
            if cand and cand['scale'] > best['scale']:
                best = cand
    return best


# ---------- 7. Visualization ----------
def render_reference(allowed, cellset, best, out):
    """Reference-signature render: best = dict(scale=..., mask=..., pos=..., ...)."""
    H, W = allowed.shape
    img = Image.new('RGB', (W, H), (225, 225, 225))
    d = ImageDraw.Draw(img)
    for r, c in cellset:
        d.rectangle([c * CELL, r * CELL, (c + 1) * CELL - 1, (r + 1) * CELL - 1], fill=(255, 255, 255))
    pad_px = np.zeros((H, W), bool)
    for r, c in cellset:
        pad_px[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL] = ~allowed[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]
    a = np.array(img)
    a[pad_px] = (255, 190, 190)
    img = Image.fromarray(a)
    m = scaled(best['mask'], best['scale'])
    y, x = best['pos']
    a = np.array(img)
    a[y:y + m.shape[0], x:x + m.shape[1]][m] = (20, 20, 20)
    img = Image.fromarray(a)
    d = ImageDraw.Draw(img)
    for r, c in cellset:
        d.rectangle([c * CELL, r * CELL, (c + 1) * CELL - 1, (r + 1) * CELL - 1], outline=(120, 160, 220))
    img.save(out)


# =====================================================================
# numpy-only fftconvolve fallback (used only if scipy is unavailable).
# Same 'valid'-mode zero-padded FFT product as scipy.signal.fftconvolve;
# not a reference function, just an environment shim.
# =====================================================================
def _fftconvolve_valid_numpy(a, b):
    ah, aw = a.shape
    bh, bw = b.shape
    if bh > ah or bw > aw:
        return np.zeros((0, 0), dtype=np.float64)
    oh, ow = ah + bh - 1, aw + bw - 1
    fh = 1 << (oh - 1).bit_length()
    fw = 1 << (ow - 1).bit_length()
    fa = np.fft.rfft2(a, s=(fh, fw))
    fb = np.fft.rfft2(b, s=(fh, fw))
    full = np.fft.irfft2(fa * fb, s=(fh, fw))[:oh, :ow]
    vh, vw = ah - bh + 1, aw - bw + 1
    return full[bh - 1:bh - 1 + vh, bw - 1:bw - 1 + vw]


# =====================================================================
# Project adaptations -- NOT reference functions. These translate our
# actual asset formats (JSON "shape" cell lists, sprite-sheet SVG
# symbols) into the reference's data model (cellset / content mask),
# and implement CHECK/FIX report modes on top of the ported algorithm.
# =====================================================================

def build_region(cellset, align=None):
    """cellset: set of (row, col) owned cells (0-indexed, normalized to bbox).
    Returns allowed(bool HxW) at CELL px/cell, sized to the cellset's bbox.

    Thin adapter over build_region_from_layout: synthesizes an equivalent
    layout of full-cell/blank rows so the actual padding logic executed is
    the reference's build_region_from_layout, unchanged."""
    rows = max(r for r, c in cellset) + 1
    cols = max(c for r, c in cellset) + 1
    layout = []
    for r in range(rows):
        row_chars = ['□' if (r, c) in cellset else '　' for c in range(cols)]
        layout.append(''.join(row_chars))
    allowed, cellset_check = build_region_from_layout(layout, align)
    assert cellset_check == cellset
    return allowed


def centered_position(allowed, kern):
    """Placement-selection policy (adoption layer, REQ-0023; user-confirmed
    2026-07-03) -- NOT a reference function, does not touch find_placement.

    The reference's find_placement (tools/reference/fit_algorithm_reference.py)
    returns np.argwhere(conv<0.5)[0], i.e. the FIRST zero-overlap position in
    row-major scan order = the top-left-most feasible position. Reference's
    objective is max scale only; position among ties in the feasible set is
    left unspecified by design. Prescribed fixes built directly on that pos
    render left/top-aligned within their allowed region, which reads as
    visually off-center even though containment is satisfied.

    This function is an ADDITIVE step applied AFTER solve()/max_scale() have
    already fixed scale/rot/flip: it recomputes the exact same feasible-position
    set for the given (already oriented+scaled) kernel via the reference's own
    find_placement machinery (same conv/allowed semantics, just enumerating all
    matches instead of taking argwhere(...)[0]), then selects the position
    minimizing Euclidean distance from the placed kernel's center to the
    allowed-region's centroid. Deterministic tie-break: smallest y, then
    smallest x (matches the row-major convention of the reference's own
    argwhere ordering, so ties resolve predictably).

    allowed: bool HxW mask (reference build_region output).
    kern: bool mask, the exact oriented+scaled content kernel solve() found
        (i.e. scaled(rotated/flipped content, best_scale) -- same kernel that
        was passed into find_placement for the accepted solve() result).

    Returns (y, x) tuple, or None if no feasible position exists (should not
    happen if solve() already returned a result for this kernel, since the
    feasible set is guaranteed non-empty in that case).
    """
    kh, kw = kern.shape
    H, W = allowed.shape
    if kh > H or kw > W:
        return None
    blocked = (~allowed).astype(np.float32 if HAVE_SCIPY else np.float64)
    if HAVE_SCIPY:
        conv = fftconvolve(blocked, kern[::-1, ::-1].astype(np.float32), mode='valid')
    else:
        conv = _fftconvolve_valid_numpy(blocked, kern[::-1, ::-1].astype(np.float64))
    ok = np.argwhere(conv < 0.5)   # every zero-overlap top-left coordinate, row-major order
    if len(ok) == 0:
        return None

    # Allowed-region centroid (of the TRUE allowed mask, not just its bbox --
    # matches "allowed-region centroid" per the policy spec).
    ys_allowed, xs_allowed = np.where(allowed)
    cy = ys_allowed.mean()
    cx = xs_allowed.mean()

    best_pos = None
    best_dist2 = None
    for y, x in ok:
        # center of the kernel if placed with top-left at (y, x)
        py = y + kh / 2.0
        px = x + kw / 2.0
        dist2 = (py - cy) ** 2 + (px - cx) ** 2
        if (best_dist2 is None or dist2 < best_dist2 or
                (dist2 == best_dist2 and (y, x) < best_pos)):
            best_dist2 = dist2
            best_pos = (int(y), int(x))
    return best_pos


def shape_to_cellset(shape):
    """shape: [[row,col], ...] -- REQ-0029: this MUST match the engine's own
    convention, which is the single source of truth for shape coordinates.
    See mock-src/engine.js's shapeInfo()/cellsOf()/bpCells() (each destructures
    offset tuples as `([r,c]) => ...`, i.e. first=row, second=col) and
    scenario.json placements (blade cell=[1,1], hilt cell=[3,1], stacked
    vertically one row apart at the same column -- confirmed against
    assembly()'s h.cell[0]===bottom[0]+1 check). Before REQ-0029 this function
    incorrectly read shape tuples as [col,row] (a REQ-0019 orchestrator guess
    that was never verified against the engine), which silently transposed
    every non-square-bbox shape mask AND some square-bbox asymmetric cell
    patterns (e.g. hoarfrost_creep). Returns normalized {(row,col)}."""
    rows = [r for r, c in shape]
    cols = [c for r, c in shape]
    r0, c0 = min(rows), min(cols)
    return {(r - r0, c - c0) for r, c in shape}, (max(rows) - r0 + 1), (max(cols) - c0 + 1)


def extract_symbol(sprite_root, icon_id):
    """Find <symbol id=icon_id> anywhere in the (possibly multi-<svg>) sprite tree.
    Returns (symbol_element, viewBox tuple(minx,miny,w,h)) or (None, None)."""
    for sym in sprite_root.iter("{%s}symbol" % SVG_NS):
        if sym.get("id") == icon_id:
            vb = sym.get("viewBox")
            if vb is None:
                return sym, None
            parts = [float(x) for x in vb.replace(",", " ").split()]
            return sym, tuple(parts)
    return None, None


def rasterize_symbol(sym, viewbox, out_w, out_h):
    """Render the symbol's inner content standalone at out_w x out_h px,
    transparent background, mapped from its own viewBox stretched exactly to
    out_w/out_h (callers should pass an out_w/out_h matching the viewBox aspect
    for a faithful 'as rendered in the shape' check)."""
    minx, miny, w, h = viewbox
    inner = "".join(
        ET.tostring(child, encoding="unicode") for child in sym
    )
    svg_doc = (
        f'<svg xmlns="{SVG_NS}" viewBox="{minx} {miny} {w} {h}" '
        f'width="{out_w}" height="{out_h}" preserveAspectRatio="none">{inner}</svg>'
    )
    png_bytes = cairosvg.svg2png(
        bytestring=svg_doc.encode("utf-8"),
        output_width=out_w,
        output_height=out_h,
        background_color="rgba(0,0,0,0)",
    )
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    arr = np.array(img)
    alpha = arr[:, :, 3]
    return alpha > 0


def crop_to_content(mask):
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return mask
    return mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def render(allowed, cellset, mask, scale, pos, out_path):
    """Adapter over render_reference for our unpacked-argument call sites."""
    best = dict(mask=mask, scale=scale, pos=pos)
    render_reference(allowed, cellset, best, out_path)


def load_sprite_tree(path):
    """Our sprite files are multiple concatenated <svg>...</svg> roots (valid as
    a browser fragment via consecutive <use> resolution, but NOT well-formed
    single-document XML). Wrap them in a synthetic root before parsing so
    ElementTree can traverse all <symbol> elements regardless of which
    top-level <svg> block they live in."""
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    wrapped = f'<root xmlns:_wrap="_wrap">{raw}</root>'
    try:
        root = ET.fromstring(wrapped)
    except ET.ParseError as e:
        raise SystemExit(f"Failed to parse sprite '{path}' even after multi-root wrapping: {e}")
    return root


def load_defs(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "entries" in data:
        return data["entries"]
    raise ValueError(f"Unrecognized defs format in {path}")


def check_icon(sprite_root, entry, render_dir=None, tag=""):
    icon_id = entry.get("icon")
    shape = entry.get("shape")
    eid = entry.get("id", icon_id)

    if not shape:
        return dict(id=eid, icon=icon_id, status="SKIPPED", reason="no shape field (socket item / non-cell item)")

    sym, viewbox = extract_symbol(sprite_root, icon_id)
    if sym is None:
        return dict(id=eid, icon=icon_id, status="SKIPPED", reason="icon symbol not found in sprite")

    cellset, rows, cols = shape_to_cellset(shape)
    allowed = build_region(cellset, entry.get("align"))
    H, W = allowed.shape

    vb_w, vb_h = viewbox[2], viewbox[3]
    shape_aspect = cols / rows
    vb_aspect = vb_w / vb_h
    aspect_mismatch = abs(shape_aspect - vb_aspect) > 0.02 * max(shape_aspect, vb_aspect)

    if aspect_mismatch:
        r = dict(
            id=eid, icon=icon_id, status="FAIL", overflow_px=None,
            reason=(f"STRUCTURAL: viewBox aspect {vb_w:.0f}x{vb_h:.0f} does not match "
                    f"shape bbox {cols}x{rows} cells -- requires 90-degree rotation, "
                    f"not fixable by translate/scale alone"),
            coverage=None, escalate="rotation_required", violated_faces=[],
        )
        return r

    content_natural = rasterize_symbol(sym, viewbox, W, H)
    overflow_mask = content_natural & (~allowed)
    overflow_px = int(overflow_mask.sum())

    violated_faces = []
    for (r, c) in sorted(cellset):
        cell_overflow = overflow_mask[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]
        if not cell_overflow.any():
            continue
        faces = []
        if cell_overflow[:PAD, :].any():
            faces.append("top")
        if cell_overflow[-PAD:, :].any():
            faces.append("bottom")
        if cell_overflow[:, :PAD].any():
            faces.append("left")
        if cell_overflow[:, -PAD:].any():
            faces.append("right")
        interior_check = cell_overflow.copy()
        interior_check[:PAD, :] = False
        interior_check[-PAD:, :] = False
        interior_check[:, :PAD] = False
        interior_check[:, -PAD:] = False
        deep = bool(interior_check.any())
        violated_faces.append(dict(cell=[c, r], faces=faces, deep_overflow=deep))

    coverage = {}
    for (r, c) in sorted(cellset):
        cell_content = content_natural[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]
        pct = 100.0 * cell_content.sum() / (CELL * CELL)
        coverage[f"({c},{r})"] = round(pct, 1)

    # Verdict is OVERFLOW-ONLY (user ruling: "Fixes execute because of OVERFLOW,
    # not because of per-cell coverage"). `coverage` above is informational only
    # and must NEVER affect `status`, `any_fail` (see main()), or fix-triggering.
    status = "PASS" if overflow_px == 0 else "FAIL"

    # ART-WARN: informational-only flag for cells whose content coverage is
    # below the 20% floor. This does NOT affect status/exit-code/fix-triggering
    # -- it exists purely so low-coverage art can be surfaced to artists.
    art_warn_cells = [key for key, pct in coverage.items() if pct < 20.0]

    result = dict(
        id=eid, icon=icon_id, status=status, overflow_px=overflow_px,
        violated_faces=violated_faces, coverage=coverage,
        art_warn_cells=art_warn_cells,
    )

    if render_dir:
        import os
        os.makedirs(render_dir, exist_ok=True)
        out_path = os.path.join(render_dir, f"{tag}{eid}.png")
        render(allowed, cellset, content_natural, 1.0, (0, 0), out_path)
        result["render"] = out_path

    return result


def fix_icon(sprite_root, entry, any_angle=False):
    icon_id = entry.get("icon")
    shape = entry.get("shape")
    eid = entry.get("id", icon_id)
    if not shape:
        return dict(id=eid, icon=icon_id, status="SKIPPED")
    sym, viewbox = extract_symbol(sprite_root, icon_id)
    if sym is None:
        return dict(id=eid, icon=icon_id, status="SKIPPED")

    cellset, rows, cols = shape_to_cellset(shape)
    allowed = build_region(cellset, entry.get("align"))
    H, W = allowed.shape

    # REQ-0029 fixer-policy guard (art_golden v3.3, binding: aspect ratio is
    # inviolable; "never fix by squeezing"). rasterize_symbol() below renders
    # the symbol's own viewBox stretched to exactly W x H (see its docstring:
    # "mapped from its own viewBox stretched exactly to out_w/out_h") --
    # i.e. if the symbol's viewBox aspect does not match the shape bbox
    # aspect, this stretch step ITSELF silently squeezes/distorts the art
    # before solve() ever runs, which would let solve() report a deceptively
    # clean rot=0 "fix" for what is actually a structural aspect violation.
    # check_icon() already flags this as a structural FAIL; fix_icon() must
    # refuse to proceed past it too, for the exact same reason -- this is a
    # code-level guard (fix_icon simply cannot produce a SOLVED result for an
    # aspect-mismatched symbol), not just a comment.
    vb_w, vb_h = viewbox[2], viewbox[3]
    shape_aspect = cols / rows
    vb_aspect = vb_w / vb_h
    if abs(shape_aspect - vb_aspect) > 0.02 * max(shape_aspect, vb_aspect):
        return dict(
            id=eid, icon=icon_id, status="FAIL",
            reason=(f"ESCALATION: STRUCTURAL viewBox aspect {vb_w:.0f}x{vb_h:.0f} does not "
                    f"match shape bbox {cols}x{rows} cells -- fix_icon refuses to rasterize "
                    f"(would silently squeeze/distort per art_golden v3.3). Fix the shape or redraw."),
            escalate="rotation_required",
        )

    content_natural = rasterize_symbol(sym, viewbox, W, H)
    content = crop_to_content(content_natural)
    if content.size == 0:
        return dict(id=eid, icon=icon_id, status="EMPTY_CONTENT")

    if any_angle:
        best = solve_any_angle(allowed, content)
        if best is None:
            return dict(id=eid, icon=icon_id, status="INFEASIBLE")
        # REQ-0029 fixer-policy guard (art_golden v3.3, binding): rotation and
        # flip are NEVER an allowed fix. If solve_any_angle()'s best-scoring
        # placement requires a nonzero rotation or a flip, this is a
        # structural aspect/shape mismatch -- ESCALATE ("fix the shape or
        # redraw"), do not synthesize a rotate/flip transform. This check is
        # structural (guards the return value itself), not a policy note --
        # no caller of fix_icon can get a rotate/flip SOLVED result out of it.
        if best["deg"] % 360 != 0 or best["flip"]:
            return dict(
                id=eid, icon=icon_id, status="FAIL",
                reason=(f"ESCALATION: solve_any_angle() best fit requires rotation="
                        f"{best['deg']:.2f}deg flip={best['flip']} -- rotation/flip is "
                        f"never an applied fix (art_golden v3.3). Fix the shape or redraw."),
                escalate="rotation_or_flip_required_by_solver",
                rotation_deg=round(best["deg"], 2), flip=best["flip"],
                scale_pct=round(best["scale"] * 100, 2), any_angle=True,
            )
        placed_kernel = scaled(best["mask"], best["scale"])
        pos_first_yx = tuple(best["pos"])
        pos_centered_yx = centered_position(allowed, placed_kernel) or pos_first_yx
        return dict(
            id=eid, icon=icon_id, status="SOLVED",
            scale_pct=round(best["scale"] * 100, 2),
            rotation_deg=round(best["deg"], 2),
            flip=best["flip"],
            pos_xy=[int(pos_centered_yx[1]), int(pos_centered_yx[0])],
            pos_first_xy=[int(pos_first_yx[1]), int(pos_first_yx[0])],
            pos_centered_xy=[int(pos_centered_yx[1]), int(pos_centered_yx[0])],
            content_size_px=[content.shape[1], content.shape[0]],
            mask=best["mask"], allowed=allowed, cellset=cellset,
            any_angle=True,
        )

    best = solve(allowed, content)
    if best is None:
        return dict(id=eid, icon=icon_id, status="INFEASIBLE")

    # REQ-0029 fixer-policy guard (art_golden v3.3, binding: "Fit fixes may
    # translate, uniformly scale ... never distort"; "the art is NOT rotated
    # ... Fixer rotation prescriptions ... are ESCALATIONS, never
    # auto-applied"). solve() searches all 4x90-degree rotations and both
    # flips as part of its max-scale search (that part of the ported
    # algorithm is untouched, see module docstring's trust directive), but
    # THIS caller must never turn a nonzero-rotation or flipped winner into
    # an applied SOLVED fix. This is a structural guard on fix_icon's return
    # value -- any caller (build_fit_report.py, this file's own `fix` CLI
    # mode) gets an escalation dict instead of transform numbers to apply.
    if best["rot"] % 360 != 0 or best["flip"]:
        return dict(
            id=eid, icon=icon_id, status="FAIL",
            reason=(f"ESCALATION: solve() best fit requires rotation={best['rot']}deg "
                    f"flip={best['flip']} -- rotation/flip is never an applied fix "
                    f"(art_golden v3.3). Fix the shape or redraw."),
            escalate="rotation_or_flip_required_by_solver",
            rotation_deg=best["rot"], flip=best["flip"],
            scale_pct=round(best["scale"] * 100, 2), any_angle=False,
        )

    # Placement-selection policy (REQ-0023): solve() itself is untouched and
    # still returns the reference's top-left-most feasible position
    # (best["pos"] = pos_first below). The adoption layer additionally picks
    # the center-most feasible position for the SAME scale/rot/flip kernel,
    # and that centered position is what fix application/report rendering use.
    placed_kernel = scaled(best["mask"], best["scale"])
    pos_first_yx = tuple(best["pos"])
    pos_centered_yx = centered_position(allowed, placed_kernel) or pos_first_yx

    return dict(
        id=eid, icon=icon_id, status="SOLVED",
        scale_pct=round(best["scale"] * 100, 2),
        rotation_deg=best["rot"],
        flip=best["flip"],
        pos_xy=[int(pos_centered_yx[1]), int(pos_centered_yx[0])],
        pos_first_xy=[int(pos_first_yx[1]), int(pos_first_yx[0])],
        pos_centered_xy=[int(pos_centered_yx[1]), int(pos_centered_yx[0])],
        content_size_px=[content.shape[1], content.shape[0]],
        mask=best["mask"], allowed=allowed, cellset=cellset,
        any_angle=False,
    )


def fix_content_image(image_path, layout_rows, any_angle=False):
    """Reference raster-input path: build a region from a literal layout (rows
    of full-cell/blank cells, matching the reference's own __main__ example) and
    solve against an image file's content mask (reference load_content)."""
    allowed, cellset = build_region_from_layout(layout_rows)
    content = load_content(image_path)
    if any_angle:
        best = solve_any_angle(allowed, content)
    else:
        best = solve(allowed, content)
    return allowed, cellset, content, best


def format_check_line(r):
    if r["status"] == "SKIPPED":
        return f"SKIPPED {r['id']:24s} icon={str(r['icon']):24s} reason={r.get('reason','')}"
    cov = r.get("coverage") or {}
    cov_vals = list(cov.values())
    cov_str = f"{min(cov_vals):.1f}-{max(cov_vals):.1f}%" if cov_vals else "n/a"
    # NOTE: r["status"] (the PASS/FAIL word printed here) is overflow-only and
    # is never altered by the ART-WARN suffix below -- ART-WARN is strictly
    # informational (per-cell coverage <20%), it must never read as a failure.
    line = f"{r['status']:4s}    {r['id']:24s} icon={str(r['icon']):24s} overflow_px={r.get('overflow_px')} coverage={cov_str}"
    if r["status"] == "FAIL":
        if r.get("escalate"):
            line += f"  ESCALATE({r['escalate']}): {r.get('reason','')}"
        else:
            viol = r.get("violated_faces", [])
            faces_summary = "; ".join(
                f"cell{v['cell']}:{','.join(v['faces'])}{'[DEEP]' if v['deep_overflow'] else ''}"
                for v in viol
            )
            line += f"  violations: {faces_summary}"
    art_warn = r.get("art_warn_cells") or []
    if art_warn:
        line += f"  [ART-WARN low-coverage cells (informational only, <20%): {', '.join(art_warn)}]"
    return line


def format_fix_line(r):
    if r["status"] in ("SKIPPED", "EMPTY_CONTENT", "INFEASIBLE"):
        return f"{r['status']:10s} {r['id']:24s} icon={str(r['icon']):24s}"
    if r["status"] == "FAIL" and r.get("escalate") == "rotation_required":
        # REQ-0029 fixer-policy guard: symbol's own viewBox aspect doesn't
        # match its shape bbox aspect -- fix_icon refused to even rasterize
        # (would silently squeeze/distort). Structural, needs shape-or-redraw.
        return (f"ESCALATE   {r['id']:24s} icon={str(r['icon']):24s} "
                f"reason={r.get('reason','')}")
    if r["status"] == "FAIL" and r.get("escalate") == "rotation_or_flip_required_by_solver":
        # REQ-0029 fixer-policy guard: solve()/solve_any_angle() found a
        # rotate/flip-only improvement, which is never an applied fix
        # (art_golden v3.3) -- surfaced as an escalation, not a transform.
        return (f"ESCALATE   {r['id']:24s} icon={str(r['icon']):24s} "
                f"rot={r['rotation_deg']} flip={r['flip']} scale={r['scale_pct']:.2f}% "
                f"reason={r.get('reason','')}")
    unit = "deg" if r.get("any_angle") else "deg(90-step)"
    pos_first = r.get("pos_first_xy", r["pos_xy"])
    pos_centered = r.get("pos_centered_xy", r["pos_xy"])
    return (f"SOLVED     {r['id']:24s} icon={str(r['icon']):24s} "
            f"scale={r['scale_pct']:.2f}% rot={r['rotation_deg']}{unit} flip={r['flip']} "
            f"pos_first(x,y)={pos_first} pos_centered(x,y)={pos_centered} "
            f"content_px={r['content_size_px']}")


def main():
    ap = argparse.ArgumentParser(description="Icon<->Cell fit check/fix tool (REQ-0019/REQ-0020)")
    ap.add_argument("mode", choices=["check", "fix"])
    ap.add_argument("sprite", nargs="?", help="path to sprite SVG")
    ap.add_argument("defs", nargs="*", help="one or more defs JSON files")
    ap.add_argument("--out", help="write report text to this file (also prints to stdout)")
    ap.add_argument("--render-dir", help="if set (check mode), write per-icon PNG visualizations here")
    ap.add_argument("--tag", default="", help="filename prefix for rendered PNGs (e.g. 'before_' / 'after_')")
    ap.add_argument("--any-angle", action="store_true",
                    help="fix mode: use solve_any_angle (arbitrary-angle search) instead of solve (4x90 deg)")
    ap.add_argument("--content-image", help="fix mode: raster image path (reference load_content path) "
                                             "instead of an SVG sprite/defs symbol")
    ap.add_argument("--layout", help="fix mode with --content-image: comma-separated layout rows, "
                                      "e.g. \"□ □,□□\" ('□'=fit cell, anything else=blank)")
    args = ap.parse_args()

    if args.content_image:
        if args.mode != "fix":
            raise SystemExit("--content-image is only supported in fix mode")
        if not args.layout:
            raise SystemExit("--content-image requires --layout")
        layout_rows = args.layout.split(",")
        allowed, cellset, content, best = fix_content_image(args.content_image, layout_rows, any_angle=args.any_angle)
        if best is None:
            report = "INFEASIBLE (no placement found for any orientation/scale)"
        else:
            if args.any_angle:
                report = (f"SOLVED scale={best['scale']*100:.2f}% deg={best['deg']:.2f} "
                          f"flip={best['flip']} pos(x,y)=({best['pos'][1]},{best['pos'][0]}) "
                          f"content_px=({content.shape[1]},{content.shape[0]})")
            else:
                report = (f"SOLVED scale={best['scale']*100:.2f}% rot={best['rot']}deg "
                          f"flip={best['flip']} pos(x,y)=({best['pos'][1]},{best['pos'][0]}) "
                          f"content_px=({content.shape[1]},{content.shape[0]})")
        print(report)
        if args.out:
            with open(args.out, "a", encoding="utf-8") as f:
                f.write(report + "\n")
        sys.exit(0)

    if not args.sprite or not args.defs:
        raise SystemExit("sprite and defs are required unless --content-image is used")

    sprite_root = load_sprite_tree(args.sprite)

    all_entries = []
    for defs_path in args.defs:
        entries = load_defs(defs_path)
        for e in entries:
            e["_source"] = defs_path
        all_entries.extend(entries)

    lines = []
    any_fail = False

    if args.mode == "check":
        for e in all_entries:
            r = check_icon(sprite_root, e, render_dir=args.render_dir, tag=args.tag)
            lines.append(format_check_line(r))
            if r["status"] == "FAIL":
                any_fail = True
    else:
        for e in all_entries:
            r = fix_icon(sprite_root, e, any_angle=args.any_angle)
            lines.append(format_fix_line(r))

    report = "\n".join(lines)
    print(report)
    if args.out:
        with open(args.out, "a", encoding="utf-8") as f:
            f.write(report + "\n")

    if args.mode == "check" and any_fail:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
