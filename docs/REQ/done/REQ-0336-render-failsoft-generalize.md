# REQ-0336 — Generalize the fail-soft render guard beyond the Monitor

## Status
built — 2026-07-28. Awaiting user acceptance / merge.

Cut on the owner's instruction after REQ-0335, having established that "the
freeze" is **not one recurring bug**. It is a recurring *symptom* with at least
four distinct causes, and the defenses built for it were only ever installed on
the surface where it was last reported.

---

## 1. The actual history

| | mechanism | fix | where the fix landed |
|---|---|---|---|
| REQ-0031 Phase A #2 | `Application.destroy()`'s async `loseContext()` races the remount's `getContext()`; PixiJS `checkMaxIfStatementsInShader()` spins `while(true)` | `setOps()` — never remount | boards |
| REQ-0041 #4 | monitor crash-loop: `cellIdToColRow` assumed `"M9"` strings, `sim/combat.cjs` emits raw `[row,col]` | shape-tolerant parse + **per-event try/catch** + unconditional index advance | Monitor only |
| REQ-0284 | `bp.unit.id` on a unit-less BP throws → **React root torn down** → blank app | patched that one deref | Monitor only |
| REQ-0285 | the class REQ-0284 left open | **error boundary** | Monitor subtree only |
| **REQ-0336, found here** | `boot()` is a floating promise (`main.tsx: boot();`); a throw after the fetch rejected into nothing and the app sat on **"Loading board…" forever** | this REQ | — |

Two of those five are the same class — *an uncaught throw with nobody
underneath it* — and REQ-0285's own header says so:

> *"There is no error boundary anywhere in the client, so the uncaught throw
> tears down the React root — the entire Watch view goes blank (the 'freeze')."*

REQ-0284 patched one throw site. REQ-0285 wrapped one subtree. Before this REQ,
a grep for `componentDidCatch|getDerivedStateFromError` across the whole client
returned **one hit**, and it was Monitor-shaped — its copy, its testids, its CSS
classes — so nothing else could reuse it. Meanwhile `BoardRenderer.ts`, 1800
lines with six per-item draw loops over saved-profile data, had **zero**
try/catch, and the boards — the app's primary surface — had no boundary at all.

## 2. What this REQ does

**(a) `client/src/RenderErrorBoundary.tsx` (new).** REQ-0285's boundary,
generalized: `surface` names the failing area in the console line, `testId`
lets e2e assert containment, and `resetKey` re-arms it when the subject changes
(via `getDerivedStateFromProps`, so recovery lands on the same commit — no flash
of a stale error card on a route the user just navigated to). Both boards are
now wrapped, keyed on the active squad and the active inventory page.

**(b) Per-item isolation in `BoardRenderer`.** The three loops that walk
saved-profile rows — BPs, BP units, sockets — run each item through
`drawGuarded()`. An item that cannot be drawn is not drawn, is logged **with its
id**, and every other item still renders. `continue` statements belonging to the
outer loop became `return`; the two that belong to inner loops were left alone
(the transform tracks enclosing *iteration statements*, not brace depth — line
590's `for (…) { if (!b.unit) continue; }` opens and closes on one line and a
depth counter misreads it).

This is the loop-level form of a rule the codebase already applied case by case:
REQ-0170's unit-less-BP branch says *"draw the bag and skip the unit — a
degraded board beats a blank one"*; REQ-0273 v4 says *"degraded render beats
data loss"*. Those were per-known-case guards. This makes it the invariant.

**(c) `boot()` surfaces post-fetch failures.** Found while writing the test, and
the most valuable part of this REQ. `boot()` is called as a floating promise and
the only `status:'error'` it ever set was for a failed *fetch*. Anything that
threw after the data arrived — `engine.migrateState()` on a canvas the engine
cannot hydrate is the reachable case — rejected into nothing, leaving the
snapshot at `'loading'`: both boards showed **"Loading board… / Loading
inventory…" indefinitely**, with no error and no way out. `Board.tsx` and
`InventoryBoard.tsx` have rendered a `"Board unavailable: {error}"` branch for
`status:'error'` all along; it was simply never reached. Now it is.

## 3. The coverage REQ-0284 said was missing

`client/e2e/board-poisoned.spec.ts` (new). REQ-0284's post-mortem named the gap
precisely — *"every schedule-fixture squad seats a `berserker` Unit on every BP,
so the unit-less branch was never exercised"* — and the general form is that
**every fixture in `client/e2e/fixtures/` is well-formed**, so nothing had ever
asked what happens to a row the app cannot use.

1. **the REQ-0284 shape** — a unit-less BP: no error card, both canvases still
   mounted, page answers an unrelated round-trip, and a real drag still commits
   to the server.
2. **an unhydratable canvas** — states the error instead of spinning on
   "Loading" forever, and the rest of the shell still navigates.

**Deliberate-regression check:** with (c) reverted and the client rebuilt, test 2
FAILS (`expect(locator).toBeVisible()` on the error placeholder) and test 1 still
passes. Restored: 2/2.

### What is deliberately not asserted, and why

Layer (b) is **not** verified by feeding the renderer a magic broken shape. That
was tried and it does not work, for a reason worth recording: every shape bad
enough to break the renderer is refused by the engine at hydration *first*, and
every shape mild enough to pass hydration — an unknown unit id, a missing
texture — the renderer already tolerates by design (it falls back to a
placeholder sprite rather than throwing). `drawGuarded` is defense in depth for
the shape **nobody has enumerated yet**, which is exactly the shape a test cannot
name. Writing a test that pretends otherwise would be worse than not having one.

The layering that fell out of this is itself the useful result:

    engine refuses what it cannot hydrate   -> boot() states the error   (c)
    renderer meets a row it cannot draw     -> drawGuarded skips it      (b)
    anything still escapes                  -> the boundary contains it  (a)

## 4. What this does NOT fix

**Consolidating the boards onto one PixiJS Application is still open, and is a
different problem.** It would close the REQ-0031 class (WebGL context lifecycle)
by construction; it would not have prevented REQ-0041, REQ-0284, or the boot
hang, all of which are uncaught-throw or data-shape bugs that a single
Application can host just as easily. The two should not be conflated — that
conflation is what this REQ was cut to untangle.

## 5. Files

| file | |
|---|---|
| `client/src/RenderErrorBoundary.tsx` | new — generalized from `MonitorErrorBoundary` |
| `client/src/App.tsx` | both boards wrapped; `InventoryColumn` takes `resetKey` |
| `client/src/board/BoardRenderer.ts` | `drawGuarded` + three loops isolated |
| `client/src/store/boot.ts` | `boot()` wraps `bootInner()`, surfaces `status:'error'` |
| `client/src/i18n/common.ts` | `render.error.*` (en + ja) |
| `client/e2e/board-poisoned.spec.ts` | new — the malformed-data coverage |
| `web/app/**` | rebuilt docroot |

`MonitorErrorBoundary` is left in place: it carries Monitor-specific copy and
testids that `schedule.spec.ts` asserts. Folding it into the general boundary is
a follow-up, not a prerequisite.

## Log
- 2026-07-28 reserved as REQ-0336 on branch req-0336-render-failsoft-generalize
  (off master 5a483a9).
- 2026-07-28 implemented; boot-hang found while writing the spec and fixed;
  deliberate-regression check; full gate; reserved -> built.

## Gate results (2026-07-28)
- `tools/release.sh` **CI GREEN**, 438.9 s wall, `dist committed`.
- scoped e2e **199 passed / 0 failed / 1 skipped** (197 before; +2 = board-poisoned.spec.ts).
  Admin trio 8/1/28, registry 4/4.
- Deliberate-regression check recorded in section 3.

## Deploy record (2026-07-28)
- Merged to master b0f4b8a (--no-ff). Gate before the merge: `tools/release.sh`
  **CI GREEN**, 438.9 s, dist committed on the branch.
- No service restart: no server path touched. web/app is served straight from
  the checkout, so the merge IS the deploy. Verified live --
  https://backpack-dev.qtie.jp/app/ serves assets/index-C995abFQ.js, which is
  HEAD's committed bundle, and that bundle contains the new guard strings.
- built -> done.
