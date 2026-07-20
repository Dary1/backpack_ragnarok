# REQ-0269 — Balance sim harness: Monte Carlo battle evaluation for generated content

## State log
- 2026-07-20 reserved (stub).
- 2026-07-20 reserved -> draft: spec written from the content-pipeline consultation
  (user, 2026-07-21 JST); blocked on user ratification (bot policy depth,
  metric bands, encounter matrix).
- 2026-07-20 draft -> todo: user ratified (chat, 2026-07-21 JST): bots = scripted
  greedy + random baseline; metric bands and the encounter matrix are
  finalized during implementation (bands seed from REQ-0268 where applicable).
- 2026-07-20 todo (premise fix, recon): battle rules live in sim/, not
  mock-src/engine.js; REQ-0050's S4 simulate gate already provides the Monte
  Carlo core and this REQ extends it. Ratified greedy+random bots become
  loadout-layer builders (combat has no in-battle decisions). Coordinate
  with in-flight REQ-0256 (built, unmerged): no committed byte-goldens.

## Origin (content-pipeline consultation)
Balance-tuning phase: monster skills and item effects. Consultation outcome:
balance is an evaluation problem, not a generation problem — the pipeline
needs an empirical judge. Battle rules live in sim/ (combat.cjs facade;
encounter/dungeon drivers), and a seeded Monte Carlo harness already exists
(REQ-0050 S4 simulate gate: tools/simulate.cjs + sim/s4/metrics.cjs), so
candidates can be scored by simulation instead of intuition. This REQ
extends that machinery rather than building anew.

## Problem
Generated monster skills and item effects pass schema/fit checks, but nothing
measures their effect on outcomes. Over/under-powered content is only
discovered by hand-play. There is no win-rate, TTK, or usage metric, no
outlier flagging, and no point on the gen_data -> integrate path where a
candidate can fail for balance reasons.

## Proposal
- tools/balance_sim.cjs (headless, node): reuse combat.runDungeon and
  sim/s4/metrics as libraries — no client, no server; content pinned to the
  worktree's content/live (+ live/dungeon), never os.homedir. Input: a
  content candidate (item or enemy/skill), an encounter/loadout matrix, N
  seeds. Combat is fully scripted (no in-battle decisions exist), so the
  ratified greedy + random policies operate at the loadout/board-construction
  layer: a greedy builder and a seeded random-legal builder place item
  candidates; enemy-side candidates are injected into packs at fixed slots.
  The policy interface stays pluggable; learned policies remain out of
  scope.
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
- sim/ is the single source of battle rules: the harness reimplements
  NOTHING and calls only public seams (combat.runDungeon, s4 metrics). If a
  hook is needed, it goes into sim/ behind a seam.
- REQ-0256 (0.01s tick-loop rewrite) is built-but-unmerged on its own
  branch and rewrites encounter internals plus replay goldens. The harness
  therefore commits NO byte-goldens; its determinism gate is double-run
  equality within the same tree, which survives the 0256 merge.
- Relationship to REQ-0268: bands may seed from corpus curves, but the sim is
  the authority for OUR game; corpus data never overrides measured outcomes.

## Gates (when implemented)
- Seeded determinism test: a fixed seed set reproduces identical metrics
  across two runs in the same tree (double-run equality, no committed
  goldens).
- Fixture matchup unit test through the real engine.
- A deliberately overpowered fixture item trips the outlier flag; a baseline
  item does not.
