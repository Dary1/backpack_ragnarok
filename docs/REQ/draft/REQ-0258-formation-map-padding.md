# REQ-0258 — formation-map-padding: one 26x18 abstraction, a padding ring on BOTH planes, and formation4 fixed

**Status:** draft — spec written, BLOCKED on user review. Two things need the user before work
may start: (1) the `docs/user_managed/backpack_battle_spec.md` amendment in §7, which an LLM may
NOT make itself; (2) confirmation that formation4's box may move (it is sanctioned by ruling Q1,
but it is a live gameplay change and §8 shows it is NOT covered by any existing golden).
**Reserved:** 2026-07-18
**Slug:** formation-map-padding
**Branch:** req-expedition-spec (spec only)
**Requested by:** user, 2026-07-18 — spec item (b) (`IBattleInstancesFormationMap`) and item (f)
(the padding-1 ring on the player plane), reconciled in the brief §2 / §3 C3 / §4.
**Depends on:** REQ-0255 (expedition-merge-baseline) — branch from the merged baseline, not from
today's master.
**Blocks:** REQ-0259 (battle-mode-verb-gating), REQ-0261 (expedition-formation-render).
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §2, §3 C3, §4.
**Inherits:** the user's 2026-07-15 24x16/B2:Y17 ruling (REQ-0184).

## 1. Goal

Three things, in one REQ because they are one fact:

1. Make `IBattleInstancesFormationMap` the SHARED 26x18 abstraction used by BOTH planes (player
   and enemy), instead of the enemy plane having a validator-enforced placeable area and the
   player plane having nothing.
2. Enforce the padding-1 ring on **both** planes. Today it is enforced on the enemy plane only.
3. Fix `formation4.unit4`, the single box that violates the ring — `J11:Q18` -> `J10:Q17`.

## 2. The inherited ruling — quoted, not paraphrased

The placeable area is not a new decision. `content/live/dungeon/packs.json` carries the user's
2026-07-15 ruling in its `port_note`, verbatim (verified by reading the file):

> These layouts are the PORT of the pre-REQ-0184 placement, not a rebalance. `compileEnemyPack()`
> used to fill from the box origin left-to-right, and `encounter.cjs` handed it the WHOLE A1:Z18
> plane — so every pack stood on the margin (frost_gnoll at A1, etc). **The user ruled 2026-07-15
> that 24x16/B2:Y17 is canon and the margin-riding was a bug.** The fix is a pure origin shift
> A1 -> B2 …

and its `note`:

> The placeable area is B2:Y17 (24x16) inside the 26x18 field — see the port note below.

The user's 2026-07-18 item (f) EXTENDS that same rule to the player plane. That is the whole
mandate: one rule, both planes.

## 3. Verified current state (I read every one of these)

| fact | source | evidence |
|---|---|---|
| field is 26x18 | `sim/lib/field.cjs:7` | `const FIELD_ROWS = 18, FIELD_COLS = 26;` |
| placeable is B2:Y17 = 24x16 | `shared/content_validate.cjs:436-437` | `const FIELD_COLS = 26, FIELD_ROWS = 18;` / `const PLACEABLE = { colMin: 2, rowMin: 2, colMax: FIELD_COLS - 1, rowMax: FIELD_ROWS - 1 };` |
| enemy plane IS ring-enforced | `shared/content_validate.cjs:519-522` | inside `validateMonsterPackEntry`, every derived cell is bounds-checked against `PLACEABLE` and throws `outside the placeable area` |
| player plane is NOT ring-enforced | `sim/lib/formation.cjs:52-64` | `validateFormationBoxes` checks **8x8 only** |
| formation4.unit4 = `J11:Q18` | `sim/lib/formation.cjs:45` | `unit4: 'J11:Q18', // backline_center` |
| formations.json says the same | `content/live/dungeon/formations.json` | `"unit4": "J11:Q18"` |

### 3.1 The C3 finding, verified box by box — every one of the 16

Computed by loading the real `FORMATIONS` table and testing each box against the real
`PLACEABLE` (not by eye):

| box | value | cols | rows | 8x8? | inside B2:Y17? |
|---|---|---|---|---|---|
| formation1.unit1 | `F2:M9` | F-M | 2-9 | OK | yes |
| formation1.unit2 | `N2:U9` | N-U | 2-9 | OK | yes |
| formation1.unit3 | `B10:I17` | B-I | 10-17 | OK | yes |
| formation1.unit4 | `R10:Y17` | R-Y | 10-17 | OK | yes |
| formation2.unit1 | `J2:Q9` | J-Q | 2-9 | OK | yes |
| formation2.unit2 | `B6:I13` | B-I | 6-13 | OK | yes |
| formation2.unit3 | `R6:Y13` | R-Y | 6-13 | OK | yes |
| formation2.unit4 | `J10:Q17` | J-Q | 10-17 | OK | yes |
| formation3.unit1 | `B2:I9` | B-I | 2-9 | OK | yes |
| formation3.unit2 | `R2:Y9` | R-Y | 2-9 | OK | yes |
| formation3.unit3 | `F10:M17` | F-M | 10-17 | OK | yes |
| formation3.unit4 | `N10:U17` | N-U | 10-17 | OK | yes |
| formation4.unit1 | `B2:I9` | B-I | 2-9 | OK | yes |
| formation4.unit2 | `J2:Q9` | J-Q | 2-9 | OK | yes |
| formation4.unit3 | `R2:Y9` | R-Y | 2-9 | OK | yes |
| **formation4.unit4** | **`J11:Q18`** | J-Q | **11-18** | OK | **NO — row 18 is the margin** |

**Result: 16 boxes, 16 pass 8x8, exactly 1 violates PLACEABLE.** The brief's C3 is CONFIRMED:
`formation4.unit4` is the only violator across all 16.

Note what the table shows about the existing gate: **all 16 boxes are 8x8, including the broken
one.** An 8x8-only check cannot see this bug — it is not a shape error, it is a POSITION error.

## 4. The fix: `J11:Q18` -> `J10:Q17`

Rationale (the brief's three parts, each checked against the table above):

- **(a) It is the only legal placement.** The box must stay 8x8, stay in the J..Q column band
  (it is `backline_center`, under `center_top` = `J2:Q9`), and sit below the front row. Inside
  B2:Y17 the only 8-row band below rows 2-9 is rows **10-17**. `J10:Q17` is forced, not chosen.
- **(b) It restores the exact 3x2 tiling.** B2:Y17 is 24x16 = exactly 3 columns of 8 (B-I, J-Q,
  R-Y) x 2 rows of 8 (2-9, 10-17). Fixed formation4 = `B2:I9` + `J2:Q9` + `R2:Y9` + `J10:Q17` —
  four of the six tiles, exactly on the grid. Verified: no overlap with `unit2` (`J2:Q9` is rows
  2-9; `J10:Q17` is rows 10-17).
- **(c) It preserves formation4's stated intent.** `docs/user_managed/backpack_battle_spec.md`
  describes formation4 as "wings (left/right) absorb most damage; center-top frontline only
  handles top-center fire; backline is well protected". Moving the backline up one row keeps it
  centered under `center_top` and still behind the wings. The intent is unchanged; only the
  illegal row is given up.

`J10:Q17` is already proven legal in practice — `formation2.unit4` is that exact box today and
passes every gate.

## 5. Consumers that MUST move in lockstep

Found by grepping `J11:Q18` across the whole tree (excluding `node_modules`, `web/app/assets`,
`.git`). This is the COMPLETE list; there are no others.

### 5.1 Code — must change

| file:line | today | becomes |
|---|---|---|
| `sim/lib/formation.cjs:45` | `unit4: 'J11:Q18', // backline_center` | `unit4: 'J10:Q17', // backline_center` |
| `sim/lib/formation.cjs:39-40` | the `note:` string, which asserts `unit4=backline_center=J11:Q18 (8 rows, in-bounds)` | rewrite: `J10:Q17`, and say WHY (in-bounds was never the whole rule — it must also be inside the B2:Y17 placeable ring) |
| `content/live/dungeon/formations.json` | `"unit4": "J11:Q18"` + the entry `note` + the file-level `note` | same box + notes corrected |
| **`sim/tests/run.cjs:1292`** | **`eq(combat.FORMATIONS.formation4.canvases.unit4, 'J11:Q18', 'formation4 unit4 must be the CORRECTED box, not the xlsx J11:Q19 error');`** | pin `'J10:Q17'`, and reword — the old message calls J11:Q18 "the CORRECTED box", which is exactly the belief this REQ retires |
| `sim/tests/run.cjs:1283` | the test NAME: `formation defs: all 4 boxes parse to exactly 8x8, formation4 uses CORRECTED J11:Q18` | rename to the new box |
| `sim/README.md:89` | "formation4 uses the CORRECTED `J11:Q18` box" | correct to `J10:Q17` |

> **`sim/tests/run.cjs:1292` is the one the brief does not mention, and it is the one that fails
> first.** A test hard-pins the broken value. Measured (§8): with the fix applied and nothing
> else touched, this is the ONLY assertion in the entire sim suite that fails. It is not
> collateral damage — it is a gate that was pointed at the wrong constant, and retargeting it is
> part of the fix.

### 5.2 Generated artifacts — rebuild, do not hand-edit

`web/preview/batch-002/index.html:100` and `web/preview/batch-004/index.html:108` embed
formation4's box and note inside generated SVG formation galleries. These are `tools/build_preview`
output. Regenerate them; never hand-edit generated HTML.

### 5.3 `formations.json` vs `sim/lib/formation.cjs` — the mirroring claim, verified

`docs/user_managed/backpack_battle_spec.md:3` declares:

> source: "content/live/dungeon/formations.json (authoritative; **mirrored byte-for-byte by
> sim/lib/formation.cjs**). The original formation.xlsx was RETIRED and deleted 2026-07-14
> (REQ-0166): it carried the stale J11:Q19 box and pre-pivot Unit1-4 labels."

**Verified: the mirroring claim currently HOLDS.** All 16 boxes were compared programmatically,
JSON against the live `FORMATIONS` table: **0 mismatches, 4/4 formations, 16/16 boxes identical.**
So both copies carry `J11:Q18` today, and both must move together or the claim breaks.

Two things to know about this mirror:

- **It is not machine-checked.** Nothing in `sim/tests/` compares `formations.json` to
  `FORMATIONS`. The mirror holds today by hand. Since this REQ edits both sides of an unpinned
  mirror, it must ALSO pin it — see §6.1. (Same lesson as the 8x8 half-check: an unwatched
  invariant is an invariant that eventually is not true.)
- **The two are read by DIFFERENT consumers**, which is why the mirror exists at all:
  `sim/lib/compile.cjs:56` reads the `FORMATIONS` table (`const formation = FORMATIONS[formationId];`)
  to place squads in a real run, while `server/services/core.cjs:52`
  (`const FORMATIONS_PATH = path.join(LIVE_DUNGEON_DIR, 'formations.json');`) serves the JSON to
  the client via `GET /api/schedule/dungeons`. Change one and not the other and the client draws
  a box the sim does not use.
- **`formations.json`'s own file-level note is already stale** on a second point: it says the
  table it mirrors is "sim/combat.cjs's hardcoded FORMATIONS table". That table MOVED to
  `sim/lib/formation.cjs` (REQ-0047 (d), whose header records "Moved VERBATIM from
  sim/combat.cjs"). Fix the path reference while editing the note.

## 6. The strengthened load-time assert

`sim/lib/formation.cjs:52-64`, `validateFormationBoxes`, today:

```js
const w = box.colMax - box.colMin + 1, h = box.rowMax - box.rowMin + 1;
if (w !== 8 || h !== 8) {
  throw new Error('Formation box ' + fid + '.' + squad + ' (' + cv[squad] + ') is ' + w + 'x' + h + ', expected 8x8');
}
```

Its own comment states the intent: "Sanity-check every formation box is exactly 8x8 … fail fast
on any typo." It does exactly that, and nothing more.

**Why this let `J11:Q18` through: `J11:Q18` IS 8x8.** Columns J..Q = 8, rows 11..18 = 8. The box
is the right SHAPE in the wrong PLACE. The validator asks "is it 8x8?" and never "is it inside
the placeable area?", so a box can be perfectly shaped and still sit on the margin where rays are
born. The rule has two halves — SHAPE and POSITION — and the gate watched one.

This is PROJECT.md's own lesson, verbatim:

> **A gate that watches one half of a rule watches none of it.**

PROJECT.md records it about `check_e2e_ports.cjs`, which "only ever read `tools/*_e2e.sh`, so the
rule rotted in the half it could not see". Same shape of failure, different file: the fix that
introduced `J11:Q18` (combat_spec §5.2) cured the out-of-bounds half (row 19 -> row 18) and never
looked at the margin half, because the margin rule did not exist yet — it was ruled on
2026-07-15, a year of commits later. The half-check then FROZE the bug in place: it went green
every run and reported the geometry as validated.

**New assert — both halves, on every box:**

```js
// Every formation box is exactly 8x8 AND lies entirely inside the placeable
// ring B2:Y17. 8x8 alone is not the rule: J11:Q18 was 8x8 and still sat on the
// row-18 margin (REQ-0258). Shape and position are one rule; check both or the
// half you skip is the half that rots.
(function validateFormationBoxes() {
  for (const fid of Object.keys(FORMATIONS)) {
    const cv = FORMATIONS[fid].canvases;
    for (const squad of Object.keys(cv)) {
      const box = parseBox(cv[squad]);
      const w = box.colMax - box.colMin + 1, h = box.rowMax - box.rowMin + 1;
      if (w !== 8 || h !== 8) {
        throw new Error('Formation box ' + fid + '.' + squad + ' (' + cv[squad] +
          ') is ' + w + 'x' + h + ', expected 8x8');
      }
      if (box.colMin < PLACEABLE.colMin || box.colMax > PLACEABLE.colMax ||
          box.rowMin < PLACEABLE.rowMin || box.rowMax > PLACEABLE.rowMax) {
        throw new Error('Formation box ' + fid + '.' + squad + ' (' + cv[squad] +
          ') is outside the placeable area B2:Y17 (the padding ring is 1 cell on ' +
          'every side of the ' + FIELD_COLS + 'x' + FIELD_ROWS + ' field)');
      }
    }
  }
})();
```

It must stay a LOAD-TIME assert (an IIFE at module load), not a test: it is what makes an illegal
formation unrepresentable rather than merely reported.

### 6.1 Pin the mirror

Add to `sim/tests/run.cjs`, next to the existing REQ-0184 parity block: a test that
`content/live/dungeon/formations.json` and `FORMATIONS` agree on all 16 boxes, and that every
JSON box independently satisfies 8x8 + PLACEABLE. This closes §5.3's gap — the mirror that
`backpack_battle_spec.md` asserts becomes machine-checked, so the next person who edits one copy
cannot silently leave the other behind.

## 7. Docs that become WRONG the moment the box moves

Both of these currently assert that `J11:Q18` is the CORRECT value. After this REQ they are not
merely stale — they state the opposite of canon.

### 7.1 `docs/llm_managed/combat_spec_draft.md` — LLM-owned, this REQ edits it

| line | today | action |
|---|---|---|
| 379 | `**Ratified v0.2:** backline_center box **corrected to `J11:Q18`** (8 rows, in-bounds); squad` | rewrite to `J10:Q17`; record that the v0.2 "correction" was itself incomplete — it fixed the row-19 overrun but predates the 2026-07-15 margin ruling |
| 384 | ``R2:Y9`, backline_center `J11:Q18`.`` | -> `J10:Q17` |

> **CORRECTION to the brief.** The brief says §5.1 and §5.2 "both assert the J11:Q18
> 'correction'". Verified: **`J11:Q18` appears ONLY in §5.2** (lines 379 and 384). §5.1's
> formation table (line 375) does not carry the box at all — its formation4 row reads
> `E5 (left wing) | M5 (center-top) | U5 (right wing) | M14 (backline) | **corrected** — see §5.2`,
> i.e. it carries the retired xlsx's anchor MARKER cells and defers to §5.2. So the edit lands in
> §5.2. §5.1 needs only a note that `M14` is a historical anchor label from the deleted
> `formation.xlsx`, not a box definition — the box in §5.2 is authoritative. Do not "fix" M14 to
> M13; the anchors are provenance, not geometry.

Also `docs/llm_managed/user_managed_rename_suggestions.md:133,140,149` repeats `J11:Q18` as the
fixed value. LLM-owned; correct it in the same commit or it becomes a third stale assertion.

### 7.2 `docs/user_managed/backpack_battle_spec.md` — USER-OWNED. **ASK; DO NOT EDIT.**

PROJECT.md: "`docs/user_managed` = golden, user-verified (do NOT edit)". This REQ therefore may
NOT touch this file. It must instead ASK the user to amend it. **Exact lines, so the user can
make the change in one pass:**

| line | today | requested amendment |
|---|---|---|
| **85** | `      unit4: "J11:Q18"  # backline_center` | `      unit4: "J10:Q17"  # backline_center` |
| **87** | `      RESOLVED. The old sheet's backline_center box (J11:Q19) extended to row 19,` | keep as history, but it is now the FIRST of two corrections |
| **89** | `      The ratified fix is J11:Q18. The four boxes now carry an explicit` | `The ratified fix is J10:Q17.` — and note that the earlier J11:Q18 fix cured only the field overrun; J11:Q18 still sat on the row-18 margin, which the 2026-07-15 24x16/B2:Y17 ruling forbids |
| **91** | `      The sim asserts at load time that EVERY formation box is exactly 8x8.` | `The sim asserts at load time that EVERY formation box is exactly 8x8 AND lies entirely inside the placeable area B2:Y17.` |
| **98** | `  - "formation4: the row-18 boundary overrun is fixed (J11:Q18)."` | `  - "formation4: the row-18 MARGIN overrun is fixed (J10:Q17); the earlier J11:Q18 fix addressed only the row-19 field overrun."` |

Lines 3 and 92 also mention `J11:Q19` as the retired xlsx value — those stay correct as history
and need no change. Line 3's "mirrored byte-for-byte by sim/lib/formation.cjs" also stays correct,
because §5.1/§5.3 move both copies together.

**Ordering:** this is a hard dependency, not a courtesy. `backpack_battle_spec.md` is the golden
source and it names `formations.json` as authoritative. If the code moves and the golden doc does
not, the doc becomes the wrongest artifact in the tree while still being the one a human trusts.
Either the user amends it as part of clearing this REQ, or this REQ does not ship.

## 8. Goldens / forecast impact — MEASURED, and the brief overstates it

The brief says the fix "changes formation4 runs. Sanctioned under Q1's rebaseline", and the task
framing asks for "the goldens/forecast impact". **Measured, there is none.** The fix was applied
to `sim/lib/formation.cjs`, the full sim suite run, and the change reverted (tree left clean,
`git status` = 0 modified):

| gate | with `J10:Q17` | why |
|---|---|---|
| `sim/tests/goldens.cjs` | **`goldens OK (12 cases, replay determinism intact)`** — byte-identical | **No golden exercises formation4.** `formationId: 'formation1'` in `goldens.cjs:63` `baseOpts` is the ONLY formationId in the file, and all 12 cases (`batch002/golden-A..C`, `dungen/default/L{1,3,5,8}/dg-{11,22}`, `dungen/test_fixed`) inherit it. |
| `sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** — unchanged | Its `formation4-full` fixture (`forecast_parity.cjs:155`) is DERIVED at runtime from `combat.FORMATIONS.formation4.canvases`, so it moves WITH the table. Parity is between two implementations reading the same table; shifting the table shifts both sides equally. |
| `sim/tests/run.cjs` | **116 passed, 1 failed** | The single failure is the §5.1 hard-pin: `formation defs: … formation4 uses CORRECTED J11:Q18 -- expected "J11:Q18" got "J10:Q17"`. |

**So the honest blast radius is one test assertion plus documentation — not a rebaseline.** This
REQ does not need Q1's golden sanction to proceed, because it does not move a golden. State this
plainly rather than letting "sanctioned under Q1" imply a churn that measurement does not show;
a REQ that predicts a golden diff and produces none has mis-specified itself.

**What DOES change is live gameplay**, and that is what Q1 covers. `formationId` arrives from the
client on `POST /api/schedule/rooms` and is looked up in `compile.cjs:56`; formation4 is a
selectable formation, so any real run using it will place its backline one row higher and take
different ray hits. No test corpus covers that path today — which is precisely why the bug
survived, and why the user's sign-off (§ Status) is on the gameplay change, not on the goldens.

If REQ-0256/0257 land first, their rebaseline absorbs this trivially; ordering between them does
not matter, and they do not conflict (they touch the tick/ray core, not the formation table).

## 9. The shared `IBattleInstancesFormationMap`

Per brief §4, the normative interface. **New file: `sim/lib/formation_map.cjs`.**

```
IBattleInstancesFormationMap                 // 26x18, padding ring 1, placeable B2:Y17
  instances : IBattleInstance[]
  rays      : IBattleRay[]                   // rays in flight ON THIS map (a ray is fired ONTO
                                             //   the opposing map, so it lives there)
  tickInstances()                            // the FIRE phase: forwards tick to instances,
                                             //   in stable instance index order (REQ-0256 s10.1)
  tickRays()                                 // the ADVANCE phase: advances rays (REQ-0257 s12.1)
  tick()                                     // === tickInstances(); tickRays()
                                             //   brief s4's single-map entry point. See below:
                                             //   `Battle` does NOT call this one.
```

It is a NEW file rather than an addition to `sim/lib/field.cjs` because `field.cjs` is
dimensions + a static occupancy index (`FIELD_ROWS`, `cellKey`, `buildOccupancyIndex`) with a
header that pins it to a determinism contract ("Moved VERBATIM from sim/combat.cjs. Determinism
contract: goldens must stay byte-identical"). The map is a LIVE, ticking object. Keep the static
geometry primitives separate from the mutable per-battle state; `formation_map.cjs` requires
`field.cjs`, not the reverse.

What this REQ delivers of the interface: the MAP itself — construction from a formation (player
plane) or a monster_pack (enemy plane), the `instances` list, the placeable/ring predicate, and
the both-planes enforcement. **This REQ must not grow a tick loop.**

**The tick half is DECLARED here and implemented elsewhere. Three REQs share this one file, and the
split is disjoint — this table is the seam:**

| member | declared | implemented |
|---|---|---|
| `instances`, construction, ring predicate | **THIS REQ** | **THIS REQ** |
| `rays[]` | **THIS REQ** | REQ-0257 (§12.1) — empty list until then |
| `tickInstances()` | **THIS REQ** | **REQ-0256** (§7.1a) |
| `tickRays()` | **THIS REQ** | REQ-0257 (§12.1). **REQ-0256 stubs it to a no-op** — `rays[]` is always empty until 0257 (REQ-0256 §11). |
| `tick()` (= both phases) | **THIS REQ** | **REQ-0256** (§7.1a) |

**Why the map has TWO phase methods and not just brief §4's one `tick()` — flagged, because it is a
deliberate refinement of the normative interface.** Brief §4 says *"`tick()` // spec c: forwards tick
to instances, then advances rays"*, written for ONE map. There are two, and `Battle` must run **all**
fires before **any** advance (REQ-0257 §12.1). Composing the single `tick()` over two maps gives
`playerInstances, playerRays, enemyInstances, enemyRays` instead — and since a ray lives on the map
it was fired ONTO, that order would advance player-fired rays on their birth tick while enemy-fired
rays wait, i.e. **player rays would arrive a tick sooner for no reason but map order**. So `tick()`
survives as brief §4's single-map entry point and `Battle` calls the two phases instead.

**REQ-0256 §7.1a owns this decision and its full rationale; REQ-0257 §12.1 states the phase order.
All three REQs say the same thing, and a user veto changes all three.** This REQ names it here only
so that `formation_map.cjs`'s own interface is not a fourth, quieter version of the story.

**Both planes, one abstraction — the point of the REQ.** Today the player plane's geometry lives
in `formation.cjs` (8x8-checked) and the enemy plane's in `validateMonsterPackEntry`
(PLACEABLE-checked). After this REQ both construct an `IBattleInstancesFormationMap`, and the
ring predicate is asked once, in one place, for both. The asymmetry that let formation4 rot is
the asymmetry this removes.

### 9.1 The `shared/` import rule — honour it, do not "fix" it

`shared/content_validate.cjs` **may NOT `require()` out of `shared/`.** The rule is documented at
the PLACEABLE constant itself (`shared/content_validate.cjs:432-435`), verbatim:

> These constants are duplicated here rather than require()d from `sim/lib/field.cjs` on purpose:
> **shared/ may not require() out of shared/** (the same rule `sim/tests/forecast_parity.cjs`
> documents in its header), so a parity test pins them equal instead of a cross-tree import.

`forecast_parity.cjs`'s header states the same rule and the reason it is nailed shut:

> CONSTANTS ARE PINNED. shared/ may not require() out of shared/, so FIELD_ROWS / FIELD_COLS /
> RAY_STEP_BUDGET / ENTRY_JITTER_HALF_WIDTH are re-declared there. That is a drift hazard — so it
> is nailed shut here: change a sim TUNABLE without changing the forecast's copy and CI goes red.

So: **`shared/content_validate.cjs` must NOT import `sim/lib/formation_map.cjs`.** It keeps its
own `PLACEABLE`. `formation_map.cjs` (which lives in `sim/`, not `shared/`) MAY require
`sim/lib/field.cjs`. The abstraction is shared by CONTRACT and parity test, not by import.

The precedent is already established and must be extended, not invented. `sim/tests/run.cjs:1816`
states it:

> REQ-0184: the geometry constants exist in THREE places — `sim/lib/field.cjs` (the sim's own),
> `shared/content_validate.cjs` (the validator's, which may not require() out of shared/), and
> `client/src/contentadmin/contentShared.ts` (the preview's mirror, which cannot require a .cjs at
> all). Duplication is forced by those module boundaries; SILENT duplication is not. These pin
> them equal, the same way `sim/tests/forecast_parity.cjs` pins the forecast's copies.

Three parity tests already exist and must keep passing:

| test | pins |
|---|---|
| `sim/tests/run.cjs:1823` | `shared/content_validate.cjs` field dims == `sim/lib/field.cjs` |
| `sim/tests/run.cjs:1830` | `PLACEABLE` is exactly the field inset by 1 (24x16 in 26x18) |
| `sim/tests/run.cjs:1840` | `client/src/contentadmin/contentShared.ts` declares the same dims (read as TEXT — the client is TS/ESM and cannot be required from a node test) |

**If `formation_map.cjs` declares its own copy of the ring, it becomes a FOURTH copy and needs a
FOURTH parity test.** Preferred: it declares none — it requires `FIELD_ROWS`/`FIELD_COLS` from
`sim/lib/field.cjs` (a legal, same-tree import) and derives the ring. Then the existing chain
already covers it and no new copy exists. Only if a copy is genuinely forced does a new parity
test get added; the rule is that duplication may be forced, but silence never is.

`client/src/contentadmin/contentShared.ts:373-374` also carries
`export const FIELD_COLS = 26, FIELD_ROWS = 18;` + its own `PLACEABLE`. It does not change (the
dims are untouched), but REQ-0261 will need the ring for rendering — it reads it from here.

## 10. Scope

**In:**
1. `sim/lib/formation.cjs` — `formation4.unit4` -> `J10:Q17`; note rewritten; `validateFormationBoxes` strengthened to 8x8 AND PLACEABLE.
2. `content/live/dungeon/formations.json` — same box; entry note + file note corrected (incl. the stale `sim/combat.cjs` path).
3. `sim/lib/formation_map.cjs` — NEW. `IBattleInstancesFormationMap` for both planes (§9).
4. `sim/tests/run.cjs` — retarget the `J11:Q18` pin (1292) + its test name (1283); add the §6.1 mirror-parity test; add a test that the strengthened assert REJECTS an out-of-ring 8x8 box (the regression guard for this exact bug).
5. `sim/README.md:89` — corrected.
6. `docs/llm_managed/combat_spec_draft.md` §5.2 lines 379/384 + the §5.1 anchor note; `docs/llm_managed/user_managed_rename_suggestions.md:133,140,149`.
7. `web/preview/batch-002` + `batch-004` — regenerated via `tools/build_preview`.
8. An ASK to the user for `docs/user_managed/backpack_battle_spec.md` lines 85/87/89/91/98 (§7.2).

**Out:**
- **Editing `docs/user_managed/backpack_battle_spec.md`.** Forbidden. Ask (§7.2).
- **`tick()` / `rays[]` implementations** — declared here, built by REQ-0256 / REQ-0257.
- **Rendering the ring** — REQ-0261. This REQ enforces it in the validator; the brief's item (f)
  is explicit that the ring is enforced "by the validator, not only by the renderer".
- **Re-composing any other formation.** The other 15 boxes are legal and are not touched. Same
  doctrine as REQ-0184's port note: a fix is not a rebalance, and mixing them makes the diff
  unreadable.
- **Widening `validateMonsterPackEntry` to accept gimic ids** — REQ-0259 (brief §3 C4/Q4).
- **An e2e harness.** None needed: the change is sim + validator + docs, covered by the sim unit
  tests. Decade **7580 / 7581 / 7582** (`5000 + 258*10 + {0,1,2}`) is reserved-by-numbering and
  left unused.

## 11. Acceptance criteria

1. `FORMATIONS.formation4.canvases.unit4 === 'J10:Q17'`, and `formations.json` agrees — the §5.3 mirror still holds, now machine-checked (§6.1).
2. All 16 boxes pass 8x8 AND inside-B2:Y17. Re-running the §3.1 sweep prints **violators=0**.
3. `validateFormationBoxes` THROWS on an 8x8 box placed outside the ring — proven by a test, not by inspection. Given the same table today it would have thrown on `J11:Q18`.
4. `sim/tests/run.cjs` green (the 1292 pin now reads `J10:Q17`); `sim/tests/goldens.cjs` still `12 cases OK` and byte-identical (§8); `sim/tests/forecast_parity.cjs` still 18/0.
5. No `J11:Q18` remains anywhere as a CURRENT assertion. It survives only as history (the retired-xlsx narrative, `docs/REQ/done/REQ-0165-*` which is terminal history and is NOT edited).
6. `shared/content_validate.cjs` has no new `require()` out of `shared/` (§9.1); the three existing parity tests still pass; no unpinned fourth copy of the geometry exists.
7. The user has amended `backpack_battle_spec.md` per §7.2, or has explicitly deferred it.
