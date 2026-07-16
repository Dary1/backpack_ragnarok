# REQ-0198 — Market sell instance visibility (eligibility, roll %, entry point)

## State log
- 2026-07-16 reserved (stub).
- 2026-07-16 reserved -> todo: user-directed, three live-reported market SELL defects
  (2026-07-16). Cleared to implement immediately.

## Problem (user report, 2026-07-16)
The market (REQ-0195a-e, merged + deployed) sells po/si/unit/tm with a rollPct bar on the
BUY side. Three SELL-side defects were reported against the live build:

### C — CRITICAL eligibility bug: "items not in my inventory are sellable"
Engine reference model (REQ-0030/0031): an item's HOME always lives in
`canvas.inv.pages[]` (`pos[]`/`bps[]`/`sis[]`). Placing it on the active board, or into a
squad preset, creates a REFERENCE (SAME uid) in the top-level `canvas.{pos,bps,sis}` OR in
a `canvas.presets.store[i]` snapshot. The market's sellable scan — client
`SellPane.collectSellable` + server `createListing` (`findInventoryPO/SI/BP`) — walks
`inv.pages` only, so board-/preset-referenced instances appear sellable even though the
player sees them as "in use, not in my inventory".

CONFIRMED on the reporting user's live profile: inv holds 16 pos / 14 bps; of those,
1 po + 3 bps are referenced by the ACTIVE BOARD and 12 pos + 3 bps by PRESET snapshots —
all wrongly listed as sellable today. The server's only pre-existing gate is
`deployedUidSet` (squads assigned to open/active ROOMS) — far narrower than "referenced".

### A — Sell picker must show per-instance roll % ("現物" visibility)
The SELL tab picker cards and the carve (price) panel show only name/rarity — two instances
of the same def are indistinguishable. The BUY side already renders a per-instance RollBar
(REQ-0195e); the SELL side does not.

### B — Sell entry point from the inventory UI
There is no one-tap path from inspecting a stowed inventory instance to the market SELL pane
with that instance preselected.

## Live-profile evidence (reporting user, 2026-07-16)
- inv: 16 pos, 14 bps.
- referenced by the ACTIVE BOARD (top-level canvas.{pos,bps,sis}): 1 po + 3 bps.
- referenced by PRESET snapshots (canvas.presets.store[i]): 12 pos + 3 bps.
- All 13 pos + 6 bps above were sellable pre-fix (wrongly); only the room-deploy subset was
  ever gated.

## Change

### C — eligibility (WYSIWYG with the inventory the player sees) — server + client
Reference set = the union of every uid in the top-level canvas `{pos,bps,sis}` (the active
board) PLUS every `presets.store[i].{pos,bps,sis}` snapshot. An SI is ALSO in-use
transitively when its HOST PO's uid is referenced (an inventory `sis[]` record whose
`host` is an object with `host.po` in the referenced-PO set). Eligibility rule: an instance
is sellable only when its uid is NOT in that set (in ADDITION to the existing room-deploy
gate). `deployedUidSet` is a strict SUBSET of the reference set (deploy reads the same
board/preset snapshots), so `deployed` is checked FIRST and keeps its own reason.

- server/services/squads.cjs: add `referencedUidSet(canvas)` (reuses squadUidSet over the
  board + every preset snapshot; adds the transitive host-PO SI walk). Re-exported on the
  services/market.cjs facade.
- createListing (po/si/unit): referenced -> 409 `{reason:in_use}` (NEW reason; keep
  `deployed` for the room case; check deployed first).
- deriveView + buyListing re-check: a LISTED instance that becomes referenced derives
  SUSPENDED (reversible, same law as deploy-suspension); buy -> 409 `{reason:suspended}`.
  Room-deploy behavior UNCHANGED.
- tm listings unaffected (no uid).
- Client SellPane.collectSellable: exclude/lock referenced instances (compute the same set
  from state: top-level pos/bps/sis + presets.store + transitive host-PO SIs). Referenced
  cards are SHOWN LOCKED with an "in use" note (mirroring the existing 配備中 deployed-lock
  chip pattern — "shown, not hidden" tells the player WHY), reusing the lock styling.
- marketErrors.ts: map reason `in_use` -> `market.err.inUse` (EN+JA).
- i18n: market.sell.inUseLock + market.err.inUse (EN+JA).

### A — per-instance roll % on the SELL side (client)
- SellableItem gains `rollPct: number|null`. collectSellable wires it: po/si -> instance q
  (`pos[].q` / `sis[].q`); unit -> `bp.roll?.pct` when a number else null (RollBar renders
  the 未測定 unmeasured badge for null on non-tm kinds); tm tab -> no bar.
- Render the existing RollBar (client/src/market/marketShared.tsx) on every picker card and
  in the carve panel's selected-item header. Cards carry `data-roll-pct` (RollBar owns
  that attribute) for e2e.

### B — sell entry point (client)
- Route: `#/market?sell=<uid>&kind=<po|si|unit>` — a new MARKET_SELL_HASH_RE deep-link
  pattern in store/core.ts (mirrors DEX_ITEM_HASH_RE), setting a one-shot
  `marketSellFocus:{uid,kind}` snapshot field, consumed + cleared by MarketPage (switch to
  SELL pane, set kind tab, preselect selectedUid, scroll into view). Invalid/missing uids
  are ignored gracefully.
- Entry-point surface: client/src/FloatingItemTip.tsx (the REQ-0119 tap tooltip) — the ONE
  per-instance inspection surface a player actually uses to inspect a specific stowed
  inventory instance (ItemPanel.tsx is a read-only DEF catalog with no instance uid, so it
  is the wrong surface). The tip already floats on tapping an item icon on any board,
  including inventory-page boards. It gains the instance uid (threaded through
  BoardRenderer.handleItemTap) and a compact "市場に出す / Sell this" action, shown ONLY
  for a po/si instance that is stowed (present in inv.pages) AND NOT referenced (same
  reference set as C) — hidden for referenced/deployed instances, matching C's rule.
  Clicking navigates to the `#/market?sell=` deep link.

## Gates
- server: full suite (STORAGE_BACKEND files + pg) green; the market group's suspension
  test is restructured (the RULE CHANGED — a preset-referenced item is now `in_use`, never
  freshly listable), keeping intent honest.
- client: pnpm -C client run build (tsc -b + vite) green.
- e2e: client/e2e/market.spec.ts extended (content-agnostic): stowed vs board-/preset-
  referenced sellability + createListing 409 in_use; picker card data-roll-pct = seeded q;
  #/market?sell= deep-link preselect. All market e2e pass.
- CI: SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh green.

## Gate results (2026-07-16)
- server api tests (files backend): 183 passed, 0 failed -- includes the
  restructured market-group in-use/suspension test.
- SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh: CI GREEN (client typecheck+build OK;
  every DB-free gate green; pg pass SKIPPED per the toggle).
- client build (tsc -b && vite build): OK.
- e2e client/e2e/market.spec.ts (fleet server + web/app build of this
  worktree, PLAYWRIGHT_BASE_URL=http://127.0.0.1:8803): 17 passed, 0 failed
  (14 existing + 3 new REQ-0198: referenced-lock/in_use 409, data-roll-pct
  picker card, #/market?sell= deep-link preselect).
- web/app reverted (git checkout -- web/app + git clean) so the tree is clean.

## Commits
- e2c24aa docs(REQ-0198): write full spec
- c2b30d6 docs(REQ-0198): reserved -> todo
- 9672aec REQ-0198(C) server: referencedUidSet eligibility gate (in_use) + referenced-suspension
- 707482d REQ-0198(A/B/C) client: sell-side roll bars, in-use lock, inventory sell entry point
- ca2227c REQ-0198 e2e: referenced-lock + in_use 409, data-roll-pct, deep-link preselect
- (this status log + todo->built follow)

## Entry-point surface chosen
client/src/FloatingItemTip.tsx (the REQ-0119 single-tap tooltip). It is the
ONE per-instance inspection surface a player actually taps to inspect a
specific stowed inventory instance -- it already floats on tapping an item
icon on an inventory-page board and reads that instance's name/rarity/tags/
effect/dismantle count. ItemPanel.tsx is a read-only DEF catalog (no instance
uid, so it cannot target a specific instance), and the warehouse views inspect
UNCLAIMED rows, not stowed inventory instances. The action is shown ONLY for a
po/si instance that is stowed AND not referenced/deployed (C's eligibility),
so a placed/in-use item never offers it.

