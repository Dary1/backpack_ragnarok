# REQ-0103 — Dex icons render too small for their display container

- **Status**: BUILT — merged to `master` (fast-forward, master unchanged since
  branch point) and LIVE on backpack-dev.qtie.jp. Branch
  `req-0103-dex-icon-cellpx-enlarge` implemented off master @ `994ccef`
  (post-REQ-0102), fast-forwarded as `2aee741`. Gates green (§3). Live
  re-verified via browser: catalog grid + detail list-row thumbnails both
  visibly larger, no clipping/overflow. Scope class: **cosmetic, client
  only** (numeric prop bump + comments; no schema/API/engine change). Staying
  in `built/` pending the user's own look; move to `done/` once confirmed.

## 日本語サマリ

**要望**（チャットでの経緯）: REQ-0096 で SI アイテムのアイコン自体は表示されるように
なったが、ユーザーから「dexでのアイコンの表示サイズを、与えられているコンテイナーに
対して、最大まで拡大表示するようにしてください」との追加依頼。確認の結果、方針は
「セルの形状で相対的な大きさは分かるので、相対サイズを保ったまま全体を拡大し、視認性を
優先する」（＝カードごとに個別最大化して相対サイズ比較を崩すのではなく、全体を一律に
拡大する）。

**原因**: カタログ/詳細/管理/ポップアップの各 Dex 画面で `ShapeGrid` に渡す `cellPx`
(1セルあたりのピクセル数) が固定の小さい値（20/16/14/28）だったため、特に1マスの
アイテム（SI の大半）はカタログの高さ96px固定の枠（`.dex-card-shape.dthumb`）の中で
20x20pxしかなく、枠の大部分が空白になっていた。

**修正**: Dex関連の全 `ShapeGrid` 呼び出しの固定 `cellPx` を一律2倍に変更:
- `Dex.tsx`（カタログ本体 + Transmutator 帯）: 20 → 40
- `DexDetail.tsx`（詳細画面左のリスト行サムネイル）: 16 → 32
- `DexAdmin.tsx`（編集画面のリストサムネイル、2箇所）: 14 → 28
- `DexCardWindow.tsx`（ポップアップカード）: 28 → 56

`DexDiagram.tsx`（詳細画面中央の大きな図解パネル）は対象外 — もともとアイテムごとに
利用可能なパネルサイズに合わせて `cellPx` を動的計算している（`BASE_CELL_PX=46 *
DIAGRAM_SCALE=5`、パネルの高さ/幅で上限クリップ）ため、固定値を持たず今回のバグの
対象ではない。

## 1. User request (verbatim, via chat)

> dexでのここのアイコンの表示サイズを、与えられているコンテイナーに対して、最大まで
> 拡大表示するようにしてください

Follow-up clarification (方針確認への回答):
> セル形状で「大きさ」はわかるので、相対サイズを保ったまま全体を拡大して、アイコンの
> 可視性重視です

## 2. Root cause + fix

Every Dex view composites an item's icon onto a `ShapeGrid` (`client/src/dex/
ShapeGrid.tsx`) sized by `nCols/nRows * cellPx`. The catalog card well
(`.dex-card-shape.dthumb`, `index.css`) is a FIXED 96px-tall box regardless of
the item's own shape, but `cellPx` was a small constant (20) shared by every
card — so a 1-cell item's whole rendered footprint was only 20x20px, ~80%
smaller than the well around it (confirmed live: Ruby Gem/Frost Orb/etc.
looked like a tiny icon floating in a mostly-empty dark box, while 2x2 items
like Tower Shield/Beast Jaw at least filled 40x40 of the same well). The
same small-constant pattern existed in the other 3 Dex views (detail list
row, admin editor list, popup card), each with its own hard-coded `cellPx`.

Rejected alternative: computing a PER-CARD `cellPx` that independently
max-fits each card into its own well would have made every item (a 1-cell
gem and a 4-cell shield alike) render at roughly the same visual size,
destroying the "shape reveals true relative size" comparison the catalog is
designed to convey (confirmed as unwanted with the user — see §1 follow-up).

Fix: doubled the shared `cellPx` constant at all four Dex call sites (see
Japanese summary above for the exact old→new values and which container each
belongs to). Because `cellPx` is one shared number per view, this is a pure
scale-up — every item in that view got 2x bigger, so their relative-size
relationship is unchanged (a 2x2 item is still exactly 2x the linear size of
a 1x1 item), it's just that even the smallest items are now clearly visible.
Verified none of the 4 containers clip at the new size: the catalog well's
worst case (2x2, the largest shape in current content) is `2*40 + 1px gap +
2px border = 83px`, comfortably inside the fixed 96px well; the other three
containers (`.dex-detail-item-list-shape`, `.dex-admin-list-thumb`,
`.dexcard-fig`) all hug their content with no fixed size, so they simply grew
to fit — nothing to overflow.

REQ-0102 (a concurrent session's PO icon-alignment feature, `align`/
`applyAlign` in `client/src/render/itemCard.ts`) landed on master between
REQ-0096 and this REQ. Read fresh before editing: `align` only translates
the already-centered icon box toward an edge (never rescales), so it's fully
orthogonal to `cellPx` — no interaction, no conflict.

## 3. Gates

- `cd client && pnpm exec tsc -b`: clean.
- `cd client && pnpm run build`: clean, `web/app/` dist rebuilt.
- `node sim/tests/run.cjs`: **66/66 passed**.
- `node mock-src/tests/run.cjs`: **101/101 passed**.
- `node server/tests/api_test.cjs` (files backend): **153/153 passed**.
- `client/e2e/dex.spec.ts` assertions reviewed (not re-run against an isolated
  server): every assertion touching icon rendering checks cell COUNTS or
  `data-footprint-w/-h` (footprint size in cells, not pixels), never a raw
  pixel/cellPx value — confirmed none needed updating for this pixel-scale-
  only change.
- Live re-verification (Chrome, hard-reloaded backpack-dev.qtie.jp): catalog
  grid icons visibly ~2x larger with correct relative sizing preserved
  (Ruby Gem/Frost Orb clearly bigger and more legible than before, still
  smaller than Tower Shield/Beast Jaw); detail view's left-rail list
  thumbnails also visibly larger; no clipping/overflow in either.

## 4. Deploy

Merged to `master` (fast-forward) and live — same static-dist-serving deploy
path as REQ-0096, no `backpack-api` restart needed.
