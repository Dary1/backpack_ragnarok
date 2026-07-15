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
