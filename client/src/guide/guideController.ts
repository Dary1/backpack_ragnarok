// client/src/guide/guideController.ts -- REQ-0141. Mutation + lifecycle layer.
// Every guide mutation flows through notifyStateChanged() (store/squads.ts) --
// THE post-mutation choke point -- so a step advance / skip / finish / replay /
// hint-mark both re-renders the subscribed overlay AND debounce-schedules the
// auto-save PUT that persists state.guide, exactly like any other canvas
// mutation. No new persistence path is introduced.
import { snapshot, notifyStateChanged, subscribe, getSnapshot } from '../store';
import {
  GUIDE_STEP_COUNT, defaultGuide, readGuide, writeGuide,
  type GuideHintId, type GuidePersisted,
} from './guideModel';

function activeGuide(): GuidePersisted | null {
  return readGuide(snapshot.state);
}

function setGuide(next: GuidePersisted): void {
  const st = snapshot.state;
  if (!st) return;
  writeGuide(st, next);
  notifyStateChanged();
}

/** Advances the active tour by one card; finishing the last marks it done. */
export function advanceGuide(): void {
  const g = activeGuide();
  if (!g || g.status !== 'active') return;
  const nextStep = g.step + 1;
  if (nextStep >= GUIDE_STEP_COUNT) setGuide({ ...g, status: 'done', step: GUIDE_STEP_COUNT, seen: true });
  else setGuide({ ...g, step: nextStep, seen: true });
}

/** Skips the whole guide from any point -- the canvas is left exactly as it is
 * (a fully usable starter canvas). */
export function skipGuide(): void {
  const g = activeGuide();
  if (!g || g.status !== 'active') return;
  setGuide({ ...g, status: 'skipped', seen: true });
}

/** Replays the guide from the first card (Settings -> Replay). Works for any
 * profile, including one that never carried a guide field (a veteran/dev
 * profile) -- it simply gains one now. Keeps hint seen-flags. */
export function replayGuide(): void {
  const g = readGuide(snapshot.state) ?? defaultGuide('done');
  setGuide({ status: 'active', step: 0, seen: true, hints: g.hints });
}

/** Marks a first-time contextual hint permanently seen. */
export function markHintSeen(id: GuideHintId): void {
  const g = activeGuide();
  if (!g || g.hints[id]) return;
  setGuide({ ...g, hints: { ...g.hints, [id]: true } });
}

// ---------------------------------------------------------------------------
// Contextual hints (first-time). A single transient "which hint is showing"
// with its own micro pub-sub (kept OUT of the store snapshot so no snapshot
// shape / initial-literal change is needed). The persisted seen-flag makes each
// hint fire at most once ever per profile; noteHint() is additionally gated on
// guide.seen so ONLY onboarded players (a genuinely fresh guest who engaged the
// guide) ever see one -- veterans / e2e fixtures never do.
// ---------------------------------------------------------------------------
let activeHint: GuideHintId | null = null;
const hintListeners = new Set<() => void>();
export function subscribeHint(l: () => void): () => void { hintListeners.add(l); return () => { hintListeners.delete(l); }; }
export function getActiveHint(): GuideHintId | null { return activeHint; }
function setActiveHint(h: GuideHintId | null): void { activeHint = h; for (const l of hintListeners) l(); }

/** Surfaces a first-time hint (once ever). No-op unless the player has engaged
 * the guide and this hint has not been seen. */
export function noteHint(id: GuideHintId): void {
  const g = activeGuide();
  if (!g || !g.seen || g.hints[id]) return;
  markHintSeen(id);
  setActiveHint(id);
}

export function dismissHint(): void { setActiveHint(null); }

// ---------------------------------------------------------------------------
// Controller init (main.tsx). Subscribes to the store to surface the one
// contextual hint cleanly detectable from state alone -- the DUD BEAM
// (canvas_spec.md's intentional-dud: a Unit ray that reaches the canvas edge
// without linking any Unit) -- straight off engine.traceBeams, with NO
// BoardRenderer hook. Inert for every non-onboarded profile (the guide.seen
// gate) and for starter-only content (starter Units cast no rays), so it never
// fires in the e2e fixture suite. rotation / tagMismatch hints are
// interaction-transient (a rejected placement / a rotate gesture leave no state
// trace), so their copy ships ready but trigger wiring is deferred.
// ---------------------------------------------------------------------------
let inited = false;
let scanning = false;
export function initGuideController(): void {
  if (inited) return;
  inited = true;
  subscribe(() => {
    if (scanning) return;
    const snap = getSnapshot();
    if (snap.status !== 'ready' || !snap.state || !snap.engine) return;
    const g = readGuide(snap.state);
    if (!g || !g.seen || g.hints.dudBeam) return;
    scanning = true;
    try {
      const beams = snap.engine.traceBeams(snap.state);
      const hasDud = beams.some((b) => b.dir !== null && (b.tos ? b.tos.length === 0 : b.to === null) && b.path.length > 0);
      if (hasDud) setTimeout(() => noteHint('dudBeam'), 0);
    } catch { /* non-fatal */ } finally {
      scanning = false;
    }
  });
}
