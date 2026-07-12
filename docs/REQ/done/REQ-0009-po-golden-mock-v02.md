# REQ-0009: PO Golden v1.0 + Mock v0.2 (round-3 decisions applied)

- **Status**: Completed (PO golden + mock v0.2 await user eyes)
- **Date**: 2026-07-02
- **Owner**: orchestrator + designer subagent

## User decisions applied (round 3)
- Research findings elevated into a golden → `docs/placement_object_golden.md` v1.0
  (supersedes item_spec_draft.md).
- **Frozen Canvas / No Gold**: sortie locks the canvas until dungeon completion; no
  mid-run economy; Gold removed entirely (Golden Idol cut). Recorded in second_golden §3.
- **Receivers are Linkers only** (visual reconfirmation): dud beams now fly OFF the
  canvas (× outside the grid), never terminating on an item.
- **Proposal A adopted — Accessories**: slot-free POs in two modes (Socket on an item /
  Bond on a tag-connection). [DERIVED constraint] capacity bounded by host: sockets per
  item (0–2), one accessory per bond — preserves P1 footprint pressure.
- **Proposal B adopted — Parts**: moderate subdivision, weapons first. Grid-native
  reading: Blade (1x2) + Hilt (1x1) adjacent = assembled Longsword; Guard is an
  Accessory on the Blade–Hilt bond (which validates the grid-native interpretation).
  Lone parts inert (safe under Frozen Canvas). Assembled weapons read as one item.

## Mock v0.2 — LIVE at https://backpack-dev.qtie.jp/mock/
- Alpha: Blade+Hilt assembly (unified outline), Ruby Gem socket badge, Guard bond
  badge, Ignite combo. Beta: shield/herb. Gamma: dagger+whetstone (Keen Edge), one
  empty piece. Delta: 3 fangs. Links: Alpha⇄Beta mutual, Alpha→Gamma, Gamma⇄Delta
  mutual, Gamma dir-3 dud flying off canvas. Catalog split: Items & Parts vs
  Accessories. Rules panel updated (Frozen Canvas / no Gold / parts / accessories).
- 5 new icons by designer subagent (blade, hilt, gem, guard, arrowhead), style-matched.

## Ops lesson (recorded for future sessions)
- **FS→sandbox sync can truncate large Write-tool files.** mock v0.2 (24KB) appeared
  truncated at 17.9KB on the mount and deployed broken (JS cut mid-file, silent page
  failure). Fix: write in <10KB parts under NEW filenames, verify sizes/tails via
  sandbox, concatenate there, `node --check` the extracted script before scp.
  ALWAYS verify page render via Chrome after deploy — HTTP 200 is not enough.

## Next
- User reviews PO golden v1.0 (esp. [DERIVED] constraints) + mock v0.2.
- Then: Linker types/effects design (anchored to PO golden), combat tick spec.
