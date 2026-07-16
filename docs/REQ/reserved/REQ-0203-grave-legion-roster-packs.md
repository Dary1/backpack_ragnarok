# REQ-0203 — grave-legion: undead roster from adopted art, enemy-verb extensions, authored packs

**Status:** todo — user-cleared 2026-07-17 (chat): adopt monster arts (orchestrator decided
adoptions), design them as monsters into the Content Data Registry, author `monster_pack`s
placed on the enemy field by art shape, and *"add the verbs you need freely, at your own
discretion"*. Which dungeons use these packs is explicitly OUT of scope (user, same chat).
**Reserved:** 2026-07-17
**Slug:** grave-legion-roster-packs
**Requested by:** user, 2026-07-16/17 (chat), design ratified by delegation to the orchestrator.
**Depends on:** REQ-0184 (monster_pack kind — MERGED + DEPLOYED 2026-07-17, migration 019 applied,
backfill green: monster_pack=4 PASS/adopted), REQ-0174 (ref-first artwork resolution),
REQ-0161 (skill/1 dialect doctrine), REQ-0121 (enemy verb sim precedent).
**Coordinates with:** REQ-0188 (art-authoritative geometry, in flight on its own worktree).
This REQ authors every footprint FROM the linked artwork's shape, so REQ-0188's drift guard
must land green over batch-005 by construction.

## Goal

A themed undead roster — 8 new `monster_def`s designed from ADOPTED artworks, 16 new
`skill_def`s, 3 enemy-side verb extensions, and 3 authored `monster_pack`s — lands as
`content/batches/batch-005-grave-legion/`, promotes to `content/live/dungeon/`, and backfills
into the ledger. The packs' theme is a WEAKNESS ENGINE: appliers stack Weakness on the player
squad, converters cash it in via `bonus_vs_status`, sustainers keep the pack alive via
`lifesteal` and the new `heal_ally`.

## The three verb extensions (user: "add verbs freely")

| verb | vocab status | EnemySkill semantics (intent) |
|---|---|---|
| `lifesteal` | EXISTS (player-side) | strike for `n`, heal SELF by `frac` of damage actually dealt |
| `bonus_vs_status` | EXISTS (player-side) | strike for `n`; if the target carries status `status`, multiply by `mult` |
| `heal_ally` | **NEW id** | heal the lowest-HP LIVING pack member for `n` (never self unless alone) |

Rules of engagement for the implementer:
- FIRST read how the sim's enemy-skill executor actually models targets/statuses/damage
  (`sim/lib/encounter.cjs`, `sim/lib/packs.cjs`, engine copies). Where the engine reality
  cannot express the intent above, implement the NEAREST HONEST semantic and document the
  deviation in this file. Do not fake a mechanic with a lookalike that lies (REQ-0160 doctrine).
- vocab.json: add `heal_ally` to `verbs`, wire `ranged_verb_params` (`n`), and extend whatever
  the enemy dialect (`skill/1` in `server/services/content_checks.cjs`) uses to admit exactly
  these three verbs for enemy skills — an unknown verb must still FAIL BY NAME.
- Find EVERY consumer that executes or predicts enemy skills (sim, `server/lib/forecast.cjs`,
  client replay/telegraphs, mock engine if it participates) and keep them in parity; pin with
  a test. REQ-0184's lesson: forced copies drift silently.
- Determinism: all randomness through the existing rng discipline; no `Math.random`.

## Roster (batch-005-grave-legion, schema enemy/1)

Footprint = linked artwork `shape` `{w,h}` TRANSPOSED to `[fh,fw]` = `[h,w]`. **MIND THE
TRANSPOSE** (REQ-0029 was a transposition bug; REQ-0184 pinned `{w:3,h:4}` → `[4,3]`).

| id | artwork_ref | shape | footprint | hp | rarity | pack_role | skills |
|---|---|---|---|---|---|---|---|
| `zombie` | `zombie` | 3x4 | [4,3] | [55,75] | common | line | rotting_claw, festering_grasp |
| `ghost` | `ghost` | 3x4 | [4,3] | [40,55] | common | skirmish | spectral_touch, haunting_chill |
| `mummy` | `mummy` | 3x4 | [4,3] | [85,115] | uncommon | line | bandage_lash, mummys_curse |
| `skeleton_warrior` | `skeleton_warrior` | 3x4 | [4,3] | [75,100] | common | bruiser | bone_cleaver, shield_jab |
| `wight` | `monsters-003-flux2:wight` | 3x4 | [4,3] | [110,140] | rare | elite | grave_blade, life_drain |
| `necromancer` | `necromancer` | 3x4 | [4,3] | [50,70] | uncommon | support | dark_mending, enfeebling_bolt |
| `lich` | `lich` | 4x5 | [5,4] | [150,200] | rare | elite | soul_blast, paralyzing_dread |
| `bone_dragon` | `bone_dragon` | 10x10 | [10,10] | [550,750] | (top vocab rarity) | boss | bone_breath, necrotic_roar |

- `rarity` MUST come from vocab.json's `rarities`; if there is no `boss`, use the highest tier
  that exists and note it here.
- i18n ja names: ゾンビ / ゴースト / マミー / スケルトンウォーリア / ワイト / ネクロマンサー /
  リッチ / ボーンドラゴン. en = Zombie, Ghost, Mummy, Skeleton Warrior, Wight, Necromancer,
  Lich, Bone Dragon. Follow batch-002's i18n spelling ({en,ja} objects).
- `pack_role` values: follow batch-002's dialect (`line`/`support`/…); if `skirmish`/`bruiser`/
  `elite`/`boss` are not attested values, use the nearest attested one and note the mapping here.
- All 8 artworks are ADOPTED in the art registry (orchestrator, 2026-07-16/17); `artwork_ref`
  uses the ns-stripped system_name exactly as spelled above (REQ-0174 ref-first canon).
- lich's adoption may still be in the GPU queue when you start; nothing in G1-G5 depends on the
  IMAGE — only on `artworks.shape`, which exists. Do not touch the art queue.

## Skills (batch-005, schema skill/1) — the Weakness engine

Cadence/damage numbers follow batch-002's scale (strike 6-22, every_secs 1.8-5.5). Attack
profiles follow ruling 7 typing (bow=side/pen0, spear=front/pen1, casters compose freely).
Exact trigger seconds / n ranges below are the DESIGN; adjust only if a machine check or
engine constraint forces it, and record any change here.

| id | ja | trigger every_secs | verb | attack_profile |
|---|---|---|---|---|
| `rotting_claw` | 腐り爪 | [2.4,3.0] | strike [5,9] | front, pen0 |
| `festering_grasp` | 膿み掴み | [3.5,4.5] | apply_status Weakness [2,4] | front, pen0 |
| `spectral_touch` | 霊気の接触 | [2.6,3.4] | lifesteal n[6,10] frac 0.5 | side (left,right), pen0 |
| `haunting_chill` | 祟りの冷気 | [3.8,4.6] | apply_status Chill [2,4] | side, pen0, aoe_statuses |
| `bandage_lash` | 包帯の鞭 | [2.6,3.4] | strike [9,15] | front, pen1 |
| `mummys_curse` | ミイラの呪い | [4.2,5.2] | apply_status Weakness [3,5] | front, aoe1, aoe_statuses |
| `bone_cleaver` | 骨断ち | [2.2,2.8] | bonus_vs_status Weakness n[10,16] mult 1.5 | front, pen0 |
| `shield_jab` | 盾突き | [3.0,3.8] | strike [4,7] | front, pen0 |
| `grave_blade` | 墓場の刃 | [2.4,3.0] | bonus_vs_status Weakness n[12,20] mult 1.5 | front, pen1 |
| `life_drain` | 生命吸収 | [3.6,4.4] | lifesteal n[8,12] frac 0.6 | front, pen0 |
| `dark_mending` | 闇の縫合 | [4.0,5.0] | heal_ally [8,14] | (no ray — support; give the dialect an honest shape) |
| `enfeebling_bolt` | 衰弱の矢 | [3.2,4.0] | apply_status Weakness [3,5] | front, pen1 |
| `soul_blast` | 魂の爆撃 | [2.8,3.6] | strike [14,22] | front, pen1, aoe1 |
| `paralyzing_dread` | 麻痺の戦慄 | [5.0,6.0] | apply_status Stun [1,2] | front, aoe1, aoe_statuses |
| `bone_breath` | 骨のブレス | [3.4,4.2] | multi_strike (verify param semantics; scale to a boss) | front, pen2, aoe2 |
| `necrotic_roar` | 屍毒の咆哮 | [5.5,6.5] | apply_status Weakness [4,6] | front, aoe2, aoe_statuses |

All ids must be globally unique in the ledger (machine check enforces).

## Packs (batch-005, schema monster_pack/1) — layouts on B2:Y17

Layout intent: melee column front (left), support behind (right), boss center-left. Derived
cells shown for review; the validator (`shared/content_validate.cjs`) is the authority — if an
anchor is mis-derived here, fix it MINIMALLY preserving the intent and record the fix.

| pack | members (enemy @ anchor → derived cells) |
|---|---|
| `pack_grave_shamble` 墓場の彷徨 | zombie@B2→B2:D5 · zombie@B7→B7:D10 · mummy@B12→B12:D15 · ghost@F4→F4:H7 |
| `pack_grave_legion` 墓場の軍団 | skeleton_warrior@B3→B3:D6 · wight@B9→B9:D12 · zombie@B13→B13:D16 · necromancer@G6→G6:I9 · ghost@G11→G11:I14 |
| `pack_bone_court` 骸骨の王廷 | bone_dragon@B4→B4:K13 · lich@N6→N6:Q10 · ghost@N12→N12:P15 · necromancer@S8→S8:U11 |

`note` field on each pack: one line naming the synergy (Weakness appliers → converters, etc).

## Ships

- `content/batches/batch-005-grave-legion/` — enemies.json + skills.json + packs.json (+
  whatever companion files `promote_dungeon_batch.cjs` requires — study batch-002's shape).
- vocab.json + `content_checks.cjs` enemy dialect: the three verbs, admitted exactly.
- `sim/lib/` enemy executor: the three verbs, deterministic, rng-disciplined.
- Parity: forecast / any engine copy that predicts or replays enemy skills.
- Tests: dialect (new verbs PASS, unknown verb FAILs by name), sim unit tests per verb,
  transpose pin (batch-005 footprint == artwork shape transposed, proven against the 3x4 and
  4x5 NON-SQUARE cases), pack layouts PASS the shared validator, legacy paths untouched
  (goldens must NOT move — nothing references the new packs; if a golden moves, something
  leaked).
- **Promotion must be ADDITIVE**: `content/live/dungeon/{enemies,skills}.json` currently carry
  batch-002; packs.json carries REQ-0184's 4. Study how `promote_dungeon_batch.cjs` merges a
  second batch BEFORE writing content — if it replaces wholesale, extend it to merge with
  provenance. batch-002 live content must survive byte-identically.
- **Worktree trap (REQ-0184 found-in-flight, verbatim):** `promote_dungeon_batch.cjs` resolves
  its live dir via `os.homedir()` and `sim/tests/run.cjs` reads live/ the same way — running
  them from a worktree writes to / reads from the MAIN checkout. Always pass an explicit
  `liveDir` / point `HOME` at the worktree. The main checkout is HANDS-OFF.
- NO `dungeon.json` change, NO dungen change (REQ-0185's seam stays shut).
- contentadmin: expected ZERO code change (monster_def/skill_def/monster_pack all render
  already). Verify the pack board resolves batch-005 member footprints from art — the two
  rosters finally meet, closing REQ-0184's honest gap for these packs.

## Gates

- G1 dialect: every batch-005 entry PASSes machine checks; an unknown verb / out-of-vocab
  status / dup id FAILs by name.
- G2 sim: per-verb unit tests green; determinism (two same-seed runs byte-identical).
- G3 parity: one executable test per forced copy pair.
- G4 transpose: non-square pins for [4,3] and [5,4].
- G5 `tools/ci.sh` GREEN (worktree, SKIP_PG=1 SKIP_E2E=1 at minimum; run the admin e2e harness
  for the contentadmin board if feasible under the port rule: REQ-0203 owns ports 2030-2039).
- G6 (deploy, post-merge, orchestrator): promote batch-005 additively; backfill; expect
  monster_def 7→15, skill_def 14→30, monster_pack 4→7, all PASS, all adopted; board verified
  in the live admin.
- S7 user acceptance.

## Out of scope

- Dungeon/encounter wiring (REQ-0185), batch-002 re-composition, art generation/adoption
  (orchestrator-owned, queue-based only), REQ-0188's guard/seed/mirror tools (in flight on its
  own branch — do NOT duplicate them here).
