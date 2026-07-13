# REQ-0156 — artadmin-ux-overhaul: zero-base UX/feature overhaul of the artwork registry admin

**Ratified:** 2026-07-14 (user, chat) — user requested a zero-base rethink of #/artadmin
("considering the role this page carries, redesign the UI so everything the user intended can
actually be accomplished; improve operation feel and features against industry norms").
User approved scope **UI + server extensions** and **merge + deploy** the same day (chat,
via orchestrator AskUserQuestion round).
**Requested by:** user, 2026-07-14 (chat). Spec authored by orchestrator (Fable) from a survey
of REQ-0151/0152 specs + the live implementation (master c83e5a3).

**Depends on / coordination:**
- REQ-0151 (artwork-registry-admin, built) — this REQ overhauls its UI surface and extends its
  server routes/queue. Registry semantics (data model, sizing law, adoption rules, export)
  are UNCHANGED.
- REQ-0152 (artwork-inspection-kits, built) — kit chips/detail UX is restyled, not resemantic'd.
  Verdicts stay advisory; adoption is never gated (standing rule).
- REQ-0155 (content-data-registry-admin, built) — receives the same treatment in a FOLLOW-UP
  REQ (user instruction 2026-07-14); this REQ adds only a cross-link between the two admin
  pages. Shared visual grammar introduced here should be reusable there.

## Zero-base role statement (what this page IS)
An art-generation console + adoption ledger (a mini-DAM):
1. **Define** artwork (kind, system_name, shape → derived read-only resolution, prompt fields).
2. **Generate** seed candidates on the single-GPU serialized queue (cold load 450–540 s; the
   UI must make an 8-min wait legible and polite).
3. **Judge & adopt** — the page's core act is HUMAN VISUAL COMPARISON of candidates (S7
   spirit); exactly one adopted render per artwork; adoption fires the content/ export.
4. **Consult** advisory inspection verdicts (REQ-0152) without ever being gated by them.
5. **Browse** a growing ledger (56 backfilled + future artworks) by kind / adoption state /
   name.

## Deficiencies being fixed (survey 2026-07-14, master c83e5a3)
- Adoption is visual, but the UI offers only ~138 px thumbnails: no enlarge, no 1:1, no
  side-by-side compare, no background toggle, no tiled preview for bpskin (industry norm for
  seamless textures: 2×2 repeat + half-shift eyeball — REQ-0138/0152 finding).
- 56-entry flat text list: no search, no kind/adoption filter, no thumbnails, no batch
  grouping of backfilled `batch:key` names.
- Create form doubles as the selection's edit buffer (selecting an artwork floods the create
  form → accidental near-duplicate Create is one click away).
- Queue is a bare depth number. REQ-0151's own risk section required "jobs cancellable from
  the UI" — never implemented (no server support either). Nothing shows what is running,
  for how long, or what is waiting.
- No confirm on delete (destructive) or adopt (fires a git-relevant export); no retry for
  failed renders; single overloaded message line for all feedback.
- Ignores the MJOLNIR design system entirely (raw inline-styled HTML).

## Scope
### A. Server extensions (small, chokepoint-respecting; NO schema migration)
- `storage_art.cjs listArtworks()`: enrich each row with `adopted_seed`, `render_count`,
  `ok_count`, `failed_count`, `last_render_at` (SQL join/aggregate; additive, backward
  compatible).
- `art_jobs.cjs`: job metadata (enqueued_at/started_at); `listJobs()` → running job (with
  elapsed) + pending generation queue (artwork system_name, seed, renderId) + inspect depth;
  `cancelJob(renderId)` → pending: remove from queue; running: kill the worker process tree.
  Canceled renders become `status='failed', error='canceled by user'` (no new enum value —
  no migration). Queue pump must always advance after a kill.
- `routes/art.cjs`: `GET /api/art/queue` (admin) → listJobs(); `POST
  /api/art/artworks/:name/renders/:seed/cancel` (admin) → cancelJob + updated queue. Retry of
  a failed render is client-side (DELETE failed render, then generate at that explicit seed —
  existing endpoints).
- Tests: extend server/tests (queue list/cancel semantics incl. cancel-running kill path with
  the mock worker; listArtworks aggregates). Existing artwork_test.cjs + api_test.cjs must
  stay green.

### B. Client overhaul (`client/src/artadmin/`, split into components)
- **Three-pane layout, MJOLNIR-styled** (.panel/.btn/.chip/.t-* tokens; page CSS follows the
  house convention alongside the other pages):
  1. Left rail: registry browser — search (system_name/main_object substring), kind filter
     chips with counts, adoption filter (all/adopted/unadopted), batch-prefix grouping
     (collapsible) for backfilled `prefix:name` entries, rows with lazy adopted-thumbnail
     (public `/api/art/<name>` endpoint) + kind chip + WxH + adopted-seed badge + render count.
  2. Center: selected artwork workspace — header (name, kind, derived size, adopted state,
     export note), edit form (main_object / prompt_template / style_override / edge_padding /
     shape where the kind allows) with DIRTY indicator, explicit Save, and debounced
     auto-refresh of the final-prompt preview; shape edits warn that existing renders keep
     their old size. Render gallery below (see C).
  3. Right/top strip: generation controls (next / N / explicit seed) + QUEUE PANEL — running
     job with live elapsed timer + cold-load hint, pending list, per-job Cancel, inspect
     depth. Visible without selecting an artwork.
- **Create flow separated**: "New artwork" opens a dedicated create panel (own state, never
  fed by selection). Live validation (name regex/reserved/duplicate, shape presence). Kind
  switch shows per-kind shape editor (po 5×5 mask / monster w×h+preview / locked sizes for
  si/unit/bpskin) and derived resolution, exactly as the sizing law dictates (law unchanged).
- **Lightbox / compare** (the core judging tool): click any ok render → full-size view; zoom
  (fit / 1:1 / 2x…), background toggle (dark / white / checker), keyboard prev/next; bpskin
  adds 2×2 tiled mode + half-shift toggle; multi-select 2 candidates → side-by-side A/B at
  synchronized zoom; Adopt from inside the lightbox.
- **Safety & feedback**: confirm dialogs for adopt (shows the image + "exports to content/")
  and delete; adopt result surfaces export success/warning explicitly; failed renders show
  the error and a one-click Retry (delete+regen same seed); toast-style transient messages
  replace the single message line.
- **Cross-link** between #/artadmin and #/contentadmin (small header link; no player-nav
  entry — admin surfaces stay off the rail).
- i18n: admin surface stays EN-only (existing convention, locale prop accepted and unused).

### C. Contract preservation
- data-testid contract of artadmin.spec.ts is PRESERVED where the flow is unchanged
  (art-kind, art-system-name, po-cell-r-c, art-resolution, art-create, art-select-<name>,
  art-preview, art-final-prompt, art-gen-next/n/seed, render-<seed>, adopt-/delete-<seed>,
  kit chips ids…). Where flows changed intentionally (create panel toggle, confirm dialogs),
  the spec is UPDATED in the same commit and the delta documented in the log.
- Sizing law, adoption semantics, export path, kit advisory rule: untouched.

## Out of scope
- Artwork deletion/renaming/archiving (ledger semantics stay); auth changes; schema
  migrations; thumbnail downscaling service; REQ-0155 page overhaul (follow-up REQ);
  any change to tools/art_route.py / art_style.py.

## Gates
- G1 build+types: client `tsc -b && vite build` green; server tests green
  (api_test 155/155 both backends, artwork_test 6/6, new queue/cancel + aggregate tests).
- G2 e2e: updated client/e2e/artadmin.spec.ts green via the REQ-0151 isolated recipe
  (ART_ROUTE_MOCK=1, spare ports, box lock) — full flow: create → generate → preview →
  lightbox open → adopt (confirm) → serve → delete rules → re-adopt → cancel a queued job →
  retry a failed render → filter/search narrows the list.
- G3 queue semantics: cancel pending removes exactly that job; cancel running kills the
  worker and the pump advances; canceled render = failed + 'canceled by user'; adopted
  render remains undeletable end-to-end.
- G4 hygiene: no candidate PNG in the branch diff; no package-lock.json/yarn.lock; pnpm
  only; web/app dist not committed on this branch (deploy rebuilds on master).
- S7 user acceptance on the live deployed screen (user approved merge+deploy in advance,
  2026-07-14 chat; coordinate the actual master merge + service restart at execution time).

## Risks
- Killing a running ComfyUI job leaves the ComfyUI-side prompt running to completion; the
  worker exits and the queue advances — acceptable for a dev tool, noted in the UI hint.
- Lazy thumbnails pull full-size adopted PNGs (no downscale service); mitigated by
  loading="lazy", browser cache + ETag; acceptable on the dev LAN.
