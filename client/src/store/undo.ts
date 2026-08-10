// client/src/store/undo.ts -- REQ-0367: single-step canvas undo (Ctrl+Z).
//
// ONE snapshot slot, no redo. Scope: pure client-side engine mutations only
// -- place / move / rotate / remove, including canvas<->inventory crossings:
// concretely, the four drop-commit functions in board/commits.ts (armUndo at
// their top, strictly BEFORE the mutation) and the two dblclick-rotate sites
// in BoardRenderer.ts (captureUndoState/armUndoFrom, armed only on success).
//
// Server-authoritative flows are NEVER undoable (spec item 1) and CLEAR the
// slot instead: warehouse claim (useWarehouseData.ts), gacha two-phase
// finalization (WorkshopPage.tsx), squad create/delete (store/squads.ts);
// market / dismantle / ragnarok all refresh through loadGame(), which
// clears. Context switches the player can see -- active squad change,
// inventory page change, route change -- also drop the slot (spec item 4):
// undo never crosses one. Out-of-scope pure-client mutations (squad/page
// rename+reorder, the chain-link toggle) clear too, because the restore is
// a WHOLE-state snapshot and must never silently revert a change the
// player did not ask to undo.
//
// Mechanism (spec item 2): a deep copy of the whole engine state (small,
// plain JSON by construction -- the auto-save PUT serializes exactly this
// object after every mutation). undo() restores through the SAME code path
// loadGame() uses (engine.migrateState + applyCanvasToState's field
// replacement), then notifyStateChanged() -- so the normal debounced
// auto-save persists the restore. Design rule 5 untouched: the auto-save
// PUT stays the one profile writer.
import type { GameState } from '../engine/engine.d.ts';
import { snapshot, setSnapshot } from './core';
import { applyCanvasToState } from './autosave';
import { notifyStateChanged } from './squads';

/** The one snapshot slot. Module-level ephemeral UI state, never persisted
 * -- same posture as locale/activeInvPage (see core.ts's module comment). */
let slot: GameState | null = null;

/** Mirrors the slot's occupancy into the store snapshot so the boardfoot
 * undo button can subscribe to it (disabled when empty). */
function publish(): void {
  const available = slot !== null;
  if (snapshot.undoAvailable !== available) setSnapshot({ ...snapshot, undoAvailable: available });
}

/** Deep copy of the live engine state, for arming AFTER a mutation is known
 * to have succeeded (the dblclick-rotate sites: a REFUSED rotate must not
 * overwrite a slot armed by an earlier successful mutation with a copy that
 * undoes nothing). Plain JSON round-trip: GameState is plain JSON by
 * construction (saveCanvas serializes exactly this object on every
 * auto-save), and the restore path runs migrateState anyway. */
export function captureUndoState(): GameState | null {
  const st = snapshot.state;
  if (!st) return null;
  return JSON.parse(JSON.stringify(st)) as GameState;
}

/** Arms the slot with a pre-captured copy (see captureUndoState). No-op on
 * null so call sites can pass a capture that raced state teardown. */
export function armUndoFrom(copy: GameState | null): void {
  if (!copy) return;
  slot = copy;
  publish();
}

/** Captures + arms in one step -- called at the TOP of each drop-commit
 * function in board/commits.ts, i.e. strictly before the mutation (spec
 * item 2: "before each in-scope mutation, store a deep copy"). */
export function armUndo(): void {
  armUndoFrom(captureUndoState());
}

/** Empties the slot. Called by every excluded (server-authoritative) commit
 * path and every player-visible context switch -- see the module comment
 * for the full list. Safe to call redundantly. */
export function clearUndo(): void {
  if (slot === null) return;
  slot = null;
  publish();
}

/** Restores the armed snapshot -- ONE step, consuming the slot (no redo:
 * a second Ctrl+Z after an undo does nothing). Restoration is loadGame()'s
 * path: migrateState first (documented safe/idempotent on a current-shape
 * state), then the identical field replacement, then notifyStateChanged()
 * so the boards re-render and the normal auto-save persists the restore. */
export function undo(): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine || slot === null) return;
  const canvas = engine.migrateState(slot);
  slot = null;
  applyCanvasToState(st, canvas);
  publish();
  notifyStateChanged();
}

/** True while keyboard focus sits in a text-entry element -- the Ctrl+Z
 * guard (spec item 3): a rename field's own native undo must win there. */
function focusInTextEntry(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable === true;
}

let hotkeyWired = false;
/** Wires the global Ctrl+Z (Cmd+Z on mac) trigger. Called once at boot
 * (main.tsx) -- same lifecycle shape as initAutoSaveLifecycle(). Plain
 * Ctrl/Cmd+Z only: Shift/Alt chords (redo conventions) are left alone,
 * since there is deliberately no redo (spec item 1). */
export function initUndoHotkey(): void {
  if (hotkeyWired) return;
  if (typeof window === 'undefined') return;
  hotkeyWired = true;
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    if (e.key !== 'z' && e.key !== 'Z') return;
    if (focusInTextEntry()) return;
    e.preventDefault();
    undo();
  });
}
