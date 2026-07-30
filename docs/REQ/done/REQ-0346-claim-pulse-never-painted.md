# REQ-0346 — The warehouse claim pulse has never been visible

## Status
built — 2026-07-29. Implemented, gates green, awaiting user acceptance / merge.

`pulseCellsSuccess()` (`client/src/board/ghosts.ts`) is REQ-0041's "received an
item" cue: a green `#59d68a` outline blinking over the claimed cells for ~2 s.
It painted nothing, and had not since it was written. It now paints.

---

## 1. The fault, restated

Found and diagnosed by REQ-0345, deliberately left as found there. Both call
sites (`client/src/warehouse/useWarehouseData.ts` handleClaim,
`client/src/schedule/WorkshopPage.tsx` roll) call `notifyStateChanged()` on the
line after the pulse. That re-enters `BoardRenderer.render(state)`, whose first
act is `gTarget.removeChildren()` — the layer the pulse had just been added to.
The blink was destroyed inside the frame that created it, and the timers then
blinked an orphan.

REQ-0345 measured it through the real warehouse-claim flow: **0 pixels of
`#59d68a` across 22 samples spanning the whole 2 s window**, identically with
the Ticker running and with it off. It also proved the paint path itself was
fine, by delaying that one call 600 ms in a throwaway build: **596 px per blink,
on the exact 330 ms rhythm, with no Ticker**. So the fault was purely ordering.

## 2. The fix — a layer, not a reordering

`BoardRenderer` gains `gPulse`, a Container between `gTarget` and `gCarry`
(above the drop-target tint, below the drag ghost), `eventMode: 'none'` like its
decorative neighbours. `pulseCellsSuccess` draws there.

`render(state)` does not clear it, and the field comment says in as many words
that nothing may ever add it to that `removeChildren()` list. `render(state)`
therefore stays the single authority over `gTarget` — which is what REQ-0346's
own "suggested shape" asked to preserve, and the reason the fix is not the
other available option (delaying / reordering the product callback). Ordering a
callback would have made a call site's line order load-bearing for a visual: the
same invisible coupling that hid this bug in the first place, re-introduced one
layer up. A container is inspectable; an implicit ordering contract is not.

Its children are removed by exactly two things, both deliberate:

- the pulse's own final `rect.destroy()` — Pixi v8 detaches a destroyed child,
  so the layer self-empties at the end of every pulse;
- `setOps()`, which sweeps it for the same reason it already cancels an
  in-flight carry: a pulse names CELLS on the page that received the item, and
  once the board is re-pointed at another page those cells mean something else.

Everything else that clears `gTarget` — `render(state)`, and the six sites in
`board/commits.ts` — leaves `gPulse` alone by design: a claim pulse is
*supposed* to survive the state change that caused it.

### Files

| file | change |
|---|---|
| `client/src/board/BoardRenderer.ts` | `gPulse` field + stage order + `eventMode`; `setOps()` sweep; a "do not add me to this list" note at `render()`'s `removeChildren()` block |
| `client/src/board/ghosts.ts` | `pulseCellsSuccess` draws into `gPulse`; the REQ-0345 FINDING block rewritten as the reason the layer exists |
| `client/src/warehouse/useWarehouseData.ts` | comment only — it named `gTarget` as the pulse's layer |
| `client/e2e/claim-pulse.spec.ts` | **new** — the pixel assertion |
| `client/e2e/board-render-ondemand.spec.ts` | header only — "the pulse has no test here" now points at the spec that has it |

## 3. The test

`client/e2e/claim-pulse.spec.ts`, one test, through the REAL claim path: dev
`item_admin` grant → Warehouse route → claim press. It screenshots the
composited inventory canvas and counts the `#59d68a` population in-page — the
probe pattern `unit-skin-fallback.spec.ts` test 4 established and
`board-render-ondemand.spec.ts` reused for this pulse's two siblings.

It has to be a pixel test, because every cheaper assertion available is green on
the broken code: the POST succeeds, the item lands in the inventory, the
"Moved to your inventory." toast appears, `pulseCellsSuccess()` is entered, and
its `Graphics` are constructed. All of that happened for a year while the player
saw nothing.

Differential in both directions:

- **before** the claim — 0;
- **during** — `> 100` px, sampled faster than the 330 ms blink so an "off" half
  cannot read as an absence, and asserted alongside the claim toast, which
  `useWarehouseData` sets on the line *after* the `notifyStateChanged()` that
  used to eat the pulse. Green pixels co-existing with that toast is the fix;
- **after** — 0, sampled six times across ~900 ms once `PULSE_TOTAL_MS` has
  certainly elapsed. A single zero could be an off-half of a pulse that never
  ends; six spanning more than a blink period cannot be.

The fixture is one empty 4×4 BP homed on inventory page 0, because
`applyWarehouseClaim` first-fits from `openPage` — that is what guarantees the
claim takes the `pulseCellsSuccess` branch rather than `pulseTab`.

## 4. Evidence

Measured on the e2e box (scoped run, GPU confirmed), sampling the inventory
canvas every ~90 ms from the claim press, `#59d68a` within tol 24:

```
596  0  0  596  0  596  596  0  596  0  0  0  0  0  0  0  0  0  0  0  0  0  0  0
```

**596 px per blink** — the same number REQ-0345's throwaway delayed build
produced, now reached without delaying anything. On the ~330 ms rhythm, gone for
good after ~2 s. Same run: the hilt placed on inv page 0 cell `[1,1]`, and
`__backpackDebug.boardPaints()['inv:0']` 4 → 12, i.e. the eight paints the pulse
asks for (first state + six blinks + the removal) and nothing more.

**Deliberate-regression check**, the discipline REQ-0345 set: the same spec, the
same fixture, with `client/src` reverted to master and the bundle rebuilt — the
DURING poll ran its full 10 s at **0**. Restored and rebuilt: green in 6.0 s.

| gate | result |
|---|---|
| `tsc -b` (client) | clean |
| `oxlint` | 0 errors (45 pre-existing warnings) |
| `claim-pulse.spec.ts` scoped | 1 passed |
| `tools/ci.sh CI_SCOPE=both` | see §6 |

## 5. Trap, recorded so it is paid once

`client/e2e/local-proxy.cjs` serves `/app` from **`web/app` — the BUILT
bundle**, not from source. A src change that has not been through
`pnpm build` in `client/` is simply not in the run: the e2e suite then exercises
master's code and the result reads exactly like "the fix does nothing" (this
cost one bewildering red here, with the correct fix already in the tree). Build
the client before any e2e run that is meant to prove a client-side change.
`tools/ci.sh` does this itself; a hand-run scoped `playwright test` does not.

`web/app` is tracked, but it is NOT committed on a REQ branch — `tools/release.sh`
rebuilds and commits it on master ("dist rebuild (web/app/) via tools/release.sh").
The build output is left uncommitted here on purpose.

## 6. Gates / commits

- branch `req-0346-claim-pulse`
- commits: see `git log master..req-0346-claim-pulse`
