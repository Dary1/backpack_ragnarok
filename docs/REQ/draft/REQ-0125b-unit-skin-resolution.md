# REQ-0125b — unit-skin-resolution

**Status:** draft — spec written, NOT cleared to implement. Blocked on a
dependency, not on a user decision.
**Reserved:** 2026-07-11 (as REQ-0125)
**Slug:** unit-skin-resolution
**Split from:** REQ-0125 (unit-icon-replaces-linker), 2026-07-12
**Sibling:** REQ-0125a (unit-icon-render-base, todo — builds the machinery)
**Blocked by:** REQ-0128 (unit-connection-mechanics) — owns the real Unit model,
i.e. the identity this REQ resolves on. Also wants REQ-0127 art to be worth
looking at, but does not strictly require it (the chain falls back).

## Why this is a separate file

REQ-0125 assumed a Unit identity that does not exist: a BP def is
`{id, name, color, shape, origin, linker:{off,dirs}, hpMax}` and carries no unit
id and no skin field. The user's ruling (2026-07-12) was explicit: **do not
invent a `unitId` field to unblock the renderer** — REQ-0128 owns that schema,
and a placeholder field here would be built to be thrown away. So the machinery
ships in REQ-0125a and the identity-keyed half waits here, in `draft/`, per the
multi-phase rule (each phase free to move on its own).

## Goal

Key REQ-0125a's resolution chain to real Unit identity, so a Unit renders ITS OWN
character icon (and, later, its selected skin) in the cell the legacy linker glyph
occupies today.

## Scope (to be re-checked against REQ-0128's actual model before ratifying)

- Feed the chain built in REQ-0125a:

      active unit skin → default unit icon → legacy linker glyph → placeholder

  REQ-0125a leaves the two upper rungs typed, unit-tested against a fake registry,
  and returning empty. This REQ points them at REQ-0128's Unit model and at the
  registry route (RASTER — decided 2026-07-12, `unit_icon_pipeline.md` §3.2,
  units and items decided together).
- Per ratified golden G6, the pipeline's base icon is the Unit's DEFAULT SKIN, not
  a hard-wired asset. Skin selection state (where an active skin is stored, and how
  it persists) is a real design question this REQ must answer WITH REQ-0126
  (backpack-skin-system): Unit Skins pair with Backpack Skins as a SET (elf unit +
  elven bag). Persistence goes through `server/storage.cjs` — the only chokepoint —
  and any persisted key needs a migration decision recorded here.
- Surfaces: the resolver is already wired at every call site by REQ-0125a
  (`BoardRenderer.ts` unit cell; dex `BpDiagram`/`ShapeGrid`, reused by market
  BuyPane and workshop). This REQ should need NO new call site — if it does, that
  is a REQ-0125a bug, fix it there.
- Renderer overlays (connection-shape markers, charge ring, link lines) stay
  data-driven and never baked into art (G2). Unchanged from REQ-0125a.
- Contain-fit uniform scaling only; aspect inviolable
  (`common_content_pipeline.md` §2). Unit icons are 1×1 / 1:1 by definition.

## Open questions for ratification

1. Does REQ-0128's Unit model give a stable id per Unit *instance* or per Unit
   *type*? Skins attach to type; charge/HP attach to instance. The chain keys on
   type.
2. Where does "active skin" live — profile-level (player picked it), squad-level,
   or per-BP? Decide with REQ-0126, not alone.
3. Does a skin swap invalidate anything persisted? (Expected: no — art only.)

## Gates (provisional)

- `tools/ci.sh` green; e2e via `tools/e2e_run.sh` only; pnpm only.
- Fallback proof: a Unit with no art still renders (legacy glyph), a Unit with a
  default icon and no skin renders the default, a Unit with a skin renders the skin.
- Manual UI pass on backpack-dev across canvas / inventory / dex / market / workshop.
