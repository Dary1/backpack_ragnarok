// Sprite v7 art loader — REQ-0026 T0.1.
// content/sprite_all_v7.svg is a <symbol> sheet (root <svg display:none>,
// one <symbol id="icon-X" viewBox="..."> per icon), referenced by
// mock-src/ui.js via <use href="#icon-X">. PixiJS has no notion of SVG
// <use>/<symbol> re-use, and its built-in SVG texture loader (loadSvg)
// rasterizes one whole SVG *document* per texture, not a fragment of one --
// so each symbol is first repackaged as its own standalone SVG document
// (same viewBox + innerHTML, byte-identical markup/paths -- no art redrawn),
// then rasterized to a canvas and handed to Pixi as a Texture. This mirrors
// exactly what <use> already does visually (stretch the referenced
// viewBox's content into a target box); only the delivery mechanism differs.
//
// Import path: the SVG file is read via Vite's `?raw` loader (same
// technique as engine/adapter.ts) directly from content/sprite_all_v7.svg,
// so the client always tracks whatever the current sprite sheet is with no
// manual copy/sync step and no fork of the art pipeline.
import spriteSheetSource from '../../../content/sprite_all_v7.svg?raw';
import { Texture } from 'pixi.js';

const RASTER_SCALE = 2; // supersample so icons stay crisp when scaled up into grid cells

interface SymbolInfo {
  id: string;
  viewBox: string;
  width: number;
  height: number;
  innerHTML: string;
}

function parseSymbols(svgSource: string): SymbolInfo[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgSource, 'image/svg+xml');
  const symbols = Array.from(doc.querySelectorAll('symbol'));
  return symbols.map((sym) => {
    const id = sym.getAttribute('id') ?? '';
    const viewBox = sym.getAttribute('viewBox') ?? '0 0 64 64';
    const [, , w, h] = viewBox.split(/\s+/).map(Number);
    return { id, viewBox, width: w || 64, height: h || 64, innerHTML: sym.innerHTML };
  });
}

function standaloneSvgDataUrl(sym: SymbolInfo): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sym.viewBox}" ` +
    `width="${sym.width * RASTER_SCALE}" height="${sym.height * RASTER_SCALE}">${sym.innerHTML}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function rasterize(sym: SymbolInfo): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = sym.width * RASTER_SCALE;
      canvas.height = sym.height * RASTER_SCALE;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error(`sprites: 2D context unavailable for ${sym.id}`));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error(`sprites: failed to rasterize ${sym.id}`));
    img.src = standaloneSvgDataUrl(sym);
  });
}

let loadPromise: Promise<Map<string, Texture>> | null = null;

/**
 * Loads content/sprite_all_v7.svg (already bundled, see the module-level
 * comment) and rasterizes every <symbol> into a Pixi Texture, keyed by
 * symbol id (e.g. "icon-blade"). Cached after first call -- one Image
 * decode per icon per client session, not per render.
 */
export function loadSpriteTextures(): Promise<Map<string, Texture>> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const symbols = parseSymbols(spriteSheetSource);
      const entries = await Promise.all(
        symbols.map(async (sym) => {
          const canvas = await rasterize(sym);
          const texture = Texture.from(canvas);
          return [sym.id, texture] as const;
        })
      );
      return new Map(entries);
    })();
  }
  return loadPromise;
}
