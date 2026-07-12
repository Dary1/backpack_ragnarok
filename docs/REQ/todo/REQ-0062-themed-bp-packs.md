> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0062 — Themed BP Packs (Workshop pack catalog)

- **Status**: USER-RULED acquisition model (2026-07-06) — implementation QUEUED.
  Extends REQ-0042's single Common gacha into a **player-chosen catalog of themed
  packs**; each content REQ declares its own pack assignment (仕分け) and this REQ
  owns the aggregate catalog.

## User spec
「開けるBPパックを選べば良くて、これらが欲しい人はBPパックそのものを選べば良い。
出現するBPパックの仕分けもそれぞれのREQに追加しておいてください。シナジーがある
ものを入れてあげるのが良い」

## Design

### Pack anatomy (content-defined, `content/live/live_packs.json`)
```jsonc
{ "id":"clockwork",
  "price":{ "tm":"weathervane", "qty":15 },          // [TUNABLE]
  "guaranteed_bp":{
     "shape":{ "cells":[3,4] },                       // size band (random-walk mint)
     "unit":{ "dirs":[1,2], "types":{ "delay":3, "divider":3, "junction":2 } } },
  "bonus":[ { "pool":"po", "table":{ "spark_candle":5, "ember_fuse":3 } } ], // 0..2 slots
  "i18n":{...} }
```
- Guaranteed slot mints a BP (REQ-0042 random-walk machinery, claim-style two-phase
  finalize unchanged); bonus slots may add POs / SI lenses / TMs — the "synergy
  bundle" the user ordered: a pack should teach its own combo by construction.
- **Transparent odds**: the pack's Dex card (REQ-0052) lists every table with
  weights — no opaque loot boxes, ever (friends-scale honesty; also future-proof
  hygiene).
- All rolls server-seeded; per-pack sub-streams (house RNG discipline).

### v1 catalog (rows owned by their REQs; this list aggregates)
| pack | contents (synergy bundle) | source REQ |
|---|---|---|
| common | existing gacha: standard unit, 4–6 cells (unchanged, default) | REQ-0042 |
| clockwork | wave-1 logic units + chain-friendly shapes + spark PO bonus | REQ-0061 |
| ember | multi-dir standard units + spark/payload PO bonuses (circuit starter) | REQ-0048 |
| prism | lens SI bonus + amplifier/splitter/condenser units | REQ-0054 / 0061 w2 |
| martyr | tanky shapes + death-will PO + testament lens bonus | REQ-0056 |
Pack lineup growth = a content-batch decision (S0 brief names the pack row), not a
code change.

### Economy discipline
- Prices premium over Common [TUNABLE ×1.5–3 in Weathervane]; every pack is a sink —
  S4-E1 monitors the faucet/sink invariant (economy.md).
- POs/SIs remain dungeon-droppable on their own tables; **unit TYPES are
  pack-only** (BPs only enter the world via packs/starter grant, so this is the
  natural consequence, not an artificial exclusive).
- [ORCH default, vetoable]: no time-limited packs, no rotation — the catalog only
  grows. Rotation is appointment pressure (retention ruling).

## Test plan
- server: pack claim two-phase per pack, odds-table schema validation (S2 extends),
  price debit atomicity, files+pg parity.
- client: E2E open each catalog pack, result modal renders bundle (BP 図解 +
  bonuses), Dex pack cards with odds.
- S4: E2-class per-pack BP audit (shape/type distributions match declared tables).
