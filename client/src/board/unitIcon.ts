// client/src/board/unitIcon.ts — REQ-0125a.
//
// THE single chokepoint that answers "what art goes in this Unit's cell?".
//
// Today the answer is always the same: every BP draws the hardcoded legacy
// glyph `icon-unit_core` (BoardRenderer used to call textures.get() on that
// string literal inline, once, for every BP on both boards). That is not a
// bug to fix here -- it is the correct answer, because as of REQ-0125a there
// IS no unit art (REQ-0127's roster batch is on hold behind REQ-0136) and no
// unit IDENTITY to hang art on (a BP def is
// {id,name,color,shape,origin,linker:{off,dirs},hpMax}; the real Unit model
// belongs to REQ-0128). What this module adds is the SEAM: one place that
// resolves the question, with the full fallback chain already implemented and
// tested, so that identity (REQ-0125b) and art (REQ-0127) arrive as DATA
// rather than as a renderer rewrite -- and so REQ-0133 (item rasters) reuses
// this chain instead of growing a parallel one.
//
// Golden G6 (unit_icon_pipeline.md §1, ratified 2026-07-12) makes this SKIN
// resolution, not asset lookup: the icon the pipeline emits is the Unit's
// DEFAULT SKIN, not a hard-wired asset. Hence the chain below.
//
// Deliberately pure: no Pixi, no DOM, no I/O. Availability is injected as a
// `has(key)` predicate, so the whole chain is exercised from plain Node by
// client/scripts/check_unit_icon.mjs against the real production code (same
// discipline as sprites.ts's parseSymbols(), which check_sprites.mjs drives
// with @xmldom/xmldom instead of browser globals).
import type { UnitDefMap } from '../engine/engine.d.ts';
import { defaultUnitSkinId, unitSkinApplies, type UnitSkinEntryLike, type UnitSkinSlot } from './skin/skinRegistry';

/** The pre-REQ-0125 glyph: one SVG <symbol> in content/sprite_all_v12.svg,
 * drawn identically for every BP. Bottom-but-one rung of the chain, and --
 * until unit art exists -- the rung every real BP actually lands on. */
export const LEGACY_UNIT_GLYPH = 'icon-unit_core';

/** Which rung of the fallback chain produced the answer. Carried out of the
 * resolver (rather than just the texture key) so callers can style by
 * provenance -- and so tests can assert the chain fell through for the RIGHT
 * reason, not merely that it landed somewhere. */
export type UnitIconRung = 'skin' | 'default' | 'legacy' | 'placeholder';

export interface UnitIconResolution {
  rung: UnitIconRung;
  /** Texture key to draw, or null at the `placeholder` rung -- meaning "draw
   * nothing but the core disc". Never throws, never returns a key the caller
   * cannot resolve: a key is only ever returned if `has(key)` said yes. */
  key: string | null;
}

/** What we know about one Unit's art at resolve time. Every field optional:
 * as of REQ-0125a nothing populates them, and the chain must handle that
 * (and handle it as the NORMAL case, not as an error). */
export interface UnitIconQuery {
  /** Player-selected skin for this Unit (REQ-0125b + REQ-0126). */
  skinKey?: string | null;
  /** The Unit's default icon -- the raster the REQ-0127 pipeline emits. */
  defaultKey?: string | null;
}

/** Injected texture availability. In the client this is
 * `(k) => textures.has(k)` over the loaded Pixi texture map; in tests it is a
 * plain Set. Crucially this is what makes missing art a NON-EVENT: a raster
 * that 404s or fails to decode never lands in the map, `has()` says no, and
 * the chain simply falls through to the next rung. Nothing throws, nothing
 * blocks the board. */
export type HasTexture = (key: string) => boolean;

/**
 * Resolves a Unit cell's art through the ratified fallback chain:
 *
 *     active unit skin -> default unit icon -> legacy linker glyph -> placeholder
 *
 * A rung is taken only if it is BOTH declared (non-empty key) AND available
 * (`has(key)`). Declared-but-unavailable is exactly the missing-art case and
 * falls through silently -- "missing art must never block rendering"
 * (REQ-0125a scope, from the ratified pipeline golden).
 *
 * Pure. Total. Never throws.
 */
export function resolveUnitIcon(query: UnitIconQuery, has: HasTexture): UnitIconResolution {
  const rungs: ReadonlyArray<readonly [UnitIconRung, string | null | undefined]> = [
    ['skin', query.skinKey],
    ['default', query.defaultKey],
    ['legacy', LEGACY_UNIT_GLYPH],
  ];
  for (const [rung, key] of rungs) {
    if (typeof key === 'string' && key.length > 0 && has(key)) {
      return { rung, key };
    }
  }
  // Placeholder: not an error path. The renderer still draws the unit core
  // disc + direction dots; it just has no art to put inside. A board with no
  // sprite sheet at all still renders, still drags, still plays.
  return { rung: 'placeholder', key: null };
}

/** One raster icon to load into the texture map (see sprites.ts). */
export interface RasterEntry {
  /** Texture-map key, e.g. `unit:elf` or `unit:elf@elven`. Namespaced so
   * raster keys can never collide with SVG symbol ids (`icon-*`). */
  key: string;
  /** URL the client fetches. Raster route decided 2026-07-12
   * (unit_icon_pipeline.md §3.2: units and items both RASTER). */
  url: string;
}

/** Texture-key namespacing. Keeping this in one place is what lets REQ-0133
 * drop item rasters into the SAME map without a key collision and without a
 * second resolver. */
export function unitIconKey(unitId: string, skinId?: string | null): string {
  return skinId ? `unit:${unitId}@${skinId}` : `unit:${unitId}`;
}

/** The unit/1 defs, as served by /api/content. Set ONCE at boot (store/boot.ts)
 * before any board mounts. A module-level registry rather than a parameter
 * because loadBoardTextures() is called from three independent board components
 * that have no business each threading the content payload down to the texture
 * loader -- and because REQ-0125a always described this as a manifest that later
 * REQs would POPULATE, not a signature they would change. */
let UNIT_DEFS: UnitDefMap = {};

/** REQ-0170. Idempotent; safe to call again on a content hot-reload. */
export function setUnitDefs(defs: UnitDefMap | null | undefined): void {
  UNIT_DEFS = defs || {};
}

/** The public, un-authenticated adopted-artwork route (server/routes/art.cjs's
 * RE_PUB_ADOPTED). `icon` is an artwork system_name and may contain ':' -- hence
 * the encode. A unit whose art has not been adopted 404s here, and that is a
 * NON-EVENT: the raster is skipped, `has(key)` says no, and resolveUnitIcon()
 * falls through to the legacy glyph.
 *
 * The '.png' is NOT decoration and must not be "cleaned up": PixiJS's Assets loader
 * picks its parser from the URL EXTENSION, so an extensionless image URL decodes to an
 * empty texture and gets skipped -- the board silently keeps the legacy glyph and every
 * unit looks identical. The server accepts the suffix and strips it. (Caught on the first
 * deploy of REQ-0170; check_unit_icon.mjs now asserts it so it cannot regress.) */
export function unitArtUrl(icon: string): string {
  return '/api/art/' + encodeURIComponent(icon) + '.png';
}

/**
 * The raster manifest for Unit icons.
 *
 * Empty until REQ-0170: there was no unit art and, more to the point, no unit
 * IDENTITY to key art on. Both landed together -- a BP now carries `unit.id`, and
 * live_units.json says which artwork that id wears. So this list is now simply
 * "every unit def that declares an icon", exactly as REQ-0125a promised: art
 * arrives as DATA, and the renderer was never touched to receive it.
 */
// REQ-0266 (item 21): cosmetic skins arrive as DATA -- the same module-global
// idiom, for the same reason, as UNIT_DEFS above (three board components mount
// their own renderer and none should thread a content payload down to a texture
// loader). Three registries land here at boot: the unit_skin/1 defs and the
// resolved art URLs, BOTH keyed by SKIN id (ruling D-A -- /api/content is public
// and mtime-cached, so it can never carry per-player state), and the player's
// own PICKS from the authenticated GET /api/profile/:id/skins. Absence at every
// level is the NORMAL case (ruling D5: no migration ever wrote a skin row), so
// every getter here is total and returns null rather than inventing a default.

/** The picks half of /api/profile/:id/skins. EXPLICIT picks only -- the server's
 * resolveSkinPrefs filters unresolvable ones out and never injects defaults, so
 * an absent key genuinely means "this player never chose". */
export interface UnitSkinPrefs { unit?: Record<string, string | null> | null; bpskin?: Record<string, string | null> | null; }

let UNIT_SKINS: Record<string, UnitSkinEntryLike> = {};
let SKIN_ART_URLS: Record<string, string> = {};
let SKIN_PICKS: { unit: Record<string, string | null>; bpskin: Record<string, string | null> } = { unit: {}, bpskin: {} };

/** REQ-0266. Idempotent; safe to call again on a content hot-reload or after a
 * skin swap (pair it with sprites.ts's invalidateBoardTextures()). */
export function setUnitSkins(
  skins: Record<string, UnitSkinEntryLike> | null | undefined,
  artUrls?: Record<string, string> | null,
  prefs?: UnitSkinPrefs | null
): void {
  UNIT_SKINS = skins || {};
  SKIN_ART_URLS = artUrls || {};
  SKIN_PICKS = { unit: (prefs && prefs.unit) || {}, bpskin: (prefs && prefs.bpskin) || {} };
}

export function unitSkins(): Record<string, UnitSkinEntryLike> { return UNIT_SKINS; }

/** Adopted-render URL for one SKIN id, or null. Sparse by design: an unadopted
 * artwork has no entry, so the chain falls through instead of 404ing. */
export function skinArtUrl(skinId: string | null | undefined): string | null {
  if (!skinId) return null;
  const url = SKIN_ART_URLS[skinId];
  return typeof url === 'string' && url.length > 0 ? url : null;
}

/** The `profile` rung: this player's pick for (unit, slot), re-validated against
 * the defs so a pick for a deleted/re-slotted skin -- or one whose def never
 * listed this unit -- reads as ABSENT rather than blanking the unit. */
export function pickedSkinId(unitId: string | null | undefined, slot: UnitSkinSlot): string | null {
  if (!unitId) return null;
  const id = SKIN_PICKS[slot] ? SKIN_PICKS[slot][unitId] : null;
  if (typeof id !== 'string' || !id) return null;
  return unitSkinApplies(UNIT_SKINS[id], unitId, slot) ? id : null;
}

/** The `set` rung: the def-declared default for (unit, slot). */
export function defaultSkinId(unitId: string | null | undefined, slot: UnitSkinSlot): string | null {
  return defaultUnitSkinId(UNIT_SKINS, unitId, slot);
}

/** pick -> def default -> nothing. The ONE value the unit-portrait chain needs
 * (resolveUnitIcon keeps its 4 rungs and wants a single skin key); the BP chain
 * asks for the two rungs SEPARATELY, because bpSkinResolve reports WHICH rung
 * fired and collapsing them would make that report a lie. */
export function activeSkinId(unitId: string | null | undefined, slot: UnitSkinSlot): string | null {
  return pickedSkinId(unitId, slot) ?? defaultSkinId(unitId, slot);
}

/** Texture-map key for a unit's ACTIVE portrait skin, or null when it has none
 * or its artwork is not adopted. Feeds resolveUnitIcon's `skinKey` rung -- null,
 * NOT the default key, so a unit with no skin still reports rung 'default'. */
export function activeUnitSkinKey(unitId: string | null | undefined): string | null {
  if (!unitId) return null;
  const skinId = activeSkinId(unitId, 'unit');
  if (!skinId || !skinArtUrl(skinId)) return null;
  return unitIconKey(unitId, skinId);
}

export function unitIconRasters(): RasterEntry[] {
  const out: RasterEntry[] = [];
  for (const id of Object.keys(UNIT_DEFS)) {
    const icon = UNIT_DEFS[id]?.icon;
    if (typeof icon === 'string' && icon.length > 0) {
      out.push({ key: unitIconKey(id), url: unitArtUrl(icon) });
    }
    // REQ-0266: the SKINNED key form `unit:<id>@<skinId>`. unitIconKey has
    // supported it since REQ-0125a and is unit-tested on it; nothing had ever
    // EMITTED one. Only the RESOLVED-ACTIVE skin is emitted, never the whole
    // 108-def corpus -- eagerly loading every variant trades a blank board for
    // a slow one, and the resolver only ever asks for this one key.
    const skinId = activeSkinId(id, 'unit');
    const skinUrl = skinArtUrl(skinId);
    if (skinId && skinUrl) out.push({ key: unitIconKey(id, skinId), url: skinUrl });
  }
  return out;
}
