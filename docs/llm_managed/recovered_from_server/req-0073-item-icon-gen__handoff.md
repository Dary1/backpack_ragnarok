# handoff.md — Item authoring via the REQ-0073 AI-icon route

Audience: Sonnet 5.0 (or any successor model) continuing to author NEW items
for backpack_ragnarok using the batch-003 pipeline. Written by Fable 5
(orchestrator of REQ-0073), 2026-07-07.

Read first: `docs/REQ-0073-item-icon-gen.md` (normative spec) and
`content/batches/batch-003-item-icons/style_guide.md` (art direction, prompt
template, negative prompt — copy its patterns verbatim).
For the unfinished batch-003 finalization state, see
`docs/HANDOFF-WIP-req-0073-resume.md`.

## The route in one paragraph

Item DB = `content/live/live_items.json` (schema `po/2`, `entries[]`). Each
entry carries three generation fields (additive; never touch other fields):
`gen_prompt`, `gen_negative`, `gen_render`. A ComfyUI pipeline generates 4
seeded candidates per item, a matting pass extracts alpha, a purely
geometric scorer (NO aesthetic judgement — hard user directive) picks the
candidate that best fills the item's cell shape after auto rotate/flip/
scale/place, and a static report page shows everything. This route is
separate from the legacy SVG sprite workflow; ignore workflow docs that
describe sprites/defs.

## Authoring a new item (checklist)

1. Add the normal po/2 entry (id, name, rarity, shape, sockets, effects,
   flavor, tags, i18n.ja). Shape cells are `[row,col]`.
2. `gen_render` (compute, don't guess):
   - `cell_px`: 256 (1 cell = 256×256 final px)
   - `cells`: normalized copy of `shape`
   - `bbox_cells`: [w,h] of the cell bounding box
   - `target_px`: [w*256, h*256] — final canvas, ALWAYS rectangular even for
     irregular shapes (diffusion only accepts rectangles)
   - `gen_px`: same aspect as target_px, ≈1MP, both dims multiples of 64.
     Known-good: 1×1→[1024,1024]; 1w×2h→[704,1408]; 2×2→[1024,1024]
   - `mask_cells`: ONLY for irregular (non-rectangular) shapes — the owned
     cells; drives ComfyUI ConditioningSetMask bias (best-effort only).
3. `gen_prompt`: object description faithful to name/flavor/tags
   + the composition line matching the footprint (vertical fill / square
   fill / L-mass) + the style/background token block from style_guide.md.
   `gen_negative`: the standard negative from style_guide.md.
4. Generate (ComfyUI must be running on 127.0.0.1:8188; checkpoint
   `JuggernautXL_RunDiffusionPhoto2_V9_Final.safetensors` — note: user
   originally said "v6" but v6 is NOT installed; V9 is the confirmed
   substitute):
   ```
   cd ~/backpack_ragnarok && setsid nohup .venv/bin/python \
     tools/gen_item_icons.py --defs content/live/live_items.json \
     --ids <new_id> --outdir content/batches/<batch-dir>/candidates \
     > tmp/gen.log 2>&1 &
   ```
   Defaults: 4 candidates, seeds 101/202/303/404, 30 steps, cfg 6.5,
   dpmpp_2m/karras. ~23s/image warm on the RTX 2080 (8GB, sequential).
   `--rematte-only` re-runs matting without regenerating.
5. Score + select (geometry only):
   ```
   .venv/bin/python tools/tool_icon_score.py \
     --defs content/live/live_items.json \
     --candidates-dir content/batches/<batch-dir>/candidates \
     --out content/batches/<batch-dir>/scores.json \
     --render-dir content/batches/<batch-dir>/fit_renders \
     --select-dir content/batches/<batch-dir>/selected
   ```
   (Check the argparse in the file — flag names are authoritative there.)
6. Report: adapt `tools/build_batch003_report.py` for the new batch dir →
   `web/preview/<batch>/index.html` (self-contained, relative paths,
   dark theme). Public URL: https://backpack-dev.qtie.jp/preview/<batch>/

## Hard-won gotchas (all hit during batch-003)

- SDXL ignores soft constraints: "near-white background" sometimes yields
  dark charcoal backdrops; "blade with no hilt" yielded full swords.
  Strengthen tokens, but rely on the pipeline, not on obedience:
  matting uses rembg `birefnet-general` (robust to any uniform backdrop)
  with a border-color-key fallback; validity band = 2%–90% opaque coverage.
- Scorer gate: `MIN_CONTENT_FRAC = 0.02` — candidates whose alpha is <2%
  of the canvas are infeasible (`content_too_small`). This exists because a
  matting-failure noise speck once scored 87.33 (solve() upscales tiny
  blobs). Do not remove the gate.
- Score = 100·(0.35·scale + 0.50·coverage + 0.15·uniformity), 0 if
  infeasible. Weights live in tool_icon_score.py's header. NEVER add
  aesthetic terms (explicit user directive); design quality is judged by
  humans on the report page.
- `tool_fit_check.py` is a NORMATIVE reference port (REQ-0020): import it,
  never fork/reimplement its algorithms.
- Cell convention is `[row,col]` everywhere. Confirm against
  tool_fit_check.shape_to_cellset when in doubt.
- Everything must be reproducible: fixed seeds, deterministic scoring,
  deterministic report builder.
- Work on a `req-XXXX-*` branch with a matching `docs/REQ-XXXX-*.md`
  (see docs/ for the format). One logical change per commit.
- bash-over-ssh sessions here have short timeouts: run anything >30s via
  `setsid nohup ... &` and poll the log.
- The live game server (node, runs as root) READS content/live/*.json.
  Fields are additive and po/2-compatible, but sanity-check the game still
  boots after schema-affecting edits.
