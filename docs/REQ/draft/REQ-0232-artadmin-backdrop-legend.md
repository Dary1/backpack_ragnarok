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
