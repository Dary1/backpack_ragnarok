# REQ-0027 — T0.2: Client Edit Interactions + Save/Load

- **Status**: DONE (browser-verified)

## Outcome
Implemented (commits 1384e1f, 7db8343, 1fa47ce, 1ccf9d6) then fixed a critical
interaction-dead bug found by orchestrator Chrome verification (commits 2d262a3,
3cc2d6b): PixiJS v8 hit-testing was swallowed by decorative nodes (empty-but-truthy
hitTest results halt sibling search → art wrappers intercepted every pointer) AND
hit-testing depended on rAF ticker rendering (throttled in background tabs) —
fixed with eventMode='none' on all decorative nodes + synchronous renderer.render()
after scene rebuild; also removed the last Pixi deprecation warning.
Working now (agent-verified in real Chrome, a–f): dblclick rotate (+legal-only,
mock-parity reject), PO drag board/inventory with ghost + red-tint illegal preview +
revert, BP move via linker drag, SI seat onto socket, Save/reload/Load round-trip.
Save contract = bare makeState() shape, interchangeable with mock (curl-verified).
Default profile confirmed restored to scenario state after tests.
Known cosmetic gaps (T0.3 backlog): inventory cards are text-only (no icons),
no board-side hover tooltips (panel only), dblclick = 300ms heuristic,
inventory-side rotate is a no-op stub.
- **Date**: 2026-07-04 (orchestrator gen2)
- **Basis**: T0.1 (REQ-0026) live; user "どうぞ".

## Scope — interaction parity with the mock, on /app/
The mock (web/mock/) is the behavioral reference; engine stays shared and unforked.
- Drag & drop: PO between inventory ⇄ board; move on board; engine legality (occupancy,
  one-BP containment, port/socket recalc) — illegal drops rejected visually (ghost +
  red tint), Esc cancels.
- Double-click: rotate clockwise (engine rotation legality).
- Drag linker core or empty BP cell: move the whole BP (links recalculated live).
- SI drag onto a PO socket: seat/unseat (socket-type hierarchy gating via engine).
- Connection ◇/◆, beams, assembly (mergeSword) visuals update live during/after edits.
- Save/Load buttons (header): /api/profile/default/canvas, same state shape as the mock
  (makeState) so mock and client profiles stay interchangeable.
- Tooltips reflect current state (assembled/connected effects where mock does).

## Non-goals
Combat playback, presets/multi-profile, auth, mobile input, undo/redo.

## Gate
tsc clean; vite build; /app/ 200; engine 18/18 + API 9/9 untouched; check:sprites 21/21;
orchestrator Chrome verification of each interaction; commits per logical unit.
