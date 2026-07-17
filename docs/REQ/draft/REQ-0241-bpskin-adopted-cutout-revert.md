# REQ-0241 — bpskin adopted-cutout revert: five tiling textures serve transparent

**Filed:** 2026-07-18, out of the REQ-0193 sweep verification.
**Ratified:** NOT YET — the user (chat, 2026-07-18) chose "leave live as-is, handle in
a separate REQ" when shown the finding. The disposition below is still open.

## Problem

Five `bpskin` artworks serve a **background-cutout render as their adopted image**.
bpskin artworks are tiling textures whose fills must stay **opaque** (operator
instruction, 2026-07-17); a transparent fill is wrong by construction.

| artwork | adopted (cutout) | original opaque seed |
|---|---|---|
| `bpskin-frames-0150:leather`   | 100202 | 202 |
| `bpskin-frames-0150:iron`      | 100001 | 1   |
| `bpskin-frames-0150:wood`      | 100001 | 1   |
| `bpskin-flux2-0150:elven`      | 100101 | 101 |
| `bpskin-flux2-0150:barbarian`  | 100101 | 101 |

Measured 2026-07-18 via `/tmp/verify_cutouts.py`: `bpskin-frames-0150:leather`
serves RGBA with `transp_frac=0.437` — i.e. 44% of the tile is holes.

## How it happened

The REQ-0193 live cutout sweep ran in two passes on 2026-07-17:

- `/tmp/cutout_batch.py` (~10:50-12:00) had **no kind filter** and cut out +
  adopted every adopted artwork, bpskin included.
- The operator instruction landed after that pass; `/tmp/make_sweep.py` patched the
  script into `/tmp/cutout_sweep.py` with `kind != 'bpskin'` at 12:09.

The exclusion therefore only ever protected **later** passes. The five
already-adopted bpskin cutouts were never reverted. The 2026-07-18 re-run
(done=26 skipped=154 failed=0) correctly touched no bpskin, so it did not clear
them either.

## Open decision (blocks this REQ)

1. **Revert only** — re-adopt each `derived_from_seed` above; leave the cutout
   renders in place (they are ordinary derived renders, deletable any time).
   Deterministic and reversible; every original render still exists and is `ok`.
2. **Revert + delete** — also delete the five bogus cutout renders so no bpskin
   cutout can be re-adopted by accident.
3. Whether a **guard** belongs in the route: `POST .../renders/:seed/cutout`
   could 400 on `kind === 'bpskin'`, so the rule stops depending on a caller-side
   filter in a /tmp script. This is the only part carrying a code change; without
   it the next sweep author repeats the mistake. Note that the REQ-0193 chip is
   deliberately kind-agnostic (per the user: "あらゆるart"), so a bpskin exception
   needs the user to say whether the chip should disappear for bpskin, or merely
   refuse when pressed.

## Out of scope

- REQ-0193 itself (delivered; this is live-data fallout, not a code defect).
- The matte implementation, and every other kind's cutouts (verified 180/180
  correct on 2026-07-18).
