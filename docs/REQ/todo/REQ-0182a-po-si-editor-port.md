# REQ-0182a — po-si-editor-port: port the DexAdmin editor UX into contentadmin

**Split note:** this file is Phase A of the original REQ-0182
(`po-si-editor-port-dex-edit-retirement`, ratified 2026-07-15). Per PROJECT.md's
multi-phase rule the two phases were split into independent files once they could
hold different statuses: **0182a** (this file, the port) and **0182b** (the Dex Edit
retirement, `draft/` until 0182a is merged). The sequence binding is unchanged —
**A must land before B**. Git history of the original file is the log of the split.

**Ratified:** 2026-07-15 (user, chat): "dex editモードは、jsonを編集する現在の画面より、
人間にとってはユーザーフレンドリーです。これらのUIだけを移植してきて、jsonを簡易に編集する
為のpo editor si editorとして活かせませんか？ その上で削除するなら私も理解できます" —
i.e. Phase A ports the friendly editor, Phase B removes Dex Edit. Cleared to implement.
**Requested by:** user, 2026-07-15 (chat). Spec authored by orchestrator (Fable).

## Why now (the forcing incident)
REQ-0178 made /api/content registry-first for po/si/tm. Dex Edit writes live FILES via
PUT /api/admin/item/:id, so its saves (a) no longer appear in the served payload for
registry-covered items and (b) create parity DRIFT (observed live 2026-07-15: the
post-deploy suite's dex-admin tests failed exactly this way and left a stray
`dagger.stretch` field in live_items.json, restored by hand). Dex Edit is now actively
harmful — but its FORM UX is better than contentadmin's edit modal, and the user wants
that UX preserved by porting, not lost by deletion. This REQ does the preserving; 0182b
does the deleting.

## Scope — the PO/SI editor (port the DexAdmin UX into contentadmin)
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

## Contract preservation
- Read-only Dex untouched; dex/* modules stay importable (ShapeGrid/adminForm/dexIcons
  are shared dependencies now); registry semantics untouched; artadmin untouched;
  admin surface EN-only; ca-* CSS only.
- Dex Edit stays exactly as-is in this REQ — it is 0182b that removes it.

## Out of scope
- Everything in 0182b (Dex Edit toggle removal, grant-button relocation, the admin PUT
  409, the dex-admin spec rewrite).
- Shape/align/part form editing (JSON tab covers them); monster/skill/tm/unit form
  editors (fallback JSON tab as today); removing the sprite fallback; PROJECT.md.

## Gates
- G1 client tsc+build; server tests green.
- G2 contentadmin + artadmin e2e green; FULL default suite green pre-merge. NOTE: the
  two dex-admin file-edit tests that fail against registry-first serving are NOT fixed
  here — they are 0182b's to replace. Their failure is the known, expected state until
  0182b lands and must be reported as such, not "fixed" by touching Dex Edit.
- G3 hygiene as usual.
- Deploy: merge → dist rebuild → restart backpack-web content → post-deploy suite → S7.
  (No route change in this REQ, so no backpack-api restart.)

## Risks
- The ported editor must not regress REQ-0173's passthrough serialization — an unedited
  field silently dropped is a content-corrupting bug the JSON tab would hide.

## Implementation log
(to be filled by the implementing engineer)
