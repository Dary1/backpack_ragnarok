# REQ-0254 - the e2e suite is not hermetic: every page load waits on fonts.googleapis.com

**Reserved:** 2026-07-18
**Slug:** e2e-hermetic-font-fetch

## Status

draft - AGENT-FILED (2026-07-18, e2e consolidation audit). Blocked on an owner
decision: the fix touches the shipped app shell, not the harness, so it changes
what users are served -- that is a product call, not a test call.

## Provenance

Found by the REQ-0251 session while root-causing an `art_inspect` flake, and
explicitly handed off: *"Not fixed here -- it is a different REQ, in a file this
one does not touch, and folding an app-shell change into a harness refactor
would muddy both."* That judgement is correct and this file is the handoff.
Independently re-verified during the 2026-07-18 consolidation audit.

## Problem

REQ-0217's contract, as `docs/llm_managed/e2e_harness.md` states it: *"An e2e run
is HERMETIC ... Everything comes from THIS worktree's code/content plus committed
fixtures."* It is not.

`web/app/index.html` line 13 carries a **render-blocking external stylesheet**
(`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel...">`),
plus a `preconnect` to the same origin at line 10.

A `link rel=stylesheet` blocks the document's `load` event until it resolves.
Playwright's default `page.goto` / `page.reload` wait is `load`. So **every
navigation in the suite blocks on a public-internet fetch to
fonts.googleapis.com** before any assertion runs.

**The local proxy cannot stop this and never could.** `client/e2e/local-proxy.cjs`
404s everything that is not `/app/*` or `/preview/*` (its own comment: *"others ->
404 (REQ-0217 hermetic: nothing falls through to live services)"*). That guard only
covers requests routed AT the proxy. The font URL is **absolute**, so the browser
resolves it directly and the proxy is not in the path at all. The hermeticity
guard and the hermeticity hole do not intersect.

## Why it presents as a flake, not a failure

From llmlocal the fetch is ~80-120 ms and succeeds almost always, so the suite is
green almost always. It surfaces as `TimeoutError: waiting for navigation until
"load"`, and gets blamed on box load. REQ-0251 isolated it by restoring
pre-refactor code in the same worktree and reproducing the failure identically --
proving the refactor innocent and pointing here instead.

`artinspect.spec.ts` is where it shows first because it is the only spec that
waits for `load` **twice** (`page.goto` AND `page.reload`; `page.reload` appears
nowhere else in the suite), so it carries double the exposure.

Interaction with REQ-0222 (`e2e-harness-load-resilience`, `todo/`): this is a
*contributing mechanism* to that REQ's flake class, not a duplicate of it.
REQ-0222 owns resilience under load; this owns the external dependency itself.

## Impact

1. **The contract is false.** A run that reaches the public internet on every
   navigation is not hermetic. The doc says it is. One of them must change.
2. **A real, if rare, red.** Reproduced twice in one session.
3. **Speed.** Every navigation across 33 specs x N workers pays the round trip
   (or a DNS/TLS stall) even when cached.
4. **Offline / network-partitioned runs do not work**, and fail with a message
   that names navigation, not fonts.

## Options (owner decision)

- **(a) Self-host the fonts.** Vendor the woff2 files and serve `@font-face`
  locally. Hermetic, faster, no behaviour change for users. Cost: font files
  enter the repo; licence check needed (these are OFL, but verify before
  shipping).
- **(b) Stub at the test layer.** Intercept `fonts.googleapis.com` (Playwright
  `page.route`) and serve an empty stylesheet. Cheapest, test-only, zero product
  change -- but fonts are then absent in test, so any spec asserting rendered
  text metrics could shift. None currently do.
- **(c) Make the link non-blocking** (`media=print` + onload swap, or
  preload+swap). Fixes `load`-blocking for users AND tests; the fetch still
  happens, so it is not hermetic -- it just stops gating.
- **(d) Accept and correct the doc.** Strike the hermeticity claim.

Recommendation: **(a)**, with (b) as an immediate stopgap if the licence check
takes time. (a) is the only option that makes the doc's existing claim true and
also makes the product faster. (c) fixes the flake but leaves the contract false.

## Scope / frozen contract

- The real edit is in the CLIENT SOURCE, not the built artifact `web/app/`.
  See the blocker below.
- No harness, no spec, no port, no gate changes.
- Do not fold in REQ-0222's resilience work.

## Blocking dependency -- the committed bundle is stale

REQ-0251 also observed, and this REQ inherits: *"The committed `web/app` bundle is
STALE with respect to `client/src`: a plain `pnpm run build` in a clean worktree
produces different asset hashes (`index-BteqOqyq.js` -> `index-BzidCTP-.js`) and
rewrites `index.html`. Since `web/` is tracked and is what the harnesses serve,
the gates test a bundle that is not the one the current source builds."*

This must be resolved (or at least understood) before editing the shell, or this
REQ's change is silently overwritten by the next build. It may deserve its own
REQ; recorded here because it is this REQ's blocker.

## Acceptance criteria

- With the box's DNS blackholing `fonts.googleapis.com` (or egress blocked), the
  default suite still goes green. That is the honest test of hermeticity, and it
  must be RUN, not reasoned about.
- `artinspect.spec.ts` passes 5/5 consecutive runs on a loaded box.
- No third-party origin remains render-blocking in the SERVED shell (grep the
  BUILT `web/app/index.html`, not just the source).
- Under (a)-(c): `docs/llm_managed/e2e_harness.md`'s hermeticity paragraph is
  true as written. Under (d): it is rewritten to be true.
