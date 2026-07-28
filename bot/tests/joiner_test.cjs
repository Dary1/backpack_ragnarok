'use strict';
// Drip-joiner cadence: one join per 30s tick, NEVER a burst; stops at full.
const { assert, test, atest, summary } = require('./_tinytest.cjs');
const { dueToJoin, planDripTick, driveDripJoin } = require('../lib/joiner.cjs');

async function run() {
  test('dueToJoin: first join (no prior) is immediate', () => {
    assert.strictEqual(dueToJoin(0, null, 30000), true);
  });
  test('dueToJoin: within the interval is NOT due (no burst)', () => {
    assert.strictEqual(dueToJoin(29999, 0, 30000), false);
  });
  test('dueToJoin: at/after the interval is due', () => {
    assert.strictEqual(dueToJoin(30000, 0, 30000), true);
    assert.strictEqual(dueToJoin(30001, 0, 30000), true);
  });
  test('planDripTick: stop when the troop is full', () => {
    assert.strictEqual(planDripTick({ now: 0, lastJoinMs: null, intervalMs: 30000, troop: { full: true }, availableAccountId: 'a0' }).action, 'stop');
  });
  test('planDripTick: stop when the troop is no longer recruiting', () => {
    assert.strictEqual(planDripTick({ now: 0, lastJoinMs: null, intervalMs: 30000, troop: { recruiting: false }, availableAccountId: 'a0' }).action, 'stop');
  });
  test('planDripTick: wait (cadence) mid-interval', () => {
    const p = planDripTick({ now: 5000, lastJoinMs: 0, intervalMs: 30000, troop: { recruiting: true }, availableAccountId: 'a0' });
    assert.strictEqual(p.action, 'wait'); assert.strictEqual(p.reason, 'cadence');
  });
  test('planDripTick: wait (pool exhausted) when no account is free', () => {
    const p = planDripTick({ now: 40000, lastJoinMs: 0, intervalMs: 30000, troop: { recruiting: true }, availableAccountId: null });
    assert.strictEqual(p.action, 'wait'); assert.strictEqual(p.reason, 'pool_exhausted');
  });
  test('planDripTick: join when due, recruiting, and an account is free', () => {
    const p = planDripTick({ now: 30000, lastJoinMs: 0, intervalMs: 30000, troop: { recruiting: true }, availableAccountId: 'a1' });
    assert.strictEqual(p.action, 'join'); assert.strictEqual(p.accountId, 'a1');
  });

  await atest('driveDripJoin: fills a troop ONE seat per interval, never bursts, departs at full', async () => {
    const INTERVAL = 30000;
    let t = 0;                                   // virtual clock (ms)
    const pool = ['a0', 'a1', 'a2', 'a3', 'a4']; // more accounts than free seats
    const used = new Set();
    // Host already holds seat 0; the fleet fills seats 1..3 (3 joins) -> depart.
    const FLEET_SEATS = 3;
    let joinCount = 0;
    const result = await driveDripJoin({
      now: () => t,
      sleep: async (ms) => { t += ms; },         // virtual time: resolve instantly
      intervalMs: INTERVAL,
      pollMs: 1000,
      readTroop: async () => (joinCount >= FLEET_SEATS ? null : { recruiting: true, full: false }),
      pickAccount: () => { for (const id of pool) if (!used.has(id)) return id; return null; },
      join: async (id) => {
        used.add(id); joinCount += 1;
        return { troop: { state: joinCount >= FLEET_SEATS ? 'active' : 'recruiting' } };
      },
      log: () => {},
    });

    assert.strictEqual(result.joins.length, FLEET_SEATS, 'exactly 3 fleet joins');
    assert.strictEqual(result.stopReason, 'troop_departed', 'stops when the fill departs the troop');
    // No burst: consecutive joins are spaced by at LEAST the interval.
    for (let i = 1; i < result.joins.length; i++) {
      const gap = result.joins[i].atMs - result.joins[i - 1].atMs;
      assert.ok(gap >= INTERVAL, 'join ' + i + ' spaced ' + gap + 'ms >= ' + INTERVAL);
    }
    // And exactly one join in each interval window (first at 0, then 30k, 60k).
    assert.deepStrictEqual(result.joins.map((j) => j.atMs), [0, 30000, 60000]);
    assert.deepStrictEqual(result.joins.map((j) => j.accountId), ['a0', 'a1', 'a2']);
  });

  await atest('driveDripJoin: stops (pool_exhausted) if accounts run out while recruiting', async () => {
    let t = 0;
    const pool = ['a0']; const used = new Set();
    const result = await driveDripJoin({
      now: () => t, sleep: async (ms) => { t += ms; }, intervalMs: 30000, pollMs: 1000,
      readTroop: async () => ({ recruiting: true, full: false }), // never fills
      pickAccount: () => { for (const id of pool) if (!used.has(id)) return id; return null; },
      join: async (id) => { used.add(id); return { troop: { state: 'recruiting' } }; },
      log: () => {},
    });
    assert.strictEqual(result.joins.length, 1);
    assert.strictEqual(result.stopReason, 'pool_exhausted');
  });
}

module.exports = { run };
if (require.main === module) run().then(() => process.exit(summary('joiner_test') > 0 ? 1 : 0));
