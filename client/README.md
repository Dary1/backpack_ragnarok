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
pnpm install --frozen-lockfile
pnpm run dev       # local dev server (Vite)
```

## Build + deploy
```
cd client
pnpm run build      # tsc -b && vite build -> outputs to ../web/app (emptyOutDir)
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
- `src/i18n.ts` (REQ-0038) — client CHROME i18n: an EN-keyed dictionary
  (`{en:{...}, ja:{...}}`) + `t(locale, key, args?)` lookup, covering nav
  labels, buttons, status text, placeholders. This is a SEPARATE concern
  from content i18n (item/SI name/flavor text, served via `content/live/
  *.json`'s `i18n.ja.{name,flavor}` map, read directly by `src/dex/*`) --
  the same single `Locale` toggle (Header.tsx) drives both.
- `src/api.ts` is a BARREL (REQ-0145b): implementation lives in
  `src/api/` split by domain (http core / content / profile / dex /
  dismantle / schedule / warehouse / workshop / market / ragnarok /
  admin). Add new endpoints in the matching domain module, never by
  appending to the barrel.
- `src/i18n.ts` is a BARREL (REQ-0145b): the en/ja key groups live in
  `src/i18n/` per-domain modules (nav / common / canvas / dex /
  schedule / warehouse / workshop / market / ragnarok / settings),
  merged with key-disjoint spreads; `t()` and `TranslationKey` are
  unchanged. Add new keys in the matching module.
- `src/index.css` is an ORDERED IMPORT LIST (REQ-0145b): rule bodies
  live in `src/styles/*.css` (a byte partition of the old file; the
  import order is load-bearing cascade order -- never reorder). Add new
  rules in the matching styles file; a new page gets a new file
  appended last.
- `src/lib/` (REQ-0145b) — shared page-level helpers, extracted from the
  pages that used to hold private copies. `itemContent.ts` (itemId ->
  content-entry / localized-name / icon+rarity resolution), `time.ts`
  (formatClock + formatWarehouseCountdown), `tabPulse.ts` (cross-page
  inv-tab pulse), `placement.ts` (the three first-fit variants + grid
  bounds; see its recorded gather-then-unify verdict), 
  `usePolledResource.ts` (load-on-mount / optional poll / error/loading /
  manual-reload hook, parameterized to each page's exact semantics),
  `contentCache.ts` (memoized /api/content promise +
  invalidateContentCache()). New pages import from here instead of
  re-implementing; `shared/constants.json` (repo root) holds the numeric
  constants shared verbatim with server services (WAREHOUSE_CAP,
  GACHA_COMMON_BP_COST) — import it rather than hardcoding a display
  literal.
- `src/theme/mjolnir.css` (REQ-0069) — the MJOLNIR design-token layer
  (colors/rarity/fonts, text scales, panel/ornament/button/chip/bar
  primitives) ported from the design mocks (`web/redesign/assets/ui.css`,
  still the visual source of truth). `index.css` @imports it and aliases
  the legacy palette names onto the tokens. Static redesign art is
  referenced from the served `/redesign/assets/` path (not bundled).
- `src/landing/` (REQ-0069) — the landing/title screen: the empty hash
  (`#/`) boot route; the nav-rail LOGO returns to it from anywhere. Also
  `particles.ts`, the perf-gated (and E2E-off via navigator.webdriver)
  lifecycle-safe port of the mock fx.js ember field.
- `src/dex/` (REQ-0035, rebuilt REQ-0038) — Item Encyclopedia (図鑑):
  `DexRoot.tsx` (data fetch + view/edit toggle), `Dex.tsx` (catalog, shape-
  mounted cards via `ShapeGrid.tsx`), `DexDetail.tsx` (two-pane detail:
  diagram left, item list right), `DexDiagram.tsx` (large shape/port/
  socket diagram), `ItemDetailCard.tsx` (detail fields), `DexAdmin.tsx`
  (edit mode: locale-only fields, effect add/delete, thumbnails).
