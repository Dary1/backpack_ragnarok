# REQ-0024 — Dynamic Mock: Node API + File Persistence (DB deferred)

- **Status**: DONE (2026-07-03)

## Outcome
backpack-api.service live (Node, 127.0.0.1:8802, user systemd, restart-safe).
Ingress: backpack-dev.qtie.jp `^/api/.*$` → 8802 inserted before the 8801 rule
(remote tunnel config v1→v2; recorded in server/README.md). Endpoints: /api/health,
/api/content (fresh from content/live + vocab, mtime cache, WITH server-rendered
eff_en/eff_ja via tools/eff_render.cjs — byte-identical to baked strings),
/api/profile/default/canvas GET/PUT (413 >64KB). storage.cjs = sole persistence
chokepoint (data/profiles/*.json, atomic tmp+rename, schema_version, id allowlist).
Mock: async boot, live-fetch with baked-data.js fallback + source badge; Save/Load
buttons round-trip makeState() shape via profile API. Tests: server 9/9, engine 18/18.
Commits ec452ce, a8cb3db, 676d734, f4297ec, a5cb15d.
**Queued cleanup**: mock-src/eff_render.cjs diverged from tools/eff_render.cjs
(TAG_KIND_EN.element 'PO' vs 'element' — batch-1 fix missed the mock-src copy);
dedupe or sync.
- **Date**: 2026-07-03 (orchestrator gen2)
- **User ruling**: proceed; DB (Postgres) DEFERRED; persistence lives in FILES with the
  storage layer confined ("ファイルにとじこめ") so a DB can slot in later at one point.

## Goal
The mock stops being a baked static page: content comes from the server's live data at
load time, and player canvas state (single local profile for now) persists across
reloads. Engine/UI logic unchanged — only the data supply and state persistence change.

## Architecture
- **backpack-api.service** (user systemd, Node v24, localhost:8802): new service beside
  backpack-web (8801, static). Public path via existing Cloudflare tunnel: add ingress
  rule `backpack-dev.qtie.jp` path `/api/*` → 8802 (remote-managed config, CF API token
  in FS `.keys/cloudflare_api_token`; tunnel id in `.keys/tunnel_id`). Existing 8801
  rule and the root llmlocal tunnel stay untouched.
- **Endpoints v0**: `GET /api/health` · `GET /api/content` (items+sis+vocab trees+
  scenario, straight from content/live — single source of truth) · `GET/PUT
  /api/profile/default/canvas` (canvas/preset state JSON).
- **Storage**: `server/storage.cjs` = THE one repository module (read/write
  `~/backpack_ragnarok/data/profiles/<id>.json`, atomic write via tmp+rename, schema
  version field). All persistence goes through it; Postgres later = replace this file.
- **Mock**: fetch `/api/content` at load (fallback to baked data.js if fetch fails —
  offline-first principle); Save/Load of canvas state via profile API.
- **Security note (accepted dev risk)**: profile PUT is publicly reachable on the dev
  URL; single fixed profile id, size-capped body, no user-controlled paths. Revisit at
  account/auth phase (= Postgres phase).

## Deliverables
- [ ] backpack-api.service active, survives restart (linger), health 200 via tunnel
- [ ] /api/content served from content/live; mock renders from it (data.js = fallback)
- [ ] Canvas save/load round-trip works in mock UI
- [ ] storage.cjs = sole persistence chokepoint; data/ gitignored
- [ ] API contract tests + storage round-trip tests; engine 18/18 stays green
- [ ] Git commits; ingress change documented here
