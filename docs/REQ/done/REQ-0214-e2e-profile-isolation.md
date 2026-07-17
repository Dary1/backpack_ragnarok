# REQ-0214 — E2E profile isolation: confine e2e writes to dedicated test profiles

## Status
todo (ratified by user directive, 2026-07-17, chat: "e2e のテストフィクスチャで
上書きは、テスト用のprofileだけにとどめる事はできませんか？").

## Problem (incident, 2026-07-17)
The main e2e suite runs against the LIVE api (proxy 8803 -> 8802) and, for
every unauthenticated request, resolves to the dev_mode no-token fallback ==
the `dev` player. Specs that reset/seed profile state therefore OVERWRITE the
dev player's real profile (observed: `88d662ca20e5289b:dev` replaced at
04:11:39 with e2e fixtures `e2e_multi_po_0` / `e2e_lrdst_seed`). History
shows this has been happening on every full-CI e2e run; REQ-0209's run merely
surfaced it.

## Design — header-based fallback redirect, one auth chokepoint
1. `server/admin.cjs resolveAuthFromRequest(req)`:
   - Detect the dev fallback (no Bearer, no X-Auth-Token, dev_mode true) and
     annotate the result: `viaDevFallback: true`.
   - When `viaDevFallback` AND header `x-bpk-e2e-profile: <suffix>` present:
     return a copy of the dev player with `playerId = 'e2e_' + sanitize(suffix)`
     (charset [A-Za-z0-9_-], max 32, else 'default'), name "E2E (<suffix>)",
     roles UNCHANGED (admin e2e needs item_admin). Real-token callers are
     NEVER redirected; with dev_mode=false the header is inert.
2. Gate/alias call sites switch from `callerId === devUser.playerId` to the
   resolver's own `viaDevFallback` (the id comparison breaks under redirect;
   the flag preserves dev/backdate + genSeed seams for e2e):
   - server/lib/route_auth.cjs  (callerIsDevFallback)
   - server/routes/market.cjs   (same duplicated computation)
   - server/routes/ragnarok.cjs (same)
   - server/routes/profile.cjs  (isDefaultAlias: 'default' now aliases the
     RESOLVED fallback identity — dev for the user, e2e_<suffix> for e2e)
   - audit any other `readDevUser().playerId ===` comparison against a
     resolved caller (grep during implementation).
3. `client/playwright.config.ts`: `use.extraHTTPHeaders = { 'x-bpk-e2e-profile':
   'ci' }` — inherited by every page/request fixture, so ALL e2e traffic
   (main suite + admin harnesses, which share this config) lands on `e2e_ci`.
   Audit manual `request.newContext()` call sites for non-inherited contexts.
4. Out of scope: cleaning up existing e2e junk rows; restoring the dev
   profile (separate user decision); the unexplained backpack-api restart at
   04:08:34 during the e2e window (investigate opportunistically).

## Gates
- New server test (files backend, DB-free): header+no-token resolves to
  e2e_<suffix>; PUT /api/profile/default with header writes e2e_* and leaves
  dev.json untouched; dev/backdate + genSeed still authorized under redirect;
  real token + header => NOT redirected.
- Full ci.sh mid-gates + client build.
- Live verification after e2e: `dev` profile row updated_at UNCHANGED across
  a full main-suite run; new writes confined to `e2e_ci`.

## Log
- 2026-07-17 reserved as REQ-0214 (e1abd3b), spec ratified straight to todo
  per user directive.

## Implementation notes (2026-07-17)
- Design amendment: storage isAllowedProfileId = "any known player id"
  (REQ-0037), so the redirect lazily provisions the e2e player via
  players.ensureFixedPlayer (ensureDevPlayer pattern) on first use; the
  resolved fallback object strips the token (dev or e2e) so a redirected
  caller can never learn a real token.
- Residual shared-state risk noted, out of scope: /api/market/listings/dev/
  clear-all clears the WHOLE shared market shelf (including human-made
  listings) on every e2e run; the redirect does not change that.

## Gate results
- e2e_profile_redirect_test: 9/9 (files + pg). auth_jwt_test files+pg,
  api_test files+pg, tsc server, client build: green.
- Route smoke (throwaway worktree api, files backend): default alias PUT/GET
  with header -> profiles/e2e_ci.json, dev untouched; dev hooks work under
  redirect; bogus token 401.
- Live verification pending deploy: run full main e2e, assert pg dev row
  updated_at unchanged and new writes confined to e2e_ci.

## Deploy record (2026-07-17)
- Merged to master 35a8edc (--no-ff, user go-ahead in chat); backpack-api
  restarted; live-verified: /api/me headerless -> dev, with
  x-bpk-e2e-profile -> e2e_ci.
- Old-harness freeze REMAINS ACTIVE until other worktrees rebase past this
  merge (~/.cache/backpack/E2E_FREEZE_README.txt).
