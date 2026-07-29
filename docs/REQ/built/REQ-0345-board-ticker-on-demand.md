# REQ-0345 — the boards rendered ~60 frames a second, forever, on every route

## Status
built — 2026-07-29. Awaiting user acceptance / merge.

Two PixiJS Applications re-rendered their entire scene graph on every animation
frame, on every route, whether or not either was on screen. Nothing needed them
to — the renderer already painted synchronously on every state change and said
so in a comment. But the frame loop was **not** redundant: three things drew
into the scene without ever calling `render()`, and lived only because something
else was painting for them. Switching the loop off naively makes those three go
silently invisible, and the whole suite stays green, because nothing in it ever
asserted that anything on a board was **painted**.

---

## 0. What was asked, and what came back

| | question | answer |
|---|---|---|
| **A** | is the always-on Ticker real, and what does it cost? | **real. 41.2 frames/s per board on `#/backpacks`, 59.7 on `#/dex` where both boards are `display:none`** |
| **B** | can it just be turned off? | **no** — two of the three animations that depend on it break. Each now renders itself |
| **C** | do the three animations still paint? | **two do, pixel-asserted, each deliberate-regression checked. The third never painted at all — before this REQ either** |
| **D** | does the Monitor need the same? | **no. Left alone; it is a genuine per-frame animation** |

Idle cost, same box, same probe, pointer parked off-canvas:

| route | before | after |
|---|---|---|
| `#/backpacks` (both boards visible) | 206 frames / 5.01 s = **41.2/s** per board, **×2 boards** | 0 / 5.01 s = **0.0/s** |
| `#/dex` (both boards `display:none`) | 300 frames / 5.02 s = **59.7/s** per board, **×2 boards** | 0 / 5.02 s = **0.0/s** |

The hidden route is faster than the visible one, which is the shape of the
problem in one line: with nothing to composite, the loop simply spins harder.

---

## 1. The Ticker, from source

`client/src/board/BoardRenderer.ts:299` (as it stood):

```ts
await app.init({ canvas, width, height, backgroundAlpha: 0, antialias: true });
```

No `autoStart`. In the installed pixi.js 8.19.0:

- `lib/app/TickerPlugin.mjs:14` — `autoStart` defaults to **`true`**.
- `:28` — the `ticker` setter does `ticker.add(this.render, this, UPDATE_PRIORITY.LOW)`.
- `:40` — `if (options.autoStart) this.start()`.
- `lib/app/Application.mjs:83` — `render() { this.renderer.render({ container: this.stage }); }`.
- `lib/ticker/Ticker.mjs:127` — the started ticker re-arms `requestAnimationFrame(this._tick)` every frame, forever.

Two Applications exist, always. `client/src/App.tsx` (REQ-0034, and its own
header at :20-31) keeps the Board and the InventoryBoard **mounted on every
route**; a route switch only adds `.route-hidden`, which is `display:none`
(App.tsx:216 and index.css). `display:none` stops compositing. It does not stop
a `requestAnimationFrame` loop.

REQ-0344 §1 had already measured the consequence from the other side — the
DOM-only `#/artadmin` console driving two live WebGL scenes, chromium's
`--type=gpu-process` at **500-660% CPU of 8 cores** under SwiftShader while
`nvidia-smi` reported 0% — and named the App.tsx rule as the cause, but stopped
at making that render fast (the GPU flags) rather than making it not happen.

And the renderer already knew it had no business in a frame loop.
`BoardRenderer.render()`'s tail comment (REQ-0027 T0.2, still in the file) ends
with an explicit synchronous `this.app.renderer.render({container: this.app.stage})`
and the sentence: *"This board has no continuous animation -- it only needs to
redraw when `render(state)` is called."* True since 2026, acted on now.

---

## 2. The catch: the Ticker was NOT redundant

This is the part that makes the change non-trivial, and the reason a green
test suite would have told you nothing.

Three things mutate the scene graph **outside** `render(state)` and never call
`render()` themselves. Grep either file for `render(` and there is nothing:

| | site | what it does | how it reached the screen |
|---|---|---|---|
| reject flash | `client/src/board/ghosts.ts:111` `flash()` | adds a red `#c05050` outline to `gTarget`; a `setTimeout` destroys it 350 ms later | the Ticker |
| claim pulse | `ghosts.ts:163` `pulseCellsSuccess()` | adds a green `#59d68a` outline; a repeating `setTimeout` toggles `rect.visible` for ~2 s | the Ticker |
| drag ghost + drop tint | `BoardRenderer.ts` `onGlobalPointerMove`, plus the carry subscription in `wireGlobalInteraction` | rebuilds `gCarry` (ghost art) and `gTarget` (legality tint) on every pointermove; clears both when a carry ends anywhere | the Ticker |

Everything else was already safe and was checked rather than assumed:

- `commits.ts` clears `gCarry`/`gTarget` in all six commit paths — every one
  followed by `notifyStateChanged()`, which re-enters `render(state)`.
- beam hover (`beamHover.ts`) is a de-duped pub-sub whose subscriber calls
  `render(this.lastState)` (`BoardRenderer.ts:1680-1681`).
- the async bp-skin decode calls back with `() => notifyStateChanged()`
  (`BoardRenderer.ts:618`), so a late-arriving texture repaints itself.
- `setOps()` clears two layers and documents that the caller must render
  (`InventoryBoard.tsx:105-106` does). Unenforced contracts were what the Ticker
  was quietly covering for, so it now also calls `requestRender()`.

---

## 3. The design

`mount()` passes `autoStart: false`. The Ticker object is still created and
`Application.render` is still registered on it, but a bare `new Ticker()` has
`autoStart = false` (`Ticker.mjs:30`) and `Ticker.add -> _startIfPossible()`
(`:160-165`) therefore requests no animation frame. Nothing schedules anything.

Two seams replace it:

- **`paintNow()`** — submit the current scene, synchronously. `render(state)`
  ends here. It stays synchronous rather than deferring, for the reason its own
  comment has always given: `renderer.lastObjectRendered` is what EventBoundary
  hit-tests against, and it must be correct before the caller's next pointer
  event, not one animation frame later.
- **`requestRender()`** — one paint on the next animation frame, coalescing
  every request made in the same frame. This is what the three sites above call.

`requestRender()` is a **one-shot rAF, not a loop**: it holds at most one
pending handle (`pendingPaint`), clears it when the frame fires, cancels it in
`destroy()`, and `paintNow()` cancels it too (a synchronous paint supersedes a
requested one — which is why an inventory tab switch, which calls `setOps()`
*and* `render(state)`, costs exactly **one** frame, measured). When nothing is
happening, nothing is scheduled. That is the whole of "idles at zero".

Coalescing matters for exactly one caller: a fast drag fires many native
`pointermove`s per displayed frame, and rendering each would be worse than the
Ticker was. One paint per frame is the ceiling a permanent Ticker could ever
have achieved anyway. For the two timer-driven animations coalescing is
irrelevant — one render per timer tick is exact and costs ~2 frames for the
whole 350 ms flash and ~7 for the whole 2 s pulse, against ~21 and ~120 at 60 Hz.

---

## 4. Measurement, and why the instrument can be trusted

**The instrument was landed first, as its own commit (04637cc3), so the same
probe reads the board before and after.** `client/src/board/paintProbe.ts` is a
per-board frame counter; `BoardRenderer.mount()` wraps `renderer.render` on the
Application **instance** immediately after `app.init()`, and `store/boot.ts`
exposes it as `__backpackDebug.boardPaints()` alongside the existing read seams.

That seam and no other, because both frame producers funnel through it: the
Ticker calls `Application.render()`, which is literally
`this.renderer.render({container: this.stage})` resolving `this.renderer` **at
call time** (`Application.mjs:83`), and `paintNow()` calls the same method. So
the counter reads the Ticker's frames and the on-demand frames identically —
and would catch a Ticker somebody re-enables by accident, which is the
regression this REQ must stay able to detect. It is measured doing exactly
that in §5.

### The instrument that did not work, and what is still unexplained

This REQ was handed a warning: patching `WebGLRenderingContext.prototype`, and
then the live context object, both read **zero even during a real state
change** — an instrument that would have "proved" there was no waste at all.
Not re-reproduced here, and honestly only half explained:

- the **prototype** patch cannot have worked. A board context is WebGL2:
  `GlContextSystem.mjs:268` defaults `preferWebGLVersion: 2` and `:117` calls
  `canvas.getContext('webgl2', ...)`. In Chrome `WebGL2RenderingContext.prototype`
  does not inherit from `WebGLRenderingContext.prototype`, so the patched method
  is never on the lookup path.
- the **instance** patch should have been seen. `GlGeometrySystem.draw()`
  (`GlGeometrySystem.mjs:265-272`) looks its draw call up on `gl` on every call;
  it holds no captured function reference. Why that read zero is unknown, and is
  recorded as unknown rather than guessed at.

What survives either way is the rule, and it is written into the probe and into
the spec: **a zero from an unvalidated probe is worth nothing and looks exactly
like a fixed bug.** So `board-render-ondemand.spec.ts` test 1 never asserts the
zero without making the same counter, read the same way, climb for a render that
certainly happened — in the same test.

### The readings

Instrument responding, before (Ticker running): an inventory tab switch moved
`{canvas:5, inv:0:6}` to `{canvas:24, inv:0:26}` — the render plus ~20 frames of
Ticker during the 400 ms wait. After: `{canvas:1, inv:0:2}` to
`{canvas:1, inv:0:3}` — **`inv:0` +1, `canvas` +0**, which is the correct answer
(an inventory tab switch is not a canvas state change) and is also the
coalescing working. The whole boot now costs the canvas board **one** frame.

Idle: the table in §0. Zero, on both routes, both boards.

---

## 5. The deliberate-regression check

Each break applied alone, rebuilt, whole spec re-run, then reverted.

| break | result |
|---|---|
| `autoStart: true` in `mount()` | **test 1 red**: `Expected: 0, Received: 124` (3 s window = 41.3/s, matching the pre-change 41.2/s). Tests 2 and 3 green. |
| drop `self.requestRender()` from `flash()` | **test 2 red**: `Expected: > 100, Received: 0`. Tests 1 and 3 green. |
| drop `this.requestRender()` from `onGlobalPointerMove` | **test 3 red**: `Expected: > 100, Received: 0`. Tests 1 and 2 green. |

`Received: 0` is the exact failure mode this REQ was afraid of — the animation
still runs, the Graphics is still built, the timers still fire, and not one
pixel of it reaches the screen. Each break reddens **only its own test**, so the
coverage is specific rather than a blanket smoke alarm.

### Why they are pixel tests

Asserting a DOM class, or a counter, would not have caught any of this. The spec
screenshots the canvas element — Playwright returns the **composited** result,
which is what the player sees — and counts the colour population in-page, the
probe `unit-skin-fallback.spec.ts` test 4 established for the same reason
(REQ-0266 shipped a board regression past every green gate because nothing
looked at the board). Each assertion is **differential**: the colour must be
absent before and present during, so it cannot pass on a pre-existing pixel of
the same hue. Test 2 additionally asserts the flash goes back to **zero** when
its 350 ms timer fires — the half a "did it appear" test misses, and the half
that matters now that no frame loop will sweep a forgotten overlay away.

### What these tests do NOT cover, stated plainly

- **The drag GHOST ART itself.** Test 3 pins the drop-target tint (`gTarget`,
  `#009e73`), which is an exact, opaque, differential colour. The carried
  sprite in `gCarry` is item art at alpha 0.75 over arbitrary background and
  has no colour signature worth asserting. Both are rebuilt and painted by the
  SAME `requestRender()` in the same handler, so the regression this REQ is
  actually exposed to (the paint call going missing) reddens test 3 — but a
  change that killed only the ghost art would not be caught here.
- **The claim pulse.** §6 — no honest assertion exists while it is invisible
  for an unrelated reason.
- **Any other board pixel.** `unit-skin-fallback.spec.ts` test 4 and
  `inventory-art-integrity.spec.ts` remain the only pixel coverage of ordinary
  board rendering, and they run in the same gate.

---

## 6. The claim pulse: found already dead, and left that way

The third animation gets no test, and that is the honest answer rather than a
convenient one.

Driven through the real flow — `dev_user.json` flipped to `item_admin`,
`POST /api/admin/warehouse/grant`, the claim button, and the toast reading
**"Moved to your inventory."**, which is the `res.page === openPage` branch and
therefore proof that `pulseCellsSuccess()` ran — the pulse paints **zero pixels
of `#59d68a`** across 22 samples spanning the whole 2 s window. Then the same
run with the Ticker put back (`autoStart: true`): **also zero**. It was already
invisible. REQ-0345 neither breaks it nor fixes it.

The cause, verified by intervention: `pulseCellsSuccess()` draws into `gTarget`,
and both call sites — `useWarehouseData.ts:217` and `WorkshopPage.tsx:244` —
call `notifyStateChanged()` on the **next line**. That re-enters
`BoardRenderer.render(state)`, whose first act is `this.gTarget.removeChildren()`
(`BoardRenderer.ts:489`). The rects are detached from the stage before any frame
could show them; the timers then blink an orphan for two seconds.

Delaying that one call by 600 ms in a throwaway diagnostic build — past the
state render, nothing else changed, no Ticker running — made every blink appear:
**596 px per blink, on the exact 330 ms rhythm**
(`797ms=596 908=596 1020=596 1119=0 1252=0 1354=0 1469=596 …`). So the pulse's
own paint path under this REQ is *proven correct*; the ordering is the fault.

Not fixed here. Choosing between "pulse into a layer `render()` does not clear"
and "pulse after the state render" is REQ-0041's call about what the feature
should look like, not this REQ's; and bundling a behaviour change into a
frame-loop change would make both harder to trust. Recorded in
`ghosts.ts`'s own doc comment, where the next person to touch it will read it.

**This also corrects this REQ's own premise.** The brief said three animations
depended on the Ticker. Two did. The third had been dead long enough that the
Ticker was burning ~60 frames/s partly on its behalf and it still never showed.

---

## 7. The Monitor was not touched

`client/src/schedule/MonitorRenderer.ts` has its own Application and keeps its
Ticker, deliberately. It is the opposite case, and the source says so plainly:

- `:311` — `if (FX_MODE !== 'off') this.app.ticker.add(this.tickRamps)`, ONE
  persistent per-frame ramp tick, whose own comment (`:307-310`) explains it is
  not registered via `addTicker()` precisely so `reset()` never cancels it.
- `:820-838` — `addTicker()` registers self-cancelling per-frame FX steps.
- `:1284` — `reset()` removes every in-flight one.
- `Monitor.tsx:286-288` — the React side sets a playhead each rAF and states
  that "the Pixi ticker does the drawing".

That is a combat replay animating continuously against a playhead: exactly what
a frame loop is for. Nothing measured here argues otherwise, and the Monitor is
mounted only on its own route inside `.route-hidden` chrome. Untouched.

---

## 8. Files

`client/src/board/paintProbe.ts` (new) · `client/src/board/BoardRenderer.ts` ·
`client/src/board/ghosts.ts` · `client/src/store/boot.ts` ·
`client/e2e/board-render-ondemand.spec.ts` (new)

No existing test assertion was changed, no timeout lengthened, no retry added,
and no existing spec was edited at all. `MonitorRenderer.ts` untouched.
The behaviour change is one option (`autoStart: false`) plus ten
`requestRender()` calls across seven sites that used to be painted for free.

## 9. Gate

`tools/release.sh` on `req-0345-board-ticker-on-demand`, `CI_SCOPE=both`,
`DATABASE_URL` exported alone (never `source`d — `server/.env` also sets
`STORAGE_BACKEND=pg`, which would turn ci.sh's `[4/7]` files-backend stage into
a second pg run):

```
export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh
export XDG_RUNTIME_DIR=/run/user/$(id -u)
export DATABASE_URL="$(grep -m1 ^DATABASE_URL= $HOME/backpack_ragnarok/server/.env | cut -d= -f2-)"
export CI_STAGE_TIMINGS=...
bash tools/release.sh
```

**CI GREEN** · `RELEASE_EXIT=0` · ci.sh **TOTAL 333.9 s** · clean worktree ·
`dist unchanged -- nothing to commit` (the last commit is comments only, and
the minified bundle is byte-identical, which is the receipt saying so) ·
CI receipt written for tree `fd81e64f`. **Not pushed.**

| | baseline | this run |
|---|---|---|
| client e2e `[7/7]` | 206 passed / 0 failed / 1 skipped | **209 / 0 / 1** (+3, this REQ's) |
| admin trio `[6.5/8]` | 8 / 1 / 28 | **8 / 1 / 28** |
| registry `[6.6/8]` | 4 / 4 | **4 / 4** |
| ci.sh TOTAL | ~390 s | **333.9 s** |

Stage wall (`CI_STAGE_TIMINGS`):

| stage | REQ-0344's gate | this run |
|---|---|---|
| `[7/7]` client e2e | (204.5 s REQ-0343 / 208.1 s REQ-0339) | **158.4 s** |
| `[6.5/8]` admin trio | 100.7 s | 93.3 s |
| `[6.6/8]` registry | 7.3 s | 6.5 s |
| **TOTAL** | 391.8 s | **333.9 s** |

`[6.5/8]` and `[6.6/8]` are REQ-0344's stages and this REQ changed nothing in
them; their small drop is box noise and is not claimed. `[7/7]` is the one this
REQ moved, and §10 measures it A/B rather than against the table above.

An earlier full `release.sh` on the same branch (before the comment-only
correction commit) was also **CI GREEN**: TOTAL 330.4 s, `[7/7]` 158.7 s,
209 / 0 / 1, and it is what committed the dist (c13d2df5).

---

## 10. The e2e suite got faster, measured A/B

The brief asked whether `[7/7]` drops if the boards stop burning frames. It
does, and this is a controlled A/B rather than a comparison against a number
from another REQ's run: same box, back to back, same 4 workers, same GPU, the
ONLY difference being `autoStart` in `mount()`.

| | `[7/7]` wall | playwright | result |
|---|---|---|---|
| **A** `autoStart: true` (the Ticker) | **192 s** | 3.2 m | 208 passed / **1 failed** / 1 skipped |
| **B** `autoStart: false` (shipped) | **159 s** | 2.6 m | **209 / 0 / 1** |

**−33 s, −17%**, on a suite that grew by three tests. A's single red is this
REQ's own test 1 catching the reverted change, which is the deliberate
regression of §5 arriving a second time by accident and passing.

The mechanism is not subtle: at `E2E_PARALLEL=4` there are **eight** board
Applications alive at once, each re-rendering a full scene ~41-60 times a
second for the entire duration of every test, whatever the test is doing. Most
of the suite is DOM assertions and network waits, none of which want a frame.

For scale, the historically recorded `[7/7]` on this box: 204.5 s (REQ-0343),
208.1 s and 210.4 s (REQ-0339) — all at ~205 tests. Consistent with A, though
those runs are not controlled against this one and are quoted only as context.

---

## Log
- 2026-07-29 reserved as REQ-0345 on branch `req-0345-board-ticker-on-demand`
  (off master 50d79016).
- 2026-07-29 instrument landed first (04637cc3) so the same probe could read
  both sides; before-measurement taken; on-demand rendering (3e833fad);
  pixel-level e2e + the claim-pulse investigation (e3836197); the paintProbe
  note corrected after reading the Pixi source rather than trusting the
  received explanation (7933a452). Three deliberate-regression checks, one A/B
  of the whole e2e suite, full gate. reserved → built.
