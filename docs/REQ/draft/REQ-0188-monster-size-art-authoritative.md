# REQ-0188 — monster-size-art-authoritative: one fact, one source, and it is the art

**Status:** draft — the CORE ruling is made (art is authoritative, user 2026-07-15); the REQ is
blocked on Q1/Q2 below, either of which changes what gets built. NOT cleared to implement.
**Reserved:** 2026-07-15
**Slug:** monster-size-art-authoritative
**Requested by:** user, 2026-07-15 (chat): **「art を正」** — ruling on the "one fact, two sources"
conflict REQ-0184 surfaced.
**Depends on:** REQ-0184 (surfaced the conflict; its board is the first consumer),
REQ-0151 (the artwork registry).
**Doctrine:** continues **REQ-0029**'s ruling verbatim — *"on a 90° scale tie, do NOT rotate the
art. Respect the original design: the art is authoritative; fix the CELL SHAPE side"*
(art_golden v3.3). This REQ makes structural what REQ-0029 made editorial.

## The conflict (REQ-0184's finding)

A monster's size in cells is written in TWO places, neither derived from the other:

| source | spelling | who consumes it |
|---|---|---|
| `artworks.shape` | `{w, h}` = width, height | `art_sizing.cjs` (128 px/cell) — what the image is generated at |
| enemy/1 `footprint` | `[fh, fw]` = height, width | `sim/lib/packs.cjs` — where the monster actually stands |

Today nothing can disagree, because the two rosters are **disjoint** (see § The blocker). The
first monster that has both would have the contentadmin board drawing one size while the sim
places another: the desk blesses one board, the player fights another. That is exactly the
failure REQ-0184 spent its budget eliminating between its checker and its placer, reappearing
one layer up.

**Ruling: art is the authority.** `footprint` stops being an independent fact.

## The constraint that shapes the design

**The sim cannot read the database.** PROJECT.md: *"sim/ and mock-src/ are dependency-free by
invariant"*, and `sim/dungen.cjs` resolves content through the filesystem. So "art is
authoritative" CANNOT mean the sim reads `artworks.shape` at runtime.

It means: **art (DB) is the source; enemy/1 `footprint` becomes a GENERATED MIRROR in
`enemies.json`; the sim keeps reading the file.** Plus a machine check that FAILs on drift, so
the mirror can never quietly diverge from its source. Direction of truth: DB -> tool ->
`content/live/dungeon/enemies.json` -> sim. Never the reverse.

This is the same shape as `promote_dungeon_batch.cjs` (copy-with-provenance) and the same
honesty rule as REQ-0171's derived percentages: the mirror is generated, never hand-edited.

## The blocker — the authority has no data for the roster in play

| | monsters | enemy/1 `footprint` | artwork `shape` |
|---|---|---|---|
| batch-002 (what the live packs field) | 7 (`frost_gnoll`…`hrimgrimnir`) | yes ([1,1]…[3,3]) | **NONE** |
| the art registry | 66 (`basilisk`, `bone_dragon`, …) | **NONE** | yes ({w,h}, 1..12) |

Making art authoritative TODAY leaves the 7 monsters the game actually fields with **no size at
all**. So the ruling cannot land as-is; Q1 decides how it lands.

## Q1 (BLOCKING) — how do the 7 batch-002 monsters get an authority?
- **(a) Seed artwork rows from their current footprints.** A ONE-TIME seed, explicitly labelled
  as a seed and not a derivation: truth flips direction once (`footprint` -> `shape`), and from
  that commit art owns it forever. Cheapest; keeps batch-002 playable; the 7 rows would carry a
  shape but no render until art is commissioned.
- **(b) Commission art for the 7.** Cleanest, but art sessions are the user's own and HANDS-OFF
  per PROJECT.md — this REQ cannot do it, only wait on it.
- **(c) Retire the batch-002 roster** in favour of the 66-monster art roster (which has art but
  no enemy/1 defs — the mirror image of the problem). Largest blast radius: goldens, S4, the
  REQ-0184 packs, `dungen`'s roster.

## Q2 (BLOCKING) — is the ruling monster-only, or every kind with geometry in its art?
The identical duplication exists for **po**: `artworks.shape = {mask: 5x5 bool}` vs `po_def.shape
= [[r,c]]` — 49 po artworks, and `live_items.json` shapes like `blade [[0,0],[1,0]]`. **REQ-0029
already ruled art-authoritative for exactly this**, but only editorially; the two copies still
stand.
- **(a) monster only** — the narrow reading of today's ruling. Leaves po's duplication live.
- **(b) monster + po** — finishes REQ-0029 structurally. But po shapes are ratified, adopted,
  fit-checked live content; regenerating them from art masks risks churning content that is
  currently correct (and REQ-0029's own history is a warning: the tooling, not the art, was
  wrong last time).
Recommend **(a) now, (b) as its own REQ** with a dry-run diff first — but this is the user's call.

## Sketch (once Q1/Q2 are ruled)
- `tools/derive_monster_footprints.cjs` — reads `artworks.shape` for kind=monster, writes
  `footprint: [h, w]` into the batch's `enemies.json`. **The transpose is the whole risk**:
  `{w,h}` -> `[fh,fw]`. REQ-0029 WAS a transposition bug ([row,col] read as [col,row]) that
  mis-measured 12/14 masks and manufactured a fake "stale art" crisis. Pinned by test against
  `art_sizing.cjs`'s own non-square examples, exactly as REQ-0184's `check_pack_board.mjs` does.
- `content_checks.cjs` — a `monster_def` whose `footprint` disagrees with its linked artwork's
  `shape` FAILs, naming both. This is the guard that makes the mirror trustworthy, and it is
  worth landing even if Q1 stalls.
- The REQ-0184 board then stops resolving art per-member and simply trusts `footprint` again —
  because by then they are provably the same number.

## Out of scope
- Commissioning monster art (user-owned, HANDS-OFF).
- `unit`/`si`/`bpskin` geometry (si/unit/bpskin artworks are locked-size and carry no shape).
