// client/src/board/skin/skinRegistry.ts -- REQ-0126. The `bpskin/1` ASSET KIND
// (pipeline §1/§6, spec item 3): schema for a Backpack Skin def, a structural
// validator (UGC-ready machine gate), and the content/live/live_bpskins.json
// loader. A skin themes edge design + interior fill and NOTHING gameplay
// (BS-G1). This REQ ships the SYSTEM with no real raster art, so a def carries
// a `palette` the procedural compositor renders from; `art` raster keys are
// OPTIONAL and, when absent/unresolvable, the renderer falls through -- missing
// art never blocks. Pure.
export const BPSKIN_KIND = "bpskin/1";
export const NEUTRAL_ID = "neutral";
export interface BpSkinArt { fill_texture?: string | null; frame_band_px?: number | null; tile_fill_override?: string | null; edge_tiles?: { straight?: string; outer_corner?: string; inner_corner?: string }; clip_masks?: { straight?: string; outer_corner?: string; inner_corner?: string }; }
export interface BpSkinPalette { canvas?: string; fill: string; fill2?: string; welt?: string; }
export interface BpSkinDef {
  kind: typeof BPSKIN_KIND; id: string; name: string; i18n?: { ja?: { name?: string } };
  set?: string | null; palette: BpSkinPalette; corner_radius: number; border_band: number; art?: BpSkinArt; neutral?: boolean;
}
const HEX = /^#[0-9a-fA-F]{6}$/;
export interface ValidationResult { ok: boolean; errors: string[]; }
export function validateSkinDef(def: unknown): ValidationResult {
  const errors: string[] = [];
  const d = def as Record<string, unknown>;
  if (!d || typeof d !== "object") return { ok: false, errors: ["def is not an object"] };
  if (d.kind !== BPSKIN_KIND) errors.push(`kind must be "${BPSKIN_KIND}"`);
  if (typeof d.id !== "string" || !d.id) errors.push("id required");
  if (typeof d.name !== "string" || !d.name) errors.push("name required");
  const pal = d.palette as Record<string, unknown> | undefined;
  if (!pal || typeof pal !== "object") errors.push("palette required");
  else {
    if (typeof pal.fill !== "string" || !HEX.test(pal.fill)) errors.push("palette.fill must be #rrggbb");
    for (const k of ["canvas", "fill2", "welt"]) { const v = pal[k]; if (v !== undefined && (typeof v !== "string" || !HEX.test(v))) errors.push(`palette.${k} must be #rrggbb`); }
  }
  if (typeof d.corner_radius !== "number" || d.corner_radius < 0) errors.push("corner_radius must be >= 0");
  if (typeof d.border_band !== "number" || d.border_band < 0) errors.push("border_band must be >= 0");
  return { ok: errors.length === 0, errors };
}
export function isNeutral(def: BpSkinDef): boolean { return def.neutral === true || def.id === NEUTRAL_ID; }
// ---------------------------------------------------------------------------
// REQ-0266: unit_skin-derived defs.
//
// A `unit_skin/1` def whose `slot` is "bpskin" IS a backpack skin -- ruling D1
// says one content kind carries both meanings and `slot` discriminates. Rather
// than teach the compositor a second def shape, such an entry is PROJECTED onto
// the bpskin/1 shape this module already validates and composites: the palette /
// corner_radius / border_band come from the neutral house def (so the welt and
// edge treatment stay the ratified ones) and `art.fill_texture` points at the
// art_urls entry for that SKIN's id -- the D-A key. `BpSkinArt.fill_texture` has
// been a declared-but-never-read field since REQ-0126; this is what starts
// reading it (composite.ts's raster path).
//
// A skin whose artwork is not adopted simply has no art_urls entry, so
// fill_texture stays null and the def renders palette-procedural. That is the
// documented degrade, not a gap: never an error, never a blank BP.
// ---------------------------------------------------------------------------

/** The served unit_skin/1 def, as this module needs it. Structurally identical
 * to shared/dto's ApiUnitSkinEntry, declared locally so board/skin/ keeps its
 * zero-import purity (the offline harnesses ssr-load these modules directly). */
export interface UnitSkinEntryLike {
  id: string; name: string; slot: string; art_ref: string; units: string[];
  default?: boolean; set?: string | null; i18n?: { ja?: { name?: string } };
  /** REQ-0291: the bpskin frame band thickness in SOURCE px (= the artwork's
   * edge_padding). Projected onto def.art.frame_band_px; null/0/absent => legacy
   * palette welt, zero behaviour change. */
  edge_padding?: number | null;
}
export type UnitSkinSlot = "unit" | "bpskin";
export const UNIT_SKIN_SLOTS: ReadonlyArray<UnitSkinSlot> = ["unit", "bpskin"];

/** The def-declared default skin for one (unit, slot). REQ-0266 §3.1 makes at
 * most one default per pair a validation FAIL server-side, so this is a lookup
 * rather than a choice; the first match wins if a corpus ever slips through. */
export function defaultUnitSkinId(
  skins: Record<string, UnitSkinEntryLike> | null | undefined,
  unitId: string | null | undefined,
  slot: UnitSkinSlot
): string | null {
  if (!skins || !unitId) return null;
  for (const id of Object.keys(skins)) {
    const e = skins[id];
    if (!e || e.slot !== slot || e.default !== true) continue;
    if (Array.isArray(e.units) && e.units.indexOf(unitId) >= 0) return e.id || id;
  }
  return null;
}

/** True when `entry` may dress `unitId` in `slot` -- the same law the PUT route
 * enforces server-side, re-checked here so a stale client pick cannot paint a
 * skin onto a unit its def never listed. */
export function unitSkinApplies(entry: UnitSkinEntryLike | null | undefined, unitId: string | null | undefined, slot: UnitSkinSlot): boolean {
  if (!entry || !unitId) return false;
  return entry.slot === slot && Array.isArray(entry.units) && entry.units.indexOf(unitId) >= 0;
}

/** The house baseline a derived def inherits its non-art properties from. */
const FALLBACK_BASE = { palette: { fill: "#3a3a3a", welt: "#2a2a2a" } as BpSkinPalette, corner_radius: 6, border_band: 3 };

/** Projects one `slot:"bpskin"` unit_skin onto the bpskin/1 def shape. */
export function bpSkinDefFromUnitSkin(entry: UnitSkinEntryLike, artUrl: string | null | undefined, base?: BpSkinDef | null): BpSkinDef {
  const src = base ?? (FALLBACK_BASE as unknown as BpSkinDef);
  return {
    kind: BPSKIN_KIND, id: entry.id, name: entry.name,
    i18n: entry.i18n, set: entry.set ?? null,
    palette: { ...src.palette },
    corner_radius: src.corner_radius, border_band: src.border_band,
    art: { fill_texture: typeof artUrl === "string" && artUrl.length > 0 ? artUrl : null,
           frame_band_px: typeof entry.edge_padding === "number" && entry.edge_padding > 0 ? entry.edge_padding : null },
  };
}

export interface LoadSkinDefsOptions {
  /** /api/content's `unit_skins`, keyed by skin id (REQ-0266 D-A). */
  unitSkins?: Record<string, UnitSkinEntryLike> | null;
  /** /api/content's `art_urls`, keyed by SKIN id -- NOT by unit id (D-A). */
  artUrls?: Record<string, string> | null;
}

/** Loads content/live/live_bpskins.json's `{entries:[...]}` document, and (REQ-0266)
 * the unit_skin-derived defs on top of it. Every def -- authored or derived --
 * goes through validateSkinDef(), which is the UGC-ready machine gate this module
 * exists for; a def that fails is dropped, never thrown on. Authored ids win over
 * derived ones so a hand-authored override is always reachable. */
export function loadSkinDefs(doc: unknown, opts?: LoadSkinDefsOptions): Record<string, BpSkinDef> {
  const out: Record<string, BpSkinDef> = {};
  const entries = (doc as { entries?: unknown[] })?.entries;
  if (Array.isArray(entries)) {
    for (const e of entries) { if (validateSkinDef(e).ok) { const def = e as BpSkinDef; out[def.id] = def; } }
  }
  const unitSkins = opts?.unitSkins;
  if (unitSkins) {
    const base = out[NEUTRAL_ID] ?? null;
    for (const id of Object.keys(unitSkins)) {
      const entry = unitSkins[id];
      if (!entry || entry.slot !== "bpskin" || typeof entry.id !== "string" || !entry.id) continue;
      if (out[entry.id]) continue; // an authored def of the same id wins
      const derived = bpSkinDefFromUnitSkin(entry, opts?.artUrls ? opts.artUrls[entry.id] : null, base);
      if (validateSkinDef(derived).ok) out[derived.id] = derived;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The live registry. A module-global for the same reason unitIcon.ts's UNIT_DEFS
// is one (see its comment at unitIcon.ts): three independent board components
// mount their own BoardRenderer and none of them has any business threading the
// content payload down to a compositor. Set ONCE at boot (store/boot.ts).
// ---------------------------------------------------------------------------
let BP_SKIN_DEFS: Record<string, BpSkinDef> = {};
/** Idempotent; safe to call again on a content hot-reload. */
export function setBpSkinDefs(defs: Record<string, BpSkinDef> | null | undefined): void { BP_SKIN_DEFS = defs || {}; }
export function bpSkinDefs(): Record<string, BpSkinDef> { return BP_SKIN_DEFS; }
/** The `has(id)` predicate bpSkinResolve.ts takes -- availability injected, so
 * the chain is exercised from plain Node with a bare object. */
export function hasBpSkin(id: string): boolean { return Object.prototype.hasOwnProperty.call(BP_SKIN_DEFS, id); }
