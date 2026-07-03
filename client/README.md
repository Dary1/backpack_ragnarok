# client/ — backpack_ragnarok game client (REQ-0026)

Vite + React + TypeScript + PixiJS. Deployed under `/app/` on the existing
static server (`web/` @ :8801, tunneled at backpack-dev.qtie.jp).

## Scope (T0.1)
Read-only board render from the live API: canvas grid, BPs, placed POs
(sprite v7 art), linker beams, port ◇/◆ marks. No drag-drop, no auth, no
combat playback yet (T0.2+). The engine (`mock-src/engine.js`) is consumed
as-is via a thin typed adapter in `src/engine/` — never forked or rewritten.

## Develop
```
cd client
npm install
npm run dev       # local dev server (Vite)
```

## Build + deploy
```
cd client
npm run build      # tsc -b && vite build -> outputs to ../web/app (emptyOutDir)
```
The build output (`web/app/`) is committed directly — it is the deployed
artifact served at https://backpack-dev.qtie.jp/app/ by the existing static
web service (no ingress change needed; `web/` is already served as-is).

## Structure
- `src/engine/` — `engine.d.ts` (typed surface for the parts T0.1 uses) +
  `adapter.ts` (thin wrapper importing `mock-src/engine.js` unmodified).
- `src/api.ts` — typed client for `/api/content` and
  `/api/profile/default/canvas` (falls back to the scenario baked into
  `/api/content` on 404).
- `src/board/` — PixiJS board renderer (grid, BPs, POs, beams, port marks).
- `src/store.ts` — module-level game-data/state store; React subscribes to
  it via a hook for the read-only UI (header, item panel, tooltips).
