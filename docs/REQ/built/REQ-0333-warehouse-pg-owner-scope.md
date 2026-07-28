# REQ-0333 — pg single-row stores ignored playerId: a cross-player ownership hole

## Status
built — found, fixed and gated 2026-07-28. Awaiting user acceptance / merge.

Found while running `tools/release.sh` for REQ-0331: stage **[5/7] (pg backend)
was RED on untouched master** and had been. Not caused by REQ-0331 (that branch
touches no `server/` path).

**Severity: high.** Under the pg backend — which is what production runs
(`server/.env`: `STORAGE_BACKEND=pg`) — one player could list ANOTHER player's
warehouse drop on the market.

---

## 1. The defect

`server/storage/warehouse.cjs` and `server/storage/gacha.cjs` each expose a
single-row store keyed by `(playerId, uid)`. Both backends take the same
signature, but only the files backend honoured it:

| | files | pg (before) |
|---|---|---|
| read | `warehouse/<playerId>/<itemUid>.json` — a foreign uid simply misses | `WHERE item_uid = $1` — **playerId accepted and ignored** |
| delete | same per-player path | `WHERE item_uid = $1` — **same** |
| list | per-player dir | `WHERE player_id = $1` (correct) |
| write | per-player path | `player_id` column written (correct) |

So the owner scoping was real on files, absent on pg, in exactly the two
functions that take a uid. `list` and `write` — the two that were written with
the column in mind — were fine, which is why this survived review.

The module's own doc comment states the invariant it was violating:

> Every function takes playerId explicitly ... because the files backend
> partitions its directory tree by player **and the pg backend needs it for the
> player_id column**

### Reachability (why this is not theoretical)

`POST /api/market/listings/from-warehouse` (REQ-0328, shipped 2026-07-27)
resolves the row to sell via `readWarehouseItem(callerId, warehouseRowId)`.
With the pg lookup unscoped, that returns another player's row and the sell
proceeds: the victim's drop is consumed and listed on the market under the
attacker's name, with the attacker collecting the proceeds. `warehouseRowId` is
a client-supplied field.

The same shape in `gacha.cjs` let a caller read or delete another player's
pending gacha roll by uid. No gate covered that one; it was found by grepping
for the same signature after the warehouse failure, and is fixed here rather
than left as a known sibling.

## 2. The gate that already knew

`server/tests/api/market.cjs:938` — *"market REQ-0328: from-warehouse
validation -- unknown/foreign row 404 (no-leak)"*:

```js
// Another player naming the seller's real row id 404s identically (peek
// only ever reads the caller's OWN warehouse): no-leak.
const foreign = await marketReq('POST', '/api/market/listings/from-warehouse',
  mktBuyer.token, { warehouseRowId: whId, price: { tm: 'lrdst', qty: 5 } });
assert.strictEqual(foreign.status, 404, 'foreign row must 404 identically: ...');
```

The assertion was correct and specific. It passed at ci.sh **[4/7] (files)** and
failed at **[5/7] (pg)** — deterministically, three runs out of three, with the
listing body printed in full in the failure message.

**So the test suite was not at fault here and neither was coverage: the pg stage
was simply red and had not been looked at.** That is the more uncomfortable
finding, and it belongs in this REQ rather than being smoothed over: ci.sh's own
header (REQ-0238's serving-mode coverage map) exists precisely to say which
stage proves what, and [5/7] is marked MANDATORY on every real CI run.

### Related hazard noticed while reproducing (not fixed here)

ci.sh **[4/7] is `node server/tests/api_test.cjs` with no `STORAGE_BACKEND`
pin**, so it inherits the caller's environment. Sourcing `server/.env` (which
sets `STORAGE_BACKEND=pg`) before running ci.sh silently turns the
files-backend stage into a second pg stage — the "(A) FILES mode" contract in
ci.sh's header then proves nothing, with no warning. Cheap fix:
`STORAGE_BACKEND=files node server/tests/api_test.cjs`, mirroring [5/7]'s
explicit `STORAGE_BACKEND=pg`. Left for its own REQ to keep this one to the
security fix.

## 3. The fix

Four functions, one predicate each:

```sql
-- warehouse_items, gacha_pending: read and delete
WHERE item_uid = $1                     ->  WHERE item_uid = $1 AND player_id = $2
WHERE roll_uid = $1                     ->  WHERE roll_uid = $1 AND player_id = $2
```

Both ids go through `namespacedId()` exactly as `list`/`write` already do, so
test namespaces stay disjoint from live.

**Why narrowing is safe.** A warehouse row never changes owner — see
`writeWarehouseItemPg`'s own REQ-0041 note ("Every REAL call site writes a given
itemUid under the SAME playerId for its whole life") — and every caller already
holds the owning player id: its own, or a participant id from a run's reward
split. `listWarehouseItemsPg` has always filtered on `player_id`, so any row
that a scoped read would now miss was already invisible to the warehouse list.

## 4. Gate results (2026-07-28)

| gate | before | after |
|---|---|---|
| `STORAGE_BACKEND=pg node server/tests/api_test.cjs` | **221 passed / 1 failed** | **222 passed / 0 failed** |
| `node server/tests/api_test.cjs` (files) | 222 / 0 | 222 / 0 |
| `tools/release.sh` (full ci.sh) | red at [5/7] | see below |

Reproduced red three times before the change (twice inside `release.sh`, once
standalone) and green on both backends after.

## 5. Files

- `server/storage/warehouse.cjs` — `readWarehouseItemPg`, `deleteWarehouseItemPg`
- `server/storage/gacha.cjs` — `readGachaPendingPg`, `deleteGachaPendingPg`

No client, content, or schema change. No migration: the `player_id` column
already exists and is already populated by the write paths.

## Log
- 2026-07-28 found via REQ-0331's release gate; reserved as REQ-0333 on branch
  req-0333-warehouse-pg-owner-scope (branched from master 0129152).
- 2026-07-28 fixed, both backends green, full gate run; reserved -> built.
