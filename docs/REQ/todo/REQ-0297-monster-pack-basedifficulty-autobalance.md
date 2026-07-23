# REQ-0297 - Monster-pack powerLevel: arena-derived, auto-balanced, per-pack runtime

**Status:** todo (user-ratified 2026-07-23 in chat). Multi-phase, one file (ships together).
NOTE: the slug says "basedifficulty" but the ratified attribute name is **`powerLevel`**
(see Naming). This supersedes REQ-0295's DUNGEON-level baseDifficulty with a PACK-level model.
**Depends on:** REQ-0296 (side-agnostic BattleGroup + sim/balance/monster_arena.cjs). This
branch is BRANCHED FROM the req-0296 branch (contains its commits); REQ-0296 is built+audited,
NOT yet merged to master.

## ================= HANDOFF / RECOVERY (read first if resuming) =================
- Server: `ssh -i ~/.ssh/backpack_ed25519 -o StrictHostKeyChecking=no qtie@192.168.0.6`
  (key install if missing: `install -d -m700 ~/.ssh && install -m600 /sessions/*/mnt/backpack_ragnarok/.keys/id_ed25519 ~/.ssh/backpack_ed25519`).
- Worktree: `~/backpack_ragnarok_worktrees/req-0297-monster-pack-basedifficulty-autobalance`
  branch `req-0297-monster-pack-basedifficulty-autobalance` (base commit 7d5d8aa; based on REQ-0296).
- Node: `export NVM_DIR=~/.nvm; . "$NVM_DIR/nvm.sh"` before `node`. sim/ is dependency-free.
- Gates (run in the worktree): `node sim/tests/goldens.cjs` (MUST be byte-identical, 12 cases),
  `node sim/tests/run.cjs`, `node tools/check_scaling_coverage.cjs --gate`,
  `node sim/balance/monster_arena.cjs <packA> <packB>`. api_test: `cd server && corepack pnpm install
  --frozen-lockfile` then `set -a; . ~/backpack_ragnarok/server/.env; set +a; STORAGE_BACKEND=pg node server/tests/api_test.cjs`.
- Deploy discipline (PROJECT.md): edits stay on the server worktree (NEVER the Cowork mount).
  dungeons/packs content deploy is SURGICAL (edit batch-002 source + byte-identical live copy +
  registry sha256, then copy into the main checkout ~/backpack_ragnarok + commit to master) so the
  REQ-0122 lossless test stays green; api reload is mtime-cached (no restart for content).
- **PHASE STATUS:** Phase 1 = BUILT + audited (committed). Phase 2 = BUILT (runtime + tests green; live powerLevel deploy DEFERRED to the Phase-3 surgical path). Phase 3 = NOT STARTED.
- Orchestration: implement via Opus subagent, orchestrator audits (independent goldens re-run + diff).
=============================================================================

## The model (RATIFIED - final)
- **`powerLevel`** is a per-monster_pack attribute (fractional; can be negative or extreme e.g.
  -13.5 -- that is FINE and meaningful, it is an internal relative measure). STRONG pack = HIGH
  powerLevel. It is the pack's intrinsic combat level, measured troop-FREE by monster-vs-monster.
- **Runtime (user-confirmed):** a pack P appears at `effLevel_P = attackLv - pack.powerLevel`;
  a BOSS pack (referenced from a dungeon's bossPool) gets `+ BOSS_LV_BONUS`. Enemy stats scale
  by `g^effLevel_P`, g=1.1. `BOSS_LV_BONUS = log_1.1(1.15) ~= 1.474` (a ~+15% strength buff), a
  named tunable. dungeon.Lv is the AUTHORING anchor (which packs to assign); it cancels at runtime
  ((attackLv-dungeon.Lv)+(dungeon.Lv-powerLevel) = attackLv-powerLevel).
- **Self-normalising:** every pack presents at the player's attackLv, so monster strength is
  constant across draws at a given attackLv.
- **Sign (CRITICAL - do not invert):** a pack that WINS the round-robin gets powerLevel RAISED
  (=> lower effLevel => scaled down at runtime => normalised). In the user's "appearance-Lv"
  words a 100%-winner is "-5 Lv" (weaker); stored powerLevel moves the OPPOSITE way (+). Confirmed.
- **User-facing "Lv"** is a SEPARATE derived display metric (to be designed later); internal
  powerLevel may be negative/odd and that is acceptable.

## Naming decision
The attribute is **`powerLevel`** (not baseDifficulty / difficultyOffset): strong pack = high,
runtime reads `effLevel = attackLv - powerLevel`. "difficulty"-named options invert intuition
(high value != harder; after normalisation all packs are equal). Reject baseDifficulty/difficultyOffset.

## Phase 1 - Faction-neutral reactive dispatch + verb-firing auto-test  [BUILT + AUDITED]
Additive faction-neutral defensive dispatch in fireEnemyInstanceSlot: a struck MONSTER
(kind==='enemy') fires its OWN OnSquadBeenHit at inst.allies() (map membership), mirroring the
bp-body retaliation; GATED so the standard enemy->player path (struck actors are BPs) emits zero
new events => goldens byte-identical. Commits 8d8b175, 04a233b. Audited independently: goldens
12/12 BYTE-IDENTICAL (fixtures untouched), sim/tests/run.cjs 158/0 (28 new verb-firing cases +
coverage guards + negative control). No current live/batch pack carries a reactive skill (all
every_secs) so this is inert on today's content -- correctness + future-proofing + guard test.

## Phase 2 - Per-pack powerLevel runtime  [BUILT -- tests green; live-content deploy DEFERRED]
- Schema: `powerLevel` (number, fractional) on each monster_pack in packs.json. Boss signal =
  membership in a dungeon def's bossPool (no per-pack flag).
- Runtime: compute effLevel PER PACK at dive time: `effLevel_P = attackLv - pack.powerLevel
  (+ BOSS_LV_BONUS if boss slot)`. Thread per-pack through runDungeon -> runEncounter ->
  compileEnemyPack (already takes effLevel; now per-encounter's pack). Retire the dungeon-level
  scaling of REQ-0293/0295 (dungeon.baseDifficulty no longer drives runtime; dungeon.Lv stays an
  authoring field). Keep effLevel-0 BYTE-IDENTICAL (goldens pass no profile; api_test test_dungeon
  packs get powerLevel s.t. effLevel stays 0). Coverage/dungeon_roll unaffected.
- **Scaling-formula CARE (ratified):** the correction is EXPONENTIAL (level_scale.cjs geometric
  g^effLevel) so a scaled value is mathematically always >0, never negative, never infinite for
  finite effLevel -- the ONLY way it hits literal 0 is integer ROUNDING of a small value. So:
  (a) keep scaled skill/hp values FRACTIONAL through the scaling; do NOT Math.round small values
  to 0; floor hp/per-hit-damage at a tiny positive minimum only as a last resort so nothing
  literally vanishes (smooth gradient -> better calibration convergence + no dead skills).
  (b) do NOT hard-cap the high side (a cap breaks the g^effLevel self-normalisation); at realistic
  powerLevels (+-10 -> factor ~0.4..2.6x) it is tame; if a pack's powerLevel drifts extreme vs the
  field, emit a WARNING (content signal), do not silently cap; keep runtime effLevel moderate via
  sane pack<->dungeon assignment. (c) GUARD TEST: across effLevel +-25, assert every scaled skill
  value is >0 (no dead skill) and finite/sane.

### Phase 2 BUILD RECORD (2026-07-24)  -- commits 5007e16 (runtime+care), c3ca8be (tests)
- **Threading (per-pack):** runs.cjs RETIRED the single dungeon-wide effLevel
  (baseDifficulty no longer read at runtime; dungeon.Lv/baseDifficulty stay
  authoring anchors). It now passes only `scaling: SCALING_PROFILE` + `level`
  (= attackLv = room.level). dungeon.cjs threads `attackLv` (defaults to `level`)
  to each runEncounter; encounter.cjs computes the PER-PACK effLevel WHERE the
  pack def is resolved: `const effLevel = scaling ? effLevelForPack(attackLv,
  packDef.powerLevel, encounterDef.type === 'boss') : 0;` then hands `{scaling,
  effLevel}` to the existing compileEnemyPack. `encounterDef.type === 'boss'` is
  the runtime boss-slot signal (dungeon_roll builds the bossPool pick as the
  type:'boss' encounter). New named tunables live in level_scale.cjs:
  `BOSS_LV_BONUS = log_1.1(1.15) ~= 1.4739`, `EXTREME_EFFLEVEL = 25`, and the pure
  `effLevelForPack(attackLv, powerLevel, isBoss)`.
- **Byte-identical fallback:** effLevelForPack returns 0 when powerLevel is
  non-finite (undefined/null/NaN) -- BEFORE adding the boss bonus, so a boss with
  no powerLevel gets neither bonus nor scaling. And runEncounter only calls it
  when a `scaling` profile is present, so goldens (no profile) never scale. Result:
  goldens 12/12 BYTE-IDENTICAL; api_test test_dungeon (level 1, no powerLevel,
  schedule.cjs determinism replay passes no scaling) stays effLevel 0 = unchanged.
- **Scaling-care:** hp is the ONLY integer-rounded stat (per-hit damage is applied
  fractionally, so it never rounds to 0). packs.cjs floors a scaled-DOWN hp at 1
  ONLY when scaleEnemyHpRange returned a NEW array (factor != 1) and the round hit
  0 -- the factor-1/no-scaling path keeps `scaledHp === def.hp` and is untouched.
  effLevelForPack WARNS (never caps) on |effLevel| > 25.
- **DEFERRED:** no powerLevel values were added to any packs.json (batch-002
  source / live copy / registry sha256) and the main checkout was NOT touched --
  per the task, the live-content deploy is the Phase-3 surgical path. Per-pack
  scaling is proven with SYNTHETIC powerLevel + SYNTHETIC profiles in
  sim/tests/req0297_phase2_test.cjs (13 cases), the REQ-0293 discipline.
- **Gates:** goldens 12/12 byte-identical; run.cjs 171/0 (158 + 13 new);
  check_scaling_coverage --gate OK.

## Phase 3 - All-pairs round-robin auto-adjuster + content-edit trigger  [NOT STARTED]
- Tool (evolve REQ-0295's calibrator; arena-based, troop-FREE): **iterative all-pairs round-robin.**
  Each loop: present every pack at effLevel = T - powerLevel (T = field mean, effectively 0), fight
  ALL pairs N seeds via sim/balance/monster_arena.cjs; compute each pack's aggregate win-rate vs the
  field; update ALL packs simultaneously by `ΔpowerLevel = α * (winRate% - 50) / 10` (α~=0.5 tunable,
  FRACTIONAL, naturally within +-5α); iterate ~5 loops. Deterministic (fixed seeds). `--report/--emit/--check`.
- **NO external anchor (theory):** in a full round-robin mean win-rate is EXACTLY 50% (Σ wins = total
  games; equal game counts => Σ winRate = N/2 => mean 50%), so mean ΔpowerLevel = 0 every loop =>
  mean(powerLevel) is EXACTLY conserved => the set self-centres on the field average (powerLevel=0 =
  average pack). Do NOT add a reference pack / re-anchor. Global drift is allowed and meaningful.
- **Smoothing:** the user's 10%->1Lv bucket table is the SHAPE only; use the damped fractional linear
  rule above; VALIDATE convergence empirically (residual win-rates settle near 50% within ~5 loops;
  if not, lower α / add loops / Gauss-Seidel). Round-robin aggregate is smoother than single duels.
- **Trigger (user-refined):** editing level-affecting content (skill/monster/monster_pack) marks the
  pack domain DIRTY (compare live content sha256 in registry.json vs a stored calibrated-from hash);
  the round-robin runs ONCE, BATCHED, at MERGE/DEPLOY time when dirty (a pre-deploy step), regenerates
  every pack.powerLevel, records the new hash, ships regenerated packs.json via the surgical path. A
  clean deploy skips it. Do NOT run per single edit.

## Acceptance (whole feature)
- Phase 1: goldens byte-identical; verb-firing auto-test green. [DONE]
- Phase 2: per-pack effLevel live; effLevel-0 byte-identical; ±25 guard test green; goldens/sim/api green.
- Phase 3: round-robin deterministic + reproducible; generated powerLevel self-normalises (arena
  win rates across packs settle near 50% at a common presentation); dirty-trigger runs at deploy.
- End-to-end: same attackLv -> constant monster strength across draws (empirical arena check).

## Gate results / commit hashes
- Phase 1: 8d8b175, 04a233b (audited; goldens byte-identical, sim 158/0).
- Phase 2: 5007e16 (per-pack runtime + scaling round-to-0 care), c3ca8be (13 tests + wire). goldens 12/12 byte-identical, run.cjs 171/0, coverage --gate OK. Live powerLevel DEFERRED (Phase-3 surgical path); main checkout untouched.
- Phase 3: _(on build)_
