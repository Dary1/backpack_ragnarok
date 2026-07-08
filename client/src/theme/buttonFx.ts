// REQ-0112: app-wide button interaction FX.
//
// A SINGLE global layer (imported once from main.tsx) — no per-button edits.
// It listens on the document (capture-phase delegation) so it covers every
// current and future <button>/.btn automatically:
//   - hover  -> the button glows in its own colour + a soft tick
//   - click  -> light flashes INSIDE the button + a colour-keyed impact sound
//
// The glow colour and click sound are derived from the button's OWN rendered
// colour (computed style -> HSL bucket), so nothing needs to be hand-tagged.
//
// Gating (mirrors landing/particles.ts): fully OFF under navigator.webdriver so
// the e2e suite behaves byte-identically; audio is best-effort and can only
// start after the first real user gesture (browser autoplay policy); the click
// flash respects prefers-reduced-motion.

type Bucket = 'gold' | 'ember' | 'blood' | 'frost' | 'iron';

const GLOW: Record<Bucket, string> = {
  gold:  'rgba(235,217,164,0.75)',
  ember: 'rgba(255,138,61,0.72)',
  blood: 'rgba(224,107,95,0.72)',
  frost: 'rgba(140,220,245,0.72)',
  iron:  'rgba(201,169,89,0.55)', // neutral night-iron -> gold "structural voice"
};
const CLIP: Record<Bucket, string> = {
  gold: 'sfx_gold.wav', ember: 'sfx_ember.wav', blood: 'sfx_blood.wav',
  frost: 'sfx_frost.wav', iron: 'sfx_iron.wav',
};
const VOL: Record<Bucket, number> = { gold: 0.5, ember: 0.5, blood: 0.5, frost: 0.5, iron: 0.45 };
const BUCKETS: Bucket[] = ['gold', 'ember', 'blood', 'frost', 'iron'];

function parseRGB(s: string): [number, number, number, number] | null {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v.trim()));
  return [p[0] || 0, p[1] || 0, p[2] || 0, p.length > 3 ? p[3] : 1];
}

/** Colour candidates for a button: solid bg, gradient stops (background-image),
 * border, text — so gradient-filled buttons (.btn/.btn-forge/.btn-blood) are
 * read from their real fill, not the transparent background-color. */
function candidates(el: HTMLElement): string[] {
  const cs = getComputedStyle(el);
  const out: string[] = [cs.backgroundColor];
  const bi = cs.backgroundImage;
  if (bi && bi !== 'none') {
    const g = bi.match(/rgba?\([^)]+\)/g);
    if (g) out.push(...g);
  }
  out.push(cs.borderTopColor, cs.color);
  return out;
}

function sat(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2;
  return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1) + 1e-9);
}
function hue(r: number, g: number, b: number): number {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d === 0) return 0;
  let h: number;
  if (mx === r) h = 60 * ((((g - b) / d) % 6 + 6) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return h;
}

/** Bucket a button by its most-saturated visible colour. Low saturation
 * (night-iron, bone) -> neutral 'iron' (given the gold structural glow). */
function bucketFor(el: HTMLElement): Bucket {
  let best: [number, number, number] | null = null;
  let bestSat = -1;
  for (const c of candidates(el)) {
    const rgba = parseRGB(c);
    if (!rgba) continue;
    const [r, g, b, a] = rgba;
    if (a < 0.15) continue;
    const s = sat(r, g, b);
    if (s > bestSat) { bestSat = s; best = [r, g, b]; }
  }
  if (!best || bestSat < 0.28) return 'iron';
  const h = hue(best[0], best[1], best[2]);
  if (h < 12 || h >= 345) return 'blood';
  if (h < 40) return 'ember';
  if (h < 70) return 'gold';
  if (h >= 170 && h < 250) return 'frost';
  return 'iron';
}

let ctx: AudioContext | null = null;
const buffers: Partial<Record<Bucket, AudioBuffer>> = {};
let requested = false;

function ac(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

function baseUrl(): string {
  try { return (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL || '/'; }
  catch { return '/'; }
}

function loadClips(): void {
  if (requested) return;
  requested = true;
  const c = ac();
  if (!c) return;
  for (const k of BUCKETS) {
    fetch(baseUrl() + 'sfx/' + CLIP[k])
      .then((r) => r.arrayBuffer())
      .then((ab) => c.decodeAudioData(ab))
      .then((buf) => { buffers[k] = buf; })
      .catch(() => { /* silent -> that bucket just stays quiet */ });
  }
}

function playClip(k: Bucket): void {
  const c = ac();
  if (!c) return;
  const buf = buffers[k];
  if (!buf) return;
  const s = c.createBufferSource();
  s.buffer = buf;
  const g = c.createGain();
  g.gain.value = VOL[k];
  s.connect(g).connect(c.destination);
  s.start();
}

function hoverTick(): void {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.value = 2200;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.02, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + 0.05);
}

function asBtn(target: EventTarget | null): HTMLElement | null {
  const el = target instanceof Element ? (target.closest('button, .btn') as HTMLElement | null) : null;
  if (!el) return null;
  if (el.hasAttribute('disabled') || el.classList.contains('is-disabled')) return null;
  return el;
}

let inited = false;

export function initButtonFx(): void {
  if (inited || typeof document === 'undefined') return;
  inited = true;
  if (navigator.webdriver) return; // automation/e2e: no-op
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  loadClips();
  document.addEventListener('pointerdown', () => { ac(); }, { passive: true, capture: true });

  let hoverEl: HTMLElement | null = null;
  document.addEventListener('pointerover', (e) => {
    const el = asBtn(e.target);
    if (!el || el === hoverEl) return;
    hoverEl = el;
    const bk = bucketFor(el);
    el.style.setProperty('--fx-glow', GLOW[bk]);
    el.classList.add('fx-glow');
    hoverTick();
  }, true);

  document.addEventListener('pointerout', (e) => {
    if (!hoverEl) return;
    const to = (e as PointerEvent).relatedTarget as Node | null;
    if (to && hoverEl.contains(to)) return; // still inside the same button
    hoverEl.classList.remove('fx-glow');
    hoverEl.style.removeProperty('--fx-glow');
    hoverEl = null;
  }, true);

  document.addEventListener('click', (e) => {
    const el = asBtn(e.target);
    if (!el) return;
    const bk = bucketFor(el);
    el.style.setProperty('--fx-glow', GLOW[bk]);
    playClip(bk);
    if (!reduced) {
      el.classList.remove('fx-click');
      void el.offsetWidth; // reflow so the animation restarts on rapid clicks
      el.classList.add('fx-click');
      window.setTimeout(() => el.classList.remove('fx-click'), 460);
    }
  }, true);
}
