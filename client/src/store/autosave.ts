// client/src/store/autosave.ts -- REQ-0047 (f2): debounced auto-save (REQ-0031 Phase B) + flushAutoSave + loadGame.
// Moved VERBATIM from client/src/store.ts (see that file for the barrel).
//
// REQ-0089: reliability hardening of the auto-save pipeline. The previous
// implementation had three data-loss/instability gaps:
//  1. Concurrent PUTs. A monotonically-increasing token guarded only the
//     STATUS flag, never the WRITE ORDER: if a save took longer than the
//     debounce and another mutation fired, TWO PUTs went in flight at once,
//     and the server (last-writer-wins) could persist the OLDER one -- the
//     "stale in-flight auto-save resurrects pre-trade/destroyed state" race
//     called out verbatim in api.ts's market/ragnarok DTO docs. Fixed with
//     a single-flight guard (`inFlight`) + a coalesced trailing save (any
//     mutation during a PUT re-runs exactly one follow-up PUT afterwards).
//  2. No retry. A failed PUT went to 'offline' and simply waited for the
//     NEXT user mutation; if the user stopped interacting, the edit was
//     silently never persisted. Fixed with an exponential-backoff retry.
//  3. No flush on exit. An edit made within the 800ms debounce window (or
//     a pending/failed save) was lost on reload/tab-close, because nothing
//     flushed on page hide. Fixed with initAutoSaveLifecycle() (keepalive
//     PUT on pagehide / visibilitychange->hidden).
// The public contract (scheduleAutoSave/flushAutoSave/loadGame + the
// 'saved'|'saving'|'offline' status) is unchanged; auto-save.spec.ts's
// mutate->debounce->reload round-trip still holds.
import { fetchCanvas, saveCanvas, saveCanvasBeacon } from '../api';
import { cancelCarry } from '../board/drag';
import { snapshot, setSnapshot } from './core';
import type { StoreSnapshot } from './core';
import { resolveProfileId, resolveSaveProfileId, refreshMe } from './boot';
import { notifyStateChanged } from './presets';

const AUTO_SAVE_DEBOUNCE_MS = 800;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
// Single-flight: at most ONE profile PUT is ever in flight, so the server
// never has to arbitrate two writes of the same profile (which, last-
// writer-wins, could persist the older one).
let inFlight = false;
// A mutation has happened since the last durable save (true = there is
// something to persist). Set on every scheduleAutoSave(); cleared only
// once a PUT for that state has actually started.
let dirty = false;
let retryDelay = RETRY_BASE_MS;
// Guards out-of-order STATUS writes only (a slow earlier attempt must not
// flip the indicator back to 'saved' after a newer one already did).
let statusToken = 0;

function setAutoSaveStatus(status: StoreSnapshot['autoSaveStatus']): void {
  if (snapshot.autoSaveStatus === status) return;
  setSnapshot({ ...snapshot, autoSaveStatus: status });
}

/** Debounces a background PUT of the current live GameState. Called from
 * notifyStateChanged() -- i.e. after every committed engine mutation
 * (drag-drop, rotate, seat/stow, chain-link toggle, preset switch, rename,
 * ...) and after loadGame()'s own field replacement. Resets the timer on
 * every call within the debounce window, so a rapid burst of mutations
 * collapses into a single PUT AUTO_SAVE_DEBOUNCE_MS after the last one.
 * Never fires while a drag is merely in progress: notifyStateChanged() is
 * only ever invoked at a drag's COMMIT, never during pointermove. */
export function scheduleAutoSave(): void {
  if (!snapshot.state) return;
  dirty = true;
  setAutoSaveStatus('saving');
  // A fresh user mutation supersedes any pending backoff wait: reset the
  // backoff schedule and let the debounce drive the next attempt.
  if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; }
  retryDelay = RETRY_BASE_MS;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => { debounceTimer = null; void pump(); }, AUTO_SAVE_DEBOUNCE_MS);
}

/** The single writer. Runs at most one PUT at a time; if the state is
 * still dirty when a PUT settles (a mutation arrived mid-flight, or the
 * PUT failed), it re-runs exactly one follow-up attempt. */
async function pump(): Promise<void> {
  if (inFlight) return;      // the in-flight settle will re-pump if needed
  if (!dirty) return;
  const st = snapshot.state;
  if (!st) return;
  const pid = resolveSaveProfileId();
  if (pid === null) {
    // A guest token is stored but /api/me has not resolved yet -- we don't
    // know this player's real profile id, and PUTting to the 'default'
    // alias would be rejected (403) for a non-dev player, silently dropping
    // the write. Defer: keep the change pending, (re)resolve identity, and
    // retry shortly.
    setAutoSaveStatus('saving');
    void refreshMe();
    scheduleRetry();
    return;
  }
  inFlight = true;
  dirty = false;                 // captured; mutations after this re-set it
  const myToken = ++statusToken;
  try {
    await saveCanvas(pid, st);
    retryDelay = RETRY_BASE_MS;
    if (myToken === statusToken && !dirty) setAutoSaveStatus('saved');
  } catch (e) {
    console.warn('[backpack_ragnarok] auto-save failed:', e instanceof Error ? e.message : e);
    dirty = true;                // never lose the unsaved change
    if (myToken === statusToken) setAutoSaveStatus('offline');
    scheduleRetry();
  } finally {
    inFlight = false;
    // Trailing save: only self-trigger if nothing else is already going to
    // (a pending debounce coalesces a burst; a pending retry owns backoff).
    if (dirty && debounceTimer === null && retryTimer === null) void pump();
  }
}

/** Schedules a single backoff retry (exponential, capped). No-op if one is
 * already pending. Cleared/reset by the next user mutation. */
function scheduleRetry(): void {
  if (retryTimer !== null) return;
  const delay = retryDelay;
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
  retryTimer = setTimeout(() => { retryTimer = null; void pump(); }, delay);
}

/** Immediately attempts a save of the current live GameState (no debounce)
 * -- the debounce timer's expiry goes through pump() directly, but this is
 * kept as an awaitable escape hatch for callers needing "save right now".
 * Routes through the same single-flight pump() so it can never introduce a
 * concurrent PUT. */
export async function flushAutoSave(): Promise<void> {
  if (!snapshot.state) return;
  dirty = true;
  if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null; }
  await pump();
}

/** Best-effort flush when the page is being hidden/unloaded, so an edit
 * made inside the debounce window (or a pending/failed save) survives a
 * reload or tab-close. Uses a keepalive PUT (saveCanvasBeacon) that can
 * outlive the page. */
function saveOnExit(): void {
  if (!dirty && !inFlight) return;
  const st = snapshot.state;
  if (!st) return;
  const pid = resolveSaveProfileId();
  if (pid === null) return;   // identity unknown -- nothing safe to write
  dirty = false;
  saveCanvasBeacon(pid, st);
}

let lifecycleWired = false;
/** Wires page-lifecycle flushes. Call once at boot (main.tsx). pagehide
 * covers reload/navigation/close (and the bfcache path); visibilitychange
 * ->hidden covers mobile tab-backgrounding where pagehide/beforeunload are
 * unreliable. Both just best-effort flush the current state. */
export function initAutoSaveLifecycle(): void {
  if (lifecycleWired) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  lifecycleWired = true;
  window.addEventListener('pagehide', saveOnExit);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveOnExit();
  });
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
