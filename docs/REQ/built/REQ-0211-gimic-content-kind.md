# REQ-0211 — gimic-content-kind: trap / treasure box / hidden door become first-class content

**Status:** built — implemented 2026-07-17, `tools/ci.sh` GREEN (DB-free) + client lint/build +
targeted e2e. NOT merged/deployed: the two ENUM migrations and the live backfill are deploy
steps awaiting the user's go-ahead (same posture as REQ-0184/0208).
**Reserved:** 2026-07-17
**Slug:** gimic-content-kind
**Branch / worktree:** `req-0211-gimic-content-kind` (server, UNMERGED)
**Requested by:** user, 2026-07-17: add a content registry kind `gimic` (the user's chosen
spelling — NOT "gimmick" — kept verbatim in every identifier), an art kind `gimic` configured
IDENTICALLY to `monster`, migrate the three legacy hardcoded gimmicks (trap / treasure box /
hidden door) into it and DELETE the old hardcoded paths entirely (full migration, no fallback),
and surface `gimic` in the Dex.
**Depends on:** REQ-0155 (content registry), REQ-0160 (dungeon registry kinds + dialects),
REQ-0184 (monster_pack — the closest precedent: a kind whose machine check REUSES a shared
validator and whose data is consumed by the sim), REQ-0179 (custom art kind), REQ-0208 (Dex
unit/monster catalog kinds — the exact pattern the Dex tab follows).
**Feeds:** REQ-0185 (dungeon becomes pre-generated content) — that REQ references gimic defs by
id with probabilities; this REQ makes gimic def ids stable and the serving API clean for it.

## Goal

The interactable dungeon gimmicks — a **trap** (damage/debuff on entry), a **treasure box**
(loot), a **hidden door** (passage/discovery) — stop being hardcoded `entity/1` records read
only by the dungeon generator and become first-class `gimic/1` content: authorable at
`/app/#/contentadmin`, machine-checked, registry-first served, art-linkable, Dex-visible, and
consumed by the generator from the registry-exported live file.

## Rulings (user, 2026-07-17)

1. **Spelling is `gimic`.** The user's chosen identifier. It is NOT "corrected" to gimmick
   anywhere in code, schema, ids, or data. (Prose may say "gimmick" for the English noun.)
2. **Full migration, no fallback.** The legacy hardcoded `entity/1` path is DELETED, not kept as
   a fallback. `entities.json` is gone; `gimics.json` (gimic/1) is the one source.
3. **Art kind `gimic` == art kind `monster`.** Same sizing law (w x h grid, 1..12, 128 px/cell,
   /16-snapped), same prompt default, same shape editor — configured identically.
4. **Dex shows gimic** as its own tab/section, following REQ-0208's catalog pattern.

## Schema `gimic/1` — shape and rationale

A gimic variant's `data` is the `entity/1` record VERBATIM plus one new field, `behavior`:

| field | notes |
|---|---|
| `id` | stable id (e.g. `trap_frost_deadfall`) — kept identical to the legacy entity id so REQ-0185 can reference it |
| `behavior` | **the discriminator, the reason the kind exists**: `trap` \| `treasure` \| `hidden_door`. The coarse, registry-facing family |
| `name` / `i18n.ja` | display, as every kind |
| `type` | the FINE-grained engine interaction subtype: `trap` \| `door_stage1` \| `door_stage2` \| `chest`. What the generator/combat key stage logic on |
| `mode` | `detection` (a trap/hidden thing is FOUND) \| `unlock` (a chest/door is OPENED) |
| `footprint` | `[fh, fw]` cells (height, width) — the transpose convention the sim/pack board use |
| `hp` | nominal HP (1 for detection traps/doors; the real race HP for a chest/door-stage2) |
| `masked` | shows as `"?"` in the replay log until discovered |
| `timeout_secs` | the interaction clock |
| `skills` | skill ids the gimic fires (the trap volley / the door-keeper strike) |
| `note` | free-text authoring note |

**Why `behavior` as a discriminator over `type`, and why keep both.** `type`/`mode` already
existed on `entity/1` and are the fine-grained pair the engine keys on (a hidden door is TWO
engine subtypes: `door_stage1` detection + `door_stage2` unlock). `behavior` is the NEW coarse
family the registry, the admin, the Dex filter and REQ-0185's probability table want to speak in
("a hidden door", not "door_stage1 and door_stage2"). The validator enforces a
behavior→allowed-modes map (`GIMIC_BEHAVIOR_MODES = {trap:[detection], treasure:[unlock],
hidden_door:[detection,unlock]}`), so the two fields cannot contradict (a "trap that is an
unlock" FAILs by name). The map is the single place the vocabulary is declared — **extensible**:
a future gimic family is one entry here plus the generator/combat code that honours it.

**Byte-identical migration.** Every field the dungeon generator reads (`footprint`, `hp`,
`timeout_secs`, `skills`, `id`, `name`, `masked`) is transcribed VERBATIM from `entities.json`.
`behavior`/`type`/`mode` are metadata the generator does not read. Result: `gimics.json` produces
a byte-identical dungen def — **the 12 replay goldens are UNMOVED** (proven, `goldens.cjs` green),
and no sim rebaseline was needed. The migration is a rename + one added field, not a rebalance.

**Occupied cells are DERIVED, never stored** — the same doctrine as REQ-0184: a gimic carries its
`footprint`, and the placer derives the cells; storing both would be two sources of truth.

## Art kind `gimic` (== monster)

`artwork_kind` ENUM += `gimic` (migration 021). `art_sizing.cjs` gives `gimic` the monster case
verbatim (stacked `case 'gimic': case 'monster':`). `routes/art.cjs` shape/defaults treat
`gimic` exactly like `monster` (`{w,h}` shape, `{main_object}, white background` prompt). The
artadmin client (`artShared`/`CreatePanel`/`Workspace`/`ArtAdminPage`) renders the monster w x h
shape editor for `gimic`. A gimic content def references a gimic artwork through REQ-0174's
`content_defs.artwork_ref` (exact-name fallback), the same chain every other kind uses; the
`art_urls` map and the Dex portrait resolve gimic ids identically to monsters.

## Ships

- **`server/migrations/020_content_kind_gimic.sql`** — `content_kind` ENUM += `gimic`
  (`ADD VALUE IF NOT EXISTS`, bare top-level statement — the 010/016/019 precedent).
- **`server/migrations/021_artwork_kind_gimic.sql`** — `artwork_kind` ENUM += `gimic`.
- **`shared/content_validate.cjs`** — `validateGimicEntry(gimic, skillDefs)` + `GIMIC_BEHAVIOR_MODES`:
  the ONE executable definition of a legal gimic (behavior/mode compatibility, footprint/hp/
  timeout ranges, skills cross-checked against the live roster). Dependency-free; reused by the
  machine check.
- **`server/services/content_checks.cjs`** — the `gimic/1` dialect: `schema_vocab` REUSES
  `validateGimicEntry`; `engine_types` APPLIES (the generator dereferences footprint/hp/timeout/
  skills — a string is a crash, not a nit); `gen_data`/`integrate` honestly `applicable:false`.
- **`server/routes/content.cjs`** — `gimic` joins `KINDS`.
- **`server/services/core.cjs`** — loads `gimicDefsById` from `gimics.json`; `gimic` joins
  `REGISTRY_KINDS` / `REGISTRY_MAP_BY_KIND`; registry overlay overlays gimic adopted variants.
- **`server/lib/content.cjs`** — `gimicsFromCore()` serves the Dex `gimics` + `gimic_skills`
  sections from the authority path; gimic ids join the `art_urls` name set.
- **`content/live/dungeon/gimics.json`** (+ `content/batches/batch-002-dungeon-pilot/gimics.json`)
  — `gimic/1`, the 4 migrated records; live is a byte-identical promote copy of the batch source.
- **`sim/dungen.cjs`** — reads `gimics.json` (`gimicsPath`/`loadGimicTemplates`/`gimicTemplates`)
  instead of `entities.json`; output byte-identical.
- **`content/registry.json`** — `live_dungeon.files` provenance: `entities.json` -> `gimics.json`
  (new sha256), keeping the REQ-0122 lossless-promotion invariant intact.
- **`tools/backfill_content_registry.cjs`** — new source `gimic <- content/live/dungeon/gimics.json`;
  `entities.json` left the `SKIPPED_FILES` table (it is a registry kind now).
- **`tools/promote_dungeon_batch.cjs`** — `REQUIRED_FILES` `entities.json` -> `gimics.json`.
- **`tools/e2e_fleet.cjs`** — overlays the worktree's `content/live/dungeon` onto each isolated
  e2e backend so it serves `gimics.json` (the "worktree overlay, not yet on master" idiom).
- **contentadmin** — `gimic` in `KINDS`/`SCHEMA_REF_DEFAULTS`; an `EntityPreview` gimic branch
  (behavior/type/mode/hp/footprint/timeout/masked chips + skill chips; FallbackGrid catches the rest).
- **Dex** — `shared/dto.ts` `ApiGimicEntry` + `ApiContentPayload.gimics`/`gimic_skills`; a real
  **Gimics** tab (`client/src/dex/GimicCatalog.tsx`, filtered by behavior; behavior-themed frame
  since gimics have no rarity), tab/focus/count wiring in `Dex.tsx`, en+ja i18n in `i18n/dex.ts`,
  a small behavior-accent block in `styles/dex.css`.
- **Tests** — 9 new `gimic/1` dialect tests; a `/api/content` gimics-section api test; a Dex
  Gimics-tab e2e test; harness/req0203/req0207/backfill/registry-provenance updates.

## Deleted legacy paths (full migration, no fallback)

- `content/live/dungeon/entities.json` — **deleted** (replaced by `gimics.json`).
- `content/batches/batch-002-dungeon-pilot/entities.json` — **deleted** (replaced by `gimics.json`).
- `sim/dungen.cjs` `entitiesPath()` / `loadEntityTemplates()` / `entityTemplates` — **removed**,
  renamed to the `gimics*` equivalents reading `gimics.json`. No `entities.json` reader remains.
- `entities.json` removed from `tools/backfill_content_registry.cjs` `SKIPPED_FILES`, from
  `tools/promote_dungeon_batch.cjs` `REQUIRED_FILES`, from `server/tests/api/harness.cjs`, from
  `sim/tests/req0203`/`req0207`, and from `content/registry.json` provenance.
- NOTE: `content/live/dungeon/dungeon.json` (the `test_fixed` hand-authored dungeon) still inlines
  its own entityDefs — that is authored dungeon CONTENT, owned by REQ-0185's dungeon kind, and is
  deliberately OUT of scope here (it is not a hardcoded code path).

## Gates (results, 2026-07-17)

- **DB-free `tools/ci.sh` GREEN** (`SKIP_PG=1 SKIP_E2E=1 SKIP_CLIENT=1`), HOME pointed at the
  worktree (the REQ-0184 os.homedir() convention). sim 117 · goldens 12 (UNMOVED) · S4 14 ·
  forecast parity 18 · req0203 15 · req0207 13 · unit-charge 13+19 · mock 119 · server tsc clean ·
  api (files) 187 (incl. the new gimic section test) · backfill_content_registry 11 (corpus +gimic)
  · dialect 43 (incl. 9 new gimic tests) · every other DB-free gate green.
- **Client GREEN**: `pnpm lint` 0 errors (46 pre-existing warnings, none in REQ-0211 files);
  `pnpm build` (tsc -b + vite) OK.
- **e2e GREEN for the touched surface**: full default suite via the ci-canonical fleet
  (`PLAYWRIGHT_BASE_URL=127.0.0.1:8803 E2E_GPU=1 E2E_PARALLEL=4`) = **187 passed, 1 skipped,
  1 failed**. The new **Dex Gimics tab test PASSED**. The single failure —
  `bp-transfer.spec.ts:164 round trip: canvas -> inventory -> canvas` — is a drag-drop/auto-save
  TIMEOUT (44.6s) with no relationship to gimic/content/art/dex; re-run in isolation it passes
  (contention flake under the parallel full-suite load).
- **NOT run (deploy steps, per REQ-0184/0208 precedent):** the PG-backend api pass and the live
  migration (020/021 applied via supabase-db as postgres) + live backfill (`gimic` = 4, all PASS,
  all adopted). These touch the live DB and close on deploy.

## Notes for the dependent REQ-0185 (dungeon content kind)

- **Gimic def ids are stable and unchanged from the legacy ids**: `trap_frost_deadfall`,
  `door_rimefast_stage1`, `door_rimefast_stage2`, `chest_frostbound_cache`. Reference these by id.
- **A hidden door is TWO ids** (`door_rimefast_stage1` detection + `door_rimefast_stage2` unlock),
  linked by convention (shared `door_rimefast_` prefix + `behavior:hidden_door`). If REQ-0185 wants
  one probability per "hidden door", weight the pair as a unit (stage1 is the entry; stage2 is its
  reveal). The generator today only instantiates `door_rimefast_stage2` for its attachment door.
- **Serving is clean and registry-first**: `core.getScheduleContent().gimicDefsById` is the
  authority map (file tier overlaid by adopted registry variants), and `/api/content` exposes the
  display slice as `gimics` + `gimic_skills`. REQ-0185 should resolve gimic refs through
  `gimicDefsById`, the same way encounters resolve `packId` through `monsterPackDefsById`.
- **The generator still hardcodes WHICH gimic ids it places** (one of each). That selection is the
  seam REQ-0185 replaces with a probability table over gimic defs — the def DATA is already in the
  registry; only the selection remains hardcoded.

## Found in flight (worth keeping)

- **The e2e fleet copies `content/live` from the MAIN checkout, not the worktree** (`e2e_fleet.cjs`
  `REPO = os.homedir()/backpack_ragnarok`), overlaying only a few worktree files. A worktree that
  RENAMES a dungeon file (entities.json -> gimics.json) makes the worktree api 500 on the isolated
  backend until a dungeon overlay is added. Fixed here (the `gimics.json`-not-yet-on-master overlay);
  any future dungeon-domain rename needs the same overlay.
- **os.homedir() content resolution** bites again (REQ-0184's note): verifying a content REQ on a
  branch needs HOME pointed at the worktree (a `/tmp/<home>/backpack_ragnarok -> worktree` symlink),
  or the sim/dialect tests read the main checkout's still-`entities.json` dungeon and fail.
- **The main checkout stays untouched** — HANDS-OFF preserved (it still carries `entities.json`;
  the migration lives only on this branch until deploy).

## Rebase onto post-0217 master — 2026-07-17

Rebased `req-0211-gimic-content-kind` onto master (base `cc575e2`, the post
REQ-0214/0217/0221/0225/0230/0231/0234 tip; master advanced to `6d0e3a0` during the work).
New tip: **`f44702d`** (was `68a684d`; backup ref `refs/backup/req-0211-pre-rebase-20260717`).

**Conflicts + resolutions**
- **`tools/e2e_fleet.cjs` overlay obsolete → commit `eef797b` DROPPED.** REQ-0217 rewrote the
  fleet so a worker home `cpSync`s the WHOLE `content/live` from THIS worktree (the per-file
  "not yet on master" overlays are retired with it). The branch's dungeon overlay (copying
  gimics.json) is subsumed; the file is now byte-identical to master. No behavior change — the
  hermetic fleet already serves the worktree's gimics.
- **`content/registry.json`** auto-merged: the branch removed `entities.json` / added the
  `gimics.json` hash in the base `live_dungeon` block; master appended batch-007 deepstone to
  `live_dungeon_additive` — disjoint regions.
- `server/routes/content.cjs` KINDS (+gimic), `server/tests/api/harness.cjs` (entities→gimics
  fixture) and the new `client/e2e/dex.spec.ts` Gimics-tab spec applied cleanly (master did not
  touch them). dex.spec.ts is read-only on `/api/content` and inherits the REQ-0214
  `x-bpk-e2e-profile` headers — no porting needed for the hermetic harness.

**New commits the rebase required**
- `port REQ-0219 additive-promotion gate to gimics.json` — REQ-0219 (deepstone) merged to
  master AFTER this branch forked, so `sim/tests/req0219_deepstone_test.cjs` still enumerated
  the pre-migration live/dungeon file set incl. `entities.json`. Applied the SAME
  entities.json→gimics.json edit this branch already made to the REQ-0203/0207 sibling gates.
- `isolate per-kind registry read` (`server/services/core.cjs computeRegistryData`) — adding
  `gimic` (and later `dungeon`) to `REGISTRY_KINDS` makes the pg registry read ask for a
  `content_kind` enum value not on the db until the 020/022 migration deploys, so
  `resolveAdoptedContentData` throws `invalid input value for enum content_kind`. The
  UN-isolated loop let that one throw reject the whole snapshot, silently blanking registry-
  first serving for EVERY kind (unit/gacha/monster/skill/po). Now guarded per-kind — the
  module already promises keep-last-snapshot / never-500; applied per-kind. Surfaced by the pg
  gates, which this branch never ran (it was validated DB-free).

**Gate evidence (measured on the req-0185 tip, which contains this branch)** — DB-free
`tools/ci.sh` GREEN. The HOME→worktree symlink is STILL required for the sim/dialect content
gates (os.homedir() content anchoring persists; the e2e overhaul only fixed the fleet's
per-worker HOME, not the ci gates). pg content/schedule serving GREEN (schedule_serving 13/0,
was 4/9 before the isolate fix). Hermetic e2e Gimics-tab spec (`dex.spec.ts:428`) PASS.
Branch stays UNMERGED.
