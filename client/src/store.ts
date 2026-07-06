// Module-level game-data/state store -- REQ-0047 (f2): now a BARREL.
// The implementation (moved verbatim) lives in src/store/{core,boot,
// routing,presets,autosave}.ts; core.ts carries the original design
// essay (REQ-0026..0037 history). Every pre-split export keeps its name
// and semantics, so all existing './store' imports work unchanged.
export * from './store/core';
export * from './store/boot';
export * from './store/routing';
export * from './store/presets';
export * from './store/autosave';
