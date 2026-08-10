// client/src/store/boot.ts -- REQ-0047 (f2): boot + identity: resolveProfileId, boot(), setLocale, setActiveInvPage.
// Moved VERBATIM from client/src/store.ts (see that file for the barrel).
import { Engine } from '../engine/adapter';
import { setUnitDefs, setUnitSkins } from '../board/unitIcon';
import { loadSkinDefs, setBpSkinDefs } from '../board/skin/skinRegistry'; // REQ-0266
import { fetchSkinPrefs } from '../api/skins'; // REQ-0266
import { setItemArtUrls } from '../board/itemArt'; // REQ-0133
import { ribbonProbeFor } from '../board/usageRibbonProbe'; // REQ-0287
import { paintCounts } from '../board/paintProbe'; // REQ-0345
import { cursorProbeFor } from '../board/cursorProbe'; // REQ-0290
import { bpSkinProbe, resetBpSkinProbe } from '../board/skin/bpSkinProbe'; // REQ-0350
import { ApiError, fetchMe, getStoredToken, resolveGameData, setStoredToken } from '../api';
import type { ApiMe } from '../api';
import { INVITE_HASH_RE, snapshot, setSnapshot } from './core';
import type { Locale } from './core';
import { clearUndo } from './undo';
import { readGuide, writeGuide, defaultGuide } from '../guide/guideModel'; // REQ-0141
import { buildStarterUnitsState } from '../../../shared/player_actions.mjs'; // REQ-0310 (was a local function here)
import { createSupabaseClient } from '../auth/client'; // REQ-0118c
import { initSupabaseAuth } from '../auth/session'; // REQ-0118c

export function resolveProfileId(): string {
  return snapshot.me?.playerId ?? 'default';
}

/** Profile id to SAVE to. Unlike resolveProfileId() (used by boot/load,
 * which run only after fetchMe has been awaited), this refuses to fall back
 * to the 'default' alias when a guest token IS stored but /api/me has not
 * resolved yet: PUTting a real guest's canvas to 'default' is rejected
 * (403) by the server and would silently drop the save. Returns null in
 * that "identity not known yet" case so the caller can defer + retry. With
 * no token stored, 'default' is correct (the server maps it to the dev
 * player under dev_mode). */
export function resolveSaveProfileId(): string | null {
  if (snapshot.me) return snapshot.me.playerId;
  if (getStoredToken()) return null;
  return 'default';
}

/** Re-fetches /api/me and updates snapshot.me on success (used by auto-save
 * when it finds a stored token but no resolved identity yet). Non-fatal on
 * failure -- leaves snapshot.me as-is; the caller retries. */
export async function refreshMe(): Promise<void> {
  try {
    const me = await fetchMe();
    if (me) setSnapshot({ ...snapshot, me });
  } catch { /* leave me unresolved; caller retries */ }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** fetchMe with a few retries -- only worth retrying when a token IS stored
 * (a real guest whose identity MUST resolve to their own profile before the
 * first save, else auto-save would 403 against the 'default' alias). With
 * no token the dev_mode fallback is deterministic and a failure is
 * terminal. */
async function fetchMeWithRetry(attempts = 3, delayMs = 500): Promise<ApiMe | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchMe();
    } catch (e) {
      // REQ-0365: a 401 is an ANSWER, not a failure -- the server has told us
      // there is no identity behind this request. Rethrow so bootInner() can
      // turn it into status:'signed_out'; retrying it would only ask the same
      // question three times and then silently degrade to the 'default' alias.
      if (e instanceof ApiError && e.status === 401) throw e;
      if (!getStoredToken()) return null;
      if (i < attempts - 1) await sleep(delayMs * (i + 1));
    }
  }
  return null;
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

// REQ-0336: boot() is called as a FLOATING promise (main.tsx:25 -- `boot();`,
// no .catch), and the only status:'error' it ever set was for a failed FETCH.
// Anything that threw AFTER the data arrived -- engine.migrateState() on a
// canvas the engine cannot hydrate is the reachable case -- rejected into
// nothing: the snapshot stayed 'loading' forever and both boards sat on
// "Loading board... / Loading inventory..." with no error, no boundary, no way
// out. Reproduced while writing client/e2e/board-poisoned.spec.ts: a canvas
// carrying one extra structurally-invalid BP wedges the app exactly there.
//
// That is a FOURTH shape of the freeze the owner keeps reporting, and the same
// class as the others: an uncaught throw with nobody underneath it. Board.tsx
// and InventoryBoard.tsx already render a "Board unavailable: {error}" branch
// for status:'error' -- they were simply never reached. This wrapper reaches
// them. A user with an unloadable save now sees what went wrong instead of an
// eternal spinner.
export async function boot(): Promise<void> {
  try {
    await bootInner();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[backpack_ragnarok] boot failed after data load -- surfacing as status:error', e);
    setSnapshot({
      ...snapshot,
      status: 'error',
      source: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function bootInner(): Promise<void> {
  // REQ-0041 fix -- boot-sequence auth race (found while adding
  // SlotsPanel.tsx's client-side isSquadDeployable gate, which was the
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
  // REQ-0118c: restore any persisted Supabase session (and finish an OAuth
  // redirect round-trip via detectSessionInUrl) BEFORE the first /api/me,
  // so a signed-in player's very first request already carries the Bearer
  // JWT. A no-op when Supabase is not configured (createSupabaseClient()
  // returns null), leaving the REQ-0037 flow byte-identical.
  //
  // REQ-0341: createSupabaseClient() is now ASYNC -- it awaits GET
  // /api/config instead of reading Vite-inlined env. That inserts one
  // network round-trip between page load and the client's construction,
  // which matters because the client is configured with detectSessionInUrl
  // + flowType:'pkce' and must exist before the OAuth callback parameters
  // are consumed or destroyed. It is safe here, and the reason is specific:
  //   - PKCE returns its callback in the QUERY STRING (?code=...), not the
  //     fragment. auth-js only treats a URL as a PKCE callback when
  //     params.code AND a stored code-verifier are both present
  //     (GoTrueClient _isPKCECallback), and it is auth-js itself that
  //     removes the param afterwards, via
  //     url.searchParams.delete('code') + history.replaceState.
  //   - Nothing in this app ever writes location.search. setRoute() writes
  //     only location.hash (store/routing.ts), setRouteReplacingHash() and
  //     contentadmin's deep-link rewrite both rebuild the URL as
  //     location.pathname + location.search + hash, and initRouting() only
  //     READS the hash on load. So ?code= survives an arbitrary delay.
  //   - The await still runs BEFORE fetchMe(), so the first /api/me carries
  //     the Bearer JWT exactly as before; initSupabaseAuth() awaits
  //     getSession(), which awaits auth-js's initializePromise and therefore
  //     the URL detection itself.
  await initSupabaseAuth(await createSupabaseClient());
  // REQ-0365: STOP HERE when the server will not identify us.
  //
  // Why this early return has to exist, and why it is not paranoia: with
  // dev_mode OFF and no credential, /api/me and /api/profile/<id>/canvas both
  // 401, but /api/content does NOT (content serving is public). resolveGameData
  // swallows the canvas 401 (`fetchCanvas(profileId).catch(() => null)`) and
  // reports source:'live' with isFreshProfile:true -- so boot() used to SUCCEED
  // into a pristine scenario board that looked completely normal and whose
  // every auto-save 401'd in silence. Measured on a scratch dev_mode:false api,
  // 2026-08-03; see this REQ's Investigation section.
  //
  // So the signed-out branch must be taken BEFORE resolveGameData, not after:
  // once the scenario board exists there is nothing left to distinguish it from
  // a real one.
  let me: ApiMe | null = null;
  try {
    me = await fetchMeWithRetry();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setSnapshot({ ...snapshot, me: null, status: 'signed_out', source: null, error: null });
      return;
    }
    throw e;
  }
  if (me) setSnapshot({ ...snapshot, me });

  // REQ-0266 (item 24): the player's skin PICKS, fetched ALONGSIDE the canvas
  // rather than after it. fetchSkinPrefs never rejects -- a 404, a 401, an older
  // server with no such route, a network failure and a malformed body all
  // resolve to empty prefs -- so firing it here costs nothing on the error path
  // and can never block boot. Ruling D5: absence IS the default.
  const skinPrefsPromise = fetchSkinPrefs(resolveProfileId());
  const resolved = await resolveGameData(resolveProfileId());
  if (resolved.source === 'error' || !resolved.gameData) {
    setSnapshot({ ...snapshot, status: 'error', source: 'error', error: resolved.error ?? 'unknown error' });
    return;
  }
  const gameData = resolved.gameData;
  // REQ-0170: the Unit registries. Without them every BP would resolve to "no
  // connection shape" and the board would draw no rays at all -- the engine
  // deliberately fails soft rather than throwing, so this line is the difference
  // between a working board and a silently link-less one.
  const engine = Engine.create(gameData.ITEMS, gameData.SI_DEFS, gameData.LAYOUT, gameData.TREES, gameData.UNITS, gameData.CONN_SHAPES);
  // REQ-0170: hand the defs to the raster manifest BEFORE any board mounts, so
  // loadBoardTextures() has the unit art list on its first (cached) call.
  setUnitDefs(gameData.UNITS);
  // REQ-0133: hand the server-resolved registry-first item art URLs to the raster
  // manifest BEFORE any board mounts, so loadBoardTextures()'s first (cached) call
  // already carries the item rasters (art arrives as DATA; the renderer is untouched).
  setItemArtUrls(gameData.ART_URLS);
  // REQ-0266: cosmetic skins arrive as DATA; the renderer is untouched. Both
  // registries are keyed by SKIN id (ruling D-A) and both degrade to empty. The
  // awaited promise was started before the canvas fetch above.
  setUnitSkins(gameData.UNIT_SKINS, gameData.ART_URLS, await skinPrefsPromise);
  setBpSkinDefs(loadSkinDefs(gameData.BPSKINS, { unitSkins: gameData.UNIT_SKINS, artUrls: gameData.ART_URLS }));
  let state = engine.migrateState(gameData.makeState()); // REQ-0051: reassigned by fresh-profile starter seed

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
  // placement does. Uses firstFitTMCell to find the landing cell rather
  // than assuming [1,1] is free -- migrateState (called just above) has
  // ALREADY first-fit-homed the baked scenario's own starter BP/PO/SI
  // content into inventory page 0 via its REQ-0033 reference-model
  // migration (migrateCanvasToReferencesV3), typically starting at
  // [1,1] itself, so a fresh profile's page 0 is USUALLY not actually
  // empty by the time this runs (a real bug, first found via E2E
  // coverage of the guest-creation-100-LRDST flow -- see this file's
  // git history for the fix).
  // REQ-0051: a genuinely fresh profile is seeded with the four starter units
  // (Guard/Arms/Mend/Scout) -- 5x5 BPs (connection_shape none) each pre-filled with
  // 4 fixed, immovable POs -- REPLACING the legacy demo scenario (a pre-
  // onboarding placeholder). The dev player and every e2e fixture load an
  // explicit saved canvas and never take this fresh path, so the swap is
  // scoped to real new guests. Solo 4-squad play is a RELIEF measure, not
  // best practice (game golden "march four packs"); the starter units are the
  // on-ramp. migrateState() then homes every BP+PO while keeping the canvas
  // fixed refs, exactly like any saved board.
  if (resolved.isFreshProfile) {
    const unitsSeed = buildStarterUnitsState(gameData, snapshot.locale);
    if (unitsSeed) state = engine.migrateState(unitsSeed);
  }
  if (resolved.isFreshProfile && state.inv) {
    // Fixed 2026-07-05: this used to hardcode cell [1,1] as the seed's
    // landing spot, assuming a truly fresh page starts empty -- but
    // migrateState()'s own REQ-0033 reference-model migration
    // (migrateCanvasToReferencesV3) ALREADY first-fits every canvas-
    // resident starter BP/PO/SI (the baked scenario's own starting
    // content) into an inventory home before this code ever runs, and
    // that first-fit walk conventionally starts at [1,1] too -- so on a
    // real fresh profile [1,1] is normally ALREADY occupied by the
    // scenario's own starter content by the time this line runs,
    // silently failing tmMove's placement (caught by E2E coverage of the
    // guest-creation-100-LRDST flow, not by any engine-level unit test,
    // since those construct a bare freshState() with no scenario content
    // competing for the same cell). Use firstFitTMCell to find a
    // genuinely free cell instead of assuming one.
    const seedPage = state.inv.pages[0];
    const seedCell = engine.firstFitTMCell(seedPage);
    if (seedCell) {
      const seedUid = 'lrdst_starter_' + Math.random().toString(36).slice(2, 10);
      engine.tmMove(state, 0, seedUid, seedCell, 'lrdst', 100);
    }
  }

  // REQ-0141: seed the first-run guide. Only a GENUINELY fresh profile
  // (isFreshProfile) starts the guided tour ('active'); a returning/dev/e2e-
  // fixture profile is left WITHOUT a guide field entirely (its saved canvas
  // stays byte-unchanged and it shows no tour). A returning player who already
  // engaged the guide keeps their persisted state.guide (makeState ->
  // migrateState preserves it), so this only writes when the field is absent.
  // No autosave is scheduled here (parity with the starter/LRDST seeds above).
  if (resolved.isFreshProfile && !readGuide(state)) {
    writeGuide(state, defaultGuide('active'));
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
  // usageOf/isSquadIndependent/usedByCurrent) directly off the live
  // `engine`/`state` closures captured here -- both are stable
  // references that the engine mutates IN PLACE (see this file's own
  // module comment), so this hook always reflects the CURRENT state with
  // zero extra wiring, even across squad switches/board mutations/
  // reloads-within-this-boot. Exists purely so client/e2e/*.spec.ts can
  // assert on exact uid sets (`page.evaluate(() => window.__backpackDebug
  // .tintSets())`) instead of reverse-engineering PixiJS canvas pixel
  // colors -- never used by any production UI code path in this app.
  (window as unknown as { __backpackDebug: unknown }).__backpackDebug = {
    tintSets: () => engine.tintSets(state),
    usageOf: (uid: string) => engine.usageOf(state, uid),
    usedByCurrent: (uid: string) => engine.usedByCurrent(state, uid),
    usedByOthers: (uid: string) => engine.usedByOthers(state, uid),
    isSquadIndependent: (n: number) => engine.isSquadIndependent(state, n),
    // REQ-0041 feedback 5: exposed for the same reason/parity as
    // isSquadIndependent just above (client/e2e/*.spec.ts assertions).
    isSquadDeployable: (n: number) => engine.isSquadDeployable(state, n),
    // REQ-0287: per-board ownership-ribbon probe (canvas | inv:<page>).
    usageRibbonProbe: (boardKey: string) => ribbonProbeFor(boardKey),
    // REQ-0290: per-board affordance probe -- the cursor the renderer ASSIGNED
    // to each interactive object on its last render (canvas | inv:<page>). A
    // board is one canvas with one live cursor, so this is the only way to
    // assert "the seat says not-allowed AND the badge still says grab" without
    // walking a real mouse over every cell. See cursorProbe.ts.
    cursorProbe: (boardKey: string) => cursorProbeFor(boardKey),
    // REQ-0345: frames each board Application has submitted, keyed by
    // boardIdKey. Asserts BOTH directions of the on-demand rule: the count
    // must climb when something visibly changed, and must not move at all
    // while the boards sit idle (the pre-REQ-0345 ticker moved it ~60/s per
    // board, forever, on every route).
    boardPaints: () => paintCounts(),
    // REQ-0350: BP-skin composite / cache-hit counters. Asserts BOTH directions
    // of the cache rule, for the same reason boardPaints does: repeated
    // render(state) over an unmoved board must add ZERO composites while the hit
    // count climbs. Pre-REQ-0350 every render recomposited every skinned BP --
    // three distance transforms plus a full W*H pass each -- because the cache
    // was consulted AFTER compositeSkin() and keyed on ABSOLUTE cells.
    bpSkinProbe: () => bpSkinProbe(),
    resetBpSkinProbe: () => resetBpSkinProbe(),
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
  // REQ-0367 (spec item 4): an inventory page change is a context switch
  // the player can see -- it drops the one-step undo snapshot.
  clearUndo();
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
