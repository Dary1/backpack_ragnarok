# Item Systems in the Backpack-Hero Genre — A Study for backpack_ragnarok

**Scope:** Backpack Hero (Jaspel, 1.0 released 2023-11-14) as the primary subject; Backpack Battles
(PlayWithFurcifer, PvP auto-battler) as the main contrast; Backpack Brawl (mobile/PC auto-battler)
as a quick third data point.
**Purpose:** extract the genre's item-system conventions and translate them into design guidance for
backpack_ragnarok (multi-backpack canvas, backpack shapes crafted by the player, exactly one
directional Linker per backpack, items confined to a single backpack, all power derived from
arrangement).

---

## 1. Item Shape System (Polyominoes)

### Backpack Hero
- Every item — including gold coins, mana stones, and curses — occupies grid cells in the backpack.
  Shapes range from 1x1 up to large multi-cell polyominoes; some items "only fit into oddly shaped
  spaces" (wiki front page). Item placement can affect, transform, or even destroy other items.
- **Rotation:** items are rotated *outside* the backpack with left/right arrow keys (CCW/CW), by
  right-click, or via an optional on-screen "rotate" button (accessibility toggle).
- **Typical shape distribution** (from item pages):
  - **1x1:** gems (Ruby, Amethyst, Emerald), mana stones (all five variants are size 1), keys,
    coins, small consumables, most "support/modifier" items.
  - **1x2 / 2x1:** shivs, daggers, Arrow (2x1), gloves, small foods.
  - **1x3 / 1x4:** swords, spears, wands, bows (long thin weapons read as "sticks").
  - **2x2 / 2x3:** shields, breastplates, books, pets.
  - **Irregular/L/T shapes:** boots, axes, instruments, some curses.
- **Design intent visible in the data:** raw power correlates with footprint; *support* items are
  deliberately tiny so they can be tucked into leftover gaps next to the big items they buff. The
  cursed-item page states it explicitly: "Smaller items tend to have more intensive downsides to
  counteract their smaller profiles, while larger items are usually more benign, with their main
  downside being filling up the backpack itself." Size itself is a balancing stat.
- **Oversized items:** Hercule Pavise (huge shield that can trigger other shields), Big Curse
  (a curse whose entire cost *is* its footprint), large armors. Oversized = high stats, low
  flexibility.

### Backpack Battles
- Item bodies are polyominoes encoded per cell; the wiki infoboxes literally store a `grid` field
  where `1` = body cell and `2` = **star-socket cell** (adjacency trigger zone around the body).
  Examples: Dagger = vertical 1x2 with 1 socket ring; Banana = 3-cell L-shape whose sockets wrap
  around it; Bloody Dagger = 1x2 body with sockets on all four sides.
- Items rotate in 90° steps while being dragged. Bags themselves are also shaped items that are
  rotated and rearranged on the canvas.
- Deliberately oversized joke/payoff items exist (Impractically Large Greatsword,
  Impractically Large Bloodthorne) — the genre's running gag that footprint is the real price tag.

### Backpack Brawl
- 6x9 fixed inventory canvas; bags are shaped items placed on it, and only bag cells accept items.

---

## 2. Grid / Bag System (How Space Grows)

### Backpack Hero
- **Space is the XP reward.** On level-up you add cells to the backpack. In 1.0 this became
  *pocket-based*: you either enlarge an existing pocket by attaching a Tetris-shaped cell cluster
  or start a new, disconnected pocket (namu.wiki: "you can increase the size of existing pockets by
  adding Tetris block-shaped pockets, or create separate pockets"). Early levels grant ~4 cells,
  later levels fewer (~2), so space inflation decays.
- **Pockets matter mechanically:** some item effects reference "other pockets" (e.g., effects that
  buff instruments or armor in a *different* pocket), so splitting your bag is a build choice, but
  too many fragments become hard to manage. This is the closest existing analog to our
  multi-backpack canvas.
- **Bag-in-bag:** the Pouch opens a 3x3 sub-inventory via right-click, but stored items are fully
  inert (no combat use, no passive effects, not even end-of-combat triggers). Storage, not power.
- **Dead space handling:** empty cells are not wasted by definition — several items *consume*
  empty space as a resource (Arrow gains damage per empty cell to its right; Keg spawns a drink
  into an empty cell in its row). Gravity-flavored placement rules exist: some items are "heavy"
  (sink to the bottom of the bag) or "light" (float to the top), e.g. Keg is heavy, Balloon is
  light and can prop heavy items upward.
- Character variants: Purse = classic growing bag; Satchel = fixed total size but pocket-shaped;
  CR-8 = circuit board bag; Tote = part of the bag is fed by a carving deck each turn.

### Backpack Battles
- Fixed **63-tile canvas**; each class starts with 12–14 unlocked tiles from its starting bag(s).
  You buy more bags (Leather Bag, Fanny Pack, Stamina Sack, Potion Belt, Protective Purse) to
  unlock more tiles. Bags both **add cells and carry an aura** (Fanny Pack: "+2 slots; items inside
  trigger 10% faster"). Bags can be picked up together with their contents.
- A separate **Storage** panel holds any number of items with zero effect — the pressure valve for
  hoarding without polluting the combat build.

### Backpack Brawl
- Same pattern: inert 6x9 canvas, bags unlock usable cells, items only inside bags.

**Genre convention:** space is the true progression currency, it is granted in small shaped
increments, and "inactive storage" always exists somewhere so players can hold options without
power creep.

---

## 3. Item Categories, Classes, and Tag Taxonomy

### Backpack Hero (multi-tag system; items usually carry 1–3 tags)
- **Weapons:** Melee (swords, maces, cleavers, shivs, hammers, nunchucks), Bows + **Arrows**
  (arrows are themselves items consumed/fired by bows), Wands (mana-powered), thrown
  (darts/shurikens). Sub-families like *Cleaver* have their own tag and intra-family synergies.
- **Defense:** Shields, Armor split into slots-as-tags: Helmet, Clothing, Footwear, Glove.
- **Accessories:** rings, necklaces, whetstones, hourglasses — mostly passive modifiers.
- **Gems:** 1x1 positional buff stones (Ruby, Amethyst, Emerald, Citrine, Peridot, Diamond...).
- **Mana Stones:** 1x1 batteries; **conductive** — they must form a contiguous path to the magic
  items they power (a literal wiring system).
- **Consumables:** food, drinks, potions; destroyed on use.
- **Relics:** global rule-changers ("all Weapons get +200% damage..." — Hourglass).
- **Curses:** harmful items forced into your bag; all shapes/types; removed by cleansing or
  destruction; deliberately double-edged.
- **Structures:** Brick, Roof, Balloon — inert blocks that buff each other positionally
  (Roof: "+1 defense to structures below").
- **Currency-as-items:** Gold and Keys physically occupy the bag.
- **Character-exclusive families:** Carvings (Tote), Circuit components (CR-8: cores, batteries,
  boosters, repeaters), Pets + Treats (Pochette), Instruments (Satchel).

### Backpack Battles (three orthogonal tag axes)
1. **Class:** Neutral + Ranger / Reaper / Berserker / Pyromancer / Mage / Adventurer / Engineer
   item pools (plus a subclass choice mid-run that opens another pool).
2. **Type (structural):** Accessory, Armor, Bag, Food, Gemstone, Gloves, Helmet, Pet, Playing
   Card, Potion, Shield, Shoes, Skill, Spell, Weapon, Book, Chess Piece.
3. **Extra type (elemental/faction):** Melee, Ranged, Effect, Nature, Magic, Holy, Dark,
   Vampiric, Fire, Ice, Musical.
- Synergies almost always reference **tags**, not specific items ("per adjacent Vampiric item",
  "per different Food"), which keeps the combination space wide with a small vocabulary.

---

## 4. Adjacency & Positional Synergy Patterns (the heart of the genre)

Enumerated pattern types, each with real item examples:

**P1. "Adjacent to tag X → Y" (orthogonal neighbor buff)**
- Ruby (BH): "adjacent Weapons get +4 damage."
- Bloody Dagger (BB): heals 4 per adjacent (star-socketed) Vampiric item.
- Black Mana Stone (BH): capacity +1 for each adjacent/diagonal mana stone destroyed.

**P2. Row / column beams**
- Amethyst (BH): "Weapons in this row get +2 damage." Emerald: same for its column.
- Whetstone (BH): "On use, Weapons in this row or column get +3 damage this combat."
- Keg (BH): "On use, creates a drink in a space in this row."

**P3. Directional / pointing effects (item has sided semantics)**
- Left Glove / Right Glove (BH): gains block "when a space to the right / left."
- Spiked Helmet (BH): "When a space above this, this item gets -2 Spikes and -1 block;
  Helmets to the right get -1 block."
- Roof (BH structure): "+1 defense to structures below." Arrow (see P4) also points.

**P4. Empty-space / runway consumption**
- Arrow (BH): "+1.5 damage for each empty space to the right" — wants clear runway.
- Heavy/Light physics (BH): Keg sinks, Balloon floats — empty space determines where they settle.

**P5. Containment aura (inside-a-bag bonus)**
- Fanny Pack (BB): items inside trigger 10% faster.
- Protective Purse / Potion Belt (BB): type-specific bonuses to contained items.
- BH pockets: certain effects target items "in other pockets" — pocket membership as a zone tag.

**P6. Connectivity / path networks (flow mechanics)** ← most relevant to our Linker
- Mana Stones (BH): "This item is conductive. It must form a path to the items it powers."
- CR-8's circuit (BH): a 3-energy orb leaves the core and physically travels through touching
  components, activating each; batteries/boosters/repeaters queue additional orbs ("hold" system).
- Combo chains: King Cleaver triggers the 4 adjacent cleavers; Shield Spirit makes shields trigger
  weapons; Hercule Pavise uses other shields. Anti-infinite rule: an item cannot be re-activated
  by the same source in one resolution.

**P7. Counting / surround thresholds**
- Goobert (BB): "5 star item activations → heal 9" — counts activations of surrounding items.
- Food rule (BB): each food triggers 10% faster per *different* adjacent food (anti-stacking
  clause: identical neighbors don't count, and each socket must be a different item).
- Brick/Wall structures (BH): +armor per adjacent structure in all directions.

**P8. Global / rule-changing auras (position-free relics)**
- Hourglass (BH): "all Weapons get +200% bonus damage, but on use they permanently lose 1 damage
  per turn" — global buff with a decay tax.
- Belt of Knives (BH relic): applies "on use, adjacent Weapons +3 damage this turn" *to every
  weapon* — a relic that retro-fits a positional effect onto the whole inventory.

**P9. Ordering / scan-line priority (position = initiative)**
- BH passive items resolve **top-left → bottom-right** ("comic book order"); for multi-cell items
  the bottom-right corner counts. Players exploit this (put armor at top so block exists before a
  self-damaging Tooth Necklace at bottom fires).

**P10. Adjacency-triggered transformation (crafting by placement)**
- BB recipes: compatible items placed adjacent combine during the next shop phase
  (Dagger + Blood Amulet → Bloody Dagger); catalysts (e.g., any Fire item "lights" Torch →
  Burning Torch) survive the craft.
- Backpack Brawl: connected ingredient groups merge after the fight; for 3+ ingredient recipes the
  *first* ingredient must be the connector touching all others (Magic Essence at the center of
  Infinity Essence).

---

## 5. Combat Stat Conventions

### Backpack Hero (turn-based)
- **Energy:** 3 per turn baseline; every active item lists an energy cost (0–3); unaffordable
  items are visually dimmed. Energy is also spent on special actions (reorganizing mid-combat).
- **Mana:** a stored resource stocked in mana-stone items; starts each combat full, does *not*
  regenerate per turn; refilled by items (Ancient Tome, Wizard's Robe passives).
- **Damage / Block:** flat numbers per use; Block expires at the start of your next turn and is
  consumed before HP. Projectiles are a damage subtype (ignore Spikes, halved by Rough Hide).
- **Uses per turn:** items are once-per-turn by default; some multi-use ("can be used 2 times");
  consumables destroy themselves on use.
- **Scaling durations:** "+X this turn" < "+X this combat" < permanent (+X forever) — three
  standard time windows on every buff, plus permanent *decay* as a cost (Hourglass).
- No crit convention; randomness lives in drops, not in combat rolls.

### Backpack Battles (real-time auto-battler)
- Per-weapon statline in the infobox: **min–max damage, stamina cost, accuracy %, cooldown (sec),
  sockets** (e.g. Dagger: 2–5 dmg, 0 stamina, 95% accuracy, 3.5s cooldown, 1 socket).
- **Stamina:** global pool with passive regen; 0-stamina weapons (Dagger) are "free" damage;
  running dry stalls attack items.
- **Cooldown** replaces turn cost; **Heat/Cold** buffs shift all trigger speeds ±2% per stack.
- **Accuracy & crit:** attacks can miss; crits deal double damage; Luck +5% accuracy per stack,
  Blind -5%.
- **Fatigue:** escalating damage-over-time to both players starting at "nightfall" — the
  anti-stall clock every auto-battler needs.

---

## 6. Status Effect Taxonomy

### Backpack Hero — small, symmetric, decays 1 stack per turn (universal rule)
| Kind | Effect (X = stacks) |
|---|---|
| Haste / Slow | each block instance gives +X / −X block |
| Rage / Weak | each hit deals +X / −X damage |
| Spikes | attacker takes X on melee hit |
| Poison | X damage at end of turn; ignores Block and Dodge; if stacks > enemy HP their turn is skipped |
| Burn | X damage at start of turn; blockable |
| Freeze | take X extra damage when hit |
| Regen | heal X at start of turn |
| Dodge | negate X hits |
| Charm | stacks > enemy HP flips the enemy to your side |
| Sleep / Rough Hide / Curse | turn-skip; −50% projectile damage (non-stacking); combat-end loot replaced by a cursed item |

Items apply statuses via clean verb templates: "On use, Adds N <status> to <target>"
(Bramble: 10 Poison to all enemies *and* 10 to self), "When attacked, Adds 1 Spikes to self"
(Cactus), "Each turn, Adds 2 Spikes to self" (Spiked Helmet). Scaling comes from adjacency buffs
(whetstones add poison/damage to *weapons* rather than to the enemy directly).

### Backpack Battles — buff/debuff + one-shot combat verbs
- **Buffs:** Empower (+1 weapon dmg/stack), Heat (+2% speed), Luck (+5% accuracy), Mana (magic
  resource), Regeneration (1 HP per stack / 2s), Spikes (reflect 1/stack vs melee, capped at 100%
  of hit), Vampirism (heal 1/stack on melee hit, same cap).
- **Debuffs:** Blind, Cold, Poison (1 dmg per stack / 2s).
- **Framework verbs:** Block, Heal, Stun, Invulnerability, Nullify (blocks next buff), Resist
  (blocks next debuff), Reflect (bounces next debuff), Reincarnate, Fatigue.
- Statuses are applied by item event hooks: **Start of battle:** (Burning Torch: gain 2 Heat),
  **On hit:** (gain 1 Vampirism, capped 5/battle), **Every 5s:** (Banana: heal 4, +1 stamina).

---

## 7. Rarity, Upgrading, Crafting

### Backpack Hero
- Rarities: **Common / Uncommon / Rare / Legendary** (grey/green/yellow/purple); Luck stat raises
  the minimum rarity of drops. Relics sit outside the normal pool.
- **No inline item levels.** Instead, the **Refinery** map node sells item *modifications* for
  gold (e.g., "+3 weapon damage 12g", "+1 weapon poison 12g", "+2 shield defense 10g", "make item
  conductive 2g", "+1 clothing energy 40g") — four random smelt offers per visit. Item *families*
  (Cleaver → Gold/Queen/King Cleaver) act as manual tier ladders through drops rather than
  upgrades.
- Weighted drop odds: owning several items of a theme raises the odds of matching items
  (build-aware loot), plus deliberate RNG-manipulation surface.

### Backpack Battles
- Rarities: **Common / Rare / Epic / Legendary / Godly / Unique** with a published per-round shop
  probability curve (Common 90%→20% by round 12; Godly 0%→20%). Uniques: max 1 owned, 2–3% chance,
  only on shop entry, never on rerolls.
- **Recipes are the upgrade system:** ingredients placed adjacent combine in the next shop phase;
  right-click locks an item to *prevent* combining; catalysts persist. The in-game recipe book
  shows silhouettes until first discovery (collection meta). Some items exist *only* to gate shop
  pools (Box of Riches / Deck of Cards add otherwise-unavailable items to the shop).
- **Subclass pick at round 8** adds a second build axis mid-run.
- The **star/diamond sockets** (Section 4, P1/P7) are the "ranks": an item's effective tier is how
  many of its sockets you can feed.

### Backpack Brawl
- Adjacency-merge crafting with no per-round limit; Lucky/Golden Clover items upgrade shop item
  rarity on reroll (Cursed Clover downgrades); paid Banish (remove item from run's pool) and paid
  instant Crafting Hammer.

---

## 8. Economy Loop

### Backpack Hero (PvE dungeon)
- Gold is loot that **occupies backpack space**, making wealth itself an inventory-tetris cost.
- Merchants price by item value; you may sell only ~3 items per shop, so junk disposal is a
  scarce resource. Piggybank ("creates 2 Gold when combat ends") turns a bag slot into income.
- Barter NPCs: Sucker (pay gold for a random same-size item), Sulky (swap an item for a random
  same-rarity item — the official cure for oversized junk), Chef/Alchemist (themed vendors),
  Refinery (see §7), Healer (pay 10g to cleanse all curses vs. heal).

### Backpack Battles (PvP shop loop)
- Start 12g / 25 HP; +9–15g per round on a published schedule; HP pool also grows per round.
- Shop = 5 slots; reroll costs 1g (first four rerolls) then 2g; right-click **Reserve** to keep an
  item through rerolls; 10% chance per item of a half-price Sale; selling returns half price
  (dragging onto Chestnut the chest). Buy on sale → sell = net zero, an intentional floor.
- Recipe economy: two cheap commons can become an item worth far more than their sum, so gold →
  ingredients → crafted spike in power; recipe knowledge is literally player skill.

### Backpack Brawl
- Escalating reroll pricing (1g/2g/3g tiers), sale + reserve + buy-back, paid banish/craft.

---

## 9. UI / UX Conventions

- **Drag & drop everywhere** — buy by dragging from shop to bag; sell by dragging onto a
  character/chest; storage vs. active inventory as two visible zones (BB, Brawl).
- **Rotation input:** BH: arrow keys / right-click / optional on-screen rotate button while the
  item floats on the cursor; BB/Brawl: rotate while dragging. Rotation only happens *outside* a
  placed state.
- **Placement feedback:** valid/invalid cell highlighting under the dragged item; BH dims items
  whose energy cost is unaffordable this turn; heavy/light items animate to their resting cells.
- **Synergy highlighting is the killer feature:** BB draws a **blue glowing line** between
  compatible recipe items on hover and an **orange line** once they're adjacent (combine armed);
  star sockets on the tooltip show exactly which neighbor cells feed the item, and filled sockets
  light up. Brawl draws light beams linking craft-ready groups. BH highlights the affected
  row/column/adjacent cells when hovering positional items.
- **Tooltip structure (both games):** name + rarity color; type tag icons; the statline block
  (BB: min–max dmg / stamina / accuracy / cooldown); effect text in **event-verb templates**
  ("Start of battle:", "On hit:", "On use:", "Each turn:", "When attacked:"); footprint/socket
  diagram; buy/sell price.
- **Anti-accident affordances:** right-click to lock/reserve (prevents rerolling away or
  accidental combining); recipe book with unlock silhouettes; combat log (BB) for auditing why a
  build lost.
- **Order legibility gap (lesson):** BH's top-left→bottom-right activation order is *not*
  surfaced in the UI — players learn it from guides; a known pain point worth fixing in our game.

---

## 10. Design Lessons for backpack_ragnarok

Our constraints: player crafts backpack *shapes*, tiles them on a canvas; exactly one directional
Linker per backpack; items never span two backpacks; strength comes ONLY from arrangement.

1. **Make item size the primary cost axis.** Genre-proven: payoff items big, modifiers 1x1–1x2,
   curses small-but-nasty or big-but-mild. Since we have no stat upgrades, footprint and shape
   *are* our rarity curve — publish a deliberate shape distribution (~40% 1-cell, ~35% 2–3 cell,
   ~20% 4–5 cell, ~5% oversized) instead of letting it drift.
2. **Reference tags, not items, in every synergy.** "Adjacent Weapons +4" (Ruby) scales across the
   whole catalog; "adjacent to Sword of Foo" doesn't. Give each item one structural type + up to
   two element/faction tags, BB-style, and write all effects against that vocabulary.
3. **Row/column effects become backpack-shape design.** In BH a Whetstone wants a long row; in our
   game the player can *craft* a 1x6 backpack to be a whetstone rack. Scope all row/column/aura
   semantics to a single backpack — this makes bag-shape crafting meaningful and silently enforces
   the "items never span backpacks" rule in the player's mental model.
4. **The Linker is CR-8's circuit + BH mana conductivity, formalized.** Both precedents prove
   flow/network mechanics work but need heavy visualization: animate a pulse traveling through the
   Linker, highlight the powered path on hover, and adopt BH's anti-infinite failsafe (an item
   cannot be re-triggered by the same source in one resolution pass).
5. **Directionality needs sided item art.** BH's Left/Right Gloves, Arrow runways, and Roof work
   because the sprite visibly points. Our directional Linkers and any pointing items must encode
   direction in the artwork, not only in tooltip text.
6. **Deterministic, visible resolution order.** BH's hidden comic-book order is a top community
   complaint-turned-guide. With multiple backpacks the order question doubles (order of backpacks
   × order within a backpack). Suggest: Linker-chain order first, then top-left→bottom-right
   within each backpack — and *number the items in the UI* during a preview mode.
7. **Empty space must be a resource, not a failure state.** Arrow's runway, Keg's spawn cell, and
   balloon/heavy physics all reward leaving holes. With player-crafted backpack shapes, include
   item families that pay for emptiness or for touching the backpack's wall cells, so "small
   elegant backpack" and "big hollow backpack" are both archetypes.
8. **Give every backpack an identity, or multi-bag becomes bookkeeping.** BH pockets show players
   fragment poorly without reasons: add per-backpack auras (BB's Fanny Pack pattern) and
   cross-backpack effects that only the Linker can carry — the reward for splitting must be
   explicit, and one Linker per backpack caps the graph complexity nicely.
9. **Spatial crafting is the cheapest content multiplier.** BB/Brawl recipes (adjacency-combine,
   catalysts, lock-to-prevent) turn shop commons into discovery content and double as placement
   puzzles. In our constraint set, recipes should resolve within one backpack; a signature twist:
   *Linker-powered crafting*, where a recipe needs ingredient A in the source backpack and B in
   the Linker's target backpack.
10. **Keep the meta-loop boring and conventional.** 5-slot shop, cheap rerolls, reserve/lock,
    sell-for-half, occasional sales, escalating gold per round — players arrive pre-trained. Spend
    the innovation budget on arrangement, not on the economy.
11. **Statuses: few, orthogonal, with one universal decay rule.** BH's "every stack −1 per turn"
    plus paired opposites (Rage/Weak, Haste/Slow) is far easier to read than BB's timer soup.
    Pick 6–8 statuses; make items apply them through the standard verb templates ("On use / Each
    turn / When attacked, add N X to target") so tooltips stay machine-generatable.
12. **Tooltip + hover highlighting is half the game.** Minimum viable tooltip: footprint diagram,
    tags, trigger event, effect, and — most importantly — live highlighting of the affected
    cells/partners on hover (BB's blue/orange recipe lines are the single most copied UX feature
    in the genre). For us, hovering a Linker should light the entire downstream backpack.

### Pitfalls observed
- **Hidden resolution order** (BH) breeds wiki-dependence — surface it.
- **Inert storage inside the combat space** (BH Pouch) confuses players about what is "active";
  our canvas needs an unambiguous active/inactive visual language per backpack.
- **Same-item stacking exploits** — BB's food rule ("different food only, one socket per distinct
  item") exists because naive adjacency counting gets degenerate; write anti-stacking clauses into
  every counting effect from day one.
- **Curses only work if removal is scarce** (BH: cleanse items, healer fee, or destruction) —
  don't add negative items without a removal economy.
- **Rarity inflation without shape variety** reads as stat inflation; BH keeps legendaries
  interesting by making them *weirder-shaped or rule-breaking* (Hourglass), not just bigger
  numbers.

---

## Quick Comparison Table

| Dimension | Backpack Hero | Backpack Battles | Backpack Brawl |
|---|---|---|---|
| Combat | Turn-based, player-piloted | Real-time auto-battler PvP | Real-time auto-battler |
| Space growth | Level-up adds shaped pocket cells | Buy bags on fixed 63-tile canvas | Buy bags on 6x9 canvas |
| Turn resource | 3 Energy/turn + stored Mana | Stamina regen + cooldowns | Cooldowns |
| Rarities | 4 (C/U/R/L) | 6 (C/R/E/L/Godly/Unique) | Tiered + clover manipulation |
| Upgrading | Refinery mods; item families | Adjacency recipes + catalysts | Adjacency merges |
| Signature positional idea | Rows/columns, pointing, conductive paths, circuits | Star sockets, bag auras, recipe adjacency | Connector-item recipes |
| Anti-stall | — (turn-based) | Fatigue at nightfall | Similar timer |

---

## Sources

**Backpack Hero**
- https://backpackhero.wiki.gg/ (main page: controls, rotation, item space rules)
- https://backpackhero.wiki.gg/wiki/Status_Effects
- https://backpackhero.wiki.gg/wiki/Category:Items (tag taxonomy, item family subcategories)
- https://backpackhero.wiki.gg/wiki/Cursed_Items
- Item pages (wiki.gg): Ruby, Amethyst, Cactus, Bramble, Cleaver, Crossbow, Keg, Piggybank, Pouch,
  Belt_of_Knives (e.g. https://backpackhero.wiki.gg/wiki/Ruby)
- https://backpack-hero.fandom.com/wiki/Buffs_and_Debuffs
- https://backpack-hero.fandom.com/wiki/Rarity
- https://backpack-hero.fandom.com/wiki/Mana_Stones (conductivity/path rule, spawn math)
- Fandom item pages: Whetstone, Emerald, Left_Glove, Spiked_Helmet, Hourglass, Arrow, Longbow, Purse
- Steam guide "(Advanced) — The inner workings of Backpack Hero" (activation priority, combo
  chains, CR-8 circuit): https://steamcommunity.com/sharedfiles/filedetails/?id=2941982865
- namu.wiki Backpack Hero article (1.0 systems: energy/mana, pockets on level-up, refinery prices,
  structures, heavy/light, NPC economy): https://en.namu.wiki/w/%EB%B0%B1%ED%8C%A9%20%ED%9E%88%EC%96%B4%EB%A1%9C
- Steam store page: https://store.steampowered.com/app/1970580/Backpack_Hero/

**Backpack Battles**
- https://backpackbattles.wiki.gg/wiki/Game_Mechanics (inventory tiles, shop math, buffs/debuffs,
  star/diamond activations)
- https://backpackbattles.wiki.gg/wiki/Items (class/type/extra-type/rarity taxonomy)
- https://backpackbattles.wiki.gg/wiki/Rarity
- https://backpackbattles.wiki.gg/wiki/Recipe
- https://backpackbattles.wiki.gg/wiki/Bag and /wiki/Food (bag auras, food adjacency rule)
- Item pages: Dagger, Banana, Goobert, Bloody_Dagger, Burning_Torch, Fanny_Pack
  (e.g. https://backpackbattles.wiki.gg/wiki/Bloody_Dagger)
- https://backpackbattles.wiki.gg/wiki/Characters (Chestnut sell mechanic)

**Backpack Brawl**
- https://backpackbrawl.wiki.gg/wiki/Basic_Guide (grid, crafting connector rule, shop/banish/hammer)
