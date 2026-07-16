# REQ-0188 — art-authoritative cell geometry: one fact, one source, and it is the art

**Status:** todo — ratified by the user 2026-07-15 (both rulings below). Cleared to implement.
**Reserved:** 2026-07-15
**Slug:** monster-size-art-authoritative (the slug says monster; the ruled SCOPE is monster + po)
**Requested by:** user, 2026-07-15 (chat): **「art を正」**, then Q1 = *「seed最大値で、artworkに
移してください（seed最大値=不明環境で作られた）」*, Q2 = **monster + po 両方**.
**Depends on:** REQ-0184 (surfaced the conflict; its board is the first consumer), REQ-0151
(the artwork registry), REQ-0177 (the backfill + the seed sentinel this REQ reuses).
**Doctrine:** continues **REQ-0029** verbatim — *"the art is authoritative; fix the CELL SHAPE
side"* (art_golden v3.3). REQ-0029 made it editorial; this REQ makes it structural.

## Rulings
1. **Art is the authority** for a thing's cell geometry. The def's shape/footprint stops being
   an independent fact.
2. **Scope = monster + po.** Both carry the duplication; REQ-0029 already ruled on po.
3. **Coverage is seeded, not commissioned.** Content that has no artwork row gets one seeded
   from its current def geometry — a ONE-TIME flip of the direction of truth — marked with
   REQ-0177's unknown-environment convention (§ The seed).

## The dry-run came back clean — there is NO drift to repair

Before writing a line, `po_def.shape` was diffed against its artwork's `shape.mask` for every
live PO (normalised, engine `[row,col]` convention per REQ-0029 Case A):

|  | count |
|---|---|
| **AGREE** | **8** |
| **DISAGREE** | **0** |
| po defs with NO artwork row | 16 |
| artworks with no mask | 0 |

**Zero disagreements.** So making art authoritative is, for everything that has art today, a
provable **no-op** — the doctrine is already honoured in the data. The risk this REQ was drafted
to fear ("regenerating po shapes churns correct live content") does not exist. That inverts the
job: this REQ is not a repair, it is **a guard plus coverage**.

## The real problem is COVERAGE, not conflict

| | items | has def geometry | has artwork row |
|---|---|---|---|
| batch-002 monsters (what the live packs field) | 7 | yes | **0 of 7** |
| po (live_items + dungeon items + starter items) | 24 | yes | **8 of 24** |

The 7 monsters have no art anywhere — not in the registry, and not in `sprite_all_v12.svg`
either (its 22 icons are all po/si + `unit_core`; there has never been a monster sprite). So the
authority simply has no row to be authoritative WITH. That, not drift, is what blocks the ruling.

## The seed (user ruling Q1)

`renders.seed = 2147483647` (int4 max) is the project's EXISTING marker for
*"imported from an unknown environment"* — `server/storage_art.cjs:190`, established by
**REQ-0177**, which used it for exactly this move (15 renders backfilled out of
`sprite_all_v12.svg`). This REQ reuses it rather than inventing a second dialect for the same
idea.

**One honest wrinkle to settle in implementation.** REQ-0177's sentinel marks a RENDER — it had
PNG bytes with an unreproducible origin. The 7 monsters have **no image at all**, so there is no
render to mark; an artwork row legitimately exists with `adopted_render_id NULL` (most of the 66
monster artworks already do). So:
- the artwork ROW is seeded (`kind`, `shape` from the def's geometry, `main_object`/prompt from
  the def) — this is the part that carries the ruling;
- **no render is fabricated.** Inventing an image row for a monster with no image would be a lie
  in exactly the register this codebase refuses (REQ-0160's "honest `applicable:false`, never a
  free PASS").
- The sentinel therefore applies to the 16 POs that DO have sprite art to import, and to any
  future import; a shape-only monster row records its unknown provenance in the seed tool's
  provenance/params, not by faking a render. **Flagged for the user — if a shape-only artwork
  row should carry a sentinel render placeholder anyway, say so and it changes.**

## The constraint that shapes the design

**The sim cannot read the database.** PROJECT.md: *"sim/ and mock-src/ are dependency-free by
invariant"*; `sim/dungen.cjs` resolves content through the filesystem. So "art is authoritative"
CANNOT mean the sim reads `artworks.shape` at runtime. It means:

> art (DB) = source → tool derives → `enemies.json` `footprint` / `live_items.json` `shape`
> = **generated mirror** → sim + engine read the files, unchanged.

Same shape as `promote_dungeon_batch.cjs` (copy-with-provenance); same honesty rule as
REQ-0171's derived percentages — the mirror is generated, never hand-edited.

## Ships

- **`content_checks.cjs` drift guard (land this FIRST — it is valuable even alone).** A
  `monster_def` / `po_def` whose def geometry disagrees with its linked artwork's shape FAILs,
  naming both sides and both spellings. Today it is green across the board (0 disagreements), so
  it lands quiet and stays quiet — and it catches the drift the DAY it appears rather than the
  day a player notices. Reuses REQ-0174's ref-first `resolveDefArtwork` canon.
- **`tools/seed_artwork_from_def.cjs`** — creates the missing artwork rows (7 monsters + 16 POs)
  from current def geometry. Explicitly a SEED: it refuses to touch a row that already exists,
  logs every write, and is a one-shot (after it, the direction of truth is art → def, forever).
- **`tools/derive_def_geometry.cjs`** — the mirror generator: `artworks.shape` → `footprint` /
  `shape` in the content files. A no-op on today's data BY CONSTRUCTION, which is the acceptance
  test: run it, and `git diff` must be empty for all 8 already-agreeing POs.
- **REQ-0184's board** then stops resolving art per member and trusts `footprint` again, because
  by then they are provably the same number.

## THE risk: the transpose

Three spellings of one fact, and every conversion crosses them:

| | spelling |
|---|---|
| artwork monster | `{w, h}` = width, height |
| artwork po | `{mask: 5x5 bool}` = `[row][col]` |
| enemy/1 | `footprint: [fh, fw]` = height, width |
| po/2 | `shape: [[r, c]]` |

**REQ-0029 WAS a transposition bug** — `[row,col]` read as `[col,row]` — that mis-measured 12/14
masks and manufactured a fake "stale art" crisis out of art that was correct all along. A square
example proves nothing. Every conversion here gets pinned against non-square fixtures, exactly as
REQ-0184's `client/scripts/check_pack_board.mjs` does (`{w:3,h:4}` → `[4,3]`; a member at B2
owning B2:**D5**, not F3).

## Gates
- G1 drift guard: green on all live content today; a hand-transposed def FAILs naming both sides.
- G2 seed: 7 monster + 16 po rows created; re-running is a no-op; an existing row is never touched.
- G3 mirror: `derive_def_geometry` on today's data produces an EMPTY diff (the no-op proof).
- G4 transpose: non-square fixtures pinned for all four spellings.
- G5 `tools/ci.sh` green; goldens unmoved (a no-op mirror cannot move them — if they move, G3 lied).
- S7 user acceptance.

## Out of scope
- Commissioning real monster art (user-owned, HANDS-OFF per PROJECT.md).
- `si`/`unit`/`bpskin` (locked-size artworks, no shape to be authoritative about).
- REQ-0185 (dungeons as content).
