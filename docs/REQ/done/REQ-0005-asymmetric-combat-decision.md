# REQ-0005: Asymmetric Combat Decision (No Enemy Backpacks, No PvP)

- **Status**: Completed
- **Date**: 2026-07-02 (golden review round 2)
- **Owner**: orchestrator (recording user decision)

## Decision (user)
1. Enemy monsters do **NOT** have backpack systems.
2. Human-vs-human combat is **not assumed, ever** (PvP explicitly out).
3. Architecture consequence: only enemies carry their own combat algorithms
   (bespoke stats/behaviors); the player-side system contains **no enemy-backpack
   logic** of any kind. Combat is fully asymmetric: player canvas vs enemy algorithm.

## Rationale (user)
- Monsters operating on a system mirrored from the player's is not enjoyable.
- Symmetric enemies would make fine-grained enemy tuning difficult.

## Effects on Existing Docs
- `second_golden.md` → v0.3: §6 v0.1 "enemy backpacks" concept (inspect / counter-arrange /
  loot from packs) CUT; §12-Q1 resolved as PvP-out.
- `worldview_ragnarok_tentative.md`: consistent — at Ragnarok, Einherjar fight purchased
  monsters (non-backpack entities), never each other.

## Engineering Notes (for future implementation)
- Enemy model: simple tunable entities (HP, attack patterns, timers, telegraphs).
  Design enemy data as flat, designer-editable definitions — tuning ease was the point.
- Clash resolution = player canvas output stream vs enemy pattern script. Keep the two
  sides in separate modules with a narrow interface (damage/status events only).

## Next
- Awaiting the user's Canvas system draft (next turn) → REQ-0006 canvas spec consultation.
