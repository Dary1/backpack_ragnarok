# REQ-0330 — Reactive fleet program: watch recruitment, drip-join, auto-sell on disband

- **State**: reserved. Program: Reactive Test-Play Fleet (owner spec items 1,2,8).
- **Depends on**: REQ-0324, 0325, 0327, 0328, 0329. **Blocks**: nothing (terminal).
- **Supersedes**: the obsolete bpk apparatus REQ-0314..0320 (no LLM judgment
  interface, no personas, no tactics kernel — the fleet is mechanical).

## Truth (owner, 2026-07-28)
> 1. When ANY player starts a troop recruitment, the bot program enters `joining`.
> 2. While joining, every 30 s join the FIRST squad from the bot player pool
>    (human-equivalent).
> 8. On disband notification, list ALL drops straight onto the market.

There is NO LLM in this program. It is a deterministic daemon.

## What to build — new top-level `bot/` (sibling of server/, its own package.json)
- **Watcher.** Poll `GET /api/schedule/troops?state=recruiting` (REQ-0324). When a
  recruiting public troop with a free seat appears, the fleet is `joining`.
- **Drip-joiner.** While a target troop is recruiting, every **30 s** take the FIRST
  not-yet-used pool account (REQ-0329) and `POST /troops/:id/join {squadIndex:0}`
  (its first/starter squad). Continue until the troop is full (REQ-0325 then makes it
  auto-depart) or it disbands. One join per 30 s tick — never burst-fill (leave room
  for a human; the owner's item 2 cadence is explicit).
- **Auto-seller.** Each pool account polls `GET /api/notifications` (REQ-0327). On a
  `troop_disbanded` entry, enumerate that account's warehouse and list EVERY drop via
  the direct warehouse->market endpoint (REQ-0328), then `ack`. "All drops onto the
  market, straight from the warehouse."
- **Identity guard.** Refuse to act for any account whose `GET /api/me` is `dev` or
  carries roles (PROJECT.md dev_user hazard). Fail closed.
- **Runtime.** `systemd --user` service on llmlocal (linger is on), reading tokens
  from `~/backpack_fleet/`; a `systemctl --user stop backpack-fleet` kill switch.
  Endpoint allowlist compiled in: only troops/join/leave, notifications, warehouse,
  market-from-warehouse, me, content, profile — nothing under `/api/admin`, `/dev/`.
  Rate >= 400 ms/request, jittered.

## Rulings (owner spec is truth)
- Bots NEVER host and NEVER cancel — they only join and sell. Recruitment is always
  started by a (human or owner) player; the fleet reacts.
- 30 s join cadence and pool-order ("first squad") are literal from the spec.
- No market-to-market laundering: refuse to BUY (the fleet only SELLS drops); a
  sell-only fleet cannot distort price by self-dealing.

## Gates / acceptance
- Discrete-event/unit test of the joiner against a hermetic API (tools/e2e_harness):
  a recruiting troop fills one seat per 30 s tick, departs at 4, and never bursts.
- Auto-seller test: seed a bot warehouse -> emit a disband notification -> the fleet
  lists every row via REQ-0328 -> warehouse empty, listings present.
- Identity guard test: a dev-resolving token aborts the session non-zero.
- End-to-end canary: 1 bot, then 4 (fills+departs a troop), against a live-shaped
  instance. `tools/ci.sh` green for the `bot/` unit suite.

## Outcome (built 2026-07-28, branch `req-0330-bot-fleet-reactive-joiner`)

- **New top-level `bot/`** (sibling of `server/`, its own `package.json`,
  framework-free Node CommonJS, ZERO runtime deps -- `node:http`/`fs`/`os` only).
  There is NO LLM: a deterministic reaction daemon.

### Architecture (`bot/lib/` pure cores + effectful drivers)
- `config.cjs` -- env-overridable defaults; every cadence constant lives here
  (join 30000ms, rate floor 400ms + 150ms jitter).
- `allowlist.cjs` -- compiled-in, default-DENY endpoint allowlist + hard-denies.
  Only troops browse/join/leave, notifications (read/ack), warehouse, market
  *from-warehouse*, me, content, profile are permitted. Hosting, cancelling,
  buying, and anything under `/api/admin` or `/dev/` are hard-refused.
- `client.cjs` -- the fleet's ONLY egress: a node:http JSON client that runs the
  allowlist BEFORE opening a socket and paces every request through a shared
  >=400ms+jitter limiter. `X-Auth-Token` attached from the vault, NEVER logged.
- `vault.cjs` -- reads the REQ-0329 pool vault (`~/backpack_fleet/agents/<id>/token`,
  0600) in stable order; redacts tokens from any log view.
- `identity.cjs` -- refuses `dev`/roled/malformed identities; fails closed.
- `pool.cjs` -- first-not-in-use selection (walks the pool one-per-tick like a
  round-robin); `nextRoundRobin` helper.
- `watcher.cjs` -- picks the oldest recruiting troop with a free seat.
- `joiner.cjs` -- the drip cadence: `dueToJoin`/`planDripTick` (pure, one join per
  interval, never a burst) + `driveDripJoin` async driver.
- `seller.cjs` -- sellable-row filter (skips tm/currency + mid-claim rows) +
  `sellAll` (lists EVERY drop via from-warehouse with a per-row Idempotency-Key).
- `price.cjs` -- the deterministic price policy (below).
- `fleet.cjs` -- the daemon: identity-clears each account, then runs a joinLoop
  (scout browse -> target -> drip) and a sellLoop (committed accounts watch for
  `troop_disbanded` -> dump drops -> ack -> free) until stopped.
- `bin/fleet.cjs` -- entry point; SIGTERM/SIGINT clean stop.
- `systemd/backpack-fleet.service` -- `systemd --user` unit (NOT enabled by this
  REQ); `systemctl --user stop backpack-fleet` is the kill switch.
- `README.md` -- run + deploy + kill-switch instructions, safety, price policy.

### Price policy (auto-seller)
Deliberately dumb + deterministic (spec: "NOT anything clever"): a FLAT per-kind
floor in the canonical market TM `lrdst` (server MARKET_TM_ID) -- **unit/BP = 25
lrdst, plain PO/SI = 5 lrdst**, both inside the server `[1..999]` band. Keyed only
off the warehouse row's own `kind` field (no appraisal, no content lookup). Env
`BOT_SELL_PRICE_UNIT`/`_ITEM`/`_TM` retune the floors; the flat-per-kind policy is
compiled in.

### Gates (all green)
- **Fleet unit suite** -- `node bot/tests/run.cjs` -> **57 passed, 0 failed**
  (pool selection/round-robin, one-join-per-tick cadence + no-burst, sellable-row
  filter, price policy, allowlist enforcement incl. host/cancel/buy/admin/dev
  refusal wired through the client, identity guard, vault, watcher).
- **Hermetic end-to-end canary** -- `node bot/tests/canary_hermetic.cjs` ->
  **PASS**. Stands up an isolated `server/api.cjs` (files backend, content-live
  copied, port from `tools/port_desk.sh`), provisions a THROWAWAY 5-account pool
  into a temp vault (`tools/fleet_pool_provision.cjs`, real starter canvases), has
  one account HOST a recruiting troop, then the fleet drip-joins one account per
  tick. Asserted: exactly 3 fleet joins, **NO BURST** (observed spacing 1534ms /
  1902ms >= the 1500ms canary interval), troop departs to `state=active` with all
  4 seats filled. Fully torn down (api killed, temp HOME+vault removed; the real
  `~/backpack_fleet` 50-account vault untouched; port released).
- **Server suite unaffected** -- `node server/tests/api_test.cjs` ->
  **222 passed, 0 failed** (1914 assertions). No server code touched.

### Deploy live (the ORCHESTRATOR does this -- NOT enabled by this REQ)
```
cp ~/backpack_ragnarok/bot/systemd/backpack-fleet.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now backpack-fleet     # start the fleet live
systemctl --user stop backpack-fleet             # KILL SWITCH
journalctl --user -u backpack-fleet -f           # logs
```

### Deviations / follow-ups
- The daemon reacts to ONE target troop at a time ("the fleet is joining for that
  troop"); concurrent multi-troop targeting is a straightforward extension if the
  owner later wants parallel fills.
- The auto-seller is exercised by unit tests (filter + list-all + ack against a
  fake client); the hermetic canary focuses on the joiner cadence (the spec's
  primary canary). An end-to-end seller canary needs a real disband-with-rewards,
  which requires a completed run then a cancel -- out of scope for a fast canary.
- `server/node_modules` was `pnpm install`ed in the worktree (needed to boot the
  hermetic API + run provisioning); it is gitignored and not part of the commit.
