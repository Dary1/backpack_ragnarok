# server/ — backpack-api (REQ-0024)

Node API service providing live content + canvas persistence for the mock.
Runs alongside `backpack-web.service` (8801, static) — this service listens
on `127.0.0.1:8802` only.

## Files
- `api.cjs` — HTTP server (node:http only, no framework deps). Entry point
  for the `backpack-api.service` systemd unit.
- `storage.cjs` — THE repository module for canvas profiles. Every read/
  write of persisted profile data goes through this file. Data directory:
  `~/backpack_ragnarok/data/profiles/<id>.json` (gitignored). Writes are
  atomic (tmp file + `fs.renameSync`). Every stored document carries a
  `schema_version` field. Body size cap: 64KB. Profile ids are now (REQ-
  0037) "any known player id" — see `players.cjs` and "Auth" below; this
  module answers "does this id exist as a known player", NOT "is the
  current caller authorized to use it" (that's `api.cjs`'s job).
  When Postgres is introduced later, only this module's internals change;
  its exported API (`readProfile`, `writeProfile`, etc.) is the seam.
- `players.cjs` (REQ-0037) — THE player registry module. Every read/write
  of a player record goes through this file. Data directory:
  `~/backpack_ragnarok/data/players/<playerId>.json` (gitignored). Record
  shape: `{playerId, name, roles, token, createdAt}`. Same atomic-write
  convention as `storage.cjs`. Tokens are server-generated
  (`crypto.randomBytes(24).toString('hex')`), long, random, never
  sequential/guessable, and never regenerated once minted.
- `cli_invite.cjs` (REQ-0037) — operator CLI: `node server/cli_invite.cjs
  <name> [--roles r1,r2]`. Mints a new player via `players.cjs` and prints
  an invite URL. Not exposed via HTTP. See "Auth" below.
- `admin.cjs` — dev-user/dev-player bootstrap (`data/config/dev_user.json`
  + `data/players/dev.json`), the auth-resolution function used by every
  authenticated route (`resolveAuth`), the admin role guard
  (`isItemAdminToken`), and the admin item-edit write path (validation
  against `content/vocab.json` + atomic write to `content/live/
  live_items.json`/`live_sis.json`). See "Auth" and "Admin API" below.
- `tests/api_test.cjs` — storage/registry round-trip, content endpoint
  shape, profile PUT/GET round-trip (per-player + the `default` alias),
  oversized-body rejection, `/api/me` token resolution (valid/invalid/
  dev_mode fallback/dev_mode off), profile-ownership 401/403 matrix,
  admin-write validation (vocab/range/schema-allowlist rejections),
  admin-guard 403 matrix (missing/invalid token, valid token lacking the
  role, dev-mode fallback), and a dedicated real-repo test that edits the
  actual `content/live/live_items.json`, verifies the change, then
  restores the original bytes and checks a sha256 match (try/finally —
  restoration runs even if an assertion above it fails). Run with
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
  REQ-0024 "blank effect text in live mode" gap). No auth required.
- `GET /api/me` → `{playerId, name, roles}` for the token-resolved player
  (REQ-0037; see "Auth" below), or `401` if the token is present-but-
  invalid, or absent with `dev_mode:false`.
- `GET /api/profile/:playerId/canvas` / `PUT /api/profile/:playerId/canvas`
  (body = canvas JSON, ≤64KB on PUT) → same shape as before
  (`{schema_version, profile_id, updated_at, canvas}`), 200/404/413, PLUS
  (REQ-0037) `401` for a missing/invalid token (when required) and `403`
  if the token's own player does not match `:playerId`. See "Auth" below.
- `PUT /api/admin/item/:id` → see "Admin API" below.

**Accepted dev risk (unchanged from REQ-0024/REQ-0035)**: this is a small
dev-grade deployment — profile storage has no rate limiting, no request
signing beyond the bearer token itself, no HTTPS termination in this
service (TLS ends at the Cloudflare tunnel). Revisit at a real
productionization pass.

## Auth (REQ-0037)

**Model**: a small player registry (`players.cjs`, `data/players/
<playerId>.json`), each record `{playerId, name, roles, token,
createdAt}`. Requests authenticate via an `X-Auth-Token` header carrying
one player's `token` verbatim. There is no session/cookie layer, no
password, no OAuth — a token IS the credential, valid indefinitely until
an operator manually edits/deletes the player's registry file. This
replaces REQ-0035's `X-Player-Id`-trusted-at-face-value mechanism
entirely — that header is no longer read anywhere in this codebase.

**Auth resolution** (`admin.cjs`'s `resolveAuth(token)`, the SINGLE
function `/api/me`, the profile routes, and the admin guard all funnel
through):
1. `X-Auth-Token` present and matches a known player's token → resolves
   to that player.
2. `X-Auth-Token` present but matches no known token → `401` (`/api/me`,
   profile routes) — an invalid/garbage/expired-looking token is always
   an auth failure, never silently downgraded to "anonymous".
3. `X-Auth-Token` absent entirely:
   - `dev_mode: true` → falls back to the dev player (see below) — so
     `/mock/` and any unauthenticated dev flow keeps working with zero
     token at all.
   - `dev_mode: false` → `401`.

**`dev_mode` flag**: lives as a boolean field on `data/config/
dev_user.json` itself (`{"playerId":"dev","name":"Developer",
"roles":["item_admin"],"dev_mode":true}`) — the same config-file
convention `admin.cjs` already established for the dev identity in
REQ-0035, just extended with one more field rather than introducing a
separate config file. **Default is `true`** on a freshly-created
`dev_user.json` (i.e. a brand-new box, or one upgraded from pre-REQ-0037
where the file didn't have this key yet — `admin.cjs`'s `readDevUser()`
treats a missing key the same as `true`, for backward compatibility).
This flag is meant to be **flipped to `false` by hand** (edit the file,
`systemctl --user restart backpack-api.service`) once real guest tokens
are the only intended entry path for this deployment — there is no
endpoint to toggle it remotely, by design.

**Dev player bootstrap**: at server boot (`api.cjs`'s `main()`),
`admin.ensureDevUser()` creates `data/config/dev_user.json` with the
default shape above if missing (unchanged from REQ-0035), then
`admin.ensureDevPlayer()` creates (or, on a later boot, simply reuses) a
matching `data/players/dev.json` registry entry — same `playerId`/`name`/
`roles` as `dev_user.json`, plus a freshly-generated `token` the FIRST
time this runs. **The token is printed to the server's own stdout/journal
exactly once** — only on the boot where the registry file is first
created. Every later boot reuses the existing token unchanged (no re-log,
no rotation) — check `journalctl --user -u backpack-api.service` right
after a fresh deploy if you need it, or just read the `token` field
directly from `data/players/dev.json` (gitignored, root-readable only in
the sense that it's just a normal file on this dev box). **The token is
never included in any HTTP response body, ever.**

**Per-player profiles**: `GET`/`PUT /api/profile/:playerId/canvas` now
accept any player id known to the registry — but the URL's `:playerId` is
NEVER trusted as the auth mechanism. `api.cjs`'s route handler resolves
the ACTUAL player from the token first (same `resolveAuth()` as `/api/me`,
including the `dev_mode` fallback), then compares that player's own id
against the URL segment. A mismatch → `403` (the token is valid and
belongs to someone, just not to the profile being requested) — this is
how per-player board isolation is enforced: player A's token can never
read or write player B's profile, full stop.

**Migration + the `default` alias**: `data/profiles/default.json` (the
pre-REQ-0037 single fixed profile) is now the dev player's own profile.
The dev player's `readProfile()` call falls back to reading
`default.json`'s contents if the dev player's own profile file doesn't
exist yet (a plain fallback READ, never a rename — `default.json` is left
on disk untouched, so this is safe to run repeatedly and never loses
data). Additionally, the literal URL segment `/api/profile/default/canvas`
is kept as a **`dev_mode`-only compat alias** for the dev player's own
profile — this is intentional, permanent (not a temporary shim to delete
later) compatibility for old E2E specs / any hardcoded `'default'` call
site, and stops working the moment `dev_mode` is flipped to `false` (at
that point `"default"` is just an unknown/mismatched player id like any
other, and 401/403s the same way).

**CLI invite tool**: `node server/cli_invite.cjs <name> [--roles
r1,r2]` — run by hand over SSH (an operator tool, never exposed via
HTTP). Creates a fresh player (`players.cjs`'s `createPlayer()` — new
`playerId`, new random `token`) and prints an invite URL:
`https://backpack-dev.qtie.jp/app/#/invite/<token>`. Omitting `--roles`
defaults to `roles: []` (a plain guest, no elevated permissions — grant
`item_admin` etc. explicitly via `--roles item_admin` or a comma-
separated list). Hand the printed URL to the guest; visiting it in the
client stores the token in `localStorage`, resolves `/api/me`, and
redirects to `#/backpacks` with a brief welcome banner (see
`client/src/store.ts`'s `handleInviteRoute()`).

## Admin API (REQ-0035, auth mechanism replaced by REQ-0037)

**`PUT /api/admin/item/:id`** edits one item's editable fields in
`content/live/live_items.json` (POs) or `content/live/live_sis.json` (SIs).

- **Auth guard**: resolves the request's `X-Auth-Token` via the exact same
  `resolveAuth()` as `/api/me` (including the `dev_mode` fallback to the
  dev player when no token is sent), then checks the resolved player's
  `roles` includes `item_admin`. Missing token, invalid token, or a
  resolved player lacking the role → `403` — this endpoint keeps its
  original REQ-0035 status-code convention (403 for every guard failure,
  not 401 for an invalid token the way the profile routes distinguish it)
  since existing tests/clients already depend on that exact contract;
  only the underlying mechanism changed (a real registry lookup instead
  of a client-supplied header trusted at face value).
- **`:id` must be a LIVE item** — found in `live_items.json` or
  `live_sis.json`'s `entries[]`. There is no `content/staging/`/`content/
  draft/` directory in this repo today, so this is enforced simply as "id
  found in one of the two live files, else 404" — draft/staging content
  (if introduced later) can never match this lookup and stays uneditable
  via this endpoint.
- **Body schema allowlist**: unknown top-level keys → `400`. Editable keys:
  `name`, `name_ja`, `flavor`, `flavor_ja`, `i18n`, `rarity`, `effects` (all
  entries), plus `tags`/`sockets`/`stretch` for POs only (SIs have no
  `tags`/`sockets`/`stretch` fields in schema `si/2`). Shape/ports are
  intentionally NOT editable via this endpoint (geometry editing is
  deferred, see the item-encyclopedia REQ). `effects` may grow or shrink
  freely (including down to an empty array) -- there is no fixed-length
  assumption anywhere in validation (REQ-0038).
- **`i18n` map (REQ-0038)**: `{<locale>: {name?, flavor?}}`, whitelisted
  to a fixed locale set (today just `{ja}` -- see `SUPPORTED_LOCALES` in
  `admin.cjs`); an unknown locale key or an unknown field inside a
  locale's entry is rejected with a `400` and the error names the exact
  bad key. The write MERGES one level deep into the entry's existing
  `i18n` map (a JA-only edit never clobbers a sibling field some other
  edit already set) rather than replacing the whole map. `name_ja`/
  `flavor_ja` remain accepted top-level keys too (back-compat -- the
  actual on-disk content/live/*.json files no longer carry them after the
  REQ-0038 migration, but an old caller sending the flat shape still
  works and still round-trips through `/api/content`'s computed
  back-compat fields, see below).
- **Closed-vocabulary validation** (against `content/vocab.json`, always
  server-side): `rarity` ∈ `vocab.rarities`; every tag ∈ `vocab.po_tags`
  keys, and `tags[0]` specifically must be a ROOT tag (a `po_tags` key
  whose value is `null`); every effect's `trigger.t` ∈ `vocab.triggers` and
  `verb.t` ∈ `vocab.verbs`; any `status` field ∈ `vocab.statuses`; every
  socket's `t`/`tags` ∈ `vocab.socket_tags` keys.
- **Range validation**: any `[lo,hi]` pair (`trigger.s` for `every_secs`,
  `verb.n` for any ranged verb) must have both values finite, `> 0`, and
  `lo <= hi` — anything else is rejected.
- **Effect re-render gate**: after merging the edit (in-memory, never
  applied to disk yet), every effect is re-rendered via
  `tools/eff_render.cjs`'s `render()` for both `en` and `ja`. If rendering
  throws for any effect, the ENTIRE write is rejected (`400`) and nothing
  is persisted — this mirrors the render step `/api/content` already
  performs on every read, just moved to write-time as a pre-commit gate.
- **Write**: atomic (tmp file in the same directory + `fs.renameSync`,
  same pattern as `storage.cjs`'s `writeProfile`; the tmp file's mode is
  set to match the original file's mode before the rename, so file
  permissions survive the replace). `fs.renameSync` updates the
  destination's mtime, so `/api/content`'s existing mtime-checked cache
  (see `getContent()` in `api.cjs`) naturally serves the updated content on
  the very next request — no server restart needed.
- **No other file is ever touched, and this endpoint never invokes git.**

**Content-edit review policy**: `PUT /api/admin/item/:id` writes directly
to `content/live/*.json` on disk but performs NO git operation of any
kind — it does not stage, commit, or push. Content edits made through this
endpoint (whether from the Dex admin UI or a direct API call) are reviewed
and committed to git at batch cadence by a human or orchestrator, exactly
like every other content edit in this repo's existing workflow (see
`content/batches/`'s batch-review convention). Do not wire up auto-commit
here without a deliberate, separately-reviewed decision to do so.

## Content i18n (REQ-0038)

`content/live/live_items.json` / `live_sis.json` entries carry base
`name`/`flavor` fields (always English) plus a formal `i18n` map keyed by
locale, e.g. `i18n: {ja: {name, flavor}}`. The legacy flat `name_ja`/
`flavor_ja` fields were migrated into this shape by `tools/
migrate_i18n.cjs` (idempotent, verifies every migrated value is
byte-identical to the field it replaced) and no longer exist on disk.

`/api/content`'s `buildContentPayload()` serves BOTH shapes: the new
`i18n` map as-is, plus COMPUTED back-compat top-level `name_ja`/
`flavor_ja` fields mirrored from `i18n.ja` (see `withBackCompatI18n()` in
`api.cjs`). This was a deliberate choice over serving only the new shape
-- it means `mock-src/ui.js`, `client/src/api.ts`'s existing consumers,
and `tools/tool_gen_data.cjs`'s baked `mock-src/data.js` output all keep
working completely unchanged; only the Dex v2 admin UI reads `i18n`
directly. `tools/eff_render.cjs` never reads name/flavor fields at all
(effect-AST rendering only) and needed no change.

## systemd (user unit, Node v24 via nvm)
`~/.config/systemd/user/backpack-api.service`:
```
ExecStart=/home/qtie/.nvm/versions/node/v24.18.0/bin/node %h/backpack_ragnarok/server/api.cjs
Restart=on-failure
WantedBy=default.target
```
Enable/start: `systemctl --user enable --now backpack-api.service`.
Check: `systemctl --user is-active backpack-api.service` and
`curl 127.0.0.1:8802/api/health`. **Restart after any server/*.cjs
change** (`systemctl --user restart backpack-api.service`) — the unit
does not hot-reload.

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

### T0.2 (REQ-0027) -- edit interactions + Save/Load
Landed on top of T0.1's read-only board: drag/drop (PO, assembly, BP,
Socket Item), double-click rotate, Esc-cancel, and a Header Save/Load pair
wired to `saveCanvas`/`fetchCanvas` (client/src/api.ts). Save PUTs the bare
live `GameState` (no wrapper) to `PUT /api/profile/default/canvas`, same
body shape `mock-src/ui.js`'s save handler sends and same shape
`mock-src/data.js`'s `makeState()` produces (`{linked,bps,pos,sis}`).
(REQ-0031 Phase B later retired the Save/Load buttons in favor of auto-
save; REQ-0037 later replaced the hardcoded `'default'` profile id with
the authenticated player's own id -- see "Auth" above.)

## Ingress change log
- 2026-07-03 (REQ-0024): applied via Cloudflare Tunnel Configuration API
  (PUT accounts/<acct>/cfd_tunnel/<tunnel_id>/configurations), config
  version 1 -> 2. Verified after apply: `curl https://backpack-dev.qtie.jp/api/health`
  -> `{"ok":true,"version":"0.1.0"}`; `/mock/` still 200.

## E2E test suite (REQ-0031 Phase A)

Server-side headless-Chromium Playwright rig living in `client/e2e/`
(config: `client/playwright.config.ts`). Exercises the REAL deployed
`/app/` bundle against the REAL API service, through the SAME
Cloudflare tunnel hostname a real browser would use --
`baseURL: 'https://backpack-dev.qtie.jp'`, NOT `http://127.0.0.1:8801`.
This is deliberate: 8801 (backpack-web.service, static files) has NO
local proxy to 8802 (backpack-api.service) -- only the tunnel's ingress
rule splits `/api/*` to :8802 (see "Cloudflare tunnel ingress" above).
A baseURL of `127.0.0.1:8801` would make every `/api/*` fetch the client
performs 404, so every test must run against the tunnel hostname.

### Running

```
cd client
npm install                 # first time only (installs @playwright/test + playwright)
npx playwright install chromium   # first time only, downloads a browser
npm run e2e                 # runs the whole suite (playwright test)
npx playwright test e2e/bp-transfer.spec.ts   # run one file
```

### Prereqs / fallback

Chromium must be installed via `npx playwright install chromium`
(downloads to `~/.cache/ms-playwright/`). If chromium fails to launch due
to missing shared libraries on a fresh box, run
`npx playwright install-deps --dry-run` to print the exact `apt-get`
command needed WITHOUT running it (this box has no sudo access for the
agent account) -- hand that command to someone who can run it with sudo,
then retry. On THIS box chromium was already installed and launched
successfully with no missing-library issues, so this fallback path has
not been needed here to date.

### Profile / player safety (backup/restore)

Several tests PUT canvas state to the live API as test-fixture setup.
`client/e2e/global-setup.ts` backs up `data/profiles/default.json` (or
records its absence) AND `content/live/live_items.json`/`live_sis.json`
to timestamped files under `/tmp` BEFORE any test runs;
`client/e2e/global-teardown.ts` restores each byte-for-byte AFTER the
whole run, even if tests fail (Playwright guarantees globalTeardown runs
once globalSetup has completed) -- restoration is verified via a sha256
comparison, and teardown itself throws if the hashes don't match, so a
broken restore is never silent. REQ-0037 extends this: `guest-
auth.spec.ts` mints brand-new guest players via the real `server/
cli_invite.cjs` CLI, registers each created file (both the `data/
players/<id>.json` registry entry and the `data/profiles/<id>.json`
profile file, if one gets created) into a shared tracked-files ledger
(`GUEST_AUTH_TRACKED_FILES_PATH`, reset at the start of every run by
global-setup.ts), and global-teardown.ts deletes every file in that
ledger at the end of the run -- verified the same way (sha256 of the
now-deleted file must equal the "missing" sentinel), since these files
never existed before the test run and therefore always follow the
"delete, don't restore" path (mirroring the existing absent-marker
convention for `data/profiles/default.json` when it doesn't exist yet).

### Test files

- `smoke.spec.ts` -- `GET /api/health`, app boot + live data-source badge.
- `tab-switch-stability.spec.ts` -- REQ-0031 bug 2 regression test (15
  tab clicks, asserts no hang and no refetch storm).
- `bp-transfer.spec.ts` (+ `fixtures/bp-transfer-fixture.json`) --
  REQ-0031 bug 1 regression tests (empty BP transfer, BP-with-contents
  transfer, round trip, illegal-overlap rejection).
- `baseline-smoke.spec.ts` (+ `fixtures/baseline-smoke-fixture.json`) --
  live data-source indicator, free-PO drag both directions, double-click
  rotate.
- `dex.spec.ts` / `dex-admin.spec.ts` -- REQ-0035 Dex display + admin
  edit-mode coverage (role-gated toggle, form edit + persistence,
  restore-via-second-edit).
- `nav-routing.spec.ts` -- REQ-0034 hash routing + the WebGL-churn
  regression guard (5 round trips away from `#/backpacks` and back).
- `grid-8x8.spec.ts`, `preset-switch.spec.ts`, `long-press-rename.spec.ts`,
  `auto-save.spec.ts` -- REQ-0031 Phase B coverage (8x8 grid, presets,
  tab/preset rename, debounced auto-save).
- `guest-auth.spec.ts` (REQ-0037) -- mints two guest players via the real
  `cli_invite.cjs` CLI; covers the `#/invite/<token>` flow (token stored,
  `/api/me` resolves, redirect + welcome banner), per-player board
  isolation (a drag/auto-save on player A's board never appears on player
  B's, and cross-player profile reads 403), logout (clears the token,
  reload returns to the dev-mode/default state), and the Settings page's
  account block + REQ-0039 bot-mode placeholder block.
