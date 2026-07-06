# Architecture (post REQ-0047)

~31k LOC hand-written. One quality gate: `bash tools/ci.sh` (or `npm test`).

## Layout

| Path | What it is | Depends on |
|---|---|---|
| `mock-src/engine.js` | THE game engine (UMD, hand-written JS by invariant; consumed AS-IS by client adapter, sim, mock UI). Typed surface: `client/src/engine/engine.d.ts`, drift-proofed by `tools/check_engine_types.cjs`. | — |
| `sim/combat.cjs`, `sim/dungen.cjs` | FACADES. Public require() surface, unchanged since REQ-0036/0043. | `sim/lib/*` |
| `sim/lib/{core,rng,heap,geometry,formation,status,compile,entry,ray,field,replay,skills,packs,encounter,dungeon}.cjs` | The simulator, decomposed (acyclic). Determinism contract frozen by `sim/tests/goldens.cjs` (12-case sha256 replay matrix). | engine (read-only) |
| `server/api.cjs` | Thin service entry (systemd ExecStart target, unchanged). | router, lib |
| `server/router.cjs` | THE dispatch order (load-bearing, byte-preserves the old if-chain). | routes |
| `server/routes/{public,me,admin,profile,schedule}.cjs` | HTTP route modules; bodies moved verbatim from the old handle(). | lib, admin, schedule facade, storage |
| `server/schedule.cjs` | FACADE, name-for-name pre-split export surface. | services |
| `server/services/{core,rooms,units,runs,warehouse,gacha}.cjs` | Schedule business logic, decomposed (acyclic: all -> core; runs -> units/rooms/warehouse). | storage, sim, engine |
| `server/lib/{content,http_util,humanize,meta}.cjs` | Content payload+cache, HTTP plumbing, event humanizer, service constants. | storage |
| `server/{storage,players,admin,pg_sync,cli_invite}.cjs` | Pre-REQ-0047 modules, unchanged (storage: files/pg seam via STORAGE_BACKEND; pg prod since REQ-0040). | — |
| `shared/content_validate.cjs` | Single executable source of truth for admin content-edit validation. | — |
| `client/` | Vite + React 19 + PixiJS 8 + TS (unchanged externally; builds into committed `web/app/`). | engine via adapter |
| `tools/ci.sh` | sim tests → goldens → mock tests → checkJs typecheck (tsconfig.server.json) → engine drift check → api tests (files) → api tests (pg) → client build → e2e. | — |

## Rules

- Dependencies point INTO `shared/`, never out.
- `sim/` stays runtime-dependency-free; engine interop stays read-only.
- Facade surfaces (`sim/combat.cjs`, `server/schedule.cjs`) are frozen API; add new exports there deliberately.
- Every commit: `npm run test:quick` minimum; before deploy: full `tools/ci.sh` on the server (pg + e2e).
- Error convention: services throw `Error` + `.code` ('NOT_FOUND'|'CONFLICT'|'BAD_REQUEST'|'TOO_LARGE') [+ `.reason`]; routes map code -> HTTP status (`types/coded-error.d.ts`).
