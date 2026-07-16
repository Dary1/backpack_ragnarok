# REQ-0207 — wildlands: beast/vermin/demon roster + authored packs (batch-006)

**Status:** todo — user-cleared 2026-07-17 (chat 「どうぞ」 continuing the grave-legion mandate:
adopt monster arts, design them into the registry, author packs; theme expansion explicitly
offered and accepted). Which dungeons use these packs remains OUT of scope.
**Reserved:** 2026-07-17
**Slug:** wildlands-roster-packs
**Requested by:** user, 2026-07-17 (chat), design ratified by delegation to the orchestrator.
**Depends on:** REQ-0203 (grave-legion — the verb set this REQ REUSES: `lifesteal`,
`bonus_vs_status`, `heal_ally` are live in sim + dialect + forecast; batch-005 is the content
template), REQ-0184 (monster_pack kind), REQ-0188 (geometry guard — footprints here are
authored FROM art, so the guard stays green by construction), REQ-0174 (ref-first canon).

## Goal

Batch-006 `content/batches/batch-006-wildlands/`: **12 monster_defs, 20 skill_defs, 3
monster_packs** — pure CONTENT. **Expected engine delta: ZERO** (every verb/trigger/status
already exists post-REQ-0203). If you find an engine change is genuinely required, stop and
record why in this file before making it — the null-delta is a design feature, not an accident.

Three synergy engines, one per pack:
- `pack_wild_hunt` — lifesteal tempo (fast melee, sustain through damage).
- `pack_venom_nest` — Poison engine (spider/snake apply Poison → scorpion/basilisk convert
  via `bonus_vs_status`).
- `pack_demon_gate` — Burn engine (imp/demon_lord apply Burn → gargoyle converts).

## Roster (schema enemy/1)

Footprint = artwork `shape {w,h}` TRANSPOSED to `[fh,fw]`. Verify each against the live
artworks table READ-ONLY before authoring; the values below were read 2026-07-17.

| id | artwork (system_name) | shape | footprint | hp | rarity | pack_role | ja |
|---|---|---|---|---|---|---|---|
| `werewolf` | `werewolf` (adopted) | 4x4 | [4,4] | [95,125] | uncommon | anchor | ワーウルフ |
| `dire_wolf` | `dire_wolf` | 5x4 | [4,5] | [80,105] | common | line | ダイアウルフ |
| `boar` | `monsters-003-flux2:boar` (adopted) | 4x3 | [3,4] | [70,95] | common | line | ワイルドボア |
| `giant_bat` | `giant_bat` | 4x3 | [3,4] | [45,60] | common | support | ジャイアントバット |
| `giant_spider` | `giant_spider` | 4x3 | [3,4] | [60,80] | common | line | ジャイアントスパイダー |
| `giant_scorpion` | `giant_scorpion` | 4x3 | [3,4] | [75,100] | common | line | ジャイアントスコーピオン |
| `giant_snake` | `monsters-003-flux2:giant_snake` (adopted) | 4x4 | [4,4] | [85,110] | uncommon | line | ジャイアントスネーク |
| `basilisk` | `basilisk` | 6x4 | [4,6] | [130,170] | rare | anchor | バジリスク |
| `imp` | `imp` | 3x4 | [4,3] | [40,55] | common | support | インプ |
| `gargoyle` | `gargoyle` | 4x4 | [4,4] | [90,120] | uncommon | line | ガーゴイル |
| `dullahan` | `dullahan` | 4x4 | [4,4] | [120,155] | rare | anchor | デュラハン |
| `demon_lord` | `demon_lord` | 8x8 | [8,8] | [500,700] | relic | boss | デーモンロード |

- `boar` / `giant_snake` arts live under the `monsters-003-flux2:` namespace → like batch-005's
  wight, their enemies.json entries carry NO artwork_ref; the content_def gets an artwork_ref
  PATCH at deploy (orchestrator). All other ids match their artwork system_name exactly.
- 9 of 12 artworks are mid-generation on the GPU queue right now. Nothing in your gates
  depends on the IMAGE — only on `artworks.shape`, which exists for all 12. DO NOT touch the
  art queue.
- rarity `relic` for the boss follows REQ-0203's precedent (highest attested tier).

## Skills (schema skill/1) — 20

Same dialect and scale as batch-005. multi_strike param semantics: follow whatever REQ-0203's
`bone_breath` established. Adjust numbers only if a machine check forces it; record changes.

| id | ja | owner | trigger | verb | profile |
|---|---|---|---|---|---|
| `rending_claws` | 引き裂く爪 | werewolf | [2.4,3.0] | multi_strike n[4,7] x3 | front pen0 |
| `feral_bite` | 獣の牙 | werewolf | [3.6,4.4] | lifesteal n[8,12] frac 0.5 | front pen0 |
| `savage_bite` | 凶暴な咬みつき | dire_wolf | [2.2,2.8] | strike [9,14] | front pen0 |
| `harrying_snap` | 追い立ての牙 | dire_wolf | [3.8,4.6] | apply_status Weakness [1,3] | front pen0 |
| `tusk_charge` | 牙の突進 | boar | [3.2,4.0] | strike [12,18] | front pen1 |
| `blood_drain` | 吸血 | giant_bat | [2.8,3.6] | lifesteal n[5,8] frac 0.6 | side pen0 |
| `venom_bite` | 毒牙 | giant_spider | [2.8,3.6] | apply_status Poison [2,4] | front pen0 |
| `stinger` | 毒針 | giant_scorpion | [2.6,3.2] | bonus_vs_status Poison n[9,15] mult 1.5 | front pen0 |
| `pincer_grip` | 鋏の握撃 | giant_scorpion | [3.6,4.4] | strike [6,10] | front pen0 |
| `constrict` | 締め付け | giant_snake | [3.0,3.8] | strike [10,16] | front pen0 |
| `venom_spit` | 毒吐き | giant_snake | [4.0,5.0] | apply_status Poison [2,4] | front pen1 |
| `petrifying_gaze` | 石化の凝視 | basilisk | [5.0,6.0] | apply_status Stun [1,2] | front aoe1 aoe_statuses |
| `toxic_maw` | 毒の顎 | basilisk | [2.8,3.6] | bonus_vs_status Poison n[12,20] mult 1.5 | front pen1 |
| `fire_dart` | 火の矢 | imp | [3.0,3.8] | apply_status Burn [2,4] | front pen0 |
| `impish_drain` | 小悪魔の吸精 | imp | [3.8,4.6] | lifesteal n[5,8] frac 0.5 | front pen0 |
| `molten_talons` | 溶岩の爪 | gargoyle | [2.6,3.4] | bonus_vs_status Burn n[10,15] mult 1.5 | front pen0 |
| `headless_charge` | 首無しの突撃 | dullahan | [3.0,3.8] | strike [14,20] | front pen2 |
| `doom_toll` | 破滅の鐘 | dullahan | [4.5,5.5] | apply_status Weakness [3,5] | front aoe1 aoe_statuses |
| `hellfire_wave` | 獄炎の波 | demon_lord | [3.2,4.0] | strike [16,24] | front pen1 aoe2 |
| `dominion_of_flame` | 炎の支配 | demon_lord | [5.0,6.0] | apply_status Burn [3,5] | front aoe2 aoe_statuses |

All ids globally unique in the ledger (machine check enforces).

## Packs (schema monster_pack/1) — layouts on B2:Y17

Intent: melee forward-left, support behind, boss center-left. Validator is the authority; fix
anchors minimally preserving intent and record any fix.

| pack | ja | members (enemy @ anchor → derived cells) |
|---|---|---|
| `pack_wild_hunt` | 野生の狩人 | werewolf@B6→B6:E9 · dire_wolf@G2→G2:K5 · boar@G12→G12:J14 · giant_bat@M7→M7:P9 |
| `pack_venom_nest` | 毒の巣 | basilisk@B7→B7:G10 · giant_spider@I3→I3:L5 · giant_scorpion@I12→I12:L14 · giant_snake@N7→N7:Q10 |
| `pack_demon_gate` | 魔界の門 | demon_lord@B5→B5:I12 · gargoyle@K3→K3:N6 · dullahan@K12→K12:N15 · imp@P6→P6:R9 · imp@P11→P11:R14 |

`note` per pack: one line naming its engine.

## Ships
- `content/batches/batch-006-wildlands/` (enemies/skills/packs + whatever companions the
  additive promote needs — mirror batch-005 exactly, including provenance fields).
- Tests: dialect PASS suite for the batch, transpose pins on the NEW non-squares ([4,5],
  [4,6], [8,8] plus one 3x4), pack layouts PASS the shared validator, goldens unmoved,
  contentadmin board footprint-resolution gate extended (or a sibling of REQ-0203's
  `check_pack_board_grave_legion.mjs`) covering one wildlands pack.
- Reuse `promoteAdditive` as-is (built by REQ-0203). NO dungeon.json/dungen change.
- **Worktree trap**: promote/sim-tests resolve live/ via `os.homedir()` — explicit `liveDir` /
  HOME override, never the main checkout.

## Gates
- G1 dialect: batch-006 all PASS; dup id / unknown status FAILs by name.
- G2 layouts: validator PASS for all 3 packs; derived cells equal the table above (or the
  recorded minimal fix).
- G3 transpose pins green.
- G4 `tools/ci.sh` GREEN (SKIP_PG=1 SKIP_E2E=1 minimum; port decade 2070-2079 if any harness).
- G5 goldens unmoved; engine delta provably zero (`git diff --stat` shows no sim/engine file).
- G6 (deploy, post-merge, orchestrator): promoteAdditive; backfill; expected counts
  monster_def 15→27, skill_def 30→50, monster_pack 7→10, all PASS/adopted; artwork_ref PATCH
  for `boar`/`giant_snake`; board verified live.
- S7 user acceptance.

## Out of scope
Dungeon wiring (REQ-0185), engine changes, art generation/adoption (orchestrator-owned,
queue-only), gacha/BP packs (REQ-0202's domain — different kind entirely).
