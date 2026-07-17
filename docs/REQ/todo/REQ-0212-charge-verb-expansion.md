# REQ-0212 — charge-verb expansion: charge_strike / transfer_status / shield_break (+3 art-first units)

**Ratified:** 2026-07-17 (user, chat): 「必要な動詞はじゃんじゃんあなたの意思で
追加して、REQを立てて、サブエージェント(Opus4.8に実装させてしまって構いません)」
— under the standing verbs/targets/triggers delegation recorded in
content/vocab.json (user 2026-07-14 「後は、私に聞かないで、必要になったら
あなたが定義してください」). All three verbs are AGENT-DEFINED and must be
labelled so in vocab provenance.

## What — three new charge-effect verbs (vocab v16)

1. `charge_strike` `{n:[lo,hi]}` — on spend, deal `n × stacks_spent` damage
   (one hit) from the host BP. Only meaningful under `fire_on_full` (stacks
   at spend == rolled capacity); under other spends validation must REJECT it.
   Design carrier: **powder_keg** (OnBPBeenHit / gain count / cap [10,15] /
   fire_on_full / charge_strike {n:[4,6]} -> self).
2. `transfer_status` `{n:[lo,hi]}` — move up to n NEGATIVE statuses
   (Burn/Poison/Chill/Stun/Weakness — the non-beneficial status_kinds) from
   the host BP hierarchy onto the enemy squad; each moved status keeps its
   remaining stacks/duration. Design carrier: **cursed_doll**
   (on_status_applied / gain count / cap [2,3] / fire_on_full /
   transfer_status {n:[1,2]} -> self).
3. `shield_break` `{n:[lo,hi]}` — remove up to n points of the enemy's
   active block/shield pool (no damage; floor at 0). Design carrier:
   **battle_pickaxe** (on_connected_unit_attack / gain count / cap [3,4] /
   fire_on_full / shield_break {n:[10,15]} -> self).

## Where (the REQ-0200 pattern, verb-for-verb)

- content/vocab.json: verbs list + charge.effect_verbs entries (AGENT-DEFINED
  labels, version bump, deprecated untouched).
- shared/content_validate.cjs: param schemas (n range), the
  charge_strike×fire_on_full-only rule in validateCharge().
- sim/lib/unit_charge.cjs: runtime for all three (grounded in the real
  combat model: damage entry point, status store, enemy block pool).
- tools/eff_render.cjs: renderCharge() lines for all three (ja+en).
- tools/self_test_vocab.cjs: one fixture per verb (the REQ-0081 coverage
  gate must hold them honest).
- sim tests: unit-context fixtures proving each verb's end-to-end effect in
  combat.runDungeon (damage lands, statuses actually move, block actually
  drops), plus validation rejections (charge_strike under passive_per_stack).

## Then — the three carrier units (content, same REQ)

- Ingest+review+adopt the 3 unit defs into the Content Data Registry
  (source llm, machine_check must PASS against the NEW vocab).
- Append the 3 entries to content/live/live_units.json byte-identical to the
  adopted registry data, and extend the `arsenal` pack pool (REQ-0213) with:
  powder_keg weight 2, cursed_doll weight 2, battle_pickaxe weight 3.
  If REQ-0213 is not yet merged when this lands, rebase on it — the pack
  must exist first; coordinate via master.

## Gates

Full ci.sh green in this worktree (sim, goldens, self_test_vocab, check_units,
server files+pg, client, admin trio, default e2e). Icons: the artworks
items005_powder_keg / items005_cursed_doll / items005_battle_pickaxe are
already adopted; no art work in this REQ.

## Out of scope

- Any enemy-side (monster skill) use of these verbs; enemy dialect is
  REQ-0161 territory.
- Forecast changes: these are player-side unit verbs; the enemy-facing
  pressure model does not read them.


## Implementation log (2026-07-17, sub-agent Opus 4.8)

### Engine + vocab (DONE, gates green)

Vocab v16 (content/vocab.json): `charge_strike` / `transfer_status` /
`shield_break` added to `verbs` + `ranged_verb_params` (each carries `n`) +
`charge.effect_verbs` + `provenance`, all labelled **AGENT-DEFINED 2026-07-17**.
`deprecated` untouched.

Grounding (verb-for-verb, REQ-0200 pattern):
- `shared/content_validate.cjs` validateCharge(): rejects `charge_strike` BY NAME
  unless `spend=fire_on_full`.
- `sim/lib/unit_charge.cjs` groundVerb: `charge_strike` = n × stacks_spent (the
  consumed counter, fed via ctx); `transfer_status` / `shield_break` record the count.
- `sim/lib/unit_charge_encounter.cjs` + `sim/lib/encounter.cjs` (chargeOps):
  `charge_strike` -> a REAL strike ray into the enemy (strikeFromBp) + a
  `unit_charge_strike` event; `transfer_status` MOVES negative statuses
  (status.cjs DEBUFF_STATUSES) off the host BP onto the first living enemy, keeping
  each status's stacks/duration; `shield_break` strips flat block
  (`ref.damageReduction` -- the pool `reduceIncoming` reads) off every living enemy,
  floor 0, no damage. All charge-guarded -> goldens byte-identical.
- `tools/eff_render.cjs`: renderCharge + PO verb phrases (en+ja) for all three.
- `tools/self_test_vocab.cjs`: one charge fixture per verb (coverage now 31 verbs).
- `sim/tests/unit_charge_encounter_test.cjs`: end-to-end combat proofs
  (charge_strike lands + scales with capacity; transfer_status moves host->enemy;
  shield_break reduces enemy block) + the validation-rejection test. 23 passed / 0.

Commits (branch req-0212-charge-verb-expansion):
- `4006083` vocab v16
- `1460297` validateCharge charge_strike fire_on_full-only
- `e4a27e5` ground the three verbs in the real combat model
- `4043ef3` render (en+ja) + self-test fixtures
- `acc4048` end-to-end combat + validation-rejection tests

Gate results (flock `tools/ci.sh`, 2026-07-17):
- self_test_vocab: ALL GREEN (31 verbs, 20/20 triggers)
- sim/tests/run.cjs: **117 passed / 0 failed**
- unit_charge_test: **13/0**; unit_charge_encounter_test: **23/0**
- goldens: OK (12 cases); s4_test: **14/0**; forecast_parity: green
- check_units: ALL GREEN (42 defs, 30 charge blocks); check_engine_types: OK
- `tsc -p tsconfig.server.json`: exit 0 (after provisioning `server/node_modules`
  -- the fresh worktree lacked the server package's own `pg` install; main has it,
  so tsc was green there. Diff-independent env gap.)
- content_checks_unit_deep_test: **6/0**; units003_acceptance: ALL GREEN
- Full ci.sh: **186 e2e passed, 1 skipped, 1 FAILED** =
  `e2e/link-trace.spec.ts` (REQ-0142 beam-trace diagnostics UI). Unrelated to this
  diff (no client link-trace code touched); FLAKY -- passes **8/8** on isolated
  re-run. NOT caused by REQ-0212.

### Content phase (NOT DONE -- blocked, left for orchestrator)

Blocked on REQ-0213: the `arsenal` pack is NOT in master (no "arsenal" anywhere in
the tree; REQ-0213 is an unmerged parallel worktree). The spec's own gate ("only
after ... master contains REQ-0213's arsenal pack") is unmet, so:
- the carrier unit defs (powder_keg / cursed_doll / battle_pickaxe) were NOT
  ingested/adopted and NOT appended to `content/live/live_units.json`;
- the `arsenal` pack pool was NOT extended.

Also, adopt would fail regardless until this REQ merges: the live server runs OLD
code and its machine check rejects the v16 verbs (the spec's "SKIP adopt" case).

Orchestrator: after REQ-0213 lands AND this REQ merges, run the content phase
(ingest/review/adopt the 3 units, append byte-identical to `live_units.json`,
extend the arsenal pool `powder_keg 2 / cursed_doll 2 / battle_pickaxe 3`), then
`git mv` this REQ todo->built.

## Gate results (2026-07-17, running record)

- Engine phase (subagent, pre-content): full ci.sh -- sim 117/0, goldens 12,
  unit_charge 13/0, unit_charge_encounter 23/0 (incl. the 4 new
  end-to-end/rejection tests), self_test_vocab 31 verbs ALL GREEN,
  check_units, tsc, server files+pg suites green; default e2e 186/1 --
  the 1 (link-trace) verified flaky, 8/8 green isolated.
- Content phase (3 carrier units + arsenal pool): check_units ALL GREEN
  (54 defs), self_test_vocab ALL GREEN, sim 117/0,
  unit_charge_encounter 23/0. Full ci re-run: green through step [6]
  (client build; FAIL count 0), then artinspect e2e failed ONCE under
  load-avg-19 CPU contention (parallel sessions; artadmin 6/6 green in the
  same run) and re-runs were repeatedly displaced by other sessions'
  harnesses (exit 75 port guard, one SIGTERM). Admin trio + default suite
  re-verification pending the next quiet box window -- recorded here
  before merge for honesty; the content delta is class-identical to
  REQ-0213's, which passed the full trio + default suite green today.
