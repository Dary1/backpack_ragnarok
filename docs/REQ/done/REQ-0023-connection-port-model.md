# REQ-0023 — Connection Port Model (Terminology Batch 5)

- **Status**: DONE — port-tag interpretation RATIFIED by user; WeaponPart<Weapon edge
  APPLIED (commit 6f13890), LEGACY_ID_ALIAS removed.

## Follow-up outcome (same day)
- First real hierarchy edge live: po_tags `WeaponPart → Weapon`. Flaming Blade now
  matches via pure hierarchy walk (verified against a degenerate-tree control).
- **Latent bug found & fixed during the edge work**: Engine.create was never passed the
  vocab trees at runtime (mock + tests silently ran degenerate) — tool_gen_data now
  emits TREES into data.js; ui.js/tests wire them. Without this fix the alias removal
  would have silently killed Flaming Blade.
- Widening survey: intentional (blade); latent (hilt also has WeaponPart — matches
  Weapon ports if ever adjacent; draft rime_shard Weapon port when batch promotes).
  Socket gating unaffected (separate namespace, test-verified).

## Outcome (2026-07-03)
Implemented as specced. `conn` → `ports:[{tiles,tag}]` (migration script with inference
table: flame_tablet ports Weapon+Oil, oil_flask port Flame, draft items schema-migrated).
Engine: portTargets/connectionsFrom/allConnections (tile hit × same-BP × PO-tag walk);
combos() recipe el-checks replaced by declarative COMBO_RECIPES over established
connections — output verified identical vs pre-migration snapshot. Tests 15→**18/18**
(no-tag-no-connection / hierarchy-match / cross-BP-blocked). Pages 200; fit unchanged
(14/0/6). Commits 6d414e0..1adf7e9.
**Known wart**: `blade` carries tags [WeaponPart, Metal], not Weapon — old Flaming-Blade
recipe survived via a narrow LEGACY_ID_ALIAS (id==='blade'). Clean fix = first real
hierarchy edge **WeaponPart < Weapon** in the po_tags tree (matches ground-truth
"Sword is a type of weapon" pattern), then drop the alias. PROPOSED to user — note it
widens every Weapon-gated check to also accept WeaponPart items.
- **Date**: 2026-07-03 (orchestrator gen2)
- **User ruling**: align `conn` to ground truth — "partner PO's cell on the port tile
  + same tag / tag-hierarchy rule (recipe-independent); never across BPs (already so)".
  User confirmed conn tiles ≈ Connection Port ("ほぼ同義で、条件が違う。OK").

## Model (orchestrator interpretation, flagged for user post-hoc review)
- **Connection Port** = `{tiles, tag}` owned by a PO. `tiles` = the former conn
  external target tiles (outside own shape, orthogonally adjacent, negative offsets ok).
  `tag` = the port's declared PO Tag.
- **Connection established** iff: a partner PO's cell occupies one of the port's tiles
  AND the partner PO has a tag equal to / hierarchy-related to the PORT's tag
  AND both POs are in the same BP. Directional: the port belongs to the sender;
  mutuality not required.
- Rationale for port-carries-tag reading: mirrors Socket Type mechanics (the
  user-endorsed "same pattern" philosophy); ratified REQ-0017 phrasing "the item's
  TAG-connection reaches"; existing recipes (Ignite = Oil item ↔ Flame partner)
  re-express naturally without content redesign.
- Combo recipes stop hard-coding `el` membership: effects attach to established
  connections (effect trigger tag ↔ port tag reconciled).

## Work
1. Schema: `conn: [[x,y]..]` → `ports: [{tiles:[[x,y]..], tag}]`; migration script;
   migrate live items + batch draft (infer port tags from existing recipe semantics —
   each migrated combo must keep its current behavior).
2. Engine: connection resolution via shared hierarchy walk (PO Tag tree);
   combos()/effects consume established connections; same-BP guard retained.
3. UI: ◇/◆ visualization retained; tooltip shows port tag.
4. Tests: all existing green; add — tile-reach WITHOUT tag match ⇒ no connection;
   port-tag hierarchy match (synthetic depth); cross-BP still blocked.
5. Tools/pages: gen_data, integrate, validators, preview/fit builders updated; rebuild;
   pages 200. Git commits per logical unit.

## Deliverables
- [ ] Migrated schema + engine + tests green (≥17 scenarios expected)
- [ ] Pages live; behavior parity for existing content documented
- [ ] User post-hoc confirmation of the port-tag interpretation
