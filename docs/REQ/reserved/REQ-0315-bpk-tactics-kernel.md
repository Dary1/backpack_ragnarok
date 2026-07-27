# REQ-0315 — `bpk` tactics kernel (deterministic, LLM-free)

- **State**: reserved (scope only)
- **Program**: LLM Test-Play Fleet, track B. Design doc §3.1, §4.3, §4.4.
- **Depends on**: REQ-0314.
- **Blocks**: REQ-0316.

## Scope

Everything with a right answer, as pure seeded functions, testable with no API key:

- **Auto-build** (deliberately dumb, per the brief): seat pass (greedy fit-tag ×
  footprint × quality `q`), link pass (≤50 seeded BP repositionings, keep the most
  Unit-to-Unit beams via `traceBeams`), socket pass. Objective weights
  hp/links/dps/balanced; seed differs per agent so builds diverge (golden pillar
  P5).
- **Triage**: what to claim (fit vs free cells vs 7-day expiry), what is junk, what
  is surplus.
- **Pricing**: deterministic percentile bands from observed listings. No formula-
  driven dynamic pricing — `economy.md` forbids it and a bot fleet must not become
  one by accident.
- **Level ladder**: when to raise `attackLv` given recent `H` and wipe history.
- **Fit scoring**: cheap static estimate; explicitly not a full sim.

All goldened, in the `sim/tests/goldens.cjs` style.
