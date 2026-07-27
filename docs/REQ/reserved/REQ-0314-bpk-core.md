# REQ-0314 — `bpk` core: HTTP client, auth guard, canvas layer

- **State**: reserved (scope only)
- **Program**: LLM Test-Play Fleet, track B (the reusable CUI tool). Design doc §4.
- **Depends on**: REQ-0309, REQ-0310.
- **Blocks**: REQ-0315, REQ-0316, REQ-0317.

## Scope

New top-level `bot/` package (sibling of `server/`, `client/`, `sim/`), its own
`package.json`, **zero dependencies**, Node CommonJS — the same posture
`server/api.cjs` already takes. Binary `bot/bin/bpk.cjs`.

- HTTP client over `node:http`/fetch: `X-Auth-Token`, JSON only, jittered rate
  floor, per-session request counter.
- **Endpoint allowlist compiled in.** Anything matching `/api/admin/`, any
  `/dev/` path, `genSeed`/`drawSeed`, and the Ragnarok `devotion` rite are refused
  by the tool, not by a prompt.
- **Identity guard** (`bpk doctor`): refuse to run unless `GET /api/me` returns a
  non-`dev` playerId matching the configured agent, with `roles: []`. Live
  `data/config/dev_user.json` carries no `dev_mode` key and `admin.cjs:71` defaults
  it to `true`, so a request with no token silently becomes the DEV PLAYER. Fail
  closed.
- Canvas layer on `shared/engine.js` + `shared/player_actions.mjs` (REQ-0310):
  load → `migrateState` → mutate → `checkUidInvariant` → PUT. **Never PUT a canvas
  that fails the invariant.**
- Profile bootstrap for a brand-new account via the shared starter seed.
