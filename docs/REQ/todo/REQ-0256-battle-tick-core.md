# REQ-0256 — battle-tick-core: the sim becomes a 0.01s tick loop, and a BP compiles to ONE IBattleInstance

**Status:** draft — spec RATIFIED (user, 2026-07-19); blocked only on the REQ-0255 baseline. The four review questions that blocked this REQ are resolved: (1) SUPERSEDING the ratified core of `combat_spec_draft.md` per ruling Q1 — **APPROVED**; (2) the irreversible rebaseline of all 12 replay goldens + S4 baselines (§12) — **APPROVED**; (3) §7.1a's split of the single-map `tick()` into `tickInstances()` / `tickRays()` — **APPROVED, not vetoed** (the birth-tick symmetry it buys stands); (4) the goldens' blindness to the charge engine (§8.5) — **proceed as specced; NO precursor REQ**. This REQ keeps the fix Out (§14) and relies on the §15.15 live-def test for charge coverage; widening the goldens to seat a charge unit is an OPTIONAL follow-up, not a blocker. NOTE (measured 2026-07-19): passing `unitDefsById` to `goldens.cjs` alone would be INERT — the golden squad's four BPs (`dwarf`/`elf`/`angel`/`lightcavalry`) are among the 12 units carrying NO `charge` block, so any future golden charge-coverage must seat a charge unit (e.g. `alchemist`), not merely pass the registry. Content authoring (adding units) is unrelated to the goldens, which are PINNED to a fixed batch-002 roster (REQ-0207). Remaining blocker before implementation: REQ-0255 ratified + merged (HANDS-OFF; needs user go-ahead) — 0256 branches from that baseline.
**Reserved:** 2026-07-18
**Slug:** battle-tick-core
**Branch:** req-expedition-spec (spec only; implementation branches from REQ-0255's merged baseline)
**Requested by:** user, 2026-07-18 — spec item (c), ruling Q1.
**Depends on:** REQ-0255 (expedition-merge-baseline) — branch from the merged baseline, not from
today's master. Soft-depends on REQ-0258 (formation-map-padding), which DECLARES
`IBattleInstancesFormationMap.tick()` and `rays[]`; this REQ IMPLEMENTS `tick()`. If 0258 lands
first, implement into its `sim/lib/formation_map.cjs`; if not, this REQ creates that file and 0258
adopts it. They do not conflict (0258 owns the ring/geometry, 0256 owns the clock).
**Blocks:** REQ-0257 (ray-flight-entity), REQ-0259 (battle-mode-verb-gating), REQ-0263
(expedition-instance-hud — `cooldownSkills` is its data source).
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q1, §3 C1, §4.

## 1. Goal

Three things, in one REQ because they are one rewrite:

1. Replace the priority-event-queue simulator with a **0.01s tick loop**. `sim/lib/heap.cjs`
   (`EventHeap`) retires.
2. Introduce **`IBattleInstance`**: each BP compiles to ONE instance carrying a FLAT
   `cooldownSkills` map that fuses its POs + SIs + the Unit's own effects — structurally
   identical to a monster's flat skill list.
3. Re-found determinism on **tick-ordering** instead of the `(t, seq)` tie-break.

Ray flight is NOT in this REQ. Rays still resolve instantly inside one tick (§11).

## 2. The ruling that authorizes this

Ruling Q1, verbatim:

> **シムを全面tick化** — the server sim is rewritten to a 0.01s tick loop. Ray flight is PHYSICAL
> and changes combat results. Goldens / determinism gate / forecast parity / S4 baselines all
> rebaseline.

And spec item (c), verbatim: 「仮に0.01秒tickだとして」 — "supposing a 0.01-second tick". The
word 仮に (provisionally) is why `TICK_SECS` is a TUNABLE and not a constant (§5).

## 3. What this REQ SUPERSEDES — quoted, not paraphrased

`docs/llm_managed/combat_spec_draft.md` is LLM-owned; this REQ edits it. These are the exact lines
that die.

### 3.1 §1.1 — the core loop (line 58-59), verbatim

> Combat is **not ticked**. It is a single **priority event queue** keyed on an absolute
> `t` in **seconds (float64)**. The simulator pops the earliest event, applies it, and
> pushes any follow-ups.

**SUPERSEDED.** Combat IS ticked. The pseudocode block at §1.1 lines 63-70 (`ev = queue.popMin()`
… `schedule(ev.followups)`) is replaced by §7's loop.

### 3.2 The binding-inputs line (line 32-33), verbatim

> Binding inputs honored: auto-battle (no mid-run input); seconds with decimal `[lo,hi]`
> ranges, **no ticks**;

**SUPERSEDED in exactly one clause.** "no ticks" dies. **"seconds with decimal `[lo,hi]` ranges"
SURVIVES** — `every_secs.s = [lo,hi]` remains the authoring unit in seconds, float. That is the
whole point of the quantization seam (§9): authoring stays in seconds; only the SCHEDULER is
integral. Do not read Q1 as re-authoring content into ticks.

### 3.3 §1.2 — the tie-break (line 84-85), verbatim

> - **Tie-break (critical):** events at equal `t` order by stable `(t, seq)`, `seq` a
>   monotone integer assigned at schedule time. Same seed ⇒ same `seq` order ⇒ identical run.

**SUPERSEDED** as the ORDERING LAW (replaced by §10's within-tick total order). **`seq` itself
SURVIVES as a wire field** — it stays a monotone integer stamped on every emitted event, because
the replay log, `shared/dto.ts` `ApiRunEvent.seq` (line 447), and every client consumer read it.
`seq` stops being an ordering INPUT and becomes an emission-order OUTPUT. This distinction is
load-bearing: §6 shows `heap.nextSeq()` is called from three modules, and all of those calls must
keep working.

### 3.4 Sections that die wholesale

| §§ | fate |
|---|---|
| §1.1 (Core loop) | **DIES.** Rewritten to the tick loop. |
| §1.2 bullet 4 (tie-break) | **DIES.** Replaced by §10. The other three bullets of §1.2 (master seed, named sub-streams, OQ1 float64/server-only) **SURVIVE VERBATIM**. |
| §1.4 (Simulated vs pre-computed) | **SURVIVES in substance, one clause dies.** Its "Simulated live (event by event)" heading becomes "Simulated live (tick by tick)". The compile-fold seam it defines is exactly what §8 extends. **[LOCKED OQ2] stays.** |
| §1.5 (Replay event log format) | **SURVIVES.** The JSONL shape, `t`, `seq` and every listed event keep their meaning. `t` is now always a multiple of `TICK_SECS`. REQ-0257 is what changes the ray events. |

**CORRECTION to the brief.** Brief §3 C1 says "**combat_spec §1.1/§1.4/§1.5 are SUPERSEDED.**"
Verified against the file: **that over-claims by two sections.** §1.4 loses one word ("event by
event") and keeps its entire compile-boundary ruling — which this REQ depends on, not supersedes.
§1.5 is not touched by THIS REQ at all; its ray events change in REQ-0257, and its `t`/`seq`/JSONL
contract survives both. The sections that actually die are **§1.1 and §1.2's tie-break bullet**.
Superseding §1.5 here would be a licence to break the replay wire format, which nothing in Q1
asks for and which would silently take the monitor with it.

## 4. Verified current state (I read every one of these)

| fact | source | evidence |
|---|---|---|
| the loop is a heap pop | `sim/lib/encounter.cjs:576-578` | `while (heap.size() > 0 && guardIters < 200000) { … const ev = heap.popMin();` |
| `(t,seq)` is the order | `sim/lib/heap.cjs:11-15` | `_less(i,j) { … if (A.t !== B.t) return A.t < B.t; return A.seq < B.seq; }` |
| `EventHeap` is imported ONCE | `sim/lib/encounter.cjs:6` | `const { EventHeap } = require('./heap.cjs');` — the only import in the tree |
| …and re-exported once | `sim/combat.cjs:50,68` | `const heap = require('./lib/heap.cjs');` / `EventHeap: heap.EventHeap,` |
| `combat.EventHeap` has NO consumers | grep over `sim/tests`, `server/`, `client/`, `shared/` | zero hits. The public export is dead weight; removing it breaks nothing. |
| `TICK_SECS` does not exist | `sim/lib/core.cjs:9-99` | `TUNABLES` has no tick constant of any kind |
| status tick is a scheduled event | `sim/lib/encounter.cjs:561,590` | `heap.push({ t: t0 + TUNABLES.STATUS_TICK_PERIOD_SECS, seq: heap.nextSeq(), kind: 'status_tick' });` |
| compile returns SEPARATE lists | `sim/lib/compile.cjs:373` | `return { bps, pos, sis, formationId, squadSlot, box, linkEdges };` |
| enemies are ALREADY flat | `sim/lib/encounter.cjs:531-535` | `e.raw.skills.forEach((skill, sIdx) => { if (skill.trigger && skill.trigger.t === 'every_secs') { enemySchedulable.push(…) } })` |
| cadence mult is HARDCODED 1.0 for POs | `sim/lib/encounter.cjs:518` | `const cadenceMultFor = () => 1.0; // cadence buffs folded at compile-time (OQ2); no per-actor Haste/Chill on POs in v1 scope.` |
| …except under a charge manager | `sim/lib/encounter.cjs:146-153,670` | `playerCadenceMult(ownerUid)` → `Math.max(0.2, cadenceMultiplier(bp.statusBag))`, passed to `scheduleEffect` ONLY when `chargeMgr` exists |
| enemy reschedule is ALWAYS 1.0 | `sim/lib/encounter.cjs:723` | `if (s && s.raw.alive) scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, ev.t, 1.0);` |

### 4.1 The three landmines a naive rewrite trips

These are the reason this REQ is not "swap the loop and re-run gen". Each was found by reading, and
each is a hard blocker if missed.

**(a) `heap.nextSeq()` is a SEQ ALLOCATOR used far outside the heap.** The heap is not only a
queue; it is the monotone-counter service for the whole replay log. Measured call sites of
`heap.nextSeq()`:

| module | count | note |
|---|---|---|
| `sim/lib/encounter.cjs` | 30 | every `events.push({ t, seq: heap.nextSeq(), … })` |
| `sim/lib/unit_charge_encounter.cjs` | 6 | lines 109, 134, 144, 161, 172 — the manager is HANDED the heap (`encounter.cjs:141` `createEncounterChargeManager({ …, heap, … })`) purely for this |
| `sim/lib/skills.cjs` | 1 | line 306, inside `scheduleEffect` |

So `EventHeap` cannot simply be deleted: **the seq allocator must survive it.** Extract it to a
`SeqCounter` (§6.2). `unit_charge_encounter.cjs`'s `heap` parameter is renamed but its behaviour is
unchanged — it never pushes, only allocates (verified: no `heap.push` in that file).

**(b) `chargeOps.advanceCooldown` REACHES INTO THE HEAP ARRAY.** `sim/lib/encounter.cjs:82-93`,
verbatim:

```js
advanceCooldown(bpId, n, t) {
  const uids = new Set(troopPos.filter(p => p.bpId === bpId).map(p => p.uid));
  if (!uids.size) return;
  let changed = false;
  for (const e of heap.a) {
    if (e.kind === 'skill_fire' && uids.has(e.ownerUid)) {
      const nt = Math.max(t, e.t - n);
      if (nt !== e.t) { e.t = nt; changed = true; }
    }
  }
  if (changed) { const items = heap.a.splice(0); for (const it of items) heap.push(it); }
}
```

This is REQ-0212's `advance_cooldown` charge verb. It mutates scheduled `skill_fire` events in
place and re-heapifies. **When the heap dies, this has no substrate.** Its tick-model equivalent is
a direct, and much simpler, `remainingTicks` decrement — §8.4. This is the single largest
behavioural risk in the REQ, and the two facts that make it so are both MEASURED:

- **It is LIVE, on 42 of 54 units.** Production passes `unitDefsById` (`server/services/runs.cjs:83-91`),
  so `bp.charge` is set for the **42 live units that carry a `charge` block** and the charge manager
  IS constructed (`encounter.cjs:40,140`). This is a real gameplay change on most of the roster, not
  a fixture-only concern. (`compile.cjs:142-144`'s comment claims the opposite; it is STALE. The
  measurement and the full correction are REQ-0263 §5.5, restated in §8.5.)
- **The 12 replay goldens CANNOT see it.** `sim/tests/goldens.cjs:63` omits `unitDefsById`, so every
  golden compiles with `UNIT_DEFS = {}` and never builds a `chargeMgr` at all. §13.1's diff is silent
  here by construction.

So the guard is **not** the goldens. It is `sim/tests/unit_charge_encounter_test.cjs` (23/23 —
measured §12), which is the ONLY gate that exercises this path, plus the live-def case §8.5 requires
this REQ to add. §8.5 spells out the respec and what must cover it.

**(c) `encounter_end`'s TIMESTAMP is read off the heap's next event.** `sim/lib/encounter.cjs:788`,
verbatim:

```js
events.push({ t: heap.size() ? heap.a[0].t : deadlineSecs, seq: heap.nextSeq(), ev: 'encounter_end', enc: encIndex, result, troop_bp_hp: troopBps.map(b => b.hp) });
```

`heap.a[0].t` is "the time the NEXT unfired event would have fired" — a quantity that does not
exist in a tick loop. **This must be respecified, not ported.** Ruling: `encounter_end.t` becomes
**the tick at which the loop broke**, i.e. `currentTick * TICK_SECS`, falling back to
`deadlineSecs` when the loop exits by deadline. Rationale: it is the honest answer to "when did
this encounter end" — the old expression answered "when would the next thing have happened", which
was an artifact of the queue, not a fact about the encounter. This CHANGES `encounter_end.t` in
every golden. Called out explicitly because it will look like a bug in the golden diff and it is
not; §13.1 tells the reviewer where to look.

Note also that `tickAndEmit` (`sim/lib/encounter.cjs:792-798`) pushes `status_tick` events with
**no `seq` field at all** (lines 795-796) — an existing inconsistency with every other emitter.
Do NOT fix it in this REQ. It is a byte in the golden; changing it here would mix an unrelated
correction into an already-large rebaseline. Log it for a follow-up.

## 5. `TICK_SECS` — the TUNABLE

**New entry in `sim/lib/core.cjs` `TUNABLES`** (the table at lines 9-99):

```js
// REQ-0256 (spec c, ruling Q1): the sim's tick period. The user's directive says
// "仮に0.01秒tickだとして" -- PROVISIONALLY 0.01s. It is a TUNABLE for that reason:
// the number is a design choice the user may move, not a law. NOTHING may hardcode
// 100 (= 1/TICK_SECS) or 0.01. Every seconds->ticks conversion goes through
// secsToTicks() so there is ONE place the quantization happens.
TICK_SECS: 0.01,
```

**The sim must never hardcode 100.** This is not style. `TICK_SECS` appears in three derived
quantities, and each must be DERIVED at use, never written as a literal:

| derived | expression | today's value |
|---|---|---|
| status tick cadence | `STATUS_TICK_TICKS = secsToTicks(TUNABLES.STATUS_TICK_PERIOD_SECS)` | 100 |
| a rolled cooldown | `secsToTicks(rolledSecs)` | varies |
| ray diagonal cadence | `TUNABLES.RAY_TICKS_PER_DIAGONAL` | 4 — **REQ-0257 adds this, not this REQ** |

**Add a gate** (`sim/tests/run.cjs`): grep `sim/lib/*.cjs` as TEXT for a bare `100` or `0.01` in a
tick context, and assert `secsToTicks(1.0) === 100` holds only BECAUSE `TICK_SECS === 0.01` —
i.e. a test that FAILS if someone moves `TICK_SECS` to 0.02 and the sim keeps behaving as if it
were 0.01. Precedent: `sim/tests/forecast_parity.cjs:187-189` pins `RAY_STEP_BUDGET` /
`ENTRY_JITTER_HALF_WIDTH` across the shared/ boundary for exactly this reason. A tunable nobody
checks is a constant with extra steps.

## 6. Retiring `sim/lib/heap.cjs` — the consumer census

### 6.1 Every consumer, verified

Grepped `EventHeap|heap\.cjs|require.*heap` across the tree (excluding `node_modules`). **The
COMPLETE list; there are no others:**

| file:line | what | fate |
|---|---|---|
| `sim/lib/encounter.cjs:6` | `const { EventHeap } = require('./heap.cjs');` | **DELETE** |
| `sim/lib/encounter.cjs:27` | `const heap = new EventHeap();` | **REPLACE** with `const seq = new SeqCounter();` |
| `sim/combat.cjs:50` | `const heap = require('./lib/heap.cjs');` | **DELETE** |
| `sim/combat.cjs:68` | `EventHeap: heap.EventHeap,` (public export) | **DELETE** — zero consumers (§4) |
| `sim/lib/heap.cjs` | the file (54 lines) | **DELETE**, but see §6.3 — the dir-vector comment block at lines 47-50 is orphaned prose, not code |

Indirect consumers that take `heap` as a PARAMETER and only ever call `nextSeq()` / `push()`:

| file:line | signature | fate |
|---|---|---|
| `sim/lib/skills.cjs:301` | `scheduleEffect(heap, rng, ownerUid, effIdx, effect, encounterStart, cadenceMult, pushEvFn)` | **DELETED ENTIRELY** — §8.3. Its whole body is a heap push. |
| `sim/lib/unit_charge_encounter.cjs` (6 sites) | `createEncounterChargeManager({ …, heap, … })` | **RENAME** the field `heap` → `seq`. Never pushes; only allocates. Behaviour identical. |

### 6.2 What survives the heap: `SeqCounter`

`heap.nextSeq()` has 37 call sites (§4.1a). They all keep working, against a 4-line object that is
the heap's counter with the heap removed:

```js
// sim/lib/seq.cjs -- REQ-0256. The replay log's monotone emission counter.
// This is EventHeap's _seq, extracted: the heap retired (REQ-0256) but `seq`
// is a WIRE FIELD (shared/dto.ts ApiRunEvent.seq) that every replay consumer
// reads, so the counter outlives the queue that used to own it. It no longer
// ORDERS anything -- ordering is the tick loop's (REQ-0256 s10) -- it only
// stamps emission order onto the log.
class SeqCounter {
  constructor() { this._seq = 0; }
  nextSeq() { return this._seq++; }
}
```

Placed in its own `sim/lib/seq.cjs` rather than folded into `core.cjs`: `core.cjs` is a pure
tunables+deepCopy table (its header says so) and a stateful counter does not belong there.

### 6.3 Do not lose the orphaned comments

`sim/lib/heap.cjs:47-50` carries a comment block that is NOT about the heap:

```
// Diagonal direction vectors (S2.2/S3): (drow,dcol) terms.
// down-right=(+1,+1)  down-left=(+1,-1)  up-right=(-1,+1)  up-left=(-1,-1)
```

That is REQ-0047's file-split leaving a header stranded (the same pattern exists in `rng.cjs:42-45`,
which carries a comment about the event queue, and `field.cjs:22-26`, which carries one about
replay helpers). It documents `geometry.cjs`'s `DIR_VEC`. When deleting `heap.cjs`, do NOT delete
this prose — it belongs at `sim/lib/geometry.cjs:7` where `DIR_VEC` actually lives. Likewise
`rng.cjs:42-45`'s "Event queue -- binary min-heap keyed on (t, seq)" comment becomes FALSE the
moment the heap dies and must be removed in the same commit. A stale comment describing a deleted
subsystem is worse than no comment.

## 7. The tick loop

`sim/lib/encounter.cjs` `runEncounter` (832 lines) keeps its ENTIRE structure — the compile,
actor-building, attachment, pulse, hp-below and charge scaffolding at lines 15-573 is untouched.
**Only the driver at lines 575-756 is rewritten.** That is roughly 180 of 832 lines.

### 7.0 The `Battle` object — `sim/lib/battle.cjs` (NEW)

Brief §4 makes `Battle` normative and spec item (b) assumes it: 「Battle」というクラスがその二つの
参照を持っていると仮定して続けます — *"I continue on the assumption that a class called `Battle`
holds those two references."* Nothing in the tree creates one today. **This REQ creates it.**

```js
// sim/lib/battle.cjs
createBattle({ playerMap, enemyMap, modeConfig, fire, rollCooldownTicks }) -> Battle

Battle
  playerMap  : IBattleInstancesFormationMap   // spec b -- REQ-0258's formation_map.cjs
  enemyMap   : IBattleInstancesFormationMap   // spec b
  modeConfig : BattleModeConfig | null        // RESERVED HERE, POPULATED BY REQ-0259 -- see below
  tickIndex  : int                            // the clock. THE integer tick counter (s10.3)
  t()        : float                          // === tickIndex * TICK_SECS. COMPUTED, never accumulated
  tick()                                      // spec c: the chain. See s7.1.
```

**`modeConfig` is reserved, not implemented.** 0256 declares the field and initialises it to `null`.
**Nothing in 0256 reads it**, exactly as `IBattleInstance.mode` is declared-but-inert here (§8.3).
REQ-0259 populates it and is the only REQ that gives it meaning. It is named here solely so that
0259 has a field to fill and does not have to re-open `battle.cjs`'s shape to get one.

**`Battle` is a VALUE that `runEncounter` DRIVES — it is NOT the new home of the loop.** This is a
decision, so here is the justification rather than a default:

- **`runEncounter` is 832 lines and only ~180 of them are the driver.** The other ~650 are compile,
  actor-building, attachment, pulse, hp-below and charge scaffolding (§7 preamble). Moving the loop
  into `Battle` would drag that scaffolding — or a callback for every piece of it — across a new
  module boundary, in the same REQ that already rebaselines all 12 goldens. **Two large, unrelated
  diffs in one rebaseline is precisely what §11 argues against** for 0256/0257, and the argument
  does not stop applying because the second diff is a refactor.
- **The fire bodies stay where they are.** `Battle`/map/instance are handed `fire` and
  `rollCooldownTicks` as closures over `runEncounter`'s existing scope. The chain decides WHEN and
  in WHAT ORDER; `runEncounter` still owns WHAT a fire does. Not one existing fire body moves.
- **`runEncounter` keeps the entry point, the termination check, and the result.** Those read
  encounter-level state (deadline, attachments, `encIndex`, the events array) that is not the
  Battle's business. `Battle` owns the clock and the tick chain; that is all it owns.

So the relationship is: **`runEncounter` constructs one `Battle` after compile, then calls
`battle.tick()` once per tick and asks its own termination question.** A follow-up REQ may move the
scaffolding in behind `Battle` later; this REQ does not, and §14 records that as OUT.

### 7.1 The loop

```js
const seq = new SeqCounter();
const TICK = TUNABLES.TICK_SECS;
const deadlineTicks = secsToTicks(deadlineSecs);
const STATUS_TICK_TICKS = secsToTicks(TUNABLES.STATUS_TICK_PERIOD_SECS); // 100 today

// s7.0: runEncounter builds the Battle from what compile() produced, then DRIVES it.
const battle = createBattle({
  playerMap : createFormationMap({ instances: playerInstances }),  // REQ-0258's formation_map.cjs
  enemyMap  : createFormationMap({ instances: enemyInstances }),
  modeConfig: null,               // s7.0: RESERVED. REQ-0259 populates it; nothing here reads it.
  fire,                           // the existing fire closures, unchanged -- s7.0
  rollCooldownTicks,              // s8.5
});

for (; battle.tickIndex <= deadlineTicks; battle.tickIndex++) {
  const t = battle.t();           // === tickIndex * TICK. NEVER `t += TICK` -- see s10.3
  simNow = t;
  if (hasAtt) checkAttachmentTimeouts(t);

  // 1. status cadence -- fires on the 100-tick boundary, NOT every tick (s7.2)
  if (battle.tickIndex > 0 && battle.tickIndex % STATUS_TICK_TICKS === 0) { …existing status_tick body verbatim… }

  // 2. THE CHAIN (spec c, brief s4). This is the whole of the fire step: battle ticks ->
  //    maps tick -> instances tick. The s10 total order is the chain's own shape (s7.1a).
  battle.tick();

  // 3. REQ-0048 pulse arrivals scheduled for THIS tick
  drainPulseArrivals(battle.tickIndex, t);

  // 4. termination -- the existing s743-755 block, verbatim
  if (…allEnemiesDead()… ) { result = 'clear'; break; }
  …
}
```

#### 7.1a The chain — who calls what

Spec item (c) requires the tick to CASCADE: **Battle ticks -> the maps tick -> the instances tick.**
Brief §4 states the middle link verbatim: *"`tick()` // spec c: forwards tick to instances, then
advances rays"*. The loop above therefore does not inline the fire walk; it delegates it. The three
levels of the chain **are** the three levels of §10.1's total order — map, then instance, then slot —
which is why the chain is not merely spec-compliance here: it is the total order made structural,
and a flat loop would restate that order in a second place where it could drift.

```js
// sim/lib/battle.cjs
tick() {
  // Phase A -- FIRES. Map order per s10.1: player, then enemy.
  this.playerMap.tickInstances();
  this.enemyMap.tickInstances();
  // Phase B -- RAY ADVANCES. Map order per REQ-0257 s12.3.
  this.playerMap.tickRays();      // NO-OP in 0256: rays[] is always empty (s11). REQ-0257 fills it.
  this.enemyMap.tickRays();
}

// sim/lib/formation_map.cjs (REQ-0258 declares the file; this REQ implements these two)
tickInstances() {
  for (const inst of this.instances) {      // stable instance index order (s10.1)
    if (inst.alive) inst.tick();
  }
}
tickRays() { /* REQ-0257 s12.1. Empty list in 0256 -> no-op. */ }
tick() { this.tickInstances(); this.tickRays(); }   // brief s4's single-map entry point; see below

// IBattleInstance
tick() {
  for (const [slot, cd] of this.cooldownSkills) {   // insertion order = slot order (s8.4)
    cd.remainingTicks -= 1;
    if (cd.remainingTicks > 0) continue;
    this.fire(slot, cd.skill);                      // existing fire bodies, unchanged
    cd.remainingTicks = this.rollCooldownTicks(slot, cd.skill);   // s8.5 RESET
  }
}
```

**`map.tick()` is SPLIT into two phase methods, and `Battle` calls the phases, not `tick()`. This is
a deliberate, user-visible refinement of brief §4 — flagged, not smuggled.** The reason is that
brief §4 wrote `tick()` for ONE map and there are TWO:

- Brief §4's single `tick()` = instances, **then** rays, per map. With two maps that composes to
  `playerInstances, playerRays, enemyInstances, enemyRays`.
- REQ-0257 §12.1 requires `playerInstances, enemyInstances, playerRays, enemyRays` — **all** fires,
  then **all** advances.

These are **not the same order**, and the difference is not cosmetic. Rays live on the map they were
fired ONTO (REQ-0257 §6), so a player instance's fire creates a ray in `enemyMap.rays`. Under the
per-map composition, `enemyMap` has not ticked yet when that ray is born, so the ray is advanced on
its birth tick; but an enemy instance's fire creates a ray in `playerMap.rays`, which has ALREADY
ticked, so that ray is NOT advanced on its birth tick. **The player's rays would arrive one tick
sooner than the enemy's, for no reason but the order the two maps happen to be composed in** — the
exact birth-order coupling REQ-0257 §12.2 rejects, and a systematic player advantage on top of the
one §10.2 already accepts. Phase-splitting removes it: every ray, both sides, takes exactly
`RAY_TICKS_PER_DIAGONAL` ticks from fire to first diagonal.

`tick()` is retained on the map as brief §4's normative single-map entry point (and is exactly
`tickInstances(); tickRays()`), but **`Battle` does not call it** — with two maps it cannot express
§12.1's order. The cascade spec (c) asks for is fully intact: Battle -> map -> instance, one call
per level. Only the map's internal one-method-ness is split, and only because two maps exist.
**This is an interpretation and the user may veto it** (see the Status block); the veto's cost is
the birth-tick asymmetry above, which would then have to be accepted and documented in 0257 §12.2.

### 7.2 Status ticking: every 100 ticks, NOT every tick — and why

This is the subtlest correctness point in the REQ. Today, `tickAndEmit`
(`sim/lib/encounter.cjs:793`) calls:

```js
const ticks = tickStatuses(actor.statusBag, TUNABLES.STATUS_TICK_PERIOD_SECS);
```

It passes **`P` (=1.0), not a delta.** And `tickStatuses` (`sim/lib/status.cjs:139-174`) does:

```js
bag._acc = (bag._acc || 0) + dtSecs;
if (bag.Stun) { bag.Stun.remain -= dtSecs; … }        // line 146
if (bag.Weakness) { bag.Weakness.remain -= dtSecs; … } // line 147
if (bag.Haste) { bag.Haste.remain -= dtSecs; … }       // line 148
while (bag._acc >= P) { bag._acc -= P; …Burn/Poison/Chill/Regen… }
```

Two consequences a naive "call it every tick with dt=0.01" would silently break:

1. **Stun/Weakness/Haste `remain` counts down in 1.0s GRANULARITY today**, because `dtSecs` IS
   `P`. Its comment at line 143 claims "real time, not period-quantized" — **that comment is
   FALSE**, and has been since the function's only caller passes `P`. Calling with `dt=0.01`
   would make it TRUE, which sounds like an improvement and is actually an unrequested balance
   change to every Stun/Weakness/Haste duration in the game, buried inside a tick rewrite. **Do
   not.**
2. **Float drift.** `0.01` is not binary-representable. Accumulating `_acc += 0.01` a hundred times
   yields `1.0000000000000007`, and the drift compounds across a 600s deadline. Passing `P` once
   per 100 ticks keeps `_acc` on the exact 0→1.0→0 cycle it rides today.

**Ruling: fire the status tick every `STATUS_TICK_TICKS` ticks and keep passing `P`.** This
reproduces today's status semantics EXACTLY. It is the conservative choice and it is the correct
one: this REQ moves the SCHEDULER, not the status system. Fix line 143's false comment in the same
commit (it costs nothing and it is actively misleading).

Note `STATUS_TICK_TICKS = secsToTicks(1.0) = 100` today, which is exact. If a future `TICK_SECS`
does not divide `P`, `secsToTicks` rounds and the cadence drifts from `P` by <1 tick — acceptable
and documented, but the gate in §5 is what will notice.

### 7.3 What the loop does NOT change

Every fire body — `fireSkillRay` calls, telegraph emission, the REQ-0078 reactive dispatch
(`encounter.cjs:624-641, 700-711`), the REQ-0095 player-side dispatch (462-515), the REQ-0121
`on_hp_below` watchers (212-277), the REQ-0049 attachment resolution (279-399), the REQ-0200
charge hooks (34-153, 584-589, 645-662, 712-720), the REQ-0212 `transfer_status` / `breakShield`
ops (94-138) — is **carried over verbatim**. They are called from a different driver; their bodies
do not know the difference. Only their SCHEDULING changes.

`heap.push({kind:'pulse_arrive'})` (`encounter.cjs:408`) is the one non-skill scheduled event. It
becomes a `Map<tickIndex, PulseArrival[]>` drained at step 3 of §7.1. `PULSE_HOP_LATENCY_SECS`
(0.15s) quantizes through the same `secsToTicks` seam → 15 ticks, exactly.

## 8. The flattening ("ビルド") — `IBattleInstance`

### 8.1 What the user requires

Brief §1, source-verified against REQ-0165: **the BP:Unit law — a BP and a Unit are 1:1; every BP
carries exactly one Unit; a BP with no Unit cannot exist.** Therefore
**IBattleInstance (player side) == one BP**, and its skills are the flattened POs + SIs + the
Unit's own effects. Brief §2, confirmed against `content/live/dungeon/enemies.json`: the target
shape is what enemies ALREADY have (`hp`, `footprint`, `skills[]`). The player side is compiled TO
it — 「平坦化したスキルを持つモンスターと同じ構造」.

### 8.2 The transform, exactly

`sim/lib/compile.cjs` `compileSquadSnapshot` (line 54) today returns, at line 373:

```js
return { bps, pos, sis, formationId, squadSlot, box, linkEdges };
```

— four parallel lists the encounter loop must re-correlate on every fire (`encounter.cjs:592-594`
does `schedulable.some(...)` then `schedulable.find(...)`; lines 810-822 re-resolve
`troopPos.find(p => p.uid === ownerUid)` then `troopBps.find(b => b.id === po.bpId)` — an O(n)
lookup per fire, three times over).

**It gains ONE more return field. It does not lose any.**

```js
return { bps, pos, sis, formationId, squadSlot, box, linkEdges, instances };
```

`instances` is `IBattleInstance[]`, one per BP, built by a new `buildInstances(bps, pos, sis)`
pass that runs AFTER all existing folding (compile.cjs passes 1-3, lines 279-357) so it sees
final, buff-folded effects.

**Why additive and not a replacement:** `bps`/`pos`/`sis` are read by `runEncounter`'s
`troopBps`/`troopPos`/`troopSis` opts (`encounter.cjs:17`) in ~40 places, by `sim/lib/dungeon.cjs`,
and by the S4 harness. Deleting them in the same REQ that rewrites the loop would make the golden
diff unattributable. **`instances` is the new truth; the flat lists are retained as a
compatibility surface and deleted in a follow-up REQ once every consumer reads `instances`.** Same
doctrine as REQ-0184's port note ("a fix is not a rebalance, and mixing them makes the diff
unreadable") and the reason the brief itself splits 0256 from 0257.

### 8.3 `IBattleInstance` — the shape

```
IBattleInstance
  id           : string           // the BP id (player) | the enemy ownerId (enemy)
  kind         : 'bp' | 'enemy' | 'gimic'   // 'gimic' arrives with REQ-0259
  squadSlot    : 'unit1'..'unit4' | null      // player side only
  fieldCells   : [row,col][]      // footprint on its OWN map
  hp, hpMax    : number           // BP: VX-1 hpMax (compile.cjs:70). enemy: rolled (packs.cjs)
  alive        : boolean
  mode         : 'battle'|'detection'|'unlock'   // DECLARED here, USED by REQ-0259
  statusBag    : StatusBag        // the existing bag, verbatim
  cooldownSkills : Map<int, { skill: IBattleInstanceSkill, remainingTicks: int }>
```

`mode` is declared in this REQ and defaults to `'battle'` for every instance. **REQ-0259 is what
makes it mean anything.** Declaring it here (and not there) keeps the interface stable across the
two REQs; a field that appears mid-program forces a second compile-surface change.

### 8.4 `cooldownSkills` — the FLAT map that fuses PO + SI + Unit

The key `int` is a **stable slot index**, assigned once at compile time in a deterministic order.
**The order IS the determinism** (§10), so it is specified exactly, not left to iteration luck:

```
slot order for a player BP's cooldownSkills, in this exact sequence:
  1. the BP's POs, ordered by ASCENDING po.uid (string compare)   -- source: compile.cjs posRaw
       for each PO: its effects, in DEF ARRAY ORDER (effIdx 0,1,2,...)
  2. the SIs seated in those POs, ordered by ASCENDING si.uid       -- source: compile.cjs sis
       for each SI: its effects, in DEF ARRAY ORDER
  3. the Unit's OWN effects, in DEF ARRAY ORDER                    -- source: UNIT_DEFS[bp.unitId]
```

Only effects with `trigger.t === 'every_secs'` get a `cooldownSkills` slot — that is exactly
today's `schedulable` filter (`encounter.cjs:160-166`) and today's enemy filter
(`encounter.cjs:531-535`). Reactive triggers (`on_hit`, `OnBPBeenHit`, `on_hp_below`,
`on_link_pulse`, `battle_start`, `passive`, `adjacent`) are NOT cooldown-driven and keep their
existing dispatch paths untouched. **`cooldownSkills` is the TIMED-FIRE map, not "all effects".**
Naming it otherwise would invite someone to route reactives through it.

**Why ascending uid and not array order:** `posRaw` order derives from `st.pos.filter(p => p.loc === 'grid')`
(`compile.cjs:156`) — i.e. from scenario.json's array order, which is authoring incident, not a
contract. `uid` is minted per instance and stable across saves. Sorting by it makes the slot map
reproducible from the DATA rather than from the file layout. This is a real (small) behaviour move
and it is deliberate: it is what makes §10's total order well-defined.

**A monster's instance is built the same way** from `e.raw.skills` in def array order (its `sIdx`,
exactly as `encounter.cjs:531` uses today). Player and enemy differ ONLY in provenance — the
brief's "Same interface, different provenance". That IS the flattening.

**`IBattleInstanceSkill`** carries `{ trigger, verb, attack_profile, modes }` — the same four
fields `goldens.cjs:38` already builds for monster skills
(`skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes }`).
For a PO effect the `attack_profile` resolves through the existing precedence
(`encounter.cjs:163`): `eff.attack_profile || po.def.attack_profile || defaultAttackProfileFor(po)`.
Preserve that precedence exactly; it is load-bearing for every live item.

### 8.5 Tick semantics — decrement, fire, RESET

Per brief §4 and spec item (c):

```
tick():  for each slot in cooldownSkills (insertion order):
           remainingTicks -= 1
           if remainingTicks === 0:
             fire(skill)
             remainingTicks = rollCooldownTicks(...)   // "数値を戻します"
```

`rollCooldownTicks` is the ONLY place seconds become ticks:

```js
function rollCooldownTicks(inst, slot, skill, t) {
  const s = skill.trigger.s;                                   // [lo,hi] SECONDS, unchanged
  const stream = rng.stream(effectStreamName(ownerUid, effIdx) + '/timing');  // SAME name as today
  const secs = stream.range(s[0], s[1]) * cadenceMultFor(inst);  // s9: multiplier on SECONDS
  return secsToTicks(secs);
}
```

Compare `sim/lib/skills.cjs:301-307` (`scheduleEffect`), which this replaces:

```js
const stream = rng.stream(effectStreamName(ownerUid, effIdx) + '/timing');
const interval = stream.range(s[0], s[1]) * cadenceMult;
const fireAt = encounterStart + interval;
heap.push({ t: fireAt, seq: heap.nextSeq(), kind: 'skill_fire', … });
```

**The stream name, the draw order, and the multiply are IDENTICAL.** The only difference is the
last line: `secsToTicks(interval)` instead of `encounterStart + interval`. That is the whole
change, and keeping it that small is what makes the golden diff attributable to quantization
alone.

**The initial roll** happens at compile/battle-start, replacing `encounter.cjs:519-526` (player,
mode-filtered) and `:544` (enemy). Same streams, same order, same mode filter.

**`advance_cooldown` (§4.1b) becomes trivial and honest:**

```js
advanceCooldown(bpId, n, t) {
  const inst = instanceOf(bpId);
  if (!inst) return;
  const dTicks = secsToTicks(n);
  for (const cd of inst.cooldownSkills.values()) {
    cd.remainingTicks = Math.max(1, cd.remainingTicks - dTicks);   // s9: floor at 1
  }
}
```

The old version could only pull an event to `Math.max(t, e.t - n)` — never before NOW. The new one
floors at 1 tick — never fire THIS tick from an advance. **These are not the same rule**, and the
difference is a real behaviour change on charge-bearing content.

**This is a LIVE gameplay change affecting 42 of 54 live units, and no golden will catch it.**
Both halves of that sentence are measured; neither was in this REQ's first draft, which claimed the
respec was unobservable. It is not:

| fact | source |
|---|---|
| **42 of 54 live units carry a top-level `charge` block** — `alchemist`, `darkknight`, `dragonknight`, `hero`, `jester`, `bard`, `cleric`, … | `content/live/live_units.json`, measured; **REQ-0263 §5.5** |
| production **does** pass `unitDefsById`, so `bp.charge` is set and `chargeBps` is non-empty -> the charge manager **is constructed** | `server/services/runs.cjs:83-91`; `sim/lib/encounter.cjs:40,140` |
| the goldens **do not** pass `unitDefsById` (`baseOpts` omits it) -> they compile with `UNIT_DEFS = {}` -> **no `chargeMgr` is ever built in any of the 12** | `sim/tests/goldens.cjs:63` |
| `compile.cjs:142-144`'s comment *"no live unit carries a charge block"* is **STALE** — REQ-0129 shipped `vocab.json` v13's charge block and the roster was authored against it. Its *second* clause ("callers with no unit registry resolve `UNIT_DEFS = {}`") is still true and is the one doing the work. | `sim/lib/compile.cjs:142-144`; REQ-0263 §5.5 |

**Consequence for this REQ, stated plainly: the 12 replay goldens are BLIND to `advance_cooldown`.**
§13.1's golden diff will be silent about the single largest behavioural risk in this REQ. A green
rebaseline is therefore **not** evidence that the respec is safe, and must not be read as any.

**What actually covers it — name it, because the goldens do not:**

1. `sim/tests/unit_charge_encounter_test.cjs` (23 tests, fixture-driven) — **the only gate that
   constructs a charge manager at all.** Expect movement here; every moved assertion must be traced
   to the floor-at-1 rule and recorded in the REQ (§15.10). This suite is now load-bearing far
   beyond its size: it is not a unit test of a corner, it is the whole net.
2. `sim/tests/unit_charge_test.cjs` (13 tests) — the charge runtime, no encounter.
3. **NEW, required by this REQ:** an `advance_cooldown` case built on a **live** unit def — pass
   `unitDefsById` for one of the 42 (`alchemist`'s `{every_secs, fire_on_full, [2,3]}` is the
   simplest) and assert the pulled cooldown. The existing 23 use synthetic fixtures; nothing today
   proves the verb works on content a player can actually field. §15.15.

**Fixing the goldens' charge-blindness is OUT of scope** (§14) — passing `unitDefsById` into
`baseOpts` would change what the goldens simulate, which is a contract change dressed as a test fix,
and it belongs to a REQ that can look at it alone rather than underneath a tick rewrite. It is
raised to the user in the Status block. Justify the floor-at-1 in the same terms as §9.

## 9. The quantization seam — the ONE place seconds become ticks

```js
// sim/lib/core.cjs -- REQ-0256. THE quantization seam. Every seconds->ticks
// conversion in the sim goes through this function and no other.
function secsToTicks(secs) {
  return Math.max(1, Math.round(secs / TUNABLES.TICK_SECS));
}
```

Per brief §4 and its "document it as the one quantization seam".

### 9.1 Why `round` and not `floor`/`ceil`

`round` is the unbiased choice: over the `[lo,hi]` uniform draw, `floor` would shorten every
cooldown by a mean of half a tick (5ms) and `ceil` would lengthen it by the same. `round` has zero
mean error. At `TICK_SECS = 0.01` the worst-case per-fire error is 5ms against `every_secs` ranges
that live in the 0.6-6s band on current content — a relative error under 1%. That is the price of
the model and it is small; a biased rounding would compound over a 300s run into seconds of drift
per instance.

### 9.2 Why `max(1, ...)` — justified, not assumed

The floor at one tick is what makes the tick model **total**. Three independent reasons, each
sufficient:

1. **A 0-tick cooldown is a same-tick refire storm.** `remainingTicks = 0` means the `if
   (remainingTicks > 0) continue` guard falls through on the SAME iteration, fires again, resets to
   0 again — an unbounded loop inside one tick that no `guardIters` counter catches (the existing
   guard at `encounter.cjs:576` counts heap pops, and there is no heap). This is the exact hazard
   the code ALREADY guards in the analogous place: `encounter.cjs:150-152`, verbatim —
   *"Floor the net multiplier at 0.2 (<=5x cadence): unbounded Haste stacks would otherwise drive
   the interval to zero/negative -> same-tick refire storm (a determinism/DoS hazard the sim never
   had while POs ignored Haste). Documented guard."* Same hazard, same answer, one layer down.
2. **Negative is representable.** `cadenceMultiplier` (`status.cjs:116-122`) returns
   `1 + (chill*0.04 - haste*0.04)`, which goes NEGATIVE at 25+ net Haste stacks. The existing 0.2
   floor only applies on the charge path (`encounter.cjs:152`); the enemy path passes a hardcoded
   `1.0` (`:723`) and the non-charge player path passes `1.0` (`:670`). `max(1, round(negative))`
   is the last line of defence and it belongs at the seam, not at each caller.
3. **It is the model's only honest answer.** A tick loop cannot represent "fires in less than one
   tick". Rounding a 4ms cooldown to 0 asserts something the model cannot do; rounding it to 1
   asserts the fastest thing the model CAN do. The alternative — sub-tick scheduling — is the event
   queue we are deleting.

**The cost, stated plainly:** any authored `every_secs.s` below `TICK_SECS/2` (0.005s) silently
becomes 1 tick. No live content is near that (the fastest live `every_secs` is measured in
hundreds of ms), but the gate in §5 should assert it, so the day someone authors a 1ms cooldown
they get a failure and not a mystery.

## 10. Determinism — the NEW total order

`combat_spec §1.2`'s `(t, seq)` tie-break dies (§3.3). This replaces it.

### 10.1 The order

Within one tick, the total order over instance fires is:

```
1. the PLAYER map, then the ENEMY map                    (map order)
2. within a map: instances by STABLE INSTANCE INDEX      (instance order)
3. within an instance: cooldownSkills by SLOT INDEX      (slot order, s8.4)
```

**Stable instance index** is assigned at compile time: player instances in
(`squadSlot` ascending `unit1..unit4`, then BP id ascending) order; enemy instances in
`monster_pack members[]` array order — which `packs.json`'s own note already declares stable and
meaningful: *"The two glacier_wisp members are distinct instances (glacier_wisp#1,
glacier_wisp#2) — member ORDER names the instance, so it is stable, not cosmetic."*

Every level of this is a total order over a finite set fixed at compile time. There are no ties to
break, which is the point: the `(t, seq)` tie-break existed because float `t` could collide; an
integer tick with a lexicographic (map, instance, slot) key cannot collide.

### 10.2 Why player-then-enemy, and why it is a real choice

It is a CHOICE and it changes results, so it is justified rather than defaulted:

- **It matches today's bias.** In the current heap, initial player schedules are pushed at
  `encounter.cjs:519-526` and enemy schedules at `:544` — player first. Equal-`t` events therefore
  break player-first on `seq` TODAY. Keeping player-first preserves the existing tie-break bias
  and minimizes the semantic distance of the rewrite.
- **It is legible.** "Players act, then enemies react, within a tick" is a sentence a designer can
  hold. The alternative (interleaving by some global key) is not.
- **The cost is real and accepted:** in a mutual-kill tick, the player wins. At 0.01s granularity
  this is a ~1-tick advantage per exchange, far below the ~200ms band any human perceives, but it
  is a systematic advantage and it should be recorded as one rather than discovered later.

**Alternative considered and rejected:** ordering by instance index across BOTH maps (a single
global list). Rejected because it makes the outcome depend on how the two maps happen to be
concatenated, which is exactly the kind of incidental coupling the `(t,seq)` tie-break was already
a workaround for.

### 10.3 `t` is COMPUTED, never ACCUMULATED

```js
const t = tick * TICK;      // CORRECT
let t = 0; t += TICK;       // FORBIDDEN
```

`0.01` is not binary-representable. Accumulation drifts (100 additions → `1.0000000000000007`);
a single multiply does not — `tick * 0.01` is one rounding of one exact product, reproducible for
any `tick`. Over a 600s deadline (60,000 ticks) the accumulated form diverges from the multiplied
form in the low bits, which is enough to move a `>=` comparison and therefore a golden.
`combat_spec §1.2 [LOCKED OQ1]` (float64, server-only, "clients replay the log, never re-simulate")
**survives verbatim** and is exactly why this matters: the log is authoritative, so its `t` values
must be a pure function of the tick index.

### 10.4 The RNG sub-streams are PRESERVED — every one

`sim/lib/rng.cjs` is **untouched** (`makeRng`, `djb2Hash`, `mulberry32`, the per-stream
`mulberry32` state seeded from `djb2Hash(masterSeed + '|' + streamName)`). Every named sub-stream
keeps its name and its draw order:

| stream | site | preserved because |
|---|---|---|
| `effect/<uid>/<idx>/timing` | `skills.cjs:303` | §8.5 rolls from the SAME name |
| `effect/<uid>/<idx>/<t>` (damage) | `encounter.cjs:614,694` | the `<t>` suffix now carries a tick-quantized `t` — **the STREAM NAME CHANGES** (see below) |
| `.../ray` | `entry.cjs` via `selectEntryCell` | ray entry geometry is untouched by this REQ |
| `compile/buff/<uid>`, `compile/dr/<bpId>` | `compile.cjs:238,298` | compile pass untouched |
| `hpbelow/<...>` | `encounter.cjs:238,247,271` | untouched |
| `attach/<enc>/placement`, `attach/<enc>/<id>/hp` | `encounter.cjs:293,324` | untouched |
| `reactive/<trigger>/<uid>/<t>/<i>` | `encounter.cjs:475,487,704` | same `<t>` quantization note |
| `unlock/<uid>/<idx>/<t>` | `encounter.cjs:373` | same |
| `charge-strike/`, `charge-fire/`, `pulse/`, `pulse-payload/` | `encounter.cjs:60,77,440,445` | same |

**CALLED OUT — this is the largest single source of golden movement, and the brief does not
mention it.** Many stream names EMBED `t` as a string (`effectStreamName(...) + '/' + ev.t`). Today
`ev.t` is an arbitrary float like `1.6180339887498949`; tomorrow it is `1.62`. **The stream NAME
changes, therefore the seed changes, therefore every damage roll changes** — even where the
quantization moved the fire time by 5ms. This is not a bug and must not be "fixed" by trying to
preserve the old names: the whole point is that fire times are now tick-quantized, and the name is
derived from the fire time. But it does mean **the golden diff will be total, not marginal** —
every `amount` in every log moves. §13 tells the reviewer to expect that and how to verify it is
quantization and not corruption.

## 11. Rays STILL resolve instantly — and why the split is not arbitrary

**In this REQ, `sim/lib/ray.cjs walkRay()` is called UNCHANGED.** A fire at tick `k` resolves its
entry → bounces → hits → splash entirely within tick `k`, exactly as it resolves entirely within
one `t` today. Only the SCHEDULING is ticked. `sim/lib/ray.cjs`, `sim/lib/geometry.cjs`,
`sim/lib/entry.cjs` and `shared/forecast.mjs` are **not touched by this REQ**.

**Ray flight is REQ-0257.** The rationale for the split, from brief §7:

> 0256 and 0257 are deliberately SEPARATE despite sharing one rewrite: each moves the goldens, and
> splitting them keeps the two causes bisectable (tick quantization vs ray flight).

That is the whole argument and it is correct, but §10.4 sharpens it into something stronger than
tidiness. **Both REQs move all 12 goldens totally** (0256 via stream-name requantization; 0257 via
live-field traversal). If they land together, a reviewer facing a 12-golden total diff has NO way
to attribute any line to a cause — and there is no third signal to appeal to, because the goldens
ARE the contract. Landed separately, the question at each step is answerable: after 0256, "did
anything change that is not explained by a 5ms fire-time shift and its stream rename?"; after
0257, "did anything change that is not explained by a ray taking time to arrive?" **Bisectability
is not a convenience here; it is the only available proof.** Same reasoning REQ-0184's port note
gives for not re-composing packs during a port, and the same reason REQ-0258 refuses to re-compose
formations while fixing one box.

## 12. Blast radius — MEASURED

Every gate below was RUN on this worktree at spec time (`req-expedition-spec` @ `f918a65`, the
pre-merge baseline). These are the numbers the rewrite must reproduce or knowingly move.

| gate | command | measured NOW | after this REQ |
|---|---|---|---|
| sim unit tests | `node sim/tests/run.cjs` | **117 passed, 0 failed** | **MOVES** — see §12.1 |
| sim replay goldens | `node sim/tests/goldens.cjs` | **`goldens OK (12 cases, replay determinism intact)`** | **REBASELINE all 12** (§13.1) |
| forecast parity | `node sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** | **18/18, UNMOVED** — §12.2 |
| S4 post-processor | `node sim/tests/s4_test.cjs` | **14 passed, 0 failed** | expected green; S4 BASELINES move (§13.3) |
| REQ-0203 grave-legion | `node sim/tests/req0203_grave_legion_test.cjs` | **15 passed, 0 failed** | expected green (assertions, not hashes) |
| REQ-0207 wildlands | `node sim/tests/req0207_wildlands_test.cjs` | **13 passed, 0 failed** | expected green |
| REQ-0219 deepstone | `node sim/tests/req0219_deepstone_test.cjs` | **13 passed, 0 failed** | expected green |
| REQ-0200 unit charge | `node sim/tests/unit_charge_test.cjs` | **13 passed, 0 failed** | expected green (pure runtime, no heap) |
| REQ-0200 charge fusion | `node sim/tests/unit_charge_encounter_test.cjs` | **23 passed, 0 failed** | **MOVES** — §4.1b `advance_cooldown` |
| api determinism | `node server/tests/api_test.cjs` | **NOT RUNNABLE HERE** — §12.3 | see §13.2 |

### 12.1 `sim/tests/run.cjs` — what moves and what does not

117 tests. The ray-geometry block is the part to watch, and it is SAFE in this REQ:

- **9 tests call `combat.walkRay` DIRECTLY** (lines 220, 253, 270, 289, 302, 322 + the AOE test) —
  `'ray geometry: entry projection+jitter…'`, `'…penetration exhaustion…'`, `'…boundary
  reflection…'`, `'…bounce damage scaling exactness…'`, `'…5-bounce all-hit-then-terminate…'`,
  `'…detection-mode per-PO bounce-budget stop…'`, `'…destroyed-BP passthrough…'`, `'…gap
  passthrough…'`, `'AOE: Chebyshev radius correctness…'`. **All 9 stay green — `walkRay` is
  untouched (§11).** They are REQ-0257's problem, not this one.
- **`run.cjs` has ZERO references to `ray_step`** (grepped). Its walkRay tests read
  `result.landing` / `result.bounces` / `result.aborted`, not the event stream. This is why they
  survive §11 and it is worth knowing before REQ-0257 touches them.
- **What DOES move:** any test asserting an absolute `t` on an emitted event, and any test
  asserting `encounter_end.t` (§4.1c). Retarget them to tick-quantized values; do not delete them.

### 12.2 Forecast parity — UNMOVED, and the brief is wrong about this

**CORRECTION to the brief.** Brief §3 C1 lists `sim/tests/forecast_parity.cjs (18/18)` among the
things that "ALL rebaseline". **Two errors in that sentence:**

1. **It is not a baseline.** `forecast_parity.cjs` is an ASSERTION test — 18 `T(...)` cases that
   compare two implementations against each other. It has no stored hash and no `gen` mode.
   **There is nothing to rebaseline.** You cannot regenerate it; you can only make it pass or
   change it.
2. **This REQ does not move it at all.** Measured reasoning: everything it pins is untouched here.
   It pins `FIELD_ROWS`/`FIELD_COLS` (`:183-184`), `RAY_STEP_BUDGET`/`ENTRY_JITTER_HALF_WIDTH`
   (`:188-189`), the geometry primitives (`:192-236`), `parseBox` (`:236`), and — the big one —
   `walkRayPath() == walkRay()` over a fixture corpus (`:261, :299, :336`). **§11 leaves every one
   of those alone.** Expected result after this REQ: **18 passed, 0 failed, unchanged.**

**But it is REQ-0257's central problem**, and 0257's spec says so: three of those tests
(`:261`, `:299`, `:336`) reassemble the ray's cell path out of **`ray_step` event batches**
(`:118` — `if (ev.ev === 'ray_step') for (const c of ev.path) cells.push(...)`; `:323` likewise).
REQ-0257 removes `ray_step`. Those tests then break STRUCTURALLY — they would compare against an
empty array — which is not a rebaseline either. Flagged here because the brief's single
"forecast parity rebaselines" line hides a structural break under a word that implies `--gen`.

**One thing this REQ MUST do for it:** if `TICK_SECS`/`RAY_TICKS_PER_DIAGONAL` ever need to be
visible to `shared/forecast.mjs`, they must be PINNED there the way the other four constants are
(`forecast_parity.cjs:187-189`), because **`shared/` may not `require()` out of `shared/`** —
documented at `shared/content_validate.cjs:432-435` and in `forecast_parity.cjs`'s header. This
REQ does not need them there (the forecast predicts GEOMETRY, not timing), so **add no fourth
copy.** Only REQ-0257 must revisit this.

### 12.3 The api determinism gate — and the CONTENT_ROOT trap

The gate is `tools/ci.sh` step `[4/7]` → `node server/tests/api_test.cjs`, specifically
`server/tests/api/schedule.cjs:383` (*"schedule: run executes and persists a replay log + summary;
fixed seed -> deterministic re-simulation"*) and `server/tests/api/schedule_ops.cjs:605`
(*"REQ-0043: two DIFFERENT rooms created with the SAME genSeed produce IDENTICAL replay logs"*).

**Measured: it is NOT RUNNABLE in a bare worktree.** `node server/tests/api_test.cjs` here dies at
`MODULE_NOT_FOUND: 'pg'` (`server/storage_moderation.cjs:11` → `server/storage.cjs` →
`server/tests/api/harness.cjs`). `ls node_modules` = absent. Per PROJECT.md, deps are provisioned
PER worktree (`pnpm install --frozen-lockfile`); this one never was. **The sim gates are the only
ones runnable in a bare worktree** — which is exactly why every number in §12 is a sim number.
Provision before believing anything about `[4/7]`.

**The CONTENT_ROOT trap applies, and it applies ASYMMETRICALLY.** REQ-0255 §7.1 measured it and it
is inherited here verbatim — do not re-derive it:

- `server/lib/content_files.cjs:19` and `sim/dungen.cjs:63` anchor content at **`os.homedir()`**,
  not at the tree under test. **`tools/ci.sh` never sets `CONTENT_ROOT`.**
- Post-REQ-0255-merge, `node sim/tests/run.cjs` from a worktree WITHOUT `CONTENT_ROOT` gives
  **13 phantom ENOENT failures** (`…/backpack_ragnarok/content/live/dungeon/gimics.json`,
  `dungeons.json`) — it reads MASTER's content. With `CONTENT_ROOT=$PWD/content`: green.
- **`sim/tests/goldens.cjs` must NOT get `CONTENT_ROOT`.** It pins its own batch-002 roster by
  remapping `os.homedir()` (`goldens.cjs:51-59`, REQ-0207); setting `CONTENT_ROOT` takes the
  `process.env` branch in `dungen.cjs liveDungeonDir()`, bypasses the pin, and it dies with
  `compileEnemyPack: missing enemy def ghost`.

**Verified on THIS tree (pre-merge):** all sim gates are green WITHOUT `CONTENT_ROOT`, because
this branch's content and master's content are the same (no `gimics.json` here either). **The trap
bites only AFTER REQ-0255's merge lands.** Since this REQ branches from that merged baseline, the
split invocation is mandatory from day one:

```
CONTENT_ROOT=$PWD/content node sim/tests/run.cjs           # and forecast_parity, s4_test, the roster tests
node sim/tests/goldens.cjs                                 # NO CONTENT_ROOT -- it pins its own roster
```

### 12.4 Everything else the brief names

| named in brief §3 C1 | what it actually is | verdict |
|---|---|---|
| `sim/s4_baselines` | `sim/s4_baselines/default/` — the S4 tuning corpus | **REBASELINE** (§13.3) |
| `sim/s4_matrices` | `sim/s4_matrices/default.json` + `default.golden.sha256` | **REBASELINE** — it is a SHA gate |
| `sim/s4_thresholds.json` | 849-byte band table | **REVIEW, do not blindly regen** — §13.3 |
| `server/services/seals.cjs` (`clearTimeSecs`) | `:186` `clearTimeSecs: typeof run.durationSecs === 'number' ? run.durationSecs : endT` | **MOVES, no code change.** It reads `run.durationSecs`, falling back to `endT` = `runEnd.t` (`:128`). Both are sim outputs. Tick-quantized run times shift them; the formula is untouched. `server/tests/api/seal.cjs:146,173` assert only `typeof === 'number'` — they stay green. |
| REQ-0240 `server/services/pacing.cjs` | presentation pacing | **NO CHANGE in this REQ.** Its header states it: *"Nothing in sim/ imports this file; `pt` can never enter sim-hashed content."* It reads `t` and reassigns `pt`. Tick-quantized `t` feeds it fine. **REQ-0257 is what disturbs it** (its `ray_step` special-case at `:44-51`). |

## 13. Rebaseline procedure — per artifact

**Order matters.** Rebaseline is a one-way door: once regenerated, the old contract is gone and
the diff is the only evidence. Do these in sequence, and read the diff at each step.

### 13.1 `sim/tests/goldens.cjs` — the 12 replay goldens

```
node sim/tests/goldens.cjs          # CONFIRM RED first -- 12 DRIFT lines. If green, the rewrite did nothing.
node sim/tests/goldens.cjs gen      # writes sim/tests/goldens/replay_hashes.json
git diff sim/tests/goldens/replay_hashes.json
```

**Expect all 12 keys to move** (`batch002/golden-{A,B,C}`, `dungen/default/L{1,3,5,8}/dg-{11,22}`,
`dungen/test_fixed`). **`def_sha256` must NOT move on the 9 dungen cases** — the generator is
untouched by this REQ; only `jsonl_sha256` and `events` change. **If a `def_sha256` moves, STOP:**
something reached into `dungen.cjs` that should not have.

**Before regenerating, prove the diff is quantization.** The hashes are opaque, so dump one log
and read it:

1. `combat.toJSONL(r.events)` for `batch002/golden-A` before and after; diff them as TEXT.
2. Every `t` in the AFTER file must be an exact multiple of `TICK_SECS` (0.01). Assert it
   mechanically — this is the single best one-line proof that the tick loop is the clock.
3. Event ORDER should be near-identical; `amount` values will ALL differ (§10.4 — the stream names
   carry `t`). **That is expected.** What must NOT differ: the SET of events, the `ev` tokens, the
   `dst` labels, the win/lose `result`.
4. `encounter_end.t` moves per §4.1c. Confirm it now equals the break tick, not the phantom
   next-event time.

Record the before/after `events` counts in the REQ. A large count change is a red flag
(quantization should barely move how MANY things happen).

### 13.2 The api determinism gate

**Nothing to regenerate.** It re-simulates and deep-equals against the stored log
(`server/tests/api/schedule.cjs:383`); both sides move together. Provision deps (§12.3), then:

```
pnpm install --frozen-lockfile
CONTENT_ROOT=$PWD/content node server/tests/api_test.cjs
```

**If it goes red, that is a REAL determinism break, not a baseline artifact** — it means two runs
of the SAME seed diverged, which is precisely what §10 exists to prevent. Do not "fix" it by
rebaselining anything. Debug it.

### 13.3 S4 — `s4_baselines`, `s4_matrices`, `s4_thresholds.json`

`sim/s4_matrices/default.golden.sha256` is a SHA gate over `default.json`; `sim/s4_baselines/default/`
is the tuning corpus. Both are downstream of run outcomes and both move.

```
node sim/tests/s4_test.cjs                   # 14/14 -- the POST-PROCESSOR, expected green (it tests the math, not the data)
<regen per sim/s4's own runbook>             # then re-hash default.golden.sha256
```

**`sim/s4_thresholds.json` is DIFFERENT and must not be swept into the regen.** It is a
hand-authored BAND table (dps ceilings 12/15/18/24 sourced from `vocab.dps_ceiling_warn`, per
combat_spec §10 "do not diverge"). Its numbers are DESIGN INTENT, not measurements. **Regenerating
it would silently rewrite the balance targets to whatever the new sim happens to produce — i.e. it
would make the tuning gate assert that the sim is correct because it is the sim.** Read the S4
report after rebaselining the corpus and ask whether any band is now systematically breached; if
so, that is a FINDING for the user, not a file to overwrite.

### 13.4 What is NOT rebaselined

- `sim/tests/forecast_parity.cjs` — §12.2. Not a baseline; expected 18/18 unchanged.
- `sim/tests/run.cjs`, the roster tests, the charge tests — assertion suites. **Retarget individual
  assertions; never regenerate.**
- `shared/pacing.json`, `server/services/pacing.cjs` — untouched (§12.4).
- `docs/user_managed/*` — forbidden.

## 14. Scope

**In:**
1. `sim/lib/core.cjs` — `TICK_SECS: 0.01` TUNABLE + `secsToTicks()` (§5, §9).
2. `sim/lib/seq.cjs` — NEW. `SeqCounter` (§6.2).
2b. `sim/lib/battle.cjs` — **NEW.** The `Battle` object (§7.0): `playerMap`/`enemyMap` (both `IBattleInstancesFormationMap`), `modeConfig` (reserved `null`; REQ-0259 populates), `tickIndex` + `t()` (the clock), and `tick()` (the §7.1a chain). Constructed and driven by `runEncounter`; it is not the home of the loop (§7.0).
3. `sim/lib/heap.cjs` — **DELETED**. Orphan comments rehomed (§6.3).
4. `sim/combat.cjs` — drop the `heap` require (`:50`) + the `EventHeap` export (`:68`).
5. `sim/lib/encounter.cjs` — the driver (`:575-756`) rewritten to the tick loop (§7); `advanceCooldown` (`:82-93`) respecified (§8.5); `encounter_end.t` (`:788`) respecified (§4.1c); `status.cjs:143`'s false comment fixed (§7.2).
6. `sim/lib/compile.cjs` — `+instances` on the return (`:373`); `buildInstances()` (§8.2-8.4).
7. `sim/lib/skills.cjs` — `scheduleEffect` (`:301-307`) **deleted**; its roll moves to `rollCooldownTicks` (§8.5).
8. `sim/lib/unit_charge_encounter.cjs` — `heap` param renamed `seq` (6 sites, §6.1).
9. `sim/lib/formation_map.cjs` — the tick half implemented (REQ-0258 declares the file; §Depends): **`tickInstances()`** (the fire phase, stable-index order) and **`tick()`** (= `tickInstances(); tickRays()`, brief §4's single-map entry point). **`tickRays()` is stubbed to a no-op here** — `rays[]` is always empty in 0256 (§11) — and is implemented by REQ-0257. `Battle` calls the two phase methods, not `tick()`; §7.1a says why and flags it as an interpretation.
10. `sim/tests/run.cjs` — the §5 tunable gate; retargeted `t` assertions (§12.1).
11. Rebaselines per §13.
12. `docs/llm_managed/combat_spec_draft.md` — §1.1 rewritten, §1.2's tie-break bullet replaced, §1.4's "event by event" → "tick by tick" (§3).

**Out:**
- **Ray flight.** `walkRay`/`ray.cjs`/`geometry.cjs`/`entry.cjs`/`shared/forecast.mjs` untouched (§11). REQ-0257.
- **Making `mode` mean anything.** Declared (§8.3), used by REQ-0259.
- **Deleting `bps`/`pos`/`sis`** from the compile return (§8.2). Follow-up REQ.
- **Moving `runEncounter`'s ~650 lines of scaffolding into `Battle`** (§7.0). `Battle` owns the clock and the chain; `runEncounter` still owns compile, attachments, pulses, fires and the result. A follow-up REQ may move more in behind it.
- **Populating `modeConfig`** (§7.0). The field is reserved and initialised to `null`; nothing in this REQ reads it. REQ-0259 gives it meaning.
- **Curing the goldens' blindness to the charge engine** (§8.5). `sim/tests/goldens.cjs:63` omits `unitDefsById`, so no golden builds a `chargeMgr`. Passing it would change what the 12 goldens SIMULATE — a contract change disguised as a test fix, and it must not ride in underneath a tick rewrite. Raised to the user in the Status block; the correction is REQ-0263 §5.5.
- **Fixing `status_tick`'s missing `seq`** (§4.1c). Follow-up; it is a golden byte.
- **Changing Stun/Weakness/Haste to real-time decay** (§7.2). It looks like a bug-fix and is a balance change.
- **`sim/s4_thresholds.json` regeneration** (§13.3).
- **Editing `docs/user_managed/*`.** Forbidden by PROJECT.md.
- **An e2e harness.** None needed — sim + compile only, covered by the sim suites. E2E is not a gate for this program (Q2). Decade **7560 / 7561 / 7562** (`5000 + 256*10 + {0,1,2}`) is reserved-by-numbering and left unused.

## 15. Acceptance criteria

1. `sim/lib/heap.cjs` does not exist. `grep -rn 'EventHeap'` over the tree returns **zero** hits outside `docs/`.
2. `TUNABLES.TICK_SECS === 0.01`, and **no literal `100` or `0.01` appears as a tick quantity** anywhere in `sim/lib/`. The §5 gate proves it by moving `TICK_SECS` and observing a failure.
3. Every `t` in every emitted event is an exact multiple of `TICK_SECS` (§13.1 step 2), mechanically asserted.
4. `compileSquadSnapshot` returns `instances`, one per BP, each carrying a `cooldownSkills` Map whose slot order matches §8.4 exactly. A test builds a fixture BP with 2 POs + 1 seated SI + a Unit effect and asserts the slot sequence by NAME, not by count.
5. A monster instance and a BP instance are STRUCTURALLY IDENTICAL at the `cooldownSkills` boundary — asserted by a test that feeds both to the same fire path. This is the flattening; if it is not testable, it did not happen.
6. Determinism holds: the same `(snapshot, defs, seed)` produces a byte-identical log across two runs in one process AND across two processes (§10). The api determinism gate (§13.2) is green.
7. `sim/tests/goldens.cjs` green at 12 cases, rebaselined per §13.1, with `def_sha256` **unmoved** on all 9 dungen cases.
8. `sim/tests/forecast_parity.cjs` **18 passed, 0 failed — UNCHANGED** (§12.2). If it moves, §11 was violated.
9. `sim/tests/run.cjs` green; its 9 `walkRay` tests green and **untouched** (§12.1).
10. `sim/tests/unit_charge_encounter_test.cjs` green at 23, with any movement traced to §8.5's `advance_cooldown` respec and recorded in the REQ.
11. `combat_spec_draft.md` §1.1/§1.2 carry the tick model; no line in the file still says "not ticked" or "no ticks".
12. The §12.3 split invocation is written into the REQ's gate table, and `goldens.cjs` is documented as `CONTENT_ROOT`-FORBIDDEN.
13. **The chain exists and is the only fire path.** `sim/lib/battle.cjs` exports `createBattle`; `runEncounter` calls **`battle.tick()`** exactly once per tick and contains **no instance-fire walk of its own** (`grep -n 'cooldownSkills' sim/lib/encounter.cjs` returns zero — the walk lives in `IBattleInstance.tick()`). A test asserts the cascade mechanically: stub a map whose `tickInstances()` records its call, assert `battle.tick()` calls player-then-enemy exactly once each, and assert an instance's `tick()` is reached from `battle.tick()` without `runEncounter` in the stack.
14. **`battle.modeConfig === null` and nothing reads it.** `grep -rn 'modeConfig' sim/` returns only its declaration and initialisation (§7.0). REQ-0259 is what makes this criterion obsolete.
15. **The `advance_cooldown` respec is proven on LIVE content, not only fixtures** (§8.5). A new case in `sim/tests/unit_charge_encounter_test.cjs` passes `unitDefsById` for one of the 42 charge-bearing live units (e.g. `alchemist`) and asserts the floor-at-1 pull. **This is required precisely because acceptance criterion 7 (the goldens) cannot see this path at all** — `goldens.cjs:63` omits `unitDefsById`. A green golden rebaseline is not evidence about charge; do not read it as any.
