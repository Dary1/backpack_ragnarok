# REQ-0012: Interactive Mock v0.4 — New Roster, Inventory, Drag, Socket/Tag Matching

- **Status**: Completed (live, interaction-verified)
- **Date**: 2026-07-02
- **Owner**: orchestrator

## User instructions applied
1. Apply the approved 1x1→Accessory migration ("accessories are sockets" confirmed).
2. Add an **Inventory space** (parked items take no effect).
3. Make canvas items **movable by the user** — key alignment check: **tag and
   socket-type matching**.
4. (Mid-task addition) **Rotation via double-click / double-tap, clockwise.**

## Roster (PO golden v1.3)
- POs (no 1x1 fillers): Blade 1x2 + Hilt 1x1 (part; inert alone — justified exception),
  Flame Rune Tablet 1x2, Oil Flask 1x2, Dagger 1x2 (edge+coat sockets), Herb Satchel
  1x2, Tower Shield 2x2, **Beast Jaw L-tromino** (hard-fit piece; edge+coat sockets).
- Accessories: Ruby Gem (gem), Frost Orb (gem), Whetstone (edge, **requires host tag
  Metal**), Arrowhead (edge, no req), Poison Coat (coat, **requires host type Weapon**),
  Guard (bond; unseats to inventory when disassembled).
- Socket types: gem ◆ / edge ▷ / coat ● / bond ▭. Match rule: slot type equality AND
  host tag/type requirement. Sockets drawn diegetically; empty = dashed indicator.

## Implementation
- State-driven renderer (single SVG: 6x6 canvas + inventory strip). Hold-drag moves
  POs/accessories (green/red target feedback + reason tooltip); drop on inventory
  stows; Esc cancels; double-click rotates CW (in place if it fits, red flash if not);
  live combo recomputation (Assembled/Ignite/Flaming Blade/Pack Instinct);
  BP PO-counts live. Linkers immovable. Beams static.

## Verification (Chrome, on live site)
- Whetstone → Beast Jaw edge socket: **rejected** (host lacks Metal) — stays in inventory ✓
- Whetstone → Dagger edge socket: **seated** {po:p5,si:0} ✓
- Double-click oil flask: rot 0→1 ✓ (fixed two bugs: pointerup re-render destroyed
  dblclick target; `preventDefault()` on pointerdown suppressed derived dblclick events)
- Herb Satchel dragged canvas → inventory: loc='inv' ✓
- Live combos correct throughout ✓

## Notes / TODO
- Beast Jaw uses per-cell fang art; proper L-shaped icon = designer task later.
- Rotated flame tablet display: icons letterbox uniformly (acceptable at mock stage).
- PO golden §8 updated to v1.3 roster (see doc).
