# REQ-0015: Pipeline Pilot — batch-001 "Niflheim shards"

- **Status**: S0–S6 complete; **awaiting S7 user review** at
  https://backpack-dev.qtie.jp/preview/batch-001/
- **Date**: 2026-07-02
- **Owner**: orchestrator (Fable) + Content Designer (Opus 4.8) + Pipeline Engineer
  (Sonnet 5.0) + Icon Designer (Sonnet 5.0)

## What was built (infrastructure)
- `content/` on server: `vocab.json` (closed vocabularies + dpt warning ceilings),
  `live/` (current 14 defs migrated to schema + **Effect AST v1**; `scenario.json`),
  `batches/batch-001-niflheim/`, `registry.json`.
- `tools/` on server: `tool_validate.cjs` (S2), `tool_gen_data.cjs` + `eff_render.cjs`
  (live JSON → data.js with AST→English tooltips), `tool_integrate.cjs` (S3, reuses
  the mock engine), `tool_art_check.py` (S5: aspect/palette/empty-quadrant/size),
  `tool_build_preview.py` (S6 gallery).
- **The mock now consumes generated data**: data.js is produced from `content/live/`;
  12/12 node tests pass against the generated module; mock rebuilt (v0.5, 83.8KB).

## Pilot run results
- S1 (Opus): 7 drafts (6 valid + 1 deliberate violator `frost_bead`, 1x1 Gem).
- S2: **validator caught a REAL bug** — `permafrost_ward` used a grammar-external
  effect (block-scaling buff). Fixed to a flat Battle-start Block 10; the scaling
  variant is deferred to a **vocab design event** (new verb would be needed).
  The deliberate violator was caught as expected. Final: 6 approved, 0 warnings.
- S3: all 6 pass placement/rotation/socket-matrix/combo probes.
- S5 (Sonnet): 6 icons incl. L/Z/T/inverted-T shaped art with strict cell-emptiness
  contracts — art_check: 6/6 PASS (aspect 0.00% diff, palette clean).
- S6: gallery live (cards, AST-rendered effects, histograms, live-roster comparison).
- Registry updated; batch is staged — **nothing merged to `live/` until S7 verdict**.

## Batch contents (6, for review)
rime_shard 1x2 C (adjacent Weapon: +2 Chill on hit) · frost_nail 1x3 C (part-style
assembled striker) · hoarfrost_creep L-3 C (adjacent Flame: Chill ×2 — "frost drinks
fire") · glacier_cleaver Z-4 U (self-Chilling carry, coat socket) · permafrost_ward
T-4 U (Battle start: Block 10) · niflheim_crown invT-4 R (Strike + per-Frost damage
scaling + adjacent-Chill amp; gem[Metal] + edge[Bone] sockets).

## Process notes
- Orchestrator patched the S2-rejected entry directly (trivial grammar fix) instead of
  a redraft round-trip — acceptable for pilot; real batches should loop to the drafter.
- Fable was used ONLY for coordination; all generation ran on Opus/Sonnet per policy.

## Next
- S7: user reviews the gallery (green/fix/cut per entry, or rule-level verdicts).
- On green: S8 merge to live, rebuild mock (Frost items appear in inventory/catalog),
  registry update, snapshot.
