# REQ-0119 — Board Item Tap Tooltip

**Status:** Done (merged to master + deployed + live-verified)
**Reserved:** 2026-07-09
**Slug:** board-item-tap-tooltip
**Code:** merged to `master` `9df7cc2` (fast-forward) — server branch
`req-0119-board-item-tap-tooltip` off `fa550b6` · src `9c48556` · dist `70bcd08`
· merge-in-master `9df7cc2`

## Request (user, JA)
インベントリ又はキャンバスで（出現箇所は複数ページに跨る）、アイテムのアイコンを
シングルタップしたら、`https://backpack-dev.qtie.jp/redesign/styleguide.html` の
ツールチップデザインのパネルが Float するように改修する。

## Scope
A single-tap on an item icon — a placed PO, an assembled blade, or a seated /
free-placed SI — on the **canvas board** OR **any inventory-page board** floats an
HTML panel styled to the redesign styleguide's tooltip anatomy
(`web/redesign/assets/ui.css`'s `.tooltip` / `.tt-name` / `.tt-tags` / `.tt-stat` /
`.tt-flavor` / `.tt-sell`). Because both boards are the same `BoardRenderer`, hooking
the tap there covers every page the boards appear on (canvas page, inventory tabs, and
the warehouse/expedition surfaces that reuse the inventory board via a portal) — the
"spans multiple pages" note in the request.

## Decisions (user-confirmed)
- **Trigger timing** — user asked "what is best per UI convention". Chosen: **immediate,
  non-toggle** show. A tap floats the panel at once; it does not toggle closed on re-tap
  (closing is a separate gesture). This coexists cleanly with the existing double-tap =
  rotate (1st tap floats, 2nd tap rotates; the panel stays, idempotent per id) and with
  drag = move (an armed drag never floats a panel). Matches touch convention (tap = show
  info immediately) and avoids a ~250ms debounce delay.
- **Dismiss / switch** — close on an outside / empty-board tap (and Esc); tapping another
  item switches the panel content in place (no explicit close). (User-selected.)
- **Bottom line** — INCLUDE the styleguide's dismantle + dex line, populated with HONEST
  data: the 1-based dex number (a PO's ordinal in `content.items`, per `dex/dexNo.ts`;
  SIs have none → chip omitted) and the per-item 分解値 = dismantle COUNT from
  `/api/dismantle/ledger` (fetched once, cached). The mock's "分解: ᚠ 120" is a placeholder
  rune amount with no backing datum here (dismantle yields a flat Weathervane; the engraved
  per-item number IS the count), so the real count is shown, matching the Dex/DismantlePanel.

## Design / implementation
- `client/src/board/itemTip.ts` (new) — framework-free pub-sub for the current tip
  `{ kind:'po'|'si', id, anchor(client px), boardKey }`. Same pattern as `board/drag.ts`;
  never touches game `state`.
- `client/src/FloatingItemTip.tsx` (new) — one app-level fixed overlay (outside the route
  switch, like `Header`/`InviteBanner`). Resolves name/tags/eff/flavor from `ITEMS`/`SI_DEFS`,
  computes dex No. + dismantle count, renders the styleguide anatomy, edge-flips to stay
  on-screen, dismiss on outside/empty tap + Esc, switch on other-item tap.
- `client/src/board/BoardRenderer.ts` — each interactive item hit graphic (placed PO,
  assembled blade `asmHit`, seated SI, free-placed SI) gets a `pointerup` → `handleItemTap`,
  filtered when a drag armed (`getCarry()?.armed`, still set because the object 'pointerup'
  fires in the document-capture phase before drag.ts's window 'pointerup' clears the carry).
  Empty stage tap (`e.target === stage`) → `clearItemTip`; `destroy()` clears its own tip.
- `client/src/board/geom.ts` — `localBoxToClient()` (inverse of `clientToLocal`) maps an
  icon's board-local pixel box to a viewport rect for the HTML anchor.
- `client/src/index.css` — `.item-tip` / `.item-tip-*` faithfully copy the styleguide
  `.tooltip` / `.tt-*` rules under a NEW class name (the plain `.tooltip` is already ItemPanel's
  older desktop hover tooltip — reusing it would collide).
- i18n reuses existing keys (`dexcard.dismantleCount` = 分解値/Dismantled,
  `market.dexChip` = 図鑑 {no}/Codex {no}); no new keys.

## Gates
- `tsc -b`: green. `oxlint`: 0 errors; new files 0 warnings. `vite build`: green.
- e2e `client/e2e/item-tap-tooltip.spec.ts`: 5/5 pass (canvas float w/ name·dims·dex, empty
  tap dismiss, other-item switch, inventory-board float, drag does NOT float) — re-run 5/5
  green against the post-merge build.
- Interaction regression (isolated rig): `baseline-smoke` + `bp-rotate` 7/7 (drag, PO rotate,
  BP rotate both boards, identity, PO-on-BP keeps own rotate). No regression from the added
  `pointerup` handlers.
- Visual: element screenshot matches the styleguide (dark gradient, gold hairline border,
  display-font name, dim tags, italic flavor, gold dismantle/dex line).

### Verification method
The standard e2e harness targets the public tunnel (deployed build + live profile), so it
would not exercise an undeployed branch and would mutate the live profile. Pre-merge
verification used an ISOLATED local rig (this worktree's `web/app` on a throwaway static
port + a temp-`HOME` `backpack-api` + `e2e/local-proxy.cjs`) — no live profile/service
touched. All 5 feature tests + 7 regressions passed there against the exact merged build.

## Merge & deploy
- Master had advanced to `10d5f3a` (REQ-0097) since branch base `fa550b6`. Merged master
  INTO the branch, resolved `client/src/index.css` (append vs their insert — kept both),
  regenerated `web/app` dist from the merged source, re-ran gates (tsc/lint/build green,
  5/5 e2e green). Then fast-forwarded `master` → `9df7cc2`.
- Deploy: `backpack-web.service` statically serves `~/backpack_ragnarok/web` (`python -m
  http.server`), so the ff-merge updated the served files in place — no build step, no
  service restart. `backpack-api` unchanged (client-only change), not restarted.
- Live-verified: `backpack-web` active; served `/app/` references `assets/index-D0K1RPmZ.css`
  which contains `.item-tip`; live JS contains the tap wiring; `https://backpack-dev.qtie.jp/app/`
  returns 200. (No destructive live check run — tapping is read-only, but PUTting a fixture
  would overwrite the real default profile, so live behavior was validated on the identical
  artifact via the isolated rig instead.)

## Follow-ups / not done
- Effect keyword coloring (焔/霜/連結/血, styleguide `.kw-*`) is not applied: `ItemDef.eff`
  is a freeform localized string, not a structured AST, so tokens aren't reliably
  identifiable. The effect line renders plainly in the `.item-tip-stat` style. Revisit if a
  structured effect surface lands.
