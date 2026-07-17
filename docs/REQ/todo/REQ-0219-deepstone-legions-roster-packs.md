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
