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

## Gates
(filled at built)
