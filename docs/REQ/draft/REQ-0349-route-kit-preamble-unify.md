# REQ-0349 — Unify the route request preamble (`lib/route_kit.cjs`)

**Status:** Draft (blocked on decisions D1/D2 below)
**Reserved:** 2026-07-30
**Slug:** route-kit-preamble-unify
**Origin:** API code audit, 2026-07-30 (whole-`server/` review; no prior REQ)
**Depends on:** nothing. **Blocks:** nothing. Sibling: REQ-0348 (independent —
different files, no overlap; either may land first).

---

## 1. Problem

`server/lib/route_auth.cjs` (REQ-0145a) already extracts the caller-resolution
preamble, but only three route families use it. Every other family re-implements
the same three-step preamble inline: **resolve caller or 401 -> read/parse the
JSON body or 4xx -> map a domain error code to a status**. `routes/` is 3,372
lines across 17 files and a large share of it is this.

### 1.1 Caller resolution: 3 families share it, 10 copy it

Uses `resolveCallerOr401` (`lib/route_auth.cjs:31`): `routes/schedule.cjs:53`,
`routes/warehouse.cjs:23`, `routes/workshop.cjs:17`, `routes/starter.cjs:31,41`.

Re-implements it inline (`const resolved = admin.resolveAuthFromRequest(req)`
followed by the same `401 'unauthorized: ' + resolved.reason`):
`routes/admin.cjs:139,170`, `routes/bio.cjs:61,78`, `routes/dex.cjs:81`,
`routes/dismantle.cjs:51`, `routes/market.cjs:61`, `routes/me.cjs:15`,
`routes/notifications.cjs:20,30`, `routes/profile.cjs:17`,
`routes/ragnarok.cjs:73`, `routes/skins.cjs:50` — **13 sites, 10 files**.

This is not accidental drift: `routes/market.cjs:47-48` and
`routes/ragnarok.cjs:61-62` both say *"resolve the caller EXACTLY like
schedule/warehouse (`lib/route_auth.cjs`'s `resolveCallerOr401`)"* — and then
open-code it instead of calling it. The `callerIsDevFallback` computation
(`!token && resolved.viaDevFallback === true`, REQ-0214) is likewise duplicated
verbatim in `route_auth.cjs`, `market.cjs` and `ragnarok.cjs`.

**Why it matters beyond tidiness.** REQ-0199 had to fix the same JWT-precedence
bug (X-Auth-Token-only resolver mis-resolving a Bearer-JWT caller to the dev
fallback, so the route acted as the wrong player) separately in `market.cjs`,
`ragnarok.cjs`, `dismantle.cjs` and `dex.cjs`. Each copy is a place the next
auth fix has to be remembered.

### 1.2 Domain-error mapping: 4 copies, and they disagree

| site | NOT_FOUND | CONFLICT | BAD_REQUEST | FORBIDDEN |
|---|---|---|---|---|
| `lib/route_auth.cjs:79` `scheduleErrToStatus` | 404 | 409 | 400 | **403** |
| `routes/market.cjs:82` `errToStatus` | 404 | 409 | 400 | **missing -> 500** |
| `routes/ragnarok.cjs:95` `errToStatus` | 404 | 409 | 400 | **missing -> 500** |
| `routes/dismantle.cjs:27` `errToStatus` | 404 | 409 | 400 | **missing -> 500** |

The paired `sendScheduleError` / `sendMarketError` / `sendRagnarokError` /
`sendDismantleError` bodies are otherwise identical (`{ok:false,error}` plus the
REQ-0041 structured `reason` when present). **A service in market / ragnarok /
dismantle that throws `code:'FORBIDDEN'` currently surfaces as a 500.** Whether
any does today is an audit item for implementation (§6 D2).

### 1.3 Body handling: 20 sites, 4 wordings

`readBody -> TOO_LARGE -> JSON.parse` appears at 20 sites
(`admin.cjs:50,107`, `dismantle.cjs:76`, `market.cjs:126,152`,
`profile.cjs:58,93`, `schedule.cjs:120,166,226,246,330,378,469,502`,
`skins.cjs:82`, `starter.cjs:46`, `warehouse.cjs:45,104`, `workshop.cjs:36`)
in two shapes — the one-liner `err.code === 'TOO_LARGE' ? 413 : 400` and the
expanded block — producing four different 413/400 wordings:

- `'request body exceeds ' + MAX_BODY_BYTES + ' bytes'` (4x)
- `'request body exceeds ' + MAX_SKINS_BODY_BYTES + ' bytes'` (1x)
- `'request body too large'` (1x, `skins.cjs:82`)
- `'body read failed: ' + err.message` (3x)
- plus `err.message` passed through raw (12x, the one-liner shape)

and two JSON-parse wordings: `'invalid JSON body'` (18x) vs
`'malformed JSON body'` (1x, `dismantle.cjs`).

**This is a client-visible contract, not just cosmetics.**
`lib/route_auth.cjs:86-99` documents that the client's `ApiError.reason` /
`schedule/errors.ts` `friendlyScheduleError` reads the structured `reason` field
*"preferentially before falling back to message-substring matching"*. Any
message the client substring-matches is load-bearing.

### 1.4 Remaining hand-rolled surface

`'method not allowed'` 405 literal: **49** sites. `sendJSON(res, 400, ...)`:
**61** sites. Inline `typeof x !== 'string'` / `Number.isInteger` /
`Number.isFinite` validation: **17** sites. There is no shared validator module
(`lib/` holds `content`, `content_files`, `http_util`, `humanize`, `meta`,
`route_auth`, `supabase_auth` — none of them validate request shapes).

## 2. Goal

Promote `lib/route_auth.cjs` into `lib/route_kit.cjs`: one module holding the
whole request preamble, used by **every** route family. No route file open-codes
caller resolution, body reading, error-code mapping, or the 405 guard again.

## 3. Proposed surface

```
resolveCallerOr401(req, res)            // kept, unchanged, now used by all 17 families
methodGuard(req, res, allowed[])        // 405 + the one canonical wording
withJsonBody(req, res, opts, cb)        // readBody + cap + parse, one wording set
                                        //   opts: { maxBytes } (skins' own cap)
sendDomainError(res, e)                 // ONE code->status table incl. FORBIDDEN->403
                                        //   + REQ-0041 structured `reason` threading
loadOwnCanvas / requireOwnCanvas        // kept as-is from route_auth.cjs
```

`lib/route_auth.cjs` stays as a thin re-export shim so no call site breaks in the
same commit — the same facade technique `storage.cjs` (REQ-0145a sb) and
`schedule.cjs` (REQ-0047 c) already use. Families migrate one commit per family,
each commit gated by that family's own `tests/api/*.cjs` file.

## 4. Scope

**In:** all 17 `server/routes/*.cjs`, `server/lib/route_auth.cjs` ->
`lib/route_kit.cjs`, `server/tests/api/*`. **Out:** `admin.cjs`'s auth/domain
split (audit item P3, its own REQ), the `routes/art.cjs` + `routes/content.cjs`
service-layer extraction (30 and 27 direct `storage.*` calls; separate REQ),
route dispatch order in `router.cjs` (load-bearing, untouched), REQ-0348's
content-overlay work.

## 5. Byte-parity strategy

The default is **byte-identical responses**. `withJsonBody` and
`sendDomainError` take the wording as data where a family currently differs, so
the mechanical migration changes zero response bytes and the existing 1,950
assertions are the gate. Wording unification (D1) and the FORBIDDEN fix (D2) are
then separate, individually revertable commits on top.

## 6. Decisions required before implementation

- **D1 (blocking).** Unify the 413/400/JSON-parse wordings, or preserve each
  family's current strings?
  - (a) **Unify** — one wording each for 413 / body-read failure / bad JSON.
    Cleanest, but must be cross-checked against every client substring match
    (`client/src/**` `ApiError`, `schedule/errors.ts` `friendlyScheduleError`)
    and against `tests/api/*` assertions before it is safe.
  - (b) **Preserve** — pass wording per family, ship a provably zero-byte-change
    refactor now, unify later behind a client audit.
  - Recommendation: **(b) for the migration, then (a) as a follow-up commit on
    the same branch** once the client match sites are enumerated. `skins.cjs`'s
    `'request body too large'` and `dismantle.cjs`'s `'malformed JSON body'` are
    almost certainly safe to align immediately (both are one-offs); the rest need
    the client read.
- **D2.** Adopt `FORBIDDEN -> 403` for market / ragnarok / dismantle as part of
  this REQ, or split it out? It is a latent-bug fix, not a refactor. Needs a grep
  of `services/market/**`, `services/ragnarok/**`, `services/dismantle.cjs` for
  `code = 'FORBIDDEN'` first — if none throws it today the change is inert and
  safe to fold in; if any does, it is a live status-code bug and deserves its own
  REQ so it can be deployed and verified alone.
- **D3 (non-blocking).** Include a shared request-shape validator for the 17
  inline type checks, or leave it out to keep this REQ mechanical? Leaning out —
  it is a design question (schema-driven vs helper functions) that would stall an
  otherwise low-risk refactor.

## 7. Gates

1. `cd server && node tests/api_test.cjs` — baseline captured 2026-07-30 at
   `master` `e4b24dd0`: **229 passed, 0 failed, 1,950 assertions**. Must stay
   green after **every** per-family commit, not just at the end.
2. `STORAGE_BACKEND=pg node tests/api_test.cjs`.
3. `tools/ci.sh` full run; scoped e2e per PROJECT.md's test-game note
   (`source tools/e2e_ports.sh`, `E2E_PARALLEL=4 pnpm exec playwright test`) —
   the client's error-message handling is only exercised there.
4. Per-family: the matching `tests/api/<family>.cjs` must be green before the
   next family is touched.
5. Under D1(b), assert byte-parity explicitly: capture the 401/405/413/400 bodies
   for one route per family before and after, and diff.

## 8. Expected result

Roughly **-300 to -400 lines** in `routes/`, +120 in `lib/route_kit.cjs`. More
importantly: 13 auth-preamble copies -> 1, four error-status tables -> 1, 20 body
handlers -> 1, and the 401/413/400/405 wordings fixed in one place. The next
REQ-0199-class auth fix becomes a one-file change.

## 9. Status log

- 2026-07-30 — reserved (`7e15078e`), spec written, moved `reserved -> draft`
  pending D1/D2. Audit evidence gathered at `master` `e4b24dd0`.
