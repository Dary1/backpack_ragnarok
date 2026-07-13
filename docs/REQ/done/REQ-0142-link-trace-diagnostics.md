# REQ-0142 — link-trace-diagnostics

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** link-trace-diagnostics
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/user_managed/game_golden.md` (P2 "The Moment is sacred"),
`docs/user_managed/canvas_spec.md` (beams, first-hit rule, mutual links),
REQ-0050 (S4 simulate gate — runtime sibling of this edit-time REQ).

## Goal

Beam legibility is the load-bearing wall of P2: all tension lives in
arrangement, so the player must be able to READ and DEBUG the beam graph
before sortie. With 8-direction beams, first-hit-only resolution and mutual
links, unaided spaghetti is guaranteed at squad scale. Make beam reasoning a
first-class UI capability.

## Scope

- Hover a Unit (or a beam segment): highlight the full ray path per direction —
  origin, traversal, first-hit receiver; dim unrelated beams.
- "Why not" diagnostics for expected-but-absent links: blocked by X at cell
  (first-hit consumed), no receiver on ray, direction not in the Unit's set.
  Rendered in the tooltip/detail panel, plain language, EN + `i18n.ja`.
- Mutual-link badge on qualifying pairs; dud-beam styling (intentional duds are
  a legitimate design per canvas_spec — mark, don't nag).
- Implementation: renderer overlay + read-only engine queries. Engine consumed
  AS-IS; no mutators. Coordinate with the planned `BoardRenderer.render()`
  rework (~690 LOC, architecture.md §"left for the upcoming UI rework").

## Non-goals

No combat-time visualization (REQ-0050 territory); no engine changes; no
auto-suggest/optimizer (P5 The Unreplicable Self — do not solve layouts for
the player).

## Gates

- e2e scenarios: hover trace + all three "why not" reasons render on canonical
  layouts (mutual link, dud, blocked chain).
- User acceptance on the canvas.

---

## Outcome (2026-07-13) — BUILT, awaiting user acceptance

**Branch:** `req-0142-link-trace-diagnostics`
**Commits:** `4a195c0` (implementation + gates) · `8ed0923` (client dist rebuild, web/app)

### What was built

The engine was consumed **as-is** — no engine change, no mutator, exactly as the
non-goals demand. Every linked / dud / mutual fact still comes out of
`engine.traceBeams()`. The new query layer adds precisely one thing the engine
never needed to compute for itself: **what stands on a ray beyond the first
hit**, plus the same ray walk for the directions a Unit does *not* fire. Those
two extensions are what make the three "why not" reasons answerable at all —
everything else in this REQ is presentation.

- **`client/src/board/linkTrace.ts`** (new) — the read-only query layer.
  `traceUnit()` returns all 8 directions (`path` / `to` / `mutual` /
  `unitsOnRay` / `shadowed` / `firstOnRay`), each classified as
  `linked | blocked | no-receiver | dir-not-in-set`. `whyNotPair()` answers the
  pair-shaped question and adds the one reason no single direction can express:
  `not-aligned`. Pure — no Pixi, no DOM, no store — which is what lets a plain
  Node gate drive the real module.
- **`client/src/board/beamHover.ts`** (new) — ephemeral hover pub-sub, the same
  shape as `itemTip.ts` / `drag.ts`'s carry. Never touches game state: hovering
  a beam cannot mutate a board, churn the store, or schedule an auto-save.
- **`client/src/BeamTracePanel.tsx`** (new) — the plain-language read-out
  (EN + `i18n.ja`), mounted app-level like `FloatingItemTip`. It explains what
  IS and never suggests what to do about it (**P5**: do not solve the layout for
  the player).
- **`BoardRenderer`** — the beam layer is now trace-aware. **At rest** it draws
  exactly what it always drew, plus the one always-on addition the scope asks
  for: a **⇄ mutual-link badge**. canvas_spec calls mutual links "allowed, not
  always optimal" and duds "intentional", so both are *marked, never nagged
  about*. **Under hover** the interrogated fan lights up (origin ring →
  traversed cells → first-hit receiver ring) while every unrelated beam dims to
  `BEAM_DIM_ALPHA`; where the first-hit rule consumed a beam, a dashed ghost
  continues from the receiver to each shadowed Unit — *"blocked by X"*, drawn
  rather than described.

### One design decision worth recording

Hover rides a **plain DOM `pointermove` on the board canvas**, not PixiJS stage
events. Two reasons, both load-bearing:

1. `globalpointermove` is the *drag* channel, and its first line returns unless
   a carry is in flight — hover is exactly the no-carry case.
2. Any Pixi-interactive hit object for a beam would sit **above** the BP's
   empty-cell drag handles, and a beam crossing a BP cell would then swallow
   that cell's `pointerdown`. A DOM listener cannot perturb hit-testing at all.

(Also fixed on the way: the panel's `useLayoutEffect` originally depended on the
freshly-derived `trace` object, whose identity changes every render — an
unbounded render loop, React #185. It now depends on a stable hover-target key.)

### Coordination with the `BoardRenderer.render()` rework

Additive only: one new `beamSegs` field, one hover subscription, and the beams
block rewritten in place. No existing draw call moved. The rework
(architecture.md §"left for the upcoming UI rework") inherits a beam block that
already separates *geometry* (this layer) from *prose* (the panel), which is the
seam it would have had to invent anyway.

### Gates — all green

- **`client/scripts/check_link_trace.mjs`** (new; wired into `tools/ci.sh` as
  step **[5.7/7]**): **44 assertions**, driving the REAL module against the REAL
  engine, with **canvas_spec.md's own decoded example** (PBSystem A1:J10 — six
  Units, every link, mutual pair and intentional dud spelled out by hand) as the
  golden. Includes an **anti-drift assertion**: every linked/dud/mutual fact this
  module reports must equal `engine.traceBeams()`'s own — if the engine ever
  changes its mind about the beam graph, linkTrace changes *with* it, never
  around it.
- **`client/e2e/link-trace.spec.ts`** (new): **8/8 pass**. Hover trace; all three
  why-not reasons on canonical layouts (**mutual link**, **dud**, **blocked
  chain** — one interlocking fixture, because that is the situation a player is
  actually in); beam-segment hover narrowing the panel to one direction; hover
  clearing; drag suppression; ja localization; and Unit dormancy (the inventory
  board never traces).
- **`tools/ci.sh`** (`SKIP_PG=1 SKIP_E2E=1`): **CI GREEN** — sim, goldens, S4,
  engine tests (101 passed), typecheck, engine type-surface drift, vocab
  self-test, server api (files), pg_sync, unit-icon chain, link-trace queries,
  client typecheck + build. Lint: 0 errors.
- **Full e2e suite** against this branch's build: **147 passed / 4 failed**. The
  4: `dex-card:65`, `nav-routing:26`, `schedule:1065` are **pre-existing** (they
  fail identically on master — verified in a baseline run of the same suite
  against the live master build); `reference-model:286` failed once on a
  `socket hang up` from the local ingress proxy and **passes 8/8 when its spec is
  re-run** (infrastructure flake, not a UI regression).

### Note for whoever runs e2e from a worktree

`backpack-web` (:8801) serves the **main checkout's** `web/`, so a worktree's e2e
run tests the LIVE build unless told otherwise. Serve the worktree's own `web/`
on a spare port and point the ingress proxy at it:

```
python3 -m http.server 8901 --bind 127.0.0.1 --directory <worktree>/web &
cd client && PLAYWRIGHT_BASE_URL=http://127.0.0.1:8803 E2E_STATIC_PORT=8901 \
  bash ../tools/e2e_run.sh [spec]
```

(Without `PLAYWRIGHT_BASE_URL`, playwright.config falls back to the public
tunnel — which serves the live build, and no local proxy starts at all.)

### Not done (by design)

No combat-time visualization (REQ-0050's territory). No engine change. No
auto-suggest / optimizer — **P5, The Unreplicable Self**: the panel hands the
player the facts and gets out of the way.

**Remaining for `done/`:** user acceptance on the canvas, then merge + deploy.
