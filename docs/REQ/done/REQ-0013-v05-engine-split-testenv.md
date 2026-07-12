# REQ-0013: v0.5 — Engine/UI Split, Test Environment, Socket Model v2, Movable BPs, Chain-Link

- **Status**: Completed (live + 12/12 node tests green on server)
- **Date**: 2026-07-02
- **Owner**: orchestrator + designer subagent

## User rounds 5/6 applied
- **(a) Guard invisible after drop** — fixed; verified visually (guard renders in
  inventory and reseats). Root causes cleaned up in the rewrite; regression covered by
  the "guard lifecycle" node test. Related fix: self-occupancy (an accessory can be
  re-dropped onto its own socket).
- **(b) Socket types as their own system** — agreed and implemented as **socket model
  v2**: sockets carry a type AND their own socket-tags (independent from item combat
  tags). Accessory matching = type equality + required-tags ⊆ socket-tags. Host-type
  rules became structural (coat sockets exist only on Weapons).
- **(c) Icon regeneration on shape change** — binding rule recorded in PO golden.
  Designer subagent regenerated 5 icons (flame_tablet, oil_flask2, dagger2,
  herb_satchel, beast_jaw L-shape with empty top-left quadrant).
- **(d) Movable BPs** — drag a Linker or an empty Piece to move a whole BP with its
  contents. Beams/links/panels re-trace live. Overlap/out-of-canvas rejected.
- **(e) Testable dev environment** — architecture split:
  - Server `~/backpack_ragnarok/mock-src/`: `engine.js` (pure logic, browser+node),
    `data.js`, `ui.js`, `index.template.html`, `item_icons_all.svg`, `build.py`,
    `tests/run.cjs`.
  - **Primary test gate = node operation-emulation suite** (12 scenarios: placement
    integrity, socket/tag matrix, occupancy, guard lifecycle, rotation, moves &
    rejections, linked/unlinked assembly moves, BP relocation with beam re-trace,
    Ignite chemistry). Run: `cd mock-src/tests && node run.cjs`. Build:
    `python3 build.py` → `web/mock/index.html`. Chrome is for visual spot-checks only.
- **(mid-task) Blade-only-carried bug** → **chain-link toggle** at the assembly's
  top-right: LINKED moves Blade+Hilt as one (guard stays); UNLINKED moves parts
  individually. Verified live: unlink → hilt dragged to inventory alone, blade stayed,
  ruby auto-unseated with its host.

## Verification
- Server: 12/12 tests PASS, build 72KB, HTTP 200.
- Chrome: initial render (new icons incl. L-shaped Beast Jaw), guard→inventory visible,
  chain unlink → hilt-only drag correct.

## Ops rule added (user directive)
- **Subagent model policy: do NOT default to Fable.** Orchestrator stays on Fable;
  subagents get an explicit cheaper model (designer/research → sonnet; trivial → haiku)
  via the Agent tool's model parameter. Fable burns tokens too fast for delegated work.
