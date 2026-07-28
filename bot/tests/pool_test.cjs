'use strict';
// Pool-account selection / round-robin (REQ-0330 gate).
const { assert, test, summary } = require('./_tinytest.cjs');
const { selectFirstAvailable, nextRoundRobin } = require('../lib/pool.cjs');

async function run() {
  const ids = ['a0', 'a1', 'a2', 'a3'];

  test('selectFirstAvailable: none in use -> first', () => {
    assert.strictEqual(selectFirstAvailable(ids, []), 'a0');
  });
  test('selectFirstAvailable: skips in-use, returns next free', () => {
    assert.strictEqual(selectFirstAvailable(ids, new Set(['a0', 'a1'])), 'a2');
  });
  test('selectFirstAvailable: all in use -> null (pool exhausted)', () => {
    assert.strictEqual(selectFirstAvailable(ids, new Set(ids)), null);
  });
  test('selectFirstAvailable: empty pool -> null', () => {
    assert.strictEqual(selectFirstAvailable([], []), null);
  });
  test('first-fit walks the pool one-per-tick like a round-robin (drip order)', () => {
    // Mark each chosen account in-use, as the drip-joiner does each tick.
    const inUse = new Set();
    const picked = [];
    for (let i = 0; i < 4; i++) { const id = selectFirstAvailable(ids, inUse); picked.push(id); inUse.add(id); }
    assert.deepStrictEqual(picked, ['a0', 'a1', 'a2', 'a3']);
    assert.strictEqual(selectFirstAvailable(ids, inUse), null); // then exhausted
  });
  test('nextRoundRobin: rotates and wraps', () => {
    assert.strictEqual(nextRoundRobin(ids, 'a0'), 'a1');
    assert.strictEqual(nextRoundRobin(ids, 'a3'), 'a0'); // wrap
    assert.strictEqual(nextRoundRobin(ids, null), 'a0'); // unknown -> front
    assert.strictEqual(nextRoundRobin([], 'x'), null);
  });
}

module.exports = { run };
if (require.main === module) run().then(() => process.exit(summary('pool_test') > 0 ? 1 : 0));
