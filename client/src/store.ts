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
import { useSyncExternalStore } from 'react';
import { Engine } from './engine/adapter';
import type { EngineInstance, GameState } from './engine/engine.d.ts';
import {
  clearStoredToken,
  fetchCanvas,
  fetchMe,
  resolveGameData,
  saveCanvas,
  setStoredToken,
  type ApiMe,
  type DataSource,
  type GameData,
} from './api';
import { cancelCarry } from './board/drag';
export type { DataSource };

export type Locale = 'en' | 'ja';

// REQ-0034 -- global nav route. Hash-based: '#/backpacks' (default),
// '#/schedule', '#/friends', '#/dex', '#/settings'. REQ-0037 adds
// '#/invite/<token>', handled as a special one-shot route (see
// routeFromHash()/handleInviteRoute() below) that immediately redirects
// to '#/backpacks' once the invite token has been stored + resolved --
// it never stays the ACTIVE route in the store for more than an instant,
// so the Route union itself does not need an 'invite' member; App.tsx
// never has to render anything for it.
export type Route = 'backpacks' | 'schedule' | 'workshop' | 'friends' | 'dex' | 'settings';

const VALID_ROUTES: Route[] = ['backpacks', 'schedule', 'workshop', 'friends', 'dex', 'settings'];

const INVITE_HASH_RE = /^#\/invite\/(.+)$/;

function routeFromHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
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
  route: routeFromHash(typeof location !== 'undefined' ? location.hash : ''),
  me: null,
  welcomeBanner: null,
  presetDeleteRefused: null,
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

/** REQ-0037: resolves the canvas profile id to use for boot()/auto-save --
 * the authenticated player's own playerId (from the store's `me`, once
 * resolved), falling back to the literal 'default' alias ONLY if `me`
 * has not resolved yet (e.g. a fetchMe() call still in flight, or it
 * failed entirely) so there is always SOME id to attempt -- the server's
 * own dev_mode-gated alias handles that fallback id correctly on its
 * side (see docs/REQ/REQ-0037-guest-auth.md). Once `me` resolves, this
 * always prefers the real playerId over the alias. */
function resolveProfileId(): string {
  return snapshot.me?.playerId ?? 'default';
}

/** Loads content from the live API and builds the engine instance + initial
 * GameState. Called once at boot (see main.tsx). Runs the freshly-built
 * state through engine.migrateState() (REQ-0030 Phase 2) so `state.inv` is
 * always populated regardless of whether the resolved GameData came from
 * the baked scenario (already current-shape, migrateState is a no-op copy)
 * or a saved profile predating REQ-0030 (legacy loc:'inv'/host:'inv'
 * entries get first-fit placed onto page 1+, see engine.js's doc).
 *
 * REQ-0037: resolves /api/me FIRST (before fetching the canvas), so the
 * canvas profile id used is the authenticated player's own id, not a
 * hardcoded 'default' string. A fetchMe() failure is treated the same
 * way DexRoot.tsx already treats it -- non-fatal, falls back to the
 * 'default' alias via resolveProfileId() above (which the server maps to
 * the dev player when dev_mode is true).
 */
export async function boot(): Promise<void> {
  // REQ-0041 fix -- boot-sequence auth race (found while adding
  // SlotsPanel.tsx's client-side isUnitDeployable gate, which was the
  // first thing in this app to actually notice its symptom): this
  // function is called UNCONDITIONALLY and SYNCHRONOUSLY at module load
  // (main.tsx's top-level `boot()` call), which fires this function's
  // OWN fetchMe() immediately. handleInviteRoute() below (the
  // '#/invite/<token>' handler) ALSO calls setStoredToken()+fetchMe(),
  // but only from initRouting(), which App.tsx only invokes inside a
  // React useEffect -- strictly LATER than this module-level call ever
  // could be. Landing on a fresh '#/invite/<token>' URL therefore used
  // to ALWAYS lose this race: this function's own fetchMe() ran with NO
  // token stored yet (resolving to the dev_mode fallback identity,
  // since dev_mode defaults to true -- server/admin.cjs's readDevUser())
  // before handleInviteRoute() ever got a chance to store the real
  // token, and since this function only runs ONCE, the wrong profile
  // (the dev fallback's, not the invited guest's own) stayed loaded for
  // the entire session even after the URL correctly redirected to
  // '#/backpacks' and even after handleInviteRoute()'s OWN fetchMe()
  // resolved correctly moments later (that second resolution updates
  // `snapshot.me`, but this function's canvas/state load had already
  // completed against the WRONG profile id by then, and boot() never
  // reruns). FIX: synchronously check the CURRENT hash for the invite
  // pattern and store its token BEFORE this function's own fetchMe()
  // call -- so the very first fetchMe() this app ever makes already
  // carries the correct token, regardless of React effect timing.
  // handleInviteRoute()'s own setStoredToken() call becomes a harmless
  // no-op re-store of the identical value when it runs afterwards.
  if (typeof location !== 'undefined') {
    const earlyInviteMatch = INVITE_HASH_RE.exec(location.hash);
    if (earlyInviteMatch) setStoredToken(decodeURIComponent(earlyInviteMatch[1]));
  }
  let me: ApiMe | null = null;
  try {
    me = await fetchMe();
  } catch (e) {
    me = null;
  }
  if (me) setSnapshot({ ...snapshot, me });

  const resolved = await resolveGameData(resolveProfileId());
  if (resolved.source === 'error' || !resolved.gameData) {
    setSnapshot({ ...snapshot, status: 'error', source: 'error', error: resolved.error ?? 'unknown error' });
    return;
  }
  const gameData = resolved.gameData;
  const engine = Engine.create(gameData.ITEMS, gameData.SI_DEFS, gameData.LAYOUT, gameData.TREES);
  const state = engine.migrateState(gameData.makeState());

  // REQ-0042: guest/fresh-profile starter LRDST grant -- ONLY when
  // resolveGameData() reported this profile as genuinely fresh (GET
  // .../canvas 404'd, no saved profile existed at all). This can only
  // ever fire ONCE per player in practice: the very first successful
  // auto-save after this makes canvasDoc.canvas truthy forever after, so
  // every subsequent boot() call for the same player takes the OTHER
  // branch and never re-seeds (no risk of silently topping up an
  // existing profile on every reload). The dev player already has a
  // saved profile from long before this REQ existed, so this branch
  // never fires for them either -- their 999x grant is a SEPARATE,
  // explicit one-time operational action via the warehouse (see REQ-0042
  // commit (e)'s report), never this automatic client-side seed. Placed
  // on inventory page 0 via engine.tmMove's idIfNew/qtyIfNew mint path
  // (same function the gacha roll's finalize-side merge uses) rather
  // than hand-constructing a {uid,id,qty,cell} literal, so the seed goes
  // through the SAME legality/collision checks (tmCanPlace) any other TM
  // placement does -- on a truly fresh page (freshly emptyInventory()'d
  // by migrateState above) cell [1,1] is always free, so this cannot
  // fail in practice, but routing through the real engine API rather
  // than a raw push keeps this seed subject to the same invariants as
  // everything else instead of being a special-cased bypass.
  if (resolved.isFreshProfile && state.inv) {
    const seedUid = 'lrdst_starter_' + Math.random().toString(36).slice(2, 10);
    engine.tmMove(state, 0, seedUid, [1, 1], 'lrdst', 100);
  }

  setSnapshot({
    ...snapshot,
    status: 'ready',
    source: resolved.source,
    error: null,
    gameData,
    engine,
    state,
  });

  // REQ-0033 Phase 2 -- READ-ONLY DEV/E2E DEBUG HOOK, always-on (this
  // codebase has no existing import.meta.env.DEV-gated convention to
  // follow -- grepped for one before adding this; there is none -- and
  // this is a local/mock-backed dev app with no production deployment
  // concept of its own, so an always-present hook carries no real
  // exposure risk). Exposes the reference-model queries (tintSets/
  // usageOf/isUnitIndependent/usedByCurrent) directly off the live
  // `engine`/`state` closures captured here -- both are stable
  // references that the engine mutates IN PLACE (see this file's own
  // module comment), so this hook always reflects the CURRENT state with
  // zero extra wiring, even across preset switches/board mutations/
  // reloads-within-this-boot. Exists purely so client/e2e/*.spec.ts can
  // assert on exact uid sets (`page.evaluate(() => window.__backpackDebug
  // .tintSets())`) instead of reverse-engineering PixiJS canvas pixel
  // colors -- never used by any production UI code path in this app.
  (window as unknown as { __backpackDebug: unknown }).__backpackDebug = {
    tintSets: () => engine.tintSets(state),
    usageOf: (uid: string) => engine.usageOf(state, uid),
    usedByCurrent: (uid: string) => engine.usedByCurrent(state, uid),
    usedByOthers: (uid: string) => engine.usedByOthers(state, uid),
    isUnitIndependent: (n: number) => engine.isUnitIndependent(state, n),
    // REQ-0041 feedback 5: exposed for the same reason/parity as
    // isUnitIndependent just above (client/e2e/*.spec.ts assertions).
    isUnitDeployable: (n: number) => engine.isUnitDeployable(state, n),
  };
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
// Routing (REQ-0034, extended REQ-0037 for #/invite/<token>). Hash-based,
// no router library -- see Route type's doc comment above. Entry points:
//   - setRoute(route): called by nav UI. Updates the store AND writes
//     location.hash (so back/forward + shareable/deep-link URLs work).
//   - initRouting(): called once at boot (main.tsx) to (a) seed the store
//     from whatever hash the page loaded with (covers a fresh deep-link
//     load, e.g. /app/#/dex, OR a fresh invite link /app/#/invite/<token>)
//     and (b) subscribe to the browser's `hashchange` event so back/
//     forward navigation also updates the store (covers the reverse
//     direction: browser -> store).
// ---------------------------------------------------------------------

/** Switches the active route. Writes `location.hash` so the URL reflects
 * the change (reload/deep-link/back-forward all stay consistent with
 * this single source of truth). Does NOT touch Board/InventoryBoard
 * mounting -- those stay mounted at all times regardless of route (see
 * App.tsx's module comment) so this never risks the Pixi-recreation bug
 * documented in REQ-0031 Phase A / REQ-0034. */
export function setRoute(route: Route): void {
  if (route === snapshot.route) return;
  setSnapshot({ ...snapshot, route });
  if (typeof location !== 'undefined') {
    location.hash = `#/${route}`;
  }
}

/** REQ-0037: handles landing on `#/invite/<token>`. Stores the token,
 * resolves /api/me with it, redirects to #/backpacks, and shows a brief
 * welcome banner with the resolved player's name. If /api/me fails for
 * this token (e.g. the invite link is stale/garbage), the token is still
 * stored (matching "trust the link, let the normal 401 surface on the
 * next real request" -- there is no separate invite-validation endpoint)
 * but no welcome banner is shown, and we still redirect to #/backpacks
 * rather than stranding the user on a dead invite URL. Exported for
 * testability; called from initRouting() below whenever the CURRENT hash
 * matches the invite pattern. */
export async function handleInviteRoute(token: string): Promise<void> {
  setStoredToken(token);
  let me: ApiMe | null = null;
  try {
    me = await fetchMe();
  } catch (e) {
    me = null;
  }
  if (me) {
    setSnapshot({ ...snapshot, me, welcomeBanner: welcomeBannerText(me) });
    scheduleWelcomeBannerClear();
  }
  setRouteReplacingHash('backpacks');
}

function welcomeBannerText(me: ApiMe): string {
  return me.name;
}

let welcomeBannerTimer: ReturnType<typeof setTimeout> | null = null;

/** Auto-hides the welcome banner a few seconds after it appears --
 * "brief" per docs/REQ/REQ-0037-guest-auth.md's client section. Also
 * dismissable early (see clearWelcomeBanner(), wired to the banner's own
 * close control if one exists in the UI). */
function scheduleWelcomeBannerClear(delayMs = 5000): void {
  if (welcomeBannerTimer !== null) clearTimeout(welcomeBannerTimer);
  welcomeBannerTimer = setTimeout(() => {
    welcomeBannerTimer = null;
    clearWelcomeBanner();
  }, delayMs);
}

/** Dismisses the welcome banner immediately (early-dismiss action, or
 * called internally by the auto-hide timer above). */
export function clearWelcomeBanner(): void {
  if (snapshot.welcomeBanner === null) return;
  setSnapshot({ ...snapshot, welcomeBanner: null });
}

/** Like setRoute(), but uses history.replaceState-style semantics for the
 * hash (no back-button entry for the one-shot invite hash itself) -- the
 * invite link should not leave "#/invite/<token>" sitting in browser
 * history for the user to accidentally navigate back onto. Falls back to
 * a plain hash write if the History API isn't available for some reason. */
function setRouteReplacingHash(route: Route): void {
  setSnapshot({ ...snapshot, route });
  if (typeof location === 'undefined') return;
  const newUrl = location.pathname + location.search + `#/${route}`;
  if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
    history.replaceState(null, '', newUrl);
  } else {
    location.hash = `#/${route}`;
  }
}

/** Wires the store's `route` to `location.hash` (both directions -- see
 * module comment above). Call once at boot. Returns an unsubscribe
 * function (not currently used by any caller, but keeps this symmetric
 * with `subscribe()` and testable in isolation).
 *
 * REQ-0037: if the CURRENT hash (at call time, or on any later
 * hashchange) matches `#/invite/<token>`, this hands off to
 * handleInviteRoute() instead of treating it as a normal route -- the
 * store's `route` field is seeded to 'backpacks' immediately (so nothing
 * ever tries to render an "invite" page) while the async token
 * resolution runs in the background and then replaces the hash with
 * #/backpacks for real once it resolves.
 */
export function initRouting(): () => void {
  if (typeof location !== 'undefined') {
    const inviteMatch = INVITE_HASH_RE.exec(location.hash);
    if (inviteMatch) {
      setSnapshot({ ...snapshot, route: 'backpacks' });
      void handleInviteRoute(decodeURIComponent(inviteMatch[1]));
    } else {
      const initial = routeFromHash(location.hash);
      if (initial !== snapshot.route) setSnapshot({ ...snapshot, route: initial });
    }
  }
  const onHashChange = () => {
    if (typeof location === 'undefined') return;
    const inviteMatch = INVITE_HASH_RE.exec(location.hash);
    if (inviteMatch) {
      void handleInviteRoute(decodeURIComponent(inviteMatch[1]));
      return;
    }
    const next = routeFromHash(location.hash);
    if (next !== snapshot.route) setSnapshot({ ...snapshot, route: next });
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }
  return () => {};
}

/** REQ-0037: Settings page's Logout action. Clears the stored token and
 * reloads the page -- the simplest correct way back to a clean
 * dev-mode/unauthenticated state (every module-level store field, the
 * engine instance, the Pixi Applications, etc. all get a fresh start,
 * avoiding any risk of stale per-player state leaking into the next
 * session, which a soft in-place reset would have to reproduce by hand). */
export function logout(): void {
  clearStoredToken();
  if (typeof location !== 'undefined') {
    location.reload();
  }
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

/** REQ-0032: commits a preset drag-to-reorder (0-based from/to) through
 * engine.reorderPreset -- same "engine mutator + notifyStateChanged()"
 * pattern as every other preset action above, so auto-save picks up the
 * new order/active index exactly like any other mutation. The engine
 * itself recomputes `active` so it keeps identifying the SAME preset
 * across the move (see reorderPreset's own doc); this wrapper does not
 * need to touch anything UI-side beyond the standard re-render+autosave. */
export function reorderActivePreset(from: number, to: number): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.reorderPreset(st, from, to);
  if (r.ok) notifyStateChanged();
}

/** REQ-0032: deletes preset `n` (0-based) via the preset trash-drop-zone.
 * Refusal (last remaining preset) sets `presetDeleteRefused` to a brief
 * message instead of mutating anything -- PresetTabs.tsx renders this as
 * short-lived inline feedback (see clearPresetDeleteRefused's auto-hide
 * timer below), and the tab is NOT removed, matching the spec's "show
 * brief inline feedback... do not remove the tab". A successful delete
 * drops ONLY the preset's own reference set (engine.deletePreset never
 * touches st.inv -- see REQ-0033's reference model, which supersedes
 * REQ-0032's original physical-return paragraph) and lands `active` on
 * the engine's own nearest-remaining-tab choice. */
export function deleteActivePresetTab(n: number): void {
  const st = snapshot.state;
  const engine = snapshot.engine;
  if (!st || !engine) return;
  const r = engine.deletePreset(st, n);
  if (r.ok) {
    notifyStateChanged();
    return;
  }
  setSnapshot({ ...snapshot, presetDeleteRefused: 'Cannot delete the last remaining preset' });
  schedulePresetDeleteRefusedClear();
}

let presetDeleteRefusedTimer: ReturnType<typeof setTimeout> | null = null;

/** Auto-hides the trash-refusal message a few seconds after it appears --
 * "brief" per the REQ-0032 spec, same pattern as
 * scheduleWelcomeBannerClear() above. */
function schedulePresetDeleteRefusedClear(delayMs = 3000): void {
  if (presetDeleteRefusedTimer !== null) clearTimeout(presetDeleteRefusedTimer);
  presetDeleteRefusedTimer = setTimeout(() => {
    presetDeleteRefusedTimer = null;
    clearPresetDeleteRefused();
  }, delayMs);
}

/** Dismisses the trash-refusal message immediately (called internally by
 * the auto-hide timer above; also safe to call from a UI close control if
 * one is ever added). */
export function clearPresetDeleteRefused(): void {
  if (snapshot.presetDeleteRefused === null) return;
  setSnapshot({ ...snapshot, presetDeleteRefused: null });
}

/** REQ-0032: the SAME active-index adjustment rule reorderPreset's engine
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
 * this wrapper's job alone, unlike the preset case where the engine
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
 * currently calls it directly other than the debounce timer itself.
 * REQ-0037: saves to resolveProfileId() (the authenticated player's own
 * id), not a hardcoded 'default'. */
export async function flushAutoSave(): Promise<void> {
  const st = snapshot.state;
  if (!st) return;
  const myToken = ++autoSaveToken;
  try {
    await saveCanvas(resolveProfileId(), st);
    if (myToken === autoSaveToken) setAutoSaveStatus('saved');
  } catch (e) {
    console.warn('[backpack_ragnarok] auto-save failed:', e instanceof Error ? e.message : e);
    if (myToken === autoSaveToken) setAutoSaveStatus('offline');
  }
}

/**
 * Load: GET /api/profile/:profileId/canvas (REQ-0037: the authenticated
 * player's own id via resolveProfileId(), not a hardcoded 'default'),
 * then replace state's OWN FIELDS in place (never reassign
 * `snapshot.state` to a new object) -- mirrors the mock's
 * `state.linked=...; state.bps=...; state.pos=...; state.sis=...`,
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
    const doc = await fetchCanvas(resolveProfileId());
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
