// client/src/store/squads.ts -- REQ-0047 (f2): squad tabs + inventory pages (switch/add/rename/reorder/delete) + notifyStateChanged (THE post-mutation choke point).
// Moved VERBATIM from client/src/store.ts (see that file for the barrel).
import { snapshot, setSnapshot } from './core';
import { scheduleAutoSave } from './autosave';

export function switchActiveSquad(n: number): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.switchSquad(st, n);
  if (r.ok) notifyStateChanged();
}

/** Appends a brand-new EMPTY squad and immediately switches to it
 * ("Squad+ appends a squad, switches to it" -- REQ-0031 UI spec). */
export function addNewSquadAndSwitch(name?: string): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const added = engine.addSquad(st, name);
  if (!added.ok || added.index === undefined) return;
  const switched = engine.switchSquad(st, added.index);
  if (switched.ok) notifyStateChanged();
}

/** Renames squad `n` (0-based) -- works for the active or an inactive
 * squad identically (engine.renameSquad only touches names[]). */
export function renameActiveSquad(n: number, name: string): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.renameSquad(st, n, name);
  if (r.ok) notifyStateChanged();
}

/** REQ-0032: commits a squad drag-to-reorder (0-based from/to) through
 * engine.reorderSquad -- same "engine mutator + notifyStateChanged()"
 * pattern as every other squad action above, so auto-save picks up the
 * new order/active index exactly like any other mutation. The engine
 * itself recomputes `active` so it keeps identifying the SAME squad
 * across the move (see reorderSquad's own doc); this wrapper does not
 * need to touch anything UI-side beyond the standard re-render+autosave. */
export function reorderActiveSquad(from: number, to: number): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.reorderSquad(st, from, to);
  if (r.ok) notifyStateChanged();
}

/** REQ-0032: deletes squad `n` (0-based) via the squad trash-drop-zone.
 * Refusal (last remaining squad) sets `squadDeleteRefused` to a brief
 * message instead of mutating anything -- SquadTabs.tsx renders this as
 * short-lived inline feedback (see clearSquadDeleteRefused's auto-hide
 * timer below), and the tab is NOT removed, matching the spec's "show
 * brief inline feedback... do not remove the tab". A successful delete
 * drops ONLY the squad's own reference set (engine.deleteSquad never
 * touches st.inv -- see REQ-0033's reference model, which supersedes
 * REQ-0032's original physical-return paragraph) and lands `active` on
 * the engine's own nearest-remaining-tab choice. */
export function deleteActiveSquadTab(n: number): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.deleteSquad(st, n);
  if (r.ok) {
    notifyStateChanged();
    return;
  }
  setSnapshot({ ...snapshot, squadDeleteRefused: 'Cannot delete the last remaining squad' });
  scheduleSquadDeleteRefusedClear();
}

let squadDeleteRefusedTimer: ReturnType<typeof setTimeout> | null = null;

/** Auto-hides the trash-refusal message a few seconds after it appears --
 * "brief" per the REQ-0032 spec, same pattern as
 * scheduleWelcomeBannerClear() above. */
function scheduleSquadDeleteRefusedClear(delayMs = 3000): void {
  if (squadDeleteRefusedTimer !== null) clearTimeout(squadDeleteRefusedTimer);
  squadDeleteRefusedTimer = setTimeout(() => {
    squadDeleteRefusedTimer = null;
    clearSquadDeleteRefused();
  }, delayMs);
}

/** Dismisses the trash-refusal message immediately (called internally by
 * the auto-hide timer above; also safe to call from a UI close control if
 * one is ever added). */
export function clearSquadDeleteRefused(): void {
  if (snapshot.squadDeleteRefused === null) return;
  setSnapshot({ ...snapshot, squadDeleteRefused: null });
}

/** REQ-0032: the SAME active-index adjustment rule reorderSquad's engine
 * function applies to st.presets.active, generalized here for
 * `activeInvPage` -- which inventory tab is "currently shown" is CLIENT-
 * side UI state (see this file's own module comment / StoreSnapshot doc),
 * so engine.reorderInvPage does not and cannot touch it; this is the
 * client-side mirror of that same rule:
 *   - if the moved page (`from`) IS the active one, active follows it to
 *     `to`.
 *   - otherwise active shifts by one only if `from`/`to` straddle it
 *     (closing/opening a gap on one side of it).
 *   - a move entirely on one side of active never touches it. */
function reorderedActiveIndex(active: number, from: number, to: number): number {
  if (from === active) return to;
  if (from < active && to >= active) return active - 1;
  if (from > active && to <= active) return active + 1;
  return active;
}

/** REQ-0032: commits an inventory-page drag-to-reorder (0-based from/to)
 * through engine.reorderInvPage, THEN applies reorderedActiveIndex() to
 * this store's own `activeInvPage` field so the shown tab keeps tracking
 * the SAME page across the move -- the engine has no concept of "which
 * page is active" (that lives only here), so this bookkeeping step is
 * this wrapper's job alone, unlike the squad case where the engine
 * itself owns `active`. */
export function reorderInventoryPage(from: number, to: number): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.reorderInvPage(st, from, to);
  if (!r.ok) return;
  const nextActive = reorderedActiveIndex(snapshot.activeInvPage, from, to);
  setSnapshot({ ...snapshot, activeInvPage: nextActive });
  notifyStateChanged();
}

/** Renames inventory page `n` (0-based). */
export function renameInventoryPage(n: number, name: string): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.renameInvPage(st, n, name);
  if (r.ok) notifyStateChanged();
}

/**
 * Pings subscribers after an in-place mutation of `snapshot.state` (an
 * engine mutator call, an Esc-cancel, or a Save/Load field replacement).
 * Produces a new outer snapshot object (so useSyncExternalStore sees a
 * change and React re-renders) while keeping the SAME `state` object
 * reference -- no cloning/restructuring of game data, matching the "state
 * is a single stable object, mutated in place" contract the rest of the
 * app (and the mock) relies on.
 */
export function notifyStateChanged(): void {
  setSnapshot({ ...snapshot, stateVersion: snapshot.stateVersion + 1 });
  scheduleAutoSave();
}

// ---------------------------------------------------------------------
// Auto-save (REQ-0031 Phase B). Save/Load buttons are retired: every
// mutation debounce-schedules a background PUT via notifyStateChanged()
// above (the one choke point all engine mutators/commit paths already
// call -- see module comment). Load stays automatic at boot (boot() below,
// unchanged from REQ-0030/T0.2).
// ---------------------------------------------------------------------
