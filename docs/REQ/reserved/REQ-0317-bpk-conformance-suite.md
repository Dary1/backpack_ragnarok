# REQ-0317 — `bpk` conformance suite (hermetic)

- **State**: reserved (scope only)
- **Program**: LLM Test-Play Fleet, track B. Design doc §10.
- **Depends on**: REQ-0314 (grows with 0315/0316).

## Scope

Prove the tool without touching live data.

- **Canvas conformance** (highest risk): property test — for random inventories,
  every canvas `bpk` would PUT satisfies `engine.checkUidInvariant`.
- **Round-trips against a real API**: gacha-roll → place → PUT → assert the pending
  row finalized; claim → place → PUT → assert the warehouse row is gone; and the
  failure paths (no space → refund / row untouched). These are the two flows where
  a silent bug loses a player's items.
- **Harness**: `tools/e2e_harness.sh` + `tools/e2e_ports.sh` with THIS REQ's
  number — ports derive as `5000 + REQ*10 + i` and `tools/check_e2e_ports.cjs`
  enforces it as ci step `[0/8]`. Never hand-pick a port.
- **Rendezvous simulation**: discrete-event model of the reactive protocol (bots
  drip-filling a human-hosted Troop on a stagger derived from
  `hash(partyId, botId)`), asserting no stampede, fair rotation, and that a second
  human can still take a seat. Falsify the protocol before deploying it.
