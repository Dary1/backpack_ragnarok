// backpack_ragnarok -- server/tests/verify_content_registry_parity_test.cjs
// REQ-0178: DB-free unit coverage of tools/verify_content_registry_parity.cjs
// -- the pure comparison/diff primitives (order-insensitive equality; field-
// level diff) and the classifier's four verdicts (MATCH / DRIFT / MISSING-IN-
// REGISTRY / UNADOPTED) driven by an INJECTED file corpus + a FAKE storage, so
// the exit-code logic and status mapping are proven without a Postgres.
'use strict';
const assert = require('assert');
const parity = require('../../tools/verify_content_registry_parity.cjs');

let pass = 0, fail = 0;
function T(name, fn) { const __t0 = Date.now(); try { fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); fail++; } }
async function AT(name, fn) { const __t0 = Date.now(); try { await fn(); console.log('PASS  ' + name + clk(name, __t0)); pass++; } catch (e) { console.log('FAIL  ' + name + ' -- ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); fail++; } }

T('deepEqualUnordered ignores object key order recursively', () => {
  assert.strictEqual(parity.deepEqualUnordered({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }), true);
  assert.strictEqual(parity.deepEqualUnordered({ a: 1 }, { a: 2 }), false);
  // arrays are ORDER-SENSITIVE (order carries meaning for effects/pools)
  assert.strictEqual(parity.deepEqualUnordered([1, 2], [2, 1]), false);
  assert.strictEqual(parity.deepEqualUnordered([1, 2], [1, 2]), true);
});

T('diffFields returns leaf-path mismatches only', () => {
  const d = parity.diffFields({ id: 'x', name: 'A', box: { w: 1, h: 2 } }, { id: 'x', name: 'B', box: { w: 1, h: 9 } });
  const paths = d.map((x) => x.path).sort();
  assert.deepStrictEqual(paths, ['box.h', 'name']);
  const nameRow = d.find((x) => x.path === 'name');
  assert.strictEqual(nameRow.file, 'A');
  assert.strictEqual(nameRow.registry, 'B');
});

// Fake storage: getAdoptedVariant returns the adopted row (with kind+data) or
// null; getContentDefByName returns {kind} or null. Mirrors the real chokepoint
// contract classifyAll relies on.
function fakeStorage(adopted, defs) {
  return {
    async getAdoptedVariant(name) { return adopted[name] || null; },
    async getContentDefByName(name) { return defs[name] || null; },
  };
}

const _p_classify = AT('classifyAll: MATCH / DRIFT / MISSING-IN-REGISTRY / UNADOPTED verdicts', async () => {
  const byName = new Map([
    ['itMatch', { kind: 'po_def', file: 'f', entry: { id: 'itMatch', a: 1, b: 2 } }],
    ['itDrift', { kind: 'po_def', file: 'f', entry: { id: 'itDrift', a: 1, b: 2 } }],
    ['itMissing', { kind: 'po_def', file: 'f', entry: { id: 'itMissing' } }],
    ['itUnadopted', { kind: 'po_def', file: 'f', entry: { id: 'itUnadopted' } }],
    ['itWrongKind', { kind: 'si_def', file: 'f', entry: { id: 'itWrongKind' } }],
  ]);
  const adopted = {
    itMatch: { kind: 'po_def', variant_no: 1, data: { b: 2, a: 1, id: 'itMatch' } }, // key order flipped -> still MATCH
    itDrift: { kind: 'po_def', variant_no: 3, data: { a: 1, b: 999, id: 'itDrift' } },
    itWrongKind: { kind: 'po_def', variant_no: 1, data: { id: 'itWrongKind' } }, // adopted under a DIFFERENT kind
  };
  const defs = { itUnadopted: { kind: 'po_def' } }; // def exists, no adopted variant
  const rows = await parity.classifyAll(fakeStorage(adopted, defs), byName);
  const by = {}; for (const r of rows) by[r.name] = r;
  assert.strictEqual(by.itMatch.status, 'MATCH');
  assert.strictEqual(by.itDrift.status, 'DRIFT');
  assert.deepStrictEqual(by.itDrift.diff.map((d) => d.path), ['b']);
  assert.strictEqual(by.itMissing.status, 'MISSING-IN-REGISTRY');
  assert.strictEqual(by.itUnadopted.status, 'UNADOPTED');
  assert.strictEqual(by.itWrongKind.status, 'MISSING-IN-REGISTRY'); // kind mismatch is not a match for this section
  const counts = parity.summarize(rows);
  assert.strictEqual(counts.DRIFT, 1);
  assert.strictEqual(counts.MATCH, 1);
  assert.strictEqual(counts['MISSING-IN-REGISTRY'], 2);
  assert.strictEqual(counts.UNADOPTED, 1);
});

async function main() {
  await _p_classify;
  console.log('\nverify_content_registry_parity_test: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail === 0 ? 0 : 1);
}
main();


// ---- REQ-0334: per-test timing ----------------------------------------
// Hoisted on purpose: these suites call their T()/AT() at module scope, so a
// `const` binding declared down here would be in the temporal dead zone when
// the first tests run. `var` + `function` hoist to the top of the module, and
// the require is deferred to the first call so it never runs ahead of a
// harness's own os.homedir()/env setup. See tools/lib/test_clock.cjs.
var __clock;
function clk(name, t0) {
  return (__clock || (__clock = require('../../tools/lib/test_clock.cjs')(__filename))).clk(name, t0);
}
