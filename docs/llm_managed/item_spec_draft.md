# Item Spec — v0.1 DRAFT — **SUPERSEDED by `canvas_spec_glossary_ground_true.md`** (2026-07-02)

> Drafted per user directive: orchestrator proposes, mock GUI follows this spec.
> Grounded in `research/backpack_genre_item_study.md` and glossary v1.0.
> Combat numbers are placeholder-grade; structure is what needs review.

## 1. Definition

An **Item** is a Placement Object (PO) with:

- `id`, `name`
- `shape`: polyomino (list of occupied cells), rotatable in 90° steps outside the BP
- `tags`: 2-axis taxonomy (see §2)
- `rarity`: Common / Uncommon / Rare / Relic
- `connection ports`: (please fill)
- `effects`: list of event-verb templates (see §4)
- No character stats exist anywhere. All power comes from placement (golden P1).

The **Linker** is also a PO (1x1) but is system-provided per BP, not an inventory item
(one per BP, glossary rule 1). Linker *types* remain on hold.

## 2. Tag taxonomy (2 axes)

- **Type** (exactly one): `Weapon` / `Shield` / `Gem` / `Reagent` / `Relic` / `Curse`
- **Element** (0..n): `Flame` / `Frost` / `Oil` / `Poison` / `Gold` / `Beast` / `Metal`

Rule (from research lesson 3): synergies always reference **tags**, never specific
item ids. Example: Whetstone buffs "adjacent Weapons", not "adjacent Short Sword".

## 3. Shape distribution policy (research lesson 1: shape IS the rarity curve)

- 1x1 — modifiers/reagents/gems (cheap to fit, weak alone)
- 1x2 / 2x1 — standard weapons, relics
- L-tromino / 2x2 — strong armor, big relics
- 1x3, 2x3, 3x3 — payoff weapons/engines; **require large BPs**, which cost the
  player Linker density (One-Linker Rule). Big item = big BP = fewer Links. This is
  the intended central tension.

## 4. Effect templates (event-verb grammar; research convention 4)

`[Trigger]: [Verb] [N] [Target]`

- Triggers: `Battle start` / `Every N ticks` / `On hit (this BP's Weapons)` /
  `On this BP damaged` / `On Link pulse (reserved, Linker spec pending)`
- Verbs: `Strike N` / `Block N` / `Apply N <Status>` / `Heal N` / `Gain N gold` /
  `Buff <tag> +N`
- Scope rule: **all positional references (adjacent / row / column) are scoped to the
  item's own BP** (research lesson 2). Nothing positional crosses BP borders — only
  Links cross borders.

## 5. Status effects (initial set)

`Burn` (DoT, decays), `Poison` (DoT, persists), `Chill` (slows tick rate),
`Regen` (HoT), `Spikes` (thorns on the BP). Statuses attach to **BPs** (they are the
HP holders), not to items.

## 6. Adjacency synergy patterns (v0.1 uses only L1; from research pattern types)

1. **Adjacent-to-tag buff**: Whetstone → adjacent Weapons +2 damage.
2. **Element reaction**: `Flame` item adjacent to `Oil` item → **Ignite** (both count
   as +100% Burn application). First concrete L1 combo.
3. **Self-stacking count**: Fang: +1 damage per other `Beast` item in this BP.
4. Row/column and directional patterns: reserved for later waves (kept in research).

## 7. BP interaction (reserved seams for the Linker spec)

- Items never affect other BPs directly. The reserved trigger `On Link pulse` and
  verb target `linked BP` are the only planned crossing points, pending Linker design.
- **Cover** (one BP tanking for another) remains TBD in the Linker/combat spec.

## 8. Resolution order (research lesson 4: deterministic and visible)

Within a tick: (1) BPs act in Linker-chain order (link senders before receivers;
cycles broken by canvas reading order), (2) within a BP, items resolve top-left →
bottom-right. The UI must show this order (numbered badges).

## 9. BP HP model (mock placeholder)

`BP HP = pieces × 5`. Damage cracks the BP as a whole (piece-level cracking from
golden §4 is a later combat-spec topic).

## 10. Economy hooks (not in mock scope)

Acquisition: dungeon loot + Market (Transmutator). Item instances are physical and
unique (preset exclusivity rule). No stacking.

## 11. Initial item catalog (mock roster, 11 items)

| id | name | shape | type | elements | rarity | effects |
|---|---|---|---|---|---|---|
| greatsword | Greatsword | 1x3 | Weapon | Metal | Rare | Every 5 ticks: Strike 14 |
| dagger | Dagger | 1x1 | Weapon | Metal | Common | Every 2 ticks: Strike 3 |
| fang | Fang | 1x1 | Weapon | Beast | Common | Every 2 ticks: Strike 2; +1 dmg per other Beast in this BP |
| tower_shield | Tower Shield | 2x2 | Shield | Metal | Uncommon | Battle start: Block 12 (this BP) |
| whetstone | Whetstone | 1x1 | Reagent | Metal | Common | Adjacent Weapons: +2 damage |
| flame_rune | Flame Rune | 1x1 | Gem | Flame | Uncommon | Adjacent Weapons: Apply 2 Burn on hit |
| oil_flask | Oil Flask | 1x1 | Reagent | Oil | Common | Adjacent Flame: Ignite (+100% Burn) |
| frost_orb | Frost Orb | 1x1 | Gem | Frost | Uncommon | Every 5 ticks: Apply 2 Chill |
| poison_vial | Poison Vial | 1x1 | Reagent | Poison | Common | This BP's Weapons: Apply 1 Poison on hit |
| herb_pouch | Herb Pouch | 1x1 | Relic | — | Common | Every 4 ticks: Heal this BP 2 |
| golden_idol | Golden Idol | 1x2 | Relic | Gold | Rare | Battle end: Gain 3 gold (inert in combat — footprint-cost demo) |

## Open for user review

- Tag axes & names; status set; template grammar; shape policy; resolution order;
  BP-HP placeholder model. Everything is cheap to change at this stage.
