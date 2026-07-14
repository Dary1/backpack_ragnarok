# REQ-0151 — artwork-registry-admin: web admin for flux2 artwork generation + adopted-seed registry

**Ratified:** 2026-07-13 (user, chat) — spec v3 approved as written; the REQ folder is the sole
status record.
**Requested by:** user, 2026-07-13 (chat). Spec authored by orchestrator (Fable) from the user's
field list + user rulings taken the same day. v2: user corrections round 2 (Postgres, DB-resident
images, model-hash pinning, wait for REQ-0150 completion). v3: user rulings round 3 (O1–O3
confirmed; item kind split into PO/SI; inspection kits made optional — see REQ-0152 draft).

**Depends on / coordination:**
- **REQ-0150 (flux2-migration) COMPLETION** — user ruling: this REQ waits for REQ-0150 to finish
  and merge. This REQ then consumes `tools/art_route.py` + `tools/art_style.py` as merged. It
  must NOT fork them, copy their constants, or define a second route.
- REQ-0152 (artwork-inspection-kits, draft) — wires per-type inspection kits into this admin.
  This REQ only leaves room for it (advisory kit results per render); nothing here blocks on it.

## User rulings (2026-07-13, binding for this spec)
1. Monster shape input = **variable grid**: numeric w×h (1..12 each), grid preview rendered.
   (The user's original "4x6" would not fit ratified monsters: chimera 6x4, ancient dragon 10x10.)
2. Serving = **API + export hybrid**: the DB is the single source of truth; adopted art is ALSO
   exported into content/ via the existing integrate path so existing consumers work unchanged.
3. Backfill = **yes**: REQ-0150-era adopted artwork is imported into the registry
   (seed + params from the batch manifests) so all art lives in one ledger from day one.
4. **Fix filename-only model pinning**: record content hashes of the model files in every
   render's params snapshot. Generated images are stored IN the DB, keyed by
   (type, system_name, seed) — a human resolves any doubt by looking at the stored image.
5. **DB = Postgres** — the established production storage backend (REQ-0040: storage.cjs 'pg'
   backend, Supabase Postgres via the local pooler). The orchestrator's initial SQLite suggestion
   was withdrawn on checking the server.
6. Candidates need **no backup** and never enter git, but MUST be persisted (in the DB) and
   instantly viewable from the WebUI.
7. **O1–O3 confirmed**: monster grid max 12×12; export target/layout follows the existing
   integrate/registry conventions; admin auth reuses admin.cjs conventions.
8. **Item kind is split into PO and SI** (canvas_spec.md canon: PO = Placement Object,
   SI = Socket Item). PO behaves as items did in v1/v2: 5x5 click-grid shape editor, resolution
   derived from active cells. SI has NO shape specification and a LOCKED 256×256 resolution.
9. **Inspection kits are OPTIONAL (advisory)** in this REQ. The end-of-pipeline inspection that
   older pipelines ran is ignored for now — the user verifies visually; adoption never requires
   a kit verdict. Kit integration (auto-run per type, UI display, DB persistence, kit
   refresh/deprecation) is specced separately in REQ-0152 (draft). Sole nuance: the bpskin
   FRAME-SOURCE gate (`gen_bpskin` 5-check) stays inside the generation recipe, because compose
   consumes only PASS frames — but its report is stored as advisory data and never blocks
   adoption of any successfully composed render.

## Decision / Goal
One web admin screen to (a) generate artwork through THE one flux2 route, (b) manage per-artwork
seed candidates, (c) adopt exactly one seed per artwork as live. Every artwork-consuming content
references artwork by **system name**; the render of the adopted seed is the live asset.
The screen does NOT judge artwork quality — adoption is a human act (S7 spirit).

## Data model
**Postgres** (the existing Supabase Postgres, via the same pooler the prod 'pg' backend uses).
New tables added via `server/migrations/` (next numbered SQL file). ALL access through
`server/storage.cjs` — the project's ONLY persistence chokepoint. No other module opens the DB.

`artworks`
- `id`, `system_name` TEXT UNIQUE NOT NULL, `kind` ENUM(po|si|unit|monster|bpskin)
- `shape` JSONB — po: 5x5 boolean mask (active cells clicked in UI);
  monster: `{w,h}` each 1..12; si/unit/bpskin: null
- `gen_width`, `gen_height` INT — DERIVED (see § Sizing law), never user-editable
- `main_object` TEXT — substituted into the prompt template placeholder
- `prompt_template` TEXT — placeholder style, default per kind
  (po/si: `{main_object}, white background, bold outline`; monster/unit per ratified shapes);
  editable per artwork
- `style_override` TEXT NULL — aux/style prompt; NULL = default per kind
  (`art_style.KIND_TEMPLATE`; po/si/unit → anime, monster → concept_art_fantasy); editable
- `edge_padding` INT NULL — bpskin only; compose band thickness in px (drives `bpskin_compose` band)
- `adopted_render_id` FK NULL → renders.id
- timestamps

`renders`
- `id`, `artwork_id` FK, `seed` INT — auto-increment per artwork starting at 1
  (`max(seed)+1`); explicit seed entry allowed; UNIQUE(artwork_id, seed); seeds never renumbered.
  The human-facing identity of a render is **(kind, system_name, seed)** — user ruling 4.
- `image` BYTEA — the generated PNG itself, stored in the DB (ruling 4/6). Candidates live
  nowhere else: no git, no separate backup.
- `image_sha256` TEXT — hash of `image`; doubles as the HTTP ETag for instant WebUI preview.
- `final_prompt` TEXT — the EXACT submitted prompt (template rendered + style layer), verbatim
- `params` JSONB — full snapshot at generation time: unet/clip/vae **filenames AND sha256 content
  hashes** (ruling 4 — hashes computed once per model file and cached by (path, size, mtime),
  not per render), steps, cfg, sampler, size, tiling flag. Sampler settings must equal the
  `art_route` constants at run time (gate G3).
- `status` (queued|running|ok|failed), `error` TEXT NULL, `created_at`
- Constraint: a render referenced by `adopted_render_id` cannot be deleted — enforced in
  storage.cjs AND refused at the API layer. Deleting any other render is allowed.
- Advisory inspection results, when present, live in `render_inspections` (schema owned by
  REQ-0152); this REQ neither writes nor requires them, except storing the bpskin frame-gate
  report emitted by the generation recipe.

Provenance model: seed + params (with model hashes) are the *recipe*; the DB-resident PNG +
sha256 is the *asset of record*. Regeneration from the recipe is parameter-identical and, with
matching model hashes, expected bit-identical — but the stored image always wins.
Durability split: candidates are unbacked-up by design (ruling 6); adopted art is additionally
exported into content/ (git) by ruling 2, so live assets survive even a DB loss.

## Sizing law (resolution is read-only in the UI; derived from kind + shape)
- po: bounding box of active cells → aspect at the item px class (256/cell) → /16 snap
- si: locked **256×256** (ruling 8; no shape)
- monster: w×h grid (max 12×12) at 128/cell → /16 snap
- unit: locked 512×512; bpskin: locked 1024×1024 (tiling fill + frame route; `edge_padding`
  feeds compose)
The derivation MUST reproduce the user-ratified examples: sword 3 vertical cells → 256×768;
shield 2x2 → 512×512; large shield 2x3 → 512×768; potion 1x2 → 256×512; goblin 3x4 → 384×512;
chimera 6x4 → 768×512; ancient dragon 10x10 → 1280×1280; any si → 256×256 (gate G2).

## Generation
- Backend calls the REQ-0150 modules (`art_route.build_txt2img/submit/wait_done`,
  `art_style.for_kind`). No parallel graph, no duplicated constants.
- Single-GPU job queue: jobs strictly serialized; UI polls async job status. Cold model load
  observed at 450–540 s — the queue and UI must survive >8 min first-image latency
  (lesson: the 300 s local-timeout bug at REQ-0150 tip e0d7b2b).
- Buttons: generate next seed (max+1), generate next N seeds, generate at an explicit seed.
- bpskin: the `gen_bpskin` frame-source gate runs inside the recipe (compose consumes only PASS
  frames; FAIL candidates auto-reroll). Its report is stored as advisory data (ruling 9);
  no inspection verdict ever blocks adoption.

## Adoption + serving (hybrid, ruling 2)
- Admin marks exactly one render adopted per artwork (switchable any time; history stays).
- `GET /api/art/<system_name>` → adopted image (served from the DB, ETag = image_sha256);
  `GET /api/art/<system_name>/meta` → JSON (kind, seed, sha256, params, adopted_at);
  `GET /api/art/<system_name>/renders/<seed>` → any candidate, for the WebUI's instant preview
  (ruling 6).
- On adoption change, an export step writes the adopted PNG (+ matte/derivatives where the kind
  requires them) into content/ via the existing integrate conventions (ruling 7), committed on a branch — existing consumers keep working unchanged.- Candidate renders NEVER enter git (lesson: 185 MB of intermediate PNGs in history from
  REQ-0150 batches). Only adopted/exported assets reach content/.

## Backfill (ruling 3)
Import REQ-0150-era adopted artwork: one `artworks` row + one adopted `renders` row each, params
read from the batch manifests (`manifest.json`, `fixups.json`, `frame_report.json`, defs files),
seed as recorded, image bytes loaded into the DB. Where a manifest lacks a param, snapshot
current `art_route` constants and set `params.backfilled_approx = true`; model hashes recorded
as current-file hashes with `params.hash_backfilled = true`.

## UI fields (as specified by the user)
kind selector · system_name · shape editor (po: 5x5 click grid; si: none — locked 256×256;
monster: w×h numeric + preview grid; hidden for unit/bpskin) · resolution (read-only, derived) ·
main_object · style/aux prompt (prefilled per kind, editable) · final-prompt preview
(placeholder rendered — shows EXACTLY what will be submitted) · edge_padding (bpskin only) ·
seed list with thumbnails (instant, DB-served), adopt button, delete button (disabled on the
adopted seed) · generate next / generate N / generate at explicit seed.

## Out of scope
- Automated quality judgement beyond the recipe-internal bpskin frame gate. Adoption stays
  human; kit integration is REQ-0152.
- Auth beyond what admin.cjs already provides (O3: reuse confirmed).
- Game-client rendering changes beyond consuming the export/API.

## Gates
- G1 chokepoint: all DB access via storage.cjs (pg path); migration applies cleanly; unit
  tests — adopted-render delete refused; per-artwork seed monotonicity + uniqueness;
  system_name uniqueness.
- G2 sizing: derivation reproduces all ratified examples above, exactly (incl. any si → 256×256).
- G3 provenance: a fresh render params JSON equals the art_route constants at run time;
  final_prompt stored verbatim; unet/clip/vae filenames AND sha256 content hashes present in
  every params snapshot.
- G4 e2e (Playwright via the existing harness + box lock, mocked ComfyUI backend — no GPU in
  CI): create artwork → generate → adopt → API serves it → delete non-adopted OK / adopted
  refused → re-adopt another seed → export step fires.
- G5 hygiene: no candidate PNG under content/ in the branch diff; data/ stays gitignored.
- S7 user acceptance on the live screen with real GPU generation.

## Risks
- Regeneration is expected bit-identical with matching model hashes but is NOT guaranteed — the
  DB-resident PNG + sha256 stays the asset of record (ruling 4).
- GPU contention with the user own art sessions — the queue must be polite: no auto-retry
  storms; jobs cancellable from the UI; UI survives >8 min cold-load latency.

## Spec-integrity note (2026-07-14, orchestrator)
The v3 edit (659b9ef) truncated this file mid-sentence, dropping everything after the export
bullet (v2 af670d1 was itself already truncated inside Gates). This tail is restored from the
v2/v1 history (af670d1, e21d2bf) with the v3 rulings applied (PO/SI split, O1–O3 resolved,
kits advisory). No new decisions were introduced.

## Implementation log
### Session 2026-07-14 (implementing engineer, worktree req-0151-artwork-registry-admin)

**Architecture decisions**
- storage.cjs remains THE persistence chokepoint. The artwork registry's DB access lives in
  a sibling storage-subsystem file `server/storage_art.cjs`, re-exported through storage.cjs
  (`...artStore`) -- the same multi-file pattern pg_sync_worker.cjs already establishes. It owns a
  dedicated ASYNC pg.Pool rather than the pg_sync bridge, because `renders.image` is a PNG BYTEA
  blob that would overflow the sync bridge's 4 MB SharedArrayBuffer + JSON round-trip; the artwork
  endpoints are all async HTTP handlers, so async/await pg is the correct substrate here.
- Generation goes through THE flux2 route AS MODULES: a thin Python worker `tools/art_job.py`
  imports `art_route`/`art_style` (no fork, no copied constants), builds the prompt via
  art_style (kind template / fill) and the graph via `art_route.build_txt2img`, and emits
  `route_params` read straight off the imported module. The Node serialized single-GPU queue
  (`server/services/art_jobs.cjs`) spawns it one job at a time and merges model-file content
  hashes (cached by path,size,mtime -- `server/services/model_hash.cjs`). No GPU this session:
  ART_ROUTE_MOCK=1 swaps the ComfyUI submit/wait for a deterministic placeholder PNG at the exact
  WxH, but build_txt2img is still exercised (proves the graph builds; keeps the negative-prompt
  refusal live).
- Sizing law (`server/services/art_sizing.cjs`) is a pure JS port of art_style.gen_size's /16-snap
  math; read-only, reproduces every ratified example.
- Kind -> style mapping: po/si -> item (anime), unit -> anime, monster -> concept_art_fantasy,
  bpskin -> fill (art_style.fill_prompt). The bpskin frame-gate report is stored advisory inside
  renders.params and never blocks adoption (ruling 9).

**Gate results (all machine gates GREEN)**
- [x] G1 chokepoint + migration + constraints -- 007_artwork.sql applied to the Supabase pg;
  artwork_test.cjs proves system_name UNIQUE, per-artwork seed = max+1 + explicit seed +
  UNIQUE(artwork,seed), and adopted-render-undeletable enforced IN storage.cjs (+ a DB RESTRICT
  FK backstop) AND refused at the API. All DB access is via storage.cjs.
- [x] G2 sizing law exact -- sword 256x768, shield 512x512, large shield 512x768, potion 256x512,
  goblin 384x512, chimera 768x512, ancient dragon 1280x1280, si 256x256, unit 512x512,
  bpskin 1024x1024 (10/10).
- [x] G3 provenance -- a fresh render's params.steps/cfg/sampler == the art_route constants read at
  run time (cross-checked against `python3 -c "import art_route"`); final_prompt stored verbatim
  (== the preview endpoint's); unet/clip/vae FILENAMES and sha256 CONTENT HASHES present in every
  params snapshot; the DB-resident PNG round-trips (stored image_sha256 == sha256 of the bytes).
- [x] G4 e2e (Playwright, EXISTING harness tools/e2e_run.sh + box lock, MOCKED ComfyUI backend) --
  client/e2e/artadmin.spec.ts PASSES (8.2s): create po sword (256x768) -> generate 3 seeds (mock)
  -> final-prompt preview -> adopt seed1 (export fires) -> GET /api/art/<name> serves the adopted
  PNG (200, image/png, ETag) -> delete non-adopted seed2 OK / adopted seed1 refused (button
  disabled) -> re-adopt seed3 -> /meta reflects seed3.
- [x] G5 hygiene -- no candidate PNG in the branch diff (candidates live ONLY in the DB; exports
  go to ART_EXPORT_ROOT, a temp dir in tests); data/ gitignored; the generated web/app bundle is
  not committed (deploy rebuilds).
- [ ] S7 user acceptance on the live screen with REAL GPU generation -- NOT this session (another
  REQ owns the GPU today); left OPEN.

**Test evidence**
- server/tests/artwork_test.cjs: 6 passed / 0 failed (G2; G1 system_name uniqueness; G1 seed
  monotonicity + uniqueness; G1 adopted-undeletable + switch; G3 provenance; full
  create->generate->adopt->export->serve->delete-rules->re-adopt flow). Wired into tools/ci.sh's
  pg pass as [5.1/7].
- server/tests/api_test.cjs: 155/155 in BOTH files and pg backends -- no regression from the
  storage.cjs re-export.
- client `tsc -b && vite build`: green. G4 browser spec: 1 passed (8.2s).

**G4 isolated-run recipe** (does NOT touch the live services): run THIS worktree's api on a spare
port with STORAGE_BACKEND=pg + DATABASE_URL + ART_ROUTE_MOCK=1 + ART_MODEL_DIR (a temp dir holding
3 tiny stand-in files named exactly like the real weights) + ART_EXPORT_ROOT (temp); serve the
built web/ statically; run client/e2e/local-proxy.cjs with E2E_STATIC_PORT/E2E_API_PORT pointed at
them; then `PLAYWRIGHT_BASE_URL=http://127.0.0.1:<proxy> bash tools/e2e_run.sh
--config=e2e/artadmin.config.ts`. dev_mode makes the item_admin gate accept the no-token dev
fallback. artadmin.config.ts carries no globalSetup/webServer, so the live profile/content/api are
never touched.

**Deviations from spec (documented)**
- Export (server/services/art_export.cjs): on every adoption it writes the adopted PNG (+ a
  provenance record) into ART_EXPORT_ROOT (default content/art/<kind>/<system_name>.png). The
  git-BRANCH commit of that asset + per-kind derivatives via tools/tool_integrate.cjs is gated
  behind ART_EXPORT_GIT=1 (OFF in CI/tests, so e2e never touches git) and is the deploy (S7) wiring
  step; the export STEP itself fires on adoption and is asserted by G4. Rationale: committing to a
  branch during e2e would touch git.
- render_inspections NOT created (owned by REQ-0152, per instruction). The bpskin frame-gate report
  is kept advisory inside renders.params.
- No Nav rail entry for #/artadmin yet (reachable by hash; skipped to avoid i18n churn this
  session).

**Remaining (NOT machine gates)**
- Backfill (ruling 3): DONE 2026-07-14 (follow-up session) -- see the Session 2026-07-14b block at
  the end of this log. The earlier concern (manifests record candidates + params but not the adopted
  pick) was resolved under the orchestrator ruling by filling the ledger with candidate-only renders
  and adopting ONLY the 3 provably-composed bpskin frames; no adopted seed was fabricated. Not a
  machine gate (G1-G5).
- Deploy-time git-branch export wiring (ART_EXPORT_GIT path) + real per-kind derivatives via
  tool_integrate.
- S7 real-GPU acceptance.

**Commits (branch req-0151-artwork-registry-admin)**
- 028d1d1 backend: migration, storage chokepoint (async pg BYTEA), sizing law, model-hash
  provenance, serialized job queue via art_route/art_style, adoption + export, API routes;
  G1/G2/G3 + full-flow tests (6/6)
- 2abcbb6 admin UI (route + page) + api client + ci.sh wiring; client tsc+vite build green
- 52c8de6 G4 Playwright spec
- a3346cd G4 green: adopted-highlight fix + isolated pg e2e config + corrected seed flow (8.2s)

### Session 2026-07-14b (follow-up: BACKFILL, ruling 3 -- completed under orchestrator ruling)

Backfill was flagged "not run" by the 2026-07-14 session (the manifests record candidates + params
but NOT which candidate was adopted, so it correctly declined to fabricate a pick). Under the
2026-07-14 orchestrator ruling ("do not fabricate adoption, but DO fill the ledger"), the backfill
is now COMPLETE via a re-runnable idempotent tool. The earlier "not run" flag is CLEARED.

**Tooling**
- `tools/backfill_registry.cjs` -- inventories the six flux2-era (REQ-0150) batches under
  content/batches/ and writes one `artworks` row per subject + one `renders` row PER CANDIDATE
  (image bytes into renders.image, seed as recorded in the manifest / candidate filename), ALL
  through storage.cjs (opens no DB itself). Idempotent: keyed by system_name + (artwork,seed);
  re-runs skip existing rows and only fill gaps (proven -- a 2nd run created 0/0). Backfilled
  system_names are batch-scoped (`<batch>:<key>`) so historical candidates never collide with each
  other or with future admin-created artworks. Params mirror the live render shape; where a manifest
  lacks a generation param the CURRENT art_route constants are snapshotted
  (`params.backfilled_approx=true`); model hashes are the CURRENT model-file CONTENT hashes
  (STREAMED, so the 4+8+0.3 GB weights never load into memory) with `params.hash_backfilled=true`
  (ruling 4). `--dry-run` prints the inventory without touching the DB.
- `server/tests/backfill_registry_test.cjs` -- DB-free unit tests (10/10) of the deterministic
  parts: manifest parsing -> row mapping (kind map, po/monster shape -> sizing law, candidate-seed
  decoding) and the adoption-evidence matcher (frame_report composed-frame + byte-match). Wired into
  tools/ci.sh as DB-free step [4.6/7].

**Counts written to the live Postgres (STORAGE_BACKEND=pg, the same env the api uses)**
- **artworks: 56   renders: 130   adopted-with-evidence: 3**
  - flux2-parity-0150         20 artworks / 20 renders (item->po, monster, unit, texture->bpskin;
    manifest + fixups + thief_framing; full params recorded -> backfilled_approx=false)
  - units-002-roster-flux2    11 / 44  (unit; 4 candidates each, seeds 101/202/303/404)
  - batch-004-item-icons-flux2 8 / 32  (po; shape mask from item_defs gen_render cells/mask_cells)
  - monsters-003-flux2        12 / 24  (monster; shape from cells_hint; 2 seeds each, s1/s202)
  - bpskin-frames-0150         3 / 6   (bpskin; leather/iron/wood frames, seeds 1/202)
  - bpskin-flux2-0150          2 / 4   (bpskin; elven/barbarian tiling SPIKE, seamless leg;
    verdict FAIL + steps=4 recorded from findings.json)

**Adoption evidence policy (never invents a seed)**
- The ONLY provable REQ-0150-era adoptions are the three composed backpack-skin frames.
  bpskin-frames-0150/frame_report.json records `skins[].composed=true, frame=<material>_frame_s1.png`
  -- a manifest-recorded selection (the exact frame the compose step consumed), not a guess. Those
  three renders (leather / iron / wood, seed 1) are adopted with
  `params.backfill_adoption_evidence = "bpskin-frames-0150/frame_report.json: skins[].composed=true,
  frame=<file>"`.
- A general byte-match matcher compares every candidate's sha256 against the live/adopted reference
  set (content/live/**.png + any batch */selected/**.png; 19 PNGs indexed). It found ZERO flux2
  matches -- consistent with REQ-0150 commit ee89739 ("S7 STOP HONORED: nothing is in
  content/live/"): no flux2 art was ratified/integrated, so nothing else is provably adopted. The
  other 127 renders stay candidate-only; the user adopts them in the admin.
- No batch was skipped. bpskin-flux2-0150 is a FAILED tiling spike whose PNGs are method-legs
  (control/vae_circ/seamless/blend/inpaint x offset/tiled), not seed candidates; it is included as 2
  motifs x 2 seeds using the `seamless` leg as the representative per-seed output, flagged
  `params.spike_verdict=FAIL` / `tiling_leg=seamless`, and never adopted.

**Verification**
- Storage-level query after apply: 56 backfilled artworks, 130 backfilled renders, 3 adopted with
  frame_report evidence; every render's image_sha256 round-trips against the stored bytes; params
  carry real content hashes (hash_source=content) + hash_backfilled=true, backfilled_approx set per
  batch, steps 30 (route) / 4 (bpskin spike, from findings).
- Idempotent re-run: 0 artworks / 0 renders created.
- backfill_registry_test.cjs 10/10; artwork_test.cjs 6/6 (no regression from the added tool). G5
  hygiene: no PNG in the branch diff -- candidates live ONLY in the DB.

**Commits (branch req-0151-artwork-registry-admin)**
- 64c060b backfill tool (ruling 3): idempotent flux2-era batch import via storage.cjs + DB-free
  mapping/adoption-matcher tests (10/10)
- 26517bd wire backfill mapping test into ci.sh (DB-free [4.6/7])
- (this commit) REQ log: backfill completed -- counts, evidence policy, "not run" flag cleared

## Integration pass -- 2026-07-14 (integration owner)

- Master @ `c41fdee` re-certified green via `tools/release.sh` (full `tools/ci.sh` incl. pg backend; `SKIP_E2E`, e2e run separately). Fresh `vite build` == the committed dist (**"dist unchanged -- nothing to commit"**), so the live static bundle already reflects this REQ. `backpack-api` + `backpack-web` restarted 2026-07-14 00:24 UTC (both active; web/api/ingress HTTP 200).
- Post-deploy live e2e (`http://127.0.0.1:8803`, sanctioned `pnpm run e2e`): **156 passed / 10 failed** -- the 10 are exactly the REQ-0159-accounted set (7x artadmin/artinspect/contentadmin 403-by-design; nav-routing:26 + dex-card:65 + schedule:1065). No unaccounted red.
- **Code**: already merged to master before this pass (branch tip is an ancestor of `c41fdee`); no new merge performed. Registry + admin surfaces live; pg-backend gates (artwork/queue/inspection) green this pass.
- **Disposition**: STAYS in built/ -- open "[ ] S7 user acceptance on the live screen with REAL GPU generation" (deferred to user/another session).
