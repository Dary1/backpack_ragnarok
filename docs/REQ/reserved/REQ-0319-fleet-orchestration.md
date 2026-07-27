# REQ-0319 — Fleet orchestration (7 reactive agents)

- **State**: reserved (scope only)
- **Program**: LLM Test-Play Fleet, track C. Design doc §7 (as revised).
- **Depends on**: REQ-0318, REQ-0313.

## Scope

- Seven guest accounts via the existing operator tool `server/cli_invite.cjs`,
  `roles: []`. Tokens in `~/backpack_fleet/agents/<id>/token`, mode 0600, outside
  the repo, never committed, never logged.
- **Reactive daemon**: a cheap deterministic watcher consumes the REQ-0313 event
  feed. Polling is not "autonomy" — the LLM wakes only when a real choice exists.
- **Drip fill**: seats are taken on a stagger (~2 min apart) derived from
  `hash(partyId, botId)`, so seven agents never stampede into 409s and no shared
  coordination state is needed; fairness by least-recently-played. The LAST seat is
  held longest, so a second human still has the best chance to join.
- **Escape hatch (mandatory).** Bots never cancel a Troop — but the deploy gate
  blocks a uid across active rooms and runs auto-restart forever
  (`runs.cjs:323`), so a bot holding one Squad in an abandoned Troop is
  permanently unavailable. Rule: leave when the host has been absent T hours, or
  immediately when the same host opens a new Troop. "解散はしないが、席は返す".
- systemd `--user` units + kill switch (`backpack-fleet.target`), per-session
  budget ledger, `TimeoutStartSec` above the session budget so a hung session is
  reaped.
- Containment: no fleet-to-fleet trading; spend and listing caps.
