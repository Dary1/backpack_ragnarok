# REQ-0377b — SPIKE: make the Pixi boards resolution-aware

## Status
todo (SPIKE — measure, then decide; do not ship a feature from this file
without a second REQ) — split out of REQ-0377 item 5 on 2026-08-11.

Item 5 carried its own instruction: *"verify Pixi resolution/crispness cost
first — if non-trivial, this item becomes a spike before a feature."* The
verification was done. The zoom TOGGLE shipped in REQ-0377; the crispness half
is non-trivial and is this file.

## The finding that split it
`client/src/board/BoardRenderer.ts:399` initialises the Application with:

```js
await app.init({ canvas, width, height, backgroundAlpha: 0, antialias: true, autoStart: false });
```

No `resolution`, no `autoDensity` — so the backing store is 1x. **Every board
in this app is already being upscaled by the browser on every HiDPI display**,
and has been since REQ-0026. REQ-0377 item 5's zoom does not introduce that
softness; it makes an existing one more visible.

The encouraging half: the geometry helpers were WRITTEN for this. Both
directions of the client<->board mapping already divide/multiply by
`app.renderer.resolution` —

* `board/geom.ts:136` `clientToLocal`: `canvas.width / rect.width / resolution`
* `board/geom.ts:225` `localBoxToClient`: `(rect.width * res) / canvas.width`

— so raising the resolution should NOT move a single hit-test or DOM overlay.
That is the hypothesis this spike exists to test rather than assume.

## What to measure
1. Does `resolution: window.devicePixelRatio, autoDensity: true` render
   correctly, with drags, ghosts, the trash zone, `BoardCoords`,
   `CanvasSelectionOverlay` and `itemTip` all still landing where they should?
2. The real cost: backing-store area grows with the SQUARE of resolution, and
   this app mounts several boards at once (canvas + inventory, plus the
   warehouse page's own pair and the schedule Monitor's stage). Measure GPU
   memory and first-paint on a 2x display, not just a 1x dev box.
3. Interaction with REQ-0377's two zoom factors (`--board-fit`,
   `--board-zoom` in `styles/canvas.css`) and with the REQ-0158 ComfyUI idle
   VRAM policy — the box shares its GPU with the art pipeline.
4. Whether the answer should be conditional (cap resolution at 2, or raise it
   only for the zoomed-in board) rather than global.

## Why it must not be smuggled into a polish REQ
It changes the render characteristics of every board on every screen, and the
failure mode is a memory regression on exactly the low-end devices item 5 was
trying to help. It gets its own measurement, its own numbers and its own
decision.

## Out of scope
The zoom toggle itself (shipped, REQ-0377 item 5).
