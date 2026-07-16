# REQ-0199 — Routes JWT auth parity (player-identity routes resolve the caller like schedule/warehouse)

## State log
- 2026-07-16 reserved (stub).
- 2026-07-16 reserved -> todo: user-reported LIVE defect (a Supabase-JWT-only
  player cannot sell on the market -- every sell 404s). Root cause diagnosed by
  code inspection + live repro; cleared to implement immediately.
- 2026-07-16 implemented + tests (commit b8d9057): market/ragnarok/dismantle/bio/dex
  now resolve the caller via admin.resolveAuthFromRequest(req); market/ragnarok keep
  `const token = getAuthToken(req)` SOLELY for callerIsDevFallback (formula preserved
  verbatim); dismantle/bio/dex dropped the now-unused getAuthToken import.
- 2026-07-16 gates GREEN:
  - server api_test.cjs (files backend): 185 passed, 0 failed (executed assertions 1500).
    Both new REQ-0199 gates PASS (market createListing + dismantle, JWT-only caller).
  - server/tests/auth_jwt_test.cjs (standalone, files): 16 passed, 0 failed.
  - SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh -> CI GREEN (typecheck + all files-backend
    suites + client typecheck/build).
  - client market e2e: 17 passed / 17 (EXIT=0). The Playwright global-teardown drove
    the no-token dev-fallback hooks (POST /api/market/listings/dev/clear-all cleared=0;
    POST /api/ragnarok/einherjar/dev/clear deleted=0), proving the preserved
    callerIsDevFallback invariant did NOT regress the e2e's dev-fallback proxy path.
  - web/app build artifacts reverted (git checkout -- web/app); tree left clean.
- 2026-07-16 todo -> built.

## Problem
User report (2026-07-16): a Supabase-JWT-authenticated player (Authorization:
Bearer <jwt>, NO X-Auth-Token) could not sell on the market -- every sell attempt
404'd "item not found in your inventory", surfaced to them as the client's
generic error toast.

Root cause (code inspection + live repro). Since REQ-0118c the single
request-level resolver `admin.resolveAuthFromRequest(req)` puts the Supabase JWT
path FIRST (a valid Authorization: Bearer <jwt> -> the mapped player), then falls
back to the REQ-0037 X-Auth-Token path (+ the dev_mode no-token fallback).
profile/me resolve through it directly, and schedule/warehouse resolve through
`lib/route_auth.cjs`'s `resolveCallerOr401`, which wraps it. But FIVE
player-identity route families were never migrated and still called the OLD
X-Auth-Token-ONLY resolver `admin.resolveAuth(getAuthToken(req))`:

- server/routes/market.cjs
- server/routes/ragnarok.cjs
- server/routes/dismantle.cjs
- server/routes/bio.cjs
- server/routes/dex.cjs

For a JWT-only caller `getAuthToken(req)` is null -> `resolveAuth(null)` -> the
dev_mode no-token fallback -> the route acted as the WRONG player ('dev'),
consulting the DEV player's inventory/ledger. Live symptom on the market: a
sell -> createListing reads the dev player's canvas -> the real seller's item is
"not found in your inventory" -> 404. The market/service logic itself is correct;
ONLY caller resolution was wrong.

## Change (server-only; no client, no API-shape change)
Each of the five routes now resolves the caller through
`admin.resolveAuthFromRequest(req)` (Supabase JWT first, then X-Auth-Token +
dev_mode fallback) -- exactly how schedule/warehouse (route_auth.cjs) and
profile/me already resolve. The 401 status + wording are unchanged
(`'unauthorized: ' + reason`; `reason` is now 'invalid_jwt' for a present-but-bad
JWT, matching me/profile).

- market.cjs / ragnarok.cjs build custom auth envelopes (Idempotency-Key, the
  dev-hook gate), so they call `admin.resolveAuthFromRequest(req)` directly and
  KEEP `const token = getAuthToken(req)` SOLELY to compute callerIsDevFallback
  (formula unchanged).
- dismantle.cjs / bio.cjs / dex.cjs swap `admin.resolveAuth(getAuthToken(req))`
  -> `admin.resolveAuthFromRequest(req)` and drop the now-unused getAuthToken
  import.

OUT OF SCOPE (untouched): routes/admin.cjs, routes/art.cjs, routes/content.cjs
(role/admin-gated semantics), routes/public.cjs, routes/me.cjs + routes/profile.cjs
(already correct). No client change.

## The dev-fallback invariant (CRITICAL)
market.cjs and ragnarok.cjs gate their dev-only E2E hooks
(/listings/dev/clear-all, /order/dev/force-rebuild, /einherjar/dev/clear) on
`callerIsDevFallback = !token && devUser.dev_mode === true && callerId === devUser.playerId`
where `token` is the X-Auth-Token (`getAuthToken(req)`). This is the SAME formula
`lib/route_auth.cjs` uses for the JWT era and is preserved verbatim. Semantics:
true ONLY when NO credential presented (no JWT AND no X-Auth-Token) resolved the
caller to the dev player via the no-token fallback. A valid JWT caller has
`getAuthToken(req) === undefined` but a resolved id that is their OWN
(auto-provisioned, never 'dev'), so callerIsDevFallback is false for them -- a JWT
caller can NEVER be the dev fallback. The no-credential path (no Bearer, no
X-Auth-Token) is unchanged, so the E2E suite's dev-fallback proxy path still works.

## Tests
- server/tests/api/market.cjs: + a JWT-only createListing gate. Provisions a
  Supabase-JWT player (TEST secret, forged the same way auth_jwt_test.cjs does),
  seeds ONLY that player's canvas with a stowed item, then POSTs
  /api/market/listings with Authorization: Bearer and NO X-Auth-Token. Asserts
  200 + the listing belongs to THAT player (sellerName) -- proving the dev
  fallback is NOT used (the item exists in no other canvas, so a dev-fallback
  resolution would 404 exactly like the live defect). Withdraws afterwards to
  leave the shared market clean.
- server/tests/api/dismantle.cjs: + a JWT-only /api/dismantle smoke -- same
  forge; dismantles the JWT player's OWN stowed item and asserts THEIR ledger was
  engraved (caller identity proven for a second route family).
- Existing suites stay green: the X-Auth-Token guest path AND the dev no-token
  fallback are both untouched (the e2e suite depends on the latter).

## Gates
- server api tests (files) green; standalone `node server/tests/auth_jwt_test.cjs`
  green.
- `SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh` -> CI GREEN.
- market e2e 17/17 (the suite authenticates via the no-token dev fallback through
  the proxy -- proves the preserved invariant did not regress it).
