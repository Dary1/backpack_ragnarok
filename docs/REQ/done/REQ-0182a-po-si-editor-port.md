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

**Implemented by:** orchestrator (Opus 4.8) session, 2026-07-15. Branch
`req-0182a-po-si-editor-port` (worktree of the same name), off master @ 7bf9da2.

### The split (this REQ's first act)
REQ-0182 arrived as one file holding both phases with a hard sequence binding
("B only after A is merged"). PROJECT.md's multi-phase rule says phases that can
hold different statuses become independent files, and these can: A is cleared,
B is not. Split into `todo/REQ-0182a` (this) + `draft/REQ-0182b`, one move per
commit (32f0c3f, 1148c17). B sits in `draft/` because its blocker is an
unresolved DEPENDENCY (A unmerged), which is exactly what `draft/` denotes; no
user decision is outstanding, so promoting it is mechanical once A merges.

### What the port actually had to close
The REQ frames Phase A as "port DexAdmin's UX". Auditing DexAdmin.tsx against
the REQ-0173 EditModal, most of the form was ALREADY there (rarity select, root
tag select, stretch, effect ADD/DELETE, trigger/verb/n/status dropdowns) — the
REQ's own "reuse adminForm.ts, already imported" is why. The genuine gaps:

1. **The effect grammar was incomplete, and it was losing editability.**
   `every_secs` carries `trigger.s = [lo, hi]` and `amp_status` carries
   `verb.mult`; DexAdmin has inputs for both, EditModal had NEITHER. adminForm's
   `effectToRow`/`rowToEffect` round-tripped the values, so nothing was
   corrupted — but an operator could not CHANGE a tick rate or an amp multiplier
   in the form at all. That is a concrete reason to keep reaching for Dex Edit,
   i.e. exactly the thing this REQ exists to remove. Both are now editable and
   conditional on the trigger/verb that owns them.
2. **No editing context.** DexAdmin's list thumbnails let the operator see the
   entity; the modal showed none. Now a live `EntityPreview` rail sits beside the
   form, fed by the SERIALIZED data — so it is live on the Form tab, equally live
   on the JSON tab, and is literally "what Submit will create". While the JSON tab
   holds unparseable text the rail holds the last valid render rather than
   blanking.
3. **Locale side-by-side, not switched** (decision below).
4. **Tags were free-text.** Now an ancestry-labelled multi-select over trees.po.

### Decisions the REQ asked for
- **Locale: the SWITCHER wins; the side-by-side is gone.** The REQ allowed
  keeping side-by-side "if the switcher proves worse". It is not worse: the user
  named DexAdmin the friendlier surface and the switcher is its pattern, and the
  preview rail now claims horizontal room that the old 2-column
  `name(EN) | name(JA)` grid needed — keeping both would cramp precisely the
  fields most often typed into. Cost, accepted and documented: a locale's testid
  only exists while that locale is selected.
- **Tags go BEYOND DexAdmin** (the REQ says "at least" parity). DexAdmin parses a
  comma-separated string; that cannot show the po/socket hierarchy and silently
  accepts typos as tags. The multi-select offers every trees.po tag labelled by
  ancestry ("Weapon > WeaponPart", via dex/vocabTree's `ancestryPath`).

### Two data-loss traps found and closed while porting
Both are cases where a control that cannot REPRESENT a value silently rewrites it
— the failure mode a "friendly form" invites and the JSON tab would hide:
- **A tag the vocab does not know.** Legacy content can carry one; a select built
  only from trees.po would drop it on the next unrelated edit. Unknown tags are
  now preserved as selected options, labelled `(not in vocab)`. Same for a first
  tag that is not a tree ROOT — the fixture's own `WeaponPart` is a child of
  `Weapon`, so the root select would have silently blanked it. It now offers the
  current value explicitly, mirroring the existing defensive `rarity` pattern.
- **Tag REORDERING.** Caught by the e2e, not by review: a `<select multiple>`
  reports its selection in DOM order, so adding one tag rewrote the whole array
  (`[Metal, Rune]` → `[Rune, Metal]`) and would surface as a spurious diff on a
  field the operator never touched. `patchExtraTags` now keeps each still-selected
  tag in its existing position and appends only genuinely new ones.

### Contract preservation (verified, not assumed)
- REQ-0173 semantics untouched: submit still serializes OVER the original variant
  (`shape`/`icon`/`part`/`sockets`/`align` pass through verbatim — asserted in the
  new effects test and the pre-existing passthrough test, both green); Form/JSON
  two-way sync unchanged; non-form kinds still open on JSON with the Form tab
  disabled + note; submit gating still keyed on `editError` ALONE (the preview's
  stricter object check deliberately does not touch it).
- Registry semantics untouched: submit = editVariant → new human_edit variant with
  lineage; adoption remains a separate explicit act.
- Every REQ-0173 `edit-*` testid kept on the same control. Two documented
  consequences: the EN/JA testid pairs are now mutually exclusive (drive
  `edit-form-locale-en/ja-<no>`), and `edit-form-tags-<no>` is a `<select
  multiple>` — `selectOption()`, not `fill()`. New testids:
  `edit-form-locale-en/ja-<no>`, `edit-form-eff-secslo/secshi-<no>-<i>`,
  `edit-form-eff-mult-<no>-<i>`, `entity-preview-edit-<no>`.
- Read-only Dex, DexAdmin, artadmin, admin surface EN-only, ca-* CSS only: all
  held. **Dex Edit is untouched** — deleting it is 0182b's job, and this REQ
  deliberately does not pre-empt it.

### Gates
- **G1** — `tsc --noEmit` clean; `vite build` clean. Server tests green via
  `tools/ci.sh` (files + pg backends): api_test, content_test 18/0,
  contentagg_test 5/0, inspection_test 5/0, bio_test(pg) 10/0. No server code was
  touched by this REQ (the admin.cjs 409 belongs to 0182b), so this is regression
  cover only.
- **G2** — full `tools/ci.sh` **GREEN**, no skips:
  - contentadmin e2e **26/26** (22 pre-existing + the 4 new)
  - artadmin **5/5**, artinspect **1/1** — untouched, as promised
  - default suite **178/178**, zero failures
  - step `[0/8]` check_e2e_ports green (3 harnesses, all derived, no collisions).
    This REQ adds no harness and so claims no port decade.
- **G3** — oxlint **40 warnings / 0 errors, byte-identical to master's count**;
  none of the 40 are in the touched files (verified by grepping the report for
  EditModal/ContentAdminPage/contentadmin.css → no hits). ca-* CSS only.

**On the two dex-admin tests:** the REQ's G2 clause expects them to fail against
*deployed* registry-first serving. Pre-merge they PASS (dex-admin 6/6 inside the
178) and that is not a contradiction — the local harness's registry does not
cover the live item ids those tests edit, so /api/content still serves them from
files and Dex Edit's PUT still round-trips. The drift is a property of the
DEPLOYED registry, so it can only appear in the post-deploy suite. Nothing here
fixes or masks it; 0182b replaces those tests.

**Build artifacts:** `web/app/assets` is tracked, but the dist rebuild is its own
`deploy: rebuild client dist (web/app)` commit on master (see eee45a2, 262fda3,
09abb4d), never part of a REQ's source commit. The local rebuild this branch
needed (the e2e harness serves the BUILT bundle from `web/`, so an unbuilt fix is
invisible to the specs — one red run was exactly this) was reverted before
committing. Deploy rebuilds it.

### Commits
- `32f0c3f` REQ-0182 -> REQ-0182a: split off Phase A
- `1148c17` REQ-0182b: Phase B -> draft/
- `1303e1b` REQ-0182a: port the DexAdmin editor UX into contentadmin
- (+ the todo -> built move that carries this log)

### Integration pass — merged + deployed 2026-07-15 (user go-ahead in chat: "マージ・デプロイ")

- **Merged** `17bd440` (--no-ff). Master had moved under this REQ mid-verification
  (7bf9da2 → 8830ace → 356da9a): REQ-0176/0183/0186/0187 landed from CONCURRENT
  sessions while 0182a was being gated. Master was merged INTO the branch first and
  re-gated there; REQ-0176 (registry-first on the authority path) touches
  server/routes/content.cjs + lib/content.cjs, so the combination was re-gated on
  master too rather than assumed.
- **Dist** `60742c2`, its own commit per repo convention; index.html→assets verified
  consistent (no stale-hash 404). **backpack-web restarted** 02:31 UTC.
  **backpack-api deliberately NOT restarted** — 0182a changes no route.
- **Deployed bundle verified through the public tunnel**, not just assumed: the live
  `index-DKOAXzB0.js` contains `edit-form-locale-en/ja-`, `edit-form-eff-secslo/mult-`
  and the preview rail's marker string.
- **Post-deploy gates:** default suite **178/178, 0 failed** (dex-admin 6/6);
  contentadmin **26/26**; live content clean after every run (global-teardown
  sha256 `match=true` on profile + live_items + live_sis).
- **0182b promoted `draft/ → todo/`** (`169d8f5`) — the split note named the MERGE as
  its trigger, and that is now discharged.

### Known-not-mine: artadmin.spec.ts:113 under box load
`artadmin.spec.ts:113` fails with `page.goto: Timeout 20000ms exceeded` on the
contended box. It is NOT this REQ's doing, and the claim is evidenced rather than
asserted:
- artadmin passed **5/5 twice in this branch's own quiet-box ci.sh runs — WITH this
  code**. Same code, quiet box, green.
- 356da9a (master WITHOUT 0182a) also passes 5/5 — but only in quiet windows.
- The discriminator is runtime, not code: quiet runs finish in ~42s, failing runs in
  ~72s (~70% slower box). `:189` was observed PASSING at **18.4s against a 20s cap** —
  the harness sits marginally under its own timeout, so whichever goto tips over is
  luck.
- This REQ's bundle delta is **+3,617 bytes of 1,739,832 (0.2%)** — physically
  incapable of adding 20s to a page load. artadmin is untouched by 0182a.
The box is SHARED: the user's ComfyUI art session plus other agent sessions' test
runs and deploys ran throughout. A pre-existing REQ-0159 note already records the
quiet-box requirement; this harness's 20s goto cap is a latent fragility worth its
own REQ, but it is not 0182a's to fix.

### Status
`done` — merged, deployed, and **ACCEPTED by the user 2026-07-15** (chat, after
reviewing the live editor: "ありがとう。結果見ました。done"). Terminal; treat as history.
REQ-0182b (Dex Edit retirement) was cleared by 0182a's merge and proceeds separately.
