# server/ — backpack-api (REQ-0024)

Node API service providing live content + canvas persistence for the mock.
Runs alongside `backpack-web.service` (8801, static) — this service listens
on `127.0.0.1:8802` only.

## Files
- `api.cjs` — HTTP server (node:http only, no framework deps). Entry point
  for the `backpack-api.service` systemd unit.
- `storage.cjs` — THE repository module. Every read/write of persisted
  profile data goes through this file. Data directory:
  `~/backpack_ragnarok/data/profiles/<id>.json` (gitignored). Writes are
  atomic (tmp file + `fs.renameSync`). Every stored document carries a
  `schema_version` field. Profile ids are a fixed allowlist (`["default"]`
  only) — no user-controlled paths. Body size cap: 64KB.
  When Postgres is introduced later, only this module's internals change;
  its exported API (`readProfile`, `writeProfile`, etc.) is the seam.
- `tests/api_test.cjs` — storage round-trip, content endpoint shape,
  profile PUT/GET round-trip, oversized-body rejection. Run with
  `node server/tests/api_test.cjs`.

## Endpoints
- `GET /api/health` → `{ok:true, version:"<semver>"}`
- `GET /api/content` → `{items, sis, trees, scenario, layout}`, read fresh
  from `content/live/*.json` + `content/vocab.json` (mtime-checked cache —
  content/live stays the single source of truth; this is not a copy).
- `GET /api/profile/default/canvas` → `{schema_version, profile_id,
  updated_at, canvas}` or 404 if nothing saved yet.
- `PUT /api/profile/default/canvas` (body = canvas JSON, ≤64KB) → same
  shape as GET, 200 on success, 413 if the body exceeds the cap.

**Accepted dev risk**: profile PUT is publicly reachable on the dev URL
(single fixed profile id, size-capped, no path injection possible). Revisit
at the account/auth phase (= Postgres phase), per REQ-0024.

## systemd (user unit, Node v24 via nvm)
`~/.config/systemd/user/backpack-api.service`:
```
ExecStart=/home/qtie/.nvm/versions/node/v24.18.0/bin/node %h/backpack_ragnarok/server/api.cjs
Restart=on-failure
WantedBy=default.target
```
Enable/start: `systemctl --user enable --now backpack-api.service`.
Check: `systemctl --user is-active backpack-api.service` and
`curl 127.0.0.1:8802/api/health`.

## Cloudflare tunnel ingress (backpack-dev, remote-managed config)
Config lives in Cloudflare, not in a file in this repo — recorded here for
the record for the REQ-0024 rollout, done via the Tunnel Configuration API
(`accounts/<acct>/cfd_tunnel/<tunnel_id>/configurations`).

Before (unchanged since REQ-0002):
```
backpack-dev.qtie.jp                  -> http://localhost:8801
(catch-all)                           -> http_status:404
```

After (REQ-0024 — new rule added ahead of the existing catch-all-hostname
rule, so more specific path wins first):
```
backpack-dev.qtie.jp  path=/api/*     -> http://localhost:8802
backpack-dev.qtie.jp                  -> http://localhost:8801
(catch-all)                           -> http_status:404
```
The 8801 rule (mock/preview/static) and DNS/tunnel id are untouched.

## Ingress change log
- 2026-07-03 (REQ-0024): applied via Cloudflare Tunnel Configuration API
  (PUT accounts/<acct>/cfd_tunnel/<tunnel_id>/configurations), config
  version 1 -> 2. Verified after apply: `curl https://backpack-dev.qtie.jp/api/health`
  -> `{"ok":true,"version":"0.1.0"}`; `/mock/` still 200.
