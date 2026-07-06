// client/src/store/routing.ts -- REQ-0047 (f2): hash routing + invite flow + welcome banner + logout.
// Moved VERBATIM from client/src/store.ts (see that file for the barrel).
import { clearStoredToken, fetchMe, setStoredToken } from '../api';
import type { ApiMe } from '../api';
import { INVITE_HASH_RE, routeFromHash, snapshot, setSnapshot } from './core';
import type { Route } from './core';

export function setRoute(route: Route): void {
  if (route === snapshot.route) return;
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
