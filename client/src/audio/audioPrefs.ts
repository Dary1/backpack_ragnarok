// REQ-0370 -- Audio foundation: master/BGM/SE mixer preferences, persisted
// to localStorage, mirroring the chimePrefs pattern (REQ-0059: small,
// dependency-free, pure normaliser testable from plain Node via the
// vite-ssrLoadModule rig -- see scripts/check_audio_prefs.mjs).
//
// Semantics: `master` scales EVERYTHING (bgm + sfx); `bgm` and `sfx` scale
// their own buses only; `muted` is a hard 0 on the master bus that leaves
// the stored slider values untouched (unmute restores the mix exactly).
// Defaults are chosen so a user who never opens the new mixer hears NO
// change: master=1 and sfx=1 leave every pre-REQ-0370 sound (chimes,
// claim SFX, button FX) at its existing level; bgm defaults below unity so
// the first BGM track lands as a subtle layer (the chime default-volume
// philosophy).

export interface AudioPrefs {
  /** Master bus volume, 0..1. Scales bgm and sfx alike. */
  master: number;
  /** BGM bus volume, 0..1. */
  bgm: number;
  /** Sound-effects (SE) bus volume, 0..1 -- chimes, claim SFX, button FX. */
  sfx: number;
  /** Hard mute (master forced to 0); slider values are preserved. */
  muted: boolean;
}

export const STORAGE_KEY = 'bp.audio.prefs';
/** Dispatched on window whenever prefs are saved, so the live bus graph
 * (audio/bus.ts) re-applies gains immediately (same tab). `detail` is the
 * new AudioPrefs. */
export const AUDIO_PREFS_EVENT = 'bp-audio-prefs-changed';

export function defaultAudioPrefs(): AudioPrefs {
  return { master: 1, bgm: 0.6, sfx: 1, muted: false };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Coerce an arbitrary parsed value into a valid AudioPrefs, filling any
 * missing/invalid field from the default. Pure -- the storage read is done
 * by loadAudioPrefs; this is the testable normaliser. */
export function normalizeAudioPrefs(raw: unknown): AudioPrefs {
  const d = defaultAudioPrefs();
  if (raw == null || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  return {
    master: typeof o.master === 'number' ? clamp01(o.master) : d.master,
    bgm: typeof o.bgm === 'number' ? clamp01(o.bgm) : d.bgm,
    sfx: typeof o.sfx === 'number' ? clamp01(o.sfx) : d.sfx,
    muted: typeof o.muted === 'boolean' ? o.muted : d.muted,
  };
}

/** Read prefs from localStorage. Missing key -> factory default; malformed
 * JSON -> default, never a throw (chimePrefs.loadChimePrefs posture). */
export function loadAudioPrefs(): AudioPrefs {
  try {
    const rawStr = localStorage.getItem(STORAGE_KEY);
    if (rawStr == null) return defaultAudioPrefs();
    return normalizeAudioPrefs(JSON.parse(rawStr));
  } catch {
    return defaultAudioPrefs();
  }
}

export function saveAudioPrefs(prefs: AudioPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage disabled/full (private mode) -- prefs simply do not persist
    // across reloads; the in-memory value still drives the current session.
  }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<AudioPrefs>(AUDIO_PREFS_EVENT, { detail: prefs }));
    }
  } catch {
    // CustomEvent unsupported -- the live bus just misses the update and
    // picks the change up on next context creation; not fatal.
  }
}
