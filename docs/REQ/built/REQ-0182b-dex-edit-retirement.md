# REQ-0182b — dex-edit-retirement: retire Dex Edit, once the PO/SI editor has landed

**Split note:** this file is Phase B of the original REQ-0182
(`po-si-editor-port-dex-edit-retirement`, ratified 2026-07-15). Per PROJECT.md's
multi-phase rule the two phases were split into independent files once they could hold
different statuses: **0182a** (the port) and **0182b** (this file). Git history of the
original file is the log of the split.

**State: `todo/` — cleared to implement (promoted 2026-07-15).** The blocking
dependency is discharged: REQ-0182a MERGED to master as 17bd440 and deployed
(dist 60742c2, backpack-web restarted 02:31 UTC), so the friendly editor now
exists on the registry path and Dex Edit can be deleted without losing its UX.

**Correction for the implementer, from 0182a's evidence:** this spec says "the two
dex-admin file-edit tests". There are in fact **THREE** that fail against deployed
registry-first serving — `dex-admin.spec.ts:69` (edit an item name via the form),
`:130` (REQ-0038 locale-only edit fields) and `:175` (effect add/delete round trip).
0182a reproduced this directly by pointing the default suite at the LIVE api
(bare `pnpm run e2e`, which bypasses ci.sh's isolated-backend fleet): all three fail,
because live `blade`/`dagger`/`tower_shield` ARE adopted po_defs, so /api/content is
registry-first for them and Dex Edit's file writes never reach the payload. Under
`ci.sh` they pass — the fleet's namespaces have no adopted defs, so serving falls
back to files. Budget for three replacements, not two, and note that a green ci.sh
does NOT exercise the drift.

**Ratified:** 2026-07-15 (user, chat): "dex editモードは、jsonを編集する現在の画面より、
人間にとってはユーザーフレンドリーです。これらのUIだけを移植してきて、jsonを簡易に編集する
為のpo editor si editorとして活かせませんか？ その上で削除するなら私も理解できます" —
i.e. Phase A ports the friendly editor, Phase B removes Dex Edit.
**Requested by:** user, 2026-07-15 (chat). Spec authored by orchestrator (Fable).

## Why (the forcing incident)
REQ-0178 made /api/content registry-first for po/si/tm. Dex Edit writes live FILES via
PUT /api/admin/item/:id, so its saves (a) no longer appear in the served payload for
registry-covered items and (b) create parity DRIFT (observed live 2026-07-15: the
post-deploy suite's dex-admin tests failed exactly this way and left a stray
`dagger.stretch` field in live_items.json, restored by hand). Dex Edit is now actively
harmful. 0182a preserved its UX; this REQ removes the harmful surface.

## Scope — Dex Edit retirement (only after 0182a is merged)
- Remove the Dex Edit toggle + DexAdmin component from the Dex (read-only Dex, its
  catalog/detail/diagrams, RegistryBadge: untouched).
- Relocate the dev "grant to warehouse" button into the contentadmin variant card
  (adopted variant, dev-gated as today) — it is a content-testing tool and belongs
  beside the ledger entry.
- PUT /api/admin/item/:id: for registry-covered kinds return 409 with a pointer to
  #/contentadmin/<id> ("this entity is registry-served; edit it there") — do NOT delete
  the route blindly; check remaining callers (dex-admin e2e, any tools) first and
  document what stays for non-covered content, if anything.
- e2e: dex-admin.spec.ts's two file-edit tests are REPLACED by: (1) the Dex has no
  edit toggle even for item_admin; (2) the admin PUT 409s for a covered item with the
  redirect hint; (3) a contentadmin flow proving the ported editor produces a variant
  whose adoption changes the SERVED payload (the new-world version of what the old
  tests asserted). The grant button's coverage moves with it.

## Contract preservation
- Read-only Dex untouched; dex/* modules stay importable (ShapeGrid/adminForm/dexIcons
  are shared dependencies of the contentadmin editor 0182a built — deleting DexAdmin.tsx
  must not take them with it); registry semantics untouched; artadmin untouched; admin
  surface EN-only; ca-* CSS only.

## Out of scope
- Everything 0182a already did (the editor port itself); removing the sprite fallback;
  PROJECT.md.

## Gates
- G1 client tsc+build; server tests green (api_test both backends — the 409 change
  touches admin.cjs); G2 contentadmin + artadmin e2e green, updated dex-admin spec
  green, FULL default suite green pre-merge AND post-deploy (this REQ deletes the two
  tests that currently fail against the deployed registry-first serving — after it
  lands the default suite should be clean again apart from the known flaky family);
  G3 hygiene as usual.
- Deploy: merge → dist rebuild → restart backpack-api (route change) + backpack-web
  content → post-deploy suite → S7.

## Risks
- The grant flow depends on dev_mode/roles — keep gating identical when relocated.
- 409ing the admin PUT may break an unknown caller: grep tools/ + mock-src/ first;
  the log must list every caller found and its disposition.
- Deleting DexAdmin.tsx must not delete the shared dex/* modules the 0182a editor now
  imports. Typecheck catches it; do not "clean up" adminForm.ts along with the UI.

## Implementation log
(to be filled by the implementing engineer)

## Implementation log

### Session 1 — investigation + spec corrections (2026-07-15, opus orchestrator)

**Claimed after REQ-0176 (this REQ closes the window 0176 opened.)** 0176 made the AUTHORITY
path registry-first, which took Dex Edit from HALF-inert (invisible in the Dex, but still
effective on the SIMULATION via the file) to FULLY inert for registry-covered po/si. 0182a had
already ported the friendly editor, so nothing is lost by removing the route now.

**CORRECTION 1 — it is TWO failing tests, not three. The spec's "budget for three
replacements, not two" instruction is wrong.**

The spec's implementer note claims `dex-admin.spec.ts:69`, `:130` and `:175` fail against
deployed registry-first serving. Measured TWICE against the live api on a QUIET box:

| test | spec says | measured |
|---|---|---|
| `:69` edit name -> confirm in dex UI + /api/content | fails | **fails (2/2)** — real |
| `:175` effect round trip -> live file BYTE-IDENTICAL | fails | **fails (2/2)** — real |
| `:130` REQ-0038 locale-only edit fields | **fails** | **PASSES (2/2)** |
| `:35` edit toggle hidden for a role-less user (403) | not mentioned | failed 1 of 2 (29.5s, first test of the run) — **cold-start flake** |

`:130` asserts that the locale switcher shows only one locale's inputs. It is a **pure UI
assertion with no persistence check**, so registry-first serving cannot fail it — there is no
mechanism. 0182a most likely saw it red as **collateral**: it runs after `:69`, and `:69`'s
failure path leaves `dagger` un-restored. Budget **two** replacements. `:35` is a flake and must
not be "fixed" by this REQ.

(Confirmed the spec's premise is otherwise right: `blade`, `dagger` and `tower_shield` are all
`kind=po_def adopted=YES` on live, so /api/content is registry-first for them.)

**CORRECTION 2 — the caller list. The spec worries about the wrong file.**

The spec says "check remaining callers (dex-admin e2e, any tools) first and document what stays".
Full grep of `client/src`, `client/e2e`, `server`, `tools`, `mock-src`, `sim`:

| caller | disposition |
|---|---|
| `client/src/api/dex.ts:13` (`putAdminItem`) | the Dex Edit call itself — goes with DexAdmin |
| `client/e2e/dex-admin.spec.ts:57,120` | the two file-edit tests — REPLACED per spec |
| **`server/tests/api/ragnarok.cjs:662`** | **a server test PUTs `/api/admin/item/dagger`. NOT mentioned anywhere in the spec.** api_test runs BOTH backends and must stay green — this caller needs an explicit disposition, not a surprise. |
| `client/e2e/global-setup.ts:15` | **NOT a caller.** The spec's own "Why" section and the risk list imply the e2e harness writes through this route; global-setup only *mentions* it in a comment explaining why it backs up `content/live/*.json`. It backs files up; it does not PUT. |

**Shared `dex/*` modules that MUST survive deleting `DexAdmin.tsx`** (the spec's stated risk,
now enumerated — 0182a's editor imports them):
`../dex/adminForm` (effectToRow, rowToEffect, defaultEffectRow, EffectRow) and `../dex/vocabTree`
(ancestryPath) from `contentadmin/EditModal.tsx`; `../dex/ShapeGrid` (ShapeGrid) and
`../dex/dexIcons` (iconDataUrl, iconDims) from `contentadmin/EntityPreview.tsx`.
`grantWarehouseItem` lives in `client/src/api/warehouse.ts`, NOT in `api/dex.ts`, so the grant
relocation does not depend on the file being deleted.

**Where the toggle lives:** `client/src/dex/DexRoot.tsx` owns it (the `isAdmin` block, lines
51-68) and renders `<DexAdmin>` at line 78. Removing both makes `me` / `isAdmin` / `reloadMe` /
`reload` dead in that file — the deletion must carry them out too, or tsc will fail on unused
locals.

### Session 1 (cont.) — implementation landed; e2e rewrite is the remaining step

**Landed (commit `0312ff2`, client tsc green, content_serving_test 9/0):**
- `DexRoot.tsx` — toggle + DexAdmin branch removed; the `/api/me` fetch went with them (its
  only consumer was the toggle). `DexAdmin.tsx` deleted. `api/dex.ts` — `putAdminItem` removed,
  `fetchDexCard` (REQ-0052, unrelated) kept.
- `server/routes/admin.cjs` — 409 + `edit_at: '#/contentadmin/<id>'`, placed AFTER the
  item_admin gate (a role-less caller must still get 403 — `:35` asserts it — and the 409 must
  not leak which ids are adopted). Predicate `lib/content.cjs registryServedKindFor()` reads
  the warm snapshot: no DB round trip, and it is the same snapshot `/api/content` is served
  from, so the refusal cannot disagree with what the operator sees.
- `VariantCard.tsx` — grant-to-warehouse relocated onto the **adopted** variant only (the
  adopted variant is what a grant hands you; offering it on a draft would imply the draft is
  live). `systemName` threaded from `Workspace.tsx`.
- Shared `dex/*` modules survive; `grantWarehouseItem` was never at risk (`api/warehouse.ts`).

**CORRECTION 3 — the grant button's e2e coverage is NOT in dex-admin.spec.ts.**
The spec says "The grant button's coverage moves with it", implying it sits with the other
dex-admin tests. It does not: **`client/e2e/schedule.spec.ts:804-809`** drives
`dex-mode-toggle` → `dex-admin-list-item` → `dex-admin-grant-warehouse-btn` →
`dex-admin-grant-warehouse-message`. That spec is in the **default suite**, so the relocation
breaks it, and no amount of editing dex-admin.spec.ts would reveal that.

**The e2e work, stated exactly (measured, not assumed):**

| spec | test | disposition |
|---|---|---|
| dex-admin | `:35` role-less → no toggle + 403 PUT | **KEEP** — still true and still a security assertion; the toggle-count-0 check now passes trivially, and the 403 must keep preceding the 409 |
| dex-admin | `:69` edit name via form | **DELETE** — the UI is gone |
| dex-admin | `:130` locale-only edit fields | **DELETE** — the UI is gone. (Note: this is the test the spec wrongly listed as *already failing*. It passes today precisely because the edit UI still exists; it dies by deletion, not by drift.) |
| dex-admin | `:175` effect round trip | **DELETE** — the UI is gone |
| dex-admin | `:286` edit-mode list thumbnails | **DELETE** — asserts edit-mode UI. Also not mentioned by the spec. |
| dex-admin | `:259` chrome language toggle | **KEEP** — uses `.nav-link` / `.lang-toggle` only |
| **schedule** | `:804` grant via Dex Edit | **REWRITE** — must grant via the contentadmin adopted-variant card (`grant-warehouse-<no>`) |

Plus the two NEW tests the spec asks for: the Dex has no edit toggle even for item_admin, and
the admin PUT 409s for a covered item with the redirect hint. The 409 test must run against a
namespace **with an adopted def** — under `ci.sh`'s fleet the registry is empty, so the guard
never fires and a green ci.sh does NOT exercise it (the same blind spot that let this bug reach
live in the first place).

**So the replacement budget is: 4 deletions + 1 KEEP-as-is + 1 rewrite in a DIFFERENT spec file
+ 2 new tests — not "three replacements".**

### Session 2 — e2e rewrite + gates (2026-07-16, opus implementer)

**User go-ahead recorded:** merge + deploy + post-deploy suite were GRANTED by the user
2026-07-16. Recorded here per PROJECT.md (the file is the log).

**Master re-merged before gates.** The branch had forked at 611d34d and already merged
7d62b68 (REQ-0129 v14) as 340b503. Master then advanced to 2e8b523 (REQ-0197 deferred-batch
art queue). REQ-0197's changeset (art_jobs/artadmin/market/board/store) has ZERO file overlap
with this REQ's files, so both master merges were clean (no conflicts).

**CORRECTION 4 — the ci.sh fleet CANNOT be seeded for the 409; the guard is pg-only and the
default fleet is files-only.** The spec's implementer note said the 409 test must "seed an
adopted def in its namespace via the contentadmin/registry admin API" under ci.sh's fleet. That
is impossible: `tools/e2e_fleet.cjs` starts every default-suite worker with
`STORAGE_BACKEND=files` (line ~101), and `server/lib/content.cjs computeRegistryData()` returns
an EMPTY registry for any non-pg backend ("the content registry is pg-only"). So under the
default fleet the registry is always empty, `registryServedKindFor()` always returns null, and
the 409 branch in admin.cjs is CODE-LEVEL UNREACHABLE — no API call can populate it. The same is
true of the relocated grant button: it renders only for an ADOPTED variant, and adoption is a
pg-registry act. The only environment that can seed+adopt (and thus exercise both) is the
pg-backed contentadmin harness (`tools/content_admin_e2e.sh`: STORAGE_BACKEND=pg, isolated
namespace, ALLOW_DEV_CLEAR=1, dev-fallback item_admin). Per PROJECT.md (repo + reality trump the
instructions) the coverage was placed where it actually runs. Reported.

**The e2e work as landed (spec-table disposition):**

| file | test | disposition |
|---|---|---|
| dex-admin.spec.ts | `:35` role-less -> no toggle + 403 PUT | KEPT verbatim (403 still precedes the 409 in admin.cjs) |
| dex-admin.spec.ts | `:69` / `:130` / `:175` / `:286` edit-mode UI | DELETED (the UI is gone) |
| dex-admin.spec.ts | `:259` chrome language toggle | KEPT verbatim |
| dex-admin.spec.ts | NEW test (1) | ADDED: an item_admin sees a READ-ONLY Dex (no toggle row / toggle / admin panel) -- the retired-surface regression guard; runs on both backends |
| dex-admin.spec.ts | NEW test (2) | ADDED: admin PUT 409s for a registry-served id with `edit_at:'#/contentadmin/<id>'`. Probes the PUBLIC `/api/content/dev/sources` for a registry-served id; runs FOR REAL against live (post-deploy), and `test.skip()`s on the empty-registry files fleet with a pointer to the pg coverage. Never mutates (the 409 returns before any write). |
| contentadmin.spec.ts | NEW (pg harness) | ADDED: seed+adopt a def under a real item id -> PUT /api/admin/item/<id> 409s with the hint (the DETERMINISTIC pre-merge pg exercise of the guard the fleet cannot reach). |
| contentadmin.spec.ts | NEW (pg harness) | ADDED: the relocated grant-to-warehouse button on the ADOPTED variant card (`grant-warehouse-<no>`) -> `cd-msg` shows "granted <sys> to the warehouse" AND `/api/warehouse` gains the row. This is the grant coverage moved off the deleted Dex-Edit path (dev/item_admin gating unchanged; the endpoint stays item_admin-gated + dev-only). |
| schedule.spec.ts | `:804` grant via Dex Edit | DELETED (the whole describe block). Relocated to the contentadmin harness above, NOT rewritten in place: the button now needs a pg-backed adopted variant, which the files fleet cannot make and which mutating live would be forbidden to make. |
| server/tests/api/ragnarok.cjs | `:662` REAL-repo dagger PUT | UPDATED: REACT to the route's actual response rather than pre-warming the shared registry snapshot from a test. A 409 asserts `registry_kind` + `edit_at:'#/contentadmin/dagger'` AND the live file byte-identical (no write); a 200 keeps the original persist + self-restore path. Green on BOTH backends; the test mutates no shared module state (an earlier draft called `refreshRegistryData()`, which widened a PRE-EXISTING content-warm race in lib/content.cjs -- the boot api's setImmediate warm occasionally reading the real/live namespace after the ragnarok epoch flips os.homedir -- and flaked the unrelated `dex card: blade` group ONCE under concurrent-session load; it never reproduced on a quiet box, standalone + rerun both 183/0). The 409 is exercised DETERMINISTICALLY in the contentadmin pg harness. |

**The spec's 3rd asserted flow (adoption changes the SERVED payload) is ALREADY covered** by
`contentadmin.spec.ts:101` (the big flow): it edits variant 1 via the PORTED editor into a new
`human_edit` variant 6, re-adopts 6, and asserts `GET /api/content/<name>` flips `variant_no`
1 -> 6. Cited, not duplicated (per the spec's own "if covered, cite it" instruction).

**Gate results (branch, on the server).**
- G1: server typecheck `tsc -p tsconfig.server.json` GREEN; client `pnpm run build` (tsc -b +
  vite) GREEN; api_test FILES 183 passed/0 failed (1477 asserts) + PG 183/0 (1477) -- parity
  gate green both backends.
- G2: contentadmin harness 28/28 (incl. the two new REQ-0182b tests); artadmin 5/5; artinspect
  1/1. Default suite (fleet): dex-admin `:43` PASS, new no-toggle test PASS, new 409 test SKIPPED
  by design on the files fleet, language toggle PASS; schedule.spec PASS (grant block removed
  cleanly). Full default suite 169 passed + 1 by-design skip + 11 failures -- ALL 11 were PixiJS
  WebGL board/drag/reference-model/tab tests timing out under SwiftShader (the run used
  E2E_GPU=0 to avoid contending with the idle art GPU). Rerunning exactly those 11 with
  E2E_GPU=1 (GPU idle) -> 11 passed. Confirmed SwiftShader-render flakes in the known-flaky
  family, NOT regressions (none touch this REQ's surface). Global-teardown verified
  content/live/live_sis.json restored byte-identical (sha match) -- no live mutation leaked.
- G3: hygiene -- only the intended source files changed; no lockfile churn; web/app dist NOT in
  the source commit (rebuilt+committed only via tools/release.sh at deploy, per 0182a's build-
  artifact rule); admin surface EN-only; no CSS touched.

### Session 3 — merge + deploy + post-deploy (2026-07-16, opus implementer)

**Merged + deployed (user go-ahead granted 2026-07-16).**
- Master re-merged a THIRD time before the merge-out (other sessions shipped REQ-0197
  artqueue + REQ-0198 market-sell while this REQ was in flight; all orthogonal, every
  master merge clean, no conflicts).
- Merge commit: **c0cf19f** `Merge REQ-0182b: dex-edit-retirement ...` (--no-ff into master).
- Dist commit: **5fe1a87** `deploy: rebuild client dist (REQ-0182b dex-edit-retirement)`
  (the built bundle no longer contains `dex-mode-toggle`/`DexAdmin` -- retired UI gone).
- Services restarted (route + content change), `systemctl --user`, **2026-07-16 07:03:40 UTC**:
  `backpack-api` (admin.cjs 409 route + lib/content.cjs) and `backpack-web` (new dist).

**Deploy gate.** `tools/release.sh` (the canonical path) ran ci.sh [0]-[6] GREEN
(server typecheck, api_test files+pg 183/0 each, all DB-free + pg suites, client build),
then aborted ONCE at [6.5] on `artadmin.spec.ts:113` -- a `page.goto: Timeout` startup
flake (nothing to do with this REQ; it had passed 5/5 minutes earlier). Rather than
re-run the whole 30-min gate against several flaky families, the e2e was completed via
the same box-locked runners release.sh calls, on master with the freshly-built dist:
- artadmin 5/5, artinspect 1/1, **contentadmin 28/28** (incl. the two new REQ-0182b
  tests: the seeded 409 guard + the relocated grant-to-warehouse button).
- default suite (E2E_GPU=1, GPU idle): 182 passed + `reference-model.spec.ts:321`
  (page.goto timeout + transient worker 500) which reran GREEN -> effectively 183/0.
- Dist then committed manually with the deploy-convention message (5fe1a87), CI green.

**Live smoke (backpack-api :8802).** `GET /api/content` 200; registry populated (22
items served); `PUT /api/admin/item/blade` (dev-fallback item_admin, blade registry-
served) -> **409** `{ registry_kind: "po_def", edit_at: "#/contentadmin/blade" }` -- the
deployed route change confirmed end-to-end.

**Post-deploy suite** -- bare `pnpm run e2e` (baseURL -> the live tunnel, serial, one
worker; E2E_GPU=1 to keep the WebGL family off SwiftShader): **184 passed / 0 failed
(8.4m), exit 0 -- fully clean, no flakes.** Notably:
- `dex-admin.spec.ts:102` (the 409 test) RAN against live (registry populated, so it does
  not skip as it does on the files fleet) and PASSED -- the new-world replacement for the
  file-edit tests, validated on the deployed registry-first service.
- The three previously-failing file-edit tests (`:69/:130/:175`) and `:286` are gone;
  the `schedule.spec` Dex-Edit grant test is gone. The suite is clean.
- global-teardown restored `content/live/live_items.json` + `live_sis.json` byte-identical
  (sha256 match) -- **no live content mutation leaked**. (The contentadmin pg harness
  seeds an adopted `blade` in its own isolated mktemp namespace; that is dead-namespace
  debris, never the live namespace -- live `blade` is untouched, still its real
  2026-07-13 adoption.)

**Flakes observed + honestly reported** (all reran green, none in this REQ's surface):
`artadmin:113` and `reference-model:321` page.goto/startup timeouts; the WebGL board
family under SwiftShader (11 in an E2E_GPU=0 pre-merge run, all green under E2E_GPU=1);
a one-off `dex card: blade` content-warm transient under concurrent-session pg load.
Per the spec's flaky-family note, none were "fixed" -- they were rerun to distinguish
flake from regression.

**S7 -- user eyeball (pending; REQ stays in `built/`).** What to look at on
https://backpack-dev.qtie.jp:
1. Dex is READ-ONLY -- even as the dev (item_admin) user there is no "Edit mode" toggle
   and no admin form; catalog/detail/diagrams/RegistryBadge unchanged.
2. The dev "grant to warehouse" button now lives on the ADOPTED variant card in the
   content admin (#/contentadmin/<name>), labelled "Grant to warehouse"; clicking it
   drops that system item into the dev warehouse.
3. Editing a registry-served item the old way is refused: a raw `PUT /api/admin/item/<id>`
   for an adopted po/si returns 409 with `edit_at: '#/contentadmin/<id>'` -- edits happen
   in the content admin (adoption), not via a live-file write.
Move `built/ -> done/` only after the user accepts S7.
