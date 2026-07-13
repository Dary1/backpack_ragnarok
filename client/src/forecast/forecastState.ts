// client/src/forecast/forecastState.ts -- REQ-0057 Ray Forecast Overlay.
//
// The overlay's own tiny framework-free pub-sub: WHICH forecast the player
// is looking at (dungeon type / level / formation / squad slot), whether the
// overlay is on, and the fetched profile payload -- plus the module-level
// payload cache both the canvas overlay AND the schedule page's formation
// picker read through.
//
// Same pattern -- and for the same reason -- as board/itemTip.ts and
// board/drag.ts: this is EPHEMERAL UI state, never game state. It must never
// live in store.ts's game snapshot, because every write there churns the
// board (store.ts's subscribers re-render the Pixi canvas). Toggling a heat
// map on must not make the board re-render its items.
//
// The heavy part -- the geometry fold -- is NOT here. It is
// shared/forecast.mjs, the same module sim/tests/forecast_parity.cjs proves
// byte-equal to sim's walkRay. This file only decides WHEN to run it; see
// pressure.ts for the memoised bridge.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { fetchForecast } from '../api';
import type { ApiForecastPayload } from '../api';

/** The four inputs REQ-0057 forecasts against: (dungeon type, level, formation, slot). */
export interface ForecastSettings {
  enabled: boolean;
  dungeonType: string;
  level: number;
  formationId: string;
  /** Which formation box THIS squad is assumed to occupy: 'unit1'..'unit4'. */
  slot: string;
}

export interface ForecastState extends ForecastSettings {
  status: 'idle' | 'loading' | 'ready' | 'error';
  payload: ApiForecastPayload | null;
  error: string | null;
}

// ---------------------------------------------------------------------
// The payload cache.
//
// A payload depends ONLY on (dungeonType, level) -- formation and slot are
// pure client-side geometry -- so it is cached per that pair and never
// re-fetched when the player is merely sliding the formation/slot selectors.
// In-flight requests are deduped by the same key, so mashing the level
// stepper cannot stack requests, and the canvas overlay + the schedule
// page's slot summary share one cache rather than each fetching their own.
// ---------------------------------------------------------------------
const cache = new Map<string, ApiForecastPayload>();
const inFlight = new Map<string, Promise<ApiForecastPayload>>();

function key(dungeonType: string, level: number): string { return dungeonType + '/' + level; }

/** Cached, deduped GET /api/schedule/forecast. */
export function loadForecast(dungeonType: string, level: number): Promise<ApiForecastPayload> {
  const k = key(dungeonType, level);
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(k);
  if (pending) return pending;
  const p = fetchForecast(dungeonType, level)
    .then((payload) => { cache.set(k, payload); return payload; })
    .finally(() => { inFlight.delete(k); });
  inFlight.set(k, p);
  return p;
}

/** Synchronous cache peek -- lets a consumer render instantly on a re-visit. */
export function peekForecast(dungeonType: string, level: number): ApiForecastPayload | null {
  return cache.get(key(dungeonType, level)) ?? null;
}

// ---------------------------------------------------------------------
// The canvas overlay's own state.
// ---------------------------------------------------------------------

// Defaults: the level-1 auto-generated dungeon, standard formation, front
// slot -- deliberately the SAME defaults CreateRoomForm lands on, so a
// player who flips the overlay on without touching anything sees the
// forecast for the room they would get by clicking "create" without touching
// anything.
let state: ForecastState = {
  enabled: false,
  dungeonType: 'default',
  level: 1,
  formationId: 'formation1',
  slot: 'unit1',
  status: 'idle',
  payload: null,
  error: null,
};

const listeners = new Set<() => void>();
function notify(): void { for (const l of listeners) l(); }

export function getForecastState(): ForecastState { return state; }

export function subscribeForecast(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useForecast(): ForecastState {
  return useSyncExternalStore(subscribeForecast, getForecastState, getForecastState);
}

function set(patch: Partial<ForecastState>): void {
  state = { ...state, ...patch };
  notify();
}

function ensurePayload(dungeonType: string, level: number): void {
  const k = key(dungeonType, level);
  const hit = cache.get(k);
  if (hit) {
    set({ payload: hit, status: 'ready', error: null });
    return;
  }
  set({ status: 'loading', error: null, payload: null });
  void loadForecast(dungeonType, level)
    .then((payload) => {
      // Guard against a stale response landing after the player has already
      // moved on to a different (type, level).
      if (key(state.dungeonType, state.level) !== k) return;
      set({ payload, status: 'ready', error: null });
    })
    .catch((e: unknown) => {
      if (key(state.dungeonType, state.level) !== k) return;
      set({ status: 'error', error: e instanceof Error ? e.message : String(e), payload: null });
    });
}

export function setForecastEnabled(enabled: boolean): void {
  set({ enabled });
  if (enabled) ensurePayload(state.dungeonType, state.level);
}

export function toggleForecast(): void {
  setForecastEnabled(!state.enabled);
}

export function setForecastSettings(patch: Partial<ForecastSettings>): void {
  const nextType = patch.dungeonType ?? state.dungeonType;
  // Clamp to the band the server accepts (server/lib/forecast.cjs's
  // FORECAST_TUNABLES) rather than letting a stray input fire a request the
  // server will just clamp anyway -- that would poison the cache key.
  const nextLevel = Math.max(1, Math.min(99, Math.floor(patch.level ?? state.level) || 1));
  set({ ...patch, dungeonType: nextType, level: nextLevel });
  if (state.enabled) ensurePayload(nextType, nextLevel);
}

// ---------------------------------------------------------------------
// A standalone hook for consumers that are NOT the canvas overlay (the
// schedule page's formation picker), so they can read a forecast without
// touching -- or being coupled to -- the overlay's own on/off state.
// ---------------------------------------------------------------------
export function useForecastPayload(dungeonType: string, level: number): {
  payload: ApiForecastPayload | null;
  loading: boolean;
} {
  const [payload, setPayload] = useState<ApiForecastPayload | null>(() => peekForecast(dungeonType, level));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const hit = peekForecast(dungeonType, level);
    if (hit) { setPayload(hit); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    void loadForecast(dungeonType, level)
      .then((p) => { if (!cancelled) { setPayload(p); setLoading(false); } })
      // A forecast is an ADVISORY overlay: if it cannot be fetched, the page
      // it decorates must keep working. Degrade to "no summary", never to a
      // broken create-room form.
      .catch(() => { if (!cancelled) { setPayload(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [dungeonType, level]);

  return { payload, loading };
}
