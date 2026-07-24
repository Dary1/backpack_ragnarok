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
_(on build)_
