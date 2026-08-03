'use strict';
// server/services/art_sizing.cjs -- REQ-0151 § Sizing law.
//
// Resolution is DERIVED from kind + shape and is READ-ONLY in the UI (the
// user never types a width/height). This module is the single source of
// that derivation, mirroring tools/art_style.py's gen_size() /16-snap math
// exactly (px_per_cell is a resolution knob, only the aspect ratio is a
// law) -- kept as a small pure JS port rather than shelling to Python so
// the create path and the G2 unit test can call it directly.
//
//   po      -> bounding box of the active cells in the 5x5 mask, at
//              256 px/cell, /16-snapped.
//   si      -> locked 256x256 (no shape; user ruling 8).
//   monster -> w x h grid (each 1..12) at 128 px/cell, /16-snapped.
//   unit    -> locked 512x512.
//   bpskin  -> locked 1024x1024.
//
// Ratified examples this MUST reproduce (REQ-0151 § Sizing law, gate G2):
//   sword 3 vertical cells -> 256x768   shield 2x2 -> 512x512
//   large shield 2x3 -> 512x768         potion 1x2 -> 256x512
//   goblin 3x4 -> 384x512               chimera 6x4 -> 768x512
//   ancient dragon 10x10 -> 1280x1280   any si -> 256x256

const KINDS = ['po', 'si', 'unit', 'monster', 'bpskin', 'custom', 'gimic', 'vfx', 'skill_icon']; // REQ-0211: gimic == monster; REQ-0280/0264: vfx (ray/hit VFX); REQ-0292: skill_icon (256x256 still, no shape)

// REQ-0179: ComfyUI's flux2 latent (EmptyFlux2LatentImage) bounds -- width/height
// min 16, max nodes.MAX_RESOLUTION, step 16 (latent = [.., height//16, width//16]).
// A `custom` artwork's operator-SET resolution is validated against exactly these.
const MAX_RESOLUTION = 16384;

/** /16 snap, floor of 16 -- a latent cannot be 756 px tall (that is why
 * the user's 256x756 sword became 256x768). Matches art_style.gen_size. */
function snap16(v) {
  return Math.max(16, Math.round(v / 16) * 16);
}

/** REQ-0179: clamp a /16-snapped custom dimension to ComfyUI's latent max. */
function clampRes(v) { return Math.min(MAX_RESOLUTION, v); }

/** Generation size for a cell footprint at px_per_cell. Aspect ratio is
 * the binding part; the /16 snap keeps it a legal latent size. */
function genSize(cellsW, cellsH, pxPerCell) {
  return { width: snap16(cellsW * pxPerCell), height: snap16(cellsH * pxPerCell) };
}

/** Bounding box (in cells) of the active cells of a 5x5 boolean mask.
 * `mask` is a 5x5 array of booleans (row-major). Throws on an empty or
 * malformed mask -- a po artwork with no active cell has no size. */
function poBoundingBox(mask) {
  if (!Array.isArray(mask) || mask.length !== 5 || mask.some((r) => !Array.isArray(r) || r.length !== 5)) {
    throw sizingError('po shape must be a 5x5 boolean mask');
  }
  let minR = 5, maxR = -1, minC = 5, maxC = -1;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (mask[r][c]) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR < 0) throw sizingError('po shape must have at least one active cell');
  return { w: maxC - minC + 1, h: maxR - minR + 1 };
}

function sizingError(msg) {
  const e = new Error(msg);
  e.code = 'BAD_SHAPE';
  return e;
}

/** Derive {width,height} for an artwork from its kind + shape.
 * `shape` is: po -> {mask:5x5 bool}; monster -> {w,h}; si/unit/bpskin -> null. */
function deriveSize(kind, shape) {
  switch (kind) {
    case 'po': {
      const bb = poBoundingBox(shape && shape.mask);
      return genSize(bb.w, bb.h, 256);
    }
    case 'si':
      return { width: 256, height: 256 };
    // REQ-0292: a skill_icon is a LOCKED 256x256 still (an ability icon, sized
    // exactly like si -- no shape, no role). One kind, one size.
    case 'skill_icon':
      return { width: 256, height: 256 };
    // REQ-0211: a gimic artwork is sized IDENTICALLY to a monster (user directive):
    // a w x h cell grid (each 1..12) at 128 px/cell. Stacked case label, one body.
    case 'gimic':
    case 'monster': {
      const w = shape && shape.w, h = shape && shape.h;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || w > 12 || h < 1 || h > 12) {
        throw sizingError('monster shape must be {w,h} with each in 1..12');
      }
      return genSize(w, h, 128);
    }
    case 'unit':
      return { width: 512, height: 512 };
    case 'bpskin':
      return { width: 1024, height: 1024 };
    case 'custom': {
      // REQ-0179: operator-SET resolution (NOT derived from a shape law). The
      // artwork's shape carries {width,height}; each is /16-snapped and clamped
      // to ComfyUI's [16, MAX_RESOLUTION] flux2-latent bounds.
      const w = shape && shape.width, h = shape && shape.height;
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) {
        throw sizingError('custom shape must be {width,height} positive integers');
      }
      return { width: clampRes(snap16(w)), height: clampRes(snap16(h)) };
    }
    case 'vfx': {
      // REQ-0280 / REQ-0264 s8.1: ONE kind, role-discriminated (shape.role).
      // LOCKED sizes -- like si/unit/bpskin; both /16-legal (256/16, 64/16) so
      // snap16 is a no-op and the law is exact. ray is a 4:1 strip tiled
      // 1-tile-per-diagonal along the path; hit is si's 256x256 verbatim.
      const role = shape && shape.role;
      if (role === 'ray') return { width: 256, height: 64 };
      if (role === 'hit') return { width: 256, height: 256 };
      throw sizingError("vfx shape must be {role:'ray'|'hit'}");
    }
    default:
      throw sizingError('unknown kind: ' + kind);
  }
}

module.exports = { KINDS, snap16, genSize, poBoundingBox, deriveSize, MAX_RESOLUTION };
