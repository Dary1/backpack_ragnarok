// Module-level game-data/state store — REQ-0026 T0.1.
// Per the spec: "engine stays shared & framework-free... no React-owned
// game state". This store lives entirely outside React; React only
// subscribes to it (via useGameStore below) for the read-only bits it
// renders (header badge, item panel, board). The engine instance and
// GameState object are the single source of truth, exactly as in
// mock-src/ui.js's top-level `state`/`E` -- just wrapped with a tiny
// pub-sub so React function components can re-render when they change.
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
}

let snapshot: StoreSnapshot = {
  status: 'loading',
  source: null,
  error: null,
  gameData: null,
  engine: null,
  state: null,
  locale: 'en',
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

/** React hook: subscribes the calling component to the store. */
export function useGameStore(): StoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
