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
