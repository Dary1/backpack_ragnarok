# REQ-0194 — Dex detail pane overhaul (schema/lore unification)

## State log
- 2026-07-16 reserved (stub).
- 2026-07-16 reserved -> todo: user-directed ("右側のSchemaと詳細がバラバラ / overhaul the page
  using aesthetic + UI/UX judgment"), cleared to implement immediately.

## Problem
User report (2026-07-16): the Dex master/detail RIGHT pane reads as two unrelated widgets.
1. Two separate ornate panels (Schema / info), each with its own rarity frame + corner
   brackets; the schema panel never names the item it diagrams.
2. The schema grid is left-anchored in its panel; socket callout labels are absolutely
   positioned at grid-right with hardcoded pixel offsets, floating in a large empty region
   (the panel is ~half the viewport wide, the grid often only 150–460px).
3. Identity is scattered: rarity/tag chips appear both in the schema panel's floating
   labels and in the info panel chiprow; the item name appears only in the SECOND panel,
   below the diagram of itself.
4. EN locale renders redundant "Schema / SCHEMA" head captions.

## Change (presentation-only; no data/API/behavior change)
- DexDetail.tsx: ONE rarity-framed ornate panel wrapping a new masthead
  (No. chip + localized name + EN caption + rarity word + kind/slot chip + id + type
  chips) and two SECTIONS that keep their E2E classes: .dex-detail-col-diagram
  (図解/SCHEMA) and .dex-detail-col-info (銘と効果/LORE & EFFECTS), separated by a rune
  divider. Section-head den captions dedupe when den === title.toUpperCase() (EN locale).
- ItemDetailCard.tsx: namehead/chiprow moved UP into the masthead (the component now
  renders lore sections only); the provenance micro-line becomes "<id> ・ No.NNN" so the
  info column keeps a locale-neutral id occurrence (E2E contract). localizedName exported.
- DexDiagram.tsx: grid centered on a new .dex-diagram-stage well; socket markers become
  NUMBERED dots; the floating absolutely-positioned socket labels become a static numbered
  legend below the stage (.dex-diagram-socket-labels class kept); ports legend matches.
  Callout lines dropped (they pointed into empty space; the numbers now carry the mapping).
- styles/dex.css: appended REQ-0194 section (later-wins, same convention as REQ-0075).
- i18n/dex.ts: + dex.loreTitle / dex.loreDen (en+ja, parity kept).
- e2e/dex.spec.ts: the locale-exclusivity test asserts the NAME on the detail pane
  (the masthead moved out of .dex-detail-col-info); flavor/effects assertions stay scoped
  to the info column. Test INTENT (only the active locale's text is shown) unchanged.

## E2E selector contract kept
[data-testid=dex-detail-pane] sticky in landscape; .dex-detail-col-diagram/-info visible;
.dex-detail-col-list count 0; .dex-diagram-grid-wrap fits its column and stays exactly
grid-sized (perCell math untouched); .dex-diagram-ports .dex-port-row one per port;
.dex-diagram-socket-overlay / .dex-diagram-socket-dot / .dex-diagram-socket-labels
.dex-tag-chip all present; .shape-grid-* untouched; the info column still contains id +
effects + flavor text.

## Gates (results appended when run)
- client: pnpm lint; pnpm build (tsc -b + vite)
- e2e: pnpm run e2e (box-locked full suite)
