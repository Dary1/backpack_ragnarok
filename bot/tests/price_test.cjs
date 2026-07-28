'use strict';
// Price policy: deterministic, per-kind flat floor, inside the server band.
const { assert, test, summary } = require('./_tinytest.cjs');
const { priceForRow, PRICE_TM, ITEM_PRICE, UNIT_PRICE } = require('../lib/price.cjs');

async function run() {
  test('po/si row (kind absent) -> flat item floor in lrdst', () => {
    const p = priceForRow({ itemUid: 'u1', itemId: 'blade' });
    assert.strictEqual(p.tm, PRICE_TM);
    assert.strictEqual(p.qty, ITEM_PRICE);
  });
  test('unit/bp row -> flat unit floor in lrdst', () => {
    const p = priceForRow({ itemUid: 'u2', kind: 'bp', bp: { unit: { id: 'wolf' } } });
    assert.strictEqual(p.tm, PRICE_TM);
    assert.strictEqual(p.qty, UNIT_PRICE);
  });
  test('policy is deterministic (same row -> same price)', () => {
    const row = { itemUid: 'u3', kind: 'bp' };
    assert.deepStrictEqual(priceForRow(row), priceForRow(row));
  });
  test('both floors sit inside the server price band [1..999]', () => {
    for (const q of [ITEM_PRICE, UNIT_PRICE]) {
      assert.ok(Number.isInteger(q) && q >= 1 && q <= 999, 'qty ' + q + ' in band');
    }
  });
  test('the market TM is the canonical lrdst weathervane', () => {
    assert.strictEqual(PRICE_TM, 'lrdst');
  });
}

module.exports = { run };
if (require.main === module) run().then(() => process.exit(summary('price_test') > 0 ? 1 : 0));
