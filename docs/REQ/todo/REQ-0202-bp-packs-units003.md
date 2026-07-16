# REQ-0202 - Bp Packs Units003

**Status:** Spec written; REQ file lands in `todo/`. **Spec + data ONLY** (no code delta this
branch); the pack rows are registered/adopted POST-MERGE, orchestrator-driven (s6).
**Reserved:** 2026-07-16
**Slug:** bp-packs-units003
**Branch:** req-0202-bp-packs-units003
**Depends on:** **REQ-0201** (units003 roster — the 30 `unit_def`s these pools reference),
  **adopted + deployed FIRST**; REQ-0171 (`gacha_pack` as a content-data-registry kind + the
  weight / derived-probability doctrine); REQ-0170 (`gacha_pack/1` schema, `content/live/
  live_packs.json`); REQ-0062 (themed-pack precedent).

## 1. Goal
Expose the units003 roster to players through **four themed BP packs**. Per the user
(2026-07-17): **no new content kind** — these are **new `gacha_pack` rows only**, on the existing
`gacha_pack/1` schema, exactly as REQ-0171 established (「ガチャパックもコンテンツRegistryとして
管理可能」). Registered and adopted **post-merge by the orchestrator** via the contentadmin HTTP API
(the same POST-def -> variant -> review -> adopt flow every kind gets); the deploy step merges the
adopted rows into `content/live/live_packs.json`.

## 2. The pack designs (`gacha_pack/1` — THE data payload of record)
`cost` is the LRDST price; `cost_tm = "lrdst"` (a live tm def); `cells [min,max]` is the BP
polyomino size (uniform draw); `hpMax = hp_per_cell x cellCount`; `pool[]` is `{unit, weight}`.
Four packs, embedded in full (entries-array, ready for the live-file merge):

```json
{
  "schema": "gacha_pack/1",
  "entries": [
    {
      "id": "pestilence",
      "name": "Pestilence Pack",
      "cost": 15,
      "cost_tm": "lrdst",
      "cells": [
        6,
        8
      ],
      "hp_per_cell": 15,
      "pool": [
        {
          "unit": "alchemist",
          "weight": 6
        },
        {
          "unit": "witch",
          "weight": 3
        },
        {
          "unit": "darkelf",
          "weight": 2
        },
        {
          "unit": "plaguedoctor",
          "weight": 3
        },
        {
          "unit": "ranger",
          "weight": 3
        },
        {
          "unit": "icequeen",
          "weight": 2
        }
      ],
      "i18n": {
        "ja": {
          "name": "疫瘴のパック"
        }
      }
    },
    {
      "id": "sanctuary",
      "name": "Sanctuary Pack",
      "cost": 15,
      "cost_tm": "lrdst",
      "cells": [
        6,
        8
      ],
      "hp_per_cell": 15,
      "pool": [
        {
          "unit": "fairy",
          "weight": 6
        },
        {
          "unit": "cleric",
          "weight": 6
        },
        {
          "unit": "druid",
          "weight": 6
        },
        {
          "unit": "miko",
          "weight": 3
        },
        {
          "unit": "shaman",
          "weight": 3
        },
        {
          "unit": "paladin",
          "weight": 2
        },
        {
          "unit": "valkyrie",
          "weight": 2
        }
      ],
      "i18n": {
        "ja": {
          "name": "聖域のパック"
        }
      }
    },
    {
      "id": "warband",
      "name": "Warband Pack",
      "cost": 12,
      "cost_tm": "lrdst",
      "cells": [
        6,
        8
      ],
      "hp_per_cell": 15,
      "pool": [
        {
          "unit": "knight",
          "weight": 6
        },
        {
          "unit": "gladiator",
          "weight": 6
        },
        {
          "unit": "orc",
          "weight": 3
        },
        {
          "unit": "monk",
          "weight": 6
        },
        {
          "unit": "ninja",
          "weight": 3
        },
        {
          "unit": "samurai",
          "weight": 2
        },
        {
          "unit": "werewolf",
          "weight": 3
        },
        {
          "unit": "darkknight",
          "weight": 6
        },
        {
          "unit": "hero",
          "weight": 6
        }
      ],
      "i18n": {
        "ja": {
          "name": "戦団のパック"
        }
      }
    },
    {
      "id": "royal_court",
      "name": "Royal Court Pack",
      "cost": 20,
      "cost_tm": "lrdst",
      "cells": [
        7,
        9
      ],
      "hp_per_cell": 15,
      "pool": [
        {
          "unit": "bard",
          "weight": 6
        },
        {
          "unit": "jester",
          "weight": 3
        },
        {
          "unit": "wizard",
          "weight": 2
        },
        {
          "unit": "sorceress",
          "weight": 2
        },
        {
          "unit": "king",
          "weight": 1
        },
        {
          "unit": "vampire",
          "weight": 1
        },
        {
          "unit": "dragonknight",
          "weight": 1
        },
        {
          "unit": "hero",
          "weight": 6
        },
        {
          "unit": "pirate",
          "weight": 6
        }
      ],
      "i18n": {
        "ja": {
          "name": "宮廷のパック"
        }
      }
    }
  ]
}
```

Summary: **pestilence** (疫瘴のパック, 15 lrdst, 6-8 cells) — the poison/DoT theme;
**sanctuary** (聖域のパック, 15 lrdst, 6-8) — heal/shield support; **warband** (戦団のパック,
12 lrdst, 6-8) — front-line melee; **royal_court** (宮廷のパック, 20 lrdst, 7-9) — the premium
caster/leader pack (holds the three Relics king/vampire/dragonknight at weight 1 each).

## 3. Weight doctrine + derived probability (REQ-0171)
- **Rarity-scaled weights**: **Common 6 / Uncommon 3 / Rare 2 / Relic 1**. Every pool row's
  weight is fixed by the unit's kit-sheet rarity — a Common is 3x as likely as a Rare and 6x a
  Relic. **Verified against the units003 kit sheet: 0 mismatches across all 31 pool rows** (every
  `weight` equals the doctrine value for that unit's rarity).
- **Probability is DERIVED, never stored** (REQ-0171): the stored datum is `weight` (what
  `gacha.cjs pickWeighted()` consumes); the percentage is computed on render (`poolChances()`).
  Storing both would be two sources of truth for one fact, and they would eventually disagree.

## 4. Coverage claim (verified against the kit sheet)
**Every units003 unit appears in >= 1 pack.** Checked programmatically against the 30-kit sheet:
- 30 kit ids; **30 distinct units** across the four pools; **0 units missing** from all packs.
- **0** pool rows name a unit that is absent from the kit sheet.
- Only **hero** appears in more than one pack (warband + royal_court, x2); all 29 others appear
  exactly once.
- Per-pack pool sizes: pestilence 6 · sanctuary 7 · warband 9 · royal_court 9 = **31 rows / 30
  distinct units** (hero counted twice). Coverage check: **PASS**.

## 5. Dependency — REQ-0201 adopted + deployed FIRST
`validatePackEntry` (the `check_units.cjs` live gate AND the `gacha_pack` `schema_vocab` machine
check) resolves each pool row against **`content/live/live_units.json`**: a row naming a unit with
no live def **FAILs by name** (REQ-0171 — the whole point of the kind). So these packs can only
pass their checks once **REQ-0201's 30 unit_defs are adopted and deployed to `live_units.json`**.
Merge/deploy order: **0200 -> 0201 -> 0202**.

## 6. Execution plan (POST-MERGE, orchestrator-driven, via the contentadmin HTTP API)
Not executed on this branch. After REQ-0201's roster is live, per pack (`server/routes/
content.cjs`): **POST `/api/content/defs`** (`kind=gacha_pack`, `schema_ref=gacha_pack/1`,
`system_name` = the pack id) -> **POST `.../variants`** (`data` = the full pack entry above;
`provenance = { model: "claude-opus-4-8", prompt: "units003 themed packs" }`) -> the machine
checks auto-run (`schema_vocab` resolves the pool against live_units + checks `cost_tm` is a live
tm; `engine_types` checks `cost`/`cells`/`hp_per_cell`/`pool[].weight` are the numeric types
`gacha.cjs` dereferences; `gen_data`/`integrate` honestly n-a) -> **POST `.../review`** (advisory,
mandatory rationale) -> **POST `.../adopt`** -> export to `content/registry_exports/gacha_pack/`.
The deploy step merges into `content/live/live_packs.json`; `check_units.cjs` gates it (live packs
3 -> 7).

## 7. Gates (this branch)
**None beyond REQ-file lint sanity** — this branch is **spec + data only, no code delta**. The
pack rows' real machine gate (`validatePackEntry` via `content_checks` / `check_units`) runs
**post-merge, against the live roster**, not here — on THIS branch it would necessarily FAIL,
because the units003 defs are not yet in `live_units.json`. Stated honestly: the only checks that
apply on this branch are that the embedded JSON parses (**done — 4 entries, `gacha_pack/1`
schema, `cost_tm=lrdst` is a live tm def**) and the weight-doctrine + coverage checks in s3-s4
(**done — 0 mismatches, full coverage**). No `ci.sh` / server-suite run applies to a data-only
branch.

## 8. Lifecycle note
Lands in **`docs/REQ/todo/`**: the spec + data are complete, but the register/adopt/deploy phase
(s6) is orchestrator-driven POST-MERGE (after REQ-0201). The file stays in `todo/` carrying this
note until the four pack rows are adopted and deployed.
