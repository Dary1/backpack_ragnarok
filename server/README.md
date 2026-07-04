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
- `schedule.cjs` (REQ-0036 P1-B) — the Dungeon Schedule SERVICE (rooms,
  runs, warehouse). Business logic module; `api.cjs` wires HTTP routes to
  it, `storage.cjs` persists its 3 new roots (rooms/runs/warehouse
  items). Solo-scope (P1): a room's 4 unit slots are always filled from
  the ROOM OWNER'S OWN presets (multi-player joins are P2). See "Dungeon
  Schedule API" below for the full endpoint table + design notes.
- `tests/api_test.cjs` — storage/registry round-trip, content endpoint
  shape, profile PUT/GET round-trip (per-player + the `default` alias),
  oversized-body rejection, `/api/me` token resolution (valid/invalid/
  dev_mode fallback/dev_mode off), profile-ownership 401/403 matrix,
  admin-write validation (vocab/range/schema-allowlist rejections),
  admin-guard 403 matrix (missing/invalid token, valid token lacking the
  role, dev-mode fallback), a dedicated real-repo test that edits the
  actual `content/live/live_items.json`, verifies the change, then
  restores the original bytes and checks a sha256 match (try/finally —
  restoration runs even if an assertion above it fails), and (REQ-0036
  P1-B) the Dungeon Schedule test group (room CRUD + deploy gate, run
  execution/determinism, warehouse cap/TTL/claim, cooldown/wipe/swap/
  cancel policies, auth isolation). Run with `node server/tests/
  api_test.cjs` (files mode) or `STORAGE_BACKEND=pg DATABASE_URL=...
  node server/tests/api_test.cjs` (pg mode) — both must pass.

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
- Dungeon Schedule + Warehouse endpoints (REQ-0036 P1-B) → see "Dungeon
  Schedule API" below for the full table.

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

## Dungeon Schedule API (REQ-0036 P1-B)

Server-authoritative "schedule a dungeon run" service: rooms (solo scope
— every slot is filled from the room OWNER'S OWN presets; multi-player
joins are a P2 concern), runs (executed instantly via `sim/combat.cjs`'s
`runDungeon`, replayed at 1× wall time — see "Run-clock design" below),
and a per-player warehouse (200-item cap, 7-day TTL). Implements golden
a-q of `docs/REQ/REQ-0036-dungeon-schedule.md`; golden r (warehouse-
scoped trade between players of the same schedule) is explicitly P3 and
NOT built here.

**Auth**: every route below uses the exact same `X-Auth-Token` /
`resolveAuth()` mechanism as the profile routes (see "Auth" above),
including the `dev_mode` no-token fallback. A room/warehouse id in the
URL is NEVER trusted as identity — the caller's playerId is always
resolved from the token first, and a room owned by a different player
404s (not 403s) to avoid leaking room existence to a non-owner. Bodies
are pure JSON, auth is header-only — no cookies, no CSRF token, no
session state (REQ-0039 Bot API design-first-class requirement).

| method | path | body | notes |
|---|---|---|---|
| POST | `/api/schedule/rooms` | `{dungeonId, level?, formationId?, cancelPolicy?:{immediate}}` | Creates a room owned by the caller. `visibility` is always `"self"` in P1-B. Returns `{ok, room}`. |
| GET | `/api/schedule/rooms` | — | Lists the CALLER's own rooms only. Returns `{ok, rooms:[...]}`. |
| GET | `/api/schedule/rooms/:id` | — | Settles a due run first (see run-clock), then returns `{ok, room}`. 404 if not found or not owned by the caller. |
| DELETE | `/api/schedule/rooms/:id` | — | Cancel (golden g). Immediate if `cancelPolicy.immediate` or no run is active; else flags `cancelRequested` (honored once the in-flight run settles). Returns `{ok, room}`. |
| PUT | `/api/schedule/rooms/:id/slots/:slotIndex` | `{presetIndex}` | Assigns one of the CALLER'S OWN presets (0-based) to a unit slot (golden b). Enforces the deploy gate (golden d) — `409` on an independence violation or a cross-room active-unit overlap. |
| PUT | `/api/schedule/rooms/:id/swap` | `{slot, presetIndex}` | Queues (or, if no run is active, immediately applies) a unit swap (golden j). Returns `{ok, room, applied:boolean}`. |
| GET | `/api/schedule/rooms/:id/run` | — | The room's last/current run, run-clock-paced (see below): `events` only includes entries whose `t` has "arrived" in wall-clock time. Also returns the full (always-final) `result`/`rewards`/`cooldownSecs` summary plus a `settled` flag and `clock:{elapsedSecs,isSettled,pct}`. |
| GET | `/api/warehouse` | — | Lists the caller's own warehouse items (expired rows purged first). |
| POST | `/api/warehouse/claim` | `{itemUid}` | Moves one warehouse item into the caller's OWN inventory via first-fit engine placement (golden f). `409` if no inventory page has space (item stays in the warehouse, untouched). There is no reverse (inventory→warehouse) path anywhere in this API. |

**Status codes**: `400` bad/missing body fields, `401` missing/invalid
token, `404` room/run/warehouse-item not found (including "not yours"),
`409` deploy-gate violation or no-inventory-space-to-claim, `413`
oversized body, `500` unexpected error. Every error body is `{ok:false,
error:"<message>"}`.

### Run-clock design (instant-sim + timed playback)

The ENTIRE run is simulated INSTANTLY the moment it starts —
`sim/combat.cjs`'s `runDungeon` is an event-driven continuous-time sim,
not a realtime loop, so there is no `setTimeout` chain, no sleeping
thread, no background timer held open for a run's duration. Every event
in the resulting log already carries its own `t` (seconds since run
start). Two wall-clock fields are added once, at persistence time:
`startedAt` (captured the instant the run is created) and `durationSecs`
(the last event's `t`). A "run clock" is then a pure, stateless
computation any caller can perform independently:

```
elapsedSecs = (Date.now() - Date.parse(run.startedAt)) / 1000
isSettled   = elapsedSecs >= run.durationSecs
```

`GET /api/schedule/rooms/:id/run` filters the (already fully computed)
event array down to `ev.t <= elapsedSecs` — a client monitor polling this
endpoint sees events "arrive" at the same pace a live-ticking sim would
produce them, without the server ever having blocked on the run's actual
duration. This is deliberately "the sim runs instantly, the *reveal* is
paced to real time," not "the sim runs in real time," for two reasons:

1. **Offline-first friendly** — a room's outcome exists complete and
   durable the instant the run starts. A client that goes offline
   mid-"broadcast" and reconnects later just resumes reading from
   wherever `elapsedSecs` now points; there is no lost state and no
   reconnect protocol to design.
2. **Cheap** — the server holds no per-run timer, interval, or worker
   thread for the run's duration, no matter how many rooms are "in
   flight" from a spectating point of view. A run's actual EFFECTS
   (rewards landing in the warehouse, cooldown starting, the level
   changing on a wipe, a queued swap applying, the next run
   auto-scheduling) are computed and applied exactly once, lazily, the
   first time ANY request touches that room after `isSettled` becomes
   true (`settleRoomIfDue()` in `schedule.cjs`, called at the top of
   every room route handler). This makes "scheduled auto-runs" (golden i)
   a real, observable design fact without any standing scheduler
   process — it is a purely lazy, poll-driven mechanism.

### Warehouse semantics (golden e/f)

- Cap: 200 items per player. Enforced at insert time (`addToWarehouse`);
  a reward that arrives to an already-full warehouse is silently
  dropped (documented interpretation — the REQ specifies the cap but not
  reward-arrival overflow behavior; blocking run settlement on warehouse
  space seemed strictly worse).
- TTL: 7 days from `harvestedAt`. Purged lazily on every warehouse read
  (list/claim/insert all purge first) AND via an hourly
  `setInterval` sweep in `api.cjs` (`sweepAllWarehouses`, `.unref()`'d so
  it never keeps the process alive on its own) that walks every
  registered player — belt-and-suspenders for a player who never polls
  their own warehouse.
- Claim (`POST /api/warehouse/claim`) is FIRST-FIT only: it scans the
  caller's 5 inventory pages in order and places the claimed item at the
  first legal `[row,col]` cell found (via `mock-src/engine.js`'s
  exported `invCanPlacePO`/`invMovePO` — `engine.js`'s own internal
  `firstFitCell` isn't exported, so this is a documented push-scan-
  rollback re-implementation using only the exported API). No space
  anywhere → `409`, warehouse item untouched.
- There is NO inventory→warehouse path anywhere in this service (golden
  r's reverse-direction ban, generalized here ahead of P3 trade — trade
  itself is not built).

### Reward-roll-id resolution

`content/batches/batch-002-dungeon-pilot/dungeon.json` references
abstract reward-roll ids (`reward_frost_shard_common` etc.) rather than
real `content/live/live_items.json` ids, since that batch's own items
haven't been through the S5 (icon art) / S7 (user review) pipeline
stages yet. `schedule.cjs`'s `REWARD_ROLL_TO_ITEM_ID` table maps each
roll id to a real, already-live item id so warehouse claim → inventory
placement has a genuine placeable item to work with today; any id absent
from the table falls back to identity (used as-is), so the table becomes
a no-op the day real batch-002 content replaces the placeholders.

### P1-C addendum: client + two new routes

REQ-0036 P1-C built the CLIENT half of the Dungeon Schedule feature
(`client/src/schedule/*` -- Schedule page, slots UI, run monitor with a
persistent PixiJS scene, Warehouse tab) and added exactly two new server
routes to support it, both documented here:

**`GET /api/schedule/dungeons`** -- the rooms API never exposed a
dungeon/formation LIST (P1-B only ever consumed a caller-supplied
`dungeonId`/`formationId` at room-create time); the client's create-room
form needs somewhere to fetch the pilot batch's one dungeon def + 4
formation defs from. Reuses `getScheduleContent()`'s existing mtime-cache
(now also loading `formations.json`) -- no second content-cache path.
**No auth required** -- this is public read data, matching `/api/content`'s
own no-auth convention. Special-cased in `api.cjs`'s `handle()` BEFORE the
schedule auth gate (`scheduleMatch`/`resolveAuth()`), for the same reason
`/api/content` and `/api/health` never go through `resolveAuth` either --
it needs no caller identity at all. Response shape:
```js
{ ok: true, dungeons: [{id, name, i18n}], formations: [{id, name, i18n, canvases}] }
```

**`POST /api/schedule/rooms/:id/dev/backdate`** -- a dev-only E2E
time-control seam, added because the real `niflheim_depths` dungeon's
measured `durationSecs` (see "E2E time-control" below) is NOT reliably
short: with a unit that cannot act during `detection`/`unlock`-mode
encounters, a run's last event lands at `t=999` (the trap encounter's
`every_secs:[999,999]` skill cadence never fires, so the encounter simply
times out at that value) -- a real E2E run could otherwise need to
poll-wait through a run that "completes" its simulation instantly but
whose run-clock replay window is 999 real seconds long. This route
rewrites the room's current/last run's OWN `startedAt` timestamp further
into the past (default 5s of margin past `durationSecs`) so
`runClock(run).isSettled` reads `true` on the very next read -- it is the
exact same trick `server/tests/api_test.cjs`'s own internal
`forceRunElapsed()` helper has used since P1-B, now exposed as a real
HTTP route so Playwright specs (which only have HTTP access) can do the
same thing. **This is a test-control seam, not a gameplay feature**:
- It NEVER touches the run's `seed` -- `schedule.cjs`'s
  `devBackdateActiveRun()` only rewrites `startedAt`; reward RNG
  (`distributeRewardsUniform`, the run's own event log) is completely
  unaffected, so a test cannot use this route to bias its own rewards.
- **Gating** (enforced in `api.cjs`, not `schedule.cjs`): only reachable
  when the request resolved via the `dev_mode` NO-TOKEN fallback --
  `callerIsDevFallback = !token && devUser.dev_mode===true && callerId===devUser.playerId`,
  the same shape as the profile route's existing `isDefaultAlias` check.
  A real guest token -- even the room owner's own valid token -- gets
  `403`, never `200`. Ownership is ALSO still enforced normally
  (`getOwnRoomOr404`): the dev fallback player can only backdate ITS OWN
  rooms, never another player's.
- Body: `{extraSecsIntoPast?: number}` (default 5). Response:
  `{ok, runId, startedAt, durationSecs}`.

Covered by 3 new server tests (`server/tests/api_test.cjs`, both
files/pg mode): the no-auth dungeons list, the 403-for-real-token +
404-for-not-your-room + happy-path-for-dev-fallback backdate gating, and
a 400 on a room with no run yet.

### E2E time-control decision (REQ-0036 P1-C)

Measured empirically (`sim/combat.cjs`'s `runDungeon` invoked directly
against the real `content/batches/batch-002-dungeon-pilot/dungeon.json`
+ `formation1`, multiple seeds) before choosing an approach -- two
different unit configurations were probed, and they behave very
differently, which is the whole reason this needed measuring instead of
assuming:
- The actual `client/e2e/fixtures/schedule-fixture.json` used by
  `schedule.spec.ts` (plain `dagger` POs, no explicit `modes` field, so
  they default to `modes:['battle']` only -- the common case, since most
  content has no reason to act during `detection`/`unlock` mode
  encounters) hits `enc_trap_1`'s detection-mode timeout at `t=999`
  (that encounter's only skill has an `every_secs:[999,999]` cadence
  that never fires without a discovering hit). `durationSecs` for the
  WHOLE run is `max(event.t)` across every encounter, so this one
  stalled encounter alone makes the run's full-settlement replay window
  **999 real seconds**, regardless of how fast every other encounter
  cleared or whether the run result is victory or wipe. This was
  confirmed by direct re-measurement against the real fixture, not
  assumed.
- A separate, hand-built unit whose PO effects explicitly opt into
  `modes:['battle','detection','unlock']` (with a nonzero
  `bounce_budget`) clears every encounter for real and was measured at
  `durationSecs` of **21s** across 3 seeds (`node -e` probe script, not
  committed -- ad hoc measurement only, and NOT the configuration the
  E2E fixture actually uses).
- **Decision**: given the real fixture's 999s figure, waiting for real
  settlement anywhere in the suite is a non-starter. The implementation
  uses BOTH time-control strategies, split by what each test actually
  needs to observe:
  - The **"monitor: events & progress"** test never waits for
    settlement at all -- it only asserts that the event count and
    progress % *increase* within the first few real seconds of a
    freshly-started run (`enc_pack_1`, the first encounter, clears in
    ~1s of sim-time), which is fast regardless of the 999s figure since
    that stall only affects the LATER `enc_trap_1` encounter. This
    covers the real poll-and-diff client behavior (the actual ~2s
    polling cadence against `GET .../run`) end to end without needing
    the run to ever finish.
  - Every OTHER schedule E2E test that needs a *settled* room (run
    completes / rewards land in the warehouse / claim moves an item to
    inventory / cancel-after-active-run) uses the dev-only
    `POST .../dev/backdate` hook instead, running as the dev-mode
    fallback caller (empty-string token), to avoid ever waiting the full
    999s per test across the spec file. This hook rewrites the run's
    `startedAt` into the past by `durationSecs + extraSecsIntoPast`, so
    the very next `settleRoomIfDue()` call (triggered by any GET/DELETE
    on the room) settles it immediately -- exercising the identical
    `settleRoomIfDue()` / run-clock code path real elapsed time would,
    just without the wait.
  This matches the task brief's own steer ("make the empirically-informed
  choice, not a default assumption"): a pure content-only fix (author a
  deliberately-short test dungeon) was rejected as more invasive than a
  single dev-gated timestamp-rewrite route, and pure real-time polling
  everywhere was rejected outright once the actual fixture measured at
  999s, not the 21s figure from the unrelated hand-built probe unit.

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

## Postgres backend (REQ-0040)

`storage.cjs`'s profile persistence gained a second backend: a
self-hosted Supabase Postgres instance running under Docker on this same
box. Backend selection is an env var, `STORAGE_BACKEND` (`files` |
`pg`), read at call time by `storage.cjs`; the files backend (original
REQ-0024 behavior, `data/profiles/<id>.json`) remains the default and is
always available as a fallback. `players.cjs` (the token/role registry,
`data/players/<id>.json`) is intentionally OUT of scope for this REQ and
stays on the files backend in both modes -- it is small, low-frequency,
and its synchronous API is deeply embedded in `admin.cjs`'s auth-
resolution chain (`resolveAuth`, used on every request); moving it would
have meant threading async through every route handler for no real
benefit at this data volume.

**Self-hosted Supabase** lives at `~/supabase` on this box (a `git clone
--depth 1 https://github.com/supabase/supabase`, official `docker/`
compose tree, commit pulled 2026-07-04) -- OUTSIDE this repo entirely,
its own git remote, its own `.gitignore`-equivalent (`docker/.env` is
never committed anywhere). All 11 containers (`db`, `kong`/API gateway +
Studio, `auth`, `rest`, `realtime`, `storage`, `meta`, `imgproxy`,
`edge-functions`, `pooler`/Supavisor) run via `docker compose` with
`restart: unless-stopped`. Only Postgres (via the Supavisor pooler,
ports 5432 and 6543) and the Kong API gateway (which also fronts Studio,
port 54321/54443) are published, and ALL FOUR are bound to `127.0.0.1`
only (`docker compose ps` / `ss -tlnp` show no `0.0.0.0` binding from
this stack) -- nothing here is reachable off-box. Studio (the Supabase
admin UI) is therefore only reachable via an SSH tunnel:
```
ssh -i ~/.ssh/backpack_ed25519 -L 54321:127.0.0.1:54321 qtie@192.168.0.6
```
then browse `http://localhost:54321` locally (dashboard login is
`server/.env`'s sibling `~/supabase/docker/.env`'s `DASHBOARD_USERNAME`/
`DASHBOARD_PASSWORD`, gitignored/never committed, not reproduced here).

**Why port 54321/54443 instead of the compose default 8000/8443**: this
box already had an unrelated process bound to `0.0.0.0:8000`; rather than
fight over it, Kong's ports were moved to 54321 (HTTP) / 54443 (HTTPS) in
`~/supabase/docker/.env` (`KONG_HTTP_PORT`/`KONG_HTTPS_PORT`) -- a purely
local renumbering, no functional difference.

**Schema** (`server/migrations/001_init.sql`, idempotent): two tables,
`profiles(player_id text primary key, doc jsonb not null, updated_at
timestamptz)` and `players(player_id text primary key, doc jsonb not
null, created_at timestamptz)` (the `players` table exists for schema
completeness/future use per the original REQ but is not yet written to
by any code -- see the scope note above), plus a dedicated `backpack`
role granted ONLY `SELECT/INSERT/UPDATE/DELETE` on those two tables (no
DDL, no superuser, no access to Supabase's own auth/storage/realtime
schemas). Apply with the postgres superuser:
```
docker exec -i supabase-db psql -U postgres < server/migrations/001_init.sql
```
The `backpack` role's password is set out-of-band (never in a committed
file): `docker exec -i supabase-db psql -U postgres` then `ALTER ROLE
backpack WITH PASSWORD '...';`, and the matching `DATABASE_URL` written
into `server/.env` (gitignored; see `server/.env.example` for the
shape). Because Postgres here is fronted by Supavisor (the pooler --
both the 5432 and 6543 published ports route through it, there is no
bare direct-to-`db` port on the host), `DATABASE_URL`'s username must be
in `role.tenant_id` form (`backpack.backpack`, matching `~/supabase/
docker/.env`'s `POOLER_TENANT_ID=backpack`) or Supavisor rejects the
connection with `ENOIDENTIFIER`.

**Synchronous pg access** (`server/pg_sync.cjs` + `server/
pg_sync_worker.cjs`): `storage.cjs`'s public API
(`readProfile`/`writeProfile`) has always been fully synchronous --
it throws synchronously and returns its result directly, and the
existing 46-test suite calls it exactly that way in several places
(`assert.throws(() => storage.readProfile(...), ...)`,
`const doc = storage.writeProfile(...); assert.strictEqual(doc.schema_version, ...)`
with no `await`) -- so keeping that exact contract in pg mode, without
touching the test file, was a hard requirement. The `pg` driver itself is
async-only. The bridge: `pg_sync_worker.cjs` runs on a background
`worker_thread` and owns the real `pg.Pool`; `pg_sync.cjs`'s `querySync()`
posts a query to it and blocks the CALLING thread with `Atomics.wait()`
on a `SharedArrayBuffer` until the worker writes the result back. This is
a deliberate trade-off (one query at a time, blocks the event loop for
the call's duration) accepted because profile reads/writes are low-
frequency, small-payload (64KB cap) operations, not a high-throughput
hot path.

**Test isolation**: every profile key written to Postgres is prefixed
with a hash of the current process's repo-root path (`sha256(REPO_ROOT)
.slice(0,16)`, the same `os.homedir()`-derived path `DATA_DIR` has
always come from). The test suite remaps `os.homedir()` to a fresh temp
directory before each `require()` (pre-existing pattern, unchanged) --
so pg-mode test runs automatically land under their own throwaway
namespace and never collide with real data or each other, with zero
test-file changes. The real deployment's namespace is a pure function of
its real repo root, so it is stable across restarts.

**Migration + byte-equivalence** (`server/tool_migrate_to_pg.cjs` /
`server/tool_export_files.cjs`): the migration tool imports every
`data/profiles/*.json` into the `profiles` table (upsert, idempotent;
skips the legacy pre-REQ-0037 `default.json` itself, which is not a
real player id -- `dev.json`, if present, migrates normally). The export
tool reverses this (pg -> a plain JSON files tree) for backup parity and
for verifying the migration didn't lose data. IMPORTANT CAVEAT: Postgres's
`jsonb` column type is a decomposed BINARY format, not text-preserving --
it always returns object keys in its own canonical (alphabetical) order,
so a re-exported file is NOT byte-identical at the raw-text level to the
pre-migration original (this is standard, documented Postgres behavior,
not a bug here). Verify with a parsed deep-equality check instead:
```
node -e "
const fs = require('fs');
const a = JSON.parse(fs.readFileSync('<exported>/profiles/dev.json','utf8'));
const b = JSON.parse(fs.readFileSync('data/profiles/dev.json','utf8'));
require('assert').deepStrictEqual(a, b);
console.log('semantically identical');
"
```
This was run against the real `dev` profile during the REQ-0040 rollout
and passed (`deepStrictEqual` clean).

**Flipping the live service to pg mode**: set `STORAGE_BACKEND=pg` and
the real `DATABASE_URL` in `server/.env` (loaded via the systemd user
unit's `EnvironmentFile=`, see below), then `systemctl --user restart
backpack-api.service`. Verify `curl 127.0.0.1:8802/api/health`, `/api/me`,
and a profile GET/PUT round trip.

**Rollback**: edit `server/.env`, set `STORAGE_BACKEND=files`, then
`systemctl --user restart backpack-api.service`. The files backend reads
whatever is currently in `data/profiles/*.json` on disk (untouched by pg
mode, since pg mode never writes there) -- no data migration needed to
roll back, only a restart. Confirmed working during the REQ-0040
rollout (round-tripped `/api/profile/default/canvas` correctly
immediately after the rollback restart).

**Server tests, both backends**: `node server/tests/api_test.cjs` (files
mode, default) and `STORAGE_BACKEND=pg DATABASE_URL=... node
server/tests/api_test.cjs` (pg mode) both currently pass 46/46 -- run
both after any `storage.cjs` change. `server/package.json` has `npm
test`/`npm run test:pg` shortcuts (pg mode still needs `DATABASE_URL` set
in the environment first).

## systemd (user unit, Node v24 via nvm)
`~/.config/systemd/user/backpack-api.service`:
```
[Service]
EnvironmentFile=%h/backpack_ragnarok/server/.env
ExecStart=/home/qtie/.nvm/versions/node/v24.18.0/bin/node %h/backpack_ragnarok/server/api.cjs
Restart=on-failure
WantedBy=default.target
```
`EnvironmentFile=` (REQ-0040) loads `server/.env` (gitignored --
`STORAGE_BACKEND`, `DATABASE_URL`; see "Postgres backend" above) as real
process env vars for the service -- `api.cjs` itself has no dotenv
dependency and never reads a `.env` file directly. Enable/start:
`systemctl --user enable --now backpack-api.service`. Check:
`systemctl --user is-active backpack-api.service` and
`curl 127.0.0.1:8802/api/health`. **Restart after any server/*.cjs
change, or after editing server/.env** (`systemctl --user restart
backpack-api.service`) — the unit does not hot-reload.

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
