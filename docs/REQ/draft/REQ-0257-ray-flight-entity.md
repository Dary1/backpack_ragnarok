# REQ-0257 — ray-flight-entity: IBattleRay becomes a live entity that takes time to arrive

**Status:** draft — spec written, BLOCKED on user review. Four things need the user before work may
start: (1) this REQ makes combat RESULTS change in ways no gate can call right or wrong — §8 spells
out kill-stealing, over-kill waste and nova re-aiming, and the user must want them; (2) it moves all
12 replay goldens a SECOND time, after REQ-0256 already moved them; (3) §10 retires the `ray_step`
event, which is a WIRE format change with six measured consumers (§11); (4) **§12.1 splits brief §4's
`IBattleInstancesFormationMap.tick()` into `tickInstances()` / `tickRays()`**, because brief §4 wrote
`tick()` for one map and there are two — see REQ-0256 §7.1a, which owns the decision. The same flag
appears in REQ-0256 and REQ-0258; **a veto changes all three**, and costs §12.2's guarantee that
every ray takes the same 4 ticks from fire to first diagonal regardless of which side fired it.

**Two hand-offs this REQ ACCEPTS, recorded so they are not silently dropped:**
(a) **REQ-0263 §4.4** — `hp_after` on `ray_hit_all.hits[]` / `ray_aoe.hits[]`, which carry **72.2% of
all ray damage** (§10.1b). Accepted; folded into §14.1's rebaseline. 0263 §4.4 is updated to match.
(b) **`ray_fire`'s three non-uniform emission sites** (§10.1a) — the `ray` id is stamped at all three
and the schema's optional fields are written down for 0262/0263/0264, which must not be authored
against golden-A's shape alone.
**Reserved:** 2026-07-18
**Slug:** ray-flight-entity
**Branch:** req-expedition-spec (spec only; implementation branches from REQ-0256)
**Requested by:** user, 2026-07-18 — spec items (c) and (g), ruling Q1.
**Depends on:** REQ-0256 (battle-tick-core) — HARD. There is no "advance one diagonal per 4 ticks"
without a tick. Also inherits REQ-0258's `IBattleInstancesFormationMap.rays[]` declaration.
**Blocks:** REQ-0262 (expedition-ray-vfx) — its per-tick trail reads §10's events.
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q1, §3 C2, §4.

## 1. Goal

Turn the ray from a FUNCTION CALL into an ENTITY. Today `walkRay()` resolves entry → bounces →
hits → splash inside one event at one `t`. After this REQ a ray is an object that lives on a
map, advances one diagonal per `RAY_TICKS_PER_DIAGONAL` ticks, and hits whatever is there **when
it arrives** — not what was there when it was fired.

This changes combat results. That is the point, not a side effect.

## 2. The ruling that authorizes this

Ruling Q1, verbatim:

> **シムを全面tick化** — the server sim is rewritten to a 0.01s tick loop. **Ray flight is PHYSICAL
> and changes combat results.** Goldens / determinism gate / forecast parity / S4 baselines all
> rebaseline.

Spec item (g): 1 diagonal per 0.04s = **25 diagonal-steps/sec**.

Spec item (c), the freeze rule, verbatim:

> IBattleRayは発火時のスキル参照から作られ、そのあとのユニットやスキルの変化を影響を受けず、そこで状態が凍結して、飛来します

("An IBattleRay is built from the skill reference at FIRE time; it is unaffected by later changes
to the unit or its skills; its state freezes there, and it flies in.")

**Both halves of §7 are load-bearing.** The brief says so and it is right: the ray is frozen, the
field is live. Implement exactly that and nothing more.

## 3. What `walkRay()` does today — read in full

`sim/lib/ray.cjs` is 100 lines; `walkRay` is lines 8-87. It is called from exactly one place in
the sim (`sim/lib/skills.cjs:283`, inside `fireSkillRay`) and from tests (§13.1). Its shape:

```js
function walkRay(opts) {
  const { field, entryCell, dir, mode, penetration, aoe, aoeStatuses,
          bounceBudget, dealHitFn, splashFn, liveOccupantFn, isDestroyedPassable } = opts;
  let cell = entryCell.slice(); let curDir = dir;
  let bounces = 0; let passed = 0; let steps = 0; let landing = null;
  const pathBatch = [];
  function flushSteps() { if (pathBatch.length > 0) { events.push({ ev: 'ray_step', path: pathBatch.slice() }); pathBatch.length = 0; } }
  for (;;) {
    steps++;
    if (steps > TUNABLES.RAY_STEP_BUDGET) { aborted = true; events.push({ ev: 'ray_abort', ... }); break; }
    const next = stepCell(cell, curDir);
    if (outside(next, ROWS, COLS)) { flushSteps(); ... bounces++; ... continue; }
    cell = next;
    pathBatch.push(cell.slice());
    const occ = liveOccupantFn(cell);
    if (occ == null) continue;
    flushSteps();
    const hitResult = dealHitFn(occ, mult(bounces), { allField: false });
    ...
    if (passed < penetration) { passed++; continue; }
    landing = cell.slice(); break;
  }
  ...
}
```

Everything — the whole `for(;;)` — happens synchronously inside one caller's `t`. `pathBatch` +
`flushSteps()` exist ONLY to batch the traversed cells into `ray_step` events for a client that
will animate them **after the fact**. `MonitorRenderer.ts:34` `STEP_ANIM_MS = 200` and REQ-0240's
`pacing.json` `rayStep.perCellMs: 90` are that after-the-fact animation. **Flight is decoration
today.** This REQ makes it physics and deletes the decoration.

Note `opts.isDestroyedPassable` is **destructured and never used** (`ray.cjs:11`) — dead
parameter. Passability is implicit: `liveOccupantFn` (`skills.cjs:204-210`) skips `!a.alive`, so a
destroyed occupant is already invisible to the walk. Remove the dead param while restructuring;
do not preserve it out of caution.

## 4. Verified current state

| fact | source | evidence |
|---|---|---|
| the whole ray is one call | `sim/lib/skills.cjs:283-291` | `const result = walkRay({ field: {...}, entryCell, dir, mode, penetration, ... });` |
| …at one `t` | `sim/lib/encounter.cjs:616` | `for (const re of rayEvents) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));` — EVERY ray event gets the SAME `t` |
| `RAY_STEP_BUDGET` = 512 | `sim/lib/core.cjs:12` | `RAY_STEP_BUDGET: 512,` — counted in CELLS today |
| no ray flight tunable exists | `sim/lib/core.cjs:9-99` | `TUNABLES` has no ray-timing constant |
| destroyed = passable | `sim/lib/skills.cjs:204-210` | `liveOccupantFn(cell) { for (const a of targetActors) { if (!a.alive) continue; ... } return null; }` |
| the 5-bounce nova hits ALL LIVE | `sim/lib/ray.cjs:56-57` | `const allHits = dealHitFn(null, mult(5), { allField: true }); events.push({ ev: 'ray_hit_all', ... })` |
| …reading liveness at CALL time | `sim/lib/skills.cjs:212-220` | `if (opts2.allField) { for (const a of targetActors) { if (!a.alive) continue; ... } }` |
| damage rolls from a fire-time stream | `sim/lib/skills.cjs:222`, `encounter.cjs:614` | `dmgStream` built from `streamPrefix: effectStreamName(s.ownerUid, s.effIdx) + '/' + ev.t` |
| lifesteal already guards a dead owner | `sim/lib/skills.cjs:268` | `if (attacker.selfActor && attacker.selfActor.alive) { ... }` |

### 4.1 MEASURED: what a real run's rays actually do

Ran `batch002/golden-A` (the first replay golden) and counted every event by type. **This is the
corpus this REQ moves, measured, not estimated:**

```
TOTAL events: 330
{"progress":5,"encounter_start":8,"telegraph":35,"ray_fire":36,"ray_step":109,
 "ray_bounce":88,"ray_hit_all":17,"encounter_end":8,"ray_hit":21,"ray_aoe":2,"run_end":1}

ray_step events: 109 | cells carried: 1017 | avg cells per ray_step: 9.33 | max: 17
bounce histogram: {"1":18,"2":18,"3":18,"4":17,"5":17}
```

Five facts fall out, and each one shapes this REQ:

1. **36 rays travel 1017 cells** — an average of **28.25 diagonals per ray**. At
   `RAY_TICKS_PER_DIAGONAL = 4` that is **1.13 seconds of flight for the AVERAGE ray**. Flight time
   is not a rounding detail; it is longer than most `every_secs` cooldowns on this content. Rays
   will routinely be in the air when their owner fires again.
2. **17 of 36 rays (47%) reach the 5th bounce** and trigger the all-field nova (`ray_hit_all`: 17).
   The bounce histogram `{1:18, 2:18, 3:18, 4:17, 5:17}` shows rays almost never stop early — 18
   rays bounce at least once and 17 of those ride all the way to bounce 5. **The nova is not an
   edge case on this content; it is the median outcome.** combat_spec §10 names this exact
   condition a balance smell: *"flag skills that near-always reach the +150% all-field
   terminator"*. It is worth telling the user that the gate they specified would fire on their
   current content — but it is NOT this REQ's job to fix (§15 Out).
3. **Only 21 direct `ray_hit` vs 17 `ray_hit_all`** — most damage in this run is delivered by the
   nova, not by the primary hit. So §8's "field state at ARRIVAL decides" applies to the dominant
   damage path, not a corner of it.
4. **`ray_step` averages 9.33 cells** (max 17). That is the batching this REQ removes, and §10.2
   quantifies what replaces it.
5. **Nothing aborts.** No `ray_abort` in 36 rays — consistent with `forecast_parity.cjs`'s header
   note that the 512 budget is *"dead code in practice for BOTH implementations"*. §5.1 revisits
   the budget under the new unit.

## 5. `RAY_TICKS_PER_DIAGONAL` — the TUNABLE

**New entry in `sim/lib/core.cjs` `TUNABLES`:**

```js
// REQ-0257 (spec g): a ray advances ONE diagonal per this many ticks.
// 4 ticks x TICK_SECS(0.01) = 0.04s per diagonal = 25 diagonal-steps/sec.
// TUNABLE for the same reason TICK_SECS is: the user gave the RATE (25/sec),
// and the tick count is how that rate is expressed against TICK_SECS. If
// TICK_SECS moves, THIS must move with it to hold 25/sec -- they are coupled,
// which is exactly why neither may be a literal.
RAY_TICKS_PER_DIAGONAL: 4,
```

**The coupling is a trap and must be gated.** `RAY_TICKS_PER_DIAGONAL = 4` only means "25/sec"
while `TICK_SECS === 0.01`. Someone halving `TICK_SECS` to 0.005 for resolution silently doubles
every ray's speed to 50/sec. Add a test asserting the DERIVED rate, not the tick count:

```js
// the user specified 25 diagonal-steps/sec (spec g). Assert the RATE.
eq(1 / (TUNABLES.RAY_TICKS_PER_DIAGONAL * TUNABLES.TICK_SECS), 25, 'ray diagonal rate');
```

That is the REQ-0256 §5 lesson applied one layer up: a tunable nobody checks is a constant with
extra steps, and two coupled tunables nobody checks are a bug with a schedule.

### 5.1 `RAY_STEP_BUDGET` = 512, now counted in DIAGONALS

Per brief §4: *"Existing `RAY_STEP_BUDGET = 512` is retained as the DoS guard, now counted in
diagonals."* Retained VERBATIM at 512, with the unit changed from cells-walked to
diagonals-advanced. Since `walkRay` already increments `steps` once per diagonal attempt
(`ray.cjs:32`), **the number does not change meaning** — it was always diagonals; "cells" and
"diagonals" were the same quantity in a synchronous walk.

What DOES change: **512 diagonals is now 2048 ticks = 20.48 seconds of flight.** A ray that never
terminates now occupies 20s of wall clock instead of a few microseconds. Measured (§4.1) nothing
comes close — the worst real ray is ~28 diagonals — so the budget stays dead code. But it is no
longer *cheap* dead code: an aborting ray is a ray that has been drawn on screen for 20 seconds.
Leave the number alone (it is a DoS guard, not a balance knob) and note the changed cost.

## 6. `IBattleRay` — the entity

Per brief §4:

```
IBattleRay
  id        : int              // per-battle monotone; NEW -- s10 needs it to correlate events
  map       : IBattleInstancesFormationMap   // the map it flies ON (= the OPPOSING map)
  frozen    : { verbs, attackProfile, pen, aoe, aoeStatuses, bounceBudget, mode,
                mult basis, ownerRef, dmgStream }        // s7
  cell      : [row,col]        // current position
  dir       : 'DR'|'DL'|'UR'|'UL'
  bounces   : int
  passed    : int              // penetration pass-throughs spent
  steps     : int              // against RAY_STEP_BUDGET (s5.1)
  subTick   : int              // 0..RAY_TICKS_PER_DIAGONAL-1
  alive     : boolean
  advance() // called once per tick; moves ONE diagonal every RAY_TICKS_PER_DIAGONAL ticks
```

Rays live on `IBattleInstancesFormationMap.rays[]` (declared by REQ-0258 §9). **A ray is fired ONTO
the opposing map, so it lives there** — brief §4 states this and it matters: a player PO's ray is
an entity on the ENEMY map, and the enemy map's `tick()` is what advances it.

### 6.1 `advance()` — the walk, one diagonal at a time

The `for(;;)` body of `walkRay` (`ray.cjs:31-80`) becomes the body of `advance()`, verbatim, with
`continue` → `return` (yield the tick) and `break` → `this.alive = false`. **The geometry is not
rewritten; it is re-hosted.** Line for line:

| `walkRay` today | `advance()` |
|---|---|
| `steps++; if (steps > BUDGET) { abort }` | same, per diagonal |
| `const next = stepCell(cell, curDir);` | same |
| `if (outside(next)) { reflectDir; bounces++; ... continue; }` | same, then `return` (a bounce consumes the diagonal) |
| `cell = next; pathBatch.push(...)` | `this.cell = next;` + emit `ray_advance` (§10.1) — **`pathBatch`/`flushSteps` DELETED** |
| `const occ = liveOccupantFn(cell); if (occ == null) continue;` | same, then `return` — **`liveOccupantFn` now reads the LIVE map (§7.2)** |
| `dealHitFn(occ, mult(bounces), {allField:false})` | same, from the FROZEN stream (§7.1) |
| `if (passed < penetration) { passed++; continue; }` | same, then `return` |
| `landing = cell.slice(); break;` | `this.landing = ...; this.alive = false;` then splash |

**Keep `walkRay` alive as a PURE PATH FUNCTION.** This is not optional — §11.6 shows
`forecast_parity.cjs` and 9 `run.cjs` tests depend on a synchronous walk, and the forecast overlay
(REQ-0057) is a *prediction* tool that must still answer "if I fire now, where does it go
assuming nothing changes". Refactor `ray.cjs` into:

- `walkRayPath(field, entryCell, dir, pen, aoe, bounceBudget, mode, occupancyFn)` → the pure
  geometry, returning the cell sequence + landing + bounces. **Snapshot semantics.** This is what
  the forecast and the geometry tests call.
- `IBattleRay.advance()` → the live entity, which walks the SAME geometry one diagonal per call
  against a LIVE occupancy function.

Both must produce identical geometry given identical occupancy — **and that is a testable
invariant, not a hope** (§16.4). If they diverge, the forecast lies.

## 7. The FREEZE rule — exactly

The ray snapshots at FIRE time and is immune to later changes **to the owner or its skills**. The
FIELD it traverses is LIVE. Both halves, precisely:

### 7.1 FROZEN at fire time (the attacker side)

| frozen | today's source | why it must freeze |
|---|---|---|
| `verbs` | `verbEff` (`skills.cjs` param) | a mid-flight `buff_host` refold must not retro-buff a ray already in the air |
| `attackProfile` | `s.attackProfile` (`encounter.cjs:163`) | pen/aoe/edge/bounce_budget are the ray's identity |
| `pen`, `aoe`, `aoeStatuses`, `bounceBudget` | `attackProfile.*` (`skills.cjs:286-289`) | same |
| `mode` | `encounterDef.mode` (`encounter.cjs:612`) | REQ-0259 gates on `ray.mode`; it must be the mode AT FIRE |
| mult basis | `mult(bounces)` table (`geometry.cjs:49-54`) | the table is static; the BOUNCE COUNT is live state on the ray |
| `ownerRef` | `attacker` (`encounter.cjs:602`) | identity for lifesteal/spikes attribution |
| `outgoingBuffPct` | `chargeMgr.outgoingBuffPctFor(bpId)` (`encounter.cjs:602`) | **read ONCE at fire.** A charge buff that lands mid-flight must not amplify a ray already fired |
| `bonusVsStatus` | `bonusVsStatusForOwnerUid(...)` (`encounter.cjs:602`) | **the LIST freezes; its EVALUATION stays live** — see §7.3 |
| `dmgStream` | `rng.stream(streamPrefix)` (`skills.cjs`) | §7.4 |

### 7.2 LIVE during flight (the field side)

| live | why |
|---|---|
| occupancy — who is in the cell the ray enters | **the entire point.** `liveOccupantFn` is re-evaluated at each diagonal against the map's CURRENT occupants |
| target liveness | a target that died mid-flight is gone; destroyed occupants are already passable (`skills.cjs:206`, combat_spec §2.2) |
| target `statusBag` | Weakness/Chill on the TARGET are read at HIT time. A ray in flight toward a target that gets Weakness'd lands weakened |
| target `damageReduction` | `reduceIncoming` (`skills.cjs:240`) reads the live target |
| the 5-bounce nova's victim set | `{allField:true}` enumerates LIVE occupants **at arrival** (`skills.cjs:212-220`). §8.4 |
| the OWNER's aliveness | a dead owner still has rays in the air; they fly on. But lifesteal heals nobody (`skills.cjs:268` already guards it) |

### 7.3 The disambiguation the brief does not make, and someone will get wrong

**"Frozen" applies to the ATTACKER. "Live" applies to the DEFENDER and the FIELD.** The brief says
*"the ray's DAMAGE/verbs/pen/aoe snapshot at fire time; the FIELD it traverses is live"* — true,
but it leaves one case genuinely ambiguous, and the code will have to pick:

**`bonusVsStatus`** (REQ-0093) is a frozen LIST of `{statuses, n}` rules owned by the ATTACKER,
evaluated against the LIVE TARGET's status bag at hit time (`skills.cjs:239`,
`bonusVsStatusAmount(a.statusBag, attacker.bonusVsStatus, dmgStream)`). **Ruling: the list freezes,
the evaluation stays live.** Rationale: the rule "deal +N vs a burning target" is part of the
attacker's skill (frozen); whether the target is burning when the ray lands is a fact about the
field (live). Freezing the EVALUATION would mean a ray fired at a healthy target that catches fire
mid-flight lands without the bonus — which contradicts §7.2's "target statusBag is live" for no
reason. The same reading applies to `weaknessMultiplier` and `reduceIncoming`: attacker-owned
rules freeze; target-owned state is read on arrival.

State this in the code as a comment at the freeze site. It is the kind of distinction that is
obvious once written and re-litigated forever if not.

### 7.4 The damage stream freezes; the DRAWS happen on arrival

`dmgStream` is built once per fire from `streamPrefix` (`encounter.cjs:614`:
`effectStreamName(s.ownerUid, s.effIdx) + '/' + ev.t`). **The ray carries that stream object.**
Draws happen at each hit, in hit order, exactly as today.

**Why not pre-roll all damage at fire time (fully frozen)?** Because you do not know how many hits
there will be until the ray flies — that is the whole change. Pre-rolling would require guessing
the hit count, which is exactly the information flight destroys.

**Consequence, stated plainly:** the stream NAME is unchanged, so the seed is unchanged, but the
ray now draws from it in a DIFFERENT ORDER and a different NUMBER OF TIMES (it hits a different
set of things). **Every damage number moves.** This compounds with REQ-0256 §10.4's stream-name
requantization — which is precisely why the two REQs must land separately (§12.3).

## 8. The RESULT CHANGES — spelled out, and intended

Ruling Q1 says *"Ray flight is PHYSICAL and changes combat results."* Here is what that buys,
concretely. **None of these are bugs. All of them are the feature.** Each is stated so the user can
veto the FEATURE rather than discover the consequence in a golden diff.

### 8.1 A ray whose target dies mid-flight flies on

The target is gone when the ray arrives. Destroyed occupants are **already** passable — combat_spec
§2.2, verbatim: *"**Destroyed occupants are passable** (treated as empty; do not stop or count
against penetration)"* — and `skills.cjs:206` (`if (!a.alive) continue;`) already implements it.
**So this rule needs NO change.** It simply starts MATTERING: today a target can only die between
fires; tomorrow it can die between the fire and the arrival, and the existing passability rule
handles it correctly and automatically.

The ray continues to the next occupant, or bounces on. It does not retarget, stop, or fizzle.

### 8.2 Kill-stealing becomes real

Two rays in flight at the same low-HP target: the first to ARRIVE kills it; the second passes
through empty space. Today both resolve at their own `t` and the second sees a dead target only if
its `t` is strictly later. **The window widens from "between two events" to "1.13 seconds of
flight" (§4.1).** With 36 rays per run averaging 28 diagonals, overlapping flights are the norm,
not the exception.

### 8.3 Over-kill waste becomes real

A ray carrying 40 damage that arrives at a 3-HP target wastes 37. Today the same waste exists but
only within a single resolution; tomorrow the ray was *committed* 1.13s ago against a target that
had 60 HP at fire time. **This is the design intent of a physical ray** — commitment under
uncertainty — and it is what makes `every_secs` cadence a real decision instead of a DPS divisor.

### 8.4 The 5th-bounce nova re-aims itself — the big one

`ray.cjs:56` fires `dealHitFn(null, mult(5), { allField: true })`, which enumerates **live**
occupants (`skills.cjs:212-220`) **at the moment the walk reaches bounce 5**. Today that moment is
the fire instant. Tomorrow it is ~28 diagonals ≈ **1.13 seconds later**.

**Measured (§4.1): 17 of 36 rays reach this — 47%, the median outcome, and `ray_hit_all` (17)
delivers more of this run's damage than direct `ray_hit` (21) does.** So the dominant damage path
in the corpus becomes "whoever is alive in ~1.1 seconds", not "whoever is alive now". This is the
single largest behavioural change in the REQ and the reason §14's rebaseline is total.

### 8.5 Bounce-count timing stops being instantaneous

`bounces` increments over real time now. A ray at bounce 4 is a ray that has been flying ~1s and is
about to nova. **This is a monitor opportunity and a balance fact**: the +150% terminator is now
TELEGRAPHED by the ray's own visible trajectory. REQ-0262 should surface it; combat_spec §4.5's
`telegraph` lead (`TELEGRAPH_LEAD_SECS = 0.6`) is now partially redundant with the flight itself.
**Do not touch the telegraph in this REQ** — note the overlap for a follow-up.

### 8.6 What does NOT change

- **A ray never retargets.** It has no target — it has a trajectory. combat_spec §4.7 stands:
  *"Enemies do not choose a target; they choose a skill to fire and the ray geometry decides what
  it hits."* Flight strengthens this ruling; it does not disturb it.
- **Entry-cell selection is untouched.** `entry.cjs selectEntryCell` runs at fire time, from the
  `.../ray` sub-stream, exactly as today. Where the ray ENTERS is a fire-time decision (frozen);
  where it GOES is geometry (live).
- **Simultaneity within a diagonal.** A ray hits, penetrates and splashes within the diagonal it
  arrives on. Only the DIAGONALS take time. Sub-diagonal ordering is not modelled and must not be.

## 9. What SURVIVES combat_spec verbatim — confirmed rule by rule

The task asks which of §2.2/§2.3/§3.2 survive. **Checked each against the file. Every geometry rule
survives; not one is superseded.** Flight changes WHEN the walk happens, never HOW.

| combat_spec rule | § | verdict |
|---|---|---|
| 45° diagonal, one cell per step, from an edge entry cell | §2.2 | **SURVIVES.** Now one diagonal per 4 ticks. |
| entry cells & per-edge fixed directions (top→↙/↘, left→↘, right→↙, bottom→↗/↖) | §2.2 | **SURVIVES VERBATIM.** `geometry.cjs:13-18` `EDGE_DIRS` untouched. |
| penetration = N occupied pass-throughs; exhausted by pass-throughs only; stops at first non-penetrable | §2.2, OQ5 | **SURVIVES VERBATIM.** `passed`/`pen` become ray state instead of loop locals. |
| **boundary reflection is INDEPENDENT of penetration and ALWAYS applies** | §2.2, OQ5 | **SURVIVES VERBATIM.** `ray.cjs:65` (`continue; // reflection does NOT consume pen`) → `return` with `passed` untouched. |
| destroyed occupants are passable; gaps are not walls; boundary is the ONLY reflecting surface | §2.2 | **SURVIVES VERBATIM** — and §8.1 shows this is the rule that quietly makes flight work. |
| bounce mult table 1.0(≤2)/1.5(3)/2.0(4)/2.5(5) | §2.2, §3.2 | **SURVIVES VERBATIM.** `geometry.cjs:49-54` `mult(b)` untouched. |
| **5th bounce: +150% AND hit ALL occupants on the field, then terminate** | §2.2, §3.2 | **RULE SURVIVES VERBATIM; its VICTIM SET is now evaluated on arrival** (§8.4). The rule text does not change — "all occupants" always meant "all LIVE occupants at the moment it fires" (`skills.cjs:214` `if (!a.alive) continue;`). Flight moves the moment, not the rule. |
| detection-mode per-PO `bounce_budget` REPLACES the global 5-bounce terminator | §2.2, §6.1 | **SURVIVES VERBATIM.** `ray.cjs:46-52` re-hosted unchanged. |
| a detection hit = a FIND; damage irrelevant; ends the ray | §2.2, §6.1 | **SURVIVES VERBATIM.** |
| AOE splash on landing, Chebyshev radius in SHARED-FIELD cells; landing occupant not double-hit | §2.2 OQ6, §3.4 | **SURVIVES VERBATIM.** `skills.cjs:226-281` `splashFn` re-hosted; splash fires at the landing diagonal. |
| step budget 512 as determinism/DoS guard, logging `ray_abort` | §2.3 | **SURVIVES**, now counted in diagonals (§5.1). |
| `mult(b)` applied before block/HP; block absorbs first | §3.3 | **SURVIVES VERBATIM.** |
| identical `walk` for player→enemy and enemy→player | §3.5 | **SURVIVES VERBATIM.** One `IBattleRay` class, two maps. |
| §3.2's `walk()` pseudocode block | §3.2 | **SUPERSEDED as PSEUDOCODE ONLY** — every RULE inside it survives; it is re-expressed as `advance()` (§6.1). Update the block; do not change a rule. |

**§3.6 (Monitor / replay events) is the ONE section that dies.** §10.

## 10. The new replay events

### 10.1 `ray_step` retires; `ray_advance` replaces it

combat_spec §3.6, verbatim:

> Each fire emits, in order: `ray_fire` (entry, dir, pen, aoe), **one `ray_step` per straight
> segment (batched cell list)**, a `ray_bounce` per reflection (with `new_dir`, `bounce`),
> `ray_hit` per occupant struck (with `bounce_mult`), `ray_aoe` on splash … This lets the client
> animate the diagonal, the bounces, and the splash **without re-simulating**.

**SUPERSEDED.** The batched cell list is a post-hoc path — it exists precisely because the server
already knew the whole trajectory at `t`. It cannot survive a ray that does not know its own future.

| event | today | after |
|---|---|---|
| `ray_fire` | **NOT UNIFORM — see §10.1a.** Golden-A's shape is `{t, seq, ev, src, field, entry, dir, pen, aoe}`; the two synthesised sites emit `{t, seq, ev, src, field, mode, entry}` | **+`ray`** (the `IBattleRay.id`) **at ALL THREE emission sites**. All consumers correlate on it. |
| `ray_step` | `{ev:'ray_step', path:[[r,c],...]}` — batched | **DELETED** |
| — | — | **NEW `ray_advance`**: `{t, seq, ev:'ray_advance', ray, cell:[r,c], bounces}` — ONE per diagonal, at the tick the ray arrives on that cell |
| `ray_bounce` | `{ev, at, new_dir, bounce}` | **+`ray`**. `t` is now the bounce's real tick. |
| `ray_hit` | `{ev, dst, amount, bounce_mult, hp_after}` | **+`ray`**. `t` is the arrival tick, NOT the fire tick. |
| `ray_aoe` / `ray_hit_all` | `{ev, center, radius, hits}` / `{ev, bounce_mult, hits}`, where `hits[] = [{dst, amount}]` — **no `hp_after`** | **+`ray`**. `t` = arrival tick. **+`hp_after` on every member of `hits[]`** — REQ-0263 §4.4's hand-off, ACCEPTED (§10.1b). |
| `ray_abort` / `ray_end` | `{ev, reason, steps}` | **+`ray`**. |

**Why one event per DIAGONAL and not per TICK.** The task frames this as "the client needs per-tick
positions". Precisely: a ray's position changes **once every `RAY_TICKS_PER_DIAGONAL` ticks** — it
is stationary for the other 3. Emitting per-tick would emit the same cell four times. **`ray_advance`
per diagonal IS the per-tick position stream at the resolution the ray actually moves**, and it
carries a tick-exact `t` so the client can place it on the clock without inference. Between two
`ray_advance` events the client interpolates with rAF — brief §6, verbatim: *"trail + 25
diagonal-steps/sec, interpolated smoothly when the display allows (rAF, not a 25Hz gate)"*. The
server emits truth at 25Hz; the client draws at 60+Hz. That is the correct split, and it is why
`ray_advance` does not need a `subTick`.

**The `ray` id is NEW and non-negotiable.** Today `MonitorRenderer.ts:160` tracks
`this.currentRayField` — *"the field the most recent ray_fire targeted — ray_hit reads its side
from here"*. **That works only because rays are instantaneous and therefore never interleave.**
With flight, N rays are in the air at once and their events interleave; "the most recent ray_fire"
becomes meaningless and the renderer would attribute hits to the wrong side. §11.1.

### 10.1a `ray_fire` has THREE emission sites, and its schema is NOT uniform

This REQ's first draft treated `ray_fire` as one emission with one shape — golden-A's. **Measured,
there are three, and they do not agree:**

| # | site | emits | `mode`? | `dir`/`pen`/`aoe`? |
|---|---|---|---|---|
| 1 | `sim/lib/skills.cjs:195` — `fireSkillRay`, the real ray | `{ev, src, field, entry, dir, pen, aoe}` (`t`/`seq` stamped by the caller at `encounter.cjs:616`) | **no** | **yes** |
| 2 | `sim/lib/encounter.cjs:359` — `resolveDetection`, **SYNTHESISED** | `{t, seq, ev, src, field:'enemy', mode:'detection', entry}` | **yes** | **no** |
| 3 | `sim/lib/encounter.cjs:378` — `resolveUnlock`, **SYNTHESISED** | `{t, seq, ev, src, field:'enemy', mode:'unlock', entry}` | **yes** | **no** |

Sites 2 and 3 are not rays in any physical sense. **No `walkRay` runs, no geometry is computed, no
trajectory exists** — the attachment is resolved directly (`resolveUnlock` even rolls its damage
inline off its own `unlock/...` stream and emits a paired `ray_hit`, `:377-379`) and a `ray_fire` is
*synthesised afterwards* so the monitor has something to draw. They are a PRESENTATION artifact
wearing a sim event's name.

**Consequences this REQ must honour, none of them optional:**

1. **The `ray` id is stamped at ALL THREE sites** (§10.1). A consumer that correlates on `ray` must
   never meet a `ray_fire` without one, or the `Map<rayId, field>` that replaces `currentRayField`
   (§11.1) silently drops a key and mis-attributes a side — the exact bug the id exists to kill.
2. **Sites 2/3 mint a ray id and CLOSE it in the same tick.** They have no flight: there is no
   `IBattleRay`, so there are no `ray_advance` events, no bounces, and no arrival. The id is a
   correlation handle, not a promise of a trajectory. **A consumer must not assume `ray_fire`
   implies a later `ray_advance`.**
3. **`dir`/`pen`/`aoe` are ABSENT, not zero, on sites 2/3** — and `mode` is absent on site 1.
   Downstream REQs (0262 ray VFX, 0263 HUD, 0264 hit VFX) **must not be written against golden-A's
   shape alone**: golden-A is a `batch002` combat run and contains no attachments, so **it exercises
   site 1 only**. Every `ray_fire` field except `{t, seq, ev, src, field, entry}` is OPTIONAL on the
   wire. A renderer that reads `ev.dir` unguarded crashes the first time a player opens a chest.
4. **This REQ does NOT unify the schema.** Making sites 2/3 emit real rays is a combat change
   (attachments would become physically reachable and missable); making them stop emitting `ray_fire`
   is a wire change with its own consumers. Both are out (§15). **What this REQ owes is the truth
   written down**, and it is now written down.

### 10.1b REQ-0263 §4.4's hand-off: **ACCEPTED**

REQ-0263 §4.4 measured that `ray_hit_all.hits[]` and `ray_aoe.hits[]` carry `{dst, amount}` and **no
`hp_after`**, while those two events deliver **72.2% of all ray damage in golden-A** (740.2 of
1024.9). An HP bar driven by `hp_after` would therefore sit still through the nova — the main gun —
and jump on the next direct hit. 0263 recommended this REQ add the field while it is already
rewriting these emissions, rather than open a fourth REQ on `skills.cjs` for one field.

**Accepted, and this REQ owns it.** The reasons are 0263's and they hold:

- **The server already has the number.** `dealHitFn` computes `hp_after` for the direct path (it is
  why `ray_hit` carries it), and the nova enumerates and damages its victims through the same path
  (`skills.cjs:212-220`). The value exists at the moment of the strike; it is simply not written
  down. **It is the same field, on the sibling event.**
- **The alternative is forbidden.** 0263's rejected option (a) — accumulate `amount` client-side —
  requires re-deriving HP through block, shield, `reduceIncoming` (`skills.cjs:240`), heals and
  lifesteal, in TypeScript, against a server that owns all of them. `combat_spec §1.2 [LOCKED OQ1]`
  forbids it by name: *"clients replay the log, never re-simulate."*
- **The cost is noise against what this REQ already spends.** ~34 extra numbers per run (17 novas x
  ~2 victims, golden-A). It adds **no events** — only a field on existing array members — against
  the 3.75x growth §10.2 already accepts.
- **Declining would be the expensive choice.** 0263 would inherit `sim/lib/skills.cjs` and the
  goldens as blast radius, i.e. a THIRD REQ would move the 12 goldens after 0256 and this one — for
  one field, in a file this REQ has open anyway. That trades a one-line diff for a third rebaseline.

**Consequence, stated because it is the whole reason to say this out loud: the goldens move for this
too.** It is folded into §14.1's single rebaseline rather than deferred into a later one, and §14.1's
diff review must expect `hp_after` inside `hits[]`. **This is a WIRE change**: `hits[]` members go
from 2 fields to 3. Its consumers are `client/src/schedule/monitor/runRoster.ts:56` and
`client/src/forecast/pressure.ts` (§11.7, §11.8) — both **read** `hits[]` and neither validates its
member shape, so both tolerate an added field. Verified, not assumed.

**Symmetry note.** `ray_hit` (direct) carries `hp_after`; after this change `ray_hit_all` and
`ray_aoe` do too, on every member. **All ray damage is then HP-attributable from the log alone**,
which is the property REQ-0263 needs and the property `combat_spec §1.2` implies the log should
already have had.

### 10.2 The log grows ~3.7x — MEASURED, not estimated

From §4.1's real numbers for `batch002/golden-A`:

| | today | after |
|---|---|---|
| `ray_step` events | **109** (carrying 1017 cells) | **0** |
| `ray_advance` events | 0 | **1017** (one per cell traversed) |
| TOTAL run events | **330** | **~1238** (330 − 109 + 1017) |

**~3.75x total log growth; ray-position events alone go 109 → 1017 (9.3x).** State this plainly
because it lands on real budgets:

- **Storage.** `run.events` is persisted per run (`server/services/seals.cjs` reads it;
  `shared/dto.ts:505` `events: ApiRunEvent[]` ships it to the client). A 3.7x log is a 3.7x row.
- **Wire.** The whole event list is sent to the monitor. 
- **REQ-0240's pacing pass** iterates every event (`detectCoalesceGroups`, `pacing.cjs:62-89`) —
  3.7x the work, on a pass that already runs per serve.

**This REQ does NOT optimize that**, and it must not quietly compress `ray_advance` back into a
batch — that would re-invent `ray_step` and lose the per-tick timing the user asked for. But the
number belongs in front of the user BEFORE the work starts, not in a post-hoc incident. If it is
unacceptable, the honest lever is `RAY_TICKS_PER_DIAGONAL` (a slower ray emits fewer events per
second but the same count per cell) or a follow-up REQ that trims the log at the SERVE boundary
while keeping storage truthful.

## 11. Ray-event consumers — every one, and its impact

Grepped `ray_step|ray_bounce|ray_fire|ray_hit_all|ray_aoe|ray_abort|ray_end` across
`req-0240-monitor-redesign-pacing` (the branch that owns the monitor; REQ-0255 merges it).
**The COMPLETE list:**

### 11.1 `client/src/schedule/MonitorRenderer.ts` — the small monitor

| line | today | impact |
|---|---|---|
| `:34` | `const STEP_ANIM_MS = 200; // per ray_step segment` | **DELETE.** Flight time is now physical; a 200ms-per-segment animation constant is exactly the decoration this REQ replaces. |
| `:716-722` | `case 'ray_step': { const path = ...; this.animateStep(path, ...); }` | **REPLACE** with `case 'ray_advance'` — move the ray's marker to `ev.cell`. The renderer stops OWNING the animation timeline and starts FOLLOWING one. |
| `:160` | `currentRayField` — *"the field the most recent ray_fire targeted"* | **BREAKS** under interleaved flight. Replace with a `Map<rayId, field>` populated at `ray_fire` and read by every `ray`-tagged event. §10.1. |
| `:704-710` | `case 'ray_fire'` → `getOrCreateEnemyMarker(entry, ...)` | **+ register the ray id.** |
| `:723-727` | `case 'ray_bounce'` → `flashCell(at)` | unchanged (now at the real bounce tick). |
| `:746-755` | `case 'ray_hit_all'` → `pulseCell('N9')` | unchanged, but see the comment there: *"No specific cell carried on these two event kinds today"*. Still true. |

### 11.2 `server/services/pacing.cjs` — REQ-0240's presentation pacing

| line | today | impact |
|---|---|---|
| `:44-51` | `gapAfterMs(cls, ev)`: `if (cls === 'ray_step') { const cells = ev.path.length; return clamp(rs.perCellMs * cells, rs.minMs, rs.maxMs); }` | **DEAD CODE** the moment `ray_step` dies. The whole `rayStep` special-case exists to hold a batched path on screen long enough to be seen. |
| `shared/pacing.json` | `"rayStep": {"perCellMs": 90, "minMs": 360, "maxMs": 900}`, `minGapMs.ray_step: 0`, `gapAfterMs.ray_step: 90` | **`rayStep` block + both `ray_step` entries retire.** `ray_advance` needs entries. |
| `:33-37` | `classOf(ev)` → falls through to `default` for unknown tokens | **This saves us.** Its comment: *"a new event type is spaced like a ray_hit, never dropped — forward-compatible"*. So `ray_advance` gets `default` (200ms) if nothing is authored — **which would be catastrophic** (1017 events × 200ms = 203s of pacing). **`minGapMs.ray_advance: 0` and `gapAfterMs.ray_advance: 0` MUST be authored.** A forward-compatible default is not a correct default at 9x the volume. |

**Per brief §3 C4 this matters LESS than it looks, and the REQ must say why:**

> **#/expedition plays the sim clock 1:1 (realtime, tick-accurate).** The pacing layer stays alive
> ONLY for the legacy small monitor on #/schedule. `pacingVersion` remains on the wire; the
> expedition view ignores `pt` and reads `t`. No deletion of pacing.cjs in this program.

So: **`#/expedition` ignores `pt` entirely** — a ray's timing IS its `t`, and stretching it would
desynchronise the ray from its own hits (which is the whole reason C4 exists). **Pacing survives
only for `#/schedule`'s small monitor**, where it must keep producing a watchable timeline out of a
3.7x-denser log. The `ray_advance` entries above are what keep that surface honest. `pacing.cjs` is
NOT deleted, NOT bypassed, and NOT extended — it is re-tuned for one event token.

### 11.3 `server/lib/humanize.cjs`

`:14-15`: `case 'ray_step': return 't=' + t + 's ray travels through ' + ev.path.length + ' cell(s)';`
→ **retarget to `ray_advance`.** Note this would print 1017 lines for golden-A; humanize is a debug
surface, so either collapse consecutive `ray_advance` for the same `ray` into one line or accept
the volume. Prefer collapsing — it is a HUMAN surface, and the batching that is wrong for the wire
is right for prose.

### 11.4 `client/src/schedule/fieldGeometry.ts`

`:23-27` documents the raw-tuple contract for *"ray_fire's `entry`, ray_bounce's `at`, ray_step's
`path[]` entries"*. **Doc + type update**: `ray_advance`'s `cell` is the same raw `[row, col]`
NUMBER TUPLE. The contract is unchanged; only the field name moves.

### 11.5 `client/src/schedule/chimes/chimeMapping.ts`

`:199-205` explains that the pulse `ray_fire`/`ray_step` onset *"stays silent"*. **No behaviour
change** — a silent event that no longer exists is still silent. Update the comment; touch no code.
`:246-261` (`ray_bounce` percussion, 5th-bounce cymbal suppression) is unaffected.

### 11.6 `sim/tests/forecast_parity.cjs` — the structural break

**This is the one the brief gets wrong, and it is not a rebaseline.** Three of its 18 tests
reassemble the ray's cell path **out of `ray_step` event batches**:

```
:113-118   // Reassemble the traversed cells from the ray_step batches. flushSteps() ...
           if (ev.ev === 'ray_step') for (const c of ev.path) cells.push([c[0], c[1]]);
:261       T('walkRayPath == sim walkRay: byte-equal cell path, landing, bounces, abort (full corpus)')
:299       T('walkRayPath == sim walkRay: bounce multiplier in force at each entered cell')
:323       else if (ev.ev === 'ray_step') for (const c of ev.path) expected.push([c[0], c[1], combat.mult(b)]);
:336       T('walkRayPath == sim walkRay: AOE splash centre / radius / multiplier')
```

Delete `ray_step` and these compare against an **empty array**. They do not fail loudly with a
useful message; they fail as a byte-equality against nothing — or worse, if the corpus's coverage
counter is satisfied elsewhere, they could pass vacuously.

**The fix is §6's `walkRayPath` refactor, and this is the test that forces it.** Point the parity
tests at the PURE path function (`walkRayPath`) rather than at the event stream. That is strictly
better than what exists: today the test reads sim's geometry through a *replay artifact*; after,
it compares two path functions directly. The forecast overlay is a snapshot predictor and stays
correct — it answers "where would a ray go against the board as it is now", which is exactly what
`walkRayPath` computes.

**Also pin the new constants if they ever cross into `shared/`.** `shared/` may not `require()` out
of `shared/` (`shared/content_validate.cjs:432-435`; `forecast_parity.cjs` header). The forecast
predicts GEOMETRY, not TIMING, so `RAY_TICKS_PER_DIAGONAL` should NOT need to appear there — **add
no fourth copy.** If a future overlay wants flight time, it pins it the way `RAY_STEP_BUDGET` is
pinned at `:188`, and not otherwise.

### 11.7 `client/src/forecast/pressure.ts`

`:136` references the all-field terminator (`ray_hit_all`) in a comment about pressure folding.
**No change** — pressure is a snapshot forecast over `walkRayPath` geometry (§11.6), and §8.4
changes WHEN the nova picks victims, not the geometry that gets it there.

### 11.8 `client/src/schedule/monitor/runRoster.ts` and `monitor/feedCopy.ts`

`runRoster.ts:56` reads `ray_aoe`/`ray_hit_all` `hits[]` with `ev.field === 'enemy'`;
`feedCopy.ts:65-66` prints them. **No change** — both survive; they gain a `ray` field they may
ignore.

## 12. Interaction with REQ-0256's within-tick order

REQ-0256 §10.1 fixes the within-tick total order as: **player map, then enemy map; instances by
stable index; slots by slot index.** Rays need a defined place in it.

### 12.1 The ruling: instances fire FIRST, then rays advance

```
within one tick:
  1. status cadence      (every STATUS_TICK_TICKS ticks, REQ-0256 s7.2)
  2. ALL instance fires  (player map, then enemy map -- REQ-0256 s10.1)
       -- a fire CREATES an IBattleRay at its entry cell, subTick = 0
  3. ALL ray advances    (player map's rays, then enemy map's rays)
       -- each ray: subTick++; if subTick === RAY_TICKS_PER_DIAGONAL { subTick = 0; advance() }
  4. pulse arrivals scheduled for this tick
  5. termination check
```

**WHO CALLS WHAT — reconciled with REQ-0256 §7.0/§7.1a, which owns the chain.** This REQ's first
draft called the five steps above *"`IBattleInstancesFormationMap.tick()`'s contract"*. **That was
wrong**: no single map's `tick()` can own steps 1, 4 and 5 (they are encounter-level), and no single
map's `tick()` can express steps 2 and 3 (they each span BOTH maps). The five steps are the
**tick-level contract**, and it is split across three owners:

| step | owned by | called from |
|---|---|---|
| 1. status cadence | `runEncounter`'s loop body | REQ-0256 §7.1 |
| **2. all instance fires** | **`Battle.tick()` phase A** -> `playerMap.tickInstances()`, then `enemyMap.tickInstances()` -> `instance.tick()` | REQ-0256 §7.1a |
| **3. all ray advances** | **`Battle.tick()` phase B** -> `playerMap.tickRays()`, then `enemyMap.tickRays()` | **THIS REQ** implements `tickRays()`; 0256 stubs it to a no-op |
| 4. pulse arrivals | `runEncounter`'s loop body | REQ-0256 §7.1 |
| 5. termination | `runEncounter`'s loop body | REQ-0256 §7.1 |

So `battle.tick()` covers steps 2-3 and nothing else, and the cascade spec (c) asks for —
Battle -> map -> instance — is intact.

**Brief §4's `tick() // forwards tick to instances, then advances rays` is honoured as the
composition `tickInstances(); tickRays()`, but `Battle` calls the two phases separately, and it must.**
Brief §4 wrote `tick()` for ONE map; there are two. Composed per-map it would run
`playerInstances, playerRays, enemyInstances, enemyRays` — **not** the order above. Because a ray
lives on the map it was fired ONTO (§6), that per-map order would advance a player-fired ray on its
birth tick (`enemyMap` has not ticked yet) but not an enemy-fired one (`playerMap` already has:
**player rays would arrive a tick sooner than enemy rays, decided by nothing but map order** — the
birth-order coupling §12.2 rejects, stacked on the player-first bias REQ-0256 §10.2 already accepts.
The phase split removes it: **every ray, both sides, takes exactly `RAY_TICKS_PER_DIAGONAL` ticks
from fire to first diagonal.**

This is a deliberate, user-visible refinement of brief §4. **It is flagged identically in REQ-0256
(§7.1a, and its Status block), REQ-0258 (§9) and here — all three say the same thing, and if the user
vetoes it, all three change together** and §12.2's uniform fire-to-first-diagonal guarantee is what
gets spent.

### 12.2 Why fires precede advances — justified

- **A ray fired this tick does not move this tick.** It is created at `subTick = 0` in step 2 and
  step 3 increments it to 1, which is not yet `RAY_TICKS_PER_DIAGONAL`. So its first diagonal lands
  4 ticks after its fire — a clean, uniform 0.04s from fire to first cell, with no off-by-one where
  a ray teleports one diagonal at birth. Rays created in step 2 MUST be appended to a list that
  step 3 iterates, and step 3 must tolerate that append (iterate a snapshot of the list taken after
  step 2, not a live array being mutated).
- **It matches the existing bias.** Today a fire and its entire resolution happen in one instant,
  i.e. the fire strictly precedes any consequence. Fires-then-advances preserves "cause before
  effect within a tick".
- **The alternative is worse.** Advancing rays BEFORE fires would let a ray fired at tick k be
  advanced by the step-3 of tick k only if the list order happened to catch it — a birth-order
  dependency, which is the exact class of incidental coupling REQ-0256 §10.2 rejects.

### 12.3 Player-map rays before enemy-map rays — and the subtlety

Rays live on the map they were fired ONTO (§6). So **"the player map's rays" are the ENEMY's rays
in flight toward players.** Advancing player-map rays first therefore means enemy attacks land
before player attacks within a tick — **the OPPOSITE of REQ-0256 §10.1's player-first instance
order.**

**This is not an inconsistency; it is two different orderings of two different things**, and it
must be written down or someone will "fix" it into a bug:

- **Instance order is player-first** (REQ-0256 §10.1): in a mutual-kill tick, the player's *fire*
  goes first.
- **Ray order is player-map-first**, i.e. enemy *arrivals* go first: in a mutual-arrival tick, the
  enemy's ray lands first.

The two biases point opposite ways and therefore roughly cancel, which is the honest outcome. The
alternative — making both player-favouring — would compound a systematic advantage twice per tick.
**Ruling: order rays by MAP identity (player map, then enemy map), for the same reason REQ-0256
orders instances by map: it is a stable, declared, data-independent key.** Do not order rays by
owner side; that reintroduces the coupling.

## 13. Blast radius — MEASURED

All numbers measured on `req-expedition-spec` @ `f918a65` (pre-merge baseline) at spec time.
**Post-REQ-0256 these are the values 0256 leaves behind, not these** — 0257 must re-measure against
its own base before rebaselining, and both REQs' diffs must be read separately (§12.3 of REQ-0256).

| gate | command | measured NOW | after this REQ |
|---|---|---|---|
| sim unit tests | `node sim/tests/run.cjs` | **117 passed, 0 failed** | **MOVES** — §13.1 |
| sim replay goldens | `node sim/tests/goldens.cjs` | **`goldens OK (12 cases)`** | **REBASELINE all 12, a SECOND time** (§14.1) |
| forecast parity | `node sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** | **3 tests STRUCTURALLY BREAK** (§11.6) — not a rebaseline |
| S4 post-processor | `node sim/tests/s4_test.cjs` | **14 passed, 0 failed** | green; S4 BASELINES move (§14.3) |
| REQ-0203 grave-legion | `node sim/tests/req0203_grave_legion_test.cjs` | **15 passed, 0 failed** | expected green |
| REQ-0207 wildlands | `node sim/tests/req0207_wildlands_test.cjs` | **13 passed, 0 failed** | expected green |
| REQ-0219 deepstone | `node sim/tests/req0219_deepstone_test.cjs` | **13 passed, 0 failed** | expected green |
| REQ-0200 unit charge | `node sim/tests/unit_charge_test.cjs` | **13 passed, 0 failed** | green (no ray coupling) |
| REQ-0200 charge fusion | `node sim/tests/unit_charge_encounter_test.cjs` | **23 passed, 0 failed** | **MOVES** — `chargeOps.strikeFromBp`/`fireItems` (`encounter.cjs:50-81`) fire real rays, which now take time |
| api determinism | `node server/tests/api_test.cjs` | **NOT RUNNABLE in a bare worktree** | REQ-0256 §12.3 |

### 13.1 `sim/tests/run.cjs` — the 9 walkRay tests

Nine tests call `combat.walkRay` DIRECTLY (`:220, :253, :270, :289, :302, :322` + the AOE test):
`'ray geometry: entry projection+jitter…'`, `'…penetration exhaustion…'`, `'…boundary reflection…'`,
`'…bounce damage scaling exactness…'`, `'…5-bounce all-hit-then-terminate…'`,
`'…detection-mode per-PO bounce-budget stop…'`, `'…destroyed-BP passthrough…'`,
`'…gap passthrough…'`, `'AOE: Chebyshev radius correctness…'`.

**Good news, measured: `run.cjs` has ZERO references to `ray_step`.** These tests read
`result.landing` / `result.bounces` / `result.aborted`, not the event stream. **So they retarget to
`walkRayPath` (§6) cleanly and keep testing exactly what they test today.** They are the regression
net for "the geometry did not change" — §16.4 leans on them. Keep all nine; do not rewrite them into
flight tests. Flight gets its OWN tests.

### 13.2 CONTENT_ROOT — inherited, not re-derived

REQ-0255 §7.1 and REQ-0256 §12.3 measured it. Post-merge, the split invocation is mandatory:

```
CONTENT_ROOT=$PWD/content node sim/tests/run.cjs     # and forecast_parity, s4_test, roster tests
node sim/tests/goldens.cjs                           # NO CONTENT_ROOT -- it pins its own roster (goldens.cjs:51-59)
```

## 14. Rebaseline procedure

### 14.1 The 12 replay goldens

```
node sim/tests/goldens.cjs          # CONFIRM RED first -- 12 DRIFT lines
node sim/tests/goldens.cjs gen
git diff sim/tests/goldens/replay_hashes.json
```

**Expect all 12 `jsonl_sha256` to move. `def_sha256` MUST NOT move on the 9 dungen cases** — the
generator is untouched. If one moves, STOP.

**`hp_after` inside `hits[]` moves the hashes too, and adds ZERO events** (§10.1b). Expect it in the
diff: every `ray_hit_all.hits[]` / `ray_aoe.hits[]` member gains a third field. It does **not**
perturb the `events` arithmetic below — if an `events` count moves for a reason the formula does not
explain, `hp_after` is not the culprit and something else did it.

**`events` counts will jump ~3.7x** (§10.2: golden-A 330 → ~1238). **This is the single best
sanity check available** — it is the one number in the golden file that is human-readable. Verify
it against §10.2's arithmetic per case:

```
events_after ≈ events_before − ray_step_count + total_cells_traversed
```

If a case's growth is wildly off that formula, the ray is not walking the geometry it used to.

**Before regenerating, prove the diff is flight.** Dump `batch002/golden-A`'s JSONL before/after:

1. Every `t` is still a multiple of `TICK_SECS` (REQ-0256's invariant must hold).
2. **A `ray_hit`'s `t` is now STRICTLY GREATER than its `ray_fire`'s `t`** — correlate on the new
   `ray` id. This is the one-line proof that flight is physical. Today they are EQUAL; if they are
   still equal, this REQ did nothing.
3. The gap should be ≈ `diagonals_travelled × RAY_TICKS_PER_DIAGONAL × TICK_SECS`. Spot-check one
   ray by hand.
4. The SET of `ev` tokens changes in exactly one way: `ray_step` gone, `ray_advance` present.
   Anything else appearing or vanishing is a bug.
5. `ray_hit_all` count will move (§8.4 — the nova now picks victims 1.13s later, so some rays that
   novaed into a live pack now nova into a cleared one). **Expect it and read it**; it is the
   headline behavioural change.

### 14.2 forecast parity — UPDATE, do not rebaseline

**There is nothing to regenerate** (REQ-0256 §12.2 explains why: it is an assertion suite with no
stored hash and no `gen` mode). Three tests must be REWRITTEN to call `walkRayPath` instead of
scraping `ray_step` (§11.6). Target: **18 passed, 0 failed** — the same 18. If the count drops,
tests were deleted rather than retargeted, and the parity gate has been quietly narrowed.

### 14.3 S4

As REQ-0256 §13.3. `sim/s4_matrices/default.golden.sha256` re-hashed; `sim/s4_baselines/default/`
regenerated. **`sim/s4_thresholds.json` is hand-authored design intent — do NOT regenerate it.**

**One S4 item this REQ specifically implicates.** combat_spec §10 lists, as an S4 measure:

> **Ray sanity (new):** distribution of bounce counts and 5th-bounce all-field triggers; flag
> skills that near-always reach the +150% all-field terminator (a balance smell).

§4.1 measured **47% of rays reaching the terminator** on batch-002 — the gate the spec asked for
would fire on today's content, before this REQ. Flight will move that number (novas that arrive
into a cleared field waste themselves). **Report the before/after distribution to the user as a
finding.** Do not tune anything: this REQ is a mechanism change, and re-balancing inside it would
make the golden diff unreadable — the same doctrine REQ-0184's port note sets and REQ-0258 §10
follows.

## 15. Scope

**In:**
1. `sim/lib/core.cjs` — `RAY_TICKS_PER_DIAGONAL: 4` TUNABLE (§5); `RAY_STEP_BUDGET` unit note (§5.1).
2. `sim/lib/ray.cjs` — split into `walkRayPath()` (pure geometry, snapshot) + `IBattleRay` (live entity, `advance()`) (§6). `pathBatch`/`flushSteps` deleted. Dead `isDestroyedPassable` param removed (§3).
3. `sim/lib/skills.cjs` — `fireSkillRay` CREATES an `IBattleRay` and returns instead of walking; `dealHitFn`/`splashFn`/`liveOccupantFn` become ray-bound callbacks (§6.1). **+`hp_after` on every member of `ray_hit_all.hits[]` and `ray_aoe.hits[]`** (§10.1b — REQ-0263 §4.4's hand-off, accepted). **+the `ray` id at `:195`** (§10.1a site 1).
4. `sim/lib/formation_map.cjs` — `rays[]` + **`tickRays()`** (§12.1), replacing REQ-0256's no-op stub. REQ-0258 declares the file, REQ-0256 implements `tickInstances()`/`tick()`, this implements `tickRays()`. Three REQs, one file, three disjoint parts — and §12.1's table is the seam.
4b. `sim/lib/encounter.cjs:359` + `:378` — **the `ray` id stamped on the two SYNTHESISED `ray_fire`s** (§10.1a). Minted and closed in the same tick: no `IBattleRay`, no flight, no `ray_advance`.
5. `sim/lib/encounter.cjs` — fires no longer inline-resolve; `landedHits` (`:625, :643, :653, :703, :715`) is delivered on ARRIVAL, so the REQ-0078/0095/0200 reactive dispatch moves to the ray's hit callback. **This is the largest non-obvious edit in the REQ** — every `fr.landedHits` consumer assumed the ray had already resolved when `fireSkillRay` returned. It has not.
6. `shared/pacing.json` — `ray_advance` entries at 0/0; `rayStep` block + `ray_step` entries retired (§11.2).
7. `server/services/pacing.cjs` — `:44-51` `ray_step` special-case deleted (§11.2).
8. `server/lib/humanize.cjs` — `:14` retargeted, with collapsing (§11.3).
9. `client/src/schedule/MonitorRenderer.ts` — `STEP_ANIM_MS` deleted; `ray_step`→`ray_advance`; `currentRayField`→`Map<rayId, field>` (§11.1).
10. `client/src/schedule/fieldGeometry.ts` — tuple-contract doc + types (§11.4).
11. `sim/tests/forecast_parity.cjs` — 3 tests retargeted to `walkRayPath` (§11.6, §14.2).
12. `sim/tests/run.cjs` — 9 walkRay tests retargeted to `walkRayPath` (§13.1); NEW flight tests (§16).
13. Rebaselines per §14.
14. `docs/llm_managed/combat_spec_draft.md` — §3.2's pseudocode re-expressed; §3.6 rewritten (§10.1); §2.2/§2.3's rules **untouched** (§9).

**Out:**
- **The tick loop.** REQ-0256.
- **Mode/verb gating.** REQ-0259. This REQ freezes `ray.mode` (§7.1); 0259 is what gates on it.
- **Ray VFX / the trail.** REQ-0262 consumes §10's events.
- **Re-balancing the 47% nova rate** (§4.1, §14.3). A finding, not a fix.
- **Touching the telegraph** (§8.5). Flight partially duplicates `TELEGRAPH_LEAD_SECS`; note it, do not act.
- **Optimizing the 3.7x log** (§10.2). Surface the number; do not re-batch.
- **Unifying `ray_fire`'s three schemas** (§10.1a). Making the synthesised detection/unlock sites emit REAL rays is a combat change (attachments become physically reachable and missable); making them stop emitting `ray_fire` is a wire change with its own consumers. This REQ stamps the `ray` id at all three and WRITES THE SHAPE DOWN. A follow-up may unify it.
- **`sim/s4_thresholds.json`** (§14.3).
- **Editing `docs/user_managed/*`.** Forbidden. Nothing here needs it: `backpack_battle_spec.md`'s `attack_line` section describes GEOMETRY, and §9 confirms every geometry rule survives verbatim. **Verify this claim before shipping** — if any §9 verdict slips from SURVIVES, the golden doc is implicated and the REQ must stop and ask.
- **An e2e harness.** Not a gate for this program (Q2). Decade **7570 / 7571 / 7572** (`5000 + 257*10 + {0,1,2}`) is reserved-by-numbering and left unused.

## 16. Acceptance criteria

1. `1 / (TUNABLES.RAY_TICKS_PER_DIAGONAL * TUNABLES.TICK_SECS) === 25` — the RATE the user specified, asserted (§5). Moving `TICK_SECS` alone fails this test.
2. **A `ray_hit`'s `t` is strictly greater than its `ray_fire`'s `t`**, correlated by `ray` id, in a real run. This is the REQ in one assertion (§14.1 step 2).
3. The fire→hit gap equals `diagonals × RAY_TICKS_PER_DIAGONAL × TICK_SECS` exactly, for a fixture ray with a hand-computed trajectory.
4. **`walkRayPath()` and `IBattleRay.advance()` produce IDENTICAL geometry** given identical (frozen) occupancy — cell sequence, landing, bounces, abort. Asserted over `forecast_parity.cjs`'s existing fixture corpus. **If these diverge, the forecast lies to the player** (§6, §11.6).
5. `ray_step` appears nowhere: `grep -rn "ray_step"` returns zero hits outside `docs/`. `ray_advance` carries a tick-exact `t` and a `ray` id.
6. Every ray event carries `ray`; the monitor correlates on it and never on "most recent ray_fire" (§11.1). Proven by a test with two interleaved in-flight rays on opposite maps — the case that is unrepresentable today.
7. **FREEZE proven, both halves** (§7): a fixture where the owner's damage is buffed mid-flight lands the ORIGINAL damage; a fixture where the TARGET gains Weakness mid-flight lands the REDUCED damage. Both, or the rule is half-implemented.
8. **A ray whose target dies mid-flight flies on** and hits the next occupant (§8.1) — a fixture, not an argument.
9. The 5-bounce nova enumerates victims **at arrival**, not at fire (§8.4) — a fixture where an enemy dies during flight and is absent from `ray_hit_all.hits`.
10. `sim/tests/goldens.cjs` green at 12, rebaselined per §14.1, `def_sha256` **unmoved** on all 9 dungen cases, and each case's `events` growth matching §14.1's formula.
11. `sim/tests/forecast_parity.cjs` **18 passed, 0 failed** — the SAME 18, retargeted, not narrowed (§14.2).
12. `sim/tests/run.cjs` green; its 9 geometry tests retargeted to `walkRayPath` and **testing the same rules** (§13.1).
13. Every §9 verdict re-verified against the implementation. Any rule that did NOT survive verbatim stops the REQ and goes to the user — `docs/user_managed/backpack_battle_spec.md` describes this geometry and an LLM may not amend it.
14. `shared/pacing.json` carries `ray_advance: 0/0`; the 3.7x log growth (§10.2) is stated to the user before merge, with the measured before/after `events` counts per golden.
15. **The `ray` id is stamped at ALL THREE `ray_fire` sites** (§10.1a): `skills.cjs:195`, `encounter.cjs:359`, `encounter.cjs:378`. Asserted by a run **with attachments** — golden-A is a `batch002` combat run with none, so it exercises site 1 only and **cannot** prove this. Use a dungen case with a chest/trap (`dungen/default/L{1,3,5,8}`) and assert every `ray_fire` in the log has a `ray`.
16. **The non-uniform schema is honoured, not crashed into** (§10.1a): a consumer test feeds a synthesised `ray_fire` (`mode` present, `dir`/`pen`/`aoe` ABSENT) through `MonitorRenderer` and it does not throw. A `ray_fire` with no following `ray_advance` must be legal — sites 2/3 mint an id and close it in the same tick.
17. **`hp_after` is on every member of `ray_hit_all.hits[]` and `ray_aoe.hits[]`** (§10.1b), and it equals the victim's post-strike HP — asserted by a nova fixture with 2+ victims, cross-checked against a direct `ray_hit` on the same victim. **All ray damage is HP-attributable from the log alone**; this is what REQ-0263 §4.4 needs and it is now this REQ's to deliver.
