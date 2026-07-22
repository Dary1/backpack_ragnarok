# REQ-0284 — Monitor mount freeze hotfix (unit-less BP crashes /schedule Watch)

**Status:** Reserved
**Reserved:** 2026-07-22
**Slug:** monitor-mount-freeze-hotfix
**Regression of:** REQ-0283 (client-only, merge eaf7610) — the seatCell/unitId transform.

## Regression (owner report, live, backpack-dev /app/#/schedule)
Pressing **Watch** shows the feed empty state ("The troop is forming up…") and
then the whole Watch view hard-locks / blanks (owner: "hard UI lock, smells like
an infinite loop"). Appeared immediately after the REQ-0283 deploy. The e2e suite
(194/196) did NOT catch it because every fixture squad seated a Unit on EVERY BP.

## Root cause (exact)
`client/src/schedule/Monitor.tsx:167` — the REQ-0283 squad→MonitorSquadVisual
transform read the seated Unit UNCONDITIONALLY:

    unitId: bp.unit.id, seatCell: [bp.origin[0] + bp.unit.off[0], bp.origin[1] + bp.unit.off[1]]

`BP.unit` is typed non-optional (shared/engine.d.ts), but real stored canvases can
omit it: a BP need not seat a Unit. The owner's active squad fields exactly such a
BP — a bare 3×6 "wall" BP with **no `unit`** (data/profiles/dev.json). At monitor
mount `bp.unit` is `undefined`, so `bp.unit.id` throws
`TypeError: Cannot read properties of undefined (reading 'id')` inside the
`room.slots.map(...)` of the mount `useEffect`. There is **no error boundary
anywhere in the client**, so the uncaught throw tears down the React root — the
entire Watch view goes blank (the "freeze"). It is a synchronous THROW, not a
compute loop: a headless Pixi harness proved `composeSquad` completes in 1–2 ms
even with a NaN seat cell, ruling out the suspected compositor/poOutline/skin loops.

## Why e2e missed it
Every schedule-fixture squad (and squad 9, the REQ-0045 (d) multi-BP case) seats a
`berserker` Unit on every BP, so the unit-less branch was never exercised.

## Fix (minimal, cell-faithful — no lanes/washes reintroduced)
1. `Monitor.tsx:167` — the actual bug: treat a unit-less BP as unit-less. Emit
   `unitId: undefined` and `seatCell: undefined`; `squadCompositor` already draws
   such a BP as its bare cells (fill + POs, no seat disc/icon/skin) — nothing is
   displaced. Guards `bp.unit` and non-finite `origin + off` before building the
   seat cell.
2. `board/squadCompositor.ts` `drawUnitSeat` — hardening: skip the seat marker for
   a non-finite seat cell (NaN/Infinity from a malformed `unit.off`) instead of
   pushing NaN geometry into Pixi.
3. `board/poOutline.ts` `boundaryLoops` — hardening: a HARD step budget (bail +
   `console.warn` + partial result) on the boundary-walk loops, so a malformed /
   degenerate footprint can never spin the main thread (defense-in-depth for the
   whole "data-driven loop" class the report worried about).

## Regression test
`client/e2e/schedule.spec.ts` — new REQ-0284 spec: fixture preset **10** is a
squad with a `berserker` fighter BP **plus** a bare unit-less "wall" BP; deploying
it and expanding the monitor asserts `__monitorDebug[room].squads()` returns (mount
did NOT throw), the wall BP is present with **no** seat (unitId/seatCell absent),
and the fighter BP keeps its seat. Fails on the pre-fix bundle (page blanks →
squads() never populates), passes after the fix.

## Gates
tsc -b, oxlint, check_po_outline.mjs, scoped schedule e2e (decade 284) incl. the
new regression — all green.


## Deploy (2026-07-22)
- Merge 1d853b5 (--no-ff) into master; client bundle rebuilt in the main checkout.
- Bundle hash: index-C6UPg4kD.js -> index-CUfhEA_S.js (build commit 5aa2db2).
- Verified: /api/health {ok:true} on :8802 (NO api restart -- server/ unchanged);
  web :8801 and public https://backpack-dev.qtie.jp/app/ both serve
  index-CUfhEA_S.js; live boot smoke (playwright, read-only) -- React root mounts,
  no pageerror.
- Fix proof: scoped schedule e2e REQ-0284 regression (fixture preset 10: berserker
  fighter + unit-less wall BP) is GREEN post-fix; the pre-fix live bundle threw
  "Cannot read properties of undefined (reading 'id')" at monitor mount and blanked
  the whole Watch view (trace-captured).
