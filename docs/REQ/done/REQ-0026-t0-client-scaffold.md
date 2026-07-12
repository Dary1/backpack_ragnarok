# REQ-0026 — T0 Client Scaffold (Vite + React + TS + PixiJS)

- **Status**: DONE (T0.1 live at /app/, orchestrator visually verified in Chrome)

## Outcome
Scaffold live: client/ (Vite+React+TS+PixiJS, base /app/, dist → web/app/).
Engine consumed AS-IS via ?raw + CJS-shim execution (no fork); typed d.ts for the used
surface; api.ts typed against actual live responses; game data in module store, React
subscribes. Board renders grid/BPs/dead space/linkers/beams(mutual+dud)/PO art(v7
textures)/port ◇/connection ◆; shell: live badge, JA/EN toggle, item+SI tooltips.
Bundle embeds NO content data (verified) — all via /api at runtime.
Post-scaffold fixes (found by orchestrator Chrome verification):
- (f/g) sprite parsing: sprite_all_v7.svg is multi-root SVG; DOMParser silently dropped
  all but the first block → only 5 symbols loaded. Fixed by tool_fit_check-style
  synthetic-root wrapping + XMLSerializer; node check 21/21 non-blank
  (`npm run check:sprites`). Commits 33e3d66, 6d36713.
- (h) blade orientation: mock's mergeSword assembly path (blade+hilt flush + linked)
  was missing in BoardRenderer → generic path drew blade wrong. Assembly-aware render
  added, matches mock composition. Commit b87409e.
Gate: tsc clean, build ok, /app/ 200, engine 18/18, API 9/9. T0.2 deferred: drag-drop,
linker edit, Save/Load wiring, combos rendering, assembly visuals polish, combat.
- **Date**: 2026-07-04 (orchestrator gen2)
- **Basis**: client stack decision (React shell + PixiJS board + TypeScript, user-approved).

## T0.1 scope (this REQ)
Visible milestone at **https://backpack-dev.qtie.jp/app/**:
- `~/backpack_ragnarok/client/` — Vite + React + TypeScript scaffold; PixiJS renders the
  board READ-ONLY first: canvas grid, BPs, placed POs (sprite v7 art), linker beams,
  port ◇/◆ marks, from `/api/content` + saved profile (fallback scenario).
- React shell: header (data-source badge, Save/Load later), item list panel, tooltip on
  hover (rendered eff_en/eff_ja from the API, JA/EN toggle).
- **engine stays shared & framework-free**: mock-src/engine.js consumed as-is via a thin
  typed wrapper (`client/src/engine/` d.ts + adapter). No engine rewrite, no React-owned
  game state.
- Build gate: `tsc --noEmit` clean + `vite build`; dist deployed to `web/app/`
  (served by existing 8801 static + tunnel; no ingress change needed).
- Edit interactions (drag-drop placement, linker editing, save) = T0.2, next REQ.

## Non-goals (T0.1)
No drag-drop yet; no auth; no combat playback; mock untouched (regression reference).

## Gate
tsc clean; build succeeds; /app/ 200 and renders board from live API (spot-verify DOM
markers + bundle contains no baked content); engine 18/18 + API 9/9 unchanged; commits.
