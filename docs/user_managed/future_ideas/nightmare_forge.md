# Nightmare Forge — PENDING (deliberately parked)

> Status: **PENDING record, NOT a REQ** (user ruling 2026-07-06: "アリ" but the
> combat-system impact is large — genuinely on hold). Pull this doc out when the
> combat system is stable enough to host user-generated opposition. Pattern follows
> worldview_ragnarok_tentative.md: direction noted, nothing frozen.

## Concept
Players design **enemy packs / dungeons** and publish them as challenges:
- Compose from the unlocked monster roster under the existing **pack budget**
  (`packBudgetForLevel`, rarity weights) — budgets keep authored content honest.
- Friends run the published dungeon; clears reward both runner and author;
  long-unbeaten dungeons accrue fame for the author.
- PvP stays out (standing ruling): this is **fighting through level design**,
  asynchronous and simulator-refereed — not live opposition.

## Why it fits (when its time comes)
- Reuses everything: enemy defs, pack grammar, budget math, `sim/combat.cjs`,
  replay/spectate, schedule rooms. No new combat mechanics required by the feature
  itself — that is exactly why it must WAIT until those systems stop moving.
- Ragnarok synergy: season bosses / horde composition could be seeded from the
  community's most-cleared or most-feared forges (UGC graduating into official
  content). Conflicting idea "Einherjar Legacy" (dead builds as hireable guests)
  was REJECTED in its favor (2026-07-06).

## Open questions (unanswered on purpose)
1. Reward source — author royalties mint currency: from where? (Faucet discipline,
   economy.md invariant.)
2. Curation/griefing — undefeatable-by-construction forges; budget gaming;
   review gates (an S2/S4-style validator for forged dungeons is mandatory).
3. Scope — friends-only vs global; discovery surface; fame model.
4. Interaction with dungeon weather (REQ-0055): may forge authors pick affixes?

## Explicit non-goals right now
No schema, no routes, no UI. Do not build. Revisit trigger: combat spec §2–6 +
REQ-0048/0049 shipped and S4 (REQ-0050) green across two content batches.
