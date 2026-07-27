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

---

## Addendum (2026-07-27, REQ-0309 orchestrator) — a second load-related failure mode: the default 4-worker e2e run

Measured while gating REQ-0309, and **reproduced on that REQ's BASE commit**, so it
is pre-existing and unrelated to that change:

- Two consecutive full `tools/ci.sh` runs each failed **a different** spec at the
  default `E2E_PARALLEL=4`: once `auto-save`, once workshop gacha asserting
  `expected 1, received 2` — i.e. a second roll arriving against the profile the
  spec believed it owned.
- Isolated re-runs: HEAD `pass / FAIL / pass`; base `c1456a5` `FAIL / FAIL / pass /
  pass`. Green was reached only with `E2E_PARALLEL=1`, a documented seam.

This is a different mechanism from the goto-timeout family above (that one is the
harness's static server starving under box load; this one looks like cross-worker
state contention), but it lands in the same place: **`tools/ci.sh` as configured by
default cannot reliably reach literal green on this box.** That sits badly with
REQ-0159's "CI GREEN means literally green" — a gate that must be re-run until it
agrees is not a gate.

Worth folding into this REQ's scope, or splitting out if the root cause turns out
to be worker isolation (REQ-0214/0217 hermetic profiles) rather than load.
