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

**_(on build — 2026-07-25) — INTEGRATED onto green master, literal `CI GREEN`. This SUPERSEDES the
at-branch-time "BLOCKED / kept in todo/" assessment recorded below (which was true off the OLD master
@079f2c5, before REQ-0307 re-baselined the balance/e2e gates)._**
- **Integration:** REQ-0307 (green master HEAD `a0fe2e5`) merged into this branch via `git merge master`
  -> merge commit `5583c4c`. The lone overlap `client/e2e/schedule.spec.ts` auto-merged correctly,
  keeping BOTH intents: REQ-0304's attackLv-only `sortieLaunch` (no dungeon pick; waits on
  `sortie-entry`) AND REQ-0307's test-isolation (winning-canvas gate 325; sortie musters dedicated
  squads 11-14, not the shared 0-3). Verified: no conflict markers; drawSeed asserts + `winningCanvas`
  helper + squads 11-14 all present.
- **One merge interaction fixed in tests (not weakened):** REQ-0307 had re-pointed `forecast.spec.ts:206`
  ("the formation picker ranks the four slots by expected pressure") at the sortie DungeonDossier's
  `SlotPressureSummary`. REQ-0304 removed the dungeon picker/dossier by ratified design (the player no
  longer picks OR previews a dungeon pre-entry), so that pre-entry per-dungeon summary no longer exists
  in the UI (`SlotPressureSummary` is now unreferenced). The obsolete test was RETIRED (`55e4670`);
  REQ-0057's canvas ray-forecast overlay half stays fully covered (`forecast.spec.ts:41-181`, all green).
- **Dist:** client rebuilt on the merged tree (`5edbf25`, `build(web)`, deterministic; env baked in).
- **Gate:** `bash tools/ci.sh` (DATABASE_URL from `server/.env`; STORAGE_BACKEND left unset so `[4]` is
  files + `[5]` is pg; NOTHING skipped) prints literal **`CI GREEN`** (rc 0). `[2/7]` goldens
  **byte-identical (12 cases)**; `[4] api_test (files)` + `[5] api_test (pg)` green incl. the 6 REQ-0304
  draw/gate tests; `[6]` client tsc+build green; `[7/7]` scoped hermetic e2e **203 passed / 1 skipped
  (pre-existing) / 0 failed**, incl. `schedule.spec.ts:1490` "REQ-0304: attackLv-only DRAW + 4 squads".
- **New commits (this integration):** `5583c4c` merge, `55e4670` retire obsolete forecast test,
  `5edbf25` web/app rebuild, then the Gate-results + `git mv todo -> built` commits.

**Implemented on branch `req-0304-dungeon-random-draw-attacklv-entry` (worktree), off `master` @079f2c5. Commits:**
- `7cb80a5` server-side levelMin-gated random dungeon draw on attackLv-only entry (rooms.cjs `drawDungeonId`
  + optional/override `dungeonId` + persisted `drawSeed`; route drawSeed gate; api harness 2nd dungeon + tests)
- `8edb415` sortie UI sets attackLv only (dungeon picker removed); drawn dungeon revealed post-entry (+ theme chip)
- `19af54d` schedule e2e updated to the attackLv-entry shape

**What was done:** `createRoom` (server/services/rooms.cjs) now DRAWS a dungeon uniformly among
`{ d in dungeonDefsById : d.levelMin <= attackLv }` (attackLv = the existing `room.level`) via the new
exported `drawDungeonId()`, deterministic in a persisted `drawSeed` (djb2->mulberry32 through `combat.makeRng`).
`dungeonId` is now OPTIONAL: absent -> the draw; present -> a validated override (back-compat for legacy rooms,
sealed runs, tools) -- so ALL existing dungeonId-passing tests/specs keep working unchanged. `drawSeed` is
route-gated privileged EXACTLY like `genSeed`. No-eligible-dungeon -> a clear BAD_REQUEST. `startRun` is
UNCHANGED (still reads `room.dungeonId`). The sortie page no longer picks a dungeon (picker removed; the
`setLevel(levelMin)` coupling is gone); the player sets attackLv (+ ENTER) and the drawn dungeon is revealed
post-entry on the schedule monitor (name + Lv + themed banner + a new theme chip).

**REQ-0304 own coverage is GREEN (verified on the server):**
- `[4] api_test (files)` **199 passed / 0 failed** incl. 6 new REQ-0304 tests (attackLv-only draw + levelMin
  gating reaching both eligible dungeons; pinned-drawSeed determinism; drawSeed 403/allow gate; dungeonId
  override; no-eligible BAD_REQUEST). `[5] api_test (pg)` **199/0** (same 6 pass; `drawSeed` round-trips the
  jsonb blob). `[5.37] schedule_serving_test (pg)` 13/0.
- `[2] sim replay goldens` **byte-identical** (12 cases) -- the serving-layer draw does NOT move the frozen
  determinism fixture (REQ-0301), as required. `[2.65] dungeon_roll` 6/0, `[2.6] forecast_parity` 18/0,
  `[1] sim run.cjs` 184/0.
- `[6] client tsc -b + vite build` GREEN. `[7] scoped hermetic e2e` -- ALL REQ-0304 specs PASS
  (schedule.spec.ts:1453 "attackLv-only DRAW sortie", :1507 seed-field gate, :1488 squad board) AND every
  out-of-scope dungeonId-honored spec (schedule-mjolnir/market/workshop/seal) passes unchanged.

**Full literal `CI GREEN` is BLOCKED by PRE-EXISTING failures that are UNRELATED to REQ-0304 (all reproduced
on clean `master` @079f2c5, so they predate this branch; all in the shipped REQ-0293/0297 enemy-scaling /
REQ-0306 calibration domain, which REQ-0304 does not touch):**
- `[2.5] sim/tests/s4_test.cjs` "threshold classes" -- deterministic red on master (a live-content tiny matrix
  now trips a HARD balance band). `set -euo pipefail` aborts ci here.
- `[2.95] sim/tests/balance_sim_test.cjs` "(d) OP skill raises wipe vs baseline" -- deterministic red on master
  (baseline starter squad already wipes 100% at L3 -> can't be raised). Both read LIVE content (`B.loadDefs()`
  / `content/live/live_items.json`), so they reflect the shipped scaling, not REQ-0304.
- `[7] e2e` (scoped): 4 deterministic reds CONFIRMED failing on master too -- `forecast.spec.ts:206` (STALE:
  `slot-pressure` moved to the sortie page in REQ-0239, the test still checks `#/schedule`); `schedule.spec.ts`
  settled-run-replay + monitor-six-zones and `workshop.spec.ts:361` reward-LRDST (run-lifecycle: L1 niflheim
  runs now wipe / don't clear + deploy-gate 409 from accumulated deployed-squad state) -- master's own full
  serial `schedule.spec.ts` run reproduces the same 2 failures (2 failed / 28 passed). Plus canvas drag-drop
  specs (`bp-rotate`, `bp-transfer`) are parallel-load FLAKY (pass on a serial re-run).

**Recommendation:** REQ-0304 introduces ZERO new reds. The blockers are a pre-existing live-balance/calibration
regression (REQ-0293/0297 shipped scaling without re-baselining the balance/forecast/monitor/reward gates) +
one stale forecast test. Restoring literal `CI GREEN` needs those gates re-baselined in the REQ-0306 (powerLevel
auto-adjuster / calibration) domain, NOT here. This REQ is code-complete + self-green; promotion to `built/`
is held pending that re-baseline (kept in `todo/`).

_Verification harness: `bash tools/ci.sh` aborts at `[2.5]`. A diagnostic run of a /tmp COPY of ci.sh (worktree
gate untouched, /tmp copy discarded) with ONLY the two pre-existing sim reds bypassed drove every other stage
green through `[6.6]` and the full `[7]` e2e with no REQ-0304-related failure._

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

## Deploy / outcome (2026-07-25)
Merged to master (b7fd923) on green master (REQ-0307). No content deploy / migration needed (drawSeed rides the
room jsonb; the 2nd api-test dungeon is test-only). Client dist (web/app) rebuilt on the merged tree. backpack-api
restarted (systemctl --user) -- clean startup ("listening on 8802"), no errors. Live-verified: GET
/api/schedule/dungeons serves; web 8801 = 200; public tunnel https://backpack-dev.qtie.jp/app/ = 200. Post-merge
sanity on master: goldens byte-identical, api_test(files) green, s4 14/0. Full scoped ci.sh was CI GREEN on the
merged tree (worktree req-0304). NOTE: the pre-entry per-slot pressure preview (SlotPressureSummary) is removed by
the ratified random-draw design; a post-entry re-homing against the DRAWN dungeon is a possible follow-up.
