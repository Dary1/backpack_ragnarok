// client/src/board/skin/unitSkinRegistry.ts -- REQ-0180. The unit_skin/1 SET
// registry + resolution. A unit_skin pairs `art_unit` (a kind=unit artwork
// system_name -> the Unit core art) with `bpskin` (a bpskin/1 def id -> the
// silhouette skin). Loaded once at boot (store/boot.ts) before any board
// mounts, exactly like unitIcon.ts's UNIT_DEFS manifest. The resolver answers
// "which set does THIS placement wear?" -- per-placement override beats the
// Unit def default beats nothing. Pure; no Pixi/DOM/IO.
import type { UnitSkinDef, UnitSkinMap } from '../../engine/engine.d.ts';
import { unitArtUrl, unitSkinIconKey, type RasterEntry } from '../unitIcon';

export const UNIT_SKIN_KIND = 'unit_skin/1';

/** Structural validator (UGC-ready machine gate; sibling of skinRegistry.ts
 * validateSkinDef). A set needs both halves of the pair present. */
export function validateUnitSkinDef(def: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const d = def as Record<string, unknown>;
  if (!d || typeof d !== 'object') return { ok: false, errors: ['def is not an object'] };
  if (d.kind !== UNIT_SKIN_KIND) errors.push(`kind must be "${UNIT_SKIN_KIND}"`);
  if (typeof d.id !== 'string' || !d.id) errors.push('id required');
  if (typeof d.name !== 'string' || !d.name) errors.push('name required');
  if (typeof d.art_unit !== 'string' || !d.art_unit) errors.push('art_unit required (kind=unit artwork system_name)');
  if (typeof d.bpskin !== 'string' || !d.bpskin) errors.push('bpskin required (bpskin/1 def id)');
  return { ok: errors.length === 0, errors };
}

/** content/live/live_unit_skins.json ({entries:[...]}) -> id-keyed map. Invalid
 * entries are dropped (never throw): a malformed set is a non-event, exactly as
 * a malformed bpskin is for loadSkinDefs. */
export function loadUnitSkinDefs(doc: unknown): UnitSkinMap {
  const out: UnitSkinMap = {};
  const entries = (doc as { entries?: unknown[] })?.entries;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) { if (validateUnitSkinDef(e).ok) { const def = e as UnitSkinDef; out[def.id] = def; } }
  return out;
}

// ---- module registry (set once at boot, before any board mounts) ----
let UNIT_SKIN_DEFS: UnitSkinMap = {};
/** REQ-0180. Idempotent; safe to call again on a content hot-reload. */
export function setUnitSkinDefs(defs: UnitSkinMap | null | undefined): void { UNIT_SKIN_DEFS = defs || {}; }
export function getUnitSkinDef(key: string | null | undefined): UnitSkinDef | null { return (key && UNIT_SKIN_DEFS[key]) || null; }
/** REQ-0180 profile-availability floor: with no acquisition flow yet, EVERY
 * defined set is available. A future grant flow narrows this from the profile. */
export function allUnitSkinKeys(): string[] { return Object.keys(UNIT_SKIN_DEFS); }

/**
 * Which unit_skin key does THIS placement wear? Per-placement override
 * (bp.unit.skin) beats the Unit def default (UnitDef.unit_skin). Returns null
 * when neither is set -- the plain, un-skinned floor (no silhouette skin, legacy
 * icon). Pure. Total.
 */
export function resolveUnitSkinKey(
  placementSkin: string | null | undefined,
  unitDefaultSkin: string | null | undefined,
): string | null {
  if (typeof placementSkin === 'string' && placementSkin.length > 0) return placementSkin;
  if (typeof unitDefaultSkin === 'string' && unitDefaultSkin.length > 0) return unitDefaultSkin;
  return null;
}

/** The raster manifest for Unit-core art carried by unit_skin SETS: one entry
 * per set, keyed unitSkinIconKey(setKey) -> unitArtUrl(art_unit). Merged into
 * the same board texture map (namespaced `unitskin:*`, never colliding with
 * unit:* / item:* / icon-*). A set whose art 404s simply never lands in the map
 * and resolveUnitIcon falls through -- missing art never blocks. */
export function unitSkinIconRasters(): RasterEntry[] {
  const out: RasterEntry[] = [];
  for (const key of Object.keys(UNIT_SKIN_DEFS)) {
    const art = UNIT_SKIN_DEFS[key]?.art_unit;
    if (typeof art === 'string' && art.length > 0) out.push({ key: unitSkinIconKey(key), url: unitArtUrl(art) });
  }
  return out;
}
