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

---

## Implementation & Results (2026-07-17)

**Built = all gates G1-G5 GREEN in the worktree; NOT deployed.** G6 (promote/backfill)
and S7 (user acceptance) are pending. Live counts confirmed READ-ONLY before starting:
monster_def=7, skill_def=14, monster_pack=4 (the promised 7/14/4 baseline).

### Commits (branch `req-0203-grave-legion-roster-packs`)
- `a9a2a1c` add heal_ally verb to vocab + eff_render (EN/JA)
- `c542276` enemy-verb executor -- lifesteal, bonus_vs_status (active), heal_ally (deterministic, rng-disciplined)
- `7accf0a` forecast parity -- lifesteal/bonus_vs_status count as incoming damage in both forecast copies
- `722398d` batch-005-grave-legion content -- 8 enemies, 16 skills, 3 packs (footprints = art shape transposed)
- `6068d6c` promote_dungeon_batch --additive mode (byte-preserving entry merge, id-collision refusal, provenance)
- `e5f9457` gates -- G1/G2/G4/packs/additive suite, G3 forecast parity, G5 board resolution; wired into ci.sh

### Gate results
- **G1 dialect** -- PASS. `sim/tests/req0203_grave_legion_test.cjs`: every batch-005 enemy
  (monster_def/enemy/1) and skill (skill_def/skill/1) PASSes `runChecks`; an unknown verb
  (`necrotic_smite`) and an out-of-vocab status (`Doom`) each FAIL by name; batch-005 ids are
  disjoint from the live corpus and unique within the batch. NOTE (found-in-flight): the
  skill/1 dialect needed **no code change** -- `checkEffects` already admits any vocab verb and
  fails an unknown one by name, so adding `heal_ally` to vocab.json (verbs + ranged_verb_params)
  was sufficient; `lifesteal`/`bonus_vs_status` were already in vocab.
- **G2 sim** -- PASS. Same file: `dealHitOnField` lifesteal (strike n, heal SELF by frac of
  damage dealt; heals nobody with no self actor), bonus_vs_status (x mult ONLY when the target
  carries the status), `selectHealAllyTarget` (lowest-HP living ally, never self unless alone),
  a synthetic heal_ally integration (no ray, event fires, targets an ally), a pinned real-content
  run exercising all three verbs, and DETERMINISM (two same-seed runs byte-identical). All RNG via
  named streams; zero `Math.random`.
- **G3 parity** -- PASS. `sim/tests/forecast_parity.cjs` (18/18): `expectedDamagePerFire` byte-
  agrees across the forced-copy pair server/lib/forecast.cjs <-> shared/forecast.mjs for
  strike/multi_strike/lifesteal/bonus_vs_status/heal_ally; lifesteal & bonus_vs_status fold to the
  BASE n midpoint, heal_ally folds to 0 (enemy-side). DAMAGE_VERBS classification pinned (lifesteal
  + bonus_vs_status counted; heal_ally never). Found-in-flight: `mock-src/engine.js` executes NO
  enemy skills (grep-verified), so it is not a forced-copy site.
- **G4 transpose** -- PASS. Footprints authored as artwork `shape {w,h}` TRANSPOSED to `[h,w]`,
  verified READ-ONLY against `artworks.shape` (2026-07-17): zombie/ghost/mummy/skeleton_warrior/
  wight/necromancer 3x4 -> [4,3]; lich 4x5 -> [5,4]; bone_dragon 10x10 -> [10,10]. Non-square pins
  for [4,3] and [5,4] assert the axis, not just equality (catch the REQ-0029 flip).
- **G5 ci.sh** -- GREEN (`SKIP_PG=1 SKIP_E2E=1`), including the client typecheck+build and the two
  new steps `[2.7]` (req0203 suite, 15/15) and `[5.76]` (board resolution). Determinism goldens
  intact (`goldens OK (12 cases)`) and `sim/tests/run.cjs` still 117/117 -- **no golden moved,
  nothing leaked.** Board (contentadmin, ZERO code change) verified via
  `client/scripts/check_pack_board_grave_legion.mjs`: every batch-005 pack member resolves its
  footprint from art and it EQUALS the sim's authored footprint (the two rosters meet); `wight`
  resolves only once its content_def carries the deploy artwork_ref.

### Design deviations (with reasons)
- **pack_role**: the spec's skirmish/bruiser/elite are NOT attested (dungen understands only
  line/support/anchor/boss; unknown roles silently fall back to `line`). Mapped to the nearest
  attested value (REQ-0160: no lookalike lie): ghost skirmish->`line`; skeleton_warrior bruiser
  ->`anchor`; wight & lich elite->`anchor`; zombie/mummy `line`; necromancer `support`;
  bone_dragon `boss`. Placement is authored explicitly (`members[].at`), so pack_role only matters
  if dungen ever samples the roster (out of scope).
- **rarity**: vocab.json has no `boss` rarity; highest tier is `Relic`. bone_dragon uses `relic`
  (enemy/1 lowercase dialect), as the spec's "top vocab rarity" instructs.
- **bonus_vs_status (active vs folded)**: vocab's `bonus_vs_status` already exists as a
  *battle_start-FOLDED additive* rider (packs.cjs foldBattleStartStatusVerbs). The spec's enemy
  intent is an *active per-skill multiplier* strike. Implemented as a distinct branch in
  `dealHitOnField` keyed on the active every_secs verb (weakness mult first, then x`mult` if the
  target carries the status, then damage_reduction) -- the nearest HONEST semantic, documented in
  code; it never touches the folded path (batch-005 uses no battle_start bonus_vs_status).
- **heal_ally (no ray)**: a support verb with no incoming ray. The executor intercepts it in the
  enemy skill-fire branch BEFORE any ray is fired; its skill's attack_profile carries an empty
  `edge` to honestly declare "projects no ray". Excluded from the incoming-pressure forecast.
- **haunting_chill aoe**: given `aoe:1` so its authored `aoe_statuses` actually spreads Chill
  (aoe_statuses is inert at aoe:0). Ray typing stays side/pen0.
- **bone_breath**: `multi_strike n=[8,14] x hits:3`, front/pen2/aoe2 -- numbers agent-scaled to a
  boss under the design's "scale to a boss" delegation.
- **artwork_ref**: enemies.json carries NO artwork_ref field (byte-shape-identical to batch-002;
  batch-002's frost_gnoll ref lives only in the DB column). 7 ids resolve to their art by exact
  name; `wight`'s art is `monsters-003-flux2:wight`, so its content_def needs an explicit
  artwork_ref set at deploy -- exactly the frost_gnoll -> monsters-003-flux2:gnoll precedent.

### Found-in-flight
- **Promotion would WIPE batch-002.** `promote_dungeon_batch.cjs` byte-copies 7 files WHOLESALE
  and requires all 7; promoting batch-005 (which ships 3) would refuse, and a naive replace would
  delete batch-002 + REQ-0184. Added `promoteAdditive` (`--additive`): a byte-PRESERVING splice
  that appends entries to the live enemies/skills/packs, refuses id collisions, records provenance
  under `registry.live_dungeon_additive`, and never touches the other 4 live files. The wholesale
  `promote()` is untouched (its REQ-0122/0184 tests stay green).
- **Worktree trap honored**: every promote/test call passes an explicit `liveDir`/`registryPath`;
  the MAIN checkout was never written. Root deps were unprovisioned -- installed with
  `pnpm install --frozen-lockfile` (no lockfile change).

### Deploy commands the orchestrator must run POST-MERGE (G6)
Run from the MAIN checkout `~/backpack_ragnarok` after merge to master. Explicit liveDir avoids
the worktree trap:
```
# 1. Additive promotion (batch-002 + REQ-0184 survive byte-for-byte)
cd ~/backpack_ragnarok && node -e "require('./tools/promote_dungeon_batch.cjs').promoteAdditive('content/batches/batch-005-grave-legion',{liveDir:process.env.HOME+'/backpack_ragnarok/content/live/dungeon',registryPath:process.env.HOME+'/backpack_ragnarok/content/registry.json'})"

# 2. Backfill the registry (pg env the api uses)
set -a; . ~/backpack_ragnarok/server/.env; set +a
cd ~/backpack_ragnarok && node tools/backfill_content_registry.cjs --dry-run   # inventory
cd ~/backpack_ragnarok && node tools/backfill_content_registry.cjs             # apply

# 3. Set wight's artwork_ref (its art is namespaced; matches the frost_gnoll precedent)
#    via updateContentDef / the contentadmin PATCH:
cd ~/backpack_ragnarok && node -e "(async()=>{await require('./server/storage_content.cjs').updateContentDef('wight',{artwork_ref:'monsters-003-flux2:wight'});process.exit(0)})()"

# 4. Rebuild + commit the client dist (vocab.json is bundled into the client; the heal_ally
#    verb must reach the built app) -- the "deploy: rebuild client dist" pattern:
cd ~/backpack_ragnarok/client && pnpm run build
```
Expected after backfill: **monster_def 7->15, skill_def 14->30, monster_pack 4->7**, all PASS,
all adopted; the contentadmin pack board resolves every batch-005 member footprint from art
(bone_dragon 10x10, lich 5x4, the rest 4x3), wight included.

## Deploy record (2026-07-17, orchestrator)
Merged to master; combined CI GREEN. promoteAdditive -> live (enemies 15, skills 30, packs 7; batch-002 + REQ-0184 byte-preserved). Backfill: monster_def 15 adopted PASS (a0407909:frost_gnoll stray is pre-existing, not ours), skill_def 30, monster_pack 7 all PASS/adopted. wight artwork_ref PATCHed to monsters-003-flux2:wight. Client dist unchanged by construction (0203 client change was a check script only). backpack-api restart deferred until the user art queue drains (in-memory queue lesson, this session). Awaiting S7.
