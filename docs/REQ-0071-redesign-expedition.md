# REQ-0071 — Expedition/Schedule screen MJOLNIR re-skin

Branch: `req-0071-redesign-expedition`. Third of the redesign series
(after REQ-0069 foundation + REQ-0070 canvas). Mock NORMATIVE for
visuals: `web/redesign/expedition.html` (+ styleguide/ui.css, whose
shared layer already lives in `client/src/theme/mjolnir.css`).

Scope: the `#/schedule` ROOMS view — room/slot cards, create panel,
monitor framing (small strip + expanded dual-plane playback), status
colors, countdown/clock, cancel flow, hide-canceled toggle. BEHAVIOR
UNCHANGED (REQ-0036/0041/0045/0046 semantics): deploy gates, wall-clock
replay pacing, lazy settlement, swap-after-run, cancel policies, run LOG
tab, rewards list. The Warehouse tab EXISTS on this page but its restyle
is REQ-0072's unit — it only picks up the shared chrome noted below.

## What landed (mock → delivered)

| Mock element | Delivered as |
| --- | --- |
| `.bgart` key art (`bg_expedition.jpg`) | `.expedition-bgart` inside `.schedule-page` — referenced from the served `/redesign/assets/` path, never bundled (REQ-0070's `.canvas-bgart` convention; the ONLY mock image asset that is not a placeholder). |
| `.pagehead` strip | `.schedule-pagehead`: den kicker (ja `EXPEDITION`; empty for EN, same skip convention as `app.canvasSub`), `dj dj-wide` hall title (ja `遠征の間` / EN `Expeditions`), lede (ja mock copy adapted to present tense — honest: runs really do progress on the wall clock while away, that is lazy settlement). Rooms/Warehouse tabs moved into this strip's right edge. |
| `.rune-divider` headline (ᚱ) | Same theme primitive under the pagehead. |
| `.colhead` `遠征房 2/3 稼働` | `.schedule-colhead` — REAL counts (`running` = rooms with status `active`, `total` = non-canceled rooms). |
| `.room` cards (panel ornate + knots) | `RoomCard.tsx` → `article.panel.ornate.schedule-room-card` + 4 gold knots. Expanded card gets `.schedule-room-card-open` (mock `.is-sel` focus ring) and spans the grid's full row. |
| `.emb` circular emblem images | Emblem DISC kept, mock's `emblem_*.png` art is placeholder → the disc renders the dungeon display name's first glyph (real data). |
| `.r-name` + `.lv` | Dungeon display name (dj) + level in gold den. Meta line: generation-type display name (`ApiRoom.dungeonType` joined against the dungeons payload `types` list) + createdAt. |
| `.r-status` chips (`交戦中 03:12` / `帰還 00:41`) | Status chip per derived status (unchanged derivation): idle=gold, cooldown=frost, running=live ember dot, cancelPending=blood, canceled=muted+desaturated card (mock `.locked` treatment). Cooldown countdown renders as its own frost chip beside the badge (`schedule-room-countdown`, same 1s ticker). The `交戦中`-chip elapsed time is NOT shown at card level (rooms list doesn't poll the run endpoint; the monitor's clock covers it). |
| `.slots` 壱/弐/参/肆 preview grid | `.schedule-room-slots` 2×2 chips on every card — numerals via i18n (EN: I/II/III/IV), filled slots resolve `presetIndex` → the player's own preset names (same store snapshot SlotsPanel reads), empty slots dashed `─空き─`. |
| `新しき遠征を組む +` button | The existing create-panel toggle (`.schedule-create-toggle-btn`, testid unchanged) now rides the theme `.btn` with the mock copy (`schedule.createToggle`). Create panel = `panel ornate` + knots; form fields restyled night-iron (den labels, gold focus ring). |
| `.mon-panel` monitor | `Monitor.tsx` root wears `panel ornate`; new `m-head` strip: `戦況監視 — <dungeon name>` + LIVE chip while the run's clock is unsettled + `seed <genSeed>` (REAL — `ApiRoom.genSeed` always exists on post-REQ-0043 rooms; hidden for legacy rooms). |
| `.ctrl` iron bar | Rendered under the Field canvas: rivets, wall-clock readout `elapsed / duration` (mm:ss from `clock.elapsedSecs` / `durationSecs`), timeline whose fill is the same progress pct as the summary bar, and one diamond pip per `encounter_start` event at its own `t/durationSecs` position (real events). |
| `.log` + `.logbar` | The existing LOG tab (REQ-0045 g) restyled (dark pre, iron copy button); logbar caption shows the REAL event count (`ムニンの記録 ・ 全N件`). |
| Spoils toasts (right column) | The settled summary's rewards list restyled as small item cards: icon thumb via the same `iconDataUrl` lookup WarehouseTab uses + rarity-tinted name (`.rarity.r-*`). List, not a cycling toast — the summary is a settled ledger, not a live feed. |
| Status colors / focus | MJOLNIR ramp throughout (gold/frost/ember/blood + `--focus-ring`). |

## Omitted (no backing data / out of scope) — all recorded here per the "UI is truth" rule

- **Muninn NIGHT REPORT headline, raven art, night arc (22:40→06:10)**:
  no sleep-session tracking exists anywhere in the data model; the arc
  would be fiction. The pagehead keeps the hall identity instead. The
  raven.png is also a placeholder asset.
- **Playback controls (pause ⏸ / 1×/2×/4× / 結末まで飛ぶ)**: replay
  pacing is SERVER wall-clock (REQ-0045's spectator contract — a client
  may never see past the run clock), so pausing/fast-forward/skip have
  no honest implementation. The ctrl bar carries the real clock +
  timeline instead.
- **Log filter chips (すべて/損害/戦利品)**: loot never appears in the
  run event stream (rewards are warehouse rows), so the 戦利品 filter
  has no data; a damage-only filter alone wasn't worth diverging the
  log-text contract the E2E suite asserts on. Omitted.
- **Lap counter / reward multiplier footer (`周回 2/3 ・ 報酬倍率 ×1.2`)**:
  no lap-count or reward-multiplier concept exists on rooms/runs. The
  card footer carries the room id + actions instead.
- **Jörmungandr cooldown ring (`蛇環 68%`)**: `ApiRoom` has
  `cooldownUntil` but not the cooldown's total duration, so a
  percentage can't be derived at card level; the textual countdown chip
  covers the state.
- **Locked/未踏 room card (`隊商 Lv.15 で開放`)**: no room-unlock or
  caravan-level concept exists.
- **Right column warehouse mini-panel (capacity, 回収/一括回収, expiry
  chips) and NIGHT TALLY slab (踏破/討伐/被弾/献身)**: the warehouse
  lives in this page's Warehouse TAB (REQ-0072 owns its restyle);
  duplicating claim flows on the rooms view would fork that unit. The
  tally aggregates (kills/damage-taken/devotion %) have no per-night
  aggregate in the data model.
- **HUD chips (`出撃中 ×2` / currency / season)**: the HUD header is
  global chrome (REQ-0069); the rooms colhead carries the live
  room-count readout instead.
- **`.grain`/`.vignette` + snow particles**: not opted in, same
  compositing-cost stance REQ-0070 took for pages hosting live WebGL
  surfaces (the monitor is a Pixi canvas).

## Layout note (mock 3-column vs delivered)

The mock is a master/detail: room cards left, ONE shared monitor center,
spoils right. The app's Monitor is nested INSIDE its room card (one
renderer per room, mounted once on first expand — the REQ-0036/0045 Pixi
lifecycle; the E2E suite also asserts monitor visibility *within* the
card locator). Moving it to a shared center column would mean
destroy/recreate or portal gymnastics for zero behavior gain, so the
delivered layout is: responsive card grid (`minmax(300px,1fr)` — mock
card width) where the expanded card spans the full row and hosts the
mock's mon-panel. Same visual language, honest structure.

## Shared chrome the Warehouse tab picked up for free (REQ-0072 heads-up)

- `.schedule-tab` / `.schedule-tab-active` (chip tabs, now in the
  pagehead strip), `.schedule-loading/.schedule-empty/.schedule-error`
  tones, `.schedule-toast` (night-iron + gold), `.schedule-claim-btn`
  (iron button, green-tinted), `.schedule-slot-error` (blood tone).
- Everything else inside `WarehouseTab.tsx` (header/cap bar/rows/board
  slot) is untouched and still old-styled — REQ-0072's unit. Its
  selectors (`schedule-warehouse-*`, `schedule-claim-btn-<uid>`) are all
  intact.
- The page shell it inherits: `.schedule-page` is now full-width
  (max-width 900px removed) with the expedition key art behind — the
  warehouse tab renders over the same backdrop.

## Selector contract

No E2E-used selector changed. Kept verbatim: `.schedule-page`,
`.schedule-tab`(-active), `.schedule-slot-error`,
`.schedule-monitor-expand-btn`, `.schedule-claim-btn`, and every
`data-testid` in `schedule.spec.ts` / `nav-routing.spec.ts` /
`workshop.spec.ts`. New hooks added (not yet load-bearing for old
specs): `data-testid="schedule-room-slot-chip-N"` (card slot preview),
`data-testid="schedule-monitor-live-chip"`,
`data-testid="schedule-monitor-clock"`, classes
`.schedule-room-card-open`, `.schedule-monitor-head`.

New spec: `client/e2e/schedule-mjolnir.spec.ts` — (1) MJOLNIR chrome
renders on the rooms view (pagehead/colhead/ornate create panel/ornate
room card + slot preview + chip badge + monitor placeholder), (2)
create → deploy one unit → cancel via the inline confirm → the
hide-canceled default collapses the card, unchecking reveals it with
the canceled treatment. Assertion intent mirrors the existing suite on
the same selectors.

## i18n

New `t()` keys (EN natural / ja mock copy): `schedule.pageTitle`,
`schedule.pageSub`, `schedule.pageLede`, `schedule.roomsDen`,
`schedule.roomsActive`, `schedule.createToggle`,
`schedule.room.slotEmpty`, `schedule.room.ord1..4`,
`schedule.room.watching`, `schedule.monitor.title`,
`schedule.monitor.live`, `schedule.monitor.seed`,
`schedule.monitor.logCaption`.
