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


## Execution ledger (2026-07-12, orchestrator)

**Phases:** A (preset/party/old-sense-unit → squad/troop; 88 files) then B
(linker → unit; 51 files), each committed only after `tools/ci.sh` green
(sim, goldens, mock 101, server tsc, vocab self-test, api fs+pg 155×2,
client build). File renames: `PresetTabs→SquadTabs`, `PresetTrashZone→
SquadTrashZone`, `store/presets.ts→squads.ts`, `services/units.cjs→
squads.cjs`, `preset-switch.spec.ts→squad-switch.spec.ts`, fixtures.

**Serialized names kept LEGACY (grep-gate exclusions; forward migration
owned by REQ-0128's real Unit model):**
- `st.presets.{active,names,store}` — engine/GameState field (decl carries a
  ledger comment in `shared/engine.d.ts`).
- Slot-key VALUES `'unit1'…'unit4'` (`SQUAD_SLOTS` symbol renamed, values
  persisted in rooms/runs).
- BP field `bp.linker.{off,dirs}` — embedded in saved canvases, gacha rows,
  scenario/e2e fixtures. Code reads the legacy field via renamed symbols
  (`unitCell(bp)` reads `bp.linker`).
- `server/migrations/003_gacha.sql` comment — applied SQL migrations are
  immutable history.

**Vocabulary design event (ratified map, chat 2026-07-12):** vocab.json
triggers `OnUnitHit→OnSquadHit`, `OnUnitBeenHit→OnSquadBeenHit`, trigger
domain `Linker→Unit`. Live defs + validator + sim updated together.

**Replay format:** replay JSONL embeds trigger names and stream prefixes →
sim goldens REGENERATED (event counts identical; behavior unchanged).
Consequence accepted + ledgered: PRE-rename stored replays keep legacy
strings (`OnUnitBeenHit`, `unitSlot`) and degrade gracefully to
display-only differences in the Monitor; no parser switches on them.

**API:** client+server ship from one repo/deploy → coordinated switch, no
payload versioning. RNG stream labels renamed (no stored contract).

**i18n (ja):** プリセット→スカッド, パーティ→トゥループ, リンカー→ユニット;
`market.chip.unit` key restored (code-level key, not serialized);
`workshop.statUnit` label ユニット.
