# REQ-0168 — Schedule (#/schedule) end-user UX pass

- **Status**: folder = status (PROJECT.md REQ policy).
- **Origin**: user directive 2026-07-14 (orchestrator session): play #/schedule as a
  real player, find and fix everything unfriendly. Scope ratified by the user the
  same day (AskUserQuestion): quick-wins bundle (this REQ) + monitor field repair
  (REQ-0169) + spoils rail (REQ-0100, ratified alongside) + 4-squad onboarding
  guidance (folded in here). User also explicitly authorized master merge + deploy
  for this batch after gates.
- **Branch**: req-0168-schedule-ux-pass (also hosts REQ-0169 + REQ-0100 work).

## Evidence — live repro, 2026-07-14

Fresh guest `ux-test-player` (p_029be4bca0b5) minted via server/cli_invite.cjs on
the dev server, profile seeded with client/e2e/fixtures/schedule-fixture.json
(4 mutually-unique deployable squads + 1 undeployable). Full player loop walked in
Chrome (EN + JA): create room -> fill 4 slots -> auto-run -> victory -> cooldown ->
next run. Issues below are all first-hand observations from that walk.

## Fixes

Each item: problem -> change -> acceptance. Keep EVERY existing data-testid /
class the e2e suite selects unless the item explicitly says otherwise; when copy
that e2e asserts on changes, update the spec assertion in the same commit.

### U1. Create-room flow gives no feedback and stays open
- Problem: after a successful create, the form stays expanded, the new room
  appears un-highlighted at the LIST BOTTOM, nothing is selected; double-submit is
  plausible.
- Change (SchedulePage.tsx handleCreate): use apiCreateRoom's return
  ({ok, room}) -> setCreateOpen(false); setExpandedRoomId(room.id); reloadRooms();
  scroll the new card into view (rooms-col scrollIntoView after render, best-effort).
- Acceptance: creating a room closes the panel, the new card renders selected
  («Watching» marker) at the top of the list (see U5), and the detail pane shows
  its slots panel.

### U2. «Select a room» has no visible selection affordance
- Problem: detail-empty copy says «Select a room…» but the only affordance is the
  small Expand/展開 button; the card body is inert; «Expand» ≠ «Select» wording.
- Change: make the whole RoomCard clickable (onClick = same handler as the toggle;
  role="button"; cursor pointer; inner buttons/selects stopPropagation). Rename the
  button label: new keys schedule.watch = EN "Watch" / JA "監視" and
  schedule.unwatch = EN "Stop watching" / JA "監視をやめる" (data-testid
  schedule-room-expand-toggle unchanged). Align schedule.detail.empty copy with the
  new verb (EN "Pick a room to watch its battle monitor." stays fine; JA stays).
- Acceptance: clicking anywhere on a card selects it; clicking again deselects;
  cancel/slot controls do not trigger selection; e2e toggle testid still works.

### U3. Stale empty-state copy («Create one below»)
- Problem: schedule.noRooms says «below»/「下記から」 but the create panel
  auto-opens ABOVE the list (UX pass that moved it predates this copy).
- Change: EN "No rooms yet — forge your first expedition with the form above." /
  JA 「まだルームがありません。上のフォームから最初の遠征を組みましょう。」
- Acceptance: zero-room state shows the corrected copy (both locales).

### U4. The 4-different-deployable-squads requirement is undiscoverable
- Problem: a run only auto-starts when all 4 slots hold 4 DIFFERENT deployable
  squads (server/services/runs.cjs maybeAutoStartNextRun + uid-overlap gate). The
  page never says so; a player with <4 squads dead-ends with no pointer to the
  Backpacks screen.
- Change (SlotsPanel.tsx): (a) permanent sub-line under the panel title: EN "A run
  starts automatically once all four slots hold four different squads." JA
  「4つのスロットすべてに異なるスカッドを配置すると、ランが自動で始まります。」
  (b) when deployableCount < 4: a callout (new testid schedule-slots-need-squads)
  EN "You need {n} more deployable squad(s) — build them on the Backpacks screen."
  JA 「あとデプロイ可能なスカッドが{n}体必要です。編成画面で用意しましょう。」
  with a real link/button navigating to #/backpacks.
  (c) schedule.monitor.awaitingRun mentions DIFFERENT squads: EN "No run yet — fill
  all 4 slots with 4 different squads to start one." JA 「まだランがありません。
  4つのスロットに異なるスカッドを配置すると開始します。」
- Acceptance: with the fixture profile stripped to 2 deployable squads, the callout
  shows «2 more» and its link lands on #/backpacks; with 4+, no callout.

### U5. Room list order is storage order (arbitrary)
- Problem: server listRooms preserves backend order; new rooms may append at the
  bottom; canceled history interleaves.
- Change (SchedulePage.tsx): client-side stable sort of visibleRooms: non-canceled
  first sorted createdAt DESC, canceled last (also createdAt DESC). Pure display.
- Acceptance: newly created room renders first; order stable across 4s polls.

### U6. Same-room duplicate squad 409 returns a misleading message
- Problem: assigning the SAME squad to a second slot of the SAME room yields
  reason deployed_overlap -> EN «This squad already has a squad deployed in another
  active schedule. Wait for that run to finish…» — wrong location (same room),
  wrong advice (no run running), broken grammar («squad has a squad»).
- Change (server/services/squads.cjs assign/swap gate): when the overlap source is
  another slot of the SAME room, attach reason "same_room_duplicate" (409,
  distinct message string); cross-room stays "deployed_overlap".
  (client errors.ts): map same_room_duplicate -> new key schedule.error.sameRoomDuplicate
  EN "This squad is already assigned to another slot of this room — each slot
  needs a different squad." JA 「このスカッドはすでにこのルームの別スロットに
  配置されています。スロットごとに異なるスカッドが必要です。」
  Fix crossRoomOverlap grammar: EN "This squad is already deployed in another
  expedition that is still running. Wait for that run to finish, or pick a
  different squad." JA 「このスカッドは進行中の別の遠征にデプロイされています。
  そのランの終了を待つか、別のスカッドを選んでください。」
- Tests: server test for the two reasons; update client/e2e/schedule.spec.ts:682
  substring assertion («already has a squad deployed») to the same-room message
  (that spec asserts the SAME-room duplicate path) — verify which path each spec
  exercises before editing.
- Acceptance: same-room duplicate and cross-room-active produce the two distinct,
  truthful messages (verified in browser both locales).

### U7. Dropdown offers squads that can only 409
- Problem: squads already deployed (other slot of this room, or any slot of
  another ACTIVE room) stay selectable; empty squads are pre-disabled but these
  are not — inconsistent.
- Change (SchedulePage -> SlotsPanel): pass the rooms list down; disable options
  whose squadIndex is (a) assigned to another slot of THIS room, or (b) assigned
  to any slot of another room with status active; suffix i18n
  schedule.slots.deployedOption EN "{name} (deployed)" / JA 「{name}（配置中）」.
  Keep the server 409 as defense (uid-overlap across different squads stays
  server-only).
- Acceptance: with room A active using squads 0-3, room B's dropdowns show 0-3
  disabled; this room's own assigned squads disabled in sibling slots.

### U8. Client deployability predicate disagrees with the server
- Problem: observed live — dropdown offered a squad as deployable, server 409ed
  empty_squad («no Backpack items»). Client uses engine.isSquadDeployable, server
  uses its own empty-squad rule; they disagree for a squad whose backpack exists
  but carries no items (exact shape to confirm in code).
- Change: root-cause and align — the dropdown's disabled predicate must imply the
  server's acceptance (for the overlap-free case). Prefer fixing the client
  predicate; if the engine call is right and the server is stricter, mirror the
  server rule client-side.
- Acceptance: a squad rendered enabled in the dropdown is never rejected 409
  empty_squad by the server.

### U9. Two cooldown countdowns disagree on screen
- Problem: RoomCard ticks 1s off room.cooldownUntil; Monitor renders
  run.cooldownSecs ONCE (static — observed 4m52s while the card read 3m39s).
- Change (Monitor.tsx): derive the cooldown line from room.cooldownUntil with the
  same 1s ticker (room prop refreshes via the rooms poll); drop run.cooldownSecs
  for display.
- Acceptance: both readouts agree (±1s) and both tick.

### U10. TM rewards render as raw ids («lrdst x14»)
- Problem: localizedItemName checks content.items/content.sis only; TM stacks live
  in content.tms (rewardVisual already checks tms — asymmetric).
- Change: resolve content.tms for kind==="tm" rows (and as a final fallback for
  any id found there).
- Acceptance: TM reward rows show the localized display name; raw id never renders
  for known content.

### U11. Rewards say nothing about where the loot went
- Problem: items silently land in the warehouse with a 7-day TTL; no hint, no link.
- Change (Monitor summary): under the rewards list add a one-liner + link to
  #/warehouse: EN "Sent to your warehouse — claim within 7 days before it rots."
  JA 「戦利品は倉庫へ送られました。7日で朽ちる前に回収しましょう。」 (new testid
  schedule-monitor-rewards-hint). The REQ-0100 rail complements this; keep both.
- Acceptance: hint renders with the rewards list and navigates to the warehouse.

### U12. Dev seed readout shown to every player
- Problem: monitor head prints «seed a9ff2445…» for everyone; the create-form
  seed FIELD is already gated to item_admin via /api/me.
- Change: SchedulePage already fetches /api/me -> pass isAdmin into Monitor; render
  the seed span only when isAdmin (same gate as the form field).
- Acceptance: plain guest sees no seed; item_admin still does.

### U13. JA terminology drift + unlocalized fragments
- Problem: (a) slots panel JA title 「ユニット」/「ユニット {n}」 contradicts
  REQ-0123 canon (Squad=スカッド owns the canvas; Unit=character piece) while the
  options say スカッド; (b) schedule.slots.noSquads JA says 「バックパックス画面」
  but the JA nav calls it 編成; (c) countdown format is EN-shaped in JA («3m 51s»);
  (d) monitor encounter/telegraph lines print raw sim tokens («boss»,
  «strike (top, ?)») in both locales.
- Change: (a) JA slots.title -> スカッド, slots.squadLabel -> スロット {n} (EN ->
  "Slot {n}"; grep e2e for label-text assertions first); (b) noSquads JA ->
  「スカッドがまだありません。先に編成画面で作成してください。」 (EN keeps
  Backpacks, the EN nav name); (c) formatCountdown takes locale -> JA 「3分51秒」
  (callers: RoomCard chip, Monitor cooldown line, nextRunIn); (d) add small i18n
  maps for the known encounter kinds (pack/boss/trap…) and telegraph
  skill/edge words emitted by sim/combat.cjs — unknown tokens fall back raw.
- Acceptance: JA screens show no スカッド/ユニット mislabel, no EN-format
  countdown, and localized kind/telegraph words for the vocabulary the sim emits
  today; EN unchanged except "Slot {n}".

### U14. Cancel is ambiguous and consequence-free
- Problem: red «Cancel/キャンセル» on every card; confirm asks «Cancel this
  room's schedule?» without stating permanence or the cancel-policy interplay.
- Change: confirm copy -> EN "This permanently disbands this expedition room —
  it cannot be reopened. (An in-flight run follows the room's cancel policy.)"
  JA 「この遠征ルームを解散します。元に戻せません。（進行中のランはこのルームの
  キャンセルポリシーに従います）」. Button labels unchanged (chrome-red styling
  already carries weight); testids unchanged.
- Acceptance: confirm shows the new copy in both locales; cancel still works.

### U15. Two identical «Collapse» buttons visible at once
- Problem: room card's toggle and the monitor's internal expand/collapse both
  label «Collapse/折りたたむ».
- Change: monitor's internal toggle gets its own keys: schedule.monitor.hideField
  EN "Hide monitor" / JA 「モニターを隠す」, schedule.monitor.showField EN "Show
  monitor" / JA 「モニターを表示」 (class/behavior unchanged). Card side follows
  U2 (Watch/Stop watching), so the collision disappears entirely.
- Acceptance: no two visible controls share a label on an expanded card.

## Out of scope here
- Monitor field rendering/freeze -> REQ-0169. Spoils rail -> REQ-0100. Cooldown
  ring -> REQ-0098 (untouched). Nav-wide aria labels -> REQ-0143.

## Test data (server, reusable)
- Guest ux-test-player p_029be4bca0b5, token in data/players; profile = e2e
  schedule fixture (re-seed by re-running storage.writeProfile with the fixture —
  NOTE the client auto-save overwrites the profile if a logged-in tab is left
  open; re-seed with tabs closed, then reload).

## Gates (before built)
- client: pnpm exec tsc --noEmit && pnpm exec eslint . && pnpm run build (or the
  repo's canonical script names — read client/package.json).
- server: repo's node --test suite (server/tests).
- e2e: pnpm run e2e (exclusive box lock; NEVER raw playwright) — full default
  suite green, including updated schedule specs.
- Manual browser pass of every acceptance line above, EN+JA, as a fresh guest.

## Record
- **Status**: built (gates green) 2026-07-14. Branch req-0168-schedule-ux-pass.
- **Commits**: 736cd7d (i18n copy + keys), d2bd6b4 (detail-pane components:
  SchedulePage/RoomCard/SlotsPanel/Monitor + errors.ts + lib/time.ts +
  WarehousePage + styles), 83ba3fb (U6 server + server tests + e2e), 2730fc0
  (dist rebuild), a339378 (U7 cross-room e2e).
- **Item status** (all DONE unless noted):
  - U1 create feedback: handleCreate consumes apiCreateRoom's {ok,room} ->
    close panel, select (watch) the new room, scroll it into view. done.
  - U2 whole-card clickable: RoomCard role="button"+onClick+keyboard, inner
    buttons stopPropagation; Watch/Stop watching labels (schedule.watch/
    unwatch); detail.empty -> "Pick a room...". done.
  - U3 noRooms copy ("...form above" / 上のフォーム). done.
  - U4 SlotsPanel auto-start sub-line + need-squads callout
    (testid schedule-slots-need-squads, link -> #/backpacks); awaitingRun copy. done.
  - U5 SchedulePage stable display sort (non-canceled createdAt DESC, canceled last). done.
  - U6 server same_room_duplicate vs deployed_overlap distinct reasons+messages;
    client errors.ts mapping + sameRoomDuplicate/crossRoomOverlap copy. done.
  - U7 SlotsPanel disables options deployed in another slot of THIS room or any
    slot of another ACTIVE room, "(deployed)" suffix. done.
  - U8 predicate parity: investigated -- see Deviation below. done (verified; no
    predicate change needed).
  - U9 Monitor cooldown derived from room.cooldownUntil with a 1s ticker. done.
  - U10 localizedItemName resolves content.tms (TM reward names). done.
  - U11 rewards-hint + #/warehouse link (testid schedule-monitor-rewards-hint). done.
  - U12 seed span gated to isAdmin (SchedulePage threads isAdmin). done.
  - U13 JA slots.title スカッド / squadLabel Slot|スロット / noSquads 編成;
    formatCountdown locale-aware (RoomCard+Monitor+lib/time+WarehousePage);
    encounter-kind + telegraph skill/edge i18n maps. done.
  - U14 cancelConfirm copy (permanence + cancel-policy note, both locales). done.
  - U15 monitor internal toggle -> hideField/showField keys. done.
- **U8 finding (deviation from spec hypothesis)**: the spec's premise ("server
  uses its own empty-squad rule; disagrees for a squad whose backpack exists but
  carries no items") is inaccurate against the code. The server deploy gate
  delegates to the SAME engine.isSquadDeployable predicate the client uses
  (mock-src/engine.js: bps.length >= 1), evaluated on the last-saved profile
  canvas; a squad WITH a backpack (bps.length>=1) is deployable on BOTH sides, so
  the empty_squad 409 can never fire for it. The predicates are identical and
  cannot structurally disagree on the same canvas (fixture confirms: store[4]=null
  -> both sides read {bps:[]} -> both refuse). The live 409 was a live-vs-persisted
  divergence: SlotsPanel reads the client's LIVE snapshot.state, the server reads
  the last debounced auto-SAVE -- a timing artifact, not a predicate mismatch.
  Acceptance ("a dropdown-enabled squad is never 409 empty_squad") already holds.
  Applied: SlotsPanel computes deployability once per render (deployableFlags,
  same predicate, deduped -- also the REQ-0169 M4 remedy). No client<->server
  predicate change was needed or made; recorded as the honest closest alternative.
- **U7<->U6 deviation**: U7 pre-disables a cross-room-deployed squad, so the old
  cross-room e2e UI flow (select the squad, read the friendly 409 message) is now
  unreachable by design. The e2e (schedule.spec.ts:665) now asserts the option is
  disabled + "(deployed)"; the server 409 + reason are still asserted via the API,
  and the friendly crossRoomOverlap message stays mapped in errors.ts as
  defense-in-depth for any path bypassing the disabled option.
- **Gates** (on the box, in the worktree):
  - `pnpm exec tsc --noEmit` (client): PASS.
  - `pnpm run lint` (oxlint, canonical): 0 errors, 34 pre-existing warnings.
  - `pnpm run build`: PASS (dist committed at 2730fc0).
  - server `node server/tests/api_test.cjs`: 157 passed / 0 failed (incl. both U6
    reason tests -- same_room_duplicate + deployed_overlap).
  - e2e `pnpm run e2e` (worktree recipe: E2E_STATIC_PORT=8901 serving this
    worktree's web/, E2E_PARALLEL fleet = this worktree's server): full suite run
    156 passed / 3 failed -- the 3 = 2 known CPU-render drag flakes
    (bp-transfer:164, reference-model:166) + schedule:665 needing the U7 update; a
    targeted E2E_GPU=1 rerun of those 4 spec files = 44 passed / 0 failed, all 3
    now green. Every default-suite test passes.
  - Manual EN+JA browser pass: deferred to orchestrator browser QA (this role does
    coding + automated gates only).


- **U9 follow-up (browser QA finding, 2026-07-14)**: orchestrator browser QA
  PASSED with one residual nit -- after canceling a room that is in cooldown, the
  Battle Monitor summary kept ticking its “Next run available in… / 次のランまで…”
  cooldown line, even though the room card had correctly dropped its own countdown
  chip on cancel. Monitor.tsx now mirrors RoomCard.deriveStatus: the cooldown /
  next-run readout is suppressed when status===‘canceled’ or cancelRequested
  (neither state will start another run). Fix commit ff84591 (“REQ-0168 U9
  follow-up: no next-run countdown on a canceled room”). data-testids unchanged;
  client has no unit specs for this line (0 client unit specs -- covered via e2e),
  so no test was added or changed.

- **Post-merge gate re-run (2026-07-14)**: `master` was merged INTO
  req-0168-schedule-ux-pass (merge commit 560699b). The ONLY conflicts were the
  web/app dist bundles + index.html (rename/rename + content); every source,
  doc and tool file auto-merged cleanly. Dist conflicts were resolved by
  REBUILDING the client (pnpm run build, emptyOutDir) rather than hand-merging
  bundles. Full re-gate on the merged head 560699b, all green:
  - `pnpm exec tsc --noEmit` (client): PASS.
  - `pnpm run lint` (oxlint, canonical): 0 errors, 34 pre-existing warnings.
  - `pnpm run build`: PASS; dist deterministic (a second build left git clean),
    committed with the merge at 560699b.
  - server `node server/tests/api_test.cjs`: 157 passed / 0 failed (1215 assertions).
  - e2e `pnpm run e2e` (worktree recipe: python http.server :8901 serving this
    worktree web/, local-proxy :8903, E2E_PARALLEL=4 fleet :8910-8913 = this
    worktree server, PLAYWRIGHT_BASE_URL=http://127.0.0.1:8903, E2E_GPU=1):
    159 passed / 0 failed (2.9m) in a SINGLE run -- no CPU-drag flake surfaced
    under GPU, so no targeted E2E_GPU=1 rerun was needed. Box lock acquired with
    no queue; the orchestrator QA instance (HOME=/tmp/bp_qa, :8899/:8902) was
    left untouched.

- 2026-07-14 merged to master (30b7105, --no-ff) and deployed: dist rebuilt+verified on master (tsc/build/server tests green), backpack-api restarted, live-verified on backpack-dev.qtie.jp (schedule page + spoils rail + monitor, EN/JA). Transient conflict-marker artifact seen once on live index.html during the merge window; served content re-verified clean (grep + DOM walk = 0 hits).
