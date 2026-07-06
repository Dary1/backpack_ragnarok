// Ember/snow particle field for the landing (title) screen — REQ-0069.
//
// This is a faithful port of the design mock's initParticles()
// (web/redesign/assets/fx.js — the mock's shared FX script) rewritten as
// a client module for ONE reason: lifecycle. fx.js's loop is a fire-and-
// forget requestAnimationFrame chain with no teardown, which is fine for
// a static mock page but would leak a render loop every time the landing
// route unmounts/remounts inside the SPA. startEmberField() below runs
// the exact same simulation but returns a disposer (cancel rAF + drop the
// resize listener). The drawing math/constants are copied 1:1 from fx.js
// so the mock stays the visual source of truth.
//
// Gating (REQ-0069: "optional, perf-gated, OFF for E2E"):
//   - navigator.webdriver → OFF. Playwright/automation always sets this,
//     so the whole E2E suite runs with zero particle work.
//   - prefers-reduced-motion → OFF (same check fx.js itself makes).
//   - hardwareConcurrency < 4 → OFF (cheap low-end-device heuristic; the
//     field is decorative and the first thing to shed).
// The landing renders its <canvas> unconditionally (it is inert and
// pointer-transparent); only the loop is gated.

export interface EmberFieldOptions {
  /** 'ember' (rising sparks), 'snow' (falling motes) or 'both' (alternating). */
  mix?: 'ember' | 'snow' | 'both';
  /** Particle count (default 46, mock's default). */
  count?: number;
}

interface Particle {
  ember: boolean;
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  tw: number;
}

/** True when the decorative particle field may run at all (see gating
 * rationale in the module comment). Exported so LandingPage can skip the
 * effect entirely and so a future settings toggle can surface the gate. */
export function particlesAllowed(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (navigator.webdriver) return false; // E2E/automation: always off
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const cores = navigator.hardwareConcurrency ?? 0;
  if (cores > 0 && cores < 4) return false; // perf gate (0 = unknown, allow)
  return true;
}

/** Starts the field on `canvas` and returns a disposer. Safe to call on
 * any 2D-capable canvas; returns a no-op disposer if a 2D context cannot
 * be created. */
export function startEmberField(canvas: HTMLCanvasElement, opts: EmberFieldOptions = {}): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  let W = 0;
  let H = 0;
  const size = () => {
    W = canvas.width = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  };
  size();
  window.addEventListener('resize', size);

  const N = opts.count ?? 46;
  const spawn = (i: number): Particle => {
    const ember = opts.mix === 'both' ? i % 2 === 0 : opts.mix !== 'snow';
    return {
      ember,
      x: Math.random() * W,
      y: H + Math.random() * H * 0.4,
      r: ember ? 0.8 + Math.random() * 1.8 : 1 + Math.random() * 2.2,
      vy: ember ? -(12 + Math.random() * 26) : 9 + Math.random() * 16,
      vx: ember ? 4 + Math.random() * 14 : -6 - Math.random() * 10,
      life: 0,
      maxLife: 6 + Math.random() * 9,
      tw: 1.5 + Math.random() * 3,
    };
  };

  const ps: Particle[] = [];
  for (let i = 0; i < N; i++) {
    const p = spawn(i);
    p.y = Math.random() * H;
    ps.push(p);
  }

  let last = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      p.x += p.vx * dt + Math.sin(p.life * p.tw) * 12 * dt;
      p.y += p.vy * dt;
      if (p.life > p.maxLife || p.y < -8 || p.y > H + 12 || p.x > W + 12 || p.x < -12) {
        ps[i] = spawn(i);
        if (!ps[i].ember) ps[i].y = -6;
        continue;
      }
      const a = Math.max(0, 1 - p.life / p.maxLife) * 0.85;
      if (p.ember) {
        ctx.fillStyle = 'rgba(255,138,61,' + (a * (0.5 + 0.5 * Math.sin(p.life * p.tw * 2))).toFixed(3) + ')';
        ctx.shadowColor = 'rgba(226,88,34,.8)';
        ctx.shadowBlur = 6;
      } else {
        ctx.fillStyle = 'rgba(214,235,244,' + (a * 0.8).toFixed(3) + ')';
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 7);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', size);
  };
}
