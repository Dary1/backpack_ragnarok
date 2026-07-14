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
export interface BpSkinArt { fill_texture?: string | null; tile_fill_override?: string | null; edge_tiles?: { straight?: string; outer_corner?: string; inner_corner?: string }; clip_masks?: { straight?: string; outer_corner?: string; inner_corner?: string }; }
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
export function loadSkinDefs(doc: unknown): Record<string, BpSkinDef> {
  const out: Record<string, BpSkinDef> = {};
  const entries = (doc as { entries?: unknown[] })?.entries;
  if (!Array.isArray(entries)) return out;
  for (const e of entries) { if (validateSkinDef(e).ok) { const def = e as BpSkinDef; out[def.id] = def; } }
  return out;
}
