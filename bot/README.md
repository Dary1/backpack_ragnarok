# bot/ — Reactive Test-Play Fleet (REQ-0330)

A deterministic, framework-free Node (CommonJS) daemon that plays the game the way
a crowd of humans would: it watches for troop recruitments, drips one pool account
in every 30 s, and dumps every drop onto the market when a troop disbands.

**There is NO LLM here.** No personas, no tactics, no judgment — just a mechanical
reaction loop. Sibling of `server/`; its own `package.json`; zero runtime
dependencies (only `node:http`/`fs`/`os`).

## What it does (owner spec items 1, 2, 8)

1. **Watcher** — polls `GET /api/schedule/troops?state=recruiting`. When a public
   recruiting troop with a free seat appears, the fleet targets it.
2. **Drip-joiner** — while that troop recruits, every **30 s** it takes the FIRST
   not-yet-used pool account (REQ-0329 vault) and `POST .../join {squadIndex:0}`
   (that account's starter squad). **One join per tick — never a burst-fill**, so a
   human always has room to take a seat. Continues until the troop fills (REQ-0325
   auto-departs it) or disbands.
3. **Auto-seller** — each committed account polls `GET /api/notifications`; on a
   `troop_disbanded` entry it lists **every** sellable warehouse drop via
   `POST /api/market/listings/from-warehouse` (REQ-0328), then acks. "All drops
   onto the market, straight from the warehouse."

## Safety (compiled in — not configurable)

- **Identity guard** — refuses to act for any account whose `GET /api/me` is `dev`
  or carries any role. Fails closed (that account is skipped/aborted).
- **Endpoint allowlist** (`lib/allowlist.cjs`) — every request is checked before a
  socket opens. Only troops browse/join/leave, notifications, warehouse, market
  *from-warehouse*, me, content, profile are permitted. Anything under `/api/admin`
  or `/dev/`, **hosting**, **cancelling**, and **buying** are hard-denied. The fleet
  is **SELL-ONLY** — it cannot self-deal.
- **Rate limit** — a shared gate enforces ≥ 400 ms between any two requests, with
  jitter.
- **Confidentials** — tokens are read from the vault at runtime and **never**
  logged; accounts are always referenced by name/playerId.

## Price policy (auto-seller)

Deliberately dumb and deterministic (the spec: "a simple deterministic price …
NOT anything clever"). A flat per-kind floor in the canonical market TM `lrdst`:

| drop kind          | price      |
|--------------------|------------|
| unit / BP          | 25 lrdst   |
| plain PO / SI      | 5 lrdst    |

Both floors are inside the server's `[1..999]` price band. Env `BOT_SELL_PRICE_UNIT`
/ `BOT_SELL_PRICE_ITEM` / `BOT_SELL_PRICE_TM` retune the floors without a code
change; the flat-per-kind policy itself is compiled in (`lib/price.cjs`).

## Layout

```
bot/
  bin/fleet.cjs            entry point (the daemon)
  lib/config.cjs           env-overridable defaults (all cadence constants)
  lib/allowlist.cjs        compiled-in endpoint allowlist (default-deny)
  lib/client.cjs           node:http JSON client (allowlist + rate limit)
  lib/vault.cjs            reads the REQ-0329 pool token vault
  lib/identity.cjs         identity guard (dev/roled -> refuse, fail closed)
  lib/pool.cjs             pool-account selection / round-robin (pure)
  lib/watcher.cjs          recruiting-troop target selection (pure)
  lib/joiner.cjs           drip cadence: one join per tick (pure + driver)
  lib/seller.cjs           sellable-row filter + list-all driver
  lib/price.cjs            deterministic price policy (pure)
  lib/fleet.cjs            daemon: wires the loops together
  systemd/backpack-fleet.service
  tests/                   unit suite (run.cjs) + hermetic canary
```

## Configuration (env, all optional)

| var | default | meaning |
|-----|---------|---------|
| `BOT_API_BASE` | `http://127.0.0.1:8802` | live API base URL |
| `BOT_VAULT_ROOT` | `~/backpack_fleet/agents` | REQ-0329 token vault |
| `BOT_JOIN_INTERVAL_MS` | `30000` | drip cadence (owner spec: 30 s) |
| `BOT_WATCH_INTERVAL_MS` | `5000` | recruiting-browse poll |
| `BOT_NOTIFY_INTERVAL_MS` | `15000` | notification poll |
| `BOT_RATE_MIN_MS` | `400` | request floor |
| `BOT_RATE_JITTER_MS` | `150` | added jitter |

## Run

Prereq: the REQ-0329 vault is populated (`~/backpack_fleet/agents/<id>/token`) and
the API is up on `BOT_API_BASE`.

```bash
# unit suite (fast, no network)
node bot/tests/run.cjs          # or: cd bot && pnpm test

# hermetic end-to-end canary (stands up its own throwaway API + pool, tears down)
node bot/tests/canary_hermetic.cjs
```

## Deploy live (systemd --user — the ORCHESTRATOR does this)

```bash
cp ~/backpack_ragnarok/bot/systemd/backpack-fleet.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now backpack-fleet     # start the fleet live
journalctl --user -u backpack-fleet -f           # watch it

# KILL SWITCH
systemctl --user stop backpack-fleet
```

The daemon is NOT enabled by this REQ. It ships the unit + these instructions; the
orchestrator performs the live enable + canary.
