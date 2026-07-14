// client/scripts/dump_module_exports.mjs -- REQ-0145b gate helper.
//
// Usage: node scripts/dump_module_exports.mjs <vite-root-relative-module> [--values]
//   e.g. node scripts/dump_module_exports.mjs /src/api.ts
//        node scripts/dump_module_exports.mjs /src/i18n.ts --values
//
// Loads the module through Vite's SSR pipeline (same rig as
// check_unit_icon.mjs / check_link_trace.mjs) and prints its RUNTIME
// export surface: sorted export names, or, with --values, a stable JSON
// of every export (functions rendered as "[fn <name>]"). Used as the
// (ca) barrel-surface-parity and (ce) i18n key/value-parity gate.
import { createServer } from 'vite';

const [, , modPath, flag] = process.argv;
if (!modPath) {
  console.error('usage: node scripts/dump_module_exports.mjs <module> [--values]');
  process.exit(2);
}
const server = await createServer({ server: { middlewareMode: true }, logLevel: 'error' });
try {
  const mod = await server.ssrLoadModule(modPath);
  if (flag === '--values') {
    const out = {};
    for (const k of Object.keys(mod).sort()) out[k] = mod[k];
    console.log(JSON.stringify(out, (_k, v) => (typeof v === 'function' ? `[fn ${v.name || 'anon'}]` : v), 1));
  } else {
    console.log(JSON.stringify(Object.keys(mod).sort()));
  }
} finally {
  await server.close();
}
