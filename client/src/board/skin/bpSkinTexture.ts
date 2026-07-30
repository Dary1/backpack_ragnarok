// client/src/board/skin/bpSkinTexture.ts -- REQ-0266 (item 23b). The bridge
// between the PURE compositor and PixiJS: decode a fill raster, composite once
// per (skin, cell-set SHAPE), upload as a Texture, hand back a positioned
// Sprite. REQ-0350 is what made that "once" true -- see textureFor().
// It lives here, not in BoardRenderer.ts: that file is hot and its
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
import { Sprite, Texture } from 'pixi.js';
import { CELL, PAD } from '../geom';
import { compositeSkin, declaresFillTexture, LAYER, type FillRaster } from './composite';
import { countBpSkinCacheHit, countBpSkinComposite } from './bpSkinProbe';
import type { BpSkinDef } from './skinRegistry';
import type { Cell } from './autotile';

/** One cell of padding, so rounding at the outer boundary is computed against
 * real background rather than the array edge. */
const MARGIN = 1;
/** Tiles are downsampled to two cells square: a bpskin artwork is authored at
 * 1024x1024 (art.cjs locks that), and tiled 1:1 at CELL px a BP would show a
 * twentieth of the image and read as noise rather than as a material. */
const TILE_PX = CELL * 2;
/** A composite costs three distance transforms plus a full W*H pass, so the
 * cache needs a cap.
 *
 * REQ-0350: the key is SHAPE-normalised (see textureFor), so the key space is
 * (skin x shape) -- bounded and small -- rather than growing with every
 * translation of a BP, and this cap is now close to unreachable in play.
 *
 * Eviction is LRU and deliberately does NOT destroy(). A Texture here may still
 * be held by a Sprite parented in EITHER mounted board's gSkins: App.tsx keeps
 * the canvas and inventory boards mounted together and this cache is
 * module-global, so the old wholesale `destroy(true)` + clear() let one board's
 * eviction destroy the OTHER board's on-screen texture -- and that board does
 * not repaint until its own state changes, so it went on holding a destroyed
 * texture. Dropping the map entry instead hands the Texture to Pixi's GCSystem,
 * which unloads it only once nothing has drawn it for gcMaxUnusedTime; a sprite
 * still on screen keeps touching it and so keeps it alive. Bounded map, and no
 * way left to destroy a texture that something is still drawing. */
const MAX_TEXTURES = 64;

const rasters = new Map<string, FillRaster | null>();
const pending = new Set<string>();
const textures = new Map<string, Texture>();

function surface(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv.getContext('2d', { willReadFrequently: true });
}

function decode(url: string, onReady?: () => void): void {
  if (rasters.has(url) || pending.has(url) || typeof document === 'undefined') return;
  pending.add(url);
  const img = new Image();
  img.onload = () => {
    pending.delete(url);
    try {
      const ctx = surface(TILE_PX, TILE_PX);
      if (!ctx) { rasters.set(url, null); return; }
      ctx.drawImage(img, 0, 0, TILE_PX, TILE_PX);
      const px = ctx.getImageData(0, 0, TILE_PX, TILE_PX);
      rasters.set(url, { width: TILE_PX, height: TILE_PX, rgba: px.data });
      if (onReady) onReady();
    } catch (err) {
      // Reading pixels back can throw. Not an error path: cache the miss and
      // keep the palette-procedural body.
      console.warn('bpSkinTexture: could not read ' + url, err);
      rasters.set(url, null);
    }
  };
  img.onerror = () => { pending.delete(url); rasters.set(url, null); }; // permanent miss
  img.src = url;
}

/** The decoded tile for a def, or null while it loads / if it never will. */
export function fillRasterFor(def: BpSkinDef, onReady?: () => void): FillRaster | null {
  const url = def.art ? def.art.fill_texture : null;
  if (typeof url !== 'string' || !url) return null;
  if (!rasters.has(url)) { decode(url, onReady); return null; }
  return rasters.get(url) || null;
}

/** Texture for one (skin, cell-set SHAPE). Pixels outside the silhouette are made
 * fully TRANSPARENT: the compositor paints a solid background there, which is
 * right for an offline PNG and wrong for a board, where the grid must show.
 *
 * REQ-0350 -- two halves of one bug, both about this cache never actually
 * saving the composite:
 *
 *  1. compositeSkin() ran BEFORE the cache lookup, so a hit still paid the full
 *     composite: three Euclidean distance transforms plus a W*H per-pixel pass,
 *     measured through the real module at 11.2ms (1x1) to 23.1ms (2x3 six-cell)
 *     per BP at CELL=80. That was per render(state), per skinned BP, on BOTH
 *     mounted boards -- and render(state) runs on every state change, every
 *     squad switch, and on drag-arm (BoardRenderer.onGlobalPointerMove). Only
 *     the Texture upload was ever being cached; the module header's "composite
 *     once per (cell-set, skin)" was a statement of intent, not of behaviour.
 *
 *  2. the key carried ABSOLUTE cell coordinates, so moving or rotating a BP
 *     minted a fresh entry for pixels that are byte-identical. The composite is
 *     translation-invariant by construction: composite.ts takes r0/c0 to be the
 *     cell set's own min row/col and works entirely in that relative frame, so
 *     two translations of one shape yield identical rgba/layer/width/height and
 *     differ only in r0/c0. Keying on absolute cells therefore thrashed a
 *     64-entry cache during ordinary play, which is what kept the cost in (1)
 *     recurring instead of amortising.
 *
 * r0/c0 are computed HERE, once, and serve both the normalised key and the
 * caller's board placement. They are the same mins composite.ts takes, and
 * check_bpskin.mjs pins both that equality and the translation-invariance the
 * normalisation rests on -- if a future compositor stops being
 * translation-invariant, that gate fails before this cache can serve a wrong
 * texture. */
function textureFor(cells: ReadonlyArray<Cell>, def: BpSkinDef, raster: FillRaster): { tex: Texture; r0: number; c0: number } | null {
  if (typeof document === 'undefined' || cells.length === 0) return null;
  const r0 = Math.min(...cells.map((cell) => cell[0]));
  const c0 = Math.min(...cells.map((cell) => cell[1]));
  const key = def.id + '|r|' + cells.map((cell) => (cell[0] - r0) + ',' + (cell[1] - c0)).sort().join(';');
  const hit = textures.get(key);
  if (hit) {
    countBpSkinCacheHit();
    // LRU touch: re-inserting moves this key to the end of the Map's insertion
    // order, so the eviction below always takes the genuinely coldest entry
    // rather than whatever happened to be inserted first.
    textures.delete(key);
    textures.set(key, hit);
    return { tex: hit, r0, c0 };
  }
  countBpSkinComposite();
  const comp = compositeSkin(cells, def, def.palette.canvas || '#000000', { cellPx: CELL, margin: MARGIN }, raster);
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
  // Bounded, LRU, and never destroy() -- see MAX_TEXTURES for why the old
  // wholesale destroy+clear was a correctness bug across two live boards.
  while (textures.size >= MAX_TEXTURES) {
    const coldest = textures.keys().next().value;
    if (coldest === undefined) break;
    textures.delete(coldest);
  }
  textures.set(key, tex);
  return { tex, r0, c0 };
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
  // fillRasterFor() covers both and starts the decode for case 2 only, but the
  // first is asked explicitly so this reads as the rule it is rather than as a
  // side effect of a cache lookup.
  if (!declaresFillTexture(def)) return null;
  const raster = fillRasterFor(def, onReady);
  if (!raster) return null;
  const built = textureFor(cells, def, raster);
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
  textures.clear(); rasters.clear(); pending.clear();
}
