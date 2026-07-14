# REQ-0177 — sprite-svg-art-backfill: lift the legacy SVG icons into the artwork registry

**Ratified:** 2026-07-14 (user, chat) — same-session companion to the REQ-0133
registry-first ruling: "これまでのSVGは、逆にart台帳にあげて、adoptにしてあげてください",
and the seed convention "その場合のseedは、seed最大値を振っておいてください
(seed最大値=不明な環境で作られた)".
**Requested by:** user, 2026-07-14 (chat). Spec authored by orchestrator (Fable).

## Goal
Every live item entity's legacy sprite icon (`icon-<id>` symbol in
content/sprite_all_v12.svg, referenced by the data `icon` field) is imported into the
artwork registry as a REAL render and adopted where nothing is adopted, and the owning
content def is linked via artwork_ref where unset — so the registry tier of the
REQ-0133 chain covers 100% of live items and the registry is the single art ledger.

## Seed convention (user ruling, binding project-wide)
- Backfilled/unknown-environment renders carry **seed = 2147483647** (int4 max).
  MAX SEED = "created in an unknown environment / not reproducible by the gen pipeline".
- GUARD: storage_art.createRender's auto-seed (`COALESCE($2, MAX(seed)+1)`) must exclude
  the sentinel (`MAX(seed) FILTER (WHERE seed < 2147483647) + 1`) or the first
  auto-seeded render AFTER a backfill overflows int4. Unit-test this.

## Scope
### A. Tool `tools/backfill_sprite_art.cjs` (re-runnable, INSERT-only, --dry-run)
- Inventory the live item corpus (po/si/tm entries the game serves; same source files the
  REQ-0157c content backfill used) and each entry's `icon` id.
- For each entity: extract the `icon-<id>` symbol from content/sprite_all_v12.svg as a
  standalone SVG (the client's parseSymbols/standaloneSvgString logic is the reference;
  reimplement or reuse in node), rasterize to PNG at the canonical size (contain-fit,
  aspect inviolable; follow the pipeline's target_px canon — 256x256 unless the pipeline
  docs say otherwise for items), and insert via the STORAGE CHOKEPOINT ONLY:
  - artwork row: system_name = bare entity id (one-name-one-entity), kind mapped
    (po/si; tm → the closest existing artwork kind, document the choice), created only
    if NO artwork row with that exact name exists;
  - render: seed = 2147483647, status ok, image = PNG bytes, provenance/params noting
    `{source:'sprite-backfill', origin:'content/sprite_all_v12.svg#icon-<id>',
    imported_at}` in whatever params/metadata field renders carry;
  - adopt that render ONLY if the artwork has no adopted render;
  - set the content def's artwork_ref to this artwork ONLY if artwork_ref is NULL
    (explicit user selections — e.g. blade → batch-004 — are never overwritten).
- Idempotent: keyed by (system_name, seed-sentinel render presence); second run = 0 writes.
  Foreign rows never mutated; skips logged loudly. Dry-run prints the full inventory.
### B. Storage guard (server/storage_art.cjs)
- The auto-seed sentinel exclusion above + test.
### C. Tests
- DB-free mapping tests where feasible (inventory → row plan, skip rules, idempotency
  keys) + a pg test for the sentinel guard (insert sentinel render → next auto-seed is
  small, not overflow). api_test/artwork_test regression green.

## Live execution (deploy step, orchestrator)
- Run against the live namespace AFTER merge (dry-run first, then real; report counts:
  artworks created / renders inserted / adoptions / defs linked / skipped-foreign).
- Expected effect with REQ-0133 wired: the game renders the SAME pixels as today (the
  registry now serves the rasterized sprite icons), while explicitly selected AI
  renders (blade) take over where chosen.

## Out of scope
- monsters/units (no live `icon`-field corpus of the same shape; units flow via
  REQ-0125b/0128), gacha_pack/skill kinds; sprite retirement; icon-field removal.

## Gates
- G1 server tests (incl. new sentinel + tool tests) + client tsc/build untouched-green.
- G2 admin e2e suites still green (contentadmin/artadmin); full default suite if the
  wiring REQ (0133) rides the same branch.
- G3 hygiene: INSERT-only proof in the log; no repo-file churn beyond tool+tests+doc;
  sprite_all_v12.svg is READ, never modified.

## Risks
- SVG rasterization in node: use the playwright chromium already provisioned for e2e
  (headless page → dataURL→PNG) or resvg if vendored — NO new global installs; document.
- BYTEA size fine (icons are small).
- tm kind mapping is a judgment call — document it in the log.

## Implementation log

### Session 2026-07-14 (implementing engineer) — SHIPPED on branch `req-0133-item-raster-live-wiring` (rides with REQ-0133)

**Decisions**
- **Sentinel seed guard** (`server/storage_art.cjs`): `createRender`'s auto-seed now
  `COALESCE($2, (SELECT COALESCE(MAX(seed) FILTER (WHERE seed < 2147483647),0)+1 …))`.
  Excluding the int4-max sentinel is what stops the first admin-generated render AFTER a
  backfill from computing `2147483647+1` (int4 overflow). A backfilled artwork's next real
  render seeds off its highest NON-sentinel seed, or 1 if the sentinel is its only render.
- **tm → artwork kind mapping = `si`** (documented judgment call). The registry KINDS are
  `po|si|unit|monster|bpskin` — there is no `tm` kind. A TM is a 1×1, shape-less, stackable
  inventory icon, so `si` (shape-less, locked 256×256) is the closest existing kind. po → po
  (shape/size derived from the item footprint via the REQ-0151 sizing law); si → si.
- **Raster size / method**: each `icon-<id>` `<symbol>` is lifted with a faithful Node port
  of the client's `parseSymbols`/`standaloneSvgString` (@xmldom, the exact `check_sprites.mjs`
  pair) and rasterized to a **transparent PNG via the e2e-provisioned Playwright chromium in
  `client/node_modules`** (no new installs) — the client's `rasterize()` path. Size: the
  symbol's **longer viewBox edge → 256px, aspect preserved** (contain-fit; `preserveAspectRatio`
  carried through). 256 is the item pipeline's per-cell canon; holding the sprite's native
  aspect makes the registry render draw the SAME shape the live sprite route draws today (the
  game contain-fits by aspect, so absolute px is not load-bearing — documented in the tool).
- **INSERT-only + idempotent** via a pure `decideActions(state)` truth table: create artwork
  only if absent; insert the sentinel render only if none present; adopt only if nothing is
  adopted (never re-adopts over an explicit selection — e.g. blade → a chosen batch); set
  `content_def.artwork_ref` only if a def exists AND its ref is NULL (never overwrites). Second
  run = 0 writes. Foreign entries (icon with no `<symbol>`) skipped loudly. `--dry-run` prints
  the full plan and writes nothing.
- **Corpus**: `content/live/{live_items,live_sis,live_tms}.json` = the 8 po + 6 si + 1 tm the
  game serves (the REQ-0157c po/si/tm files). `starter_items.json` is EXCLUDED by design — its
  entries carry `icon-placeholder-*` ids that have no `<symbol>` in the sheet (nothing to lift).
- content/sprite_all_v12.svg is READ, never modified.

**Files**
- `server/storage_art.cjs` (sentinel guard), `server/tests/artwork_test.cjs` (+1 pg case).
- `tools/backfill_sprite_art.cjs` (tool), `server/tests/backfill_sprite_art_test.cjs` (tests).

**Gate results**
- **G1**: `artwork_test.cjs` (pg) **7 passed / 0 failed** (incl. the new sentinel case — insert
  sentinel → next auto-seed = 1, not 2147483648). `backfill_sprite_art_test.cjs` **12 passed /
  0 failed** — 8 DB-free mapping tests (parse, inventory→plan, po/si/tm kind mapping, 5×5 mask,
  decideActions truth table, rasterSize) + 4 pg tool tests in an isolated TMPHOME namespace
  (dry-run writes nothing / first run 15 artworks+15 renders+15 adoptions / idempotent re-run 0
  writes / sprite-backfill provenance). content/api tests green (see REQ-0133 log). Client
  tsc+build EXIT 0.
- Real Playwright rasterizer proven end-to-end against an isolated namespace: 15 artworks / 15
  renders / 15 adoptions in ~1s, all valid PNG bytes (blade 4187 B, etc.); namespace cleaned.
  (Browsers cache: `~/.cache/ms-playwright`; under a HOME-remapped run set
  `PLAYWRIGHT_BROWSERS_PATH` at it.)
- **G2**: `tools/content_admin_e2e.sh` **22 passed** — its harness now seeds this backfill
  (INSERT-only) so the REQ-0133 wiring test can prove registry-first vs sprite. `artadmin_e2e.sh`
  **4 passed**. (Full default suite = post-deploy; see REQ-0133 log.)
- **G3**: diff carries only tool + tests + doc (+ the REQ-0133 files); `content/sprite_all_v12.svg`
  UNTOUCHED; no repo web/dist/lockfile churn; every test run used an isolated pg namespace (no
  live-DB writes from this branch).

**Commits**: `6cae9ec` (sentinel guard + test), `973533a` (backfill tool + tests).

**Live execution (orchestrator owns this, POST-merge, against the LIVE namespace)**
    set -a; source server/.env; set +a
    node tools/backfill_sprite_art.cjs --dry-run   # prints the full plan, writes nothing
    node tools/backfill_sprite_art.cjs             # applies (INSERT-only, idempotent)
Expected on the live corpus: entities=15 artworks_created=15 renders_inserted=15 adoptions=15
defs_linked=<# of existing po/si/tm content_defs with a NULL artwork_ref> skipped_foreign=0
(counts reduce on re-run / where explicit selections already exist). Run the dry-run first and
compare. Node on PATH (`export PATH=$HOME/.nvm/versions/node/v24.18.0/bin:$PATH`); Playwright
browsers resolve from `~/.cache/ms-playwright` under the real HOME (no override needed live).

**Deviations / notes**
- Automated tool test injects a fake rasterizer (deterministic, browser-free, fast); the REAL
  Playwright path is proven by the isolated live-shape run above + the content_admin_e2e harness
  seed. `check_sprites.mjs` FAILs in this sandbox on a missing `.venv/bin/python` (cairosvg) —
  PRE-EXISTING environment gap, unrelated to this REQ (our raster path uses Playwright, not the
  cairosvg check).

