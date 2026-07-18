# Expedition Monitor — full redefinition brief (2026-07-18)

Source: user directive 2026-07-18 (verbatim spec items a–l), plus four ratified answers
to the orchestrator's conflict questions (same session). The user declared the CURRENT
combat/monitor code "false" (偽) and re-specified the system at detailed-design level.

This brief is the RECONCILED spec: the user's a–l cross-checked against the internal
specs and the source tree, with every contradiction resolved. REQ-0255..0265 expand
from this file. It is llm_managed scratch, NOT golden — the REQs are the deliverable.

## 0. Ratified answers (user, 2026-07-18) — binding

| # | question | RULING |
|---|---|---|
| Q1 | is the 0.01s tick + ray flight the authoritative sim, or presentation only? | **シムを全面tick化** — the server sim is rewritten to a 0.01s tick loop. Ray flight is PHYSICAL and changes combat results. Goldens / determinism gate / forecast parity / S4 baselines all rebaseline. |
| Q2 | base branch? | **影響があるモノを全てマージして、それをmasterとして新規。e2eを通す必要はない。** — merge the impacted built branches into master first, branch new work from that. E2E is NOT a gate for this program. |
| Q3 | full-screen geometry? | **横長の画面 → 横並び、縦長の画面 → 縦並び.** Orientation-responsive. |
| Q4 | monster/gimic unification? | **Battle側の設定でどのmodeかで、有効な動詞を制限する実装をする。** — mode-gating moves ONTO the Battle object and restricts which VERBS are effective. |

## 1. Terminology reconciliation (do not skip)

The user wrote "プレイヤーのUnit(または内部名称BP)". Against docs/llm_managed/terminology_unit_squad.md
this is WELL-FORMED, not an error, because of the **BP:Unit law** (REQ-0165, source-verified):
**a BP and a Unit are 1:1; every BP carries exactly one Unit; a BP with no Unit cannot exist.**

Therefore:
- **IBattleInstance (player side) == one BP** (which necessarily carries exactly one Unit).
  Its HP is the BP's HP (VX-1 `hpMax`). Its skills are the flattened POs + SIs + the Unit's own effects.
- **IBattleInstance (enemy side) == one monster entity OR one gimic entity.**
- "Unitの下にHPバー" (spec j) = under the Unit ICON, which sits at the BP's `linker.off` cell.
- A **Squad** is NOT an IBattleInstance. A Squad is an 8x8 canvas box holding many BPs.
  Squads have no HP (backpack_battle_spec: "a squad itself has no HP").
- "squads の formation" (spec a/d) = the 4 Squad canvases placed on the player plane.

## 2. What the user's spec CONFIRMS in existing canon (no change needed)

- **26x18 field** — matches `sim/lib/field.cjs` FIELD_COLS=26 / FIELD_ROWS=18 and
  backpack_battle_spec `bounds: A1:Z18`. NO CHANGE.
- **Two planes, one per side** — matches combat_spec §2.1 ("TWO independent A1:Z18 planes").
  The user names this `IBattleInstancesFormationMap`. NO GEOMETRY CHANGE, only a new interface name.
- **padding 1 where rays are born** — matches `shared/content_validate.cjs` PLACEABLE =
  {colMin:2,rowMin:2,colMax:25,rowMax:17} = **B2:Y17 = 24x16**, a user ruling of 2026-07-15
  (REQ-0184 port note: "the user ruled 2026-07-15 that 24x16/B2:Y17 is canon and the
  margin-riding was a bug"). The user's (f) EXTENDS that same rule to the player plane.
  Note 24x16 == exactly 3x2 boxes of 8x8 — the formation grid is exact.
- **Rays enter from an edge cell** — combat_spec §2.2 entry cells are row1/row18/colA/colZ =
  precisely the padding ring. Consistent.
- **monsters == HP + flat skill list** — combat_spec ruling 3 / `content/live/dungeon/enemies.json`
  (`hp`,`footprint`,`skills[]`). The user's "平坦化したスキルを持つモンスターと同じ構造" is
  literally the shape enemies already have. The player side must be flattened TO IT.
- **asymmetric-combat golden is NOT violated.** game_golden §4 says "enemies do NOT have
  backpack systems". The user's (b) makes the INTERFACE symmetric, not the CONTENT: enemies
  still have no canvas/BP/socket/link — they are born flat. Players are compiled flat.
  Same interface, different provenance. This is combat_spec ruling 3 restated.

## 3. Conflicts found, and their resolutions

### C1 — tick vs event queue (RESOLVED: full tick rewrite, Q1)
combat_spec §1.1 states verbatim: "Combat is **not ticked**. It is a single **priority event
queue** keyed on an absolute `t` in **seconds (float64)**." and "Binding inputs honored: ...
seconds with decimal [lo,hi] ranges, **no ticks**". The user's (c) mandates a 0.01s tick.
=> **combat_spec §1.1/§1.4/§1.5 are SUPERSEDED.** `sim/lib/heap.cjs` (EventHeap) is retired.
Blast radius (measured, not guessed): `sim/tests/goldens.cjs` (12 replay goldens),
the api determinism gate, `sim/tests/forecast_parity.cjs` (18/18), `sim/s4_baselines`,
`sim/s4_matrices`, `sim/s4_thresholds.json`, `server/services/seals.cjs` (sealed-seed
`clearTimeSecs`). ALL rebaseline. This is sanctioned by Q1.

### C2 — ray flight time (RESOLVED: physical, Q1)
Today `sim/lib/ray.cjs walkRay()` resolves the ENTIRE ray inside one event at one `t`:
entry -> bounces -> hits -> splash, all simultaneous. Flight is decoration added later by
`MonitorRenderer.ts` (STEP_ANIM_MS=200/segment) and by REQ-0240's pacing (rayStep
perCellMs 90). The user's (c)/(g) make the ray a LIVE ENTITY: 1 diagonal per 4 ticks (0.04s).
=> **combat results change.** A ray fired at an instance that dies before arrival now flies
through empty space (destroyed occupants are already "passable" per combat_spec §2.2) and
hits whatever it next touches, or bounces on. Kill-stealing and over-kill waste become real.
The user's freeze rule ("IBattleRayは発火時のスキル参照から作られ、そのあとのユニットやスキルの変化を
影響を受けず、そこで状態が凍結して、飛来します") means the ray's DAMAGE/verbs/pen/aoe snapshot at
fire time; the FIELD it traverses is live. Both halves are load-bearing — implement exactly.

### C3 — formation4 violates the padding rule (RESOLVED: it is a BUG; fix it)
`sim/lib/formation.cjs` FORMATIONS.formation4.unit4 = **'J11:Q18'** — occupies **row 18**,
which is padding under (f) and outside PLACEABLE (B2:Y17). It is the ONLY violator; the
other 15 boxes are inside B2:Y17. History: the retired formation.xlsx carried J11:Q19 (row 19,
outside the field), combat_spec §5.2 "corrected" it to J11:Q18 — a fix that cured the
out-of-bounds but NOT the margin overrun, and predates the 2026-07-15 24x16 ruling.
=> **formation4.unit4 becomes 'J10:Q17'.** Rationale: (a) it is the only 8x8 box in column
band J..Q that is inside B2:Y17 and below the R2:Y9/B2:I9/J2:Q9 front row; (b) it restores
the exact 3x2-of-8x8 tiling of B2:Y17; (c) it preserves formation4's stated intent
("wings absorb; backline well protected") — the backline stays centered under center_top.
This changes formation4 runs. Sanctioned under Q1's rebaseline.
=> Add a load-time assert: every formation box is 8x8 AND inside PLACEABLE. The existing
validator (`validateFormationBoxes`) checks 8x8 only — that half-check is exactly why this
survived. Same lesson as PROJECT.md's "a gate that watches one half of a rule watches none of it."

### C4 — REQ-0240 presentation pacing vs physical ray time (RESOLVED: pacing does not govern #/expedition)
REQ-0240 (built, unmerged) added `shared/pacing.json` + `server/services/pacing.cjs`:
每event gets a presentation time `pt`, same-target hits coalesce, and the WHOLE run is
clamped/stretched into [45s, 300s], with a 2500ms deliberate live lag. Under (g) the ray's
timing is PHYSICS (0.04s/diagonal), so a presentation layer that stretches the timeline
would desynchronise the ray from its own hits.
=> **#/expedition plays the sim clock 1:1 (realtime, tick-accurate).** The pacing layer stays
alive ONLY for the legacy small monitor on #/schedule. `pacingVersion` remains on the wire;
the expedition view ignores `pt` and reads `t`. No deletion of pacing.cjs in this program.

### C5 — display size does not fit (RESOLVED: orientation + fit-scale, Q3)
Backpacks board is `client/src/board/geom.ts` **CELL = 80**. Spec (d) says half => **CELL 40**.
One plane = 26*40 x 18*40 = **1040 x 720**. Two planes stacked = 1040 x 1440(+gap) — taller
than any 1080p viewport. Side-by-side = 2080+gap x 720 — wider than 1920.
=> Per Q3: **the LOGICAL size is fixed at CELL=40 (1040x720 per plane)**, the ORIENTATION is
chosen from the viewport aspect (landscape -> side-by-side, portrait -> stacked), and the
composed stage is then **uniform fit-scaled** (letterbox) into the viewport. No scrolling.
At 1920x1080 landscape: 2080+32 gap = 2112 wide -> scale ~0.909 -> effective cell ~36.4px.
`MonitorRenderer.setLayout('row'|'column')` (REQ-0240) is the existing seam for the flip.
The "1/2" of spec (d) is therefore preserved as the LOGICAL definition; fit-scale is a
viewport transform on top, never a re-authoring of geometry.

### C6 — Battle-level mode gating vs REQ-0049 mode purity (RESOLVED per Q4)
REQ-0049 (layered encounters) resolves battle + up to 2 attachments IN PARALLEL on one field
with "mode-pure transparency" (a ray interacts only with occupants of its own mode).
combat_spec OQ12/MODE-6 gate at the PO level (`modes:[...]` on the PO/skill).
Q4 relocates the gate: **the Battle carries the mode configuration and it restricts which
VERBS are effective.** Interpretation adopted (flagged as an interpretation, vetoable):
- `Battle` holds `modeConfig: { activeModes: Mode[], verbGate: (mode, verb) -> bool }`.
- An IBattleInstance carries its own `mode` (battle | detection | unlock).
- A skill fire resolves its verbs against a touched instance IFF the Battle's modeConfig
  permits (ray.mode, verb.t) against that instance's mode.
- This PRESERVES parallel layering (activeModes may hold >1 mode simultaneously) and
  PRESERVES OQ12 (a `strike` verb from a battle-mode ray is not effective on an unlock-mode
  chest), while moving the policy from scattered per-PO checks to ONE Battle-owned table.
- monster_pack `members[]` may now reference **gimic ids as well as enemy ids**; both compile
  to IBattleInstance. `shared/content_validate.cjs validateMonsterPackEntry` widens.

## 4. The interface model (normative — implement these names)

```
Battle
  playerMap : IBattleInstancesFormationMap   // spec b
  enemyMap  : IBattleInstancesFormationMap
  modeConfig: BattleModeConfig               // spec Q4
  tick()                                     // spec c: called every TICK_SECS
IBattleInstancesFormationMap                 // 26x18, padding ring 1, placeable B2:Y17
  instances : IBattleInstance[]
  rays      : IBattleRay[]                   // rays in flight ON THIS map (spec c: a ray is
                                             //   fired ONTO the opposing map, so it lives there)
  tick()                                     // spec c: forwards tick to instances, then advances rays
IBattleInstance
  fieldCells : [row,col][]                   // footprint on its own map
  hp, hpMax                                  // spec j
  mode       : 'battle'|'detection'|'unlock'
  cooldownSkills : Map<int, {skill: IBattleInstanceSkill, remainingTicks: int}>   // spec c
  tick()      // decrement each remainingTicks by 1; on reaching 0 -> fire, then RESET
              //   ("数値を戻します") to a freshly rolled cooldown from the skill def
IBattleInstanceSkill    // flattened: a monster's Skill, a PO's effect, an SI's effect, a Unit's effect
  cooldownTicks() : int // rolled per occurrence from every_secs [lo,hi] / TICK_SECS
  attackProfile, verbs, modes
IBattleRay              // spec c/g: FROZEN snapshot, live flight
  frozen  : { verbs, attackProfile, pen, aoe, bounceBudget, mult basis, ownerRef }
  cell, dir, bounces, passed
  advance()  // 1 diagonal per RAY_TICKS_PER_DIAGONAL ticks
```

**Constants (new TUNABLES in `sim/lib/core.cjs`):**
- `TICK_SECS = 0.01` (spec c, "仮に0.01秒tickだとして" — TUNABLE, the sim must not hardcode 100)
- `RAY_TICKS_PER_DIAGONAL = 4` (spec g, 0.04s per diagonal = 25 diagonal-steps/sec)
- Existing `RAY_STEP_BUDGET = 512` is retained as the DoS guard, now counted in diagonals.

**Cooldown reset semantics.** `every_secs.s = [lo,hi]` stays the authoring unit (seconds,
float). At each fire the next cooldown is rolled from the SAME sub-stream name the event
queue used (`effectStreamName`) and converted: `ticks = max(1, round(secs / TICK_SECS))`.
Chill/Haste `cadenceMultiplier()` applies to the ROLLED SECONDS before conversion, so the
status system's meaning is unchanged. Rounding to >=1 tick is what makes the tick model
total; document it as the one quantization seam.

## 5. Merge baseline (REQ-0255) — measured

master = `f918a65`. Impacted built-but-unmerged branches, with ancestry MEASURED (not assumed):
- `req-0211-gimic-content-kind` (+10) — gimic content kind; art kind gimic == monster.
- `req-0185-dungeon-content-kind` (+19) — dungeon as pre-generated content. Its own docs/REQ
  copy is `built/`; master still shows it in `draft/` (master is simply behind).
- `req-0239-sortie-squad-board` (+24) — sortie page + squad board. Contains 0185+0211 built.
- `req-0240-monitor-redesign-pacing` (+24) — the CURRENT Battle Monitor the user wants a
  全画面 button on. Contains 0211; contains 0185's built state as of `ce78af5` but the
  `req-0185` BRANCH has since advanced, so 0185 must be merged EXPLICITLY, not assumed.
Order: 0211 -> 0185 -> 0239 -> 0240. E2E is NOT a gate (Q2). REQ-0211/0185 carry DB ENUM
migrations + a live backfill that are DEPLOY steps — merging does not run them; the REQ must
say so out loud rather than let a deploy surprise the user.

## 6. UI decomposition (spec d–l) — anchors

- Route `#/expedition` — `client/src/store/core.ts` `Route` union + `VALID_ROUTES` both widen
  (they are two separate lists in one file; changing one is a bug).
  NOTE a naming collision worth knowing: the mock `web/redesign/expedition.html` is the
  SCHEDULE screen redesign (遠征の間 = rooms + small monitor), NOT this full-screen battle view.
  The user's directive names the ROUTE `#/expedition` explicitly; the mock keeps its filename.
- 全画面 button: on the REQ-0240 monitor header (`client/src/schedule/monitor/MonitorHeader.tsx`).
  The existing small monitor is otherwise UNTOUCHED ("今ある画面は放置して").
- Player plane render (d): reuse the Backpacks board composition at CELL=40. The board is
  `client/src/board/BoardRenderer.ts` + `geom.ts` (CELL=80, PAD=38) + `render/itemCard.ts`
  (`computeFootprintCells`) + `board/sprites.ts` (sprite_all_v11.svg symbols -> Pixi textures)
  + `board/unitIcon.ts`. UNIT_CORE_RADIUS=26 halves to 13.
- Padding ring (f): drawn in a distinct colour, and NO instance may occupy it — enforced by
  the validator, not only by the renderer.
- Ray VFX (g,h,i): trail + 25 diagonal-steps/sec, interpolated smoothly when the display
  allows (rAF, not a 25Hz gate). Impact highlights BOTH the struck cell AND the struck
  instance's cell SHAPE (h). One ray line + one hit effect for now, but behind a swappable
  seam (i) -> art REQ-0264.
- HP bars (j): under the Unit icon for a BP; under the cell shape for a monster/gimic.
- Cooldowns (k): item = translucent-black overlay ON the item; Unit = clockwise background
  charge. `client/src/board/chargeRing.ts` ALREADY implements the clockwise ring
  (REQ-0125a golden G7: RING_RADIUS=30, RING_WIDTH=3, RING_START_ANGLE=-PI/2, clockwise) and
  every production call site passes `null` because no charge data reached the client.
  REQ-0200 (unit-charge-engine, MERGED) is the data source; REQ-0240 recorded the gap
  verbatim: "M3 (charge ticks) — feature-flagged OFF cleanly ... charge events are not
  slot-attributable without more plumbing". REQ-0263 closes exactly that gap.
  Passive-trigger items must also flash on fire (k, l).
- Monster skill charge (l): a circle + skill icon, clockwise translucent-black charge, laid
  out top-right of the drawn art, one per skill, passives included. Skill icons DO NOT EXIST —
  art kinds today are `['po','si','unit','monster','bpskin','custom']`
  (`server/services/art_sizing.cjs` KINDS) (+`gimic` after REQ-0255's merge). -> art REQ-0265.
- Visual language: `web/redesign/styleguide.html` §6 (MJÖLNIR). Binding rules from §6.0:
  glow is rationed to FOUR moments — focus / legendary+ manifestation / live link beam /
  **the instant of a hit**; outer glow blur <= 8px, one colour per element, <= 3 simultaneous
  glow sources per screen; transitions 120–180ms ease-out; `prefers-reduced-motion` short-circuits
  CSS to 0.001s and JS effects must not even be CONSTRUCTED. §6.4's `RayMonitor(canvas, log)`
  in `web/redesign/assets/fx.js` is the ratified reference implementation of the dual 26x18
  ray playback (bounce sparks, hit flash, 5th-bounce nova) — port its LOOK, not its code
  (it is a scripted mock with hardcoded packs and no real data).

## 7. REQ map

| REQ | slug | depends on |
|---|---|---|
| 0255 | expedition-merge-baseline | — |
| 0256 | battle-tick-core | 0255 |
| 0257 | ray-flight-entity | 0256 |
| 0258 | formation-map-padding | 0255 |
| 0259 | battle-mode-verb-gating | 0256, 0258 |
| 0260 | expedition-fullscreen-route | 0255 |
| 0261 | expedition-formation-render | 0260, 0258 |
| 0262 | expedition-ray-vfx | 0261, 0257 |
| 0263 | expedition-instance-hud | 0261 |
| 0264 | art-ray-hit-vfx-kind | 0262 |
| 0265 | art-monster-skill-icons | 0263 |

0256 and 0257 are deliberately SEPARATE despite sharing one rewrite: each moves the goldens,
and splitting them keeps the two causes bisectable (tick quantization vs ray flight). One
combined REQ would land a single unreadable golden diff — the same reasoning REQ-0184's port
note gives for not re-composing packs during a port.
