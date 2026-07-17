# REQ-0227 — Dex card API + subwindow for unit / monster kinds

## State log
- 2026-07-17 reserved (stub).
- 2026-07-17 reserved -> draft: explicit REQ-0208 non-goal, now specced;
  needs user prioritization.
- 2026-07-17 draft -> todo: user cleared for implementation ("do REQ-0227").
- 2026-07-17 todo -> built: REQ-0227 gates green (api 190/0, tsc, oxlint, scoped e2e); full ci.sh blocked only at the unrelated [6.5/8] admin harness (cross-session infra) -- see Outcome.

## Origin (REQ-0208 retrospective)
REQ-0208 gave units/monsters full catalog tabs + detail panes but declared
the dex card surface a non-goal: GET /api/dex/card/:kind/:id (REQ-0052)
still allowlists item/si/tm/pack only. On the Items grid every card carries
the "i" preview button (DexCardWindow -- the shareable, deep-linkable card);
unit/monster cards have nothing in that spot, a visible asymmetry the tabs
now expose.

## Problem
- No render-ready public card DTO exists for the two newest kinds, so
  nothing (market hovers, forecast tooltips, future chat/share links) can
  show a unit or monster card without re-implementing the detail pane.
- '#/dex/<unit|monster id>' deep links land on the right tab (REQ-0208) but
  cannot produce the compact card window the other kinds get.

## Proposal
- server/routes/dex.cjs: add 'unit' and 'monster' to KIND_TO_CONTENT_KEY
  (payload keys units/monsters -- both already served registry-first).
  DTO slices mirror the REQ-0208 detail panes: unit = names/rarity/icon/
  connection_shape/flavor; monster = names/rarity/hp/footprint/skills +
  the referenced monster_skills name entries riding along.
- client DexCardWindow: two new kind renderers reusing UnitCatalog/
  MonsterCatalog's detail building blocks (portrait well, connection row,
  stat rows) -- shared components, not copies.
- Catalog cards in both new tabs gain the same .dex-card-preview-btn the
  Items grid has.
- Dismantle overlay stays po/si-only (kinds are not dismantlable).

## Gates (when implemented)
- api tests: 200 + DTO shape for both kinds; 404 for unknown ids.
- e2e: preview button opens the card window from each new tab.

## Outcome (2026-07-17)

Branch `req-0227-dex-card-unit-monster-kinds`, rebased onto master f5ffce2
(post REQ-0214/0217 hermetic e2e). Commits: c979711 (draft -> todo move),
666cd1c (implementation).

**Server** (`server/routes/dex.cjs`):
- `KIND_TO_CONTENT_KEY` += `unit: 'units'`, `monster: 'monsters'` (both
  payload sections already served registry-first; no new resolution path).
- `buildCardDto` gains a `content` param and two branches:
  - unit: `connection_shape` + the referenced `connection_shapes` vocab
    entry riding along as `connection_shape_def`.
  - monster: `hp` / `footprint` / `skills` / `pack_role` + the referenced
    `monster_skills` name entries riding along as `skill_names` (limited to
    the ids the monster references).
- Dismantle overlay untouched (item/si only).

**Wire type** (`shared/dto.ts` + `client/src/api/dex.ts`):
`ApiDexCardDto.kind` widened to item|si|tm|unit|monster; `icon` became
optional (absent for monsters -- their art resolves by id via art_urls);
new optional per-kind fields connection_shape, connection_shape_def, hp,
footprint, skills, pack_role, skill_names. `fetchDexCard` kind param widened.

**Client** (`client/src/dex/`):
- `DexCardWindow.tsx`: unit/monster cards render a new `DexCardPortrait`
  (the catalogs' portrait-well posture: rune fallback under the adopted
  render, unitArtUrl for units, getItemArtUrl for monsters) instead of a
  ShapeGrid. Stat rows: unit connection (shared lib/connShapeLabel
  formatter), monster hp/footprint/pack_role/skills (names via the DTO's
  riding skill_names); monster lowercase rarity capitalized for `.r-*`
  theme-class lookup only.
- `UnitCatalog.tsx` / `MonsterCatalog.tsx`: catalog cards gain the same
  `.dex-card-preview-btn` ("i", data-testid dex-card-preview-btn) the Items
  grid has, calling openCard('unit'|'monster', id) with stopPropagation.
- Tests: server/tests/api/dex.cjs +4 groups (unit DTO shape + riding vocab
  def, monster DTO shape + riding skill names, monster /api/content parity,
  unknown unit/monster id -> 404); client/e2e/dex-card.spec.ts +2 (Units /
  Monsters tab preview opens the card -- no ShapeGrid, no navigation, served
  hp band + portrait well visible).

**Gate results**
- server api tests (pg backend): `node tests/api_test.cjs` -- 190 passed,
  0 failed; the 4 new REQ-0227 groups all pass.
- client: `tsc -b` exit 0; `oxlint` 0 errors.
- ci.sh (full pipeline, quiet box): [0/8]..[6/7] all green -- port rule,
  sim, server api (files + pg 190/0), every [5.x] registry / artwork /
  bp-skin gate, client typecheck + build. Then RED at [6.5/8] admin e2e
  harnesses (artadmin / artinspect / contentadmin, REQ-0156/0152/0157): the
  artadmin harness binds fixed ports 1560-1562 (derived from REQ-0156, not
  the worktree) and a concurrent session running that harness directly
  monopolizes + kills competitors on those ports. Three runs died
  identically at [6.5/8] -- two here and a concurrent REQ-0232 ci.sh -- each
  after passing the port preflight, i.e. externally killed mid-bringup.
  Infra contention, unrelated to REQ-0227 (no artadmin code touched): red
  (env / cross-session, not this REQ).
- e2e [7/7] REQ-0227 coverage verified directly via the SCOPED hermetic run
  on this REQ's own decade (ports 2270-2279, box lock not required, exactly
  what ci.sh [7/7] would run): 187 passed, 1 skipped, 2 failed. Both
  failures are canvas drag/drop specs unrelated to dex (squad-switch.spec.ts
  :36, reference-model.spec.ts:166); both pass on an isolated re-run (10/10,
  exit 0) -- flaky under box load, not a regression. All REQ-0227 dex-card
  specs pass (Units / Monsters preview, catalog trigger, ESC-close).
- Note: an earlier pre-rebase stale-gate red (REQ-0207) was fixed on master
  independently; not part of this REQ.
