// REQ-0276 B1: async Pixi-texture cache for MONSTER art, resolved through the
// SAME chain the Dex MonsterCatalog uses -- board/itemArt.getItemArtUrl(id)
// (the payload-level art_urls map; monster ids ride it exactly like item ids,
// see MonsterCatalog.MonsterPortrait). This mirrors board/sprites.loadRaster's
// failure policy verbatim: a URL that 404s / decodes empty is cached as a MISS
// (null) so the caller draws the rune placeholder -- never a broken image.
//
// Kept OUT of loadBoardTextures()'s one-shot manifest on purpose: that map is
// built once at monitor mount from a fixed raster list; monster art is resolved
// lazily per roster (a run only fields a handful of distinct monster ids), and
// caching here (id -> Texture|null) means one decode per id per session.
import { Assets, type Texture } from 'pixi.js';
import { getItemArtUrl } from '../board/itemArt';

// undefined = never attempted; null = attempted + absent/failed (draw rune);
// Texture = ready.
const CACHE = new Map<string, Texture | null>();
const PENDING = new Map<string, Promise<Texture | null>>();

/** Synchronous peek -- undefined (unknown), null (known miss), or a Texture. */
export function getCachedMonsterTexture(id: string): Texture | null | undefined {
  return CACHE.get(id);
}

/** Resolve + decode a monster's adopted-render texture (idempotent, cached).
 * Resolves to null when the id has no art_urls entry or the raster fails to
 * decode -- callers keep the rune placeholder in that case. Never throws. */
export function loadMonsterTexture(id: string): Promise<Texture | null> {
  const cached = CACHE.get(id);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = PENDING.get(id);
  if (inflight) return inflight;
  const url = getItemArtUrl(id);
  if (!url) { CACHE.set(id, null); return Promise.resolve(null); }
  const p = (async (): Promise<Texture | null> => {
    try {
      const tex = await Assets.load<Texture>({ src: url, loadParser: 'loadTextures' });
      if (!tex || !tex.width || !tex.height) { CACHE.set(id, null); return null; }
      CACHE.set(id, tex);
      return tex;
    } catch {
      CACHE.set(id, null);
      return null;
    } finally {
      PENDING.delete(id);
    }
  })();
  PENDING.set(id, p);
  return p;
}
