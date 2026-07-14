# REQ-0164 — contentadmin-ux-r2: second UX pass on the content-data registry console

**Ratified:** 2026-07-14 (user, chat) — "洗い出し→REQ起こし→improve" mandate for
https://backpack-dev.qtie.jp/app/#/contentadmin; scope ruling "全部入り" (all 14 surveyed
deficiencies) and merge+deploy approval both given in the same chat (AskUserQuestion,
2026-07-14). CLIENT-ONLY: no server/API/schema changes.
**Requested by:** user, 2026-07-14 (chat). Spec authored by orchestrator (Fable) from a live
survey of the deployed screen (master 8436734, post REQ-0157/0160/0161) + source reading.

**Depends on / coordination:**
- REQ-0157 (contentadmin-ux-overhaul, built+deployed) — this REQ polishes its surface.
  Registry semantics (REQ-0155: variant-as-record, immutability, machine checks advisory-loud,
  FAIL adoption only behind explicit override, export on adoption, Q1 agent-session loop,
  Dex LINK-FIRST) are UNCHANGED.
- REQ-0156 (artadmin) — shared aa-* CSS is REUSED VERBATIM and must stay byte-untouched
  (client/src/styles/artadmin.css); all new styling lands in contentadmin.css as ca-* only.
  artadmin.spec.ts re-run green is the regression proof, same as REQ-0157 did.
- REQ-0052 dex deep link (#/dex/<id>) — the routing pattern this REQ mirrors.

## Survey — deficiencies being fixed (live screen 2026-07-14, master 8436734)
Numbered as presented to + ratified by the user:
1. LAYOUT WIDTH INSTABILITY (worst): `.ca-root` is a flex child of `.app-main`
   (base.css `display:flex`) with no `flex`/`width`, so the page shrink-to-fits its content:
   one-third-width screen with nothing selected, then JUMPS when the commission payload
   renders, and can exceed the viewport → page-level HORIZONTAL SCROLL cutting off the
   variant cards' right edge (observed live).
2. The commission workflow strip is always fully expanded, even on adopted defs with
   variants — the page's most common task (inspect existing content) scrolls past
   commissioning UI every time.
3. Def rail is `created_at ASC` only (storage ORDER BY); no sort control at 38 defs and
   growing.
4. The header aria-live message is STALE-STICKY: it persists indefinitely and survives def
   switches ("commission for 5 variants ready" still shown while browsing another def).
5. After ingest, new variants get no highlight and no scroll-into-view; workflow step 3 is
   inert text with no counts.
6. The diff view renders BELOW all variant cards — invisible from the trigger button with
   many variants; no Esc-to-close.
7. `ca-kind--skill_def` palette entry is missing (REQ-0160 added the kind; the chip renders
   unstyled default grey — observed live).
8. Timestamps are raw UTC ISO slices (`fmtDate`), -9h for the JST operator; no local-time
   rendering.
9. VariantCard local state (jsonOpen etc.) leaks across def switches — React reuses cards
   keyed by bare variant_no, so v1's open JSON panel carries from def to def (observed live).
10. The review draft controls (select + rationale input + save) are always visible on every
    card — clutter for the browse case; reviews normally arrive via the API.
11. CreatePanel's schema_ref default is the placeholder `content/vocab.json`; the canon refs
    are per-kind (po/2, si/2, tm/1, enemy/1, skill/1 — the backfill's origin_schema truth).
12. Dirty brief/schema_ref edits are silently discarded on def switch / create-panel open.
13. No deep link: the selected def is not in the URL; refresh loses the selection.
    #/dex/<id> is the in-repo precedent.
14. With a missing/invalid admin token the rail is silently empty; the only signal is a tiny
    "list: ..." message top-right.

## Scope (all client; `client/src/contentadmin/*`, `client/src/styles/contentadmin.css`,
routing files for D only)

### A. Layout stability (fixes 1)
- `.ca-root` becomes a stable full-width flex child (`flex: 1; min-width: 0;` or
  `width: 100%`), grid columns unchanged (340px rail + `minmax(0,1fr)` center).
- NO page-level horizontal scroll in ANY state (payload open, JSON open, diff open,
  create panel) at viewport ≥1280px; wide `pre` content scrolls/wraps INSIDE its panel.
- The placeholder/create/workspace states all occupy the same stable footprint.

### B. Workflow strip collapse (fixes 2)
- The strip gets a header toggle (`data-testid="cd-flow-toggle"`) with a one-line summary
  when collapsed (e.g. "Commission workflow — adopted v1 · 1 variant").
- Default: COLLAPSED when the def has an adopted variant AND ≥1 variant AND no commission
  payload/ingest text in progress; EXPANDED otherwise (unadopted or zero variants — the
  commissioning case). Manual toggle wins for the current selection; reset on def switch.
- All existing strip testids (cd-gen-n, cd-commission, cd-commission-out,
  cd-copy-commission, cd-ingest-json, cd-parse-preview, cd-ingest) keep working once
  expanded; the e2e is updated to expand first where needed (delta documented).

### C. Feedback & adjudication legibility (fixes 4, 5, 6)
- cd-msg clears on def switch and auto-fades after ~8 s (the aria-live NODE stays mounted;
  e2e substring assertions read it right after the action, unaffected).
- After a successful ingest the new cards get a transient `is-new` highlight and the first
  new card scrolls into view; workflow step 3 shows live counts
  ("N variants · M PASS · K FAIL", testid `cd-adjudicate-summary`).
- Diff view: opening it scrolls it into view; Esc closes it (same handler grammar as the
  confirm dialog); `diff-view`/`diff-close` testids preserved.
- Variants section header also carries the PASS/FAIL tally.
- Async card actions (recheck at minimum) get a busy state (disabled + label swap) so
  double-clicks don't double-fire.

### D. Deep link (fixes 13)
- `#/contentadmin/<system_name>` mirrors the REQ-0052 dex pattern: a
  CONTENTADMIN_HASH_RE + one-shot `contentAdminFocusName` field in store/core.ts,
  consumed+cleared by ContentAdminPage (select the def once loaded; unknown name → normal
  page + err report). Selecting a def rewrites the hash via history.replaceState
  (no history spam); bare `#/contentadmin` keeps working; route stays 'contentadmin'.

### E. Rail improvements (fixes 3, 14)
- Sort control (`cd-sort-<mode>` chips or select): `created` (default, current behavior),
  `name` (A→Z), `activity` (last_variant_at DESC, nulls last) — client-side only.
- Auth/list failure state: the rail shows an explicit error panel (testid `cd-list-error`)
  with the failure text and a hint ("admin token required — open via an invite link"),
  instead of a silent empty list; retries keep polling.
- Row tooltip carries the brief snippet (title attr), so brief-substring search hits are
  explicable.

### F. Card polish (fixes 8, 9, 10)
- `fmtDate` renders LOCAL time "YYYY-MM-DD HH:MM" (title attr = raw ISO UTC). Helper stays
  in contentShared with a unit-testable pure signature.
- VariantCard React keys become `<system_name>:<variant_no>` (or state resets on selection)
  so per-card UI state never survives a def switch.
- The review draft controls collapse behind a per-card toggle
  (`data-testid="review-open-<no>"`); once open, the REQ-0155 testids
  (review-verdict-select-<no>, review-rationale-<no>, review-submit-<no>) are unchanged.
  The e2e is updated to click the toggle first (delta documented).

### G. Create flow & dirty guard (fixes 11, 12, 7)
- Kind-driven schema_ref default map in contentShared (single source):
  po_def→po/2, si_def→si/2, tm_def→tm/1, monster_def→enemy/1, skill_def→skill/1,
  unit_def→content/vocab.json (no canon schema yet — documented). Auto-swap ONLY while the
  field is pristine; a user-edited value always wins.
- Switching def / opening the create panel with a dirty draft raises the existing
  ConfirmDialog ("discard unsaved changes to <name>?"); Cancel keeps the selection.
- skill_def gets its palette entry (`.ca-kind--skill_def`) + a sane default for any future
  kind (base .aa-kind look is the fallback, but every CURRENT kind must have an entry).

## Contract preservation
- REQ-0155/0157 semantics untouched; NO server or shared/dto changes; NO change to
  api.ts/api/* modules (client-view-only REQ, except store/core.ts+routing.ts for D).
- artadmin.css byte-untouched; artadmin behavior pixel-identical (its e2e re-run green).
- Preserved testids: everything REQ-0157 lists as PRESERVED plus its NEW set, except where
  this spec names a change; every changed/added testid is documented in the log
  (NEW: cd-flow-toggle, cd-adjudicate-summary, cd-sort-*, cd-list-error, review-open-<no>,
  is-new highlight class; CHANGED FLOW: review controls behind toggle, strip
  collapsed-by-default on adopted defs).
- contentadmin.spec.ts updated in the SAME commit as each behavior change.

## Out of scope
- Server extensions of any kind (aggregates, endpoints); batch orchestrator; reviewer
  automation; artadmin (REQ-0156 owns it); def rename/delete; mobile layout;
  i18n of the admin surface (stays EN-only); localStorage persistence of filters.

## Gates
- G1 build+types: `pnpm exec tsc -b` + `pnpm run build` EXIT 0 in client/. Server test
  suites untouched by construction (no server diff); run content_test.cjs + api_test.cjs
  once anyway as a no-regression courtesy check.
- G2 e2e: updated contentadmin.spec.ts green via tools/content_admin_e2e.sh, covering at
  minimum: stable-width smoke (no horizontal document overflow with payload+JSON+diff open),
  strip collapsed on an adopted def / expanded on a fresh def / toggle works, msg clears on
  def switch, ingest highlights + summary counts, diff Esc-close, deep link
  (#/contentadmin/<name> selects; selection rewrites hash), sort modes reorder the rail,
  review controls open-then-submit, per-kind schema_ref default in create, dirty-guard
  confirm on switch, local-time render, list-error panel (token-less context or mocked
  failure if the harness allows; otherwise assert the component branch via a unit-style
  check). PLUS regression re-run: artadmin.spec.ts green.
- G3 hygiene: no content/ data, no PNG/dist/lockfile-drift commits; pnpm only; worktree
  req-0164-contentadmin-ux-r2 only; diffs composed off-mount (docs/llm_managed
  2026-07-14-mount-truncation.md rules followed).
- S7 user acceptance on the live deployed screen (merge+deploy approval already carried
  from the 2026-07-14 chat; orchestrator executes merge → web/app rebuild → restart).

## Risks
- The strip default-collapse interacts with the existing e2e flow (def becomes adopted
  mid-test); the spec update must re-expand via cd-flow-toggle where the flow continues to
  use strip controls after an adoption.
- scrollIntoView in headless Playwright is a no-op visually but must not throw; keep it
  try-safe (browser-only code path).
- history.replaceState hash rewrites must not retrigger routing loops (replaceState does
  NOT fire hashchange — but guard the handler to treat 'contentadmin/<name>' as the
  'contentadmin' route anyway, mirroring the dex pattern's specific-before-generic order).

## Implementation log
(to be filled by the implementing engineer)

### Session 2026-07-14 (implementing engineer, opus)

Client-only implementation of scope A–G. Branch `req-0164-contentadmin-ux-r2`
off master 8436734. Changes composed off-mount and applied over SSH per the
mount-truncation policy; every write verified server-side by md5sum / git diff.

#### Architecture decisions
- **A (layout).** `.ca-root` becomes a stable full-width flex child
  (`flex:1; min-width:0`); grid columns unchanged (`340px minmax(0,1fr)`). Wide
  `pre` blocks stay contained by the existing `overflow`/`min-width:0` chain —
  no page-level horizontal scroll at ≥1280px in any state (verified by the
  stable-width e2e).
- **B (strip collapse).** Collapse state lives in `ContentAdminPage` as
  `flowCollapse: boolean | null` (null = follow the derived default), reset to
  null on every def switch. Derived default collapsed =
  `adoptedNo != null && variants.length >= 1 && !commission && !ingestText.trim()`.
  Manual `cd-flow-toggle` sets the concrete boolean (wins for the selection).
  When collapsed, `Workspace` renders only the header + a one-line
  `cd-flow-summary`; the numbered steps (and their controls) are unmounted.
- **C (feedback).** `cd-msg` auto-fades via a single `useEffect([msg])`
  (covers every `setMsg` source; the aria-live node stays mounted, only its
  text clears) and is cleared explicitly in `doSelectDef`. Fresh ingest sets
  `newNos[]` + `scrollToNo` (min new no) with an 8 s clear timer; the first new
  `VariantCard` scrolls into view (try-safe, browser-only). `DiffView` owns its
  own `scrollIntoView` + Esc-close handler (same grammar as `ConfirmDialog`).
  Recheck is guarded by `recheckingNos[]` (button disabled + label swap).
  Live PASS/FAIL tallies in step 3 (`cd-adjudicate-summary`) and the Variants
  header (`cd-variants-tally`).
- **D (deep link).** Mirrors the REQ-0052 dex pattern exactly:
  `CONTENTADMIN_HASH_RE` + one-shot `contentAdminFocusName` in `store/core.ts`,
  set by `initRouting()`/`onHashChange` (specific-before-generic, after the
  invite/dex checks), cleared by `clearContentAdminFocusName()`.
  `ContentAdminPage` reads the field via `useGameStore()` — **keeping the
  `{ locale }` signature and leaving App.tsx untouched** — consumes it once the
  def list has loaded (unknown name → reported), and rewrites the hash via
  `history.replaceState` in `doSelectDef` (replaceState fires no hashchange, so
  no routing loop). Bare `#/contentadmin` still works.
- **E (rail).** `sortDefs()` pure helper: `created` = id ASC (server order),
  `name` = localeCompare, `activity` = `last_variant_at` DESC nulls-last.
  `cd-list-error` panel shown when a list load fails and there are no rows to
  show; polling continues. Row `title` carries a brief snippet.
- **F (card).** `fmtDate` renders LOCAL `YYYY-MM-DD HH:MM` (unit-testable pure
  fn; title attr = raw ISO). `VariantCard` React keys become
  `<system_name>:<variant_no>` so per-card UI state (jsonOpen/rationaleOpen/
  reviewOpen) resets on def switch. Review draft controls hide behind
  `review-open-<no>`.
- **G (create/guard).** `SCHEMA_REF_DEFAULTS` map + `defaultSchemaRef()` single
  source; `CreatePanel` auto-swaps schema_ref on kind change **only while
  pristine** (`schemaTouched` tracker). Dirty-draft guard: a `ConfirmState`
  `'discard'` variant + `performNav()` raises the existing `ConfirmDialog`
  ("Discard unsaved changes to <name>?") on def switch / create-open with an
  unsaved brief/schema_ref; Cancel keeps the selection. `.ca-kind--skill_def`
  palette entry added.

#### testid delta
- **PRESERVED** (unchanged, every REQ-0157 testid): `contentadmin`,
  `cd-artadmin-link`, `cd-msg`, `cd-list`, `cd-select-<name>`,
  `cd-faildot-<name>`, `cd-adopted-badge-<name>`, `cd-facet-<name>`, `cd-new`,
  `cd-search`, `cd-filter-kind-*`, `cd-filter-adoption-*`, `cd-detail`,
  `cd-adopted-state`, `cd-dirty`, `cd-artwork-facet`, `cd-artadmin-goto`,
  `cd-dex-link`, `cd-edit-schema-ref`, `cd-edit-brief`, `cd-save`, `cd-gen-n`,
  `cd-commission`, `cd-commission-out`, `cd-copy-commission`, `cd-ingest-json`,
  `cd-parse-preview`, `cd-ingest`, `cd-diff-open`, `cd-variants`,
  `variant-<no>`, `variant-adopted-<no>`, `variant-source-<no>`, `checks-<no>`,
  `overall-<no>`, `check-<no>-<name>`, `check-detail-<no>-<name>`,
  `recheck-<no>`, `review-<no>`, `review-verdict-<no>`,
  `review-rationale-full-<no>`, `review-verdict-select-<no>`,
  `review-rationale-<no>`, `review-submit-<no>`, `adopt-<no>`, `delete-<no>`,
  `edit-open-<no>`, `json-toggle-<no>`, `diff-adopted-<no>`, `diff-pick-<no>`,
  `json-copy-<no>`, `json-view-<no>`, `diff-view`, `diff-close`,
  `confirm-dialog`, `confirm-ok`, `confirm-cancel`, `adopt-override`,
  `edit-close`, `edit-json-<no>`, `edit-valid-<no>`, `edit-format-<no>`,
  `edit-submit-<no>`, `cd-create-panel`, `cd-create-close`, `cd-kind`,
  `cd-system-name`, `cd-schema-ref`, `cd-brief`, `cd-create`, `cd-create-error`.
- **NEW**: `cd-flow-toggle`, `cd-flow-summary`, `cd-adjudicate-summary`,
  `cd-variants-tally`, `cd-sort-created`, `cd-sort-name`, `cd-sort-activity`,
  `cd-list-error`, `review-open-<no>`, `variant-new-<no>`, and the `is-new`
  highlight CLASS on `.ca-vcard`.
- **CHANGED FLOW** (no testid renamed or removed):
  * the review DRAFT controls (`review-verdict-select-<no>` /
    `review-rationale-<no>` / `review-submit-<no>`) render only after clicking
    `review-open-<no>` — same testids, now gated behind the per-card toggle.
  * the workflow-strip controls (`cd-gen-n`, `cd-commission`,
    `cd-commission-out`, `cd-copy-commission`, `cd-ingest-json`,
    `cd-parse-preview`, `cd-ingest`, `cd-adjudicate-summary`) render only when
    the strip is expanded; on an adopted def with variants the strip is
    collapsed by default (click `cd-flow-toggle` to reach them). The existing
    big e2e flow keeps a live commission payload, so its strip stays expanded
    and needed no re-expand; new tests exercise the collapse explicitly.

#### Gate results
- **G1 types/build**: `pnpm exec tsc -b` EXIT 0; `pnpm run build` EXIT 0
  (built in ~450–510 ms; web/ artifacts restored after, not committed).
  Courtesy no-regression (no server diff): `node server/tests/api_test.cjs`
  (files backend) **157 passed, 0 failed**; `STORAGE_BACKEND=pg node
  server/tests/content_test.cjs` (isolated temp-home namespace) **13 passed,
  0 failed**.
- **G2 e2e**: `tools/content_admin_e2e.sh` → **12/12 passed (23.4 s)**;
  regression `tools/artadmin_e2e.sh` → **3/3 passed (28.7 s)**. web/ rebuilt
  before the runs, then `git checkout -- web/ && git clean -fd web/`; working
  tree verified clean of dist artifacts.
- **G3 hygiene**: `git diff master...HEAD --stat` = only the 12 intended files
  (7 contentadmin components + contentadmin.css + store core/routing + e2e spec
  + this REQ doc). `client/src/styles/artadmin.css` byte-untouched; no server/
  /shared/api change; no App.tsx change; no lockfile/dist/PNG churn.

#### Commits
- `1d292e3` REQ-0164 D: #/contentadmin/<name> deep-link store plumbing.
- `c5f5f96` REQ-0164 A-G: contentadmin UX r2 (console polish + e2e).
- (this log commit).

#### Deviations / notes for the orchestrator
- **Server deps install.** The worktree had no `server/node_modules` (only
  client was installed). Ran `pnpm install --frozen-lockfile` in `server/` so
  `pg` resolves for the pg-backed `content_test` and the e2e API server. No
  lockfile drift (`server/pnpm-lock.yaml` unchanged; `server/node_modules`
  gitignored). Not a code change. `content_test.cjs` initially failed only with
  "Cannot find module 'pg'" (env), and passed after install.
- **Stable-width assertion** uses `scrollWidth - clientWidth <= 1` (1 px
  sub-pixel tolerance) rather than a strict `<=`, to avoid rounding flakiness;
  still proves no page-level horizontal scroll at the 1400 px viewport.
- **cd-list-error** is exercised in e2e via a Playwright route-mock 500 (the
  harness runs dev_mode, so the admin gate never fails auth) — as the spec's
  G2 list permits.
- **No `contentadmin.config.ts` change** was needed.
- Merge/deploy still owned by the orchestrator (S7). The deployed web/app must
  be rebuilt from client/ at deploy time (the branch does not commit web/).

### Deployment record (orchestrator, 2026-07-14)
- Merged to master 994f0d8 (merge of req-0164-contentadmin-ux-r2, 3 impl commits
  1d292e3 / c5f5f96 / f806baf + state moves); dist rebuild d783c47 (web/app).
- backpack-web serves the new dist statically (no service restart needed; no server code
  in this REQ, backpack-api untouched).
- Live verification on https://backpack-dev.qtie.jp/app/#/contentadmin (Chrome, 2026-07-14):
  stable full-width layout (no horizontal overflow); deep link #/contentadmin/frost_gnoll
  selects the def and selection rewrites the hash (#/contentadmin/gnoll_claw observed);
  workflow strip collapsed-by-default on adopted defs with summary line, toggle expands,
  step-3 adjudicate summary + variants PASS/FAIL tally render; skill_def kind chip styled;
  local-time timestamps (JST); review controls behind "Add review"; sort chips
  (created/name/activity) render; cd-list-error panel PROVEN LIVE by a real incident (the
  browser held a role-less ux-test-player guest token -> explicit forbidden panel + hint,
  where the old UI showed a silent empty rail).
- Incident note: that guest token 403 was pre-existing browser state, not a regression;
  per user ruling in chat ("逆に全ての権限を付与") data/players/p_029be4bca0b5.json
  (ux-test-player) was granted roles:["item_admin"] (the only role in the codebase).
- Status: stays in built/ awaiting S7 user acceptance on the live screen.
