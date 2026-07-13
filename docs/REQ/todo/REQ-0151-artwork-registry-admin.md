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
(to be filled by the implementing session; per-session gate status checkboxes as in REQ-0150)
