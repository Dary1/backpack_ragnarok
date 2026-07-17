# REQ-0225 — e2e: a worktree run must not silently target the deployed master

## State log
- 2026-07-17 reserved (stub).
- 2026-07-17 reserved -> draft: retrospective proposal from REQ-0208; needs
  user ratification (warn-only vs default-flip -- see Decision).

## Origin (REQ-0208 retrospective)
During REQ-0208 a bare `pnpm run e2e dex.spec.ts ...` in the worktree ran
against the DEFAULT baseURL -- the public tunnel, i.e. the DEPLOYED master
bundle + api. The 3 new branch tests "failed" against code that simply
predates the branch, with nothing in the output hinting the target was not
this worktree. The run only became meaningful after rediscovering the ci.sh
[7/7] invocation (PLAYWRIGHT_BASE_URL=127.0.0.1:8803 + E2E_GPU=1 +
E2E_PARALLEL=4), which serves THIS worktree's web/app build and boots THIS
worktree's api fleet. One full box-locked run was wasted; a colder-context
agent could burn far more time chasing the phantom failures.

## Problem
The default e2e target (public tunnel -> live 8801/8802) is only correct for
POST-DEPLOY verification from the main checkout. From a feature worktree it
is almost always wrong, and the mistake is silent: global-setup happily backs
up live state and the specs run green/red against the wrong code.

## Proposal
In e2e global-setup, detect the mismatch and make it loud:
1. Compute "am I testing this worktree?": baseURL is the tunnel/live ports
   AND this worktree's web/app bundle hash differs from the served
   /app/assets/index-*.js name (cheap: compare the hashed filename).
2. On mismatch, print a prominent banner naming the canonical worktree
   invocation (the ci.sh [7/7] env) -- and, under E2E_REQUIRE_WORKTREE=1
   (or when the git dir is a linked worktree, if the default-flip option is
   ratified), FAIL FAST instead of running 20+ minutes against master.

## Decision needed (why draft)
- (a) warn-only banner (zero behavior change), or
- (b) default-flip: linked worktrees default to the local proxy + fleet, and
  the tunnel target requires an explicit PLAYWRIGHT_BASE_URL (post-deploy
  verification habit changes -- main checkout keeps the tunnel default).

## Gates (when implemented)
- shellcheck/lint as applicable; one e2e run per mode proving the banner /
  fail-fast fires from a worktree and does NOT fire from the main checkout.

## Decision + implementation (2026-07-17, ratified via REQ-0234 report §5)
- BOTH options landed: (a) the banner -- e2e global-setup warns loudly when
  baseURL is non-local and cwd is a linked worktree, and aborts under
  E2E_REQUIRE_WORKTREE=1; and the default-flip, delivered through ci.sh:
  [7/7] auto-scopes (fleet root + REQ-decade ports from the branch name) for
  any req-NNNN worktree, so the canonical invocation now tests THIS worktree
  by construction. Bare `pnpm run e2e` keeps legacy behavior + the banner.

## Gate results (2026-07-17)
- From the REQ-0234 worktree: PLAYWRIGHT_BASE_URL=https://backpack-dev.qtie.jp
  E2E_REQUIRE_WORKTREE=1 -> global-setup throws the REQ-0225 banner BEFORE
  any fleet/page work (verified live).
- Scoped worktree runs (ci.sh [7/7] and the REQ-0234 audit run) show no
  banner -- local baseURL from a worktree is the sanctioned path.
