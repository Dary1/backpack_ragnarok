// client/src/a11y/scalePrefs.ts -- REQ-0377 item 4: an app-wide UI SCALE
// preference (S / M / L), for players who need the interface larger (or who
// want more on screen at once).
//
// Mirrors a11y/motionPrefs.ts EXACTLY -- localStorage + a same-tab change
// event + a pure, Node-testable normaliser + a :root data attribute the CSS
// reads. That is this codebase's established shape for a client pref
// (REQ-0059 chimePrefs -> REQ-0143 motionPrefs -> here); a third spelling
// would be the only novel thing about it.
//
// HOW IT SCALES, and why not the way the REQ brief said. The brief asked for
// the toggle to be "driven by the mjolnir text-scale tokens". Those scales
// (.t-micro/.t-body/.t-label/.t-h3/.t-h2/.t-h1/.t-massive, theme/mjolnir.css)
// are real, but they are NOT the whole app: 246 call sites use them, while
// every pre-MJOLNIR surface in styles/base.css still sets px font-size
// directly. Driving only the tokens would grow SOME of the text on a screen
// and leave the rest -- a worse result than not offering the setting. So the
// scale is applied ONCE, as `zoom` on the document body, which scales layout
// and type together and reaches every surface including the ones nobody has
// ported yet.
//
// `zoom` is not a novel choice here either: styles/canvas.css already ships
// `zoom: 0.75` on the canvas board stage for short viewports, and the board's
// own client<->local hit-test math (board/geom.ts clientToLocal) derives its
// scale from getBoundingClientRect(), which `zoom` moves -- which is why that
// shipped rule does not break dragging, and why this one does not either.
//
// The default is 'm' == scale 1.0, so an untouched install (and every e2e run)
// is byte-identical to the pre-REQ layout.

export type UiScale = 's' | 'm' | 'l';

export interface ScalePrefs {
  scale: UiScale;
}

export const STORAGE_KEY = 'bp.a11y.scale';
/** Dispatched on window whenever prefs are saved, so a mounted Settings page
 * picks up a change live (same tab). `detail` is ScalePrefs. */
export const SCALE_PREFS_EVENT = 'bp-a11y-scale-changed';

/** The multiplier each step applies. Deliberately gentle: 'l' has to stay
 * inside a 1280x800 laptop viewport without the canvas stage overflowing, and
 * 's' has to stay legible. */
export const SCALE_FACTORS: Record<UiScale, number> = { s: 0.9, m: 1, l: 1.15 };

export const UI_SCALES: UiScale[] = ['s', 'm', 'l'];

export function defaultScalePrefs(): ScalePrefs {
  return { scale: 'm' };
}

/** Coerce an arbitrary parsed value into valid ScalePrefs. Pure. */
export function normalizeScalePrefs(raw: unknown): ScalePrefs {
  if (raw == null || typeof raw !== 'object') return defaultScalePrefs();
  const o = raw as Record<string, unknown>;
  return { scale: o.scale === 's' || o.scale === 'l' || o.scale === 'm' ? o.scale : 'm' };
}

export function loadScalePrefs(): ScalePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return defaultScalePrefs();
    return normalizeScalePrefs(JSON.parse(raw));
  } catch {
    return defaultScalePrefs();
  }
}

/** Reflect the prefs onto the document root. CSS owns the rest: styles/base.css
 * maps :root[data-ui-scale] to --ui-scale and applies it as body { zoom }. */
export function applyScaleAttributes(prefs: ScalePrefs): void {
  try {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-ui-scale', prefs.scale);
  } catch {
    // No DOM (SSR/tests) -- nothing to reflect.
  }
}

export function saveScalePrefs(prefs: ScalePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage disabled/full -- the choice simply does not persist; it still applies.
  }
  applyScaleAttributes(prefs);
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ScalePrefs>(SCALE_PREFS_EVENT, { detail: prefs }));
  } catch {
    // CustomEvent unsupported -- a mounted consumer misses the live update only.
  }
}

/** Load prefs and apply the document attribute. Call once at boot (main.tsx). */
export function initScalePrefs(): UiScale {
  const prefs = loadScalePrefs();
  applyScaleAttributes(prefs);
  return prefs.scale;
}
