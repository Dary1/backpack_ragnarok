# batch-006-wildlands (REQ-0207)

A wildlands beast/vermin/demon roster DESIGNED FROM adopted artworks. Pure content,
**expected engine delta ZERO** -- every verb/trigger/status already exists post-REQ-0203
(lifesteal / bonus_vs_status / apply_status / strike / multi_strike; statuses Poison, Burn,
Stun, Weakness). No engine, sim, forecast, or vocab change.

## Ships
- `enemies.json` -- 12 `enemy/1` monster defs. Footprint = artwork `shape {w,h}` TRANSPOSED
  to `[fh,fw]=[h,w]` (verified read-only vs `artworks.shape` 2026-07-17: werewolf/giant_snake/
  gargoyle/dullahan 4x4 -> [4,4]; dire_wolf 5x4 -> [4,5]; boar/giant_bat/giant_spider/
  giant_scorpion 4x3 -> [3,4]; basilisk 6x4 -> [4,6]; imp 3x4 -> [4,3]; demon_lord 8x8 -> [8,8]).
- `skills.json` -- 20 `skill/1` defs. Three synergy engines: lifesteal tempo (wild hunt),
  Poison convert (venom nest), Burn convert (demon gate).
- `packs.json` -- 3 `monster_pack/1` authored layouts on B2:Y17.

## Deploy (orchestrator, post-merge)
Promote ADDITIVELY on top of the current live (batch-002 + batch-005 = 15/30/7 survive
byte-identically) -> 27/50/10, then backfill. `boar`'s artwork is `monsters-003-flux2:boar`
and `giant_snake`'s is `monsters-003-flux2:giant_snake`, so those two `content_def.artwork_ref`
must be set at deploy (exactly like batch-005 `wight` -> `monsters-003-flux2:wight`); the other
10 resolve to their art by exact name. See the REQ file for exact commands.
