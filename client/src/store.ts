// Module-level game-data/state store — REQ-0026 T0.1, extended REQ-0027 T0.2.
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
// cancel / Save / Load, so Board/ItemPanel/inventory panel all refresh.
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
 * GameState. Called once at boot (see main.tsx). */
export async function boot(): Promise<void> {
  const resolved = await resolveGameData('default');
  if (resolved.source === 'error' || !resolved.gameData) {
    setSnapshot({ ...snapshot, status: 'error', source: 'error', error: resolved.error ?? 'unknown error' });
    return;
  }
  const gameData = resolved.gameData;
  const engine = Engine.create(gameData.ITEMS, gameData.SI_DEFS, gameData.LAYOUT, gameData.TREES);
  const state = gameData.makeState();
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
 * strings). Profile id is hardcoded to 'default' for T0.2, same as the mock.
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
 * the mock's `state.linked=...; state.bps=...; state.pos=...; state.sis=...`.
 * On 404 shows "No saved canvas" (not an error). Caller (Header) is
 * responsible for canceling any active drag/carry BEFORE calling this, same
 * order as the mock (`carry=null` before the field replacement).
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
    const canvas = doc.canvas;
    if (!canvas || !Array.isArray(canvas.pos) || !Array.isArray(canvas.bps)) {
      throw new Error('malformed saved canvas');
    }
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
