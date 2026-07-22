// REQ-0280 P3: async Pixi-texture cache for per-skill ray/hit VFX ART, resolved
// through the composed-name convention ratified in REQ-0264 s11.1 and served
// DIRECTLY at /api/art/<system_name>.png (NOT joined into art_urls -- vfx names
// are not content-def ids; see REQ-0264 s11.5). This mirrors monitorArt.ts's
// loadMonsterTexture failure policy verbatim: a name that 404s / decodes empty
// is cached as a MISS (null) so the caller keeps the procedural draw -- never a
// broken image, never a per-frame retry (REQ-0264 s11.3).
//
// Resolution chain (per role, REQ-0264 s11.2, keys from the P2 wire contract):
//   1. vfx_<role>_<skill>        (skill = skills.json def id on enemy/trap/door
//                                 rays; ABSENT on player-item / charge / synth)
//   2. vfx_<role>_<src-stripped> (src = player item id; enemy src is
//                                 '<defId>#<idx>' -- the '#idx' suffix stripped)
//   3. vfx_<role>_default        (the shipped default)
//   4. null                      -> caller draws the current procedural visuals
//
// Caching is per-NAME (not per-chain): each system_name is fetched at most once
// per session (hit -> Texture, miss -> null), with a single in-flight promise
// per name. resolveVfxTexture() walks the chain, awaiting each name in order and
// stopping at the first hit (so a skill-specific override short-circuits the
// default fetch). peekVfxTexture() is the SYNCHRONOUS cached-only read the draw
// sites use: it returns a Texture only when the chain's outcome is already known
// (every earlier candidate a known miss, this one a known hit); if any earlier
// candidate is still in flight the outcome is indeterminate, so it returns null
// and the CURRENT effect falls back procedurally -- nothing ever waits or jitters
// on a texture. A ray_fire fire-and-forget prefetch of both roles then warms the
// cache so the very next ray/impact of the same key resolves synchronously.
import { Assets, type Texture } from 'pixi.js';

export type VfxRole = 'ray' | 'hit';

// undefined = never attempted; null = attempted + absent/failed (procedural);
// Texture = ready.
const CACHE = new Map<string, Texture | null>();
const PENDING = new Map<string, Promise<Texture | null>>();

// system_name validation mirror (server art route): only [A-Za-z0-9_] names can
// name an adopted asset, so anything else can never resolve -- skip the fetch.
const NAME_RE = /^[A-Za-z0-9_]+$/;

/** Enemy src is '<defId>#<idx>' on charge/react firings -- the art key is the
 * bare def id (REQ-0280 P2 handoff). Player-item src has no suffix. */
function stripSrc(src: string): string {
  const h = src.indexOf('#');
  return h >= 0 ? src.slice(0, h) : src;
}

/** The chain's candidate system_names, in resolution order, for a role. Invalid
 * (non [A-Za-z0-9_]) or empty/'?' keys are dropped -- they cannot name an asset. */
function candidateNames(role: VfxRole, skill: string | null, src: string | null): string[] {
  const out: string[] = [];
  if (skill) {
    const n = 'vfx_' + role + '_' + skill;
    if (NAME_RE.test(n)) out.push(n);
  }
  if (src) {
    const s = stripSrc(src);
    if (s && s !== '?') {
      const n = 'vfx_' + role + '_' + s;
      if (NAME_RE.test(n)) out.push(n);
    }
  }
  out.push('vfx_' + role + '_default');
  return out;
}

/** Resolve+decode ONE system_name (idempotent, cached incl. null misses, single
 * in-flight promise). Ray strips get their source address mode set to 'repeat'
 * so a TilingSprite tiles them seamlessly (REQ-0264 s7.2). Never throws. */
function loadName(name: string): Promise<Texture | null> {
  const cached = CACHE.get(name);
  if (cached !== undefined) return Promise.resolve(cached);
  const inflight = PENDING.get(name);
  if (inflight) return inflight;
  const url = '/api/art/' + name + '.png';
  const p = (async (): Promise<Texture | null> => {
    try {
      const tex = await Assets.load<Texture>({ src: url, loadParser: 'loadTextures' });
      if (!tex || !tex.width || !tex.height) { CACHE.set(name, null); return null; }
      // Ray strips tile along the trail polyline -- the source must wrap in X
      // (REQ-0264 s7.2/s8: seamless 256x64 strip). Hit stills are plain Sprites.
      if (name.startsWith('vfx_ray_') && tex.source) {
        try { tex.source.style.addressMode = 'repeat'; } catch { /* best-effort */ }
      }
      CACHE.set(name, tex);
      return tex;
    } catch {
      CACHE.set(name, null);
      return null;
    } finally {
      PENDING.delete(name);
    }
  })();
  PENDING.set(name, p);
  return p;
}

/** Walk the chain, awaiting each name in order; resolve to the first hit, else
 * null. Also the fire-and-forget PREFETCH used at ray_fire (warms the cache for
 * the impending impact). Stops at the first hit so an adopted skill override
 * never triggers the default fetch (REQ-0264 s11.4: resolve per-roster). */
export async function resolveVfxTexture(
  role: VfxRole,
  skill: string | null,
  src: string | null,
): Promise<Texture | null> {
  const names = candidateNames(role, skill, src);
  for (const name of names) {
    const tex = await loadName(name);
    if (tex) return tex;
  }
  return null;
}

/** SYNCHRONOUS cached-only read of the chain's outcome. Returns a Texture only
 * when it is ALREADY known (every earlier candidate a known miss, this one a
 * known hit); returns null when the head of the chain is still in flight
 * (indeterminate) or the whole chain is a known miss. Draw sites use THIS so a
 * ray/impact never waits on a load -- an unwarmed key falls back procedurally,
 * a warmed one (post-prefetch) resolves instantly. Never triggers a fetch. */
export function peekVfxTexture(
  role: VfxRole,
  skill: string | null,
  src: string | null,
): Texture | null {
  const names = candidateNames(role, skill, src);
  for (const name of names) {
    const c = CACHE.get(name);
    if (c === undefined) return null; // still in flight -> outcome unknown -> procedural
    if (c) return c;                  // known hit
    // c === null -> known miss -> try the next candidate
  }
  return null;
}

/** Test/debug seam: clear the module cache (used by unit checks). */
export function __resetVfxCache(): void {
  CACHE.clear();
  PENDING.clear();
}
