# REQ-0263 — expedition-instance-hud: HP, cooldown, charge and skill badges on every `IBattleInstance`

**Status:** draft — spec written, BLOCKED on user review. Five things need the user before work may
start: (0) **this REQ moves all 12 replay goldens — a THIRD time, after REQ-0256's and REQ-0257's.**
§6.4/§7.1 add three fields to `ray_fire` and §5.4 adds two events, which moves the replay JSONL and
therefore every `jsonl_sha256`. The first draft never said so, which left §11's gates unsatisfiable
(`tools/ci.sh:107` runs `sim/tests/goldens.cjs` at step [2/7]). **§10.1 is the procedure** — the same
one REQ-0256 §13.1 / REQ-0257 §14.1 specify, with one sharper check: this REQ's `events` count must
**not move at all**. It is listed first because it is a determinism-contract move and the user has
ruled (Q1) on those specifically. (1) §5.2 — the user's 「Unitの**背景**をClockwiseに増加させる」 and ratified golden **G7** ("the
Unit charge-state overlay is a **ring fill**") are **not the same control**; §5.2 shows the daylight
and recommends amending G7, which an LLM may not do. (2) §4.4 — enemy `hpMax` on the wire is the
def's *upper bound*, so on a formation map where every enemy is visible from t=0, **every enemy's HP
bar starts below 100%**, reading as "already damaged". (3) §6/§7 — closing the cooldown and charge
data gaps needs **new fields on sim events**; §6.3 shows the naive encoding is ~300,000 events per
run and specifies the alternative. (4) §8.3 — **skill icons do not exist** and the placeholder this
REQ ships is a new visual vocabulary.
**Reserved:** 2026-07-18
**Slug:** expedition-instance-hud
**Branch:** req-expedition-spec (spec only)
**Requested by:** user, 2026-07-18 — spec items (j), (k), (l).
**Depends on:** **REQ-0261** (expedition-formation-render) — HARD, and specifically on its **server
change** (§8.2's `instanceId`/`at`/`fieldCells`/`masked`), which is the only join that lets an enemy
HP bar exist at all (§4.3). **REQ-0256** (battle-tick-core) — HARD; its per-instance
`cooldownSkills: Map<int,{skill, remainingTicks}>` is this REQ's data source (§6). **REQ-0257**
(ray-flight-entity) — **HARD, and it MUST LAND FIRST.** This REQ adds three fields to `ray_fire`
(§6.4's `slot`/`cooldownTicks`, §7.1's `cause`) and REQ-0257 **rewrites `ray_fire` wholesale** (its
§10.1/§10.1a: the `ray` id at all three emission sites, the retired `ray_step`, the non-uniform
schema). **If this REQ lands first, 0257's rewrite silently drops these three fields** — no gate
would catch it, because a missing wire field on an additive event fails as a blank HUD, not as a red
test. REQ-0257 §10.1b also ACCEPTS this REQ's §4.4 hand-off (`hp_after` on `ray_hit_all.hits[]` /
`ray_aoe.hits[]`), so §4.4 is now 0257's to deliver and this REQ merely consumes it. **Ordering
constraint: 0256 -> 0257 -> 0263.** **REQ-0260** (§9.3) owns the clock every ramp in this REQ is
evaluated against.
**Blocks:** REQ-0265 (art-monster-skill-icons) — §8.3's placeholder is its landing surface.
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §1, §4, §6.

## 1. Goal

Spec items (j), (k), (l) — the per-instance readouts on both planes:

- **(j)** An **HP bar** under each `IBattleInstance`: under the **Unit ICON** for a player BP; under
  the **CELL SHAPE** for a monster/gimic.
- **(k)** **Item cooldown** = a translucent-black overlay **on the item**. **Unit charge** =
  「Unitの背景をClockwiseに増加させるUI技法」. Passive-trigger items **flash on fire**
  (「パッシブ的な発動条件のアイテムもちゃんと発動したら、光る」).
- **(l)** **Monster/gimic skills**: a circle + skill icon, clockwise translucent-black charge, laid
  out **top-right of the drawn art**, one per skill, passives included, and the **frame lights on
  fire**.

**The through-line of this REQ, and the reason it is mostly about the WIRE rather than about
drawing:** every one of these is a *continuous* quantity (an HP fraction, a cooldown remainder, a
charge level) on a sim that now ticks at **0.01s**. At 0.01s, *any* per-tick per-entity stream is 100
events per entity per second. §6.3 measures the naive encoding at **~300,000 events per run**.
**Every gap below is closed by sending a ramp's PARAMETERS once and evaluating the ramp against the
clock** — the same architectural move REQ-0262 §5.2 makes for the ray head, for the same reason.

**Out of scope:** rays, trails, impacts — REQ-0262. Static composition — REQ-0261. The tick loop —
REQ-0256. Actual art — REQ-0265.

## 2. Terminology — settled, because (j) depends on it

Brief §1 resolves 「プレイヤーのUnit(または内部名称BP)」 via the **BP:Unit law** (REQ-0165):

> **A BP and a Unit are 1:1. Every BP carries exactly one Unit; a BP with no Unit cannot exist.**

So: **`IBattleInstance` (player) == one BP**, its HP is the BP's `hpMax`, and 「Unitの下にHPバー」 means
*under the Unit ICON*, which sits at one specific cell of that BP. A **Squad is not an
`IBattleInstance`** (it has no HP — `backpack_battle_spec`: *"a squad itself has no HP"*); it is an
8x8 canvas holding many BPs. **`IBattleInstance` (enemy) == one monster OR one gimic entity.**

### 2.1 CORRECTION — the Unit is at `bp.unit.off`, **not** `bp.linker.off`

The task framing says *"the Unit sits at `bp.linker.off` — verify against `mock-src/engine.js`'s
`unitCell(bp)`"*. **Verified, and it is wrong.** `mock-src/engine.js:103`:

```js
const unitCell=bp=>[bp.origin[0]+bp.unit.off[0],bp.origin[1]+bp.unit.off[1]];
```

`bp.unit.off`. The `linker` model is **retired**, and the tree says so in four places:

| evidence | source |
|---|---|
| the accessor dereferences `bp.unit` | `mock-src/engine.js:103` |
| the mint stamps `unit`, not `linker` | `server/services/gacha.cjs:208` — `unit: { id: picked.unit, off: seat },` |
| the retirement is explicit | `server/services/gacha.cjs:133` — *"The retired model rolled `linker: {off, dirs}`"* |
| **a test pins it gone** | `server/tests/api/workshop.cjs:61` — `assert.strictEqual(rolled.linker, undefined, 'the retired linker field is GONE -- not renamed, not shadowed');` |
| the sim reads `unit` too | `sim/lib/compile.cjs:150` — `const u = bpDef && bpDef.unit;` |

**`docs/llm_managed/terminology_unit_squad.md` is stale on exactly this**, and it is the file the task
cites as the authority. Its BP:Unit law paragraph says:

> `mock-src/engine.js:92` `unitCell(bp)` dereferences `bp.linker` unconditionally.

**Both halves are wrong**: it is line **103**, not 92, and it dereferences **`bp.unit`**, not
`bp.linker`. **The LAW ITSELF still holds** — `gacha.cjs:208` stamps `unit:{id,off}` unconditionally
on every rolled BP, so a BP with no Unit still cannot exist — only its cited evidence rotted under a
rename. **This REQ does not edit that doc** (it is not this REQ's file to fix), but any implementer
following its line reference will dereference a field a test asserts is `undefined`.

> **Nuance worth keeping.** `unitCell` itself (`:103`) is unconditional and *would* throw on a
> Unit-less BP — but its callers guard: `unitMap` (`:105`) and `:883` both do `if(!bp.unit)continue;`.
> So the engine defends against the state the law says cannot exist. Draw the bar from a **guarded**
> read, matching the engine's own posture; do not rely on the law to keep a renderer alive.

Legacy survivals that are **not** counter-evidence: `mock-src/ui.js:319,397` (the retired mock UI) and
`mock-src/tests/run.cjs:187` (a legacy fixture) still spell `linker`. They are history, per
`terminology_unit_squad.md`'s own "Deliberate legacy survivals" clause.

## 3. Verified current state — every row read or measured

| fact | source | evidence |
|---|---|---|
| player BP `hpMax` is on the wire, **exact** | `shared/dto.ts:464-467` (0240) | `ApiRunRosterSlot { slot, index, bps: { id: string; hpMax: number }[] }` — REQ-0240 M1: *"Player hpMax exact (from `result.bps.squadSlot`)"* |
| enemy `hpMax` is the def's **upper bound** | `dto.ts:471-479` (0240) | *"hpMax is the def's upper bound, so an hp_after/hpMax tick is honest and never exceeds 100%"* |
| `ray_hit` carries `dst` + `hp_after` | measured, golden-A | `{"ev":"ray_hit","dst":"beta","amount":11.36,"bounce_mult":1,"hp_after":78.64}` |
| **`ray_hit_all` carries NO `hp_after`** | measured, golden-A | field set `seq,t,ev,bounce_mult,hits`; `hits[]` = `[{"dst":"frost_gnoll#0","amount":21.94},…]` — **`amount` only** |
| **`ray_aoe` carries NO `hp_after`** | measured, golden-A | field set `seq,t,ev,center,radius,hits`; same `{dst,amount}` shape |
| enemy `dst` is **instance-suffixed** | measured, golden-A | `"frost_gnoll#0"`, `"ice_archer#1"` |
| …while the roster's `id` is the **def** id | `pacing.cjs:220-239` | `enemies.push({ id: def.id, … })` — REQ-0261 §8.4: two namespaces |
| masked entities emit `'?'` | `sim/lib/replay.cjs:21-23` | `function maskLabel(entity) { return entity.masked ? '?' : entity.id; }` |
| the ONLY production `drawChargeRing` call site passes `null` | `BoardRenderer.ts:986` | `drawChargeRing(ring, x, y, null);` — grep over the whole tree returns **exactly one** production call |
| `chargeRing` radius/width are already parameters | `chargeRing.ts:118-126` | `radius: number = RING_RADIUS, width: number = RING_WIDTH` |
| `chargeRingArc` is pure/total | `chargeRing.ts:76-88` | `null`/`0`/`NaN`/`Infinity`/negative -> `null`; >1 clamped; never throws |
| **42 of 54 live units carry a `charge` block** | measured, `content/live/dungeon`/`content/live/live_units.json` | 54 entries; 42 with a top-level `charge` — e.g. `alchemist {trigger:every_secs, spend:fire_on_full, capacity:[2,3]}` |
| production **does** pass the unit registry | `server/services/runs.cjs:83-91` | `combat.runDungeon({ …, unitDefsById, connShapes })` |
| …but the **goldens do not** | `sim/tests/goldens.cjs:63` | `baseOpts` has **no `unitDefsById`** -> `UNIT_DEFS = {}` (`compile.cjs:94`) -> no `bp.charge` |
| the charge manager is built iff some BP has charge | `sim/lib/encounter.cjs:40,140` | `const chargeBps = troopBps.filter(b => b && b.charge);` / `const chargeMgr = chargeBps.length ? … : null` |
| the charge instance id **IS** the BP id | `unit_charge_encounter.cjs:169` | `chargeBps.map(bp => ({ id: bp.id, unitId: bp.unitId, charge: bp.charge }))` |
| **no event carries the charge counter** | `unit_charge.cjs:176,210,230` + `unit_charge_encounter.cjs:109-161` | every emission is DISCRETE (`_spend`/`_stack`/`_transform`/`_strike`/`_onhit`/`_lifesteal`/`_reflect`/`_transfer`/`_shieldbreak`); none carries `counter` |
| capacity is **per-instance rolled** | `unit_charge.cjs:128` | `capacity: resolveRolledRange(spec.charge.capacity, rolls, spec.id + ':cap')` — the def says `[2,3]`; the instance says `2.5` |
| max skills on a live enemy = **3** | measured, `content/live/dungeon/enemies.json` | 44 entries; dist `{1:10, 2:33, 3:1}`; max = `hrimgrimnir` (footprint `[3,3]`) |
| max skills on a live gimic = **1**, and **2 gimics have 0** | measured, `gimics.json` (req-0211) | 4 entries; dist `{0:2, 1:2}` |
| **all 81 live skills are `every_secs`** | measured, `content/live/dungeon/skills.json` | trigger dist: `{"every_secs": 81}` — **zero passives** |
| the live skill **verb** taxonomy is closed at 6 | measured, same | `strike:30, apply_status:27, bonus_vs_status:9, lifesteal:7, multi_strike:6, heal_ally:2` |
| there is **no `skill` art kind** | `server/services/art_sizing.cjs:24` | `const KINDS = ['po','si','unit','monster','bpskin','custom'];` (+`gimic` after REQ-0255) |
| `cause` is a live discriminator precedent | `MonitorRenderer.ts:718`; `encounter.cjs:119,136` | `ev.cause === 'pulse'` -> gold rays; `cause:'charge'` on `unit_charge_transfer`/`_shieldbreak` |
| …but `cause` is on **no** ray event in a real run | measured, golden-A | zero events carry `cause` |

## 4. (j) HP bars

### 4.1 Under the Unit ICON — the player BP

The Unit's field cell (§2.1):

```
unitFieldCell(bp) = squadBoxTopLeft + bp.origin + bp.unit.off          // engine.js:103, guarded
unitCentre        = cellIdToXY(unitFieldCell, EXP_CELL) + EXP_CELL/2   // fieldGeometry.ts:76
```

```
EXP_HP_BAR_W      = EXP_CELL * 0.80     // 32px at EXP_CELL=40
EXP_HP_BAR_H      = 3
EXP_HP_BAR_GAP    = 2
barTop            = unitCentre.y + RING_RADIUS*0.5 + EXP_HP_BAR_GAP    // = +17 at EXP_CELL=40
```

**`RING_RADIUS*0.5` (=15), not `coreRadius` (=13), is the clearance term — and that is not a typo.**
REQ-0261 §5.1 rules that the expedition passes `15 / 1.5` as the charge ring's `radius`/`width` args
(halving `RING_RADIUS=30` / `RING_WIDTH=3` at the CALL SITE, never editing the constants, because
REQ-0125a golden G7 pins 30/3 for the Backpacks board). The ring is drawn at r=15 and the core at
r=13, so **the ring is the outermost thing around the Unit** and the bar must clear *it*. Clearing
13 would put the bar through the ring — placing the HP readout and the charge readout on top of each
other, which is the one collision this whole section exists to avoid. At +17 the bar's top still sits
inside the Unit's own 40px cell (half-cell = 20), so the bar never trespasses on a neighbouring BP.

**Live HP resolves today, with no new plumbing:** `ray_hit.dst` is the **BP id** (measured:
`dst:"beta"`) and `ray_hit.hp_after` is the value. Join `dst` -> `ApiRunRosterSlot.bps[].id` ->
`hpMax` (exact, per REQ-0240 M1). Bar fraction = `hp_after / hpMax`.

**Reuse REQ-0240's colour thresholds rather than inventing a second scale.** `SquadDock.tsx:11-14`:
`frac >= 0.7 -> hp-full`, `>= 0.4 -> hp-mid`, else `hp-low`. The dock and the stage must not disagree
about what "low" means; extract the predicate rather than copy the numbers.

### 4.2 Under the CELL SHAPE — the monster/gimic

No icon to hang from: the bar spans the instance's **footprint bounding box**, under its bottom edge.

```
box     = bounds(instance.fieldCells)          // REQ-0261 s8.2 -- cells, NEVER footprint
barW    = box.w                                 // spans the shape, so size reads as presence
barTop  = box.bottom + EXP_HP_BAR_GAP
```

**Read `fieldCells`; never `footprint`.** REQ-0261 §8.5 sends `fieldCells` derived server-side
precisely so no renderer can transpose `[fh, fw]`. A cell list has no orientation to get wrong. This
REQ inherits that discipline unchanged, and §11's gate pins it.

> **New finding — a transpose trap in `shared/dto.ts` itself.** `dto.ts:201` documents
> `ApiMonsterEntry` (the **enemy/1** dialect) as: *"`footprint` is **[w,h]** in cells (the REQ-0188
> drift guard keeps the def field in agreement with the linked artwork)"*. **That is transposed.** The
> real convention is `[fh, fw]` — height first — per `shared/content_validate.cjs:472-479`
> (`fp[0]` expands ROWS) and REQ-0188's own schema table (`| enemy/1 | footprint: [fh, fw] = height,
> width |`). The comment even cites REQ-0188 while contradicting it. **`dto.ts:229`, describing
> `ApiGimicEntry`'s footprint for the same field, gets it right** (*"`footprint` is [fh,fw] in
> cells"*) — so one file documents one convention two ways. REQ-0261 §8.5 caught the analogous bug in
> `MonsterCatalog.tsx:53-55`; this is a second instance, in the **shared DTO**, which is the worst
> place for it. **Not this REQ's to fix** (it touches no Dex type and reads no `footprint`), but it
> is exactly the fossil that produces a transpose in the next renderer someone writes from the types.

### 4.3 Does REQ-0257 fix the `dst` -> roster resolution? **NO.**

The task asks this directly. **Stated plainly: REQ-0257 does not fix it, and cannot.**

REQ-0240's Deviation 3, verbatim:

> **Enemy HP ticks on the stage deferred.** `ray_hit`'s masked `dst` label does not resolve to a
> roster enemy id/hpMax, so per-enemy HP bars are not drawn.

**What REQ-0257 §10.1 adds is `ray` — the `IBattleRay.id`.** It answers *"which ray did this?"*. It
never answers *"which enemy is this?"*. Three independent reasons the gap survives 0257 untouched:

1. **`maskLabel` is not in REQ-0257's scope.** Its §15 lists every file it edits; `sim/lib/replay.cjs`
   is not among them. `dst` still comes from `maskLabel(entity)` and still returns `'?'` when masked.
2. **The namespace split is unchanged.** Measured: `dst = "frost_gnoll#0"` (instance-suffixed) vs
   roster `id = "frost_gnoll"` (def id). REQ-0257 adds a *ray* id to the event; it adds no *instance*
   id to the roster.
3. **Stripping `#N` is not a repair.** A pack with three `ice_archer`s yields **three roster entries
   all carrying `id:'ice_archer'`** (REQ-0261 §8.4) — the only disambiguator is `at`, which
   `buildRoster` holds and then drops (`pacing.cjs:220-239`). So `ice_archer#1` cannot be told from
   `ice_archer#2` by any client-side parse. The information is not encoded.

**What must change — and it is already specified, by a sibling:** REQ-0261 §8.2's roster widening.

```ts
export interface ApiRunRosterEnemy {
  id: string;                      // the DEF id (unchanged)
  instanceId: string;              // NEW -- "frost_gnoll#0". THE JOIN. This is what closes Deviation 3.
  at: string;                      // NEW
  fieldCells: [number, number][];  // NEW -- s4.2's geometry
  masked: boolean;                 // NEW -- s4.5
  name: string; nameJa: string; hpMax: number; footprint: number[]; packId: string | null;
}
```

**So REQ-0263 hard-depends on REQ-0261's SERVER change, not on its renderer.** If REQ-0261 ships only
its client half, **(j) is undeliverable for enemies** and this REQ must stop. REQ-0261 §8.4 says the
same thing from its own side (*"closing it here also closes REQ-0263's deviation-3 blocker for free"*);
this REQ confirms the dependency is real and names it as a blocker rather than an optimisation.

### 4.4 The gap NOBODY has named: **the nova carries no `hp_after`**

**Measured, and this is the finding this REQ contributes to the program:**

| event | carries `hp_after`? | share of ray damage (golden-A) |
|---|---|---|
| `ray_hit` | **yes** | 284.7 = 27.8% |
| `ray_hit_all` (nova) | **NO** — `hits[] = [{dst, amount}]` only | **740.2 = 72.2%** |
| `ray_aoe` | **NO** — same shape | 0.0 (this run) |

**An HP bar driven by `hp_after` is blind to 72.2% of the damage in the game.** It would sit still
through the nova — the main gun (REQ-0262 §11) — and then jump on the next direct hit. On the
*enemy* side, where the nova does its work, the bar would be wrong almost all of the time.

Neither REQ-0240 (which deferred enemy bars entirely, so never hit this), nor REQ-0257 (which adds
`ray` to `ray_hit_all` but not `hp_after` to its `hits[]`), nor REQ-0261 (which draws no bars) names
this. It only surfaces once you try to draw the bar.

**Two ways to close it:**

- **(a) Accumulate `amount` client-side.** **Rejected.** It requires the client to re-derive HP from
  damage — which means re-implementing block, shield, `reduceIncoming` (`skills.cjs:240`), heals and
  lifesteal, in the client, in TypeScript, against a server that owns all of them. That is
  re-simulating, which `combat_spec §1.2 [LOCKED OQ1]` forbids by name (*"clients replay the log,
  never re-simulate"*). It would also drift silently.
- **(b) ADOPTED — add `hp_after` to `ray_hit_all.hits[]` and `ray_aoe.hits[]`.** The server already
  has it: `dealHitFn` computes `hp_after` for the direct path (`ray_hit` carries it), so the value
  exists at the moment each nova victim is struck (`skills.cjs:212-220` enumerates them and applies
  damage). It is **the same field, on the sibling event**.
  **Cost, measured:** golden-A has 17 novas averaging ~2 victims = **~34 extra numbers per run**.
  Against REQ-0257 §10.2's already-accepted **3.75× log growth** (330 -> ~1238 events), this is
  **noise** — it adds no events at all, only a field to existing array members.

**Whose REQ is this? — SETTLED: REQ-0257's. It ACCEPTED.**

This was raised as a cross-REQ hand-off rather than silently assumed, and **REQ-0257 §10.1b has now
accepted it in writing**: `hp_after` is added to `ray_hit_all.hits[]` and `ray_aoe.hits[]` in 0257,
which is already rewriting exactly these emissions, and the golden movement is folded into **0257
§14.1's** rebaseline rather than deferred into a third one. 0257's acceptance criterion 17 is the
gate.

**What that means for THIS REQ, precisely:**

- **This REQ does NOT touch `sim/lib/skills.cjs`.** The field arrives with 0257. §10's scope says so.
- **It becomes an ORDERING dependency, and a hard one.** REQ-0257 must land first (see **Depends**).
  If this REQ shipped first, its HP bars would be blind to 72.2% of ray damage until 0257 landed —
  and blind *silently*, since a bar that does not move looks like a bar, not like a bug.
- **The blast radius this REQ avoided:** had 0257 declined, this REQ would have inherited
  `sim/lib/skills.cjs` **and a third rebaseline of all 12 goldens**, after 0256's and 0257's. That is
  the cost the hand-off bought off, and it is why it was worth asking rather than assuming.

**If 0257's acceptance is ever reversed, this REQ STOPS and returns to the user** — it must not
quietly re-adopt the field, and it must not fall back to 0263 §4.4 option (a), which
`combat_spec §1.2 [LOCKED OQ1]` forbids by name.

### 4.5 Enemy `hpMax` is a HINT, and on a formation map that becomes visible — **USER RULING**

REQ-0240 M1 chose enemy `hpMax = hp[1]`, the def's **upper** bound, deliberately: *"so an
`hp_after/hpMax` tick never exceeds 100% (a leak-safe HINT the client reveals on first-seen)"*.

**That choice was safe when enemies were drawn lazily at their first ray-event cell.** REQ-0261 §8.2
changes the premise: the expedition **is** a formation map, so every unmasked enemy is on screen from
`t=0`. And an enemy whose real rolled HP is near `hp[0]` will show, **at full health, before a single
shot**, a bar at `hp[0]/hp[1]` — visibly partial. **Every enemy appears pre-damaged.**

This is new: the small monitor never drew enemy bars (Deviation 3), so the hint's cost was never
paid. Options:

- **(A) RECOMMENDED — send the instance's real rolled `hpMax`, gated on `masked`.** For **unmasked**
  instances, send the truth: REQ-0261 §8.2 already rules that their position, footprint and identity
  are visible from t=0 on a formation map, so their `hpMax` is **not a larger spoiler than what is
  already conceded**. For **masked** instances, send nothing (they have no bar until discovery, §4.6).
- **(B) Keep `hp[1]`.** Zero server change; every enemy reads as pre-damaged for the whole run. The
  bar is then not a lie exactly, but it is not readable either.
- **(C) Normalise to first-seen HP.** Rejected: a 1-HP trap and a 500-HP boss would render identical
  bars, which destroys the only thing a bar is for.
- **(D) No enemy bar until first hit.** Rejected: it re-creates Deviation 3 as a feature and leaves
  (j) half-unimplemented on the side the user is watching.

**This is a spoiler/design call and belongs to the user**, and it rides with REQ-0261 §8.2's own
open spoiler ruling — they should be answered together, since (A) is only defensible *because* of how
0261's is answered.

### 4.6 Masked instances

`masked:true` gimics (measured: `trap_frost_deadfall` and one other of the 4) emit `dst:'?'`. **No
bar until discovery.** On the first event naming the instance by its real id, the bar appears. This
matches REQ-0261 §8.2's silhouette treatment (*"The arrangement is visible; the identity is not"*)
and `MonitorRenderer.markDiscovered` (`:445-455`) already implements exactly this reveal latch —
reuse its semantics, do not invent a second one.

## 5. (k) Unit charge — and the golden that may not survive the user

### 5.1 Auditing `chargeRing.ts`'s promise — it holds, and its comment does not

`chargeRing.ts:28-30` makes a specific, testable claim:

> REQ-0129 (charge trigger taxonomy) supplies the real value; when it does, it changes **ONE argument
> at the call site** and this module needs **no edit**.

**Verified, claim by claim:**

| claim | verdict | evidence |
|---|---|---|
| *"every production call site passes NULL today"* | **TRUE**, and stronger than stated: there is exactly **ONE** production call site. | grep over the whole tree: `BoardRenderer.ts:986` `drawChargeRing(ring, x, y, null);`. Everything else is `check_unit_icon.mjs` / `build_ring_preview.mjs` (test + preview). |
| *"changes ONE argument … this module needs no edit"* | **TRUE — for a ring.** `radius`/`width` are already parameters (`:124-125`), so REQ-0261 §5.1's `15 / 1.5` needs no edit. `chargeRingArc` is pure and total. | `chargeRing.ts:118-126, 76-88` |
| *"THERE IS NO CHARGE DATA IN THIS CODEBASE … sim/ has no per-unit charge either. The only `cooldown` in the tree is sim/lib/dungeon.cjs's cooldownForH()"* | **TRUE on 2026-07-12. FALSE TODAY.** | REQ-0200 (**merged**) added `sim/lib/unit_charge.cjs` (a per-unit-instance counter/capacity runtime) and `sim/lib/unit_charge_encounter.cjs`. And **42 of 54 live units carry a `charge` block** (measured). |
| *"REQ-0129 supplies the real value"* | **FALSE — mis-assigned.** REQ-0129 lives in **`docs/REQ/done/`**: it has shipped, and `:986` still passes `null`. It delivered the *vocabulary* (`vocab.json` v13's `charge` block) — which is *why* 42 units now have charge — but it was never the thing that lights the ring. **The data source is REQ-0200.** Brief §6 says so. | `docs/REQ/done/REQ-0129-…`; `BoardRenderer.ts:986` |

> **A REQ-policy violation found in passing, reported not fixed.** `REQ-0129`'s own header reads
> `**Status:** todo`, while the file sits in `docs/REQ/done/`. PROJECT.md is unambiguous: *"a REQ's
> status IS its folder. Nothing else records REQ status."* The in-file status line should not exist.
> Not this REQ's file to edit; flagged for whoever owns the board.

**So: the module is genuinely call-ready and the promise holds. Its module comment is materially
false.** REQ-0263 makes a **doc-only** edit to `chargeRing.ts`'s header (and `BoardRenderer.ts:981-987`'s
mirroring comment) — no behaviour change — because a comment that tells the next reader *"there is no
charge data in this codebase"* while 42 units carry charge blocks and a merged runtime computes them
is worse than no comment. **The Backpacks call site stays `null`** and the reason it stays `null`
changes: not *"no data exists"* but *"canvas units are dormant — out of combat, per REQ-0030"*, which
is the one clause of the original audit that is still true.

### 5.2 「背景」 vs G7's RING — the daylight is real. **USER RULING REQUIRED.**

**G7**, `unit_icon_pipeline.md` §1 (ratified 2026-07-12, "ALL GREEN"), verbatim:

> **G7 — Charge overlay language.** The Unit charge-state overlay is a **ring fill** (radial progress
> around the icon), renderer-drawn per G2 and identical across all skins.

**The user**, 2026-07-18, spec (k), verbatim: 「Unitの**背景**をClockwiseに増加させるUI技法」 — *"a UI
technique that increases the Unit's **background** clockwise."*

**Are they the same control? No.**

| | **G7 — ring fill** | **user — 背景 wedge** |
|---|---|---|
| geometry | a **stroked annulus**: `g.arc(x,y,30,…); g.stroke({width:3})` (`chargeRing.ts:132-140`) | a **filled sector** sweeping from the centre |
| what sweeps | an **arc** along a circle's circumference | an **area** |
| where it sits | **outside** the core disc (r=30 vs core r=26) | **behind** the icon |
| its relation to the art | *"hugs the OUTSIDE of the unit core disc so it never occludes the character's face — G4 demands the silhouette stay readable at 64px"* (`chargeRing.ts:37-40`) | occludes nothing **iff** drawn behind; occludes **everything** if drawn over |
| reads as | a progress **ring** | a **pie/cooldown sweep** |

**They CAN be reconciled, and the reconciliation is the recommendation:** a clockwise-sweeping
**translucent wedge drawn BEHIND the unit art** (z-order below the icon sprite) satisfies 「背景」
literally *and* preserves G4 — it cannot occlude a face it is behind. **But it is not a ring fill, so
G7 as written does not survive it.**

**The decisive argument is that the user's spec is self-consistent and G7 is the outlier.** Across
the same directive:

- **(k)** item cooldown = 半透明の黒 **on** the item — a translucent-black overlay;
- **(k)** Unit charge = 背景 increasing **clockwise**;
- **(l)** monster skill = a circle with **clockwise translucent-black** charge.

**All three are one idiom: a clockwise translucent sweep meaning "time until this fires".** Under G7
the Unit alone would be a stroked ring — the only element on a screen full of sweeps that reads
differently, for a quantity that is *the same quantity*. The user has, in effect, unified the
vocabulary; G7 predates the unification.

**Options:**

- **(A) RECOMMENDED — the wedge wins; G7 is amended.** One idiom across Unit / item / monster skill.
  **`chargeRingArc()`'s math survives verbatim** (`{startAngle, endAngle, sweep, full}` is exactly a
  wedge's parameters — it was always geometry, not decoration); a new `drawChargeWedge()` supplies the
  fill. `RING_START_ANGLE = -PI/2` and the clockwise sweep carry over unchanged, so 12-o'clock-clockwise
  — the part of G7 the user is *agreeing* with — is preserved.
- **(B) G7 holds; the Unit keeps the ring.** Zero code risk (`chargeRing.ts` is call-ready today,
  §5.1). Cost: two idioms for one concept, and the Unit is the odd one out.
- **(C) Both** — wedge behind *and* ring outside. **Rejected**: two controls for one number.

**Why an LLM must not decide this.** `unit_icon_pipeline.md` is under `docs/llm_managed/`, so the file
is *technically* LLM-writable — **but G7 records a user ratification** (*"Ratified via 2026-07-12
review, ALL GREEN"*), and G7 was reserved specifically so that **no unit icon bakes in ring-like
framing that would collide with the overlay**. Amending it is therefore not a doc edit; it is a change
to a constraint that **already governs shipped art**. If the wedge wins, every existing unit icon must
be re-checked against the *new* overlay shape — a wedge behind the art has different collision
properties than a ring outside it (G2/G4 re-verification, `art_golden`). **That is an art-pipeline
consequence, and it must be the user's call.**

### 5.3 The charge DATA gap — what REQ-0240 M3 actually found, and what actually closes it

REQ-0240 M3, verbatim:

> **M3 (charge ticks) — feature-flagged OFF cleanly.** No `unit_charge_*` -> dock/plate pip mapping
> was wired (**charge events are not slot-attributable without more plumbing**); dock charge pips are
> hidden when charge telemetry is absent (`charge:null`).

**M3's diagnosis is half right, and the half it misses is the half that matters for a ring.**

**On "not slot-attributable":** measured, the events **do** carry a BP id. `unit_charge.cjs:210`
emits `{ev:'unit_charge_spend', id: s.id, …}` and `unit_charge_encounter.cjs:169` builds instances as
`chargeBps.map(bp => ({ id: bp.id, … }))` — **`id` IS the BP id**. BP -> squad slot is then knowable
(`ApiRunRosterSlot.bps[].id`, and the sim tags `b.squadSlot` per REQ-0095). So slot attribution is
*derivable* today; M3's blocker is softer than its wording suggests. **But this REQ needs BP
attribution, not slot attribution — and it already has it.**

**The real gap, which M3 does not name: NO EVENT CARRIES THE COUNTER.** Every `unit_charge_*`
emission is **discrete** — `_spend` (at capacity), `_stack`, `_transform`, `_strike`, `_onhit`,
`_lifesteal`, `_reflect`, `_transfer`, `_shieldbreak`. **None carries `counter`.** So:

- for `spend:'fire_on_full'` (the majority of the 42) the client sees **only the moment of firing** —
  it can flash at 100% but cannot draw a *filling* control at all;
- for `spend:'passive_per_stack'`, `unit_charge_stack {id, stacks}` gives `stacks`, but only when
  stacks *change*.

**A ring with no counter is not a ring. This is the gap, and it is a wire gap, not a plumbing gap.**

### 5.4 The encoding that closes it — parameters, not a stream

**The naive fix is fatal.** A `unit_charge_tick {t, id, counter, capacity}` per instance per tick, at
`TICK_SECS=0.01` over a 23.6s run, is **2,360 events per charging BP** — for a troop with 32 charge
BPs, **~75,500 events**, versus the ~1,238 REQ-0257 §10.2 already flags as a 3.75× problem. **A ~60×
blow-up to draw a ring. No.**

**ADOPTED — split by whether the counter is a function of time:**

```
NEW  unit_charge_arm  {t, seq, ev, id, capacity, trigger, period?}
       // emitted at encounter start and after every spend/rearm. ONE per spend.
       // `capacity` is MANDATORY: it is per-instance ROLLED (unit_charge.cjs:128 --
       // the def says [2,3], the instance says 2.5), so the client CANNOT derive it
       // from content. This is the field that makes the whole scheme possible.

NEW  unit_charge_gain {t, seq, ev, id, counter}
       // ONLY for non-every_secs triggers. ONLY when the counter changes.

     unit_charge_spend {…}   // EXISTS. client snaps to full, flashes, resets to 0, awaits re-arm.
```

- **`trigger === 'every_secs'`** -> the counter is a **pure ramp**: `counter(t) = (t - t_arm)/period`.
  The client interpolates it against REQ-0260 §9.3's clock, exactly as REQ-0262 §5.2 interpolates the
  ray head. **Zero further traffic.** This is precisely the trigger that *would* emit every tick, so
  keeping it off the wire is the entire win.
- **event-driven triggers** (measured on live units: `on_damage_dealt`, `OnBPBeenHit`, `on_heal_done`,
  `on_connected_unit_attack`, `on_connected_unit_spend`, `on_kill`, …) -> the counter is **not** a
  function of `t`; it jumps on combat events. It cannot be interpolated, so it is sent — but only on
  change. **Bounded by combat events, not by ticks:** golden-A has 36 fires + 21 hits + 17 novas, so
  gains are in the **hundreds** per run, not the tens of thousands.
- **The ring hides cleanly when absent — already, with no edit.** A BP with no `charge` block (12 of
  54 units) never emits `arm`, so the client holds `null`, so `chargeRingArc(null)` returns `null`
  and **nothing is drawn and nothing costs** (`chargeRing.ts:77`, and `check_unit_icon.mjs:123` already
  tests exactly this case: *"null charge -> no ring (the production case today)"*). **Verified: the
  module needs no edit for absence.** This is the one part of §5.1's promise that requires no
  qualification at all.

**Why not send `counter` on change for *all* triggers, uniformly?** Because for `every_secs` the
counter changes **every tick by construction** (`unit_charge.cjs:297-305` ramps it on the timer) —
"on change" *is* the per-tick stream for the one trigger that would flood. The arm/ramp split is not
an optimisation; it is the difference between 75,500 events and ~0.

### 5.5 CORRECTION — **42 of 54 live units DO carry a charge block**

The task states: *"note NO live unit carries a `charge` block today (`unit_charge.cjs`'s guard:
`troopBps.filter(b => b && b.charge)` — verify)"*. **Verified. It is false**, and the correction
matters because it inverts this REQ's risk.

**Measured** (`content/live/live_units.json`, 54 entries): **42 carry a top-level `charge` block** —
`alchemist {every_secs, fire_on_full, [2,3]}`, `darkknight {OnBPBeenHit, passive_per_stack, [12,18]}`,
`dragonknight {on_damage_dealt, fire_on_full, [80,120]}`, `hero`, `jester`, `bard`, `cleric`, … .

**Where the claim comes from, and why it is stale:** `sim/lib/compile.cjs:142-144`, verbatim:

```js
// REQ-0200: attach the unit def's `charge` block (if any) so runEncounter can build
// a charge manager keyed on this BP. undefined for ALL current content (no live unit
// carries a charge block, and callers with no unit registry resolve UNIT_DEFS = {})
// -> no new property is set -> byte-identical goldens.
```

The first clause is **out of date** (REQ-0129 shipped `vocab.json` v13's charge block and the roster
was authored against it). **The second clause is still true and is the load-bearing one** —
and following it produces a genuinely important finding:

| caller | passes `unitDefsById`? | -> `bp.charge`? | -> charge manager? |
|---|---|---|---|
| **production** `server/services/runs.cjs:83-91` | **YES** | **YES**, for 42 units | **YES** — `chargeBps.length` is non-zero (`encounter.cjs:40,140`) |
| **goldens** `sim/tests/goldens.cjs:63` (`baseOpts`) | **NO** | no | no |

**So the charge engine is LIVE in production and INVISIBLE to the 12 replay goldens.** The goldens
compile with `UNIT_DEFS = {}` and never construct a `chargeMgr`, so the determinism contract does not
cover the charge runtime at all. That is not this REQ's to fix — but it means (a) the ring has **real
data waiting** the moment §5.4's events exist (the risk is *lower* than the task assumed), and (b)
**no golden will catch a charge regression** (a different risk, *higher* than anyone has assumed).
`sim/tests/unit_charge_test.cjs` (13 passing) and `unit_charge_encounter_test.cjs` (23 passing) are
the only nets. **Reported to the orchestrator; belongs to REQ-0256/0257's rebaseline conversation,
not here.**

Minor correction to the same sentence: the guard is at **`sim/lib/encounter.cjs:40`**, not in
`unit_charge.cjs`.

## 6. (k) Item cooldown — the overlay, and the stream that must not exist

### 6.1 The control

「アイテムのクールダウンは、アイテムの上に半透明の黒」 — a translucent-black overlay **on** the item.

```
EXP_CD_OVERLAY_FILL  = 0x000000
EXP_CD_OVERLAY_ALPHA = 0.55
```

Drawn as a **clockwise wedge** from 12 o'clock (`RING_START_ANGLE = -PI/2`, reused verbatim from
`chargeRing.ts:47`), clipped to the item's **footprint cells** — not to a circle, because a PO is a
polyomino. The cells come from `computeFootprintCells(shape, rot)` (`itemCard.ts:71`), the same helper
REQ-0261 §4.3 uses to draw the item in the first place, so the mask cannot drift from the art.

`frac` **remaining** shrinks 1 -> 0 as the cooldown elapses: the black *uncovers* the item as it
becomes ready. **The sweep direction and the semantics are the user's** — 「増加」 in (l) describes the
charge *filling*; for a cooldown the same clockwise sweep *depletes*. Both are "the wedge tracks time
until fire", which is §5.2's single idiom.

### 6.2 The data — REQ-0256's `cooldownSkills`

Brief §4 / REQ-0256:

```
IBattleInstance.cooldownSkills : Map<int, {skill: IBattleInstanceSkill, remainingTicks: int}>
  tick()  // decrement each remainingTicks by 1; on reaching 0 -> fire, then RESET
          //   ("数値を戻します") to a freshly rolled cooldown from the skill def
```

The HUD needs `remainingTicks / cooldownTicks` **per item (PO), per tick**.

### 6.3 The naive stream is ~300,000 events. Measured, not feared.

A per-tick per-item event, at `TICK_SECS = 0.01` over golden-A's 23.6s (= **2,360 ticks**):

| troop scale | items | events |
|---|---|---|
| 4 squads × ~8 BPs × ~2-4 POs | ~64–128 | **151,000 – 302,000** |

Against a **330-event** run today, and the **~1,238** REQ-0257 §10.2 already flags as a 3.75× problem
that *"belongs in front of the user BEFORE the work starts"*. **This would be 100–240× the entire
log, to animate a rectangle.** It is not a tuning question; the encoding is simply wrong.

### 6.4 ADOPTED — derive the ramp; send nothing

**A cooldown is the most perfectly linear quantity in the entire system.** REQ-0256's own contract
says `remainingTicks` decrements by **exactly 1 per tick**, with no exceptions and no easing. So:

```
frac_remaining(t) = clamp01( 1 - (t - t_arm) / (cooldownTicks * TICK_SECS) )
```

The client needs **two numbers per fire**: `t_arm` (which is the fire event's own `t`) and
`cooldownTicks`. It already has the first.

**So: add two fields to `ray_fire`, and add NO new event.**

```
ray_fire  {t, seq, ev, ray, src, field, entry, dir, pen, aoe,
           slot,           // NEW -- the cooldownSkills slot index (REQ-0256 s10.1 orders by it)
           cooldownTicks}  // NEW -- the freshly rolled cooldown this fire re-armed to
```

**Cost, measured: 36 fires in golden-A = 36 events that already exist, gaining two fields. Zero new
events.** Compare 302,000. The overlay for **every item, on every frame, at any playback speed**, is
then a pure function of the clock — exactly REQ-0262 §5.2's ray head, and correct under 0.5/1/2/4×
and backward scrub for exactly the same reason.

**Why `ray_fire` and not a new `skill_arm` event:** a fire *is* the arm. REQ-0256's `tick()` fires and
re-arms in the same step (*"on reaching 0 -> fire, then RESET"*), so the two moments are one moment,
and one event should carry it. A parallel `skill_arm` would duplicate `ray_fire`'s `t` and `src` on
every fire and then need a join key to reconnect them.

**Four caveats, stated because they are the ones that would break this:**

1. **A non-ray fire has no `ray_fire`.** A skill whose verb is `heal_ally` (measured: 2 of 81 live
   skills) or `apply_status` (27 of 81) may resolve without a ray. Those fires need the same two
   fields on **whatever event they do emit**. **This REQ cannot enumerate that set without REQ-0256's
   implementation in hand** — flagged as an interface requirement on REQ-0256: *every fire, ray or
   not, emits `slot` + `cooldownTicks`*. If a fire emits no event at all, its item's overlay is
   underivable and REQ-0256 must add one.
2. **Chill/Haste must not re-roll mid-cooldown.** Brief §4: `cadenceMultiplier()` applies *"to the
   ROLLED SECONDS before conversion"*, i.e. at **fire** time — so the multiplier is already baked into
   `cooldownTicks` at arm and the ramp stays exactly linear. **If REQ-0256 instead re-rolls or scales
   an already-armed cooldown when a status lands, this derivation silently breaks** (the bar would
   drift from the sim, invisibly). **Gate it** (§11.4): assert that an armed `remainingTicks` is a
   pure function of `(t_arm, cooldownTicks, t)` across a Chill application. This is a **dependency
   assumption on REQ-0256, recorded as one** rather than discovered later.
3. **`ray_fire` has THREE emission sites, and the inverse of caveat 1 — a `ray_fire` with no
   cooldown — DOES NOT arise. Here is why, because the answer is not obvious and the opposite was
   assumed.** REQ-0257 §10.1a measures the sites: `skills.cjs:195` (the real ray), and
   `encounter.cjs:359` / `:378` — detection and unlock rays, **synthesised**, carrying `mode` and
   omitting `dir`/`pen`/`aoe`. It would be natural to conclude those two have no slot and no rolled
   cooldown, and that `slot`/`cooldownTicks` must therefore be nullable. **Read the dispatch and that
   conclusion collapses** (`encounter.cjs:663-670`, verbatim structure):

   ```js
   } else if (s.modes.includes(encounterDef.mode)) { …fireSkillRay… }      // site 1
   } else if (hasAtt && s.modes.includes('detection')) { resolveDetection(s, ev.t); }  // site 2
   } else if (hasAtt && s.modes.includes('unlock'))    { resolveUnlock(s, ev.t); }     // site 3
   // reschedule regardless of match
   scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, ev.t, …);                 // :670
   ```

   **All three sites are driven by the SAME schedulable `s`, and `:670` re-arms it identically for
   all three.** Under REQ-0256 §8.5 that `scheduleEffect` **becomes `rollCooldownTicks` on the same
   `cooldownSkills` slot**. So a detection/unlock ray has exactly the slot and the freshly rolled
   cooldown that a combat ray has. **RULING: `slot` and `cooldownTicks` are NON-NULL at all three
   sites, and are not special-cased.** What REQ-0256/0257 owe is **threading the slot into
   `resolveDetection`/`resolveUnlock`**, which today receive `s` but do not know their slot index —
   recorded here as an interface requirement on them, alongside caveat 1's.

   **The HUD consequence is real, not academic:** an unlock skill on a player BP *does* get a
   cooldown overlay on its item, and it should — the item genuinely re-arms. Had `null` been
   specified, that overlay would have silently vanished the moment a player opened a chest.

   **What the client must still guard (REQ-0257 §10.1a):** `dir`/`pen`/`aoe` are **absent, not zero**
   on sites 2/3, and `mode` is absent on site 1. golden-A is a `batch002` run with **no attachments**,
   so it exercises **site 1 only** and cannot show this. **Do not author the HUD against golden-A's
   `ray_fire` shape.** Read `slot`/`cooldownTicks`/`cause`; guard everything else.
4. **`cooldownTicks` is rolled AFTER the fire, so the field must be BACK-PATCHED — it cannot be
   stamped at emit time, and the roll must not move.** REQ-0256 §8.5 is explicit that the fire
   precedes the roll (*"on reaching 0 -> fire, then RESET"*) and that *"the stream name, the draw
   order, and the multiply are IDENTICAL"* to today's `scheduleEffect`. **Rolling earlier to have the
   number in hand would reorder an RNG draw and move every golden for a reason that has nothing to do
   with this REQ.** So: emit `ray_fire` during the fire, then write `cooldownTicks` onto the
   already-emitted event once `rollCooldownTicks` returns, before it is serialised. This applies to
   **all three** sites. It is an implementation constraint, but it is a *determinism* constraint
   wearing implementation clothes, which is why it is specified here rather than left to taste.

## 7. (k)/(l) The passive flash — and distinguishing it from a cooldown fire

「パッシブ的な発動条件のアイテムもちゃんと発動したら、光る」 — a passive-trigger item, when it really
fires, **lights up**.

### 7.1 The discriminator

| | **cadence fire** | **passive fire** |
|---|---|---|
| trigger | `trigger.t === 'every_secs'` — a countdown reaches 0 | a **condition** (OnHit, OnBPBeenHit, on_kill, hpbelow, …) |
| has a ramp? | **yes** — §6.4's overlay | **no** — there is nothing to count down |
| flashes on fire? | yes | **yes** — this is the user's point |

**The rule: overlay ⟺ cadence. Flash ⟺ any fire.** The flash is universal (「発動したら」 — *whenever*
it fires); the overlay belongs only to the thing that has a countdown. Drawing a cooldown wedge on a
passive would be inventing a timer that does not exist.

**On the wire — use `cause`, which is an established precedent here, not an invention:**

```
ray_fire  {…, cause}   // NEW field, existing vocabulary
   'cadence'  -> an every_secs cooldown fire   (gets the s6.4 overlay + a flash)
   'reactive' -> a passive/condition fire      (flash only)
   'charge'   -> a charge spend                (flash only; already emitted, encounter.cjs:119,136)
   'pulse'    -> a linker pulse                (already emitted; MonitorRenderer.ts:718 reads it)
```

**Precedent, verified:** `cause` already exists on this wire and already drives a visual branch —
`MonitorRenderer.ts:718` gold-tints payload rays on `ev.cause === 'pulse'`, and `encounter.cjs:119/136`
stamp `cause:'charge'`. **Measured caveat: `cause` appears on ZERO events of golden-A**, because that
run takes neither the pulse nor the charge path. So `cause` is real but **sparse**, and this REQ makes
it **total on fire events** — `'cadence'` becomes the explicit default rather than an absence.

**Why not read the trigger from the def client-side?** The client *does* have the defs, so it could
look up `skill.trigger.t`. **Rejected:** it requires the client to know which skill fired, and
measured, **`ray_fire` carries no `skill`** (REQ-0262 §9.1) — the very field REQ-0264 must add. A
discriminator that depends on an unshipped field is not a discriminator. `cause` is one field, needs
no join, and is already the pattern.

### 7.2 The flash itself — and why it does not glow

```
EXP_FIRE_FLASH_MS = 150      // s6.0's 120-180ms transition band
```

The item's **frame brightens** for 150ms, ease-out. **Non-glowing** — a border/fill lightening, no
`shadowBlur`.

**Justification, and it is a real constraint rather than caution:** `styleguide.html` §6.1 rations
glow to four moments — ①focus ②legendary+ manifestation ③live link beam ④**命中の瞬間 (the instant of
a hit)**. **A skill FIRING is not a HIT.** It is not any of the four. So a glowing fire-flash is
unlicensed, and it would compete for the ≤3 budget that REQ-0262 §8 shows is *already* 6.3× oversubscribed
by rays. With up to ~128 items on the player plane firing throughout a run, fire-flashes alone would
dwarf the hits.

**「光る」 literally means "shines/glows", and rendering it as a non-glowing brighten is an
interpretation.** Recorded as one (§12). The reading: the user's intent is *"I must be able to see
that it fired"* — 「ちゃんと発動したら」 emphasises *confirmation*, not luminance — and a 150ms frame
brighten delivers that at zero budget. If the user wants literal glow, it lands inside REQ-0262 §8's
budget ruling, which must then account for it.

## 8. (l) Monster / gimic skill badges

### 8.1 The control

Per instance, one badge **per skill**, passives included:

- a **circle** + the skill **icon**,
- a **clockwise translucent-black** charge wedge (§6.1's idiom and constants — one vocabulary),
- laid out **top-right of the drawn art**,
- the **frame lights on fire** (§7.2's non-glowing 150ms brighten).

### 8.2 The layout rule for N skills — MEASURED, and the task's premise is wrong

**The task says enemies carry "1-2" skills. Measured across ALL live content:**

| source | entries | skills-count distribution | **MAX** |
|---|---|---|---|
| **`content/live/dungeon/enemies.json`** | 44 | `{1:10, 2:33, 3:1}` | **3** (`hrimgrimnir`, footprint `[3,3]`) |
| `content/live/dungeon/gimics.json` (req-0211) | 4 | `{0:2, 1:2}` | **1** |
| batch-002 | 7 | `{1:3, 2:3, 3:1}` | 3 |
| batch-005 | 8 | `{2:8}` | 2 |
| batch-006 | 12 | `{1:4, 2:8}` | 2 |
| batch-007 | 17 | `{1:3, 2:14}` | 2 |

**So N ∈ [0, 3], not [1, 2].** Two corrections fall out, and the second is the one the task misses
entirely:

- **N can be 3** (`hrimgrimnir`, a live boss). A layout that assumes 2 clips a boss's third skill.
- **N can be 0.** Two of the four live gimics (`door_rimefast_stage2`, `chest_frostbound_cache`) have
  **no skills at all**. **N=0 draws no badge cluster** — not an empty circle, not a placeholder. An
  empty badge on a treasure chest would assert a mechanic that does not exist.

**The binding constraint is not N — it is N against FOOTPRINT.** Measured cross-tab:

```
fp1x1  skills=2 -> 2 enemies   (rime_shaman, niflheim_stalker)   <-- WORST CASE
fp1x1  skills=1 -> 3
fp3x3  skills=3 -> 1           (hrimgrimnir)
fp4x3  skills=2 -> 11          (the modal case)
fp10x10 skills=2 -> 2          (bone_dragon, kraken)
```

**The rule:**

```
EXP_BADGE_D    = clamp(cellPx * 0.45, 12, 20)     // 18px at EXP_CELL=40
EXP_BADGE_GAP  = 2
anchor         = top-right corner of bounds(instance.fieldCells)
direction      = stack DOWNWARD along the box's right edge
```

**Why downward, not leftward:**

- **It never collides with the HP bar**, which §4.2 puts under the shape's **bottom** edge. Leftward
  stacking marches across the art's face — the silhouette G4 exists to protect; downward marches along
  its edge.
- **The right edge is the stable anchor** under REQ-0261 §8.2's `fieldCells` bounding box, and enemy
  shapes are as often taller than wide as the reverse (`[3,4]` and `[4,3]` both occur), so no
  width-based rule generalises.

**And it fits the real content — exactly, with 2px to spare:**

| case | badges | needed height | available | fits? |
|---|---|---|---|---|
| `rime_shaman` `[1,1]`, 2 skills | 2 | `2*20 - 2 = 38px` | `1 * 40 = 40px` | **yes, by 2px** |
| `hrimgrimnir` `[3,3]`, 3 skills | 3 | `3*20 - 2 = 58px` | `3 * 40 = 120px` | yes |
| `bone_dragon` `[10,10]`, 2 | 2 | 38px | 400px | trivially |

**It fits by 2px, which means it fits by luck — so pin it.** §11.5's gate asserts, for every live
enemy and gimic, `N * (EXP_BADGE_D + EXP_BADGE_GAP) - EXP_BADGE_GAP <= footprint[0] * EXP_CELL`. **The
gate fires the moment anyone authors a 1×1 enemy with 3 skills** — the exact content drift that would
otherwise ship as a silently clipped badge. This is REQ-0258's lesson applied to layout: *a gate that
watches one half of a rule watches none of it*.

**Runtime overflow policy** (for content deployed after the gate): badges beyond the fit **collapse
into a single `+N` badge**. Never overlap, never spill outside the shape.

**Clipping at the plane edge is not a risk, and the padding ring is why.** An enemy at the rightmost
placeable column (Y, per `PLACEABLE = {colMax:25}`) has its badges land over column Z — which is the
**padding ring** (spec f), field but unoccupiable. There is always room. Worth stating because it is
the kind of thing that looks like a bug waiting to happen and is in fact already solved by REQ-0258's
geometry.

### 8.3 Skill icons DO NOT EXIST — the placeholder that ships now

**Verified:** `server/services/art_sizing.cjs:24` — `const KINDS = ['po','si','unit','monster','bpskin','custom'];`
(+`gimic` after REQ-0255's merge of REQ-0211). **There is no `skill` kind.** 81 live skills, zero art.

**Candidates, judged:**

| candidate | verdict |
|---|---|
| **styleguide §5's rune vocabulary** (`ᚨ`表題 `ᛗ`編成 `ᚱ`遠征 `ᚷ`倉庫 `ᚲ`図鑑 `ᛈ`工房 `ᚠ`市場 `ᛏ`殿堂 — `styleguide.html:249-256`) | **REJECTED.** These are **navigation** symbols with assigned meanings. `ᚷ` already means 倉庫 in the nav **and** "chest" in REQ-0240 M4. Reusing them for skills triple-books a glyph. |
| **REQ-0240 M4's class glyphs** (`ᚦ` trap / `ᚷ` chest / `ᛞ` door) | **REJECTED as-is** — a **3-symbol gimic-family** vocabulary cannot name **81** skills. But its *principle* (a ratified class->glyph fallback, honest, never blank) is exactly right. |
| the skill id's initial | **REJECTED.** `hrim_cleave`/`hrim_blizzard_volley`/`hrim_deep_freeze` all give "h". |
| **VERB-CLASS glyph — ADOPTED** | The verb axis is **closed and tiny**: measured, all 81 live skills use **6 verbs**. It is REQ-0240 M4's pattern applied to the axis that actually has few values. |

**ADOPTED: a verb-class rune, on the badge, over the wedge.**

```
strike           (30/81)  -> ᛊ     apply_status  (27/81) -> ᛁ
bonus_vs_status   (9/81)  -> ᛉ     lifesteal      (7/81) -> ᚢ
multi_strike      (6/81)  -> ᚺ     heal_ally      (2/81) -> ᛒ
```

Drawn in `--f-rune`, the styleguide's existing rune face (`styleguide.html:36`). **Collision-checked
against both the nav set and REQ-0240 M4's class glyphs — none of these six is used by either.**

**Why the verb, honestly stated with its cost:** the verb is **on the def already**
(`skillDefsById[s.id] = {trigger, verb, attack_profile, modes}`), so the placeholder needs **no new
wire field and no new art** — it ships the day the badge does. It says *what the skill does*, which is
true and useful. **Its cost: 30 skills share `ᛊ`.** A placeholder that says "this is an attack" is
low-resolution — and that is precisely the gap REQ-0265 closes by replacing glyph -> art **per skill
id**, one map, no layout change. Note the badge is not blank even without the glyph: it still carries
a live countdown wedge, so it already communicates *"something fires in N seconds"*; the glyph adds
*what kind*.

**This is a new visual vocabulary and is flagged for the user** (§12) — six runes entering the
product's symbol set is a design decision, not an implementation detail.

### 8.4 "Passives included" describes content that does not exist

Spec (l) says the badges include passives. **Measured: not one live monster skill is a passive.**
`content/live/dungeon/skills.json` — all **81** entries have `trigger.t === 'every_secs'`. The trigger
distribution is literally `{"every_secs": 81}`.

So on the **monster/gimic** side, every badge is a **cadence** badge with a real countdown ramp
(§6.4), and **the passive branch of (l) ships unexercised by live content.** It is specified and
implemented (§7.1's `cause` discriminator is uniform across both planes), and it will draw a
ramp-less flashing badge the day such content is authored.

**Passives are real — but on the PLAYER side**, which is why (k) needs them: item effects carry
reactive triggers (REQ-0078's OnHit taxonomy), and the unit-charge triggers measured in §5.5 are
mostly event-driven (`on_damage_dealt`, `OnBPBeenHit`, `on_heal_done`, `on_connected_unit_attack`,
`on_connected_unit_spend`). **So (k)'s passive flash has content today and (l)'s does not.** Recorded
so that "the monster passive badge never appears" is read as *correct*, not as a bug.

### 8.5 Gimic art does not reach the client — inherited from REQ-0261 §8.6

REQ-0261 §8.6 found that `computeArtUrls()` joins `monstersFromCore().monsters` only
(`content.cjs:240`), so **gimic ids never join `art_urls`** and `textures.get('item:' + gimicId)`
misses. **REQ-0259 owns the one-line fix.** For this REQ the consequence is bounded and worth naming:
a gimic's **badge** is unaffected (badges are runes, not art), but the instance it hangs off falls to
REQ-0240 M4's class glyph. Since 2 of 4 live gimics have **zero** skills (§8.2), the practical
exposure today is **two gimics with one badge each**.

## 9. Reduced motion — this REQ is mostly exempt, and that is not a loophole

REQ-0262 §10 carries the hard `prefers-reduced-motion` ruling (styleguide §6.6 names **戦闘再生** in
tier ②). **This REQ's controls are almost entirely STATE, not EFFECT, and §6.6 has never applied to
state:**

| control | under reduced motion |
|---|---|
| HP bars (§4) | **unchanged.** A bar's length is a fact. |
| cooldown overlay (§6) | **unchanged in value, discrete in update.** The wedge is evaluated on REQ-0262 §10.2's 250ms cursor instead of per rAF frame — it steps rather than sweeps. It is never *animated*; it is *recomputed*. |
| charge ring/wedge (§5) | same as the cooldown overlay. |
| skill badges (§8) | **unchanged.** |
| fire flash (§7.2), badge frame light | **NOT CONSTRUCTED.** These are the only true *effects* in this REQ — a 150ms ease-out transition is exactly what §6.6 tier ① short-circuits and tier ② forbids generating. **A fired item instead holds a static "fired" frame for one 250ms cursor step**, then drops it. The confirmation the user asked for survives; the animation does not. |

**The distinction that makes this legitimate** (and it is REQ-0262 §10.2's, applied consistently): a
cooldown's remaining fraction at time T is **read from the log**, not generated by a script. Stepping
it at 4Hz removes the motion while preserving the information. **The flash is generated**, so it goes.

## 10. Scope

**In:**

1. `client/src/expedition/ExpeditionHudLayer.ts` — **NEW.** HP bars (§4), item cooldown overlays
   (§6), unit charge control (§5), fire flashes (§7), monster/gimic skill badges (§8). Draws into
   REQ-0261's `ExpeditionRenderer` scene graph.
2. `client/src/expedition/skillGlyph.ts` — **NEW.** §8.3's verb -> rune map + the `+N` overflow
   collapse. The single seam REQ-0265 replaces.
3. `client/src/board/chargeRing.ts` — **DOC-ONLY** header correction (§5.1). No behaviour change; the
   Backpacks call site keeps `null` and gains a true reason. **Plus**, iff the user rules for the
   wedge (§5.2 Option A): a new `drawChargeWedge()` **alongside** `drawChargeRing()`, reusing
   `chargeRingArc()` verbatim. `chargeRingArc`, `RING_RADIUS`, `RING_WIDTH`, `RING_START_ANGLE` are
   **not touched** — REQ-0125a golden G7 pins them for the Backpacks board and REQ-0261 §5.1 halves
   them at the call site.
4. `client/src/board/BoardRenderer.ts` — **COMMENT-ONLY** (`:981-987`), which currently repeats
   chargeRing's stale audit (*"no charge data exists anywhere in the codebase"*). Pixel-identical.
5. `client/src/expedition/expeditionGeom.ts` — the constants join REQ-0260's module:
   `EXP_HP_BAR_W/H/GAP`, `EXP_CD_OVERLAY_FILL/ALPHA`, `EXP_FIRE_FLASH_MS=150`, `EXP_BADGE_D`,
   `EXP_BADGE_GAP`.
6. **Sim (additive), and every one of these is a FIELD on an EXISTING event, never a new stream:**
   - `ray_fire` + `slot`, `cooldownTicks` (§6.4), `cause` (§7.1).
   - **NEW** `unit_charge_arm {t, seq, ev, id, capacity, trigger, period?}` and
     `unit_charge_gain {t, seq, ev, id, counter}` (§5.4) — the only new events in this REQ, and both
     are O(spends)/O(combat events), not O(ticks).
   - `ray_hit_all.hits[]` / `ray_aoe.hits[]` + `hp_after` — **NOT THIS REQ'S. REQ-0257 §10.1b
     ACCEPTED the hand-off** and delivers it (§4.4). Listed here only so the reader knows the HUD
     depends on it; **this REQ does not touch `sim/lib/skills.cjs`.**
   - **These sim additions MOVE ALL 12 REPLAY GOLDENS. §10.1 is the rebaseline procedure, and it is
     not optional.**

### 10.1 Golden rebaseline — REQUIRED, and previously missing

**This REQ moves the replay JSONL, therefore it moves all 12 goldens' `jsonl_sha256`.** The first
draft did not say so anywhere, which made §11's gate list unsatisfiable as written: `tools/ci.sh`
runs `sim/tests/goldens.cjs` at step **[2/7]** (`ci.sh:107`), so a green CI was impossible the moment
`ray_fire` gained a field. **What moves the log:**

| change | § | effect on the log |
|---|---|---|
| `ray_fire` + `slot`, `cooldownTicks` | §6.4 | 3 fields on 36 existing events (golden-A). **No new events.** |
| `ray_fire` + `cause` | §7.1 | same event, one more field |
| **NEW** `unit_charge_arm`, `unit_charge_gain` | §5.4 | **new events — but ZERO in all 12 goldens.** See below. |

**The `unit_charge_*` events add nothing to the goldens, and that fact is itself the §5.5 finding.**
`sim/tests/goldens.cjs:63`'s `baseOpts` omits `unitDefsById`, so every golden compiles with
`UNIT_DEFS = {}`, builds no charge manager, and **can emit no charge event at all**. The two new
events are therefore invisible to the determinism contract — exactly the blindness §5.5 measured, now
biting this REQ's own gate. **Consequence, stated plainly: the goldens will confirm the `ray_fire`
fields and say NOTHING about the charge events.** Gate 8 and gate 9 are what cover those; do not
mistake a green rebaseline for coverage of §5.4.

**The procedure — the SAME one REQ-0256 §13.1 and REQ-0257 §14.1 specify. Do not invent a second
convention:**

```
node sim/tests/goldens.cjs          # CONFIRM RED first -- 12 DRIFT lines. If green, the fields did not land.
node sim/tests/goldens.cjs gen      # writes sim/tests/goldens/replay_hashes.json
git diff sim/tests/goldens/replay_hashes.json
```

1. **Expect all 12 `jsonl_sha256` to move.**
2. **`def_sha256` MUST NOT move on the 9 dungen cases** — the generator is untouched by this REQ. **If
   one moves, STOP:** something reached into `dungen.cjs` that should not have. (REQ-0256 §13.1's rule,
   unchanged and for the same reason.)
3. **`events` counts MUST NOT MOVE AT ALL.** This REQ adds only FIELDS to existing events, and its two
   new event kinds cannot fire in any golden (above). **This is the sharpest check available to this
   REQ** — sharper than 0256's or 0257's, because both of those legitimately move the count and must
   argue about the delta, while this REQ's correct delta is exactly **zero**. **A moved `events` count
   means this REQ emitted a stream it does not know about — stop and find it.**
4. **Prove the diff is fields-only.** Dump `combat.toJSONL(r.events)` for `batch002/golden-A` before
   and after and diff as TEXT: every line must differ **only** by the added keys, with no line added,
   removed or reordered, and every `t` unchanged. §6.4 caveat 4's back-patch is what makes this true —
   **if a `t` or an `amount` moved, the `cooldownTicks` roll was hoisted before its fire and the RNG
   draw order changed.** That is the specific regression this step catches.

**Ordering.** 0256 and 0257 each rebaseline before this REQ exists (0256 §13.1, 0257 §14.1). **This is
the THIRD move of the same 12 hashes, and the only one whose `events` count must not change** — which
is precisely why it is bisectable after the other two and why the Depends ordering (0256 -> 0257 ->
0263) is hard rather than tidy.

**Not rebaselined:** `sim/tests/forecast_parity.cjs` (this REQ adds no geometry — expect 18/18
unchanged, per REQ-0256 §12.2's reasoning), `sim/s4_thresholds.json` (hand-authored design intent —
REQ-0256 §13.3), and `docs/user_managed/*` (forbidden).

**Out:**

- **The enemy roster widening** (`instanceId`/`at`/`fieldCells`/`masked`) — **REQ-0261 §8.2 owns it.**
  This REQ hard-depends on it (§4.3) and does not duplicate it.
- **Rays, trails, impacts, the glow budget, the nova** — REQ-0262.
- **Real skill art / a `skill` art kind** — REQ-0265. §8.3 ships the placeholder.
- **`skill` on `ray_fire`** — REQ-0262 §9.3 / REQ-0264.
- **Widening `computeArtUrls` for gimics** — REQ-0259 (§8.5).
- **Amending G7** (§5.2) — the user's, and it has art-pipeline consequences.
- **Fixing `dto.ts:201`'s `[w,h]` transpose comment** (§4.2) — a Dex-side doc bug; reported.
- **Fixing `terminology_unit_squad.md`'s stale `bp.linker` citation** (§2.1) — reported.
- **Fixing REQ-0129's in-file `Status:` line** (§5.1) — a board-policy issue; reported.
- **The goldens' blindness to the charge engine** (§5.5) — belongs to REQ-0256/0257's rebaseline.
- **`docs/user_managed/*`** — forbidden, and nothing here needs it.

## 11. Gates

**E2E ports (rule: `5000 + REQ*10 + index`): `7630` static / `7631` api / `7632` proxy.** Reserved by
the numbering rule and machine-enforced by `tools/check_e2e_ports.cjs`. **Per ruling Q2
(「e2eを通す必要はない」) E2E is NOT a gate for this program, so no harness is built and the decade is
left unused** — the same posture REQ-0261 §13 takes with 7610-7612 and REQ-0262 §14 with 7620-7622.

Gates that DO apply:

1. **The Unit anchor is `bp.unit.off`.** A grep gate: `client/src/expedition/` contains **zero**
   `.linker`. Pins §2.1 against the stale doc a reader may follow. Positive test: a BP whose
   `unit.off` is non-zero draws its bar under the **Unit's** cell, not the BP's origin.
2. **The HP bar clears the charge ring.** At `EXP_CELL=40`, assert `barTop >= unitCentre.y + 15` —
   i.e. it clears `RING_RADIUS*0.5`, **not** `coreRadius`. The 13-vs-15 confusion is the bug this
   gate exists for (§4.1).
3. **No `footprint` is read for geometry.** Grep gate over `client/src/expedition/`: geometry comes
   from `fieldCells` / `computeFootprintCells` only. Plus a **non-square** fixture (`[4,3]`) whose bar
   spans **3** columns and sits under row **4** — a square fixture proves nothing (REQ-0188 G4's
   lesson).
4. **The cooldown ramp is exactly linear across a status change.** Apply Chill mid-cooldown; assert
   `remainingTicks` still equals `cooldownTicks - (t - t_arm)/TICK_SECS`. **This is the gate that
   protects §6.4's entire derivation** and it fails loudly if REQ-0256 re-rolls an armed cooldown.
5. **Badges fit their footprint.** For **every** live enemy and gimic:
   `N * (EXP_BADGE_D + EXP_BADGE_GAP) - EXP_BADGE_GAP <= footprint[0] * EXP_CELL`. Passes today
   (worst: `rime_shaman` 38 <= 40). **Must fail** on a synthetic 1x1-with-3-skills fixture — pin the
   failing case explicitly (§8.2).
6. **N=0 draws nothing.** A gimic with no skills (`chest_frostbound_cache`) renders **zero** badges —
   not an empty circle.
7. **The ring/wedge hides cleanly when absent.** A BP with no `charge` block draws nothing and costs
   nothing: `chargeRingArc(null) === null` (already pinned by `check_unit_icon.mjs:123`; assert the
   expedition path honours it).
8. **The charge control is a pure function of the clock** for `every_secs` triggers: given one
   `unit_charge_arm`, the control's value at `t` is identical called in any order, at any speed, and
   under backward scrub (§5.4). Mirrors REQ-0262 §14.2.
9. **No per-tick stream exists.** An event-count gate on a full golden-A replay: the run's total event
   count must stay within REQ-0257 §10.2's stated ~3.75× envelope **plus O(spends) + O(gains)**, and
   must **not** scale with tick count. **This is the gate that catches anyone "fixing" §5.4 or §6.4 by
   just streaming the value** — the failure this REQ exists to prevent (§6.3: ~300,000 events).
10. **Enemy bars track the nova.** Given a `ray_hit_all` carrying `hp_after` (§4.4), an enemy's bar
    moves on the nova. **Fails today** — the field does not exist — and is the acceptance test for the
    §4.4 hand-off.
11. **Reduced motion constructs no flash** (§9): with `prefers-reduced-motion: reduce`, assert no
    flash/transition object is created; bars and overlays still render.
12. `BoardRenderer` output is **byte-identical** after §10.4's comment-only edit.
13. `pnpm exec tsc --noEmit` + lint.
14. **`node sim/tests/goldens.cjs` green at 12 cases, REBASELINED per §10.1**, with `def_sha256`
    unmoved on all 9 dungen cases and **every `events` count unmoved** (§10.1 step 3). Without the
    rebaseline this gate — and `tools/ci.sh` step [2/7] (`ci.sh:107`), which runs it — **cannot pass**,
    because this REQ adds fields to `ray_fire`.
15. **`node server/tests/api_test.cjs` (the determinism gate) green**, per REQ-0256 §13.2: nothing to
    regenerate — it re-simulates and deep-equals, so both sides move together. **If it goes red, that
    is a REAL determinism break, not a baseline artifact.** Do not "fix" it by rebaselining.

## 12. Acceptance criteria

1. Every player BP shows an HP bar **under its Unit icon** (anchored at `bp.unit.off`), clearing the
   charge ring, using REQ-0240's `hp-full/mid/low` thresholds (§4.1).
2. Every unmasked enemy/gimic shows an HP bar **under its cell shape**, spanning the shape's width,
   derived from `fieldCells` (§4.2). A **masked** instance shows **no** bar until discovery (§4.6).
3. **Enemy HP bars move on the nova**, not only on direct hits (§4.4) — the 72.2% of damage that is
   currently invisible.
4. An item on cooldown shows a clockwise translucent-black wedge masked to its **footprint**, exact
   against the sim clock at 0.5/1/2/4× and under backward scrub, driven by **two fields on
   `ray_fire`** and **zero new per-tick events** (§6.4).
5. A Unit with charge shows the §5.2-ruled control filling clockwise from 12 o'clock; a Unit with no
   `charge` block shows **nothing** (§5.4).
6. A **passive** fire flashes and shows **no** cooldown wedge; a **cadence** fire flashes **and**
   shows one — distinguished by `cause`, never by a client-side def lookup (§7.1).
7. `hrimgrimnir` (3 skills, `[3,3]`) shows **3** badges; `rime_shaman` (2 skills, `[1,1]`) shows **2**
   without overlapping or spilling; `chest_frostbound_cache` (0 skills) shows **none** (§8.2).
8. Each badge carries its verb rune, a clockwise wedge, and lights its frame on fire. Swapping
   `skillGlyph.ts` for a stub changes every icon with **no** change to `ExpeditionHudLayer` — the
   REQ-0265 seam proven by exercise (§8.3).
9. The whole HUD renders against the **files backend** (empty `art_urls`) without throwing (§8.5).
10. **The user has ruled on: §5.2 (G7's ring vs the user's 背景 wedge), §4.5 (enemy `hpMax` — real vs
    `hp[1]`), §8.3 (six new runes entering the symbol set), and §7.2 (「光る」 rendered as a non-glowing
    brighten).** Implementation does not start before then.
11. REQ-0261's **server-side** roster widening has landed (§4.3). Without `instanceId`, criterion 2 is
    undeliverable and this REQ stops.

## 13. Corrections to the brief, the task framing, and the source

| claim | reality | evidence |
|---|---|---|
| task: *"the Unit sits at `bp.linker.off`"* | **`bp.unit.off`.** The `linker` model is **retired** and `server/tests/api/workshop.cjs:61` **asserts `rolled.linker === undefined`**. | §2.1 |
| `terminology_unit_squad.md`: *"`mock-src/engine.js:92` `unitCell(bp)` dereferences `bp.linker` unconditionally"* | **Wrong twice**: line **103**, and `bp.unit`. **The BP:Unit LAW still holds** (`gacha.cjs:208` stamps `unit:{id,off}` unconditionally) — only its cited evidence rotted under the rename. | §2.1 |
| task: *"NO live unit carries a `charge` block today"* | **FALSE — 42 of 54 do** (measured). The claim traces to `compile.cjs:142-144`'s stale comment. **The real story is better AND worse:** production passes `unitDefsById` (`runs.cjs:83-91`) so charge is **LIVE**; the goldens don't (`goldens.cjs:63`) so charge is **invisible to all 12 determinism goldens**. | §5.5 |
| task: *"`unit_charge.cjs`'s guard: `troopBps.filter(b => b && b.charge)`"* | The guard is at **`sim/lib/encounter.cjs:40`**, not in `unit_charge.cjs`. | §3, §5.5 |
| `chargeRing.ts:12-30`: *"THERE IS NO CHARGE DATA IN THIS CODEBASE … sim/ has no per-unit charge"* | **True 2026-07-12, false since REQ-0200 (merged).** `sim/lib/unit_charge.cjs` is a per-unit charge runtime; 42 live units carry charge blocks. | §5.1 |
| `chargeRing.ts:28-30`: *"REQ-0129 supplies the real value"* | **Mis-assigned.** REQ-0129 is in **`done/`** and `:986` still passes `null`. It shipped the *vocabulary* (v13's charge block); the *data source* is **REQ-0200**. | §5.1 |
| `chargeRing.ts:28-30`: *"changes ONE argument … this module needs no edit"* | **TRUE — verified, for a ring.** radius/width are already params; `chargeRingArc` is pure/total; `null` hides cleanly. **Conditional on §5.2**: if the wedge wins, the arc math survives verbatim and the *draw* does not. | §5.1, §5.2 |
| task: *"G7 says RING — reconcile: is a ring fill the same thing the user is asking for?"* | **No.** Annulus stroke vs filled sector; outside-the-disc vs behind-the-art; arc vs area. Reconcilable (a wedge **behind** the icon preserves G4), **but G7 as written does not survive it**. The user's own (k)+(l) are one idiom; **G7 is the outlier**. | §5.2 |
| REQ-0240 M3: *"charge events are not slot-attributable without more plumbing"* | **Half right.** The events **do** carry a BP id (`unit_charge_encounter.cjs:169`), so attribution is derivable. **The real gap M3 does not name: no event carries the COUNTER** — every emission is discrete. A ring cannot be drawn from spend-only telemetry. | §5.3 |
| task: *"enemies today carry 1-2 [skills]"* | **N ∈ [0, 3].** Live max is **3** (`hrimgrimnir`); **2 of 4 live gimics carry 0**. A layout assuming 2 clips a boss and draws a phantom badge on a chest. | §8.2 |
| spec (l): *"passives included"* | **No live monster skill is a passive** — all **81** are `every_secs`. The branch ships unexercised. Passives are real on the **player** side, which is (k)'s problem, not (l)'s. | §8.4 |
| **`shared/dto.ts:201`** (NEW finding): *"`footprint` is **[w,h]** in cells"* on `ApiMonsterEntry` (enemy/1) | **Transposed.** The convention is `[fh, fw]` (`content_validate.cjs:472-479`; REQ-0188's schema table) — and **`dto.ts:229` documents the same field correctly** for `ApiGimicEntry`. One file, one field, two conventions, in the **shared DTO**. A second instance of the bug REQ-0261 §8.5 found in `MonsterCatalog.tsx`. | §4.2 |
| **`ray_hit_all` / `ray_aoe` carry no `hp_after`** (NEW finding) | Unnamed by REQ-0240, REQ-0257 and REQ-0261. **An `hp_after`-driven HP bar is blind to 72.2% of all ray damage.** Fix: one field on existing array members, ~34 numbers per run. | §4.4 |
| REQ-0257 vs REQ-0240 Deviation 3 | **REQ-0257 does NOT fix `dst` -> roster resolution.** It adds `ray` (a **ray** id), not an **instance** id; it does not touch `maskLabel`; and `#N` cannot be stripped because three `ice_archer`s share one roster `id`. **REQ-0261 §8.2's `instanceId` is the fix.** | §4.3 |
| `REQ-0129`'s header: `**Status:** todo` while filed in `done/` | Violates PROJECT.md's *"a REQ's status IS its folder. Nothing else records REQ status."* | §5.1 |
