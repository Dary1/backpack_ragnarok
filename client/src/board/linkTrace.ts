// client/src/board/linkTrace.ts -- REQ-0142 link-trace diagnostics: the
// READ-ONLY query layer behind the beam overlay and the "why not" panel.
//
// P2 ("The Moment is sacred") puts every gram of tension in ARRANGEMENT, so
// the beam graph must be readable and debuggable BEFORE sortie. With
// 8-direction beams, first-hit-only resolution and mutual links, an
// unaided player reads spaghetti. This module turns the engine's beam facts
// into the answers a player actually asks: "who does this Unit link?",
// "why is THAT link not happening?".
//
// ENGINE IS CONSUMED AS-IS (REQ-0142 non-goal: "no engine changes"). Every
// LINKED/DUD/MUTUAL fact below comes straight out of engine.traceBeams();
// this module adds exactly one thing the engine never needed to compute for
// itself: what else stands on a ray BEYOND the first hit (the beam the
// first-hit rule consumed), plus the same walk for the directions a Unit
// does NOT have enabled. Those two extensions are what make the three
// "why not" reasons answerable:
//
//   'blocked'        -- the ray does reach the expected receiver, but a
//                       NEARER Unit consumed the first hit (canvas_spec:
//                       "the link beam can not penetrate ... one link
//                       direction only one first hit").
//   'no-receiver'    -- the beam is fired but no Unit stands anywhere on
//                       the ray (an intentional dud is legitimate design --
//                       canvas_spec's F2/C8 examples -- so this is MARKED,
//                       never nagged about).
//   'dir-not-in-set' -- the direction is not in the Unit's dirs set, so no
//                       beam is fired down it at all (even if a Unit sits
//                       right there, waiting).
//
// Pure by construction: no Pixi, no DOM, no store -- engine + state + layout
// in, plain data out. That is what lets client/scripts/check_link_trace.mjs
// drive the REAL module from plain Node (same rig as check_unit_icon.mjs).
import type { BP, Cell, EngineInstance, GameState, Layout } from '../engine/engine.d.ts';

/** Compass names for dirs 0..7 -- engine.js's DIRS order
 * (0=N,1=NE,2=E,3=SE,4=S,5=SW,6=W,7=NW). Display-side labels only; the
 * engine never names them. */
export const DIR_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** What the beam down ONE direction is doing.
 *  - 'linked'   : fired, and a receiver took it (a BP link exists).
 *  - 'dud'      : fired, nothing on the ray. Legitimate (see module doc).
 *  - 'inactive' : not fired -- direction not in this Unit's set. */
export type BeamStatus = 'linked' | 'dud' | 'inactive';

/** The row-level diagnosis. 'linked' is the happy path; the other three are
 * REQ-0142's three "why not" reasons, one per absent-link cause. */
export type TraceReason = 'linked' | 'blocked' | 'no-receiver' | 'dir-not-in-set';

/** A Unit standing on a ray, with the cell it stands on. */
export interface RayHit {
  bp: string;
  cell: Cell;
}

export interface DirTrace {
  dir: number;
  /** direction is in the Unit's dirs set (a beam is actually fired) */
  active: boolean;
  /** cells the beam traverses: origin-exclusive, first-hit-inclusive, or to
   * the board edge when nothing is hit. For an INACTIVE direction this is
   * the path the beam WOULD traverse if the direction were enabled -- that
   * hypothetical is precisely the diagnostic. */
  path: Cell[];
  /** first-hit receiver BP id (engine's own answer), or null */
  to: string | null;
  /** both Units target each other (engine's own answer) */
  mutual: boolean;
  status: BeamStatus;
  reason: TraceReason;
  /** every Unit standing on this ray, NEAREST FIRST (independent of
   * `active` -- an inactive direction still has a ray). */
  unitsOnRay: RayHit[];
  /** Units the first-hit rule consumed the beam before reaching -- i.e.
   * unitsOnRay beyond the nearest. These are the expected-but-absent links
   * that the 'blocked' reason explains. */
  shadowed: string[];
  /** the Unit that took the first hit and therefore shadows the rest --
   * null when nothing is on the ray. Set even for an INACTIVE direction
   * (it is who WOULD receive, and that is the useful thing to say). */
  firstOnRay: RayHit | null;
}

export interface UnitTrace {
  bp: string;
  /** the Unit's own cell (beam origin) */
  cell: Cell;
  /** always 8 entries; index === dir */
  dirs: DirTrace[];
  /** receivers this Unit currently links (dirs with a first hit) */
  linked: string[];
  /** receivers with which this Unit is MUTUALLY linked */
  mutualWith: string[];
  /** active dirs that hit nothing (intentional duds are legal) */
  duds: number[];
  /** every expected-but-absent link explained by the first-hit rule */
  blocked: { dir: number; target: string; blockedBy: string; at: Cell }[];
}

/** Pair query: "why is A NOT linking B?". Adds one reason the per-direction
 * rows cannot express, because it is not about any single direction:
 * 'not-aligned' -- B does not stand on ANY of A's eight rays, so no beam
 * direction could ever reach it. */
export type PairReason = TraceReason | 'not-aligned' | 'self' | 'unknown-bp';

export interface PairVerdict {
  reason: PairReason;
  /** the direction B lies on (null when not aligned / unknown) */
  dir: number | null;
  /** for 'blocked': who took the first hit, and where */
  blockedBy?: string;
  at?: Cell;
}

function bpById(state: GameState, id: string): BP | null {
  return state.bps.find((b) => b.id === id) ?? null;
}

/** Every cell of the ray leaving `from` in direction `dir`, up to the board
 * edge. Deliberately the SAME walk engine.js's traceBeams() does (same DIRS
 * step, same 1..ROWS/1..COLS bounds) -- but it does NOT stop at the first
 * Unit, which is the whole point: what lies behind the first hit is the
 * information the engine has no reason to keep, and the player has every
 * reason to want. */
export function rayCells(engine: EngineInstance, layout: Layout, from: Cell, dir: number): Cell[] {
  const step = engine.DIRS[dir];
  const out: Cell[] = [];
  let r = from[0];
  let c = from[1];
  for (;;) {
    r += step[0];
    c += step[1];
    if (r < 1 || r > layout.ROWS || c < 1 || c > layout.COLS) break;
    out.push([r, c]);
  }
  return out;
}

/**
 * Full 8-direction trace for ONE Unit. Returns null for an unknown BP id.
 *
 * The engine's traceBeams() is the authority for the ACTIVE directions
 * (path/to/mutual are copied from it, never recomputed); the ray walk here
 * only supplies what it never had to: the units standing further down each
 * ray, and the hypothetical ray of every direction the Unit has switched
 * off.
 */
export function traceUnit(engine: EngineInstance, state: GameState, layout: Layout, bpId: string): UnitTrace | null {
  const bp = bpById(state, bpId);
  if (!bp) return null;
  const origin = engine.unitCell(bp);
  const units = engine.unitMap(state); // cellKey -> BP id
  const beams = engine.traceBeams(state);
  // REQ-0170: the ACTIVE directions are the Unit's connection_shape, resolved
  // through the engine's registry -- not a per-BP dirs array (that field is gone).
  // An offset shape (knight jump) has no ray directions at all, so every one of the
  // 8 dirs below traces as INACTIVE for it: the panel then shows the player exactly
  // what is true -- this Unit fires no rays, and whatever stands on those lines is
  // irrelevant to it.
  const connShape = engine.connShapeOf(bp);
  const activeDirs = new Set<number>(connShape && connShape.kind === 'ray' ? (connShape.dirs ?? []) : []);

  const dirs: DirTrace[] = [];
  const blocked: UnitTrace['blocked'] = [];
  const linked: string[] = [];
  const mutualWith: string[] = [];
  const duds: number[] = [];

  for (let d = 0; d < 8; d++) {
    const cells = rayCells(engine, layout, origin, d);
    const unitsOnRay: RayHit[] = [];
    for (const cell of cells) {
      const hit = units[engine.key(cell[0], cell[1])];
      // A Unit never receives its own beam; the engine's own walk starts
      // one step off the origin, so this can only trigger on a malformed
      // state, but the guard keeps the two walks honestly identical.
      if (hit && hit !== bpId) unitsOnRay.push({ bp: hit, cell });
    }
    const firstOnRay = unitsOnRay[0] ?? null;
    const shadowed = unitsOnRay.slice(1).map((h) => h.bp);
    const active = activeDirs.has(d);
    const beam = active ? beams.find((b) => b.from === bpId && b.dir === d) ?? null : null;
    const to = beam ? beam.to : null;
    const mutual = beam ? beam.mutual : false;

    let status: BeamStatus;
    let reason: TraceReason;
    if (!active) {
      status = 'inactive';
      reason = 'dir-not-in-set';
    } else if (to) {
      status = 'linked';
      reason = shadowed.length > 0 ? 'blocked' : 'linked';
    } else {
      status = 'dud';
      reason = 'no-receiver';
    }

    // Path: the engine's own for a fired beam; the equivalent hypothetical
    // walk for a direction that fires nothing (stop at the Unit it would
    // have hit, exactly as the engine would have).
    const path: Cell[] = beam
      ? beam.path
      : firstOnRay
        ? cells.slice(0, cells.findIndex((c) => c[0] === firstOnRay.cell[0] && c[1] === firstOnRay.cell[1]) + 1)
        : cells;

    if (active && to) {
      linked.push(to);
      if (mutual) mutualWith.push(to);
      for (const s of shadowed) {
        blocked.push({ dir: d, target: s, blockedBy: to, at: firstOnRay!.cell });
      }
    }
    if (active && !to) duds.push(d);

    dirs.push({ dir: d, active, path, to, mutual, status, reason, unitsOnRay, shadowed, firstOnRay });
  }

  return { bp: bpId, cell: origin, dirs, linked, mutualWith, duds, blocked };
}

/**
 * "Why is `fromBp` not linking `toBp`?" -- the pair-shaped view of the same
 * facts, for when the player is asking about a specific expected link rather
 * than reading one Unit's whole fan.
 *
 * Note 'no-receiver' is unreachable here BY CONSTRUCTION and that is
 * correct: if the pair is aligned at all, then `toBp` itself stands on the
 * ray, so the ray is never empty. The dud reason belongs to a DIRECTION, not
 * to a pair -- which is exactly why the panel renders per-direction rows.
 */
export function whyNotPair(engine: EngineInstance, state: GameState, layout: Layout, fromBp: string, toBp: string): PairVerdict {
  if (fromBp === toBp) return { reason: 'self', dir: null };
  const trace = traceUnit(engine, state, layout, fromBp);
  if (!trace || !bpById(state, toBp)) return { reason: 'unknown-bp', dir: null };

  const on = trace.dirs.find((d) => d.unitsOnRay.some((h) => h.bp === toBp));
  if (!on) return { reason: 'not-aligned', dir: null };
  if (!on.active) return { reason: 'dir-not-in-set', dir: on.dir };
  if (on.to === toBp) return { reason: 'linked', dir: on.dir };
  return { reason: 'blocked', dir: on.dir, blockedBy: on.firstOnRay!.bp, at: on.firstOnRay!.cell };
}

/** Cell -> the human "column-letter + row-number" label the canvas_spec's own
 * worked example uses (C2, F2, I8 ...). Columns are 1-based -> A, B, C ...
 * Display-only; nothing in the engine knows this notation. */
export function cellLabel(cell: Cell): string {
  const [r, c] = cell;
  return `${String.fromCharCode(64 + c)}${r}`;
}
