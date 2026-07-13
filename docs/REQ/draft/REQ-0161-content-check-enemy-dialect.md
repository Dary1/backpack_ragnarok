# REQ-0161 — content-check-enemy-dialect: reconcile machine checks with the enemy/1 schema dialect

**Status:** draft — spec written, BLOCKED on the direction ruling Q1 below.
**Requested by:** user, 2026-07-14 (chat): "REQ立ててください" for the monster-FAIL finding of
the REQ-0157 backfill session (Session 2026-07-14c).
**Spec authored by:** orchestrator (Fable), 2026-07-14.

**Depends on / coordination:**
- REQ-0155/0157 (content registry + checks wiring, built+deployed).
- `server/services/content_checks.cjs` (the four machine checks) and the enemy/1 live data
  (`content/live/dungeon/enemies.json`, 7 entries, batch-002-dungeon-pilot).
- REQ-0154 docs (monster_content_pipeline.md) — consult as the doc-canon for which dialect
  is canonical before implementing.

## Background (facts from the 2026-07-14c backfill)
All 7 backfilled `monster_def`s carry an honest machine-check **FAIL** while being live,
game-served assets. The failures are a VALIDATOR-DIALECT MISMATCH, not data corruption:
- `schema_vocab` flags enemy/1's lowercase rarity values (`"rarity": "common"`) — the vocab
  expects the capitalized rarity words used by po/si (`Common`, …).
- `engine_types` flags `hp` given as a `[lo, hi]` integer RANGE (enemy/1's roll-range
  convention) where the check expects a scalar runtime number.
Verdict tallies (2026-07-14c): schema_vocab 15 ok / 7 fail; engine_types 15 ok / 7 fail;
gen_data 22/0; integrate n/a for tm/monster. The FAILs were left standing (advisory doctrine;
adoption unaffected) with red dots in the admin — correct behavior, noisy signal.

## Open ruling (blocking)
**Q1 — which side is canon?**
- Option A (validators learn the dialect): teach schema_vocab/engine_types the enemy/1
  conventions per-kind (kind-aware rarity casing map; `[lo,hi]` int-range acceptance for the
  fields enemy/1 declares as ranges — the same "ranged verb params as [lo,hi]" doctrine
  self_test_vocab already documents for verbs). Live data untouched.
- Option B (data normalized to one dialect): migrate enemies.json to capitalized rarity +
  explicit range objects, bump schema to enemy/2, touch the sim/loader accordingly. Bigger
  blast radius (REQ-0122 dynamic enemy loading, sim), only worth it if the user wants ONE
  dialect everywhere.
- Recommendation (orchestrator): Option A — checks are advisory mirrors of reality; reality
  is the game-served enemy/1. Option B belongs to a schema-canon REQ if ever.

## Scope (once ruled; assumes A unless ruled otherwise)
- Kind-aware dialect handling in `content_checks.cjs` (schema_vocab + engine_types) with the
  dialect table documented in the module header; kit-style honesty preserved (real failures
  must still fail — e.g. an unknown rarity word or a malformed range still FAILs).
- Re-run checks over the 7 monster_defs via the existing recheck path (REQ-0157 endpoint);
  expected end state: 7/7 overall PASS, red dots gone, without editing any variant data
  (immutability untouched — machine_check is the annotation path).
- Negative tests: deliberately broken enemy defs (bad rarity token, inverted/non-int range)
  still FAIL naming the right check.

## Out of scope
- enemy/2 schema work, sim/loader changes, data edits (unless Q1=B); new kinds (REQ-0160);
  authoring a full monster validator suite beyond the two dialect fixes.

## Gates
- G1: content_test/contentagg_test + new dialect tests green; api_test 155/155 both backends.
- G2: recheck on the live 7 monster_defs flips them to PASS with data untouched
  (data_sha256 unchanged); the broken-def negatives still FAIL correctly.
- G3 hygiene: checks stay advisory (no adoption gating change); pnpm only; no schema/data
  file edits under content/ (Option A).
- S7: user acceptance — monster rows show honest PASS in the live admin.
