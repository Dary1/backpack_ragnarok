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

## Implementation log
### Session 2026-07-14 (implementing engineer, worktree req-0156-artadmin-ux-overhaul)

**Architecture decisions**
- Server stays a SMALL extension (no schema migration, chokepoint intact). `storage_art.cjs
  listArtworks()` gains the per-artwork aggregates (adopted_seed / latest_ok_seed /
  render_count / ok_count / failed_count / last_render_at) in ONE SQL round-trip: LEFT JOIN on
  the adopted render + LEFT JOIN LATERAL count/filter aggregate per artwork. Purely additive
  over the REQ-0151 row shape -- every existing caller (hGet, hList, tests) is untouched.
- `art_jobs.cjs`: generation descs now carry enqueued_at (stamped in enqueue()); the pump
  records runningDesc/runningChild/runningStartedAt. `listJobs()` snapshots running (with
  elapsed_ms) + pending (renderId, artwork system_name, seed, enqueued_at) + inspectDepth.
  `cancelJob(renderId)`: pending -> spliced out of genQueue + render marked failed
  'canceled by user' (NO new status enum -- no migration); running -> desc.canceled flag +
  SIGTERM the python child (SIGKILL fallback after 2 s, timer unref'd). runWorker gained an
  optional onChild callback so the queue owns a kill handle; its close handler fires either
  way, so the pump ALWAYS advances (G3). processGenJob checks desc.canceled after the worker
  returns, so even the cancel-vs-finish race resolves to the human's verdict. Inspection jobs
  are deliberately NOT individually cancellable (seconds of CPU, advisory); listJobs reports
  their backlog depth only.
- Routes: `GET /api/art/queue` + `POST /api/art/artworks/:name/renders/:seed/cancel`, both
  item_admin-gated, same handler/regex style as the file. 'queue' added to RESERVED (the
  public GET /api/art/<name> could otherwise never serve an artwork named "queue"); the
  client mirrors the reserved list in its live create validation.
- `tools/art_job.py` (REQ-0151's own worker; art_route/art_style untouched per scope) gained
  ART_MOCK_DELAY_MS: mock-mode-only sleep so tests/e2e can hold jobs in the queue long enough
  to observe/cancel them -- real generation takes minutes, the mock milliseconds, so without
  the knob the cancel paths are untestable.
- Client: ArtAdminPage split into components (artShared.ts helpers/types, RegistryRail,
  CreatePanel, Workspace, QueuePanel, Lightbox, KitChips, ShapeEditors); the root owns all
  server state + polling (list 10 s / detail 2 s / queue 2 s / 1 Hz elapsed tick) and the
  safety rails (confirm dialogs, toasts + the persistent aria-live art-msg line). Export name
  `ArtAdminPage` and the `{ locale }` prop signature preserved (EN-only surface, locale
  accepted+unused).
- Create flow fully separated: art-new opens a dedicated panel whose state is NEVER fed by
  selection (kills the REQ-0151 accidental-near-duplicate-Create hazard). Live validation:
  name regex/reserved/duplicate + po-mask-non-empty; Create disabled until valid. The e2e
  field-testid contract (art-kind/art-system-name/po-cell-r-c/art-resolution/art-create/...)
  lives on this panel; the WORKSPACE edit form uses art-edit-* ids + idPrefix'd shape editors
  (edit-po-cell-...) so testids never collide across panes.
- Lightbox is the judging tool: zoom fit/1:1/2x/4x, bg dark/white/checker, keyboard
  prev/next/Escape, bpskin 2x2 tile + half-shift (seam runs through the middle of the view),
  2-up compare at synced zoom/bg (picked via per-card A/B checkboxes -> art-compare), Adopt
  from inside routed through the SAME confirm dialog (keysDisabled while a dialog is up).
- Queue strip visible without a selection: gold .btn-forge "Generate next seed" (the one
  forge CTA), N/seed controls, queue panel with live elapsed (server elapsed_ms + local
  delta), cold-load hint (~8 min + "ComfyUI prompt finishes on its own" risk note), per-job
  Cancel (queue-cancel-<renderId>; the running job gets one too -- server supports it),
  inspect depth. art-queue keeps showing the generation queue DEPTH number (e2e contract).
- Styling: `/* REQ-0156 artadmin */` section appended to client/src/index.css, MJOLNIR
  tokens/primitives only. Adopted = gold border + badge; kit verdicts keep PASS/WARN/FAIL
  semantics on the house palette (uncommon-green / legend-amber / blood-red); all REQ-0152
  kit testids preserved verbatim. Cross-links: artadmin header -> #/contentadmin and a
  one-line mirror link in ContentAdminPage's h2 (nothing else touched there).

**Gate results (all machine gates GREEN)**
- [x] G1 build+types: client `tsc -b && vite build` EXIT 0; server checkJs typecheck
  (tsconfig.server.json) EXIT 0; api_test.cjs 155/155 files AND 155/155 pg;
  artwork_test.cjs 6/6; NEW artqueue_test.cjs 4/4 (wired into ci.sh as [5.15/7]);
  inspection_test.cjs 5/5 (queue rewrite regression-checked).
- [x] G2 e2e: client/e2e/artadmin.spec.ts 3/3 PASSED in 27.9 s via tools/artadmin_e2e.sh
  (HOME-remap isolation, ports 8921/8922/8923, box lock through tools/e2e_run.sh):
  (1) create via art-new panel -> generate 3 seeds -> preview -> lightbox (open/zoom/bg/
  keyboard-nav/Escape) -> adopt seed 1 with confirm (msg 'exported') -> API serves PNG+ETag
  -> confirm-delete seed 2 -> re-adopt seed 3 FROM THE LIGHTBOX -> meta seed 3;
  (2) search (system_name + main_object substrings) + kind chips + adoption filter narrow
  the list; (3) queue 5 jobs -> cancel the last PENDING one from the queue panel -> that
  render = failed 'canceled by user', the other 4 complete -> Retry regenerates the same
  seed to [ok]. Retry is therefore covered end-to-end in the BROWSER (the cancel produces
  the failed render deterministically -- no unit-test fallback needed).
  artinspect.spec.ts (REQ-0152) updated for the changed flows (art-new + adopt confirm) and
  re-run green via tools/art_inspect_e2e.sh: 1/1 in 19.7 s.
- [x] G3 queue semantics (artqueue_test.cjs, real serialized queue + mock worker):
  cancel-pending removes exactly that job (listJobs before/after asserted) and marks the
  render failed 'canceled by user' while the neighbors complete; cancel-running kills the
  worker fast (asserted < 6 s against an 8 s mock sleep) and the pump advances (follow-up
  job completes); cancel of a finished job -> NOT_FOUND (404 at the route); adopted render
  remains undeletable.
- [x] G4 hygiene: git status clean; `git diff master` = 25 files, no PNG, no lockfile, no
  web/app dist (rebuilt for e2e, then restored via git checkout + git clean); pnpm only.
- [ ] S7 user acceptance on the live deployed screen -- orchestrator owns merge + deploy.

**Deviations / notes**
- 'queue' added to the RESERVED system_name words (server + client mirror). Additive
  tightening; no existing artwork uses it (backfilled names are batch-prefixed).
- The RUNNING job also gets a Cancel button in the queue panel (spec asked per-job Cancel on
  pending; the server cancel-running path exists and G3 tests it, so hiding it in the UI
  would be artificial).
- Workspace edit-form fields use NEW art-edit-* testids (the old ids stayed on the create
  panel, which owns the historical contract); delta documented here per spec C.
- artadmin.config.ts timeout 90 s -> 150 s (the cancel spec deliberately holds ~1.5 s mock
  jobs in queue).
- tools/ci.sh [3.5/7] server typecheck needs root node_modules; the worktree runs it through
  a gitignored node_modules symlink to the main checkout (read-only). Nothing in the main
  checkout was modified.

**Test evidence**
- server/tests/artqueue_test.cjs: 4 passed / 0 failed (aggregates incl. empty-artwork nulls
  + REQ-0151 row-shape preservation; cancel-pending; cancel-running incl. kill latency +
  pump advance + NOT_FOUND; adopted-undeletable).
- server/tests/artwork_test.cjs 6/6; server/tests/api_test.cjs 155/155 (files) + 155/155
  (pg); server/tests/inspection_test.cjs 5/5.
- e2e: artadmin.spec.ts 3 passed (27.9 s); artinspect.spec.ts 1 passed (19.7 s).

**Commits (branch req-0156-artadmin-ux-overhaul)**
- 0370283 server: listArtworks aggregates + queue introspection/cancel + routes +
  ART_MOCK_DELAY_MS knob; artqueue_test 4/4 wired into ci.sh
- 12fdaa2 client: three-pane MJOLNIR overhaul (registry browser / workspace / queue strip,
  lightbox+compare, separated create panel, confirm dialogs, toasts); contentadmin cross-link
- 851bdb0 e2e: updated artadmin spec + lightbox/filter/cancel/retry coverage; artinspect
  spec follows the new flows; tools/artadmin_e2e.sh harness
- (this commit) REQ log
