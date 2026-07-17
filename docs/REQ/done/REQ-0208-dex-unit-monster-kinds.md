# REQ-0208 — Dex: unit / monster catalog kinds

## State log
- 2026-07-17 reserved (stub).
- 2026-07-17 reserved -> todo: user-directed. Design ratified in user Q&A (2026-07-17):
  (1) real tab switching Items / Units / Monsters; (2) all three reserved tabs
  (Socket Items / BPs / Search Squads) removed; (3) monster info FULL (name, rarity,
  hp range, skills, footprint, art); (4) both new kinds get the master/detail pane.
  User constraint: units show NO shape display — a unit's backpack shape is rolled
  at emission, so the reserved "BPs" tab concept is obsolete (user: 陳腐化).

## Problem
The Dex (#/dex) covers po/si/tm only. unit_def (REQ-0170) and monster_def (enemy/1)
are live, contentadmin-authorable kinds the game rolls and fights with, but they
have no player-facing reference surface. The tab row still advertises three
disabled "reserved" tabs whose concepts are stale: SIs merged into the Items grid
long ago (REQ-0038), and a BP catalog cannot exist — a BP's shape/hp are
per-instance, rolled at Workshop emission (REQ-0170/0190), never a content def.

## Change

### Server (display serving; ADDITIVE payload fields only)
- GET /api/content gains `monsters` (id-keyed monster_def entries) and
  `monster_skills` (skill id -> {name, name_ja}, LIMITED to skills referenced by
  served monsters). Both are derived from services/core.cjs getScheduleContent() —
  the authority path the roll/sim already serve registry-first (REQ-0176).
  lib/content.cjs gains NO second monster/skill resolution path; Dex display and
  combat authority agree by construction (the REQ-0170/0176 anti-drift argument).
  withBackCompatI18n is applied at the seam (same display convention as every
  other section). Under the files backend the sections still serve (file tier),
  registry overlay empty — same posture as every covered kind.
- art_urls: monster ids join the resolved map (storage.resolveItemArtNames is
  kind-generic: def.artwork_ref adopted -> exact-name adopted -> omitted). Unit
  art does NOT ride art_urls: a unit def's `icon` IS its artwork reference
  (a free reference — REQ-0170), resolved client-side via board/unitIcon
  unitArtUrl(), the same convention Workshop/board already use.
- shared/dto.ts: ApiMonsterEntry + ApiSkillName; ApiContentPayload gains
  monsters / monster_skills.

### Client (Dex)
- Dex.tsx: the tab row becomes real state — Items (default; catalog + TM strip
  markup byte-unchanged) / Units / Monsters. The three reserved tabs and their
  i18n keys are REMOVED. #/dex/<id> deep links resolve across all three kinds
  (tab auto-switch). Collection strip total counts po+si+tm+unit+monster pages.
- UnitCatalog.tsx (new): search + rarity filter, card grid, master/detail.
  Cards and detail show the adopted artwork portrait (unitArtUrl), names, rarity,
  connection shape (shapeLabel/dirsLabel lifted from WorkshopPage into a shared
  lib/connShapeLabel.ts), flavor. NO ShapeGrid anywhere on unit surfaces; the
  detail's schema slot is an explicit rolled-at-emission note instead.
- MonsterCatalog.tsx (new): search + rarity filter, card grid, master/detail.
  Cards show art (art_urls; rune placeholder when absent), names, rarity, hp
  range; detail adds footprint (def.footprint — the REQ-0188 drift guard keeps it
  art-consistent), skills as chips localized via monster_skills, pack_role.
  enemy/1 rarity is lowercase; it is capitalized ONLY for the theme class/word.
- Both catalogs reuse the dex-md master/detail classes, the dcard anatomy and
  RegistryBadge (REQ-0155 LINK-FIRST applies to the new kinds for free).
- i18n/dex.ts: + tab/portrait/connection/stats/footprint/skills/role keys
  (en+ja parity); obsolete reserved-tab keys removed.
- styles/dex.css: appended REQ-0208 section (later-wins, REQ-0075 convention).

## Non-goals
- No DexCardWindow (i-preview) for units/monsters (dex card kind allowlist untouched).
- No dex numbering for units/monsters (the po-only v1 numbering is unchanged).
- No market/dismantle wiring for the new kinds.
- monster_pack / skill_def / gacha_pack get no Dex tab (packs already surface in
  the Workshop odds view; a pack tab is a separate design).

## E2E selector contract kept
Items tab path unchanged: .dex-count / .dex-card / .dex-card-shape .shape-grid /
.dex-grid / .dex-search / .dex-tab-active / .dex-empty, and dex-admin.spec's
locale flip on the active Items tab. New surfaces add .dex-unit-card /
.dex-monster-card and data-testid dex-unit-detail / dex-monster-detail.

## Gates (results appended when run)
- server: api tests (+ new monsters/monster_skills assertions on GET /api/content)
- client: pnpm lint; pnpm build (tsc -b + vite)
- e2e: dex specs (+ new units/monsters tab tests) via tools/e2e_run.sh

## Gate results (2026-07-17)
- server api tests: 186 passed, 0 failed (includes the new REQ-0208
  monsters/monster_skills assertion; 1509 assertions, sf parity gate).
- client lint: 0 errors (46 pre-existing warnings, none in REQ-0208 files).
- client build (tsc -b + vite): OK.
- e2e targeted (dex.spec / dex-card.spec / dex-admin.spec), CI-canonical env
  (PLAYWRIGHT_BASE_URL=127.0.0.1:8803, E2E_GPU=1, E2E_PARALLEL=4):
  18 passed, 1 skipped (the pg-only dex-admin 409 guard), 0 failed --
  includes the 3 new REQ-0208 tests.
- e2e FULL default suite, same env: 187 passed, 1 skipped, 0 failed (3.6m).
- NOTE: a first targeted run against the default PUBLIC tunnel baseURL
  failed the 3 new tests -- expected, not a regression: that target serves
  the DEPLOYED master bundle/api, which predates this branch. The local
  proxy + fleet (the ci.sh [7/7] invocation) serves THIS worktree's build
  and api, and is the meaningful pre-merge gate.

## Status
Implementation commit 74d0762 on branch req-0208-dex-unit-monster-kinds.
Built, NOT merged/deployed -- deploy needs the usual coordination on the
main checkout + backpack-api/backpack-web restart (HANDS-OFF without user
go-ahead).

## Deploy record (2026-07-17)
- Pre-deploy: master (REQ-0207 wildlands) merged INTO the branch; api tests
  re-run green (186/186; monsters section picked up the batch-006 roster:
  15 -> 27 served monsters, 28 -> 48 referenced skills).
- Merged to master (--no-ff) and deployed: backpack-api + backpack-web
  restarted, both active. User-directed (2026-07-17).
- Live verification on https://backpack-dev.qtie.jp:
  /api/content serves monsters=27, monster_skills=48, units=42
  (ja names verified: frost_gnoll -> フロストノール, gnoll_claw -> ノールの爪);
  the served bundle contains the new tab keys; art_urls resolves adopted
  renders for 20/27 monsters (the rest show the rune placeholder by design).
- Status: LIVE. Stays in built/ pending user acceptance (built -> done on
  acceptance, per the REQ state policy).
