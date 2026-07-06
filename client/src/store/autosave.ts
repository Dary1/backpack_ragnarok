// client/src/store/autosave.ts -- REQ-0047 (f2): debounced auto-save (REQ-0031 Phase B) + flushAutoSave + loadGame.
// Moved VERBATIM from client/src/store.ts (see that file for the barrel).
import { fetchCanvas, saveCanvas } from '../api';
import { cancelCarry } from '../board/drag';
import { snapshot, setSnapshot } from './core';
import type { StoreSnapshot } from './core';
import { resolveProfileId } from './boot';
import { notifyStateChanged } from './presets';

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
export function scheduleAutoSave(): void {
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
