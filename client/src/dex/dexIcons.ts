// Dex icon loader — REQ-0035. Reuses board/sprites.ts's SVG-sheet parsing
// pipeline verbatim (parseSymbols/standaloneSvgString already solve the
// multi-root-SVG-sheet problem, see that file's module comment) but stops
// one step short of sprites.ts's own rasterize()/loadSpriteTextures(),
// which produce PixiJS Textures (only useful inside a WebGL board). The
// Dex is a plain DOM/HTML reference view -- no PixiJS Application here,
// deliberately, to avoid any risk of the Pixi-lifecycle issues documented
// in REQ-0031/REQ-0034 -- so each icon is served as a standalone SVG data
// URL directly to an <img> tag instead.
import spriteSheetSource from '../../../content/sprite_all_v10.svg?raw';
import { parseSymbols, standaloneSvgString, type SymbolInfo } from '../board/sprites';

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
