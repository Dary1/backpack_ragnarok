# REQ-0351 — Collapse `invalidateServedContent()`'s double refresh to one

**Status:** Done (merged, deployed, live-verified)
**Reserved:** 2026-07-31
**Slug:** invalidate-served-content-collapse
**Origin:** REQ-0348 §9 "Follow-ups this REQ deliberately did not take"
**Depends on:** **REQ-0348 must be merged first** — this REQ is only true because of
it. **Blocks:** nothing.

---

## 1. Problem

`server/routes/content.cjs:85-91`:

```js
function invalidateServedContent() {
  return Promise.all([
    require('../lib/content.cjs').refreshRegistryData(),
    require('../services/core.cjs').refreshRegistryData(),
  ]).catch(() => {});
}
```

Before REQ-0348 those were two different functions maintaining two different
snapshots, and awaiting both was exactly right. After REQ-0348 there is one
snapshot: `lib/content.cjs`'s `refreshRegistryData` is a one-line delegation to
`services/core.cjs`'s. So this fires **the same recompute twice, concurrently**,
on every adopt / edit / delete / patch.

It is not merely redundant:

- `computeRegistryData()` issues one `storage.resolveAdoptedContentData()` call
  **per kind** — 10 kinds — so every content mutation now makes 20 registry round
  trips where 10 would do. On the adopt path that is the latency the operator
  waits on.
- The two runs race to assign `registryData` / `registryAt`. Benign today (same
  inputs, same output, last writer wins), but it is a race that is *correct by
  coincidence* rather than by construction, and the next person to reason about
  snapshot freshness has to re-derive that.

## 2. Why it was left out of REQ-0348

This call site **is** the display/authority determinism contract, and
`routes/content.cjs:78-84` says so in place:

> Both refresh from THIS ONE call site, on purpose: a mutation that refreshed
> only one would leave display and roll disagreeing, which is precisely the drift
> REQ-0176 exists to kill. If a third snapshot is ever added, it belongs here too.

That comment is now describing a world with one snapshot, so it needs rewriting
rather than deleting — the *invariant* it protects (a mutation is not
acknowledged until the served view reflects it) is unchanged and still load-
bearing for the wiring e2e. Doing that inside REQ-0348 would have mixed a
contract edit into a mechanical de-duplication. Hence its own REQ.

## 3. Goal

One recompute per mutation, with the determinism contract restated for a
one-snapshot world.

## 4. Proposed change

```js
// REQ-0348 made this ONE snapshot; REQ-0351 collapsed the call. The await is
// still the contract: the adopt/edit/delete/patch handlers do not answer until
// the served view reflects the mutation (the wiring e2e determinism contract,
// REQ-0176/REQ-0178). If a SECOND snapshot is ever introduced, it belongs here
// too -- and that is the moment to ask why it exists at all.
function invalidateServedContent() {
  return require('../services/core.cjs').refreshRegistryData().catch(() => {});
}
```

## 5. One choice for the implementer (non-blocking)

Does `lib/content.cjs` keep exporting its delegating `refreshRegistryData`?

- **(a) Keep it.** `server/tests/content_serving_test.cjs` names it at 6 call
  sites, and it reads naturally there — that file tests the DISPLAY path.
  A facade re-export over the real owner is this codebase's own established
  pattern (`storage.cjs` REQ-0145a sb, `schedule.cjs` REQ-0047 c).
  **Recommended.**
- **(b) Drop it**, and point the test at `services/core.cjs`. One name for one
  operation. Costs a 6-line test edit and makes a display-path test import the
  authority module.

(a) is recommended because a delegation is not a duplicate — the thing REQ-0348
removed was a second *implementation*, not a second *name*.

## 6. Scope

**In:** `server/routes/content.cjs` (`invalidateServedContent` + its comment),
optionally `server/lib/content.cjs`'s export and
`server/tests/content_serving_test.cjs` under §5(b), and the new gate in §7.
**Out:** everything else REQ-0348 touched; the `monster_pack` serving gap
(its own REQ); `services/core.cjs`'s low cohesion (audit item P3).

## 7. Gates

1. `cd server && node tests/api_test.cjs` — 229 passed, 0 failed.
2. `STORAGE_BACKEND=pg node tests/api_test.cjs`.
3. `node tests/content_serving_test.cjs` (pg) — 9/0. This is the file that pins
   "adopting a new variant changes the served payload within one refresh", i.e.
   the contract this REQ must not weaken.
4. `node tests/schedule_serving_test.cjs` (pg) — 13/0, the authority half of the
   same contract.
5. **New assertion (the point of the REQ):** extend
   `server/tests/registry_overlay_test.cjs` (REQ-0348, DB-free, already stubs
   `storage.resolveAdoptedContentData` and records every `(kind, names)` ask) so
   that ONE `invalidateServedContent()` produces exactly ONE ask per kind. That
   turns "we collapsed the duplicate" into something that stays collapsed.
6. `tools/ci.sh` full run.

## 8. Expected result

Registry round trips per content mutation halve (20 -> 10). No behaviour change
otherwise: same snapshot, same await, same determinism.

## 9. Status log

- 2026-07-31 — reserved and specced straight into `todo/` at the user's request,
  from REQ-0348 §9. Not started. Do not implement before REQ-0348 is merged:
  on `master` as it stands today the two calls are still genuinely different.

## 10. Implementation record (2026-08-01)

- Branch `req-0351-invalidate-served-content-collapse`, code commit **fc0bb166**
  (tree `d4cd2a42` == the ci-receipt tree).
- §5 choice taken: **(a)** — `lib/content.cjs` keeps its delegating
  `refreshRegistryData` facade; `content_serving_test.cjs` untouched.
- Files changed: `server/routes/content.cjs` (collapse + contract comment
  rewritten per §4; added `_invalidateServedContent` test export alongside the
  existing `_normalizeProvenance`-style exports) and
  `server/tests/registry_overlay_test.cjs` (new case (D), the §7.5 gate).

### Gate results

1. `node tests/api_test.cjs` (files) — 229 tests, 0 failed, 1948 assertions.
2. `STORAGE_BACKEND=pg node tests/api_test.cjs` — 229 tests, 0 failed,
   1950 assertions.
3. `node tests/content_serving_test.cjs` (pg) — 9 pass / 0 fail.
4. `node tests/schedule_serving_test.cjs` (pg) — 13 pass / 0 fail.
5. New §7.5 assertion — green; **verified red against the pre-patch code**
   (restored the old Promise.all with only the test export added: all 11 kinds
   asked x2, case (D) FAILs; with the collapse: x1, PASS).
6. `tools/ci.sh` full run — CI GREEN, 327.8s, receipt written for tree
   `d4cd2a42`.

Result matches §8: registry asks per kind per content mutation 2 → 1 (11 kinds
live rather than the spec-time 10 — `unit_skin` joined the list since), same
await, same determinism contract.

## 9′. Status log (cont.)

- 2026-08-01 — implemented, all §7 gates green, todo → built (code commit
  fc0bb166). Not merged, not deployed.

## 11. Deploy record (2026-08-01)

- Merged to master as **458b09e1** (no-ff) on user go-ahead ("go merge").
- Released as part of the combined REQ-0351 + REQ-0349 + REQ-0350 release: a
  concurrent session merged 0349/0350 on top of 458b09e1 and ran
  `tools/release.sh` over the combined tree — full unscoped gate + content
  drift gate GREEN (MATCH=413 DRIFT=0), dist rebuild **1b88a2ac**, ci-receipt
  written for the master tree.
- Pushed to origin and offsite (master @ 1b88a2ac); `backpack-api` restarted
  09:02:47 UTC.
- Live-verified: the running checkout has zero `Promise.all` in
  `routes/content.cjs` (the collapse is what is serving); `/api/content` 200
  both on 127.0.0.1:8802 and via https://backpack-dev.qtie.jp.

## 9″. Status log (cont.)

- 2026-08-01 — merged (458b09e1), released (1b88a2ac), deployed, live-verified;
  built → done.
