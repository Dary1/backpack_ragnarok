# REQ-0281 - e2e-hermetic-external-fonts: stop external Google Fonts from stalling page load

**Status:** todo -- cleared to implement (user commission 2026-07-22, "gotoの問題着手").
**Reserved:** 2026-07-22
**Slug:** e2e-hermetic-external-fonts

## Problem (the "goto-under-load" family, red-flagged 3 deploys)

`artadmin.spec.ts` `:124` / `:273` (occasionally `:344`) fail
`page.goto: Timeout 20000ms exceeded ... waiting until "load"` while the page
snapshot shows the SPA FULLY rendered (nav, banner, live/saved). This aborted
the `[6.5/8]` admin harness on REQ-0266, REQ-0273 and REQ-0278/0279 (each
tolerated with evidence, "REQ-0222 goto-under-load family").

## Root cause (captured 2026-07-22, evidence below)

The SPA `client/index.html` `<head>` loads Google Fonts from an EXTERNAL host:

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel..&display=swap" />

A `<link rel="stylesheet">` (and the woff2 files it pulls from
`fonts.gstatic.com`) is a subresource the page `load` event WAITS ON. With
`display=swap` the text paints immediately with a system fallback, so the page
LOOKS done -- but `load` does not fire until the font fetch completes. On the
hermetic box that fetch is outside the harness control (external host, IPv6-only
resolution, no in-harness stub); when it is slow or unreachable `load` stalls
until Playwright navigationTimeout (20 s) elapses and `goto` fails.

It is NOT harness-serving load (REQ-0222/0234 removed the single-threaded python
docroot) and NOT a same-origin slow resource: in the failing trace every
`127.0.0.1` resource finished in <50 ms and the ONLY external subresource is the
font. `/api/me` is a `fetch()`/XHR and does not block `load`. The env-carrying
supabase bundle is likewise exonerated: supabase is reached via `fetch()` (no
preconnect/link/stylesheet to `auth.qtie.jp`), which cannot block `load`.

### Why artadmin, not artinspect / contentadmin
Every `/app` goto `load` depends on the same external font. The difference is
exposure, not kind:
- artadmin: 8 gotos @ navigationTimeout 20 s -- most rolls of the dice.
- artinspect: 1 goto @ 20 s.
- contentadmin: navigationTimeout 25 s -- a 5 s cushion the others lack.

### Evidence
- Reproduced under `HOME=/tmp/hmaster`, `tools/artadmin_e2e.sh`: `:124` + `:273`
  red (goto 26.5 s), 6 passed -- the exact deploy signature.
- Retained trace (`trace: retain-on-failure`): `fonts.googleapis.com/css2`
  present; all same-origin resources <50 ms; no gstatic woff2 completion logged.
- Instrumented Playwright probe on the harness proxy:
  - fonts HELD open (simulates the hermetic-broken/slow condition):
    `page.goto ... waitUntil:load` times out at 20007 ms with the pending
    request = `https://fonts.googleapis.com/css2?...` -- the exact deploy error.
  - fonts route-ABORTED: `load` fires in ~110 ms, deterministically, x8.

## Fix (hermetic-honest, harness-only)

`client/e2e/local-proxy.cjs` is the SINGLE chokepoint that serves `/app` for
EVERY e2e path (the REQ-0217 fleet global-setup and all admin harnesses route
`/app` through it). When it serves `index.html` it now strips the external
Google Fonts `<link>`s (`fonts.googleapis.com` / `fonts.gstatic.com`, preconnect
+ stylesheet). The browser therefore never issues an external font request;
`load` fires on same-origin resources only, deterministically.

- HERMETIC by construction: removes the one external dependency from the e2e page
  load instead of loosening an assertion or lengthening a timeout. Nothing
  external is fetched during a run.
- Whole FAMILY, zero spec changes: fixing the shared proxy covers artadmin,
  artinspect, contentadmin, registry and the parallel fleet at once; no
  `*.spec.ts` and no product source is touched.
- Production is UNAFFECTED: real users are served through the Cloudflare ingress,
  not this proxy, and still receive the web fonts. The font stacks already
  degrade to system serif/sans if the fetch fails (see index.html comment), so
  stripping them in e2e changes nothing the specs assert on.

`goto` wait semantics (`waitUntil`) are deliberately left ALONE: the primary
cause (the external fetch) is removed, so no second-line mitigation is needed.

## Out of scope
- REQ-0222 remaining scope (release.sh rerun-then-abort + provenance-carrying
  known-flaky list) -- untouched; that machinery was not commissioned here.
- Self-hosting the fonts in the PRODUCT bundle (would also fix it everywhere but
  means committing multi-MB CJK woff2 sets; not warranted for an e2e-only stall).

## Gates (2026-07-22)

Conditions: worktree `req-0281-e2e-hermetic-external-fonts` cut from master
`a5f83bd`; HOME bridge `/tmp/h0281` (mirrors `/tmp/hmaster`, backpack_ragnarok ->
this worktree, shared `.cache/ms-playwright`); node v24.18.0; DATABASE_URL from
`server/.env`. The box was under concurrent multi-session load throughout (other
sessions' `ci.sh` / art work; 1-min loadavg 0.9-5 during the artadmin runs).

### Reproduction of the failure (pre-fix, on master via /tmp/hmaster)
- `tools/artadmin_e2e.sh`: `:124` (goto 26.5 s) + `:273` RED, 6 passed -- the exact
  deploy signature.
- Retained trace + instrumented probe: fonts held open -> `page.goto ...
  waitUntil:load` TIMEOUT 20007 ms, pending = `fonts.googleapis.com/css2` (the exact
  deploy error); fonts route-aborted -> load fires ~110 ms x8.

### THE PROOF THAT MATTERS -- artadmin 8/8, 3 consecutive runs (post-fix)
`tools/artadmin_e2e.sh` from this worktree, same conditions that red it today:
- Run 1: 8 passed (1.9m)  -- :124 19.4s, :273 8.7s, :344 22.2s
- Run 2: 8 passed (1.8m)  -- :124 19.2s, :273 9.4s, :344 20.9s
- Run 3: 8 passed (1.8m)  -- :124 18.4s, :273 9.2s, :344 23.5s
Post-fix, no `/app` goto ever waits on an external host.

### No regression (family)
- `tools/art_inspect_e2e.sh`:  1 passed.
- `tools/content_admin_e2e.sh`: 28 passed.
- `tools/ci.sh` (SKIP_PG, HOME=/tmp/h0281): all stages green through client
  typecheck+build [6/7] and the Supabase-env tripwire [6.1/7]; the scoped fleet
  e2e [7/7] -- which serves every `/app` through the patched local-proxy --
  ran 194 passed, 1 skipped, 2 failed, the two failures being the KNOWN-TOLERABLE
  documented flakes `forecast.spec.ts:206` and `schedule.spec.ts:1451` (signature
  match). `[6.5/8]` admin harnesses are skipped by ci.sh and were run directly
  (above). The fix is proven non-regressive across the whole e2e family.

### Not run to green (out of blast radius)
- `tools/ci.sh` pg-backend api render stages `[5.1]/[5.15]/[5.16]/[5.17]`
  (artwork/artqueue/artfamily/inspection) FLAKE on "render seed N did not finish in
  time" under the sustained concurrent multi-session box load (1/5-min loadavg
  7-12 for most of the window). These are SERVER-SIDE api render-timeout tests; the
  sole code change in this REQ is `client/e2e/local-proxy.cjs` (e2e `/app` static
  serving), which cannot affect them. They pass on a quiet box (master is green);
  the flake is the render-under-load class REQ-0222 catalogs, not introduced here.

**Files changed:** `client/e2e/local-proxy.cjs` (+19/-2) -- plus this REQ doc.
**Commits (branch req-0281-e2e-hermetic-external-fonts, off a5f83bd):**
- `030f737` reserve REQ-0281
- `d77d86b` local-proxy strips external Google Fonts <link> from served index.html
- `d04d99a` spec
- `544b503` reserved -> todo
- (this) todo -> built

**REQ-0222 remaining scope UNTOUCHED:** release.sh rerun-then-abort + the
provenance-carrying known-flaky list were not commissioned today and are not
altered here.

### Incident + correction (2026-07-22)
Integration caught that docs commit `c44026d` had accidentally swept in a rebuilt
`web/app` bundle: this worktree was created WITHOUT `client/.env.local` (the
REQ-0278 provisioning gap), so the CI build regenerated an env-LESS bundle
(`index-6THOT9M7.js`, no `VITE_SUPABASE_URL`/`ANON_KEY` baked) and the REQ-0278
tripwire prints N/A on absent env, so nothing failed. Correction (append-only, no
history rewrite): worktree provisioned via `tools/provision_worktree_env.sh`, then
commit `6fcf8b6` restored `web/app` to masters env-carrying dist (`a5f83bd`,
`index-Bk5vjz_m.js`, Supabase host baked) and dropped the env-less orphan assets.
Post-correction `git diff a5f83bd..HEAD` = `client/e2e/local-proxy.cjs` + this doc
ONLY; `web/app` is byte-identical to master. (The tripwire N/A-on-absent-env hole
itself is flagged for a separate user decision, not fixed here.)
