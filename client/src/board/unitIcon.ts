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

/**
 * The raster manifest for Unit icons.
 *
 * EMPTY BY DESIGN as of REQ-0125a, and that is the whole point: it is the one
 * place art gets plugged in. Returning [] means every BP resolves to the
 * legacy glyph and the board is pixel-identical to pre-REQ-0125a -- which is
 * this REQ's stated, intended end state (a seam plus a proof it falls
 * through), NOT an unfinished edge.
 *
 * REQ-0127 lands the roster PNGs; REQ-0125b lands the identity that keys them
 * (and, with REQ-0126, the active-skin selection). Neither needs to touch the
 * renderer -- they populate this list.
 */
export function unitIconRasters(): RasterEntry[] {
  return [];
}
