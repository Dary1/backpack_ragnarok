# batch-007-deepstone-legions (REQ-0219)

A tide/petrify/greenskin/titan roster DESIGNED FROM adopted artworks. Pure content,
**expected engine delta ZERO** -- every verb/trigger/status already exists (strike /
multi_strike / lifesteal / bonus_vs_status / apply_status / heal_ally; statuses Chill,
Stun, Weakness). No engine, sim, forecast, or vocab change.

## Ships
- `enemies.json` -- 17 `enemy/1` monster defs. Footprint = artwork `shape {w,h}` TRANSPOSED
  to `[fh,fw]=[h,w]` (verified read-only vs `artworks.shape` 2026-07-17: kraken 10x10 -> [10,10];
  behemoth 8x8 -> [8,8]; sea_serpent 6x6 -> [6,6]; medusa/lamia/ogre 4x4 -> [4,4];
  frost_giant/cyclops 5x6 -> [6,5]; stone_golem/troll 4x5 -> [5,4]; giant_crab 4x3 -> [3,4];
  sahuagin/cockatrice/goblin/goblin_shaman/kobold/orc_warrior 3x4 -> [4,3]).
- `skills.json` -- 31 `skill/1` defs. Four synergy engines: Chill convert at sea (deep tide),
  Stun convert (petrifying court), swarm tempo + heal_ally + Weakness convert (greenskin warband),
  big hits + Chill convert (titan ridge).
- `packs.json` -- 4 `monster_pack/1` authored layouts on B2:Y17.

## Deploy (orchestrator, post-merge)
Promote ADDITIVELY on top of the current live (batch-002 + batch-005 + batch-006 = 27/50/10
survive byte-identically) -> 44/81/14, then backfill. FOUR `content_def.artwork_ref` must be
set at deploy (bare art names are unadopted; the adopted art is namespaced): `cockatrice` ->
`monsters-003-flux2:cockatrice`, `goblin` -> `monsters-003-flux2:goblin`, `goblin_shaman` ->
`monsters-003-flux2:goblin_shaman`, `ogre` -> `monsters-003-flux2:ogre` (exactly the batch-006
boar precedent). The other 13 resolve to their art by exact name. Backfill FIRST, then PATCH the
refs (backfill resets artwork_ref on ingest). See the REQ file for exact commands.
