# Monster Art Plans — 50-monster roster expansion (2026-07-15)

Operator: Claude (Cowork session), directed by the user.
Pipeline: artwork registry (`server/routes/art.cjs` → `art_jobs` queue → flux2
route, Concept Art (Fantasy) template). Pipeline itself is NOT modified; quality
is steered through `main_object` prompts only. See `docs/llm_managed/art_pipeline.md`
and `monster_content_pipeline.md`.

## Operating rules

- kind=`monster`, shape = w×h cells (1..12) @128 px/cell; shape chosen per the
  creature's in-world size so relative scale reads at a glance.
- `prompt_template` stays the kind default `{main_object}, white background`.
  `style_override` stays NULL (Concept Art (Fantasy) default). The ONLY lever is
  `main_object`.
- Every prompt ends with `full body` — the whole creature must be in frame,
  nothing cropped (user minimum requirement).
- Generate 2–3 seeds per monster (same prompt ⇒ cheap rerolls), pick the best
  render, adopt via `POST /api/art/artworks/<name>/adopt`. Rejected renders are
  kept (user rule: no need to delete rejects).
- Work proceeds in batches of 5; STOP after each batch for user review.
- Final in-game adoption is the user's decision; registry adoption here is a
  review aid, per user instruction 2026-07-15.
- Existing already-adopted monsters may be regenerated later if quality is short
  (user instruction 6); not part of the 50 below.

## Roster (50)

| # | batch | system_name | shape | px | main_object |
|---|---|---|---|---|---|
| 1 | B1 | slime | 3x3 | 384x384 | cute round slime monster, glossy translucent blue gel body dripping slightly, simple face, full body |
| 2 | B1 | skeleton_warrior | 3x4 | 384x512 | undead skeleton warrior in rusted armor scraps holding a notched sword and cracked shield, full body |
| 3 | B1 | werewolf | 4x4 | 512x512 | feral werewolf with shaggy grey fur and glowing yellow eyes, claws spread in a hunting crouch, torn trousers, full body |
| 4 | B1 | griffin | 6x4 | 768x512 | majestic griffin with white eagle head, golden feathered wings and tawny lion body, standing proud with wings raised, full body |
| 5 | B1 | bone_dragon | 10x10 | 1280x1280 | colossal undead bone dragon, bleached skeletal wyrm with tattered wing membranes and glowing blue eye sockets, rearing up, full body |
| 6 | B2 | zombie | 3x4 | 384x512 | rotting zombie shambling forward with outstretched arms, torn clothes, sickly green decayed skin, full body |
| 7 | B2 | ghost | 3x4 | 384x512 | eerie ghost with flowing translucent pale body trailing into wisps, hollow glowing eyes, floating, full body |
| 8 | B2 | mummy | 3x4 | 384x512 | ancient mummy wrapped in frayed bandages, dark hollow face with glowing eyes, lurching with arms raised, full body |
| 9 | B2 | vampire_lord | 3x4 | 384x512 | elegant vampire lord with slicked black hair and high-collared cape with crimson lining, fangs bared, clawed hand raised, full body |
| 10 | B2 | lich | 4x5 | 512x640 | skeletal lich king in ornate tattered robes with a golden crown and glowing staff, faint arcane wisps around him, full body |
| 11 | B3 | kobold | 3x4 | 384x512 | small dog-headed kobold scout in patchwork leather armor gripping a crude spear, full body |
| 12 | B3 | orc_warrior | 3x4 | 384x512 | burly green-skinned orc warrior with jutting tusks, heavy iron battle axe and fur-trimmed armor, battle stance, full body |
| 13 | B3 | lizardman | 3x4 | 384x512 | lizardman warrior with green scales and crocodile head, round hide shield and curved blade, thick tail, full body |
| 14 | B3 | sahuagin | 3x4 | 384x512 | fish-headed sahuagin sea devil with fin crest, teal scales and webbed claws wielding a coral trident, full body |
| 15 | B3 | imp | 3x4 | 384x512 | small mischievous imp with bat wings, curling horns and barbed tail, grinning while holding a tiny pitchfork, full body |
| 16 | B4 | giant_bat | 4x3 | 512x384 | giant cave bat swooping with wide leathery wings spread, fangs bared, big ears, full body |
| 17 | B4 | giant_spider | 4x3 | 512x384 | giant hairy spider with eight gleaming eyes and striped bristly legs, venom dripping from fangs, full body |
| 18 | B4 | giant_scorpion | 4x3 | 512x384 | giant armored desert scorpion with raised segmented stinger tail and open pincers, full body |
| 19 | B4 | giant_crab | 4x3 | 512x384 | giant crab with thick barnacled shell and one oversized crusher claw raised, full body |
| 20 | B4 | giant_toad | 4x3 | 512x384 | giant warty swamp toad with bulging orange eyes, crouched low ready to leap, full body |
| 21 | B5 | harpy | 4x4 | 512x512 | harpy with a fierce woman's face, large brown feathered wings for arms and sharp bird talons, screeching mid-air, full body |
| 22 | B5 | medusa | 4x4 | 512x512 | medusa gorgon with writhing snakes for hair and a long coiled serpent tail, arms spread with clawed nails, full body |
| 23 | B5 | lamia | 4x4 | 512x512 | lamia enchantress with a woman's upper body and long coiled golden serpent lower body, holding a curved dagger, full body |
| 24 | B5 | gargoyle | 4x4 | 512x512 | gargoyle of weathered grey stone with bat wings, horns and a fanged grimace, crouched on a stone ledge, full body |
| 25 | B5 | dullahan | 4x4 | 512x512 | headless dullahan knight in blackened plate armor holding its own helmeted head under one arm, longsword drawn, full body |
| 26 | B6 | minotaur | 4x5 | 512x640 | towering minotaur with a snorting bull head, massive horns and muscular body, swinging a giant double-headed axe, full body |
| 27 | B6 | troll | 4x5 | 512x640 | gangly cave troll with mossy warty green skin, long arms with oversized claws, hunched posture and underbite fangs, full body |
| 28 | B6 | stone_golem | 4x5 | 512x640 | massive stone golem assembled from rough mossy boulders with a glowing runic core and huge fists, full body |
| 29 | B6 | cyclops | 5x6 | 640x768 | towering cyclops giant with a single huge eye, wild beard, ragged hides and an uprooted tree club, full body |
| 30 | B6 | frost_giant | 5x6 | 640x768 | towering frost giant with icy blue skin, frosted braided beard, fur and bronze armor, hefting a great ice axe, full body |
| 31 | B7 | dire_wolf | 5x4 | 640x512 | huge dire wolf with shaggy black fur, glowing amber eyes and bared fangs, stalking low, full body |
| 32 | B7 | basilisk | 6x4 | 768x512 | basilisk, massive eight-legged lizard with dull green scales, spined crest and baleful petrifying eyes, full body |
| 33 | B7 | cerberus | 6x4 | 768x512 | cerberus, three-headed hellhound with black fur, glowing red eyes and flame licking from its jaws, full body |
| 34 | B7 | manticore | 6x4 | 768x512 | manticore with a snarling lion body, leathery bat wings and a segmented scorpion tail poised to strike, full body |
| 35 | B7 | salamander | 6x4 | 768x512 | fire salamander, giant ember-scaled lizard wreathed in flames with molten glow between its scales, full body |
| 36 | B8 | myconid | 3x3 | 384x384 | walking mushroom monster with a wide spotted cap, stubby arms and legs, spores drifting around it, full body |
| 37 | B8 | fire_elemental | 4x4 | 512x512 | fire elemental, a roaring humanoid figure of living flame with a white-hot core and ember trails, full body |
| 38 | B8 | ice_elemental | 4x4 | 512x512 | ice elemental, a jagged humanoid of translucent blue crystal ice exhaling frost mist, full body |
| 39 | B8 | treant | 6x6 | 768x768 | ancient treant tree giant with a wise bearded face in the bark, great branch arms and gnarled root legs, full body |
| 40 | B8 | thunderbird | 6x6 | 768x768 | thunderbird, a great storm eagle with slate-grey feathers and lightning crackling across its spread wings, full body |
| 41 | B9 | sandworm | 6x6 | 768x768 | colossal desert sandworm erupting from the sand, circular maw ringed with teeth, segmented armored body, full body |
| 42 | B9 | wyvern | 6x6 | 768x768 | wyvern with two clawed legs and broad leathery wings, barbed venomous tail, perched with wings flared, full body |
| 43 | B9 | sea_serpent | 6x6 | 768x768 | sea serpent coiling above stormy waves, finned crest and glinting blue-green scales, fanged maw open, full body |
| 44 | B9 | hydra | 8x6 | 1024x768 | hydra with five snapping serpent heads on long necks, heavy swamp-green reptilian body, full body |
| 45 | B9 | phoenix | 8x8 | 1024x1024 | phoenix rising with blazing crimson and gold plumage, long flowing tail of flame, wings spread wide, full body |
| 46 | B10 | behemoth | 8x8 | 1024x1024 | behemoth, a colossal purple-hided beast with huge curved horns, a dark mane and massive claws, full body |
| 47 | B10 | kraken | 10x10 | 1280x1280 | gigantic kraken rising from the deep, massive coiling tentacles with suckers and one huge baleful eye, full body |
| 48 | B10 | demon_lord | 8x8 | 1024x1024 | mighty demon lord with sweeping curved horns, huge bat wings, crimson skin and a flaming greatsword, full body |
| 49 | B10 | necromancer | 3x4 | 384x512 | hooded necromancer in dark tattered robes clutching a skull-topped staff, green soul-fire in his palm, full body |
| 50 | B10 | living_armor | 3x4 | 384x512 | haunted living armor, an empty full plate suit animated by a faint inner glow, greatsword and shield ready, full body |

## Status log

- 2026-07-15: Plan authored; user approved roster (B1 start authorized).
- 2026-07-15: Hit a latent pipeline bug: model_hash.cjs sha256File used
  fs.readFileSync, which refuses files > 2 GiB, so EVERY real API-path
  generation failed on the 4.3 GB flux2 GGUF. Reported; fixed by the user
  (another session) with a streamed hash. Two api restarts wiped the
  in-memory job queue mid-batch; orphaned renders were deleted and re-queued.
- 2026-07-15: B1 generated (3 seeds each; bone_dragon 6 seeds) and ADOPTED:
  slime s2, skeleton_warrior s1, werewolf s1, griffin s2, bone_dragon s2.
  All exported to content/art/monster/<name>.png.
- 2026-07-15: Per user instruction, B2-B10 (45 artworks) were CREATED with
  refined prompts only -- NO generation, NO adoption. The user will generate
  seeds at their own timing and judge. Prompts in the DB are authoritative;
  the roster table above reflects the original plan wording, while created
  artworks add the framing clauses below where relevant.

## Learnings from B1 (visual review of 21 renders)

1. Edge clipping is the top failure for WIDE subjects: griffin (6x4, wings
   raised) clipped 2/3 seeds at top/left; bone_dragon clipped 2/6 at right.
   Portrait humanoids and compact blobs almost never clip. Mitigation applied
   to B2-B10 prompts: append "entire creature/wingspan fully inside the
   frame" (variants: "all legs/heads/tentacles ...") on wide, winged,
   sprawling, or long-weapon subjects.
2. Painter-signature artifacts: the Concept Art (Fantasy) template sometimes
   paints a fake artist signature, mostly on large canvases (bone_dragon 3/6
   seeds, slime 1/3, skeleton_warrior 1/3). No negative prompt exists on
   flux2-klein, so the only remedy is seed rerolls; treat a signature as a
   reroll trigger during review.
3. Weapon tips are extremities too: a sword tip grazed the left edge on
   skeleton_warrior s2 (0.4% edge contact). Prefer "holding/resting" over
   "swinging" for big weapons, keeping them close to the body.
4. Style consistency holds without style_override; "full body" reliably
   yields whole-creature compositions on white background.
5. Numeric edge check (border-pixel non-white fraction, threshold <235 luma)
   catches clipping objectively and cheaply; run it before eyeballing.

## Handoff state (session end, 2026-07-15)

- 50/50 artworks exist in the registry (plain [A-Za-z0-9_]+ names, no batch
  prefix; the API rejects ':' so registry-era monsters are unprefixed).
- Adopted (5): slime, skeleton_warrior, werewolf, griffin, bone_dragon.
- Ready-to-generate (45): B2-B10 rows above; each has kind=monster, shape,
  and a tuned main_object; prompt_template is the kind default. Generate via
  the artadmin UI or POST /api/art/artworks/<name>/generate {"count":N}.
