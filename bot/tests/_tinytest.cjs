'use strict';
// bot/tests/_tinytest.cjs -- a zero-dependency test harness shared by the fleet
// unit suite (one cached instance => one shared PASS/FAIL tally across every
// test file the runner requires). `test` for sync cases, `atest` for async.
const assert = require('assert');
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; failures.push(name); console.log('FAIL  ' + name + ' -- ' + (e && e.message)); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { failed++; failures.push(name); console.log('FAIL  ' + name + ' -- ' + (e && e.message)); }
}
function summary(label) {
  console.log('\n' + (label || 'total') + ': ' + passed + ' passed, ' + failed + ' failed');
  if (failed) console.log('  failed: ' + failures.join('; '));
  return failed;
}
module.exports = { assert, test, atest, summary };
