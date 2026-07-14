> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0058 — Sealed Seed Share (同一スケジュール共有)

- **Status**: ADOPTED WITH USER REDESIGN (2026-07-06) — implementation QUEUED
- Origin: brainstorm batch 2 item 11 (ghost racing). User's redesign: **only seeds
  that have NEVER been run are shareable** — "share the same schedule with friends".
  Rationale ties to the item-12 rejection: anyone who has SEEN a seed run gains a
  counter-pick advantage; sealing removes it. Grudge Rematch (12) stays REJECTED.

## User spec
「ランがまだ実行されたことがないSeedはシェア可能にすることで同機能に対応します。
(フレンドに同スケジュールを共有機能)　リンカーは無関係でgreen。」

## Design
- **Sealed schedule token**: `POST /api/schedule/seal` mints
  `{dungeonType, level, genSeed, affixes(REQ-0055), sealId}` with a SERVER-generated
  seed (bypasses nothing: REQ-0043's admin-only custom-seed gate is untouched —
  sealing always mints fresh, so no caller ever supplies a seed).
- **Sealing invariant**: a seed is shareable IFF it has zero runs at mint time —
  guaranteed by construction (freshly minted, never exposed before sealing).
  The sealed tuple is frozen; recipients' rooms copy it verbatim.
- **Share**: link/token to friends (invite-auth scale); each participant may run a
  given sealId **once** [TUNABLE 1]; the run is otherwise a normal scheduled run
  (rewards, cooldowns, warehouse — no special economy).
- **Anti-spoiler visibility [ORCH default, vetoable]**: replays/results of OTHER
  participants' runs of a sealId are hidden from you until YOUR run of it settles
  (then everything unlocks). Consistent with the "?"-masking philosophy: spectators
  must not see answers before the troop — here, before themselves.
- **Comparison view** (post-settle): side-by-side timelines per participant —
  clear time, finishing H, per-encounter durations, damage taken, attachments
  resolved (REQ-0049), with links into each replay. Chimes (REQ-0059) make the
  side-by-side audible for flavor.
- Storage: `sealed_seeds` table/file (files+pg parity, storage.cjs chokepoint rule);
  participant run registry keyed (sealId, playerId).
- **Not built**: leaderboards beyond the participant set, global discovery, rewards
  for "winning" a comparison — friendly benchmarking only, per retention philosophy
  (no appointments, no pressure).

## Test plan
- server: seal mint freshness-by-construction, one-run-per-participant 409, copy
  fidelity (tuple byte-equal across rooms), visibility gate (403/masked until own
  settle), files+pg parity.
- sim: none (ordinary runs).
- E2E: seal → share → two guests run → masked-until-settle → comparison view.

---

## Implementation log (2026-07-14)

Implemented end-to-end on branch `req-0058-sealed-seed-share` (worktree off master).
NOT merged/deployed (integration owner handles that).

### API surface (server/routes/schedule.cjs)
- `POST /api/schedule/seal` — mint. Body `{dungeonId?, dungeonType?, level?, affixes?}`.
  Server always mints a FRESH `genSeed` (crypto); any caller-supplied seed is
  ignored, so REQ-0043's admin-only custom-seed gate is neither invoked nor
  bypassed. Returns `{ok, seal: <public meta, genSeed withheld>, shareToken:sealId}`.
- `POST /api/schedule/rooms {sealId}` — join a sealed run. The room copies the
  frozen tuple (`dungeonType/level/genSeed/affixes`) verbatim, carries `sealId`,
  and is single-shot (runs.cjs `maybeAutoStartNextRun` never re-arms a sealed
  room). One room per `(sealId, playerId)` — a second attempt is `409`
  (`reason:seal_already_joined`).
- `GET /api/schedule/seals/:sealId` — public seal meta + participation status.
- `GET /api/schedule/seals/:sealId/comparison` — anti-spoiler-gated comparison.
  Non-participant → `403` (`seal_not_participant`). `unlocked:false` (other
  participants withheld) until the caller's OWN run of the seal settles; then
  `unlocked:true` reveals every participant's timeline (result, clearTimeSecs,
  finishingH, per-encounter durations, damageTaken, attachmentsResolved).
- `GET /api/schedule/seals/:sealId/runs/:playerId` — seal-scoped replay. Own
  always readable; another participant's is gated on the caller's own settle
  (`403 seal_replay_locked`).

### Storage (files+pg parity through storage.cjs chokepoint)
- `server/storage/seals.cjs` + roots in `storage/lib.cjs`:
  `data/schedule/sealed_seeds/<sealId>.json`, `data/schedule/seal_runs/<sealId>__<playerId>.json`.
- `server/migrations/011_sealed_seeds.sql`: `sealed_seeds(seal_id,doc,created_at)`,
  `seal_runs(seal_id,player_id,doc,updated_at)` composite PK. Applied to the dev DB.

### [ORCH default, vetoable] decisions
1. **affixes**: REQ-0055 is still draft/unimplemented, so `affixes` is a FROZEN
   passthrough `string[]` (default `[]`) with no gameplay effect yet — it carries
   the tuple shape REQ-0055 will later populate and is copied verbatim into every
   recipient's room.
2. **genSeed withheld from clients**: `POST /seal` and `GET /seals/:id` return the
   public meta WITHOUT `genSeed`. Recipients never handle the raw seed (the server
   copies it into their room server-side), preserving REQ-0043's "no caller ever
   handles a seed" spirit.
3. **One ROOM per participant (not merely one settled run)** [TUNABLE 1]: because
   the combat seed is re-rolled per run, allowing a re-created sealed room would let
   a participant re-roll the outcome and defeat the fair-benchmark point — so a
   participant's single sealed room IS their one attempt (a sealed room is
   single-shot and ends `canceled` after its one run settles).
4. **Anti-spoiler is per-viewer**: the comparison/replay unlock is keyed to the
   VIEWER's own settle, independent of whether other participants have settled
   (consistent with the "?"-masking philosophy: never see answers before yourself).
5. **Comparison metric `damageTaken`**: derived by attributing `ray_hit`/`ray_aoe`/
   `ray_hit_all` amounts under a `ray_fire` whose target field is the troop
   (`field==='player'`), a deterministic, symmetric benchmark number across
   participants running the same sealed layout.
6. **Client e2e**: the box serves the DEPLOYED static bundle (never a worktree
   dist), so a pre-deploy UI-render test cannot pass; SealPanel compile-correctness
   is covered by the client build gate, behavior fully covered API-side (the fleet
   backend is this worktree's own api.cjs under `E2E_PARALLEL>=1`).

NOT built (per spec): leaderboards beyond the participant set, global discovery,
rewards for "winning" a comparison.

### Gate results
- `flock /tmp/backpack_ci.lock bash tools/ci.sh` (SKIP_E2E=1, DATABASE_URL set):
  **GREEN** — sim/goldens/S4/forecast-parity, typecheck (server+shared), engine
  type-surface, vocab, server api tests **files+pg** (166 passed / 0 failed, 1302
  assertions each backend), pg_sync, backfill, content-check dialects, artwork/
  queue/inspection/content pg suites, client unit-icon + link-trace, client
  typecheck+build.
- Full `flock /tmp/backpack_ci.lock bash tools/ci.sh` (e2e enabled, E2E_PARALLEL=4):
  **157 passed, 10 failed** — every failure in the ACCOUNTED tolerated set
  (artadmin 38/113/147, artinspect 21, contentadmin 57/171/203 [403-by-design +
  numpy-missing render env], dex-card 65, nav-routing 26, schedule 1065). No
  unaccounted failures; none caused by this change. The listed parallel-flake
  candidates (forecast 41, warehouse-mjolnir 203, landing 115, guest-auth 83,
  dex 280) all PASSED this run.
- NEW e2e `client/e2e/seal.spec.ts` (test #107): **PASSED** — seal → share →
  second player runs once → anti-spoiler hold → comparison unlocks after own
  settle; duplicate-run 409; seal-replay gate.

### Commit hashes (branch req-0058-sealed-seed-share)
- `4d236de` REQ-0058: Sealed Seed Share (server + client source + tests + migration)
- `b443096` Merge branch 'master' (synced to master b53bc36)
- `1b391a8` REQ-0058: dist rebuild (web/app)
- `99615c6` REQ-0058: e2e -- drop pre-deploy UI-render smoke

---

## Merge & deploy record -- integration owner (2026-07-14)

Merged, deployed, and live-verified on master. The REQ records no open
user-acceptance / S7 gate (the [ORCH default, vetoable] design decisions above
remain vetoable -- a later user veto would reopen the REQ per normal board flow --
but none is an open acceptance gate), so this REQ moves **built -> done** in the
following commit, mirroring the sibling UI REQs 0168/0100/0169.

- **Merge**: git merge --no-ff of req-0058-sealed-seed-share onto master 6479b1b
  -> merge commit **d51b1d6** (git merge-tree verified conflict-free against
  post-0170/0168/0100/0173 master; the only auto-conflicts were the web/app dist,
  resolved to master and rebuilt below). The two source unions were resolved in
  the branch own master-merge (**59bf207**): client/src/i18n/schedule.ts (seal.*
  keys UNION REQ-0168/0100 schedule keys) and client/src/schedule/SchedulePage.tsx
  (SealPanel UNION REQ-0100 SpoilsRail, both inside schedule-spoils-col).
- **Migration**: 011_sealed_seeds.sql kept AS-IS -- master migrations topped out
  at 010, so 011 was already the next free number (NO renumber needed). Tracking
  is by table existence (there is no schema_migrations table); the dev/live DB
  already carried sealed_seeds + seal_runs with schema byte-matching the migration,
  so the deploy needed no migration step. NOTE for a future owner: the unmerged
  req-0051-starter-jobs branch also numbered its migration 011
  (011_starter_claims.sql) and applied it to the dev DB -- it MUST renumber to 012
  before its own merge. No tracking-record reconciliation is needed (no tracking
  table); its starter_claims table already exists in the DB.
- **Release**: flock /tmp/backpack_ci.lock bash tools/release.sh -> **CI GREEN**
  (literal green; REQ-0159 retired the accounted-failure convention). Admin e2e
  harnesses artadmin 4/4 + art_inspect + content_admin green; default e2e suite
  **160 passed / 0 failed** (159 baseline + seal.spec.ts). Dist committed
  **c1d3726**.
- **Restart**: systemctl --user restart backpack-api backpack-web -> both active;
  HTTP **200** on /app/ (web 8801), /api/health and /api/schedule/dungeons
  (api 8802).
- **Post-deploy e2e (live)**: bash tools/e2e_run.sh e2e/seal.spec.ts against the
  live services (public-tunnel baseURL, live backpack-api) -> **1 passed**, EXIT=0
  (seal -> share -> second player -> anti-spoiler hold -> comparison unlock;
  duplicate-run 409; replay gate -- all green live).

Final master after deploy: **c1d3726**. Services active. No unaccounted reds.
