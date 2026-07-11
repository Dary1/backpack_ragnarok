# REQ-0129 — unit-charge-trigger-taxonomy

**Status:** draft — vocabulary growth is a DESIGN EVENT (common pipeline
rule); the frozen vocabulary needs user ratification before any unit def
authoring (REQ-0130) begins.
**Reserved:** 2026-07-11
**Slug:** unit-charge-trigger-taxonomy
**Precedent:** REQ-0078 (on-hit taxonomy), REQ-0079 (linker destination
triggers).

## Why (session finding, 2026-07-12)

The user-authored unit roster already uses 6+ distinct charge sources: item
on-hit, BP damage taken, damage dealt, damage-taken count, ally unit death,
time/cooldown, connected-target's trigger firing, connected-target attacks.
Authoring dozens of units before freezing this vocabulary will produce the
inconsistencies the content pipeline exists to prevent.

## Scope

- Extend `content/vocab.json` triggers/verbs (proposal only; user ratifies):
  charge-source triggers, charge-spend semantics (active skill on full charge
  vs passive per-stack effects, e.g. berserker), and charge-target grammar
  (self / connected / connected-BP / distributed).
- Effect AST extension for charge: charge counter, thresholds, stack effects
  — grammar + validator, mirroring the existing AST discipline.
- **Resolved during drafting (user ruling, 2026-07-12):** the thief's
  "クロックタワー" reference is a stale leftover from a deleted unit draft
  (clock tower was a unit kind) — no definition needed; drop the reference
  when the thief's kit is authored. Remaining check here: the princess-tower
  transformation ("リトルプリンセスタワー → プリンセスタワー") must be
  expressible as a charge-spend verb (form change) in the frozen grammar.
- No content authoring; no sim implementation beyond validator support.

## Gates

- Every roster-seed unit's charge behavior is expressible in the frozen
  grammar (paper check against all 13 user-a