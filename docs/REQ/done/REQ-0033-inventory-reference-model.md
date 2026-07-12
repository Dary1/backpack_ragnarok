# REQ-0033 — Inventory Reference Model (usage tracking, red/yellow, unit independence)

- **Status**: DONE (2026-07-05; engine 854dcbc..06113ea, client 2f31e41..0d5ffb7)
  Engine: inventory-as-master, references, tintSets{red,yellow,canvasYellow},
  bpReferenceSet exclusions, isUnitIndependent, migrateState v3, tests 44→61.
  Client: createRef/removeRef drag semantics (canvas→inv = neutral "return" ghost),
  red/yellow overlays both boards (alpha .20), window.__backpackDebug E2E hook,
  E2E 45/45. Caught+fixed a fixture bug (1-cell BP linker-cell overlap).
- Supersedes the REQ-0031 physicality decision (uid-in-one-place). Inventory becomes
  the MASTER storage; presets hold REFERENCES to inventory items.

## Spec (user verbatim intent)
1. Moving an item Inventory → Preset(canvas) does NOT remove it from the inventory.
   The system tracks which presets USE each inventory item.
2. In the Inventory, an item already used in the CURRENT preset renders with a
   translucent faint RED background and CANNOT be placed again into that same preset.
3. An inventory item used by OTHER presets renders with a translucent faint YELLOW
   background. NO drag & drop restriction. The same yellow indicator also shows on
   the Preset(canvas) display for items shared with other presets.
4. BP drag from Inventory → Preset(canvas): POs inside the BP that are already used
   in the CURRENT preset are EXCLUDED (only those); the BP arrives with the rest.
5. Guarantee: a Preset containing ZERO yellow-tinted items is an independent "Unit".

## Orchestrator defaults (refine at implementation)
- Applies to POs, SIs, and BPs alike (a BP used by the current preset = red, etc.).
- Canvas→Inventory drag under this model = REMOVE the reference (item stays where it
  already is in inventory; drop cell irrelevant). In-inventory repositioning never
  affects references (references are by uid, not by cell).
- Nested rule for BP references: a preset referencing a BP also references the POs/SIs
  it brought along (minus exclusions); those POs turn red/yellow individually.
- Red state is per-preset (switching presets re-tints the inventory).
- Engine work: reference sets per preset (uid lists), legality layer ("usable in
  current preset"), independence checker isUnitIndependent(preset). Node tests for
  every rule incl. BP partial exclusion. Client: tint rendering (red/yellow overlays,
  both boards), drag gating, E2E with input emulation.
- Deployment interaction (glossary: an item cannot exist in two DEPLOYED presets) is
  enforced later at schedule join time using the same yellow/independence data
  (REQ-0036 dependency).

## Engine design (adopted, 2026-07-05)
- **Inventory = master/home**: every uid (PO/SI/BP) has exactly ONE home placement in
  st.inv.pages. Canvas arrays (active preset + presets.store) keep their EXISTING
  physical shape (entries {uid,cell,rot,...}) but are now REFERENCES: the same uid
  also lives in inventory. Old canvas code paths (legality, beams, combos, sockets)
  need no structural change.
- **New uid invariant** (replaces uid-in-one-place): uid exists in inventory exactly
  once; each preset references it at most once; checker updated.
- **Transfers**: inv→canvas = createReference (item stays home; refuse if uid already
  referenced by CURRENT preset = the red rule); canvas→inv board drop = removeReference
  (drop cell irrelevant; home untouched); inv⇄inv stays physical; canvas-internal
  moves manipulate the reference placement only. BP reference = BP + contents minus
  POs already referenced by current preset (exclusion set), their SIs following;
  preset keeps its OWN SI seat assignments after creation (initialized from
  inventory-side seating, then independent).
- **Queries**: usageOf(uid) → preset indices; usedInCurrent/usedInOthers; tint data
  = red set (current) + yellow set (others) for BOTH boards; isUnitIndependent(n) =
  preset n shares no uid with any other preset.
- **Migration**: items physically held by canvas/preset stores get first-fit inventory
  homes; existing canvas arrangements preserved as references. Preset delete (REQ-0032)
  = drop references only.
