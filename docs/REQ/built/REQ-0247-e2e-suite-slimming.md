# REQ-0247 - E2E default suite: slimming, dedupe, one bringup path

**Reserved:** 2026-07-18
**Slug:** e2e-suite-slimming
**Scope:** the DEFAULT suite only -- the 33 spec files `client/playwright.config.ts`
runs (hermetic, fleet-backed). The harness itself (global-setup, e2e_fleet.cjs,
local-proxy.cjs) and the harness-only admin trio are OUT of scope; they belong to
the concurrent REQ-0248/0251 (harness dedupe) and REQ-0252 (artadmin spec).

## Problem

Post-REQ-0234 the suite is architecturally sound, so this is not a rescue: it is
the tidy-up that audit explicitly left for later. Three things had accumulated.

1. **Two tests were strict subsets of tests in other files.** Not "similar" --
   subsets: every assertion in each was already made, verbatim, by a test that
   asserts strictly more. They cost a browser boot each and bought nothing.
2. **Eight specs each carried a private `loadFixtureAndBoot(page)`**, identical
   apart from which `FIXTURE_PATH` it closed over. Four called `bootApp()`; the
   other four inlined `bootApp()`'s own goto/badge/settle sequence by hand. Two
   halves of one contract, free to drift apart silently -- and the second half
   would not notice a `bootApp()` fix. This is the same "a fix that must be
   applied N times eventually gets applied N-1 times" shape REQ-0251 found in
   the harness shell scripts.
3. **The REQ-0234 (F3) waitForAutoSave rewrite missed one spec.** `auto-save.spec.ts`
   never called the helper, so it still slept a fixed 1600ms for the debounced PUT
   -- and it also hand-rolled its own copy of `drag()`. The spec whose entire
   subject is auto-save was the last one still sleeping for it.

## What was done

**Deleted (2 tests; coverage unchanged -- each a strict subset):**

| Deleted | Superset that keeps the coverage |
|---|---|
| `baseline-smoke.spec.ts` "app boots and shows the live data-source indicator" | `smoke.spec.ts` "app boots and shows the live data-source badge" -- same goto, same three assertions (badge text, badge class, h1); smoke's additionally asserts both board canvases are mounted |
| `tab-reorder-trash.spec.ts` test 4 "long-press ... still triggers rename after DnD wiring" | `long-press-rename.spec.ts` "squad tab: long-press renames inline, persists after reload via auto-save" -- same locator (`.squad-tab` nth(0)), same longPress -> rename-input -> fill -> Enter -> autoSaveAndFetch -> `presets.names[0]` flow; that one additionally proves the rename survives a reload |

The "after DnD wiring (no regression)" framing named no separate condition: the
reorder wiring is unconditional in the shipped app, so `long-press-rename.spec.ts`
has always exercised long-press WITH it present. There is no build in which the
deleted test could fail while its superset passed.

**Deliberately NOT deleted.** `landing.spec.ts` "boards survive landing
round-trips" and `nav-routing.spec.ts` "backpacks board round-trip ... (WebGL-churn
guard)" are structurally near-identical (same hang check, same p200 drag) and
landing's comment already points at nav-routing as its source of truth -- but they
drive genuinely different routes (landing's `route-hidden` path vs nav-link
routing). Same invariant, different code path: consolidated onto shared helpers,
both kept.

**Refactored:**
- `helpers.ts` gains `readFixture` / `loadFixtureFileAndBoot` (retires all 8
  private copies; `bootApp()` is the only boot path now), `reloadApp`,
  `assertPageResponsive` (the REQ-0031 Phase A busy-loop gate, previously
  copy-pasted into tab-switch-stability / nav-routing / landing) and
  `assertBaselineBoardsInteractive` (the p200 drag gate, previously in landing +
  nav-routing).
- `auto-save.spec.ts`: uses `drag()`; waits on the auto-save PUT **armed before
  the gesture** (so it cannot miss a save that flushed early) instead of sleeping
  1600ms; asserts the settled state directly instead of a 900ms idle sleep.
  Three fixed sleeps gone.
- Unused imports the above exposed: `tab-reorder-trash` (bootApp, longPress),
  `guest-auth` (bootApp -- pre-existing, its only mention was in prose).

Net: 12 files, +164/-189; 188 -> 186 tests.

## Gate results (2026-07-18)

Scoped hermetic run, this REQ's decade 2470-2479, GPU, 4 workers, quiet box:

| Tree | Result | exit | Wall |
|---|---|---|---|
| **This branch** | **185 passed / 1 skipped / 0 failed** | **0** | 3.4 min |
| Same tree, change stashed (= baseline) | 184 passed / 3 failed / 1 skipped | 1 | 3.4 min |

- 188 -> 186 tests = exactly the two deletions, nothing else lost.
- The baseline's 3 failures are all `workshop.spec.ts` (dismantle x2, clockwork
  pack) -- untouched by this REQ, a pre-existing flake family.
- `tab-reorder-trash.spec.ts` 3/3 green serially after the change.
- The 1 skip is unchanged: `dex-admin.spec.ts:102`, the REQ-0221/F1 files-fleet
  registry blind spot.
- **Wall time is unchanged (3.4 min both).** Stated plainly because it would be
  easy to imply otherwise: the two deleted tests were trivial, and the suite's
  runtime is dominated by schedule/workshop. The win here is maintainability and
  one fewer flake source, NOT speed.

## Findings recorded, deliberately NOT fixed here (out of the ratified scope)

1. **`grid-8x8.spec.ts` "canvas board and inventory board both render at 8x8"
   does not do what its comment claims.** The `page.evaluate` collects
   `{w, h, cssW, cssH}` and its comment says it cross-checks "the ACTUAL <canvas>
   element's width/height attributes (device-pixel-space, not just the CSS box)
   ... confirming the PixiJS Application itself was initialized with COLS=ROWS=8".
   It then asserts only `cssW`/`cssH` -- the CSS box `boundingBox()` already
   asserted six lines earlier. `w`/`h` are never asserted. The device-pixel
   cross-check does not exist.
2. **`grid-8x8.spec.ts` far-edge test is vacuous for its stated purpose.**
   `page.on('pageerror')` is registered at L89, AFTER `page.goto` (L84) and the
   badge wait + 400ms settle (L86). Any render error from the BP at the far edge
   -- the exact thing the test says it guards -- fires before the listener
   exists. `expect(errors).toEqual([])` can only observe a 300ms idle window.
3. **`client/e2e/` is typechecked by nothing.** `tsconfig.app.json` includes only
   `src`, `tsconfig.node.json` only `vite.config.ts`; `tsc -p tsconfig.json` has
   `files: []`. The specs are transpiled by Playwright at runtime and never
   type-gated. (Verified: `tsc --listFiles` lists 0 files under `client/e2e/`.)
   A standalone `tsc --noEmit` over `e2e/` was run by hand for this REQ and is
   clean for every touched file.
4. **The suite is not viable on the CPU path at 4 workers.** Without `E2E_GPU=1`
   this REQ's first baseline was 21 failed / 166 passed in 10.9 min (load 35 on
   8 cores, self-inflicted, SwiftShader); with GPU, 4.8 min. Every failure was a
   wall-clock timeout. `docs/llm_managed/e2e_harness.md` documents the scoped
   incantation without `E2E_GPU=1`, so a first-time reader gets the 21-red run.
   Worth either documenting GPU as required at 4-way, or defaulting it on.
5. **REQ-0234 F3 is live.** This REQ's own 4-way baseline flaked 4 tests under
   external load (all 22 passed serially); the quiet-box baseline flaked 3
   others. ~73 `waitForTimeout` sites remain across the suite.

## Log
- 2026-07-18 reserved as REQ-0247 (d2d92ab) on branch req-0247-e2e-suite-slimming.
- 2026-07-18 scope confirmed with the user: the DEFAULT suite (not the harness).
  Deletion set and refactor set ratified before any deletion.
- 2026-07-18 implemented (5184bcf); gates green (185/1/0, exit 0);
  reserved -> built, pending user acceptance and merge.
