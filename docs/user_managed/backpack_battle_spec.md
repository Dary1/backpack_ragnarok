```yaml
game_system: "multi-squad backpack battler"
source: "formation.xlsx (labels only; the AUTHORITATIVE formation data is content/live/dungeon/formations.json)"
status: "rules confirmed by designer; implemented and live in sim/ (REQ-0036/0047)"

field:
  bounds: "A1:Z18"          # 26 cols (A-Z) x 18 rows
  shape: "TWO independent A1:Z18 planes -- one player plane, one enemy plane. A ray is fired ONTO the opposing plane. Within the player plane, all 4 squads share one coordinate plane."
  boundary_role: "ONLY reflection surface for attack lines"
  note: "empty gaps between squad canvases are NOT walls; rays pass through freely"
  entry_points:
    - "an attack enters from one edge of the target plane; the edge comes from the skill's attack_profile"
    - "the entry cell is DERIVED, not free: the attacker's cell centroid is projected onto that edge and jittered, then clamped to the board -- any edge cell is reachable, but the attacker does not choose it"
    - "the diagonal direction is fixed only on the left edge (↘) and the right edge (↙); the top edge fans ↙/↘ and the bottom edge fans ↗/↖, and one of the two is drawn at random"

attack_line:
  movement: "45-degree diagonal, one cell per step, starting from an edge entry point"
  on_hit_occupied_bp:
    default: "stops, deals damage to that BP"
    with_penetration_N: "passes through N occupied BPs before finally stopping"
  on_hit_boundary_no_bp_found: "reflects diagonally (bounce), continues traveling. a bounce never consumes penetration"
  on_hit_destroyed_bp: "passable — treated as empty, does not stop or block"
  bounce_damage_scaling:
    bounce_1_2: "+0% (normal)"
    bounce_3: "+50%"
    bounce_4: "+100%"
    bounce_5: "+150%, AND instead of continuing, immediately hits ALL LIVE OCCUPANTS on the field (BPs and enemies alike) at +150%, applies its AOE splash at the last in-field cell, and terminates the ray"
  aoe_effects: "some attacks also splash damage to other occupants within a skill's AOE range on landing, in addition to the primary hit. AOE range is measured in SHARED-FIELD cells, as a Chebyshev radius around the landing cell"

squad_canvas:
  definition: "each squad owns a fixed 8x8 sub-grid within the shared field, marked by thick dark-red borders"
  contents: "many backpacks (BP), each BP has its own HP pool. a squad itself has no HP"
  cell_rule: "1 BP per cell max, no stacking"
  layout_source: "pre-built by the player before the match, like a loadout"
  layout_mutability: "LOCKED for the duration of the match — cannot reassign/move BPs mid-fight"
  fill_style: "mostly pre-filled and finalized before entering combat; not a live packing puzzle like Backpack Hero — closer to Path of Exile's build-then-play loop"
  destroyed_bp_state: "becomes passable once HP hits 0"

# NOTE on the slot keys below: unit1..unit4 are the LIVE PERSISTED slot-key VALUES
# (server SQUAD_SLOTS, content/live/dungeon/formations.json, saved rooms/runs). They
# were deliberately kept legacy through the Unit/Squad rename (REQ-0124). They name
# SQUADS, not Units. Do not rename them here -- the doc would then contradict the data.
formations:
  - id: formation1
    description: "standard — 2 frontline squads cover 2 backline squads"
    canvases:
      unit1: "F2:M9"
      unit2: "N2:U9"
      unit3: "B10:I17"
      unit4: "R10:Y17"
    verified_issue: >
      Side-entry rays at rows 10-17 hit Squad3/Squad4 on their very first step,
      completely bypassing Squad1/Squad2 (rows 2-9). Since inter-canvas gaps
      don't bounce, "frontline covers backline" only holds for TOP-entering
      attacks, not SIDE-entering ones at backline height.

  - id: formation2
    description: "Squad1 is the main tank up top; Squad4 is very well protected behind it"
    canvases:
      unit1: "J2:Q9"
      unit2: "B6:I13"
      unit3: "R6:Y13"
      unit4: "J10:Q17"
    why_squad4_is_protected: >
      Squad4 shares the same column band (J-Q) as Squad1 directly above it, and
      Squad2/Squad3's row band (6-13) overlaps both Squad1 and Squad4's zones —
      so side-entries at Squad4's height must cross Squad2 or Squad3 first.

  - id: formation3
    description: "unusual — corner squads (1,2) intentionally tank top-left/top-right diagonal fire"
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
      unit1: "B2:I9"    # left_wing
      unit2: "J2:Q9"    # center_top
      unit3: "R2:Y9"    # right_wing
      unit4: "J11:Q18"  # backline_center
    resolved_data_issue: >
      RESOLVED. The old sheet's backline_center box (J11:Q19) extended to row 19,
      OUTSIDE the field boundary (row 18), and was 9 rows tall instead of 8x8.
      The ratified fix is J11:Q18. The four boxes now carry an explicit
      squad-to-box assignment (they were previously implied by position only).
      The sim asserts at load time that EVERY formation box is exactly 8x8.
      formation.xlsx still carries the old J11:Q19 and is NOT authoritative.

resolved_items:
  - "penetration exhausted mid-flight: the ray STOPS on the hit that exhausts the budget. it does not keep bouncing. a bounce never consumes penetration."
  - "AOE/explosion radius: measured in SHARED-FIELD cells (Chebyshev radius around the landing cell), not canvas-local cells."
  - "formation4: squad-to-box assignment is now explicit (left_wing / center_top / right_wing / backline_center)."
  - "formation4: the row-18 boundary overrun is fixed (J11:Q18)."
```
