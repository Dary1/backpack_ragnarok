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
