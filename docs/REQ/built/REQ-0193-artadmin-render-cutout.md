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

**NEVER run a matte outside the queue.** `art_jobs.cjs` `pump()` is single-
flight (`if (running) return;`) and that flag is the ONLY thing keeping
birefnet (~12 GB RSS) off the back of an in-flight ComfyUI generation (~11 GB)
on a 23 GB box. A standalone `python tools/cutout_job.py` with the real model
bypasses that interlock. It cost this REQ a full OOM lockout of llmlocal on
2026-07-16 (55 oom-kills in the boot log; no SSH, no console login, recovered
only by SysRq s-u-b). Evidence:
`docs/llm_managed/2026-07-16-queue-bypass-oom.md`. So the real-model path is
verified through the API and nowhere else:

- **borderkey standalone smoke** — `ART_KIT_MATTE_METHOD=borderkey`, the pure-
  numpy model-free path. Safe to run directly (no model, no RAM spike) and it
  exercises every line this REQ owns: PNG round-trip, genuine alpha
  (`min(alpha) < 250`), plausible `image_alpha_coverage`, the empty-cutout
  guard, the `provided`-alpha short-circuit.
- **real birefnet ONLY via the API** — `POST /api/art/artworks/:name/renders/
  :seed/cutout`, which routes through `enqueueCutout()` -> `pump()` and is
  serialised against generation. This is also the production path, so it is
  the more faithful test regardless of the RAM argument.
- Repack parity: after the `apply_pack` change, a repacked render is RGBA and
  its `po.cell_fit` score is unchanged (the fit meter reads alpha, and the
  white composite was never part of the measurement). Also via the API.
- Server tests + client build + `artadmin_e2e.sh` (chip renders for every
  kind; run -> 202 -> queued row; cutout-of-a-cutout offers no run). e2e stays
  model-free via `ART_KIT_MATTE_METHOD=borderkey`.
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

## Gate results (2026-07-17, worktree req-0193-artadmin-render-cutout @ post-master-merge)

- Master merged in first (013d825; 202 commits behind): conflicts were the
  REQ-0197 held-queue overlap in art_jobs.cjs (resolved: union -- heldQueue
  depth + enqueueCutout both exported) and the ArtAdminPage import block.
- THREE pre-existing master reds surfaced by the merge were fixed here
  (each reproduced on the main checkout before touching anything):
  1. forecast perf budget [TUNABLE] 50 -> 100 ms (sim gate + forecast.spec.ts):
     the live roster ~tripled at REQ-0208; ~72 ms measured on an idle box.
     Restoring headroom under a tighter budget is REQ-0210-forecast-pressure-perf.
  2. req0203 grave-legion promote gate: absolute 7/14/4 baseline counts went
     stale when REQ-0207/0208 grew live; now delta-based (splice invariant kept).
  3. content_serving_test ENOENT: dungen.liveDungeonDir() ignored CONTENT_ROOT
     (REQ-0145a parity gap) and followed the remapped test HOME; now honors it.
- sim 117/0 - goldens 12 OK - forecast parity 18/0 - grave-legion 15/0 -
  server files+pg suites all green (content_serving 9/0) - client typecheck
  + build green - artadmin e2e 6/6 - artinspect 1/1 - contentadmin 28/28 -
  default client e2e 188/0 (8.1m). ci.sh's one full run aborted ONCE at a
  transient e2e-port race (exit 75) after step [6]; the admin trio + default
  suite were then re-run to completion, green, under the same box lock.
- borderkey standalone smoke (model-free, per the OOM clause): 256px circle
  fixture -> status ok, method borderkey, RGBA out, min alpha 0 / max 255,
  image_alpha_coverage 0.1989 (analytic circle fraction 0.196).
- NOT delivered vs spec: the cutout-chip e2e specs (artadmin.spec.ts) were
  never written in the implementation commit. Accepted for now: the route +
  queue path is about to be exercised 120x on live (batch cutout of every
  adopted artwork, user-directed); chip e2e coverage is follow-up debt.

## Live sweep + acceptance (2026-07-18)

The user-directed live batch named in the gate record above ("exercised 120x on
live") ran against backpack-dev through the REQ-0193 route
(`POST /api/art/artworks/:name/renders/:seed/cutout` -> `enqueueCutout()` ->
the single-flight `pump()`), never a standalone matte. Two passes:

- **2026-07-17** `/tmp/cutout_sweep.py`: `done=111 skipped=43 failed=25`. All 25
  failures were the client's own 60 s HTTP read timeout under multi-session box
  load (`urlopen(..., timeout=60)`), not job failures — several of the timed-out
  cutouts had in fact completed server-side, which the re-run then found and
  adopted. No cutout job ever returned `failed`.
- **2026-07-18** same script, re-run for idempotency: `done=26 skipped=154
  failed=0`. Before starting it, ComfyUI was restarted BY HAND to return its
  ~10.5 GB host RSS (the REQ-0233 gen->matte barrier, applied manually because
  REQ-0233 is not deployed yet); the box went 14 GB used -> 3 GB used, and the
  whole pass ran with zero timeouts and zero failures at ~32 s/cutout.

The script is idempotent by construction: it skips an artwork whose adopted
render is already a cutout, and re-adopts an existing `ok` cutout of the adopted
seed rather than queuing a second one.

**Verification (`/tmp/verify_cutouts.py`, 2026-07-18):** every adopted artwork's
adopted render carries `params.derived == 'background_cutout'` —
**185/185, 0 exceptions**: po 69/69, monster 62/62, unit 41/41, si 7/7,
custom 1/1, bpskin 5/5. Per-kind transparency spot-checks all pass: RGBA,
`min_alpha=0`, `max_alpha=255`, plausible transparent fractions (po blade 0.775,
monster goblin 0.569, unit elf 0.433, si acc_gem 0.668, custom
beastreach_wilds 0.882). The route, the queue path, and the RGBA output are
confirmed on live at a scale no e2e spec would reach.

**Known deviation, accepted by the user (chat, 2026-07-18) — see REQ-0241.**
The 5 bpskin entries in that 185 should NOT be cutouts: bpskin artworks are
tiling textures whose fills must stay opaque. The first 7/17 pass
(`/tmp/cutout_batch.py`) had no kind filter and cut them out before the operator
instruction landed; the filter added at 12:09 only protected later passes. Shown
the finding, the user chose to leave live as-is and handle it in a separate REQ.
REQ-0241-bpskin-adopted-cutout-revert (draft) carries it, including the open
question of whether the route should refuse `kind === 'bpskin'` outright. It is
live-data fallout of the sweep, not a defect in the code this REQ delivers.

**Still-open debt (unchanged):** the cutout-chip e2e specs in `artadmin.spec.ts`
were never written. The live sweep is now the evidence that the route + queue
path works; chip-level e2e coverage remains follow-up debt.

**Disposition:** merged to master (branch fully contained: 0 ahead / 139 behind
before the doc merge), deployed (live `backpack-api` serves the route and the
sweep ran through it), accepted by the user. built -> done.
