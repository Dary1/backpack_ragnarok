// client/src/forecast/pressure.ts -- REQ-0057: the client's thin bridge
// between the game board and shared/forecast.mjs's fold.
//
// It does three things and no more:
//   1. turns the CURRENT squad canvas into the occupancy set the walker
//      needs (which cells a ray would actually hit / penetrate / land on),
//   2. runs shared/forecast.mjs's forecastPressure() over the chosen
//      formation box,
//   3. memoises the answer, so re-rendering React 30 times while a drag is
//      in flight does not re-walk 144 rays 30 times.
//
// The forecast MATH lives entirely in shared/forecast.mjs -- the module
// sim/tests/forecast_parity.cjs proves byte-equal to sim/lib/ray.cjs's
// walkRay. Nothing in this file may re-derive a ray, a bounce, or an entry
// cell: if a number is wrong, it is wrong in the shared module and the
// parity gate should have caught it.
import {
  boxCells,
  canvasToField,
  cellKey,
  forecastPressure,
  parseBox,
  type ForecastCell,
  type ForecastResult,
} from '../../../shared/forecast.mjs';
import type { ApiForecastPayload } from '../api';
import type { EngineInstance, GameState } from '../engine/engine.d.ts';

export type { ForecastCell, ForecastResult };

/**
 * The rays' occupants on the player field are BACKPACKS (sim compiles one
 * actor per BP -- sim/lib/compile.cjs), not individual items: a ray that
 * enters any cell of a BP hits that BP. So occupancy is exactly the BP
 * footprint map the engine already keeps (engine.cellBPMap -> "r,c" -> bpId
 * on the LOCAL 8x8 canvas), lifted into A1:Z18 field coordinates through the
 * squad's formation box.
 *
 * Items placed INSIDE a backpack are not separate occupants and must not be
 * added here -- they are already inside their BP's footprint. An item can
 * never sit on a cell no BP covers (the engine forbids it), so the BP map is
 * complete by construction.
 */
export function occupiedFieldCells(
  engine: EngineInstance,
  state: GameState,
  box: ReturnType<typeof parseBox>,
): Set<string> {
  const out = new Set<string>();
  const map = engine.cellBPMap(state); // "r,c" (1-indexed, local 8x8) -> bpId
  for (const localKey of Object.keys(map)) {
    const parts = localKey.split(',');
    const r = Number(parts[0]);
    const c = Number(parts[1]);
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
    // canvasToField takes 0-indexed canvas offsets; the engine's map is
    // 1-indexed, hence the -1s.
    const f = canvasToField(box, r - 1, c - 1);
    out.add(cellKey(f[0], f[1]));
  }
  return out;
}

/** A cheap, order-stable fingerprint of the occupancy set (memo key). */
function occupancySignature(occupied: Set<string>): string {
  return Array.from(occupied).sort().join(';');
}

export interface PressureInput {
  payload: ApiForecastPayload;
  formationId: string;
  slot: string;
  engine: EngineInstance;
  state: GameState;
}

export interface PressureView {
  result: ForecastResult;
  /** Field cells of the squad's 8x8 box, row-major (canvas order). */
  cells: Array<[number, number]>;
  box: ReturnType<typeof parseBox>;
  min: number;
  max: number;
  /** Milliseconds the fold took -- surfaced so the perf budget is observable. */
  ms: number;
}

let memoKey: string | null = null;
let memoValue: PressureView | null = null;

/**
 * Compute (or return the memoised) pressure map for the current board.
 * Returns null when the chosen formation/slot is not in the payload (a
 * content change could retire a formation while a stale setting points at
 * it -- degrade to "no overlay", never throw).
 */
export function computePressure(input: PressureInput): PressureView | null {
  const { payload, formationId, slot, engine, state } = input;
  const formation = payload.formations.find((f) => f.id === formationId);
  const boxStr = formation?.canvases[slot];
  if (!boxStr) return null;

  const box = parseBox(boxStr);
  const occupied = occupiedFieldCells(engine, state, box);
  const k = [
    payload.dungeonType, payload.level, formationId, slot,
    payload.profiles.length, occupancySignature(occupied),
  ].join('|');
  if (memoKey === k && memoValue) return memoValue;

  const cells = boxCells(box);
  const t0 = performance.now();
  const result = forecastPressure({
    bounds: payload.bounds,
    jitterHalfWidth: payload.jitterHalfWidth,
    profiles: payload.profiles,
    cells,
    occupied,
  });
  const ms = performance.now() - t0;

  let min = Infinity;
  for (const cell of result.perCell.values()) if (cell.damage < min) min = cell.damage;
  if (!Number.isFinite(min)) min = 0;

  memoKey = k;
  memoValue = { result, cells, box, min, max: result.max, ms };
  return memoValue;
}

/**
 * Tint ramp: 0 -> cold, 1 -> hot.
 *
 * NORMALISED OVER THE OBSERVED [min, max] OF THIS BOARD, not over [0, max].
 * That is a deliberate display choice with a real reason: sim's 5-bounce
 * all-field terminator (ray_hit_all) strikes every occupant wherever it
 * stands, so a large, perfectly FLAT slab of pressure sits under every cell
 * of the map. Normalising from zero would spend the whole colour ramp on
 * that slab and render the actual placement signal -- which is the entire
 * point of the overlay -- as a uniform wash. The legend prints the true
 * dmg/s at both ends so the compression is never hidden from the player.
 */
export function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  // 205deg (cold slate-blue) -> 0deg (red), through amber. Alpha stays low
  // so the board's own art, item icons and link beams read THROUGH the tint:
  // this is a lens over the board, not a replacement for it.
  const hue = 205 - 205 * x;
  const alpha = 0.16 + 0.34 * x;
  return `hsla(${hue.toFixed(0)}, 82%, 52%, ${alpha.toFixed(3)})`;
}

/** Normalised position of `damage` within the board's own [min, max]. */
export function heatT(damage: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return (damage - min) / (max - min);
}
