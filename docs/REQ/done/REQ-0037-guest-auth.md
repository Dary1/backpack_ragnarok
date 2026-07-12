# REQ-0037 — Simple Guest Auth (invite tokens; EOS rejected)

- **Status**: IN PROGRESS (user: implement now; backend DB researched separately by user)

## Context
EOS rejected (friends lack Epic accounts). Goal: developer mode for the user + let
non-developer friends play, with per-player profiles, TODAY, without passwords.

## Design
- Invite token = unguessable ID (server-generated). `node server/cli_invite.cjs <name>`
  creates data/players/<playerId>.json {playerId, name, roles, token} and prints an
  invite URL `https://backpack-dev.qtie.jp/app/#/invite/<token>`.
- Client: visiting the invite route stores the token (localStorage allowed in our own
  client build) and calls POST /api/auth/guest {token} → session cookie-less model:
  client sends `X-Auth-Token` on every API call. /api/me resolves the token → player.
- Per-player profiles: /api/profile/:playerId/canvas — server derives playerId from
  the TOKEN (path must match; 403 otherwise). Existing default profile becomes the
  dev player's. Dev token auto-created at boot (printed to server log only).
- Logout/switch = clear token (Settings page gets a small account block: name, id,
  roles, logout). No password, no email. Rate-limit auth endpoint lightly.
- Roles stay in the player file (item_admin only for dev by default).
- E2E: invite flow (create token via CLI in test setup), two players get ISOLATED
  profiles (mutations don't leak), wrong/absent token → 401/403 on profile+admin,
  dex edit gate follows roles of the authenticated player.
- Migration: unauthenticated requests to the old default profile keep working ONLY
  in dev mode flag (config) to avoid breaking mock; flag documented.
