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
import { resolveGameData, type DataSource, type GameData } from './api';
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

/** React hook: subscribes the calling component to the store. */
export function useGameStore(): StoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
