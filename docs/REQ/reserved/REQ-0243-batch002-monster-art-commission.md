# REQ-0243 — batch-002 monster art: commission the six that have none

**Status:** draft — spec written, BLOCKED on the user. Commissioning is user-owned and
queue-only (PROJECT.md § HANDS-OFF: the art session is run separately), so this cannot be
cleared to implement by an agent. Not scheduled.
**Reserved:** 2026-07-17
**Slug:** batch002-monster-art-commission
**Requested by:** user, 2026-07-17 (chat), ruling on REQ-0206 § Scope 1: link `frost_gnoll`
only, and *file a commissioning REQ for the rest*.
**Depends on:** REQ-0188 (art is authoritative; the seeded rows this REQ would replace),
REQ-0206 (the precedent: one link -> derive -> re-compose -> rebaseline).
**Spawned by:** REQ-0206.

## Why this REQ exists

Under REQ-0188 an artwork's shape IS a monster's cell geometry. Six of the seven batch-002
monsters have an artwork ROW but **no image** — REQ-0188 seeded the row from the def's own
geometry (a one-time flip of the direction of truth) and deliberately fabricated no render.
So the authority exists on paper and says only what the def already said:

| monster | def footprint | artwork row | adopted render |
|---|---|---|---|
| `ice_archer` | `[1,1]` | `{w:1,h:1}` seeded | **none** |
| `rime_shaman` | `[1,1]` | `{w:1,h:1}` seeded | **none** |
| `glacier_wisp` | `[1,1]` | `{w:1,h:1}` seeded | **none** |
| `frostback_bear` | `[2,2]` | `{w:2,h:2}` seeded | **none** |
| `niflheim_stalker` | `[1,1]` | `{w:1,h:1}` seeded | **none** |
| `hrimgrimnir` (boss) | `[3,3]` | `{w:3,h:3}` seeded | **none** |

`frost_gnoll` is now the ONLY batch-002 monster with real art (REQ-0206:
`monsters-003-flux2:gnoll`, footprint `[4,3]`). That leaves the pilot roster visibly
inconsistent: one 4x3 illustrated gnoll fighting beside 1x1 placeholders, at a scale every
other live roster (batch-005/006/007) left behind — those monsters are 4x3 and up because
their footprints came from real art.

## The survey REQ-0206 already did (do not redo it)

There is **no batch-002-suitable art in the registry**. 236 monster artworks, 62 with a real
adopted render, and none of them is an ice archer, a rime shaman, a glacier wisp, a
frostback bear or a niflheim stalker. The only thematically adjacent candidates are already
the art of OTHER live monsters, so reusing them would make two different monsters render
identically:

| tempting reuse | already belongs to |
|---|---|
| `ice_elemental` `{w:4,h:4}` | the `ice_elemental` enemy |
| `frost_giant` `{w:5,h:6}` | the `frost_giant` enemy |
| `dire_wolf` `{w:5,h:4}` | the `dire_wolf` enemy |

The user rejected that reuse on 2026-07-17. **New art is the only honest option**, and
generating it is the user's own GPU session.

## Scope (proposed — needs the user's ratification)

1. Commission six monster arts in the live style (`monsters-003-flux2` is the current
   flux2 set; `tools/gen_monster_art.py` is the generator). Sizes are a DESIGN choice, not
   a derivation — a 1x1 wisp and a 3x3 boss are the placeholder sizes an unknown environment
   produced, not sizes anyone chose. Suggested starting points for the user to overrule:
   `ice_archer` 3x4 · `rime_shaman` 3x4 · `glacier_wisp` 3x3 · `frostback_bear` 4x4 ·
   `niflheim_stalker` 5x4 · `hrimgrimnir` (boss) 6x5..8x8.
2. Adopt each render, then `artwork_ref`-link (or exact-name-resolve) each def.
3. `node tools/derive_def_geometry.cjs --write` -> the footprints follow the art.
4. **Re-compose every pack that fields them** — `pack_rime_choir`, `pack_bear_and_stalker`,
   `pack_hrimgrimnir` (and `pack_frost_scouts` if `ice_archer` grows). REQ-0206 proved this is
   NOT optional: `frost_gnoll` alone `[1,1] -> [4,3]` made `ice_archer` stand INSIDE the gnoll.
   Six monsters growing at once will break all four.
5. Rebaseline goldens + S4; expect a LARGER diff than REQ-0206's 8/12 — this is a deliberate
   gameplay change, reviewed as design.

## Gates
- G1 six artworks adopted; each def resolves to it ref-first (REQ-0174 canon).
- G2 `derive --check` -> `drifting=0`; guard sweep exit 0 (art == def, provably).
- G3 every batch-002 pack PASSes the shared validator, no overlap, B2:Y17.
- G4 goldens + S4 rebaselined; S4 verdict has no NEW hard fail.
- G5 `tools/ci.sh` GREEN.
- S7 user acceptance (art and layouts are both player-facing).

## Out of scope
- Re-sizing batch-005/006/007 monsters (already art-authoritative).
- The REQ-0188 derive/promote seam REQ-0206 found (derive writes `content/live/`, but
  `promote_dungeon_batch.cjs` byte-copies an underived batch base OVER live). REQ-0206 worked
  around it by hand; it deserves its own fix REQ before another roster moves.

## Open questions for the user
1. Sizes — accept the suggestions above, or specify?
2. Should `hrimgrimnir` read as a boss at frost-giant scale (6x5+), or stay compact?
3. One batch (`monsters-008-niflheim`?) or fold into an existing art queue?
