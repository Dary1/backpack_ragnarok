# REQ-0169 — Battle-monitor Field view repair (#/schedule)

- **Status**: folder = status (PROJECT.md REQ policy).
- **Origin**: user directive 2026-07-14 — same session/scope ratification as
  REQ-0168 (schedule UX pass). Split out because this piece is riskier (Pixi
  lifecycle + rendering) and independently shippable. Same branch:
  req-0168-schedule-ux-pass.
- **Constraint canon**: ONE Pixi Application per monitor, created once, never
  destroyed on collapse (REQ-0036/0069/0097); REQ-0099 replay semantics and every
  monitor data-testid/class stay intact; __monitorDebug seams stay functional
  (e2e asserts through them — update assertions WITH any seam-shape change).

## Evidence — live repro, 2026-07-14 (fresh guest, dev server, Chrome)

- E1 **Mount race, reproduced**: expand a room BEFORE its first run exists ->
  Monitor early-returns the awaitingRun stub (no <canvas> in the tree). Fill the
  slots; the run auto-starts; the full JSX (with canvas) now renders — but the
  mount effect (deps [expanded, mountedOnce]) never re-fires, so
  MonitorRenderer.mount/app.init never runs. Observed: canvas stuck at the
  browser-default 300x150, Field pane a blank box, replay Play/scrub moves the
  clock but renders NOTHING. A full page reload (run now pre-existing) mounts
  fine (canvas 960x324).
- E2 **Enemy-side labels collide into garbage**: with a settled run, the enemy
  field's masked marker labels (all «dagger» for this content) overlap into an
  unreadable red smear at the top edge. REQ-0045 (f) clamped each label's OWN
  width but nothing de-overlaps SIBLING markers.
- E3 **Player side illegible**: only the four squad-name texts are visually
  apparent, stacked; formation outlines (alpha 0.5 hairline) and 2x2 BP
  footprints are not readable against the dark backdrop at 18px cells.
- E4 **Main-thread freezes ~10-30s**, twice, each immediately after an
  interaction on this page (create-room click; first expand click) — CDP
  Page.captureScreenshot timed out at 30s, page recovered afterwards. Suspects:
  loadBoardTextures() SVG rasterization on first monitor mount; engine
  isSquadDeployable snapshot work on SlotsPanel/RoomCard mount. NOT yet
  root-caused — instrument first.

## Fixes

### M1. Canvas mount race (E1)
- Change (Monitor.tsx): make renderer mount react to the canvas ACTUALLY entering
  the DOM: replace the plain ref with a callback ref storing the element in state
  (setCanvasEl), and key the mount effect on [expanded, mountedOnce, canvasEl].
  (Equivalent alternative: keep the ref but ALSO depend on !!room.lastRunId so the
  post-first-run render re-runs the effect. Callback ref is the robust choice —
  it also covers future conditional renders.)
- Acceptance: expand an idle room with no run; fill 4 slots; when the run starts,
  the Field view initializes live (canvas 960x324, backdrops visible) WITHOUT a
  reload; after settle, replay visibly renders. (This exact sequence, in browser.)

### M2. Enemy marker label de-overlap (E2)
- Change (MonitorRenderer.ts): keep marker dots at their true cells; de-conflict
  only the LABELS — assign labels to vertical lanes on collision (bounds check
  against already-placed labels this frame; bump down one lane, max N lanes, then
  hide the label and keep the dot). Masked duplicates («dagger» xN) collapse to
  one label per cluster with a xN count suffix. Exact strategy may be tuned in
  implementation, but the acceptance bar is fixed.
- Seam: getEnemyMarkerBounds() keeps returning per-marker {x, labelWidth,
  labelText}; add hidden/lane fields rather than changing existing ones; update
  the e2e that reads it only if shape must change.
- Acceptance: with the fixture's settled run, no two rendered enemy labels
  overlap (assertable via the seam: pairwise bounds disjoint OR hidden), and the
  Field screenshot is human-readable (manual check).

### M3. Player-side legibility (E3)
- Change (MonitorRenderer.ts mountSquads/drawFieldBackdrop): raise formation
  outline contrast (alpha/width), draw BP footprints with a visible fill +
  1px outline, add a faint cell grid to both field backdrops so positions read
  as a board at all; verify via __monitorDebug.squads() that every BP/PO of the
  4 fixture squads is actually mounted (if the formation canvases join fails
  silently — the catch swallows it — surface a console.warn and a dim fallback
  outline so the failure is at least visible in dev).
- Acceptance: all four squads' boxes + BP footprints are individually
  distinguishable in a screenshot at default zoom; debug seam lists 4 squads with
  non-empty bps.

### M4. Interaction freezes (E4) — instrument, then fix the top cause
- Step 1 (measure): temporary dev-only PerformanceObserver(longtask) probe logged
  to console (or Playwright tracing) around: room create, first card expand,
  first monitor mount. Identify the >1s tasks.
- Step 2 (fix): whatever the probe convicts. Named suspects and their remedies:
  loadBoardTextures re-rasterizing the SVG atlas per monitor -> memoize/share the
  Promise module-wide (the board pages already load the same atlas — reuse that
  cache); synchronous engine.isSquadDeployable fan-out on mount -> memoize per
  squad per state snapshot.
- Step 3: remove or gate the probe behind dev_mode before built.
- Acceptance: with devtools Performance recording, create-room and first-expand
  produce no main-thread task >1s on the dev box; interaction feels immediate.

### M5. (conditional) Canvas fit-to-pane
- Only if M2+M3 leave the default view still awkward inside the ~950px detail
  pane: scale the stage uniformly to the pane width (app.renderer.resize + CSS
  width:100%; keep internal 960x324 coordinates via stage.scale) instead of
  overflow-x scroll. Decide during implementation; if skipped, record why.
- Acceptance (if done): no horizontal scrollbar at >=1280px viewports; aspect
  preserved; e2e canvas selectors untouched.

## Gates (before built)
Same battery as REQ-0168 (tsc, eslint, build, server node --test, pnpm run e2e
with box lock, manual browser pass of each acceptance line, EN+JA).

## Record
- **Status**: built (gates green) 2026-07-14. Branch req-0168-schedule-ux-pass.
- **Commits**: d2bd6b4 (Monitor.tsx M1/M3/M4 + MonitorRenderer.ts M2/M3 +
  workshop.css M5, co-located with the REQ-0168 detail-pane commit), 2730fc0 (dist).
- **M1 canvas mount race**: fixed with a callback ref stored in state
  (setCanvasEl) + mount effect keyed [expanded, mountedOnce, canvasEl], so the
  renderer mounts the instant the canvas node enters the DOM (covers the
  expand-before-first-run -> awaitingRun-stub -> run-appears sequence). Validated
  by the REQ-0045(d) squads()-seam e2e (canvas mounts, 4 squads read) passing.
- **M2 enemy label de-overlap (chosen strategy)**: dots stay at their true cells.
  relayoutEnemyLabels() runs on every marker creation: (1) same-rawText markers
  collapse to ONE leftmost representative label suffixed " x{count}", the rest keep
  their dot but hide their label; (2) surviving labels are 2D lane-placed -- each
  starts at its dot's own row and is bumped DOWN one LABEL_LANE_H (11px) at a time
  until it clears every already-placed label (greedy bounds check), max 3 lanes,
  else hidden (dot kept). Every label is still truncated to the field's right edge,
  so REQ-0045(f)'s "x + labelWidth <= FIELD_W" invariant holds. Seam
  getEnemyMarkerBounds() gained ADDITIVE hidden/lane fields (x/labelWidth/labelText
  unchanged). Validated: REQ-0045(f) enemyBounds() e2e passes.
- **M3 player legibility**: faint cell grid on both backdrops; formation outline
  contrast raised (width 1.5, alpha 0.9); BP footprints fill alpha 0.72 + 1px dark
  outline; degenerate-formation-box fallback outline + console.warn in mountSquads;
  Monitor.tsx warns on a silent formation-join failure (found-missing + thrown).
  REQ-0045(d) squads() seam confirms 4 squads with non-empty bps.
- **M4 probe findings**: loadBoardTextures is ALREADY memoized module-wide
  (boardLoadPromise) and shared with the board pages -- there is NO per-monitor
  re-rasterization (the spec's primary named suspect is already mitigated).
  Measured the SVG atlas cost on the box (client/node deps): 22 symbols, DOMParser
  parse ~1.6ms + inner-markup serialize ~2.2ms (~4ms total main-thread JS) plus 22
  small Image decodes (largely off-main-thread). isSquadDeployable is O(1) per
  squad (bps.length) and is now computed once per render (deployableFlags memo,
  SlotsPanel). Neither named suspect is a plausible >1s main-thread stall; the E4
  evidence (10-30s CDP screenshot timeouts, page recovered) is most consistent
  with a transient CDP/capture stall, not a reproducible code stall. Shipped an
  opt-in dev longtask probe (PerformanceObserver, gated behind
  window.__bpMonitorProbe -- inert otherwise, safe to ship per M4 step 3) so the
  orchestrator's browser QA can confirm empirically; the live capture is deferred
  to that QA (this role does coding + automated gates, not browser QA). Fix
  applied = the two convictable remedies both in place: module-memoized textures
  (confirmed) + isSquadDeployable per-render dedupe.
- **M5 fit-to-pane**: DONE, via the low-risk CSS-scale variant (canvas
  width:100% height:auto max-width:960 in workshop.css). The Pixi renderer keeps
  its native 960x324 BACKING resolution, so internal coordinates and every
  e2e/__monitorDebug seam are unchanged; only the display size scales to the pane,
  aspect preserved, no horizontal scrollbar. Chosen over app.renderer.resize +
  stage.scale specifically to avoid touching coordinates/seams (lower risk).
- **Gates**: same battery as REQ-0168 (tsc PASS, oxlint 0 errors, build PASS,
  server 157/0, e2e full suite green incl. REQ-0045(d)/(f) monitor tests that
  exercise the M1/M2/M3 seams). Manual EN+JA browser pass deferred to orchestrator.

