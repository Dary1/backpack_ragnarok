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
