# REQ-0299 -- Monster-pack flavor skills (weak, name-matching, passive)

## Goal
Every monster referenced by a live monster_pack/1 def (44 unique enemies across
15 packs) gains ONE extra "flavor" skill: weak, thematically matched to the
monster name, and PASSIVE-first (battle_start / on_hp_below / OnSquadBeenHit),
never a new every_secs damage skill. User-ratified 2026-07-24 (proposal + GO,
including the on_death stretch).

## New vocabulary (AGENT-DEFINED, under the standing delegations)
Verb delegation (user 2026-07-14), trigger delegation (user 2026-07-14), plus the
explicit REQ-0299 GO (2026-07-24). vocab v16 -> v17.

1. verb grant_self_status {status, n} -- the owner applies a BUFF status
   (Spikes/Regen/Haste) to ITS OWN statusBag. Distinct from apply_status (targets
   the enemy) and buff_self (stat:damage only). battle_start-folded at pack compile
   (packs.cjs), reusing status.cjs applyStatus + the already-running enemy tick
   (encounter.cjs tickAndEmit) and consumeSpikes. Only the three BUFF_STATUSES are
   legal (validator-guarded). n is a [lo,hi] range, rounded to integer stacks via a
   NEW per-instance stream pack/selfstatus/<eid>#<i> (a named stream is independent
   so content WITHOUT the verb stays byte-identical).
2. trigger on_death -- fires ONCE when the owning enemy dies (hp reaches 0).
   Domain [EnemySkill]. Implemented as a deterministic post-battle.tick() death
   drain in encounter.cjs: after each tick chain resolves (and after pulse
   arrivals), any enemy now dead with an on_death skill fires it once as a one-shot
   ray at the player field, BEFORE the allEnemiesDead/troopWiped termination check
   (so a boss dying blast still lands). Isolated RNG stream death_throes/<id>/<t>;
   deduped via raw._deathFired. No content uses it today so goldens stay
   byte-identical until Phase 2 wires imp/bone_dragon/mummy. LIMITATION: fires on
   the standard enemy-death path; monster-vs-monster arena death is out of scope
   (mirrors the existing OnSquadBeenHit phase-limit).
3. verb death_throes {n} -- the on_death payload: one strike of n into the player
   field. n is a [lo,hi] range.

## Engine touch-points
- shared/content_validate.cjs: validateEffect accepts on_death (no s/hp_frac);
  grant_self_status (status in {Spikes,Regen,Haste} + ranged n); death_throes (n).
- sim/lib/status.cjs foldBattleStartStatusVerbs: also collect battle_start
  grant_self_status -> selfStatuses [{status,n}].
- sim/lib/packs.cjs: resolve selfStatuses per-instance and applyStatus into the
  enemy statusBag.
- sim/lib/encounter.cjs: fireDeathThroes(t) death drain after battle.tick().
- tools/eff_render.cjs + tools/self_test_vocab.cjs: render + coverage fixtures for
  the two verbs and the trigger (REQ-0081 coverage gate).

## The 44 flavor skills (monster -> skill id -> trigger -> verb)
Frost: frost_gnoll/gnoll_snap OnSquadBeenHit strike[2,4]; ice_archer/archer_steady_aim
battle_start buff_self dmg[1,2]; rime_shaman/rime_mantle battle_start status_immune
Chill; glacier_wisp/wisp_freezing_touch OnSquadBeenHit apply_status Chill[1,2];
frostback_bear/bear_frost_hide battle_start damage_reduction[1,3];
niflheim_stalker/stalker_cornered_fury on_hp_below0.4 buff_self dmg[2,4];
hrimgrimnir/hrim_frost_masked battle_start status_immune Chill.
Undead: zombie/zombie_already_rotten battle_start status_immune Poison;
ghost/ghost_incorporeal battle_start damage_reduction[1,3]; mummy/mummy_wrappings
battle_start damage_reduction[1,3] (plus mummy_dying_curse on_death death_throes[3,6]);
skeleton_warrior/skel_no_flesh battle_start status_immune kind:dot; wight/wight_undying
battle_start grant_self_status Regen[1,3]; necromancer/necro_deathly_ward
OnSquadBeenHit apply_status Weakness[1,2]; lich/lich_undying_will battle_start
status_immune Stun; bone_dragon/bonedrag_death_collapse on_death death_throes[8,14].
Wildlands: alpha_werewolf/werewolf_lunar_regen battle_start grant_self_status
Regen[2,3]; dire_wolf/direwolf_harrier_retort OnSquadBeenHit strike[1,3];
boar/boar_wounded_fury on_hp_below0.4 buff_self dmg[2,4]; giant_bat/bat_erratic_flight
battle_start damage_reduction[1,2]; giant_spider/spider_clinging_web OnSquadBeenHit
apply_status Chill[1,2]; giant_scorpion/scorpion_barbed_carapace battle_start
grant_self_status Spikes[1,2]; giant_snake/snake_retaliatory_venom OnSquadBeenHit
apply_status Poison[1,2]; basilisk/basilisk_venom_blooded battle_start status_immune
Poison; imp/imp_death_pop on_death death_throes[4,8]; gargoyle/gargoyle_stone_skin
battle_start damage_reduction[1,3]; dullahan/dullahan_headless battle_start
status_immune Stun; demon_lord/demonlord_wrath on_hp_below0.4 buff_self dmg[3,5].
Deepstone: kraken/kraken_regrowing_tendrils battle_start grant_self_status Regen[2,3];
sea_serpent/seaserpent_cold_native battle_start status_immune Chill;
sahuagin/sahuagin_blood_frenzy on_hp_below0.4 buff_self dmg[2,4]; giant_crab/crab_hard_shell
battle_start damage_reduction[1,3]; medusa/medusa_stone_gaze OnSquadBeenHit apply_status
Stun[0.5,1.0]; cockatrice/cockatrice_bristling_plumage battle_start grant_self_status
Spikes[1,2]; lamia/lamia_shedding_skin battle_start grant_self_status Regen[1,3];
stone_golem/golem_immovable battle_start status_immune Stun; goblin/goblin_cornered_stab
OnSquadBeenHit strike[1,3]; goblin_shaman/shaman_totemic_mending battle_start
grant_self_status Regen[1,2]; kobold/kobold_caltrops battle_start grant_self_status
Spikes[1,2]; orc_warrior/orc_cleaving_riposte OnSquadBeenHit strike[2,4];
ogre/ogre_thick_hide battle_start damage_reduction[2,4]; behemoth/behemoth_last_stand
on_hp_below0.4 buff_self dmg[3,5]; frost_giant/giant_ice_born battle_start status_immune
Chill; cyclops/cyclops_mighty_thews battle_start buff_self dmg[1,3]; troll/troll_regeneration
battle_start grant_self_status Regen[2,4].

Note: on_hp_below buff_self only folds onto strike/multi_strike ranges
(hpbelow.cjs foldFlatBonusInPlace); every enrage pick owns such a skill. Orc has
only a bonus_vs_status skill, so it gets a retaliation strike instead.

## Gates / re-baseline plan
Phase 1 (vocab+validator+engine+coverage): golden-neutral. Green: sim/tests/run.cjs,
goldens.cjs (unchanged), self_test_vocab.cjs. Phase 2 (content): deliberate
`node sim/tests/goldens.cjs gen` re-baseline; update region tests (req0203/0207/0219);
re-run REQ-0297 autobalance_pack_powerlevel.cjs --emit to recalibrate powerLevel +
re-stamp registry sha markers.

## Status
todo -> built (2026-07-24). Implemented; all sim gates green + live-content procs verified. Awaiting deploy (autobalance powerLevel --emit) + user acceptance.

## Outcome / verification (2026-07-24)
Implemented in two phases on this branch.
- Phase 1 (vocab v17 + validator + engine + coverage) is GOLDEN-NEUTRAL and committed
  first: sim/tests/goldens.cjs byte-identical, sim/tests/run.cjs 177/0, self_test_vocab
  ALL GREEN (33 verbs, 21/21 triggers). req0297_verb_firing_test verb/trigger maps
  classify grant_self_status + on_death.
- Phase 2 (44 flavor skill defs in live/dungeon/skills.json + enemies.json wiring).

CORRECTION to the pre-implementation gate plan: goldens.cjs and the region tests
(req0203/0207/0219) load the frozen content/batches/* fixtures, NOT content/live/dungeon/,
so the live content edits are golden-neutral there too -- NO golden re-baseline was needed
and none was done. All green WITH content: run.cjs 177/0, goldens OK, req0203 15/0,
req0207 13/0, req0219 13/0, candidate_gate 10/0, balance_sim 6/0, forecast_parity 18/0,
s4 14/0, unit_charge 13/0 + 24/0, self_test_vocab ALL GREEN.

Live-content verification (two ad-hoc harnesses, not committed):
- compile probe: battle_start folds land on live enemies -- troll Regen(3 stacks),
  ogre damageReduction~3, scorpion Spikes(2), zombie immune Poison, skeleton immune
  {Burn,Poison} (kind:dot), frost_giant immune Chill; behemoth carries on_hp_below
  buff_self; imp carries on_death death_throes.
- integration (combat.runDungeon, sparse_glass squad vs single-monster packs): ALL FIVE
  new runtime procs fire -- reactive_proc on_death (imp death_throes), reactive_proc
  OnSquadBeenHit (necromancer apply_status Weakness), status_tick Regen (troll self-heal),
  reflect_damage (scorpion self-Spikes), passive_proc on_hp_below buff_self (stalker enrage).

DEPLOY-TIME follow-up (NOT a per-REQ gate; autobalance is not in ci.sh): REQ-0297
tools/autobalance_pack_powerlevel.cjs --check is DIRTY by design (enemies.json + skills.json
changed). Per that tool's own doc it is BATCHED at merge/deploy; run --emit at deploy to
recalibrate per-pack powerLevel and re-stamp the registry sha markers. Note the arena that
autobalance measures does not fire OnSquadBeenHit/on_death/on_hp_below (documented m-v-m
limit), so the recalibration captures the battle_start-folded passives + self-status, not
the reactive/death/enrage deltas.

## CORRECTION (2026-07-24, integrated-deploy): batch-authored, not live-edited
The first packaging hand-edited content/live/dungeon/{enemies,skills}.json directly.
That violated the REQ-0122 lossless-promotion invariant (live must decompose into
batch-002 base ++ additive layers; modifying base frost monsters + appending 44 new
skill ids off-provenance). The worktree missed it because run.cjs REQ-0122 reads the
MAIN checkout via dungen.liveDungeonDir() (homedir-anchored), so it only fired at merge.
REPACKAGED correctly: the 44 flavor skills are authored into their SOURCE batches
(frost->batch-002, grave->005, wildlands->006, deepstone->007; enemies.json wiring +
skills.json defs), then live/dungeon + registry are regenerated by the promote pipeline
(promote(batch-002) wholesale + promoteAdditive(005/006/007)); powerLevel via
autobalance --emit. Direct REQ-0122 check (all 8 files, worktree): 19/0. goldens
RE-BASELINED (batch-002 pilot now carries frost flavor -> 8 replays legitimately drift).
Branch green except run.cjs REQ-0122 (reads main checkout -> resolves on merge). Region
tests (0203/0207/0219) still green with the augmented batches.

## DEPLOYED (2026-07-24)
Merged to master (merge 73fd3cc; integrated on top of the concurrently-landed REQ-0301
goldens decouple -- restored the frozen-fixture replay baseline since REQ-0301 makes
goldens content-independent, commit 3c32636). Master gates GREEN from the main checkout:
run.cjs 184/0 (incl REQ-0122 lossless), goldens OK, self_test_vocab ALL GREEN,
autobalance --check CLEAN, region tests 0203/0207/0219 + 0298 green. backpack-api
restarted (PID rolled); /api/health 200; /api/schedule/forecast?dungeonId=niflheim_depths
200 (sim serving live content). backpack-web active (no client change). Live.
