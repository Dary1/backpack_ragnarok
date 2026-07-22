// client/src/board/skin/bpSkinTexture.ts -- REQ-0266 (item 23b). The bridge
// between the PURE compositor and PixiJS: decode a fill raster, composite once
// per (cell-set, skin), upload as a Texture, hand back a positioned Sprite.
// It lives here, not in BoardRenderer.ts: that file is hot, 1664 lines, and its
// interaction invariants are pinned by e2e specs -- and none of this is renderer
// logic. composite.ts stays pure and Node-callable for the three offline
// harnesses, so DECODING is this module's job; the compositor sees only pixels.
// ONLY A SKIN WITH REAL ART PAINTS -- bpSkinSprite() returns null for any def
// that does not declare art.fill_texture. This is load-bearing, not an
// optimisation: `neutral` is ALWAYS registered (skinRegistry) so resolveBpSkin
// lands on a def for EVERY BP on both boards, every derived unit_skin def whose
// artwork is not adopted inherits neutral's palette, and a composite body is
// OPAQUE and parented above gBase. Without this guard every BP was painted flat
// #2b3240, hiding the per-BP colour grid tint -- the one cue that tells one BP
// from another -- and all but the outer half of its 3px coloured outline. The
// resolver is deliberately untouched: it still REPORTS `neutral` (or `set`)
// honestly, it just no longer causes a paint. See composite.ts's
// declaresFillTexture(), which is the single executable definition of "has art".
// Decode is ASYNC and render() is not, so a skinned BP paints NOTHING on the
// frame that starts the decode -- it is pixel-identical to an unskinned BP --
// and onReady() re-renders once the pixels are in. A raster that 404s or fails
// to decode is cached as a permanent miss and the BP simply stays unskinned:
// missing art never blocks a draw, and never degrades one either.
// REQ-0291: when the def carries a frame band (def.art.frame_band_px > 0, fed
// from the artwork's edge_padding), decode() slices the SOURCE image ONCE into
// three pieces -- an INTERIOR-only fill (inset by the band, so the authored
// frame no longer pollutes the tile) and two directional welt strips cut from
// the top and left padding runs -- then discards the 4MB source. The strips
// travel to compositeSkin, which cuts the welt ring from them (see composite.ts
// FrameStrips). Absent a band, decode() behaves exactly as before (full-tile
// downsample, no strips) and the composite is byte-identical to pre-REQ-0291.
import { Sprite, Texture } from 'pixi.js';
import { CELL, PAD } from '../geom';
import { compositeSkin, declaresFillTexture, LAYER, type FillRaster, type FrameStrips } from './composite';
import type { BpSkinDef } from './skinRegistry';
import type { Cell } from './autotile';

/** One cell of padding, so rounding at the outer boundary is computed against
 * real background rather than the array edge. */
const MARGIN = 1;
/** Tiles are downsampled to two cells square: a bpskin artwork is authored at
 * 1024x1024 (art.cjs locks that), and tiled 1:1 at CELL a BP would show a
 * fraction of the image and read as noise rather than as a material. */
const TILE_PX = CELL * 2;
/** A composite costs a distance transform and a BP rotation changes its cell
 * set, so the cache needs a cap. Wholesale eviction is fine -- the next render
 * rebuilds whatever is actually on screen. */
const MAX_TEXTURES = 64;

/** REQ-0291: the fill raster plus (when a frame band is authored) the two welt
 * strips sliced from the same source. */
interface DecodedSkin { fill: FillRaster; strips: FrameStrips | null; }
// Keyed by url + frame band, so a def that toggles its band never reuses a stale
// decode (a full-tile fill vs an interior-only one are different pixels).
const decoded = new Map<string, DecodedSkin | null>();
const pending = new Set<string>();
const textures = new Map<string, Texture>();

function surface(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv.getContext('2d', { willReadFrequently: true });
}

/** The frame band in SOURCE px, rounded; 0 when the def declares none. */
function bandPxOf(def: BpSkinDef): number {
  const b = def.art && typeof def.art.frame_band_px === 'number' ? def.art.frame_band_px : 0;
  return b > 0 ? Math.round(b) : 0;
}
/** Clamp the band so the interior inset and the strip slices stay inside the
 * source (a pathological edge_padding must never produce a negative rect). */
function safeBand(bandPx: number, iw: number, ih: number): number {
  return Math.max(0, Math.min(Math.round(bandPx), Math.floor(Math.min(iw, ih) / 2) - 1));
}

/** The INTERIOR fill, downsampled to TILE_PX^2. With a band, the source is inset
 * by the band on all four sides first, so the authored frame is excluded from
 * the tile; without one, the whole source is used (pre-REQ-0291 behaviour). */
function sliceFill(img: HTMLImageElement, bandPx: number): FillRaster | null {
  const ctx = surface(TILE_PX, TILE_PX);
  if (!ctx) return null;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const b = bandPx > 0 ? safeBand(bandPx, iw, ih) : 0;
  if (b > 0 && iw > 2 * b && ih > 2 * b) ctx.drawImage(img, b, b, iw - 2 * b, ih - 2 * b, 0, 0, TILE_PX, TILE_PX);
  else ctx.drawImage(img, 0, 0, TILE_PX, TILE_PX);
  const px = ctx.getImageData(0, 0, TILE_PX, TILE_PX);
  return { width: TILE_PX, height: TILE_PX, rgba: px.data };
}

/** Two directional welt strips at NATIVE resolution: stripH from the top-edge
 * run (rows 0..band x the middle 30%..70% of columns), stripV from the left-edge
 * run (cols 0..band x the middle 30%..70% of rows) -- exactly welt_strips() in
 * tools/bpskin_compose.py with the full square as silhouette (top=0, left=0). */
function sliceStrips(img: HTMLImageElement, bandPx: number): FrameStrips | null {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const b = safeBand(bandPx, iw, ih);
  if (!(b > 0)) return null;
  const cx0 = Math.floor(iw * 0.30), cx1 = Math.floor(iw * 0.70), hw = cx1 - cx0;
  const ry0 = Math.floor(ih * 0.30), ry1 = Math.floor(ih * 0.70), vh = ry1 - ry0;
  if (!(hw > 0) || !(vh > 0)) return null;
  const hctx = surface(hw, b); const vctx = surface(b, vh);
  if (!hctx || !vctx) return null;
  hctx.drawImage(img, cx0, 0, hw, b, 0, 0, hw, b);
  vctx.drawImage(img, 0, ry0, b, vh, 0, 0, b, vh);
  const hp = hctx.getImageData(0, 0, hw, b);
  const vp = vctx.getImageData(0, 0, b, vh);
  return { stripH: { width: hw, height: b, rgba: hp.data }, stripV: { width: b, height: vh, rgba: vp.data }, frameBandPx: b };
}

function decode(url: string, bandPx: number, key: string, onReady?: () => void): void {
  if (decoded.has(key) || pending.has(key) || typeof document === 'undefined') return;
  pending.add(key);
  const img = new Image();
  img.onload = () => {
    pending.delete(key);
    try {
      const fill = sliceFill(img, bandPx);
      if (!fill) { decoded.set(key, null); return; }
      const strips = bandPx > 0 ? sliceStrips(img, bandPx) : null;
      decoded.set(key, { fill, strips });
      if (onReady) onReady();
    } catch (err) {
      // Reading pixels back can throw. Not an error path: cache the miss and
      // keep the palette-procedural body.
      console.warn('bpSkinTexture: could not read ' + url, err);
      decoded.set(key, null);
    }
  };
  img.onerror = () => { pending.delete(key); decoded.set(key, null); }; // permanent miss
  img.src = url;
}

/** The decoded (fill + strips) for a def, or null while it loads / if it never
 * will. Cache key folds in the frame band (REQ-0291). */
function decodedFor(def: BpSkinDef, onReady?: () => void): DecodedSkin | null {
  const url = def.art ? def.art.fill_texture : null;
  if (typeof url !== 'string' || !url) return null;
  const bandPx = bandPxOf(def);
  const key = url + '|b' + bandPx;
  if (!decoded.has(key)) { decode(url, bandPx, key, onReady); return null; }
  return decoded.get(key) || null;
}

/** The decoded fill tile for a def (compat shim; the guard reads this). */
export function fillRasterFor(def: BpSkinDef, onReady?: () => void): FillRaster | null {
  const d = decodedFor(def, onReady);
  return d ? d.fill : null;
}

/** Texture for one (cell-set, skin). Pixels outside the silhouette are made
 * fully TRANSPARENT: the compositor paints a solid background there, which is
 * right for an offline PNG and wrong for a board, where the grid must show. */
function textureFor(cells: ReadonlyArray<Cell>, def: BpSkinDef, raster: FillRaster, strips: FrameStrips | null): { tex: Texture; r0: number; c0: number } | null {
  if (typeof document === 'undefined' || cells.length === 0) return null;
  const key = def.id + '|b' + bandPxOf(def) + '|r|' + cells.map((c) => c[0] + ',' + c[1]).sort().join(';');
  const comp = compositeSkin(cells, def, def.palette.canvas || '#000000', { cellPx: CELL, margin: MARGIN }, raster, strips);
  const hit = textures.get(key);
  if (hit) return { tex: hit, r0: comp.r0, c0: comp.c0 };
  const ctx = surface(comp.width, comp.height);
  if (!ctx) return null;
  const out = ctx.createImageData(comp.width, comp.height);
  for (let i = 0; i < comp.width * comp.height; i++) {
    const o = i * 4;
    out.data[o] = comp.rgba[o]; out.data[o + 1] = comp.rgba[o + 1]; out.data[o + 2] = comp.rgba[o + 2];
    out.data[o + 3] = comp.layer[i] === LAYER.bg ? 0 : 255;
  }
  ctx.putImageData(out, 0, 0);
  const tex = Texture.from(ctx.canvas);
  if (textures.size >= MAX_TEXTURES) { for (const t of textures.values()) t.destroy(true); textures.clear(); }
  textures.set(key, tex);
  return { tex, r0: comp.r0, c0: comp.c0 };
}

/** A board-positioned Sprite of the BP body wearing `def`, or null when there is
 * nothing to draw. The CALLER marks it eventMode 'none' and parents it. */
export function bpSkinSprite(cells: ReadonlyArray<Cell>, def: BpSkinDef | null | undefined, onReady?: () => void): Sprite | null {
  if (!def) return null;
  // THE GUARD (module header). Two separate reasons to draw nothing, and both
  // must render EXACTLY as the board did before this REQ -- bare grid tint, bare
  // outline, no child in gSkins at all:
  //   1. the def declares no art (`neutral`, and every derived skin whose
  //      artwork is not adopted -- the normal case under ruling D5), and
  //   2. it declares art that is not decoded yet, or never will be.
  // decodedFor() covers both and starts the decode for case 2 only, but the
  // first is asked explicitly so this reads as the rule it is rather than as a
  // side effect of a cache lookup.
  if (!declaresFillTexture(def)) return null;
  const dec = decodedFor(def, onReady);
  if (!dec) return null;
  const built = textureFor(cells, def, dec.fill, dec.strips);
  if (!built) return null;
  const sprite = new Sprite(built.tex);
  sprite.x = PAD + (built.c0 - MARGIN - 1) * CELL;
  sprite.y = PAD + (built.r0 - MARGIN - 1) * CELL;
  return sprite;
}

/** Drop every cached composite/raster. Pairs with sprites.ts's
 * invalidateBoardTextures() for a runtime skin swap. */
export function invalidateBpSkinTextures(): void {
  for (const t of textures.values()) t.destroy(true);
  textures.clear(); decoded.clear(); pending.clear();
}
