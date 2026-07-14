# user_managed correction proposals — **v2** (REQ-0165, 2026-07-14)

**Filename kept** (`user_managed_rename_suggestions.md`) for REQ-0123 traceability.
**v1 (REQ-0123, 2026-07-12) is SUPERSEDED by this file** — it was rename-only, and two
of its suggestions were wrong against the sources (see "Errata" at the bottom).

`docs/user_managed/**` is golden and user-edited only. Nothing here has been applied.
Every item below was re-derived from the SOURCES on master (not from other docs), and
carries its evidence. Apply, adapt, or reject freely.

---

## 0. The one fact that drives most of this file

**On master today, a BP and a Unit are 1:1. Every BP carries exactly one Unit; a BP
without a Unit cannot exist.**

- `server/services/gacha.cjs` `rollCommonBp()` always stamps `linker:{off,dirs}`:
  the Unit cell is drawn uniformly from the polyomino's own cells, and `dirs` gets
  `GACHA_MIN_UNIT_DIRS..GACHA_MAX_UNIT_DIRS` (1–3) distinct directions. There is no
  "no Unit" branch.
- `client/src/i18n/workshop.ts` `workshop.ruleUnit`: 「ユニット座(ᛖ)は鋳込時に1セルへ
  刻印される — 座は選べない。」
- `mock-src/engine.js:92` `unitCell(bp) = bp.origin + bp.linker.off` — unconditional.

`bp.linker` is a **deliberately retained serialized legacy name** (REQ-0124 ledger);
its meaning is **Unit**. Do not read it as "Linker still exists".

Consequence: post-pivot, the word "Unit" in the golden docs is the single most
dangerous term, because the OLD sense (canvas owner → now **Squad**) and the NEW sense
(character piece in one BP cell) both read naturally in the same sentences.

---

## 1. canvas_spec.md

### 1.1 FACTUAL — "It may contain one BP Linker or none" (L16)

> BP (Backpack) — … It may contain one BP Linker or none.

**Wrong on both counts.** Rename aside, the "or none" is not true of any BP the game
can mint (§0). Suggested:

> **BP (Backpack)** — one Backpack placed on the Canvas. It provides many cells, and
> carries **exactly one Unit**, seated on one of its own cells. The seat is stamped at
> mint time and cannot be chosen or moved.

Note: `connection_shape: none` exists in `content/vocab.json` v9 (REQ-0128a) — that is
a Unit that forms **no links**, not a BP with no Unit.

### 1.2 FACTUAL — the Unit cell is not a placement cell (L17)

> Cell — one cell of a BP. A cell provides one placement availability for layer-1.

Two problems. (a) The rule that a **PO can never be placed on the Unit's cell** is
missing — the engine rejects it explicitly: `mock-src/engine.js` `canPlaceCells()`
returns `{ok:false, why:'Unit cell'}`. (b) BP cells supply placement for **layer-2**
(POs), not layer-1. Suggested:

> **Cell** — one cell of a BP. Each cell offers one **layer-2** placement slot, except
> the Unit's own cell, which is occupied by the Unit and never accepts a PO.

### 1.3 TERMINOLOGY — "Canvas … of one Unit" (L15)

"**Canvas** — the full placement field of one Unit." → **"…of one Squad."**
(`server/services/core.cjs`, `client/src/SquadTabs.tsx`, `store/squads.ts`.)

### 1.4 TERMINOLOGY — the Backpack-as-HP line (L19) — **highest-risk sentence in the docs**

> **Backpack-as-HP** the unit does not have HP, its each backpack that has HPs.

Read with the new vocabulary this says "the character piece has no HP", which is a
different (and misleading) statement. Suggested:

> **Backpack-as-HP** — a **Squad** has no HP of its own; **each BP carries its own HP
> pool** (`bp.hpMax`), and is destroyed independently.

### 1.5 TERMINOLOGY — the Linker section (L43–52)

Retitle **"BackPack Extra Function — Linker"** → **"The Unit (ex-Linker)"**, and swap
the terms: "a linker sends linking beams" → "a Unit emits connection rays";
"BP link" (L49) → **"Unit Link"**.

**The mechanics in this section are still exactly what the engine does** — 8-point
compass dirs, ray runs to the board edge, links to the **first** Unit hit, no
piercing, mutual links legal (`mock-src/engine.js` `traceBeams()`, `DIRS`). Do not
"fix" the mechanics; only the names are stale.

Forward-looking note (optional, and NOT live yet): REQ-0128a registered
`connection_shapes` (queen / queen_2 / rook / rook_3 / bishop / lance / backward_line /
adjacency / knight / none) in `content/vocab.json` v9 as a **dictionary only** —
nothing is wired to the engine. Per-Unit shapes replace the current "1–3 free
directions" model only when **REQ-0128b** ships. If you want the golden to describe
today's game, keep the 8-direction wording; if you want it to describe the ratified
target, say "each Unit has a Connection Shape" and mark it as pending REQ-0128b.

### 1.6 TERMINOLOGY — Preset (L61)

The word **Preset is retired**; the concept merged into **Squad** (REQ-0123 map;
i18n contains no "プリセット"/"preset" string). Suggested:

> **Squad** — a saved Canvas configuration. A player may deploy multiple own Squads
> simultaneously, but one physical item cannot exist in two deployed Squads.

The exclusivity rule itself is live and unchanged: `schedule.error.notIndependent` /
`schedule.error.crossRoomOverlap` in `client/src/i18n/schedule.ts`.

### 1.7 TERMINOLOGY — decoded example (L64–80)

"One Linker per BP" → "One Unit per BP" (which is now a **law**, not an observation —
§0). "`C2` Linker **24**" etc. → "`C2` Unit **24**". The dir numbering in the example
(0=N … 7=NW) matches `engine.js` `DIRS` — keep it as is.

### 1.8 VERIFIED CORRECT — do not touch

PO must fit entirely inside ONE BP (`canPlaceCells`: `why:'spans two BPs'`);
Dead Space is inert (`why:'Dead Space'`); PO Connection Ports are directional, belong
to the sender, and never connect across BPs (`connectionsFrom()`: `// never across
BPs`); Socket Type hierarchy is a separate vocabulary from PO Tags and never
cross-matches (`hostOk()`); Transmutator is the only currency (LRDST is a `tm/1`
entry in `content/live/live_tms.json`, and is both the gacha and the Market currency).

---

## 2. backpack_battle_spec.md

### 2.1 FACTUAL — formation4's `flagged_data_issue` is RESOLVED (L72–86)

The spec still flags `J11:Q19` (row-19 overrun, 9 rows) and "unit-to-box assignment is
implied, not explicit". **Both were fixed and are live.** Sources agree byte-for-byte:

- `sim/lib/formation.cjs` — `formation4.canvases = {unit1:'B2:I9' (left_wing),
  unit2:'J2:Q9' (center_top), unit3:'R2:Y9' (right_wing), unit4:'J11:Q18'
  (backline_center)}`, with a load-time assertion that **every** formation box is
  exactly 8×8 (it throws otherwise).
- `content/live/dungeon/formations.json` — identical, and says so in its `note`.

Suggested: replace `flagged_data_issue` with the corrected box + the explicit
assignment, and delete the "likely a sheet error" wording. `formation.xlsx` should be
corrected to `J11:Q18` too, or the sheet retired as non-authoritative.

### 2.2 FACTUAL — `open_items_still_unresolved` (L88–92): **all four are resolved**

| open item | resolved behavior | source |
|---|---|---|
| penetration exhausted mid-flight | the ray **stops** on the hit that exhausts the budget; a **bounce never consumes penetration** | `sim/lib/ray.cjs` (`if (passed < penetration) { passed++; continue; } landing = cell; break;` and `// reflection does NOT consume pen`) |
| AOE measured in shared-field or canvas-local cells | **shared-field cells**, Chebyshev radius around the landing cell | `sim/lib/skills.cjs` `splashFn()` + `sim/lib/ray.cjs` `chebyshevDist()` |
| formation4: which unit occupies which box | explicit (§2.1) | `sim/lib/formation.cjs` |
| formation4: row-18 overrun | fixed to `J11:Q18` (§2.1) | `sim/lib/formation.cjs`, `formations.json` |

Suggested: delete the block, or keep it as a "resolved" changelog.

### 2.3 FACTUAL — entry points are not free, and top/bottom dirs are not fixed (L11–13)

> every cell along the outer edge … can spawn an attack
> entry cells have a **fixed** diagonal direction (↘ / ↙ / ↗ / ↖)

- The entry cell is **derived**, not free: the attacker's cell **centroid** (round-half-up)
  is projected onto the chosen edge and jittered by `ENTRY_JITTER_HALF_WIDTH`, then
  clamped to the board (`sim/lib/entry.cjs` `selectEntryCell()`). Any edge cell is
  *reachable*, but which one is not the attacker's choice.
- The direction is fixed **only on the left and right edges** (left → ↘ DR, right → ↙ DL).
  **Top and bottom edges fan two ways** (top → ↙/↘, bottom → ↗/↖) and the sim picks
  between them from the ray RNG stream (`sim/lib/geometry.cjs` `EDGE_DIRS`,
  `entry.cjs`). The edge itself comes from the skill's `attack_profile.edge` list.

### 2.4 FACTUAL — bounce 5 hits every live occupant, not "all BPs" (L26)

> …immediately hits ALL BPs on the field at +150% (terminates the ray)

Implementation (`sim/lib/ray.cjs`, `ev:'ray_hit_all'`) strikes **all live occupants** —
which includes **enemy entities**, not only BPs — at ×2.5, **and still runs the AOE
splash** at the last in-field cell before terminating. Suggested wording: "strikes every
live occupant on the field (BPs and enemies) at +150%, applies its AOE splash, and
terminates".

### 2.5 FACTUAL — the field is two planes, not one (L6–10)

> shape: "single shared coordinate plane for all 4 units"

The sim runs **two independent A1:Z18 planes** — the player plane and the enemy plane —
and a ray is fired **onto the opposing plane** (`sim/lib/ray.cjs` header: "two
independent A1:Z18 planes (S2.1)"; `selectEntryCell(..., oppFieldBounds)`;
`sim/lib/encounter.cjs` builds the enemy plane). The "single shared plane" statement is
true **within one side** (the 4 Squads share the player plane) — say so explicitly.

### 2.6 TERMINOLOGY

`game_system: "multi-unit backpack battler"` → "multi-**squad** backpack battler";
`unit_canvas` → `squad_canvas`; "each unit owns a fixed 8×8 sub-grid" → "each **squad**
owns…"; prose "Unit1/Unit3/Unit4" → "Squad1/Squad3/Squad4".

**Do NOT rename the `unit1`…`unit4` KEYS inside the `formations` blocks.** They are
live persisted slot-key values (REQ-0124 ledger: "Slot-key VALUES 'unit1'…'unit4'"),
and `content/live/dungeon/formations.json` + `sim/lib/formation.cjs` + `SQUAD_SLOTS` in
`server/services/core.cjs` all still use them. Renaming them in the golden doc would
make the doc contradict the shipped data. (v1 of this file suggested exactly that —
see Errata.)

### 2.7 VERIFIED CORRECT — do not touch

Field bounds A1:Z18 (`sim/lib/field.cjs`: `FIELD_ROWS=18, FIELD_COLS=26`); 8×8 squad
canvases (`mock-src/data.js`: `LAYOUT={ROWS:8,COLS:8}`); boundary is the only reflection
surface, gaps are not walls; 45° diagonal stepping; stop-and-damage on an occupied BP;
destroyed BPs are passable; bounce multipliers **+0 % / +0 % / +50 % / +100 % / +150 %**
for bounces 1–5 (`sim/lib/geometry.cjs` `mult()`: 1.0 / 1.0 / 1.5 / 2.0 / 2.5);
1 BP per cell, no stacking; layout locked for the match (Frozen Canvas).

---

## 3. game_golden.md

### 3.1 TERMINOLOGY — L10

"Every pack speaks through a single **Linker**." → "…through a single **Unit**."
The metaphor gains its literal speaker, and the line is now a mechanical law (§0).

### 3.2 TERMINOLOGY — L13

"**March four packs at a time**" → the deployable four are **Squads**, not packs
(`Troop = 4 Squads`; `server/services/core.cjs` `SQUAD_SLOTS`, `runs.cjs` refuses to
start an incomplete Troop). Each Squad holds **many** BPs. Suggested: "March a Troop of
four Squads at a time".

### 3.3 TERMINOLOGY — L6

"bind pack to pack with directional **Linkers**" → "bind pack to pack through your
**Units'** connection rays".

### 3.4 APPLIED — the guardrail pillar (REQ-0166, reworded by the user in REQ-0167)

Shipped under **P5**, in the user's ratified wording:
> A Squad Canvas is the vessel; strength always derives from the units' contents
> and arrangement, never from the Unit alone.

The vessel is the **Squad Canvas** — not the Unit, and not a single pack. Strength is a
property of the whole arrangement across all of a Squad's Units and their packs.

### 3.5 VERIFIED CORRECT — do not touch

**Asymmetric combat** (§4): enemies have no backpack system — `content/live/dungeon/
enemies.json` entries are `{id, name, hp, footprint, skills, rarity, pack_role}`, no
canvas, no BPs, no Units. **No Gold; Transmutators are the only currency** — LRDST is a
`tm/1` Transmutator and is the gacha (`GACHA_COMMON_BP_COST`) *and* Market currency
(`server/services/market.cjs`, `MARKET_TM_ID='lrdst'`). **Frozen Canvas**, auto-resolving
clash, scheduled deployments: all live.

---

## 4. worldview_ragnarok_tentative.md

No factual conflict with the sources. It is already character-centric ("a devoted
character"), and the live Ragnarok flow devotes a **Squad**
(`client/src/i18n/ragnarok.ts`: "One squad not on any expedition…", `err.last_squad`,
`err.empty_squad`). Optional tightening: "a devoted **character**" → "a devoted
**Squad**", since a Squad — not a single Unit — is what is sacrificed and engraved.

---

## 5. formation.xlsx — RETIRED (REQ-0166, 2026-07-14)

User ruling: **delete it.** The sheet was the origin of the row-19 error (§2.1) and
carried pre-pivot Unit1–Unit4 labels. `content/live/dungeon/formations.json` is the sole
authoritative formation data (mirrored byte-for-byte by `sim/lib/formation.cjs`).
`backpack_battle_spec.md`'s `source:` field now says so.

---

## 6. Not suggested

- No change to the Pay-to-Kill single-axis monetization ruling; skins remain
  capability-only/UGC (2026-07-12 ruling); Units/packs unaffected.
- No change to the link mechanics prose in canvas_spec (§1.5) — it still matches the
  engine. It becomes stale only when REQ-0128b ships.

---

## Errata — what v1 (REQ-0123) got wrong

1. v1 suggested: *"a BP may contain one Unit **or none**"*. **Wrong** — every minted BP
   has exactly one Unit (§0). v1 propagated the very error it was meant to fix.
2. v1 suggested: *"formations' `unit1..unit4` → `squad1..squad4`"*. **Harmful** — those
   are live persisted slot keys, deliberately kept legacy by REQ-0124 (§2.6).
3. v1 was rename-only, and therefore missed every factual divergence in §1.2, §2.1–2.5:
   the golden docs still carry four "unresolved" open items that the sim resolved, and a
   formation-4 data bug that the sim corrected.
