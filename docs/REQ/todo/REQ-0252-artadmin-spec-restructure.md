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

## Outcome

Implemented in `ae37e7a`. Footprint is exactly two files: the spec and this
REQ. `artadmin.config.ts` and `tools/artadmin_e2e.sh` were deliberately left
alone (REQ-0251), so this branch cannot conflict with the harness work.

Extracted: `mask()` row-major builder (+ named `swordMask`/`lMask`/`gemMask`),
`test.beforeEach` clear-all, `selectArtwork()`, `genNext()`. Hoisting the
clear-all left the custom-kind test with no use for its `request` fixture, so
it drops it.

Line count went 333 -> 340. This is a dedupe that does not shrink the file:
the removed ceremony (~42 lines) is offset by the helpers and by comments
recording why the shapes and the REQ-0251 boundary are what they are. The win
is edit-locality, not brevity -- a change to the clear-all or the select-wait
is now one site instead of seven or five.

## Gate results

| run | spec | result |
|-----|------|--------|
| baseline (`ae37e7a~1`, md5 f8cfe8af) | pre-refactor | **7 passed**, RC=0, 1.6m |
| refactored (`ae37e7a`, md5 232ad7d0) | post-refactor | **7 passed**, RC=0, 1.6m |

Both run through `tools/artadmin_e2e.sh` in this worktree, same environment,
baseline run second to rule out ordering. `tsc --noEmit` clean. Static parity
check: no unique assertion text added or removed; the `expect()` count drops
87 -> 83 purely because 5 `art-editor` visibility sites collapse into one
helper (7 -> 3 literal sites, +1 in the helper). The deep-link test's distinct
`toBeVisible({ timeout: 30000 })` was correctly not collapsed.

## Notes for the harness REQs (0248 / 0251), found while running this

Not acted on -- recorded so they are not rediscovered a fourth time.

1. **The port preflight aborts silently.** With 1560-1562 held, running
   `tools/artadmin_e2e.sh` exits **75 with zero output** -- no `[e2e-ports]
   ... is BUSY` line, with or without `set -e`. The success path
   (`REQ-156 -> static:1560 ...`) prints fine, so it is specific to the busy
   branch. This defeats the helper's stated purpose ("One clear line beats
   forty confusing ones"): the operator sees an instant, silent, non-zero
   exit. Root cause not pinned -- it is the rig's file, not this REQ's.
2. **Same-harness runs do not queue; the second one dies.** `e2e.0156.lock`
   is taken inside `e2e_run.sh`, i.e. AFTER the harness has already bound its
   ports. So two worktrees running artadmin concurrently (0248 and 0251 both
   did, during this REQ) do not serialise: the first binds 1560-1562 and the
   second aborts on preflight. The comment claims "Same-harness runs still
   queue" -- they do not, unless the first is already past bringup. Combined
   with (1), the second run just vanishes.
3. **The bringup logs collide across worktrees.** `/tmp/req0156_e2e_api.log`
   and `/tmp/req0156_e2e_proxy.log` are hardcoded, so every worktree running
   artadmin overwrites the same two files. During this REQ the log showed
   another worktree's api on :6561 while debugging a failure in this one --
   actively misleading. The paths should carry the worktree or the run.
4. **A fresh worktree needs three installs, not one.** `client/`, `server/`,
   and the root each have a package.json; provisioning only `client/` yields
   `Cannot find module 'pg'` and a 502-on-everything run whose Playwright
   output blames `apiCreate`, not the api that never booted. `server/.env` is
   gitignored and must be copied in too. PROJECT.md says "repeat in any other
   dir that has its own package.json"; the harness could just check.
