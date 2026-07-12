# REQ-0144 — ugc-skin-moderation-gates

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** ugc-skin-moderation-gates
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/backpack_skin_pipeline.md` §0 (skins not for
sale; likely UGC source; Nightmare Forge validator discipline), §6 (every S3
gate must be a machine gate), §7.1 (UGC scope — OPEN).

## Goal

Player-authored skin images without automated moderation is a non-starter
(2026 legal/operational reality). Before ANY UGC skin intake exists, the
machine-gate suite must include content moderation, not just technical
validation.

## Scope

- Gate 0: the S3 technical harness (seams, clip-mask leakage, shape suite) —
  already specified by the skin pipeline; reused as-is.
- Gate 1: NSFW/CSAM classifier on every submitted bitmap (local, deterministic
  threshold policy; no LLM approval — "LLMs draft; scripts judge").
- Gate 2: best-effort IP/logo-likeness screen (perceptual-hash match against a
  curated denylist + logo detector); document known limits honestly.
- Reject/appeal flow definition (automated verdict + stored evidence, user-
  operator override path).
- Research/select the local classifier stack; record model choices + hashes.

## Non-goals

- The friends-only vs global rollout decision stays the USER's open item
  (§7.1) — this REQ builds gates, not policy.
- No market/tradability design (skin doc §7.2, still open).
- No skin system implementation (REQ-0126) and no UGC submission UI.

## Gates

- Adversarial test set (benign / NSFW / IP-lookalike / technically-broken)
  passes with documented precision; zero false-negatives on the NSFW set.
- Gate list ratified by the user BEFORE any UGC intake ships.
