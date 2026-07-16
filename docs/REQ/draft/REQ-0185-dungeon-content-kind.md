# REQ-0185 — dungeon-content-kind: dungeons are PRE-GENERATED content, not a runtime roll

**Status:** draft — specced, blocked on the design rulings in § Open questions. NOT cleared
to implement.
**Reserved:** 2026-07-15
**Slug:** dungeon-content-kind (supersedes the reserved slug `dungen-registry-packs` — see
§ Supersedes)
**Requested by:** user, 2026-07-15 (chat): *「dungen.cjs が、enemyIds を自力でランタイムで
組み立てるのはサーバ負荷がきつそうだし、シナジー等を考慮するとつまらなさそうです。dungeon は、
ランダムで潜るとしても、事前生成されたパターンをプレイする形にしましょう。つまり、dungeon も
content の kind とします。」*
**Depends on:** REQ-0184 (monster_pack kind — the pack layout this REQ composes into dungeons),
REQ-0155/0157 (the content-data registry + admin).

## Goal

A dungeon a player dives into is **authored content that was generated ahead of time**, drawn
from a pool of ratified patterns — not a graph assembled inside the request that serves it.
`sim/dungen.cjs` stops being a RUNTIME generator and becomes an AUTHORING tool whose output is
adjudicated in the content ledger like every other kind.

## Why (the user's two reasons, both real)

1. **Server load.** `dungen.generate()` runs inside the serving path today
   (`server/services/runs.cjs` · `rooms.cjs` · `lib/forecast.cjs` all call it). Every dive
   re-derives an entire encounter graph — rolls, pack composition, attachment placement — that
   nothing ever reuses. Pre-generation moves that cost off the request entirely: the dive
   becomes a SELECT.
2. **It is not fun.** `buildPack()` draws enemies by budget from the roster with no notion of
   synergy. A pack that happens to roll three `glacier_wisp` is arithmetically valid and
   dramatically inert. A pre-generated pattern can be *composed* — anchor + line + support that
   actually interlock, and (with REQ-0184) a LAYOUT that means something — and, being content,
   it can be reviewed and rejected before a player ever sees it. Procedural generation cannot be
   given taste; a content ledger can.

## Shape (sketch — the Open questions below are what block ratification)

- New `content_kind` = `dungeon_def`, schema `dungeon/1` (the shape `runDungeon()` already
  consumes — `{id, name, encounters:[...]}`).
- The encounters reference `monster_pack` defs by id (REQ-0184's `packId` seam) instead of
  carrying inline `enemyIds`. That seam is REQ-0184's deliberate contribution to this REQ.
- `sim/dungen.cjs` is re-pointed: same deterministic generator, run OFFLINE by a tool
  (`tools/gen_dungeon_patterns.cjs`) that emits N patterns per (theme, level) into
  `content/live/dungeon/patterns/`, whence the backfill ingests them as `dungeon_def` variants.
  The generator's determinism contract (byte-identical output per (dungeonType, level, seed))
  is what makes a generated pattern reviewable at all — it stops being a transient.
- A dive PICKS a pattern (weighted, by theme/level) rather than generating one. The pick is the
  only roll left in the serving path.

## Open questions (MUST be ruled before this leaves draft)

1. **Pattern pool size + selection.** How many patterns per (theme, level)? How is one picked —
   uniform, weighted, or "not the last N you played"? A pool too small makes the dungeon
   memorised; the whole point of pre-generation is that a HUMAN sized that pool deliberately.
2. **Replay/forecast parity.** `lib/forecast.cjs` calls `dungen` to forecast a dive, and
   `sim/tests/forecast_parity.cjs` pins that the forecast mirrors the sim. If the dive picks a
   pattern, the forecast must forecast THAT pattern — the parity test's contract changes shape.
3. **Sealed seeds (REQ-0058).** A sealed seed today reproduces a dungeon by re-generating it
   from (type, level, seed). If dungeons become picked content, a sealed seed must instead pin a
   PATTERN ID + the combat seed. That is a data-format change to an already-shipped feature.
4. **Scaling.** `level_scaling` is applied at compile time today (`packBudgetForLevel()`). Do
   patterns get pre-generated PER LEVEL (pool × levels), or does one pattern carry a level-scaling
   rule applied at serve time? The first is more reviewable; the second is far fewer defs.
5. **`test_fixed` retirement.** `dungen`'s `test_fixed` type returns batch-002's hand-authored
   `dungeon.json` verbatim. Once dungeons ARE content, `test_fixed` is just "pattern #1" — does
   it retire, or stay as a test seam?

## Supersedes

The reserved slug for this number was `dungen-registry-packs` — "wire `dungen.cjs` to reference
the ledger's `monster_pack` defs". That framing is ABSORBED here and is no longer a separate
REQ: if `dungen` no longer runs at serve time, there is no runtime pack assembly left to point
at the ledger. The number is unchanged (REQ numbers are never reused or re-cut); only the slug
and the framing moved, before any spec existed under the old one.

## Out of scope

- REQ-0184 (the `monster_pack` kind + its layout + the 4-pack port). This REQ consumes it.
- The `content/live` export gap (adoption writes `registry_exports/`, not the live files) — that
  is REQ-0155's un-wired S7 step and applies to every kind equally.
