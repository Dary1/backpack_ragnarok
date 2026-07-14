# REQ-0171 — contentadmin-gacha-pack-pools

**Status:** built — implemented 2026-07-14 on the user's instruction: *「ガチャパックも
コンテンツRegistryとして管理可能対象にしてください」*. Merged + deployed; awaiting acceptance.
**Reserved:** 2026-07-14
**Slug:** contentadmin-gacha-pack-pools
**Depends on:** REQ-0170 (shipped `live_packs.json` / `gacha_pack/1` — the table this REQ puts
a screen on top of), REQ-0155/0157/0164/0173 (the content-data registry + its admin UX).
**Spawns:** REQ-0175 (the pack's ARTWORK facet in artadmin — REQ-raise only, per the user).

## Goal

A gacha pack — WHICH Units it emits, at what weight, for what cost — must be authored in the
**content admin ledger**, like every other content kind. REQ-0170 made the pool *data*; this
REQ makes it *managed* data.

## What a gacha_pack variant carries (`gacha_pack/1`)

| field | notes |
|---|---|
| `id` / `name` / `i18n.ja` | as every kind |
| `pool[]` | **the reason the kind exists**: `{unit, weight}` — the unit REFERENCE and its emission WEIGHT |
| `cost` / `cost_tm` | the price, and the currency it is priced in (`lrdst`) |
| `cells` | `[min,max]` — the BP polyomino size the roll draws from (uniform) |
| `hp_per_cell` | `hpMax = hp_per_cell × cellCount` |
| `bonus` | added by REQ-0062 (themed packs) while this REQ was in flight; carried verbatim, surfaced in the preview's fallback grid — nothing is silently hidden |

**Probability is DERIVED, never stored.** The admin edits `weight`, because weight is what
`gacha.cjs pickWeighted()` consumes; the percentage is computed on render (`poolChances()`).
Storing both would be two sources of truth for one fact, and they would eventually disagree.

## What shipped

- **`016_content_kind_gacha_pack.sql`** — `content_kind` ENUM += `gacha_pack` (the ONLY thing
  blocking pack data from the ledger, exactly as `010` was for `skill_def`). Applied.
- **`routes/content.cjs`** — `KINDS` += `gacha_pack`.
- **`content_checks.cjs`** — the machine checks learn the kind:
  - `schema_vocab`: a pack's closed vocabulary is **not vocab.json — it is the LIVE UNIT
    ROSTER.** Every pool row must name a unit that has a def. This REUSES
    `shared/content_validate.cjs validatePackEntry()` (the same function `check_units.cjs`
    runs) rather than re-implementing "what is a legal pack" a second time — two copies would
    drift, and the drift would be invisible. Also: `cost_tm` must be a real tm def (a pack
    priced in a currency that does not exist is unbuyable, and nothing else would say so).
  - `engine_types`: **APPLIES** (unlike `skill_def`, which honestly does not) — `gacha.cjs`
    dereferences `cost` / `cells` / `hp_per_cell` / `pool[].weight`, so a string where it
    wants a number is a 500 at roll time.
  - `integrate`: honestly `applicable: false` — a pack places nothing on a canvas.
- **`backfill_content_registry.cjs`** — two new SOURCES: `gacha_pack ← live_packs.json` AND
  `unit_def ← live_units.json`. The unit source is not scope creep: a pack pool that
  references units the ledger has never heard of is a ledger that cannot check its own
  references. The old `UNIT_DEF_NOTE` ("zero by design, REQ-0130 provisional") was true until
  REQ-0170 shipped the roster; it is now retired.
  **Backfilled: 12 unit_defs + 3 gacha_packs, all machine-check PASS, all adopted.**
- **contentadmin UI** — `gacha_pack` in `KINDS` / `SCHEMA_REF_DEFAULTS`, and an `EntityPreview`
  renderer that shows a pack as a pack: cost chip, cell-range chip, HP/cell chip, and the pool
  as a table of **unit · weight · derived %**.

## Honest gap (shared with every other kind, not new here)

Adopting a variant writes it to `content/registry_exports/<kind>/`, **not** to
`content/live/live_packs.json` — the live-file merge is `CONTENT_EXPORT_GIT`-gated and has never
been wired for ANY kind (REQ-0155's own S7 step). So the ledger is where a pack is *authored and
adjudicated*; the running gacha still reads `content/live/live_packs.json`. Parity with po/si/tm/
monster/skill, and the user asked for exactly that ("他のコンテンツ同様に"). Closing it is one
REQ for all kinds at once, not a special case for packs.

## Gates

- `tools/ci.sh` green, including 7 new content-check tests (unknown unit in the pool FAILS by
  name; zero weight FAILS; `cost` as a string fails engine_types; unknown `cost_tm` FAILS; the
  3 live packs and the 12 live units all PASS) and the rewritten backfill inventory test.
- Backfill verified against the live DB: `gacha_pack` = 3 / `unit_def` = 12, PASS + adopted.

## Outcome (2026-07-14) — BUILT, merged (`97b13f6`), deployed

- `content_kind` ENUM extended (`016_...sql`, applied to the live DB).
- Backfilled into the ledger: **12 `unit_def` + 3 `gacha_pack`** — all four machine checks
  green, all adopted at v1, all exported.
- Verified in the admin on backpack-dev: `common_bp` renders as *Common Backpack /
  コモンバックパック*, chips `cost 10 lrdst · 6–8 cells · HP 15/cell · 12 units`, and the pool as
  **elf w1 8.3% · dwarf w1 8.3% · …** (weight edited, percentage derived) with
  `schema_vocab ok · engine_types ok · gen_data ok · integrate n/a`.
- `tools/ci.sh` CI GREEN, incl. 7 new checks and the rewritten backfill inventory test.

**Found in flight:** REQ-0062 (another agent) landed two themed packs (`clockwork`, `ember`)
on the `gacha_pack/1` schema while this REQ was being built, adding a `bonus` field. Both
backfilled and PASS; `bonus` surfaces in the preview's fallback grid (the "nothing is silently
hidden" rule did its job without a line of new code). If `bonus` deserves a first-class
renderer and its own machine check, that is a small follow-up — say the word.

**Still true, and worth repeating:** adopting a variant does not write
`content/live/live_packs.json`. That gap is REQ-0155's un-wired S7 step and it applies to
EVERY kind equally; the running gacha still reads the live file. Closing it is one REQ for all
kinds, not a special case for packs.
