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

---

## Implementation log — session 2026-07-18 (implementing engineer, opus), branch `req-0206-batch002-pack-recomposition-art-size`

`tools/ci.sh` GREEN (646 pass / 0 fail). NOT merged, NOT deployed. S7 pending.

### User rulings taken this session (2026-07-17/18 chat)
1. **Art links: `frost_gnoll` ONLY.** The other 6 keep their REQ-0188 seeded rows.
   Commissioning real art for them is filed as **REQ-0243** (reserved).
2. **Re-composition scope: `pack_frost_scouts` ONLY** — a deliberate NARROWING of this
   REQ's own § Scope 3, which says all four. The other three keep their REQ-0184 ported
   layouts. Recorded as a deviation, not silently applied.
3. **Fix the two found-in-flight defects INSIDE this REQ** rather than split them out
   (REQ-0244 / REQ-0245 were reserved for the splits and are now redundant — numbers burned).

### The survey that decided scope
`frost_gnoll` was the ONLY one of the 7 with **no artwork row at all**: the 2026-07-17
unlink cleared its ref, and REQ-0188's seed had skipped it *because* it was ref-covered at
seed time. The other 6 carry seeded rows with **no image** (`adopted=false`,
shape = their own def geometry) — which is exactly why the live guard reads
`agree=64 disagree=0 n/a=2` and derive reports `drifting=0`. No batch-002-suitable art
exists: the only thematic reuse candidates (`ice_elemental`, `frost_giant`, `dire_wolf`)
are already the art of *other* live monsters, so linking them would duplicate batch-005
monsters visually. Hence ruling 1 — the honest gap stays a gap.

### What shipped
- `a3806ea` — `frost_gnoll` footprint `[1,1] -> [4,3]`, **generated** by `derive_def_geometry`'s
  `runDerive()` (`monsters-003-flux2:gnoll {w:3,h:4}`, the REQ-0188 transpose), never hand-typed.
- `26cb55c` — `pack_frost_scouts` re-composed: `frost_gnoll` B8:D11 (anchor forward, vertically
  centred), `ice_archer` G9 (second rank, 2 clear columns behind the gnoll's back edge so one
  AoE cannot catch both). REQ-0203 idiom. All 14 packs PASS the shared validator.
- `997ed5e` — **bounded the legacy cursor row** (found-in-flight defect #1, below).
- `23dd83c` — carried both changes into the batch-002 **BASE** + refreshed registry provenance
  (found-in-flight defect #2, below).
- `cff4d41` — rebaselined the 8 drifted goldens (design record below).
- `c83520a` — **revived the S4 matrix gate** (found-in-flight defect #3, below).

### The ordering that keeps live green (deliberate, not an oversight)
The live `artwork_ref` PATCH is **NOT done on this branch** — it is a deploy step, run AFTER
merge. Setting it now would leave the live guard RED (def `[1,1]` vs art `[4,3]`) for the whole
review window: exactly the dirty state REQ-0188 refused to promote in, and exactly what the
2026-07-17 unlink was ruled to clear. Landing the derived def FIRST means the guard moves
`n/a -> agree` at deploy and is **never red**. The mirror was therefore generated read-only,
injecting only the ref VALUE the PATCH will set while resolution ran the real
`storage.resolveArtworkFacetName` against the real registry — so post-PATCH `derive --check`
must report `drifting=0`. Verified: it does.

### FOUND IN FLIGHT #1 — the legacy cursor never bounded its rows (fixed here, user-ruled)
`packMembers`' cursor wrapped COLUMNS but never checked `rowMax`, so it marched off the bottom
of the plane unconditionally — members landed on cells that do not exist. Measured:

| roster | cells out of bounds |
|---|---|
| **live (44 monsters, REQ-0206-independent)** | **12804 / 31982** |
| batch-002 @ master (`frost_gnoll [1,1]`) | 0 / 4501 |
| batch-002 @ REQ-0206 (`frost_gnoll [4,3]`) | 24 / 7669 |

The REQ-0045 guard passed on master **only because it is pinned to the batch-002 fixture
roster**, whose old 1x1..3x3 footprints could never push the cursor to row 19 — it could not
falsify its own claim. The claim has been false since batch-005/006/007 shipped tall monsters:
**three `bone_dragon` [10,10] already overflow B2:Y17.** NOT player-reachable — the real
generator emits packs of <= 2 members (0 of 600 generated packs overflow) and authored packs go
through the layout path, which the shared validator bounds. Latent, not live.
Fix: clamp to the last legal band. An over-capacity pack cannot be placed legally at all
(18 rows / 4-tall = 4 bands x 8 = 32 members, so 69 will not fit however arranged) — the choice
is overlap, drop, or throw; clamping keeps every member ON THE FIELD, the property the guard
asserts and the ray math depends on. Live-roster overflow: **12804 -> 0**.
**Proven no-op, by isolation:** footprint only -> 8 goldens drift; footprint + fix -> the same
8; **fix alone -> 0**. The legacy path is REQ-0185's to retire; this bounds it, does not
redesign it.

### FOUND IN FLIGHT #2 — derive cannot reach the promote SOURCE
`derive --write` only touches `content/live/` (REQ-0188's CORPUS), but
`content/batches/batch-002-dungeon-pilot/` is what `promote_dungeon_batch.cjs` **byte-copies
over live**. A base left at `[1,1]` would have **silently reverted this REQ on the next
batch-002 promotion**, and the goldens read the base directly, so live and the replay would have
disagreed. The REQ-0122 lossless invariant caught it rather than review (`enemies.json sha
expected 895df769 got 43c50003`). Base fixed with the tool's own derivation; the pack layout
lifted VERBATIM from live so the two cannot drift by a byte; the last additive layer's recorded
sha recomputed (no `added` id list touched — nothing was added or removed).
**This is a real REQ-0188 architectural gap this REQ only works around: derive writes live,
promote overwrites live from an underived base.** Left for a follow-up, not smuggled in here.

### FOUND IN FLIGHT #3 — the S4 matrix gate has been DEAD since 2026-07-16 (fixed here, user-ruled)
`tools/simulate.cjs` loaded its roster from batch-002 (7 monsters) while `dungen.generate()` —
which it calls to build the dungeons it measures — resolves from LIVE via `os.homedir()`. Two
loaders, one roster. When batch-005 went live additively (REQ-0203) the generator began emitting
monsters the loader had never heard of and every run died on `compileEnemyPack: missing enemy def
troll`. **Verified pre-existing: master (863c90d) fails identically.** Nothing caught it — ci.sh
`[2.5]` runs the S4 UNIT tests, never the matrix, so the gate rotted while CI stayed green; the
golden sha256 had not moved since 2026-07-12, pinned to a gate that could not run.
Fixed by reading through `dungen.liveDungeonDir()` — whatever roster dungen fields is what S4
measures, so the mismatch is structurally impossible rather than a thing to remember.

### Gate results
- **G1 packs** — GREEN. All 14 packs PASS the shared validator; the overlap this REQ exists to
  fix was reproduced first (`members[1] ("ice_archer" at C2) overlaps members[0] ("frost_gnoll"
  at B2) on cell C2`) and is gone. Board footprint math pinned by `check_pack_board.mjs` (ci `[5.75/7]`).
- **G2 derive** — GREEN. Post-write `derive --check` **with the ratified link: `drifting=0`**
  (idempotent). Live guard sweep **exit 0** (`agree=64 disagree=0 n/a=2`) — live is clean and
  stays clean until the deploy PATCH, by design (§ ordering).
- **G3 goldens + S4** — GREEN, rebaselined.
  - Goldens: **8 of 12 moved, 4 byte-identical. `def_sha256` UNCHANGED on every one** — the
    dungeon DEFINITIONS never moved, only the replay (the REQ-0184 nuance). Deltas run BOTH ways
    (+27 / -14 / +29 / +16 / +5 / -17 / +5 / +32): a 1x1 gnoll becoming 4x3 changes what the rays
    hit, so a uniform shift would be evidence the footprint had NOT taken effect. L1/L3 are
    byte-identical because `frost_gnoll` is not fielded there — the blast radius is exactly the
    packs that field it.
  - S4: **GATE PASS (11 warn)** — the SAME 11 warns as the inaugural baseline, same families, no
    new warn, no hard fail. Numbers move mostly TOWARD the bands (dagger DPS 17.47 -> 12.45;
    terminator 0.87-0.91 -> 0.46-0.62; pack 1.25s -> 1.95s). **Attribution, measured:** that
    movement is the GATE REVIVAL (7 -> 44 monsters), NOT this REQ's footprint — with the live
    roster and `frost_gnoll` reverted the numbers are 12.66 / 0.47-0.65 / 1.90s. `--check-golden`
    re-run: golden OK.
- **G4 ci.sh** — **GREEN** (`SKIP_PG=1 SKIP_E2E=1`, HOME pinned at the worktree per REQ-0184's
  convention). 646 pass / 0 fail. Re-run GREEN after merging master (REQ-0220/0238/0193) so the
  branch is verified against the tree it will merge into.
- **S7** — pending user acceptance (layouts are player-facing design).

### Deviations from the spec letter
- § Scope 3 says re-compose all four packs; the user narrowed it to `pack_frost_scouts` (ruling 2).
- § Scope 1's "decide art links for the other 6" is decided as NO LINK (ruling 1) -> REQ-0243.
- Two defects outside § Scope were fixed here on the user's explicit ruling 3 (found-in-flight
  #1 and #3). Both are proven not to move any golden on their own.
- `REQ-0244` / `REQ-0245` were reserved before ruling 3 and are now redundant; their stubs are
  removed and their numbers permanently burned (per the § Numbering policy — gaps are normal).

### Deploy steps (orchestrator, post-merge, live namespace — NOT run here)
1. **PATCH the ratified link** (this is what makes art authoritative for `frost_gnoll`):
   `curl -X PATCH .../api/content/defs/frost_gnoll -d '{"artwork_ref":"monsters-003-flux2:gnoll"}'`
   (admin auth; `server/routes/content.cjs` `hPatchDef`, REQ-0174-validated). Order matters:
   merge FIRST, PATCH SECOND -> the guard goes `n/a -> agree`, never red.
2. **Verify:** `node tools/derive_def_geometry.cjs` -> `drifting=0` (the committed mirror is
   already correct, so `--write` must be a proven no-op), and
   `node server/services/content_checks.cjs` -> exit 0 with `frost_gnoll -> monsters-003-flux2:gnoll AGREE`.
3. Rebuild/redeploy the client dist if the pack board is user-visible; restart `backpack-api` to
   drop served-content caches.
