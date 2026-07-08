# REQ-0069 — Redesign foundation + landing page (MJOLNIR)

Branch: `req-0069-redesign-foundation`. First of the redesign series: the
shared design-system layer + the new landing (title) route. The page-port
REQs (0070–0074: canvas, expedition, warehouse, dex, workshop) and the new
pages (0064 market, 0066 ragnarok) build on this.

## Plan (as specified)

1. Port `web/redesign/assets/ui.css`'s design language (fonts, rune
   accents, panel ornaments, color tokens) into the client as a shared
   stylesheet layer; restyle the global nav to the mock's chrome. fx.js
   ember particles: optional, perf-gated, OFF for E2E.
2. Landing page from the `web/redesign/index.html` mock as a NEW route:
   empty hash (`#/`) renders it; the LOGO above the main navigation
   returns to it from anywhere; its nav entries deep-link to app routes.
3. Shared static assets referenced from the served `/redesign/assets/`
   path (no duplication into the Vite bundle); the app keeps its sprite
   system for item rendering (mock `ic_*.png` are placeholders).

Hard rules honored: ONE Pixi Application per board forever (boards stay
mounted on every route incl. landing; only `.route-hidden` toggles);
engine untouched; [row,col] convention untouched; chrome text via
`i18n.ts` `t()` with EN keys.

## What landed

### 1. Design-token/foundation layer
- **`client/src/theme/mjolnir.css`** (new): color/rarity/font tokens,
  named text scales (`.t-*`, `.den/.dj/.rune/.seal/.tnum/.gold-text`),
  `.panel`/`.panel-pad`/`.ornate` gold-knot corners/`.rune-divider`,
  `.btn`/`.btn-forge`/`.btn-ghost`, `.chip`, `.kw-*`, rarity frames
  (`.rar-*` + `.gem`), `.bar`, scrollbars, reduced-motion discipline,
  `.grain`/`.vignette` overlays — ported from
  `web/redesign/assets/ui.css`, which stays the visual source of truth.
  The file header records what was deliberately NOT ported (mock
  `.tooltip` collides with the app's; mock page primitives belong to the
  page-port REQs; `.hud`/`.rail` were adapted onto real chrome classes
  instead of copied).
- **`client/src/index.css`**: `@import`s the theme; its `:root` now
  ALIASES the legacy palette names (`--bg/--line/--text/--dim` →
  `void/border-lo/bone/bone-2`; `--panel` is defined only by the theme),
  so every pre-existing rule picked up the night-iron palette with zero
  per-rule edits. Body font became `var(--f-ui)`. Chrome sections
  rewritten: `.app-header` = the mock's slim sticky HUD bar; new
  `.nav-rail` (fixed left, 86 px; bottom bar under 840 px) with
  `.nav-logo` + rune-over-label `.nav-link`s; `.app-shell.with-rail`
  margin clears the rail.
- **`client/index.html`**: Google-Fonts link for the six design-system
  families (same delivery as the mocks, `display=swap` fallback).
- **`client/src/landing/particles.ts`**: 1:1 port of fx.js's
  `initParticles()` with a disposer (fx.js has no teardown; the SPA needs
  one per route unmount). Gates: `navigator.webdriver` → OFF (all E2E),
  `prefers-reduced-motion` → OFF, `hardwareConcurrency < 4` → OFF.

### 2. Landing route
- **`client/src/landing/LandingPage.tsx` + `landing.css`** (new): port of
  the `web/redesign/index.html` mock — key art (`key_title.jpg`), aurora,
  shade, particle canvas, gold RAGNARÖK logo lockup, ornate main-menu
  panel whose entries deep-link via `setRoute()`: 続きから→`#/backpacks`,
  遠征を見守る→`#/schedule`, 殿堂→`#/ragnarok`, 設定→`#/settings`; the
  one line of real save data we have (the `/api/me` player name) replaces
  the mock's fictional save summary; lang chip (top-right) toggles the
  same locale the header toggle drives.
- **Routing** (`store/core.ts`, `store/routing.ts`): `Route` gains
  `'landing' | 'market' | 'ragnarok'`. Empty hash (`''`/`'#'`/`'#/'`) →
  landing (the new boot default). Unknown hashes still fall back to
  `backpacks`; `#/invite/<token>` untouched. `setRoute('landing')` writes
  the canonical bare `#/`.
- **`client/src/App.tsx`**: rail + HUD header hide on the landing route
  only; the backpacks-view stays UNCONDITIONALLY mounted on every route
  (REQ-0034 hard rule, unchanged — verified by the new round-trip specs).
  `#/market`, `#/ragnarok` render `PlaceholderPage`.
- **`client/src/Nav.tsx`**: the rail. Logo (triple horn + vertical brand)
  above the entries → landing; entries in mock-rail order (編成/遠征/図鑑/
  工房/市場/殿堂) + app-only Friends/Settings appended; the mock's 倉庫
  rail entry is deferred to REQ-0072 (warehouse is a Schedule tab today).
  `.nav-link`/`.nav-link-active` classes and EN label text kept verbatim
  for the E2E suite.
- **`client/src/Header.tsx`**: nav removed; same h1/badge/status/toggle
  contents restyled as the HUD bar.
- **i18n**: `nav.market/nav.ragnarok/nav.logoLabel` + `landing.*` keys
  (EN authored, ja mirrors mock copy); ja rail labels for backpacks/
  schedule adopt the mock vocabulary (編成/遠征) — they also fit the
  86 px rail; EN labels unchanged.

### 3. E2E
- Every spec that booted via bare `/app/` now boots
  `/app/#/backpacks` explicitly (7 spec files + `helpers.ts bootApp()` —
  the empty hash is the landing now).
- New `client/e2e/landing.spec.ts` (4 tests): landing renders on the
  empty hash (chrome absent, boards mounted-but-hidden, placeholder
  routes resolve, menu deep-links); rail logo returns to the landing from
  backpacks/schedule/dex (hash normalizes to `#/`); boards survive
  repeated landing round-trips (drag still commits; canvas count stable);
  cold boot ON the landing (Pixi boards initialized under `display:none`
  are interactive after Continue — a codepath no earlier spec exercised).

## Deliberate deviations / not done (for the follow-up REQs)

- No "press to begin" gate and no SKIP-LANDING localStorage bypass (mock
  features): the menu opens immediately; skip-landing changes boot
  routing and deserves its own decision.
- No season slab/countdown/wheel and no Muninn notice board: no backing
  data exists client-side; omitted rather than hardcoding fiction.
- No pointer parallax on the landing (fx.js `initParallax`).
- Settings rune is ᛟ on both rail and landing (mock's landing used ᛈ,
  which the rail already uses for Workshop).
- App pages do NOT get `.grain`/`.vignette` overlays yet (full-viewport
  mix-blend over live WebGL boards is a compositing cost; page REQs can
  opt in after measuring).
- No Vite dev-server proxy for `/redesign` was added: the dev server has
  no proxy at all today (`/api` is equally unproxied), so landing art
  404s harmlessly under `npm run dev`; the deployed/E2E origin serves it.
- Existing page bodies (backpacks/schedule/dex/...) keep their layouts —
  they inherit the palette/fonts only; their restyles are REQ-0070+.
- Mobile (<840 px) hides the rail logo (mock hides its brand the same
  way), so mobile has no logo path back to the title until a page REQ
  revisits mobile chrome.

## Gates (execution log)

- `npx tsc -b`: clean.
- `npm run build`: clean; fresh dist committed (`web/app/`).
- Engine tests `node mock-src/tests/run.cjs`: **97 passed, 0 failed**.
- Full E2E `npm run e2e`: **96 passed / 2 failed (98 total, 9.2 m)**.
  Baseline measured immediately before this REQ on the same rig: 92
  passed / 2 failed (94 total) — so all 4 new landing specs pass and the
  ONLY failures are the same 2 pre-existing, documented ones
  (architecture.md §6, REQ-0043 dev_mode-fallback seams):
  - `schedule.spec.ts:274` create-room form offers a dungeon TYPE
    selector (default/test_fixed) …
  - `schedule.spec.ts:333` the generator-seed field IS visible for the
    dev_mode fallback caller (item_admin) …
