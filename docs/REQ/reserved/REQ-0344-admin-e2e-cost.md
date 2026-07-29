# REQ-0344 — the admin e2e trio: GPU, artadmin's poll latency, and the :124 flake

## Status
built — 2026-07-29. Awaiting user acceptance / merge.

Three questions, each a MEASUREMENT first. Two of them turned out to have the
same answer.

---

## 0. What was asked, and what came back

| | question | answer |
|---|---|---|
| **A** | do the four standalone configs benefit from the GPU? | **yes, ~40%.** REQ-0342 §4's expectation is refuted |
| **B** | can artadmin's 12.2 s/test shrink by coupling the poll to the mock delay? | **yes, a further ~24%** on top of A |
| **C** | why does `artadmin.spec.ts:124` flake? | **root-caused and reproduced 2/2**; same cause as A |

`tools/artadmin_e2e.sh` wall, same box, 8/8 green throughout:
**119.0 s → 52.8 s (−56%)**, i.e. 14.9 s/test → 6.6 s/test, and stage
`[6.5/8]` **192.6 s → 100.7 s (−48%)**.

---

## 1. (A) The standalone configs were never on the GPU, and it matters

### The claim under test

REQ-0342 §4: *"I expected GPU not to help them … the cost is latency rather than
pixels. **That expectation is untested.**"*

It is wrong, and the reason is one line of `client/src/App.tsx`. REQ-0034's rule
(App.tsx:21-31) keeps **both PixiJS Applications mounted on every route** — a
route switch only adds `.route-hidden` (`display:none`), never unmounts. So
`#/artadmin`, whose visible surface is pure DOM, still builds and drives two live
WebGL scenes. Under SwiftShader that is not free:

- chromium `--type=gpu-process`: **500–660% CPU** sampled through a run, on an
  8-core i7-9700.
- `nvidia-smi` at the same moment: **0% utilisation, 247 / 8192 MiB**. The GPU
  this box has was idle while six of its eight cores emulated one.

`client/e2e/{artadmin,artinspect,contentadmin,registry}.config.ts` are
standalone `defineConfig`s — they do not import `client/playwright.config.ts` —
and each set `headless: true` with no `launchOptions`. REQ-0342 flipped the
default in a file none of them read.

### Measured

`tools/artadmin_e2e.sh`, 3 runs each, nothing else changed:

| | run 1 | run 2 | run 3 |
|---|---|---|---|
| software (before) | 118.0 s | 121.0 s | 118.1 s |
| GPU (after) | 74.0 s | 72.5 s | ~72 s |

Per test, the shape is the interesting part — it is **not** the render waits
that moved:

| spec | what it does | software | GPU |
|---|---|---|---|
| `:49` create → 3 renders → adopt | 3 renders | 19.6 s | 16.6 s |
| `:124` cell backdrop | 2 renders | 19.7 s | 11.8 s |
| `:197` registry search/filters | **0 renders** | 9.4 s | **0.98 s** |
| `:231` queue cancel + retry | 5 renders | 19.4 s | 16.6 s |
| `:273` deep link | **0 renders** | 9.1 s | **0.54 s** |
| `:286` custom kind | 0 renders | 1.2 s | 1.1 s |
| `:309` true-scale thumbs | 2 renders | 12.4 s | 9.1 s |
| `:344` same-seed A/B | 2 renders | 24.8 s | 14.3 s |

The tests with **no renders at all** — which by REQ-0342's theory should have
been the cheapest and the least affected — fell by 9-17x. That is the tell.

### Where the 8 s went (Playwright trace, software run)

Running the spec through a trace-on clone of its own config and summing action
durations, the cost is the **first interaction after `page.goto`**:

| spec | first action after goto | software |
|---|---|---|
| `:124` | `click art-select-e2e_axe` | **6.86 s** |
| `:197` | `expect art-select-e2e_sword visible` | **7.53 s** |
| `:273` | `expect artadmin visible` | **8.27 s** |
| `:344` | `click art-new` | **8.57 s** |
| `:49` `:231` `:286` `:309` | (same kind of action) | ≤ 1.5 s |

The split is not random: **a test's opening stalls iff the previous test
generated renders.** Every completed render auto-enqueues its inspection kits
(`server/services/art_jobs.cjs:182`, REQ-0152), each of which spawns a python
child; the pump's REQ-0233 family grouping then drains all queued matte work
before the next generation. So the box is still working through the previous
test's kits while the next page boots — and under SwiftShader that oversubscribes
it. On GPU the same openings are 0.4-1.5 s.

### What changed

The flags now live **once**, in `client/e2e/gpu.ts`, together with REQ-0331's
renderer probe moved verbatim out of `global-setup.ts`. Before this there were
two copies of the argv list and four configs with neither — the precise shape
`tools/e2e_harness.sh`'s own header warns about ("a fix that must be applied four
times gets applied three times"). Six consumers, one definition.

The four standalone configs also gain `client/e2e/gpu-setup.ts` as their **only**
`globalSetup`. It asserts `UNMASKED_RENDERER_WEBGL` and does nothing else: no
fleet, no state, no lock, so their isolation contract is untouched (their headers
were corrected from "No globalSetup" to "No fleet globalSetup" rather than left
contradicting the file). Without it a silent ANGLE fallback costs 65% of these
stages again with no signal — which is exactly the four-day regression REQ-0331
was written about, and REQ-0342's own thesis that a warning nobody reads is not
a gate.

---

## 2. (B) The mock delay and the poll interval were one setting wearing two names

`tools/artadmin_e2e.sh:22` held every mock job `ART_MOCK_DELAY_MS=1500` so the
queue spec could observe a PENDING entry. Its header said why. What it did not
say is that 1500 was chosen **against** `ArtAdminPage.tsx:144`/`:149`'s 2000 ms
queue and detail polls: a job had to outlive a poll gap to be seen at all. One
half of the pair was a harness env var; the other was a compiled-in constant. So
the floor could never move, and each of the spec's 14 mock renders paid
1500 ms + up to 2000 ms of detection latency.

### The seam, and the three that were rejected

The poll now arrives from **`GET /api/config`** — the app's existing runtime
config channel (REQ-0341). `server/routes/public.cjs` **omits the key** (rather
than sending `null`) unless `ART_ADMIN_POLL_MS` is in the api process's
environment. Consequences worth stating:

- An ordinary server's `/api/config` body is **byte-for-byte** what REQ-0341
  shipped. The three existing `deepStrictEqual` cases in
  `server/tests/api/public.cjs` and `client/e2e/runtime-config.spec.ts:32`'s
  `toEqual` therefore became the regression guard for this field for free —
  neither needed editing, and either would have caught a leak into production.
- Production cannot reach the knob without an EnvironmentFile edit: the *same*
  trust boundary `ART_MOCK_DELAY_MS` already sits behind. The two are now set
  **together, in one env block**, in the one harness that wants either.

Rejected, and why:

- **`import.meta.env.VITE_ART_POLL_MS`.** `web/app` is a TRACKED build artifact.
  REQ-0341 exists because making its bytes depend on env shipped broken sign-in
  twice (42238f8, 2517c83). A build-time knob would re-arm that and additionally
  make the committed bundle differ between a run that set it and one that did not.
- **`localStorage` seeded via `use.storageState`.** Config-only, no client
  plumbing, genuinely tempting — but a real production browser can set it, so the
  guarantee degrades from "unreachable" to "unlikely".
- **A query param.** Would require editing eight `page.goto` lines in a spec this
  REQ is otherwise not allowed to touch.

Client-side the interval is **state seeded from the memoised promise
`store/boot.ts` already awaits**, not a module constant: it settles in a
microtask, so the intervals re-arm once, before their first tick. The list poll
is a **multiple** (×5) of the fast one rather than a second knob, so an override
moves all three together and cannot produce a 1:1:5 ratio nobody has ever run.

### Measured (GPU on, i.e. on top of A)

| poll | delay | wall | vs (A) alone |
|---|---|---|---|
| 2000 | 1500 | 74.0 / 72.5 s | — |
| 250 | 1500 | 66.3 s | −8% |
| 2000 | 750 | 62.3 s | −15% |
| **250** | **750** | **55.4 s** | **−24%** ← chosen |
| 250 | 400 | 50.9 s | −30% ← declined |

### Why 750 and not 400

`artadmin.spec.ts:231` queues 5 jobs and cancels the **last pending** one, so the
window it must click inside is `4 × delay`: **3.0 s at 750 ms, 1.6 s at 400 ms.**
Measured need is ~0.5 s (one poll + `innerText` + the click). Trading a 6× margin
down to 3× to buy 4.5 s of wall is a bad trade on the one property this delay
exists to preserve. 400 ms is recorded here as measured-and-declined, not
untried.

### Proof the spec still catches the bug it exists for

A deliberate regression, applied to `server/services/art_jobs.cjs:525-530` —
cancellation removed for **PENDING jobs only**, the running-job path left intact.
That is precisely the defect a too-short delay would hide: if the last job were
already RUNNING when the spec clicked cancel, the spec would silently exercise
the running path and a pending-only bug would sail through green.

| | artadmin at the chosen poll 250 / delay 750 |
|---|---|
| with the regression | **1 failed** — `:231`, line 254, `expect(render-status-N).toHaveText('[failed]')` |
| what the spec saw instead | `[queued]` → `[running]` → `[ok]` |
| the other seven | green — the break is localised |
| after revert (`git diff` empty) | **8 passed**, 53.3 s |

The rejected *sequence* is the answer to "are the states still observable?". The
spec did not merely fail to find `[failed]`; it watched the job go
queued → running → ok, i.e. it saw the pending state it is supposed to act on,
and correctly refused the outcome. At 250/750 this test still proves what it was
written to prove.

---

## 3. (C) The `:124` flake — root-caused, and reproduced 2/2

### It failed again, unprompted, while this REQ was being investigated

A `tools/release.sh` run on the main checkout went red at 09:27 on 2026-07-29,
at `artadmin.spec.ts:130`, 7 passed, 1 failed, 2.7m — the same signature as the
original sighting. Its trace was preserved before the tree was reused.

### The evidence

The failure's call log is the first clue:

```
TimeoutError: locator.click: Timeout 15000ms exceeded.
  - waiting for getByTestId('art-select-e2e_axe')
    - locator resolved to <button type="button" class="aa-row" data-testid="art-select-e2e_axe">…</button>
  - attempting click action
    - waiting for element to be visible, enabled and stable
```

The element **existed**. The page snapshot taken at failure shows a completely
healthy console: both rows rendered, `Queue 0`, `idle`. This was never "the
registry list failed to load".

The trace's network log says what actually happened. Times are the trace clock:

```
24388    GET /app/
24735    GET /api/art/artworks -> 200 (10.8 ms)     <- list arrived 350 ms after load
24804    GET /api/profile/dev/canvas -> 200
57438    GET /api/art/queue -> 200                  <- the next request, 32.6 s later
```

`ArtAdminPage` runs a 1 s clock, a 2 s queue poll, a 2 s detail poll and a 10 s
list poll. **Not one of them fired for 32.6 seconds.** The page's timers were not
running, which is also why Playwright's in-page actionability check ("visible,
enabled and stable") never completed. The last request before the silence is
`/api/profile/dev/canvas` — the payload the two always-mounted Pixi boards build
their scenes from.

That matches §1's trace exactly: the same stall, measured at 6.86-8.57 s on an
idle box, is unbounded on a loaded one.

### Reproduced

Six CPU hogs (`sha256sum /dev/zero`) alongside the harness, `ART_MOCK_DELAY_MS`
and the poll held at the ORIGINAL 1500/2000 so only the renderer differs:

| run | renderer | result | wall |
|---|---|---|---|
| 1 | SwiftShader (`E2E_GPU=0`) | **1 failed** — `:124`, `locator.click: Timeout 15000ms`, 7 passed | 162.9 s |
| 2 | SwiftShader (`E2E_GPU=0`) | **1 failed** — `:124`, same error, 7 passed | 161.3 s |
| 3 | NVIDIA | 8 passed | 85.3 s |
| 4 | NVIDIA | 8 passed | 87.8 s |

2/2 red on software, 2/2 green on GPU, same load, same everything else. It
reproduced on the **first** attempt.

`:273` (deep link) is the next-nearest miss and worth naming: under the same CPU
load it took **20.9 s against a 30 s budget** — 9 s from red — and 1.0 s on GPU.
The flake was never specific to `:124`; `:124` is simply the assertion with the
tightest budget (`actionTimeout: 15 s`) sitting immediately after a `goto` that
follows a render-producing test.

### Honest limits of this root cause

- The mechanism is **established by correlation and by intervention** (removing
  SwiftShader removes the red, 2/2 vs 2/2), not by a profile of the stalled
  main thread. I did not capture a JS sample inside the 32.6 s window; the
  browser was not responsive enough to ask.
- The two reproductions' call logs differ in their **last line** from the gate
  failure's: mine time out with the locator never resolving, the gate's with the
  locator resolved and the actionability check unfinished. Same error, same line,
  same timeout — but that is two points on one spectrum (how far into the 15 s
  the row appeared), not an exact replay.
- Nothing here was fixed by **retry or by a longer timeout**, per REQ-0159. The
  budgets are untouched. `actionTimeout` stays 15 s; it now has ~15-20× margin
  instead of ~2×.
- What remains **unproven**: that GPU rendering eliminates this class of stall
  rather than moving it out of reach. A sufficiently loaded box will still starve
  a renderer. The claim proven here is narrower and is the one that matters for
  the gate: at the load that reliably reddened software, GPU is green with room.

---

## 4. Measured but NOT changed — the inspection-kit floor

Worth recording because it is the next-largest term and I deliberately left it
alone. Every OK render auto-enqueues its inspection kits
(`server/services/art_jobs.cjs:182`), each spawning a python child, and the pump
serialises them against generation. In the software trace this showed as
`render-status-<seed>` waits of 1.8 s for a *first* render but **5.9 s for
subsequent ones** — ~3.4 s per render that is neither the mock delay nor the
poll.

`artadmin.spec.ts` asserts **nothing** about inspections; REQ-0152's coverage
lives in its own harness (`tools/art_inspect_e2e.sh`, `[6.5/8]`'s second script).
So an `ART_AUTO_INSPECT=0` for this harness is probably ~15-20 s more. Not done
here: it changes what the harness exercises rather than only how fast it runs,
and bundling it with two changes that are already measured would make this REQ's
numbers mean less. Its own REQ, with its own before/after.

---

## 5. Files

**(A)** `client/e2e/gpu.ts` (new) · `client/e2e/gpu-setup.ts` (new) ·
`client/e2e/{artadmin,artinspect,contentadmin,registry}.config.ts` ·
`client/e2e/global-setup.ts` · `client/playwright.config.ts`

**(B)** `server/routes/public.cjs` · `server/tests/api/public.cjs` ·
`client/src/auth/client.ts` · `client/src/artadmin/ArtAdminPage.tsx` ·
`client/scripts/check_auth.mjs` · `tools/artadmin_e2e.sh`

**(C)** no code. The fix is (A).

No test assertion was changed, no timeout lengthened, no retry added. The only
product-code change is `ArtAdminPage.tsx`'s three intervals becoming a value
whose default is the number that was there before.

## 6. Gate

`tools/release.sh` on `req-0344-admin-e2e-cost`, `CI_SCOPE=both`,
`E2E_GPU` deliberately unset (the GPU comes from the default):

**CI GREEN** · `dist committed` (206e4fe1) · ci.sh TOTAL **391.8 s**, CI_WALL 402.8 s

| | baseline | this run |
|---|---|---|
| client e2e `[7/7]` | 206 passed / 0 failed / 1 skipped | **206 / 0 / 1** |
| admin trio | 8 / 1 / 28 | **8 / 1 / 28** |
| registry `[6.6/8]` | 4 / 4 | **4 / 4** |

Stage wall, `CI_STAGE_TIMINGS`, against the same three harnesses re-run with
`E2E_GPU=0` (which makes `gpu.ts` emit exactly the old `headless: true`, no args,
no probe — a byte-equivalent reconstruction of the before state):

| harness | before (software) | after |
|---|---|---|
| `artadmin_e2e` | 118.0 / 121.0 / 118.1 s | **52.8 s** (A+B) |
| `art_inspect_e2e` | 24.0 s | **11.8 s** (A) |
| `content_admin_e2e` | 49.6 s | **30.5 s** (A) |
| **stage `[6.5/8]`** | **~192.6 s** (REQ-0342 recorded 191.0 s) | **100.7 s  (−48%)** |
| stage `[6.6/8]` registry | 11.2 s | **7.3 s  (−35%)** |

~96 s off a ~490 s ci.sh, from two stages, with every count unchanged.
`[gpu-check] … CONFIRMED -- ANGLE (NVIDIA, Vulkan 1.4.329 (… RTX 2080 …), NVIDIA)`
appears once per standalone config in the log, which is the assertion doing its
job rather than a claim about it.

Per test, artadmin in that gate run (was 14.9 s/test, now 6.6 s/test):
`:49` 12.9 s · `:124` 8.6 s · `:197` 1.0 s · `:231` 11.0 s · `:273` 0.62 s ·
`:286` 1.2 s · `:309` 6.5 s · `:344` 9.5 s.

## Log
- 2026-07-29 reserved as REQ-0344 on branch req-0344-admin-e2e-cost
  (off master 5557664).
- 2026-07-29 (A) implemented + measured; (B) implemented, swept over four
  poll/delay pairs, deliberate-regression checked; (C) root-caused from a live
  gate failure's trace and reproduced 2/2 under load. Full gate; reserved → built.
