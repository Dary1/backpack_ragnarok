# REQ-0149 — Unit Roster 001 — kit design & def authoring

**Status:** Draft — the roster design below is USER-AUTHORED and binding, but it
is NOT yet authorable as defs.
~~REQ-0127 (art)~~ **CLEARED 2026-07-13** — S7 ALL GREEN, 11 icons cover all 12 kits (§3b).
~~REQ-0128 vocabulary~~ **CLEARED** — shipped as REQ-0128a (`vocab.json` v9).
~~REQ-0129~~ **CLEARED 2026-07-14** — the charge grammar is FROZEN (`vocab.json` v13); `todo/`.
~~REQ-0128b~~ **CLEARED 2026-07-14** — occluder set, pierce semantics and the pulse-law
retirement all ruled; `todo/`.
~~REQ-0130~~ **CLEARED 2026-07-14** — `unit/1` is RATIFIED in `unit_icon_pipeline.md` §4.2
(REQ-0130 itself stays superseded in `done/`).

**Every mechanics blocker is gone. What still blocks def authoring is THIS REQ's own
content gaps — G2, G5, G6, G12, G13 — which are questions for the user about HIS kits,
not about the grammar. They are now the whole critical path.**

> **Schema changes that land on this REQ (2026-07-14):** `sockets` is **REMOVED** from
> `unit/1` (demoted to REQ-0163, unratified) — so G9's "no `sockets`" is no longer a gap,
> it is the ruling. And `icon` is now a **free reference**, which is exactly what G14
> demanded.
>
> **⚠ G6 got WORSE, not better.** REQ-0128b named `PULSE_CAP` as the backstop for the
> Berserker's uncapped `+0.1%/stack` — and **PULSE_CAP was retired on 2026-07-14.**
> `passive_per_stack` never consumes charge, so `capacity` does not bound it either.
> **Nothing in the engine will catch this.** G6 now needs a real cap from the user, and it
> is the only gap with no safety net left underneath it.
**Reserved:** 2026-07-13
**Slug:** unit-roster-001-kits
**Source:** user chat, 2026-07-13 (verbatim design, reproduced in §2); rulings
of 2026-07-13 recorded in §0.

---

## 0. Ruling log (user, binding — append only, never rewrite)

| Date | Gap | Ruling |
|---|---|---|
| 2026-07-13 | **G3** | **REQ-0129 7/12 ruling UPHELD.** The clock tower does not exist and is not resurrected. The Thief kit may NOT use it. → the Thief now has **no charge trigger**; the user must restate it. Tracked as the still-open **G3a**. |
| 2026-07-13 | **G7** | **Necromancer is CUT** (没). **Watcher and Squire are IN**, with kits authored by the user (§2.11, §2.12). Roster 001 = **12 units**. REQ-0130's "13 kits" gate text is wrong and is corrected by this REQ. |
| 2026-07-13 (later) | **G3 — REVERSED** | The user challenged the kill: *"why does it need to be killed?"* **They were right.** The "2026-07-12 user ruling" that deleted the clock tower was **fabricated by a previous agent** (see REQ-0129 retraction; commits `ed2bfe5` → `8188b9a`, 36 seconds apart, no user turn between). The clock tower was never "a deleted unit kind" — the term had no history in the repo at all. G3 was closed on a forged authority, and this REQ then upheld it. Both are withdrawn. |
| 2026-07-13 (later) | **G4 — CLOSED by user ruling** | **"タワー" is DELETED from the design. A unit is a unit.** There is no tower entity, no tower kind, no tower form. Every occurrence of the noun is struck: Elf's "same tower", Little Princess's "Princess Tower", the Thief's "clock tower". The kits that leaned on it must be restated (G3a, G5, G14). |

*(Discovered while acting on the G7 ruling: the REQ-0127 art batch is out of sync
with the roster — see §3b. G14 opened.)*
| 2026-07-13 (later) | **G14 — CLOSED by user ruling** | **Princess and Little Princess adopt the SAME artwork** (*一旦* — provisional). They remain **two units / two defs sharing one icon**. Roster 001 stays at **12 units**, served by **11 icons**. Consequence for REQ-0130: the `icon: "icon-<id>"` convention (icon id derived 1:1 from unit id) **no longer holds** — the schema must permit two defs to reference one icon. Raised on REQ-0130. |
| 2026-07-13 (later) | **connection_shapes** | **Register the shape vocabulary (飛車 / 角 / …) as a DICTIONARY now; implementation becomes its own REQ.** Done: `content/vocab.json` v9 gains `connection_shapes` (10 entries). REQ-0128 is split per the PROJECT.md multi-phase rule → **REQ-0128a** (vocabulary, this ruling, → built) / **REQ-0128b** (mechanics + engine, stays draft). |
| 2026-07-13 (later) | **G3a — CLOSED by user ruling** | **The Thief's charge trigger is the firing of the Unit at the other end of its link** (*"Thiefも接続元が発火する事でトリガーになっている"*). This is an **already-attested charge source** in REQ-0129 ("connected-target's trigger firing") — **no grammar extension is needed and no rule was ever broken.** The "clock tower" was only ever flavour for *a connected Unit*; it never needed a definition, and it never needed to be killed. |
| 2026-07-13 (later) | **Board orientation** | **前方 = the battlefield cell with the LOWER Y (up).** Reconciled to the engine's `[row,col]` / row-increases-downward convention: **forward = `DIRS[0]` = N = `[-1,0]`.** Recorded in `vocab.json.orientation`. Unblocks `lance` (Light Cavalry), `backward_line`, `forward_1` (Squire). |
| 2026-07-13 (later) | **REQ-0128b decisions 1–3** | **(1) Rays do NOT pierce** (keep it parameterisable — `pierce` field). **(2) `adjacency` is not a concept — it is a ray with range 1/2/…** This collapses every shape to `{dirs, range, pierce}` and leaves the knight jump as the only offset. **(3) Connections are canvas-local (Squad-scoped).** REQ-0128b is now `todo/` — all five decisions closed. |
| 2026-07-13 | **⚠ Watcher — consequence, needs a look** | Under ruling (2), `adjacency_lr` = a **range-1 E/W ray**: the Watcher links to a Unit in the cell **directly left or right of its own cell**. Its design note — *"縦長や横長の変なバックパックの横にポンと置くだけで仕事をする"* — reads more like **BP-footprint** adjacency, which the ruling does not give. **The kit may need restating; the ruling stands.** |
| 2026-07-13 (later) | **Watcher — RULED** | **`connection_shape: queen`, range 2** (`queen_2`). User: *"出ないとほぼ接続が不可能ですね"* — at range 1 a Unit only links when another Unit occupies the literal adjacent cell, which effectively never happens. `adjacency_lr` is now orphaned and has been REMOVED from the dictionary. |
| 2026-07-13 | **⚠ G15 — the Squire has the same disease** | *(OPEN)* The Squire is `forward_1` = a **range-1** forward ray. It links only if a Unit sits in the single cell directly in front of it — the exact condition the user just called "nearly impossible" for the Watcher. Its design note assumes an "attacker" in front, and since links are **Unit-to-Unit**, that attacker must be a **Unit**, not a weapon PO. **Is the Squire deliberately that positional, or does it need range 2 as well?** Not fixed by inference. |
| 2026-07-13 (final) | **G15 — CLOSED by user ruling** | **The Squire is `rook`, range 3** (`rook_3`). `forward_1` is orphaned and REMOVED from the dictionary. |
| 2026-07-14 | **Mechanics — ALL CLEARED** | REQ-0129 charge grammar FROZEN (spend closed at 3; gain count/damage; 8 charge triggers, 5 AGENT-DEFINED; targets self + units_connected user-ratified, bp_connected + units_connected_distributed AGENT-DEFINED under delegation). REQ-0128b: occluder set = **Units only** (BP/PO transparent); `pierce` = link **every** Unit in range; **propagation RETIRED** (no PULSE_CAP / visited-set / hop budget); REQ-0061 8-type axis 供養; `knight` -> `chess_knight_move`, new `shougi_keima_move`. `unit/1` RATIFIED, `sockets` removed -> REQ-0163. Shipped as `vocab.json` **v13**. |
| 2026-07-13 (final) | **G1 — CLOSED by AGENT INFERENCE under explicit user delegation** | User: *"残りの接続形状は、あなたの推論で決めちゃってください。後でまた修正が必要ならREQを出します。では、GO"*. **This is NOT a user ruling and is not recorded as one.** Shieldmaiden = `backward_line`; Priest = `queen`. Reasoning in §3c. The user has pre-authorised a correcting REQ; this row exists so that whoever reads it later knows a machine chose, not a person. |

## 1. Why this REQ exists

REQ-0130's gate reads: *"Paper check: all 13 user-authored roster kits (elf …
squire) expressible in schema + frozen grammar."*

**Those kits are written down nowhere.** They lived only in a 2026-07-12 chat.
A gate that checks a document that does not exist is not a gate. REQ-0130 owns
the *schema and the pipeline*; REQ-0128 owns the *connection mechanics*;
REQ-0129 owns the *charge grammar*. Nobody owned the **content** — the actual
kits — and so the content evaporated.

This REQ is that missing home. It records the roster design, holds it against
the three mechanics REQs, and authors `content/live/live_units.json` once they
land. It ships **defs, not mechanics**: every rule below that the engine cannot
yet express is a demand on REQ-0128/0129, raised here and settled there.

## 2. Roster 001 — the user's design (2026-07-13, binding) — 12 units

Reproduced as given. `connection_shape` values map onto the ratified REQ-0128
vocabulary (bishop 角 / rook 飛車 / lance 香 / queen / knight / adjacency /
backward-line / none) — **except where flagged**: units 11 and 12 name shapes
that the ratified vocabulary does not contain (→ G10, G11).

### 1. Elf — `connection_shape: bishop` (角)
- **Charge trigger:** item on-hit.
- **Charge effect:** ~~shares cooldown within the same *tower*~~ — **"tower" STRUCK
  2026-07-13 (user: a unit is a unit).** The scope of the cooldown share is now
  undefined. **→ G5, awaiting the user's restatement.**

### 2. Dwarf — `connection_shape: rook` (飛車)
- **Charge trigger:** BP damage taken.
- **Charge effect:** shares, with the connected Unit, the *already-reduced*
  cooldown of an item that carries its own cooldown.

### 3. Thief — `connection_shape: chess_knight_move` (chess knight)
- **Charge trigger:** **the connected Unit fires.** *(RULED 2026-07-13 — G3a closed.)*
  The old wording named a "clock tower"; with *tower* deleted, that was only ever
  flavour for **a Unit at the other end of the link**. This is an already-attested
  charge source in REQ-0129 — **no grammar extension, no rule violation.** The term
  never needed defining, and never needed killing.
- **Charge effect:** steals cooldown from the connected Unit's cooldown-bearing
  items, and clears the cooldown on its own items.

### 4. Angel — `connection_shape: queen`
- **Charge trigger:** number of times damage was taken.
- **Charge effect:** reduces its own debuffs and the connected BP's debuffs by a
  percentage.

### 5. Shieldmaiden — `connection_shape: backward_line` (後方直線) *(AGENT-INFERRED, see §3c)*
- **Charge trigger:** amount of damage received.
- **Charge skill:** immediately fires `Armor`-tagged items.
- **Passive:** takes damage on behalf of the connected target — **but only up to
  the BP's block value.**

### 6. Priest — `connection_shape: queen` *(AGENT-INFERRED, see §3c)*
- **Charge trigger:** amount of damage the *connected target* received.
- **Active:** heals the connected target's HP (distributed if there are several).

### 7. Little Princess — `connection_shape: queen`
- **Charge trigger:** its passive fires **XX** times **(XX NOT GIVEN — §3 G2)**.
- **Charge effect:** ~~becomes the **Princess Tower**~~ — **"tower" STRUCK
  2026-07-13.** Under *a unit is a unit*, this reads as **becomes the Princess**
  (§2.8) — i.e. a Unit form change. **Not adopted by inference → G14.**
- **Passive:** the connected target *always* takes attacks on her behalf, and
  doing so **satisfies the Unit's trigger conditions**.

### 8. Princess — `connection_shape: queen`
- **Charge trigger:** the connected target takes damage.
- **Charge effect:** grants the connected BP a shield equal to **half its own**.
- **Passive:** an item that would deal damage instead grants **itself a shield**.

### 9. Light Cavalry — `connection_shape: lance` (香)
- **Charge trigger:** damage dealt.
- **Charge effect:** "CHARGE!" — every `Weapon` in its own BP *and* the connected
  BP fires immediately.

### 10. Berserker — `connection_shape: none`
- **Charge trigger:** damage taken.
- **Charge skill:** none.
- **Passive:** **+0.1% damage per charged stack.**

### 11. Watcher (ウォッチャー / 見張り番) — `connection_shape: queen_2` (クイーン・射程2) *(RULED 2026-07-13)*
- **Charge trigger:** its own cooldown (elapsed time).
- **Charge effect:** slightly advances the cooldown timer of the **longest-cooldown
  item inside the connected Unit's BP**. *("Slightly" is unquantified → G12.)*
- **Design note (user):** a general-purpose unit that does its job just by being
  dropped beside a tall or wide odd-shaped backpack. Also serves as a **hub** for
  wiring into other, stronger units. *(The hub reading is what forced the shape ruling:
  range 1 could not deliver it. `queen` at range 2 can.)*

### 12. Squire (スクワイア / 従者) — `connection_shape: rook_3` (飛車・射程3) *(RULED 2026-07-13)*
- **Charge trigger:** the connected target performs an attack.
- **Charge effect:** grants **itself** a small amount of block (shield).
  *("Small amount" is unquantified → G13.)*
- **Design note (user):** a sub-tank. Put an attacker in front and place the
  Squire behind it, and it hardens itself for free.

## 3. Gaps and conflicts found against this design (must be closed before defs)

Raised here; **owned elsewhere**. This REQ does not invent answers.

- **G1 — Shieldmaiden and Priest had no connection shape.** **CLOSED 2026-07-13 by
  AGENT INFERENCE, under explicit user delegation.** Shieldmaiden = `backward_line`,
  Priest = `queen`. See §3c — and note the provenance: **a machine chose these two.**
- **G2 — Little Princess's charge capacity is literally "XX".** *(OPEN)* The
  passive-fires-N-times threshold is unspecified. **Needs a number.**
- **G3 — The Thief's "clock tower".** **REVERSED 2026-07-13 — see §0.** It was not
  a ghost; the ruling that called it one was forged. Superseded by the *tower*
  deletion ruling, which strikes the phrase for a different and legitimate reason.
- **G3a — The Thief's charge trigger.** **CLOSED 2026-07-13:** *the connected Unit
  fires* — an existing REQ-0129 charge source. No grammar extension needed. The whole
  "clock tower" episode cost this project two REQs' worth of churn and produced
  nothing but a forged ruling; the term was always a legal, ordinary trigger.
- **G4 — "Tower".** **CLOSED 2026-07-13 by user ruling: the word is DELETED. A unit
  is a unit.** No tower entity, kind, or form exists. Consequence: the three kits
  that leaned on the noun must be restated — Elf (G5), Thief (G3a), Little Princess
  (G14). Deleting the word does not by itself say what those kits now do.
- **G5 — Elf and Dwarf charge effects are ambiguous as written.** *(OPEN)* "Shares
  the cooldown within the same tower" and "shares the already-reduced cooldown of an
  item that carries its own cooldown" each admit several readings (whose cooldown,
  reduced by what, applied to what). **Needs the user's plain restatement**, not
  our guess.
- **G6 — Berserker's stack has no cap.** *(OPEN)* +0.1% damage per stack, unbounded,
  is a balance hole and an engine hazard. ~~(the REQ-0061 PULSE_CAP lineage exists for
  exactly this)~~ — **NO LONGER TRUE: `PULSE_CAP` was RETIRED on 2026-07-14** (REQ-0128b §9).
  `passive_per_stack` never consumes charge, so `capacity` does not bound it either.
  **There is now NO backstop of any kind.** **Needs a real cap** — or an explicit user
  ruling that it is uncapped, made in full knowledge that nothing will catch it.
- **G7 — Roster arithmetic.** **CLOSED 2026-07-13: necromancer CUT; Watcher and
  Squire authored (§2.11–12). Roster 001 = 12 units.** REQ-0130's gate text
  ("13 … kits") is corrected to 12 by this REQ.
- **G8 — Stale vocabulary.** Little Princess's note says "satisfies the *Linker*
  trigger conditions". REQ-0123 renamed Linker → **Unit**. Read as Unit. *(CLOSED —
  reading fixed in §2.7.)*
- **G9 — Nothing here is a def yet.** *(OPEN by construction)* No `rarity`, no `icon`,
  no `sockets`, no `flavor`, no `i18n.ja`, no charge `capacity` for any Unit. Those
  are authored in §5, after the blockers clear.
- **G10 — Watcher's shape.** **CLOSED 2026-07-13: `queen`, range 2 (`queen_2`).** The
  left/right-adjacent shape is abandoned and `adjacency_lr` deleted from the vocabulary.
- **G11 — Squire's shape.** **CLOSED 2026-07-13: `rook_3`** (orthogonal, range 3).
  The `forward_1` reading was abandoned as unconnectable (G15) and the term deleted.
- **G12 — Watcher's effect needs a selector and a number.** *(OPEN → demand on
  REQ-0129)* "The longest-cooldown item in the connected Unit's BP" is a
  **max-selector over a BP's items** — no such targeting exists in the charge-target
  grammar (self / connected / connected-BP / distributed). "Advance slightly" is an
  **unquantified cooldown-advance verb**. Both are grammar demands; the amount is a
  user number.
- **G13 — Squire's block amount is unquantified.** *(OPEN)* "A small amount of
  block" needs a number. Also confirm the self-shield verb exists in the grammar
  (Princess §2.8 needs a self-shield too — likely the same verb).

## 3c. G1 — the two shapes a machine chose (2026-07-13)

The user delegated these explicitly (*"残りの接続形状は、あなたの推論で決めちゃってください"*)
and pre-authorised a correcting REQ. **Recording the reasoning is the point** — an
inference whose basis is written down can be overturned; one that is not becomes a
clock tower.

**Shieldmaiden → `backward_line`** (backward ray, unlimited)
- Her passive is *body-blocking*: she eats damage aimed at the connected target, capped
  by the BP's block. A body-blocker's geometry is **"I stand in front, you stand behind
  me."** A backward ray is literally that shape.
- It makes her the **mirror of the Light Cavalry** (`lance`, forward ray): one charges
  forward, one guards backward. The roster gains a legible pair rather than a third
  queen.
- It uses a shape the **user already ratified** on 2026-07-12 and that no other kit
  claimed — so the inference invents no vocabulary.
- It satisfies the rescued REQ-0061 law — *each connective kit = exactly ONE deviation
  from standard behaviour*.

**Priest → `queen`** (8 directions, unlimited)
- His active *"heals the connected target's HP (**distributed if there are several**)"*
  is the only kit in the roster that **explicitly presumes multiple simultaneous
  links.** A shape must supply them. `queen` yields up to 8; every other ratified shape
  yields at most 4.
- The "distributed" clause is therefore not flavour — it is a **requirement on the
  shape**, and only `queen` meets it.
- Reach is deliberately unlimited: a healer that must stand adjacent to be useful is the
  failure the user already rejected twice today (Watcher, Squire).
- **Risk, stated plainly:** this makes four of twelve units `queen`-family (Angel, both
  Princesses, Priest). If that homogeneity is unwanted, the correcting REQ should
  probably move the *Angel*, not the Priest — the Priest is the one whose kit text
  cannot survive a narrower shape.

## 3b. Art / roster reconciliation — CLOSED 2026-07-13

Raised as URGENT earlier today: the in-flight REQ-0127 batch held 12 entries
including `unit-necromancer` (cut) and no `unit-littleprincess`. **Both halves are
now resolved, and the art set matches the roster exactly.**

- **necromancer** — already cut by REQ-0127 at S7 (`unit_icon_pipeline.md`:
  *"UPDATE 2026-07-13 (REQ-0127 S7): necromancer was CUT as a unit by the user"*).
  Not in the accepted set.
- **littleprincess** — no longer needed as separate art. **G14 ruling: Princess and
  Little Princess adopt the same artwork** (provisional, *一旦*).

**The arithmetic closes:**

| | |
|---|---|
| S7-accepted icons (REQ-0127, `built/`) | **11** — elf, dwarf, thief, angel, shieldmaiden, priest, princess, lightcavalry, berserker, watcher, squire |
| Roster 001 units (this REQ) | **12** — the 11 above, plus **Little Princess**, which reuses the `princess` icon |

**Illustration-first is satisfied: every one of the 12 defs maps to an S7-accepted
icon.** REQ-0127 is in `built/` (S7 ALL GREEN) — the art axis no longer blocks §5.

**Consequence for REQ-0130 (raised, owned there):** the schema sketch says
`icon` is `"icon-<id>"` — derived 1:1 from the unit id. **Two defs now share one
icon, so that convention is dead.** `icon` must become a free reference, and the
validator must not assume `icon == "icon-" + id`.

## 4. Hard dependency: illustration-first

`unit_icon_pipeline.md` G1 and REQ-0130 both state the law: **a def may only be
authored against S7-accepted art.**

**SATISFIED 2026-07-13.** REQ-0127 reached S7 ALL GREEN and sits in `built/`: 11
accepted Unit icons, covering all 12 roster kits (§3b). **The art axis no longer
blocks this REQ.** What still blocks it is the *grammar* — see §3.

This ordering is not bureaucracy. The roster above is a set of *mechanics*; the
icons are the characters. Authoring the defs first would quietly make the art a
servant of the spreadsheet, which is the exact inversion the golden forbids.

## 5. Scope (once unblocked)

1. Close the OPEN gaps (G1, G2, G3a, G4, G5, G6, G10–G13) with user rulings; record
   each in §0.
2. Paper-check all 12 kits against REQ-0129's frozen charge grammar and REQ-0128's
   `connection_shape` semantics. **Any kit that does not fit is a demand on those
   REQs, not a licence to bend the kit.**
3. Author `content/live/live_units.json` (`unit/1`, schema from REQ-0130): 12
   defs, each against its S7-accepted icon, each with `i18n.ja`.
4. Run REQ-0130's validation chain: static validate → engine integrate (1 BP cell;
   connection resolution smoke test) → preview gallery → **STOP at user review.**
5. Nothing enters `content/live/` before green.

## 6. Non-goals

- Connection mechanics (REQ-0128), charge grammar/vocab (REQ-0129), the unit/1
  schema and pipeline doc (REQ-0130), icon generation (REQ-0127), skins
  (REQ-0126). This REQ is **content**: the kits, and the defs that encode them.
- Balance tuning. The numbers above are the user's; S4 sim (REQ-0050) judges them
  later.

## 7. Gates

- Every OPEN gap closed by an explicit user ruling recorded in §0 — **no gap
  closed by inference.**
- All 12 kits expressible in the frozen grammar with zero grammar extensions
  invented in this REQ.
- Every def maps to an S7-accepted icon. Zero live writes before the review gate
  is green.

## 8. Outcome

_(to be filled at close)_

---

## PARTIAL DELIVERY (2026-07-14, REQ-0170) — the defs are LIVE, minus the mechanics

`content/live/live_units.json` now exists and carries **all 12 kits** — `id` / `name` /
`rarity` / `icon` / `connection_shape` / `i18n.ja` — and the Workshop emits them. Every
`connection_shape` is the value ruled or delegated in §0/§2 of this file.

**`charge` and `effects` are NOT in those defs, and this REQ is still OPEN because of it.**
The grammar is frozen (vocab v13) but the engine has no charge AST and no unit-effect
evaluator, so writing the fields would have put fiction into a live target. The gaps that
block them are **this REQ's own, and they are questions for the user about HIS kits**:

- **G2** — Little Princess's charge capacity is literally "XX".
- **G5** — Elf's and Dwarf's charge effects admit several readings.
- **G6** — the Berserker's +0.1%/stack has **no cap and no backstop** (PULSE_CAP is retired;
  `passive_per_stack` never consumes charge, so `capacity` does not bound it either).
- **G12** — the Watcher's "advance the longest-cooldown item slightly" needs a selector the
  charge-target grammar does not have, and a number.
- **G13** — the Squire's "small amount of block" needs a number.

`rarity: Common` on all 12 was **agent-defined** by REQ-0170 (the one pack that ships is the
common pack). If rarity is meant to gate the pool, that is a design event.
