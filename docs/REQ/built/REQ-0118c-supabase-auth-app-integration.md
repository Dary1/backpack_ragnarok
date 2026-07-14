# REQ-0118c — Supabase Auth app integration: client Discord/guest UI + server JWT→player (TODO)

- **Status**: TODO (ready to implement). The backend/infra it needs is live (REQ-0118a,
  built). Ratified direction: **Discord + guest only**, off-store, $0.
- **Decision basis**: `docs/llm_managed/research/social_login_platform_selection.md`.

## Scope (remaining app work)
- **Server** (in a `req-0118` worktree): verify the Supabase JWT on API requests; map
  `auth.users.id` → `players` via the storage seam (`server/storage.cjs` is the ONLY
  persistence chokepoint); keep the REQ-0037 `X-Auth-Token` path + files-backend as
  fallback; all server tests stay green.
- **Client** (Vite+React+TS+PixiJS): add `supabase-js`; sign-in UI "Continue with Discord"
  + "Play as guest" (anonymous); handle the OAuth redirect round-trip (SITE_URL +
  allow-list already configured in REQ-0118a); session persistence. Respect the invariant
  that the client auto-save PUT is the ONE profile writer.
- **Guest migration / linking**: existing invite-token players (REQ-0037) and anonymous
  users can link Discord without losing their profile (respect REQ-0037 isolation and
  REQ-0089 save reliability).

## Gate (to reach built)
- E2E: Discord login on web (redirect round-trip → session → resolved player).
- Anonymous/guest → Discord linking preserves the player profile (prove no data loss).
- `tools/ci.sh` + full server/E2E suites green; secrets uncommitted.
- Then move to `built`; coordinate with the user before any live deploy
  (`backpack-api` / `backpack-web` are HANDS-OFF per PROJECT.md).

## Open (non-blocking, decide during design)
- Account-linking UX; whether to retain the dev invite-token path.

## Relationships
- Depends on: REQ-0118a (backend/infra — built & live), REQ-0040 (Supabase infra — done).
- Related: REQ-0118b (Steam bridge — draft); future Google + Sign in with Apple for paid
  stores.

---

## Implementation — 2026-07-14 (worktree `req-0118c-supabase-auth-app`)

Built off master @ `6ae7051`, re-synced with master (`8c8f4f7`) before final gates.
**NOT merged, NOT deployed** — the integration owner handles merge + deploy + the live
env wiring (below). This REQ moves `todo → built` (it stays `built`, not `done`, until the
S7 item below is verified).

### Auth flow design
- **Server JWT verify** — `server/lib/supabase_auth.cjs` (new): verifies the Supabase
  (self-hosted GoTrue) access token, HS256, via `node:crypto` only (**no new dependency**).
  Secret comes ONLY from `SUPABASE_JWT_SECRET`; when unset, verification is DISABLED and the
  server behaves exactly like the pre-REQ-0118c X-Auth-Token world. Checks: `alg=HS256`
  (no `none`/alg-confusion), timing-safe HMAC signature, `exp`/`nbf` (±5s skew),
  `aud=authenticated`.
- **`auth.users.id → players` mapping** — stored as `authId` on the player registry record
  (`server/players.cjs`: `findPlayerByAuthId` / `linkAuthId` / `createAuthPlayer`). A
  first-seen identity auto-provisions a player (name from Discord `user_metadata`, or "Guest"
  for anonymous; `roles:[]` — a social/guest login never self-grants `item_admin`).
- **Single chokepoint** — `admin.resolveAuthFromRequest(req)` is the one request-level
  resolver every authenticated route now calls (`routes/me.cjs`, `routes/profile.cjs`,
  `lib/route_auth.cjs`). Precedence: valid Bearer JWT → mapped player; else REQ-0037
  X-Auth-Token + `dev_mode` fallback. A present-but-invalid JWT (secret configured) is a
  hard 401 — never a silent dev-mode bypass. REQ-0037 invite path + files-backend fallback
  preserved; the client auto-save PUT stays the ONE profile writer.
- **Linking (no data loss)** — `POST /api/auth/link` attaches a verified Supabase identity
  to the caller's EXISTING invite/guest player (requires BOTH X-Auth-Token + Bearer JWT). It
  sets `authId` and NEVER touches `data/profiles/`, so the whole profile survives.
  Anonymous→Discord is client-side via supabase `linkIdentity` (the `auth.users.id` is
  preserved, so the same server player resolves — no migration). Conflicts refused
  (`authid_taken` / `already_linked`); idempotent re-link is a no-op.
- **Client** (`client/src/auth/{session,client}.ts`, new; `+@supabase/supabase-js`):
  "Continue with Discord" (OAuth redirect round-trip; `redirectTo` = app origin+path,
  matching REQ-0118a's SITE_URL/allow-list) and "Play as guest" (`signInAnonymously`) in the
  Settings sign-in block; session persistence + the OAuth code exchange handled by supabase-js
  (`persistSession`, `detectSessionInUrl`, PKCE), restored at boot BEFORE the first
  `/api/me`. `api/http.ts` `authHeaders()` now also sends `Authorization: Bearer <jwt>` (both
  headers may co-exist during linking; server prefers the JWT). When the build has no Supabase
  env the client is inert ("not configured") and the REQ-0037 invite/guest path is
  byte-identical — this is the CI/e2e state. `i18n.ja` added for every new string.

### Decisions [ORCH default, vetoable]
1. **auth→player seam lives in `server/players.cjs`, not physically inside
   `server/storage.cjs`.** The spec names storage.cjs as the mapping chokepoint; players.cjs
   is the established identity root (playerId/token/roles), and storage.cjs's own header
   explicitly scopes the registry OUT of storage.cjs (REQ-0037/0145a one-root-per-module).
   Putting `authId` on the player record keeps identity with identity and guarantees linking
   never touches the profile root (`data/profiles/`, the storage.cjs domain) — exactly what
   "no data loss" needs. Both are single-chokepoint seams for their own root; the mapping
   still flows through the ONE resolver (`admin.resolveAuthFromRequest`).
2. **JWT verified with `node:crypto` (HS256), no `jsonwebtoken` dependency** — smaller
   supply-chain surface; test JWTs minted with the same helper under a throwaway test secret.
3. **JWT ignored (not 401) when `SUPABASE_JWT_SECRET` is unset** — keeps dev/CI boxes without
   the secret identical to today; in production the secret is always set, so a real invalid
   JWT is still a hard 401.
4. **Discord sign-out / guest sign-in reload the page** to re-run boot cleanly against the
   new identity (same rationale as REQ-0037 `logout()`).
5. **Dist (`web/app/`) NOT committed on this branch** — the integration owner's
   `tools/release.sh` rebuilds+commits it at deploy (matches the master "dist rebuild via
   release.sh" convention); `ci.sh` rebuilds it before e2e anyway.

### Gate results (exact)
- `server/tests/auth_jwt_test.cjs` (new): **files 16/0, pg 16/0** — JWT verify
  (tamper/expiry/aud/alg/unset-secret), `auth.users.id→player` mapping + idempotent
  provisioning, fallback matrix, **linking-preserves-profile (files+pg parity)**.
- `server/tests/api_test.cjs`: **files 176/0, pg 176/0** — no regressions
  (`resolveAuthFromRequest` is a strict superset of `resolveAuth` for header-less requests).
- `client/scripts/check_auth.mjs` (new, ci step `[5.9/7]`): **all assertions pass** — OAuth
  redirect-URL construction, X-Auth-Token+Bearer header matrix, session persistence via
  `getSession`/`onAuthStateChange`, guest/discord/link/sign-out dispatch (injected fake client).
- `flock /tmp/backpack_ci.lock bash tools/ci.sh` (`SKIP_E2E=1`, `DATABASE_URL` set):
  **CI GREEN** — sim, server files+pg, typecheck (`tsconfig.server.json`), all client checks
  incl. `check_auth`, client typecheck+build.
- Default e2e suite (`pnpm run e2e`): **164 passed / 1 failed**; the single failure was
  `link-trace.spec.ts:202 "diagnostics are localized (ja)"` — a hover-timing flake in an
  UNTOUCHED REQ-0142 spec (the `.beam-trace` panel didn't appear; `element(s) not found`, not
  a wrong-string). Re-run in isolation (`pnpm run e2e:failed`): **1 passed**. Suite effectively
  all-green; global-teardown confirmed the profile sha256 matched before/after.
- **Secrets**: `git ls-files` / `git log -p master..HEAD` verified — no
  `SUPABASE_JWT_SECRET` value, no `VITE_SUPABASE_*` value, no `.env`/keys committed. Only
  placeholder `client/.env.example` (blank anon key). The one committed secret-like string is
  the intentional **test** JWT secret in `auth_jwt_test.cjs` (`req0118c-test-jwt-secret-not-the-real-one`).

### OPEN ITEM — S7 (requires user manual verification)
- **Live Discord OAuth round-trip: requires user manual verification (S7).** The real browser
  round-trip against live GoTrue at `auth.qtie.jp` (click "Continue with Discord" → authorize
  on discord.com → return to SITE_URL → resolved player) cannot be honestly automated — it
  needs real Discord credentials / account creation and an external live service, so it is
  NOT in the automated suite. What IS automated: server-side JWT verify + mapping + linking +
  fallbacks (files+pg), and client-side wiring (redirect construction, header attach, session
  persistence, handler dispatch against a stubbed session). **Because this open item remains,
  REQ-0118c stays in `built/` (not `done/`) after merge** until the user verifies the live
  Discord round-trip.
- **Integration owner TODO before deploy** (not committed here — secrets): set
  `SUPABASE_JWT_SECRET` (the GoTrue JWT secret) in `server/.env` for `backpack-api`, and
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the client build env (or
  `client/.env.local`) before `tools/release.sh`.

### Commits (branch `req-0118c-supabase-auth-app`)
- `83582dd` — server: Supabase JWT verify + `auth.users.id→player` mapping (+ files/pg tests)
- `e3445f8` — client: Supabase sign-in (Discord + guest) + Bearer header + linking (+ check)
- `8c8f4f7` — merge master (re-sync before final gates)
- _this commit_ — docs: REQ-0118c `todo → built`

---

## Wave-5 integration / deploy record (2026-07-14)

Merged to master via `--no-ff` merge commit `6f69975`. Env wired at deploy
(values NOT committed; both targets gitignored -- verified before writing):
- `SUPABASE_JWT_SECRET` -> `server/.env` (from the REQ-0118a GoTrue
  `~/supabase/docker/.env` `JWT_SECRET`); loaded by `backpack-api` via its
  systemd `EnvironmentFile=server/.env`. Ignored by `.gitignore:8` (`.env`).
- `VITE_SUPABASE_URL=https://auth.qtie.jp` + `VITE_SUPABASE_ANON_KEY` (from the
  same file, key `ANON_KEY`) -> `client/.env.local`; baked into the committed dist
  by `tools/release.sh` (Vite loads `.env.local`). Ignored by `client/.gitignore`
  (`*.local` / `.env*.local`).

Full gate `flock /tmp/backpack_ci.lock bash tools/release.sh` GREEN on the
integrated master: **CI GREEN**; server `auth_jwt_test` 16/0 (files+pg),
`api_test` 176/0 (no regression); client `check_auth` [5.9/7] pass; default e2e
**165/165 passed** against the supabase-env-baked dist -- REQ-0037 guest/invite
parity holds (`guest-auth.spec.ts:83` invite -> `/api/me` -> welcome banner
green with env baked in). Dist rebuilt + committed `4b1a544`;
`backpack-api` / `backpack-web` restarted; HTTP 200 (8801 /app/, 8802 /api/health).

Post-deploy smoke: fabricated invalid Bearer and well-formed-but-tampered JWT
both -> **401** on `/api/me` (proves HS256 verify is ACTIVE, i.e. the secret is
loaded -- an unset secret would ignore the token, not reject it); no-token ->
unchanged REQ-0037 dev identity (`{"playerId":"dev",...}`, 200).
Final master at deploy: `4b1a544`.

**STAYS in `built/`** -- the S7 open item (live Discord OAuth browser round-trip)
still requires user manual verification (see "OPEN ITEM -- S7" above). NOT moved
to `done/`.
