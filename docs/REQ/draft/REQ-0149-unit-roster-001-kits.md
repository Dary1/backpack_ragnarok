# REQ-0149 — Unit Roster 001 — kit design & def authoring

**Status:** Draft — the roster design below is USER-AUTHORED and binding, but it
is NOT yet authorable as defs. Blocked on REQ-0127 (S7-accepted art;
illustration-first law), REQ-0129 (frozen charge/trigger grammar), REQ-0128
(`connection_shape` semantics), REQ-0130 (unit/1 schema + validation chain).
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
- **Charge effect:** shares cooldown within the same tower with the connected Unit.

### 2. Dwarf — `connection_shape: rook` (飛車)
- **Charge trigger:** BP damage taken.
- **Charge effect:** shares, with the connected Unit, the *already-reduced*
  cooldown of an item that carries its own cooldown.

### 3. Thief — `connection_shape: knight` (chess knight)
- **Charge trigger:** ~~the connected clock tower fires~~ — **STRUCK 2026-07-13.**
  The clock tower does not exist (REQ-0129 ruling 2026-07-12, upheld 2026-07-13).
  **This kit currently has NO charge trigger. → G3a, awaiting the user.**
- **Charge effect:** steals cooldown from the connected Unit's cooldown-bearing
  items, and clears the cooldown on its own items.

### 4. Angel — `connection_shape: queen`
- **Charge trigger:** number of times damage was taken.
- **Charge effect:** reduces its own debuffs and the connected BP's debuffs by a
  percentage.

### 5. Shieldmaiden — `connection_shape: ` **(NOT GIVEN — see §3 G1)**
- **Charge trigger:** amount of damage received.
- **Charge skill:** immediately fires `Armor`-tagged items.
- **Passive:** takes damage on behalf of the connected target — **but only up to
  the BP's block value.**

### 6. Priest — `connection_shape: ` **(NOT GIVEN — see §3 G1)**
- **Charge trigger:** amount of damage the *connected target* received.
- **Active:** heals the connected target's HP (distributed if there are several).

### 7. Little Princess — `connection_shape: queen`
- **Charge trigger:** its passive fires **XX** times **(XX NOT GIVEN — §3 G2)**.
- **Charge effect:** becomes the **Princess Tower**.
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

### 11. Watcher (ウォッチャー / 見張り番) — `connection_shape:` **left/right adjacent cell** *(NOT IN THE REQ-0128 VOCABULARY → G10)*
- **Charge trigger:** its own cooldown (elapsed time).
- **Charge effect:** slightly advances the cooldown timer of the **longest-cooldown
  item inside the connected Unit's BP**. *("Slightly" is unquantified → G12.)*
- **Design note (user):** a general-purpose unit that does its job just by being
  dropped beside a tall or wide odd-shaped backpack. Also serves as a **hub** for
  wiring into other, stronger units.

### 12. Squire (スクワイア / 従者) — `connection_shape:` **1 cell forward** *(NOT IN THE REQ-0128 VOCABULARY → G11)*
- **Charge trigger:** the connected target performs an attack.
- **Charge effect:** grants **itself** a small amount of block (shield).
  *("Small amount" is unquantified → G13.)*
- **Design note (user):** a sub-tank. Put an attacker in front and place the
  Squire behind it, and it hardens itself for free.

## 3. Gaps and conflicts found against this design (must be closed before defs)

Raised here; **owned elsewhere**. This REQ does not invent answers.

- **G1 — Two Units have no connection shape.** *(OPEN)* Shieldmaiden and Priest are
  the only kits with no `connection_shape`. Both are *support* units whose whole kit
  is phrased in terms of "the connected target", so the field cannot be `none`.
  **Needs a user ruling.** (→ REQ-0128 vocabulary; ruling belongs to the user.)
- **G2 — Little Princess's charge capacity is literally "XX".** *(OPEN)* The
  passive-fires-N-times threshold is unspecified. **Needs a number.**
- **G3 — The Thief's "clock tower" is a ghost.** **CLOSED 2026-07-13: the 7/12
  ruling stands. The clock tower is not resurrected; the reference is struck.**
- **G3a — The Thief now has no charge trigger.** *(OPEN — created by the G3 ruling)*
  Striking the clock tower leaves the kit with a charge *effect* and no *source*.
  **The user must restate the Thief's charge trigger.** Not inferable: nothing in
  the roster implies what should replace it.
- **G4 — "Tower" is undefined.** *(OPEN)* It still appears in the Elf ("cooldown
  within the same tower") and in Little Princess ("becomes the Princess Tower") —
  the G3 ruling removed only the *clock* tower, not the word. No definition of a
  *tower* exists anywhere in the repo. If it is a Unit form/kind, form-change is
  exactly the charge-spend verb REQ-0129 already flagged it must express.
  **Needs a definition before the Elf and Little Princess can be authored.**
- **G5 — Elf and Dwarf charge effects are ambiguous as written.** *(OPEN)* "Shares
  the cooldown within the same tower" and "shares the already-reduced cooldown of an
  item that carries its own cooldown" each admit several readings (whose cooldown,
  reduced by what, applied to what). **Needs the user's plain restatement**, not
  our guess.
- **G6 — Berserker's stack has no cap.** *(OPEN)* +0.1% damage per stack, unbounded,
  is a balance hole and an engine hazard (the REQ-0061 PULSE_CAP lineage exists for
  exactly this). **Needs a cap** — or an explicit user ruling that it is uncapped.
- **G7 — Roster arithmetic.** **CLOSED 2026-07-13: necromancer CUT; Watcher and
  Squire authored (§2.11–12). Roster 001 = 12 units.** REQ-0130's gate text
  ("13 … kits") is corrected to 12 by this REQ.
- **G8 — Stale vocabulary.** Little Princess's note says "satisfies the *Linker*
  trigger conditions". REQ-0123 renamed Linker → **Unit**. Read as Unit. *(CLOSED —
  reading fixed in §2.7.)*
- **G9 — Nothing here is a def yet.** *(OPEN by construction)* No `rarity`, no `icon`,
  no `sockets`, no `flavor`, no `i18n.ja`, no charge `capacity` for any Unit. Those
  are authored in §5, after the blockers clear.
- **G10 — Watcher's shape is not in the vocabulary.** *(OPEN → demand on REQ-0128)*
  "Left/right adjacent cell" is *axis-restricted* adjacency. REQ-0128 ratified a
  generic `adjacency`, not a horizontal-only one. Either `adjacency` is parameterised
  by axis, or a new shape value is added. **REQ-0128 must rule; this REQ does not
  bend the kit.**
- **G11 — Squire's shape is not in the vocabulary.** *(OPEN → demand on REQ-0128)*
  "1 cell forward" is a *directed, single-offset* shape. REQ-0128 has `backward-line`
  but no forward single-cell shape, and "forward" presupposes a **board orientation**
  that REQ-0128 has never defined for Units. **REQ-0128 must rule** on (a) the shape
  and (b) what "forward" means on the canvas.
- **G12 — Watcher's effect needs a selector and a number.** *(OPEN → demand on
  REQ-0129)* "The longest-cooldown item in the connected Unit's BP" is a
  **max-selector over a BP's items** — no such targeting exists in the charge-target
  grammar (self / connected / connected-BP / distributed). "Advance slightly" is an
  **unquantified cooldown-advance verb**. Both are grammar demands; the amount is a
  user number.
- **G13 — Squire's block amount is unquantified.** *(OPEN)* "A small amount of
  block" needs a number. Also confirm the self-shield verb exists in the grammar
  (Princess §2.8 needs a self-shield too — likely the same verb).

## 4. Hard dependency: illustration-first

`unit_icon_pipeline.md` G1 and REQ-0130 both state the law: **a def may only be
authored against S7-accepted art.** No Unit icon exists — the Unit icon pipeline
has never been executed (REQ-0148 finding). So §5 **cannot start** until REQ-0127
produces art and the user accepts it at S7. As of 2026-07-13 REQ-0127 is still in
`todo/`; the user reports art is in flight.

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
