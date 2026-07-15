# REQ-0186 — po-shape-lock-params: give the operator the shape-conditioning dial

**Ratified:** 2026-07-15 (user, chat). REQ-0183 made every po render shape-conditioned at
one hardcoded setting. The user's follow-up: *"そのあたりをpo kindのartworkのパラメーター
にして生成側に調整の余地を与える方向性で"* — turn the trade-off into po artwork parameters
and give the generation side room to tune. Chosen at ratification: **`auto` as the new
default**, dilation **exposed but bounded 0–16**, and **artwork default + one-shot
generate override**.

## Problem

REQ-0183 shipped REQ-0153's GREEN recipe (Arm C, D=8) hardcoded ON for every po. That was
the right call for "any shape, always", but it spends a real cost everywhere, including
where it buys nothing. REQ-0153's own results say so:

- The unconditioned baseline **PASSES on 1x3 and 2x2** — "only because the ratified
  aspect-sizing law already gives the subject a natural fit there (a vertical spear fills a
  tall 1x3; a shield fills a square)".
- It **MISSES on L-tromino / T-tetromino**, which is where the spike said shape control
  "actually earns its cost".
- And the lock costs subject legibility: the 2x2 `round shield` "becomes a full round disc
  (great fill, but it drops the heater-shield character)".

So on a full rectangle, REQ-0183 was paying legibility (disc, not heater shield) plus
~2-3x generation time to fix a miss that was not happening.

**A correction carried into this REQ.** When first reporting REQ-0183 I suggested Arm A
("guide") as the way to buy legibility back. Re-reading REQ-0153: the war hammer reads as
an abstract cracked-metal T **under A *and* C** ("under A/C reads as an abstract
cracked-metal T"). The silhouette-vs-legibility cost comes from the ReferenceLatent itself,
not from the hard mask. `guide` buys **containment** (60% vs 100%), NOT legibility. Only
`off` restores a free composition. The controls below are named and documented on that
basis; steering an operator toward `guide` "for legibility" would be selling a knob that
does not do that.

## The parameters

`shape_lock` — every value is an arm REQ-0153 actually SCORED, not an invented setting:

| value | mechanism | identity-fit (REQ-0153) |
| --- | --- | --- |
| `off` | none (Arm 0) | 28.6% |
| `guide` | ReferenceLatent scaffold only (Arm A) | 60% |
| `strict` | Arm A + SetLatentNoiseMask (Arm C) | 100% |
| `auto` | **DEFAULT** — `strict` when the shape does not fill its bounding box, else `off` | — |

`shape_dilation_px` — slack in px around the owned cells, `strict` only. Default 8,
**bounded 0..16**. Honest limit: the spike BUILT masks at {0, 8, 16} but only **D=8 was
ever scored for image quality**; 0 and 16 are supported and bounded, not validated. The UI
says so. Beyond 16 is unexplored, and at 256 px/cell a large enough D just dissolves the
shape into its bounding box — `off` with extra steps.

### The `auto` rule
`len(cells) == rows * cols` -> the shape IS its bounding box (1x3, 2x2, 3x2, 1x1) -> `off`.
Otherwise (L, T, S, anything notched) -> `strict`. This is not a heuristic invented here:
it is the exact line REQ-0153's results draw between "baseline already fits" and "baseline
free-composes and misses". `auto` spends the legibility cost only where it buys containment.

## Decisions

- **`auto` is the default** (user ruling). A po created today gets `auto`; NULL in the DB
  also means auto, so pre-REQ-0186 rows need no backfill.
- **An explicit lock always wins.** `auto` never second-guesses an operator who chose.
- **The one-shot override does NOT mutate the artwork.** Same posture as `tiling`. This is
  the point of the feature: a conditioned render costs 76-130 s and the trade-off is only
  visible once rendered, so the loop is *same seed at two locks -> compare in the lightbox
  -> Save the winner as the artwork's default*. Making generate silently rewrite the
  artwork would destroy the comparison it exists to enable.
- **New COLUMNS, not `artworks.shape`.** REQ-0179 put custom's width/height in the shape
  jsonb and noted no column was needed; that precedent does not extend here.
  `kit_registry.cjs` `kitParams()` hashes `shape` VERBATIM into `kit_input_sha256`, the
  inspection staleness key — so an enforcement setting living in shape would mark every
  existing verdict **STALE** on a lock change, with neither the image nor the geometry
  having moved. `shape` stays pure geometry (what the kits legitimately consult); how to
  enforce it sits beside it, exactly like `edge_padding` does for bpskin.
- **The REQ-0183 `shape_conditioning: false` seam is retired**, superseded by
  `shape_lock: 'off'`. It was internal and nothing sent it.
- **Not exposed, deliberately:** Arm B / img2img (REQ-0153 killed it), the C2
  DifferentialDiffusion soft mask (coded in the spike but **never scored** — its findings
  table has no C2 row), and the scaffold gray tone (Q1 said sweep only if Arm A
  underperformed; never measured). Shipping unmeasured knobs as if they were tuned options
  is how a settings panel starts lying.

## Implementation

- `server/migrations/018_artwork_shape_lock.sql` — `shape_lock text`,
  `shape_dilation_px integer`, both nullable (NULL = default), with CHECK constraints
  mirroring the route's validation. Idempotent; migration-first is safe (old code never
  reads them, new code treats NULL as auto/8).
- `tools/art_shape.py` — `fills_bounding_box()`, `resolve_lock()`, `MAX_DILATION_PX`.
- `tools/art_job.py` — `shape_settings()` resolves (mask, effective lock, dilation) once;
  `guide` passes ONLY `reference_image`, `strict` passes the full trio, `off` passes
  nothing and the graph stays byte-identical to the unconditioned route. Both `guide` and
  `strict` use the edit-instruction prompt (both hand the model a scaffold).
- `server/storage_art.cjs` — the two columns through create/patch/map.
- `server/routes/art.cjs` — `shapeLockFields()` validates on create/patch/generate/preview
  (bad value = 400, never a silent coercion: a mis-typed lock must not quietly burn an hour
  of GPU at the wrong setting); create defaults po to `auto`; generate takes the one-shot
  override; preview reports the lock it would really run.
- `server/services/art_jobs.cjs` — override > artwork default > built-in; records the
  RESOLVED lock in `params.shape_lock` so the lightbox can say which setting made which
  render (without that, comparing two locks is guesswork).
- Client — lock select + conditional dilation input beside the 5x5 editor (saved via the
  existing explicit Save), and a "lock (this render only)" select in the generate strip.

## Verification

- `auto` rule over L / T / S-zigzag / 1x3 / 2x2 / 3x2 / 1x1: strict on every underfilled
  bbox, off on every full rectangle.
- Graphs per lock: `off` -> `latent_image=[6,0]`, no reference/mask nodes; `guide` ->
  ReferenceLatent positive, latent still `[6,0]`, NO SetLatentNoiseMask; `strict` ->
  ReferenceLatent + `latent_image=[22,0]` SetLatentNoiseMask. Mask-without-reference refused.
- Dilation 0/8/16 accepted, 17 and -1 refused; unknown lock refused.
- `artwork_test.cjs`: new gates for the auto rule, explicit locks, the non-mutating one-shot
  override, and validation.
- Migration applied to the live DB; both columns + both CHECK constraints verified present.

## Out of scope
- Backfilling existing po artworks (NULL already means auto).
- si/unit/monster/bpskin/custom (no cell shape to lock to).
- Any new arm or mechanism; this REQ only exposes what REQ-0153 measured.

## Gate results — 2026-07-15
- `tools/ci.sh` (SKIP_E2E): **CI GREEN**.
- `artwork_test.cjs` (pg): **11 passed, 0 failed** — incl. the two new REQ-0186 gates.
- `tools/artadmin_e2e.sh`: **5 passed**. `tools/art_inspect_e2e.sh`: **1 passed**.
- Migration 018 applied to the live DB; columns + CHECK constraints verified present.

## Integration pass — 2026-07-15

- **Merged to master** (`b6f7cc6`). Master moved twice mid-work (`e720e95` -> `7f03920` ->
  `7d66310`, docs-only both times, no overlap); merged in and re-certified each time rather
  than merging stale.
- **Re-certified after the last master merge:** `tools/ci.sh` (SKIP_E2E) **CI GREEN**;
  `artwork_test.cjs` **11/11**; `artadmin_e2e.sh` **5/5**; `art_inspect_e2e.sh` **1/1**.
- **Migration 018 applied** to the live DB; both columns and both CHECK constraints verified.
- **Client rebuilt** (this REQ does touch `client/`), committed dist == fresh build.
- **Deployed:** `backpack-api` restarted; api/web/tunnel active, ingress + `/app/#/artadmin`
  200.
- **Verified LIVE:** a full-rectangle po previews `lock=off` with the plain subject; the same
  artwork with a one-shot `{"shape_lock":"strict"}` previews `lock=strict D=8` with the edit
  instruction, without mutating the artwork. Bad values are refused with a 400.

**Defect found and fixed during this pass:** `hPreview` did not validate the lock, so a typo
(`shape_lock: "nonsense"`) reached the worker, threw, and surfaced as an opaque
**500 "preview failed"** — while create/patch/generate all returned a clean 400. Now
validated at the same guard: 400 with `shape_lock must be one of auto|off|guide|strict`.

**Observation for the owner — `auto` is currently a no-op on the whole live registry.**
Every po artwork registered today (22 of them: iron_sword 1x3, iron_shield 2x2,
large_iron_shield 2x3, healing_potion 1x2, blade/hilt/flame_tablet/oil_flask 1x2 or 1x1 ...)
is a FULL RECTANGLE, so `auto` resolves to `off` for all of them. That is the intended,
evidence-backed answer — REQ-0153 recorded the unconditioned baseline PASSING on exactly
these footprints — but it is worth stating plainly: on the registry as it stands, REQ-0183's
always-on conditioning was paying subject legibility and ~2-3x generation time on every
render and fixing a miss that was not occurring. `strict` will start engaging the moment a
genuinely awkward footprint (L, T, notched) is drawn, which is where REQ-0153 measured the
baseline at 28.6%.

**Disposition: STAYS in built/.** Merged, deployed, live-verified — but not yet accepted:
no real GPU render has been eyeballed (ComfyUI was busy with another session's job
throughout). Moving to done/ needs the owner to generate and accept.
