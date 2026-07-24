# REQ-0298 - Monster-pack formation-fill inspection (system-side output mechanism)

**Status:** todo (user-ratified 2026-07-24). User: "build a system-side mechanism that PROPERLY
OUTPUTS these results" (replacing an ad-hoc analysis). This is the backend the admincontent
visualisation (follow-up REQ) will consume; and the rule that makes sparse packs illegal going forward.

## HANDOFF / RECOVERY
- Server SSH: `ssh -i ~/.ssh/backpack_ed25519 -o StrictHostKeyChecking=no qtie@192.168.0.6`.
- Worktree: `~/backpack_ragnarok_worktrees/req-0298-pack-formation-fill-inspection` (branch same; base 75cca14; off master which has REQ-0296/0297 merged).
- Node via nvm: `export NVM_DIR=~/.nvm; . "$NVM_DIR/nvm.sh"`. sim/ dependency-free.
- Gates: `node sim/tests/goldens.cjs` (byte-identical), `node sim/tests/run.cjs`, plus the new tool + test.
- STATUS: NOT STARTED.

## The rule (ratified)
A monster_pack is INVALID if its formation fills < **30%** of the enemy placeable area. GIMIC content
is EXEMPT (the rule applies to monster_pack content only). 30% is a DATA-tunable constant (FILL_MIN).

## Definitions (confirmed against live data)
- A monster_pack has `members: [{enemy, at}]`. A member occupies the ENEMY's footprint (enemies.json
  `footprint:[h,w]`) anchored at `at`. Occupied cells = SUM over members of h*w.
- Placeable area = the enemy field's placeable region B2:Y17 = 24x16 = 384 cells. DERIVE it from the sim
  field constants (FIELD_ROWS/FIELD_COLS -> placeable = (COLS-2)*(ROWS-2)); do NOT hardcode 384.
- fillFrac = occupiedCells / placeableCells. Pass iff fillFrac >= FILL_MIN (0.30).
- Current live snapshot (for the test's expected shape; 11/14 FAIL): frost_scouts 0.5%, rime_choir 0.8%,
  bear_and_stalker 1.3%, hrimgrimnir(boss) 2.3%, grave_shamble 12.5%, grave_legion/wild_hunt 15.6%,
  venom_nest/petrifying_court/greenskin_warband 16.7% [FAIL]; demon_gate 31.2%, bone_court 37.5%,
  titan_ridge 37.5%, deep_tide 41.7% [ok].

## Deliverables (this REQ = the OUTPUT MECHANISM; NOT the pack-fix, NOT the UI)
1. **Pure module** `sim/lib/pack_formation.cjs` (or server/lib): `packFill(packDef, enemyDefsById, {placeableCells})`
   -> `{ occupiedCells, placeableCells, fillFrac, members }`; `inspectPacks(packs[], enemyDefsById, opts)`
   -> per-pack `{ id, occupiedCells, placeableCells, fillFrac, pass, exempt }` + a summary. FILL_MIN a named
   export (0.30). Deterministic, dependency-free.
2. **Tool** `tools/inspect_pack_formation.cjs`: loads live content, runs inspectPacks, and outputs:
   - `--report` : human table (pack, members, cells, fill%, PASS/FAIL) sorted by fill%.
   - `--json`   : structured `{ fillMin, placeableCells, packs:[...], summary:{ total, failing, failingIds } }`
     -- the STABLE contract the admincontent view consumes. Deterministic (no timestamps in the data).
   - `--gate`   : exit 1 if any non-exempt monster_pack is below FILL_MIN (so ci.sh can FORBID sparse packs
     going forward). Wire a step into `tools/ci.sh` running `--gate` in REPORT-ONLY first (advisory: prints the
     failing list, exits 0) because 11/14 live packs currently FAIL -- flipping it to a hard gate happens with
     the pack-fix follow-up REQ. Make the advisory-vs-hard mode a clear flag.
3. **Test** (sim/tests, wired into run.cjs): packFill math (a synthetic pack of known footprints -> exact
   cells/fill), the 30% boundary, gimic-exempt, and the --json shape. Fast + deterministic.
4. Goldens BYTE-IDENTICAL (this REQ adds a tool/module/test only; touches no runtime scaling).

## Out of scope (follow-ups)
- Adding monsters to the 11 failing packs (a content-authoring REQ; needs the design call on how dense +
  boss-pack handling -- boss hrimgrimnir currently FAILs).
- The admincontent VISUALISATION (a UI REQ consuming this tool's --json / an admin endpoint serving it).

## Acceptance
- `node tools/inspect_pack_formation.cjs --report` prints the 14-pack table matching the snapshot above.
- `--json` emits the stable structured contract; `--gate` (advisory) lists the 11 failing ids, exits 0.
- Unit tests green; goldens byte-identical; sim/tests/run.cjs green.

## Gate results / commit hashes
**Built 2026-07-24.** Output MECHANISM only (pure module + tool + unit test); NO
runtime touched -- goldens byte-identical. Status stays `todo` (folder not moved).

**Commits** (since 75cca14):
- `47b27c7` feat(REQ-0298): pure pack_formation inspector + tool + unit test
- `7151d57` feat(REQ-0298): wire formation-fill test into run.cjs + advisory step into ci.sh
- (this) docs(REQ-0298): record gate results

**Files:**
- NEW `sim/lib/pack_formation.cjs` -- pure module: `FILL_MIN` (0.30), `placeableCellsFor(rows,cols)`, `packFill(packDef, enemyDefsById, placeableCells)`, `inspectPacks(packs, enemyDefsById, {placeableCells, fillMin})`.
- NEW `tools/inspect_pack_formation.cjs` -- `--report` / `--json` / `--gate` / `--advisory` (default) / `--self-test`.
- NEW `sim/tests/req0298_pack_formation_test.cjs` -- 6 unit cases (packFill math, 30% boundary, placeableCells derivation, --json summary shape).
- MOD `sim/tests/run.cjs` -- register the sibling test (rolls into suite totals).
- MOD `tools/ci.sh` -- new `[3.996/7]` step: `--self-test` then `--advisory` (report-only, exit 0).

**`node tools/inspect_pack_formation.cjs --report`** (reproduces the ratified snapshot, incl. banker-rounded demon_gate 31.25% -> 31.2%):
```
pack               members    cells  fill%  result
frost_scouts             2    2/384   0.5%  FAIL
rime_choir               3    3/384   0.8%  FAIL
bear_and_stalker         2    5/384   1.3%  FAIL
hrimgrimnir              1    9/384   2.3%  FAIL
grave_shamble            4   48/384  12.5%  FAIL
grave_legion             5   60/384  15.6%  FAIL
wild_hunt                4   60/384  15.6%  FAIL
venom_nest               4   64/384  16.7%  FAIL
petrifying_court         4   64/384  16.7%  FAIL
greenskin_warband        5   64/384  16.7%  FAIL
demon_gate               5  120/384  31.2%  PASS
bone_court               4  144/384  37.5%  PASS
titan_ridge              4  144/384  37.5%  PASS
deep_tide                4  160/384  41.7%  PASS

summary: 14 packs, 4 pass, 10 fail  (FILL_MIN 30.0%, placeable 384 cells)
```

**Gates:**
- `--gate` exit **1** (`GATE FAIL: 10 monster_pack(s) below FILL_MIN (30.0%)`); `--advisory`/default exit **0**; `--json` exit 0; `--self-test` exit 0 (10 checks PASS).
- `--json` stable contract: `{ fillMin: 0.3, placeableCells: 384, packs:[{id,memberCount,occupiedCells,placeableCells,fillFrac,pass}...14], summary:{ total: 14, failing: 10, failingIds:[pack_frost_scouts..pack_greenskin_warband] } }` (input/file order; no timestamps).
- `node sim/tests/goldens.cjs` -> `goldens OK (12 cases, replay determinism intact)` -- **BYTE-IDENTICAL** (golden hash file untouched).
- `node sim/tests/run.cjs` -> `183 passed, 0 failed` (incl. the 6 REQ-0298 cases).

**Deviation (fail count):** the prose above says "11/14 FAIL", but the actual
computed result is **10 FAIL / 4 PASS**. This matches the per-pack snapshot itself,
which lists 10 failing packs (frost_scouts..greenskin_warband) and 4 passing
(demon_gate / bone_court / titan_ridge / deep_tide) -- 14 - 4 = 10. The tool
reports 10 failing; "11" in the prose is an off-by-one. All 14 per-pack
percentages match the snapshot exactly.
