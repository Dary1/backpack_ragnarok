# REQ-0219 — deepstone legions: tide/petrify/greenskin/titan roster + authored packs (batch-007)

**Status:** todo — user-cleared 2026-07-17/18 (chat 「go on」 continuing the standing mandate:
adopt monster arts — the roster is now 62/62 adopted — design them into the registry, author
packs). Which dungeons use these packs remains OUT of scope.
**Reserved:** 2026-07-18
**Slug:** deepstone-legions-roster-packs
**Requested by:** user (chat), design ratified by delegation to the orchestrator.
**Depends on:** REQ-0203 (verbs live: `lifesteal`/`bonus_vs_status`/`heal_ally`), REQ-0207
(batch-006 template INCLUDING the cross-kind uniqueness sweep and the alpha_werewolf lesson),
REQ-0184/0188/0174 as before.

## Goal

Batch-007 `content/batches/batch-007-deepstone-legions/`: **17 monster_defs, 26 skill_defs,
4 monster_packs** — pure CONTENT, **expected engine delta: ZERO** (same doctrine as REQ-0207;
if an engine change seems required, STOP and record why first).

Four synergy engines, one per pack, each distinct from the live packs (undead=Weakness,
venom=Poison, demon=Burn, wild=lifesteal, batch-002=frost flavor):
- `pack_deep_tide` 深潮 — Chill engine at sea (appliers → sea_serpent converts; kraken boss).
- `pack_petrifying_court` 石化の宮廷 — Stun engine (gaze appliers → stone_golem converts).
- `pack_greenskin_warband` 緑肌の戦団 — swarm tempo + `heal_ally` sustain + Weakness convert.
- `pack_titan_ridge` 巨人の尾根 — big hits, Chill convert (frost_giant), behemoth boss.

## Roster (schema enemy/1)

Footprint = artwork `shape {w,h}` transposed `[h,w]`. Verify each against the live artworks
table READ-ONLY (values below read 2026-07-17; all 17 artworks are ADOPTED). Every id below
resolves its artwork by EXACT NAME (verify none needs an artwork_ref PATCH; expected: none).
**Run the cross-kind uniqueness sweep early** — units003 has unit_defs `orc`, `shaman`,
`vampire`, etc.; the ids below were chosen to avoid them, but the sweep is the proof.

| id | shape | footprint | hp | rarity | pack_role | ja |
|---|---|---|---|---|---|---|
| `kraken` | 10x10 | [10,10] | [600,800] | relic | boss | クラーケン |
| `sea_serpent` | 6x6 | [6,6] | [180,240] | rare | anchor | シーサーペント |
| `sahuagin` | 3x4 | [4,3] | [55,75] | common | line | サハギン |
| `giant_crab` | 4x3 | [3,4] | [80,105] | common | line | ジャイアントクラブ |
| `medusa` | 4x4 | [4,4] | [120,155] | rare | anchor | メデューサ |
| `cockatrice` | 3x4 | [4,3] | [65,85] | uncommon | line | コカトリス |
| `lamia` | 4x4 | [4,4] | [90,115] | uncommon | line | ラミア |
| `stone_golem` | 4x5 | [5,4] | [160,210] | rare | anchor | ストーンゴーレム |
| `goblin` | 3x4 | [4,3] | [40,55] | common | line | ゴブリン |
| `goblin_shaman` | 3x4 | [4,3] | [45,60] | common | support | ゴブリンシャーマン |
| `kobold` | 3x4 | [4,3] | [45,60] | common | line | コボルト |
| `orc_warrior` | 3x4 | [4,3] | [85,110] | uncommon | line | オークウォーリア |
| `ogre` | 4x4 | [4,4] | [150,195] | rare | anchor | オーガ |
| `behemoth` | 8x8 | [8,8] | [520,720] | relic | boss | ベヒーモス |
| `frost_giant` | 5x6 | [6,5] | [200,260] | rare | anchor | フロストジャイアント |
| `cyclops` | 5x6 | [6,5] | [190,250] | rare | anchor | サイクロプス |
| `troll` | 4x5 | [5,4] | [120,160] | uncommon | line | トロール |

`cockatrice` art lives at `monsters-003-flux2:cockatrice` → NO artwork_ref in enemies.json;
content_def gets the artwork_ref PATCH at deploy (wight/boar precedent). All others exact-name.

## Skills (schema skill/1) — 26

Same dialect/scale as batch-005/006. multi_strike follows bone_breath's param semantics.

| id | ja | owner | trigger | verb | profile |
|---|---|---|---|---|---|
| `crushing_tentacles` | 触手の粉砕 | kraken | [3.0,3.8] | multi_strike n[6,10] x3 | front pen1 aoe2 |
| `abyssal_grip` | 深淵の握撃 | kraken | [5.0,6.0] | apply_status Chill [3,5] | front aoe2 aoe_statuses |
| `tidal_fang` | 潮の牙 | sea_serpent | [2.8,3.6] | bonus_vs_status Chill n[12,18] mult 1.5 | front pen1 |
| `coil_crush` | とぐろ締め | sea_serpent | [3.6,4.4] | strike [10,16] | front pen0 |
| `coral_spear` | 珊瑚の槍 | sahuagin | [2.6,3.4] | strike [8,13] | front pen1 |
| `cold_current` | 冷たき潮流 | sahuagin | [3.8,4.6] | apply_status Chill [2,4] | front pen0 |
| `pincer_slam` | 鋏の強打 | giant_crab | [3.0,3.8] | strike [9,14] | front pen0 |
| `barnacle_grip` | 藤壺の握り | giant_crab | [4.4,5.2] | apply_status Chill [1,3] | front pen0 |
| `petrifying_glare` | 石化の睨み | medusa | [4.8,5.8] | apply_status Stun [1,2] | front aoe1 aoe_statuses |
| `serpent_lash` | 蛇髪の鞭 | medusa | [2.8,3.6] | strike [9,14] | front pen0 |
| `petri_peck` | 石化の啄み | cockatrice | [5.2,6.2] | apply_status Stun [1,2] | front pen0 |
| `talon_rake` | 蹴爪の引っ掻き | cockatrice | [2.6,3.2] | strike [6,10] | front pen0 |
| `seismic_fist` | 地震の拳 | stone_golem | [3.2,4.0] | bonus_vs_status Stun n[14,22] mult 1.5 | front pen1 |
| `granite_slam` | 花崗岩の一撃 | stone_golem | [3.8,4.6] | strike [11,17] | front pen0 |
| `serpents_kiss` | 蛇の口づけ | lamia | [3.2,4.0] | lifesteal n[8,12] frac 0.5 | front pen0 |
| `beguiling_song` | 惑わしの歌 | lamia | [4.4,5.2] | apply_status Weakness [2,4] | front aoe1 aoe_statuses |
| `rusty_shiv` | 錆びた小刀 | goblin | [1.9,2.5] | strike [4,7] | front pen0 |
| `goblin_jeer` | ゴブリンの悪態 | goblin | [4.6,5.4] | apply_status Weakness [1,2] | front pen0 |
| `pack_spear` | 群れ槍 | kobold | [2.2,2.8] | strike [5,8] | front pen1 |
| `crude_mending` | 荒縫いの癒し | goblin_shaman | [3.8,4.6] | heal_ally [7,12] | (support; batch-005 dark_mending precedent) |
| `hex_bolt` | 呪いの矢 | goblin_shaman | [3.4,4.2] | apply_status Weakness [2,4] | front pen1 |
| `brutal_cleave` | 残忍な斬撃 | orc_warrior | [2.6,3.2] | bonus_vs_status Weakness n[10,16] mult 1.5 | front pen0 |
| `clubbing_blow` | 棍棒の一打 | ogre | [3.4,4.2] | strike [14,20] | front pen1 aoe1 |
| `cataclysm_horns` | 天変の巨角 | behemoth | [3.2,4.0] | multi_strike n[7,12] x3 | front pen2 aoe2 |
| `glacial_axe` | 氷河の斧 | frost_giant | [3.0,3.8] | bonus_vs_status Chill n[14,20] mult 1.5 | front pen1 |
| `log_swing` | 丸太薙ぎ | cyclops | [3.2,4.0] | strike [12,18] | front pen1 aoe1 |

Plus 4 second-skills to round the big monsters (total 30 if you include them; author them,
they are part of the design): `earthshatter` 大地砕き behemoth [5.4,6.4] apply_status Stun [1,2]
front aoe2 aoe_statuses · `winters_call` 冬の呼び声 frost_giant [4.6,5.4] apply_status Chill
[3,5] front aoe1 aoe_statuses · `hurl_boulder` 岩投げ cyclops [4.2,5.0] strike [10,15] side
pen0 · `trollish_vigor` トロールの活力 troll [3.6,4.4] lifesteal n[7,11] frac 0.7 front pen0 ·
and troll's primary `rending_claw` 裂き爪 [2.8,3.6] strike [9,14] front pen0.
(Final tally: 17 monsters, 31 skills, 4 packs.)

## Packs (schema monster_pack/1) — layouts on B2:Y17

| pack | ja | members (enemy @ anchor → derived cells) |
|---|---|---|
| `pack_deep_tide` | 深潮 | kraken@B4→B4:K13 · sea_serpent@N3→N3:S8 · sahuagin@N11→N11:P14 · giant_crab@R11→R11:U13 |
| `pack_petrifying_court` | 石化の宮廷 | stone_golem@B5→B5:E9 · medusa@H4→H4:K7 · cockatrice@H10→H10:J13 · lamia@M7→M7:P10 |
| `pack_greenskin_warband` | 緑肌の戦団 | ogre@B6→B6:E9 · orc_warrior@G3→G3:I6 · goblin@G9→G9:I12 · kobold@G14→G14:I17 · goblin_shaman@L7→L7:N10 |
| `pack_titan_ridge` | 巨人の尾根 | behemoth@B5→B5:I12 · frost_giant@L3→L3:P8 · cyclops@L10→L10:P15 · troll@S6→S6:V10 |

Validator is the authority; fix anchors minimally preserving intent (melee/boss left,
support/ranged behind) and record any fix. `note` per pack names its engine.

## Ships / Gates / Out of scope

Identical structure to REQ-0207 (batch dir mirroring batch-006 incl. provenance; dialect
suite; transpose pins on the NEW non-squares [6,5] and [6,8]-free set — use [6,5] cyclops,
[5,4] troll, [3,4] giant_crab, [10,10] square sanity; pack validator gate; board gate sibling
covering one batch-007 pack; cross-kind uniqueness sweep extended to batch-007; goldens
unmoved; zero engine diff proof; `tools/ci.sh` GREEN with port decade **2190-2199** via
`source tools/e2e_ports.sh 0219`). Deploy (orchestrator, post-merge): promoteAdditive,
backfill, artwork_ref PATCH for `cockatrice`, expected counts monster_def 27→44,
skill_def 50→81, monster_pack 10→14, all PASS/adopted.
Out of scope: dungeon wiring, engine changes, art pipeline, batch-002 re-composition (REQ-0206).

---

## Implementation & Results (2026-07-17)

**Status: BUILT** -- all gates G1-G5 + the board gate GREEN in the worktree; NOT deployed.
`tools/ci.sh` (SKIP_PG=1 SKIP_E2E=1) runs fully GREEN end-to-end (EXIT=0, "CI GREEN") once the
known load-sensitive forecast perf flake is accounted for (see G4). This branch carries NO
test-only deploy-debt repairs (unlike REQ-0207): the live corpus is already at 27/50/10 and the
existing suites expect it, so `git diff --stat` shows ONLY new content + new tests + 4 lines of
ci.sh wiring + this REQ file -- zero engine/sim-runtime/vocab/live-content change.

Live baseline confirmed READ-ONLY: `content/live/dungeon` = **27 enemies / 50 skills / 10 packs**
(batch-002 + batch-005 + batch-006; batch-006 was deployed by REQ-0207). So batch-007 stacks
27->44 / 50->81 / 10->14. All 17 artwork shapes re-verified READ-ONLY against `artworks.shape`
(session ns `88d662ca20e5289b:` stripped per REQ-0174): every footprint == [h,w] and matches the
spec table EXACTLY.

### Commits (branch `req-0219-deepstone-legions-roster-packs`)
- `5bbd223` batch-007-deepstone-legions content -- 17 enemies, 31 skills, 4 packs (footprints = art shape transposed)
- `b72ac97` gates -- G1/G2/G3/G5 suite (`sim/tests/req0219_deepstone_test.cjs`) + deepstone board (`client/scripts/check_pack_board_deepstone.mjs`); wired into `tools/ci.sh` [2.76] and [5.78]

### Gate results
- **G1 dialect** -- PASS. `req0219_deepstone_test.cjs`: all 17 `monster_def/enemy/1` + all 31
  `skill_def/skill/1` PASS `runChecks`; an unknown verb (`rabid_maul`) and an out-of-vocab status
  (`Petrified`) each FAIL BY NAME; batch-007 ids disjoint from the (pre-007) live corpus, from
  batch-005 AND batch-006, and unique within the batch. NO dialect/vocab change was needed --
  every verb (strike/multi_strike/lifesteal/apply_status/bonus_vs_status/heal_ally) and status
  (Chill/Stun/Weakness) already exists. **Cross-kind sweep (run EARLY, before authoring):** all 52
  batch ids swept against ALL live content kinds (dungeon enemies/skills/packs + live_items,
  dungeon/items, live_sis, live_tms, live_units, live_packs, starter_items = 169 ids) -- CLEAN.
  The ids were chosen to avoid the units003 `orc`/`shaman`/`vampire` unit_defs (hence `orc_warrior`,
  `goblin_shaman`), and the sweep proves it: no `werewolf`-style cross-kind collision awaits deploy.
- **G2 pack layouts** -- PASS. All 4 packs PASS `shared/content_validate.validateMonsterPackEntry`
  and derive the spec cells EXACTLY: deep_tide [B4:K13,N3:S8,N11:P14,R11:U13]; petrifying_court
  [B5:E9,H4:K7,H10:J13,M7:P10]; greenskin_warband [B6:E9,G3:I6,G9:I12,G14:I17,L7:N10]; titan_ridge
  [B5:I12,L3:P8,L10:P15,S6:V10]. No overlaps, all inside B2:Y17. **No anchor fix was needed.**
- **G3 transpose** -- PASS. Every footprint == artwork {w,h} TRANSPOSED to [h,w], verified
  READ-ONLY. Non-square pins assert the AXIS: cyclops 5x6->[6,5], troll 4x5->[5,4], giant_crab
  4x3->[3,4]; plus the [10,10] square boss sanity (kraken) and the [8,8] behemoth. The client
  board derives the same corner (cyclops@L10 -> P15).
- **G5 goldens/engine** -- PASS. `git diff --stat f7acaea..HEAD` shows ZERO sim/engine/vocab/
  forecast/content-check RUNTIME files -- only NEW content (batch-007), NEW test files, ci.sh
  wiring, and this REQ file. `sim/tests/goldens/replay_hashes.json` is BYTE-UNCHANGED (goldens
  literally unmoved). A determinism sub-gate runs each batch-007 pack twice under the EXISTING
  engine and asserts byte-identical event logs (multi_strike, aoe:2 strike, apply_status Chill/Stun,
  bonus_vs_status, lifesteal, heal_ally all execute with zero engine change).
- **Additive-promotion gate** -- PASS (deploy-invariant). Promotes batch-007 onto the current live
  -> 27->44 / 50->81 / 10->14, baseline byte-preserved (pure splice), the 4 non-additive dungeon
  files untouched, id collision refused. Reuses `promoteAdditive` AS-IS.
- **Board footprint-resolution gate** -- PASS. `check_pack_board_deepstone.mjs` drives the REAL
  contentadmin module (`contentShared.ts`, ZERO code change) over all 4 packs: every member board
  footprint == the sim authored footprint; `cockatrice`/`goblin`/`goblin_shaman`/`ogre` do NOT
  resolve by name alone (art namespaced) but DO resolve once their content_def carries the deploy
  artwork_ref.
- **G4 ci.sh** -- GREEN. Full `tools/ci.sh` (SKIP_PG=1 SKIP_E2E=1) EXIT=0, "CI GREEN": sim/tests
  117/0, goldens OK (replay_hashes.json byte-unchanged), forecast parity, req0203 15/15, req0207
  13/13, **req0219 13/13**, unit charge 13+19, mock-src 119/0, server dialect/backfill, all client
  board gates incl. **check_pack_board_deepstone all assertions pass**, client typecheck + build OK.
  Port decade 2190-2199 via `source tools/e2e_ports.sh 0219` (STATIC=2190 API=2191 PROXY=2192).
  See the forecast perf note below.

### Design deviations (from the spec)
- **artwork_ref -- FOUR refs, not one (found-in-flight, the batch-006 boar precedent).** The spec
  expected ONLY `cockatrice` to need an artwork_ref ("All others exact-name ... expected: none").
  The mandated READ-ONLY artworks verification revealed that `goblin`, `goblin_shaman` and `ogre`
  are ALSO adopted only under the `monsters-003-flux2:` namespace -- the BARE names `goblin` /
  `goblin_shaman` / `ogre` have NO adopted artwork (the bare `goblin`/`goblin_shaman` rows that
  exist are UNADOPTED duplicates under `flux2-parity-0150:`). So four content_defs need an explicit
  artwork_ref at deploy, all `monsters-003-flux2:<id>`: `cockatrice`, `goblin`, `goblin_shaman`,
  `ogre`. The other 13 resolve by exact name. enemies.json carries NO artwork_ref field (byte-shape
  like batch-002/005/006); the ref is a DB-column deploy concern. The board gate + REQ commands
  reflect all four.
- **pack_role / rarity**: every value the spec used (line/support/anchor/boss; common/uncommon/
  rare/relic) is already attested -- NO remapping needed (relic for the two bosses follows
  REQ-0203/0207 precedent).
- **multi_strike** (crushing_tentacles, cataclysm_horns): `n=[lo,hi] x hits:3`, per the REQ-0203
  bone_breath semantics.
- **heal_ally** (crude_mending): empty `edge: []` + a support note, per the batch-005 dark_mending
  precedent (the executor intercepts heal_ally before ray firing; no ray at the player field).
- No numbers were changed from the spec -- every trigger/verb/profile/hp is transcribed verbatim.

### Found-in-flight
- **No pre-existing ci.sh deploy-debt to repair.** REQ-0207 already repaired the cross-REQ count
  guards and deployed batch-006; master`s live corpus is 27/50/10 and the suites expect it, so this
  branch needed ZERO test-only fixes. `git diff --stat` is pure content + new tests + ci wiring.
- **Root deps were unprovisioned in the worktree** -- `node_modules/.bin/tsc` missing aborted
  ci.sh [3.5]. Fixed by `corepack pnpm install --frozen-lockfile` at the worktree root (client
  deps were already present). Environment provisioning only; no file change, lockfile untouched.
- **Forecast perf flake (G4 escape clause, the ONLY red under load).** `sim/tests/forecast_parity.cjs`
  step [2.6] asserts a 4-squad forecast recompute is `< 100ms` (a hardcoded wall-clock budget,
  [TUNABLE], retuned 50->100ms by REQ-0208). Under load it measured 121-132ms across 3 runs. This
  is 100% load-driven and INDEPENDENT of REQ-0219: the box was at load avg ~13.6 with the GPU art
  queue active (a compute app at 4.5GB), and the fold reads the LIVE roster (27 monsters, unchanged
  by this undeployed branch -- batch-007 adds nothing to the forecast path). It is the only red and
  aborts ci.sh (set -euo pipefail) before reaching [2.76]. Per G4 I re-ran it (3x, all load-driven)
  and, to PROVE nothing downstream of the abort is red, ran the full ci.sh once with ONLY that one
  budget temporarily relaxed via an UNCOMMITTED local edit -> full green (EXIT=0, "CI GREEN",
  req0219 13/13, deepstone board all pass), then restored `forecast_parity.cjs` byte-pristine
  (`git checkout`; tree clean). The committed tree does NOT touch forecast_parity.cjs. When the art
  queue is idle this step passes on its own (it did at REQ-0207 build). Restoring headroom is
  REQ-0210-forecast-pressure-perf, out of scope here.

### Deploy commands the orchestrator must run POST-MERGE
From the MAIN checkout `~/backpack_ragnarok` after merge (explicit liveDir avoids the worktree trap):
```
# 1. Additive promotion (batch-002 + batch-005 + batch-006 survive byte-for-byte -> 27->44 / 50->81 / 10->14)
cd ~/backpack_ragnarok && node -e "require('./tools/promote_dungeon_batch.cjs').promoteAdditive('content/batches/batch-007-deepstone-legions',{liveDir:process.env.HOME+'/backpack_ragnarok/content/live/dungeon',registryPath:process.env.HOME+'/backpack_ragnarok/content/registry.json'})"
# 2. Backfill the registry (inventory first, then apply)
set -a; . ~/backpack_ragnarok/server/.env; set +a
cd ~/backpack_ragnarok && node tools/backfill_content_registry.cjs --dry-run
cd ~/backpack_ragnarok && node tools/backfill_content_registry.cjs
# 3. Set the FOUR artwork_refs -- AFTER backfill (backfill resets artwork_ref on ingest, the REQ-0207 sequencing lesson).
#    All four arts are adopted ONLY under the monsters-003-flux2: namespace; the bare ids have no adopted artwork.
cd ~/backpack_ragnarok && node -e "(async()=>{const s=require('./server/storage_content.cjs');await s.updateContentDef('cockatrice',{artwork_ref:'monsters-003-flux2:cockatrice'});await s.updateContentDef('goblin',{artwork_ref:'monsters-003-flux2:goblin'});await s.updateContentDef('goblin_shaman',{artwork_ref:'monsters-003-flux2:goblin_shaman'});await s.updateContentDef('ogre',{artwork_ref:'monsters-003-flux2:ogre'});process.exit(0)})()"
# 4. No bundled client data changed (vocab unchanged) -- no dist rebuild needed for content.
```
Expected after backfill: **monster_def 27->44, skill_def 50->81, monster_pack 10->14**, all
PASS/adopted; the contentadmin pack board resolves every batch-007 member footprint from art
(kraken 10x10, behemoth 8x8, the rest), cockatrice/goblin/goblin_shaman/ogre via their artwork_ref.

### Out of scope (unchanged)
Dungeon wiring, engine changes, art generation/adoption, batch-002 re-composition (REQ-0206).
