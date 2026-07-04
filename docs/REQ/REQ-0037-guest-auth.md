# REQ-0037 -- Simple Guest Auth via Invite Tokens

Status: spec, written before implementation (same convention as
REQ-0034/REQ-0035).

## Goal

Replace the dev-grade "`X-Player-Id` header trusted at face value" auth
(REQ-0035) with a minimal but real token model: a server-side player
registry, unguessable per-player tokens, an invite-link flow so a human
operator can hand a guest a URL that logs them in, and per-player canvas
profiles (replacing `storage.cjs`'s fixed `["default"]` allowlist).
Explicitly NOT in scope: passwords, OAuth, real sessions/cookies, API
keys/scopes for bots (that is REQ-0039, and only its "Now" placeholder
lands here -- see that doc).

## Server: player registry (`data/players/<playerId>.json`)

New persistence root, same conventions as `storage.cjs`/`data/profiles/`:
gitignored (`data/` is already covered by `.gitignore`), atomic writes
(tmp file in the same directory + `fs.renameSync`). Each file:
```
{ playerId, name, roles, token, createdAt }
```
- `playerId`: server-generated, stable, used as the profile-id and as the
  filename stem.
- `token`: server-generated, long and unguessable (`crypto.randomBytes(24)
  .toString('hex')` or equivalent -- NOT sequential/guessable). Never
  regenerated once created (an invite link is a one-time mint, not a
  rotating credential, per this REQ's scope).
- `roles`: array of role strings, same vocabulary as REQ-0035's
  `item_admin` (e.g. `[]` or `['item_admin']`).
- `createdAt`: ISO timestamp.

Persistence for this registry either extends `storage.cjs` or lives in a
clean sibling module (`server/players.cjs`) -- either is acceptable, but
persistence code must stay confined to one place (no ad-hoc `fs` calls
scattered through `api.cjs`/`admin.cjs`), matching the existing
"`storage.cjs` is THE repository module" convention.

Lookup is by token (the hot path, every authenticated request needs it)
and by playerId (used by the profile-route guard and the CLI). A registry
small enough to load-on-demand (read the whole `data/players/` directory)
is acceptable at this scale -- no index file needed.

## Server: CLI invite tool (`server/cli_invite.cjs`)

Usage: `node server/cli_invite.cjs <name> [--roles r1,r2]`.

- Creates a new player record (fresh `playerId`, fresh token) via the
  registry module above.
- `--roles` omitted -> `roles: []` (a guest with no special permissions;
  the safe default -- an operator must explicitly grant `item_admin` etc.
  via `--roles`).
- Prints an invite URL to stdout: `https://backpack-dev.qtie.jp/app/#/invite/<token>`.
- This is an operator tool (run by hand over SSH), not exposed via HTTP --
  there is no self-service signup in this REQ's scope.

## Server: dev player (boot-time, replaces REQ-0035's `dev_user.json` as a bare identity file)

At server boot, `data/config/dev_user.json` (REQ-0035's existing shape:
`{playerId, name, roles}`) is still the SOURCE for the dev player's
identity, but it now also gets a token, and a matching entry under
`data/players/`:
- If `data/config/dev_user.json` is missing, it is created with the
  existing default (`{"playerId":"dev","name":"Developer","roles":
  ["item_admin"]}`), exactly as REQ-0035 already does.
- If `data/players/dev.json` does not yet exist, it is created from
  `dev_user.json`'s contents plus a freshly generated token and
  `createdAt`, then persisted via the same atomic-write path as any other
  player.
- If `data/players/dev.json` already exists, its token is reused
  unchanged (never regenerated on restart) -- so the dev player's token
  stays stable across server restarts, and repeated boots are idempotent.
- The dev token is printed to the server's own stdout/journal exactly
  once -- the first time it is generated (a fresh `data/players/dev.json`
  is created). On every subsequent boot where the file already exists,
  nothing is printed (idempotent boot, no log spam, and no repeated
  disclosure of a long-lived credential in the log). It is NEVER included
  in any HTTP response body, ever (not `/api/me`, not any error message).

## Server: auth resolution (`GET /api/me` and every authenticated route)

Requests carry `X-Auth-Token: <token>`. A single resolution function
(used by `/api/me`, the profile routes, and the admin guard) maps the
header to a player record:

1. Header present, matches a known token -> resolved player.
2. Header present, does not match any known token -> `401`.
3. Header absent entirely:
   - `dev_mode: true` -> falls back to the dev player (so `/mock/` and any
     other unauthenticated dev flow keeps working with no token at all).
   - `dev_mode: false` -> `401`.

`dev_mode` lives as a boolean field on `data/config/dev_user.json` itself
(simplest option consistent with the existing config-file convention --
no new file needed): `{"playerId":"dev","name":"Developer",
"roles":["item_admin"],"dev_mode":true}`. Default (when the file is freshly
created at boot) is `true`. This flag is meant to be flipped to `false`
by hand (edit the file, restart the API service) once real guest tokens
are the only intended entry path -- documented as a manual operator
action, not exposed via any endpoint.

`GET /api/me` -> `200 {playerId, name, roles}` (same shape as REQ-0035,
`ApiMe` in `client/src/api.ts` unchanged) for the resolved player, under
all cases above except the `401` cases, which return
`{ok:false, error:...}` with status 401.

## Server: per-player profiles (`GET`/`PUT /api/profile/:playerId/canvas`)

`storage.cjs`'s fixed `PROFILE_ALLOWLIST = ['default']` becomes "any
playerId with a registry entry" -- but the URL's `:playerId` is NEVER
trusted as the auth mechanism. The route handler:
1. Resolves the ACTUAL player from the `X-Auth-Token` header (same
   resolution as `/api/me`, including the `dev_mode` fallback).
2. Compares the resolved player's own `playerId` to the URL's
   `:playerId`. Mismatch -> `403` (a valid token authenticated as someone,
   just not the profile owner). No token + `dev_mode:false` -> `401`
   (never got as far as resolving a player at all). No token + `dev_mode:
   true` -> resolves to the dev player, whose OWN playerId is the only one
   that will match the URL without a 403.
3. Only on a match does `storage.cjs` read/write `data/profiles/
   <playerId>.json`.

**Migration**: `data/profiles/default.json` (the pre-REQ-0037 fixed
profile) becomes the dev player's own profile. On first boot with this
code: if the dev player's own profile file (`data/profiles/<dev's real
playerId>.json`) does not exist yet AND `data/profiles/default.json`
does, the dev player's first read falls back to reading `default.json`'s
contents (fallback-read, not a rename -- `default.json` is left in place
untouched) so existing saved boards are not lost. The dev player's
playerId is `dev` (unchanged from REQ-0035's `dev_user.json`), so in
practice the dev player's profile path and the legacy `default.json` path
can be the SAME file if the dev playerId is kept as literally `"dev"` and
the alias below is used -- see the alias note next.

**Compat alias**: `GET`/`PUT /api/profile/default/canvas` keeps working
as an alias for the dev player's profile, but ONLY when `dev_mode` is
`true` (when `dev_mode` is `false`, `default` is just an unknown playerId
like any other, and 403/401s the same as every other id would). This
preserves old E2E specs and any hardcoded `'default'` call sites without
requiring them to be rewritten as part of this REQ -- new code should
prefer resolving the dev player's actual id rather than depending on the
alias, but the alias is not a temporary hack to be removed; it is an
intentional compatibility surface for as long as `dev_mode` stays `true`.

## Server: admin guard (`PUT /api/admin/item/:id`)

Replaces REQ-0035's `X-Player-Id`-trusted-at-face-value check. The guard
now: resolve the token via the exact same auth resolution as `/api/me`
(including the `dev_mode` fallback), then check the resolved player's
`roles` includes `item_admin`. No token (with `dev_mode:false`), invalid
token, or a resolved player lacking the role -> `403` (matches the
existing status code convention for this endpoint -- unauthenticated
requests get the same 403 a wrongly-authenticated one gets, no
information leak distinguishing "no token" from "bad role"). Note: unlike
the profile route (which 401s on a totally invalid/absent token before
even considering ids), this endpoint keeps REQ-0035's original `403` for
every failure mode of this guard specifically, since that is the
established contract E2E/tests already depend on -- only the mechanism
underneath changes, not the status code.

## Client

**Invite route (`#/invite/<token>`)**: extends `store.ts`'s hash-routing.
Landing on this hash:
1. Stores the token in `localStorage`.
2. Calls `/api/me` (now sending the token) to resolve the player.
3. Redirects to `#/backpacks`.
4. Shows a brief welcome banner/toast with the resolved player's name
   (dismissable, auto-hides after a few seconds; no toast library --
   plain CSS + a module-store field, consistent with this app's existing
   "no dependency, inline state" style).

**`api.ts`**: every fetch call attaches `X-Auth-Token` from `localStorage`
when a token is present (a small `authHeaders()` helper). `putAdminItem`
no longer takes/sends a `playerId`/`X-Player-Id` -- the token alone
carries identity now; the server resolves the acting player from the
token, exactly like every other authenticated route.

**Profile id resolution**: `store.ts`'s `boot()` (and the auto-save path)
resolve the profile id from the AUTHENTICATED player (`/api/me`'s
`playerId`) rather than the hardcoded string `'default'`, so different
logged-in guests get isolated boards. With no token and `dev_mode:true`,
this still resolves to the dev player (via `/api/me`'s own fallback
behavior -- the client does not need to special-case "no token" beyond
"use whatever `/api/me` says", since the server already encodes the
dev-mode fallback rule).

**Settings page** (`#/settings`, currently a bare `PlaceholderPage`):
replaced with a dedicated `Settings.tsx`:
1. Account block -- name, playerId, roles (from `/api/me`), and a
   Logout action that clears the stored token from `localStorage` and
   reloads the page (falling back to dev-mode/unauthenticated state, or a
   401'd empty state if `dev_mode` is ever `false`).
2. REQ-0039 "Now" placeholder block -- see that doc; this is the entirety
   of REQ-0039's scope landing here.

**Dex edit toggle** (`DexRoot.tsx`): already keys off `/api/me`'s `roles`;
requires no code change once `/api/me` is token-resolved, since the
client-side contract (`ApiMe` shape, `fetchMe()` call) is unchanged --
only the identity the server resolves changes. Verified by testing, not
just by reading the code, since this is exactly the kind of assumption
worth confirming empirically.

## Deferred (explicitly out of scope here)

- Passwords, OAuth, real sessions/cookies -- token-in-localStorage is the
  entire "session" model for this REQ.
- Token rotation/expiry/revocation -- a minted token is good forever
  until an operator manually edits/removes the player's registry file.
- Self-service signup -- invites are operator-minted via the CLI only.
- REQ-0039's actual API/bot scope (keys, scopes) -- only its Settings
  placeholder block lands as part of this REQ's client work.
