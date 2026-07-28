'use strict';
// tools/lib/test_clock.cjs -- REQ-0334: per-test wall time for the node suites.
//
// WHY THIS EXISTS
// Before this, only the Playwright e2e suite reported per-test durations
// (its JSON reporter). The other 43 node suites ci.sh runs printed
// "PASS  <name>" with no timing at all, so the question "which tests are
// expensive, and are they still worth it?" was answerable for 198 tests and
// unanswerable for the ~1900 assertions everywhere else. REQ-0331's audit had
// to hand-time suites one at a time to say anything.
//
// WHAT IT DOES
// Nothing clever, on purpose. Each harness's own T()/AT() keeps printing its
// own PASS line; it just appends this module's suffix, which both formats the
// duration for a human and records it for tools/test_timings.cjs.
//
//   const { clk } = require('../../tools/lib/test_clock.cjs')(__filename);
//   function T(name, fn) {
//     const t0 = Date.now();
//     try { fn(); console.log('PASS  ' + name + clk(name, t0)); pass++; }
//     catch (e) { ... }
//   }
//
// OUTPUT
//   - always: the PASS line gains "  (12ms)". Sub-millisecond tests print
//     "(0ms)" rather than being hidden -- a suite of 200 0ms tests is itself
//     the useful signal.
//   - on exit, a one-line footer naming the suite's own slowest test, so a
//     plain `node server/tests/api_test.cjs` is self-diagnosing with no flags.
//   - when TEST_TIMINGS_OUT is set: one JSON object per test appended to that
//     file (JSONL). Appended, never truncated, so a whole ci.sh run collects
//     into one file across 40+ processes. tools/test_timings.cjs ranks it.
//
// Zero dependencies and no global state beyond this module -- it is required
// by suites that run under both storage backends, in parallel worktrees, and
// inside the e2e fleet's throwaway HOMEs.

const fs = require('node:fs');
const path = require('node:path');

/** Suite label: the path relative to the repo root, so two `run.cjs` files
 *  (sim/tests and mock-src/tests) never collide in the report. */
function suiteLabel(filename) {
  const root = path.join(__dirname, '..', '..');
  const rel = path.relative(root, filename);
  return rel.startsWith('..') ? path.basename(filename) : rel;
}

module.exports = function testClock(filename) {
  const suite = suiteLabel(filename);
  const records = [];
  let installed = false;

  function flush() {
    const out = process.env.TEST_TIMINGS_OUT;
    if (records.length === 0) return;
    const slowest = records.reduce((a, b) => (b.ms > a.ms ? b : a));
    const total = records.reduce((a, r) => a + r.ms, 0);
    console.log(
      '[timing] ' + suite + ': ' + records.length + ' tests, ' + total + 'ms total, ' +
      'slowest ' + slowest.ms + 'ms -- ' + slowest.name
    );
    if (!out) return;
    try {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.appendFileSync(out, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } catch (e) {
      // Never let bookkeeping fail a test run.
      console.warn('[timing] could not write ' + out + ': ' + (e && e.message));
    }
  }

  /** Call at the END of a test, with the Date.now() captured at its start.
   *  Returns the suffix to append to the harness's own PASS/FAIL line. */
  function clk(name, t0, ok) {
    const ms = Date.now() - t0;
    records.push({ suite, name: String(name), ms, ok: ok !== false });
    if (!installed) { installed = true; process.on('exit', flush); }
    return '  (' + ms + 'ms)';
  }

  return { clk, suite, records };
};
