# REQ-0141 — canvas-first-run-guidance

**Status:** built
**Reserved:** 2026-07-12
**Slug:** canvas-first-run-guidance
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/user_managed/game_golden.md` (P1/P2/P5),
`docs/user_managed/canvas_spec.md` (3 placement layers, Unit beams).

## Goal

The design is intrinsically deep: Canvas → BP → PO (tags, ports) → SI
(sockets) → Unit link beams. Review verdict: steepest UX risk in the product.
Teach it by doing — a first-run guided placement that reveals one layer at a
time (progressive disclosure), never a wall of text.

## Scope

- Guided first-canvas sequence: place a BP → drop a PO (see it fit) → witness
  a port connection → seat an SI in a socket → place a second BP + Units →
  first link beam ignites. Each step gated on the player actually doing it.
- Contextual hints thereafter (first time seeing: rotation, tag mismatch,
  dud beam) — dismissable, never modal-stacked.
- Skippable at any point; replayable from Settings; state in profile via the
  storage seam.
- Copy EN + `i18n.ja`. Empty-state copy shared with REQ-0140.

## Non-goals

No tutorialized combat (dungeon runs are schedule-driven; out of scope); no
rules-reference/codex screen (possible future REQ); no rebalancing.

## Gates

- e2e: fresh profile completes the guided sequence; skip path leaves a fully
  usable canvas.
- User playtest verdict green.

---

## Implementation record (2026-07-14)

Branch `req-0141-first-run-guidance` (own server worktree; NOT merged to master
-- a separate integration owner handles merge/deploy).

### Reconciliation with REQ-0051 starter units [KEY DECISION, vetoable]
Fresh guests are seeded four starter-unit squads -- each a filled 5x5 BP whose
POs are `fixed` (immovable), carry NO ports and NO sockets, and whose Unit's
`connection_shape` is `none` (casts no link beams). The spec's ideal
"gated on actually doing it" build (drop a free PO -> witness a port connection
-> seat an SI -> ignite a first link beam) is therefore UNREACHABLE with
starter-only content: no free PO to drop, no socket to seat into, no ray-casting
Unit to light, and two 5x5 starter BPs may not even co-fit one canvas. So the
guided first-canvas sequence ships as a **progressive-disclosure ORIENTATION
tour** over the starter canvas the guest already has -- one card per placement
layer (Backpack -> Placement Objects -> Unit -> Link/The Moment -> Depart), each
gated on an explicit acknowledgement (never a wall of text), skippable at any
point. The "teach by doing" for the movable-content mechanics is delivered by
the **contextual first-time hints**, which fire the first time the player
genuinely performs each action LATER, once real (movable, ray-casting) content
is earned from a dungeon.

### Other decisions
- **Persistence.** Guide state rides in the persisted canvas as `state.guide`
  (`{status, step, seen, hints}`), round-tripped through the ONE auto-save PUT
  writer (`client/src/store/autosave.ts`) -- the established client-profile
  pattern. NO `server/storage.cjs` change: the profile canvas doc is opaque
  JSON/jsonb, `migrateStateV2`'s deep clone preserves the field, `loadGame`
  copies it back. boot writes the field ONLY for a genuinely fresh profile
  (`isFreshProfile`); returning/dev/e2e-fixture profiles never gain it (saved
  canvas stays byte-unchanged, no tour) -- so no existing e2e fixture is
  disturbed.
- **Contextual hints [scope, vetoable].** Framework + EN/JA copy for all three
  (rotation, tag mismatch, dud beam) shipped. Only the DUD-BEAM trigger is wired
  (detected from `engine.traceBeams` in a store subscription, NO BoardRenderer
  edit; gated on `guide.seen` so it is inert for every non-onboarded profile and
  for starter-only content). rotation/tag-mismatch are interaction-transient (a
  rejected placement / a rotate gesture leave no state trace); their copy ships
  ready but trigger wiring is deferred to a follow-up interaction hook
  (additive-only, zero BoardRenderer edits -- matching REQ-0140).
- **Empty-state copy** reused from REQ-0140 `CanvasEmptyState` (imported, not
  forked). **Replay** from Settings works for any profile. Non-modal by design:
  the tour container is `pointer-events:none`; only the card/hint are
  interactive, so the board underneath stays fully usable.

### Files
New: `client/src/guide/{guideModel.ts,guideController.ts,FirstRunGuide.tsx,ContextualHint.tsx}`,
`client/src/i18n/guide.ts`, `client/src/styles/guide.css`,
`client/e2e/first-run-guide.spec.ts`.
Wired: `client/src/{App.tsx,Settings.tsx,main.tsx,i18n.ts,index.css,store/boot.ts,store/autosave.ts}`;
`client/e2e/starter-units.spec.ts` (dismiss the now-present tour first).

### Gates (exact)
- `flock /tmp/backpack_ci.lock bash tools/ci.sh` -> **CI GREEN** (CI_EXIT=0),
  DATABASE_URL sourced from the live pg-backed API server. All stages green:
  sim/goldens/S4/forecast-parity, mock-engine, server+shared typecheck, engine
  type-surface drift, vocab/units, files- AND pg-backend api tests,
  bio/bpskin/artwork/content/inspection suites, client typecheck+build, the
  admin e2e trio (artadmin 4/4, artinspect 1/1, contentadmin 21/21), and the
  default e2e suite **177 passed / 0 failed** (172 prior + REQ-0141's 5).
- Targeted `first-run-guide.spec.ts` via the sanctioned wrapper: **5/5** --
  (1) fresh guest auto-activates the tour; (2) clicking every card completes it
  and completion persists across a reload; (3) skip leaves a fully usable canvas
  and persists; (4) mid-tour progress persists across a reload; (5) replayable
  from Settings.

### Commits
- `b079d4f` -- REQ-0141 feature (source).
- `47b3d1f` -- merge master (REQ-0126/0140 done-record docs; re-sync).
- this record + `git mv todo -> built` follow.

### Non-goals honored
No tutorialized combat, no codex/rules-reference screen, no rebalancing.

---

## Wave-7 merge/deploy record (2026-07-14)

- Merged to master via `--no-ff` **908890b** (branch `req-0141-first-run-guidance`, tip fe1e9fe). No conflicts; disjoint file set from REQ-0144. Client `tsc -b` sanity gate green before proceeding.
- Full gate `flock /tmp/backpack_ci.lock bash tools/release.sh`: **CI GREEN**; dist rebuilt + committed as **5535b45** (guide now in the shipped `web/app/` bundle). Services restarted and verified active + HTTP 200 (web :8801 `/app/`, api :8802 `/api/health`).
- Post-deploy full e2e (`pnpm run e2e`): **177 passed / 0 failed**, incl. `first-run-guide.spec.ts` **5/5** and `starter-units.spec.ts` (tour-dismissal) green. Note: the first release attempt aborted on a single `artadmin.spec.ts:113` `page.goto` 20s-timeout flake in the admin trio; an isolated rerun was 4/4, confirming a timing flake; the re-run release was fully green.
- **Disposition: STAYS built.** The REQ Gates list an explicit unmet user-acceptance item -- "User playtest verdict green." The live fresh-guest first experience now ships the orientation tour (intended); built->done is withheld pending the user playtest verdict. Worktree retained.
