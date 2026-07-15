# REQ-0190 — unit-instance-rolled-values: a Unit's charge numbers are ROLLED PER INSTANCE, not fixed on the def

**Reserved:** 2026-07-15
**Slug:** unit-instance-rolled-values
**Requested by:** user, 2026-07-15 (chat) — raised while answering REQ-0129 §8.
**Status:** reserved — spec written, NOT ratified. See §6 (open questions) before promoting.

**Numbering note (orchestrator error, recorded not hidden):** REQ-0189 was reserved for this
work and then BURNED — the allocator was run a second time from a different worktree, issuing
0190. Per PROJECT.md abandoned reservations permanently burn a number and gaps are normal;
0189 was not hand-recovered because hand-editing REQ numbers is forbidden. The gap at 0189 is
mine.

## 1. How this was found

REQ-0129 §8 listed five numbers its charge grammar could not supply, each marked as the
user's to give. Asked for them on 2026-07-15, the user answered — and **every single answer
was a RANGE that varies per gacha roll**, not a number:

| REQ-0149 gap | the user's answer, VERBATIM |
|---|---|
| **G2** — Little Princess `capacity` | 「最低値20最高値50 (ガチャ変動)」 |
| **G6** — Berserker stack cap | 「100-500(ガチャ変動)」 |
| **G13** — Squire block amount | 「3。HPの2%-4%(ガチャ変動)」 |
| **G5** — Elf cooldown share | 「elf shares cooldown of the items in the inventory to the items in inventories of connected units evenly. **(min 50% share max 100% share)**」 |

Four for four. This is not a slip; it is a design model the REQs had not written down.

**G12 (Watcher — "slightly advances the cooldown timer") remains UNASKED/OPEN** and, on this
evidence, is very likely a range too.

## 2. The finding, stated exactly (source-verified 2026-07-15)

The frozen v13 grammar **cannot express any of those answers.**

- `content/vocab.json` `charge._doc`: *"A unit def carries `charge: {trigger, gain, capacity,
  spend}`"* — **`capacity` is a SCALAR on the DEF.** One def, one number, shared by every copy
  of that unit that ever drops.
- `server/services/gacha.cjs` `rollPackBp()` rolls: the BP **polyomino shape**, the **seat
  index**, the **unit pick** (`pickWeighted`), and the **bonus slots** (`rollPackBonuses`).
  It does **NOT** roll any per-instance unit stat. The rolled BP references its unit by **id**;
  the numbers come from the def at read time.

So "min 20 max 50, varies by gacha" has **no field to live in and no code to roll it**.

## 3. What the user is actually describing

Two units of the same def are **not identical**. A def declares a RANGE; the gacha roll picks
this instance's value from it; that value belongs to the **instance**, travels with the BP, and
is what the sim reads. This is ordinary loot-game variance (the same idea as the BP shape roll,
which the gacha already does per instance) — but for charge numbers.

## 4. Why this is not a quiet edit to REQ-0129

REQ-0129 §6 defines its freeze precisely: growing the vocabulary is a **DESIGN EVENT**, *except*
where the user delegated growth — §4 (`triggers_closed: false`) and §5 (`targets_closed: false`).
**Neither delegation covers `capacity`'s value model.** `spend_closed: true`.

Changing a scalar into a rolled range is therefore a design event, and it is bigger than the
vocabulary: it reaches the unit schema, the gacha, instance persistence, the sim and the Dex.
REQ-0129's own history is the argument for raising it as its own REQ rather than absorbing it —
that REQ exists because an agent once closed a debt by inventing the authority to close it.

## 5. Scope (to be specced properly once §6 is ruled)

- **`unit/1` schema + `charge` grammar (v14):** `capacity` (and the Berserker cap, and any
  effect magnitude) become a declared range. Shape TBD — `{min, max}` vs a named roll spec.
  Every effect magnitude the user quoted is a range, so the range likely belongs on the
  **effect/param**, not only on `capacity`.
- **Gacha roll:** `rollPackBp()` rolls each declared range **from a dedicated sub-stream of the
  same master seed**, exactly as `rollPackBonuses` already does — the REQ-0058 sealed-seed
  contract must hold: one seed ⇒ one identical BP, values included.
- **Instance persistence:** the rolled values are stored on the BP/unit instance. This is a
  storage shape change (`storage.cjs` is the only persistence chokepoint).
- **Sim:** reads the INSTANCE value, never the def's range.
- **Dex / contentadmin display:** a def shows a RANGE; a held unit shows ITS value.
- **Registry/back-compat:** existing rolled BPs carry no rolled values. Ruling needed (§6).

## 6. Needs a ruling BEFORE this is cleared

1. **Distribution.** Uniform over the range? Weighted? Rarity-linked (a Relic pack rolls
   nearer the max)?
2. **Granularity.** Integers only (capacity 20–50), or fractions (Elf's 50–100% share,
   Squire's 2–4% of HP)?
3. **Existing BPs.** Units already rolled and held by players have no instance values. Do they
   (a) re-roll on read, (b) take the range's midpoint, (c) take the min, or (d) is a wipe
   acceptable? **The honest answer may be (d) — this is pre-release — but it is the user's.**
4. **Visibility.** Does the player SEE the rolled value (it is a reason to re-roll a pack), or
   is it hidden? This decides whether the Workshop/Dex need UI.
5. **Scope of the model.** Is this charge numbers ONLY, or the beginning of rolled stats for
   POs/SIs too? A grammar that answers only the first will be reopened by the second.

## 7. Non-goals

- Authoring the roster defs (REQ-0149 owns the kits).
- REQ-0129's G12 (Watcher) — ask it with the rest once this model exists.
- The engine's charge AST (`charge._status`: "RATIFIED, NOT IMPLEMENTED"), which no REQ owns yet.

## 8. Consequence for REQ-0129 and REQ-0149

- **REQ-0129 sits in `todo/` but is BLOCKED**, and this REQ is why: its §9 paper-check gate
  ("NOT green and must not be reported as green") cannot close until the kits have numbers, and
  the numbers need a model that does not exist. By PROJECT.md (blocked on an unresolved
  dependency) it belongs in `draft/`. Flagged to the user 2026-07-15; not moved unilaterally.
- **REQ-0149's G5 is closable independently of this REQ's number problem.** The user's
  restatement is now on the record (§1) and it is NOT what the REQ assumed. The struck text was
  *"shares cooldown within the same tower **with the connected Unit**"*; the surviving clause
  was always "with the connected Unit", so the orchestrator proposed that G5 was a false alarm
  in the Thief/G3a pattern. **That inference was WRONG and the user corrected it:** the Elf
  shares the cooldown of the items in **its OWN inventory** out to the items in the inventories
  of **connected units**, **evenly** — a distribution outward, not a share with one Unit, and
  materially different from the Dwarf. Recorded here so the correction is not lost; G5's closure
  belongs to REQ-0149.
