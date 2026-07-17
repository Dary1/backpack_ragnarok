# REQ-0222 — e2e-harness-load-resilience: stop box load from aborting releases

**Status:** draft — AGENT-PROPOSED, awaiting owner review. Not cleared to implement.
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


## Measured evidence from the REQ-0231 session (2026-07-18)

Recorded here because it was measured while gating another REQ and would
otherwise be lost; no work on REQ-0222 was done.

`client/e2e/artinspect.spec.ts:56` (`await page.reload()`) fails with
`TimeoutError: page.reload: Timeout 20000ms exceeded` at a **~2-in-3 rate on a
loaded box** (load 6-17, concurrent sessions + ComfyUI on the GPU). It took
full `ci.sh` RED at [6.5/8] on 2026-07-18 19:18.

Interleaved A/B, alternating ONLY the harness file between master's version
and a modified one, three pairs each: control FAIL/FAIL/pass, modified
FAIL/FAIL/pass -- same failure string, same rate, pair for pair. So it is the
spec/proxy under load, not any harness change.

Relevant: REQ-0234 F7 dropped the python static server as "the goto-under-load
flake source (REQ-0222)" and moved /app onto the REQ-0217 local-proxy. This
reload timeout persists AFTER that change, so either F7 did not close the
class or the local-proxy has its own limit under load. Worth checking before
assuming F7 settled it.
