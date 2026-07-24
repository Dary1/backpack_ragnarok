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

## Audit remediation (2026-07-25, orchestrated audit)
Grounded audit (see docs/llm_managed/2026-07-25-req-0304-0306-orchestrator-audit.md). Verdict:
READY-WITH-FIXES. The gap and the REQ-0185/0297 anchors were code-verified. Decisions added to de-risk
implementation:
- DRAW LOCATION: execute the draw in `createRoom` (server/services/rooms.cjs). Given attackLv, select
  uniformly from `{ d in dungeonDefsById : d.levelMin <= attackLv }` using a stored `drawSeed` (crypto-random
  default; privileged `drawSeed` override gated exactly like `genSeed`). Persist the drawn `dungeonId` +
  `drawSeed` on the room; `startRun` is UNCHANGED (it keeps reading `room.dungeonId`).
- dungeonId BACK-COMPAT: `dungeonId` becomes OPTIONAL on create. Absent -> server draws. Present -> a
  privileged/test override only (not a player action); legacy rooms already carrying a dungeonId start unchanged.
  Existing server/tests schedule api tests + client/e2e/schedule.spec.ts must be updated to the attackLv entry
  shape (or exercise the override).
- WEIGHTING: uniform among eligible dungeons for v1; a per-dungeon `drawWeight` field is a follow-up (default 1).
- levelMax does NOT gate eligibility (authoring/recommendation band only); only `levelMin <= attackLv` gates.
- Deliverable 3 is ALREADY satisfied: attackLv IS the existing `room.level`/`level` field (sim/lib/dungeon.cjs);
  no new persisted field -- just remove the picker-derived `setLevel(levelMin)` coupling in SortiePage.tsx.
- TESTABILITY: the api harness (server/tests/api/harness.cjs) currently authors ONE dungeon (levelMin 1); add
  >= 2 dungeons at differing levelMin so the draw gating and the "no eligible dungeon" error branch are exercised,
  and pin selection with the privileged `drawSeed`.
- Gap wording: `levelMin` IS used today (count-scaling floor, schema, serving payload, UI lock chip) -- just never
  as a random-draw gate. No new e2e harness is added -> the 5000+3040+idx port rule is N/A.
Status unchanged (`todo`): still ready to implement, now with the above decisions pinned.
