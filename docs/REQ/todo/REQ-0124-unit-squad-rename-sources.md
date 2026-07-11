# REQ-0124 — unit-squad-rename-sources

**Status:** todo (queued behind REQ-0123)
**Reserved:** 2026-07-11
**Slug:** unit-squad-rename-sources
**Blocked by:** REQ-0123 (glossary of record must exist first)
**Blocks:** REQ-0125 (Phase B naming is a prerequisite)

## Goal

Apply the ratified rename map (`docs/llm_managed/terminology_unit_squad.md`,
produced by REQ-0123) to all sources: `client/`, `server/`, `mock-src/`,
`content/`, e2e, i18n.

## Scope & method

- **Phase ordering is MANDATORY** (same swap hazard as REQ-0123):
  - Phase A: unit(old sense)→squad, preset→squad, party→troop; ALL gates green
    and committed before proceeding.
  - Phase B: linker→unit.
- Order within each phase: user-visible strings first (`client/src/i18n.ts`
  and literals, ja + en), then identifiers, then file names
  (e.g. `client/e2e/preset-switch.spec.ts`).
- `content/`: registry and vocab entries. Any `content/vocab.json` change is a
  DESIGN EVENT — surface to the user before applying (common pipeline rule).
- Persistence: `server/storage.cjs` is the only chokepoint. Persisted keys
  carrying retired terms (e.g. preset) get a migration under
  `tools/migrations`; decide per key between real rename + migration vs legacy
  alias, and record every decision in this file.
- API routes/payloads (`server/api.cjs`): renamed fields need either versioned
  compatibility or a coordinated client+server switch; record the choice here.
- NOTE: connection-pattern mechanics (per-unit shapes instead of always-queen
  beams) are OUT of scope. This REQ is naming only; mechanics land in their
  own REQ.

## Gates

- pnpm test green in every touched package; e2e via `tools/e2e_run.sh`
  (exclusive box lock; never call playwright directly). pnpm only — never npm.
- grep gate on sources for retired terms (preset/party/linker), excluding
  migration shims / legacy aliases, each of which is listed in this file.
- Manual UI pass on backpack-dev: Squad Editor / Squad Layout / Troop visible;
  no user-facing "preset" / "party" / "linker" strings in ja or en.
