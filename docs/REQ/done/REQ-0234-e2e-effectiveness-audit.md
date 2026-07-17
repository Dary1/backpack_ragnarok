# REQ-0234 — E2E effectiveness audit (external, read-only)

## Status
draft — external audit report delivered 2026-07-17; findings await owner
ratification. Each finding below is REQ-ready (problem / evidence /
recommendation) so accepted items can be lifted into their own REQs or
merged into the existing drafts they endorse (REQ-0221/0222/0225/0230/0231).

**Auditor:** external E2E audit engineer (LLM session, 2026-07-17)
**Method:** static audit of the harness, specs, tooling and CI integration on
master (a7b0724), plus one measured hermetic scoped run executed from this
REQ's own worktree (`req-0234-e2e-effectiveness-audit`, decade 2340-2349).
No live service, live data row, or foreign worktree was touched.

---

## 1. Executive verdict

The post-REQ-0214/0217 e2e stack is **architecturally excellent** — hermetic
by construction, machine-enforced port hygiene, defense-in-depth profile
isolation, broad and dense feature coverage, and a genuinely strict
"CI GREEN means literally green" discipline. The measured run confirms it:
**187 passed / 1 skipped / 0 failed in 3.4 minutes**, with the live-state
fingerprint byte-identical before and after.

Effectiveness is nevertheless reduced by four structural issues, in
descending severity:

1. the **registry-first (pg) serving path is structurally untestable** in the
   default suite (the fleet is files-backend) — the suite's single skip IS
   this blind spot (F1);
2. the **standard CI entrypoints for e2e are currently dead**: ci.sh [6.5/8]
   and [7/7] both route through the box lock that the REQ-0217 freeze daemon
   holds indefinitely, and ci.sh has no scoped-run mode (F2);
3. **pervasive wall-clock synchronization** (~76 fixed-sleep sites plus the
   time-based auto-save helper) makes the suite load-sensitive on a box that
   the suite itself saturates (load hit 13.9/8 cores during the audit run),
   and retries:0 turns every load flake into an aborted cycle (F3);
4. several **box-global mutable seams survive inside "scoped" runs** (fixed
   /tmp ledger path, shared log-archive dir) (F4).

None of these are regressions; F1-F3 are already partially self-diagnosed in
draft REQs. This audit independently confirms them with fresh evidence and
adds F4-F6.

---

## 2. Measured run (primary evidence)

Scoped hermetic run per docs/llm_managed/e2e_harness.md, from this REQ's
worktree at master a7b0724:

    E2E_FLEET_ROOT=/tmp/bp_e2e_workers_req0234 E2E_PROXY_PORT=2342 \
    E2E_FLEET_BASE_PORT=2344 PLAYWRIGHT_BASE_URL=http://127.0.0.1:2342 \
    E2E_PARALLEL=4 E2E_GPU=1 pnpm exec playwright test

| Metric | Value |
|---|---|
| Result | **187 passed / 1 skipped / 0 failed** (exit 0) |
| Wall time | **3.4 min** (207.5 s), 4 workers, GPU (ANGLE/Vulkan) |
| Suite size | 188 tests / 33 spec files (default); +36 tests / 3 files (admin trio, harness-only) |
| Box load during run | peaked **13.9** on 8 cores (quiet before: 0.15) |
| Hermeticity check | top-3 mtimes + file count (230) of `~/backpack_ragnarok/data` + `content/live` **identical** before/after |
| The 1 skip | `dex-admin.spec.ts:102` — the REQ-0182b 409 guard for registry-served items: *"no adopted def available"* on the files fleet. This is exactly finding F1. |
| Stability cross-check | identical outcome to REQ-0217's gate run (187/1/0) on a different day/decade — no fresh flake observed on a quiet box |

Run log: `/tmp/req0234_e2e.log`; fleet forensics: `/tmp/bp_e2e_logs_last/`.

**Bonus negative test (unplanned but instructive):** the first launch failed
— `server/node_modules` was missing (`Cannot find module 'pg'`), because a
fresh worktree needs `pnpm install` in **three** dirs (root, client/,
server/). The harness surfaced only `health timeout on :2344` after 20 s; the
real cause was findable in under a minute, but only via the archived
`w0-api.log`. See F5.

---

## 3. What is genuinely strong (keep, and defend)

- **Hermetic by construction, not by convention.** The proxy 404s anything
  that is not `/app`, `/preview` or `/api`; headerless `/api` goes to fleet
  w0, never :8802; `reuseExistingServer:false` refuses foreign proxies;
  worker HOMEs are built from the worktree + committed fixtures only
  (e2e_fleet.cjs); teardown kills only manifest-recorded PIDs. The audit's
  before/after fingerprint independently re-proved the REQ-0217 invariant.
- **Defense in depth at one chokepoint.** Even if a run ever reaches a live
  api, `x-bpk-e2e-profile` redirects the dev-fallback caller to `e2e_<suffix>`
  at the single `resolveAuthFromRequest` seam, with the real token stripped
  and the header inert when `dev_mode=false` (server/admin.cjs:301-343,
  covered by e2e_profile_redirect_test 9/9 files+pg).
- **Port hygiene is machine-enforced, not remembered** — the decade rule
  (`tools/e2e_ports.sh` + `check_e2e_ports.cjs` as ci.sh step [0/8], exit-75
  preflight) killed the ECONNREFUSED failure class at the root.
- **Coverage breadth and density.** 224 e2e tests total; every major feature
  surface has a dedicated spec (canvas/board interactions x15 files,
  schedule/monitor 57, market 24, workshop 22, dex trio, warehouse,
  ragnarok, forecast, seal, guest-auth/landing/nav, settings, reduced-motion,
  i18n toggle; admin trio via three isolated pg harnesses in ci.sh [6.5/8]).
  ~1,600 `expect()` sites (grep approximation); zero `.only`; only 5
  condition-guarded `test.skip`s, each with a printed reason.
- **Specs assert real outcomes, not just DOM decoration** — trusted CDP
  input for drags; state read back through the API after auto-save
  (`autoSaveAndFetch`); server-enforced rules re-checked at the route level
  (e.g. workshop 409 on forced roll, deploy-gate 409 across rooms).
- **Failure forensics**: trace + screenshot retained on failure, per-worker
  api logs archived to `/tmp/bp_e2e_logs_last` even after teardown.
- **Anti-flake culture**: retries:0, no accounted-failure set (REQ-0159),
  flakes root-caused in REQ logs (3/3 serial rerun convention).

---

## 4. Findings

### F1 (High) — Registry-first serving is structurally untested by the default suite
**Confirms draft REQ-0221; raise its priority.**
The fleet runs `STORAGE_BACKEND=files` with `DATABASE_URL=''`
(e2e_fleet.cjs), while the registry is pg-only — so every registry-first
code path (now the AUTHORITY path for po/si/tm serving) is unreachable in
ci.sh's e2e stage. Consequences already realized: the REQ-0178 serving drift
shipped through a green CI; the REQ-0182b 409 guard exists as a test but was
the audit run's sole skip. Registry behaviour is covered only by the
contentadmin harness (pg) and post-deploy live runs — i.e. after merge.
**Recommend:** implement REQ-0221 (pg-backed fleet variant or a minimal
seeded pg harness on its own decade); un-skip the fleet-skipped tests.

### F2 (High) — The standard e2e entrypoints are dead-locked by the freeze; ci.sh has no scoped mode
`client/package.json` `e2e` → `tools/e2e_run.sh` → flock on
`~/.cache/backpack/e2e.box.lock`, which the REQ-0217 freeze daemon (pid
455867, confirmed alive) holds **indefinitely**. All three admin harnesses
route through the same wrapper/lock. Therefore ci.sh [6.5/8] and [7/7] on
ANY worktree — including ones already rebased past 0217 — wait
`E2E_LOCK_WAIT` (default **1800 s**) and then die with exit 75, aborting the
whole fail-fast ci.sh after a silent 30-minute stall. The documented
workaround (scoped run) exists only as a hand-typed incantation; ci.sh
cannot express it, and the `E2E_LOCK_FILE` override that would unfreeze a
rebased tree is documented nowhere. With ~95 worktrees pre-dating 0217, the
freeze will not be liftable soon.
**Recommend:** (a) teach ci.sh a scoped e2e mode (derive decade from the
worktree's REQ, reuse `e2e_ports.sh`), making scoped the default for linked
worktrees (this also implements draft REQ-0225's default-flip); (b) have
e2e_run.sh print WHO holds the lock and the freeze README path immediately,
not after 30 min; (c) document the sanctioned unfreeze path for rebased
trees (E2E_LOCK_FILE or freeze-lift criteria) in e2e_harness.md.

### F3 (Medium) — Wall-clock synchronization makes the suite load-sensitive; the suite itself creates that load
**Confirms drafts REQ-0222/0230/0231.**
~76 `waitForTimeout` sites across 20/33 spec files (mode: 400 ms/300 ms;
worst file tab-reorder-trash.spec.ts with 21), plus the helpers everything
funnels through: `waitForAutoSave` = fixed 1500 ms, `drag` = fixed 25 ms
steps + 150/250 ms settles, `longPress` = 750 ms, `bootApp` = +400 ms. These
pass on a quiet box, but: the audit run itself drove load to 13.9 on 8
cores; the box hosts concurrent agent CI sessions plus GPU art (documented
incidents: REQ-0191 goto-under-load release aborts, REQ-0216 burned cycles,
2026-07-17 mid-CI reboot). retries:0 (correct policy) means each such flake
costs a full cycle or a release abort.
**Recommend:** replace time-based sync with event-based where cheap —
`waitForAutoSave` should `page.waitForResponse` the PUT (or poll the
readback) instead of sleeping 1.5 s: it is called from ~every mutation spec,
so this one helper is both the biggest flake risk and the biggest speed win.
Ratify REQ-0230 (cpu-time perf gates) and REQ-0231 (whole-CI queue lock);
REQ-0222 for the harness goto family.

### F4 (Medium) — Box-global mutable seams survive inside "scoped" runs
Scoped runs are advertised as sharing "nothing box-global", but:
(a) the guest-auth ledger is a fixed path
`/tmp/backpack_e2e_guest_auth_tracked_files.json` — a second concurrent
scoped run resets/sweeps the first one's ledger;
(b) `/tmp/bp_e2e_logs_last` is clobbered by every fleet stop — run B's
teardown destroys run A's crash forensics, exactly the artifact one needs
when two runs interact.
Consequences are benign today (leaked files live under throwaway /tmp
HOMEs) but they falsify the "disjoint by construction" claim and can eat the
evidence of a real cross-session incident.
**Recommend:** derive both paths from `E2E_FLEET_ROOT` (ledger inside the
fleet root; logs to `<fleet-root>-logs-last` or keyed by decade).

### F5 (Low) — Fleet boot failures hide their cause; worktree provisioning underdocumented
A missing `server/node_modules` produced only `health timeout on :2344`; the
actual `Cannot find module 'pg'` lived in the archived log. PROJECT.md's
provisioning section names `client/` explicitly but not `server/`, and
e2e_harness.md not at all; a fresh worktree therefore fails its first e2e
run by default.
**Recommend:** on health timeout, e2e_fleet.cjs should tail the dead
worker's api.log to the console (5 lines suffice); add `server/` to the
provisioning docs; optionally preflight `require.resolve('pg', …)` in
`fleet start`.

### F6 (Low) — Residual coverage gaps (accepted risks; record them as such)
- **Rendering itself is asserted structurally, not visually**: PixiJS canvas
  output has no screenshot-golden gate; a renderer regression that keeps DOM
  state intact would pass. (Deliberate trade-off; consider one coarse
  golden per board type under the GPU path.)
- **Chromium-only, single desktop viewport (2000x1400)**: no touch/mobile
  project despite touch-flavoured features (tap tooltip, long-press).
- **Real Supabase OAuth/link flows** are unit-covered (check_auth.mjs) but
  have no e2e; only guest flow is e2e'd. (Hard without live IdP; record.)
- `E2E_PARALLEL≤6` per decade (indexes 4-9) is documented but unenforced —
  worker 7+ would silently claim the next REQ's decade; a one-line assert in
  global-setup closes it.

---

## 5. Recommended action order

1. **F2** — unblock the standard entrypoints (cheap, pure ops/docs; every
   session pays the 30-min stall today). Fold in REQ-0225's default-flip.
2. **F1 / REQ-0221** — pg-backed registry coverage in CI (the only finding
   that has already shipped a real defect).
3. **F3** — event-based `waitForAutoSave` first (one helper, suite-wide
   payoff), then ratify REQ-0230/0231/0222.
4. **F4, F5, F6** — hygiene batch; small diffs, mostly in tools/.

## 6. Evidence appendix

- Audit run: worktree `~/backpack_ragnarok_worktrees/req-0234-e2e-effectiveness-audit`
  @ master a7b0724; log `/tmp/req0234_e2e.log`; fleet logs `/tmp/bp_e2e_logs_last/`;
  before/after fingerprints `/tmp/req0234_live_before.txt` (+ post-run re-read, identical).
- Files read: client/playwright.config.ts, e2e/{global-setup,global-teardown,
  e2e-env}.ts, e2e/local-proxy.cjs, e2e/helpers.ts, all 36 *.spec.ts (grep
  metrics) , tools/{e2e_run.sh,e2e_fleet.cjs,e2e_ports.sh,check_e2e_ports.cjs,
  ci.sh,artadmin_e2e.sh,content_admin_e2e.sh,art_inspect_e2e.sh},
  server/admin.cjs (auth chokepoint), docs/llm_managed/e2e_harness.md,
  REQ-0214/0217 (done) and REQ-0221/0222/0225/0230/0231 (draft),
  ~/.cache/backpack/E2E_FREEZE_README.txt (+ daemon liveness check).
- Grep metrics are approximations (regex `^\s*test(\.\w+)?\(` also matches
  `test.describe`); authoritative counts are Playwright's own: 188 default,
  7+1+28 admin.

## Log
- 2026-07-17 reserved as REQ-0234 (ccbde0d) on branch
  req-0234-e2e-effectiveness-audit.
- 2026-07-17 audit executed (static + measured scoped run, 187/1/0);
  report written; reserved -> draft pending owner ratification of findings.

## Implementation (2026-07-17, this branch -- ratified by user directive: implement report §5, then merge/deploy)
- F2/F7: e2e_run.sh names the lock holder (and the freeze) immediately; the
  three admin harnesses drive the post-0217 proxy via
  E2E_FLEET_BASE_PORT=<api> (F7: their old E2E_STATIC_PORT/E2E_API_PORT
  wiring silently died with REQ-0217 -- /api fell through to fleet base
  8810; masked by the F2 freeze deadlock), drop the vestigial
  single-threaded python static server (REQ-0222 root cause), and take
  per-REQ locks (e2e.<req>.lock) instead of the frozen box lock. ci.sh
  [7/7] auto-scopes from a req-NNNN branch (REQ-0225 default-flip).
- F1: REQ-0221 harness + seeder + registry.config + ci.sh [6.6/8].
- F3: waitForAutoSave waits for the auto-save PUT response (fallthrough
  keeps legacy semantics); REQ-0230 (a)+(b) perf gate; REQ-0231 ci lock.
- F4: guest ledger + fleet log archive scoped by fleet root.
- F5: fleet pg-preflight + api.log tail on health timeout; 3-dir
  provisioning documented (e2e_harness.md).
- F6: E2E_PARALLEL<=6 decade guard in global-setup.
- F8 (new, found during gates): the additive-promote gates
  (req0207/req0219) hardcoded absolute before/after counts and went stale
  the moment the next batch promoted -- req0207 was RED on untouched master,
  killing every full ci.sh at [2.75/7]. Baselines are floors now; the
  delta/byte-splice/appended-ids/collision assertions keep every real
  invariant.
- Out of scope, unchanged: REQ-0222's release.sh codification (stays todo);
  lifting the freeze (still correct while pre-0217 worktrees exist).

## Gate results (2026-07-17)
- REQ-0221 harness 4/4 no-skip + deliberate-regression catch demo.
- REQ-0230 5/5 under 8-way burn; REQ-0231 serialize + NONBLOCK=75 demos.
- REQ-0225 fail-fast banner demo (tunnel baseURL from worktree -> abort).
- Kill-path audit clean (recorded-PID kills only; fuser -k scoped to own
  fleet range).
- Full ci.sh: see below (first attempt aborted at [6.5/8] by ANOTHER
  session's pre-fix artadmin harness parked on the frozen box lock holding
  the 156x decade -- the port preflight refused in one line, exactly as
  designed; reran after its 1800s timeout released the ports).

## Deploy record (2026-07-17)
- Merged to master bc6c012 (--no-ff, user go-ahead in chat). No runtime paths touched (tools/, sim/tests, client/e2e, docs only): no service restart, no dist rebuild needed.
- Live verification: full ci.sh GREEN on the identical tree pre-merge (FULLCI2 09:52:59-10:00:40, incl. admin trio 7/1/28, registry stage 4/4 no-skip, scoped e2e 187/1/0); backpack-web/api healthy post-merge (200/200). Main-checkout quick gates green EXCEPT the PRE-EXISTING [3.8] art-export red: the in-flight art session's untracked content/art mirror lacks the items005 renders (gate self-skips in any tree without that mirror; this merge touches no content paths) -- flagged to the user, not caused here.
