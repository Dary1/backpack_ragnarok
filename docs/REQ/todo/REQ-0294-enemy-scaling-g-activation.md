# REQ-0294 - Enemy Scaling g Activation

**Status:** todo (design ratified by user 2026-07-23; cleared)
**Depends on:** REQ-0293 (engine, shipped neutral), REQ-0269 (balance-sim), REQ-0275 (on-ladder authoring).

## What
Turn REQ-0293's neutral scaling ON: a gentle ~10%/Lv geometric curve, factor unbounded
(user 2026-07-23: "10%/Lv程度の緩やかさ 一旦それで" + "max, no upper limit").

## Changes
- content/scaling_profile.json: geometric g=1.1 on enemy.hp and damage magnitudes
  (verb.strike/multi_strike/charge_strike.n) and verb.heal_ally.n. apply_status.n,
  trigger.every_secs.s, lifesteal/bonus_vs_status, hits/mult/frac and attack_profile
  integers stay FLAT (DPS growth via magnitude only -> dps-proxy exact; no fractional
  status magnitudes). No clampMaxFactor.
- server/services/runs.cjs: effLevel = max(0, attackLv - baseDifficulty); the levelMax
  upper clamp is removed so the factor is UNBOUNDED in attackLv.

## Behaviour
- Live dives now scale enemy hp/damage/heals by 1.1^(attackLv - baseDifficulty). At
  attackLv == baseDifficulty (every existing api dive runs at level 1 == test_dungeon
  levelMin) effLevel is 0 -> factor 1 -> unchanged. goldens pass no scaling profile ->
  byte-identical regardless of g.
- NOT yet self-normalised across draws: the authored rosters are not on a 1.1 ladder by
  baseDifficulty (niflheim medHP38/DPS4.4, grave 100/2.6, beast 98/2.0). Within-dungeon
  scaling is correct; exact cross-draw parity is REQ-0275 (author rosters on the ladder
  / set baseDifficulty to the authored power tier).

## Acceptance
- goldens byte-identical; full sim suite green; coverage gate green (total coverage, now
  a live non-identity profile); api_test 194/0 (all dives at effLevel 0); new unit test
  locks g=1.1 scaling + unbounded effLevel.

## Gate results / commit hashes
**Built 2026-07-23** on branch req-0294-enemy-scaling-g-activation (base master ce0d173).

Commits: feat (profile g=1.1 + runs.cjs unbounded effLevel), docs (reserved->todo), test (synthetic identity fixture + activation lock).

Gate results (verified by orchestrator):
- content/scaling_profile.json: geometric g=1.1 on enemy.hp, verb.strike/multi_strike/charge_strike.n, verb.heal_ally.n; apply_status.n + trigger.s + lifesteal/bonus_vs_status + hits/mult/frac + attack_profile integers FLAT. No clampMaxFactor.
- runs.cjs: effLevel = max(0, attackLv - baseDifficulty) -- levelMax upper clamp removed (unbounded).
- sim suite (sim/tests/run.cjs): 130 passed, 0 failed (3 former identity tests re-based onto a SYNTHETIC all-flat fixture; new REQ-0294 lock: hp/strike 1.1^effLevel, unbounded, status/cadence flat).
- goldens (sim/tests/goldens.cjs): 12/12 byte-identical (goldens pass no profile).
- coverage gate: 14/14 covered (rule presence unchanged).
- api_test.cjs: 194 passed / 0 failed (1641 assertions, pg) -- every dive runs at level 1 == test_dungeon levelMin, so effLevel 0 -> factor 1 -> unchanged.
- scale sanity: effLevel 3 -> 1.331x, 7 -> 1.949x, 20 -> 6.727x (1.1^effLevel, unbounded).
