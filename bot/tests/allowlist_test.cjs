'use strict';
// Allowlist enforcement: allowed fleet endpoints pass; host/cancel/buy/admin/dev
// are refused (default-deny + hard-deny).
const { assert, test, summary } = require('./_tinytest.cjs');
const { isAllowed, assertAllowed, normalizePath } = require('../lib/allowlist.cjs');

async function run() {
  test('allowed: browse, join, leave, me, content, profile, notifications, warehouse, from-warehouse', () => {
    assert.ok(isAllowed('GET', '/api/me'));
    assert.ok(isAllowed('GET', '/api/content'));
    assert.ok(isAllowed('GET', '/api/profile/p_1/canvas'));
    assert.ok(isAllowed('GET', '/api/schedule/troops'));
    assert.ok(isAllowed('GET', '/api/schedule/troops?state=recruiting&attackLv=1'));
    assert.ok(isAllowed('POST', '/api/schedule/troops/room_9/join'));
    assert.ok(isAllowed('POST', '/api/schedule/troops/room_9/leave'));
    assert.ok(isAllowed('GET', '/api/schedule/troops/room_9'));
    assert.ok(isAllowed('GET', '/api/notifications?since=5'));
    assert.ok(isAllowed('POST', '/api/notifications/ack'));
    assert.ok(isAllowed('GET', '/api/warehouse'));
    assert.ok(isAllowed('POST', '/api/market/listings/from-warehouse'));
  });
  test('refused: HOST a troop (POST /troops with no id)', () => {
    assert.strictEqual(isAllowed('POST', '/api/schedule/troops'), false);
    assert.throws(() => assertAllowed('POST', '/api/schedule/troops'), /NEVER hosts/);
  });
  test('refused: CANCEL a troop', () => {
    assert.strictEqual(isAllowed('POST', '/api/schedule/troops/room_9/cancel'), false);
    assert.throws(() => assertAllowed('POST', '/api/schedule/troops/room_9/cancel'), /NEVER cancels/);
  });
  test('refused: BUY a listing (sell-only, anti self-dealing)', () => {
    assert.strictEqual(isAllowed('POST', '/api/market/listings/mkt_1/buy'), false);
    assert.throws(() => assertAllowed('POST', '/api/market/listings/mkt_1/buy'), /SELL-ONLY/);
  });
  test('refused: canvas-sourced market create (only from-warehouse is allowed)', () => {
    assert.strictEqual(isAllowed('POST', '/api/market/listings'), false);
  });
  test('refused: withdraw a listing', () => {
    assert.strictEqual(isAllowed('POST', '/api/market/listings/mkt_1/withdraw'), false);
  });
  test('refused: anything under /api/admin', () => {
    assert.strictEqual(isAllowed('POST', '/api/admin/warehouse/grant'), false);
    assert.throws(() => assertAllowed('GET', '/api/admin/item/x'), /admin surface/);
  });
  test('refused: any /dev/ test-control seam', () => {
    assert.strictEqual(isAllowed('POST', '/api/warehouse/dev/clear-debris'), false);
    assert.throws(() => assertAllowed('POST', '/api/schedule/troops/r/dev/backdate'), /dev\/test-control/);
  });
  test('method matters: PUT on an allowed GET path is refused', () => {
    assert.strictEqual(isAllowed('PUT', '/api/profile/p_1/canvas'), false);
  });
  test('normalizePath strips scheme+host and query', () => {
    assert.strictEqual(normalizePath('http://127.0.0.1:8802/api/schedule/troops?state=recruiting'), '/api/schedule/troops');
    assert.strictEqual(normalizePath('/api/warehouse'), '/api/warehouse');
  });
  test('assertAllowed returns true for an allowed request', () => {
    assert.strictEqual(assertAllowed('GET', '/api/warehouse'), true);
  });
}

module.exports = { run };
if (require.main === module) run().then(() => process.exit(summary('allowlist_test') > 0 ? 1 : 0));
