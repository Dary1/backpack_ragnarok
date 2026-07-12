# REQ-0008: Genre Research + Item Spec Draft + Canvas Mock v0.1

- **Status**: Completed (item spec + mock await user review)
- **Date**: 2026-07-02
- **Owner**: orchestrator + 2 subagents (autonomous batch; user away, no questions allowed)

## Sub-results

### 1. Ratifications applied (start of batch)
- `first_golden.md` → **v2** (All Green; v1 archived inside the file).
- `glossary.md` → **v1.0 RATIFIED** (BP = BackPack confirmed).

### 2. Genre research (subagent: research analyst, ~124k tokens)
- `docs/research/backpack_genre_item_study.md` (442 lines). Sources: backpackhero.wiki.gg,
  backpack-hero fandom, backpackbattles.wiki.gg, backpackbrawl.wiki.gg, namu.wiki, Steam
  guides. Covers shapes, bag growth, tag taxonomy, 5 synergy pattern families, stat/status
  conventions, rarity/upgrades/recipes, economy loops, UX conventions, 12 design lessons.
- Key lessons adopted: tags-not-items synergy referencing; event-verb effect grammar;
  positional semantics scoped to one BP; deterministic visible resolution order;
  shape distribution as the real rarity curve.

### 3. Item spec draft (orchestrator)
- `docs/item_spec_draft.md` v0.1: item definition, 2-axis tags (Type × Element),
  shape policy, effect template grammar, status set (Burn/Poison/Chill/Regen/Spikes),
  L1 combo patterns (adjacent-to-tag, element reaction Ignite, self-stacking count),
  resolution order, BP HP placeholder (pieces × 5), 11-item mock catalog.

### 4. Item icons (subagent: item designer)
- `item_icons.svg` sprite, 12 symbols, flat fantasy style, validated XML (14.7 KB).
  (Lives embedded in the deployed mock; source kept in session outputs only — graphics
  belong to code, which lives on the server per user directive.)

### 5. Canvas Mock v0.1 (orchestrator) — LIVE
- **URL: https://backpack-dev.qtie.jp/mock/** (root index links to it). HTTP 200 +
  visual check via Chrome done.
- Server path: `~/backpack_ragnarok/web/mock/index.html` (single file, sprite inlined).
- Shows (per user task 2/5): 6×6 Canvas; 4 BPs (Alpha 6pc / Beta 6pc / Gamma 6pc /
  Delta 4pc, HP = pieces×5); exactly one Linker per BP with direction pips; live beam
  tracing — Alpha⇄Beta MUTUAL (dirs 1/5), Alpha→Gamma (dir 4), Gamma→Delta (dir 2,
  passing over a dagger + dead space), 2 intentional duds (Gamma dir 3, Delta dir 7);
  items per spec incl. 1×3 Greatsword (big-item/big-BP demo), 3-Fang self-stack,
  Ignite combo (Flame Rune + Oil Flask); hover tooltips; item catalog panel;
  rules-in-force panel; toggles (beams / combos / resolution order).

## Notes for next session (memory recovery)
- Mock data model in the page's `const BPS/CATALOG/COMBOS` doubles as the first
  data-model draft.
- Beam tracing algorithm implemented generically (walk dir until edge or Linker).

## Next
- User reviews: item spec v0.1 + mock (sync check). Expected follow-ups: Linker
  types/effects design (items now exist to anchor it), combat tick spec, then T0 slice.
