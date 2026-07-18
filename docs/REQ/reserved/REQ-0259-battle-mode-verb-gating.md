# REQ-0259 — battle-mode-verb-gating: the Battle owns the mode policy, and it gates VERBS

**Status:** draft — spec written, BLOCKED on user review. **This REQ rests on an INTERPRETATION of
ruling Q4 (§3), and the interpretation is the thing to review.** Q4 is one sentence; §3 lists the
four readings it admits, adopts one, and shows what the other three cost. If the user meant a
different one, §3 is where to say so — the rest of the REQ follows from that choice. Two further
gates: (1) §9 asks the user about `docs/user_managed/game_golden.md` §4, which an LLM may not edit;
(2) §7 widens a live content schema.
**Reserved:** 2026-07-18
**Slug:** battle-mode-verb-gating
**Branch:** req-expedition-spec (spec only)
**Requested by:** user, 2026-07-18 — ruling Q4.
**Depends on:** REQ-0256 (battle-tick-core) — declares `IBattleInstance.mode` (its §8.3) and the
flat `cooldownSkills` this gates. REQ-0258 (formation-map-padding) — `IBattleInstancesFormationMap`.
REQ-0255 (expedition-merge-baseline) — **hard**, because gimic (REQ-0211) is built-but-unmerged and
§7 references its schema.
**Blocks:** nothing in this program.
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q4, §3 C6, §4.

## 1. Goal

Move mode-gating OFF the PO and ONTO the Battle, and make it gate **verbs**:

1. `Battle.modeConfig = { activeModes: Mode[], verbGate: (mode, verb) -> bool }`.
2. Each `IBattleInstance` carries its own `mode`.
3. A verb is effective on a touched instance **IFF** the Battle's `modeConfig` permits
   `(ray.mode, verb.t)` against that instance's `mode`.
4. `monster_pack members[]` widens to accept **gimic ids** as well as enemy ids; both compile to
   `IBattleInstance`.

## 2. The ruling

Q4, verbatim:

> **Battle側の設定でどのmodeかで、有効な動詞を制限する実装をする。**

("Implement it so that the configuration on the Battle side restricts which verbs are effective,
according to which mode it is.")

Three things the sentence fixes beyond doubt:

- **`Battle側の設定`** — the configuration lives on the **Battle**. Not on the PO, not on the skill.
  This is a RELOCATION and it is unambiguous.
- **`有効な動詞を制限する`** — what is restricted is **verbs** (`動詞`), and the predicate is
  **effectiveness** (`有効`), not firing. A gated verb is INERT, not unscheduled.
- **`どのmodeかで`** — the restriction is keyed on **which mode it is**.

**What the sentence does NOT fix: WHOSE mode `どのmode` refers to.** That is §3.

## 3. The INTERPRETATION — flagged, and vetoable

**This is an orchestrator interpretation of Q4, not a user ruling. The user may veto it.** Per
combat_spec's own convention, this is a `[LOCKED]` default: orchestrator-decided, user may veto
async. It is called out at the top of the file rather than buried because everything below depends
on it.

`どのmodeかで` has a genuinely ambiguous referent. Four readings:

### Reading A — (ray.mode, verb) vs instance.mode — **ADOPTED**

The Battle holds a policy table. A verb carried by a ray of mode `M` is effective on an instance of
mode `N` iff `verbGate(M, verb.t)` permits it against `N`.

```
Battle.modeConfig = {
  activeModes: Mode[],                        // which modes are live in THIS battle
  verbGate: (rayMode, verb, targetMode) -> bool
}
```

**Why adopted: it is the only reading under which BOTH REQ-0049 and OQ12 stay true**, and it is the
only one that is a strict generalisation of the other three (§3.5).

### Reading B — `どのmode` = the BATTLE's single mode

The Battle has one mode; the gate says which verbs are effective in it. Essentially today's MODE-6
lifted onto the Battle object.

**REJECTED — it kills REQ-0049.** REQ-0049 (done, live) resolves battle + up to 2 attachments **in
parallel on one field and one clock**. A Battle with ONE mode cannot express "a battle pack and an
unlock chest, simultaneously". Brief §4 says `activeModes: Mode[]` — a LIST — which is itself
evidence the user does not mean B. Adopting B would silently delete a shipped feature.

### Reading C — `どのmode` = the TOUCHED INSTANCE's mode only

The Battle maps `instance.mode -> allowed verbs`, ignoring the ray's mode. An unlock chest accepts
only unlock verbs, whoever fires.

**REJECTED as the SPEC, but note it is REPRESENTABLE within A** (a `verbGate` that ignores its
first argument IS C). It preserves OQ12 and even most of mode-purity. It is rejected only because
it cannot express "a battle ray and a detection ray behave differently against the same instance" —
a distinction REQ-0049's transparency rule relies on today, and which costs nothing to keep. **If
the user prefers C's simplicity, it is a one-line change to the gate, not a redesign.** That is the
strongest reason to adopt A: A can become C; C cannot become A.

### Reading D — `どのmode` = the FIRING instance's mode

An instance's own mode decides which of ITS verbs are live.

**REJECTED — it misreads `有効`.** "Effective" is a property of a verb landing ON a target, not of
an instance being allowed to act. D is also already covered: which skills an instance FIRES is
`cooldownSkills` + `activeModes` (§5.2), not a verb gate.

### 3.5 Why A subsumes the rest

| reading | gate signature | expressible in A? |
|---|---|---|
| A | `(rayMode, verb, targetMode)` | — |
| B | `(battleMode, verb)` | yes — `activeModes` of length 1 + ignore `targetMode` |
| C | `(verb, targetMode)` | yes — ignore `rayMode` |
| D | `(firerMode, verb)` | not a target gate at all; belongs to §5.2 |

A is the general form. Adopting it costs one extra parameter and buys the ability to be corrected
into B or C **without another interface change** — which matters, because this interface is
consumed by REQ-0256's `IBattleInstance` and is expensive to move twice.

**Ask the user this, precisely:** *"A battle-mode ray and a detection-mode ray touch the same
chest. Should they be able to behave differently?"* Yes → A. No → C. Only one mode ever live at
once → B (and REQ-0049 must be reopened).

## 4. Verified current state — mode-gating today is scattered across 8 sites

Q4 says the policy moves onto the Battle. Here is what it moves FROM. **Grepped `modes` across
`sim/lib/encounter.cjs`; this is every site:**

| line | code | what it gates |
|---|---|---|
| `:163` | `modes: po.def.modes \|\| ['battle']` | stamps each schedulable with its PO's modes |
| `:430-431` | `const modes = eff.modes \|\| (po.def && po.def.modes) \|\| ['battle'];`<br>`if (!modes.includes(encounterDef.mode)) return;` | REQ-0048 pulse payloads |
| `:520-521` | `const attActive = hasAtt && s.modes.some(m => (m === 'detection' && …) \|\| (m === 'unlock' && …));`<br>`if (s.modes.includes(encounterDef.mode) \|\| attActive) { scheduleEffect(…) }` | **initial scheduling** — the MODE-6 "pause, do not accumulate" rule |
| `:553-554` | `const modes = eff.modes \|\| (po.def && po.def.modes) \|\| ['battle'];`<br>`if (!modes.includes(encounterDef.mode)) continue;` | REQ-0048 battle_start pulse openers |
| `:595` | `if (s.modes.includes(encounterDef.mode) && … verb.t === 'pulse')` | pulse fire |
| `:601` | `} else if (s.modes.includes(encounterDef.mode)) {` | **the main ray fire** |
| `:663` | `} else if (hasAtt && s.modes.includes('detection')) { resolveDetection(s, ev.t); }` | REQ-0049 detection |
| `:665` | `} else if (hasAtt && s.modes.includes('unlock')) { resolveUnlock(s, ev.t); }` | REQ-0049 unlock |

Plus `sim/lib/skills.cjs:309-311`:

```js
function effectModesOf(effect, ownerModes) {
  return effect.modes || ownerModes || ['battle'];
}
```

— exported, and **never called from anywhere in the sim** (grepped). A helper that names the rule
and that no gating site uses; all 8 sites re-implement the `||` chain by hand. **That is the
scattering Q4 ends, and it is worth stating as the JUSTIFICATION for the ruling rather than
treating Q4 as arbitrary:** the same three-term fallback is written out eight times, one of them
subtly different (`:163` omits the `eff.modes` term), with a helper sitting unused. This is
PROJECT.md's "a gate that watches one half of a rule watches none of it" in a different costume.

**Other verified facts:**

| fact | source | evidence |
|---|---|---|
| `modes` is a ratified CLOSED vocabulary | `content/vocab.json` | `"modes": ["battle", "detection", "unlock"]` — top-level key, alongside `po_tags`/`socket_tags` |
| 31 verbs exist | `content/vocab.json` `verbs` | `strike, multi_strike, block, heal_bp, apply_status, add_on_hit_status, amp_status, buff_host, buff_self_per_tag, buff_adjacent, cleanse, reflect_damage, lifesteal, haste, slow_enemy, bonus_vs_blocked, status_immune, bonus_vs_status, pulse, buff_linked, buff_self, damage_reduction, grant_charge, advance_cooldown, fire_items, grant_shield, grant_lifesteal, heal_ally, charge_strike, transfer_status, shield_break` |
| the encounter has ONE mode today | `sim/lib/encounter.cjs` (8 sites) | every gate compares against the scalar `encounterDef.mode` |
| attachments are the parallel-mode carrier | `sim/lib/encounter.cjs:279-334` | `encounterDef.attachments[]`, `ATTACH_CAP = 2` |
| `members[]` accepts ONLY enemy ids | `shared/content_validate.cjs:505` | `if (typeof m.enemy !== 'string' \|\| !m.enemy) throw new Error(mctx + ': enemy (monster id) is required');` |
| …and resolves footprint from enemy defs | `shared/content_validate.cjs:509-512` | `const def = enemyDefs[m.enemy]; if (!def) throw new Error(mctx + ': names monster "' + m.enemy + '", which has no live def');` |

## 5. `Battle.modeConfig`

### 5.1 The shape

```js
// sim/lib/mode_gate.cjs -- REQ-0259. THE mode policy. One table, one place.
// Replaces the eight hand-written `modes.includes(encounterDef.mode)` checks
// listed in REQ-0259 s4. Q4: "Battle側の設定でどのmodeかで、有効な動詞を制限する".
const MODES = ['battle', 'detection', 'unlock'];   // == content/vocab.json `modes`, pinned by a test

function makeModeConfig(activeModes) {
  return {
    activeModes,                      // Mode[] -- may hold >1 (REQ-0049 parallel layering)
    verbGate(rayMode, verb, targetMode) { ... },   // s5.3
  };
}
```

`Battle` (per brief §4) carries `modeConfig: BattleModeConfig` alongside `playerMap` / `enemyMap`.

### 5.2 `activeModes` — and what it does NOT do

`activeModes` is derived at battle construction:

```
activeModes = [encounterDef.mode]
              ∪ { att.mode for att in encounterDef.attachments }   // REQ-0049
```

For today's content this yields `['battle']` for a plain pack, and `['battle','detection']` or
`['battle','unlock']` for a layered encounter — **exactly what `encounter.cjs:520`'s `attActive`
expression computes today, by hand, inline.** `activeModes` is that expression, named and hoisted.

**`activeModes` gates SCHEDULING, not effectiveness.** An instance's `cooldownSkills` slot is live
iff its skill's `modes` intersect `activeModes`. That preserves **MODE-6** verbatim:

> mode filtering: only POs whose `modes` include the encounter mode fire; the rest idle, their
> `every_secs` **pauses (does not accumulate)**

Under REQ-0256's model this is even more literal than today: a slot outside `activeModes` simply
**gets no `remainingTicks`** — there is no timer to accumulate. `encounter.cjs:524-525`'s comment
already describes this as the intent (*"non-matching effects: simply never scheduled while this
encounter is active (no timer exists to backlog)"*); the tick model makes it structural rather than
incidental.

**The two gates are different questions and must not be merged:**

| gate | question | answer |
|---|---|---|
| `activeModes` | may this instance's skill FIRE at all in this battle? | scheduling (§5.2) |
| `verbGate` | is this verb EFFECTIVE on the thing the ray touched? | effectiveness (§5.3) |

Q4 is about the SECOND. The first already exists and is only being tidied.

### 5.3 `verbGate` — the policy table

```js
verbGate(rayMode, verb, targetMode) -> bool
```

The v1 table, which reproduces today's behaviour exactly:

| rayMode | targetMode | verbs permitted | source |
|---|---|---|---|
| `battle` | `battle` | **ALL** | combat_spec §6.1: battle is the full §2-3 system |
| `battle` | `detection` | **NONE** | OQ12 — no bruteforce; REQ-0049 mode-purity ("battle rays ignore ?/chest/door") |
| `battle` | `unlock` | **NONE** | OQ12 — "a battle weapon cannot pick the lock" |
| `detection` | `detection` | **the hit itself** — damage irrelevant | combat_spec §6.1: "a hit = DISCOVERY"; §2.2: "a hit is a *find*, not damage" |
| `detection` | `battle` | **NONE** | REQ-0049: "detection/unlock rays pass through live enemies harmlessly (no damage, no penetration cost, no stop)" |
| `detection` | `unlock` | **NONE** | the door chain is two STAGES, not cross-mode (MODE-2) |
| `unlock` | `unlock` | **damage verbs** (`strike`, `multi_strike`) | combat_spec §6.1: "Hits deal damage; reduce HP to 0 before timeout = victory" |
| `unlock` | `battle` | **NONE** | REQ-0049 transparency |
| `unlock` | `detection` | **NONE** | ditto |

**Read the diagonal.** The table is: same-mode → permitted; cross-mode → inert. That IS mode-purity
(§6), expressed once as data instead of eight times as control flow.

**The `detection` row is the one with real content**, and it is why the gate takes a VERB and not
just a mode pair: in detection mode a `strike` verb's DAMAGE is not effective but the TOUCH is —
the hit is the find. `ray.cjs:74` implements this today (`if (mode === 'detection' && hitResult.isDiscovery) return …`) and `skills.cjs:236,242,251,261` implement the damage suppression
(`if (mode !== 'detection' && verbEff.verb.t === 'strike')` — the `mode !== 'detection'` guard
appears **four times** in `splashFn` alone). **Those four inline guards are exactly what `verbGate`
replaces.**

### 5.4 Where the gate is CALLED

**One place: the hit boundary.** `sim/lib/skills.cjs` `dealHitOnField` — the single chokepoint every
hit already flows through (`skills.cjs:216, 222`, and `splashFn`'s per-verb guards at `:236-276`).

```js
// before applying any verb to `occ`:
if (!battle.modeConfig.verbGate(ray.frozen.mode, verb, occ.mode)) continue;   // INERT
```

**Inert means: no damage, no status, no penetration cost, no stop.** The ray passes through as if
the cell were empty — which, per REQ-0049's transparency rule and combat_spec §2.2's
"destroyed occupants are passable", is a shape the walk already handles natively (§6.2).

`ray.frozen.mode` is REQ-0257 §7.1's frozen field: **the mode AT FIRE TIME.** A ray's mode cannot
change mid-flight. That is stated in REQ-0257 and depended on here.

## 6. This PRESERVES REQ-0049 and OQ12 — shown, not asserted

### 6.1 Parallel layering survives — `activeModes` may hold >1

REQ-0049's design (`docs/REQ/done/REQ-0049-layered-encounters.md:42-49`), verbatim:

> ### Mode-pure ray transparency — [LOCKED, vetoable]
> A ray interacts ONLY with occupants matching its own mode:
> - battle rays ignore "?"/chest/door entities (pass through; cannot break a chest);
> - detection/unlock rays pass through live enemies harmlessly (no damage, no penetration cost, no
>   stop).
> Rationale: dense packs must not shield traps (frustration), weapons must not bruteforce locks
> (OQ12), and cross-mode interference would make ray outcomes illegible. Boundary reflection &
> bounce budgets unchanged per mode (§2.2).

**Every clause maps onto §5.3's table:**

| REQ-0049 clause | §5.3 row |
|---|---|
| "battle rays ignore ?/chest/door (pass through; cannot break a chest)" | `(battle, detection) → NONE`, `(battle, unlock) → NONE` |
| "detection/unlock rays pass through live enemies harmlessly" | `(detection, battle) → NONE`, `(unlock, battle) → NONE` |
| "no damage, no penetration cost, no stop" | §5.4's "inert" — all three |
| "Boundary reflection & bounce budgets unchanged per mode" | **untouched** — the gate is at the HIT boundary; reflection is geometry (REQ-0257 §9) |
| "A ray interacts ONLY with occupants matching its own mode" | **the diagonal of the table** |

**`activeModes: Mode[]` is what keeps the parallel half alive.** A layered encounter carries
`['battle','detection']`; battle instances and the "?" instance are BOTH on the field, BOTH
ticking, and their rays pass through each other. That is REQ-0049's design, unchanged, now
expressed as one table instead of `encounter.cjs:520`'s inline `attActive` disjunction plus the
`:663/:665` else-if chain.

### 6.2 The `(battle, unlock)` case is already free

REQ-0049's implementation note (`encounter.cjs:279-284`) says mode-purity is currently achieved
**structurally**, verbatim:

> Mode-pure by construction: attachment POs (detection/unlock) resolve ONLY against attachments;
> battle rays only ever target enemies -> neither can touch the other's occupants.

I.e. today purity holds because the two never share a `targetActors` list — `resolveDetection`/
`resolveUnlock` (`:354-385`) don't fire rays at all; they short-circuit to the attachment directly
and **synthesise** `ray_fire`/`ray_hit` events (`:359, :378-379`).

**This REQ makes purity EXPLICIT rather than emergent, and that is a real strengthening.** Once
gimics compile to `IBattleInstance` and stand on the same map as monsters (§7), the structural
guarantee EVAPORATES — a battle ray's `liveOccupantFn` will now find a chest in its path. **The
`verbGate` is what keeps OQ12 true at that moment.** Without this REQ, §7's unification would
silently let a sword break a chest.

That is the dependency in one sentence: **§7 removes the accident that was enforcing OQ12; §5
replaces it with a rule.** Do not land §7 without §5.

### 6.3 OQ12 survives — the concrete case

combat_spec **[LOCKED OQ12]**, verbatim:

> discovery/unlock is **strictly mode-gated** — combat (`battle`) weapons do NOT contribute to
> trap/door detection or chest unlocking (no bruteforce).

**Test it against §5.3:** a battle-mode `strike` from a sword touches an unlock-mode chest.
`verbGate('battle', {t:'strike'}, 'unlock')` → row `(battle, unlock)` → **NONE** → inert → the ray
passes through, the chest takes nothing. **OQ12 holds.** This is §16.3's acceptance test verbatim.

## 7. Monster/gimic unification

### 7.1 The dependency

**gimic is REQ-0211 (built, UNMERGED).** REQ-0255 merges it (`req-0211-gimic-content-kind`, +10
commits off merge-base `cc575e2`). This REQ depends on that merge and must not be started before it.
Read from the branch (`git show req-0211-gimic-content-kind:docs/REQ/built/REQ-0211-gimic-content-kind.md`),
the `gimic/1` schema:

| field | value |
|---|---|
| `id` | stable id, e.g. `trap_frost_deadfall` |
| `behavior` | **the discriminator**: `trap` \| `treasure` \| `hidden_door` |
| `type` | engine subtype: `trap` \| `door_stage1` \| `door_stage2` \| `chest` |
| **`mode`** | **`detection` (a trap/hidden thing is FOUND) \| `unlock` (a chest/door is OPENED)** |
| `footprint` | `[fh, fw]` — "the transpose convention the sim/pack board use" |
| `hp` | 1 for detection traps/doors; the real race HP for chest/door-stage2 |
| `masked` | shows as `"?"` in the replay until discovered |
| `timeout_secs` | the interaction clock |
| `skills` | skill ids the gimic fires |

with `GIMIC_BEHAVIOR_MODES = {trap:[detection], treasure:[unlock], hidden_door:[detection,unlock]}`
enforced by its validator.

**The gimic schema ALREADY CARRIES `mode`.** This is the single most important fact in §7:
`IBattleInstance.mode` (REQ-0256 §8.3) is not a new authoring burden — it reads straight off the
gimic def. And REQ-0211 already enforces `behavior → allowed modes`, so a "trap that is an unlock"
is unrepresentable before this REQ ever sees it. **The unification is cheaper than the brief
implies**, and the reason is that REQ-0211 designed for it without knowing.

`IBattleInstance.mode` resolves as:

| instance source | `mode` |
|---|---|
| a BP (player) | `'battle'` — the only mode a BP is ever in |
| an enemy (`enemies.json`) | `'battle'` — enemy defs carry no `mode` field; default |
| a gimic (`gimics.json`) | **`def.mode`** — verbatim |

### 7.2 `members[]` widens

`content/live/dungeon/packs.json` today (verified, live):

```json
{ "id": "pack_frost_scouts", "name": "Frost Scouts",
  "members": [ { "enemy": "frost_gnoll", "at": "B2" }, { "enemy": "ice_archer", "at": "C2" } ] }
```

**Widen with an ALTERNATIVE key, not a redefined one:**

```json
"members": [
  { "enemy": "frost_gnoll",         "at": "B2" },
  { "gimic": "trap_frost_deadfall", "at": "M9" }
]
```

**Exactly one of `enemy` | `gimic` is required per member; they are mutually exclusive.**

**Why a second key and not a widened `enemy` key:** `enemy: "trap_frost_deadfall"` would be a lie in
the data, and `content/live/dungeon/packs.json`'s port_note is explicit that these layouts are a
**PORT, not a rebalance** — every existing member keeps its `enemy` key BYTE-IDENTICALLY, so the 12
goldens cannot move from the schema change alone (§8). A discriminated key is also what makes the
validator's error messages nameable (`members[3] ("trap_frost_deadfall")…`), which is the shape
`validateMonsterPackEntry` already uses at `:507, :511, :520, :529`.

### 7.3 `validateMonsterPackEntry` widens

`shared/content_validate.cjs:490`. Signature:

```js
function validateMonsterPackEntry(pack, enemyDefs)              // today
function validateMonsterPackEntry(pack, enemyDefs, gimicDefs)   // after
```

The one required change, at `:505-512`:

```js
// today
if (typeof m.enemy !== 'string' || !m.enemy) throw new Error(mctx + ': enemy (monster id) is required');
...
if (enemyDefs) {
  const def = enemyDefs[m.enemy];
  if (!def) throw new Error(mctx + ': names monster "' + m.enemy + '", which has no live def');
  if (def.footprint !== undefined) footprint = def.footprint;
}

// after: exactly one of enemy|gimic; resolve footprint from the matching registry
const hasEnemy = typeof m.enemy === 'string' && m.enemy;
const hasGimic = typeof m.gimic === 'string' && m.gimic;
if (hasEnemy === hasGimic) {
  throw new Error(mctx + ': exactly one of enemy (monster id) or gimic (gimic id) is required');
}
const memberId = hasEnemy ? m.enemy : m.gimic;
const defs = hasEnemy ? enemyDefs : gimicDefs;
if (defs) {
  const def = defs[memberId];
  if (!def) throw new Error(mctx + ': names ' + (hasEnemy ? 'monster' : 'gimic') + ' "' + memberId + '", which has no live def');
  if (def.footprint !== undefined) footprint = def.footprint;
}
```

Everything else in the function — the `PLACEABLE` bounds check (`:519-524`), the overlap detection
via `claimed` (`:526-533`), `parseA1`/`cellsFor` — **is id-agnostic and unchanged.** A gimic gets
the ring check and the overlap check for free, which is correct: a chest may no more stand on the
margin than a gnoll may.

**`hasEnemy === hasGimic` catches BOTH failure modes in one line** — neither key (both false) and
both keys (both true). Write it that way rather than as two separate checks; it is the kind of
symmetry that does not rot.

### 7.4 Gimic-as-member vs REQ-0049 attachment — they COEXIST, and here is why

**This is a gap in the brief and it must be closed before implementation, because two mechanisms
now put a gimic on a field.**

| | REQ-0049 attachment | REQ-0259 pack member |
|---|---|---|
| declared in | `encounterDef.attachments[]`, cap 2 | `monster_pack.members[]` |
| placed by | seeded placement (`encounter.cjs:302-315` `takeCluster`) | **authored** `at` anchor |
| carries | reward, `timeout_secs`, door `stage`, `settled`/`discovered` state | position + footprint only |
| resolved by | `resolveDetection`/`resolveUnlock` (`:354-385`) + end-of-encounter settlement (`:393-399`) | the normal ray/hit path |
| source | `dungen.cjs` attachment rolls | hand-authored packs |

**Ruling: they coexist. This REQ does NOT unify them.** An attachment is a *run-integration
record* — it owns rewards, shortcuts and timeout outcomes that reach `runDungeon`
(`:789` returns `attachmentRewards`, `doorShortcut`). A gimic pack member is *a thing standing on
the field*. Both compile to an `IBattleInstance`; only the attachment additionally carries run
state.

Rationale for not unifying here: folding REQ-0049's reward/timeout/stage machinery into
`members[]` is a run-integration redesign with its own user-facing consequences (what does a
hand-authored chest in a pack DROP?). It has no mandate in Q4, which is about verb gating.
**Same doctrine as REQ-0184's port note and REQ-0258 §10: a fix is not a rebalance, and mixing
them makes the diff unreadable.** Flag it as a follow-up REQ.

**But note the consequence honestly:** after this REQ a gimic can reach the field by two paths with
different capabilities, which is a wart. It is a smaller wart than an unmandated redesign, and it
is written down here rather than discovered later.

## 8. Blast radius — MEASURED

Measured on `req-expedition-spec` @ `f918a65` at spec time.

| gate | command | measured NOW | after this REQ |
|---|---|---|---|
| sim unit tests | `node sim/tests/run.cjs` | **117 passed, 0 failed** | green + NEW gate tests (§16) |
| sim replay goldens | `node sim/tests/goldens.cjs` | **`goldens OK (12 cases)`** | **UNMOVED** — §8.1 |
| forecast parity | `node sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** | **UNMOVED** — no geometry change |
| S4 post-processor | `node sim/tests/s4_test.cjs` | **14 passed, 0 failed** | green |
| REQ-0203 / 0207 / 0219 rosters | (three commands) | **15 / 13 / 13, 0 failed** | green |
| REQ-0200 charge | `node sim/tests/unit_charge_test.cjs` | **13 passed, 0 failed** | green |
| REQ-0200 charge fusion | `node sim/tests/unit_charge_encounter_test.cjs` | **23 passed, 0 failed** | green |
| content check | `shared/content_validate.cjs` consumers | — | **NEW cases** — §8.2 |

### 8.1 The goldens do NOT move — and that is a claim, so here is the argument

**Expected: `goldens OK (12 cases)`, byte-identical.** Three independent reasons:

1. **§5.3's table reproduces today's behaviour exactly.** Every row is transcribed from a rule the
   sim already implements (the four `mode !== 'detection'` guards in `splashFn`, `ray.cjs:74`'s
   discovery short-circuit, the 8 `modes.includes` sites). Same decisions, one location.
2. **No golden exercises a gimic.** `goldens.cjs:63` `baseOpts` fixes `formationId: 'formation1'`
   and the batch-002 corpus; the 12 cases are `batch002/golden-{A,B,C}`,
   `dungen/default/L{1,3,5,8}/dg-{11,22}`, `dungen/test_fixed`. **§7's `members[]` widening is
   purely additive** — every existing member keeps its `enemy` key byte-identically (§7.2), so
   `def_sha256` cannot move either.
3. **REQ-0211 already proved this exact claim.** Its own note, verbatim: *"`gimics.json` produces a
   byte-identical dungen def — **the 12 replay goldens are UNMOVED** (proven, `goldens.cjs` green)"*.

**If the goldens DO move, this REQ has changed behaviour it did not intend to.** Do not rebaseline —
debug. That is the strongest available proof that a relocation is a relocation. (Note: landing after
REQ-0256/0257 means the goldens have ALREADY moved twice; the claim here is that THIS REQ adds no
further movement on top of its own base.)

### 8.2 Content validation

`validateMonsterPackEntry` is *"the ONE definition, shared by the machine check and the sim"*
(`shared/content_validate.cjs:542`). Widening it touches every caller. New test cases required:

- a member with `gimic` and a valid def → passes, footprint from the gimic def
- a member with BOTH `enemy` and `gimic` → throws `exactly one of…`
- a member with NEITHER → throws `exactly one of…`
- a gimic member outside `PLACEABLE` (B2:Y17) → throws `outside the placeable area` (inherited free)
- a gimic member overlapping an enemy member → throws `overlaps members[...]` (inherited free)
- **every existing pack still validates unchanged** — the regression net for §8.1's claim

### 8.3 CONTENT_ROOT — inherited

REQ-0255 §7.1 / REQ-0256 §12.3. Post-merge, the split invocation is mandatory, and it bites this
REQ specifically: **`gimics.json` is one of the two files whose absence causes the 13 phantom
ENOENT failures.**

```
CONTENT_ROOT=$PWD/content node sim/tests/run.cjs    # and forecast_parity, s4_test, roster tests
node sim/tests/goldens.cjs                          # NO CONTENT_ROOT -- it pins its own roster
```

## 9. `game_golden.md` §4 — the argument, verified, and where it does NOT hold

The brief (§2) claims:

> **asymmetric-combat golden is NOT violated.** game_golden §4 says "enemies do NOT have backpack
> systems". The user's (b) makes the INTERFACE symmetric, not the CONTENT: enemies still have no
> canvas/BP/socket/link — they are born flat. Players are compiled flat. Same interface, different
> provenance. This is combat_spec ruling 3 restated.

**Verdict: the argument HOLDS for the clause it quotes, and the brief quotes only half the golden.**
`docs/user_managed/game_golden.md:44-45`, verbatim — **both** sentences:

> - **Asymmetric combat [DECIDED, review round 2]:** enemies do **NOT** have backpack
>   systems. Only players hold canvases; enemies run bespoke stat/behavior algorithms.

### 9.1 First clause — HOLDS, and stays holding

*"enemies do NOT have backpack systems. Only players hold canvases"* — **TRUE today and TRUE after
this program.** Verified: enemies are compiled by `sim/lib/packs.cjs compileEnemyPack` from
`enemies.json` (`hp`, `footprint`, `skills[]`); they have no canvas, no BP, no socket, no link, no
`linkEdges`. REQ-0256's flattening compiles the PLAYER side TO the enemy's shape; it does not give
the enemy a backpack. **Different provenance, same interface** — the brief is exactly right here,
and this is the clause that carries the design intent (P1 "Fit is power" is a PLAYER pillar; giving
enemies canvases would gut it).

### 9.2 Second clause — ALREADY FALSE, before this program touched anything

*"enemies run bespoke stat/behavior algorithms"* — **NOT TRUE TODAY.** The brief does not mention
this clause at all. Verified against the source:

- `combat_spec §4.1` (ruling 3), verbatim: *"A **skill** is an effect (or effect bundle) authored in
  the **same content pipeline, effect-AST, and closed vocab** as player POs … Both go through S1–S8
  (content_pipeline.md) unchanged."*
- `combat_spec §3.5`, verbatim: *"The identical `walk` runs for player→enemy (on the enemy field)
  and enemy→player (on the player field). The only difference is which plane's occupancy map is
  consulted."*
- The code agrees: `sim/lib/skills.cjs fireSkillRay` is called for player fires
  (`encounter.cjs:611`) and enemy fires (`encounter.cjs:691`) with the **same** function, the same
  `walkRay`, the same `dealHitOnField`, the same status system.

**There is no bespoke enemy algorithm. There has not been one since combat_spec v0.2 (2026-07-05),
which is LATER than game_golden v2 (ratified 2026-07-02) and which the user ratified.** So the
clause was superseded by a subsequent user ruling and the doc was never updated.

### 9.3 What this REQ does about it: ASK. Do not edit.

PROJECT.md: *"`docs/user_managed` = golden, user-verified (do NOT edit)"*. `game_golden.md`'s own
first line: **"LLM MAY NOT EDIT THIS FILE BUT ONLY THE USER"**. So this REQ may not touch it.

**This REQ does not CAUSE the drift** — it is three weeks old and already live. But it makes it
maximally visible: after §7, a monster and a gimic and a BP are all `IBattleInstance`, gated by one
table, fired by one loop. A reader of §4 would conclude enemies run something bespoke, and they do
not.

**Requested amendment, exact line, so the user can do it in one pass:**

| line | today | requested |
|---|---|---|
| **45** | `  systems. Only players hold canvases; enemies run bespoke stat/behavior algorithms.` | keep the first sentence VERBATIM (it is the load-bearing one, §9.1). Replace the second clause: `Only players hold canvases; enemies are born as flat HP + skill lists and run the SAME combat pipeline as players (combat_spec ruling 3, 2026-07-05). The asymmetry is in the CONTENT (who has a backpack), not in the ENGINE.` |

**This is a documentation correction, not a design change**, and the user may equally rule the
opposite: that the golden is right and combat_spec ruling 3 overreached. That would be a much
larger finding — it would reopen ruling 3, the enemy schema (VX-2), and this whole program's §7.
**Which is exactly why it goes to the user as a question rather than being quietly assumed away.**
Unlike REQ-0258 §7.2's `backpack_battle_spec.md` amendment, this one is **not a hard blocker**: the
code is already this way, so the REQ can ship against a stale doc. It should not, but it can.

## 10. Scope

**In:**
1. `sim/lib/mode_gate.cjs` — NEW. `makeModeConfig`, `activeModes`, `verbGate` (§5). `MODES` pinned against `content/vocab.json`.
2. `sim/lib/encounter.cjs` — the 8 scattered `modes.includes(...)` sites (§4) collapse to `activeModes` (scheduling) + `verbGate` (effectiveness). `:520`'s inline `attActive` becomes §5.2's derivation.
3. `sim/lib/skills.cjs` — `verbGate` called at the `dealHitOnField` hit boundary (§5.4); `splashFn`'s four `mode !== 'detection'` guards (`:236, :242, :251, :261`) replaced by it; the unused `effectModesOf` (`:309-311`) **deleted**.
4. `sim/lib/compile.cjs` / `sim/lib/packs.cjs` — `IBattleInstance.mode` populated per §7.1.
5. `shared/content_validate.cjs` — `validateMonsterPackEntry` widened (§7.3).
6. `content/live/dungeon/packs.json` — **NO data change.** Schema widens; data is untouched (§7.2, §8.1).
7. `sim/tests/run.cjs` — the §16 gate tests; the §8.2 validator cases.
8. `docs/llm_managed/combat_spec_draft.md` — §6.1/§6.2/MODE-6/OQ12 amended to say the gate lives on the Battle; **the RULES are unchanged** (§6).
9. An ASK to the user for `docs/user_managed/game_golden.md:45` (§9.3).

**Out:**
- **Unifying REQ-0049 attachments with pack members** (§7.4). Follow-up.
- **Changing any mode RULE.** §5.3 transcribes; it does not legislate. If a row is wrong, that is a user decision, not this REQ's.
- **Editing `docs/user_managed/*`.** Forbidden (§9.3).
- **The tick loop / `cooldownSkills`** — REQ-0256. **Ray flight / `ray.frozen.mode`** — REQ-0257.
- **Gimic ART / Dex** — REQ-0211, already built.
- **Re-authoring packs to USE gimic members.** The schema widens; using it is content work with its own ratification. Same doctrine as REQ-0184's port note.
- **An e2e harness.** Not a gate for this program (Q2). Decade **7590 / 7591 / 7592** (`5000 + 259*10 + {0,1,2}`) is reserved-by-numbering and left unused.

## 11. Acceptance criteria

1. **`grep -rn "modes.includes" sim/` returns ZERO hits.** All 8 sites (§4) route through `mode_gate.cjs`. `effectModesOf` is deleted.
2. `sim/lib/mode_gate.cjs` `MODES` is pinned equal to `content/vocab.json` `modes` by a test — the closed vocabulary has one source.
3. **OQ12, as a test:** a battle-mode `strike` on an unlock-mode chest is INERT — no damage, no status, **no penetration cost, no stop** (all four, §5.4). The chest's HP is unchanged and the ray continues (§6.3).
4. **REQ-0049 transparency, as a test:** a detection-mode ray passes through a live battle-mode enemy with no damage/pen/stop, and still discovers the "?" behind it. This is the case §6.2 says stops being structural and starts being a rule.
5. **Parallel layering, as a test:** a battle + detection layered encounter has `activeModes.length === 2`, both instance sets tick, and neither's rays affect the other's occupants.
6. **MODE-6, as a test:** a PO whose `modes` exclude every `activeModes` entry gets NO `cooldownSkills` timer — proven by asserting the slot is ABSENT, not merely never fired (§5.2). It cannot accumulate a backlog because it has no counter.
7. `validateMonsterPackEntry` accepts `{gimic, at}`, rejects both-keys and neither-key with the `exactly one of…` message, and applies the `PLACEABLE` + overlap checks to gimic members (§8.2).
8. Every existing `packs.json` entry validates **unchanged**.
9. **`sim/tests/goldens.cjs` byte-identical — 12 cases, UNMOVED** on this REQ's own base (§8.1). If it moves, do NOT rebaseline; debug.
10. `sim/tests/forecast_parity.cjs` 18/0, unmoved. `sim/tests/run.cjs` green.
11. A gimic instance's `mode` is read from `def.mode`; an enemy's defaults to `'battle'`; a BP's is `'battle'` (§7.1). Asserted for all three.
12. §3's interpretation has been PUT TO THE USER and either ratified or replaced. **This REQ does not ship on an unreviewed interpretation of a one-sentence ruling.**
13. The §9.3 `game_golden.md` question has been asked and answered (amend, or rule that combat_spec ruling 3 overreached — which reopens §7).
