# REQ-0206 — batch-002 pack re-composition under art-authoritative sizes

**Status:** todo — ratified by the user 2026-07-17 (chat ruling on REQ-0188's found-in-flight
drift): *"frost_gnoll: unlink now, and cut the pack re-composition REQ"*. Cleared in principle;
NOT scheduled in the 2026-07-17 session.
**Reserved:** 2026-07-17
**Slug:** batch002-pack-recomposition-art-size
**Requested by:** user, 2026-07-17 (chat).
**Depends on:** REQ-0188 (deployed: guard + seed live, derive a proven no-op after the unlink),
REQ-0184 (the pack kind + the ported layouts this REQ re-composes), REQ-0203 (the precedent:
footprints authored from art, packs laid out on B2:Y17).

## Why this REQ exists

REQ-0188's drift guard caught the first real drift the day it landed: `frost_gnoll` footprint
`[1,1]` vs its linked artwork `monsters-003-flux2:gnoll` `{w:3,h:4}` (should be `[4,3]`).
Accepting the art size on the spot would have made `enc_pack_1`'s members overlap (ice_archer
anchors at C2, inside a 4x3 frost_gnoll at B2), i.e. an unreviewed gameplay change. The user
ruled: clear the LINK now (done 2026-07-17, live is drift-free), and do the real fix — this
REQ — deliberately. This is exactly the follow-up REQ-0184 § "The port is a PORT" reserved for
a re-composition: *"a game-design decision with its own ratification"*. That ratification is
the 2026-07-17 ruling.

## Scope

1. **Re-link** `frost_gnoll` -> `monsters-003-flux2:gnoll` (artwork_ref), and decide art links
   for the other 6 batch-002 monsters (`ice_archer`, `rime_shaman`, `glacier_wisp`,
   `frostback_bear`, `niflheim_stalker`, `hrimgrimnir`). Suitable arts may not exist yet —
   commissioning is user-owned and queue-only; a monster with no art keeps its seeded
   `{1x1|2x2|3x3}` artwork row from REQ-0188's seed (already the authority, so the guard stays
   green for them with no def change).
2. **Derive** footprints from art (`tools/derive_def_geometry.cjs --write`) — `[4,3]` for
   frost_gnoll under today's link; others move only if step 1 links them to real art.
3. **Re-compose** the four live packs (`pack_frost_scouts`, `pack_rime_choir`,
   `pack_bear_and_stalker`, `pack_hrimgrimnir`) on B2:Y17 for the new sizes: no overlap,
   validator PASS, REQ-0184 intent language (anchor forward, support behind, spread vs AoE).
4. **Rebaseline**: goldens + S4 re-run. Unlike the 0184 port this IS a deliberate gameplay
   change — the diff is reviewed as design, not required to be a uniform shift.
5. REQ-0188's guard green afterwards (art == def, provably), REQ-0203's batch-005 untouched.

## Gates
- G1 re-composed packs PASS the shared validator; the admin board renders them footprint-true.
- G2 derive: post-write `--check` = 0 drifting; guard sweep exit 0.
- G3 goldens/S4 rebaselined with the diff summarized in this file as the design record.
- G4 `tools/ci.sh` GREEN.
- S7 user acceptance (layouts are player-facing design).

## Out of scope
- batch-005 grave-legion (already art-authoritative), dungeon/encounter wiring (REQ-0185),
  commissioning new art (user-owned; coordinate separately).
