> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# Economy — v1.0 (principles only)

> Populated 2026-07-06 per owner approval. **Standing rule (owner directive,
> 2026-07-06): this document holds only change-resistant principles.** Anything
> spec-fragile — concrete TM rosters, prices, drop rates, tax percentages, caps —
> lives in REQ docs (REQ-0053 and successors) and may change without touching this
> file. If a statement here ever needs a number, it is in the wrong file.

## Identity

**Items are found; Backpacks are made.**
Instance modification (crafting) is confined to BPs — their shape, their Unit,
their HP. POs and SIs are immutable drops. This keeps PoE-grade crafting depth while
leaving the closed content vocabularies untouched: the crafting canvas is the one
object class that is already per-player instance data.

## Currency: the Transmutator family

- Every currency is a **Transmutator (TM)**: a 1×1 stackable item that physically
  occupies inventory space — wealth itself pays inventory-tetris rent (genre lesson:
  gold-takes-space).
- Every TM is **dual-use** (glossary canon): it does something concrete to a BP or a
  roll, AND serves as exchange currency. Use-value gives every currency a price
  floor; there is no abstract gold.
- The TM set is a **closed roster** curated like a vocabulary: growing it is a design
  event, not a batch detail. The live roster lives in REQ-0053.

## Faucets and sinks

- Faucets: dungeon rewards (scaling with depth), attachment rewards (chests lean
  TM-heavy — utility play pays in currency), boss firsts.
- Sinks: BP crafting operations, the BP gacha, market burn tax, and ultimately
  **Devotion** (worldview doc): the full-loss Einherjar pledge is the economy's
  terminal sink and prestige ladder.
- Invariant: at steady state, sinks must absorb the large majority of faucet output;
  the target ratio and its measurement live in REQ-0053 / S4-E1.
- **No dynamic pricing, ever.** The post-run cooldown H-curve already governs
  economic throughput (weaker play = slower economy). Prices that move by formula
  erode trust in a crafting economy; tuning happens by patch, visibly.

## Market (deployment layer: trade)

- **Barter in TMs; no abstract coin.** Price discovery is social, catalog-anchored
  (Dex-integrated listings), not auction-house-automated.
- Every trade burns a fraction of its price (the inflation valve). Deployed items
  are untradeable while deployed (same exclusivity law as deployment).
- Position: **trade is the social insurance for uniform-random reward
  distribution** — the RNG stays contribution-blind and generous-hearted; the market
  repairs mismatches between what dropped and what a build needs.

## What this economy refuses

- **No monetization.** (Standing assumption; the tentative Ragnarok concept is out
  of scope and quarantined in the worldview doc.)
- No item affixes / item levels in v1 — item power is footprint, tags, and effects,
  exactly as authored.
- No repair costs, no durability. Attrition lives inside runs (H-curve), never as a
  bill afterwards.
- No paid warehouse capacity. The warehouse is pressure, not a storefront.

## Pointers

- Volatile layer: `docs/REQ/REQ-0053-economy-v1-weathervane.md` (TM roster, numbers,
  market mechanics, migration).
- BP gacha: REQ-0042. Rewards & attachments: REQ-0049. Metrics: REQ-0050 (E-class).
- Endgame sink & seasons: `docs/worldview_ragnarok_tentative.md`.
