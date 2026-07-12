# REQ-0104 — Align-aware padding flush (blade/hilt seam truly flush)

- **Status**: DONE — merged to `master` (`1617cdb`) + dist committed (`23ac456`); **deployed live**.
  The v12 sprite is confirmed in the served bundle (`data-fit-align` ×2 = blade + hilt).
- **Date**: 2026-07-09 (orchestrator)
- **Worktree/branch**: `~/backpack_ragnarok_worktrees/req-0104-icon-align-trim`, from `master`
  @ `2aee741`.
- **Numbering note**: 0102 was the align feature; 0103 was taken by a concurrent
  `req-0103-dex-icon-cellpx-enlarge` (already merged to master), so this is **0104**.

## Request (user)
Follow-up to REQ-0102 ("much improved, but one more push"): find the tool that shapes icon
padding, change its spec so that **if an icon's `align` is set, the padding on that side is
removed**, run it, and confirm the sword blade and hilt connect.

## Root cause
REQ-0102's render-time align anchors the icon's *box* to the footprint edge, but the icon
*art* still carries the fit tool's no-contact **PAD** baked into the symbol (`tool_fit_check`
reserves `PAD=5`/100px on every exposed face). Per the ② audit that is blade bottom ≈2.5% and
hilt top ≈5.0% of viewBox — so the assembled Longsword seam kept a small residual gap (~8px).

## Change
- **`tools/tool_fit_check.py`** — `build_region`, `build_region_from_layout`, and `check_icon`
  are now **align-aware**: an exposed face named by a PO's `align` (v:bottom / v:top / h:left /
  h:right) no longer reserves the PAD strip, so content may sit flush to that edge and still
  verify **PASS** (overflow-only verdict is preserved; only the aligned face is un-padded).
- **`tools/fix_v12.py`** (new baker) — for every PO in `content/live/live_items.json` carrying
  `align`, rasterize the symbol, measure the content bbox, and bake an outer
  `<g data-fit-align transform="translate(…)">` that flushes the art to the aligned viewBox
  edge. Reads `sprite_all_v11.svg` → writes `sprite_all_v12.svg` (append-only; idempotent —
  SRC is always v11; re-wraps its own layer).
- **Client** bundles `sprite_all_v12.svg` (`client/src/board/sprites.ts`,
  `client/src/dex/dexIcons.ts`). v12 == v11 for all icons **except** blade & hilt (safe superset).

## Results / verification
- `fix_v12` run: **blade** bottom pad 2.5%→**0.0%** (dy +3.2), **hilt** top pad 5.0%→**0.0%**
  (dy −3.2); both `check_icon` = **PASS** (overflow_px=0) under the align-aware region.
- Assembled Longsword content seam gap: **8px (0.09 cell) → 1px (0.01 cell)** — flush (the 1px
  is anti-alias edge). Visual before/after: `tmp/req0104_seam_trim.png`.
- Client `npm run build` with v12: **green** (bundle `index-DiAVZlEX.js`).

## Deploy (2026-07-09) — DONE
- Non-fast-forward merge `req-0104` → `master` (master had advanced via concurrent
  REQ-0101/0105/0106 SFX work, none overlapping my files): `b7bb2cd` → merge `1617cdb`.
  The concurrent orchestrator's uncommitted art-pipeline files (`vocab.json`, batch-004, …)
  were left untouched, and touch no `client/src`, so the client rebuild is unaffected by them.
- `client && npm run build` → `web/app` (bundle `index-DiAVZlEX.js`); dist committed `23ac456`.
- No service restart (web serves `web/app` from disk; sprite is bundled into the client build,
  which the fresh dist carries).
- Live checks: served bundle == `index-DiAVZlEX.js`; **`data-fit-align` present ×2** in the
  served JS (v12 blade+hilt flush wrappers are live); `/api/content` align intact;
  `backpack-api`/`backpack-web`/`backpack-tunnel` active.
