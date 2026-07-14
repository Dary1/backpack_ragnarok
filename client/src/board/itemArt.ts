// client/src/board/itemArt.ts — REQ-0133 (item-raster-live-wiring).
//
// The ITEM half of the REQ-0125a render machinery: item cells resolve their
// texture REGISTRY-FIRST (an adopted registry render, served as a raster PNG)
// with the SVG sprite symbol as the fallback tier. This is a thin analog of
// board/unitIcon.ts — SAME machinery, not a parallel one:
//   * raster keys are namespaced `item:<id>` (unit uses `unit:<id>`, the SVG
//     route uses `icon-*`), so all three producers share ONE texture map with
//     no key collisions (the reason unitIcon.ts kept its key helper public);
//   * resolveItemIcon() is the pure, framework-agnostic rung walker (registry
//     -> sprite -> placeholder), exactly the shape of resolveUnitIcon(), so a
//     raster that 404s / fails to decode is simply ABSENT from the map, has()
//     says no, and the chain falls through to the sprite — missing art never
//     blocks rendering.
//
// The per-item resolved URLs come from the SERVER: /api/content's `art_urls`
// map (payload-level, REQ-0133) is the def.artwork_ref-adopted -> exact-name-
// adopted resolution computed at the storage chokepoint. The client does NO
// cross-registry join; it just consumes the URL. setItemArtUrls() is called
// ONCE at boot (store/boot.ts) before any board mounts, so loadBoardTextures()
// has the item raster list on its first (cached) call — art arrives as DATA.
import { type RasterEntry } from './unitIcon';

/** id -> resolved adopted-render URL (`/api/art/<artwork>.png`). Sparse: an id
 * absent here has no registry art and falls back to its sprite symbol. */
let ITEM_ART_URLS: Record<string, string> = {};

/** REQ-0133. Idempotent; safe to call again on a content hot-reload. */
export function setItemArtUrls(map: Record<string, string> | null | undefined): void {
  ITEM_ART_URLS = map || {};
}

/** The resolved registry URL for one entity id, or null (DOM callers use this
 * via dexIcons.resolveIconUrl; the board uses the texture-map form below). */
export function getItemArtUrl(id: string | null | undefined): string | null {
  return (id && ITEM_ART_URLS[id]) || null;
}

/** Texture-map key namespacing — `item:<id>`. Kept in one place so item rasters
 * never collide with unit rasters (`unit:<id>`) or SVG symbols (`icon-*`). */
export function itemIconKey(id: string): string {
  return 'item:' + id;
}

/** The raster manifest for item icons: one RasterEntry per id that has a
 * resolved registry URL. Consumed by sprites.ts's loadBoardTextures(), merged
 * into the same texture map as the SVG symbols + unit rasters. */
export function itemIconRasters(): RasterEntry[] {
  const out: RasterEntry[] = [];
  for (const id of Object.keys(ITEM_ART_URLS)) {
    const url = ITEM_ART_URLS[id];
    if (typeof url === 'string' && url.length > 0) out.push({ key: itemIconKey(id), url });
  }
  return out;
}

/** Which rung of the item chain produced the answer (carried out so the DOM
 * side / tests can label + assert on provenance, not just the key). */
export type ItemIconRung = 'registry' | 'sprite' | 'placeholder';

export interface ItemIconResolution {
  rung: ItemIconRung;
  /** Texture-map key to draw, or null at `placeholder` (draw nothing). Only ever
   * a key that has() confirmed is present, so callers never get a dud key. */
  key: string | null;
}

/**
 * Resolve an item cell's texture through the ratified chain:
 *
 *     registry adopted render (raster)  ->  SVG sprite symbol  ->  placeholder
 *
 * A rung is taken only if BOTH declared AND available (`has(key)`). A registry
 * raster that failed to load is declared but unavailable — it falls THROUGH to
 * the sprite symbol silently. Pure. Total. Never throws.
 */
export function resolveItemIcon(
  id: string | null | undefined,
  spriteKey: string | null | undefined,
  has: (key: string) => boolean
): ItemIconResolution {
  const registryKey = id ? itemIconKey(id) : null;
  if (registryKey && has(registryKey)) return { rung: 'registry', key: registryKey };
  if (typeof spriteKey === 'string' && spriteKey.length > 0 && has(spriteKey)) return { rung: 'sprite', key: spriteKey };
  return { rung: 'placeholder', key: null };
}
