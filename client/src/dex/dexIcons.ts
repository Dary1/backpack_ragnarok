// Dex icon loader — REQ-0035. Reuses board/sprites.ts's SVG-sheet parsing
// pipeline verbatim (parseSymbols/standaloneSvgString already solve the
// multi-root-SVG-sheet problem, see that file's module comment) but stops
// one step short of sprites.ts's own rasterize()/loadSpriteTextures(),
// which produce PixiJS Textures (only useful inside a WebGL board). The
// Dex is a plain DOM/HTML reference view -- no PixiJS Application here,
// deliberately, to avoid any risk of the Pixi-lifecycle issues documented
// in REQ-0031/REQ-0034 -- so each icon is served as a standalone SVG data
// URL directly to an <img> tag instead.
import spriteSheetSource from '../../../content/sprite_all_v12.svg?raw';
import { parseSymbols, standaloneSvgString, type SymbolInfo } from '../board/sprites';
import { getItemArtUrl } from '../board/itemArt'; // REQ-0133

let cache: Map<string, SymbolInfo> | null = null;

function symbolsById(): Map<string, SymbolInfo> {
  if (!cache) {
    const symbols = parseSymbols(spriteSheetSource, new DOMParser(), new XMLSerializer());
    cache = new Map(symbols.map((s) => [s.id, s]));
  }
  return cache;
}

/** Returns a data: URL for the given icon id (e.g. "icon-blade"), suitable
 * for direct use as an <img src>. Returns null if the icon id is not found
 * in the sprite sheet (renders as a placeholder in the caller). */
export function iconDataUrl(iconId: string): string | null {
  const sym = symbolsById().get(iconId);
  if (!sym) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(standaloneSvgString(sym))}`;
}

/** REQ-0038 R2: returns the icon's own SVG viewBox width/height (the
 * symbol's NATIVE aspect ratio) -- needed by client/src/render/itemCard.ts's
 * computeItemCardLayout/computeDomIconOverlay to contain-fit the icon into
 * its full multi-cell footprint box (same aspect-ratio input BoardRenderer
 * gets for free from a Pixi Texture's width/height). Returns null if the
 * icon id is not found (caller falls back to a square aspect). */
export function iconDims(iconId: string): { width: number; height: number } | null {
  const sym = symbolsById().get(iconId);
  if (!sym) return null;
  return { width: sym.width, height: sym.height };
}

// REQ-0133: resolution-aware icon source for DOM <img> callers.
export type IconSource = 'registry' | 'sprite';
export interface ResolvedIcon { url: string | null; source: IconSource; }

/** REQ-0133 resolution-aware icon URL for a DOM <img>: the REGISTRY adopted-
 * render URL (from /api/content's art_urls, set at boot via
 * board/itemArt.setItemArtUrls) when this entity has one, else the SVG sprite
 * data URL. `source` names the winning tier so callers can label it
 * (contentadmin) or style it. This is the DOM analog of board/itemArt's
 * resolveItemIcon chain -- registry first, sprite fallback -- so the reference
 * views agree with the game board. iconDims() (the sprite's native aspect) is
 * still the fit input: the backfilled registry raster is aspect-identical to the
 * sprite, and an explicit AI render is contain-fit into the same footprint. */
export function resolveIconUrl(id: string | null | undefined, iconId: string | null | undefined): ResolvedIcon {
  const reg = getItemArtUrl(id);
  if (reg) return { url: reg, source: 'registry' };
  return { url: iconId ? iconDataUrl(iconId) : null, source: 'sprite' };
}
