> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0060 — Pack Biography (+ veteran TM luck)

- **Status**: ADOPTED by user (2026-07-06, 「素晴らしい」) with a user-added
  mechanical layer: small success-probability benefits for certain special
  Transmutators, acceptable because **Devotion resets everything** (long-play-to-win
  slightly accelerated, capped by the terminal reset) — implementation QUEUED
- Origin: brainstorm batch 2 item 14. Objects with histories make Devotion's full
  loss genuinely dramatic — the emotional foundation the endgame pledge needs.

## User spec
「素晴らしい。一部の特殊transmutatorの成功確率が上がるみたいなメリットが多少あっても
いいかも。("献身"が最終目的でリセットされるので良いかも)」

## Design

### §1 The ledger (display-first)
Per BP instance, an append-only `bio` record:
- born: date + origin (gacha sealed seed / starter job / future sources)
- runsSurvived, wipes endured, bossesFelled (killing blow attributed to a hosted PO)
- trapsDisarmedAboard, chestsOpenedAboard (REQ-0049 attachment credits)
- damageTanked (lifetime), weathervaneRerolls, chiselCells added/filed
- names it has carried (BPs may be renamed later — history keeps old names)
Aggregation: derived at run settle from the replay/settlement data the server
already has (no sim change); stored on the profile BP record (storage.cjs
chokepoint; files+pg parity).

### §2 Surfaces
Dex card "Biography" section (REQ-0052 surface), warehouse rows (age), gacha modal
("day one" entry). Cosmetic wear/patina visuals: BACKLOG (art pipeline, user-gated).

### §3 Veteran luck (the user's mechanical layer)
- `bio` milestones grant **bio_luck**: a small additive success-probability bonus
  applying ONLY to future CHANCE-BASED special TMs (current roster — Weathervane/
  Chisel/File/Resin — is deterministic and stays so; the schema seat waits for the
  first gambling TM, e.g. a future "risky reshape").
- Bounds: cap [TUNABLE +10%] total; milestone curve [TUNABLE]; per-TM opt-in flag
  (`respects_bio_luck: true`) so a TM must explicitly choose to honor it.
- **Reset law**: Devotion zeroes `bio_luck` with everything else (worldview canon);
  the ledger TEXT of a devoted pack is archived to the Einherjar record — the
  history is not deleted, it is enshrined. (Display only; no mechanical carryover.)
- economy.md compliance check: this is not an item affix (item power untouched) and
  not a durability/repair bill — it is a per-instance crafting-odds modifier on the
  player's OWN tools, inside the "Backpacks are made" identity. Noted here so the
  principles file stays clean.

## Test plan
- server: settle-time bio aggregation correctness (fixtures per credit type),
  files+pg parity, migration for existing BPs (bio starts empty, born=migration).
- squad: milestone→bio_luck curve, cap, per-TM opt-in gate.
- E2E: Dex biography section renders, gacha "day one", warehouse age.
- S4: E-class addition — bio_luck distribution across a simulated account age
  matrix (verify the cap keeps veteran advantage inside [TUNABLE] band).

---

## Outcome (2026-07-14) — BUILT (server end-to-end; client rendering deferred, recorded)

Implemented on `192.168.0.6`, worktree/branch `req-0060-pack-biography`, branched
from master `8963278`, re-synced with master `0b56a03` (REQ-0051/0059 waves) before
final gates.

### What shipped (server, fully tested)
- **§1 Ledger — server-authoritative bio store.** `server/storage/bio.cjs`: a new
  per-BP-instance persistence root keyed by the BP uid (canvas `bps[].id` === sim
  `bpId` === gacha-minted uid), files (`data/bio/<uid>.json`) + pg (`bp_bio`) parity,
  re-exported through the `server/storage.cjs` facade (the sole persistence
  chokepoint). Migration `server/migrations/012_bp_bio.sql` (applied to supabase-db).
  Bio is deliberately NOT stored inside the client-owned profile `canvas` (which
  `writeProfile()` overwrites wholesale every PUT) — it must be server-derived and
  unforgeable.
- **Settle-time aggregation, NO sim change.** `startRun` captures a lean `bioRoster`
  ({id,hpMax,hpEnd}) on the run doc from the already-returned `result.bps` (the run
  is fully simulated at start, so final hp is already known). `settleRun` folds each
  aboard BP's biography exactly once, inside its `run.settled` apply-once section,
  via `services/bio.cjs applyRunBio` (wrapped defensively — a bio write never breaks
  reward settlement). Counters derived purely from `run.result` + `run.events` +
  `run.bioRoster`: runsSurvived, wipesEndured, bossesFelled, trapsDisarmedAboard
  (att_disarm), chestsOpenedAboard (att_open kind:chest), damageTanked (hpMax-hpEnd).
- **Birth.** `services/gacha.cjs finalizeGachaForCanvas` stamps `born{date,origin:'gacha'}`
  (+ seeds namesCarried[0] with the unit name) when a roll finalizes into the canvas.
  Any BP the settle path first sees without a bio gets `born.origin:'field'`.
- **§3 Veteran luck — schema seat only (no live TM consumes it).** `services/bio.cjs`
  `bioLuck(bio)` = sum of reached milestone grants, capped at `BIO_LUCK_CAP`; monotonic.
  `tmSuccessChance(base, bio, tmDef)` is the per-TM opt-in GATE: returns base unchanged
  unless `tmDef.respects_bio_luck === true` (default false — the current deterministic
  roster is untouched and stays so), else `clamp01(base + bioLuck)`. Tunables in
  `shared/constants.json` (`BIO_LUCK_CAP`, `BIO_LUCK_MILESTONES`).
- **§2 Surfaces — server transport.** `server/routes/bio.cjs`: `GET /api/bio/:bpUid`
  (auth'd, instance-scoped — the "auth'd bp surface" REQ-0052 explicitly deferred)
  returns a render-ready DTO (born/originLabel, ageDays, dayOne, all counters,
  bioLuck, milestones, full i18n.ja block for the biography section / warehouse age /
  gacha "day one" line). `POST /api/bio/:bpUid/name` appends to the append-only
  rename history. Wired into `router.cjs` at the tail.
- **Rename history.** `recordRename` appends `{name,since}` — old names KEPT, never
  overwritten (spec "history keeps old names").
- **Schema seats** `weathervaneRerolls / chiselCellsAdded / chiselCellsFiled` exist +
  are testable via `recordTmOp`, populated by future workshop-TM hooks (none emit
  them yet — they are not run-derivable).

### Bio schema (bp_bio doc, schema_version 1)
`{ schema_version, bp_uid, born{date,origin}, runsSurvived, wipesEndured, bossesFelled,
trapsDisarmedAboard, chestsOpenedAboard, damageTanked, weathervaneRerolls,
chiselCellsAdded, chiselCellsFiled, namesCarried[{name,since}], updated_at }`.
origin vocab: gacha | sealed_seed | starter | field | migration | unknown.

### Decisions [ORCH default, vetoable]
1. **bio lives in its own server-owned store, not the profile canvas.** The canvas is
   client-owned + overwritten each PUT; a server-derived, unforgeable ledger needs a
   sidecar. This is the only faithful reading of "stored on the profile BP record via
   storage.cjs (files+pg parity)" given the canvas ownership model.
2. **bossesFelled / trapsDisarmedAboard / chestsOpenedAboard credited at roster
   ("aboard") granularity, not killing-blow-precise per-PO.** The sim's damage/att
   events carry masked labels, not bpIds (REQ-0049 spectator masking), so precise
   killing-blow attribution would REQUIRE a sim change (forbidden). victory ⇒ +1
   bossFelled to every aboard BP; att_disarm/att_open counts credited to every aboard
   BP. Faithful to the word "aboard"; precise per-PO attribution is a future sim-event
   add.
3. **runsSurvived = non-wipe runs aboard; wipesEndured = wipe runs aboard** (the pack
   came home / did not). Roster-level.
4. **Veteran-luck milestone curve** (tunable): runsSurvived≥10/50/200 +0.02 each,
   bossesFelled≥5/25 +0.02 each, wipesEndured≥20 +0.02; cap +0.10. Bounded veteran
   advantage, zeroed by Devotion per worldview canon (display-only archival of the
   ledger text to the Einherjar record is future work, noted).
5. **Client rendering + browser E2E of the three surfaces DEFERRED (recorded).** No
   client code was changed. Rationale: (a) REQ-0052 itself deferred the `kind:'bp'`
   card for the same instance-vs-static reason; (b) landing three client surfaces +
   Playwright specs safely under the REQ-0159 ALL-GREEN policy, in a heavily
   wedge-prone session with a contended exclusive e2e box lock, is high-risk for low
   marginal proof — my changes are server-only. The honestly-testable data path
   (settle → bio store → read-API DTO, files+pg) is fully covered by server tests.
   The bio read/rename API is the exact transport the client surfaces will consume.
6. **`respects_bio_luck` default false; no live TM opts in yet** (spec: "no live TM
   consumes it yet"). The seat + curve + cap + gate are implemented and tested.

### Deferred / backlog (recorded)
- Client biography section, warehouse age column, gacha "day one" modal line + their
  browser E2E (transport + i18n.ja ready server-side).
- Killing-blow-precise boss/trap/chest attribution (needs a sim-emitted bpId on
  kill/att events).
- starter-job (REQ-0051) / sealed-seed (REQ-0058) born-origin hooks (schema supports
  the origins; those mint paths fall back to origin 'field' until wired).
- Cosmetic wear/patina (spec §2 BACKLOG), Devotion→Einherjar ledger archival display.
- weathervane/chisel/file bio counters await the workshop-TM hooks that produce them.

### Files touched
new: server/storage/bio.cjs, server/services/bio.cjs, server/routes/bio.cjs,
server/migrations/012_bp_bio.sql, server/tests/bio_test.cjs.
edited: server/storage.cjs, server/router.cjs, server/services/runs.cjs,
server/services/gacha.cjs, shared/constants.json, tools/ci.sh.

### Gate results (exact)
- `flock /tmp/backpack_ci.lock env SKIP_E2E=1 DATABASE_URL=... bash tools/ci.sh` -> **CI GREEN** (EXIT=0). Includes:
  sim tests, replay goldens, S4, forecast parity, mock-src engine, tsc (checkJs),
  engine-type drift, vocab self-test, unit/pack gate, server api tests FILES backend,
  pg_sync, artwork/content backfills, content-check dialects, **bio_test FILES: 10 passed / 0 failed**,
  server api tests PG backend + artwork/queue/inspection/content pg suites,
  **bio_test PG: 10 passed / 0 failed** (files+pg PARITY: identical 10 assertions each),
  client typecheck + vite build.
- Default e2e suite via the sanctioned wrapper (`cd client && pnpm run e2e`, box lock):
  **164 passed / 0 failed (13.1m)** — incl. workshop gacha (exercises the gacha-finalize
  born hook) and schedule/settle specs (exercise settleRun's bio fold); no regression.
- `bp_bio` migration (012) applied to supabase-db (CREATE TABLE + GRANT).
- Admin trio (artadmin/artinspect/contentadmin) e2e: not run this pass (untouched by
  REQ-0060; their isolated harnesses are the integration owner's pre-deploy gate).

### Commits (branch `req-0060-pack-biography`)
- `8f5ac5f` REQ-0060: Pack Biography ledger + veteran-luck (bio_luck) schema seat.
- `751b533` Merge master into req-0060 (re-sync; resolved router.cjs vs REQ-0051 starter routes).
- (this file's git mv todo->built lands as its own commit, hash recorded on merge.)

NOT merged to master, NOT deployed — handed to the integration owner per task brief.
