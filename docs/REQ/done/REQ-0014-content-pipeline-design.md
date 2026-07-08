# REQ-0014: Content Generation Pipeline v1.0 (design)

- **Status**: Design delivered, awaiting user review (pilot batch-001 pending go)
- **Date**: 2026-07-02
- **Owner**: orchestrator

## Context
User: any model except Fable 5 is fine (weekly tokens plentiful, Fable tokens scarce);
split work across Opus 4.8 / Sonnet 5.0. Then: "design the content generation
pipeline".

## Delivered
`docs/content_pipeline.md` v1.0. Core decisions:
- Content = schema-validated JSON; closed vocabularies (`vocab.json`); effects become
  a machine-checkable **Effect AST v1** with English tooltips rendered from it.
- 9 stages S0–S8: Brief → Draft (Opus) → Static validation (script) → Engine
  integration tests (script, reuses mock engine) → Balance sim (reserved until combat
  spec) → Art (Sonnet + auto-checks incl. palette/aspect/quadrant scans) → Preview
  gallery deploy (backpack-dev/preview/batch-NNN/) → User review gate (sample-based;
  rule-level verdicts encoded back into validators) → Merge to content/live/ +
  registry + snapshot rollback.
- LLMs draft, scripts judge; nothing reaches live/ before the user gate.
- Ratified laws become validators (tags-not-ids, grammar, scarcity, socket model v2,
  art contracts, shape-change⇒icon-regeneration).
- Model policy recorded: orchestrator Fable; Content Designer Opus 4.8; Icon
  Designer / critic Sonnet 5.0; validators are scripts.

## Next
- User reviews the design → pilot **batch-001 "Core"**: migrate current 14 defs to
  schema/AST, mock consumes content/live/, +6 new Frost-family entries via the full
  pipeline (with one deliberate S2 rejection to prove the gate).
