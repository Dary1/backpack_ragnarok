# REQ-0272 — Candidate generation wiring: context packs + one-door gate

## State log
- 2026-07-21 reserved (stub).
- 2026-07-21 reserved -> todo: user directive "proceed to completion" (chat,
  2026-07-21 JST). This is the unbuilt half of the original program goal:
  connecting corpus + bands + sim to the actual generation flow.

- 2026-07-21 IMPLEMENTED (subagent, opus). Delivered:
  - `tools/gen_context.py` (stdlib): context-pack builder
    `--kind item|skill|enemy --rarity T [--verb V] [--theme S] [--format md|json] [--out F]`.
    Emits CONSTRAINTS (schema fields with dialect casing, domain-filtered
    triggers, closed verbs, DO-NOT = excluded_attested + deprecated, rarity
    band warn_hi + basis, dps-proxy formula) + GENRE EXEMPLARS + LIVE
    NEIGHBORS. Deterministic (stable sort, no timestamps).
  - `tools/candidate_gate.cjs` (dep-free node): the one door.
    `<candidate.json> [--kind auto|...] [--seeds N] [--skip-sim]`. Stage 1
    VALIDATE -> Stage 2 STATIC -> Stage 3 DYNAMIC, single verdict, exit
    0/1/2, `<name>.gate.json` written next to the candidate (deterministic
    core + non-core meta).
  - `docs/llm_managed/common_content_pipeline.md`: S1 now points at the
    gen_context pack; the reserved S4 slot is marked FULFILLED by the
    REQ-0269 sim via candidate_gate.
  - Tests: `tools/tests/gen_context_test.py` (31, stdlib; committed corpus
    fixture, not gitignored data/) and `sim/tests/candidate_gate_test.cjs`
    (7, end-to-end spawn). Wired into ci.sh at [3.98/7] and [2.96/7].
  Decisions / deviations:
  - REUSE not fork: gate Stage 1 reuses `content_validate.validateEffect/
    validateSocket` for the closed-vocab AST and `content_checks._dialectFor`
    for the rarity-casing / range-field / name-field dialect rows; Stage 2
    SPAWNS `check_stat_bands.cjs --gate`; Stage 3 calls `balance_sim.runMatrix`.
  - Did NOT run `validateBody` on items: its admin-only tags[0]-must-be-root
    rule rejects live-shaped items (live tags[0]='WeaponPart', a non-root
    po_tag). Used vocab.po_tags tree membership instead (the same rule the
    content_checks machine check applies), so live-shaped candidates validate.
  - skill/1 has no rarity, so the STATIC band stage is advisory 'na' for
    skills; the DYNAMIC sim is the OP-skill detector. The in-band-but-flagged
    fixture is a strong DoT (apply_status Poison) -- static-'na' PASS, dynamic
    FLAG (wipe/win/dmg bands). Over-band ITEM fixture trips the STATIC reason.
  - Tolerates REQ-0271's in-flight verb-mapping enrichment: low mapped counts
    fall back to damage-number exemplars (noted in the pack); extra corpus
    fields are ignored (schema-additive safe).
  Gates: new tests green; `SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh`
    green in the worktree (corpus provisioned into gitignored data/corpus).
    REQ left in todo/ per directive (not moved between folders).

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
