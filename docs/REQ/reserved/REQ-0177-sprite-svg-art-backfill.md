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
(to be filled by the implementing engineer)
