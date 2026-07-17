# REQ-0252 - artadmin spec restructure

**Status:** Todo
**Reserved:** 2026-07-18
**Slug:** artadmin-spec-restructure

## Problem

`client/e2e/artadmin.spec.ts` (333 lines, 7 tests) has accreted through
REQ-0151 -> 0156 -> 0173 -> 0179 -> 0191 -> 0216. Each REQ appended a test in
the style of the one before it, so the same four idioms are now open-coded in
every test:

| idiom                                  | sites |
|----------------------------------------|-------|
| `POST /api/art/dev/clear-all`          | 7 (every test's first line) |
| 5x5 blank-mask boilerplate             | 3     |
| `art-select-<name>` click + editor wait| 5     |
| `art-gen-next` click + `waitStatusOk`  | 7     |

None of this is wrong; it is just repeated. The cost is that the next REQ to
add a test copies 6 lines of ceremony before reaching anything specific to it,
and a change to the ceremony is a 7-site edit.

## Scope

`client/e2e/artadmin.spec.ts` ONLY. Behaviour-preserving: same 7 tests, same
assertions, same order, same results. No production code, no config, no harness.

Extract:
- `mask(...[row, col])` -- 5x5 builder; replaces the 3 hand-rolled grids.
  Named shapes `SWORD` / `L` / `GEM` keep their REQ rationale comments.
- `test.beforeEach` -- the clear-all every test already opens with.
- `selectArtwork(page, name)` -- click + editor-visible wait.
- `genNext(page, seed)` -- gen-next click + `waitStatusOk(seed)`.

Keep as-is: `waitStatusOk`, `confirmClick`, `apiCreate` -- already factored.
Keep verbatim: every REQ rationale comment (REQ-0191's L-tromino note, the
mock-opacity/white-key note, REQ-0216's px-per-cell note). They record why a
test is shaped the way it is; they are the reason this file is maintainable.

## Out of scope -- owned by REQ-0251 (e2e-harness-dedupe)

**The config-fallback port drift is NOT this REQ's.** `artadmin.config.ts`
defaults `BASE_URL` to `127.0.0.1:8903`, outside REQ-0156's derived decade
(1560-1569; proxy = 1562). The siblings drift the same way -- artinspect 8913
(REQ-0152 -> 1522), contentadmin 8923 (REQ-0157 -> 1572). All three are
pre-REQ-0172 fossils: REQ-0172 fixed the `.sh` harnesses and left the configs,
which survived because `check_e2e_ports.cjs` scans only `tools/*_e2e.sh` and
never the configs. (`registry.config.ts` is correct -- REQ-0221 postdates the
rule.) It is hidden at runtime because each harness passes an explicit
`PLAYWRIGHT_BASE_URL`; it bites only when a config is driven directly.

REQ-0251 already owns this, verbatim, with a worktree in flight. REQ-0249 was
an independent rediscovery of the same defect and was dropped as a duplicate,
burning 0249 (see commit 1ac6de6). **This session rediscovered it a THIRD
time.** It is recorded here so the next one does not spend the search again --
and does not fix artadmin's 8903 alone, which would collide with 0251's
three-config sweep. One config fixed out of three is worse than none: it makes
the remaining drift look intentional.

## Gate

`bash tools/artadmin_e2e.sh` green, 7/7 -- the same 7 that pass before the
change. A refactor whose gate is "the tests still pass" is only honest if the
tests are unchanged, so the diff must show no assertion added or removed.
