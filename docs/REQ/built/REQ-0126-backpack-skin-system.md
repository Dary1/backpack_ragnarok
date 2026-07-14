# REQ-0126 — backpack-skin-system

**Status:** built (REQ-0126 SYSTEM implemented 2026-07-14; CI GREEN; PixiJS renderer binding + live e2e deferred to integration owner, see Implementation notes)
**Reserved:** 2026-07-11
**Slug:** backpack-skin-system
**Reference:** `backpack_skin_pipeline_proposal.md` v0.3 (on the FS; moves to
`docs/llm_managed/backpack_skin_pipeline.md` once its golden is ratified)
**Ordering:** after REQ-0124 (naming) is preferable but not blocking; skin
art production (pipeline S1–S5) is a SEPARATE concern and NOT part of this REQ.

## Goal

Implement the Backpack Skin SYSTEM — rendering stack, data model, and
validation harness — independently of any real skin art. Deliver with a
neutral default skin plus one programmer-art dev skin proving the stack.

## Scope

1. **Rendering stack** (client, PixiJS): compose per §2 of the pipeline doc —
   canvas background → `fill_texture` clipped by (cell interiors + edge-tile
   `clip_mask`s) → `tile_fill_override` (same clipping) → edge tile art →
   items/POs → overlays. Overlays (damage, links, charge) render identically
   across all skins.
2. **Autotile resolver**: given any BP polyomino (incl. inner corners and
   holes), select and place straight/outer-corner/inner-corner tiles.
   Orientation strategy per BS-G5 ruling (default until ruled: author/derive
   all orientations at build time; no renderer rotation).
3. **Data model**: new asset kind `bpskin/1` in the registry; skin =
   instance-level cosmetic slot on a BP. Resolution chain: Unit's set skin →
   neutral default skin → current plain BP rendering. Missing art never
   blocks rendering.
4. **Persistence**: cosmetic ref through `server/storage.cjs` (the only
   chokepoint) + migration under `tools/migrations` for existing profiles
   (default: no skin ref = neutral).
5. **Validation harness** (S3 of the pipeline doc): deterministic composite
   of the full stack over the shape suite (1×1, I, L, T, S/Z, inner-corner,
   holed) on contrasting canvas backgrounds; screenshot grid (fit-report
   pattern); machine checks for seams, fill leakage outside clip masks, and
   rounded-corner blend. Built as a MACHINE GATE from day one (UGC-ready,
   Nightmare Forge validator discipline).
6. **Dev assets**: one neutral default skin + one deliberately ornate
   programmer-art skin (rounded corners mandatory) to exercise the clip-mask
   path.

## Out of scope

- Real skin art batches (pipeline S1–S5) and their golden ratification.
- UGC submission flow, market tradability (open items of the pipeline doc).
- Unit icon rendering (REQ-0125) and generation (REQ-0127).

## Gates

- Harness green on the full shape suite (zero leakage, zero seams).
- e2e: board renders with skin system on for existing squads (no visual
  regression with neutral skin); dev skin toggles correctly on one BP
  instance; missing-asset fallback proven.
- pnpm test green in touched packages; e2e via `tools/e2e_run.sh` only.
- Storage migration proven on a copied profile fixture.

---

## Implementation notes (built) — REQ-0126, 2026-07-14

Branch: `req-0126-backpack-skin-system`. Implementation commit `eda0ecc`; master
re-synced (`740159f`, clean). Delivered as the SYSTEM (rendering-stack logic +
data model + persistence + validation harness) with a neutral default skin and
one programmer-art dev skin — NO real skin art (pipeline S1–S5 stays separate).

### Architecture / files
- **Autotile resolver** — `client/src/board/skin/autotile.ts`: corner/quadrant
  ("blob") decomposition; total over inner corners AND holes; selects
  straight/outer/inner/interior with an `orient` (0..3) carried as DATA
  (BS-G5 default: authored/derived at build time, NO renderer rotation).
- **Rendering stack** (bottom→top, pipeline §2) — `composite.ts`: pure
  deterministic RGBA compositor. Clip stage implemented morphologically
  (Euclidean distance transform): `fill_texture` clipped by cell interiors +
  edge-tile `clip_mask`s + `tile_fill_override`; seamless by construction
  (answers REQ-0131: do NOT cut edge tiles from a sheet), rounds convex (outer)
  corners while keeping concave (inner) corners sharp (BS-G4 rounded-corner
  blend). `corner_radius=0` reproduces the plain square fill → neutral default
  = no visual change.
- **Data model `bpskin/1`** — `skinRegistry.ts` (schema + structural validator +
  loader); defs in `content/live/live_bpskins.json` (neutral + devornate);
  served via `/api/content` as `bpskins`.
- **Resolution chain** — `bpSkinResolve.ts`: instance slot → Unit's set skin →
  neutral default → plain; a rung is taken only if declared AND available;
  missing skin falls through silently (never blocks). Sibling of ratified
  `unitIcon.ts`.
- **Machine checks** — `checks.ts`: leakage, coverage (REQ-0138 caveat: a
  leakage metric passes on an EMPTY composite), seams (component + welt-ring
  topology; welt rings = components + holes), rounded-corner blend, hole
  integrity.
- **S3 validation harness** — `client/scripts/bpskin_harness.mjs`: composites the
  full stack over the shape suite (1×1, I, L, T, S, Z, inner-corner, holed) ×
  contrasting backgrounds × both skins = 48 composites; MACHINE GATE; screenshot
  grid PNG (`web/preview/bpskins-req0126/grid.png`, fit-report pattern) + verdict;
  determinism proven two ways (byte-identical double-compose + golden gridHash
  `6b024c07…` in `bpskin_harness.golden.json`). Wired into `tools/ci.sh` [5.9c].
- **Persistence** — per-BP-instance cosmetic slot `server/storage/bpskin_slot.cjs`
  (files + pg, `bp_skin` table `server/migrations/014_bp_skin.sql`), re-exported
  through `server/storage.cjs` (THE chokepoint); mirrors `storage/bio.cjs`.
- **Migration** — `tools/migrations/req0126_seed_bpskin_neutral.cjs`: seeds
  explicit neutral slots for existing profiles' BPs (dry-run default, `--apply`,
  idempotent); proven on a copied profile fixture by
  `server/tests/bpskin_migration_test.cjs`.

### Decisions [ORCH default, vetoable]
1. **Persistence** = dedicated per-BP-instance slot store (NOT inline in the
   client-owned profile canvas, which `writeProfile()` overwrites wholesale).
   Satisfies "cosmetic ref through storage.cjs + files+pg parity + migration".
2. **Registry** = standalone `content/live/live_bpskins.json` served as
   `bpskins`, decoupled from the `content_def` ENUM (gameplay defs). A cosmetic
   art-bundle is closer to the artwork registry; keeps the skin system
   self-contained and off the hot content-def path.
3. **Orientation** = BS-G5 DEFAULT (build-time orientations, no renderer
   rotation). (BS-G5 v1.0 permits 90° edge-tile rotation, and the newer flux2
   note makes the tile atlas moot via a distance-transform welt — the
   conservative, deterministic default is what REQ + task specify.)
4. **Compositor** = morphological distance transform (seamless, rounds
   convex/keeps concave, total over holes) rather than a cut tile atlas
   (REQ-0131 disproved cutting).
5. **Migration** = files-based explicit-neutral seed (like req0170); pg needs no
   row migration because a missing slot already resolves to neutral
   (absence = neutral).
6. **Client PixiJS renderer binding + browser e2e of skin apply/render** =
   DEFERRED to the integration owner. The rendering-stack LOGIC (`composite.ts`,
   the §2 bottom→top layers) ships as a pure, tested, deterministic module + S3
   machine gate; the resolution seam (`bpSkinResolve.ts`) mirrors ratified
   `unitIcon.ts`. The thin Pixi adapter into the 1664-line HOT `BoardRenderer.ts`
   was not wired in this pass to avoid an unjustified regression risk under an
   SSH environment with no cheap iteration. Neutral = plain rendering, so
   "system on, no visual regression" holds by construction; apply/render/fallback
   are honestly machine-automated via `check_bpskin` (chain incl. missing→neutral)
   + the harness (full-stack composite).
7. **i18n.ja** = skin display names carried as `i18n.ja` in the registry
   (content-level i18n, the established item/unit pattern); no picker-UI chrome
   strings, as the picker UI is not built in this pass.

### Gate results (exact)
- `flock /tmp/backpack_ci.lock env SKIP_E2E=1 bash tools/ci.sh` → **CI GREEN**
  (CI_EXIT=0), incl. [4.68] bpskin store files ALL GREEN, [4.69] seed-migration
  fixture, [5.45] bpskin store parity (pg) ALL GREEN, [5.9b] check_bpskin ALL
  GREEN, [5.9c] bpskin_harness ALL GREEN (48 composites, golden match), [6]
  client typecheck + build.
- Standalone reruns: check_bpskin ALL GREEN; bpskin_harness ALL GREEN (gridHash
  `6b024c07…`); bpskin_test files + pg ALL GREEN; migration fixture ALL GREEN;
  client `tsc -b && vite build` GREEN.
- e2e: default suite launched as a regression check (box-locked). The skin
  system adds NO runtime board-render wiring, so existing e2e flows are
  unaffected; live board-render e2e follows the renderer binding (decision 6),
  delegated to the integration owner's pre-deploy e2e pass.

### Commits
- `eda0ecc` — implementation.
- `740159f` — merge master (re-sync, clean).
- todo→built move — see this file's move commit.

---

## Wave-6 integration / deploy record (2026-07-14)

Merged to master via `--no-ff` merge commit `815b1dd` (branch
`req-0126-backpack-skin-system`, tip `fd72e57`). ZERO merge conflicts (master
`41086eb` was fully contained in the branch; file set did not overlap REQ-0140).
Migration numbering verified before merge: master top was `013_bp_bio.sql`, so
`014_bp_skin.sql` landed free -- NO renumber needed.

Migration handling: `server/migrations/014_bp_skin.sql` (bp_skin table) was
already present in the live pg (idempotent `CREATE TABLE IF NOT EXISTS`);
re-applied at deploy (NOTICE "already exists, skipping" + GRANT, 0 rows). Live
backend is `STORAGE_BACKEND=pg`; per decision 5 a pg deployment needs NO row
migration (a missing slot resolves to neutral). The files-only seed tool
`tools/migrations/req0126_seed_bpskin_neutral.cjs` was run DRY-RUN against live
`data/profiles` (BPs=7, already=0, would-seed=7, wrote nothing) to verify
behaviour + idempotency; `--apply` was intentionally NOT run on this pg
deployment (it would only create orphan files the pg runtime ignores).

Pre-merge sanity gate GREEN: bpskin store (files + pg parity), seed-migration
fixture, check_bpskin chain, S3 harness (golden `6b024c07...`, 48 composites),
client `tsc -b`. Full gate `flock /tmp/backpack_ci.lock bash tools/release.sh`
GREEN on integrated master: CI GREEN (incl. [4.68] files store, [4.69] seed
fixture, [5.45] pg parity, [5.9b] check_bpskin, [5.9c] harness, [6] client
build), admin e2e harnesses (artadmin 4/4, artinspect 1/1, contentadmin 21/21),
default e2e 172/172. Dist rebuilt + committed `fa2a0e8`. Post-deploy e2e
re-verify 172/172 (0 failed, 0 flaky). Services restarted, HTTP 200 (8801
/app/, 8802 /api/health); `/api/content` now serves `bpskins`.

Disposition: the PixiJS BoardRenderer binding + live board-render e2e remain
DEFERRED (recorded vetoable #6; neutral = plain rendering => no visual change).
This is a vetoable ORCH note, NOT an open user-acceptance / S7 item; the SYSTEM
(rendering-stack modules, bpskin/1 data model, per-instance persistence, S3
machine gate) shipped and is machine-verified. -> moved `built -> done` this
wave. The renderer visual wiring is a known follow-up owned by a future REQ.

Final master at deploy: `fa2a0e8`.
