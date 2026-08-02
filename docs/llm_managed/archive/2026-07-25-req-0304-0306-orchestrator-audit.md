# Orchestrated audit — REQ-0304 / REQ-0305 / REQ-0306

- Date: 2026-07-25
- Facilitator: orchestrator (Cowork)
- Method: grounded audit — one Opus (max-reasoning) subagent per REQ, each reading the REAL
  code/content on `master` and citing file:line evidence. Read-only; findings synthesized here.
- Scope: every REQ numbered >= 0304 that exists on any branch. On `master` these are exactly the
  three `todo/` items below; no REQ >= 0304 exists on any worktree branch; `reserved/` = 0146, 0210
  (old); the allocator counter last-issued = 0306.

## Verdict summary

| REQ | Title | Verdict | State action |
|-----|-------|---------|--------------|
| 0304 | Dungeon entry by attackLv only + levelMin-gated random draw (UI) | READY-WITH-FIXES | stays `todo`; spec clarified |
| 0305 | Fix <30% monster_packs + flip formation-fill gate to hard | **SUPERSEDED by REQ-0303** | moved `todo -> done` |
| 0306 | Wire powerLevel auto-adjuster dirty-trigger into deploy pipeline | READY-WITH-FIXES | stays `todo`; spec clarified |

## REQ-0304 — READY-WITH-FIXES

The described gap is real and correctly located; the anchors it names all exist.

Confirmed against code:
- `server/services/runs.cjs` `startRun` reads `room.dungeonId` + `room.level`; `server/services/rooms.cjs`
  `createRoom` REQUIRES `dungeonId` (throws "dungeonId is required"). No random draw / levelMin draw-gate
  exists anywhere in the server.
- REQ-0185 anchor `sim/dungeon_roll.cjs rollDungeon(def, level, seed, opts)` — feeding a drawn def + attackLv
  is a drop-in.
- REQ-0297 anchor `sim/lib/level_scale.cjs effLevelForPack(attackLv, powerLevel, isBoss)` = `attackLv - powerLevel
  (+ boss bonus)`, exactly as the spec states. Engine already treats `attackLv` as defaulting to `room.level`
  (`sim/lib/dungeon.cjs`).
- Dungeon defs carry `levelMin` (`content/live/dungeon/dungeons.json`: niflheim_depths=1, grave_hollows=4,
  beastreach_wilds=8). `levelMin` IS used today (count-scaling floor, schema, serving payload, UI lock chip) —
  just never as a draw gate. The spec sentence "levelMin is NOT used" is imprecise.
- Goldens are content/serving-decoupled (REQ-0301 frozen fixture), so "goldens byte-identical" is credible.

Issues:
- [MAJOR] Draw LOCATION unspecified (createRoom vs startRun). "Store the seed like genSeed" (create-time) vs
  "feed into rollDungeon" (start-time) pull in different directions. Recommended: draw in `createRoom`, persist
  the drawn `dungeonId` + a `drawSeed`, leave `startRun` untouched — zero migration for legacy rooms.
- [MAJOR] Backward-compat of the `dungeonId`-required contract undefined. Literally "no dungeonId" 400s every
  existing create path + all `schedule.cjs` api tests and `schedule.spec.ts` e2e. Spec must state the posture:
  make `dungeonId` optional; a present value = privileged/test override (gated like genSeed), not a player action.
- [MAJOR] Draw is not made deterministically testable — the api harness (`server/tests/api/harness.cjs`) authors
  ONE dungeon (levelMin 1), so "random draw", levelMin gating, and the "no eligible dungeon" error are all
  unobservable. Fix: harness gains >= 2 dungeons at differing levelMin + a privileged `drawSeed` to pin selection.
- [MINOR] Weighting left open ("uniform, or a weight field if desired") — decide (recommend: uniform v1, optional
  `drawWeight` follow-up). `levelMax` role unstated — affirm it does NOT bound eligibility. Deliverable 3
  ("surface player-facing Lv = attackLv") is already satisfied (attackLv IS `room.level`); risk of a redundant new
  field.

## REQ-0305 — SUPERSEDED by REQ-0303 (do not implement)

Every deliverable was already shipped by REQ-0303 ("monster-pack underfill fix"), merged `5a680e3`, powerLevel
recalibrated `635d55a`, marked done `538510a`, deployed + live-verified on 2026-07-24 — the same day REQ-0305 was
retro-captured, without referencing 0303.

Independently re-verified on `master` HEAD:
- `tools/inspect_pack_formation.cjs --report`: 14 packs, 14 PASS, 0 FAIL (lowest rime_choir 30.7%). All 10 packs
  REQ-0305 lists as failing now PASS; no other pack fails.
- `tools/ci.sh` line 159 runs `--gate` under `set -euo pipefail` — the hard gate REQ-0305 wants to "flip" is
  already HARD (REQ-0303 flipped it) and returns exit 0.
- `tools/autobalance_pack_powerlevel.cjs --check`: CLEAN — powerLevel already regenerated.
- REQ-0305 file makes 0 references to REQ-0303.

Implementing REQ-0305 as written would at best be a no-op and at worst double-fill already-compliant packs and
churn powerLevel for nothing.

Secondary defects found (recorded for provenance):
- [MAJOR] Threshold off-by-one: spec says ">= 115 cells". The pass predicate is `fillFrac >= 0.30` and
  0.30*384 = 115.2, so the real minimum is >= 116 cells (115/384 = 0.2995 < 0.30 FAILS). REQ-0303 states 116
  correctly.
- [MAJOR] Wrong content path: monster packs live in `content/live/dungeon/packs.json` (schema `monster_pack/1`)
  + source `content/batches/batch-002-dungeon-pilot/packs.json`, NOT `content/live/live_packs.json` (that file is
  `gacha_pack/1` — player backpacks).
- [MINOR] Non-overlap/in-bounds is enforced by `shared/content_validate.cjs validateMonsterPack`, not by the
  inspector (which only sums footprint areas); the acceptance conflates the two.

Action taken: status line updated to SUPERSEDED with evidence; file moved `todo/ -> done/`.

## REQ-0306 — READY-WITH-FIXES

The mechanism it wires is real and proven; the WIRING is under-specified.

Confirmed against code:
- `tools/autobalance_pack_powerlevel.cjs` has `--check` (compares sha256 of `content/live/dungeon/{enemies,skills,
  packs}.json` vs `content/registry.json powerlevel_calibrated_from`, read-only, exit 1 if dirty) and `--emit`
  (deterministic all-pairs round-robin, upserts every `pack.powerLevel`, re-stamps the marker, keeps REQ-0122
  lossless green). Live is currently CLEAN.
- The marker exists and hashes the correct three level-affecting files (the "skill/monster/monster_pack" set).
- Goldens decoupled from live (REQ-0301) — golden-safe confirmed.

Issues:
- [MAJOR] Deliverable 3 has no concrete content-deploy chokepoint. `deploy/` holds only ComfyUI systemd units;
  `tools/release.sh` deploys the client dist, not content; there is NO separate "live checkout" — the main
  checkout @ master IS live (backpack-api user unit serves it with mtime hot-reload). "before the live checkout is
  finalized" is therefore undefined. Fix: define the hook as the mandatory final step of the content-deploy
  runbook, run on the main checkout after any `promote_dungeon_batch.cjs`/surgical edit and before
  `systemctl --user restart backpack-api`.
- [MAJOR] Deliverable 1 says "script OR documented runbook step" — a runbook step is still a remembered manual
  action, exactly the failure the REQ exists to remove. Require a SCRIPT (`tools/predeploy_recalibrate_powerlevel.cjs`);
  a runbook line documents it, it does not replace it.
- [MAJOR] The ci advisory `--check` under `set -euo pipefail` becomes a HARD gate immediately (it exits 1 on
  dirty). Deliverable 2 wants report-only first. Spec it verbatim as `... --check || echo "[advisory] drift"` and
  define "flip to hard" as removing the guard.
- [MAJOR] `--check` is CHECKOUT-relative (ROOT = tool dir), not "the live server". On a feature branch it compares
  that worktree vs its own marker. Reword "live" -> "checkout-relative (= live only on the main checkout)". Keep
  ci advisory; put HARD enforcement in the predeploy step (a hard ci gate would block WIP branches that edited
  content before recalibrating).
- [MINOR] False-clean hole: `content/scaling_profile.json` is level-affecting to the arena but not in the sha
  dirty-set — editing it should regenerate powerLevel but `--check` reports CLEAN. Either add it to `LEVEL_FILES`
  (mechanism change; separate REQ) or scope the trigger to the three files explicitly and note scaling-profile/code
  changes still need a manual `--emit`. Additive source batches (005/006/007) carry no powerLevel — a future
  wholesale re-promotion would drift (same trap REQ-0305 touched). Marker `date` is wall-clock, so registry.json is
  not byte-reproducible across days (powerLevel/packs.json ARE) — state determinism applies to those, not the date.
- [MINOR] No test for the check->emit orchestration or the ci advisory. Require a DB-free self-test.

## Cross-cutting

- REQ-0305 and REQ-0306 share the powerLevel auto-adjuster. 0305 hand-runs `--emit`; 0306 automates it. With 0305
  superseded, 0306 is the single remaining owner of powerLevel recalibration at deploy — its "eliminate the manual
  remembered emit" motivation is only strengthened.
- REQ-0304 depends only on already-shipped anchors (REQ-0185 roll, REQ-0297 scaling); no blocking dependency.
- Ordering: 0305 removed from the queue. Remaining `todo` execution order (ascending): 0304, then 0306. No
  inter-dependency between them.
- Data-quality theme: two of the three specs shipped with STALE premises (0305 fully obsolete; 0304/0306 name
  non-existent file paths — `content/live/dungeons.json`, `content/live/packs.json`, `content/live/live_packs.json`
  for monster packs). Retro-captured specs written after the fact are the common factor; recommend a quick
  "does this already exist / are these paths real" check at ratification.

## Remediation applied (self-improvement, per user grant 2026-07-25)

Doc-only; no code, content, service restart, or deploy touched.
- REQ-0305: Status -> SUPERSEDED (evidence); `git mv todo/ -> done/`.
- REQ-0304: appended an "Audit remediation (2026-07-25)" section resolving draw-location, dungeonId back-compat,
  weighting, levelMax, the already-satisfied deliverable 3, and the testability/harness gap.
- REQ-0306: appended an "Audit remediation (2026-07-25)" section requiring a script, the `|| echo` advisory,
  the checkout-relative wording, the concrete runbook hook point, and the scaling_profile/self-test gaps.

## Open decisions left for the user

1. REQ-0304 draw location + dungeonId back-compat posture (recommended defaults recorded in the spec).
2. REQ-0306: hard enforcement in predeploy step vs ci.sh; whether `scaling_profile.json` should join the dirty-set
   (likely its own REQ).
3. Whether REQ-0305 should sit in `done/` (chosen — work is live via 0303) or a dedicated superseded bucket
   (none exists today).
