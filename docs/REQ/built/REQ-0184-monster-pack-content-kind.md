# REQ-0184 — monster-pack-content-kind: a pack is a LAYOUT, and it lives in the ledger

**Status:** built — implemented 2026-07-15, `tools/ci.sh` GREEN (incl. the client build). NOT yet
merged/deployed: the migration and the backfill are deploy steps awaiting the user's go-ahead.
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

- **`server/migrations/019_content_kind_monster_pack.sql`** — `content_kind` ENUM += `monster_pack`
  (`ADD VALUE IF NOT EXISTS`, bare top-level statement — the 010/016 precedent). Started as 018;
  renumbered to 019 when REQ-0186 landed `018_artwork_shape_lock.sql` on master mid-flight.
  Migration numbers are hand-claimed and DO collide (the tree already carries two `016_`s).
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


## Outcome (2026-07-15) — BUILT, CI GREEN, not yet deployed

**Port fidelity, proven rather than asserted.** All 34 packs in the game (the 4 ported + 30
`dungen`-generated across L1/L3/L5/L8 x 2 seeds) shift by EXACTLY +1 row / +1 col, and each
authored layout is byte-identical to the cursor placement under the corrected box. The port
transcribed the arrangement; it did not redesign it. `def_sha256` is unchanged for every golden
— the dungeon DEFINITIONS never moved, only the replay did.

**A nuance the spec got slightly wrong, corrected here.** G5 said the golden diff must be "the
uniform +1/+1 shift and nothing else". That is true of the PLACEMENT and NOT of the LOG: moving
enemies off the margin changes their distance to the walls, so ray reflections differ and event
counts move (e.g. dungen/default/L1/dg-22: 206 -> 226 events). That is inherent to the fix the
user ratified, not a second change smuggled in. The placement-level proof above is the real
acceptance test, and it is now an executable one.

### What shipped
- `019_content_kind_monster_pack.sql` — written as 018 (the tree already had two `016_`s), then
  renumbered when REQ-0186 took 018 on master mid-flight. Migration numbers are hand-claimed and
  collide; if it clashes again on merge, renumber again — nothing depends on the digits.
- `shared/content_validate.cjs`: `parseA1`/`formatA1`/`cellsFor`/`validateMonsterPackEntry` —
  ONE definition of a legal layout, imported by BOTH the machine check and `sim/lib/packs.cjs`.
  A test pins that the checker and the placer agree cell-for-cell; if they ever diverge, the
  admin would bless one board and the player would fight another.
- `content/live+batches/dungeon/packs.json` + `dungeon.json` encounters naming `packId`.
- `sim/lib/packs.cjs` layout path + the legacy cursor path locked byte-identical by test.
- `server/lib/forecast.cjs` got the SAME box correction — otherwise the forecast would predict
  a battle the sim never fights (the thing `forecast_parity.cjs` exists to prevent).
- `content_checks.cjs` monster_pack dialect; 10 new dialect tests.
- backfill source; contentadmin `KINDS` + the 26x18 board preview, with member footprints
  resolved from each monster's linked artwork (see below) and `check_pack_board.mjs` as its gate.
- Parity tests pinning the geometry constants across their three forced copies.

### Found in flight (worth keeping)
- **`validateI18n`'s locale whitelist was `{ja}`, but live dungeon content has always written
  `{en, ja}`.** Widening `SUPPORTED_LOCALES` would have silently widened what an admin PUT may
  write for items/SIs. It is now an OPTIONAL parameter; the po/si surface is provably unchanged
  (a test asserts it still refuses `en`). REQ-0161 doctrine, applied.
- **`packDefsById` was already taken** — by REQ-0170's GACHA emission pools, live in the very
  opts bag this REQ threads through. Ours is `monsterPackDefsById`. Two different things under
  one name in one bag is a bug waiting for a careless destructure. Same collision recurred in
  the test fixtures (`GOOD_PACK`) and was renamed the same way.
- **`promote_dungeon_batch.cjs` resolves its live dir via `os.homedir()`**, so running it from a
  worktree writes to the MAIN checkout (HANDS-OFF). It did; it was reverted immediately and
  re-run with an explicit `liveDir`. Anyone promoting from a worktree must pass `liveDir`.
  Likewise `sim/tests/run.cjs` reads the batch from the worktree but live/ from `os.homedir()`,
  so verifying a content REQ on a branch needs `HOME` pointed at the worktree. Both are
  pre-existing; neither is this REQ's to fix, but both cost time and should be written down.
- `sim/tests/run.cjs` hardcoded `promote() reports the 6 files`; now derived from
  `REQUIRED_FILES.length`, so the next file to join the domain does not re-break it.

### Footprints come from the ART (user instruction, 2026-07-15)

The first cut drew every member 1x1 and called it an honest gap. The user corrected it: *「関連
しているartに形状がありますよ。それを引っ張ってくるようにしてください」* — and they were right.
`artworks.shape` for a monster IS its cell grid: `server/services/art_sizing.cjs` — *"monster ->
w x h grid (each 1..12) at 128 px/cell"*, with its own ratified examples (goblin 3x4 -> 384x512,
chimera 6x4 -> 768x512, ancient dragon 10x10 -> 1280x1280). `ArtworkDto.shape` is already on the
`listArtworks()` rows the contentadmin already polls, so the data was in the room the whole time.

Resolution reuses **REQ-0174's ref-first canon verbatim** (`resolveDefArtwork`: explicit
`artwork_ref` -> exact `system_name` match), so the board resolves art the same way every other
contentadmin surface does — one canon, not a second guess. Per MEMBER, not all-or-nothing: a
pack may mix monsters that have art with monsters that do not, and the board reports exactly
which ones it had to guess (`N/M footprints from art` + `K drawn 1x1 (no art)`, and a `1x1?`
mark on the member chip itself). An unresolved footprint is still never invented.

**MIND THE TRANSPOSE.** Artwork shape is `{w,h}` = {width,height}; enemy/1 `footprint` is
`[fh,fw]` = [height,width]. The board crosses that boundary on every member, and a square
example proves nothing. `client/scripts/check_pack_board.mjs` (CI `[5.75/7]`) pins it against
art_sizing's OWN non-square examples: `{w:3,h:4}` -> `[4,3]`, a member at B2 occupying B2:**D5**
and not F3.

### Honest gap — the two rosters do not meet yet

**None of the 4 ported packs resolve a single footprint today**, because the batch-002 roster has
**zero artwork rows**. The two rosters are currently disjoint:

| | monsters | has enemy/1 `footprint` | has artwork `shape` |
|---|---|---|---|
| batch-002 (what the packs field) | 7 (`frost_gnoll`…`hrimgrimnir`) | yes ([1,1]…[3,3]) | **no** |
| the art registry | 66 (`basilisk`, `bone_dragon`, …) | **no** | yes ({w,h}, 1..12) |

So the mechanism is wired, tested and correct, and on the batch-002 packs the board still draws
1x1 and says so — not because the code cannot resolve, but because the art does not exist. It
will light up for any pack built from the art roster.

### Ruling needed: one fact, two sources

A monster's size in cells is now written in **two places** — enemy/1 `footprint` and artwork
`shape` — and they are not derived from each other. Today nothing can disagree (the rosters are
disjoint), but the moment one monster has both, **the board would draw the art's size while the
sim places by the def's footprint**: the admin blesses one board, the player fights another.
That is the exact failure this REQ spent its whole budget eliminating between the checker and
the placer, reappearing one layer up. Options, for a follow-up REQ:
1. **Art is authoritative** — enemy/1 `footprint` is derived from `artworks.shape` at backfill/
   promote time; the def stops carrying an independent copy.
2. **Def is authoritative** — the artwork's shape is set from the def; art generation reads it.
3. **Neither; make them reconcile** — a machine check FAILs a monster whose def footprint and
   artwork shape disagree, so the duplication stays but can never drift silently.
Recommend (3) as the immediate guard (cheap, catches drift the day it appears) plus (1) as the
real fix. Not decided here — it needs the user's ruling and it is not this REQ's scope.

Also unchanged and shared with every kind: adopting a variant writes
`content/registry_exports/`, NOT `content/live/dungeon/packs.json`. That is REQ-0155's un-wired
S7 step, equal for all kinds; the sim still reads the live file.

### Gate results
`tools/ci.sh` **GREEN** (`SKIP_PG=1 SKIP_E2E=1`, incl. the client typecheck+build).
sim 117 pass · goldens 12 rebaselined · S4 14 pass, GATE PASS (warn-only, no new hard fails) ·
forecast parity 16 pass · dialect 34 pass · backfill 11 pass · server tsc clean.
**Not run:** the PG pass and the live backfill — they touch the live DB, which is a deploy step
(`built` = gates green, not deployed). G1/G6 close on deploy.

## Deploy record (2026-07-17, orchestrator, user go-ahead)
Merged to master (91171da; VariantCard.tsx hand-merged: REQ-0182b grant + REQ-0184 footprints both kept; REQ-0188 doc restored from git dir-rename mis-detection). Migration 019 applied via supabase-db (ALTER TYPE as postgres; pooler role lacks ownership). Backfill: monster_pack=4 PASS/adopted. CI GREEN post-merge. Awaiting S7.
