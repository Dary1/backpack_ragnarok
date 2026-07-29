# REQ-0346 — The warehouse claim pulse has never been visible

## Status
todo — found and diagnosed by REQ-0345, deliberately left as found there.

`pulseCellsSuccess()` (`client/src/board/ghosts.ts:142`) is REQ-0041's
"received an item" cue: a green `#59d68a` outline blinking over the claimed
cells for ~2 s. **It paints nothing, and has not since it was written.**

## Evidence (REQ-0345)

Driven through the real warehouse claim path — `item_admin` grant → claim → the
same-page toast that proves `pulseCellsSuccess` actually ran — the canvas shows
**zero `#59d68a` pixels across 22 samples over the whole 2 s window**. Identical
with the PixiJS ticker put back, so REQ-0345 neither caused nor masked it.

## Cause, established by intervention

The call sites (`client/src/warehouse/useWarehouseData.ts:217`,
`client/src/schedule/WorkshopPage.tsx:244`) call `notifyStateChanged()` on the
next line. That re-enters `BoardRenderer.render(state)`, which begins with
`gTarget.removeChildren()` (`BoardRenderer.ts:489`) — the layer the pulse was
just added to. The blink is destroyed within the same frame it was created.

Delaying that one call by 600 ms in a throwaway build made every blink paint:
**596 px on the exact 330 ms rhythm, with no ticker running.** So the pulse's
paint path is correct under REQ-0345; the fault is purely ordering.

## Why it was not fixed in REQ-0345

That REQ's contract was "stop the ticker without changing what anything
asserts". Reordering a product callback, or moving the pulse to a layer
`render()` does not clear, is a product behaviour change with its own design
question (which layer should survive a re-render?) and deserves its own gate.

## Suggested shape

Either move the pulse overlay to a layer `render(state)` does not wipe, or have
`pulseCellsSuccess` re-add itself after the state-driven render settles. Prefer
whichever keeps `render(state)` as the single authority over `gTarget`.

**A test must come with it.** REQ-0345 proved a pixel assertion is feasible
(`canvas.screenshot()` → colour population in-page, the `unit-skin-fallback`
probe), and the pulse is exactly the case where "the DOM says it happened"
passes while nothing is drawn.
