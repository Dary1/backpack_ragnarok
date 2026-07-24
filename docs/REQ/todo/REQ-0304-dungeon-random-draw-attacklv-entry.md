# REQ-0304 - Dungeon entry by attackLv only + levelMin-gated RANDOM draw (UI-enabled)

**Status:** todo (RATIFIED in chat early in the scaling design thread; retro-captured 2026-07-24 -- the
runtime scaling shipped as REQ-0293/0294/0297 but this ENTRY/DRAW flow + UI was never REQ'd).
**Relates to:** REQ-0185 (dungeon_roll), REQ-0297 (per-pack powerLevel: 出現Lv = attackLv - pack.powerLevel).

## The decision (user, verbatim intent)
"どのダンジョンに潜るかはランダムにする。最低Lv(levelMin)を満たしていることが出現条件。プレイヤーは攻略Lv
(attackLv)だけを指定する。" i.e.:
- The player sets ONLY an attackLv (a target challenge level). They do NOT pick a specific dungeon.
- The dungeon they enter is RANDOMLY DRAWN among the dungeons whose `levelMin <= attackLv` (levelMin is the
  APPEARANCE/draw condition). The dungeon THEME/種類 is a byproduct of the draw.
- attackLv + the drawn dungeon then drive the run; enemy strength is per-pack (REQ-0297): each rolled pack
  appears at effLevel = attackLv - pack.powerLevel (+ boss bonus). So strength self-normalises per attackLv
  regardless of which dungeon is drawn (dungeon.Lv is an authoring anchor; see REQ-0297).

## Current state (the gap)
`server/services/runs.cjs startRun` reads `room.dungeonId` -- a SPECIFIC dungeon chosen up front -- and
`room.level`. dungeons.json carries `levelMin` but it is NOT used as a draw gate; nothing performs a random
draw. The player/room picks the dungeon. So the ratified "attackLv-only + random levelMin-gated draw" is NOT
implemented, and the UI still selects a dungeon.

## Deliverables
1. **Server (draw):** on room creation / entry, take attackLv ONLY (no dungeonId). Deterministically (seeded)
   RANDOM-DRAW a dungeon among `{ d : d.levelMin <= attackLv }` (weighted uniform, or a weight field if desired).
   Feed the drawn dungeon + attackLv into the existing rollDungeon + per-pack scaling path. Keep the draw seed
   stored (reproducible, like genSeed). If NO dungeon is eligible (attackLv below every levelMin), a clear error.
2. **UI (contentless entry):** the schedule/sortie page lets the player set attackLv (slider/input) and press
   ENTER -> triggers the random draw; the player does NOT choose a dungeon. Reveal the drawn dungeon
   (theme/種類 + name) AFTER entry. Remove/repurpose the dungeon-picker.
3. **User-facing Lv (REQ-0297 note):** surface a friendly player-facing level = attackLv (internal
   pack.powerLevel is NOT shown; it can be negative/odd). Minimal: show the attackLv the player set.
4. **levelMin as the ONLY draw gate** (distinct from pack.powerLevel which drives strength).

## Acceptance
- Creating a run with attackLv only draws an eligible dungeon at random (deterministic per seed); ineligible
  attackLv errors clearly. api_test covers the new entry shape. goldens byte-identical (draw is a serving-layer
  concern; the sim determinism fixture is unaffected).
- The UI sets attackLv (no dungeon pick) and shows the drawn dungeon post-entry.

## Gate results
_(on build)_
