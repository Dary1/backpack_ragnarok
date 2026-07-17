# REQ-0191 — artadmin-cell-shape-backdrop: render po images over their cell footprint

**Ratified:** 2026-07-15 (user, chat, during the REQ-0187 S7 session):
"セル形状が分かりやすいように、背景をセル形状にして、有効セルと無効セルで色を分けて表示"
(make the cell shape legible: draw the background as the cell footprint, with
owned and unowned cells in different colors). Scoped as display-only by the
user ("REQに起こすだけでOK" — file the REQ, implement later).

## Problem

The artadmin lightbox shows a po render on plain white. Whether the subject
actually sits inside its owned cells — the whole question REQ-0183/0186/0187
exist to answer — is invisible without exporting to an image editor: the user
had to hand-compose grid overlays in GIMP to judge seed 1's diagonal miss
(REQ-0187 session, 2026-07-15). What the eye needs is exactly what those
hand-made overlays showed: the footprint behind the alpha.

## What to build

In the artadmin render lightbox (and ideally the render thumbnails), draw a
backdrop behind the (matted or white-keyed) render:

- The artwork's 5x5 `shape.mask` bbox, scaled to the render, one tile per cell.
- OWNED cells in one clear tint, UNOWNED bbox cells in a distinct one
  (the user's own mockups used yellow vs checkerboard-transparent; exact
  palette is the implementer's choice, ratified at S7).
- Cell grid lines on the boundaries (the user's mockups drew them; they are
  what makes border-skimming readable).
- Toggleable (default ON for po), so the plain view stays reachable.
- po-kind only; other kinds have no cell footprint.

Display-time compositing only — no new columns, no route changes, no stored
images. The client already has the shape mask on the artwork payload.

Nice-to-have, same surface: show `po.cell_fit` fit_score + worst-cell tint on
the same overlay (per-cell v values are already in the kit row's notes), so
the meter's verdict and the eyeball look at the same picture.

## Why it matters (REQ-0187 findings)

The fit doctrine (item_content_pipeline.md §0.2) judges violations the eye
checks against the grid: border-skimming, starved cells, diagonal
compositions. Every one of those is only visible against the footprint. This
backdrop turns the S7 eyeball from an export-to-GIMP ritual into a glance.

## Out of scope

- Any scoring/route change (po.cell_fit shipped with REQ-0187).
- The packed-placement "pack" button (separate follow-up).
- Client-side matting; use the render as stored (white background) with
  multiply/luminance keying, or the adopted alpha when present.

---

# Implementation (2026-07-15)

**Branch:** `req-0191-artadmin-cell-shape-backdrop` (off master `64e18f7`; the spec
commits were cherry-picked off `req-0187`, where they were stranded).
**Scope ruling (user, at implementation):** lightbox **+ thumbnails**, and the
`po.cell_fit` nice-to-have **included** — so the whole REQ shipped, not just its
required half.

## What shipped

`client/src/artadmin/CellBackdrop.tsx` (new) — the whole mechanism, shared by both
surfaces so the gallery and the lightbox can never disagree about what is on screen:

- **The footprint.** `maskBbox()` reduces the artwork's 5x5 `shape.mask` to its bbox —
  which IS the render's footprint (the sizing law renders the bbox at 256/cell). Owned
  cells take a pale-gold tint, unowned bbox cells a light checker, and a grid-line layer
  sits ON TOP of the pixels (under them it would be invisible exactly where
  border-skimming has to be read).
- **Alignment without measurement.** The wrapper carries `aspect-ratio: cols/rows` and the
  render fills it, so the grid stays locked to the pixels at every zoom with no
  measuring, no resize observers, no reflow race.
- **Keying, both cases (as the spec asked).** `useNeedsWhiteKey()` reads the loaded
  image's corners on a 2x2 canvas: an opaque render is stored-on-white and gets
  `mix-blend-mode: multiply` (white * tint = tint); a real-alpha render — i.e. most of the
  live registry, the batch-backfilled/adopted ones — is composited plainly, because it
  already keys itself and multiplying it would cost the subject ~25% of its blue: a warm
  cast on the very pixels being judged. Verified live on both branches (below).
- **The fit meter, on the same picture.** `cellFitFrom()` tints each owned cell along the
  `po.cell_fit` violation ramp (pale gold -> pale blood, saturating at the kit's own
  `v <= 0.5` S7 threshold), rings the worst cell, and shows `fit NN` in the corner —
  stale rows say so. The meter's verdict and the eyeball now look at one image.

**Wiring.** `ArtAdminPage` owns one `cells` switch and derives both inputs
(`savedMask`, `fitBySeed`); `Workspace` wraps the thumbs (chip: `art-cells`), `Lightbox`
wraps the pane (chip: `lightbox-cells`). Default ON for po, inert elsewhere. Every
existing testid/src contract survives the wrap — the `<img>` is passed through as a
child, never re-created.

## Two calls worth recording

- **The backdrop is drawn from the SAVED mask, never the draft.** An unsaved click in the
  shape editor must not repaint the footprint under renders made against the saved one.
  Same reason `art-shape-warn` exists.
- **A render whose aspect disagrees with the mask gets NO backdrop** (`aspectMatches`).
  That is the shape-edited-after-render case; a grid drawn there would be misaligned
  while presenting itself as ground truth. No overlay beats a lying overlay.

## The one piece of ugliness, stated plainly

`po.cell_fit` publishes its per-cell `v` values **only inside its prose note**. The tint
parses them out with a regex. Promoting them to `metrics` is the clean fix and was
rejected on cost: it means a `kit_version` bump, which marks every stored inspection row
stale and forces a re-inspection of the registry to get a tint back. So the note is now
an interface — and it is pinned as one: `inspect_kits_test.py` re-parses the note with
**the client's own regex** and asserts the numbers come back, the keys are the
bbox-normalized cells the client indexes by, and `worst_cell_violation` equals the max
parsed `v`. Reword the note and that gate fails loudly, instead of the overlay silently
losing its tint on screen. (`parseCellV` also degrades to no-tint, never to a wrong tint.)

## Gates

- `tools/ci.sh` -> **CI GREEN** (full run: 178 default e2e passed, admin trio green,
  typecheck + build clean).
- `artadmin` e2e **6/6**, including the new spec `REQ-0191 cell backdrop: po renders draw
  over their footprint (owned vs unowned), toggleable, po-only`. It uses an **L-tromino**
  on purpose: the existing `e2e_sword` is a full 1x3 rectangle whose bbox has no unowned
  cell and so cannot show the split at all. Covers: thumb + lightbox backdrop, owned vs
  unowned per cell, both toggles off/on, backdrop survives a zoom change, `data-key`
  keying choice, and po-only (an si artwork gets no chip and no backdrop).
- `inspect_kits_test.py` **36/36** (4 new REQ-0191 contract checks + `po.cell_fit` added
  to the G2 purity sweep, which it had been missing).

## S7 eyeball — done, on a real render

Not deferred: verified against the LIVE registry (`tower_shield`, adopted s2147483647,
real 256x256 render, 2x2 footprint) through a read-only rig — this worktree's build
served on the REQ-derived port 1910 with `/api` proxied to the live api, non-GET refused
so the rig could not mutate a live row. The footprint lands square on the pixels, the
grid lines read across the subject, and the keying probe correctly reported `data-key=alpha`
(true colour, no multiply). Screenshots shown to the user in-session.

**Known gap, inherited not introduced:** every po in the live registry is a full
rectangle (REQ-0187's blocking precondition), so the owned/unowned split has no live
subject yet and was verified on the e2e L-tromino only. REQ-0187's awkward test artworks
are what close this, and the backdrop is what REQ-0187 will look at when they exist.

## Not done (deliberately)

- The packed-placement "pack" button — out of scope, and REQ-0192 now owns that ground.
- Any scoring or route change: `po.cell_fit` was read, never touched.

---

# Merge & Deploy (2026-07-16)

**User go-ahead.** The user directed the session to finish the TODO REQs and
answered "go on" (chat, 2026-07-16) to continuing with REQ-0191; merge + deploy
+ post-deploy verification are thereby sanctioned. ("go on" is read as the
go-ahead -- this is the orchestrator's interpretation, labeled as such.)

**Brought current with master.** Merged master `f8076d7` (REQ-0129 vocab v14,
REQ-0182b dex-edit-retirement, REQ-0187 S7, REQ-0192 repack, REQ-0194,
REQ-0195*, REQ-0197 deferred-batch, REQ-0198 + master dist rebuild) into the
branch -> integration merge `a4d378a`. `ArtAdminPage.tsx` and `Workspace.tsx`
auto-merged cleanly (master's REQ-0192 repack + REQ-0197 batch controls and this
REQ's cell-backdrop wiring sit in disjoint regions; both kept). REQ-file
reconciled: master carried a duplicate copy in `todo/` (the reserve+spec commits
that rode on req-0187, hashes 13905d4/4adbf40, already on master); removed it so
the REQ lives in exactly one state folder (`built/`).

**Gates re-run on the merged tree** (branch `a4d378a`, whose tree is
BYTE-IDENTICAL to the post-merge master tree `d4afaeb` -- verified by
`git rev-parse`, so this gate is authoritative for the deployed tree):
- `tools/ci.sh` -> **CI GREEN**. Admin trio: artadmin **6/6** (incl. the
  REQ-0191 `cell backdrop` spec, 13.0s), artinspect **1/1**, contentadmin
  **28/28** (REQ-0182b-reshaped). Default suite **183 passed / 1 skipped**.
  Typecheck + `pnpm run build` clean.
- `tools/tests/inspect_kits_test.py` -> **36/36** (the 4 REQ-0191 note-as-
  interface contract checks + po.cell_fit G2 purity included).

**Merged to master:** `d4afaeb` (`git merge --no-ff`). Net delta added to master
vs `f8076d7` is EXACTLY the 7 REQ-0191 files (artadmin.spec.ts, ArtAdminPage,
CellBackdrop, Lightbox, Workspace, artadmin.css, inspect_kits_test) -- only this
REQ's delta landed. (REQ-0199 routes-jwt-auth-parity, another session, merged
server-only on top afterward -- no client/web changes, so it does not affect this
client dist.)

**Deploy (client-only -- the REQ touches no server code):**
- `tools/release.sh` was run first (the one deploy path). It **aborted on an
  environmental e2e flake** (documented next), before its dist commit. Per the
  established recovery convention (REQ-0182b), e2e was completed green via the
  locked runner on the byte-identical tree, and the dist was committed per
  convention.
- Dist rebuild committed: **`86dd827`** ("deploy: rebuild client dist (REQ-0191
  artadmin-cell-shape-backdrop)"), bundle `index-BnJYIYh2.js` (1,421,127 B).
- Service restarted: **`backpack-web`** at **2026-07-16T10:55:00 UTC**
  (`systemctl --user restart`). `backpack-api` deliberately NOT restarted --
  no server code in this REQ's delta.

**The flake, documented honestly (NOT a regression).** On master the isolated
`artadmin_e2e.sh` harness reliably failed ONE test -- the REQ-0191 spec's
`page.goto('/app/#/artadmin')` -- with `TimeoutError: page.goto: Timeout
20000ms exceeded` (the document `load` event, never a backdrop assertion). Root
cause: the box was under heavy concurrent load from the user's separate GPU/art
workload (`pt_main_thread`, ~40% mem; load average ~10), which starves the
harness's single-threaded `python3 -m http.server` serving the 1.4 MB PixiJS
SPA. The failure time scales directly with box load: **13.0s (branch run, quiet
box -> PASS) -> 22.1s (load ~7 -> FAIL, barely over the 20s line) -> 27-29s
(load ~10 -> FAIL)**. Every failed run's Playwright snapshot shows the FULL
artadmin UI rendered (Artwork Registry, sidebar, the "po 1 / si 1" kind filters
= the two artworks the test created); an UNRELATED test (`deep link`, untouched
by 0191) flakes the same way intermittently. The feature is verified correct by
the branch CI GREEN (this same spec passed at 13.0s on the byte-identical tree)
plus the full render in every snapshot. This is the known "occasional page.goto
timeouts" flaky family, amplified by external load -- exactly the case the
release.sh recovery convention covers.

**Post-deploy verification (on live):**
- Live bundle served by `backpack-web` (127.0.0.1:8801) is `index-BnJYIYh2.js`
  and carries the backdrop symbols: `lightbox-cells`, `art-cells`,
  `aa-cb-render`, `render-cb-`, `data-key` present in the JS; the `aa-cb-*`
  classes present in the CSS. The new feature bundle is live.
- Bare `pnpm run e2e` against live (`https://backpack-dev.qtie.jp`, the way
  REQ-0182b verified): **184 passed / 0 failed (14.2m)**; live profile backed up
  and restored by global setup/teardown.

**Status: stays in `built/`.** Code is merged + live, but user S7 acceptance is
pending (do NOT move to `done/` until the user has eyeballed it).

## S7 eyeball checklist (for the user, on the LIVE artadmin)

Open `https://backpack-dev.qtie.jp/app/#/artadmin` and:
1. Select any adopted **po** artwork with renders. The render thumbnails now sit
   ON their cell footprint by default -- a **"cells"** chip appears next to
   "Renders (N)"; toggle it off to get the old plain thumbs back, on to restore.
2. Owned cells show a **pale-gold** tint; unowned bbox cells show a **light
   checker** ("not yours"). **Grid lines** trace every cell boundary on top of
   the pixels, so border-skimming reads across the subject.
   (NB: every po in the live registry is currently a full rectangle, so its bbox
   has no unowned cell yet -- the owned/unowned split is exercised by the e2e
   L-tromino; REQ-0187's awkward test artworks are what will show it live.)
3. Click a thumb to open the **lightbox**: same backdrop, default ON, with its
   own **"cells"** chip. Zoom (1x/2x/4x) -- the grid stays locked to the pixels.
4. If a `po.cell_fit` inspection has run, each owned cell is tinted along its
   violation ramp (pale gold -> pale blood), the worst cell is ringed, and a
   **"fit NN"** badge shows in the corner (says "(stale)" if the row predates the
   current kit). Toggle "cells" off to confirm the plain render is one click away.
5. Confirm a **si** (non-po) artwork shows **no** "cells" chip and no backdrop.
