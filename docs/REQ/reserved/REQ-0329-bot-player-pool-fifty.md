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
