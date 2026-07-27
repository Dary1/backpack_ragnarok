# REQ-0318 — Claude CLI integration and personas

- **State**: reserved (scope only)
- **Program**: LLM Test-Play Fleet, track C. Design doc §7.4, §8.
- **Depends on**: REQ-0316.
- **Blocks**: REQ-0319.

## Scope

- Headless `claude -p` invocation with `--allowedTools` limited to the `bpk`
  subcommands: no Bash, no file writes, no network. The model literally cannot
  reach the API except through the verb set.
- Prompt pack: the rules of the game as a player sees them, the verb contract, and
  the instruction to always give a `why`.
- Seven persona seeds (hoarder / gambler / merchant / climber / turtle / socialite
  / builder) injected into both the system prompt AND the kernel's build seed, so
  one fleet produces seven different economies of behaviour.
- Mixed models across agents, so the game is not tested against a single model
  class.
- Ordinary player names, not `bot_01` — a human who meets them should meet players.
