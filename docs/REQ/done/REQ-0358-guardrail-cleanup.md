# REQ-0358 — Guardrail cleanup of docs/llm_managed (audit 2026-08-02)

- State: built (docs-only; awaiting user inspection/merge)
- Spec: apply the guardrail audit delivered in chat 2026-08-02 (verdict table:
  guardrail_audit_llm_managed.md, session outputs). Doctrine: a guardrail pays
  context rent every session; keep only premise-carrying notes, archive dead
  premises, state each survivor's premise so removal is decidable.

## Applied BEFORE this branch, directly on master (user grant in chat)
- fa061bc6..e62b7d00 is the base; the grant covered:
  b3faa20d archive user_managed_rename_suggestions.md (+ creates archive/)
  65bd7b60 promote terminology_unit_squad.md -> user_managed
  b48076f9 promote economy.md -> user_managed
  7cfed747 extract Art Golden -> user_managed/art_golden.md (spine s2 = pointer)
  e62b7d00 add user_managed/art_canon.md; art_pipeline cites it
- PROJECT.md full rewrite proposed in chat; user adopted and applied it
  themselves (user-owned file).

## This branch
- research/: business_analysis.md, genre_mechanics_gap.md (inputs, not rules)
- archive/: ssd playbook (premise verified dead: root now on NVMe), 0304/0306
  audit (both REQs done), item_spec_draft (superseded 07-02),
  recovered_from_server/ (pre-pivot history), 07-17 session log and 07-27
  fleet handoff (after folding their load-bearing parts, below)
- Folds: RSS mitigations + torch>=2.8 note -> art_pipeline.md; handoff
  decisions/findings -> fleet design doc appendix (status-board copy dropped:
  the REQ board is the only status)
- Fixes: deduped pasted terminology banners whose second copy was corrupted
  ("Unit = ex-Unit") in architecture / combat_spec / business_analysis
- Compression: 20-line pasted ART-SUPERSEDED banners -> 3-line pointer in
  item/unit/skin pipelines; dead V9/SDXL sections cut (git history keeps all)
- Premise/Expires-when headers added to 7 living notes
- hard_sessions.md distributed (Pixi/e2e/artifact/doc-hygiene lessons ->
  architecture.md s8) and deleted

## Gates
- Docs-only: no code, content, or service touched; no restarts.
- Link sweep: moved/deleted files grepped for live inbound refs before moving
  (terminology: none; economy: by-name refs only, path-independent;
  content_pipeline.md stub kept BECAUSE live code/docs still reference it).
- done/ history untouched throughout (immutable per policy).

## Outstanding (deliberately not in this REQ)
- e2e freeze lift: verify the 12 remaining worktrees are rebased, then kill the
  flock pair and delete the freeze section in e2e_harness.md.
- content_deploy_runbook "known gaps" -> own REQ (autobalance gap detection).
- combat_spec_draft promotion on ratification (audit C1.5).
- llm-art-plans/: untouched (user art domain, HANDS-OFF).
