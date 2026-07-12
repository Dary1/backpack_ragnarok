# REQ-0096 — SI dex cards render no icon (ShapeGrid "--" placeholder)

- **Status**: BUILT — merged to `master` (user asked in-chat to fix + make visible on
  backpack-dev.qtie.jp) and LIVE there. Branch `req-0096-si-icon-shapegrid-fallback`
  implemented off master @ `6177254`, fast-forwarded onto master as `2eebc30`
  (master had not moved). Gates green (§4). Live re-verified via browser: catalog
  grid, detail two-pane diagram, and list-row thumbnails all now show the SI icon.
  Scope class: **bugfix, client only** (no schema/API/engine change; no
  `backpack-api` restart needed — `web/app/`'s committed dist is served as static
  files, so the merge itself was the deploy). Staying in `built/` pending the
  user's own look at backpack-dev.qtie.jp/app/#/dex; move to `done/` once
  confirmed.

## 日本語サマリ

**症状**: `/app/#/dex` で SI（ソケットアイテム／装備品ではないアイテム）のカードにアイコン
が表示されず、カタログ・詳細図解・管理画面のどこでも空の「--」プレースホルダーのまま
だった。PO（Ruby Gem 以外の武器・防具パーツ等）は正常に表示されていた。

**原因**: `ApiSIEntry`（SI のデータ型）には `shape` フィールドが存在しない（SI は盤面
セルを占有せず `slot` を持つだけ）。`Dex.tsx`/`DexDetail.tsx`/`DexAdmin.tsx` 内の
`shapeOf()` ヘルパーはこれを見て常に `[]` を返しており、`ShapeGrid.tsx`/`DexDiagram.tsx`
はセル集合が空だと即座に「--」プレースホルダーを返して抜けるため、アイコン `<img>` 自体
が一切マウントされていなかった（アイコンのデータURL解決自体は問題なかった —
`iconDataUrl()` は正しく動いていたが、呼び出し元に届く前に空状態で早期リターンしていた）。

**修正**: `shapeOf()` の戻り値が空のとき、`[[0, 0]]`（1x1 の合成アンカーセル）にフォール
バックするよう変更。この解決策は `DexCardWindow.tsx`（ポップアップカード）が既に採用して
いたパターンと同一で、カタログ／詳細／管理画面の3箇所すべてに横展開した。e2e 回帰テストを
1件追加（`/api/content` の全 SI id をイテレートし、各カタログカードがアイコンオーバーレイ
を実際にマウントすることを確認）。

## 1. User report (verbatim, 2026-07-07, via chat)

> https://backpack-dev.qtie.jp/app/#/dex で、SIの場合、アイコンが表示されないのを修正して、
> 表示されるようにしてください。

## 2. Repro

Chrome-automated repro against the live dev site confirmed the report exactly:
all 6 live SI entries (Ruby Gem, Frost Orb, Whetstone, Arrowhead, Poison Coat,
Guard (Tsuba)) showed a bare "--" placeholder in the catalog grid where every PO
card (Nos. 001-008) rendered a real icon. DOM inspection confirmed PO cards had a
`<img>` element (`data:image/svg+xml...`), SI cards had none at all.

## 3. Root cause

`client/src/dex/Dex.tsx` (and the same pattern duplicated in `DexDetail.tsx` and
`DexAdmin.tsx`):

```ts
function shapeOf(e: ApiItemEntry | ApiSIEntry): Cell[] {
  return ('shape' in e && Array.isArray(e.shape) ? e.shape : []) as Cell[];
}
```

`ApiSIEntry` (`shared/dto.ts`) has no `shape` field — SI items equip into a `slot`,
they don't occupy inventory-board cells. So `shapeOf()` always returned `[]` for
SI entries, feeding an empty `shape` array into `ShapeGrid`:

```ts
// ShapeGrid.tsx
const all = [...shape, ...(portTiles ?? []), ...(linkerTile ? [linkerTile] : [])];
if (all.length === 0) return <div className="shape-grid-empty">--</div>;
```

With an empty `shape` and no `portTiles`/`linkerTile`, `all.length === 0` always,
so the component bails to the "--" placeholder *before* reaching the icon-overlay
compositing code further down — the icon `<img>` element was structurally never
created. `DexDiagram.tsx` (the big detail-view diagram) has the identical
`if (shape.length === 0) return <div className="dex-diagram-empty">--</div>;` guard,
so the detail two-pane view's diagram panel had the same bug.

Confirmed via live-data check that `iconDataUrl(e.entry.icon)` itself resolves
correctly for every SI id (all SI icon ids -- `icon-acc_gem`, `icon-frost_orb`,
`icon-whetstone`, `icon-acc_arrowhead`, `icon-poison_vial`, `icon-acc_guard` --
exist in `content/sprite_all_v11.svg`) — the bug was purely in the shape-empty
short-circuit upstream of where that icon URL ever gets used, not in icon
resolution itself.

`client/src/dex/DexCardWindow.tsx` (the popup item-card overlay, REQ-0052) did
NOT have this bug: it already computed `card.shape && card.shape.length > 0 ?
card.shape : [[0, 0]]` before passing shape into `ShapeGrid` — this REQ applies
that same fallback to the three other call sites that had their own separate
`shapeOf()` copy without it.

## 4. Fix

`client/src/dex/Dex.tsx`, `client/src/dex/DexDetail.tsx`, `client/src/dex/DexAdmin.tsx`:
each file's local `shapeOf()` now falls back to a synthetic 1x1 anchor cell when
the entry carries no real shape:

```ts
function shapeOf(e: ApiItemEntry | ApiSIEntry): Cell[] {
  const shape = ('shape' in e && Array.isArray(e.shape) ? e.shape : []) as Cell[];
  return shape.length > 0 ? shape : ([[0, 0]] as Cell[]);
}
```

This makes `ShapeGrid`/`DexDiagram` see one occupied cell for SI/TM entries, so
they render a 1x1 grid with the icon composited onto it (via the existing
`computeDomIconOverlay` full-footprint fit math) instead of bailing to the empty
placeholder. PO items are unaffected (they always had a real multi-cell `shape`,
so the fallback branch never triggers for them).

`client/e2e/dex.spec.ts`: new test — iterates every SI id in `/api/content`,
searches for it in the dex catalog, and asserts the resulting card has zero
`.shape-grid-empty` elements and exactly one real `.shape-grid-icon-overlay` /
`.shape-grid-cell-icon`.

## 5. Gates

- `cd client && pnpm exec tsc -b`: clean.
- `cd client && pnpm run build` (`tsc -b && vite build`): clean, `web/app/` dist
  rebuilt.
- `node sim/tests/run.cjs`: **66/66 passed**.
- `node mock-src/tests/run.cjs`: **101/101 passed**.
- `node server/tests/api_test.cjs` (files backend): **153/153 passed**.
- e2e not run against an isolated local server pair for this REQ (would need
  `tools/e2e_fleet.cjs`/a dedicated worktree port); instead verified directly
  against the live site before AND after the fix via Chrome automation (§2 and
  below), which exercises the exact same code path the new Playwright test
  covers.
- Live re-verification post-deploy (Chrome, hard-reloaded `backpack-dev.qtie.jp`):
  all 6 SI catalog cards (Ruby Gem, Frost Orb, Whetstone, Arrowhead, Poison Coat,
  Guard (Tsuba)) now render their icon. Opened the Ruby Gem detail view: the big
  diagram panel, the left-rail list thumbnail, and the info panel all show the
  gem icon correctly too (confirms the `DexDetail.tsx` fallback covers both the
  list-row thumbnail AND the large `DexDiagram` panel, not just the catalog grid).

## 6. Deploy

Merged to `master` (fast-forward, master unchanged since branch point) and live
— `web/app/`'s committed dist is served as static files by `backpack-web.service`
directly from the main checkout, so the merge/rebuild itself was the entire
deploy; no `backpack-api` restart needed (server/ untouched). Two files in the
main checkout unrelated to this REQ (`content/vocab.json`,
`tools/build_dungeon_preview.py`, both from a concurrent art/content session)
were left untouched — verified `git status` before/after the merge is identical
apart from this REQ's own files.
