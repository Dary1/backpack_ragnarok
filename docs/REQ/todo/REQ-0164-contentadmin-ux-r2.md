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
