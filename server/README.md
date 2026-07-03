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
  content/live stays the single source of truth; this is not a copy). Each
  item/si entry also carries server-rendered `eff_en`/`eff_ja` display text,
  produced from its `effects` AST via `tools/eff_render.cjs` (the same
  renderer `tools/tool_gen_data.cjs` uses to bake `mock-src/data.js`), so
  live-mode tooltips are byte-identical to baked-mode tooltips (closes the
  REQ-0024 "blank effect text in live mode" gap).
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

## Client (REQ-0026 T0.1)
The real game client lives in `~/backpack_ragnarok/client/` (Vite + React +
TypeScript + PixiJS) and is served as **static files** by the same
`backpack-web.service` this file's sibling section documents -- no separate
service, no ingress change. Build output goes straight to `web/app/`, which
`backpack-web.service` already exposes at `/app/` (it serves the whole
`web/` directory as-is).

Build + deploy:
```
cd client
npm install     # first time only; node_modules is gitignored
npm run build   # tsc -b && vite build -> outputs to ../web/app (emptyOutDir)
```
The build output (`web/app/`) is committed directly to the repo -- it is the
deployed artifact. There is no separate "deploy" step beyond running the
build and committing the result; `backpack-web.service` picks it up
immediately since it serves `web/` from disk on every request.

Verify: `curl https://backpack-dev.qtie.jp/app/` -> 200, HTML with a hashed
JS bundle under `/app/assets/`. The client fetches game content from
`/api/content` (this service, see Endpoints above) at runtime -- no game
content (item names, effect/flavor text) is baked into the client bundle;
see `client/README.md` for the client's own structure and scope notes.

## Ingress change log
- 2026-07-03 (REQ-0024): applied via Cloudflare Tunnel Configuration API
  (PUT accounts/<acct>/cfd_tunnel/<tunnel_id>/configurations), config
  version 1 -> 2. Verified after apply: `curl https://backpack-dev.qtie.jp/api/health`
  -> `{"ok":true,"version":"0.1.0"}`; `/mock/` still 200.
