'use strict';
// Vault loader: reads {playerId,token,name} in stable order, skips malformed,
// never surfaces the token in the redacted view.
const { assert, test, atest, summary } = require('./_tinytest.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadAccounts, redact } = require('../lib/vault.cjs');

function writeAgent(root, dir, obj) {
  const d = path.join(root, dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'token'), JSON.stringify(obj), { mode: 0o600 });
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-vault-'));
  writeAgent(root, 'p_02', { playerId: 'p_02', token: 'tok2', name: 'Marcus Larsson' });
  writeAgent(root, 'p_01', { playerId: 'p_01', token: 'tok1', name: 'Sofia Hansen' });
  writeAgent(root, 'p_bad', { playerId: 'p_bad', name: 'No Token Here' }); // no token -> skipped
  fs.mkdirSync(path.join(root, 'p_empty'), { recursive: true });          // no token file -> skipped

  test('loadAccounts: returns valid agents in stable (dir-ascending) order', () => {
    const accts = loadAccounts(root);
    assert.deepStrictEqual(accts.map((a) => a.playerId), ['p_01', 'p_02']);
    assert.strictEqual(accts[0].name, 'Sofia Hansen');
    assert.strictEqual(accts[0].token, 'tok1');
  });
  test('loadAccounts: skips agents missing a usable token', () => {
    const ids = loadAccounts(root).map((a) => a.playerId);
    assert.ok(!ids.includes('p_bad') && !ids.includes('p_empty'));
  });
  test('redact: exposes name/playerId but NOT the token', () => {
    const r = redact({ playerId: 'p_01', token: 'tok1', name: 'Sofia Hansen' });
    assert.deepStrictEqual(r, { playerId: 'p_01', name: 'Sofia Hansen' });
    assert.ok(!('token' in r));
    assert.ok(!JSON.stringify(r).includes('tok1'));
  });
  test('loadAccounts: a missing vault throws VAULT_MISSING (fail loud)', () => {
    try { loadAccounts(path.join(root, 'does_not_exist')); assert.fail('should throw'); }
    catch (e) { assert.strictEqual(e.code, 'VAULT_MISSING'); }
  });

  fs.rmSync(root, { recursive: true, force: true });
}

module.exports = { run };
if (require.main === module) run().then(() => process.exit(summary('vault_test') > 0 ? 1 : 0));
