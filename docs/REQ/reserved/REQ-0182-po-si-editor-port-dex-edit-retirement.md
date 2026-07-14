# REQ-0182 — po-si-editor-port-dex-edit-retirement: port the DexAdmin editor UX into contentadmin, THEN retire Dex Edit

**Ratified:** 2026-07-15 (user, chat): "dex editモードは、jsonを編集する現在の画面より、
人間にとってはユーザーフレンドリーです。これらのUIだけを移植してきて、jsonを簡易に編集する
為のpo editor si editorとして活かせませんか？ その上で削除するなら私も理解できます" —
i.e. Phase A ports the friendly editor, Phase B removes Dex Edit. Cleared to implement
(sequence binding: A must land before B).
**Requested by:** user, 2026-07-15 (chat). Spec authored by orchestrator (Fable).

## Why now (the forcing incident)
REQ-0178 made /api/content registry-first for po/si/tm. Dex Edit writes live FILES via
PUT /api/admin/item/:id, so its saves (a) no longer appear in the served payload for
registry-covered items and (b) create parity DRIFT (observed live 2026-07-15: the
post-deploy suite's dex-admin tests failed exactly this way and left a stray
`dagger.stretch` field in live_items.json, restored by hand). Dex Edit is now actively
harmful — but its FORM UX is better than contentadmin's edit modal, and the user wants
that UX preserved by porting, not lost by deletion.

## Phase A — the PO/SI editor (port the DexAdmin UX into contentadmin)
Upgrade the edit-as-new modal (REQ-0173 EditModal) into a full-size PO/SI editor whose
form affordances are AT LEAST DexAdmin parity (client/src/dex/DexAdmin.tsx is the
reference; reuse adminForm.ts EffectRow grammar — already imported):
- Layout: full-height editor surface (modal may stay, but sized like the Dex editor,
  entity preview beside the form — the operator sees the shape/icon/art context while
  editing, which DexAdmin's list thumbnails provided).
- Locale handling: EN/JA switcher for name/flavor (DexAdmin's "never both at once" is
  the friendlier pattern per the user; keep the current side-by-side only if the
  switcher proves worse — decide and document).
- rarity select from vocab.rarities; tags multi-select from trees.po with ancestry
  labels (DexAdmin's tagOptions/rootTagOptions logic); stretch checkbox (po only);
  effects: template ADD (defaultEffectRow(vocab)), per-row DELETE, per-row
  trigger/verb/param dropdowns constrained by vocab (DexAdmin's exact row grammar).
- The JSON tab stays (advanced escape hatch, two-way sync, passthrough-preserving
  serialization over the original variant data — REQ-0173 semantics unchanged).
- Registry semantics unchanged: submit = editVariant → NEW human_edit variant with
  lineage; adoption stays the explicit separate act.
- Testids: keep every edit-* testid; new form controls get documented testids.

## Phase B — Dex Edit retirement (only after A is merged)
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
  are shared dependencies now); registry semantics untouched; artadmin untouched;
  admin surface EN-only; ca-* CSS only.

## Out of scope
- Shape/align/part form editing (JSON tab covers them); monster/skill/tm/unit form
  editors (fallback JSON tab as today); removing the sprite fallback; PROJECT.md.

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

## Implementation log
(to be filled by the implementing engineer)
