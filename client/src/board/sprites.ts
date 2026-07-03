// Sprite v7 art loader — REQ-0026 T0.1 (repackaging bug fixed, REQ-0026 follow-up).
// content/sprite_all_v10.svg is a <symbol> sheet: SEVERAL concatenated
// <svg style="display:none">...</svg> root blocks (valid as a browser
// fragment via consecutive <use> resolution -- the mock's ui.js just drops
// the raw text into the page -- but NOT well-formed single-document XML,
// since XML only allows one root element per document), each containing
// one or more <symbol id="icon-X" viewBox="..."> per icon. PixiJS has no
// notion of SVG <use>/<symbol> re-use, and its built-in SVG texture loader
// (loadSvg) rasterizes one whole SVG *document* per texture, not a
// fragment of one -- so each symbol is first repackaged as its own
// standalone SVG document (own viewBox + serialized children, byte-
// identical markup/paths -- no art redrawn), then rasterized to a canvas
// and handed to Pixi as a Texture. This mirrors exactly what <use> already
// does visually (stretch the referenced viewBox's content into a target
// box); only the delivery mechanism differs.
//
// BUG HISTORY (fixed here): parseSymbols() used to call
// `parser.parseFromString(svgSource, 'image/svg+xml')` directly on the RAW
// multi-root text. Because XML forbids more than one root element, the
// parser hits a fatal error at the second block's opening `<svg>` (extra
// content after the first document's `</svg>`) and silently returns a
// partial/error document -- DOMParser never throws, so nothing surfaced.
// In practice this meant only <symbol>s living in the FIRST <svg> block
// were ever found (icon-tower_shield, icon-whetstone, icon-frost_orb,
// icon-poison_vial, icon-linker_core); every symbol declared in a later
// block (icon-blade, icon-hilt, icon-flame_tablet, icon-oil_flask2,
// icon-dagger2, icon-herb_satchel, icon-beast_jaw, and all Frost-tier
// icons) was invisible on the board with no console error. This exact
// multi-root shape is documented and already solved on the Python side --
// tools/tool_fit_check.py's load_sprite_tree() wraps the raw text in a
// synthetic single root before parsing for precisely this reason. We
// mirror that here: wrap in a synthetic <svg-root> element first, then
// parse once, so every <symbol> in every block is found regardless of
// which top-level <svg> it lives in.
//
// A second latent issue fixed at the same time: the old code built each
// symbol's inner markup via `sym.innerHTML`, which is not reliably
// available on documents parsed as 'image/svg+xml' (varies by DOM
// implementation) and was never exercised by a non-browser test. We now
// serialize each child node explicitly with XMLSerializer (available in
// both the browser and Node's @xmldom/xmldom), which mirrors
// tools/tool_fit_check.py's `rasterize_symbol()` reference exactly
// (`"".join(ET.tostring(child) for child in sym)`) and is testable in
// plain Node -- see client/scripts/check_sprites.mjs.
//
// Import path: the SVG file is read via Vite's `?raw` loader (same
// technique as engine/adapter.ts) directly from content/sprite_all_v10.svg,
// so the client always tracks whatever the current sprite sheet is with no
// manual copy/sync step and no fork of the art pipeline.
import spriteSheetSource from '../../../content/sprite_all_v10.svg?raw';
import { Texture } from 'pixi.js';

const RASTER_SCALE = 2; // supersample so icons stay crisp when scaled up into grid cells

export interface SymbolInfo {
  id: string;
  viewBox: string;
  width: number;
  height: number;
  preserveAspectRatio: string | null;
  innerMarkup: string;
}

/**
 * Parses content/sprite_all_v10.svg's raw text into one SymbolInfo per
 * <symbol>, regardless of which (possibly multiple) top-level <svg> root
 * block it lives in. Pure function, no browser/DOM-global dependencies
 * beyond a DOMParser+XMLSerializer pair passed in by the caller -- this is
 * what makes it testable from plain Node (see check_sprites.mjs), where
 * @xmldom/xmldom provides both.
 */
export function parseSymbols(
  svgSource: string,
  domParser: DOMParser,
  xmlSerializer: XMLSerializer
): SymbolInfo[] {
  // The sprite sheet is several concatenated <svg>...</svg> root blocks,
  // which is not well-formed XML (only one root element allowed per
  // document) -- wrap in a synthetic single root first, same technique as
  // tools/tool_fit_check.py's load_sprite_tree(). The wrapper element name
  // is arbitrary; it is never itself read back out.
  const wrapped = `<svg-root xmlns="http://www.w3.org/2000/svg">${svgSource}</svg-root>`;
  const doc = domParser.parseFromString(wrapped, 'image/svg+xml');
  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`sprites: failed to parse sprite sheet: ${parserError.textContent ?? 'unknown parse error'}`);
  }
  const symbols = Array.from(doc.getElementsByTagName('symbol'));
  return symbols.map((sym) => {
    const id = sym.getAttribute('id') ?? '';
    const viewBox = sym.getAttribute('viewBox') ?? '0 0 64 64';
    const [, , w, h] = viewBox.split(/\s+/).map(Number);
    const preserveAspectRatio = sym.getAttribute('preserveAspectRatio');
    const innerMarkup = Array.from(sym.childNodes)
      .map((child) => xmlSerializer.serializeToString(child))
      .join('');
    return { id, viewBox, width: w || 64, height: h || 64, preserveAspectRatio, innerMarkup };
  });
}

/**
 * Builds a standalone SVG document string for one symbol: same viewBox,
 * same (serialized, byte-identical) inner markup, sized to
 * width*RASTER_SCALE x height*RASTER_SCALE. Carries the symbol's own
 * preserveAspectRatio through (several symbols -- blade, flame_tablet,
 * oil_flask2, dagger2, herb_satchel -- declare preserveAspectRatio="none"
 * because their inner <g transform> wrappers rotate a tall drawing into a
 * wide viewBox; dropping that attribute would letterbox/crop them instead
 * of stretching to fill, unlike the mock's native <use> rendering).
 * Exported (pure, no I/O) so it is testable from plain Node.
 */
export function standaloneSvgString(sym: SymbolInfo): string {
  const w = sym.width * RASTER_SCALE;
  const h = sym.height * RASTER_SCALE;
  const parAttr = sym.preserveAspectRatio ? ` preserveAspectRatio="${sym.preserveAspectRatio}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sym.viewBox}" ` +
    `width="${w}" height="${h}"${parAttr}>${sym.innerMarkup}</svg>`
  );
}

function standaloneSvgDataUrl(sym: SymbolInfo): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(standaloneSvgString(sym))}`;
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
 * Loads content/sprite_all_v10.svg (already bundled, see the module-level
 * comment) and rasterizes every <symbol> into a Pixi Texture, keyed by
 * symbol id (e.g. "icon-blade"). Cached after first call -- one Image
 * decode per icon per client session, not per render.
 */
export function loadSpriteTextures(): Promise<Map<string, Texture>> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const symbols = parseSymbols(spriteSheetSource, new DOMParser(), new XMLSerializer());
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
