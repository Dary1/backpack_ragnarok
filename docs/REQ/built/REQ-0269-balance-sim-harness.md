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

- 2026-07-20 todo (implemented): built tools/balance_sim.cjs (CLI + programmatic
  runMatrix), sim/balance/{builders,inject}.cjs, sim/balance_bands.json, and
  sim/tests/balance_sim_test.cjs; registered [2.95/7] in tools/ci.sh. Content
  pinned via __dirname to content/live/live_items.json + content/live/dungeon/*
  + content/vocab.json (never os.homedir, never batch dirs); content/s4_boards/*
  reused as loadout templates. Two arms per matrix cell (boards x levels x seeds)
  SHARE the cell master seed, so a metric delta is attributable to the candidate
  alone. Decisions:
    * Item builders (greedy/random) place the candidate into a legal free BP cell
      (add mode); the authored s4_boards are near-full, so when no free cell
      exists the builder swaps out one removable (non-`fixed`) PO (replace mode)
      and baseline = the untouched template. Legality + rotation reuse
      sim/lib/compile.cjs localCellsOfPO -- no grid math reimplemented. greedy
      maximizes a static Chebyshev-adjacency coverage heuristic; both builders
      draw every stochastic choice from makeRng streams (no Math.random).
    * Enemy/skill candidates are injected into a live pack (default
      pack_frost_scouts, slot 0): skill -> swap the member enemy for a clone
      whose skills list is replaced by the candidate; enemy -> append at a fixed
      slot. Both arms run a boss-less "arena" of N=4 pack encounters so the
      candidate combat effect is isolated from trap/door/chest/boss noise.
    * Metrics reuse sim/s4/metrics.cjs processRun; per-arm win/wipe rate, TTK
      mean/p50/p95, damage dealt/taken, candidate DPS/usage, then
      candidate-vs-baseline deltas. Bands: content/corpus_stats.json (REQ-0268)
      overlays sim/balance_bands.json when present, else the hand-set defaults
      (item DPS ceilings anchored on vocab dps_ceiling_warn with a x3 flag
      multiple; |d win|/|d wipe| 0.10 warn / 0.20 flag; TTK & dmg-dealt ratio
      bands). Exit 0 clean / 1 flagged / 2 usage. The comparison payload carries
      no timestamps/paths (metadata does).
  Gates: sim/tests/{run,goldens,s4_test}.cjs unchanged & green; balance_sim_test
  (6) green. End-to-end: live item `dagger` runs and reports a summary; the OP
  fixture item (strike [500,600]/0.5s Common) trips the item_dps_ceiling FLAG;
  an OP injected skill flips 100% victory -> 100% wipe (wipe-rate delta +1).
- 2026-07-20 REQ-0256 seam check: `git diff master...HEAD --stat -- sim/lib/
  dungeon.cjs sim/combat.cjs` on req-0256-battle-tick-core shows dungeon.cjs
  UNCHANGED and combat.cjs only removing the EventHeap re-export (2 lines).
  runDungeon opts + result shape ({events, finalProgressPct, result, rewards,
  lrdstReward, cooldownSecs, level, H, bps}) are byte-identical on 0256 HEAD.
  The 0.01s tick-loop rewrite lives in sim/lib/encounter.cjs (replay event
  shapes) which the harness never depends on -- it builds only against
  combat.runDungeon + s4 metrics. Determinism gate is double-run equality
  in-tree (no committed byte-goldens), which survives the 0256 merge. No
  sim/lib internals were modified.

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
