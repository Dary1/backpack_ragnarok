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
- **Stops at built/** — merge/deploy is hands-off (PROJECT.md); coordinate separately.

## What was done — final compositions (re-laid-out via first-fit; all validated by
`shared/content_validate.cjs`, all non-overlapping and inside B2:Y17)

| pack | final composition (enemy x count) | cells | fill | members |
|---|---|---|---|---|
| pack_frost_scouts | frostback_bear x28, frost_gnoll x3, ice_archer x3 | 118 | 30.7% | 34 |
| pack_rime_choir | frostback_bear x28, rime_shaman x3, glacier_wisp x3 | 118 | 30.7% | 34 |
| pack_bear_and_stalker | frostback_bear x28, niflheim_stalker x6 | 118 | 30.7% | 34 |
| pack_hrimgrimnir | hrimgrimnir x1 (boss), frostback_bear x26, niflheim_stalker x5 | 118 | 30.7% | 32 |
| pack_grave_shamble | zombie x5, mummy x2, ghost x2, lich x1 (boss) | 128 | 33.3% | 10 |
| pack_grave_legion | skeleton_warrior x3, wight x2, zombie x2, necromancer x1, ghost x1, lich x1 | 128 | 33.3% | 10 |
| pack_wild_hunt | alpha_werewolf x2, dire_wolf x2, boar x2, giant_bat x2 | 120 | 31.3% | 8 |
| pack_venom_nest | basilisk x2, giant_spider x3, giant_scorpion x2, giant_snake x1 | 124 | 32.3% | 8 |
| pack_petrifying_court | stone_golem x2, medusa x2, cockatrice x3, lamia x1 | 124 | 32.3% | 8 |
| pack_greenskin_warband | ogre x2, orc_warrior x3, goblin x1, kobold x1, goblin_shaman x1, troll x1 | 124 | 32.3% | 9 |

Each pack keeps its id, name, i18n, powerLevel and note; only `members` changed.

## Pipeline (how the edit stays lossless)
`content/live/dungeon/packs.json` is an additive-promoted file (REQ-0122): batch-002 base packs byte-verbatim
at the head, then batch-005/006/007 layers. So each pack was edited in BOTH its batch source AND live,
identically. The REQ-0122 invariant checks: live packs.json sha == the LAST additive-layer sha (re-stamped in
`registry.json` — line 260, the batch-007 layer, `764c77..` -> `6e19356b..`), live entry-ids == base ++ layer
ids (unchanged — members added, no packs added/removed), and live starts with the batch-002 source bytes
verbatim (the 4 frost packs are edited identically in source + live, so the head still matches).

## Key discoveries / decisions
- **Frost packs are footprint-limited (flag for review).** batch-002's largest body is
  `frostback_bear[2,2]=4`; there is NO large frost boss in batch-002. A batch-002 Niflheim smoke test
  (`sim/tests/run.cjs`) builds its roster from batch-002 enemies ONLY, so a frost pack may use ONLY batch-002
  enemies (an early attempt with `frost_giant` crashed `compileEnemyPack: missing enemy def`). Reaching >=30%
  with 2- and 1-cell bodies therefore needs ~32-34 members (mostly `frostback_bear`). This is mechanically
  valid but flavor-heavy. **Options for the user at review:** (a) accept as-is; (b) defer the 4 frost packs
  until REQ-0206 gives them art-authoritative (larger) footprints, after which >=30% needs far fewer members;
  (c) a different hand-picked mix. The other 6 packs use their own batch's roster with a clean boss+entourage.
- **Gate flipped to HARD.** `tools/ci.sh` step [3.996/7]: `inspect_pack_formation --advisory` ->
  `--gate` (exit 1 if any monster_pack < 30%). Now green (14/14).
- **Geometry tests reconciled.** req0203/0207/0219 pin each authored layout's derived cell-ranges; the
  `expected` maps for the 6 non-frost packs were updated to the new placements. The frost packs have no
  geometry test.
- **Seed re-pick (req0203).** The G2 "real content" test runs `pack_grave_legion` under a fixed seed and
  asserts heal_ally/lifesteal/bonus_vs_status all fire. Growing the pack shifted the deterministic RNG, so the
  seed was re-picked (`req0203-legion-fixed` -> `-6`, verified) — same intent, new composition.
- **powerLevel marker left DIRTY (correct).** `registry.powerlevel_calibrated_from.packs.json` (line 273) was
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
- (this) docs(REQ-0303): spec + gate results; reserved -> todo -> built

## Out of scope / follow-ups
- **Merge + deploy** (hands-off): on deploy, the powerLevel `--check` is DIRTY by design; the pre-deploy hook
  re-emits powerLevel (REQ-0297) for the grown packs, then ships. Coordinate with the user.
- **REQ-0206** (batch-002 pack re-composition under art-authoritative footprints) remains separate; if it
  lands, the 4 frost packs can be re-composed with far fewer, larger members.
- **Flavor review** of the frost packs (see "footprint-limited" above).
