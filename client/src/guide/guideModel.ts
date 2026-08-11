// client/src/guide/guideModel.ts -- REQ-0141 (canvas-first-run-guidance).
// The persisted guide-state SHAPE + the ordered first-run tour steps + pure
// typed accessors. No React, no side effects: the single source of truth for
// what the first-run guide is, shared by the controller (mutations), the
// overlay (render), and boot/loadGame (seed + round-trip).
//
// PERSISTENCE (decision, REQ-0141): the guide state rides in the persisted
// canvas as state.guide -- a CLIENT-ONLY UI field the engine and server never
// read (the profile canvas doc is opaque JSON/jsonb, so NO server/storage.cjs
// change is needed). It round-trips through the ONE auto-save PUT writer
// (client/src/store/autosave.ts) exactly like every other canvas mutation:
// migrateStateV2's deep clone preserves the field and loadGame copies it back.
// To keep the blast radius nil, boot ONLY writes this field for a genuinely
// fresh profile -- a returning/dev/e2e-fixture profile never gains a guide
// field (its saved canvas stays byte-unchanged) and simply shows no tour.
//
// RECONCILIATION with REQ-0051 starter units (recorded): a fresh guest is NOT
// seeded an empty canvas -- they get four starter-unit squads, each a filled
// 5x5 BP whose POs are fixed (immovable), carry NO ports and NO sockets, and
// whose Unit connection_shape is none (casts no link beams). So the spec ideal
// gated-on-doing build (drop a free PO, seat an SI, ignite a first link beam)
// is UNREACHABLE with starter-only content: no free PO to drop, no socket to
// seat into, no ray-casting Unit to light (two 5x5 starter BPs may not co-fit
// one canvas). The first-run guide is therefore a PROGRESSIVE-DISCLOSURE
// ORIENTATION tour over the starter canvas the guest already has -- revealing
// one placement layer at a time (Canvas -> BP -> PO -> Unit -> Link) and
// pointing at the Moment (P2) rather than forcing an action the fixed starter
// content cannot afford. The learn-by-doing for movable-content mechanics is
// delivered by the CONTEXTUAL HINTS that fire the first time the player
// genuinely performs each action LATER, once real content is earned.
import type { GameState } from '../engine/engine.d.ts';

export type GuideStatus = 'active' | 'skipped' | 'done';
export type GuideHintId = 'rotation' | 'tagMismatch' | 'dudBeam';

// REQ-0376: the halls that carry a first-visit card. One per nav destination
// whose LAWS are otherwise stated nowhere -- the canvas is covered by the tour
// above, the Dex carries the glossary, and Ragnarok/Friends have no laws to
// state yet. Order is the nav-rail order, and is the order the e2e gate walks.
export type HallId = 'schedule' | 'sortie' | 'warehouse' | 'workshop' | 'market';
export const HALL_IDS: readonly HallId[] = ['schedule', 'sortie', 'warehouse', 'workshop', 'market'] as const;

/** How many law lines each hall card states -- the i18n keys are
 * guide.hall.<id>.law1 .. law<N>, plus guide.hall.<id>.title. Keeping the count
 * HERE (rather than counting keys at runtime) is what keeps TranslationKey a
 * compile-time union: every key this table implies exists literally in
 * src/i18n/guide.ts, so the barrel's en/ja parity gate covers them like any
 * other chrome string. */
export const HALL_LAW_COUNT: Readonly<Record<HallId, number>> = {
  schedule: 3, sortie: 4, warehouse: 4, workshop: 3, market: 4,
};

export interface GuidePersisted {
  status: GuideStatus;
  /** index into GUIDE_STEPS; meaningful only while status === active. */
  step: number;
  /** true once the user has engaged the guide (advanced past the first card,
   * skipped, finished, or replayed). Gates contextual hints to the onboarding
   * cohort. */
  seen: boolean;
  /** first-time contextual-hint seen-flags. */
  hints: Partial<Record<GuideHintId, boolean>>;
  /** REQ-0376: per-hall first-visit card seen-flags. OPTIONAL on purpose --
   * every guide record persisted before REQ-0376 lacks it, and those records
   * must round-trip through the auto-save PUT untouched. Absent === nothing
   * dismissed yet, which is exactly what an unflagged veteran should mean. */
  halls?: Partial<Record<HallId, boolean>>;
}

/** One step of the first-run tour. id keys the i18n copy
 * (guide.step.<id>.title / .body) and the optional spotlight target. */
export interface GuideStep {
  id: string;
  spot: 'bp' | 'po' | 'unit' | 'links' | 'none';
}

// One card at a time, revealing the placement stack in the same order the
// design layers it (canvas_spec.md: Canvas -> BP -> PO -> Unit -> Link).
export const GUIDE_STEPS: GuideStep[] = [
  { id: 'bp', spot: 'bp' },
  { id: 'po', spot: 'po' },
  { id: 'unit', spot: 'unit' },
  { id: 'links', spot: 'links' },
  { id: 'depart', spot: 'none' },
];

export const GUIDE_STEP_COUNT = GUIDE_STEPS.length;

export function defaultGuide(status: GuideStatus): GuidePersisted {
  return { status, step: 0, seen: false, hints: {}, halls: {} };
}

/** REQ-0376: has this hall's first-visit card already been dismissed? A null
 * guide (a profile that has never carried the field) answers false -- it has
 * dismissed nothing -- WITHOUT the record being created; only a dismiss creates
 * it (see guideController.markHallSeen). */
export function isHallSeen(g: GuidePersisted | null, hall: HallId): boolean {
  return Boolean(g?.halls?.[hall]);
}

// GameState is intentionally NOT widened with this client-only field (it would
// pollute the shared, drift-checked engine surface). We cast at the seam.
type GuidedState = GameState & { guide?: GuidePersisted };

/** Reads the guide record off a GameState, or null when absent. Never mutates. */
export function readGuide(st: GameState | null | undefined): GuidePersisted | null {
  if (!st) return null;
  return (st as GuidedState).guide ?? null;
}

/** Writes (replaces) the guide record on a GameState in place. */
export function writeGuide(st: GameState, g: GuidePersisted): GameState {
  (st as GuidedState).guide = g;
  return st;
}
