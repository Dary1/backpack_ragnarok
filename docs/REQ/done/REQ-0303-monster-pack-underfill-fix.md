# REQ-0303 — Monster-pack underfill fix (10 packs -> >=30% formation fill)

**Status:** built — implemented on branch `req-0303-monster-pack-underfill-fix`, all gates green,
NOT merged/deployed (folder is authoritative; this line is a convenience).
**Reserved:** 2026-07-24 · **Slug:** monster-pack-underfill-fix · **Requested by:** user, 2026-07-24 (chat).
**Depends on:** REQ-0298 (the formation-fill inspector + advisory gate), REQ-0300 (the 30% admincontent
warning; confirmed the params: *boss + entourage, add to >=30%*), REQ-0301 (goldens decoupled to a frozen
fixture, so editing live packs is golden-safe), REQ-0299 (landed: monster-pack flavor skills — the last
blocker; base master `30b5a31`).

## Why this REQ exists
REQ-0298/0300/0301 repeatedly deferred "the pack-FIX" as a separate REQ: *adding monsters to the 10
monster_packs that fill < 30% of the enemy placeable area, and flipping the advisory formation-fill gate to
hard.* REQ-0301 removed the last technical blocker (goldens are now a self-owned frozen fixture, so content
edits no longer force a golden rebaseline) and REQ-0299 landed. This REQ is that fix.

## The rule (ratified, from REQ-0298/0300)
A monster_pack is INVALID if its formation fills < **30%** (`FILL_MIN`) of the placeable area. Placeable =
`(FIELD_COLS-2)*(FIELD_ROWS-2)` = 24x16 = **384** cells (B2:Y17). A member occupies its enemy footprint
`[h,w]` = h*w cells; `fillFrac = sum(h*w) / 384`. Pass iff `fillFrac >= 0.30` (>= **116** cells). GIMIC is a
different kind and is naturally exempt.

## Scope (user decisions, 2026-07-24 chat)
- **All 10** sub-30% packs (user chose "10 packs 全部"), including the 4 batch-002 frost packs that overlap
  REQ-0206 (REQ-0206 remains a separate art-link concern; this REQ only adds members).
- **Execute end-to-end**, user reviews at built ("任せて実装、builtで確認").
- **Existing enemies only** (no new art — art is queue-only/user-owned).
- **No frost-theme uniformity** required (user, 2026-07-24) — frost packs may use large cross-batch bodies.
- **Stops at built/** — merge/deploy is hands-off (PROJECT.md); coordinate separately.

## What was done — final compositions (re-laid-out via first-fit; all validated by
`shared/content_validate.cjs`, all non-overlapping and inside B2:Y17)

| pack | final composition (enemy x count) | cells | fill | members |
|---|---|---|---|---|
| pack_frost_scouts | frost_giant x3 (boss), frostback_bear x6, frost_gnoll x2, ice_archer x2, rime_shaman x1, glacier_wisp x1, niflheim_stalker x1 | 121 | 31.5% | 16 |
| pack_rime_choir | frost_giant x3 (boss), frostback_bear x5, rime_shaman x3, glacier_wisp x3, ice_archer x2 | 118 | 30.7% | 16 |
| pack_bear_and_stalker | frost_giant x3 (boss), frostback_bear x7, niflheim_stalker x5 | 123 | 32.0% | 15 |
| pack_hrimgrimnir | hrimgrimnir x1 (boss), frost_giant x3, frostback_bear x5, niflheim_stalker x3, ice_archer x3 | 125 | 32.6% | 15 |
| pack_grave_shamble | zombie x5, mummy x2, ghost x2, lich x1 (boss) | 128 | 33.3% | 10 |
| pack_grave_legion | skeleton_warrior x3, wight x2, zombie x2, necromancer x1, ghost x1, lich x1 | 128 | 33.3% | 10 |
| pack_wild_hunt | alpha_werewolf x2, dire_wolf x2, boar x2, giant_bat x2 | 120 | 31.3% | 8 |
| pack_venom_nest | basilisk x2, giant_spider x3, giant_scorpion x2, giant_snake x1 | 124 | 32.3% | 8 |
| pack_petrifying_court | stone_golem x2, medusa x2, cockatrice x3, lamia x1 | 124 | 32.3% | 8 |
| pack_greenskin_warband | ogre x2, orc_warrior x3, goblin x1, kobold x1, goblin_shaman x1, troll x1 | 124 | 32.3% | 9 |

Each pack keeps its id, name, i18n, powerLevel and note; only `members` changed. The 6 non-frost packs use
their own batch's roster (a clean boss + entourage). The 4 frost packs use `frost_giant[6,5]=30` (batch-007)
as the boss body — see the frost note below.

## Pipeline (how the edit stays lossless)
`content/live/dungeon/packs.json` is an additive-promoted file (REQ-0122): batch-002 base packs byte-verbatim
at the head, then batch-005/006/007 layers. So each pack was edited in BOTH its batch source AND live,
identically. The REQ-0122 invariant checks: live packs.json sha == the LAST additive-layer sha (re-stamped in
`registry.json` line 260, the batch-007 layer, `764c77..` -> `97c9403..`), live entry-ids == base ++ layer
ids (unchanged — members added, no packs added/removed), and live starts with the batch-002 source bytes
verbatim (the 4 frost packs are edited identically in source + live, so the head still matches).

## Key discoveries / decisions
- **Frost packs use frost_giant (user waived frost-theme uniformity, 2026-07-24).** batch-002's own largest
  body is `frostback_bear[2,2]=4` (there is NO large frost boss in batch-002), so an all-batch-002 fill to
  >=30% needs ~34 members (mostly bears). The user waived theme uniformity, so the 4 frost packs now use
  `frost_giant[6,5]=30` (batch-007) as the boss + a frostback_bear/scout entourage (~15-16 members each).
  Because a batch-002 pack now references a cross-batch body, the `sim/tests/run.cjs` tests that RUN the
  batch-002 Niflheim dungeon (full-run smoke, REQ-0042 x2, REQ-0292) were pointed at the LIVE roster
  (`liveEnemyDefsById`/`liveSkillDefsById`) — the roster the file's own header note already prescribes for
  dungeon-running tests — instead of batch-002-only. Their assertions are loose (legal terminal state, reward
  ranges, cadence structure, valid JSONL) and stay green.
- **Gate flipped to HARD.** `tools/ci.sh` step [3.996/7]: `inspect_pack_formation --advisory` ->
  `--gate` (exit 1 if any monster_pack < 30%). Now green (14/14).
- **Geometry tests reconciled.** req0203/0207/0219 pin each authored layout's derived cell-ranges; the
  `expected` maps for the 6 non-frost packs were updated to the new placements. The frost packs have no
  geometry test.
- **Seed re-pick (req0203).** The G2 "real content" test runs `pack_grave_legion` under a fixed seed and
  asserts heal_ally/lifesteal/bonus_vs_status all fire. Growing the pack shifted the deterministic RNG, so the
  seed was re-picked (`req0203-legion-fixed` -> `-6`, verified) — same intent, new composition.
- **powerLevel marker left DIRTY (correct).** `registry.powerlevel_calibrated_from.packs.json` was
  deliberately NOT re-stamped, so `autobalance_pack_powerlevel.cjs --check` correctly reports DIRTY — the
  deploy pre-hook re-emits powerLevel for the changed content (REQ-0297). Not a ci.sh gate; out of scope here.
- **CONTENT_ROOT for worktree gates.** `dungen.liveDungeonDir()` resolves via `os.homedir()` to the MAIN
  checkout unless `CONTENT_ROOT` is set. Content-reading gates were run with
  `CONTENT_ROOT=<worktree>/content`; goldens is fixture-based and run WITHOUT it.

## Gate results (worktree, 2026-07-24; node via nvm)
Run content gates with `CONTENT_ROOT=$PWD/content`; goldens without.

| gate | result |
|---|---|
| `tools/inspect_pack_formation.cjs --gate` | **GATE OK: all 14 packs >= FILL_MIN** (0 fail) |
| `tools/inspect_pack_formation.cjs --self-test` | OK |
| `sim/tests/run.cjs` (CONTENT_ROOT) | **184 passed, 0 failed** (incl. REQ-0122 lossless invariant) |
| `sim/tests/goldens.cjs` (no CONTENT_ROOT) | **byte-identical** (12 cases) |
| `sim/tests/req0203_grave_legion_test.cjs` | 15 passed, 0 failed |
| `sim/tests/req0207_wildlands_test.cjs` | 13 passed, 0 failed |
| `sim/tests/req0219_deepstone_test.cjs` | 13 passed, 0 failed |
| `sim/tests/req0298_pack_formation_test.cjs` | 6 passed, 0 failed |
| `server/tests/content_checks_dialect_test.cjs` | 69 passed, 0 failed |
| `tools/check_scaling_coverage.cjs --gate` | OK (total coverage) |
| `STORAGE_BACKEND=pg server/tests/api_test.cjs` (CONTENT_ROOT; worktree-namespaced, hermetic) | **194 passed, 0 failed** |

## Commits (branch `req-0303-monster-pack-underfill-fix`, base master `30b5a31`)
- `f2a1396` docs: reserve REQ-0303
- `505b1ba` feat(REQ-0303): fill 10 sub-30% monster_packs to >=30% formation (live + batch sources + registry sha)
- `8da7308` feat(REQ-0303): flip formation-fill gate to HARD + reconcile geometry maps + req0203 seed
- `460c7de` docs(REQ-0303): full spec + gate results
- `3a58ec0` / `13d53d4` REQ-0303: reserved -> todo -> built
- `ee0bad3` feat(REQ-0303): frost packs -> frost_giant boss+entourage; live roster for batch-002 dungeon tests
- (this) docs(REQ-0303): update spec for the frost redesign

## Out of scope / follow-ups
- **Merge + deploy** (hands-off): on deploy, the powerLevel `--check` is DIRTY by design; the pre-deploy hook
  re-emits powerLevel (REQ-0297) for the grown packs, then ships. Coordinate with the user.
- **REQ-0206** (batch-002 pack re-composition under art-authoritative footprints) remains separate and
  independent; frost packs here only gained members (no art-link changes).

## Merged + deployed (2026-07-24)
- **Merge** `5a680e3` into master (--no-ff). Gates on merged master: inspect `--gate` 14/14, goldens
  byte-identical, run.cjs 184/0, req0203 15/0, req0207/0219 13/0, content_checks 69/0, api_test(pg) 194/0.
- **powerLevel recalibrated** (user-approved 2026-07-24) — `autobalance --emit` (commit `635d55a`)
  re-derived all 14 powerLevels for the grown content; `--check` now CLEAN. Because the frost packs gained
  strong bodies (`frost_giant`), the relative (mean-conserved) calibration shifted the whole field:
  frost packs rose (frost_scouts −15.53→+4.58, rime_choir −17.37→+3.90, bear_and_stalker −5.83→+7.00,
  hrimgrimnir +4.85→+9.74) and the previously-strong packs fell (titan_ridge +12.88→+1.35,
  deep_tide +10.32→−1.48, demon_gate +9.51→−2.51, bone_court +6.06→−1.62) — the dungeon difficulty curve
  flattened, which the user explicitly accepted. The `--emit` FLAG stands: batch-005/006/007 SOURCE
  packs.json powerLevel is unsynced (pre-existing since REQ-0297; sync on a future byte-lossless re-promotion).
- **Deployed** — `backpack-api` (systemd --user) RESTARTED; `/api/health` ok; `/api/schedule/dungeons`
  serves `niflheim_depths` (boss `pack_hrimgrimnir`). Served snapshot: frost_scouts 16 members / pL 4.5769,
  hrimgrimnir 15 / 9.7372, titan_ridge 4 (unchanged) / 1.3462, grave_shamble 10 / −5.609. The formation-fill
  admincontent warning is cleared for all 14 packs (`inspect --gate` OK on the live file).
- Status: **done** (merged + deployed + live-verified). REQ-0206 (frost art-authoritative footprints) remains
  a separate follow-up.
