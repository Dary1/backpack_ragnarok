# REQ-0329 — Bot player pool (~50) minted as human-equivalent, default starter canvas

- **State**: reserved. Program: Reactive Test-Play Fleet (owner spec item 2).
- **Depends on**: REQ-0324 (troops to join into). **Blocks**: REQ-0330.
- **Supersedes**: the identity portion of the obsolete REQ-0318/0319.

## Truth (owner, 2026-07-28)
> 2. ...join the FIRST squad from a bot player pool. Prepare ~50 players. These bot
>    players' first-squad canvas may equal the player's initial placement.

## Current state (surveyed)
- Accounts are minted by `server/cli_invite.cjs` -> `players.createPlayer(name,
  roles)`; `--roles` omitted => `roles:[]` (safe, non-admin). Returns a token.
- The default/initial player canvas is `buildStarterUnitsState(gameData, locale)` in
  `shared/player_actions.mjs` (four starter units, moved verbatim from the client's
  boot seed by REQ-0310). This is exactly "the player's initial placement".

## What to build
- A provisioning tool `tools/fleet_pool_provision.cjs` (or `bot/provision.cjs`) that:
  - Mints ~50 guest players with ordinary names (`roles:[]`, NEVER item_admin), e.g.
    a small human-plausible name list — NOT `bot_01` (they must be indistinguishable
    from humans per item 2).
  - Seeds EACH account's profile canvas with `buildStarterUnitsState` (the default
    starter placement) and PUTs it, so slot 0 (the first squad) is immediately
    deployable — this is the squad the fleet will join with.
  - Writes each `{playerId, token, name}` to a vault OUTSIDE the repo,
    `~/backpack_fleet/agents/<id>/token` mode 0600 (never committed, never logged),
    matching PROJECT.md's confidential-handling rules.
- Idempotent / re-runnable: a second run tops the pool up to 50, never duplicates.
- A `--count` flag (default 50) and a `--dry-run`.

## Rulings
- These are REAL accounts in the LIVE data (owner authorised live). They are
  human-equivalent: no special role, no dev seam, standard `X-Auth-Token` auth.
- The pool count (~50) is a target, not a hard invariant; 50 is the default.

## Gates / acceptance
- Running the tool creates N accounts, each with a valid token and a starter canvas
  whose squad 0 passes `isSquadDeployable`. Re-run is idempotent. Tokens land in the
  0600 vault, absent from git status. Unit test the seeding (canvas invariant
  `checkUidInvariant` holds for the seeded canvas). `tools/ci.sh` unaffected/green.

## Outcome (built 2026-07-28, branch `req-0329-bot-player-pool-fifty`)

- **Tool**: `tools/fleet_pool_provision.cjs` (CommonJS, framework-free, like the
  rest of the tool/server code). Flags: `--count N` (default 50), `--dry-run`,
  `--api URL` (default `http://127.0.0.1:8802`, or env `BPK_API_BASE`),
  `--locale L` (default `en`).
- **Seed**: builds the default starter canvas exactly as client boot does for a
  genuinely fresh profile -- `buildStarterUnitsState(gameData, locale)` ->
  `engine.migrateState()` -- then asserts `checkUidInvariant().ok` AND
  `isSquadDeployable(state, 0)` BEFORE persisting (throws otherwise, never seeds
  a bad/undeployable canvas). The seeded canvas (11211 bytes, well under the 64KB
  cap) is byte-indistinguishable from a fresh human's first save.
- **Mint path**: player records via `server/players.cjs createPlayer(name, [])`
  (`roles:[]` -- never item_admin; the files-backend registry the live server
  reads in both storage modes). The canvas is persisted by the SAME path a real
  client uses -- `PUT /api/profile/:id/canvas` with `X-Auth-Token` -- so it lands
  in whatever backend the live server runs (Postgres on this box) and the tool
  never handles a backend secret (no DATABASE_URL).
- **Vault** (outside the repo): `~/backpack_fleet/agents/<playerId>/token`, dir
  mode 0700, file mode 0600, JSON `{playerId, token, name}`. Tokens are NEVER
  printed, logged, or committed (only written to the 0600 vault).
- **Idempotent / re-runnable**: the vault is the source of truth for "already
  provisioned"; a re-run tops the pool UP to `--count` and never duplicates a
  name or exceeds the target (verified: re-run at 50 is a no-op).
- **Unit test**: `tools/tests/fleet_pool_provision_test.cjs` -- proves the seed
  satisfies `checkUidInvariant` and squad 0 is deployable (en + ja) against the
  REAL content/live defs with NO network; plus the name pool is distinct/human/
  no-`bot_NN`, and `chooseNames` never re-uses an already-provisioned name.

### Live mint (owner authorised live; performed 2026-07-28)
- Minted **50** real guest accounts against the live API (`127.0.0.1:8802`), each
  `roles:[]`, each seeded with the starter canvas (squad 0 deployable,
  `checkUidInvariant` ok). All 50 verified end-to-end via `GET /api/me` (token ->
  roles:[]) + `GET /api/profile/:id/canvas` (HTTP 200, invariant + deployable).
- Vault location: `~/backpack_fleet/agents/` -- **50** entries, **50** distinct
  names. Sample (non-secret) names: Sofia Hansen, Marcus Larsson, Lena Hansen,
  Elena Adeyemi, Freya Cohen, Marcus Rossi. (playerIds + tokens live only in the
  0600 vault; tokens never leave it.)

### Gates (files backend)
- `node server/tests/api_test.cjs` -> **217 passed, 0 failed** (unchanged baseline).
- `node_modules/.bin/tsc -p tsconfig.server.json` -> **exit 0** (tool is under
  `tools/`, outside the tsconfig include, so it is not type-checked; suite stays green).
- `node tools/tests/fleet_pool_provision_test.cjs` -> **all green (17 checks)**.
