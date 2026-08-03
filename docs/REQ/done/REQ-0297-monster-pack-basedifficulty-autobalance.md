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
- **PHASE STATUS:** Phase 1/2/3 all BUILT+ORCHESTRATOR-AUDITED. NEXT = INTEGRATED DEPLOY (Phase 2+3 together; see runbook at end). NOT merged/deployed.
- **DEPLOY WARNING:** do NOT deploy Phase 2 alone -- retiring dungeon-level scaling leaves live enemies UNSCALED until Phase 3 generates pack.powerLevel. Phase 2 + Phase 3 deploy TOGETHER.
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

## Phase 3 - All-pairs round-robin auto-adjuster + content-edit trigger  [BUILT -- tool + tests green; live-content EMIT DEFERRED to integrated deploy]
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

### Phase 3 BUILD RECORD (2026-07-24) -- commit 45d443b (tool + tests); live-content EMIT DEFERRED
- **Tool:** `tools/autobalance_pack_powerlevel.cjs` -- troop-FREE all-pairs round-robin over
  sim/balance/monster_arena.cjs. Every pack fights EVERY other in BOTH orientations (A-vs-B and
  B-vs-A) x SEEDS seeds (seeds keyed on the id-sorted pair => entry-order invariant). Both
  orientations are REQUIRED: the arena has a fire-order/field-band positional bias (slot B won
  ~65:26 of 91 duels at eff 0); playing each pair both ways cancels it exactly. Each pack presents
  at effLevel = -powerLevel (T=0); the arena scales its hp+damage by g^effLevel (shipped profile
  g=1.1). Aggregate win-rate vs the field (win=1, loss=0, draw/timeout broken by remaining
  hp-fraction so scoreA+scoreB=1 => mean exactly 50%). Update ALL packs simultaneously (Jacobi):
  dPowerLevel = alpha*(winRate%-50)/10, FRACTIONAL (never rounded); a WINNER gets powerLevel RAISED.
- **NO anchor -- verified empirically:** mean(powerLevel) stays 0 to ~1e-16 EVERY loop (round-robin
  mean win-rate is exactly 50% by construction), so the set self-centres with no reference pack.
- **Convergence (chosen defaults alpha=0.7 / loops=8 / seeds=6):** on the 14 live packs the residual
  mean|winRate-50| settles 24.6 -> 11.3(L4) -> 6.8(L5) -> 1.9(L6) -> 1.6(L8); max|res| -> 3.2%;
  per-loop max dPowerLevel -> ~0.27; timeouts -> 0; every pack ends within 47.4..53.2%. Runtime ~7s.
  Sweep evidence: alpha 0.5 needs ~10 loops; 0.6/0.7/0.8 all settle cleanly by L5-8; alpha>=1.0
  mildly OSCILLATES (max-residual wanders 3.9->7.0, mean creeps up). 0.7 chosen: in the user's
  suggested {0.3,0.5,0.7}, safely below the oscillation edge, fully settled with 2 flat loops margin.
- **DERIVED powerLevel (live packs; deterministic, STRONG pack = HIGH powerLevel):** titan_ridge
  +12.8333, deep_tide +11.1282, demon_gate +9.4231, bone_court +6.4167, hrimgrimnir +4.9359,
  petrifying_court +2.3782, venom_nest +1.3910, greenskin_warband -0.1346, grave_legion -0.4038,
  wild_hunt -1.7949, grave_shamble -5.8333, bear_and_stalker -5.8782, rime_choir -17.1410,
  frost_scouts -17.3205. The ~30-wide spread is the TRUE content imbalance (2-monster frost_scouts
  vs behemoth-led titan_ridge); it is normalised at runtime by effLevel=attackLv-powerLevel.
- **Tests:** `sim/tests/req0297_phase3_test.cjs` (6 cases, wired into run.cjs): determinism, convergence
  (synthetic strong/mid/weak field -> exactly 50% by L4), SIGN (winner raised, strong>mid>weak, +/-),
  no-anchor (mean win-rate exactly 50%; mean(powerLevel) conserved =0 every loop), win-score tiebreak.
  Fast (~0.3s tiny synthetic set; the full round-robin is ~7s). run.cjs 177/0.
- **Trigger (--check):** compares live enemies/skills/packs sha256 to a stored `powerlevel_calibrated_from`
  marker in registry.json; exits 1 (DIRTY) when they differ / no marker. Deploy hook (documented in the
  tool header, not wired to a live script): a pre-deploy step runs --check and, when dirty, runs --emit
  ONCE, BATCHED at merge/deploy; a clean deploy skips it. Do NOT run per single edit.
- **--emit DEFERRED (functional but NOT committed) -- exact integrated-deploy sync:** --emit writes
  powerLevel into live packs.json (all 14, byte-preserving line insert after each id), batch-002 base
  packs.json (its 4 base packs byte-identically), re-stamps registry's LAST additive-layer packs.json
  sha256, and sets the marker. VERIFIED after --emit: goldens BYTE-IDENTICAL (goldens compile with no
  scaling profile => powerLevel inert) and the diff is clean. BUT the REQ-0122 lossless test reads live
  content via dungen.liveDungeonDir() = os.homedir() -> ~/backpack_ragnarok (the MAIN CHECKOUT) while
  the emit updates the WORKTREE registry -- so an in-worktree-only emit makes the worktree registry (new
  sha) disagree with the UNTOUCHED main-checkout live (old sha) and REDDENS the lossless test. PROJECT.md
  forbids touching the main checkout, so the emit is REVERTED + DEFERRED. EXACT SYNC (orchestrator, atomic,
  BOTH checkouts): (1) run `node tools/autobalance_pack_powerlevel.cjs --emit`; (2) apply the SAME
  powerLevel edits to the MAIN checkout ~/backpack_ragnarok (live packs.json all-14 + batch-002 base + registry
  sha/marker); (3) ALSO add the same per-pack powerLevel to the ADDITIVE SOURCE batches' packs.json
  (batch-005-grave-legion, batch-006-wildlands, batch-007-deepstone-legions -- the 10 non-base packs) for
  a byte-lossless future re-promotion (--emit does NOT touch these; the lossless test does not read them,
  but re-promotion would); (4) re-run goldens (byte-identical) + run.cjs (REQ-0122 green once registry +
  both checkouts' live agree) + commit to master. Deploy TOGETHER with Phase 2 (DEPLOY WARNING): Phase 2
  retired dungeon-level scaling, so live enemies stay UNSCALED until these powerLevels ship.

## Acceptance (whole feature)
- Phase 1: goldens byte-identical; verb-firing auto-test green. [DONE]
- Phase 2: per-pack effLevel live; effLevel-0 byte-identical; ±25 guard test green; goldens/sim/api green.
- Phase 3: round-robin deterministic + reproducible; generated powerLevel self-normalises (arena
  win rates across packs settle near 50% at a common presentation); dirty-trigger runs at deploy.
- End-to-end: same attackLv -> constant monster strength across draws (empirical arena check).

## Gate results / commit hashes
- Phase 1: 8d8b175, 04a233b (audited; goldens byte-identical, sim 158/0).
- Phase 2: 5007e16 (per-pack runtime + scaling round-to-0 care), c3ca8be (13 tests + wire). goldens 12/12 byte-identical, run.cjs 171/0, coverage --gate OK. Live powerLevel DEFERRED (Phase-3 surgical path); main checkout untouched.
  ORCHESTRATOR-AUDITED (independent): goldens re-run byte-identical + fixtures untouched; diffs reviewed (effLevelForPack absent->0, factor-1 hp-floor gated on scaledHp!==def.hp, warn-not-cap); sanity g^BOSS_LV_BONUS=1.1500, effLevelForPack(5,2,boss)=4.4664, hp[30,45]@eff-25=[2.77,4.15] (>0).
- Phase 3: 45d443b (tool `tools/autobalance_pack_powerlevel.cjs` + 6 phase-3 tests wired into run.cjs).
  goldens 12/12 BYTE-IDENTICAL, run.cjs 177/0 (171 + 6). Convergence alpha0.7/loops8/seeds6: mean|winRate-50|
  24.6->1.6, max->3.2%, mean(powerLevel)=0 conserved (~1e-16); every live pack settles within 47.4..53.2%.
  Derived powerLevel (STRONG=HIGH): titan_ridge +12.83 ... frost_scouts -17.32 (full list in Phase 3 BUILD
  RECORD). --check dirty-trigger built. --emit functional + goldens-safe but DEFERRED/reverted (NOT committed):
  a worktree-only emit reddens the REQ-0122 lossless test because it reads MAIN-checkout live via os.homedir();
  exact integrated-deploy sync (both checkouts + additive source batches) flagged in the BUILD RECORD.


## Phase 3 - ORCHESTRATOR-AUDITED (2026-07-23)
Tool tools/autobalance_pack_powerlevel.cjs (all-pairs round-robin, both-orientation to cancel the
arena's ~65:26 slot bias, Jacobi ΔpowerLevel=α(winRate-50)/10, α0.7/loops8/seeds6). Commits 45d443b (+docs).
Independent audit: goldens 12/12 BYTE-IDENTICAL (fixtures untouched), sim/tests/run.cjs 177/0 (+6 Phase-3
cases). Convergence reproduced: meanResid 24.63->1.56, maxResid->3.21, every live pack 47.4-53.2% by loop 8;
mean(powerLevel) conserved ~1e-16/loop (no-anchor theory empirically confirmed). powerLevel DETERMINISTIC
(two runs identical; only the diagnostic `runtimeMs` json field varies -- benign, not emitted). --emit
DEFERRED (works + goldens-safe, but REQ-0122 lossless reads the MAIN checkout via os.homedir so a worktree-
only emit reddens it; reverted). Derived powerLevel (STRONG=HIGH): titan_ridge +12.83, deep_tide +11.13,
demon_gate +9.42, bone_court +6.42, hrimgrimnir +4.94, petrifying_court +2.38, venom_nest +1.39,
greenskin_warband -0.13, grave_legion -0.40, wild_hunt -1.79, grave_shamble -5.83, bear_and_stalker -5.88,
rime_choir -17.14, frost_scouts -17.32. The ~30-wide spread = true content power gap (surfaced, not a bug).

## INTEGRATED DEPLOY RUNBOOK (Phase 2 + Phase 3 together -- consequential LIVE balance change)
Retires dungeon-level scaling (REQ-0294/0295 1/15/16) and switches to per-pack: runtime effLevel =
attackLv - pack.powerLevel (+ boss g^1.4664=x1.15). Steps (do NOT half-do; keep REQ-0122 lossless green):
1. In the worktree: `node tools/autobalance_pack_powerlevel.cjs --emit` (writes powerLevel into live
   packs.json[14] + batch-002 base[4] byte-preserving + registry packs.json sha + powerlevel_calibrated_from).
2. Surgically mirror to the MAIN checkout ~/backpack_ragnarok: same powerLevel edits to live packs.json +
   batch-002 base + registry sha/marker (like the REQ-0295 dungeons.json deploy). Confirm live==worktree bytes.
3. Add the same per-pack powerLevel to the ADDITIVE source batches for future re-promotion: batch-005-grave-
   legion(3), batch-006-wildlands(3), batch-007-deepstone-legions(4). (lossless test does not read these but
   re-promotion would.)
4. Merge the branch chain (REQ-0296 + REQ-0297) into master (--no-ff).
5. Restart backpack-api (Phase 2 runtime changed runs.cjs/encounter/level_scale -- CODE, needs restart, unlike
   pure content). Verify /api/health, per-pack scaling live (getScheduleContent packs carry powerLevel; a dive
   scales per pack), goldens + REQ-0122 lossless green from the worktree.
6. git mv REQ-0296 + REQ-0297 built/todo -> done with deploy records.
BALANCE NOTE: at a fixed attackLv the ~30-wide spread means some packs hit near-±25 effLevel if drawn far
from their level; dungeon pack-assignment should keep drawn packs near attackLv (or re-author the extreme
packs closer). The ±25 guard keeps values >0; warnings surface extremes.


## Merged + deployed + LIVE-VERIFIED (2026-07-23)
- Merge commit c374176 (REQ-0296+0297 --no-ff into master). Surgical content deploy of calibrated
  powerLevel: main-checkout live packs.json + batch-002 base + registry (sha/marker) synced; REQ-0122
  lossless GREEN. backpack-api RESTARTED (Phase-2 runtime code); /api/health ok.
- LIVE proof (getScheduleContent + compileEnemyPack on the deployed tree): 14/14 packs carry powerLevel;
  at attackLv 5, pack_frost_scouts (pL -17.32) -> effLevel +22.3 (scaled UP, medHP 360), pack_titan_ridge
  (pL +12.83) -> effLevel -7.83 (scaled DOWN, medHP 112) -- both normalise to attackLv 5's combat power.
- Retired REQ-0294/0295 dungeon-level scaling; monster strength now self-normalises per attackLv across draws.
- Gates on merged master: goldens 12/12 byte-identical, sim 177/0, coverage green, REQ-0122 lossless green.
- DEFERRED (self-healing): additive SOURCE batches 005/006/007 packs.json were NOT given powerLevel; a
  future additive re-promotion of those marks the content dirty -> the Phase-3 auto-adjuster regenerates
  powerLevel, so no data is permanently lost. The current lossless test does not read those sources.
