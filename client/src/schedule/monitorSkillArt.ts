// REQ-0292 P2: async Pixi-texture cache for monster/gimic SKILL ICONS, the
// `skill_icon` art kind (256x256) served DIRECTLY at /api/art/<skill_id>.png by
// EXACT NAME. P1 ruling (evidence E): skills.json def ids are real content ids
// but are NOT joined into art_urls (server/lib/content.cjs artUrlNameBatch omits
// skills), so -- like vfx art (monitorVfxArt.ts) -- the client resolves the bare
// skill id directly. Failure policy mirrors monitorVfxArt/monitorArt verbatim: a
// name that 404s / decodes empty is cached as a MISS (null) so the caller keeps
// the class-glyph fallback -- never a broken image, never a per-frame retry.
//
// Caching is per-skill-id (fetched at most once per session; hit -> Texture,
// miss -> null, single in-flight promise). resolveSkillTexture() is the async
// fetch (fire-and-forget warm on badge creation); peekSkillTexture() is the
// SYNCHRONOUS cached-only read the draw site uses so a badge never waits on a
// load -- an unwarmed id shows the glyph fallback this frame and the icon lands
// the next.
import { Assets, type Texture } from 'pixi.js';

// undefined = never attempted; null = attempted + absent/failed (glyph fallback);
// Texture = ready.
const CACHE = new Map<string, Texture | null>();
const PENDING = new Map<string, Promise<Texture | null>>();

// system_name validation mirror (server art route): only [A-Za-z0-9_] names can
// name an adopted asset, so anything else can never resolve -- skip the fetch.
const NAME_RE = /^[A-Za-z0-9_]+$/;

/** Resolve+decode ONE skill icon (idempotent, cached incl. null misses, single
 * in-flight promise). Never throws; a bad/empty id resolves to null. */
export function resolveSkillTexture(skillId: string | null | undefined): Promise<Texture | null> {
  if (!skillId || !NAME_RE.test(skillId)) return Promise.resolve(null);
  const cached = CACHE.get(skillId);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = PENDING.get(skillId);
  if (inflight) return inflight;
  const url = '/api/art/' + skillId + '.png';
  const p = (async (): Promise<Texture | null> => {
    try {
      const tex = await Assets.load<Texture>({ src: url, loadParser: 'loadTextures' });
      if (!tex || !tex.width || !tex.height) { CACHE.set(skillId, null); return null; }
      CACHE.set(skillId, tex);
      return tex;
    } catch {
      CACHE.set(skillId, null);
      return null;
    } finally {
      PENDING.delete(skillId);
    }
  })();
  PENDING.set(skillId, p);
  return p;
}

/** SYNCHRONOUS cached-only read: Texture when known-ready, else null (still in
 * flight OR a known miss) -> the caller draws the glyph fallback. Never fetches. */
export function peekSkillTexture(skillId: string | null | undefined): Texture | null {
  if (!skillId) return null;
  return CACHE.get(skillId) ?? null;
}

/** Test/debug seam: clear the module cache. */
export function __resetSkillArtCache(): void {
  CACHE.clear();
  PENDING.clear();
}
