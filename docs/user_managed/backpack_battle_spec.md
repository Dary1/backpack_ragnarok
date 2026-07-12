```yaml
game_system: "multi-unit backpack battler"
source: "formation.xlsx"
status: "rules confirmed by designer, ready for prototyping"

field:
  bounds: "A1:Z18"          # 26 cols (A-Z) x 18 rows
  shape: "single shared coordinate plane for all 4 units"
  boundary_role: "ONLY reflection surface for attack lines"
  note: "empty gaps between unit canvases are NOT walls; rays pass through freely"
  entry_points:
    - "every cell along the outer edge (row1, row18, col A, col Z) can spawn an attack"
    - "entry cells have a fixed diagonal direction (↘ / ↙ / ↗ / ↖) the attack travels along"

attack_line:
  movement: "45-degree diagonal, one cell per step, starting from an edge entry point"
  on_hit_occupied_bp:
    default: "stops, deals damage to that BP"
    with_penetration_N: "passes through N occupied BPs before finally stopping"
  on_hit_boundary_no_bp_found: "reflects diagonally (bounce), continues traveling"
  on_hit_destroyed_bp: "passable — treated as empty, does not stop or block"
  bounce_damage_scaling:
    bounce_1_2: "+0% (normal)"
    bounce_3: "+50%"
    bounce_4: "+100%"
    bounce_5: "+150%, AND instead of continuing, immediately hits ALL BPs on the field at +150% (terminates the ray)"
  aoe_effects: "some attacks also splash damage to other BPs within a skill's AOE range on landing, in addition to the primary hit"

unit_canvas:
  definition: "each unit owns a fixed 8x8 sub-grid within the shared field, marked by thick dark-red borders"
  contents: "many backpacks (BP), each BP has its own HP pool"
  cell_rule: "1 BP per cell max, no stacking"
  layout_source: "pre-built by the player before the match, like a loadout"
  layout_mutability: "LOCKED for the duration of the match — cannot reassign/move BPs mid-fight"
  fill_style: "mostly pre-filled and finalized before entering combat; not a live packing puzzle like Backpack Hero — closer to Path of Exile's build-then-play loop"
  destroyed_bp_state: "becomes passable once HP hits 0"

formations:
  - id: formation1
    description: "standard — 2 frontline units cover 2 backline units"
    canvases:
      unit1: "F2:M9"
      unit2: "N2:U9"
      unit3: "B10:I17"
      unit4: "R10:Y17"
    verified_issue: >
      Side-entry rays at rows 10-17 hit Unit3/Unit4 on their very first step,
      completely bypassing Unit1/Unit2 (rows 2-9). Since inter-canvas gaps
      don't bounce, "frontline covers backline" only holds for TOP-entering
      attacks, not SIDE-entering ones at backline height.

  - id: formation2
    description: "Unit1 is the main tank up top; Unit4 is very well protected behind it"
    canvases:
      unit1: "J2:Q9"
      unit2: "B6:I13"
      unit3: "R6:Y13"
      unit4: "J10:Q17"
    why_unit4_is_protected: >
      Unit4 shares the same column band (J-Q) as Unit1 directly above it, and
      Unit2/Unit3's row band (6-13) overlaps both Unit1 and Unit4's zones —
      so side-entries at Unit4's height must cross Unit2 or Unit3 first.

  - id: formation3
    description: "unusual — corner units (1,2) intentionally tank top-left/top-right diagonal fire"
    canvases:
      unit1: "B2:I9"
      unit2: "R2:Y9"
      unit3: "F10:M17"
      unit4: "N10:U17"

  - id: formation4
    description: >
      wings (left/right) absorb most damage; center-top frontline only
      handles top-center fire; backline is well protected
    canvases:
      left_wing: "B2:I10"
      center_top: "J2:Q10"
      right_wing: "R2:Y10"
      backline_center: "J11:Q19"
    flagged_data_issue: >
      backline_center box (J11:Q19) extends to row 19, which is OUTSIDE the
      stated field boundary (row 18), and is 9 rows tall instead of the
      standard 8x8 — likely a sheet error, needs correction.
      Also: no Unit1-4 text labels exist on this sheet, only the 4 boxes —
      unit-to-box assignment is implied by position, not explicit.

open_items_still_unresolved:
  - "exact behavior when penetration count is exhausted mid-flight (does it stop, or keep bouncing?)"
  - "whether AOE/explosion radius is measured in shared-field cells or canvas-local cells"
  - "formation4: confirm/relabel which unit occupies which of the 4 boxes"
  - "formation4: fix the row-18 boundary overrun on the backline box"
```
