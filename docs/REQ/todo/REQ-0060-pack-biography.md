> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0060 — Pack Biography (+ veteran TM luck)

- **Status**: ADOPTED by user (2026-07-06, 「素晴らしい」) with a user-added
  mechanical layer: small success-probability benefits for certain special
  Transmutators, acceptable because **Devotion resets everything** (long-play-to-win
  slightly accelerated, capped by the terminal reset) — implementation QUEUED
- Origin: brainstorm batch 2 item 14. Objects with histories make Devotion's full
  loss genuinely dramatic — the emotional foundation the endgame pledge needs.

## User spec
「素晴らしい。一部の特殊transmutatorの成功確率が上がるみたいなメリットが多少あっても
いいかも。("献身"が最終目的でリセットされるので良いかも)」

## Design

### §1 The ledger (display-first)
Per BP instance, an append-only `bio` record:
- born: date + origin (gacha sealed seed / starter job / future sources)
- runsSurvived, wipes endured, bossesFelled (killing blow attributed to a hosted PO)
- trapsDisarmedAboard, chestsOpenedAboard (REQ-0049 attachment credits)
- damageTanked (lifetime), weathervaneRerolls, chiselCells added/filed
- names it has carried (BPs may be renamed later — history keeps old names)
Aggregation: derived at run settle from the replay/settlement data the server
already has (no sim change); stored on the profile BP record (storage.cjs
chokepoint; files+pg parity).

### §2 Surfaces
Dex card "Biography" section (REQ-0052 surface), warehouse rows (age), gacha modal
("day one" entry). Cosmetic wear/patina visuals: BACKLOG (art pipeline, user-gated).

### §3 Veteran luck (the user's mechanical layer)
- `bio` milestones grant **bio_luck**: a small additive success-probability bonus
  applying ONLY to future CHANCE-BASED special TMs (current roster — Weathervane/
  Chisel/File/Resin — is deterministic and stays so; the schema seat waits for the
  first gambling TM, e.g. a future "risky reshape").
- Bounds: cap [TUNABLE +10%] total; milestone curve [TUNABLE]; per-TM opt-in flag
  (`respects_bio_luck: true`) so a TM must explicitly choose to honor it.
- **Reset law**: Devotion zeroes `bio_luck` with everything else (worldview canon);
  the ledger TEXT of a devoted pack is archived to the Einherjar record — the
  history is not deleted, it is enshrined. (Display only; no mechanical carryover.)
- economy.md compliance check: this is not an item affix (item power untouched) and
  not a durability/repair bill — it is a per-instance crafting-odds modifier on the
  player's OWN tools, inside the "Backpacks are made" identity. Noted here so the
  principles file stays clean.

## Test plan
- server: settle-time bio aggregation correctness (fixtures per credit type),
  files+pg parity, migration for existing BPs (bio starts empty, born=migration).
- squad: milestone→bio_luck curve, cap, per-TM opt-in gate.
- E2E: Dex biography section renders, gacha "day one", warehouse age.
- S4: E-class addition — bio_luck distribution across a simulated account age
  matrix (verify the cap keeps veteran advantage inside [TUNABLE] band).
