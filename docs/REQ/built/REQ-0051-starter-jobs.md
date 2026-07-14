> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0051 — Starter Units -- four fixed-item starter units (5×5 BPs, connection_shape none; ex "Starter Jobs")

- **Status**: USER-DESIGNED (2026-07-06) — implementation QUEUED. This REQ is the
  first docs capture of the user's plan (previously undocumented); it is the
  "right arm of the tutorial" (user's words) and the solo-play enabler.

## User spec (verbatim design, 2026-07-06)
- Grant every new player **four 5×5 BPs WITHOUT Units** at profile creation.
- Each comes pre-filled with **4 different fixed POs** that **cannot be moved** —
  four distinct "starter jobs".
- Each starter BP occupies one inventory page (pages 1–4).
- Players use them while convenient, then **discard** them when outgrown.
- Result: a solo player can field 4 squads immediately, progressing regardless of any
  other player's activity.
- 1-squad runs remain possible but clear only low levels with matching rewards —
  the 4-job grant is the intended on-ramp, not a hard requirement.

### Ruling addendum (user, 2026-07-06 — BINDING design philosophy)
The IDEAL endgame shape is: **one player concentrates their assets into ONE
strongest squad and plays in a troop of players.** Fielding up to 4 squads solo is a
RELIEF measure for solo players — it must never be presented or balanced as best
practice. Starter jobs are the relief's on-ramp; UI copy, tutorials and reward
curves must nudge toward troop play + single-squad mastery as players graduate.
(Same ruling rejected cross-squad Formation Links: coupling squads too tightly would
promote solo multi-boxing over cooperation.)

## Design

### Job roster (plain names per art_golden; [ORCH proposals, vetoable])
| id | job | fixed PO kit (4) | teaches |
|---|---|---|---|
| job_guard | Guard | block/Spikes-leaning kit | Backpack-as-HP, formation tanking |
| job_arms | Arms | weapon DPS kit | every_secs cadence, rays/bounces |
| job_mend | Mend | Regen/heal/cleanse kit | statuses, attrition & the H-curve |
| job_scout | Scout | detection + unlock kit (lockpick/spyglass line) | modes; layered-encounter value (REQ-0049) from run 1 |
Kits reuse live/batch-002 items where possible; gaps become a mini content batch
through the normal S0–S8 pipeline. **Dependency**: pilot utility item icons (S5,
still open) block job_scout's kit.

### Mechanics
- **Fixed placements**: placement records gain `fixed: true` — engine refuses move/
  rotate/remove for fixed POs (new engine capability + tests). Everything else about
  the BP is normal (exclusivity, deploy gating, reference model).
- **Free practice cells [ORCH addition, vetoable]**: each starter BP keeps 2–3 empty
  cells so the very first looted PO can be placed/rotated on a safe sandbox without
  waiting for the first owned BP.
- **Power ceiling** (graduation pressure): starter POs have no sockets and no
  connection ports; starter BP `hpMax` is an authored override
  **[TUNABLE 120]** — NOT the 15×cells formula (15×25=375 would out-tank every
  gacha BP and invert the power curve; authored-override capability comes with VX-1's
  `hpMax` field, already live).
- **Grant**: once per profile, same genuine-freshness gate as the Weathervane seed
  (REQ-0042 pattern). Four squads pre-seeded ("Job: Guard" … one job BP each,
  centered) so the first room deploy is 4 clicks.
- **Discard & regrant**: discard = normal BP delete; each job is **re-grantable free,
  once [TUNABLE]** via a claim endpoint — prevents new players bricking themselves;
  further regrants refused (409).
- **Unit-less on purpose** (user design): the first gacha BP (guest Weathervane
  seed covers ~10 pulls) is the deliberate "circuit unlock" beat — REQ-0048's
  mechanics stay invisible until the player holds their first unit.

### Tutorial integration
- Each job gets a **Dex job card** (archetype explanation, suggested formation slot);
  tutorial text lives in Dex, opened via REQ-0052 subwindows at first-touch moments
  (first deploy → job card; first trap survived → Scout card; first unit'd BP →
  Unit chapter). No modal-script tutorial is built or maintained.
- Graduation prompt [ORCH, vetoable]: when a crafted/gacha BP first out-stats a job
  BP on the same squad, surface a gentle "outgrown?" hint on the job squad tab.

### Dual use
The four job canvases are committed to `content/s4_boards/` as S4 reference fixtures
(REQ-0050) — the tutorial loadout and the balance baseline stay the same artifact.

## Test plan (gates before DONE)
- engine: `fixed` flag refusals (move/rotate/remove/transfer), migrateState back-compat.
- server: grant idempotency (files+pg), regrant once-then-409, squad seeding shape.
- sim: none (starter BPs are ordinary content to the sim).
- client E2E: fresh-guest first-run flow (invite → 4 job squads visible → create room
  → deploy 4 squads → run settles → claim), fixed-PO drag refusal UX, discard+regrant.
- S4: inaugural baseline includes the four job boards (REQ-0050).
- i18n: ja names/flavors for jobs and kits.

---

## Implementation log (REQ-0051, 2026-07-14)

Branch: `req-0051-starter-jobs` (worktree; NOT merged, NOT deployed -- integration owner merges/deploys).

### Design decisions ([ORCH proposal, vetoable] unless noted)

- **[vetoable] Fresh-profile board = the four job squads, REPLACING the legacy demo scenario.**
  A genuinely fresh guest is seeded (client boot, `isFreshProfile`, the REQ-0042 pattern)
  with squads 0-3 = Guard/Arms/Mend/Scout + one empty spare squad, plus the existing
  100-LRDST grant. The dev player and every e2e fixture load an explicit saved canvas
  (non-fresh) and never take this path, so the swap is scoped to real new guests. The
  demo scenario (alpha/beta/gamma/delta) was a pre-onboarding placeholder.
- **[vetoable] `fixed` rides ONLY the canvas reference record, not the inventory home.**
  A pinned PO cannot move/rotate on its BP (engine + board UX refuse), but once the job
  squad is discarded the items return to inventory as NORMAL (movable) POs -- no immovable
  orphans. `migrateState` is unchanged (homes stay unpinned; the canvas reference keeps
  `fixed:true` across save/reload).
- **[vetoable] Starter content is isolated in `content/live/starter_items.json` +
  `content/live/starter_jobs.json`, NOT appended to `live_items.json`.** This keeps the
  REQ-0160 registry count-gate (`22 pre-existing + 16` in backfill_content_registry_test)
  and the REQ-0064 dex numbering untouched, and avoids the backfill duplicate-system_name
  rule (lockpick/spyglass are Scout-kit reuse COPIES). `server/lib/content.cjs` merges
  starter items into the served ITEMS + exposes `payload.starterJobs`;
  `server/services/core.cjs` overlays them into the sim defs. Both guarded (absent file =
  none, so the api_test synthetic fixture is unaffected).
- **[vetoable] Kit roster.** Guard: tower_shield (reuse) + bulwark(block) + iron_thorns
  (apply_status Spikes) + hide_wrap(damage_reduction). Arms: training_blade / hand_axe /
  war_pick / sling_stone (every_secs strike; sling has a bounce_budget). Mend: herb_pouch
  (reuse) + poultice(heal_bp) + regen_salve(apply_status Regen) + cleansing_tonic(cleanse).
  Scout: lockpick + spyglass (batch-002 reuse) + probe_lens(detection) + skeleton_key(unlock).
  All socketless + portless (the power-ceiling measure); hpMax authored override = 120
  [TUNABLE]. Placeholder icons pending the S5 icon pipeline (the REQ-noted S5 dependency).
- **[vetoable] Regrant endpoint enforces regrant-only, once per job.** `POST /api/starter/claim`
  {job} -> once per job then 409; the INITIAL 4-job grant is the client boot seed and is
  NOT recorded server-side (mirrors the REQ-0042 LRDST seed). REGRANT_LIMIT=1 [TUNABLE].
  The endpoint returns the job id; the client rebuilds the squad from its own /api/content
  starterJobs copy (the gacha pattern). "squad seeding shape" is proven by the mock tests +
  e2e; the server test proves the ledger/idempotency/parity.
- **[vetoable, DEFERRED] Dex job cards + graduation prompt are NOT built.** The REQ itself
  gates them on REQ-0052 subwindows ("tutorial text lives in Dex, opened via REQ-0052").
  The BINDING troop-play nudge IS shipped as i18n (en+ja) surfaced on the squad-tabs tooltip
  (`squad.starterNudge`); a fixed-lock hint string (`squad.fixedLocked`) is also added.
  A client regrant UI is deferred (the server endpoint + tests stand alone).
- **e2e enablement (worktree-only infra):** `tools/e2e_fleet.cjs` additively overlays the
  worktree starter content into each per-worker `content/live` copy, and
  `client/e2e/local-proxy.cjs` serves `/app/*` from THIS worktree build (the e2e otherwise
  serves the DEPLOYED master client, which lacks every worktree client change). Both are
  scoped, guarded, worktree-only.

### Gate results

- `flock /tmp/backpack_ci.lock bash tools/ci.sh` (SKIP_E2E): **GREEN** -- sim, goldens,
  s4, forecast-parity, mock (105 pass incl. 4 REQ-0051 fixed-PO tests), server tsc,
  engine-type-surface, vocab self-test, api_test **files (166 pass / 1249 asserts)** AND
  **pg (166 pass)**, pg_sync, backfill, content-checks, client typecheck+build. Migration
  `011_starter_claims.sql` applied to the DB before the pg leg.
- e2e (`pnpm run e2e`, PARALLEL=4 -- the gate): **161 passed / 1 failed**. All three
  REQ-0051 tests PASS: (1) fresh guest seeded with the 4 job squad tabs; (2) a fixed
  starter PO stays on its seeded cell after a drag attempt; (3) a job squad discards via
  the squad trash drop.
- The single e2e failure -- `workshop.spec.ts:667` (REQ-0063 dismantle "dismantle-empty")
  -- is a PRE-EXISTING dev-state artifact, NOT caused by REQ-0051: it reproduces in
  E2E_PARALLEL=0 serial mode (which routes to the DEPLOYED API and serves NONE of this
  REQ content), and REQ-0051 touches neither the dismantle picker nor `migrateState`. Root
  cause: the dev profile (data/profiles/dev.json, saved by another session at 01:29 today)
  carries top-level canvas content (1 BP / 1 PO + a store PO); the REQ-0159 dismantle
  fixture clears only the inventory pages, so `migrateState` homes that top-level content
  back into the inventory picker -> it is not empty after the blade is dismantled. Handoff:
  the fixture should also clear top-level `bps/pos` + `presets.store[].pos`, OR the dev
  profile should be reset. Outside REQ-0051 scope.

### Commit hashes (branch req-0051-starter-jobs)

- `00f5860` engine fixed-PO flag (immovable starter kit placements) + mock tests + engine.d.ts
- `6bd05e1` starter-job kit content (starter_items.json + starter_jobs.json) + content.cjs/core.cjs merge
- `ae7b68f` starter-job regrant claim endpoint + ledger (files+pg) + migration 011 + 9 api tests
- `0cc9965` client fresh-profile job-squad seed + fixed-PO UX + i18n nudge
- `de3d370` S4 dual-use -- four job boards as reference fixtures
- `744042a` merge master (REQ-0159 e2e repair + docs); client rebuild
- `c3122d7` e2e coverage + fleet content overlay
- `b5cf2a1` e2e local-proxy serves the worktree /app build

### Final gate re-run (after re-merging current master @ dbf92e3)

Master advanced during the session; re-merged it (commit `cd1e772`), which pulled in
REQ-0172 -- the fix for the order-dependent dismantle seed (it now builds a CLEAN dev
canvas from scratch, clearing top-level `bps/pos` too). That was exactly the earlier
`workshop.spec.ts:667` failure, confirming it was pre-existing and NOT REQ-0051.

- `flock /tmp/backpack_ci.lock bash tools/ci.sh` (SKIP_E2E) on the synced tree: **GREEN** (CI2_EXIT_0).
- e2e (`pnpm run e2e`, PARALLEL=4): **162 passed, 0 failed** -- fully green, including all
  three REQ-0051 tests and the now-fixed dismantle test.

Merge commits: `744042a` (first sync), `cd1e772` (final sync to current master).

---

## Naming rework -- starter jobs -> starter units (user ruling, 2026-07-14)

User ruling (verbatim, JA): 「starter_jobsの意味若干変わってます。現状のシステムの文脈だと、items-fixed-prepopulated-unitという感じになると思います。」
Follow-up (via choice): the implementation STRUCTURE (BP + 4 fixed POs, fresh-profile seed, regrant endpoint) is CORRECT; fix NAMING / model terminology only.

Interpretation: after REQ-0123 (Unit = the character piece a BP carries; connection_shape none = a Unit that forms no links, NOT a BP without a Unit) and REQ-0170 (the live unit/1 registry: elf/dwarf/...), the granted onboarding entity is modelled as a starter unit -- a Unit whose BP is pre-populated with fixed (immovable) items -- NOT a job squad. The word job was a class-system term absent from the current vocabulary.

### Naming mapping (old -> new) [ORCH naming, vetoable]
| old | new |
|---|---|
| starter jobs (concept) | starter units |
| job_guard / job_arms / job_mend / job_scout | starter_guard / starter_arms / starter_mend / starter_scout |
| bp_job_* / po_job_*_N | bp_starter_* / po_starter_*_N |
| Job: Guard ... (display) | Starter: Guard ... ; ja ジョブ：X -> スターター：X |
| starter_jobs.json (schema starter_jobs/1) | starter_units.json (schema starter_units/1) |
| top-level array jobs | units |
| content/s4_boards/job_*.json | content/s4_boards/starter_*.json (bp id bp_starter_*) |
| payload starterJobs ; GameData.starterJobs | starterUnits |
| ApiStarterJob / ApiStarterJobPO / ApiStarterJobs | ApiStarterUnit / ApiStarterUnitPO / ApiStarterUnits |
| STARTER_JOB_IDS ; buildStarterJobsState | STARTER_UNIT_IDS ; buildStarterUnitsState |
| POST /api/starter/claim body {job}; resp jobs/job | body {unit}; resp units/unit |
| client/e2e/starter-jobs.spec.ts | client/e2e/starter-units.spec.ts |
| i18n fixedLocked Starter-job.../スタータージョブ.../ジョブ・スカッド | Starter-unit.../スターターユニット... |
| pre-pivot unit-less 5x5 BP prose | 5x5 BP, connection_shape none |

KEPT (concept-neutral, deliberately NOT renamed): endpoint path /api/starter/claim[s]; files server/routes/starter.cjs, server/storage/starter.cjs, server/tests/api/starter.cjs; table starter_claims + STARTER_CLAIMS_DIR; i18n keys squad.starterNudge and squad.fixedLocked; content/live/starter_items.json (the fixed items); the engine fixed flag. Kit item ids (tower_shield, bulwark, ...) were already generic and unchanged. The REQ doc filename and branch keep the legacy starter-jobs slug (matches the branch the integration owner merges) [vetoable].

### Persisted-data safety
The feature never shipped (built/, never on master), so NO production profile references the old content ids, the claims-ledger doc keys, or the endpoint param -- the renames need NO data migration (conservative-but-clean route: full rename, no legacy alias). The starter_claims table has no job column (the ledger is a jsonb doc keyed by the unit id), so the SQL is a renumber-only change with no column rename.

### Migration renumber
Master advanced during the run: REQ-0058 (Sealed Seed Share) landed 011_sealed_seeds.sql. This branch 011_starter_claims.sql was renumbered to 012_starter_claims.sql and current master was re-merged, so the migration dir is contiguous (...010, 011_sealed_seeds, 012_starter_claims). Re-applied to the pg test DB (idempotent CREATE IF NOT EXISTS).

### REQ-0170 integration (forced by the master re-sync) [vetoable]
REQ-0170 (merged to master during this run) made BP.unit ({id, off} keying live_units.json) MANDATORY and removed the old BP.linker/{dirs}. The starter seed was adapted so the branch builds: each starter BP now carries unit {id: berserker, off: [0,0]} -- berserker is the SOLE connection_shape:none unit in live_units.json, which preserves REQ-0051 no-synergy / power-ceiling intent (no link rays). Updated linker -> unit in: content/live/starter_units.json, the four content/s4_boards/starter_*.json, ApiStarterUnits (shared/dto.ts), and buildStarterUnitsState (client/src/store/boot.ts).
NOTE [vetoable]: all four starters currently share the one none-shape unit (berserker); the integration owner / user should refine the starter <-> unit-registry pairing (author dedicated starter units, or map Guard/Arms/Mend/Scout to thematically-fitting none-shape units) as a follow-up. This wiring was REQUIRED to build REQ-0051 against current master and is a merge-integration stopgap, not a naming choice.

### Gates (post-rework, on the re-synced tree @ current master)
- flock /tmp/backpack_ci.lock bash tools/ci.sh (SKIP_E2E): GREEN (CI_EXIT=0). api_test 175 passed on BOTH files AND pg backends (renamed endpoint: resp units/unit, once-per-starter-unit, ids starter_guard...); mock fixed-PO tests; backfill_content_registry_test 11 passed (REQ-0160 registry count-gate untouched); content-checks; client typecheck+build.
- e2e (client, E2E_PARALLEL=4): 163 passed, 0 failed (3.1m). All three renamed specs pass: client/e2e/starter-units.spec.ts (fresh-guest four starter-unit tabs Starter: Guard...; fixed-PO drag refusal; starter-unit discard).

### Commits
- 866e883 rename starter jobs -> starter units
- 8933921 migration renumber 011 -> 012_starter_claims.sql
- ed447c5 re-sync current master (REQ-0058 sealed_seeds / REQ-0173)
- (final) REQ-0170 BP.unit adaptation + web/app rebuild + this gate record

### Integration-owner merge + deploy (wave 3 -- 2026-07-14)
Merged and deployed to master by the integration owner (user go-ahead 2026-07-14).
- Merge: `26ada1c` "Merge req-0051-starter-jobs" (`--no-ff`, into master @ `8963278`). CLEAN -- no conflicts (the 3 master commits since the branch last synced touched only `docs/REQ/*`).
- Post-merge sanity: server+shared `tsc -p tsconfig.server.json` OK; `server/tests/api/starter.cjs` PASS on BOTH the files and pg backends.
- Migration `012_starter_claims.sql`: already present in the deploy DB (idempotent `CREATE TABLE IF NOT EXISTS` + GRANT); verified `to_regclass('public.starter_claims')` present -- no re-apply required.
- Full gate: `flock /tmp/backpack_ci.lock bash tools/release.sh` -> CI GREEN. api_test 175 passed x2 backends; dist rebuilt + committed `239ca7b`.
- Deploy: restarted `backpack-api` + `backpack-web` (both active); HTTP 200 on 8801 `/app/` and 8802 `/api/health`.
- e2e (all via the sanctioned wrapper `pnpm run e2e`, box-locked):
  - pre-deploy (release ci, local ingress, fresh dist): 164 passed / 0 failed (3.1m).
  - post-deploy (restarted services, local ingress): 164 passed / 0 failed (3.0m).
  - live public tunnel (https://backpack-dev.qtie.jp): 164 passed / 0 failed (13.1m).
  `starter-units.spec.ts` PASS 3/3 in every run (fresh-guest four starter squads; fixed-PO drag refusal; starter-unit discard).
- Final master hash after deploy: `239ca7b`.
- Follow-up (NON-blocking, `[vetoable]` -- see the REQ-0170 integration note above): all four starters currently share the sole none-shape unit `berserker`; refine the starter<->unit pairing (author dedicated starter units, or map Guard/Arms/Mend/Scout to thematic none-shape units) as a follow-up. Recorded merge-integration stopgap, not a naming decision; does NOT block done.
