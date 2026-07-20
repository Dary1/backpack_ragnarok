# REQ-0269 — Balance sim harness: Monte Carlo battle evaluation for generated content

## State log
- 2026-07-20 reserved (stub).
- 2026-07-20 reserved -> draft: spec written from the content-pipeline consultation
  (user, 2026-07-21 JST); blocked on user ratification (bot policy depth,
  metric bands, encounter matrix).
- 2026-07-20 draft -> todo: user ratified (chat, 2026-07-21 JST): bots = scripted
  greedy + random baseline; metric bands and the encounter matrix are
  finalized during implementation (bands seed from REQ-0268 where applicable).

## Origin (content-pipeline consultation)
Balance-tuning phase: monster skills and item effects. Consultation outcome:
balance is an evaluation problem, not a generation problem — the pipeline
needs an empirical judge. The shared engine (engine.js; REQ-0256
battle-tick-core) already encodes the battle rules, so candidates can be
scored by simulation instead of intuition.

## Problem
Generated monster skills and item effects pass schema/fit checks, but nothing
measures their effect on outcomes. Over/under-powered content is only
discovered by hand-play. There is no win-rate, TTK, or usage metric, no
outlier flagging, and no point on the gen_data -> integrate path where a
candidate can fail for balance reasons.

## Proposal
- tools/balance_sim.cjs (headless, node): drive the shared engine directly —
  no client, no server. Input: a content candidate set (live/ or a batch), an
  encounter/loadout matrix, N seeds. Bots play a scripted greedy policy
  plus a random baseline (ratified); the policy interface stays pluggable, but learned policies are explicitly out
  of scope for this REQ.
- Metrics per candidate: win rate, TTK distribution, damage dealt/taken,
  usage/pick rate within loadouts; aggregated against baseline runs without
  the candidate.
- Outlier flagging: configurable bands (seeded from REQ-0268 stat curves
  where applicable, hand-set otherwise); out-of-band candidates are flagged
  in a report consumed before integrate.
- Determinism: seeded RNG end to end; same seeds, same metrics. CI-friendly
  runtime budget: subset matrix in CI, full matrix on demand.

## Posture notes
- Hermetic like e2e: never touches live services or data. No ports needed
  (pure in-process engine calls); if a serving surface ever appears it
  derives ports from this REQ decade per the port rule.
- The engine is the single source of battle rules: the sim reimplements
  NOTHING. If the sim needs a hook, the hook goes into the engine behind a
  seam.
- Relationship to REQ-0268: bands may seed from corpus curves, but the sim is
  the authority for OUR game; corpus data never overrides measured outcomes.

## Gates (when implemented)
- Seeded determinism test: a fixed seed set reproduces identical metrics.
- Fixture matchup unit test through the real engine.
- A deliberately overpowered fixture item trips the outlier flag; a baseline
  item does not.
