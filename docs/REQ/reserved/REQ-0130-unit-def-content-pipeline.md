# REQ-0130 — unit-def-content-pipeline

**Status:** draft — blocked on: REQ-0127 (S7-accepted art; illustration-first
law), REQ-0129 (frozen charge/trigger vocabulary), REQ-0128 (connection_shape
schema semantics).
**Reserved:** 2026-07-11
**Slug:** unit-def-content-pipeline

## Goal

The pipeline doc + first defs batch for Units: schema, validation chain, and
live target — the def-side counterpart of the ratified Unit Icon pipeline
(`docs/llm_managed/unit_icon_pipeline.md` v1).

## Schema (sketch; finalized in the pipeline doc)

`unit/1`: `id` / `name` / `rarity` / `icon` (`"icon-<id>"`, always 1×1) /
`connection_shape` (semantics from REQ-0128) / `charge`
(`{trigger, capacity, spend}` in the REQ-0129 grammar) / `effects` (AST) /
`sockets` (see REQ-0054 rescue below) / `flavor` / `i18n.ja`.
Illustration-first: a def may only be authored against S7-accepted art.

## Validation chain (mirrors item pipeline v2)

Static validate (unit ALLOWED_KEYS, closed vocab) → engine integrate
(occupies exactly 1 BP cell; connection resolution smoke test) → preview
gallery on backpack-dev → **STOP for user review**. Nothing enters
`content/live/live_units.json` (new live target) until green. `i18n.ja`
mandatory on every entry.

## Rescued from REQ-0054 (供養 2026-07-12) — Unit Sockets / equipment SIs

- The ADOPTED (2026-07-06) "Linker gains ONE socket; lens SI family
  customizes behavior" concept transfers to Units: unit defs may carry one
  socket; SI seating/rejection/hierarchy machinery (`sockets(st)`) is reused
  verbatim. Socket tag naming (`lens` vs an equipment-flavored rename) is a
  vocab decision → settle in REQ-0129's design event.
- Launch trio (hop_lens / dye_lens_burn / guard_lens) re-derives against the
  post-pivot link/charge semantics once REQ-0128 settles what a "pulse" is.
- `on_pulse_emit` trigger: re-evaluate under the charge grammar (REQ-0129).
- Pack ruling survives: equipment SIs debut inside themed packs (REQ-0062
  Prism Pack lineage — pack teaches the mechanic by construction).

## Rescued from REQ-0061 (供養 2026-07-12) — the 8-type connective axis

- The factorized relay-behavior axis (delay / divider / junction / toggle /
  terminal / amplifier / splitter / condenser) becomes ROSTER SEED MATERIAL:
  candidate unit kits or charge-spend verbs. The rescued design LAW: **each
  connective kit = exactly ONE deviation from standard behavior.**
- Ratified staging law transfers: teaching-staircase wave first (the
  delay/divider/junction analogues), power wave only after the first wave's
  S4 data is green.
- Acquisition ruling (user, 2026-07-06) transfers: connective identities are
  obtained by CHOOSING which themed BP pack to open (REQ-0062 catalog;
  Clockwork/Prism lineage). No rerolls; starter jobs stay connective-less
  (REQ-0051 lineage).
- Deterministic semantics (merge rules, counters, caps) went to REQ-0128 —
  this REQ consumes whatever REQ-0128 ratifies.

## Gates

- Pipeline doc ratified by user before the first batch brief.
- Paper check: all 13 user-authored roster kits (elf … squire) expressible in
  schema + frozen grammar.
- First batch reaches the user-review STOP with every def mapped to accepted
  art; zero live writes before green.
