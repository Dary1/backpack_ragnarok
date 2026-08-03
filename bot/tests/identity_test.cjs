'use strict';
// Identity guard: refuse dev / roled / malformed; fail closed.
const { assert, test, summary } = require('./_tinytest.cjs');
const { isForbiddenIdentity, assertHumanEquivalent } = require('../lib/identity.cjs');

async function run() {
  test('a clean human-equivalent identity is allowed', () => {
    const me = { playerId: 'p_abc', name: 'Sofia', roles: [] };
    assert.strictEqual(isForbiddenIdentity(me), false);
    assert.strictEqual(assertHumanEquivalent(me), me);
  });
  test('playerId dev is refused', () => {
    assert.strictEqual(isForbiddenIdentity({ playerId: 'dev', roles: [] }), true);
    assert.throws(() => assertHumanEquivalent({ playerId: 'dev', roles: [] }), /identity guard REFUSED/);
  });
  test('any non-empty roles is refused', () => {
    assert.strictEqual(isForbiddenIdentity({ playerId: 'p_x', roles: ['item_admin'] }), true);
    assert.throws(() => assertHumanEquivalent({ playerId: 'p_x', roles: ['item_admin'] }), /identity guard REFUSED/);
  });
  test('fail closed on a malformed / empty identity', () => {
    assert.strictEqual(isForbiddenIdentity(null), true);
    assert.strictEqual(isForbiddenIdentity({}), true);
    assert.strictEqual(isForbiddenIdentity({ playerId: '' }), true);
    assert.throws(() => assertHumanEquivalent(undefined), /identity guard REFUSED/);
  });
  test('the guard error carries a machine code', () => {
    try { assertHumanEquivalent({ playerId: 'dev' }); assert.fail('should throw'); }
    catch (e) { assert.strictEqual(e.code, 'IDENTITY_GUARD'); }
  });
}

module.exports = { run };
if (require.main === module) run().then(() => process.exit(summary('identity_test') > 0 ? 1 : 0));
