# REQ-0167 — P5 guardrail reword (user's ratified wording)

**Status:** done — merged to master (8bcb864) and deployed 2026-07-14 (docs-only; no service restart).
**Reserved:** 2026-07-14
**Slug:** p5-guardrail-reword
**Follows:** REQ-0166 (which shipped the orchestrator's draft wording)

## Trigger

User, 2026-07-14 chat, replacing REQ-0166's P5 sub-bullet verbatim:

> A Squad Canvas is the vessel; strength always derives from the units' contents and
> arrangement, never from the Unit alone.

## What changed and why it matters

REQ-0166 shipped *"A **Unit** is the vessel; strength always derives from the **pack's**
contents and arrangement…"*. The user's wording moves the vessel **up one level**:

- The vessel is the **Squad Canvas**, not a Unit and not a single pack. The unit of
  design is the whole 8×8 field — every BP on it, every Unit seated in those BPs, and
  the link topology between them.
- Strength derives from the **units'** (plural) contents and arrangement — a Squad's
  power is a property of the *set* of Units and how they are laid out, not of any one
  pack in isolation.
- The closing clause is unchanged: **never from the Unit alone.** A Unit contributes
  identity and connection topology; it is never raw power.

This is the sharper statement of P5 (The Unreplicable Self): if the vessel were the Unit,
builds would converge on best-in-slot Units. Because the vessel is the Canvas, the
unreplicable thing is the arrangement.

## Applied

- `docs/user_managed/game_golden.md` — the P5 sub-bullet replaced with the wording above,
  verbatim.
- `docs/llm_managed/user_managed_rename_suggestions.md` — §3.4 flipped from "OPTIONAL /
  proposed" to "APPLIED", carrying the user's ratified text (the file is the record of
  what the goldens now say).
- `docs/REQ/done/REQ-0166-*.md` — **not** rewritten. It is history and correctly records
  what it shipped; this REQ is the amendment.

## Gates

- game_golden.md's P5 block contains the user's sentence byte-for-byte.
- No other golden line touched; docs-only change, no code gate, no service restart.
