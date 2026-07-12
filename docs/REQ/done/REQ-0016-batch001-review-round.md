# REQ-0016: batch-001 Review Round — Vocab v2, i18n, Icon Regen, Conn Tiles, Ranges

- **Status**: Completed; batch-001 v2 re-staged for review
- **Date**: 2026-07-02
- **Owner**: orchestrator (Fable, coordination) + Opus 4.8 (art) + Sonnet 5.0 (vocab/tools, i18n)

## User verdicts applied
1. **Genre-verb auto-approval**: vocab v2 built from the research doc — triggers 5→7,
   verbs 8→16, statuses 5→8, each with provenance; 9 non-portable verbs recorded in
   `excluded_attested` with reasons. Rule recorded in PO golden v1.5.
2. **Japanese-first UI + i18n**: preview gallery and mock are JA-default with a
   🇯🇵/🇬🇧 toggle; all names/flavors translated (name_ja/flavor_ja in content JSON);
   effect text renders from the AST per locale (eff_render en/ja).
3. **All icons rejected → process fixed**: `art_golden.md` v2 written — mandatory
   render-to-PNG-and-LOOK self-review loop (cairosvg), three-tone construction recipe,
   orchestrator visual gate before S6, art on Opus 4.8. All 6 Frost icons regenerated;
   orchestrator gate rejected hoarfrost_creep once more (thin wires) → rebuilt chunky.
4. **Conn tiles**: POs declare tag-connection cells; both-sides contact rule
   [DERIVED]; gold ◆ notch visualization + active-connection lines in mock; validator
   enforces conn on adjacency effects.
5. **Ranges + ×3 numbers**: all combat numerics are [lo,hi] per-drop roll ranges
   (e.g. dagger 3 → 7–11, shield 12 → 26–46); notation shown as 4〜8 (JA) / 4–8 (EN);
   dpt ceilings ×3. Per-instance roll display arrives with the drop system.
6. **Rime Shard "Gem" collision → type renamed to "Rune"** across vocab/content.

## State
- Live (14 defs) migrated to schema v2: S2 green; 12/12 engine tests green with
  generated bilingual data.js; mock v0.6 live (conn notches, JA/EN toggle).
- batch-001 v2 re-staged: S2 green (6 approved + planted reject confirmed),
  preview rebuilt JA-first: https://backpack-dev.qtie.jp/preview/batch-001/
- Ops: Write-tool truncation on the outputs mount is now chronic — ALL agents warned;
  bash/python file I/O is the standard write path for build artifacts.

## Awaiting
- S7 re-review of batch-001 v2 (icons + JA text + ranges + conn).
