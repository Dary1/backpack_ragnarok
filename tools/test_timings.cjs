#!/usr/bin/env node
'use strict';
// tools/test_timings.cjs -- REQ-0334: one ranked view of what the test suites
// actually cost, across BOTH timing sources.
//
//   node tools/test_timings.cjs [--jsonl <path>] [--pw <path>] [--top N] [--json]
//
//   --jsonl  JSONL written by tools/lib/test_clock.cjs (the node suites).
//            Default: $TEST_TIMINGS_OUT, else /tmp/bpk_test_timings.jsonl
//   --pw     Playwright JSON report (the e2e suite).
//            Default: $PLAYWRIGHT_JSON_OUTPUT_NAME, else skipped.
//   --top    how many slowest tests to list (default 25)
//   --json   emit the merged records instead of the table
//
// Typical use -- collect a whole ci.sh run into one file, then rank it:
//
//   rm -f /tmp/bpk_test_timings.jsonl
//   TEST_TIMINGS_OUT=/tmp/bpk_test_timings.jsonl bash tools/ci.sh
//   node tools/test_timings.cjs --top 40
//
// WHY BOTH SOURCES: Playwright already measures per-test duration and writes a
// JSON report; the node suites did not measure anything until REQ-0334 added
// test_clock. Rather than force one format on the other, this reads each in its
// native shape and normalizes to {suite, name, ms, ok}. The point of merging is
// that the interesting comparison is ACROSS suites -- a 12s e2e test and a 40ms
// unit test asserting the same invariant is the finding, and you cannot see it
// while the two live in separate reports.

const fs = require('node:fs');

function parseArgs(argv) {
  const a = { top: 25, json: false, jsonl: process.env.TEST_TIMINGS_OUT || '/tmp/bpk_test_timings.jsonl', pw: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME || null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--top') a.top = Number(argv[++i]);
    else if (argv[i] === '--json') a.json = true;
    else if (argv[i] === '--jsonl') a.jsonl = argv[++i];
    else if (argv[i] === '--pw') a.pw = argv[++i];
    else { console.error('unknown arg: ' + argv[i]); process.exit(2); }
  }
  return a;
}

function readJsonl(p) {
  if (!p || !fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/** Playwright's JSON report nests suites arbitrarily; flatten to specs. */
function readPlaywright(p) {
  if (!p || !fs.existsSync(p)) return [];
  const out = [];
  const walk = (node) => {
    (node.suites || []).forEach(walk);
    (node.specs || []).forEach((spec) => {
      (spec.tests || []).forEach((t) => (t.results || []).forEach((r) => {
        out.push({
          suite: spec.file,
          name: spec.title + ' :' + spec.line,
          ms: r.duration,
          ok: r.status === 'passed',
        });
      }));
    });
  };
  walk(JSON.parse(fs.readFileSync(p, 'utf8')));
  return out;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function rpad(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }
function secs(ms) { return (ms / 1000).toFixed(1) + 's'; }

const args = parseArgs(process.argv);
const rows = readJsonl(args.jsonl).concat(readPlaywright(args.pw));

if (rows.length === 0) {
  console.error('no timing records found.');
  console.error('  node suites: run with TEST_TIMINGS_OUT=<path> (see tools/lib/test_clock.cjs)');
  console.error('  e2e:         run playwright with --reporter=json and PLAYWRIGHT_JSON_OUTPUT_NAME=<path>');
  process.exit(1);
}

if (args.json) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const total = rows.reduce((a, r) => a + r.ms, 0);
const bySuite = new Map();
for (const r of rows) {
  const s = bySuite.get(r.suite) || { n: 0, ms: 0, fails: 0 };
  s.n++; s.ms += r.ms; if (!r.ok) s.fails++;
  bySuite.set(r.suite, s);
}

console.log('== test timings ==');
console.log(rows.length + ' tests, ' + secs(total) + ' of measured test time'
  + '  (this is SUM of test durations, not wall time -- parallel runs finish sooner)');
console.log('');

console.log('-- by suite, slowest first --');
console.log(pad('SUITE', 46) + rpad('TESTS', 6) + rpad('TOTAL', 10) + rpad('AVG', 9) + rpad('SHARE', 8));
[...bySuite.entries()].sort((a, b) => b[1].ms - a[1].ms).forEach(([suite, s]) => {
  console.log(
    pad(suite.length > 45 ? '...' + suite.slice(-42) : suite, 46) +
    rpad(s.n, 6) + rpad(secs(s.ms), 10) + rpad((s.ms / s.n / 1000).toFixed(2) + 's', 9) +
    rpad((100 * s.ms / total).toFixed(1) + '%', 8) + (s.fails ? '  ' + s.fails + ' FAILED' : '')
  );
});

console.log('');
console.log('-- ' + args.top + ' slowest individual tests --');
const sorted = rows.slice().sort((a, b) => b.ms - a.ms);
sorted.slice(0, args.top).forEach((r) => {
  console.log(rpad(secs(r.ms), 8) + '  ' + pad(r.suite.split('/').pop().slice(0, 30), 32) + r.name.slice(0, 84));
});

console.log('');
console.log('-- concentration --');
let acc = 0;
sorted.forEach((r, i) => {
  acc += r.ms;
  if ([9, 19, 49, 99].includes(i)) {
    console.log('  top ' + rpad(i + 1, 3) + ' tests = ' + rpad((100 * acc / total).toFixed(1) + '%', 6) + ' of measured test time');
  }
});
const trivial = rows.filter((r) => r.ms < 10).length;
console.log('  ' + trivial + ' tests (' + (100 * trivial / rows.length).toFixed(0) + '%) run in under 10ms -- these cost nothing; do not optimise them, and do not delete them for speed either');
