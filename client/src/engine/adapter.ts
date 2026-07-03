// Thin loader for the shared, framework-free mock-src/engine.js — REQ-0026
// T0.1. This file does NOT reimplement or fork any engine logic; it only
// evaluates the engine's own unmodified source in a CJS-shaped scope so a
// Vite/Rollup (ESM) pipeline can consume it.
//
// Why not a plain `import`: mock-src/engine.js is a hand-written UMD module
// (`(function(root,factory){ if module.exports ... else root.Engine=... })`)
// with no import/export ES module syntax at all. Rollup treats any non-
// node_modules .js file as ES module source and will not rewrite
// `module.exports` for it (that CJS interop only applies to dependencies
// pre-bundled by esbuild). Two options were considered:
//   1. Fork/rewrite engine.js as an ES module -- rejected: the spec (T0.1
//      scope) requires the engine be consumed AS-IS, never forked, so the
//      mock and client always share one source of truth and can never
//      silently drift.
//   2. Load the file's source text (via Vite's `?raw` import, which works
//      identically in dev and in the production Rollup build) and execute
//      it in a scope that provides the `module`/`exports` locals it already
//      branches on -- i.e. give it exactly the CJS environment it asks for,
//      without changing a single byte of it. This is what's implemented
//      below. `new Function` is used (not eval) so scope is limited to the
//      two injected parameters; no access to this module's closure.
// Any future engine.js change (new export, bugfix) is picked up automatically
// on next build with zero adapter changes, since the source is read fresh.
import engineSource from '../../../mock-src/engine.js?raw';
import type { EngineModule } from './engine.d.ts';

function loadEngineModule(): EngineModule {
  const mod: { exports: unknown } = { exports: {} };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see comment above: this is intentional, scoped CJS-shim execution of first-party source, not arbitrary eval of external/user input.
  const runInCjsShim = new Function('module', 'exports', engineSource);
  runInCjsShim(mod, mod.exports);
  return mod.exports as EngineModule;
}

// Evaluated once per client load; engine.js has no external side effects
// beyond building its own closures, so a module-level singleton is safe and
// matches how the mock (mock-src/ui.js) uses the global `Engine` singleton.
export const Engine: EngineModule = loadEngineModule();
