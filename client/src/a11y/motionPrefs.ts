// client/src/a11y/motionPrefs.ts -- REQ-0143 (overlay-accessibility), spec
// item 2: an app-wide REDUCED-MOTION preference. Mirrors REQ-0059s
// chimePrefs exactly (localStorage + a same-tab change event + a pure,
// Node-testable normaliser), and it OWNS the :root[data-motion] gate that
// REQ-0113 introduced inline in main.tsx -- so there is now ONE source of
// truth for "is motion welcome?" that both CSS (data-motion / data-reduced-
// motion attributes) and the Pixi renderer (getReducedMotion()) read.
//
// Seed vs choice: on a FIRST visit the default follows the platform --
// prefers-reduced-motion: reduce, OR an automation driver (navigator.webdriver,
// so Playwright stays byte-identical to REQ-0113s behaviour) -> reduced ON.
// Once the user saves a choice in Settings, that explicit value wins and the
// seed is never consulted again. Reduced-motion suppresses the Ragnarok Frame
// slow-mo, beam animation and charge pulses app-wide (the golden slow-mo and
// the ghosts.ts success pulse consult getReducedMotion() / the data attribute).

export interface MotionPrefs {
  /** When true, decorative/among-frame motion is suppressed app-wide. */
  reducedMotion: boolean;
}

export const STORAGE_KEY = "bp.a11y.prefs";
/** Dispatched on window whenever prefs are saved, so a mounted renderer or the
 * Settings page can pick up a change live (same tab). `detail` is MotionPrefs. */
export const A11Y_PREFS_EVENT = "bp-a11y-prefs-changed";

/** Platform seed: reduce OR an automation driver -> reduced ON. Mirrors the
 * REQ-0113 gate this module absorbs. */
export function prefersReducedMotionSeed(): boolean {
  try {
    if (typeof navigator !== "undefined" && (navigator as { webdriver?: boolean }).webdriver === true) return true;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function defaultMotionPrefs(seed = prefersReducedMotionSeed()): MotionPrefs {
  return { reducedMotion: seed };
}

/** Coerce an arbitrary parsed value into a valid MotionPrefs. Pure. */
export function normalizeMotionPrefs(raw: unknown, seed = prefersReducedMotionSeed()): MotionPrefs {
  const d = defaultMotionPrefs(seed);
  if (raw == null || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  return { reducedMotion: typeof o.reducedMotion === "boolean" ? o.reducedMotion : d.reducedMotion };
}

export function loadMotionPrefs(): MotionPrefs {
  const seed = prefersReducedMotionSeed();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return defaultMotionPrefs(seed);
    return normalizeMotionPrefs(JSON.parse(raw), seed);
  } catch {
    return defaultMotionPrefs(seed);
  }
}

// The live effective flag, read synchronously by the renderer. Seeded on first
// access and kept fresh by save + the change event.
let effective: boolean | null = null;

/** Reflect the prefs onto the document root: data-reduced-motion mirrors the
 * flag, and data-motion="on" is present iff motion is WELCOME (REQ-0113 CSS
 * scopes every decorative motion under :root[data-motion="on"]). */
export function applyMotionAttributes(prefs: MotionPrefs): void {
  effective = prefs.reducedMotion;
  try {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.setAttribute("data-reduced-motion", prefs.reducedMotion ? "true" : "false");
    if (prefs.reducedMotion) root.removeAttribute("data-motion");
    else root.setAttribute("data-motion", "on");
  } catch {
    // No DOM (SSR/tests) -- the in-memory `effective` flag still drives logic.
  }
}

export function saveMotionPrefs(prefs: MotionPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Storage disabled/full -- prefs simply do not persist; live value still applies.
  }
  applyMotionAttributes(prefs);
  try {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<MotionPrefs>(A11Y_PREFS_EVENT, { detail: prefs }));
  } catch {
    // CustomEvent unsupported -- a mounted consumer misses the live update only.
  }
}

/** Load prefs, apply the document attributes, and subscribe to live changes.
 * Call once at boot (main.tsx). Returns the effective reduced-motion flag. */
export function initMotionPrefs(): boolean {
  const prefs = loadMotionPrefs();
  applyMotionAttributes(prefs);
  try {
    if (typeof window !== "undefined") {
      window.addEventListener(A11Y_PREFS_EVENT, (e) => {
        const d = (e as CustomEvent<MotionPrefs>).detail;
        if (d && typeof d.reducedMotion === "boolean") effective = d.reducedMotion;
      });
    }
  } catch {
    // ignore
  }
  return prefs.reducedMotion;
}

/** Synchronous accessor for render code. Lazy-seeds from storage/platform on
 * first call so a caller that runs before initMotionPrefs() still gets a sane
 * value. Never throws. */
export function getReducedMotion(): boolean {
  if (effective === null) {
    try {
      effective = loadMotionPrefs().reducedMotion;
    } catch {
      effective = false;
    }
  }
  return effective;
}
