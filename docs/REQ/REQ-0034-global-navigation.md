# REQ-0034 -- Global Navigation

Status: spec, written before implementation (unlike REQ-0031, which was
written after the fact -- this repo's `docs/REQ/` convention started with
that file; this is the second entry and precedes its own implementation).

## Goal

Add a top navigation bar next to the existing "backpack_ragnarok" title,
with five destinations:

- バックパックス (Backpacks) -- `#/backpacks` -- the EXISTING two-board
  (Canvas + Inventory) layout, unchanged. Default route.
- スケジュール (Schedule) -- `#/schedule` -- placeholder.
- フレンズ (Friends) -- `#/friends` -- placeholder.
- 図鑑 (Dex) -- `#/dex` -- REQ-0035's item encyclopedia.
- 設定 (Settings) -- `#/settings` -- placeholder.

## Routing

Hash-based (`location.hash`), no router dependency added (project has none
today; a 5-route nav does not justify one). Route state lives in the
module store (`store.ts`), same pattern as `locale`/`activeInvPage` --
NOT React state -- and is kept in sync with `location.hash` both ways:

- On boot and on the browser's `hashchange` event, the store's route is
  set FROM `location.hash` (covers reload and deep-link, e.g. opening
  `/app/#/dex` fresh).
- When nav-bar code changes the route via the store, the store setter also
  writes `location.hash` (covers back/forward button + shareable URLs).

Unknown/empty hash falls back to `#/backpacks` (the default), same
defensive-clamp spirit as `setActiveInvPage`'s range clamp.

## Hard constraint: Pixi Application lifecycle

Per project history (REQ-0031 Phase A bug 2 -- see `docs/REQ/REQ-0031-
e2e-bugfix-presets-ui.md` section 2), destroying and recreating a PixiJS
`Application` on the same `<canvas>` element races WebGL context teardown
(`WEBGL_lose_context.loseContext()` is asynchronous) and can permanently
wedge the software GL driver (swiftshader, no real GPU on this box) into
an infinite shader-recompile retry loop. `Board.tsx`/`InventoryBoard.tsx`
already mount their `BoardRenderer`/Pixi `Application` exactly once per
boot and never remount on ordinary state changes (tab switch swaps
`BoardOps` via `setOps()`, not remount).

REQ-0034 must not reintroduce this bug via routing: switching away from
`#/backpacks` and back must NOT unmount `<Board/>`/`<InventoryBoard/>`.
Both components stay mounted in the DOM at ALL times (siblings of every
other route's content, inside `<main>`), and the currently-inactive
route's DOM (including the backpacks section when on a different route)
is hidden via CSS (`display:none` on a wrapping container), never
conditionally rendered (`{route === 'backpacks' && <Board/>}` is exactly
the pattern to avoid, since that unmounts on route change).

Verification: an E2E test navigates away from `#/backpacks` and back 5
times, then performs a drag/click on a board to confirm it is still
interactive (see `client/e2e/nav-routing.spec.ts`).

## Nav bar

Rendered in `Header.tsx` (extends the existing header row, next to the
title) -- five buttons, JA labels per the spec (バックパックス / スケジュール
/ フレンズ / 図鑑 / 設定), active item visually highlighted (reuses the
existing `.preset-tab`/`.inv-tab` active-state color convention: cyan
border/text vs dim default, see `index.css`).

## Placeholder pages

スケジュール/フレンズ/設定: each a titled, empty page with a bilingual
"coming soon" note (JA + EN in the same inline-string-per-locale pattern
`Header.tsx`/`Tabs.tsx`/`App.tsx` already use throughout -- no i18n
library, just `locale === 'ja' ? '...' : '...'`).

## Deferred

- No actual Schedule/Friends/Settings functionality -- REQ-0036 (Dungeon
  Schedule, already tracked as a separate pending item) and any future
  Friends/Settings REQ own that scope.
- No client-side router library -- revisit if route count/complexity
  grows past what hand-rolled hash sync comfortably covers.
