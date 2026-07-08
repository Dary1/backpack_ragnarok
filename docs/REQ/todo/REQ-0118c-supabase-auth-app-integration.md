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
