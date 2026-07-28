'use strict';
// bot/tests/run.cjs -- REQ-0330 fleet unit suite runner. Requires every
// *_test.cjs (except the hermetic canary, which stands up a live-shaped API and
// is run separately), runs each module's async run(), and exits non-zero if any
// assertion failed. `node bot/tests/run.cjs` from bot/, or `pnpm test`.
const fs = require('fs');
const path = require('path');
const { summary } = require('./_tinytest.cjs');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter((f) => f.endsWith('_test.cjs') && f !== 'canary_hermetic.cjs')
  .sort();

async function main() {
  for (const f of files) {
    console.log('\n=== ' + f + ' ===');
    const mod = require(path.join(dir, f));
    if (typeof mod.run === 'function') await mod.run();
  }
  const failed = summary('FLEET UNIT SUITE');
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('runner crashed: ' + (e && e.stack || e)); process.exit(2); });
