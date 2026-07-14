// REQ-0059 -- Circuit Chimes: user preferences (chimes on/off, haptics
// on/off, volume), persisted to localStorage. Small and dependency-free,
// mirroring api/http.ts's TOKEN_STORAGE_KEY pattern (the app's only other
// localStorage-backed value). Pure enough to unit-test the default/merge/
// reduced-motion logic from plain Node (check_chime_mapping.mjs).

export interface ChimePrefs {
  /** Play the WebAudio circuit chimes. Default ON at a low mix (spec). */
  chimes: boolean;
  /** Fire navigator.vibrate haptics on mobile. Independent toggle. */
  haptics: boolean;
  /** Master mix volume, 0..1. Default low so chimes stay a subtle layer. */
  volume: number;
}

export const STORAGE_KEY = 'bp.chimes.prefs';
/** Dispatched on window whenever prefs are saved, so a mounted Monitor's
 * ChimeEngine can pick up a Settings change live (same tab). `detail` is
 * the new ChimePrefs. */
export const CHIME_PREFS_EVENT = 'bp-chime-prefs-changed';

/** The factory default. `reducedMotion` (from
 * `matchMedia('(prefers-reduced-motion: reduce)')`) suppresses chimes by
 * default on a FIRST visit only -- respecting the platform convention --
 * while leaving the explicit toggle fully in the user's hands once they
 * have saved a choice (see loadChimePrefs). Volume stays low regardless. */
export function defaultChimePrefs(reducedMotion = false): ChimePrefs {
  return { chimes: !reducedMotion, haptics: true, volume: 0.35 };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Coerce an arbitrary parsed value into a valid ChimePrefs, filling any
 * missing/invalid field from the default. Pure -- the storage read is
 * done by loadChimePrefs; this is the testable normaliser. */
export function normalizeChimePrefs(raw: unknown, reducedMotion = false): ChimePrefs {
  const d = defaultChimePrefs(reducedMotion);
  if (raw == null || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  return {
    chimes: typeof o.chimes === 'boolean' ? o.chimes : d.chimes,
    haptics: typeof o.haptics === 'boolean' ? o.haptics : d.haptics,
    volume: typeof o.volume === 'number' ? clamp01(o.volume) : d.volume,
  };
}

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Read prefs from localStorage. Missing key -> factory default (with the
 * reduced-motion-aware chimes default applied ONLY when nothing is stored
 * yet). Malformed JSON -> default, never a throw. */
export function loadChimePrefs(): ChimePrefs {
  const reduced = prefersReducedMotion();
  try {
    const rawStr = localStorage.getItem(STORAGE_KEY);
    if (rawStr == null) return defaultChimePrefs(reduced);
    return normalizeChimePrefs(JSON.parse(rawStr), reduced);
  } catch {
    return defaultChimePrefs(reduced);
  }
}

export function saveChimePrefs(prefs: ChimePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage disabled/full (private mode) -- prefs simply do not persist
    // across reloads; the in-memory value still drives the current session.
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<ChimePrefs>(CHIME_PREFS_EVENT, { detail: prefs }));
    }
  } catch {
    // CustomEvent unsupported -- a mounted engine just misses the live
    // update and picks the change up on next mount; not fatal.
  }
}
