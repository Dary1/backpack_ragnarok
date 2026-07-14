// client/src/board/skin/skinTexture.ts -- REQ-0180. Turns the REQ-0126 PURE
// compositor output (compositeSkin's RGBA) into a Pixi Texture shaped exactly
// like the BP's rounded silhouette, cached by (skin id x LOCAL shape signature
// x cellPx). The composite is shape-dependent -- a skin is an autotile set over
// an arbitrary polyomino, not a static raster -- so it is built per distinct
// silhouette on first sight and reused thereafter. DOM/Pixi live HERE (the
// compositor stays pure), via an offscreen canvas + putImageData -- the same
// SVG->canvas->Texture path sprites.ts already uses.
//
// The texture's alpha is the compositor's ROUNDED-silhouette mask (`rs`), so
// only bag pixels are opaque: the board (canvas tint / neutral grid) shows
// through the rounded corners and holes with NO dependence on a background
// colour -- which is why this never needs to know which board it draws on
// (BS-G4 rounded-corner blend, satisfied by construction).
import { Texture } from 'pixi.js';
import { compositeSkin } from './composite';
import type { Cell } from './autotile';
import type { BpSkinDef } from './skinRegistry';

export interface SkinTexture { texture: Texture; r0: number; c0: number; margin: number; cellPx: number; }

const cache = new Map<string, SkinTexture>();

/** Order-independent signature of the LOCAL silhouette (offsets from min r/c),
 * so two BPs of one shape at different origins share a single texture. */
function shapeSig(cells: ReadonlyArray<Cell>): string {
  const rs = cells.map((c) => c[0]); const cs = cells.map((c) => c[1]);
  const r0 = Math.min(...rs), c0 = Math.min(...cs);
  return cells.map(([r, c]) => (r - r0) + ',' + (c - c0)).sort().join(';');
}

/** Composite `cells` under `def` at `cellPx` and return a silhouette-shaped Pixi
 * Texture + its top-left cell anchor (r0,c0) and margin, or null when there is
 * no DOM (unit tests) or no 2d context -- callers then fall through to the plain
 * rendering, never throwing. */
export function skinTextureFor(cells: ReadonlyArray<Cell>, def: BpSkinDef, cellPx: number): SkinTexture | null {
  if (!cells.length) return null;
  if (typeof document === 'undefined') return null;
  const key = def.id + '|' + cellPx + '|' + shapeSig(cells);
  const hit = cache.get(key);
  if (hit) return hit;
  // bg is irrelevant: the rs alpha mask below zeroes every non-silhouette pixel.
  const comp = compositeSkin(cells, def, '#000000', { cellPx, margin: 1 });
  const canvas = document.createElement('canvas');
  canvas.width = comp.width; canvas.height = comp.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rgba = new Uint8ClampedArray(comp.rgba.length);
  rgba.set(comp.rgba);
  for (let i = 0; i < comp.rs.length; i++) rgba[i * 4 + 3] = comp.rs[i] ? 255 : 0; // silhouette alpha
  const img = new ImageData(rgba, comp.width, comp.height);
  ctx.putImageData(img, 0, 0);
  const out: SkinTexture = { texture: Texture.from(canvas), r0: comp.r0, c0: comp.c0, margin: comp.margin, cellPx };
  cache.set(key, out);
  return out;
}
