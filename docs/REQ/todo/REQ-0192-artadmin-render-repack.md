# REQ-0192 — artadmin-render-repack: a manual "Repack" button per render

**Ratified:** 2026-07-15 (user, chat, REQ-0187 session): "renderに再配置ボタンを
作って、ArtAdminのUIから個別に再配置版を手動生成させられるようにしてください。
押下するとseed値、10万たしていく感じで。"

## What

Per-render **Repack** button in the artadmin render card (po artworks, status
ok only). Pressing it derives a best-placement variant of that render — matte
-> tool_cell_fit pack search (feasible placements only: containment + the
no-contact pad guaranteed by construction; 4x90 rotations + flips; objective =
the REQ-0187 v5 cell-fit score, worst-spot aggregation, shifted expectation
centers) — registered as a NEW render at **seed + 100000**, bumping by another
100000 while that seed is taken (user convention: seeds >= 100000 are derived,
generation seeds stay below; repeated presses stack).

## How

- `tools/tool_cell_fit.py` — pack machinery promoted from the REQ-0187 spike
  (feasible_positions / pack_search / apply_pack).
- `tools/pack_job.py` — one repack job CLI (stdin JSON -> stdout JSON), same
  stdout-noise hygiene as inspect_job.py; ART_KIT_MATTE_METHOD=borderkey keeps
  tests/e2e off the GPU model.
- `server/services/art_jobs.cjs` — `enqueuePack()` + `processPackJob()` at
  inspection priority (generation always jumps ahead). Completes the
  pre-created target row with the packed image; params carry full provenance
  (`derived: packed_placement`, `derived_from_seed`, exact transform, both fit
  scores — the REQ-0186 attributability posture). Failure -> row status
  'failed' (deletable in the UI). Advisory kits auto-run on the packed render.
- `server/routes/art.cjs` — `POST /api/art/artworks/:name/renders/:seed/repack`
  (admin-gated): 404 unknown artwork/render, 400 non-po or non-ok source,
  202 {render, source_seed}. Target row created up front (status queued) so
  the UI shows it immediately.
- Client — `repackRenderApi()` + Repack button in the render card
  (`repack-<seed>` testid), handler refreshes the detail.

## Verification

- pack_job.py smoke (borderkey): req0187_scythe seed 43 -> ok, transform
  s=0.9875 pos(5,5), identity 66.17 (matches the po.cell_fit kit's 66.06 by
  birefnet), output PNG 768x768.
- Server tests + client build: see gate results below.
- Live: repack of a real render lands at seed+100000 with provenance params
  and kit rows. [recorded below when done]

## Out of scope

- Cell-shape backdrop display (REQ-0191).
- Auto-repack policies / the instrument-driven revision loop (REQ-0187
  follow-up); this REQ is one manual button.
