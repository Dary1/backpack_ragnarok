// client/src/sortie/sortiePrefs.ts -- REQ-0371 (attack-level prefill).
//
// PERSISTENCE (the REQ-0141 state.guide precedent, verbatim): the last-used
// attackLv rides in the persisted canvas as state.sortie -- a CLIENT-ONLY UI
// field the engine and server never read (the profile canvas doc is opaque
// JSON/jsonb, so no server/storage change). It round-trips through the ONE
// auto-save PUT writer (store/autosave.ts): written at sortie commit +
// notifyStateChanged(), restored by applyCanvasToState()/boot's migrate deep
// clone. GameState is intentionally NOT widened (that would pollute the
// shared, drift-checked engine surface) -- we cast at the seam, exactly like
// guide/guideModel.ts.
import type { GameState } from '../engine/engine.d.ts';

export interface SortiePersisted {
  /** the attackLv of the player's most recent sortie/recruit commit. */
  attackLv: number;
}

type SortieState = GameState & { sortie?: SortiePersisted };

/** Last-used attackLv, or null when absent/malformed (fresh profile, pre-
 * REQ-0371 save, or hand-edited doc). Clamped to the LevelStepper's >= 1. */
export function readSortieAttackLv(st: GameState | null | undefined): number | null {
  if (!st) return null;
  const lv = (st as SortieState).sortie?.attackLv;
  if (typeof lv !== 'number' || !Number.isFinite(lv) || lv < 1) return null;
  return Math.floor(lv);
}

/** Records the attackLv the player just committed a sortie with. The caller
 * owns the follow-up notifyStateChanged() (which auto-saves). */
export function writeSortieAttackLv(st: GameState | null | undefined, attackLv: number): void {
  if (!st) return;
  if (typeof attackLv !== 'number' || !Number.isFinite(attackLv) || attackLv < 1) return;
  (st as SortieState).sortie = { attackLv: Math.floor(attackLv) };
}
