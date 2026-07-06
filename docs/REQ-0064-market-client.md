# REQ-0064 — Market screen (交易の火床 / Hearth of Barter)

Branch: `req-0064-market-client`. Client pane for the ALREADY-MERGED,
already-deployed market backend (REQ-0064 backend: `server/market.cjs`,
`server/routes/market.cjs`, `server/services/market.cjs`, migration
`004_market.sql`, DTOs `ApiMarket*` in `shared/dto.ts`). This REQ is
CLIENT-ONLY: no server code, content, or DTO was touched. The live
`#/market` route previously rendered a generic `<PlaceholderPage>`; it now
renders the real screen.

Mock NORMATIVE for visuals: `web/redesign/market.html` (+ styleguide /
`ui.css`, shared layer already in `client/src/theme/mjolnir.css`). Backend
NORMATIVE for behavior: the route surface + `services/market.cjs` business
rules (409 vocabulary, burn math, eligibility, TTL, suspension).

## What landed (three panes → mock)

New directory `client/src/market/` (one-dir-per-page, sibling to
`client/src/landing/`):

| File | Role |
| --- | --- |
| `MarketPage.tsx` | Route component. Tab state (buy/sell/mine), initial fetch (browse + mine + furnace), the balance read, the MINE refetch-on-focus, and THE RACE GUARD (`refreshAfterServerMutation`). |
| `BuyPane.tsx` | 買う: content-bound filter chips + Dex-No/name search + listing cards; suspended cards lock + disable buy; short-of-ᚠ cards disabled with the shortfall note. |
| `BuyModal.tsx` | 購入の誓い: breakdown table (pay/burn-8%/seller-receives) + post-pay projection, then confirm → settle. Every 409 gets its mock-designed body (取引成立 / 一足遅かった / 倉庫満杯 / ᚠ不足 / suspended / generic). |
| `SellPane.tsx` | 出品する: picker over the player's own inventory POs + integer stepper (min 1, cap ᚠ999) + LIVE client-side receipt estimate + the item's recent settled-price anchor; ineligible rows shown LOCKED (not hidden). |
| `MinePane.tsx` | 自分の出品: rows with age / projected burn-receive / state chip / withdraw button. Fresh GET on focus. |
| `marketShared.tsx` | Burn math (client mirror), item-def resolution off the content map, and the ONE `MarketThumb` (delegates to `dex/ShapeGrid` + `render/itemCard` — no third render path). |
| `marketErrors.ts` | Maps the service's structured `ApiError.reason` vocabulary → i18n key (the mock's voice, never a raw code). |

Wired into `client/src/App.tsx` (`route === 'market'` → `<MarketPage>`; the
import sits beside `WorkshopPage`). `Nav.tsx` already highlighted `market`
generically (rune ᚠ, route present since REQ-0069) — verified, unchanged.

API surface added to `client/src/api.ts` (matches `shared/dto.ts` exactly):
`fetchMarketListings({filter?,q?})`, `createMarketListing`,
`withdrawMarketListing`, `buyMarketListing`, `fetchMarketFurnace`, plus a
`newIdemKey()` (first client use of the OPTIONAL `Idempotency-Key` header —
`crypto.randomUUID()` with a timestamp fallback; every mutation sends one).

### Pane → mock mapping

- **BUY.** `.pagehead`/three-laws/`.mtabs` ported. Listing cards are the
  mock's `.mcard` anatomy: rarity frame + gem, 64px `MarketThumb` well,
  dj name + Dex-No chip, `PO ・ WxH ・ tags RARITY` sub, `売り手:` + name
  (plain text — no profile link, matching the mock's explicit "v1 has no
  profile concept, don't build a false door"), price row with the FROZEN
  burn breakdown line `支払N → 焼却n ・ 相手受取m`. Suspended → `.lockchip`
  + disabled buy. Can't-afford → disabled buy + `ᚠ不足(あとN)` note (burn
  still shown: transparency before the oath).
- **SELL.** Two-panel `.sell-grid`: 手持ちから選ぶ (inventory POs) + 値を刻む
  (stepper + estimate). The estimate recomputes `max(1,ceil(qty*0.08))`
  client-side as the stepper moves. Ineligible items are shown LOCKED with
  the mock's `配備中 — 出品不可` / already-listed word — see inference below.
- **MINE.** `.lrow` rows with the mock's state vocabulary (`.stchip
  .pause/.exp/.setl`), CALM TTL copy (`あとN日で炉棚から下がる`, no red/
  countdown), withdraw button on active/suspended. Refetched fresh on
  every focus of the tab (state drifts server-side).
- **Footer.** `GET /api/market/furnace` total with the FROZEN lore
  (`今季、炉は ᚠN を焼いた — 灰に持ち主はいない。`), season-aware copy when
  the furnace response carries a season, all-time copy otherwise.

## THE race condition — how it is solved

Buying (and any settle) debits/credits the player's TM balance
SERVER-side, directly in the DB, while this client holds an in-memory
canvas whose debounced auto-save (`store/autosave.ts`, ~800ms) would
otherwise PUT a STALE pre-trade balance back over the server's correct
debit — silently resurrecting spent currency (the REQ-0041 auto-save race
class, called out verbatim in `shared/dto.ts`'s `ApiMarketBuyResponse`
doc).

**Solution — `MarketPage.refreshAfterServerMutation()`:** after any
server-side balance/settle mutation it calls the store's **`loadGame()`**
FIRST (before offering the modal's close, before any pending auto-save can
fire), which re-GETs the fresh (already-debited) canvas and replaces
`state`'s OWN fields in place, THEN bumps `stateVersion` via
`notifyStateChanged()` — so any pending/next auto-save now PUTs the CORRECT
post-trade balance. Only after `loadGame()` resolves does the modal reveal
its 取引成立 body. It then refetches browse + mine + furnace.

This is the SAME reconciliation mechanism the rest of the app uses for
server-authoritative canvas changes (the store's own `loadGame()`, used by
the Header's manual reload). We deliberately use `loadGame()` (a PULL)
rather than a bare `notifyStateChanged()` (a PUSH): WorkshopPage debits
LRDST *client-side first* and pushes, but a market buy debits *server-side*
— the authoritative new balance lives on the server, so we must pull it,
not push our stale copy. `refreshAfterServerMutation` is also wired to the
SELL "list it" and MINE "withdraw" paths (listing/withdrawal don't move the
balance, but re-pulling keeps the canvas and every listing view coherent).

Called from: `BuyModal.onSettled` (on 200 AND, fire-and-forget, on a 409 so
the grid reflects a listing that just flipped to settled), `SellPane`
`onListed`, `MinePane` `onWithdrawn`.

## Inferences & omissions (each with its one-line rationale)

- **Deployed-item locking is server-answered, not client-derived.** The
  mock shows deployed inventory items LOCKED ("配備中 — 出品不可"), not
  hidden. But the authoritative "deployed uid" set lives SERVER-side
  (`deployedUidSet` scans the player's open/active ROOMS + assigned preset
  slots — `services/market.cjs`), and this client does NOT load room/
  schedule state on the market page. Reimplementing that scan here would
  drift from the server and is genuinely not exposed. So the SELL picker
  lists every inventory PO as attemptable; when the server 409s `deployed`,
  that specific card is locked with the mock's word (`deployedUids` set) —
  honest ("reflect the server's answer, don't fake a local transition I
  can't confirm", per the spec's own edge-case guidance). Items the player
  has ALREADY listed (active/suspended, from `filter=mine`) are grayed with
  an "already on the hearth" lock pre-emptively, since that state IS known
  client-side.
- **Sell-pane recent-settled anchor (図鑑の直近刻銘).** `priceHistory` IS
  exposed on `ApiMarketListing` (rolling last-5 settled, newest first), but
  only on LISTING objects — an unlisted inventory item has no listing to
  read. Derived instead by scanning all known listings (browse + mine) for
  one of the same `itemId` and reading its `priceHistory[0].qty`. When no
  such history exists anywhere (item never settled), this one sub-element
  empty-states ("図鑑にまだ刻銘は無い") and the rest of the pane proceeds —
  exactly the spec's fallback for this element.
- **Dex-No in the sell pane** is read off any known listing of the same
  itemId (the DTO carries `dexNo`); null → `No.—`. The BUY/browse cards get
  `dexNo` directly from their own DTO.
- **Filter chips are content-bound, not hardcoded.** The mock's fixed chip
  labels (すべて/武具/霜/焔/連結/遺宝) map to real content tag/rarity VALUES
  (`weapon`/`frost`/`ember`/`linker`/`relic`), compared lowercased against
  each listing's `tags[]`/`rarity` EXACTLY as the server's `matchesFilter`
  does. A chip is only rendered when ≥1 live listing actually carries its
  value, so the row reflects the real hearth (never a chip that filters to
  nothing). The BUY grid filters client-side (all active+suspended are
  already loaded) for instant chip response, mirroring the mock's client-
  only chip toggle; the same values are valid `?filter=` params server-side
  if ever needed. NOTE: the specific tag strings (`weapon`, `frost`, …) are
  a best-effort guess at the content taxonomy — the live item defs' actual
  `tags[]` vocabulary drives what shows, so a chip whose value no item
  carries simply never appears (no fiction). If the real taxonomy differs,
  only the chip LABELS' mapping needs adjusting, not the mechanism.
- **Currency name.** Wire id stays `'lrdst'` (the market's one TM). The
  UI-facing name follows the MOCK for this page — the ᚠ rune glyph +
  "通貨アイテム / Currency-things" (the mock's own registry), rather than
  Workshop's raw "LRDST" label, because the mock is normative for this
  screen's visuals and never shows the string "LRDST".
- **Balance shown** is the cross-page sum of `lrdst` TM stacks in the
  player's inventory — the SAME "can I afford this" number WorkshopPage
  shows. The actual settle debit is server-side; this display stays correct
  after each buy via the `loadGame()` refresh.
- **DESIGN-DEMO chrome (骨組み/空/成立-switcher) NOT ported.** Those are the
  mock's designer affordances ("設計確認用の意匠。製品UIではない"), not
  product UI. The real states are data-driven: a genuine empty result set
  renders the mock's empty-block; loading renders a quiet text line (the
  mock's skeleton is optional/perf-gated — see below).
- **Particle embers (`fx.js`) NOT added** — perf-gated and the sibling
  ported pages (REQ-0069/0070/0071/0072) did not add theirs either; not
  paying a cost the rest of the app doesn't.
- **Buy modal's static "先着負け" also covers `not_active`/`expired`/
  `item_gone`** (all "the goods already departed / this is no longer
  active" outcomes) — the mock designed one race panel; these share its
  voice. `insufficient_balance`→ᚠ不足 panel, `warehouse_full`→倉庫満杯
  panel, `suspended`→a dedicated "beyond trade for now" panel, everything
  else→a generic in-voice line.

## Selector contract (data-testid scheme — established fresh)

No prior market E2E existed; this scheme is new but follows the house
convention (kebab feature-prefixed, uid/id-suffixed for row-scoped
handles), same shape as `warehouse-mjolnir.spec.ts`'s selectors:

- Page/tabs: `market-page`, `market-tab-buy|sell|mine`, `market-mine-badge`,
  `market-loading`, `market-error`.
- Buy: `market-pane-buy`, `market-grid`, `market-listing-row`
  (+`data-listing-id`/`data-item-uid`/`data-state`), `market-dexno`,
  `market-buy-btn-<itemUid>`, `market-lock-chip`, `market-chips`,
  `market-chip-<key>`, `market-search`, `market-buy-count`,
  `market-buy-empty`.
- Buy modal: `market-buy-modal`, `market-buy-body-form|done|race|full|poor|
  suspended|generic`, `market-buy-confirm`, `market-buy-cancel`,
  `market-buy-done-close`, `market-buy-fail-close`.
- Sell: `market-pane-sell`, `market-sell-item` (+`data-item-uid`/
  `data-locked`), `market-sell-lockword`, `market-carve-name`,
  `market-carve-anchor`, `market-price-input|down|up`, `market-est-pay|
  burn|get`, `market-cap-note`, `market-list-btn`, `market-sell-toast`,
  `market-sell-error`, `market-sell-empty`.
- Mine: `market-pane-mine`, `market-mine-panel`, `market-mine-row`
  (+`data-listing-id`/`data-state`), `market-state-chip`,
  `market-withdraw-btn-<id>`, `market-mine-empty`, `market-mine-error`.
- Footer: `market-furnace`.

## E2E status — WRITTEN, NOT YET LIVE-EXECUTED

`client/e2e/market.spec.ts` (8 tests) covers: browse + Dex-No deep-link +
name substring; buy happy path (asserts the balance debits server-side AND
the item lands in the buyer's warehouse, both read back via the API — the
proof the race guard held); buy 409 `self_buy` (disabled button + API 409);
buy 409 `insufficient_balance` (short-gated card + API 409); sell happy
path (live estimate + stepper + listing appears under Mine); sell deployed-
item LOCK (shown, not hidden); mine withdraw (free — furnace total
unchanged — and the row leaves browse); furnace footer renders the API's
own total + lore.

Data strategy mirrors the siblings exactly: a second REAL player (the
SELLER) is minted over SSH via the operator CLI `server/cli_invite.cjs`
(byte-for-byte `guest-auth.spec.ts`'s helper), whose token seeds real
listings through the market HTTP API; the BUYER is the dev_mode fallback
player, seeded via a profile PUT; `withDevProfileBackup`-style pg-aware
restore + `POST /api/warehouse/dev/clear-debris` teardown (same as
`warehouse-mjolnir.spec.ts`). Reuses `bootApp`/`waitForAutoSave` from
`e2e/helpers.ts` (not reimplemented).

It has **NOT been executed against a live deploy**: the Playwright
`baseURL` is the shared live site `https://backpack-dev.qtie.jp`, which the
MAIN checkout owns and this worktree must not deploy to. Every selector and
assertion was hand-traced against the actual implementation (a dex-style
dry run), and `npx playwright test --list e2e/market.spec.ts` parses/loads
all 8 tests cleanly (esbuild transpile OK, no syntax/import errors). The
orchestrator runs it for real immediately after the deploy step.

## Gate results (this worktree, `req-0064-market-client`)

- `node mock-src/tests/run.cjs` → **97 passed, 0 failed** (engine untouched).
- `node server/tests/api_test.cjs` (files) → **134 passed, 0 failed**.
- `set -a; source server/.env; set +a; STORAGE_BACKEND=pg node
  server/tests/api_test.cjs` → **134 passed, 0 failed** (server code
  untouched; proven under both backends).
- `cd client && npx tsc -b` → **clean**.
- `cd client && npm run build` → **clean** (785 modules; dist emitted to
  `web/app/`; pre-existing >500 kB chunk-size advisory only).
- `cd client && npm run check:sprites` → **22/22** non-blank.
- `npx playwright test --list e2e/market.spec.ts` → 8 tests parsed OK
  (NOT run against live — see above).

## Notable implementation detail — build-time CSS gotcha

The market CSS lives in `client/src/index.css` (same convention as dex/
warehouse). An early version's block comment contained a bare `/`-delimited
class list (`.panel/.ornate/...`), which `lightningcss` (Vite's CSS
minifier) mis-parsed as a stray `Delim('/')` and FAILED the build. Fixed by
rewriting that one comment without slashes. Flagging it because it is a
non-obvious, minifier-specific trap for anyone adding CSS comments here.
