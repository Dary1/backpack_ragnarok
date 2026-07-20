# Corpus test fixtures (REQ-0268)

These five JSON files are **real, trimmed** raw wiki pages captured by
`tools/corpus_fetch.py`, kept as committed fixtures for
`tools/tests/corpus_test.py` (the normalizer/stats tests run offline, with no
network).

Each file is one page in the same schema `corpus_fetch.py` caches under
`data/corpus/raw/<source>/pages/<pageid>.json`:
`{source, endpoint, license, tool_version, fetched, pageid, title,
categories, wikitext}`. Version-history tables and other bulk were trimmed;
the infobox/`Item_Template` and category lines are verbatim.

## Attribution / license

The `wikitext` is user-generated wiki content licensed **CC-BY-SA**:

| file | title | source wiki |
|---|---|---|
| bb_bloodthorne.json | Bloodthorne | Backpack Battles Wiki (backpack-battles.fandom.com) |
| bb_banana.json | Banana | Backpack Battles Wiki (backpack-battles.fandom.com) |
| bb_accessory_index.json | Accessory | Backpack Battles Wiki (backpack-battles.fandom.com) |
| bh_carved_blade.json | Carved Blade | Backpack Hero Wiki (backpack-hero.fandom.com) |
| bh_daisy_blade.json | Daisy Blade | Backpack Hero Wiki (backpack-hero.fandom.com) |

The underlying game data belongs to each game's developer. Per REQ-0268 this is
reference-only tooling data: it is never shipped, never copied verbatim into
live content, and never used as model-training data.

## What each fixture exercises

- **bb_bloodthorne.json** -- Godly (-> Relic) melee weapon: clean `Damage=4-8`,
  `Cooldown=1.6s`, damage verb mapping, and the excluded features
  `accuracy_crit` (Accuracy), `stamina_cost`, `recipe_craft` (combination).
- **bb_banana.json** -- Common food: `Every 5s` cadence + `Heal for 4`
  (heal_ally), `stamina_cost`, `recipe_craft` (used-in-recipe).
- **bh_carved_blade.json** -- Uncommon carving: Backpack Hero infobox, damage
  recovered from prose ("Deal 12 Damage"), `energy_cost` excluded.
- **bh_daisy_blade.json** -- Common carving: second Backpack Hero item, `size`
  tag, energy costs.
- **bb_accessory_index.json** -- a category-index page with NO infobox: must
  normalise to kind "other" and land its prose in `unmapped`, never crash.
