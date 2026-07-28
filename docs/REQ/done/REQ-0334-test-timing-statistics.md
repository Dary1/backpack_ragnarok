# REQ-0334 — Per-test timing for every suite, and what it says about test waste

## Status
built — implemented and gated 2026-07-28. Awaiting user acceptance / merge.

Asked for directly by the user after REQ-0331: *"are there meaningless tests,
especially slow ones that have gone stale? if the timing data doesn't exist,
add it to every test first so statistics can be produced."* The second half is
the deliverable; the first half could not be answered honestly without it.

---

## 1. Why the question could not be answered before

Only Playwright measured anything. Its JSON reporter gave per-test durations for
198 e2e tests; the **other 43 node suites printed `PASS  <name>` with no clock
at all**, and `tools/ci.sh` announced 42 stages with bare `echo`s. So "which
tests are expensive?" was answerable for 15% of the tests and, for the rest, only
by sitting and watching which banner the run was parked on. REQ-0331's audit had
to hand-time suites one at a time to say anything at all.

## 2. What was added

**`tools/lib/test_clock.cjs`** — a shared, zero-dependency clock. Each harness's
own `T()`/`AT()` keeps printing its own PASS line; it just appends
`clk(name, t0)`, which formats the duration and records it.

- always: the PASS line gains `  (12ms)`.
- on exit: a footer naming that suite's own slowest test, so a plain
  `node server/tests/api_test.cjs` is self-diagnosing with no flags.
- with `TEST_TIMINGS_OUT=<path>`: one JSON object per test, **appended**, so a
  whole ci.sh run collects 40+ processes into one file.

Wired into **39 harness files** by script (`T`/`AT` in both `function` and arrow
form). Two `tools/*.cjs` gates also print `PASS  ` lines — `inspect_pack_formation`
and `check_stat_bands` — and were deliberately left alone: they are inspection
gates over content, not test harnesses, and their "tests" are content rows.

> **Implementation note worth keeping.** The first attempt inserted
> `const { clk } = require(...)` after each file's last top-level `require` and
> broke 345 tests. These suites call `T()` **at module scope** — `sim/tests/run.cjs`
> starts firing tests at line 80 of a 2000-line file — so the `const` sat in the
> temporal dead zone when the early tests ran. The shipped form is a hoisted
> `var __clock` + `function clk()` appended at the END of each file: function
> declarations hoist regardless of position, so placement stops being a
> correctness question, and the require is deferred to first call so it never
> runs ahead of a harness's own `os.homedir()` redirection.

**`tools/ci.sh`** — 80 `echo "==== … ===="` banners became `stage "…"`, which
prints the same banner and closes the previous stage with its wall time. The run
ends with the stages sorted slowest-first. `CI_STAGE_TIMINGS=<path>` also appends
`<ms>\t<label>` for comparing runs over time.

> Second note: `date +%s%3N` on this box **ignores the `%3N` precision modifier**
> and emits full nanoseconds, which produced a first table of 19-digit
> "milliseconds". The shipped code divides `%s%N` by 1e6 instead of trusting the
> format string.

**`client/playwright.config.ts`** — setting `PLAYWRIGHT_JSON_OUTPUT_NAME` now
also enables the JSON reporter (the list reporter stays the default and the only
one an ordinary run pays for). Without this, ci.sh's e2e stage produced no
machine-readable timings at all.

**`tools/test_timings.cjs`** — merges both sources into one ranked report:
by suite, the N slowest individual tests, and concentration. The point of merging
is that the interesting comparison is *across* suites — a 12 s e2e test and a
40 ms unit test asserting the same invariant is the finding, and you cannot see
it while the two live in separate reports.

    rm -f /tmp/bpk_timings.jsonl /tmp/bpk_stages.tsv /tmp/bpk_e2e.json
    TEST_TIMINGS_OUT=/tmp/bpk_timings.jsonl \
    CI_STAGE_TIMINGS=/tmp/bpk_stages.tsv \
    PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/bpk_e2e.json  bash tools/ci.sh
    node tools/test_timings.cjs --top 40

## 3. First measurement (full green ci.sh, 2026-07-28, restored GPU)

**1337 tests, 747.7 s of summed test time, 504.9 s wall.**

### Where the wall time is — three stages are 84% of ci.sh

| stage | wall | share |
|---|---|---|
| `[7/7]` client e2e (default suite, 198 tests, 4 workers) | **182.1 s** | 37% |
| `[6.5/8]` admin e2e trio (artadmin + artinspect + contentadmin, 37 tests) | **165.6 s** | 33% |
| `[5.1/7]` `server/tests/artwork_test.cjs` (pg, 19 tests) | **70.3 s** | 14% |
| the other 39 stages combined | ~80 s | 16% |

Of those 39, **31 finish in under a second** and 16 in under 0.1 s.

### Where the test time is — and how little of it is spread out

| | |
|---|---|
| top 10 tests | 14.3% of measured test time |
| top 50 tests | 48.8% |
| **912 tests (68%) run in under 10 ms** | ~0% |

`server/tests/api/harness.cjs` runs **444 tests in 7.6 s** (0.02 s each).
`sim/tests/run.cjs` runs **185 tests in 0.6 s**. `mock-src/tests/run.cjs` runs
123 in 0.14 s.

## 4. So: is anything meaningless or stale?

**Essentially no — and the data says the question was aimed slightly off-target.**

**(a) There is no case for deleting cheap tests, and they are most of them.**
Two thirds of the suite runs in under 10 ms per test. Removing every single one
of those 912 tests would save under 2 seconds of a 505-second run. Their cost is
not the issue and never was; they are the cheapest coverage in the repo.

**(b) Nothing was found that is actually obsolete.** Grepping the specs for
retirement language (`retired`, `superseded`, `deprecated`, …) returns 34 hits,
and reading them shows the opposite of staleness: they are *negative guards*
protecting retirements — `dex-admin.spec.ts` exists precisely because REQ-0182b
removed the Dex Edit UI and "the retired surface must not creep back";
`auto-save.spec.ts` and `baseline-smoke.spec.ts` note that Save/Load buttons are
gone and assert the behaviour that replaced them. One **title** is stale —
`baseline-smoke.spec.ts:75` still says "verified via Save + profile fetch" when
that button no longer exists — which is a comment fix, not waste.

**(c) The real finding is that cost is concentrated in three places, and only
those three are worth arguing about.**

1. **`artwork_test.cjs` is bimodal and is the most expensive *unit* file in the
   repo.** 11 of its 26 tests (counting its artqueue/artfamily siblings) cost
   6–12.6 s each — ~82 s — because each drives a full mock generate → adopt →
   export → serve cycle; the other 15 cost **0.1 s combined** because they are
   pure storage-law assertions. Several of the expensive ones repeat the *same*
   adopt+serve+export cycle for a different kind (`REQ-0280 vfx HIT`,
   `REQ-0280 vfx RAY`, `REQ-0292 skill_icon`). That is a shared-fixture
   opportunity worth ~40 s, **not** a deletion candidate: each asserts a
   different tiling/sizing law.
2. **The admin e2e trio costs almost as much as the entire default e2e suite**
   (165.6 s vs 182.1 s) for 37 tests vs 198. `artadmin.spec.ts` alone is 8 tests
   in ~100 s — **12.5 s per test, the most expensive tests in the repo.** Each
   harness boots its own isolated pg api with a fresh storage namespace
   (REQ-0159's HOME-remap design). That design is deliberate and load-bearing;
   what is *not* obviously deliberate is paying three separate cold boots.
3. **The default e2e suite has no monster test.** Its distribution is flat — top
   10 tests are 14% — so there is nothing to cut. REQ-0331 already took the one
   structural win available (the `bootApp` fixed sleep). The remaining
   consolidation candidate is the **WebGL-churn cluster**: `landing.spec.ts:115`,
   `nav-routing.spec.ts:124` and `landing.spec.ts:139` assert the same invariant
   (2 canvases before and after, page not wedged, boards still interactive) via
   three different churn vectors, ~24 s total, with the assertion apparatus
   triplicated. Three vectors is legitimate coverage; three cold boots is not.

**None of (1)–(3) is a deletion. All three are "share the setup".** That is the
honest answer: this suite is not carrying dead weight, it is paying for the same
expensive setup repeatedly.

## 5. Deliberately NOT done here

No test was deleted, merged or weakened. This REQ adds measurement and reports
what it measured; acting on §4(c) changes what the gates prove and belongs in its
own REQ, with the before/after numbers this tooling now makes cheap to produce.

The suite-label granularity has one known limitation: all 444 `api_test.cjs`
sub-suites report under `server/tests/api/harness.cjs`, because that is where
`T`/`AT` are defined. Fixing it means passing a label per sub-module; not worth
it until someone needs to rank *within* api_test.

## 6. Gate results (2026-07-28)

- `tools/release.sh` — **CI GREEN**, 504.9 s wall, `dist unchanged`.
- Per-suite counts identical to before instrumentation, checked explicitly:
  `sim/tests/run.cjs` 185/0, `server/tests/api_test.cjs` 222/0 on both backends,
  `mock-src/tests/run.cjs` 123/0, admin trio 8/1/28, registry 4/4,
  scoped e2e 197 passed / 0 failed / 1 skipped.
- The first instrumentation attempt's 345 failures are recorded in §2 on purpose:
  the counts above are the evidence that the shipped form does not repeat it.

## 7. Files

| file | change |
|---|---|
| `tools/lib/test_clock.cjs` | new — shared per-test clock + JSONL recorder |
| `tools/test_timings.cjs` | new — merged ranked report over both sources |
| `tools/ci.sh` | 80 banners → timed `stage`; slowest-first summary |
| `client/playwright.config.ts` | JSON reporter when `PLAYWRIGHT_JSON_OUTPUT_NAME` is set |
| 39 harness files under `sim/tests`, `server/tests`, `tools/tests`, `mock-src/tests` | timed PASS line + hoisted `clk` shim |

## Log
- 2026-07-28 reserved as REQ-0334 on branch req-0334-test-timing-statistics
  (off master b99d297, i.e. after REQ-0331/0333 landed).
- 2026-07-28 implemented; first attempt's TDZ failure diagnosed and replaced
  with the hoisted form; full green gate + first measurement; reserved -> built.

## Deploy record (2026-07-28)
- Merged to master f29b020 (--no-ff). Gate before the merge: `tools/release.sh`
  **CI GREEN**, 504.9 s, `dist unchanged -- nothing to commit`.
- **No service restart, no dist rebuild.** Every changed path is a test harness,
  a tool, or docs; the only file outside a tests/ directory is
  `client/playwright.config.ts`, which is test configuration and is not part of
  the shipped bundle. Verified post-merge anyway: backpack-api / backpack-web /
  backpack-tunnel / comfyui all active, api 200, web 200, tunnel 200.
- built -> done.
