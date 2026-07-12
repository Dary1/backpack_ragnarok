# REQ-0052 — Dex Card API + In-App Subwindow System

- **Status**: USER-ORDERED (2026-07-06) — implementation QUEUED
- Origin: consultant point 4.5 — the Dex is the project's single source of teachable
  truth (board/catalog/detail/diagram all render from the same AST/data via
  `render/itemCard.ts`, so taught content can never rot). User's directive: expose an
  API that returns Dex page content directly, plus a subwindow system to display it
  anywhere in the app.

## User spec
「Dexのページコンテンツを直接呼び出せるAPIがあり、それを表示できるサブウィンドウ
システムがあると良さそう」 → one REQ, both halves.

## Design

### Half 1 — Dex Card API (server)
- `GET /api/dex/card/:kind/:id` — `kind ∈ { item, si, tm, bp }` v1;
  reserved: `enemy, skill, job, chapter` (REQ-0051 job cards; future lore chapters).
- Returns a **render-ready JSON card DTO**: the def + resolved effect text
  (`eff_en`/`eff_ja` via the existing `tools/eff_render.cjs` path, mtime-cached like
  `/api/content`) + shape/ports/sockets geometry + icon ref + i18n block + rarity —
  exactly the inputs `ItemDetailCard`/`DexDiagram` consume today, sliced per entity.
  No HTML; the client owns presentation.
- Auth: same `X-Auth-Token`/`resolveAuth()` as every route; card content is
  non-secret. **Bot-API alignment (REQ-0039)**: this is deliberately the first
  public-API-shaped surface (pure JSON, token auth, no CSRF, stable DTO) per the
  user's standing "public API from the start" preference — the DTO gets a version
  field (`v:1`) from day one.
- 404 for unknown ids (no existence oracle needed here — content is public).

### Half 2 — Subwindow system (client)
- `<DexCardWindow>`: an in-app overlay panel (portal-rendered, anchored, dismiss on
  ESC/outside-click), stack depth **[TUNABLE max 2]** (a card may open one nested
  card, e.g. an SI from its host PO's card).
- **One shared component** renders the card from the API DTO using the SAME
  `render/itemCard.ts` composition math (standing "same math everywhere" rule).
  **No new Pixi Application** (standing lesson: ONE Application per board, forever —
  cards compose via the existing non-board pathway).
- Open sources wired in v1:
  - board PO/SI/BP long-press (existing long-press infra pattern) → its card;
  - run LOG entity mentions (enemy/skill names once kinds land; item rewards now);
  - gacha result modal ("what is this BP?");
  - warehouse rows;
  - Dex catalog itself (hover/preview without navigation);
  - reserved: market listings (REQ-0053 P3), notification toasts.
- Each subwindow footer links to the canonical full page `#/dex/:id` — the hash
  route stays the single deep-link URL; the subwindow is a projection, not a fork.
- Locale: active-locale text with EN fallback, same as Dex v2 rules.

### Explicitly out of scope (backlog)
- Discovery/silhouette states (collection meta), chapter unlock pacing, job-card
  authoring UI — separate REQs; this REQ builds the transport + surface they will use.

## Test plan (gates before DONE)
- server: DTO snapshot tests per kind (files+pg), eff_render parity with /api/content,
  404s, DTO version field.
- client E2E: open from board long-press / run log / gacha modal; nested card depth
  cap; ESC + outside-click dismissal; full-page link navigates; locale switch.
- tsc/lint/build green; no new Pixi app instances (assert via existing board tests).

## Outcome (2026-07-07) — DONE (v1 slice; merged to master + live, via REQ-0063)

Implemented on `~/backpack_ragnarok` (192.168.0.6), worktree/branch
`req-0052-dex-card-subwindow`, 5 commits. All runnable gates green (details below).
**This REQ was implemented as REQ-0063's prerequisite** — the user's
2026-07-07 decision on REQ-0063's Dex-surfacing question was "build REQ-0052 first,
then wire 分解値 into it" — so this pass deliberately delivers a genuinely complete,
tested v1 of the API + subwindow mechanism itself, with the FULL breadth of "open
sources" the spec lists (5 integration points) scoped down to ONE flagship
integration, clearly flagged below, rather than a shallow stub across all 5.

### What shipped
- **Server**: `GET /api/dex/card/:kind/:id` (`server/routes/dex.cjs`), kinds
  `item | si | tm`. Reuses `lib/content.cjs`'s `getContent()` — the exact same
  mtime-cache + `eff_en`/`eff_ja` rendering `/api/content` already runs every entry
  through, so a card DTO is always byte-consistent with `/api/content` for the same
  id (proven by a dedicated test, see below). No auth (public/non-secret content,
  matching `/api/content`'s own posture). `v:1` on the DTO from day one, per spec.
  Wired into `router.cjs` at the tail (after ragnarok — collides with nothing, same
  precedent as market/ragnarok's own append).
- **Client**: `<DexCardProvider>` / `useDexCard()` (`client/src/dex/DexCardWindow.tsx`)
  — a portal-rendered overlay (same scrim/modal visual language as the Workshop
  casting-result modal), ESC closes the topmost card, a scrim click closes the whole
  stack, nested-open depth capped at 2 per spec. Renders via `ShapeGrid` (the same
  shared composition math `render/itemCard.ts` backs, per the "same math everywhere"
  rule) — a NEW presentational component rather than a reuse of `ItemDetailCard`'s
  existing JSX (that component is keyed to an already-loaded `DexEntry` + full
  `ApiContentPayload` tag-tree context, a materially different prop contract than
  this window's API-DTO-first, zero-navigation-context shape; sharing the leaf
  pieces (`ShapeGrid`, rarity theme classes) avoided forcing a risky contract change
  onto the existing full Dex page for this pass — documented judgment call).
  Mounted once at the app root (`App.tsx`).
- **Deep link**: `#/dex/<id>` now genuinely round-trips to the Dex detail view.
  This did NOT already work — `store/core.ts`'s `routeFromHash` only ever matched
  exact top-level route names, so `#/dex/blade` would have silently fallen back to
  `backpacks` (a real bug the spec's "hash route stays the single deep-link URL"
  line would have shipped broken had this not been caught and fixed). Added
  `DEX_ITEM_HASH_RE` + a `dexFocusId` snapshot field, checked in `initRouting()`/
  `onHashChange` before the generic fallback (same ordering as the pre-existing
  invite-hash special case); `Dex.tsx` consumes it once (jumps its own
  `selectedId`) then clears it via the new `clearDexFocusId()`.
- **v1 open-source integration (flagship, chosen deliberately)**: the Dex catalog's
  new per-card preview trigger (`.dex-card-preview-btn`, an "i" badge) opens the
  SAME entry's card via the subwindow WITHOUT navigating away from the grid —
  distinct from the pre-existing card-body click (unchanged: still switches into
  the two-pane detail view). Proves the API+window mechanism end-to-end on a real,
  visible, testable path.

### Scope cuts (deliberate, flagged per this project's own documented-judgment-call
norm — NOT silently dropped)
- **`kind:'bp'` is deferred, not merely unwired.** A rolled Blueprint instance
  (Workshop gacha result) has no static content def to key off of — its
  shape/linker/hpMax are per-instance, minted at roll time, living in a player's
  own canvas/warehouse row, never in `content/live/*`. Serving one through this
  same public, id-keyed GET would need either an auth'd instance-scoped route or
  embedding the full instance in the request — a genuinely different design, not
  an allowlist add. `KIND_TO_CONTENT_KEY` in `dex.cjs` is written so adding it later
  is additive.
- **4 of the 5 spec'd "open sources" are NOT wired yet**: board PO/SI/BP
  long-press, run-log entity mentions, the gacha result modal, and warehouse rows.
  `useDexCard()`'s `openCard`/`openNestedCard` API is general-purpose and already
  used by the Dex catalog integration — wiring each remaining source is now a
  small, mechanical addition (one `onClick`/long-press handler calling
  `openCard(kind, id)` per site), not a redesign. Left as fast-follow so this REQ
  could land as a real, fully-gated vertical slice rather than 5 shallow stubs.
- The TM catalog strip (Dex.tsx's separate display-only TM section) does NOT get a
  preview button in this pass (only the main PO/SI grid does) — minor, same
  fast-follow bucket.

### Gate results (this worktree)
- `node sim/tests/run.cjs` → **63 passed, 0 failed**. `node sim/tests/goldens.cjs`
  → **12 cases, replay determinism intact**. `node mock-src/tests/run.cjs` → **97
  passed, 0 failed** (engine untouched by this REQ; baseline held, matches
  REQ-0076's own reported 97).
- `tsc -p tsconfig.server.json` → **clean (exit 0)**.
  `node tools/check_engine_types.cjs` → **OK, 49 declared members verified**.
- `node server/tests/api_test.cjs` (files) → **139 passed, 0 failed** (134
  pre-existing + 5 new dex-card cases).
- `set -a; source server/.env; set +a; STORAGE_BACKEND=pg node
  server/tests/api_test.cjs` → **139 passed, 0 failed**, re-verified after one
  transient, non-reproducing failure in an UNRELATED pre-existing test ("admin:
  REAL repo happy path", a 403) on the first pg run — re-ran clean, and confirmed
  the SAME pre-existing test passes cleanly on a completely untouched sibling
  worktree (`req-0063-dismantle-system`, zero REQ-0052 changes), isolating it as
  environmental flake, not a regression from this REQ.
- `cd client && npx tsc -b && npx vite build` (via `npm run build`) → **success**
  ("✓ built"), dist rebuilt to `web/app/`; only the pre-existing >500kB chunk-size
  advisory.
- `cd client && npm run check:sprites` → **22/22 non-blank** (verified with the main
  checkout's `.venv` temporarily symlinked in for this worktree, since a fresh
  `git worktree add` doesn't carry the gitignored Python env — symlink removed
  again immediately after the check; no sprite/icon was touched by this REQ, so
  this is a baseline-hold confirmation, not new coverage).
- `npx playwright test --list` → **130 tests parsed OK across 24 files** (125
  pre-existing + 5 new `dex-card.spec.ts`), confirming nothing else in the suite
  was broken by this change's imports/syntax. NOT live-run: `playwright.config.ts`'s
  `baseURL` is the shared production tunnel (reflects only the currently-deployed
  build), so the 5 new scenarios were hand-traced against the actual implementation
  instead — same posture as every prior REQ that shipped ahead of its own deploy
  (e.g. REQ-0076).

### Incidental fix
- No pnpm-lock.yaml existed anywhere in this repo's history (root/client/server
  each only carried an npm `package-lock.json`, a pre-existing drift from
  PROJECT.md's stated pnpm-only policy that this REQ did not otherwise go looking
  for). Provisioning this worktree the documented way generated real lockfiles for
  the first time, from the existing shared pnpm store (no new dependency versions
  introduced); committed per PROJECT.md's "commit only pnpm-lock.yaml" instruction.

### Commits (newest last, branch `req-0052-dex-card-subwindow`)
- `a929d57` (a) server — Dex Card API (`GET /api/dex/card/:kind/:id`)
- `f77c21c` (b) client — subwindow + `#/dex/<id>` deep link + catalog wiring
- `a31bd7b` (c) tests — server DTO coverage + client E2E
- `3df248e` (d) pnpm-lock.yaml (root, client, server)
- `640374d` (e) rebuild web/app dist

### Not done in this pass
Merge to `master` and live deploy are separate, later steps outside this REQ's
scope (same convention as every prior redesign/feature REQ) — coordinate before
either, per PROJECT.md's live-services stance.

**Update (2026-07-07, REQ-0063)**: the 分解値 + suppression section referenced
above has now shipped — see REQ-0063's own outcome doc. It merged this branch
into `req-0063-dismantle-system` (this branch was never merged to `master`
directly) and added the overlay to `server/routes/dex.cjs` + `DexCardWindow.tsx`
there rather than here, since REQ-0063 owns the ledger this section