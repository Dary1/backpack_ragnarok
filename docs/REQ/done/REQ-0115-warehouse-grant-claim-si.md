# REQ-0115 — dev "Acquire to warehouse" accepts SI ids (grant + claim)

Status: **done** (merged to `master`@`89895b8`, `backpack-api` restarted,
live; verified against the live API — see "Deploy"). User ratified the fix
and its scope (grant + claim) and pre-approved deploy (chat, 2026-07-09).

## Origin

User request (chat, 2026-07-09, ja): in the dex Edit Mode (developer-only)
at `https://backpack-dev.qtie.jp/app/#/dex`, selecting an **SI** such as
`acc_gem` and pressing **"Acquire to warehouse"** fails with
`Could not add to warehouse: unknown item id "acc_xxxx"`. Asked to
investigate the cause; the OR-check fix (accept an id present in the PO
map OR the SI defs) was agreed. Investigation then found the same PO-only
assumption in the **claim** path, so the ratified scope is grant + claim.

## Bug

Two server-side validation gates rejected every SI id because both check
only `getScheduleContent().itemDefsById`, which is **PO-only** (live
`live_items.json` + the batch-002 pilot overlay). SIs live in a separate
file (`content/live/live_sis.json`, ids `acc_gem`, `acc_frost`, `acc_whet`,
`acc_arrow`, `acc_poison`, `acc_guard`) and are never in that map.

1. **Grant** — `server/routes/admin.cjs`, `POST /api/admin/warehouse/grant`:
   `if (!itemDefsById[body.itemId]) 400 'unknown item id "…"'`. The client
   (`DexAdmin.tsx` → `api.ts` `grantWarehouseItem`) posts the selected
   entry's id verbatim; for an SI that is `acc_gem`, and the client prefixes
   the server error with `dexAdmin.grantToWarehouseFailed`
   ("Could not add to warehouse: "), reproducing the reported message
   exactly.
2. **Claim** — `server/services/warehouse.cjs` `claimWarehouseItem`, the
   non-`tm` branch: `const itemDef = itemDefsById[item.itemId]; if (!itemDef)
   … 'unknown content item id'`. So even once an SI row exists in the
   warehouse, claiming it onto the canvas would fail with a different error.

The route's own comment claimed it validated against "the COMBINED item
defs … the same map claimWarehouseItem/settleRun already trust" — but
`itemDefsById` is not combined; that stale comment described the intended
behavior, not the actual one.

## Root cause

`services/core.cjs` `getScheduleContent()` builds `itemDefsById` from
`live_items.json` + pilot items only, by design: SIs are a distinct kind
for the engine/settle paths and are loaded separately (`services/
ragnarok.cjs` `getSiDefsById()`; comment there: "getScheduleContent doesn't
carry SI defs -- they're not a [PO]"). Nothing merged SI defs into the map
the grant/claim gates consult, so any SI id was "unknown".

This never surfaced in normal play because SIs never reach the warehouse
there: the market lists POs only (`services/market.cjs` says an SI row
"could not be claimed even if we listed it"), and dungeon rewards are POs
or a `kind:'tm'` LRDST row. The dev "Acquire to warehouse" grant is the
only path that puts an SI into the warehouse, so it was the first place the
PO-only assumption became a user-visible bug. The client side was already
SI-aware end-to-end (`WarehousePage.tsx` `itemKindOf` resolves against
`content.sis` and places PO vs SI accordingly), so the gap was server-only.

## Fix

Mirrors REQ-0042's `tmDefsById` addition: a new **sibling** map, not a
merge into `itemDefsById` (SIs stay a distinct kind).

- `server/services/core.cjs` — add `SIS_PATH` (`live_sis.json`), track its
  mtime in the content cache, load it, build `siDefsById`, and add it to the
  `getScheduleContent()` payload.
- `server/routes/admin.cjs` — grant gate now accepts an id present in
  `itemDefsById` **OR** `siDefsById`; stale "COMBINED" comment corrected.
- `server/services/warehouse.cjs` — `claimWarehouseItem` takes a new
  `siDefsById` param; the non-`tm` branch accepts a PO **or** SI id.
- `server/routes/schedule.cjs` — `POST /api/warehouse/claim` passes
  `siDefsById` through to `claimWarehouseItem`.
- `server/services/market.cjs` — corrected the now-stale comment (SI rows
  ARE claimable after this REQ; market still lists POs only as a v1 scope
  choice, not a claim-path limitation).

No client change: the client already resolves and places SIs. No dist
rebuild required (server-only behavior; request/response shapes unchanged).

## Files changed

- `server/services/core.cjs` — `siDefsById` sibling in `getScheduleContent`.
- `server/routes/admin.cjs` — grant gate accepts PO or SI.
- `server/services/warehouse.cjs` — `claimWarehouseItem` PO-or-SI (new param).
- `server/routes/schedule.cjs` — pass `siDefsById` to claim.
- `server/services/market.cjs` — comment accuracy only.
- `server/tests/api_test.cjs` — +2 regression tests.

Branch: `req-0115-warehouse-grant-claim-si` (cut off `master`@`f4bfe6d`).
Commit: `b9eaa8f` (fix + tests).

## Gates

- `node server/tests/api_test.cjs` (files backend) — **155/155** (153
  pre-existing + 2 new: grant SI `acc_gem` → 200 & listed; claim SI row →
  200, marked `claiming`).
- `node mock-src/tests/run.cjs` — **101/101**.
- `node sim/tests/run.cjs` — **74/74**.
- `node sim/tests/goldens.cjs` — **12/12**, replay determinism intact.
- `node tools/check_engine_types.cjs` — OK, 49 members, no drift.
- `pnpm run typecheck` (`tsc -p tsconfig.server.json`, which type-checks all
  five edited runtime files) — **clean (exit 0)**.
- `SKIP_PG` (files backend; no `DATABASE_URL` this session) — pg-backend api
  tests not run. e2e (Playwright) not run: client is unchanged, so the
  server gate + api regressions are the load-bearing coverage here.

## Interpretations / decisions

1. **Separate `siDefsById` sibling, not merged into `itemDefsById`.** The
   engine/settle paths deliberately treat SIs as a distinct kind; merging
   would risk the engine treating an SI as a PO. The sibling map is the
   exact shape/precedent REQ-0042 set for `tmDefsById`.
2. **Scope = grant + claim (both), per user ratification.** Fixing grant
   alone would let a dev put an SI in the warehouse that could never be
   claimed onto the canvas (a half-fix). Since the client is already
   SI-ready, the whole feature works with a server-only change.
3. **No client rebuild / no dist change** — behavior and API shapes are
   unchanged for the client; the fix is purely in server validation.
4. **Process note:** `tools/touch_next_req_reserved.py` is currently broken
   (SyntaxError at line ~109, an unclosed `def ensure_gitignore(` paren), so
   the number could not be reserved with the tool. REQ-0115 was confirmed
   free across `docs/REQ/*` (max 0114) and server `refs/heads/req-01NN` (max
   req-0114) and the reserved stub was created manually. Flagged to the user
   for a separate fix.

## Deploy

User pre-approved deploy (chat, 2026-07-09). Server-only change; no client
dist rebuild required.

1. `master` had advanced past this branch's base (`f4bfe6d`) while the work
   was in progress — `1d1413b` (REQ-0099 settled-run replay + E2E fix + a
   web/app dist rebuild). Its changed files are all `client/`, `web/app`
   dist, and `web/preview` assets — **no overlap** with this REQ's six
   server files. Merged current `master` into the branch
   (`146aaee`, clean, no conflicts).
2. Re-ran the full gate suite post-merge: api_test **155/155**, mock-src
   **101/101**, sim **74/74**, goldens **12/12**, engine-types OK,
   `tsc` typecheck clean.
3. `~/backpack_ragnarok` (main checkout, clean beforehand):
   `git merge --no-ff req-0115-warehouse-grant-claim-si` →
   merge commit **`89895b8`** (only the six server files applied).
4. `systemctl --user restart backpack-api` → **active**.
5. Live smoke (direct to `127.0.0.1:8802`, the restarted service):
   - `GET /api/content` → **200**.
   - `POST /api/admin/warehouse/grant {itemId:"acc_gem"}` → **200**
     `{ok:true, item:{itemId:"acc_gem", status:"claimable", …}}` (the exact
     reported failure — now fixed).
   - control `POST …/grant {itemId:"totally_not_real_xyz"}` → **400**
     `unknown item id` (genuinely-unknown ids still rejected).
   - `POST /api/warehouse/claim {itemUid:<the granted row>}` → **200**
     `{ok:true, itemId:"acc_gem"}` (claim gate now accepts SIs).
   - control `POST …/claim {itemUid:"no_such_uid"}` → **404**.

   The grant smoke left one real dev-warehouse row (`acc_gem`,
   `wh_85af1373d2f32d67`) in the `dev` player's warehouse; the claim smoke
   marked it `claiming` (it lazily reverts to `claimable` on the claim
   timeout, so nothing is stranded). Safe to leave, claim, or clear.

Live at `master`@`89895b8` on llmlocal.
