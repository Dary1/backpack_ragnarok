# REQ-0272 — Candidate generation wiring: context packs + one-door gate

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: user directive "proceed to completion" (chat,
  2026-07-21 JST). This is the unbuilt half of the original program goal:
  connecting corpus + bands + sim to the actual generation flow.

## Origin
REQ-0268/0269 built measurement (bands, sim); generation still runs as
unassisted LLM drafting. The consultation plan said: generation = existing
LLM flow + corpus injected as retrieval/few-shot, candidates machine-checked
before human review.

## Problem
No tool assembles generation context (genre exemplars, live neighbors, band
limits, vocab constraints) for a requested slot; and checking a candidate
requires knowing three separate tools. Human review time is spent on
mechanical rejects.

## Proposal
1. tools/gen_context.py (stdlib): input {kind: item|skill|enemy, rarity,
   optional theme/verb filter} -> emits a context pack (markdown + JSON):
   vocab constraints for the kind (closed verb/trigger lists, schema
   fields), band limits for the rarity, 5-10 corpus exemplars (mapped
   entries matching the slot), 3-5 live neighbors, and explicit DO-NOTs
   (excluded_attested, deprecated tokens). This is what an LLM (Claude in
   chat or a future scheduled job) consumes to draft candidates.
2. tools/candidate_gate.cjs (node, dep-free): ONE command for a candidate
   JSON file: schema+vocab validation (reuse shared/content_validate.cjs
   dialect rules) -> static bands (check_stat_bands) -> dynamic sim
   (balance_sim, small default matrix) -> single verdict report
   (PASS/WARN/FLAG + reasons, exit 0/1/2). The one door every candidate
   passes before human review.
3. docs/llm_managed/common_content_pipeline.md: S1 gains "draft with
   gen_context pack"; the reserved S4 slot now points at candidate_gate
   (balance sim fulfilled by REQ-0269).
4. Tests + ci wiring per repo conventions.

## Posture notes
- Generation itself remains an LLM-in-the-loop step meeting the pipeline at
  the JSON boundary; these tools ground and gate it. No vocab changes; no
  server code; no new deps.

## Gates (when implemented)
- gen_context: deterministic pack for a fixture slot; exemplars only from
  mapped entries; ci-wired test.
- candidate_gate: a known-good candidate passes end-to-end; an over-band
  candidate exits 1 with the static reason; an in-band but sim-flagged
  candidate exits 1 with the dynamic reason.
