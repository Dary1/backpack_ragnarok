# REQ-0221 — e2e-fleet-registry-first-coverage: close the route-level registry-first gap in ci.sh

**Status:** todo — ratified by the user (2026-07-17, chat) AFTER a rescope; see "Correction" below.
**Reserved:** 2026-07-16
**Slug:** e2e-fleet-registry-first-coverage
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」.

## Correction (2026-07-17) — the original draft's premise was stale

This REQ was filed AGENT-PROPOSED off the REQ-0182b finding. On owner review the premise was
re-checked against the tree and found substantially overstated. Recorded here because the
correction, not the original claim, is what this REQ implements.

The draft asserted "under CI the registry is ALWAYS EMPTY and every registry-first code path is
unreachable". That is true of the **default e2e fleet only** (`e2e_fleet.cjs` spawns workers with
`STORAGE_BACKEND: 'files', DATABASE_URL: ''`) — NOT of ci.sh, which already runs these pg-backed
stages mandatorily (they gate on `SKIP_PG`, which CI does not set):

- `[5.36/7]` `content_serving_test.cjs` (REQ-0178 gate D) — seeds an adopted def in an isolated
  pg namespace and asserts registry-first serving, fallback, kind filter, cache invalidation,
  source accounting, the parity classifier, **and REQ-0182b's `registryServedKindFor` predicate**
  (both directions: adopted → `po_def`, empty registry → `null`).
- `[5.37/7]` `schedule_serving_test.cjs` — registry-first SCHEDULE serving (REQ-0176).
- `[5.355/7]` `seed_derive_pg_test.cjs` — art-authoritative seed/derive, isolated pg ns.
- `[6.5/8]` the pg admin e2e trio, incl. `content_admin_e2e.sh` (`STORAGE_BACKEND=pg`, HOME-remapped
  namespace, ports derived `0157`).

Consequences for the draft's three "What to do" candidates:

- **(a) "promote the pg contentadmin harness into ci.sh's mandatory chain if it is not already"
  — already done.** It is step `[6.5/8]`. No-op.
- **(b) teach the fleet a `STORAGE_BACKEND=pg` variant** and **(c) a dedicated harness on
  2210-2219** — both would rebuild coverage `[5.36]` + `[6.5]` already provide. Rejected as
  redundant infrastructure.

Also corrected: the draft cited the REQ-0178 serving drift as proof that "green ci.sh proves
nothing about registry-first behaviour". That drift is the incident that CAUSED `[5.36]` to be
written (as REQ-0178's own gate D). Citing it post-fix inverts the evidence.

## Why (the gap that IS real)

`registryServedKindFor` — the predicate — is covered pg-backed at `[5.36]`. What is NOT covered
anywhere in ci.sh is the **HTTP route wiring on top of it**: that `PUT /api/admin/item/:id`
actually calls the predicate, returns **409**, and returns the `edit_at: '#/contentadmin/<id>'`
hint plus `registry_kind`. A refactor could drop the guard from the route and leave `[5.36]`
green, because `[5.36]` never issues a request.

The route-level test exists (`client/e2e/dex-admin.spec.ts`, REQ-0182b) but `test.skip`s itself
on the files-backed fleet — correctly, since the guard cannot fire against an empty registry. So
today it proves the route only against the LIVE api / post-deploy, never in ci.sh.

Narrow, accurate statement of the defect: **one route-level assertion is homeless.** It needs a
pg-backed harness with a seeded adopted def — and ci.sh already runs exactly one such harness.

## What to do

- Relocate the REQ-0182b 409 route test out of the fleet-run `dex-admin.spec.ts` and into the
  pg-backed contentadmin harness already mandatory at `[6.5/8]`. Seed an adopted def in the
  harness namespace so the guard genuinely fires; assert `409` + `edit_at` + `registry_kind`
  unconditionally (no `test.skip`).
- Ports: the test moves into an EXISTING harness, so it inherits `e2e_ports.sh 0157`. This REQ
  claims **no** port band; 2210-2219 stay unissued. `check_e2e_ports.cjs` still gates.
- Document in ci.sh which stages cover which serving mode (files fleet vs pg registry-first), so
  the next REQ knows where its coverage belongs. This is the draft's one surviving deliverable
  and is the real fix for the blind spot: the gap was never missing pg coverage, it was that
  nobody could see where pg coverage lived.

## Out of scope
- Changing registry/serving semantics. Replacing the files backend anywhere (files-mode coverage
  is still wanted — the point is BOTH, not a swap).
- A pg fleet variant / dedicated 0221 harness (rejected above as redundant).

## Gates
- Deliberately drop the 409 guard from the legacy PUT for a covered kind → ci.sh alone catches it
  (it does not today). Demonstrated once and recorded below.
- The relocated test runs unconditionally — asserted un-skipped in the harness.
- Full default suite green; `check_e2e_ports.cjs` green; no new port band issued.

## Outcome

**Result: the REQ was already satisfied. Only the documentation deliverable was real.**

Implementation found that the rescope in `f0ea1c9` was ALSO wrong -- less wrong than the original
draft, but wrong. It claimed the 409 ROUTE wiring was homeless. It is not:
`client/e2e/contentadmin.spec.ts:884` already seeds an adopted `po_def` (`blade`), issues the PUT
and asserts `409` + `registry_kind` + `edit_at`, **unconditionally**, inside `content_admin_e2e.sh`
= ci.sh step `[6.5]`. REQ-0182b performed that relocation itself. `contentadmin.spec.ts:903`
likewise already covers the relocated grant-to-warehouse control. The `test.skip` in
`dex-admin.spec.ts` is a live-api duplicate of an assertion covered in `[6.5]`, not a hole -- and
its comment saying so was accurate all along.

So all three of the draft's "what to do" bullets were already done, by REQ-0178 and REQ-0182b.
Nothing was implemented for them. Writing a second copy would have been redundant.

### Gate: "a deliberately introduced registry-first regression is caught by ci.sh alone"
**PASSES today, on unmodified master, with no new harness.** Demonstrated on the pg contentadmin
harness (= ci.sh `[6.5]`), which is the whole of the gate's "ci.sh alone":

| state of `server/routes/admin.cjs` | harness result |
|---|---|
| guard intact | **28 passed** (incl. `:884` 409 test, `:903` grant control) |
| `if (false && servedKind)` -- the REQ's own example regression | **1 failed** at `contentadmin.spec.ts:884`, 27 passed |

The broken run also wrote `content/live/live_items.json` behind the ledger
(`"Longsword Blade"` -> `"must not apply -- registry-served"`) -- the exact drift REQ-0182b's guard
exists to prevent, reproduced on demand. Regression reverted; `admin.cjs` restored byte-identical
(`git diff` empty); `live_items.json` restored.

### What actually shipped
- `c2099b1` -- `tools/ci.sh`: the SERVING-MODE COVERAGE MAP comment block (+ a pointer at the
  `[7/7]` fleet step). No behaviour change. This is the REQ's one surviving deliverable and, it
  turns out, the only real defect: **the gap was never coverage, it was legibility.**
- `f0ea1c9` -- rescope + premise correction. `77c25df` -- draft -> todo.

### Lesson (the reason this REQ was worth doing at all)
Two independent agents -- the one who filed this REQ and the one who implemented it -- read the
same tree and reached the same false conclusion: "ci.sh never exercises registry-first serving",
each proposing to build infrastructure that already existed (a pg fleet variant; a dedicated
0221 harness on 2210-2219). The coverage is spread across `e2e_fleet.cjs` (files),
`content_serving_test.cjs` (pg), and `content_admin_e2e.sh` (pg), and nothing named the split.
An expensive, repeatable misread of a correct system is a documentation defect. Fixed in `c2099b1`.

### Gate results
- `check_e2e_ports.cjs`: green -- 3 harnesses, all derived, no collisions.
- No new port band issued; **2210-2219 remain unissued** (this REQ claims none).
- `content_serving_test.cjs` (pg): 9 pass, 0 fail. `schedule_serving_test.cjs` (pg): 13 pass, 0 fail.
- `content_admin_e2e.sh` (pg, ci.sh `[6.5]`): 28 passed with the guard intact.
- `bash -n tools/ci.sh`: clean.
