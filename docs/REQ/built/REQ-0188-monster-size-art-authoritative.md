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

## Implementation log

### Session 2026-07-17 (implementing engineer, opus) — branch `req-0188-monster-size-art-authoritative`

Implemented the guard + the two tools + fixtures; `tools/ci.sh` GREEN. NOT deployed.
Commits (this branch):
- `7812770` — art-authoritative cell-geometry drift guard in `server/services/content_checks.cjs`
- `65b9c57` — `tools/seed_artwork_from_def.cjs` + `tools/derive_def_geometry.cjs`
- `4e7921b` — DB-free geometry gate + isolated-ns seed/derive pg test; wire `tools/ci.sh`

**Key design decisions**
- **The guard is a SEPARATE exported check + corpus sweep, NOT a 5th entry in the four
  per-variant machine checks.** `runChecks`' `[schema_vocab, engine_types, gen_data,
  integrate]` contract (asserted verbatim by content_test/contentagg_test and rendered by
  the contentadmin e2e) is left byte-untouched, and the machine checks stay DB-free.
  `checkArtworkGeometry(kind, data, artwork)` returns a machine-check-shaped result
  (`{name:'artwork_geometry', ok, applicable, detail}`), so "FAILs naming both sides" is
  honoured in the same vocabulary; `sweepArtworkGeometry()` + a `require.main` CLI apply it
  across the served corpus and exit 1 on drift. The artwork is resolved by the caller
  (ref-first, REQ-0174 `resolveArtworkFacetName` → exact-name fallback) and passed in, so
  the pure check is fixture-testable.
- **Comparison is by NORMALIZED CELL-SET** (translate to bbox top-left), so a footprint and
  an art shape agree iff they cover the same cells — order-, offset- and spelling-independent.
- **Seed = ROWS ONLY, no renders.** The `seed=2147483647` unknown-environment sentinel is a
  RENDER convention (REQ-0177), owned by the sprite backfill where an actual image is
  imported. The image-less monsters get a shape-only artwork row (adopted_render_id NULL,
  like most of the 66 existing monster artworks); inventing a render would be the dishonesty
  REQ-0160 refuses. `main_object` = the def's name, `prompt_template` = '' (monsters/POs carry
  no `gen_prompt`).
- **Seed is already-covered-aware, not just row-exists-aware.** It skips any entity that
  already RESOLVES to an artwork ref-first (explicit `artwork_ref` OR an exact-name row), so a
  re-run is a pure no-op and an operator's explicit link is never doubled with a stray row.
- **Derive rewrites exactly what the guard flags.** Agreeing entities are byte-untouched (the
  file is not even opened for writing), so the mirror is a no-op BY CONSTRUCTION → empty diff.
  When it does reconcile drift it does a surgical, formatting-preserving in-place replace of
  just that one geometry field. Safe-by-default: `--check` (report-only); `--write` is the
  deploy step.
- **The transpose is the whole risk** and every conversion is pinned NON-SQUARE across all
  four spellings (see G4). REQ-0184's `footprintFromArtShape` ({w,h}→[h,w]) is the same canon,
  mirrored here for the def side; `maskFromShape` is REUSED from `backfill_sprite_art.cjs`
  (one copy of "shape→5×5 mask", per the REQ-0171 don't-drift lesson).

**Gate results**
- **G1 drift guard** — GREEN by fixtures (`content_checks_geometry_test.cjs`, ci step 4.665):
  agrees on sync, FAILs on drift naming BOTH sides in BOTH spellings, honest `applicable:false`
  when there is no linked artwork. **Live sweep (read-only, `node server/services/content_checks.cjs`):
  agree=8, n/a=19, disagree=2** — the guard is PROVEN correct on live data: the 8 REQ-0177
  live_items POs all AGREE; the 2 disagreements are found-in-flight (below), i.e. the guard
  catching real drift, not a code defect.
- **G2 seed** — `seed_derive_pg_test.cjs` (isolated TMPHOME namespace, ci step 5.355): creates
  every missing row from def geometry, ZERO renders, SKIPs covered/ref-linked entities, second
  run is a pure no-op. Live `--dry-run` preview: `scanned=29 created=19 skipped_covered=10`
  (8 live_items + frost_gnoll[ref] + lockpick[ref]).
- **G3 mirror** — no-op BY CONSTRUCTION: (a) fixtures prove seed↔derive are inverses across
  non-square shapes; (b) pg test proves derive finds ZERO drift end-to-end after a clean seed;
  (c) live `derive --check`: the 8 already-agreeing POs are UNCHANGED (the spec's literal G3:
  "empty diff for all 8 already-agreeing POs" holds) — only the 2 in-flight-linked entities
  would change.
- **G4 transpose** — 24 fixtures, every one NON-SQUARE, all four spellings ({w,h}, [fh,fw],
  {mask [row][col]}, [[r,c]]); the transposed spelling must FAIL. In ci (step 4.665).
- **G5 ci** — `SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh` → **CI GREEN** (log `/tmp/req0188_ci.log`).
  Root worktree deps were missing tsc → provisioned with `pnpm install --frozen-lockfile`
  (lockfile UNCHANGED; only added the already-pinned typescript/@types/node). The client build
  regenerated `web/` dist — restored (`git checkout -- web/ && git clean -fd web/`), no dist
  churn committed. Sim replay goldens unmoved (no sim/content bytes changed; derive never run
  in `--write`).
- **S7** — pending user acceptance.

**FOUND-IN-FLIGHT (important — the shared live DB drifted after the 2026-07-15 dry-run)**
The parallel art/monster-pack workstream has, since this spec was ratified, set two
`content_defs.artwork_ref` links whose geometry disagrees with the def:
1. `frost_gnoll` footprint `[1,1]` → `monsters-003-flux2:gnoll` (monster art `{w:3,h:4}`,
   ADOPTED). Art-authoritative ⇒ footprint should be `[4,3]`.
2. `lockpick` shape `[[0,0]]` → `items005_dungeon_key` (po art, 2-cell mask, NOT adopted).
The guard correctly FLAGs both. So a literal "0 disagreements on today's live content" (G1)
and "empty full diff" (G3) cannot hold on the mutating shared DB right now — these are the
guard working, and they are reconciled by the deploy-time derive/seed run. **This REQ is left
in `todo/`** (not promoted to `built/`) precisely because promoting it would assert the live
content is clean when it is not; the built/-move is handed to the orchestrator once the two
in-flight links are reconciled or accepted. batch-005 (REQ-0203) monsters are covered
automatically — the corpus reads `enemies.json`, no roster is hardcoded.

**Deviations from the spec letter**
- Guard NOT wired into the four machine checks (see design decision #1) — "FAILs" honoured via
  the check-result shape + the sweep's exit code. Zero blast radius on existing tests/e2e.
- The spec's "16 POs" is the RAW inventory count; `lockpick`/`spyglass` appear in BOTH
  `dungeon/items.json` and `starter_items.json`, so the seed dedups to 22 unique POs (+7
  monsters = 29 unique planned). One artwork row per unique id (system_name is one-name-one-entity).
- Seed writes ROWS ONLY (no `artwork_ref`); exact-name resolution links a seeded row. If the
  orchestrator wants an explicit `artwork_ref` set too, that is a one-line follow-up.

**Deploy steps (orchestrator, post-merge, against the LIVE namespace — NOT run here)**
1. **Reconcile the 2 in-flight drifts (decision required).** Either accept the links and let
   step 3 rewrite the def geometry (note: `frost_gnoll` `[1,1]→[4,3]` is a GAMEPLAY footprint
   change — a 1-cell monster becomes 4×3 — and needs user/parent sign-off), or clear the
   experimental link(s) first.
2. **Seed the coverage rows** (INSERT-only, idempotent, no renders):
   `set -a; source server/.env; set +a`
   `node tools/seed_artwork_from_def.cjs --dry-run`  (preview; today: created=19 skipped_covered=10)
   `node tools/seed_artwork_from_def.cjs`
3. **Regenerate the def-side mirror from art:**
   `node tools/derive_def_geometry.cjs`          (--check: report what would change)
   `node tools/derive_def_geometry.cjs --write`  (rewrite footprint/shape; review + commit the diff)
4. **Verify the guard is clean:** `node server/services/content_checks.cjs` → exit 0 (0 disagreements).
   After this, REQ-0184's board can trust `footprint` again (def == art, provably).

## Deploy record (2026-07-17, orchestrator, partial)
Merged to master (guard + tools + gates; CI GREEN). Seed run live: created=19, re-run no-op (G2 closed live). derive --check: 2 drifts (frost_gnoll [1,1]->[4,3] from monsters-003-flux2:gnoll -- a REAL gameplay footprint change that would overlap enc_pack_1 neighbors and needs pack re-composition + user sign-off; lockpick [[0,0]]->2 cells from unadopted items005_dungeon_key link). derive --write NOT run; stays todo pending the user ruling on those two.

## Ruling + closure (2026-07-17, user)
User ruled on the two drifts: (1) frost_gnoll -- UNLINK now; the real fix is the deliberate re-composition, reserved as REQ-0206. (2) lockpick -- UNLINK (experimental items005_dungeon_key link cleared). Both artwork_refs cleared via contentadmin PATCH; derive --check now reports drifting=0 across all 37 scanned defs, and derive --write is a proven no-op. Guard live, seed live (19 rows, re-run no-op), mirror no-op: every gate closed on the live namespace.
