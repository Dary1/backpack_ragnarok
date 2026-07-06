# REQ-0072 — Warehouse tab MJOLNIR re-skin

Branch: `req-0072-redesign-warehouse`. Fourth of the redesign series
(after REQ-0069 foundation, REQ-0070 canvas, REQ-0071 expedition). Mock
NORMATIVE for visuals: `web/redesign/warehouse.html` (+ styleguide/
ui.css, shared layer already in `client/src/theme/mjolnir.css`).

Scope: the `#/schedule` WAREHOUSE tab — row cards, expiry presentation,
capacity meter, claim affordances, claim-all. BEHAVIOR UNCHANGED
(REQ-0041/0042/0046 semantics): two-phase claim (POST claim → row
'claiming' → CLIENT engine first-fit → notifyStateChanged() auto-save →
server finalizes/deletes the row on the profile PUT), the REAL
InventoryBoard embedded via React portal (ONE Pixi Application — the
`board/inventorySlot.ts` mechanism, untouched), placement pulse ~2s /
cross-page tab-pulse fallback, soonest-to-expire ordering, staged
capacity warning, day-aware TTL countdown, 200-cap/7d-TTL, claim-all
walk order and its no-space stop condition.

## What landed (mock → delivered)

| Mock element | Delivered as |
| --- | --- |
| `.bgart` key art (`bg_warehouse.jpg`) | `.warehouse-bgart` — SchedulePage swaps it against `.expedition-bgart` when the warehouse tab is active (same served `/redesign/assets/` non-bundled convention). |
| `.pagehead` (kicker MUNINN'S HOARD / 宝物庫 / lede) + headline rune ᚷ | The REQ-0071 pagehead strip now switches identity with the active tab: `schedule.warehouse.pageSub/pageTitle/pageLede` keys (ja mock copy / EN natural), divider glyph ᚷ on the warehouse tab, ᚱ on rooms. Tabs stay in the strip (REQ-0071 placement). |
| `.topstrip` panel (capacity num + bar, warn chip, filters, 一括回収, strip note) | `.schedule-warehouse-topstrip` = `panel ornate` + knots. Capacity readout is the big den gold `{n}/200` (`schedule-warehouse-cap` testid kept) + 収蔵/CAPACITY labels; the bar is the theme `.bar` with gold fill. The REQ-0046 staged classes are KEPT (`schedule-warehouse-capacity-calm/warning/full` + warning-text testid): calm=mock gold, warning=ember, full=blood — 'full' is still the real data-loss state (server drops new rewards at cap). |
| `⚠ 3品が期限まぢか` warn chip | `.chip.warn` (mock rule ported) + `schedule-warehouse-warnchip` testid — REAL count of rows within 48h of expiry; hidden at zero. |
| Filter chips すべて/武具/霜/焔/通貨 | Delivered as すべて/戦利品/通貨 (all/spoils/currency) — `kind:'tm'` vs everything else is the only category split a warehouse row actually carries. 武具/霜/焔 omitted: item defs do have `tags`, but the live set has no frost/ember taxonomy (`Flame` appears once, `Frost` never) and rows don't carry element data — a tag-based filter would be fiction for most rows. Display-only: counts and claim-all always use the full list. |
| `ᚷ 一括回収` forge CTA | The existing claim-all (`schedule-claim-all-btn` testid kept) restyled as the screen's one `btn-forge`, with the ᚷ rune. Same sequential soonest-first walk, same no-space stop. |
| DECAYING SOON section (red colhead + `.wgrid.two` danger cards) | Rows with <48h remaining split out above the shelf (`schedule-warehouse-danger-head/-grid`), cards get `.is-danger` (red inset + red thumb border + red TTL text/ring). Threshold chosen from the mock's own examples (期限 2日 / 期限 1日); supersedes the REQ-0046 24h "warm label" (same intent, made spatial — class name `schedule-warehouse-item-expiry-soon` kept). |
| `.shelf` stone panel + 収蔵の棚 colhead + `8種 187点 ・ 新着 1` | `.schedule-warehouse-shelf` = `panel ornate` + `tex_stone.jpg` (served asset) blend. Tally is REAL: kinds = distinct itemIds, pieces = Σ qty (TM stacks count their qty), 新着 = rows harvested <24h ago. |
| `.wcard` anatomy (rarity frame + gem, 64px thumb + `.qcnt`, dj name, sub line, `.src` chip) | `.schedule-warehouse-row` (article, testid + data-item-uid kept) wears theme `.rar rar-*` + `.gem`; app ramp maps Common/Uncommon/Rare→same, **Relic→`rar-legend`** (REQ-0070's mapping). Thumb = `iconDataUrl` sprite in a 64px night-iron well, stack count in the corner for qty>1. Sub line = rarity word ・ ×qty ・ expiry (CSS interpuncts). |
| `出所:` provenance chip | REAL origin joins only: `sourceRoomId` → the player's own room (rooms list SchedulePage already polls) → dungeon display name; `sourceListingId` (market settlement rows — buyer delivery + seller TM proceeds, `server/services/market.cjs`) → gold-etched 「出所: 市場」chip + the mock's Muninn micro-line. Rows with neither (dev grants) get NO chip — nothing is invented. |
| Jörmungandr TTL ring (`.cring`, % + arc + dot) | `TtlRing` SVG (`.schedule-warehouse-ring`), geometry copied from the mock (pathLength 100 arc, end-dot by sin/cos). The pct is the row's remaining share of its OWN `expiresAt−harvestedAt` span — no 7d literal baked in; red ramp when in the danger window. Localized `<title>`/aria-label. |
| `NEW` badge / 今夜搬入 | `.schedule-warehouse-badge-new` on rows harvested <24h ago (no "seen" tracking exists; harvestedAt is the only honest recency signal — documented inference). |
| `回収` button / `.placing` 配置中… | Claim button (testid kept) = theme `.btn` at the mock `.sm` scale over the REQ-0071 green tint. While THIS row's claim is in flight it wears the mock's `.placing` green pulse with copy 配置中…/Placing… |
| Footer lore + first-fit micro | `.schedule-warehouse-foot` — the micro line states REAL behavior (client first-fit into pack pages; a no-space row stays and keeps expiring). |
| TM row 「通貨アイテム ×12」 | kind:'tm' rows resolve their real `content.tms` display name now (the old lookup missed the tms map and showed the raw id), show the gold 通貨 word + stack qty. |

## Omitted / diverged (no backing data — "UI is truth")

- **「通貨 — 朽ちない」(currency doesn't decay)**: FALSE for real data —
  TM rows (grants AND market proceeds) carry the same 7d `expiresAt` as
  every row (`server/services/warehouse.cjs` grantTmQty,
  `services/market.cjs` proceeds row). TM rows therefore render the SAME
  TTL ring/expiry as item rows. Divergence from the mock, in the data's
  favor.
- **Seller attribution 「市場 — 灰狼のヴィズより」**: a market row
  carries only `sourceListingId`; no seller display name is on the row
  and resolving it would need a per-row listing lookup (and listings
  expose `sellerId`, not a name). Chip says 市場/Market only.
- **`sourceListingId` typing**: consumed via a client-local
  `WarehouseRow = ApiWarehouseItem & { sourceListingId?: string|null }`
  extension instead of editing `shared/dto.ts` — the market lane owns
  that file's market section (parallel-lane conflict avoidance); it can
  fold the field into the DTO properly when it lands.
- **武具/霜/焔 filters**: see the filters row above — no stable
  weapon/element taxonomy on rows or (in practice) items.
- **「出所: … ・ ボス」**: reward rows don't record which encounter
  dropped them.
- **HUD chips (TM balance 1,284 / season / ムニン搬入 4件)**: global
  chrome = REQ-0069's stance (REQ-0071 took the same omission). The
  shelf colhead's 新着 count carries the delivery-recency signal
  instead.
- **`placing` copy 「配置中… 編成の間で確定」**: shortened to 配置中…/
  Placing… — the mock's "finalize in the formation hall" tail is wrong
  for this app: the REAL board is embedded right below and placement
  finalizes via auto-save with no user step (REQ-0041 §two-phase).
- **Snow particles / grain / vignette**: not opted in — the tab hosts
  the live InventoryBoard WebGL canvas (same compositing-cost stance as
  REQ-0070/0071).
- **Harvested timestamp line**: the mock's sub line drops it; kept as
  the row's `title` tooltip (`schedule.warehouse.harvested`) rather than
  deleted.
- **Raven art**: placeholder asset, already omitted by REQ-0071's
  pagehead.

## Embedded board note

The mock's warehouse page has NO inventory board — but the board embed
is REQ-0041 architecture (claims place into the LIVE engine state and
must be visible/operable where they land, one Pixi app total). It stays,
below the shelf: the portal target div (`schedule-warehouse-board-slot`
testid) is untouched; App.tsx's InventoryColumn (Tabs + InventoryBoard +
title) renders into it exactly as before.

## Selector contract

Kept verbatim (E2E load-bearing): `.schedule-tab`(-active),
`[data-testid="schedule-warehouse-row"][data-item-uid]`,
`schedule-claim-btn-<uid>` (+ `.schedule-claim-btn`),
`schedule-warehouse-toast`, `schedule-claim-all-btn`,
`schedule-warehouse-cap`, `schedule-warehouse-capacity-bar` (+
`-calm/-warning/-full` classes), `schedule-warehouse-capacity-warning`
(+ `.warning/.full`), `.schedule-slot-error` (inside the row),
`schedule-warehouse-board-slot`, `.tab-claim-pulse`,
`.schedule-empty/.schedule-loading/.schedule-error`.

Retired (DOM no longer renders them; no spec used them):
`.schedule-warehouse-header(-top)`, `.schedule-warehouse-item-harvested`
(now a title attr), the icon frame's `rarity-frame-r-*` variant classes
and `.schedule-warehouse-row-stack`'s dashed-frame styling (rarity now
lives on the card frame via theme `.rar-*`; `-row-stack` class itself
still applied). `schedule.warehouse.cap` i18n key retired (readout is
now numeric spans).

New hooks (not load-bearing for old specs):
`schedule-warehouse-topstrip`, `schedule-warehouse-warnchip`,
`schedule-warehouse-filter-all/spoils/currency`,
`schedule-warehouse-danger-head/-grid`, `schedule-warehouse-shelf`,
`schedule-warehouse-shelf-count`, `schedule-warehouse-badge-new`,
`schedule-warehouse-src`, classes `.warehouse-bgart`,
`.schedule-warehouse-ring`, `.schedule-claim-btn.placing`,
`.schedule-warehouse-row.is-danger`.

New spec: `client/e2e/warehouse-mjolnir.spec.ts` — (1) real-backend
(dev-grant) single claim on the new chrome: pagehead swap, ornate
topstrip, shelf card anatomy (rar frame/gem/thumb/ring/NEW), embedded
board canvas, claim → toast → auto-save finalization; (2) claim-all via
the forge CTA empties both granted rows into the canvas; (3)+(4)
mocked-payload presentation states: 70% → warning stage + DECAYING SOON
split + warn chip count, 200/200 → full stage + TM/market row marks +
kind filter narrowing. Assertion intent mirrors schedule.spec.ts's
REQ-0041 describe on the same selectors.

## i18n

New keys (EN natural / ja mock copy), all `schedule.warehouse.*`:
`pageSub pageTitle pageLede capWord capDen expiryWarnChip stripNote
filterAll filterSpoils filterCurrency dangerTitle dangerDen dangerNote
shelfTitle shelfDen shelfCount shelfFresh shelfFiltered badgeNew
srcDungeon srcMarket srcMarketNote currencyWord ringTitle footLore
footNote`. Changed: `claimButton` ja 回収, `claimAllButton` ja 一括回収,
`claimingAll` ja 一括回収中…, `claiming` 配置中…/Placing….

## Gate notes (final run)

- engine 97/97; server api 118/118 on BOTH backends (files + pg);
  E2E **104 passed / 3 failed of 107** (103 old + 4 new). The 3:
  / (the accepted REQ-0043 baseline pair)
  and  — the latter is NOT a REQ-0072 regression:
  it is API-only up to its failing assert (never loads the client),
  fails identically in isolation without this branch's specs, and a raw
  HTTP repro (create room → assign → backdate → settle) shows the run
  ending  with  at t=0 → no
  reward accrual by design. Deterministic on the current box; the box's
  live content is also being edited concurrently (art session appended
   to every live item mid-day).
  Left for a sim/server lane to bisect.
- E2E hygiene finding (fixed in this REQ's own spec, worth copying
  back into older specs eventually): the suite-wide "backup/restore
   around a dev-player test" pattern is a
  SILENT NO-OP under  — the profile lives in
  Postgres, so whatever doc a test PUT last simply LEAKS to the next
  spec. If the leaked doc is the raw schedule fixture, its preset-store
  BPs are unrepaired references that the next booted client homes into
  inventory pages on its first auto-save — observed as
   counting 10 phantom "new" BPs (trace-verified
  network bodies). warehouse-mjolnir.spec.ts therefore restores the dev
  canvas by re-PUT-ing the original doc through the API (and its
  mocked-payload tests do not write a profile at all).

## REQ-0073/0074 heads-up (dex/workshop can reuse)

- `.chip.warn` is now in index.css (mock styleguide chip variant).
- The `rarThemeClass()` app-ramp→theme-`.rar-*` mapping (Relic→legend)
  and the `TtlRing` arc/dot geometry live in WarehouseTab.tsx — lift
  them if a page needs rarity frames or progress rings.
- Per-tab pagehead identity swap on a shared route shell (SchedulePage
  pattern) works cleanly; keep it in mind for any multi-tab page.
- The stone-shelf `panel ornate` + served-texture blend
  (`.schedule-warehouse-shelf`) is the generic "textured panel" recipe.
