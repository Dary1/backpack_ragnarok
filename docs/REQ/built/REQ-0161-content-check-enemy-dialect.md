# REQ-0161 — content-check-enemy-dialect: reconcile machine checks with the enemy/1 schema dialect

**Status:** built — merged to master + deployed + live-rechecked (2026-07-14, user go-ahead).
Awaiting S7 user acceptance in the live admin; moves to `done/` on that word.
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

## Ruling (2026-07-14, user — closes the block)
**Q1 = Option A.** The validators learn the enemy/1 dialect; live content/ is NOT edited.
Rationale (as specced): the checks are advisory mirrors of reality, and reality is the
game-served enemy/1 corpus. Option B (one dialect everywhere, enemy/2) is NOT taken and, if
ever wanted, belongs to a separate schema-canon REQ — not here.

## Options as put to the user (historical)
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

## Outcome (2026-07-14, orchestrator — Option A as ruled)

### What was done
`server/services/content_checks.cjs` now resolves a **schema dialect** from the def's
`schema_ref` (`content_defs.schema_ref`, which the REQ-0157 backfill copies VERBATIM from the
source file header: `po/2` | `si/2` | `tm/1` | `enemy/1`) and hands it to both offending
checks. The dialect table lives in the module header:

| schema_ref | rarity tokens | integer-range fields |
| --- | --- | --- |
| `enemy/1` | lowercase form of `vocab.rarities` (`common`, `rare`, …) | `hp` — `[lo,hi]`, ints, lo≤hi |
| DEFAULT (`po/2`, `si/2`, `tm/1`, …) | verbatim `vocab.rarities` token (`Common`, …) | none — stats are scalar |

- `schema_vocab` — rarity is matched against the dialect's spelling (`rarityAllowed`).
- `engine_types` — the dialect's declared range fields must be `[lo,hi]` int ranges
  (`isIntRange`); every other numeric stat keeps the scalar rule engine.js consumes.
- `runChecks` resolves the dialect once and now REPORTS it (`machine_check.dialect`), so a
  verdict says which spelling it was judged under. Additive: no existing field changed.
- **The dialect follows `schema_ref`, not `kind`** — a `monster_def` filed under a non-enemy
  schema still gets the default (scalar) rules. Keying on kind would have hard-coded the
  enemy dialect into a kind that may later hold another schema.
- Doc canon consulted as the spec required: `docs/llm_managed/monster_content_pipeline.md` §2
  already declares `hp` = `[lo, hi]` integer range and `rarity` = e.g. `common`. The data was
  right; the validators were reading it in po/si's accent.

**Honesty preserved (kit doctrine).** A dialect is a spelling, never an excuse: an unknown
rarity word, a capitalized rarity inside `enemy/1` (mixed dialect), and a malformed /
inverted / non-integer / scalar-where-ranged `hp` all still FAIL, each naming its own check.
The enemy/1 spelling does not leak into po/si/tm.

**No data, schema or sim change.** `content/` untouched (Option A); `enemy/2` not created;
adoption gating unchanged (checks stay advisory).

### Gates
- **G1 — green.** Full `tools/ci.sh` (SKIP_E2E=1) → **CI GREEN**. sim 112/112, mock-src
  engine 101/101, S4 14/14, forecast parity 16/16, typecheck + engine type-surface +
  vocab self-test clean, **api_test 157/157 on BOTH backends** (files + pg; the suite is at
  157 today, not the 155 the spec quoted), pg_sync 4/4, backfill 10/10 + 8/8,
  **content_test 13/13**, **contentagg_test 4/4** (recheck path incl.), inspection kits,
  client typecheck+build. E2E skipped — the default suite is REQ-0159's open repair, not
  this REQ's surface (no client code touched).
- **G1 — new tests: `server/tests/content_checks_dialect_test.cjs`, 11/11**, DB-free, wired
  into `tools/ci.sh` as `[4.66/7]`. It pins: dialect resolution by schema_ref; **all 7 live
  enemy/1 entries PASS as-shipped**; a non-vacuity assertion (the live corpus really is
  lowercase + ranged); 5 negatives (unknown rarity word, capitalized rarity in enemy/1,
  inverted range, non-int range, malformed/scalar hp) each naming the right check; and
  no-leakage (po/2 still PASSes, a lowercase rarity on a po_def still FAILs, a monster_def
  under a non-enemy schema keeps scalar hp).
- **G2 — green (verified read-only against the LIVE registry before merge).** All 7 live
  `monster_def` variants: stored verdict `FAIL` → fresh verdict **PASS**, `dialect=enemy/1`,
  `integrate` still `applicable:false`, and **`data_sha256` UNCHANGED on every row** (the
  probe never wrote; the asset of record was not touched). Deployed recheck record below.
- **G3 — green.** Checks remain advisory (no adoption-gating change); pnpm only
  (`--frozen-lockfile` in root/, server/, client/); zero edits under `content/`.

### Commits (branch `req-0161-content-check-enemy-dialect`)
- `f8faa49` — record the user ruling Q1 = Option A.
- `ca3aec3` — REQ draft → todo (ruled, cleared).
- `a949d54` — the dialect-aware checks + the 11-case dialect test + ci.sh wiring.

### Follow-ups (NOT taken here, deliberately)
- A first-class `enemy` validator kind in `shared/content_validate.cjs` (`validateBody`
  still accepts `item | si` only) — the honest gap REQ-0111/0154 carried; own it where first
  needed.
- Any move toward ONE dialect everywhere (`enemy/2`) remains a separate schema-canon REQ.
- The dialect table is the place to declare the next schema's conventions (e.g. `skill/1`
  if skills ever become a registry kind, REQ-0160).

### S7
User acceptance: the 7 monster rows show honest PASS (no red dots) in the live content admin.

### Merge & deploy record (2026-07-14, explicit user go-ahead)
- Merged `req-0161-content-check-enemy-dialect` → `master` **fast-forward** (`0c86d83..9b50d04`,
  5 files, +363/−70). Deployed by restarting `backpack-api` (`systemctl --user restart
  backpack-api`; active, `/api/content/defs` → 200). `backpack-web` / `backpack-tunnel`
  untouched — no client code changed.
- **Live recheck through the REQ-0157 endpoint** (`POST /api/content/defs/<name>/variants/1/recheck`),
  all 7 monster_defs, against the deployed code:

  | def | before | after | dialect | data_sha256 |
  | --- | --- | --- | --- | --- |
  | frost_gnoll, ice_archer, rime_shaman, frostback_bear, glacier_wisp, niflheim_stalker, hrimgrimnir | FAIL | **PASS** | `enemy/1` | **UNCHANGED** (all 7) |

- **Whole-registry state after the recheck** (list endpoint aggregates): 22 defs
  (8 po_def, 6 si_def, 7 monster_def, 1 tm_def), `ok=1` on every def and
  **`failed_checks=0` across the entire live registry** — the red dots are gone, and the
  po/si/tm verdicts were not disturbed (no leakage).
- Immutability held: only `machine_check` was rewritten (the annotation path); every
  `data_sha256` is byte-identical to what was ingested, so no asset of record moved.
