// client/src/lib/buildPower.ts -- REQ-0371 (build power readout on canvas).
//
// The DOCUMENTED reference aggregate shown on the canvas stats chip and on
// each sortie squad card. RECORDED DECISION (REQ-0371 spec item 1): the
// content-pipeline powerLevel (tools/autobalance_pack_powerlevel.cjs,
// REQ-0297) is a sim-driven all-pairs round-robin calibration and is NOT
// expressible from the client-side snapshot, so this is the spec's fallback:
//
//   power = round(totalHp + summed effect magnitudes of counted items)
//
//   * totalHp = sum over the canvas's BPs of (hpMax ?? 100). The 100 default
//     is the combat sim's own fallback (sim/lib/compile.cjs: `(typeof
//     bpDef.hpMax === 'number') ? bpDef.hpMax : 100`), so the chip's HP is
//     the HP the sim would actually fight with.
//   * effectMagnitude(def) = sum over the def's `effects` AST of mean(verb.n)
//     x hits (multi_strike only). Combat numerics are 2-int [lo,hi] ranges
//     (tools/eff_render.cjs v2) -> mean = (lo+hi)/2; legacy scalars count
//     as-is; verbs without a numeric `n` (pulse, status_immune, pct-based
//     grant_lifesteal, ...) count 0. The AST reaches the client because
//     server/lib/content.cjs serves each po/si entry via Object.assign({},
//     e, {eff_en, eff_ja}) -- the raw `effects` field rides along untyped,
//     read here tolerantly (the REQ-0141 state.guide cast-at-seam pattern).
//   * counted items: POs with loc === 'grid', plus SIs seated on one of
//     those POs ({po,si} host) or in the assembly 'bond' socket. 'inv' and
//     page-stowed items are excluded -- "items parked here take no effect"
//     (i18n app.inventoryNote).
//
// HONESTY LABEL: this is a REFERENCE number, never a battle prediction (the
// ragnarok.order.forecastTip convention) -- the chip/card tooltips say so.
// Pure data reads: no engine call, no store import, no Pixi (REQ-0371 rule 4).

interface EffVerbLike { t?: unknown; n?: unknown; hits?: unknown }
interface EffectLike { verb?: EffVerbLike | null }
interface HasEffects { effects?: unknown }

export interface PowerBP { hpMax?: number }
export interface PowerPO { uid?: string; id?: string; loc?: string }
export interface PowerSI { id?: string; host?: unknown }
export interface PowerCanvas { bps?: PowerBP[]; pos?: PowerPO[]; sis?: PowerSI[] }
export interface BuildPowerResult { hp: number; power: number }

/** The sim's BP max-HP fallback (sim/lib/compile.cjs) for a BP that predates
 * the REQ-0036 hpMax field. */
export const DEFAULT_BP_HP = 100;

function meanOf(n: unknown): number {
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  if (Array.isArray(n) && n.length === 2 && typeof n[0] === 'number' && typeof n[1] === 'number') {
    return (n[0] + n[1]) / 2;
  }
  return 0;
}

/** Summed effect magnitudes of one content def (see module header). Tolerant:
 * a def without a well-formed `effects` array contributes 0. */
export function effectMagnitude(def: unknown): number {
  const effects = (def as HasEffects | null | undefined)?.effects;
  if (!Array.isArray(effects)) return 0;
  let sum = 0;
  for (const e of effects) {
    const verb = (e as EffectLike | null | undefined)?.verb;
    if (!verb) continue;
    const base = meanOf(verb.n);
    if (base <= 0) continue;
    const hits = verb.t === 'multi_strike' && typeof verb.hits === 'number' && verb.hits > 0 ? verb.hits : 1;
    sum += base * hits;
  }
  return sum;
}

/** HP + reference power for one canvas ({bps,pos,sis} -- the live top-level
 * state or a presets.store[] squad snapshot). `items`/`siDefs` are the served
 * gameData.ITEMS / gameData.SI_DEFS maps; pass null/undefined while content
 * is still loading and only the (def-free) HP sum is produced. */
export function buildPower(
  canvas: PowerCanvas | null | undefined,
  items: Record<string, unknown> | null | undefined,
  siDefs: Record<string, unknown> | null | undefined,
): BuildPowerResult {
  let hp = 0;
  for (const bp of canvas?.bps ?? []) {
    hp += bp && typeof bp.hpMax === 'number' ? bp.hpMax : DEFAULT_BP_HP;
  }
  let offense = 0;
  const gridUids = new Set<string>();
  for (const po of canvas?.pos ?? []) {
    if (!po || po.loc !== 'grid') continue;
    if (typeof po.uid === 'string') gridUids.add(po.uid);
    if (typeof po.id === 'string' && items) offense += effectMagnitude(items[po.id]);
  }
  for (const si of canvas?.sis ?? []) {
    if (!si || typeof si.id !== 'string' || !siDefs) continue;
    const host = si.host as { po?: unknown } | string | null | undefined;
    const seatedOnGridPO = typeof host === 'object' && host !== null
      && typeof host.po === 'string' && gridUids.has(host.po);
    if (!seatedOnGridPO && host !== 'bond') continue;
    offense += effectMagnitude(siDefs[si.id]);
  }
  return { hp, power: Math.round(hp + offense) };
}
