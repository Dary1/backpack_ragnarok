# REQ-0154 — content-pipeline-registry-reconcile: pipeline docs rewritten for the registry era, on a path to user_managed

**Ratified:** 2026-07-13 (user, chat) — including rulings on Q1/Q2 below. The REQ folder is
the sole status record.
**Requested by:** user, 2026-07-13 (chat): once the adopted-seed registry (REQ-0151/0155) becomes
the standard, the content pipeline changes; file a REQ to update the pipeline docs with the REQ
dependency graph included. **End goal: refine ALL content-pipeline docs to the quality where the
user promotes them to docs/user_managed (frozen golden).**

**A DOCS REQ.** No production code changes. It lands in waves, one wave per upstream merge.

## Canonical target flow (user, 2026-07-13 — the operating model the docs must converge on)
```
user commissions a content batch from the LLM
  -> foreach content in batch {
       generate 5 artwork renders            (REQ-0151 registry, flux2 route)
       -> machine scoring                    (REQ-0152 kits; REQ-0153 shape recipe if GREEN)
       -> separate-agent provisional adopted-seed decision   (advisory, recorded)
       -> generate 5 content-data variants   (REQ-0155 content registry, LLM x5)
       -> machine validity checks            (tool_gen_data / self_test_vocab /
                                              check_engine_types / tool_integrate dry-run)
       -> separate-agent validity review     (advisory, recorded)
     }
  -> batch reviewer surface
  -> user reviews: check off / edit content / change seed-variant
  -> ALL contents checked -> release (export via integrate into content/live)
```
Human adoption remains the only binding act (S7 doctrine); every agent verdict is advisory and
recorded with its rationale.

## Scope
1. **Rewrite/reconcile the pipeline docs** in docs/llm_managed/ to describe the registry-era
   flow above as THE pipeline: `common_content_pipeline.md` (the spine),
   `item_content_pipeline.md` (PO/SI split per REQ-0151 ruling 8),
   `monster_content_pipeline.md` (currently a stub), `unit_icon_pipeline.md`,
   `tm_content_pipeline.md`, plus registry cross-references in `art_pipeline.md`.
   Batch-file conventions, seed policy, adoption contract (system_name -> adopted seed/variant),
   export path, and the advisory-inspection doctrine all stated once in the spine and referenced
   by the per-kind docs.
2. **Absorb / supersede the pending doc REQs**: REQ-0111 (monster-content-pipeline-doc, draft)
   and REQ-0130 (unit-def-content-pipeline, draft) — their content lands as this REQ's monster
   and unit waves; move them per REQ-board policy (one `git mv` per commit) with a supersession
   note rather than leaving parallel doc REQs open. Coordinate REQ-0133 (item raster live
   wiring, draft) — its wiring becomes the registry export contract.
3. **REQ dependency map** (maintained IN the spine doc, updated each wave):
   REQ-0150 (flux2 route, done-when-merged) -> REQ-0151 (artwork registry admin)
   -> REQ-0152 (inspection kits, advisory) and REQ-0153 (PO shape spike; recipe folds into the
   item wave if GREEN) -> REQ-0155 (content-data registry) -> batch orchestrator + reviewer
   (future REQ, reserved when 0151/0155 are built) -> final doc wave -> promotion.
4. **Promotion path** (the end goal): when a doc's wave is complete and it has survived one
   real batch unchanged, stage a verbatim candidate copy as
   `docs/llm_managed/promotion_candidates/<name>_CANDIDATE.md`, listed in a one-line-per-file
   note (the `user_managed_rename_suggestions.md` mechanism). **The user moves candidates into
   docs/user_managed/ and commits; no LLM ever writes user_managed.** Volatile operational
   detail (box timings, OOM lore, tool flags) stays in llm_managed companions — frozen docs
   carry only ratified contract-grade content, so they do not rot.

## Wave plan (docs land after the code they describe merges — never before)
- Wave 0 (now ratifiable): spine skeleton + dependency map + this flow diagram + promotion
  mechanics.
- Wave 1 (after REQ-0151 merges): registry contract, PO/SI, adoption/export, item doc rewrite.
- Wave 2 (after REQ-0152): advisory-inspection doctrine + kit references.
- Wave 3 (after REQ-0153 verdict): PO shape-conditioning recipe (or its recorded rejection).
- Wave 4 (after REQ-0155): content-data variants, validator wiring, monster/unit/tm rewrites
  (absorbing REQ-0111/0130).
- Wave 5 (after batch orchestrator): batch reviewer flow; then promotion candidates staged.
Multi-phase policy: keep one REQ file while all waves share a status; split
(REQ-0154a…) only if waves need independent statuses.

## Gates
- G1 doc-vs-code: every statement in a rewritten doc is true of MERGED code (the REQ-0150 audit
  lesson: never freeze a doc describing uncommitted behavior); spot-verified per wave.
- G2 single-source: batch conventions / seed policy / adoption contract each stated in exactly
  one place; per-kind docs reference, never restate (drift-proofing for the freeze).
- G3 dependency map current at every wave commit.
- G4 promotion candidates are verbatim-copyable (no llm_managed-only cross-references that would
  dangle inside user_managed).
- S7 per wave: user reads the wave's docs; final S7 = user executes the promotion.

## Out of scope
- Any production code (registries, kits, orchestrator are their own REQs).
- The batch orchestrator + reviewer implementation (future REQ; only mapped here).
- The promotion act itself (user-only, by design).

## Risks
- Docs racing code: mitigated by the wave rule (docs land only after merges).
- REQ-0111/0130 authors' intent lost in absorption: their draft content is read and folded in,
  with attribution notes, before their files are moved.
- Freeze-then-rot: mitigated by G2/G4 and the volatile/contract split.

## Resolved questions (user rulings, 2026-07-13)
- Q1 ABSORB BOTH: REQ-0111 and REQ-0130 content folds into the waves with attribution;
  their files close with supersession notes (one `git mv` per commit, per board policy).
- Q2 ONE FILE: