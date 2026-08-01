# batch-005-grave-legion (REQ-0203)

An undead roster DESIGNED FROM adopted artworks + the enemy-side Weakness engine.

## Ships
- `enemies.json` -- 8 `enemy/1` monster defs. Footprint = artwork `shape {w,h}`
  TRANSPOSED to `[fh,fw]=[h,w]` (verified read-only vs `artworks.shape` 2026-07-17:
  zombie/ghost/mummy/skeleton_warrior/wight/necromancer 3x4 -> [4,3]; lich 4x5 -> [5,4];
  bone_dragon 10x10 -> [10,10]).
- `skills.json` -- 16 `skill/1` defs. Three enemy-verb extensions in play:
  `lifesteal` (spectral_touch, life_drain), `bonus_vs_status` ACTIVE form (bone_cleaver,
  grave_blade), and the NEW `heal_ally` (dark_mending).
- `packs.json` -- 3 `monster_pack/1` authored layouts on B2:Y17.

## Deploy (orchestrator, post-merge)
Promote ADDITIVELY (batch-002 + REQ-0184 live content survives byte-identically), then
backfill. `wight`'s artwork is `monsters-003-flux2:wight`, so its `content_def.artwork_ref`
must be set at deploy (exactly like batch-002 `frost_gnoll` -> `monsters-003-flux2:gnoll`);
the other 7 resolve to their art by exact name. See the REQ file for exact commands.
