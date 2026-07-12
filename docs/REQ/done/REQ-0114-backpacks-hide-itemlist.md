# REQ-0114 — Hide the ItemList (item/SI catalog panel) on the Backpacks view

**Status:** Done (merged + deployed + live-verified) — folder is authoritative
**Reserved:** 2026-07-09
**Slug:** backpacks-hide-itemlist
**Branch:** `req-0114-backpacks-hide-itemlist` (server worktree
`~/backpack_ragnarok_worktrees/req-0114-backpacks-hide-itemlist`), branched off `master` @ f4bfe6d
**Commits:** `5e99abe` (source) · `676922e` (dist rebuild, web/app)

## Request (user)
On https://backpack-dev.qtie.jp/app/#/backpacks the backpacks view shows three
panels — Canvas / Inventory / ItemList. Make the **ItemList** no longer display
(Canvas and Inventory stay). "REQ をたててそのまま作業して" — reserve a REQ and do the work.

## What "ItemList" is
The backpacks-view (`client/src/App.tsx`) renders three sibling panels:
1. **Canvas** column — `app.canvasTitle` ("Canvas"/"編成の間"), the main Pixi `<Board>`.
2. **Inventory** column — `app.inventoryTitle` ("Inventory"/"インベントリ"), `<InventoryBoard>`.
3. **ItemPanel** — `<aside className="item-panel">` whose body is a READ-ONLY item/SI
   catalog: `<ul className="item-list">` under "Items"/"Socket Items" headings, plus a
   `.item-detail` card. This third panel is the "ItemList". (No component is literally
   named `ItemList`; the list container class is `item-list`, and it is the third of the
   three panels — a 1:1 match to the user's "Canvas / Inventory / ItemList".)

## Change
`client/src/App.tsx`
- Removed the `<ItemPanel .../>` render node from the backpacks-view (the
  `{snapshot.status === 'ready' && snapshot.gameData ? (<ItemPanel .../>) : null}` block),
  replaced with an explanatory REQ-0114 comment.
- Removed the now-unused `import { ItemPanel } from './ItemPanel'` (`tsconfig.app.json`
  has `noUnusedLocals: true`, so a dangling import fails typecheck).
- Canvas and Inventory columns are untouched. The REQ-0034 "backpacks-view is always
  mounted" rule is unaffected — ItemPanel owned no Pixi surface and no game state (it was
  a read-only catalog), so removing it cannot affect board persistence.

`client/e2e/canvas-chrome.spec.ts`
- The former "item panel: icard catalog + click-to-select detail card; hover tooltip"
  test (which asserted `.item-panel .icard` presence) is replaced by a REQ-0114 absence
  guard: `.item-panel`, `.item-panel .icard`, and `.item-detail` all count 0, while
  `canvas.board-canvas` still counts 2 (Canvas + Inventory boards remain mounted).

Not changed
- `ItemPanel.tsx` is left in the tree (now unused, tree-shaken out of the bundle) so the
  panel can be restored later by re-adding the import + render node.
- i18n keys `itemPanel.items` / `itemPanel.socketItems` left as-is (harmless unused entries).

## Decision — remove render vs. CSS-hide
Chose to NOT render the component (drop the import + JSX) rather than `display:none`.
The codebase gates panels via conditional rendering throughout; not rendering is cleaner,
removes the DOM / hover / tooltip surface entirely, and matches "表示しない" literally.
`ItemPanel.tsx` is retained for one-line reversibility.

## Gates (run in the worktree, pnpm via corepack)
- **Typecheck** `pnpm exec tsc -b` → exit 0 (clean).
- **Lint** `pnpm exec oxlint` → 0 errors (35 pre-existing warnings, none in the changed files).
- **Build** `pnpm run build` (`tsc -b && vite build`) → OK; dist emitted to `web/app`.
- **Behavioral (local, no deploy, read-only API)** — served the worktree's freshly built
  `web/app` on a localhost port behind a tiny proxy that forwards ONLY `/api/*` to the live
  backpack-api (`:8802`, GETs only — no profile writes, no e2e global-setup), then ran a
  headless-Chromium DOM assertion. A/B:
  - control = live/master build (`:8801`): `.item-panel=1`, `.item-detail=1`, `.item-list=2`,
    `boards=2`, `columns=2`, titles=`[Canvas, Inventory]` → **ItemList PRESENT**.
  - this build (req-0114): `.item-panel=0`, `.item-detail=0`, `.item-list=0`, `boards=2`,
    `columns=2`, titles=`[Canvas, Inventory]` → **ItemList ABSENT**.
  Both reached `data-source-badge="live"`. Before/after screenshots captured.

## Outcome / status
Built on branch `req-0114-backpacks-hide-itemlist` (source `5e99abe` + dist `676922e`),
all gates green. NOT merged to `master` and NOT deployed — `backpack-web` / `backpack-api`
are untouched; the merge + service restart is the user-coordinated deploy step (HANDS-OFF
per PROJECT.md). Moving `reserved → built`.

## Done — merged & deployed (2026-07-09)
- Updated the branch to current master (merge `fbdd99b`) and rebuilt the dist
  (`319c69b`, pnpm) so the bundle carries REQ-0099/0115/0116/0081 plus the
  ItemList removal (my earlier f4bfe6d-based dist would have been stale).
- Merged to `master` on the live checkout: merge commit **20d6798**
  ("Merge branch req-0114-backpacks-hide-itemlist").
- Deploy: `backpack-web` serves `~/backpack_ragnarok/web` via
  `python3 -m http.server` (reads disk per request) — no restart needed;
  `backpack-api` untouched (client-only change).
- Live-verified https://backpack-dev.qtie.jp/app/#/backpacks (headless Chromium):
  `data-source-badge="live"`, `.item-panel`=0, `.item-detail`=0, `.item-list`=0,
  `canvas.board-canvas`=2, `.board-column`=2, titles=[Canvas, Inventory].
  ItemList gone; Canvas + Inventory intact.
