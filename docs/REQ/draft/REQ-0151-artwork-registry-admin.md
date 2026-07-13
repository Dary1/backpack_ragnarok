# REQ-0151 — artwork-registry-admin: web admin for flux2 artwork generation + adopted-seed registry

**State:** draft — BLOCKED on user ratification of this spec.
**Requested by:** user, 2026-07-13 (chat). Spec authored by orchestrator (Fable) from the user's
field list + three user rulings taken the same day (see § User rulings).

**Depends on / coordination:**
- REQ-0150 (flux2-migration) §1/§2 modules `tools/art_route.py` + `tools/art_style.py` — INCLUDING
  the working-tree fixes that were uncommitted as of the 2026-07-13 audit (STYLE.for_kind
  application in gen_item_icons, art_route submit error-surfacing + 1800 s wait). Those must be
  committed on the 0150 branch before this REQ starts. This REQ calls those modules; it must NOT
  fork them, copy their constants, or define a second route. REQ-0150 is still in flight —
  coordinate with its worker; rebase on its merge.

## User rulings (2026-07-13, binding for this spec)
1. Monster shape input = **variable grid**: numeric w×h (1..12 each), grid preview rendered.
   (The user's original "4x6" would not fit ratified monsters: chimera 6x4, ancient dragon 10x10.)
2. Serving = **API + export hybrid**: the DB is the single source of truth; adopted art is ALSO
   exported into content/ via the existing integrate path so existing consumers work unchanged.
3. Backfill = **yes**: REQ-0150-era adopted artwork is imported into the registry
   (seed + params from the batch manifests) so all art lives in one ledger from day one.

## Decision / Goal
One web admin screen to (a) generate artwork through THE one flux2 route, (b) manage per-artwork
seed candidates, (c) adopt exactly one seed per artwork as live. Every artwork-consuming content
references artwork by **system name**; the render of the adopted seed is the live asset.
The screen does NOT judge artwork quality — adoption is a human act (S7 spirit).

## Data model
SQLite, single file under `data/` (gitignored). ALL access through `server/storage.cjs` —
the project's ONLY persistence chokepoint. No other module opens the DB.

`artworks`
- `id`, `system_name` TEXT UNIQUE NOT NULL, `kind` ENUM(item|unit|monster|bpskin)
- `shape` JSON — item: 5x5 boolean mask (active cells clicked in UI);
  monster: `{w,h}` each 1..12; unit/bpskin: null
- `gen_width`, `gen_height` INT — DERIVED (see § Sizing law), never user-editable
- `main_object` TEXT — substituted into the prompt template placeholder
- `prompt_template` TEXT — placeholder style, default per kind
  (item: `{main_object}, white background, bold outline`; monster/unit per ratified shapes);
  editable per artwork
- `style_override` TEXT NULL — aux/style prompt; NULL = default per kind
  (`art_style.KIND_TEMPLATE`); editable
- `edge_padding` INT NULL — bpskin only; compose band thickness in px (drives `bpskin_compose` band)
- `adopted_render_id` FK NULL → renders.id
- timestamps

`renders`
- `id`, `artwork_id` FK, `seed` INT — auto-increment per artwork starting at 1
  (`max(seed)+1`); explicit seed entry allowed, duplicates per artwork refused;
  seeds are never renumbered
- `final_prompt` TEXT — the EXACT submitted prompt (template rendered + style layer), verbatim
- `params` JSON — full snapshot at generation time: unet/clip/vae filenames, steps, cfg, sampler,
  size, tiling flag — must equal the `art_route` constants at run time (gate G3)
- `file_path` (under `data/artworks/`), `file_sha256`, `status` (queued|running|ok|failed),
  `error` TEXT NULL, `created_at`
- Constraint: a render referenced by `adopted_render_id` cannot be deleted — enforced in
  storage.cjs AND refused at the API layer. Deleting any other render is allowed.

Rationale (audit lesson): models are pinned by FILENAME only, so seed+params are the *recipe*,
not the contract. The stored PNG + sha256 is the asset of record; regeneration is best-effort
parameter-identical, not guaranteed bit-identical.

## Sizing law (resolution is read-only in the UI; derived from kind + shape)
- item: bounding box of active cells → aspect at the item px class (256/cell) → /16 snap
- monster: w×h grid at 128/cell → /16 snap
- unit: locked 512×512
- bpskin: locked 1024×1024 (tiling fill + frame route; `edge_padding` feeds compose)
The derivation MUST reproduce the user-ratified examples: sword 3 vertical cells → 256×768;
shield 2x2 → 512×512; large shield 2x3 → 512×768; potion 1x2 → 256×512; goblin 3x4 → 384×512;
chimera 6x4 → 768×512; ancient dragon 10x10 → 1280×1280 (gate G2).

## Generation
- Backend calls the REQ-0150 modules (`art_route.build_txt2img/submit/wait_done`,
  `art_style.for_kind`). No parallel graph, no duplicated constants.
- Single-GPU job queue: jobs strictly serialized; UI polls async job status. Cold model load
  observed at 450–540 s — the queue and UI must survive >8 min first-image latency
  (lesson: the 300 s local-timeout bug at REQ-0150 tip e0d7b2b).
- Buttons: generate next seed (max+1), generate next N seeds, generate at an explicit seed.
- bpskin renders run the full `gen_bpskin` 5-check gate; a FAIL render is stored with
  status=failed + the check report and is never adoptable.

## Adoption + serving (hybrid, user ruling 2)
- Admin marks exactly one render adopted per artwork (switchable any time; history stays).
- `GET /api/art/<system_name>` → adopted image; `GET /api/art/<system_name>/meta` → JSON
  (kind, seed, sha256, params, adopted_at).
- On adoption change, an export step writes the adopted PNG (+ matte/derivatives where the kind
  requires them) into content/ via the existing integrate conventions, committed on a branch —
  existing consumers keep working unchanged.
- Candidate renders NEVER enter git (lesson: 185 MB of intermediate PNGs in history from
  REQ-0150 batches). Only adopted/exported assets reach content/.

## Backfill (user ruling 3)
Import REQ-0150-era adopted artwork: one `artworks` row + one adopted `renders` row each, params
read from the batch manifests (`manifest.json`, `fixups.json`, `frame_report.json`, defs files),
seed as recorded, file copied under `data/artworks/`. Where a manifest lacks a param, snapshot
current `art_route` constants and set `params.backfilled_approx = true`.

## UI fields (as specified by the user)
kind selector · system_name · shape editor (item: 5x5 click grid; monster: w×h numeric + preview
grid; hidden for unit/bpskin) · resolution (read-only, derived) · main_object · style/aux prompt
(prefilled per kind, editable) · final-prompt preview (placeholder rendered — shows EXACTLY what
will be submitted) · edge_padding (bpskin only) · seed list with thumbnails, adopt button, delete
button (disabled on the adopted seed) · generate next / generate N.

## Out of scope
- Automated quality judgement beyond the existing bpskin gate. Adoption stays human.
- Auth beyond what admin.cjs already provides (open question O3 if it provides none).
- Game-client rendering changes beyond consuming the export/API.
- Model-hash pinning (worth its own REQ; see Risks).

## Gates
- G1 chokepoint: all DB access via storage.cjs; unit tests — adopted-render delete refused;
  per-artwork seed monotonicity + uniqueness; system_name uniqueness.
- G2 sizing: derivation table reproduces all ratified examples above, exactly.
- G3 provenance: a fresh render's `params` JSON equals the `art_route` constants at run time;
  `final_prompt` stored verbatim and equal to what the REQ-0150 parity manifest format records.
- G4 e2e (Playwright via the existing harness + box lock, mocked ComfyUI backend — no GPU in CI):
  create artwork → generate → adopt → API serves it → delete non-adopted OK / adopted refused →
  re-adopt another seed → export step fires.
- G5 hygiene: no candidate PNG under content/ in the branch diff; `data/` stays gitignored.
- S7 user acceptance on the live screen with real GPU generation.

## Risks
- Reproducibility is parameter-level, not bit-level (filename-only model pinning) — mitigated by
  storing the PNG + sha256 as the asset of record.
- REQ-0150 still in flight; `art_route`/`art_style` may drift — this REQ rebases on the 0150
  merge and consumes the modules as-is.
- GPU contention with the user's own art sessions — the queue must be polite: no auto-retry
  storms; jobs cancellable from the UI.

## Open questions (draft blockers besides ratification)
- O1 monster grid max: 12×12 assumed from ruling 1 wording — confirm.
- O2 export target/layout in content/ per kind — align with existing integrate/registry
  conventions during implementation planning.
- O3 admin auth: reuse admin.cjs conventions; if none exist, a ruling is needed before exposure
  beyond the tunnel.

## Implementation log
(to be filled by the implementing session; per-session gate status checkboxes as in REQ-0150)
