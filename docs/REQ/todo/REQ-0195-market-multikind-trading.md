# REQ-0195 — market-multikind-trading: the Market trades unit / tm / po / si, priced in ANY TM

**Reserved:** 2026-07-16
**Ratified:** 2026-07-16 — direct user directive (chat, 2026-07-16); three open rulings
answered the same day (see §3).
**Slug:** market-multikind-trading
**Requested by:** user, 2026-07-16 (chat): "https://backpack-dev.qtie.jp/app/#/market
実際に動作するように実装してください" + the four numbered requirements below.

## 1. The user's directive, decomposed

1. **N currencies.** tm (currency item) is one kind today; the market must keep working
   at ANY number of TM kinds. (今は一種類しかないが、何種類になっても対応)
2. **Currency-for-currency trades.** TM listings priced in a different TM are legal.
3. **Tradeable kinds** = the contentadmin registry kinds **unit, tm, po, si** — nothing else.
4. **Roll fulfillment visualization.** A drop instance's hack-and-slash performance sits
   somewhere between its def's min and max; the fraction fulfilled (min=0%, max=100%)
   must be shown VISUALLY on the market.
5. **Instance-time computation.** Where the fraction does not exist in data (units), do NOT
   compute it at market-read time — REQ-0196 defines the per-instance container, minted at
   instance-creation time. The user granted container-definition-only authority
   ("入れ物だけを作る権限"); values stay design events (REQ-0190).

## 2. Baseline being amended (REQ-0064/0065, all still live law unless amended here)

- Law 1 "barter in kind" — WAS: price = integer qty of THE one TM (`lrdst`, hardcoded
  MARKET_TM_ID). NOW: price = integer qty of any ONE TM present in the live TM registry
  (content/live/live_tms.json). The registry is the single source of the currency set.
- Law 2 furnace tithe — UNCHANGED: burn = max(1, ceil(qty * 0.08)), settlement-only.
  User ruling 2026-07-16: rate and price range stay common across ALL kinds.
- Law 3 no living prices — UNCHANGED.
- Listing lifecycle (active/settled/withdrawn/expired + derived suspended), 7d TTL,
  no-escrow + lazy derivation, warehouse-grant delivery, idempotency — UNCHANGED.

## 3. User rulings recorded 2026-07-16 (AskUserQuestion, chat)

1. Same-TM-for-same-TM listings: **FORBIDDEN** (price.tm ≠ listed tm id; 400).
2. Unit % bar while no instance roll data exists: **"unmeasured" badge, no bar**;
   bars appear automatically once REQ-0196's container fills (REQ-0190 values).
3. Burn 8% + price range [1,999]: **common to every kind**.

## 4. Design

### 4.1 Listing shape (storage + DTO; MARKET_DTO_VERSION 1 -> 2)

- `kind: 'po' | 'si' | 'unit' | 'tm'` — NEW, required. Legacy stored listings lacking
  `kind` normalize to 'po' at read (they can only be POs).
- po/si/unit: `itemUid` = the instance uid (po.uid / si.uid / bp.id), `itemId` = the
  content id (po.id / si.id / bp.unit.id). One live listing per instance uid, as before.
- tm: `itemUid` = null, `itemId` = the TM content id, `tmQty` = integer amount sold
  (NEW field, [1,999] too). Multiple concurrent tm listings by one seller are legal;
  each is checked against the balance independently.
- `price: {tm, qty}` — tm must be a live TM registry id; for kind 'tm', price.tm ≠ itemId.
- `rollPct: number | null` — NEW on the DTO (not stored; derived at DTO time from the
  seller's live instance): po/si -> the instance's q (REQ-0063); unit -> bp.roll?.pct
  (REQ-0196 container) else null; tm -> null. null renders as "unmeasured" (units) or
  no bar (tm).

### 4.2 Eligibility / suspension / item-gone, per kind

- po — UNCHANGED (inventory pos[]; deployed -> suspended; gone -> auto-withdraw).
  NEW: settling a PO re-homes any SIs socketed on it (`sis[].host.po === uid`) to
  `host:'inv'` on the same page instead of leaving orphaned host refs.
- si — inventory pages[].sis[] (socketed-in-inventory included); deployed (via squad
  scan, squadUidSet already covers sis) -> suspended; gone -> auto-withdraw.
- unit — inventory pages[].bps[]; the BP must be EMPTY: no pos[]/sis[] homed within its
  footprint on its home page (nested content does not travel; 409 {reason:'not_empty'}).
  Deployed -> suspended. Gone -> auto-withdraw.
- tm — no uid; "stock" = readTmBalance(seller, itemId). balance < tmQty -> derived
  SUSPENDED (reversible — balances refill; never auto-withdraw). Settle re-checks and
  409s {reason:'suspended'} on shortfall.

### 4.3 Settlement (buyListing) — same 7-step order, kind-branched at steps 3/4

- (3) seller side: po -> stripPoFromCanvas (+ SI re-home); si -> strip sis[] entry;
  unit -> strip bps[] entry; tm -> debitTmFromCanvas(seller, itemId, tmQty).
- (4) buyer delivery rows: po/si -> row as today (q copied, never re-rolled; si rows
  validate against siDefsById per REQ-0115); unit -> NEW row kind:'bp' carrying the FULL
  instance payload `bp` (shape/unit/hpMax/cellCount/bonuses/roll — verbatim, never
  re-rolled), claim validates payload.unit.id against unitDefsById, client places via
  lib/placement's firstFitPlaceBp (the Workshop's own claim path); tm -> row kind:'tm'
  qty=tmQty (grantTmQty shape, claim merges via firstFitOrMergeTM).
- Proceeds/furnace/dex history: proceeds row already generic by price.tm; furnace
  entries already record tm. Dex history entries GAIN `tm` (prices in different TMs
  never mix): entries keyed by itemId as before, each entry {qty, tm, t}; the client
  anchor shows only entries matching the currently-chosen price TM.

### 4.4 Wire (shared/dto.ts; dtoVersion 2)

- ApiMarketListing += kind, tmQty (tm only), rollPct; envelope `tm` (the ONE tm) ->
  `tms: string[]` (the live registry ids, display order). ApiMarketPriceHistoryEntry
  += tm. ApiMarketCreateListingRequest: {kind, itemUid?, itemId?, tmQty?, price}.
  Furnace: totals become per-tm rows [{tm, total, count}]; season windowing unchanged.

### 4.5 Client (/app/#/market)

- SellPane: kind tabs (po/si/unit/tm) over the player's sellable sets; price-TM
  selector (hidden behind a single default when only one TM is live); tm listing form
  (sell qty stepper + balance); same-TM guard mirrored client-side.
- BuyPane: kind filter chips; card shows kind, price TM (icon+short), and the ROLL BAR:
  a 0–100% fill bar labeled with the % (rollPct*100, rounded), rendered for po/si always
  and for unit when rollPct != null, else the "unmeasured" badge; nothing for tm.
- BuyModal: affordability against the LISTING's price.tm balance (not lrdst).
- MinePane: kind + roll bar on own cards. i18n: EN/JA pairs for every new string
  (i18n/market.ts).
- WarehousePage/WarehouseTab: claim handles kind:'bp' rows (firstFitPlaceBp).

### 4.6 Out of scope

- Filling unit roll VALUES (REQ-0190 + REQ-0196; the market renders whatever the
  container holds). - Contentadmin TM authoring UX (registry already serves TMs).
- Cross-TM exchange-rate analytics. - Escrow (no-escrow law stands).

## 5. Gates

- server tests: existing market suites stay green; new suites for kind validation,
  same-TM 400, tm suspension/settle, unit empty-check/delivery payload, SI re-home,
  rollPct derivation (q passthrough + null for unit-without-container + null for tm).
- client: tsc + build green. e2e (ports 1950–1959 per the port law): market spec
  extended — sell/buy a tm-for-tm listing end to end; unit listing shows unmeasured
  badge; po listing shows a % bar matching the seeded q.
- ci.sh green on the branch.

## 6. Status log

- 2026-07-16 reserved (f919562), spec written, ratified by the user's own directive;
  reserved -> todo same day.
