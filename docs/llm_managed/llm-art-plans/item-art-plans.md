# Item Art Plans — items-005 roster (40 PO + 20 SI)

> LLM-managed working plan (user directive, 2026-07-15). Goal: +40 NEW PO and
> +20 NEW SI artworks (8 on 2026-07-15, +12 on 2026-07-16, user directive),
> generated via the artwork-registry pipeline (artadmin /
> REQ-0151 route: server queue -> art_job.py -> art_route/art_style, flux2,
> Anime template), each left in ADOPTED state as a candidate. Final in-game
> adoption is the user's call; this roster is decision support.
>
> Plan file: docs/llm_managed/llm-art-plans/item-art-plans.md
> Sibling precedent: unit-art-plans.md (units-003, same operating model).

## Ground rules (binding, from art_pipeline.md + art_style.py)

- Route/pipeline UNCHANGED: flux2 klein 4B, euler / 30 steps / cfg 1.0,
  no negative, no LoRAs. Quality is steered from the POSITIVE subject only.
- Created via POST /api/art/artworks. PO: kind=po + 5x5 shape mask, resolution
  derived (256 px/cell, /16 snap). SI: kind=si, locked 256x256. Default
  template `{main_object}, white background, bold outline` + Anime style
  layer. No style_override (style parity with the adopted batch-004 items).
- Subject rules (measured, REQ-0150 / art_style.py header):
  - PART-OF and COMPOUND noun traps: say positively what the thing IS
    ("tower shield" -> a stone tower; "sword hilt" -> a whole sword). Every
    subject below names the whole object and its key parts explicitly.
  - The Anime template drifts modern: give every item fantasy/medieval
    material words (wooden, iron, bronze, leather, runes).
  - No negative prompt exists. Composition is steered by stating WHERE parts
    are ("blade across the top, handle straight down").
- Acceptance floor per render: single object, readable silhouette at 64 px,
  white background, fills its cell footprint, no cropped edges.
- Naming: PO `items005_<slug>`, SI `sis005_<slug>` (registry name rule
  [A-Za-z0-9_]+). Seeds 101/202/303/404 (4 candidates each); best seed
  adopted right after generation (user directive: end state = adopted);
  the user can switch seed / NG / reroll at every review stop. Losers kept.
- Cadence: 12 batches x 5 items (8 PO batches, 4 SI batches); STOP after
  each batch for user review in artadmin
  (https://backpack-dev.qtie.jp/app/#/artadmin).

## Complex shapes (user directive: ~half of POs non-rectangular)

Genre research (Backpack Hero wiki + similar): swords/bows/staves read as
1x3-1x4 verticals, hammers/pickaxes/anvils/crossbows as T, axes/halberds/
boots/scythes/banners as L/J, flails/chains as S/Z, horseshoes as U,
shuriken/dolls as plus. 20 of the 40 POs below are non-rectangular.

UPDATE 2026-07-15 (supersedes the stale constraint that stood here): shape
conditioning IS live — REQ-0183 wired Arm C @ D=8 into the production route
and REQ-0186 exposed it as `shape_lock` (default `auto` = strict exactly on
the non-rectangular shapes below). Complex shapes therefore get the strict
mask automatically; the prompt still owes the TOPOLOGY (part placement /
attachment anatomy) per item_content_pipeline.md §0.2, and `po.cell_fit`
(REQ-0187) scores every render's per-cell fit in artadmin automatically.

Shape notation below: active cells as (row,col) in the 5x5 mask, plus the
bounding box and derived gen size.

## PO roster (40)

### Batch 1 — weapons core (2 complex)
| # | system_name | item | shape | cells | gen | subject (main_object) |
|---|---|---|---|---|---|---|
| 1 | items005_longsword | Longsword | rect 1x3 | (0,0)(1,0)(2,0) | 256x768 | a knight's steel longsword with a golden crossguard and a blue leather-wrapped grip, blade pointing down |
| 2 | items005_battle_axe | Battle Axe | L 2x3 | (0,0)(0,1)(1,0)(2,0) | 512x768 | a heavy battle axe, one broad curved steel blade on the upper right side of a tall wooden haft |
| 3 | items005_war_hammer | War Hammer | T 3x3 | (0,0)(0,1)(0,2)(1,1)(2,1) | 768x768 | a mighty war hammer, a massive rectangular steel head across the top and a long leather-wrapped wooden handle straight down the middle |
| 4 | items005_knight_spear | Spear | rect 1x4 | (0,0)(1,0)(2,0)(3,0) | 256x1024 | a knight's spear, a long wooden shaft with a leaf-shaped polished steel spearhead at the top |
| 5 | items005_hunters_bow | Hunter's Bow | rect 1x3 | (0,0)(1,0)(2,0) | 256x768 | a hunter's longbow, a tall curved wooden bow with a taut bowstring, standing upright |

### Batch 2 — weapons exotic (5 complex)
| # | system_name | item | shape | cells | gen | subject |
|---|---|---|---|---|---|---|
| 6 | items005_halberd | Halberd | L 2x4 | (0,0)(0,1)(1,0)(2,0)(3,0) | 512x1024 | a halberd, a tall polearm with an axe blade and a spear point at the top of a long wooden shaft |
| 7 | items005_crossbow | Crossbow | T 3x2 | (0,0)(0,1)(0,2)(1,1) | 768x512 | a heavy medieval crossbow, a horizontal steel bow spanning the top and a carved wooden stock pointing straight down |
| 8 | items005_reaper_scythe | Reaper's Scythe | J 3x3 | (0,0)(0,1)(0,2)(1,2)(2,2) | 768x768 | a reaper's scythe, a long curved steel blade sweeping across the top and a tall dark wooden snath running down the right side |
| 9 | items005_boomerang | Boomerang | L 2x2 | (0,0)(1,0)(1,1) | 512x512 | a carved wooden hunting boomerang with tribal patterns, a bent V shape with one arm pointing up and one arm pointing right |
| 10 | items005_iron_flail | Iron Flail | S 2x3 | (0,1)(1,0)(1,1)(2,0) | 512x768 | a medieval flail: a short wooden handle standing upright at the top right, a heavy iron chain hanging down from it, and a large spiked iron ball resting at the bottom left |

### Batch 3 — armor & shields (1 complex)
| # | system_name | item | shape | cells | gen | subject |
|---|---|---|---|---|---|---|
| 11 | items005_round_buckler | Buckler | rect 1x1 | (0,0) | 256x256 | a small round wooden buckler shield with a polished iron boss and iron rivets |
| 12 | items005_kite_shield | Kite Shield | rect 2x3 | (0,0)(0,1)(1,0)(1,1)(2,0)(2,1) | 512x768 | a tall kite shield, a pointed teardrop-shaped knight's shield painted with a red and white heraldic cross |
| 13 | items005_knight_cuirass | Cuirass | rect 2x2 | (0,0)(0,1)(1,0)(1,1) | 512x512 | a polished steel breastplate armor with gold trim, a medieval knight's cuirass, front view |
| 14 | items005_horned_helm | Horned Helm | rect 2x2 | (0,0)(0,1)(1,0)(1,1) | 512x512 | a viking iron helmet with two curved bull horns and a nose guard |
| 15 | items005_leather_boot | Leather Boot | L 2x2 | (0,0)(1,0)(1,1) | 512x512 | a single brown leather adventurer's boot with buckled straps, tall shaft on the left, toe pointing right |

### Batch 4 — magic (1 complex)
| # | system_name | item | shape | cells | gen | subject |
|---|---|---|---|---|---|---|
| 16 | items005_wizard_staff | Wizard's Staff | rect 1x4 | (0,0)(1,0)(2,0)(3,0) | 256x1024 | a wizard's tall gnarled wooden staff crowned with a glowing blue crystal orb at the top |
| 17 | items005_crystal_wand | Crystal Wand | rect 1x2 | (0,0)(1,0) | 256x512 | a slender wooden magic wand tipped with a glowing violet amethyst crystal, pointing up |
| 18 | items005_ancient_grimoire | Grimoire | rect 2x2 | (0,0)(0,1)(1,0)(1,1) | 512x512 | an ancient leather-bound grimoire spellbook with a golden pentagram emblem and brass clasps, closed, front cover view |
| 19 | items005_magic_scroll | Magic Scroll | rect 2x1 | (0,0)(0,1) | 512x256 | an unrolled ancient parchment scroll with glowing golden magic runes, lying horizontally |
| 20 | items005_mana_crystal | Mana Crystal | L 2x2 | (0,0)(1,0)(1,1) | 512x512 | a cluster of glowing blue mana crystals, one tall crystal spire on the left with a smaller crystal growing from its base on the right |

### Batch 5 — light & tools (2 complex)
| # | system_name | item | shape | cells | gen | subject |
|---|---|---|---|---|---|---|
| 21 | items005_crystal_orb | Crystal Orb | rect 1x1 | (0,0) | 256x256 | a fortune teller's crystal ball on a small brass stand, swirling blue mist inside |
| 22 | items005_enchanted_lantern | Lantern | rect 1x2 | (0,0)(1,0) | 256x512 | an iron adventurer's lantern with a warm glowing flame inside and a ring handle on top |
| 23 | items005_pilgrim_torch | Torch | rect 1x2 | (0,0)(1,0) | 256x512 | a burning wooden torch wrapped in rope, with a bright orange flame at the top |
| 24 | items005_fishing_rod | Fishing Rod | L 2x3 | (0,1)(1,1)(2,0)(2,1) | 512x768 | a bamboo fishing rod standing upright on the right with a wooden reel and cork grip at the bottom left, fishing line hanging down |
| 25 | items005_grappling_hook | Grappling Hook | J 2x2 | (0,1)(1,0)(1,1) | 512x512 | a three-pronged iron grappling hook at the top right with a coiled hemp rope beneath it at the bottom left |

### Batch 6 — consumables (0 complex)
| # | system_name | item | shape | cells | gen | subject |
|---|---|---|---|---|---|---|
| 26 | items005_golden_apple | Golden Apple | rect 1x1 | (0,0) | 256x256 | a shiny golden apple with a single green leaf on its stem |
| 27 | items005_roast_meat | Roast Meat | rect 2x1 | (0,0)(0,1) | 512x256 | a glazed roasted meat joint on a white bone, lying horizontally |
| 28 | items005_antidote_vial | Antidote Vial | rect 1x1 | (0,0) | 256x256 | a small round glass vial of bubbling green antidote potion with a cork stopper |
| 29 | items005_powder_keg | Powder Keg | rect 2x2 | (0,0)(0,1)(1,0)(1,1) | 512x512 | a wooden gunpowder keg barrel with black iron bands and a burning fuse on top |
| 30 | items005_hourglass | Hourglass | rect 1x2 | (0,0)(1,0) | 256x512 | a wooden hourglass with golden sand flowing between glass bulbs |

### Batch 7 — relics & curios (5 complex)
| # | system_name | item | shape | cells | gen | subject |
|---|---|---|---|---|---|---|
| 31 | items005_lucky_horseshoe | Horseshoe | U 3x2 | (0,0)(0,2)(1,0)(1,1)(1,2) | 768x512 | an iron lucky horseshoe with seven nail holes, a U shape with both open ends pointing up |
| 32 | items005_war_horn | War Horn | corner 2x2 | (0,0)(0,1)(1,1) | 512x512 | a curved bronze war horn carved with runes, mouthpiece at the upper left and flared bell at the lower right, crescent shape |
| 33 | items005_blacksmith_anvil | Anvil | T 3x2 | (0,0)(0,1)(0,2)(1,1) | 768x512 | a heavy blacksmith's iron anvil with a wide flat top, a pointed horn on the left, and a narrow waisted base |
| 34 | items005_cursed_doll | Cursed Doll | plus 3x3 | (0,1)(1,0)(1,1)(1,2)(2,1) | 768x768 | a creepy stitched voodoo doll with button eyes and pins, round head at the top, cloth arms outstretched to both sides, stubby legs at the bottom |
| 35 | items005_iron_chain | Iron Chain | Z 2x3 | (0,0)(1,0)(1,1)(2,1) | 512x768 | a heavy iron chain of thick interlocked links hanging in a zigzag from the top left down to the bottom right |

### Batch 8 — big finishers (4 complex)
| # | system_name | item | shape | cells | gen | subject |
|---|---|---|---|---|---|---|
| 36 | items005_war_trident | Trident | tall T 3x4 | (0,0)(0,1)(0,2)(1,1)(2,1)(3,1) | 768x1024 | a bronze trident, three sharp prongs spread across the top and a long shaft running straight down the middle |
| 37 | items005_battle_standard | War Banner | L 2x3 | (0,0)(0,1)(1,0)(2,0) | 512x768 | a medieval war banner, a red flag with a golden lion emblem flying to the right from the top of a tall wooden pole |
| 38 | items005_battle_pickaxe | Pickaxe | T 3x3 | (0,0)(0,1)(0,2)(1,1)(2,1) | 768x768 | a miner's pickaxe, a curved twin-pointed steel head spanning the top and a wooden handle straight down the middle |
| 39 | items005_giant_shuriken | Giant Shuriken | plus 3x3 | (0,1)(1,0)(1,1)(1,2)(2,1) | 768x768 | a giant four-pointed ninja shuriken throwing star with cross-shaped steel blades and a round center hole |
| 40 | items005_dungeon_key | Dungeon Key | rect 1x2 | (0,0)(1,0) | 256x512 | an ornate golden dungeon key standing upright, a decorated ring bow at the top and intricate teeth at the bottom |

Complex total: 20/40 (axe, hammer, halberd, crossbow, scythe, boomerang,
flail, boot, mana crystal, fishing rod, grappling hook, horseshoe, horn,
anvil, doll, chain, trident, banner, pickaxe, shuriken).

## SI roster (20) — kind=si, 256x256, five per slot

### Batch 9 — SI part 1
| # | system_name | slot | item | subject |
|---|---|---|---|---|
| 41 | sis005_emerald_gem | gem | Emerald | a sparkling cut emerald gemstone, deep green, faceted, centered |
| 42 | sis005_ember_core | gem | Ember Core | a round fire-orange gemstone with a small flame swirling inside, centered |
| 43 | sis005_obsidian_shard | edge | Obsidian Shard | a sharp black obsidian stone shard with glassy edges, centered |
| 44 | sis005_serrated_fang | edge | Serrated Fang | a large curved ivory beast fang with a serrated inner edge, centered |
| 45 | sis005_flame_oil | coat | Flame Oil | a small round glass flask of glowing red-orange oil with a flame emblem, centered |

### Batch 10 — SI part 2
| # | system_name | slot | item | subject |
|---|---|---|---|---|
| 46 | sis005_frost_rime | coat | Frost Rime | a small glass jar of pale blue frost salve topped with ice crystals, centered |
| 47 | sis005_leather_grip | bond | Leather Grip | a coiled roll of brown leather grip strap with a buckle, centered |
| 48 | sis005_silver_chain | bond | Silver Chain | three interlocked polished silver chain links, centered |
| 49 | sis005_sapphire_gem | gem | Sapphire | a sparkling cut sapphire gemstone, deep blue, faceted, centered |
| 50 | sis005_thunder_core | gem | Thunder Core | a round golden gemstone with a small lightning bolt crackling inside, centered |

### Batch 11 — SI part 3 (added 2026-07-16, user directive)
| # | system_name | slot | item | subject |
|---|---|---|---|---|
| 51 | sis005_moon_pearl | gem | Moon Pearl | a large round white pearl glowing with pale silver moonlight, centered |
| 52 | sis005_dragon_claw | edge | Dragon Claw | a large curved crimson dragon claw with a sharp ivory tip, centered |
| 53 | sis005_bone_spike | edge | Bone Spike | a sharp white spike carved from beast bone, with a chipped surface, centered |
| 54 | sis005_iron_caltrop | edge | Iron Caltrop | a small black iron caltrop with four sharp spikes, one spike pointing up, centered |
| 55 | sis005_venom_flask | coat | Venom Flask | a small round glass flask of bubbling purple poison with a skull emblem, centered |

### Batch 12 — SI part 4 (added 2026-07-16, user directive)
| # | system_name | slot | item | subject |
|---|---|---|---|---|
| 56 | sis005_holy_water | coat | Holy Water | a small round glass flask of glowing golden holy water with a cross-shaped cork stopper, centered |
| 57 | sis005_tar_pot | coat | Tar Pot | a small clay pot filled with thick black sticky tar dripping over its rim, centered |
| 58 | sis005_golden_thread | bond | Golden Thread | a wooden spool wound with glowing golden thread, centered |
| 59 | sis005_hemp_rope | bond | Hemp Rope | a coiled ring of thick brown hemp rope tied with a knot, centered |
| 60 | sis005_iron_rivet | bond | Iron Rivet | a cluster of three polished iron rivets with round dome heads, centered |

Design notes: no name collisions with live content (blade/hilt/flame_tablet/
oil_flask/dagger/herb_pouch/tower_shield/beast_jaw, acc_*); SI slots follow
vocab socket_tags (gem/edge/coat/bond); PO concepts map onto po_tags roots
(Weapon/Shield/Rune/Reagent/Relic/Curse + Metal/Wood/Beast/Flame/Frost/Oil/
Poison attributes) for later content-data work. Existing adopted items are
left untouched; re-generation of weak ones is a follow-up only if the user
flags them at review.

## Ops notes

- Generation via curl on the server against localhost:8802 /api/art
  (item_admin dev fallback), NOT via browser — 4 seeds x 48 = 192 renders.
  Budget: first render of a run 450-540 s cold load; per prompt change
  30-170 s; same-prompt renders 2-20 s => roughly 2-3 h GPU total,
  ~10-20 min per 5-item batch. Advisory kits auto-run (matte.coverage_band,
  po.cell_packing / si.subject_frame); they never gate adoption.
- Artwork rows are created per batch right before that batch generates
  (artworks are not deletable via the API; avoids orphan rows on plan NG).
- ComfyUI must be up (checked); nothing else may hold the GPU.

## Status log

- 2026-07-15: plan drafted; awaiting user plan review before batch 1.
- 2026-07-15 (later, user directive in the REQ-0187 session): all 40 PO
  artworks registered in one pass with first-draft prompts/shapes from this
  plan (flail wording de-diagonalized, doll given legs, §0.2 applied);
  **3 seeds per item (101/202/303), user override of the 4-seed line above**;
  ~120 renders queued fire-and-forget. Iteration/adoption belongs to the next
  agent session. SI batches 9-10 NOT started.
- 2026-07-16: +12 SI added (#49-60, user directive: 20 SI total, 5 per
  socket_tag slot); all 20 SI registered via POST /api/art/artworks
  (kind=si, 256x256, default template, no style_override). Seed generation
  NOT run (user directive) — renders pending user go-ahead.
