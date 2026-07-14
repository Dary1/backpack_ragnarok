// client/src/store/boot.ts -- REQ-0047 (f2): boot + identity: resolveProfileId, boot(), setLocale, setActiveInvPage.
// Moved VERBATIM from client/src/store.ts (see that file for the barrel).
import { Engine } from '../engine/adapter';
import { setUnitDefs } from '../board/unitIcon';
import { fetchMe, getStoredToken, resolveGameData, setStoredToken } from '../api';
import type { ApiMe } from '../api';
import { INVITE_HASH_RE, snapshot, setSnapshot } from './core';
import type { Locale } from './core';
import type { GameData } from "../api/content"; // REQ-0051
import { readGuide, writeGuide, defaultGuide } from '../guide/guideModel'; // REQ-0141
import type { GameState, BP, PO, SquadSlot } from "../engine/engine.d.ts"; // REQ-0051
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
    } catch {
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
/**
 * REQ-0051: builds the fresh-profile starting GameState from the served
 * starter-unit definitions (gameData.starterUnits) -- four starter units -- 5x5 BPs (Unit forms no links), each a BP with an authored hpMax override pre-filled with 4 fixed
 * (immovable) POs. Returns null when the payload carries no starterUnits (an
 * older server), so boot() falls back to the baked demo scenario. The caller
 * runs the result through engine.migrateState(), which gives every BP+PO an
 * inventory home while preserving the canvas fixed references.
 */
function buildStarterUnitsState(gameData: GameData, locale: Locale): GameState | null {
  const su = gameData.starterUnits;
  if (!su || !Array.isArray(su.units) || su.units.length === 0) return null;
  const slotFor = (unit: (typeof su.units)[number]): SquadSlot => {
    const bp: BP = {
      id: "bp_" + unit.id,
      name: unit.name,
      color: unit.color,
      shape: su.bpShape,
      origin: su.origin,
      unit: { id: su.unit.id, off: su.unit.off },
      hpMax: su.hpMax,
    };
    const pos: PO[] = unit.pos.map((pp, i) => ({
      uid: "po_" + unit.id + "_" + i,
      id: pp.id,
      loc: "grid" as const,
      cell: pp.cell,
      rot: pp.rot,
      fixed: true,
    }));
    return { linked: true, bps: [bp], pos, sis: [] };
  };
  const nameOf = (unit: (typeof su.units)[number]): string =>
    (locale === "ja" && unit.i18n && unit.i18n.ja && unit.i18n.ja.name) ? unit.i18n.ja.name : unit.name;
  const units = su.units;
  const first = slotFor(units[0]);
  const names: string[] = units.map(nameOf);
  const store: Array<SquadSlot | null> = [null];
  for (let i = 1; i < units.length; i++) store.push(slotFor(units[i]));
  // Pad to the engine default squad count so a fresh guest keeps one empty
  // spare squad tab (matches makeSquadsMeta shape).
  while (names.length < 5) { names.push("Squad " + (names.length + 1)); store.push({ linked: true, bps: [], pos: [], sis: [] }); }
  return { linked: first.linked, bps: first.bps, pos: first.pos, sis: first.sis, presets: { active: 0, names, store } };
}

export async function boot(): Promise<void> {
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
  await initSupabaseAuth(createSupabaseClient());
  const me: ApiMe | null = await fetchMeWithRetry();
  if (me) setSnapshot({ ...snapshot, me });

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
