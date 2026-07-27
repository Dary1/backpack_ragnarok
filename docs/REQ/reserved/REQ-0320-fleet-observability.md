# REQ-0320 — Fleet observability and acceptance

- **State**: reserved (scope only)
- **Program**: LLM Test-Play Fleet, track C. Design doc §9, §6.5.
- **Depends on**: REQ-0319.

## Scope

- **Fleet board**: static HTML (the `tools/build_corpus_browser.py` pattern) —
  live Troop occupancy, seat-fill latency, each agent's last decision and its
  `why`.
- **Play journal**: the `why` sentences grouped by verb. This is the qualitative
  product of the whole program — where a designer learns how the game reads to a
  fresh mind.
- **Acceptance metric** (reactive model): *a human who opens a Troop has four
  seats filled within N minutes*, measured p50/p90 — replacing the first draft's
  greeter-seat-uptime target, which the reactive design makes moot.
- Alarms: a Troop that never fills; an agent stuck in an abandoned Troop past the
  escape-hatch window; any agent with >3 consecutive refused verbs; any session
  hitting its request cap.
