# REQ-0193 — artadmin-render-cutout: background cutout for ANY render

**Ratified:** 2026-07-16 (user, chat): "artworkのrendersに対して po.cell_fit:
not inspected run のように、nobackgroundcutout を表示して、あらゆるartがいつでも
背景抜きできるようにしてください。加工するとseedが10万上昇したコピーが配置され
ます" + "背景抜き処理は、自前で実装せず、有名なpythonソースをgitから取得して
ください" / "もしくはライブラリを使用" + "repackも白抜きが自動的に入るように
しておいてください".

**User design decisions (chat, 2026-07-16):**
- Output = **transparent alpha PNG** (RGBA), not a white composite.
- UI = a **dedicated chip in the KitChips row**, in the un-run kit grammar.
- Library = **reuse the existing rembg `birefnet-general`** (already a
  production dependency), imported — never forked, never re-implemented.

## What

Every `ok` render of EVERY artwork kind gets a `nobackgroundcutout` chip in
its KitChips row, styled exactly like an un-run kit:

    nobackgroundcutout: not cut  [run]

Pressing `run` mattes that render and registers the **background-removed RGBA
PNG** as a NEW render at **seed + 100000**, bumping by another 100000 while
that seed is taken — the REQ-0192 derived-seed convention (seeds >= 100000 are
derived; generation seeds stay below; repeated presses stack). Once a cutout
derived from that seed exists, the chip stops offering `run` and instead shows
the derived seed:

    nobackgroundcutout: cut -> seed 100043

A render that IS itself a cutout shows no run affordance (no cutout of a
cutout). Unlike a kit, this chip has **no verdict** — it is an action, not an
inspection; it borrows only the chip grammar the user pointed at.

**Kind-agnostic, by design.** The chip is NOT registered in
`tools/inspect_kits.json` and has no `applies_to` list: "あらゆるart" means po,
si, unit, bpskin, monster, custom — anything with an ok render.

**Repack now cuts out automatically.** `tool_cell_fit.apply_pack()` stops
compositing the packed piece onto white and returns the RGBA canvas it already
builds internally, so REQ-0192 repack output is transparent for free. This is
a behaviour change to REQ-0192's stored image, ratified above.

## How

- **Matte source — reuse, do not fork.** `gen_item_icons.matte_alpha_data()`
  (rembg `birefnet-general` primary + pure-numpy border-key fallback) is the
  one matte implementation in this tree; every matte caller
  (`inspect_kits.kit_matte_coverage_band`, `kit_po_cell_fit`, `pack_job`)
  already imports it. The cutout job imports it too — no new library, no new
  model weight, no new RAM ceiling (the REQ-0158 / REQ-0135b OOM history says
  a second matting stack is exactly what not to add).
- `tools/cutout_job.py` — one cutout job CLI (stdin JSON `{png_b64}` -> stdout
  JSON `{status, png_b64, method, image_alpha_coverage}`), same stdout-noise
  hygiene as `inspect_job.py` / `pack_job.py` (matting libs print PERFORMANCE
  WARNINGs to stdout; all in-run stdout routes to stderr and only the final
  JSON touches real stdout). `ART_KIT_MATTE_METHOD=borderkey` forces the
  model-free path for tests/e2e.
- `tools/tool_cell_fit.py` — `apply_pack()` returns RGBA (drop the trailing
  white composite; docstring updated). Sole caller is `pack_job.py`.
- `server/services/art_jobs.cjs` — `enqueueCutout()` + `processCutoutJob()` on
  the existing `packQueue` priority band (user-initiated: highest waiting
  priority, generation still jumps ahead). Completes the pre-created target
  row; params carry provenance (`derived: background_cutout`,
  `derived_from_seed`, tool id, matte method, coverage) per the REQ-0186
  attributability posture. Failure -> row status `failed` (deletable).
  Advisory kits auto-run on the cutout render — `matte.coverage_band` and
  `po.cell_fit` both take the provided alpha (`_has_real_alpha` -> method
  `provided`), so a cutout is measured on its own real matte, not a re-matte.
- `server/routes/art.cjs` — `POST /api/art/artworks/:name/renders/:seed/cutout`
  (admin-gated): 404 unknown artwork/render, 400 non-ok source, 400 source is
  already a cutout, 202 `{render, source_seed}`. Target row created up front
  (status `queued`) so the UI shows it immediately — same shape as `hRepack`.
- **Client** — `cutoutRenderApi()` in `client/src/api/admin.ts`; the chip in
  `KitChips.tsx` (new props `renders` + `onCutout`), which resolves "is there
  a cutout of this seed?" from the renders list it is handed
  (`params.derived === 'background_cutout' && params.derived_from_seed ===
  seed`) — `RenderDto.params` is already served, so no API shape change.
  Testids: `cutout-<seed>`, `run-cutout-<seed>`, `cutout-link-<seed>`.
  `Workspace.tsx` passes renders through; `ArtAdminPage.tsx` gets the handler
  next to `onRepack`.

## Verification

- `cutout_job.py` smoke (borderkey + real birefnet) on a po and a non-po
  render; assert the output PNG has a genuine alpha channel (`min(alpha) <
  250`) and a plausible `image_alpha_coverage`.
- Repack parity: after the `apply_pack` change, a repacked render is RGBA and
  its `po.cell_fit` score is unchanged (the fit meter reads alpha, and the
  white composite was never part of the measurement).
- Server tests + client build + `artadmin_e2e.sh` (chip renders for every
  kind; run -> 202 -> queued row; cutout-of-a-cutout offers no run).
- Live check on backpack-dev: run the chip on a real render, open the derived
  seed in the lightbox, confirm the background is actually gone.
- Gate results and commit hashes land here before this file moves to `built/`.

## Out of scope

- Auto-cutout on generation (this REQ is one manual, on-demand action).
- Replacing the matte model or adding a second one (REQ-0135b settled that;
  REQ-0147 owns the bg-clause A/B).
- Adopting a cutout as the artwork's serving image — Adopt already works on
  any ok render, including this one; nothing kind-specific is added here.
- Any change to `tools/inspect_kits.json` — this is not a kit.
