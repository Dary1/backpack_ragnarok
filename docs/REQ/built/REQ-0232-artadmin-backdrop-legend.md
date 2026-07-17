# REQ-0232 - artadmin: cell-backdrop legend + small-thumb fit badge

**Reserved:** 2026-07-17 (observed during REQ-0216)
**Slug:** artadmin-backdrop-legend

## Problem

The REQ-0191 cell backdrop encodes four things visually (checker = bbox cell
NOT in the mask; pale gold = owned, no violation; gold->pale-blood ramp =
po.cell_fit per-cell violation up to the 0.5 alarm; thick blood border =
worst cell) plus the fit-score badge -- and NONE of it is legible in the UI
itself. The user had to ask for a verbal explanation (2026-07-17); the
answer lives in this conversation and in code comments, not on the page.
REQ-0216 fixed the SIZE axis (true-scale thumbs); this fixes the MEANING axis.

Secondary: after REQ-0216 a 1x1 thumb is 42px wide, and the fit badge
("fit 100", ~40px at 9px font) covers nearly the whole render.

## Proposal

- A compact legend, one line under the gallery head (or a hover popover on
  the `cells` chip): checker / gold / ramp->red / thick-red swatches with
  3-4-word labels, plus "fit N = po.cell_fit score, advisory".
- Hide (or shrink to a dot) the per-thumb fit badge when the stage is
  narrower than ~64px; the lightbox keeps the full badge.

## Gates

- e2e: legend visible with the backdrop ON, absent OFF; badge hidden on a
  1x1 thumb, present in its lightbox.
- ci.sh green.

## What was done

`CellBackdrop.tsx` gained two exports of one idea -- make the REQ-0191
encoding legible where it is used:

- `CellLegend` -- one flex line of 12px swatches whose CSS restates
  `.aa-cb-cell` / `.aa-cb-line` exactly (checker / pale gold / gold->blood
  ramp / thick blood border), plus "fit N = po.cell_fit score, advisory".
  `Workspace.tsx` renders it under the gallery head gated on `thumbBb`, the
  SAME expression the thumbs draw the backdrop from (`kind === po &&
  props.cells && savedMask`). So the legend cannot label swatches that are
  not on screen -- it follows the `art-cells` toggle by construction, not by
  a second copy of the condition.
- `SCORE_MIN_STAGE_PX = 64` -- `CellStage` drops the fit badge when
  `widthPx` is under it. A 1x1 thumb (42px after REQ-0216) sheds a ~40px
  badge that covered the render it annotates; every >=2-cell thumb (84px)
  and every lightbox stage (basis >=256px) keeps it. The 1x1 badge is not
  lost, only deferred to its lightbox.

## Gate results (2026-07-17)

- `tools/ci.sh` -> **CI GREEN** (exit 0). Includes step [0/8] port rule,
  typecheck+build, the admin trio, registry-first (REQ-0221), and the
  scoped hermetic fleet suite in the REQ-0232 decade: **187 passed, 1
  skipped, 0 failed** (4.8m).
- The 1 skip is `dex-admin.spec.ts` REQ-0182b (admin PUT 409 on a
  registry-served item): pre-existing and expected -- the default fleet is
  files-backed and the registry is pg-only, which is exactly why ci.sh
  stage [6.6/8] covers that path separately. Not related to this REQ.
- `tools/artadmin_e2e.sh` -> **8/8 passed**, including the new spec
  `REQ-0232 backdrop legend + small-thumb badge: legend follows the toggle;
  a 1x1 thumb sheds the fit badge, its lightbox keeps it`.
- `client && pnpm run build` reproduced the committed bundle
  (`index-SmqqMq31.js`), confirming the `web/app` rebuild commit is current.

## Commits (branch `req-0232-artadmin-backdrop-legend`)

- `02e29a1` REQ-0232: draft -> todo (user go-ahead 2026-07-17)
- `33223d0` REQ-0232: cell-backdrop legend + small-thumb fit badge cutoff
- `ccd8f7a` REQ-0232: rebuild web/app

## Outcome

Implementation complete, all gates green -> `built/`. NOT merged to master
and NOT deployed; awaiting user acceptance (the legend wording and swatch
set are a UI judgement call the user should see first).
