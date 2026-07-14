# REQ-0127 — unit-icon-generation

**Status:** built (S7 ALL GREEN, 2026-07-13; awaiting deploy/acceptance)
**Reserved:** 2026-07-11
**Slug:** unit-icon-generation
**Reference:** `docs/llm_managed/unit_icon_pipeline.md` v1 (golden RATIFIED
2026-07-12)
**Ordering caveat:** the AI-raster route tools live on branch
`req-0073-item-icon-gen` until REQ-0109 merges — same operating caveat as
item icon batches; not a blocker (run from that branch as items do today).

## Goal

Implement the ratified Unit Icon pipeline end to end and run the first
roster batch up to the S7 user-review stop.

## Scope

1. **Tooling**: `gen_unit_icons` as a thin wrapper (or `--defs` mode) over
   `tools/gen_item_icons.py`; `gen_render` constant for 1×1 (target 256×256,
   gen 1024×1024, Lanczos downscale); ComfyUI route unchanged
   (JuggernautXL V9, 4 candidates, seeds 101/202/303/404, 30 steps, cfg 6.5,
   dpmpp_2m/karras, `setsid nohup` for long runs).
2. **Style guide**: unit style template per pipeline S2 (painterly
   dark-fantasy CHARACTER icon, stylization tokens front-loaded, near-white
   background, NOT photorealistic). Bust vs full-body: resolve via the
   bakeoff below before the main batch (pipeline open item 1).
3. **Bakeoff batch** (pattern: monsters-002-style-bakeoff): 2–3 units
   rendered bust AND full-body; user picks the roster-wide framing. This
   settles pipeline open item 1; record the ruling in this file and in the
   pipeline doc.
4. **First roster batch**: the user-authored roster seed list (elf, dwarf,
   thief, angel, shieldmaiden, priest, princess towers, light cavalry,
   berserker, necromancer, watcher, squire — final list at batch brief).
   Matte via rembg `birefnet-general` + edge-key fallback; matte quality
   shown in gallery; `--rematte-only` reruns.
5. **Scoring as FILTER only**: `tool_icon_score.py` auto-FAILs coverage
   < 20% (art_golden); it never picks winners — user gallery verdict selects
   (ratified golden deviation from the item route).
6. **Gallery**: `web/preview/units-NNN/` on backpack-dev, every candidate at
   256 px AND 64 px side by side (golden G4), numbered.
7. **STOP at S7**: user review; accepted numbers recorded in batch notes.
   Def authoring (connection shape, charge, effects, `i18n.ja`) stays OUT of
   this REQ (illustration-first: art precedes data; defs get their own REQ).

## Out of scope

- Client rendering of unit icons (REQ-0125).
- Backpack skins (REQ-0126 system; art has its own pipeline proposal).
- Unit def/content pipeline (future doc + REQ).

## Gates

- Bakeoff ruling recorded before main batch generation starts.
- Every shipped candidate passes coverage ≥ 20% and shows correctly in the
  256/64 px gallery.
- S7 stop honored: nothing enters `content/live/` in this REQ.


---

## Progress record (2026-07-12, session batch REQ-0136/0138/0131/0127/0137)

### Bakeoff ruling — RECORDED (gate 1 satisfied)

**Bust**, roster-wide. The framing bakeoff planned as scope item 3 was
superseded before execution: the 2026-07-12 review session ratified
"bust for the 1x1 board icon" (ALL GREEN) and it is recorded as
`unit_icon_pipeline.md` v1.1 §3 item 1 (decision log). Full-body art of
the same character is a separate dex/splash asset sharing one identity
(REQ-0137); it is never the board icon. Per this REQ's gate ("bakeoff
ruling recorded before main batch generation starts"), this section is
that record; no framing bakeoff batch will be generated.

### Tooling — DONE (scope item 1, 2)

- `tools/gen_unit_icons.py`: thin wrapper over `tools/gen_item_icons.py`
  (defaults `--defs`/`--outdir` to `content/batches/units-001-roster/`;
  inherits 4 candidates, seeds 101/202/303/404, 30 steps, cfg 6.5,
  dpmpp_2m/karras, birefnet matte + border-key fallback, --rematte-only).
  `make-defs` subcommand regenerates the defs from the roster concept
  table (single source of truth in the wrapper). `--ckpt` override ready
  for the REQ-0136 winner (SDXL family; a non-SDXL winner would port the
  route as part of REQ-0136 implementation).
- `content/batches/units-001-roster/style_guide.md`: unit style template
  per pipeline S2 (painterly dark-fantasy CHARACTER icon, stylization
  tokens front-loaded, near-white background, NOT photorealistic; bust
  framing; G7 no ring-like framing) + 12-unit roster concept table
  (user-authored seed list: elf, dwarf, thief, angel, shieldmaiden,
  priest, princess, light cavalry, berserker, necromancer, watcher,
  squire).
- `content/batches/units-001-roster/unit_defs.json`: 12 entries with
  `gen_prompt`/`gen_negative`/`gen_render` (1x1 constant: target 256,
  gen 1024, Lanczos).
- Header "Ordering caveat" is OBSOLETE: the route tools merged to master
  via REQ-0109 (2026-07-12); this REQ's worktree branches from that
  master. Two roster busts (unit-elf, unit-berserker) are exercised
  end-to-end through the identical route as REQ-0136 bakeoff subjects.

### First roster batch — ON HOLD pending REQ-0136 verdict

The main batch (12 units x 4 candidates) deliberately waits for the
REQ-0136 checkpoint ratification: generating 48 candidates on the
incumbent V9 while the default checkpoint is under re-evaluation (and
batch-003's V9 art was NG'd at S7) would bake the same style-ceiling risk
into the roster gallery. The bakeoff grid includes 2 unit busts exactly
so the verdict transfers. On ratification: run
`tools/gen_unit_icons.py [--ckpt <winner>]`, score-filter (>=20%
coverage, filter-only), gallery to `web/preview/units-001/` (256+64 px,
numbered), STOP at S7.

---

## Outcome (2026-07-13) — S7 ALL GREEN, all gates green

### First roster batch — DONE (scope item 4, 6, 7)

The batch was un-held once REQ-0136 ratified **flux2** (FLUX.2 klein 4B Q8_0,
steps=4, cfg=1.0, euler) and the route merged; it ran on that route, not on the
incumbent V9 whose style ceiling this REQ deliberately refused to bake in.
Paused at 13/48 when a REQ-0135 spike co-occupied the box (9d02339), resumed and
completed (8930bfe).

- **44 candidates** = 11 units x 4 (seeds 101/202/303/404), matted with rembg
  `birefnet-general` + border-key fallback.
- Gallery `web/preview/units-001/` — every candidate at 256 px AND 64 px,
  numbered (golden G4): https://backpack-dev.qtie.jp/preview/units-001/
- Batch notes: `content/batches/units-001-roster/notes.md`.

### Roster cut — unit-necromancer (user ruling, 2026-07-13)

Necromancer is cut **as a unit**, not just as art. Removed from the wrapper
roster table (single source of truth), from the regenerated `unit_defs.json`
(12 -> 11), and from the style guide roster table; its 4 candidates are
deliberately not in the repo. The seed roster is **11 units**.

### S7 verdict — ALL GREEN (11 of 11 accepted)

Accepted seed per unit; each accepted candidate is copied to
`content/batches/units-001-roster/selected/<id>.png` (RGBA 256x256):

elf 101 · dwarf 101 · thief 303 · angel 202 · shieldmaiden 202 · priest 101 ·
princess 303 · lightcavalry 303 · berserker 202 · watcher 202 · squire 303

No unit requires a regeneration pass.

### Gates

| gate | result |
| --- | --- |
| Bakeoff ruling recorded before main batch generation | GREEN — bust ruling recorded 2026-07-12 (2558072), pipeline v1.1 §3 |
| Every shipped candidate coverage >= 20% and correct in the 256/64 px gallery | GREEN — 44/44, **0 auto-FAIL**; coverage 35.5%–52.8% |
| S7 stop honored: nothing enters `content/live/` | GREEN — batch stops at `selected/`; no live write |

Scoring stayed FILTER-ONLY (ratified golden deviation): the user gallery verdict
selected every winner.

### Commits

- 2558072 — bust ruling (gate 1); wrapper + 12-unit roster defs + style guide
- 9d02339 — batch launch on flux2; 13 candidates; PAUSED (box contention)
- a14d60c — resume-predicate fix (`--no-matte` regression)
- 8930bfe — batch COMPLETE: 44 candidates, necromancer cut, gallery rebuilt
- (this commit) — S7 record: `selected/` (11 winners) + batch notes

### Follow-ups (not this REQ)

- Unit def authoring (connection shape, charge, effects, `i18n.ja`) — own REQ,
  illustration-first.
- Client rendering of unit icons — REQ-0125.
- Full-body dex/splash art of the same identities — REQ-0137.

## Integration pass -- 2026-07-14 (integration owner)

- Master @ `c41fdee` re-certified green via `tools/release.sh` (full `tools/ci.sh` incl. pg backend; `SKIP_E2E`, e2e run separately). Fresh `vite build` == the committed dist (**"dist unchanged -- nothing to commit"**), so the live static bundle already reflects this REQ. `backpack-api` + `backpack-web` restarted 2026-07-14 00:24 UTC (both active; web/api/ingress HTTP 200).
- Post-deploy live e2e (`http://127.0.0.1:8803`, sanctioned `pnpm run e2e`): **156 passed / 10 failed** -- the 10 are exactly the REQ-0159-accounted set (7x artadmin/artinspect/contentadmin 403-by-design; nav-routing:26 + dex-card:65 + schedule:1065). No unaccounted red.
- **Code**: already merged to master before this pass (branch tip is an ancestor of `c41fdee`); no new merge performed. Dedicated merge `f2ee954` (unit roster 001 on flux2).
- **Disposition**: STAYS in built/ -- S7 is ALL GREEN (11/11 accepted) but header still reads "awaiting deploy/acceptance"; batch stops at selected/ by design (nothing enters content/live), so no web deploy to certify. Kept in built pending explicit close.
