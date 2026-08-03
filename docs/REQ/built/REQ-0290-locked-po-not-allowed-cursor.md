# REQ-0290 — seat-cell X cursor; fixed-interior affordances (🔒, no grab)

## Status
built 2026-08-03 (all gates green; see the implementation log at the foot of
this file). Was: todo (ratified 2026-07-22; design finalized by user rulings
below).
Reserved 2026-07-22 on branch `req-canvas-inventory-ux-spec`. The slug
(`locked-po-not-allowed-cursor`) reflects the FIRST draft; the ratified
design moved the X to the seat cell — slug kept (never hand-edit REQ ids).

## Origin (user directive, 2026-07-22, chat — verbatim)
「POが固定化されているUnitの上にマウスカーソルがある場合、Xにカーソルをして
ください。動かせない、回転させられないことを明確にしてください。」

## Rulings (2026-07-22, chat — verbatim, binding)
1.「「POが固定化されているUnit」の中のPOには、Xは不要です。なぜなら回転も移動も
できないからです。固定Unit自体は、回転と移動が可能です。ですので、同様にX
カーソルは他のユニット同様、Unit Artのマスに表示してください。」
2. Option ratified: "X固定・不活性" — ALL units' seat cells show X and are
   inert; BP drag/rotate consolidates on the ✥ button + empty cells.
3. Fixed-PO presentation ratified: default arrow + persistent 🔒 glyph
   (no not-allowed cursor on POs).
Reading of record: the X on the SEAT CELL states a Unit piece can never be
moved/re-seated (its seat is stamped at mint — canvas_spec law, true for
EVERY unit); interior fixed pieces show no grab affordance at all.

## Current state (verified)
- Seat-cell core: `cursor='grab'`, pointerdown -> `handleBPPointerDown`
  (BoardRenderer.ts ~L1016-1018) — core is a BP drag handle + dblclick-
  rotate trigger today.
- Other BP handles: ✥ badge (~L552-565) and empty BP cells (~L578-588),
  both -> handleBPPointerDown. These REMAIN the handles after this REQ.
- Fixed POs: hit rect `cursor='grab'` (~L800) despite `p.fixed`; refusal
  only surfaces post-click (short-circuit + red flash, ~L1312-1315).
- Seated SIs in locked BPs: `cursor='grab'` (~L1220) though unseat is
  engine-refused (engine.js seatSI/stow guards `why:'locked unit'`).

## Design (binding)
1. **Seat cell = X, inert (ALL units, both boards).** The unit core's hit
   object keeps `eventMode='static'` solely so `cursor='not-allowed'`
   renders; its `pointerdown` wiring (drag AND the dblclick-rotate path
   through it) is REMOVED. Unit art/disc keep drawing exactly as today.
   Unit-less BPs (live walls, REQ-0284): nothing to do (no core drawn).
2. **BP drag/rotate entry points** are the ✥ badge (pointerdown-drag /
   dblclick-rotate) and empty BP cells — mechanics unchanged, minus the
   core. Order-free with REQ-0289 (the badge exists since REQ-0042; 0289
   only moves it to the seat's top-left corner).
3. **Fixed POs (`p.fixed`).** Hit rect cursor = DEFAULT (no 'grab', no
   'not-allowed' — ruling 1). Persistent 🔒 glyph: 9px Text, fill
   `#f2fbff`, alpha 0.85, inside the TOP-RIGHT corner of the footprint
   bbox, drawn into `gBadges`, `eventMode='none'`; if REQ-0287's ribbon
   occupies that corner, nudge the padlock one cell-corner inward
   (deterministic offset — whichever REQ lands second implements the
   nudge). Existing pointerdown short-circuit + red flash stays.
4. **SIs seated in locked-BP-hosted POs.** Cursor = DEFAULT; pointerdown
   short-circuits with a red flash on its cell (mirror of the fixed-PO
   guard — the refusal stops being a drop-time surprise). No glyph.
   Engine surface: export `poInLockedBP(st, po)` + the page-container twin
   (engine.js ~L164-172 / ~L939) on the engine API + shared/engine.d.ts so
   the client never re-derives lock topology.
5. **Non-goal — do NOT over-lock.** BP move/transfer and (Unit-pivot)
   rotation remain LEGAL on locked starter units (REQ-0209 design). The ✥
   badge and empty-cell handles keep `cursor='grab'` everywhere.

## Implementation notes
Client + engine-surface export only; no behavioral engine change. e2e
specs that use the CORE as a drag/rotate handle (bp-rotate/bp-transfer et
al.) must switch to the badge or an empty cell — each change annotated.

## Gates
- `ci.sh` green; engine tests: exported poInLockedBP parity with the
  internal predicate (canvas + page).
- e2e on decade **7900-7909** (`e2e_harness_req 0290 …`), starter-squad
  fixture, probe seam `cursorProbe: {uid|'seat:'+bpId, cursor}[]`:
  seat cells 'not-allowed' on EVERY unit (starter and normal); fixed POs
  default; badge + empty cells 'grab'; pointerdown on core does nothing
  (no carry, no rotate); pointerdown on locked-seated SI: no carry +
  flash; padlock exactly once per fixed PO.
- Screenshots under `web/preview/req-0290/`.

## Dependencies
Order-free with REQ-0289 (badge position) and REQ-0287 (corner nudge).

---

# Implementation log (2026-08-03, orchestrator session)

Branch `req-0290-locked-po-not-allowed-cursor`, forked from master `c1b34a2f`.

## Summary

All five binding design items landed as specified. Nothing in the ratified
design was renegotiated; the two deviations below are both places where the
spec's *procedure* had gone stale since it was written on 2026-07-22, not
places where its *design* changed.

| Design item | Where |
|---|---|
| 1. Seat cell = X, inert, ALL units, both boards | `BoardRenderer.ts` unit-core block: `cursor='not-allowed'`, `eventMode='static'` kept (a Pixi hit object is what carries a cursor), `pointerdown` wiring DELETED — and with it the dblclick-rotate path that ran through it |
| 2. Badge + empty cells remain the BP handles | unchanged; both now publish `cursor:'grab'` to the probe so the "do not over-lock" rule is asserted, not assumed |
| 3. Fixed PO: default arrow + persistent 🔒 | `hit.cursor = p.fixed ? 'default' : 'grab'`; 9px Text, `#f2fbff`, alpha 0.85, top-right of the footprint bbox, `gBadges`, `eventMode='none'` |
| 4. Locked-hosted SI: default arrow, never lifts | socket block reads `ops.poInLockedBP(state, hostPo)`; pointerdown short-circuits with `flash()` on its cell, mirroring the fixed-PO guard. Tap-to-inspect deliberately untouched |
| 5. Do NOT over-lock | badge/empty cells keep `grab` on locked starter units; asserted per-board in the new spec |

**Engine surface.** `poInLockedBP` / `poInLockedBPIn` were already module-locals
(REQ-0209) and are the very functions `seatSI`/`stowSI` refuse through. Only the
export list and `shared/engine.d.ts` changed — no logic, no call-site change, no
behavioural change. `boardOps.ts` gained one delegating query so BoardRenderer
never re-derives `cellBPMap -> bp.locked` for itself.

**Probe seam.** `client/src/board/cursorProbe.ts`, copied in shape from
REQ-0287's `usageRibbonProbe.ts`, exposed as `__backpackDebug.cursorProbe(boardKey)`.
It records the cursor the renderer ASSIGNED, per object, per render. A board is
one `<canvas>` with one live cursor, so the alternative — walking a real mouse
cell by cell — is both slow and unable to distinguish "no hit object here" from
"a hit object that sets the default arrow", which is precisely the distinction
ruling 1 turns on. `lock:<poUid>` entries (value `'inert'`, not a CSS cursor —
the glyph is `eventMode:'none'`) exist so the padlock can be COUNTED.

## Corner arbitration with REQ-0287 (the nudge this REQ deferred)

The spec said "if REQ-0287's ribbon occupies that corner, nudge the padlock one
cell-corner inward — whichever REQ lands second implements the nudge". REQ-0287
is live, so this REQ implemented it, and had to make it total: "one cell-corner
inward" has no referent on a 1x1 fixed PO. Deterministic rule, always landing
inside the footprint bbox: one cell LEFT if the footprint has a second column,
else one cell DOWN if it has a second row, else inset by the ribbon's own 16px
leg. Only the shared (`tr`) ribbon contends; REQ-0287's self ribbon is a `tl` wedge.

## e2e migration — every spec that grabbed a BP by its seat

The spec anticipated `bp-rotate`/`bp-transfer` "et al."; the real set was six
files. Each grab moved to the ✥ badge, annotated in place:

| Spec | Note |
|---|---|
| `bp-rotate` | 2 rotate triggers re-pointed at the badge; the 4x-identity loop's per-iteration recomputation now derives the badge cell from the shape's own min-row/min-col instead of `unit.off` |
| `bp-transfer` | 6 grabs; seat and badge share a cell in every fixture here, so `grabOff` — and every assertion — is unchanged |
| `bpskin-composite-cache` | 1 grab. Its header comment claimed "every one of its cells is an empty-cell grab handle"; the seat cell never was one (the empty-cell loop skips it via `unitMap`). Comment corrected |
| `reference-model` | 3 grabs. **The only place the drop also moved.** `homebp` seats its unit at off `[2,0]`, so seat and badge are DIFFERENT cells; `grabOff = grabCell - origin` went `[2,0] -> [0,0]`, and each drop absorbed exactly that: `(7,1) -> (5,1)`. Landing origins, and therefore all assertions, unchanged |
| `workshop` | 2 grabs. **Pre-existing defect found:** the test is named "dragging the top-left move-handle badge" and its comment says badge, but it pressed `cx/cy` — the cell CENTRE, i.e. the unit core. It passed only because the core was also a handle. It now presses the badge, which matters here more than anywhere: this fixture covers every legally coverable cell, so empty-cell handles do not exist and the badge is the only affordance left — exactly the scenario the test claims to cover |
| `locked-affordances` (new) | 5 tests, described below |

## New spec — `client/e2e/locked-affordances.spec.ts`

Fixture: a `locked:true` BP hosting a `fixed:true` PO with an SI seated on it,
PLUS an ordinary unlocked BP, mirrored onto inventory page 0 — so "EVERY unit,
not just the locked one" is a real assertion rather than a single-case
coincidence. Tests: (1) seat `not-allowed` + badge/empty-cell `grab` on both
boards; (2) pointerdown on a seat neither carries nor rotates; (3) the badge
still rotates, so the handles that remain genuinely work; (4) fixed PO default +
exactly one padlock + does not move; (5) locked-hosted SI default + stays seated.

Test (5) computes its grab point from `socketScreenPos`' own maths (`box + (ax*W0,
ay*H0)`; hilt's gem socket is ax 0.5 / ay 0.81 — `content/live/live_items.json`).
Using the cell centre would miss the SI's r=15 hit circle by ~25px and land on
the host PO instead, which would have made the test pass for the wrong reason.

## Deviations from the spec as written (both procedural, neither a design change)

1. **Ports.** The spec says "decade **7900-7909** (`e2e_harness_req 0290 …`)".
   Both halves were superseded by **REQ-0323** (rental port desk) before this
   REQ was implemented: decades are no longer derived from a REQ number, and
   `e2e_harness_req` was renamed `e2e_harness_name`. PROJECT.md is explicit —
   "Ports ALWAYS come from the port desk; never hand-pick, never derive from a
   REQ number" — so runs leased their decade from `tools/e2e_ports.sh`. Nothing
   about the coverage changed. REQ-0288/0289/0291 carry the same stale sentence
   and will need the same reading.
2. **Fixture.** "starter-squad fixture" is realised as a hand-written
   `locked:true` + `fixed:true` profile PUT rather than a CLI-minted guest
   (`starter-units.spec.ts`'s rig). Same law under test, no guest-registry
   side effects, and it let the ordinary-unit control live in the same fixture.

## Gates

- **`tools/ci.sh`: CI GREEN**, ~350s, scope=both, run on this worktree against
  the exact tree that was then committed. The receipt tree hash is recorded in
  the commit message rather than here: writing the hash into this file would
  change the very tree it attests.
- **Engine tests** (`mock-src/tests/run.cjs`): **126 passed, 0 failed**, incl. 3
  new REQ-0290 cases pinning the exports to the BEHAVIOUR they mirror (the
  refusal the engine already performs) rather than to a second copy of the
  logic — canvas, page, and canvas/page parity across a locked/unlocked/locked
  cycle.
- **e2e**: **217 passed, 1 skipped** in the default suite. Master's baseline is
  212 passed / 1 skipped (REQ-0362's recorded figure), so this is baseline plus
  the 5 new `locked-affordances` tests, with no test lost to the migration.
- `tools/check_engine_types.cjs`: OK.
- Client typecheck + build: clean.
- **Screenshots**: `web/preview/req-0290/{before,after}-canvas.png`, shot from
  the same fixture, the "before" against the pre-REQ-0290 bundle (its
  `cursorProbe` hook reports absent, which is how the pair is known to be a
  genuine before/after). Pixel diff between them is a single 8x10 region at
  (265,121) — the padlock, at the top-right of the fixed PO's footprint, and
  nothing else. Cursors are deliberately NOT evidenced by screenshot: a CSS
  cursor does not appear in a rendered frame at all. That is what the probe
  seam is for.

## Follow-ups filed (not fixed here)

- **REQ-0363** — `check_engine_types.cjs` silently skips doc-comment-prefixed
  members, so its "49 declared members verified" excludes `poInBP`,
  `canRotateBP` and (now) both members this REQ added. Found because the
  verified count did not move after adding two exports. Compensated for here by
  the engine-suite coverage above; the checker itself is REQ-0363's job.
- **REQ-0364** — a branch named `req-0290-locked-po-not-allowed-cursor` already
  existed carrying an unmerged, gates-green-by-its-own-commits implementation of
  REQ-0288 + REQ-0289, 559 commits behind master. Renamed to
  `stale/req-0290-branch-carrying-0288-0289-2026-07-22`; no commit altered. User
  ruled 2026-08-03 to report and proceed with REQ-0290 alone.
