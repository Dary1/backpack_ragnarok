# REQ-0184 — monster-pack-content-kind: a pack is a LAYOUT, and it lives in the ledger

**Status:** todo — ratified in chat by the user 2026-07-15 (all four rulings below). Cleared to
implement.
**Reserved:** 2026-07-15
**Slug:** monster-pack-content-kind
**Requested by:** user, 2026-07-15 (chat): add a `monster_pack` kind to the Content Data
Registry — *"a pack of monsters is a layout of monsters on the placable battle field of 24x16
(with margin of 1. the battle field itself is 26x18)"* — and *"port the data"* that already
defines the monsters appearing on a dungeon dispatch.
**Depends on:** REQ-0155 (the content-data registry), REQ-0157/0164/0173 (its admin UX),
REQ-0171 (the closest precedent: a kind whose machine checks REUSE a shared validator).
**Spawns:** REQ-0185 (dungeon becomes pre-generated content) — this REQ builds the `packId`
seam that REQ-0185 consumes.

## Goal

A monster pack — WHICH monsters, and **WHERE each one stands** — becomes first-class content in
the ledger, and the sim places from that layout instead of inventing one.

## Rulings (user, 2026-07-15 chat)

1. **Coordinates: A1 notation.** `members: [{enemy, at: "F5"}]` — the same spelling
   `formations.json` already uses for player canvases (`"F2:M9"`). Human-readable and editable
   in the admin; occupied cells are derived from the enemy def's `footprint`.
2. **The sim CONSUMES the layout.** `packs.cjs` places from `members[]` when the pack carries
   one. This is a real behaviour change: goldens rebaseline, S4 re-runs.
3. **Phased.** This REQ = the kind + the port + sim consumption. `dungen`'s runtime pack
   assembly is NOT touched here — it became REQ-0185 (and, per the user's 2026-07-15
   follow-up, grew into "dungeons are pre-generated content").
4. **24x16 is canon; the current placement is the bug.** See § The finding.

## The finding (what the port actually uncovered)

`encounter.cjs` hands `compileEnemyPack()` a box of `{rowMin:1, colMin:1, rowMax:18, colMax:26}`
— **the whole A1:Z18 plane, margin included** — and the compiler fills it left-to-right from the
top-left. So every enemy in the game today stands ON the margin:

| pack | placement TODAY (derived) | in B2:Y17? |
|---|---|---|
| `enc_pack_1` | `frost_gnoll` A1 · `ice_archer` B1 | no — row 1 is margin |
| `enc_pack_2` | `rime_shaman` A1 · `glacier_wisp` B1 · `glacier_wisp` C1 | no |
| `enc_pack_3` | `frostback_bear` A1:B2 (fp 2x2) · `niflheim_stalker` C1 | no |
| `enc_boss` | `hrimgrimnir` A1:C3 (fp 3x3) | no |

All four, without exception. "Port today's placement verbatim" and "fit the 24x16 placeable
area" are therefore mutually exclusive, and the user ruled: **24x16 (B2:Y17) is canon, the
margin-riding is a bug, fix it.** `enemyFieldBox` becomes `{rowMin:2, colMin:2, rowMax:17,
colMax:25}`.

## The port is a PORT, not a rebalance

The new layouts preserve today's RELATIVE arrangement exactly and move the origin A1 -> B2.
Nothing else. Re-composing the packs (anchor forward, support behind, spread against AoE) is a
GAME-DESIGN decision the user has not asked for, and smuggling it into a port would make the
golden diff unreadable — you could no longer tell "the port moved the pack" from "the port
changed the game". A deliberate re-composition is a follow-up REQ with its own ratification.

| pack | ported layout |
|---|---|
| `enc_pack_1` | `frost_gnoll` B2 · `ice_archer` C2 |
| `enc_pack_2` | `rime_shaman` B2 · `glacier_wisp` C2 · `glacier_wisp` D2 |
| `enc_pack_3` | `frostback_bear` B2 (2x2 -> B2:C3) · `niflheim_stalker` D2 |
| `enc_boss` | `hrimgrimnir` B2 (3x3 -> B2:D4) |

**Expected golden diff: a uniform +1 row / +1 col shift of every enemy, and nothing else.** That
is the acceptance test for "this was a port". Any other movement in the diff is a bug in this
REQ, not a rebalance.

## What a monster_pack variant carries (`monster_pack/1`)

| field | notes |
|---|---|
| `id` / `name` / `i18n.ja` | as every kind |
| `members[]` | **the reason the kind exists**: `{enemy, at}` — the monster REFERENCE and its A1 ANCHOR. Order is stable (it names the instance: `frost_gnoll#0`) |
| `note` | free-text authoring note, carried verbatim |

Occupied cells are **derived** from `footprint`, never stored — the same doctrine as REQ-0171's
"probability is derived, never stored". Storing both the anchor and the cell list would be two
sources of truth for one fact, and a def whose `footprint` later changes would start lying.

## Ships

- **`server/migrations/018_content_kind_monster_pack.sql`** — `content_kind` ENUM += `monster_pack`
  (`ADD VALUE IF NOT EXISTS`, bare top-level statement — the 010/016 precedent). Note the tree
  has TWO `016_` files already; this takes 018.
- **`shared/content_validate.cjs`** — `parseA1`/`cellsFor` + `validateMonsterPackEntry()`: A1
  parse, bounds B2:Y17, footprint-aware OVERLAP detection, every `enemy` must resolve to a live
  enemy def. ONE executable definition of "a legal pack layout", reused by both the machine
  check and the sim — the REQ-0171 lesson (two copies drift, and the drift is invisible).
- **`server/services/content_checks.cjs`** — the `monster_pack/1` dialect + wiring:
  `schema_vocab` REUSES `validateMonsterPackEntry`; `engine_types` APPLIES (`packs.cjs`
  dereferences `members[].at`); `gen_data` / `integrate` honest `applicable:false`.
- **`sim/lib/packs.cjs`** — `compileEnemyPack()` places from `members[]` when present; the legacy
  `enemyIds` cursor path stays byte-identical for callers that have no layout (that path is what
  REQ-0185 retires).
- **`sim/lib/encounter.cjs`** — `enemyFieldBox` -> B2:Y17; resolve `enemyPack.packId` against the
  pack defs, else legacy `enemyIds`.
- **`content/live/dungeon/packs.json`** — new, `monster_pack/1`, the 4 ported packs.
- **`content/live/dungeon/dungeon.json`** — encounters reference `packId`. Single source of
  truth: the pack lives in `packs.json`, not duplicated inline.
- **`tools/backfill_content_registry.cjs`** — new source `monster_pack <- content/live/dungeon/packs.json`.
- **contentadmin** — `monster_pack` in `KINDS`/`SCHEMA_REF_DEFAULTS`, and an `EntityPreview` that
  renders a pack AS A BOARD: 26x18 grid, the B2:Y17 placeable area marked, each member drawn at
  its real footprint.

## Gates

- G1 ENUM applied; a `monster_pack` def round-trips through the ledger (create -> ingest ->
  check -> adopt).
- G2 checks: out-of-bounds anchor FAILs BY NAME; overlapping members FAIL; unknown `enemy` id
  FAILs; a malformed A1 token FAILs; the 4 ported packs PASS.
- G3 ONE validator: the sim and the machine check import the SAME `validateMonsterPackEntry` /
  A1 parser. A test asserts the sim's derived cells equal the validator's.
- G4 sim: a pack WITH a layout places at its anchors; a pack WITHOUT one is byte-identical to
  the pre-REQ cursor path (the legacy contract REQ-0185 will retire).
- G5 goldens rebaselined + S4 re-run. **The diff must be the uniform +1/+1 shift and nothing
  else** (§ The port is a PORT).
- G6 backfill: `monster_pack` = 4, all PASS, all adopted.
- G7 `tools/ci.sh` green.
- S7 user acceptance in the admin on backpack-dev.

## Out of scope

- `dungen.cjs` runtime pack assembly -> **REQ-0185**.
- Re-composing the packs as game design (§ The port is a PORT).
- The `content/live` export gap — REQ-0155's un-wired S7 step, equal for every kind.

## Risks

- **The golden diff is the deliverable's honesty check.** If it shows anything beyond the
  uniform shift, the port changed the game and must be re-examined before merge.
- S4 verdict warns may move (`heatmap`, `formationEquity`). Pre-existing warns are recorded in
  `sim/s4_baselines/default/summary.json`; this REQ compares against them rather than treating
  any warn as new.
