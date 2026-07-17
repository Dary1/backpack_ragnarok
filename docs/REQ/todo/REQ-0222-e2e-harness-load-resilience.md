# REQ-0222 — e2e-harness-load-resilience: stop box load from aborting releases

**Status:** see folder — a REQ's status IS its folder (PROJECT.md). This line is retained only as the original 2026-07-16 filing note.
**Reserved:** 2026-07-16
**Slug:** e2e-harness-load-resilience
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」.

## Why (measured on 2026-07-16, REQ-0191 deploy; same family aborted REQ-0182b's release.sh)

The artadmin harness serves its static docroot with a single-threaded `python3 -m http.server`,
and its specs use Playwright's default `page.goto` (20 s, `load` event). Under the owner's
concurrent GPU/art workload the goto time scales with load until it crosses the timeout:

- 13.0 s quiet (PASS) → 22.1 s at load ~7 (just over) → 27-29 s at load ~10 (reliable FAIL).
- Every failing snapshot shows the page fully rendered — the harness, not the feature, fails.
- Twice in one day this aborted `release.sh` mid-deploy (REQ-0182b, REQ-0191), forcing the
  manual recovery convention (finish e2e via the locked runner on the byte-identical tree,
  commit the dist by hand, document). The convention works but is hand-run tribal knowledge.

The box is SUPPOSED to run art and CI concurrently (GPU etiquette assumes it); a harness that
only passes on a quiet box tests the wrong thing.

## What to do

1. **Harness:** serve static docroots with a threaded/robust server (`ThreadingHTTPServer` or
   the node-based server other harnesses use — survey which harnesses share the pattern), and/or
   switch harness gotos to `waitUntil: 'domcontentloaded'` with an explicit readiness probe,
   and/or raise nav timeout under a `E2E_LOADED_BOX` seam. Fix the FAMILY (audit all harnesses),
   not just artadmin.
2. **release.sh:** codify the existing manual recovery — on a failure in a known-flaky family,
   rerun that spec once via the locked runner before aborting; keep abort behaviour for real
   regressions. The known-flaky list must live in one greppable place with provenance per entry
   (WebGL-under-SwiftShader, cold-start first-test, goto-under-load).

## Out of scope
- "Fixing" flaky tests by weakening their assertions; touching the box-lock semantics
  (REQ-0117/0172); scheduling policy for the GPU (etiquette stays as is).

## Gates
- The artadmin goto spec passes on a deliberately loaded box (reproduce with a CPU-burn, not
  the owner's art job); release.sh demonstrates the rerun-then-abort path on an injected flake
  and the abort path on an injected regression; full default suite green on quiet AND loaded box.

## Partial implementation (2026-07-17, via REQ-0234 -- family fix landed)
- ROOT CAUSE REMOVED for the harness family: the single-threaded
  `python3 -m http.server` docroots are GONE from all three admin harnesses.
  Since REQ-0217 the local-proxy serves /app + /preview from the worktree
  itself (node fs.readFile, no thread bottleneck); the harnesses now drive
  it via E2E_FLEET_BASE_PORT=<their api> (see REQ-0234 F7 -- the old
  E2E_STATIC_PORT/E2E_API_PORT knobs had silently died with REQ-0217,
  leaving /api routed at the default 8810).
- REMAINING SCOPE (this REQ stays todo): release.sh rerun-then-abort
  codification with the provenance-carrying known-flaky list, and the
  loaded-box artadmin goto demo for the gate.

---

## Implementation record (2026-07-17; ratified todo by user chat directive "do REQ-0222")

### Survey + premise correction
- The `python3 -m http.server` pattern was shared by exactly the admin trio
  (artadmin/art_inspect/content_admin harnesses). CORRECTION: the box runs python
  3.14, whose http.server CLI is ThreadingHTTPServer since 3.7 — it was never
  single-threaded. The measured goto scaling (13.0 s quiet -> 27-29 s @ load ~10,
  REQ-0191) is Chromium being CPU-starved on the 1.4 MB bundle's `load` event, not
  server accept starvation. The fix therefore leans on goto policy + timeout
  scaling. (REQ-0234/F7 subsequently removed the python server entirely: nothing
  routed to it post-0217.)

### What was built (commits 8608c97 + merge 22ed4c8 on this branch)
1. `client/e2e/helpers.ts gotoReady()` — `domcontentloaded` + explicit readiness
   probe (`#root > *` attached); all 33 admin-spec gotos switched (artadmin 7,
   artinspect 1, contentadmin 25).
2. `client/e2e/load-seam.ts` — E2E_LOADED_BOX seam scaling every timeout in all 4
   playwright configs: explicit 1->3x / N->Nx / 0->off; UNSET -> auto-3x when 1-min
   loadavg >= 0.75*cores (both prior release aborts happened exactly where a human
   forgets a flag). Widening timeouts weakens no assertion.
3. `tools/e2e_known_flaky.tsv` — THE one greppable known-flaky registry; 3 families
   (goto-under-load, cold-start-first-test, webgl-swiftshader), each with dated
   provenance; provenance-less entries declared invalid.
4. `tools/e2e_flaky_gate.sh` — the REQ-0182b/0191 manual recovery convention,
   executable: wraps every ci.sh e2e step. ALL failures matching known families ->
   ONE rerun via the (per-REQ) locked runner, default suite narrowed to
   `--last-failed`; ANY unknown failure or unparsable death -> abort, NO rerun.
   Injection seams E2E_INJECT_FLAKE / E2E_INJECT_REGRESSION for gate demos.
5. `tools/tests/flaky_gate_test.sh` — 9-path self-test wired as ci.sh [0.5/8].
6. `tools/ci.sh` — flaky-gate around [6.5] admin trio, [6.6] registry stage, and
   both [7/7] paths (scoped + legacy); `tools/release.sh` — codification note.
7. Merge of master (REQ-0221/0225/0230/0231/0234): harness trio taken from master
   wholesale (their per-REQ locks + post-0217 proxy wiring supersede the static
   server half of this REQ; the interim `static-server.cjs` was removed as
   obsolete); flaky-gate rewired into the new ci.sh structure.

### Gate results (2026-07-17, box shared with concurrent agent CI + in-flight art session)
- flaky-gate self-test: 9/9 (twice: pre- and post-merge). check_e2e_ports: green (4 harnesses).
- LIVE classification evidence (the gate run for real, 3 times):
  - port-decade collision (exit 75, another session's harness) -> "no parsable
    block -> ABORT, no rerun" — port-rule semantics preserved.
  - scoped suite loaded (load 10-27): 185 passed / 2 assertion-signature fails
    (long-press-rename, reference-model canvasYellow) -> correctly NOT matched to
    any family, ABORT no-rerun; both reran GREEN solo => F3 wall-clock family
    (fixed sleeps), deliberately outside this REQ's registry. 1 skip = REQ-0221's
    known F1 (files fleet).
  - artadmin harness loaded (load 24-30): auto load-seam engaged
    ("[load-seam] auto: loadavg1=30.6 -> 3x"); goto-family spec (the big flow,
    20.8 s goto) PASSED under load — the original REQ-0191 failure mode is fixed.
    6/7; the 1 red is REQ-0235 (below), not a goto/timeout failure.
- BLOCKER for the remaining gates (release.sh injected-flake/regression demos +
  full ci quiet/loaded): the artadmin REQ-0216 true-scale spec is deterministically
  RED on PRISTINE MASTER since ~10:30 UTC (passed 09:52 in REQ-0234's FULLCI2).
  A/B on this branch (original goto restored) and solo-quiet master runs exonerate
  REQ-0222. Evidence + hypotheses filed as docs/REQ/reserved/REQ-0235 (d8e8285):
  suspected art-session content-mirror -> fit-check reference coupling (snapshot
  shows "fit 95"). ci.sh [6.5] cannot be literally GREEN (REQ-0159 rule) for ANY
  branch until REQ-0235 is triaged, so this REQ stays in todo with implementation
  complete; rerun the release.sh demos + full ci quiet/loaded once master is green.

---

## Gate record — 2026-07-18 session (ratified todo by user chat directive "do REQ-0222")

Tree: req-0222 @ 8d68dbd = master (REQ-0193/0212/0213/0233 world) merged in, clean merge,
client rebuilt. The 2026-07-17 record above stands; this supersedes its BLOCKER.

### The 2026-07-17 blocker (REQ-0235) is GONE — not by this REQ
The artadmin REQ-0216 true-scale spec, deterministically red on pristine master on
2026-07-17 (5/5 runs), now **PASSES** on the merged tree — 7/7 quiet AND 7/7 under a
deliberate burn. REQ-0235's own hypothesis is thereby confirmed: it was env-coupled to the
in-flight art session's untracked `content/art` mirror, which has since landed
(REQ-0193 cutout sweep + REQ-0233). Filed for owner disposition in
`docs/REQ/reserved/REQ-0235-artadmin-truescale-master-red.md`.

### Gate 1 — artadmin goto spec on a deliberately loaded box: **PASS**
`tools/artadmin_e2e.sh` under an artificial 8-way CPU burn (spin loops, per REQ-0230's
recipe; NOT the owner's art job), loadavg1 12.4 -> 24:
- `[load-seam] auto: loadavg1=12.4 >= 0.75*8 cores -> 3x e2e timeouts` — auto-engaged, no
  human flag needed (both historic release aborts happened exactly where a human forgets one).
- **7/7 passed (2.6m)**. The goto-family spec — the big flow that took 27-29 s and blew the
  20 s default in the REQ-0191 abort — completed its goto in **30.3 s and PASSED**.
  This is the original failure mode, reproduced at its own load level, and fixed.

### Gate 2 — release.sh rerun-then-abort: **PASS (both paths, live, through the real pipeline)**
Both demos run `tools/release.sh` (-> `tools/ci.sh` -> `tools/e2e_flaky_gate.sh`) end to end:
- **Injected regression** (`E2E_INJECT_REGRESSION=artadmin`): the real artadmin harness ran
  7/7 green, the synthetic unknown failure was appended, and the gate printed
  `UNMATCHED failure (real regression) ... -> ABORT (no rerun)`. release.sh **EXIT=1**, dist
  NOT committed, `git status --porcelain web/app` clean. Real-regression behaviour preserved.
- **Injected flake** (`E2E_INJECT_FLAKE=artadmin`): classified
  `known-flaky [goto-under-load]` -> `ALL 1 failure(s) known-flaky -> rerunning ONCE via the
  box-locked runner` -> `rerun GREEN -- known-flaky recovery succeeded` -> **ci.sh CONTINUED**
  to [6.5] artinspect and on. The REQ-0182b/0191 hand-run recovery is now executable.
- Third path observed for free, twice, unsolicited: another session's harness held the
  REQ-0156 decade -> exit 75 -> `failure has NO parsable playwright block -> ABORT, no rerun`.
  Port-rule semantics preserved under the gate. (That contention is REQ-0242's subject,
  already filed as draft; caught live here — REQ-0223's worktree proxy holding :1562.)

### Gate 3 — full default suite green on quiet AND loaded: **DELEGATED to REQ-0253**
Not met, and not meetable inside this REQ's scope. Measured on this tree:
- quiet (loadavg1 4.25): **186/187** — `long-press-rename.spec.ts:77` red.
- loaded (loadavg1 9-12): **185/187**; loaded (loadavg1 -> 36, 8-way burn): **175/187**.
- Every red is an assertion signature from the F3 wall-clock family (fixed sleeps), green on
  solo rerun. It reds a QUIET box, so it is not a load-resilience defect at all, and the
  goto/timeout work in this REQ cannot address it. REQ-0234 fixed F3's headline item
  (`waitForAutoSave` -> event-based, f6ddcb4 — present in every run above); **83
  `waitForTimeout` sites across 18 spec files + `longPress`'s 750 ms remain**.
- Deliberately NOT absorbed into `e2e_known_flaky.tsv`: the signature is a plain assertion
  failure, indistinguishable from a real regression; a family for it would let the gate rerun
  and swallow genuine regressions, breaking the registry's own rule and this REQ's purpose.
- Split out per user directive (2026-07-18 chat) as **REQ-0253-e2e-fixed-sleep-residual**,
  which carries this gate and the evidence.

### One anomaly, investigated and dismissed (per user directive: mechanism first)
A single burn run collapsed 72/187 with 97x `ECONNREFUSED` on the proxy :2222. Excluded by
evidence, not by assumption: accept-backlog saturation (`tcp_abort_on_overflow=0` would
TIME OUT, not refuse; `TcpExtListenOverflows`/`ListenDrops` = 0 since boot); a proxy crash on
client abort (repro: the proxy survived 40 aborted-mid-body requests, PROXY ALIVE); OOM
(19 GB available, no kill at that time); a broad `pkill` by another session (no such code in
any worktree's tools — only the comment forbidding it); and steady-state load itself — a
**watched** rerun at HIGHER load (36 vs 30) never dropped the listener once across the whole
run (175/187). ECONNREFUSED = RST = no listener, so the process was gone that once.
Leading explanation: MY OWN procedure — run 2 was started 35 s after run 1 with the same
`E2E_FLEET_ROOT=/tmp/bp_e2e_workers_req0222`, so run 1's late teardown could reap PIDs from a
manifest run 2 had overwritten. Not a harness property; ci.sh serialises per-REQ runs, and the
cross-session form of it is REQ-0242. No new REQ filed.

### Verdict
This REQ's own scope — the goto-under-load family fix and the release-abort codification —
is implemented and demonstrated end to end under real load. Gate 3 belongs to REQ-0253.
todo -> built (not `done`: unmerged, undeployed).
