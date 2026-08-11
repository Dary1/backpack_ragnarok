// client/src/store/routing.ts -- REQ-0047 (f2): hash routing + invite flow + welcome banner.
// REQ-0362: the logout() that used to live at the bottom of this file is GONE.
// It cleared only the REQ-0037 invite token and reloaded, which left a
// persisted Supabase session (REQ-0118c) untouched and therefore did nothing
// visible. Sign-out is now Settings.tsx's AuthBlock alone -- one control that
// drops the Supabase session AND the invite token. Do not re-add a
// store-level logout(): a second entry point is how the two diverged.
// Moved VERBATIM from client/src/store.ts (see that file for the barrel).
// REQ-0052: extended with '#/dex/<id>' deep-link handling (DEX_ITEM_HASH_RE) --
// see core.ts's module comment on DEX_ITEM_HASH_RE/dexFocusId for the design note.
import { fetchMe, setStoredToken } from '../api';
import type { ApiMe } from '../api';
import { ARTADMIN_HASH_RE, CONTENTADMIN_HASH_RE, DEX_ITEM_HASH_RE, INVITE_HASH_RE, MARKET_BUY_HASH_RE, MARKET_SELL_HASH_RE, SORTIE_HASH_RE, routeFromHash, snapshot, setSnapshot } from './core';
import type { Route } from './core';
import { clearUndo } from './undo';

export function setRoute(route: Route): void {
  if (route === snapshot.route) return;
  // REQ-0367 (spec item 4): a route change is a context switch -- drop the
  // one-step undo snapshot (undo never crosses one).
  clearUndo();
  setSnapshot({ ...snapshot, route });
  if (typeof location !== 'undefined') {
    // REQ-0069: the landing's canonical hash is the bare '#/' (empty
    // route path), not '#/landing' -- see core.ts's routeFromHash().
    location.hash = route === 'landing' ? '#/' : `#/${route}`;
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
  } catch {
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

/** REQ-0052: clears a consumed Dex deep-link target (see core.ts's
 * dexFocusId doc). Dex.tsx calls this right after honoring a pending
 * dexFocusId (jumping its OWN local selectedId state to it) so the same
 * id does not keep re-forcing a jump on later, unrelated re-renders --
 * mirrors clearWelcomeBanner()'s "one-shot store field, explicit
 * consume-then-clear" shape immediately above. */
export function clearDexFocusId(): void {
  if (snapshot.dexFocusId === null) return;
  setSnapshot({ ...snapshot, dexFocusId: null });
}

/** REQ-0164 (contentadmin-ux-r2 D): clears a consumed contentadmin deep-link
 * target (see core.ts's contentAdminFocusName doc). ContentAdminPage calls
 * this right after honoring a pending focus name -- mirrors clearDexFocusId's
 * "one-shot store field, explicit consume-then-clear" shape. */
export function clearContentAdminFocusName(): void {
  if (snapshot.contentAdminFocusName === null) return;
  setSnapshot({ ...snapshot, contentAdminFocusName: null });
}

/** REQ-0173 (contentadmin-entity-rendering B): clears a consumed artadmin
 * deep-link target (see core.ts's artAdminFocusName doc). ArtAdminPage calls
 * this right after honoring a pending focus name -- exact mirror of
 * clearContentAdminFocusName's one-shot consume-then-clear shape. */
export function clearArtAdminFocusName(): void {
  if (snapshot.artAdminFocusName === null) return;
  setSnapshot({ ...snapshot, artAdminFocusName: null });
}

/** REQ-0198 (B): clears a consumed market SELL deep-link target (see
 * core.ts's marketSellFocus doc). MarketPage calls this right after it has
 * switched to the SELL pane + latched the preselect into its own state --
 * exact mirror of clearDexFocusId's one-shot consume-then-clear shape. */
export function clearMarketSellFocus(): void {
  if (snapshot.marketSellFocus === null) return;
  setSnapshot({ ...snapshot, marketSellFocus: null });
}

/** REQ-0374: clears a consumed market BUY deep-link target (see core.ts's
 * marketBuyFocus doc). MarketPage calls this right after it has switched to
 * the BUY pane + seeded its own search state -- exact mirror of
 * clearMarketSellFocus's one-shot consume-then-clear shape. */
export function clearMarketBuyFocus(): void {
  if (snapshot.marketBuyFocus === null) return;
  setSnapshot({ ...snapshot, marketBuyFocus: null });
}

/** REQ-0239: clears a consumed sortie deep-link target (sortieFocusDungeonId). */
export function clearSortieFocusDungeonId(): void {
  if (snapshot.sortieFocusDungeonId === null) return;
  setSnapshot({ ...snapshot, sortieFocusDungeonId: null });
}

/** Like setRoute(), but uses history.replaceState-style semantics for the
 * hash (no back-button entry for the one-shot invite hash itself) -- the
 * invite link should not leave "#/invite/<token>" sitting in browser
 * history for the user to accidentally navigate back onto. Falls back to
 * a plain hash write if the History API isn't available for some reason. */
function setRouteReplacingHash(route: Route): void {
  clearUndo(); // REQ-0367 (spec item 4): route change -- see setRoute().
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
 *
 * REQ-0052: if the hash instead matches `#/dex/<id>` (DEX_ITEM_HASH_RE),
 * the route resolves to 'dex' (a plain, pre-existing Route member) AND
 * `dexFocusId` is set to the decoded id -- checked BEFORE the generic
 * routeFromHash() fallback, same ordering rationale as the invite check
 * (a more specific pattern must win over the plain '#/dex' match that
 * routeFromHash's raw-segment comparison would otherwise silently lose,
 * since routeFromHash only recognizes EXACT top-level route names and
 * would fall back to 'backpacks' for an unrecognized 'dex/<id>' segment
 * if this check were skipped).
 */
export function initRouting(): () => void {
  if (typeof location !== 'undefined') {
    const inviteMatch = INVITE_HASH_RE.exec(location.hash);
    const dexItemMatch = inviteMatch ? null : DEX_ITEM_HASH_RE.exec(location.hash);
    const caMatch = inviteMatch || dexItemMatch ? null : CONTENTADMIN_HASH_RE.exec(location.hash);
    const artMatch = inviteMatch || dexItemMatch || caMatch ? null : ARTADMIN_HASH_RE.exec(location.hash);
    const marketSellMatch = inviteMatch || dexItemMatch || caMatch || artMatch ? null : MARKET_SELL_HASH_RE.exec(location.hash);
    const marketBuyMatch = inviteMatch || dexItemMatch || caMatch || artMatch || marketSellMatch ? null : MARKET_BUY_HASH_RE.exec(location.hash);
    const sortieMatch = inviteMatch || dexItemMatch || caMatch || artMatch || marketSellMatch || marketBuyMatch ? null : SORTIE_HASH_RE.exec(location.hash);
    if (inviteMatch) {
      setSnapshot({ ...snapshot, route: 'backpacks' });
      void handleInviteRoute(decodeURIComponent(inviteMatch[1]));
    } else if (dexItemMatch) {
      setSnapshot({ ...snapshot, route: 'dex', dexFocusId: decodeURIComponent(dexItemMatch[1]) });
    } else if (caMatch) {
      setSnapshot({ ...snapshot, route: 'contentadmin', contentAdminFocusName: decodeURIComponent(caMatch[1]) });
    } else if (artMatch) {
      setSnapshot({ ...snapshot, route: 'artadmin', artAdminFocusName: decodeURIComponent(artMatch[1]) });
    } else if (marketSellMatch) {
      setSnapshot({ ...snapshot, route: 'market', marketSellFocus: { uid: decodeURIComponent(marketSellMatch[1]), kind: (marketSellMatch[2] as 'po' | 'si' | 'unit') || 'po' } });
    } else if (marketBuyMatch) {
      setSnapshot({ ...snapshot, route: 'market', marketBuyFocus: decodeURIComponent(marketBuyMatch[1]) });
    } else if (sortieMatch) {
      setSnapshot({ ...snapshot, route: 'sortie', sortieFocusDungeonId: decodeURIComponent(sortieMatch[1]) });
    } else {
      const initial = routeFromHash(location.hash);
      if (initial !== snapshot.route) setSnapshot({ ...snapshot, route: initial });
    }
  }
  const onHashChange = () => {
    if (typeof location === 'undefined') return;
    clearUndo(); // REQ-0367 (spec item 4): browser navigation is a route change too.
    const inviteMatch = INVITE_HASH_RE.exec(location.hash);
    if (inviteMatch) {
      void handleInviteRoute(decodeURIComponent(inviteMatch[1]));
      return;
    }
    const dexItemMatch = DEX_ITEM_HASH_RE.exec(location.hash);
    if (dexItemMatch) {
      setSnapshot({ ...snapshot, route: 'dex', dexFocusId: decodeURIComponent(dexItemMatch[1]) });
      return;
    }
    const caMatch = CONTENTADMIN_HASH_RE.exec(location.hash);
    if (caMatch) {
      setSnapshot({ ...snapshot, route: 'contentadmin', contentAdminFocusName: decodeURIComponent(caMatch[1]) });
      return;
    }
    const artMatch = ARTADMIN_HASH_RE.exec(location.hash);
    if (artMatch) {
      setSnapshot({ ...snapshot, route: 'artadmin', artAdminFocusName: decodeURIComponent(artMatch[1]) });
      return;
    }
    const marketSellMatch = MARKET_SELL_HASH_RE.exec(location.hash);
    if (marketSellMatch) {
      setSnapshot({ ...snapshot, route: 'market', marketSellFocus: { uid: decodeURIComponent(marketSellMatch[1]), kind: (marketSellMatch[2] as 'po' | 'si' | 'unit') || 'po' } });
      return;
    }
    const marketBuyMatch = MARKET_BUY_HASH_RE.exec(location.hash);
    if (marketBuyMatch) {
      setSnapshot({ ...snapshot, route: 'market', marketBuyFocus: decodeURIComponent(marketBuyMatch[1]) });
      return;
    }
    const sortieMatch = SORTIE_HASH_RE.exec(location.hash);
    if (sortieMatch) {
      setSnapshot({ ...snapshot, route: 'sortie', sortieFocusDungeonId: decodeURIComponent(sortieMatch[1]) });
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

// ---------------------------------------------------------------------
// Squad actions (REQ-0031 Phase B). All three go through the engine's
// squad mutators (switchSquad/addSquad/renameSquad) then
// notifyStateChanged() -- same pattern as every board interaction commit
// in BoardRenderer.ts -- so auto-save picks up the change exactly like
// any other mutation, and the canvas board's existing render(state)-on-
// stateVersion-bump subscription (Board.tsx) redraws the newly-active
// squad's bps/pos/sis with NO Pixi Application recreation (Phase A
// lesson: canvas ops read state.bps/pos/sis directly -- see
// boardOps.ts's makeCanvasOps container(){return state;} -- so
// switchSquad() mutating those same top-level fields in place is
// already everything Board.tsx's render() needs; there is no separate
// per-squad BoardOps/boardId the way inventory pages have one per page,
// so no setOps() call is needed here at all, only the state mutation +
// notifyStateChanged() re-render every other commit already relies on).

/** Switches the active squad (0-based index). Beams/connections/combos
 * recompute automatically on the next render() since they are always
 * derived fresh from st.bps/st.pos (traceBeams/combos take no cached
 * state) -- nothing squad-specific needs to be invalidated by hand. */
