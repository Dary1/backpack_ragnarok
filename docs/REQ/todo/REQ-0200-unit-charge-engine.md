# REQ-0200 - Unit Charge Engine

**Status:** In progress (todo/)
**Slug:** unit-charge-engine
**Branch:** req-0200-unit-charge-engine
**Depends on / follows:** REQ-0129 (charge grammar freeze, vocab v13/v14), REQ-0170/0128b (unit link walker), REQ-0081 (vocab coverage gate), REQ-0190 (per-instance rolls -- FUTURE), REQ-0201 (units003 content -- the acceptance corpus).

## 1. Goal
Turn the FROZEN `charge` grammar (content/vocab.json `charge`, ratified 2026-07-14 REQ-0129)
from a def field nothing evaluates into an ENFORCED, RENDERED, and RUNTIME-implemented
mechanic. Before this REQ the vocab's own `charge._status` read "RATIFIED, NOT IMPLEMENTED --
no `unit` validator kind and no charge AST exist." This is the code REQ that named `_status`
demanded: it adds the `unit` validator kind, the charge AST validator, the tooltip renderer,
the deterministic runtime engine, and the coverage fixtures -- and moves `charge.triggers`
into the top-level `triggers` registry so the REQ-0081 gate holds them honest.

## 2. Rulings inherited (provenance -- NOTHING here is a new user ruling)
- **Triggers / targets delegated to the agent 2026-07-14 (REQ-0129):**
  targets_growth verbatim 「後は、私に聞かないで、必要になったらあなたが定義してください」;
  triggers_growth verbatim 「targetと同じく私に委任」. New charge triggers/targets may be added
  WITHOUT a design event, each labelled AGENT-DEFINED so a machine's choice is never mistaken
  for a user ruling.
- **Verbs delegated by the user 2026-07-16 chat:** 「必要な動詞はじゃんじゃんあなたの意思で追加して」.
  New effect verbs may be added by the agent under the same AGENT-DEFINED labelling rule.
- **Charge grammar FROZEN 2026-07-14 (REQ-0129):** `spend` is a closed set {fire_on_full,
  passive_per_stack, transform}; giving charge away is an effect verb (grant_charge), not a
  fourth spend mode; capacity is the stack cap for passive_per_stack (AGENT-DEFINED 2026-07-16).
- Every vocab entry this REQ adds (grant_lifesteal verb; on_heal_done / on_status_applied /
  on_kill triggers; bp_connected_lowest_hp target) is **AGENT-DEFINED**, never a user ruling.
  The doc strings are taken VERBATIM from /tmp/units003_new_vocab.json (the REQ-0201 kit sheet).

## 3. Scope delivered
### 3.1 vocab.json v14 -> v15 (content/vocab.json)
- The 8 charge triggers now live in the top-level `triggers` list: OnHit / OnBPBeenHit /
  every_secs were already there; **added** on_damage_dealt, on_connected_unit_spend,
  on_connected_unit_attack, on_connected_unit_bp_been_hit, on_own_passive_fire, plus the 3 NEW
  AGENT-DEFINED triggers on_heal_done, on_status_applied, on_kill. Each new trigger gets a
  `trigger_domains` entry `["Unit"]` (content_checks.checkEffects spells the unit_def domain
  "Unit"); "Unit" is also added to every_secs' domain.
- `verbs` += `grant_lifesteal` (doc recorded verbatim in `provenance`).
- `charge.targets` += `bp_connected_lowest_hp` (doc verbatim).
- `charge.triggers` doc catalog gains on_heal_done / on_status_applied / on_kill (verbatim).
- `charge._doc` / `_status` rewritten to record that the validator kind + charge AST now EXIST;
  new `_status_v15` records the full v15 provenance and the pct/hits/"any"/po_tag conventions.

### 3.2 Validator (shared/content_validate.cjs)
- `UNIT_ALLOWED_KEYS` += `charge`.
- New `validateCharge(charge, vocab, ctx)` + `validateChargeEffect(...)`, wired into
  `validateBody('unit')` and thus `validateUnitEntry`. The legal trigger union, spend modes,
  and targets are READ FROM vocab (charge.triggers / charge.spend / charge.targets) so the
  validator can never drift from the grammar it enforces. Rules:
  - `trigger.t` in charge.triggers; `every_secs` carries `s:[lo,hi]`.
  - `gain` in {count, damage}; `capacity` a `[lo,hi]` range with `0 < lo <= hi`.
  - `spend` in {fire_on_full, passive_per_stack, transform}.
  - `effects` (non-empty array of {verb, target}) REQUIRED for fire_on_full / passive_per_stack.
  - `transform_to` (string) REQUIRED iff spend=transform, forbidden otherwise.
  - each effect verb: `verb.t` in vocab.verbs; `n / hits / pct / dur_s` (if present) valid
    ranges; `status` in vocab.statuses EXCEPT bonus_vs_status may carry `"any"`; fire_items.tag
    (if present) a po_tag; `target` a key of charge.targets.

### 3.3 Runtime engine (sim/lib/unit_charge.cjs) + tests (sim/tests/unit_charge_test.cjs)
A deterministic (no-RNG), self-contained runtime: per-unit-instance counter; gain count/damage;
capacity resolution via the single seam (below); the three spend modes; the six targets; verb
groundings; cascade safety; on_kill dedup. Driven by an explicit event API (feed/settle) whose
event vocabulary maps 1:1 onto the sim's existing combat events (see section 7). 13 tests, incl.
a full 30-kit corpus sweep, all green.

### 3.4 Renderer (tools/eff_render.cjs)
`renderCharge(charge, locale)` -> 3-part tooltip (trigger line / capacity+spend line / one line
per effect verb+target), EN + JA, AST-first (no hand-written prose in defs). grant_lifesteal also
gets a generic verbPhrase fallback for the PO self-test loop.

### 3.5 Gates / fixtures
- tools/self_test_vocab.cjs: 13 honest charge fixtures (validated by validateCharge, rendered by
  renderCharge) cover every charge trigger, all 3 spend modes, all 6 targets, grant_lifesteal, and
  the grammar exceptions ("any" / fire_items.tag / multi_strike.hits). Their triggers feed the
  REQ-0081 coverage set -> the gate now demands + gets a fixture for each new trigger (20/20).
- tools/check_units.cjs: reports units-with-charge (validated via validateCharge through
  validateUnitEntry).
- tools/units003_acceptance.cjs + tools/tests/units003_kits.json: THE acceptance corpus -- all 30
  units003 kits (design_note dropped as authoring-only; stub icon added) validate against v15.
- ci.sh: two new steps ([2.7] unit charge runtime, [3.9] units003 acceptance).

## 4. Verb-grounding table (unit charge context)
Each charge-effect verb is grounded as the simplest honest mutation on the target, consistent with
the item-side verb. `pct` = percent points (charge form); `n/hits/dur_s` are [lo,hi] ranges.

| verb | grounding (unit charge) |
|------|--------------------------|
| strike | deal `n` damage to target |
| multi_strike | deal `n` damage x `hits` |
| block | +`n` block on target |
| heal_bp | heal target BP by `n` (capped at hpMax) |
| apply_status | +`n` `status` stacks on target |
| add_on_hit_status | attach `n` `status` on-hit rider to target's items |
| amp_status | +`n` amplification of `status` applications |
| cleanse | clear target's (negative) statuses |
| reflect_damage | +`pct` reflect on target |
| haste | +`n` haste stacks (tick-interval reduction) |
| status_immune | target immune to `status` |
| bonus_vs_status | +`pct` bonus damage vs `status` (or "any" afflicted) |
| buff_self | +`pct` damage to self |
| buff_linked | +`pct` damage to linked target |
| damage_reduction | reduce incoming damage by `pct` |
| grant_shield | +`n` shield on target |
| grant_lifesteal | attach `pct` lifesteal for `dur_s`s to target |
| advance_cooldown | advance target's (max-cooldown) item by `n` |
| fire_items | immediately fire target's `tag` items |
| grant_charge | +`n` to target's charge counter (STRUCTURAL -- routes to the counter, cascade-guarded) |

passive_per_stack effects are STANDING (base-per-stack x current stacks, capped), applied as an
idempotent `set` on the target rather than a spend.

## 5. Cascade rule
A spend that GRANTS charge (grant_charge) to another unit which thereby REACHES capacity does NOT
spend that unit in the same tick -- it is DEFERRED to the next tick (settle()). Independently, every
instance spends AT MOST ONCE per feed()/settle() cascade (spentThisTick guard), so any spend chain
terminates in <= N hops. Together these mean the king<->jester grant loop is a legitimately
SUSTAINED chain (one bounded hop per tick) and NEVER a same-tick infinite spend loop. on_kill is
deduped: one gain per distinct enemy-death event, never per-hit. (Tested: cascade scenario + on_kill
scenario.)

## 6. Range-resolution seam and its REQ-0190 relationship
`resolveRolledRange(range, instanceRolls, key)` is the SINGLE seam that turns any `[lo,hi]` design
range (capacity AND every ranged verb param) into a concrete number:
- if the instance carries a pre-rolled value for `key`, use it;
- else fall back to the deterministic **MIDPOINT** `(lo+hi)/2`.
The midpoint is the honest "expected value" of a range when no per-instance roll exists. **REQ-0190**
(per-instance rolls, ハスクラ) makes the whole engine per-instance-rolled by populating that one map
(`instanceRolls`) at instance creation -- with NO other code change. Every number in the engine flows
through this seam, so REQ-0190 is a one-map wiring, not an engine rewrite.

## 7. Sim integration seam (event mapping) + LIMITATIONS
The engine is driven by feed(ev); its event vocabulary maps 1:1 onto the sim's existing combat events:

| feed event | sim source (sim/lib/encounter.cjs) | fires triggers |
|------------|-------------------------------------|----------------|
| bp_attack{sourceId,amount} | dispatchPlayerOffensive landed hits | OnHit, on_damage_dealt (source); on_connected_unit_attack (linked) |
| bp_damaged{bpId,amount} | dispatchPlayerDefensive | OnBPBeenHit (bp); on_connected_unit_bp_been_hit (linked) |
| bp_healed{bpId} | heal application | on_heal_done |
| status_applied{sourceId} | applyStatus on enemy | on_status_applied |
| enemy_killed{sourceId,enemyId} | enemy death | on_kill (deduped) |
| passive_fired{instanceId} | a unit's own passive spend | on_own_passive_fire |
| (internal) | a linked unit spends | on_connected_unit_spend |
| timer{now} | encounter clock | every_secs |

**LIMITATION (open item):** the DEEP fusion of this seam into the deterministic encounter loop
(sim/lib/encounter.cjs) is DEFERRED. Reasons, stated honestly: (a) NO live unit carries a charge
block yet -- charge only becomes live content in REQ-0201, so any wiring is inert on all current
content and exercised by no existing gate; (b) the determinism goldens (sim/tests/goldens.cjs) are
byte-identical hashes and adding an event-emitting hook to the hot loop, even guarded, is untested
code in a determinism-critical path unless a bespoke unit-bearing encounter fixture drives it. The
runtime engine itself is COMPLETE and fully tested at the module boundary (sim/tests/unit_charge_test.cjs,
30-kit corpus); wiring it into encounter.cjs is a bounded follow-up (instantiate a manager from
unit-bearing troopBps at encounter start; call feed() at the event points above; guard on
"has charge instances" so unit-less encounters stay byte-identical; add a unit-bearing integration
test). This limitation is why the REQ stays in todo/ rather than built/.

**Other honesty notes / open items:**
- `on_own_passive_fire`, `units_connected_distributed`, and `spend=transform` are NOT exercised by
  any of the 30 units003 kits; they are covered by the self_test charge fixtures + the engine test
  (grammar expressibility), not by the acceptance corpus.
- The verb groundings target a MINIMAL combat-target model (the honest landing surface). The sim's
  richer actor adapter is provided when the encounter wiring lands; the groundings are the same
  mutations, so no re-derivation is needed.
- capacity midpoint can be fractional (e.g. [2,3]->2.5): with count gain the counter fires at the
  next integer (3). Documented, deterministic; REQ-0190 rolls replace it per instance.

## 8. Gate results (this branch, worktree)
Ran `SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh` (client build INCLUDED) -> **CI GREEN**. Key steps:
- sim tests 112/0; goldens OK (12 cases, determinism intact); S4 14/0; forecast parity 16/0.
- **[2.7] unit charge runtime: unit_charge_test 13/0** (incl. 30-kit corpus sweep, no unhandled verb).
- mock-src engine 114/0.
- typecheck (checkJs, incl. shared/content_validate.cjs) OK; engine type surface OK.
- **[3.7] vocab self-test ALL GREEN -- 27 verbs / 20 of 20 triggers; charge targets 6/6, spend 3/3.**
- **[3.8] check_units ALL GREEN (units with charge blocks: 0 live -- correct).**
- **[3.9] units003 acceptance: 30/30 kits validate against vocab v15 -- ALL GREEN.**
- server api (files backend) 185/0; all DB-free server + client-side checks green; client build OK.
- **SKIPPED (safety, per hard rules -- running services + art queue must not be disturbed):**
  [5] pg-backend server tests (need DATABASE_URL); [6.5]/[7] e2e (need browsers + running services).
  These exercise validateUnitEntry on fixture content (no fixture carries charge, so validateCharge
  is inert there) -- expected green, but NOT RUN in this pass.

## 9. Files changed
- content/vocab.json (v14 -> v15)
- shared/content_validate.cjs (UNIT_ALLOWED_KEYS += charge; validateCharge/validateChargeEffect; wiring; export)
- tools/eff_render.cjs (renderCharge EN/JA + charge verb/target/trigger phrases; grant_lifesteal fallback)
- tools/self_test_vocab.cjs (13 charge fixtures; coverage union)
- tools/check_units.cjs (charge-count report)
- tools/units003_acceptance.cjs (NEW -- acceptance gate)
- tools/tests/units003_kits.json (NEW -- corpus fixture, mirror of the REQ-0201 kit sheet)
- sim/lib/unit_charge.cjs (NEW -- the runtime engine)
- sim/tests/unit_charge_test.cjs (NEW -- 13 tests)
- tools/ci.sh (two new steps)
- docs/REQ/.../REQ-0200-unit-charge-engine.md (this file)
