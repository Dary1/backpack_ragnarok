'use strict';
// Watcher target selection over the browse rows.
const { assert, test, summary } = require('./_tinytest.cjs');
const { pickTarget, hasFreeSeat } = require('../lib/watcher.cjs');

async function run() {
  test('pickTarget: null on empty browse', () => {
    assert.strictEqual(pickTarget([]), null);
    assert.strictEqual(pickTarget(null), null);
  });
  test('pickTarget: chooses the OLDEST recruitment with a free seat', () => {
    const troops = [
      { roomId: 'r1', seats: '1/4', attackLv: 1, ageSec: 10 },
      { roomId: 'r2', seats: '2/4', attackLv: 1, ageSec: 90 }, // oldest
      { roomId: 'r3', seats: '3/4', attackLv: 1, ageSec: 40 },
    ];
    assert.strictEqual(pickTarget(troops).roomId, 'r2');
  });
  test('pickTarget: ties on age broken by roomId ascending', () => {
    const troops = [
      { roomId: 'r_b', seats: '1/4', ageSec: 50 },
      { roomId: 'r_a', seats: '1/4', ageSec: 50 },
    ];
    assert.strictEqual(pickTarget(troops).roomId, 'r_a');
  });
  test('pickTarget: excludes handled rooms', () => {
    const troops = [
      { roomId: 'r1', seats: '1/4', ageSec: 99 },
      { roomId: 'r2', seats: '1/4', ageSec: 10 },
    ];
    assert.strictEqual(pickTarget(troops, { excludeRoomIds: ['r1'] }).roomId, 'r2');
  });
  test('pickTarget: skips a full row defensively (no free seat)', () => {
    const troops = [{ roomId: 'r_full', seats: '4/4', ageSec: 99 }];
    assert.strictEqual(pickTarget(troops), null);
  });
  test('hasFreeSeat parses the k/4 seats string', () => {
    assert.strictEqual(hasFreeSeat({ seats: '3/4' }), true);
    assert.strictEqual(hasFreeSeat({ seats: '4/4' }), false);
    assert.strictEqual(hasFreeSeat({}), true); // missing -> assume free (browse guarantees it)
  });
}

module.exports = { run };
if (require.main === module) run().then(() => process.exit(summary('watcher_test') > 0 ? 1 : 0));
