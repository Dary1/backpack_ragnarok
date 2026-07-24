# REQ-0300 - Formation-fill 30% rule in the admincontent warning system

**Status:** todo (user 2026-07-24: "put this 30% constraint into the admincontent WARNING system").
**Builds on:** REQ-0298 (sim/lib/pack_formation.cjs -- FILL_MIN, packFill, inspectPacks; branched from it).

## HANDOFF
- SSH `ssh -i ~/.ssh/backpack_ed25519 qtie@192.168.0.6`; worktree `~/backpack_ragnarok_worktrees/req-0300-packfill-admincontent-warning` (branch same; base off REQ-0298 branch, has pack_formation.cjs). Node via nvm. STATUS: NOT STARTED.
- Gates: goldens byte-identical, sim run.cjs, server api_test (pg; needs server/.env + pnpm install in server/), content_checks tests.

## The warning system (recon)
`server/services/content_checks.cjs` `runChecks(kind, schema_ref, data)` is the PURE, DB-free content-check
engine that auto-runs on every ingested def; `server/routes/content.cjs` appends a DB-tier row + computes
`overall` and serves it; the contentadmin client renders those check rows as the per-def warnings. So the
30% rule becomes a live admincontent warning by ADDING it to runChecks() for kind monster_pack -- no new UI.

## Deliverable
1. In `content_checks.cjs`, in the monster_pack path of runChecks() (it already resolves members against
   content/live/dungeon/enemies.json), compute formation fill via REQ-0298's `sim/lib/pack_formation.cjs`
   (packFill + placeableCellsFor(FIELD_ROWS,FIELD_COLS) from sim/lib/field.cjs; FILL_MIN 0.30). If
   fillFrac < FILL_MIN, emit a WARNING/FAIL entry in the runChecks result (match the existing result shape:
   the same {ok/applicable/detail} or check-row structure the other monster_pack checks use) with a clear
   message ("formation fill 12.5% < 30% minimum -- add monsters (boss packs: boss+entourage); gimic exempt").
   Gimic content is a different kind and is never checked here (naturally exempt).
2. Keep it PURE/DB-free (read enemies.json the same way the existing monster_pack check does). Deterministic.
3. Test: content_checks unit test -- a <30% monster_pack yields the fill warning (and lowers `overall`), a
   >=30% one does not; boundary at exactly 30%. Wire into the existing content_checks test + ci.sh.
4. Verify the warning surfaces in the served check result (server/tests/api content path, or a runChecks unit
   assertion). Minimal/no client change (the UI already renders runChecks rows); if a wording/severity tweak
   is needed in contentadmin, keep it minimal.

## Acceptance
- runChecks('monster_pack', ...) on a sparse pack returns the fill warning + lowers overall; a full pack passes.
- goldens byte-identical; sim run.cjs green; content_checks tests green; api_test green (pg).
- The 30% failing packs (frost_scouts .. greenskin_warband) show the warning in admincontent.

## Out of scope
- The pack-FIX (adding monsters -- separate REQ, params confirmed: boss+entourage, add to >=30%).
- Flipping tools/inspect_pack_formation.cjs --gate to hard (ships with the pack-fix).

## Gate results
Built 2026-07-24 on branch `req-0300-packfill-admincontent-warning` (base off REQ-0298; base commit 82a11e9).
Commit: **611263c** feat(REQ-0300): add 30% formation-fill rule as a monster_pack admincontent warning row.

**Files changed**
- `server/services/content_checks.cjs` -- runChecks('monster_pack', ...) now emits a `formation_fill`
  check ROW: `packFill(data, enemyDefsById, placeableCellsFor(FIELD_ROWS,FIELD_COLS))` from REQ-0298's
  sim/lib/pack_formation.cjs over the live placeable area (384). When `fillFrac < FILL_MIN` (0.30) the row
  is not-ok and LOWERS `overall`. ADDITIVE -- schema_vocab (geometry) + engine_types (member types) are
  untouched. Resolves enemies.json with the SAME read/guard the monster_pack schema_vocab check uses; if
  unreadable, degrades to `applicable:false` (never throws). Row added ONLY for monster_pack, so gimic (a
  different kind) never gets it -> naturally exempt, no per-pack flag. Exports `formationFillCheck` +
  `_formationFillResult`.
- `server/tests/content_checks_dialect_test.cjs` -- new REQ-0300 block (4 tests: sparse<30% warns + lowers
  overall with exact string; >=30% passes; strict-`<` 30% boundary via `_formationFillResult`; gimic/non-pack
  exempt). Reconciled 2 pre-existing REQ-0184 tests that asserted *every live pack overall PASS* -> now pin
  `schema_vocab`+`engine_types` (10 live packs FAIL overall on fill BY DESIGN now). Extended the existing
  ci.sh DB-free step (line 173) -- no new file, no ci.sh change.

**Exact warning string a failing pack surfaces** (rendered as a runChecks row in contentadmin):
`formation fill 12.5% (48/384) < 30% minimum -- add monsters (boss packs: boss + entourage); gimic exempt`
(shown for grave_shamble; each pack shows its own %/cells). `overall` is lowered to FAIL by the not-ok row
(runChecks: `overall = checks.every(c => c.applicable===false || c.ok) ? PASS : FAIL`; the route recomputes
with the identical rule in content.cjs `withDbTierChecks`, so the served machine_check.overall is FAIL too).

**Gate exit codes (all green)**
| gate | result | exit |
|---|---|---|
| `node server/tests/content_checks_dialect_test.cjs` | 69 passed, 0 failed | 0 |
| `node server/tests/content_checks_geometry_test.cjs` | 24 passed, 0 failed | 0 |
| `node server/tests/content_checks_unit_deep_test.cjs` | 6 passed, 0 failed | 0 |
| `node sim/tests/goldens.cjs` | goldens OK (12 cases), BYTE-IDENTICAL, git clean | 0 |
| `node sim/tests/run.cjs` | 183 passed, 0 failed | 0 |
| `STORAGE_BACKEND=pg node server/tests/api_test.cjs` | 194 passed, 0 failed | 0 |

**Live packs now surfacing the warning** (fill < 30%, per tools/inspect_pack_formation.cjs): frost_scouts 0.5%,
rime_choir 0.8%, bear_and_stalker 1.3%, hrimgrimnir 2.3%, grave_shamble 12.5%, grave_legion 15.6%, wild_hunt
15.6%, venom_nest 16.7%, petrifying_court 16.7%, greenskin_warband 16.7% (10 total). Clean (>=30%): demon_gate
31.2%, bone_court 37.5%, titan_ridge 37.5%, deep_tide 41.7%. No client change (contentadmin already renders
runChecks rows). The pack-FIX (adding monsters to reach >=30%) remains OUT OF SCOPE (separate REQ).

