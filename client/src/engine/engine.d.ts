// REQ-0047 (f2): the engine's typed surface moved to shared/engine.d.ts
// (single source of truth, mechanically drift-checked against
// mock-src/engine.js by tools/check_engine_types.cjs). This shim keeps
// the historical './engine/engine.d.ts' import path working unchanged.
export * from '../../../shared/engine.d.ts';
