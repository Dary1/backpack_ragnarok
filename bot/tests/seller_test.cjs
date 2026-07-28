'use strict';
// Auto-seller: sellable-row filter (tm/claiming skipped) + sellAll lists EVERY
// sellable drop via from-warehouse and tolerates races.
const { assert, test, atest, summary } = require('./_tinytest.cjs');
const { isSellableRow, sellableRows, sellAll } = require('../lib/seller.cjs');

async function run() {
  const rows = [
    { itemUid: 'u_po', itemId: 'blade' },                 // po -> sellable
    { itemUid: 'u_si', itemId: 'acc_gem' },               // si -> sellable
    { itemUid: 'u_bp', kind: 'bp', bp: { unit: { id: 'wolf' } } }, // unit -> sellable
    { itemUid: 'u_tm', kind: 'tm', itemId: 'lrdst' },     // currency -> SKIP (unsellable_kind)
    { itemUid: 'u_cl', itemId: 'blade', status: 'claiming' }, // mid-claim -> SKIP (409)
    { itemUid: '', itemId: 'blade' },                     // malformed -> SKIP
  ];

  test('isSellableRow: po/si/bp sellable; tm/claiming/malformed skipped', () => {
    assert.strictEqual(isSellableRow(rows[0]), true);
    assert.strictEqual(isSellableRow(rows[1]), true);
    assert.strictEqual(isSellableRow(rows[2]), true);
    assert.strictEqual(isSellableRow(rows[3]), false);
    assert.strictEqual(isSellableRow(rows[4]), false);
    assert.strictEqual(isSellableRow(rows[5]), false);
  });
  test('sellableRows: keeps exactly the three drops, order preserved', () => {
    assert.deepStrictEqual(sellableRows(rows).map((r) => r.itemUid), ['u_po', 'u_si', 'u_bp']);
  });

  await atest('sellAll: lists every sellable drop and skips the rest', async () => {
    const calls = [];
    const sold = await sellAll({
      listWarehouse: async () => ({ items: rows }),
      createListingFromWarehouse: async (body, idemKey) => { calls.push({ body, idemKey }); return { ok: true, listing: { id: 'mkt_' + body.warehouseRowId } }; },
      log: () => {},
    });
    assert.deepStrictEqual(sold.listed, ['u_po', 'u_si', 'u_bp']);
    assert.strictEqual(sold.skipped.length, 3);
    // Every list call targeted the row uid, priced in lrdst, with a stable idemKey.
    assert.deepStrictEqual(calls.map((c) => c.body.warehouseRowId), ['u_po', 'u_si', 'u_bp']);
    assert.ok(calls.every((c) => c.body.price.tm === 'lrdst' && Number.isInteger(c.body.price.qty)));
    assert.deepStrictEqual(calls.map((c) => c.idemKey), ['fleet-sell-u_po', 'fleet-sell-u_si', 'fleet-sell-u_bp']);
  });

  await atest('sellAll: a per-row 409/400 is non-fatal -- the rest still list', async () => {
    const sold = await sellAll({
      listWarehouse: async () => ({ items: [rows[0], rows[1], rows[2]] }),
      createListingFromWarehouse: async (body) => {
        if (body.warehouseRowId === 'u_si') { const e = new Error('being claimed'); e.reason = 'claiming'; throw e; }
        return { ok: true };
      },
      log: () => {},
    });
    assert.deepStrictEqual(sold.listed, ['u_po', 'u_bp']);
    assert.strictEqual(sold.errors.length, 1);
    assert.strictEqual(sold.errors[0].uid, 'u_si');
  });

  await atest('sellAll: empty warehouse -> nothing listed, no throw', async () => {
    const sold = await sellAll({ listWarehouse: async () => ({ items: [] }), createListingFromWarehouse: async () => ({}), log: () => {} });
    assert.deepStrictEqual(sold.listed, []);
  });
}

module.exports = { run };
if (require.main === module) run().then(() => process.exit(summary('seller_test') > 0 ? 1 : 0));
