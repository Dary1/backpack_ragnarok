# REQ-0316 — The judgment interface + event-driven session runner

- **State**: reserved (scope only)
- **Program**: LLM Test-Play Fleet, track B. Design doc §3 (and §4 as revised).
- **Depends on**: REQ-0314, REQ-0315, REQ-0313.
- **Blocks**: REQ-0318.

## Scope

The one place a language model touches the system.

- **Situation Digest** (`bpk digest`) — versioned JSON, ≤ ~2 KB, every array capped
  and pre-ranked by the kernel. No raw canvas, no raw event log, ever.
- **Decision Verbs** — a closed set. Under the reactive model the set shrinks:
  `JOIN`, `HOLD`, `LEAVE`, plus the housekeeping verbs `HARVEST`, `DISMANTLE`,
  `GACHA`, `SELL`, `BUY`, `REBUILD`, `END_SESSION`. `HOST` is removed — bots do not
  open Troops. Every verb carries a one-sentence `why`, which is the research
  output of the whole system.
- **Receipt** — `ok` / `refused` / `partial`, with `alternatives` on refusal.
  A refusal does not consume a turn; the runner never half-executes.
- **Event-driven sessions**, replacing the fixed 25-minute loop:
  `party_opened` → a cheap join decision (often pure CUI, zero LLM turns);
  `troop_disbanded` / `run_settled` → the housekeeping session, where the LLM
  turns actually live. This matches the game's own rule that deployed items are
  untradeable: disband IS the natural economy window.
- Budgets enforced by the tool (turns, wall clock, requests, LRDST spend, live
  listings), never by the prompt.
- JSONL transcript per session.
