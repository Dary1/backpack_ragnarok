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
//
// REQ-0037 addition -- guest auth: `me` holds the resolved /api/me
// identity (playerId/name/roles), fetched once at boot() and again after
// the invite-route flow completes. The canvas profile id used by
// boot()/scheduleAutoSave() is `me.playerId` (or the dev-mode fallback id
// the server resolves when no token is stored) -- see resolveProfileId()
// below -- replacing the old hardcoded 'default' string, so different
// logged-in guests get isolated boards. `welcomeBanner` is the minimal,
// dependency-free toast shown right after the invite flow resolves a
// player (see handleInviteRoute()); it auto-clears after a few seconds.
// client/src/store/core.ts -- REQ-0047 (f2): snapshot + pub-sub core: StoreSnapshot, the module-level snapshot, subscribe/getSnapshot/setSnapshot, useGameStore hook, Locale/Route types.
// Moved VERBATIM from client/src/store.ts (see that file for the barrel).
import { useSyncExternalStore } from 'react';
import type { EngineInstance, GameState } from '../engine/engine.d.ts';
import type { ApiMe, DataSource, GameData } from '../api';

export type { DataSource };

export type Locale = 'en' | 'ja';

// REQ-0034 -- global nav route. Hash-based: '#/backpacks',
// '#/schedule', '#/friends', '#/dex', '#/settings'. REQ-0037 adds
// '#/invite/<token>', handled as a special one-shot route (see
// routeFromHash()/handleInviteRoute() below) that immediately redirects
// to '#/backpacks' once the invite token has been stored + resolved --
// it never stays the ACTIVE route in the store for more than an instant,
// so the Route union itself does not need an 'invite' member; App.tsx
// never has to render anything for it.
//
// REQ-0069 adds 'landing' (the title screen; canonical hash is the BARE
// '#/' / empty hash, which is now the boot default instead of
// 'backpacks') plus the 'market'/'ragnarok' placeholder routes from the
// mock rail (their real pages land in later REQs).
//
// REQ-0086 adds 'warehouse' -- promoted from a Schedule-page tab
// (REQ-0036/0041/0072) to its own top-level route, landing the 倉庫
// rail entry REQ-0069 had explicitly deferred.
export type Route =
  | 'landing'
  | 'backpacks'
  | 'schedule'
  | 'warehouse'
  | 'workshop'
  | 'friends'
  | 'dex'
  | 'settings'
  | 'market'
  | 'ragnarok';

const VALID_ROUTES: Route[] = ['landing', 'backpacks', 'schedule', 'warehouse', 'workshop', 'friends', 'dex', 'settings', 'market', 'ragnarok'];

export const INVITE_HASH_RE = /^#\/invite\/(.+)$/;

// REQ-0052: a Dex card subwindow's footer links to the canonical full
// page via '#/dex/<id>' -- a deep-link hash carrying an id SEGMENT,
// distinct from the plain '#/dex' route hash. Checked the same way
// INVITE_HASH_RE is (see routing.ts's initRouting()/onHashChange): if
// the CURRENT hash matches this, the route resolves to 'dex' (still a
// plain Route member, no union widening needed) AND dexFocusId is set so
// Dex.tsx can jump straight to that entry's detail view on load, instead
// of the bare catalog grid.
export const DEX_ITEM_HASH_RE = /^#\/dex\/(.+)$/;

// REQ-0069: the EMPTY hash ('', '#' or '#/') is the landing (title)
// screen -- the app's boot route. Named routes keep their '#/<name>'
// hashes, and an UNKNOWN hash still falls back to 'backpacks' (NOT the
// landing) so a stale/mistyped deep link degrades to the main play
// screen exactly as it did before REQ-0069. '#/landing' is accepted as
// input too, but setRoute() always writes the canonical bare '#/'.
export function routeFromHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  if (raw === '') return 'landing';
  return (VALID_ROUTES as string[]).includes(raw) ? (raw as Route) : 'backpacks';
}

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
  /** Current nav route (REQ-0034). Synced both ways with `location.hash`
   * by initRouting() -- see module comment there. */
  route: Route;
  /** REQ-0037: the resolved /api/me identity for the current session (a
   * stored guest token, or the dev-mode fallback player when none is
   * stored). null until the first fetchMe() resolves (or fails -- a
   * failure is treated as "no identity", non-fatal, same posture
   * DexRoot.tsx already established for its own /api/me call). */
  me: ApiMe | null;
  /** REQ-0037: minimal welcome banner text shown right after the invite
   * flow resolves a player, or null when nothing should be shown. Plain
   * module-store field -- no toast library exists in this app (see
   * Settings.tsx / InviteBanner rendering in App.tsx for the consumer). */
  welcomeBanner: string | null;
  /** REQ-0032: brief inline feedback shown when a trash-drop delete is
   * REFUSED (dropping the last remaining preset onto the trash zone) --
   * a short-lived message the preset-tab row can render as a shake/toast
   * right next to the tabs, mirroring welcomeBanner's "plain module-store
   * field, auto-clears after a few seconds" pattern (no toast library in
   * this app). null when nothing should be shown. */
  presetDeleteRefused: string | null;
  /** REQ-0052: pending Dex deep-link target id, set by initRouting()/
   * onHashChange when the current hash matches DEX_ITEM_HASH_RE
   * ('#/dex/<id>', e.g. a DexCardWindow footer link). Dex.tsx consumes
   * this once (jumps straight to that entry's detail view) then calls
   * clearDexFocusId() -- null the rest of the time, including on every
   * plain '#/dex' navigation that carries no id segment. */
  dexFocusId: string | null;
}

export let snapshot: StoreSnapshot = {
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
  route: routeFromHash(typeof location !== 'undefined' ? location.hash : ''),
  me: null,
  welcomeBanner: null,
  presetDeleteRefused: null,
  dexFocusId: null,
};

const listeners = new Set<() => void>();

export function setSnapshot(next: StoreSnapshot) {
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

/** REQ-0037: resolves the canvas profile id to use for boot()/auto-save --
 * the authenticated player's own playerId (from the store's `me`, once
 * resolved), falling back to the literal 'default' alias ONLY if `me`
 * has not resolved yet (e.g. a fetchMe() call still in flight, or it
 * failed entirely) so there is always SOME id to attempt -- the server's
 * own dev_mode-gated alias handles that fallback id correctly on its
 * side (see docs/REQ/REQ-0037-guest-auth.md). Once `me` resolves, this
 * always prefers the real playerId over the alias. */

export function useGameStore(): StoreSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}
