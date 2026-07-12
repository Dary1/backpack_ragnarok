# REQ-0128 — unit-connection-mechanics

**Status:** draft — blocked on user ratification of the remaining geometry
rules and per-unit kits (open decisions below)
**Reserved:** 2026-07-11
**Slug:** unit-connection-mechanics
**Ordering:** independent of the rename program (user ruling 2026-07-12:
this change "could have happened under the old Linker system"); sensibly
lands after REQ-0124 so it is built in the new vocabulary.

## Background (user decisions, 2026-07-12 chat)

Connections move from always-queen 8-direction beams to **per-unit connection
shapes**: bishop (角), rook (飛車), lance (香), queen, knight (桂-like fixed
offsets), adjacency, backward-line, none. Ratified rules:

- Links are **Unit-to-Unit**.
- Ray-type connections keep the **first-hit rule** (first Unit on the ray).
- One-sided connections are valid; mutual links remain possible.

## Scope

- Engine: connection resolution in the sim — ray patterns (reuse the shipped
  beam machinery from REQ-0048/0079), fixed-offset patterns (new), adjacency
  patterns (new); link graph construction; mutual-link detection.
- Client: connection visualization overlays (shape preview on placement,
  established-link rendering). Overlay art is data-driven (unit icon golden
  G2 — never baked into icons).
- Content schema: `connection_shape` field on unit defs (schema only; def
  authoring is REQ-0130 territory).

## Open decisions (need user ruling before todo)

1. **Ray occlusion:** old Linker beams passed over everything until the first
   Linker. Keep (recommended: preserves first-hit semantics), or let BPs/POs
   block rays shogi-style (deeper P1, worse P2 legibility)?
2. **Knight/adjacency targeting:** knight = exact target cell must contain a
   Unit (consistent with Unit-to-Unit)? Adjacency = unit-cell adjacency, or
   BP-footprint adjacency (the Watcher's "置くだけで仕事をする" reading)?
3. **Field scope:** connections resolve canvas-local (within one Squad) only,
   or may they cross Squad zones on the shared battle field?
4. Per-unit kit ratification happens per roster batch (REQ-0130), not here —
   this REQ ships the mechanics, not the kits.

## Rescued prior art (from REQ-0061, 供養 2026-07-12)

The pulse-walk law set of REQ-0048/0061 is the deterministic baseline this
REQ must either ADOPT for Unit Links or EXPLICITLY RETIRE, law by law —
silence is not allowed: PULSE_CAP; visited-set; hop 