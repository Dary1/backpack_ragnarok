# Batch-001 — Niflheim Shards (Frost family) — Design Notes

## Family identity
The Frost family is the "arrangement tax" element: almost nothing it does is worth points on its own tile. Its job is to *convert* your existing engine. Chill is the family's currency — Rime Shard and the violator seed it, Glacier Cleaver self-applies it, and the payoff pieces (Hoarfrost Creep, Niflheim Crown) *amplify* it. The deliberate twist is that Frost's biggest multipliers key off **Flame adjacency**: instead of frost and fire cancelling, the mist "drinks" the heat, so a player already running a Flame/Oil Burn board must decide whether to bolt a cold amplifier onto the hottest corner of the bag. That pulls two families into the same cramped real estate and forces genuine polyomino compromises. Metal appears as the structural thread (nails, cleavers, crowns) so Frost can borrow the existing Metal-socket accessory ecosystem (Whetstone, Ruby) without inventing new tags. Defensively, Permafrost Ward rewards clustering Frost, giving cold a build path that isn't just poking damage. The result: Frost is low-floor, high-ceiling, and every strong Frost line is a physically awkward one.

## Per-entry notes

**rime_shard** (Gem, Common, 2 cells, domino).
Intent: the on-ramp — a cheap adjacency Chill applier so any early weapon starts inflicting cold. Puzzle: it only pays when touching a Weapon *type*, so you must dock it against your attacker, not park it in dead space. Shape is a plain domino on purpose — the *placement* is the constraint, not the outline. Hook: feeds every amp piece below and any OnPOHit synergy.

**frost_nail** (WeaponPart, Common, 3 cells, I-tromino).
Intent: a lean assemble-part payoff that's inert until built into `frostpick`. Puzzle: a 3-tall vertical bar is genuinely hard to seat in a wide bag, and it carries a Metal edge socket, so you also want a Whetstone/Arrowhead line-of-sight. Shape is interesting because it's a long thin column that fights horizontal layouts. Hook: assembled-only strike + Metal edge socket ties into the existing WeaponPart/accessory loop.

**hoarfrost_creep** (Reagent, Common, 3 cells, L-tromino).
Intent: the "frost drinks fire" amplifier — doubles Chill *when adjacent to Flame*. Puzzle: it demands you nestle cold into your hot corner, competing with Oil Flask for the same Flame neighbor. The L bend lets it wrap a corner, which is exactly where a Flame Tablet often sits — awkward but rewarding. Hook: cross-family bridge (Frost x Flame), pairs with rime_shard's Chill output.

**glacier_cleaver** (Weapon, Uncommon, 4 cells, S/Z-tetromino).
Intent: the family's self-sufficient carry — strikes every 2 ticks and self-Chills on hit (no adjacency needed). Puzzle: the S-tetromino is a classic hard-fit; its coat socket (Weapon-only, Metal) invites Poison Coat for a Chill+Poison stack. Shape interesting: staircase forces you to build the bag around it. Hook: standalone Chill source that de-risks the amp pieces; DPT sits right at the Uncommon guideline (2.5).

**permafrost_ward** (Shield, Uncommon, 4 cells, T/plus).
Intent: gives Frost a defensive identity — battle-start block that *grows* per adjacent Frost. Puzzle: the plus/T shape has a protruding stud you must feed with a Frost neighbor to bank the bonus block, encouraging a cold cluster. Shape interesting: the center-stud outline is deliberately annoying to pack flush. Hook: rewards Frost density, anchoring a "cold wall" archetype distinct from the poke line.

**niflheim_crown** (Relic, Rare, 4 cells, T-tetromino).
Intent: the family capstone — scales its own damage per Frost tag AND doubles Chill for adjacent Frost. Two sockets (Rare allowance): a Metal gem and a Bone edge, so it can host a Ruby *and* a Bone-only edge accessory. Puzzle: it wants to be buried in a sea of Frost to max both the per-tag buff and the amp aura, which competes hard for space. Shape interesting: T-tetromino with a central knob that only tessellates cleanly against specific neighbors. Hook: the payoff that makes a mono-Frost or Frost/Flame board pop.

**frost_bead** — VIOLATOR (Gem, Common, 1 cell).
Looks like a tempting cheaper cousin of rime_shard (a mild 1-stack Chill applier). It breaks exactly one law: **single-cell scarcity** — no 1x1 non-part placement objects are allowed; former 1x1s became accessories, and this is a Gem, not a WeaponPart, so the `hilt` 1x1 exemption ("inert alone, no dead-space filler") does not apply. Everything else (vocab, effects AST, icon, unique id, tone) is clean, which is what makes it a good validator trap. Flagged with `_expect_reject`.
