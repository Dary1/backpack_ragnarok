// Module-level game-data/state store — REQ-0026 T0.1, extended REQ-0027
// T0.2, extended REQ-0030 Phase 2 (inventory tabs + migrateState wiring).
// Per the spec: "engine stays shared & framework-free... no React-owned
// game state". This store lives entirely outside React; React only
// subscribes to it (via useGameStore below) for the read-only bits it
// renders (header badge, item panel, board). The engine instance and
// GameState object are the single source of truth, exactly as in
// mock-src/ui.js's top-level `state`/`E` -- just wrapped with a tiny
// pub-sub so React function components can re-render when they change.
//
// REQ-0027 T0.2 addition: the engine mutates `state` IN PLACE (e.g.
// movePO sets `p.loc='grid'` on the same PO object) rather than returning
// a new GameState. useSyncExternalStore requires getSnapshot() to return a
// NEW top-level object reference whenever consumers should re-render (React
// compares by Object.is), but the actual game-state object identity must
// stay the same (so any code that captured a `state` reference -- e.g. an
// in-flight drag closure -- keeps seeing live data, matching the mock's
// single top-level `const state` that is "never reassigned"). So:
// `notifyStateChanged()` below produces a shallow-cloned StoreSnapshot
// wrapper (new outer object -> React re-renders) whose `state` field is
// the SAME GameState object reference (no restructuring of game data).
// Call this after every successful engine mutator call, and after Esc-
// cancel / Save / Load, so Board/inventory board all refresh.
//
// REQ-0030 Phase 2 additions:
//  - `activeInvPage`: 0-based index of the currently-shown inventory tab
//    (1..5 in the UI, 0..4 internally, matching engine.js's page()
//    convention). Per the task spec, tab state is NOT persisted to
//    localStorage -- it lives here, in the module store, same as every
//    other piece of ephemeral UI state (locale, ioStatus) already does;
//    it simply resets to page 0 on a fresh page load, same as `locale`
//    defaults to 'en' rather than remembering a prior session.
//  - `boot()`/`loadGame()` both run the loaded state through
//    engine.migrateState() before it becomes `snapshot.state` -- so ANY
//    saved profile (pre-REQ-0030 legacy shape, or already-current) always
//    ends up with a populated `state.inv` before the board ever reads it.
//    migrateState() is documented safe/idempotent on an already-migrated
//    state (no legacy loc:'inv'/host:'inv' entries left to move -- a
//    structural no-op copy), so this is unconditionally correct to call
//    every time, not just on a detected-legacy shape.
//
// REQ-0031 Phase B addition -- auto-save (Save/Load buttons retired):
// notifyStateChanged() is the ONE choke point every engine mutation in the
// app already flows through (confirmed by reading every call site: every
// drag-drop/rotate/seat-stow commit in BoardRenderer.ts, the chain-link
// toggle, and loadGame()'s own field-replacement all call it, and NONE of
// them call it mid-drag -- drag.ts's updateCarry()/armCarry() are a
// completely separate pub-sub that never touches `state` or this store;
// only a drag's final pointerup COMMIT mutates state and calls
// notifyStateChanged()). So scheduleAutoSave() is invoked from inside
// notifyStateChanged() itself: any mutation anywhere in the app
// automatically debounce-schedules a background PUT, and "don't save
// mid-drag" falls out for free from the fact that this function is
// simply never called until a drag has already committed. autoSaveStatus
// mirrors the old ioStatus concept but with three states aimed at a
// persistent small indicator rather than a one-shot toast: 'saved'
// (nothing pending, last write succeeded), 'saving' (a debounced write is
// pending or in flight), 'offline' (the last attempted write failed --
// network/server error; the local state is NOT lost, just not yet
// persisted, and the next mutation's debounce will retry).
import { useSyncExternalStore } from 'react';
import { Engine } from './engine/adapter';
import type { EngineInstance, GameState } from './engine/engine.d.ts';
import { fetchCanvas, resolveGameData, saveCanvas, type DataSource, type GameData } from './api';
import { cancelCarry } from './board/drag';
export type { DataSource };

export type Locale = 'en' | 'ja';

export interface StoreSnapshot {
  status: 'loading' | 'ready' | 'error';
  source: DataSource | null;
  error: string | null;
  gameData: GameData | null;
  engine: EngineInstance | null;
  state: GameState | null;
  locale: Locale;
  /** Bumped by notifyStateChanged(); lets consumers detect in-place
   * mutations even though `state`'s own reference never changes. Not
   * required by useSyncExternalStore (the outer snapshot object itself is
   * already new each time) but useful for effects that want to depend on
   * "did the game state change" without depending on `state` identity. */
  stateVersion: number;
  /** Auto-save status shown in the Header's small indicator (REQ-0031
   * Phase B; replaces the retired Save/Load buttons' one-shot ioStatus
   * line). 'saved' = last write succeeded and nothing is pending;
   * 'saving' = a debounced write is scheduled or a PUT is in flight;
   * 'offline' = the most recent PUT attempt failed (state is still safe
   * locally; the next mutation's debounce will retry the write). */
  autoSaveStatus: 'saved' | 'saving' | 'offline';
  /** 0-based active inventory tab/page index (REQ-0030 Phase 2). Module-
   * store-only, never persisted (see module comment above). */
  activeInvPage: number;
}

let snapshot: StoreSnapshot = {
  status: 'loading',
  source: null,
  error: null,
  gameData: null,
  engine: null,
  state: null,
  locale: 'en',
  stateVersion: 0,
  autoSaveStatus: 'saved',
  activeInvPage: 0,
};

const listeners = new Set<() => void>();

function setSnapshot(next: StoreSnapshot) {
  snapshot = next;
  for (const l of listeners) l();
}

export function getSnapshot(): StoreSnapshot {
  return snapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Loads content from the live API and builds the engine instance + initial
 * GameState. Called once at boot (see main.tsx). Runs the freshly-built
 * state through engine.migrateState() (REQ-0030 Phase 2) so `state.inv` is
 * always populated regardless of whether the resolved GameData came from
 * the baked scenario (already current-shape, migrateState is a no-op copy)
 * or a saved profile predating REQ-0030 (legacy loc:'inv'/host:'inv'
 * entries get first-fit placed onto page 1+, see engine.js's doc). */
export async function boot(): Promise<void> {
  const resolved = await resolveGameData('default');
  if (resolved.source === 'error' || !resolved.gameData) {
    setSnapshot({ ...snapshot, status: 'error', source: 'error', error: resolved.error ?? 'unknown error' });
    return;
  }
  const gameData = resolved.gameData;
  const engine = Engine.create(gameData.ITEMS, gameData.SI_DEFS, gameData.LAYOUT, gameData.TREES);
  const state = engine.migrateState(gameData.makeState());
  setSnapshot({
    ...snapshot,
    status: 'ready',
    source: resolved.source,
    error: null,
    gameData,
    engine,
    state,
  });
}

export function setLocale(locale: Locale): void {
  setSnapshot({ ...snapshot, locale });
}

/** Sets the active inventory tab (0-based page index, 0..PAGE_COUNT-1).
 * REQ-0030 Phase 2 -- switching tabs re-renders the inventory board only
 * (the canvas board's own snapshot subscription is unaffected: it never
 * reads activeInvPage). Out-of-range indices are clamped defensively
 * (PAGE_COUNT is always 5 today, but this keeps the store honest even if
 * that ever changes). */
export function setActiveInvPage(page: number): void {
  const engine = snapshot.engine;
  const max = engine ? engine.PAGE_COUNT - 1 : 4;
  const clamped = Math.max(0, Math.min(max, page));
  if (clamped === snapshot.activeInvPage) return;
  setSnapshot({ ...snapshot, activeInvPage: clamped });
}

// ---------------------------------------------------------------------
// Preset actions (REQ-0031 Phase B). All three go through the engine's
// preset mutators (switchPreset/addPreset/renamePreset) then
// notifyStateChanged() -- same pattern as every board interaction commit
// in BoardRenderer.ts -- so auto-save picks up the change exactly like
// any other mutation, and the canvas board's existing render(state)-on-
// stateVersion-bump subscription (Board.tsx) redraws the newly-active
// preset's bps/pos/sis with NO Pixi Application recreation (Phase A
// lesson: canvas ops read state.bps/pos/sis directly -- see
// boardOps.ts's makeCanvasOps container(){return state;} -- so
// switchPreset() mutating those same top-level fields in place is
// already everything Board.tsx's render() needs; there is no separate
// per-preset BoardOps/boardId the way inventory pages have one per page,
// so no setOps() call is needed here at all, only the state mutation +
// notifyStateChanged() re-render every other commit already relies on).

/** Switches the active preset (0-based index). Beams/connections/combos
 * recompute automatically on the next render() since they are always
 * derived fresh from st.bps/st.pos (traceBeams/combos take no cached
 * state) -- nothing preset-specific needs to be invalidated by hand. */
export function switchActivePreset(n: number): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.switchPreset(st, n);
  if (r.ok) notifyStateChanged();
}

/** Appends a brand-new EMPTY preset and immediately switches to it
 * ("Preset+ appends a preset, switches to it" -- REQ-0031 UI spec). */
export function addNewPresetAndSwitch(name?: string): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const added = engine.addPreset(st, name);
  if (!added.ok || added.index === undefined) return;
  const switched = engine.switchPreset(st, added.index);
  if (switched.ok) notifyStateChanged();
}

/** Renames preset `n` (0-based) -- works for the active or an inactive
 * preset identically (engine.renamePreset only touches names[]). */
export function renameActivePreset(n: number, name: string): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.renamePreset(st, n, name);
  if (r.ok) notifyStateChanged();
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
const AUTO_SAVE_DEBOUNCE_MS = 800;
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
// Monotonically-increasing token: if a NEWER debounced save has been
// scheduled by the time an in-flight PUT resolves, that PUT's result is
// stale and must not flip autoSaveStatus back to 'saved' out of order
// (the newer save's own completion will do that instead).
let autoSaveToken = 0;

function setAutoSaveStatus(status: StoreSnapshot['autoSaveStatus']): void {
  if (snapshot.autoSaveStatus === status) return;
  setSnapshot({ ...snapshot, autoSaveStatus: status });
}

/** Debounces a background PUT of the current live GameState. Called from
 * notifyStateChanged() -- i.e. after every committed engine mutation
 * (drag-drop, rotate, seat/stow, chain-link toggle, preset switch, rename,
 * ...) and after loadGame()'s own field replacement. Resets the timer on
 * every call within the debounce window, so a rapid burst of mutations
 * (e.g. several drags in quick succession) collapses into a single PUT
 * AUTO_SAVE_DEBOUNCE_MS after the last one. Never fires while a drag is
 * merely in progress: notifyStateChanged() (and therefore this function)
 * is only ever invoked at a drag's COMMIT (pointerup resolving against an
 * engine mutator), never during pointermove -- there is no separate
 * "in-progress" mutation event to guard against here. */
function scheduleAutoSave(): void {
  if (!snapshot.state) return;
  setAutoSaveStatus('saving');
  if (autoSaveTimer !== null) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    void flushAutoSave();
  }, AUTO_SAVE_DEBOUNCE_MS);
}

/** Immediately PUTs the current live GameState (no debounce) -- used by
 * the debounce timer's expiry. Exported so tests/callers needing a
 * synchronous "save right now, don't wait for the debounce" escape hatch
 * (e.g. a future beforeunload handler) have one, though nothing in the UI
 * currently calls it directly other than the debounce timer itself. */
export async function flushAutoSave(): Promise<void> {
  const st = snapshot.state;
  if (!st) return;
  const myToken = ++autoSaveToken;
  try {
    await saveCanvas('default', st);
    if (myToken === autoSaveToken) setAutoSaveStatus('saved');
  } catch (e) {
    console.warn('[backpack_ragnarok] auto-save failed:', e instanceof Error ? e.message : e);
    if (myToken === autoSaveToken) setAutoSaveStatus('offline');
  }
}

/**
 * Load: GET /api/profile/default/canvas, then replace state's OWN FIELDS
 * in place (never reassign `snapshot.state` to a new object) -- mirrors
 * the mock's `state.linked=...; state.bps=...; state.pos=...; state.sis=...`,
 * extended (REQ-0030 Phase 2) to also replace `state.inv` and to run the
 * fetched canvas through engine.migrateState() FIRST -- a profile saved by
 * an older client (pre-REQ-0030, no `inv` field / legacy loc:'inv' list
 * entries) is migrated to the current spatial shape before it ever
 * replaces the live state, so the inventory board never has to special-
 * case a missing/legacy shape. On 404 shows "No saved canvas" (not an
 * error). Caller (Header) is responsible for canceling any active drag/
 * carry BEFORE calling this, same order as the mock (`carry=null` before
 * the field replacement).
 */
export async function loadGame(): Promise<void> {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  try {
    const doc = await fetchCanvas('default');
    if (!doc) return; // no saved canvas yet -- not an error, nothing to load
    const rawCanvas = doc.canvas;
    if (!rawCanvas || !Array.isArray(rawCanvas.pos) || !Array.isArray(rawCanvas.bps)) {
      throw new Error('malformed saved canvas');
    }
    const canvas = engine.migrateState(rawCanvas);
    // Cancel any active drag BEFORE the field replacement -- same order as
    // the mock (`carry=null` before `state.linked=...` etc). No engine call:
    // this is a pure UI-state abort (matches Esc-cancel semantics), and
    // BoardRenderer's carry-subscription clears the ghost/target Pixi
    // layers as a side effect of the carry becoming null (see
    // BoardRenderer.wireGlobalInteraction's subscribeCarry callback).
    cancelCarry();
    st.linked = canvas.linked;
    st.bps = canvas.bps;
    st.pos = canvas.pos;
    st.sis = canvas.sis || [];
    st.inv = canvas.inv;
    st.presets = canvas.presets;
    // NOTE: this reload just replaced state's fields FROM the server's own
    // saved copy, so there is nothing new to auto-save -- notifyStateChanged()
    // still bumps stateVersion (so the boards re-render) but the resulting
    // scheduleAutoSave() call is a harmless no-op PUT of unchanged data.
    notifyStateChanged();
  } catch (e) {
    console.warn('[backpack_ragnarok] canvas load failed:', e instanceof Error ? e.message : e);
  }
}

/** React hook: subscribes the calling component to the store. */
export function useGameStore(): StoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
