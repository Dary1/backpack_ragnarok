// client/e2e/load-seam.ts -- REQ-0222: e2e timeout scaling for a LOADED box.
//
// The box is SUPPOSED to run art/GPU work and CI concurrently (GPU etiquette
// assumes it), but the e2e timeouts were tuned on a quiet box: REQ-0191
// measured the artadmin page.goto at 13.0 s quiet -> 22.1 s at load ~7 ->
// 27-29 s at load ~10, sailing over the fixed 20 s navigationTimeout while
// every failing snapshot showed a fully rendered page. The harness, not the
// feature, failed -- and twice in one day that aborted tools/release.sh.
//
// This module is the ONE seam that widens the suite's timeouts when the box
// is busy. Every playwright config multiplies its timeouts through scaled():
//   E2E_LOADED_BOX=1    -> 3x (explicit opt-in)
//   E2E_LOADED_BOX=<N>  -> Nx for N > 1 (explicit factor)
//   E2E_LOADED_BOX=0    -> 1x (force off, even on a loaded box)
//   unset               -> AUTO: 1-min loadavg >= 0.75 * cores -> 3x.
// Auto-detection matters because the deploy path is exactly where a human
// forgets a flag: REQ-0182b and REQ-0191 both had release.sh aborted by this
// family. A deploy gate must not depend on remembering an env var.
//
// Widening timeouts does NOT weaken assertions: a real regression fails at
// any timeout (wrong DOM stays wrong forever); only "correct but slow under
// load" stops aborting releases.
import { cpus, loadavg } from 'node:os';

function computeFactor(): number {
  const raw = process.env.E2E_LOADED_BOX;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (n === 0) return 1;
    if (Number.isFinite(n) && n > 1) return n;
    return 3;
  }
  const cores = cpus().length || 1;
  const load1 = loadavg()[0];
  if (load1 >= 0.75 * cores) {
    console.log(
      `[load-seam] auto: loadavg1=${load1.toFixed(1)} >= 0.75*${cores} cores ` +
      `-> 3x e2e timeouts (E2E_LOADED_BOX=0 forces off)`);
    return 3;
  }
  return 1;
}

const FACTOR = computeFactor();

/** The multiplier in force for this process (1 on a quiet box). */
export const loadFactor = (): number => FACTOR;

/** Scale a millisecond timeout by the current load factor. */
export const scaled = (ms: number): number => Math.round(ms * FACTOR);
