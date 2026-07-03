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
  /** Save/Load status line shown in the Header, mirroring the mock's
   * #canvasIoStatus (localized message + ok/error color). null = nothing
   * to show yet. */
  ioStatus: { message: string; isError: boolean } | null;
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
  ioStatus: null,
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
}

/** Sets (or clears, pass null) the Save/Load status line. */
export function setIoStatus(message: string, isError: boolean): void {
  setSnapshot({ ...snapshot, ioStatus: { message, isError } });
}

const IO_STRINGS = {
  saved: { ja: '保存しました', en: 'Saved' },
  saveFailed: { ja: '保存失敗', en: 'Save failed' },
  loaded: { ja: '読み込みました', en: 'Loaded' },
  loadFailed: { ja: '読み込み失敗', en: 'Load failed' },
  noSavedCanvas: { ja: '保存データなし', en: 'No saved canvas' },
} as const;

function ioText(key: keyof typeof IO_STRINGS): string {
  return IO_STRINGS[key][snapshot.locale];
}

/**
 * Save: PUT the CURRENT live GameState (bare, unwrapped -- see api.ts's
 * saveCanvas) to /api/profile/default/canvas. Mirrors mock-src/ui.js's
 * saveBtn handler exactly (same endpoint, same body shape, same status
 * strings) -- `st` already carries `st.inv` (REQ-0030 Phase 1's makeState()
 * shape), so no extra wiring is needed here: the existing bare-state PUT
 * already round-trips the inventory pages as-is. Profile id is hardcoded
 * to 'default' for T0.2, same as the mock.
 */
export async function saveGame(): Promise<void> {
  const st = snapshot.state;
  if (!st) return;
  try {
    await saveCanvas('default', st);
    setIoStatus(ioText('saved'), false);
  } catch (e) {
    console.warn('[backpack_ragnarok] canvas save failed:', e instanceof Error ? e.message : e);
    setIoStatus(ioText('saveFailed'), true);
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
    if (!doc) {
      setIoStatus(ioText('noSavedCanvas'), true);
      return;
    }
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
    notifyStateChanged();
    setIoStatus(ioText('loaded'), false);
  } catch (e) {
    console.warn('[backpack_ragnarok] canvas load failed:', e instanceof Error ? e.message : e);
    setIoStatus(ioText('loadFailed'), true);
  }
}

/** React hook: subscribes the calling component to the store. */
export function useGameStore(): StoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
