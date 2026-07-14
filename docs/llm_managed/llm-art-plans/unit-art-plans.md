# Unit Art Plans — units-003 expansion roster (30 units)

> LLM-managed working plan (user directive, 2026-07-15). Goal: +30 NEW unit
> artworks, generated via the artwork-registry pipeline (artadmin / REQ-0151
> route: server queue -> art_job.py -> art_route/art_style, flux2, Anime
> template), each left in ADOPTED state as a candidate. Final in-game adoption
> is the user's call; this roster is decision support.
>
> Plan file: docs/llm_managed/llm-art-plans/unit-art-plans.md

## Ground rules (binding, from art_pipeline.md + art_style.py)

- Route/pipeline UNCHANGED: flux2 klein 4B, euler / 30 steps / cfg 1.0,
  no negative, no LoRAs. Quality is steered from the POSITIVE subject only.
- Created via POST /api/art/artworks, kind=unit (512x512), default template
  `{main_object}, portrait, looking at viewer, white background` + Anime style
  layer. No style_override.
- Subject rules (measured, REQ-0150):
  - State identity in FACE-AND-SHOULDER terms (hat, helm, hood, crown, mask,
    beard, ears, wings, scarf) or the Anime template drifts modern.
  - No below-shoulder gear nouns (weapon/belt/armor names widen the shot);
    where identity is bodily, append "bust, head and shoulders".
  - No negative prompt exists: say positively what the thing IS.
- Acceptance floor per render: bust framing, head NOT cropped at the top,
  single character, readable silhouette at 64 px, white background.
- Naming: `units003_<archetype>`. Seeds 101/202/303/404 (4 candidates each);
  best seed adopted; losers kept (no deletion needed).
- Cadence: 6 batches x 5 units; STOP after each batch for user review.

## Roster (30)

### Batch 1 — classic RPG core
| # | system_name | archetype | subject (main_object) |
|---|---|---|---|
| 1 | units003_hero | Hero | a young valiant hero with spiky chestnut hair and a red headband, determined bright eyes |
| 2 | units003_knight | Knight | a stalwart knight in a polished steel great helm with a scarlet plume, visor raised, steady gaze |
| 3 | units003_wizard | Wizard | an ancient wizard with a long flowing white beard, bushy eyebrows, and a tall pointed midnight-blue hat |
| 4 | units003_ranger | Ranger | a keen-eyed forest ranger in a deep green hood with a hawk feather, calm focused gaze |
| 5 | units003_cleric | Cleric | a gentle young cleric woman in a white and gold hooded vestment, a small golden circlet, serene warm smile |

### Batch 2 — east & rogue & holy
| # | system_name | archetype | subject |
|---|---|---|---|
| 6 | units003_samurai | Samurai | a stern samurai warrior in a black and gold kabuto helmet with a crescent-moon crest, resolute dark eyes |
| 7 | units003_ninja | Ninja | a masked ninja with a midnight-blue face scarf, a steel forehead protector, sharp piercing eyes |
| 8 | units003_witch | Witch | a young witch with a wide-brimmed pointed black hat, wavy violet hair, mischievous amber eyes |
| 9 | units003_paladin | Paladin | a noble paladin woman in gleaming white and gold plate with winged pauldrons, golden hair, resolute gaze |
| 10 | units003_monk | Monk | a serene warrior monk with a shaved head, wooden prayer beads around his neck, calm meditative expression |

### Batch 3 — heavy & dark & dragon
| # | system_name | archetype | subject |
|---|---|---|---|
| 11 | units003_darkknight | Dark Knight | a sinister dark knight in jagged black plate and a horned helm, crimson eyes glowing in the visor slit |
| 12 | units003_valkyrie | Valkyrie | a valkyrie maiden in a silver winged helm, golden braids, piercing sky-blue eyes |
| 13 | units003_dragonknight | Dragon Knight | a dragon knight in a dragon-crested helm with scale pauldrons, fierce emerald eyes |
| 14 | units003_gladiator | Gladiator | a scarred gladiator in a bronze crested helm, a strong jaw, defiant grin, bust, head and shoulders |
| 15 | units003_bard | Bard | a charming bard with a jaunty feathered cap, wavy auburn hair, a winning roguish smile |

### Batch 4 — non-human heroes
| # | system_name | archetype | subject |
|---|---|---|---|
| 16 | units003_darkelf | Dark Elf | a dark elf sorceress with obsidian skin, long white hair, long pointed ears, cold violet eyes |
| 17 | units003_orc | Orc Warrior | a battle-scarred orc warrior with green skin, jutting lower tusks, a black topknot, fierce grin, bust, head and shoulders |
| 18 | units003_vampire | Vampire Lord | an aristocratic vampire lord with slicked silver hair, crimson eyes, pale skin, a high black collar, subtle fangs |
| 19 | units003_werewolf | Werewolf | a werewolf warrior with a grey-furred wolf head, amber eyes, bared fangs, bust, head and shoulders |
| 20 | units003_fairy | Fairy | a tiny fairy girl with iridescent butterfly wings, a flower crown on pastel-pink hair, sparkling eyes |

### Batch 5 — nature, occult, sea
| # | system_name | archetype | subject |
|---|---|---|---|
| 21 | units003_shaman | Shaman | a tribal shaman wearing a carved wooden spirit mask and a feathered headdress, glowing painted markings |
| 22 | units003_druid | Druid | an elder druid with an antlered headdress, a grey beard woven with leaves and vines, deep green eyes |
| 23 | units003_alchemist | Alchemist | an eccentric alchemist girl with brass goggles pushed up over her copper hair, a curious bright smile |
| 24 | units003_miko | Shrine Maiden | a shrine maiden with long straight black hair, red and white ribbons, a composed gentle gaze |
| 25 | units003_pirate | Pirate Captain | a swaggering pirate captain with a black tricorne hat, an eyepatch, a gold earring, a bold grin |

### Batch 6 — court & the strange
| # | system_name | archetype | subject |
|---|---|---|---|
| 26 | units003_king | King | a wise old king with a jeweled golden crown, a long silver beard, an ermine-trimmed mantle, dignified gaze |
| 27 | units003_icequeen | Ice Queen | an ice queen with a crystalline frost crown, pale blue skin, long white hair, a cold regal gaze |
| 28 | units003_jester | Jester | a grinning court jester in a three-pointed motley cap with golden bells, a painted face, a sly wide smile |
| 29 | units003_plaguedoctor | Plague Doctor | a plague doctor in a black beaked leather mask and a wide-brimmed hat, round glass eye lenses |
| 30 | units003_sorceress | Flame Sorceress | a flame sorceress with long blazing crimson hair, ember-orange glowing eyes, a gold ruby tiara |

Design notes: silhouette variety at 64 px is deliberate (helms / hats / hoods /
crowns / masks / animal features / wings); necromancer stays CUT (user, REQ-0127
S7); light-cavalry "rider" trap avoided (no mount relations in any subject).
Existing units-002 roster (11 adopted) is untouched; re-generation of weak ones
is a separate follow-up if the user asks.

## Status log

- 2026-07-15: plan drafted; batch 1 generation started. (updates appended here)
