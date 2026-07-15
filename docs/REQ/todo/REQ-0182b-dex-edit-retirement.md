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
