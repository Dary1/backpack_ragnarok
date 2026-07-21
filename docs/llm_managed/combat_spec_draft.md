> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# Combat Spec — v0.3-draft (for owner review)

> Design-only pass. No code or server state was touched. This spec designs the
> **combat half** of the game so it plugs into the existing **placement half**
> (`mock-src/engine.js`) without contradicting it. It cites the exact vocab
> (`content/vocab.json` v4) and engine functions by name where it relies on them.
> Everything below marked **[TUNABLE]** is a constant the owner/sim can move.
> Everything marked **[LOCKED]** is an orchestrator-decided default (user can veto async).
> Everything marked **[USER]** is a genuine open item requiring an explicit user decision.
> Everything marked **[VX-n]** is a vocabulary/schema extension request (collected at end).
>
> **v0.2 headline change (retained):** the v0.1 "cover / front-rank targeting" design was
> **DELETED** and replaced by the user-ratified **formation-ray battle system** (2026-07-05).
> All targeting and damage geometry flow from that system. Monsters shrink to **HP + a
> list of possessed skills** (ruling 3).
>
> **v0.3 headline change:** the user has **ratified a closed-vocabulary mode-tag system**
> (2026-07-05) that **RESOLVES VX-3** — the former `Tool` PO-tag placeholder is **DEAD**.
> Encounter mode-gating is now driven by a **third, separate vocabulary axis** — **mode
> tags** `battle` / `detection` / `unlock` — carried on POs and skills (same "separate
> vocabulary, same pattern" philosophy as PO Tags vs Socket Types). With this, **every open
> item is resolved**: the spec is design-complete pending a final user pass.
>
> Retained from v0.1 (still valid): event-driven seconds sim, determinism/replay log,
> status semantics, run integration, S4 tuning surface.
>
> Binding inputs honored: auto-battle (no mid-run input); seconds with decimal `[lo,hi]`
> ranges, no ticks; BPs have HP (squads have none); troop = 4 Squads; run 0→100% with traps /
> hidden doors / chests / boss resolved as combat with mode-gating; wipe = level-down +
> cooldown, nothing lost/gained; runs on COPIES; deterministic server sim + spectate log.
> Reference games (owner-endorsed): Loop Hero (auto-run), Slay the Spire (intent
> telegraph), PoE (pack grammar), Darkest Dungeon (trap/curio/role flavor).

---

## 0. What changed v0.1 → v0.2 (orientation)

| area | v0.1 | v0.2 |
|---|---|---|
| targeting / damage geometry | designed "front-rank cover" on the placement grid | **DELETED** → **formation-ray system** on a shared 26×18 field (§2) |
| enemy model | flat def with `actions[]` (verb + every_secs + reach + telegraph) | **HP + skill-id list only** (ruling 3); skills use the PO pipeline (§4) |
| player attacks | verbs hit "lowest-HP enemy" | PO effects gain an **attack-profile** → fire **rays** onto the enemy field (§3–4) |
| two fields | one (player BPs only) | **two coexisting A1:Z18 planes** — player field + enemy field (§2.1) |
| formations | none | **content** (`formation` defs; the 4 from formation.xlsx) (§5) |
| cover / OQ4–OQ6 | open | **SUPERSEDED** by ray geometry |
| open questions | 19 open | **all resolved as [LOCKED] defaults** (§9); VX-3 now **RESOLVED** by the ratified mode-tag system — **no open items** |
| VX list | VX-1/2/3 | VX-1 (BP hp, *genuinely new*), VX-2 (enemy/formation schemas), **VX-3 RESOLVED** (`modes` vocabulary + `modes` field; `Tool` placeholder dead), VX-4 (attack-profile schema) |

---

## 1. Resolution model — event-driven continuous time (RETAINED from v0.1)

### 1.1 Core loop
Combat is **not ticked**. It is a single **priority event queue** keyed on an absolute
`t` in **seconds (float64)**. The simulator pops the earliest event, applies it, and
pushes any follow-ups. This matches `every_secs`, whose live payload is `{s:[lo,hi]}`
(a per-occurrence range; live on `blade`, `dagger`, `herb_pouch`, `beast_jaw`, `oil`).

```
loop:
  ev = queue.popMin()                 # earliest (t, seq) wins
  if ev.t > encounter.deadline: break # timeout / forced end (§6)
  apply(ev)                           # mutates BP HP, status stacks, enemy HP, fires rays
  schedule(ev.followups)              # e.g. next every_secs occurrence
  if allEnemiesDead or partyWiped: break
```

### 1.2 Seeded RNG & determinism
- One run carries **one master seed** (server-issued, on the run record).
- The seed derives **named sub-streams** so unrelated rolls never desync:
  `rng("<encounterIndex>/<actorUid>/<effectKey>")`, a splittable counter PRNG.
- **Every `[lo,hi]` range** (`every_secs.s`; every ranged verb `n` in
  `vocab.ranged_verb_params`; skill timings/damage) draws `lo + r*(hi-lo)`, `r∈[0,1)`
  from the owning effect's sub-stream. **Entry-cell jitter (§4.3) draws from a dedicated
  `.../ray` sub-stream** so ray geometry never desyncs damage rolls.
- **[LOCKED OQ1] float64 + server-only authoritative sim.** No cross-platform bit-identical
  replay requirement, so we do NOT pay for fixed-point. Rationale: the spectate log is
  produced by the one authoritative server and *replayed* by clients, never *re-simulated*
  on them — float64 determinism on a single implementation suffices.
- **Tie-break (critical):** events at equal `t` order by stable `(t, seq)`, `seq` a
  monotone integer assigned at schedule time. Same seed ⇒ same `seq` order ⇒ identical run.

### 1.3 Determinism guarantee
Given `(snapshot of all 4 Squads' canvases + chosen formation, encounter/enemy defs +
their skill defs, master seed)` the run is a pure function → `(outcome, event log)`.
Snapshots come from the **COPY** of each squad (golden j). Re-running reproduces the log —
the spectate/replay contract.

### 1.4 Simulated vs pre-computed (simulation boundary)
**Pre-computed once at battle_start, then frozen (a "compile" pass over placement):**
- Static topology from the engine: `assembly(st)`, `sockets(st)`, `allConnections(st)` /
  `connectionsFrom(st,p)`, `combos(st)`, `adjacent(...)`, `traceBeams(st)`. Placement never
  changes mid-run, so adjacency/connection/assembled/socket facts are constant and folded
  **once** into a flat effect list (§4.1). This is the seam: combat consumes the engine's
  output; it does not re-run placement per event.
- **Formation placement.** The 4 chosen squad canvases are mapped onto the **shared field**
  (§2, §5) once; every BP acquires an absolute field cell (a `Set` of `(row,col)` in A1:Z18).
- Per-Squad derived stats (final `strike` band after `buff_host`, `buff_self_per_tag`,
  `buff_adjacent`, Whetstone/Ruby SIs) folded where the trigger is `passive`/`battle_start`.
- **[LOCKED OQ2] Dynamic buffs = minimal.** Fold `buff_*` at compile time; the only
  buffs allowed to recompute mid-encounter are those whose value literally cannot be known
  at compile (none exist in live data today). Rationale: keeps the sim a near-static fold,
  matches all current live defs, avoids a recompute engine.

**Simulated live (event by event):**
- Timed occurrences (`every_secs`) → skill firings → **ray resolution** (§3);
  reactive triggers (`on_hit`, `host_on_hit`, `on_bp_damaged`); status ticking
  (Burn/Poison/Regen/Chill); BP HP; block pools; enemy HP; enemy skill schedule;
  encounter progress/timeout.

### 1.5 Replay event log format
Append-only JSON-lines; the spectate/monitor view (golden k) replays it without
re-simulating. Ray events (§3.6) are first-class so the spectate view can animate the
diagonal, bounces, hits and splash.
```jsonc
{"t":0.00,"seq":0,"ev":"encounter_start","enc":3,"kind":"pack","seed":"…","formation":"formation2"}
{"t":0.00,"seq":1,"ev":"telegraph","src":"e0","skill":"spear_thrust","edge":"top","dir":"↘","fires_at":1.6}
{"t":1.61,"seq":9,"ev":"ray_fire","src":"e0/spear_thrust","field":"player","entry":"M1","dir":"↘","pen":1,"aoe":1}
{"t":1.61,"seq":10,"ev":"ray_step","path":["M1","N2","O3"]}
{"t":1.61,"seq":11,"ev":"ray_bounce","at":"Z4","new_dir":"↙","bounce":1}
{"t":1.61,"seq":12,"ev":"ray_hit","dst":"u2/bpA","amount":31,"bounce_mult":1.0,"hp_after":74}
{"t":1.61,"seq":13,"ev":"ray_aoe","center":"P6","radius":1,"hits":[{"dst":"u2/bpB","amount":8}]}
{"t":9.30,"seq":88,"ev":"encounter_end","enc":3,"result":"clear","party_bp_hp":[…]}
```

---

## 2. The formation field (RATIFIED — replaces v0.1 §2.2 cover entirely)

### 2.1 Two coexisting planes
There are **two** independent `A1:Z18` planes (26 cols A–Z × 18 rows), per ruling 2:
- **player field** — the 4 player squad canvases (8×8 each) placed per the chosen
  **formation** (§5). Cells are occupied by **BPs** (each BP occupies its footprint cells;
  1 BP per cell max).
- **enemy field** — the same `A1:Z18` geometry, but cells are occupied **DIRECTLY by
  enemy entities** (ruling 2/3: enemies have no BP/canvas). An enemy's `footprint` (default
  1×1; bosses larger, §4.4) marks the cells it occupies.

A skill fired by **side X resolves on the OPPOSING plane**: player POs' rays land on the
enemy field; enemy skills' rays land on the player field. **Same damage rule both
directions** (ruling 2); "occupied cell" means "a live BP cell" on the player field and
"a live enemy cell" on the enemy field.

### 2.2 Ray geometry (verbatim from ratified proposal)
- **Movement:** 45° diagonal, one cell per step, from an edge **entry cell**.
- **Entry cells & directions:** every outer-edge cell (row1, row18, col A, col Z) can
  spawn a ray with a fixed diagonal direction per the `where_attack_come_from` sheet:
  top edge → `↙`/`↘`; left edge → `↘`; right edge → `↙`; bottom edge → `↗`/`↖`.
- **On hitting an occupied cell:** by default **stop and deal damage** to that occupant.
  With **penetration N**, pass through N occupied occupants (damaging each) before the
  final stop. **[LOCKED OQ5]** penetration = the number of occupied-cell pass-throughs;
  it is exhausted by pass-throughs only. The ray **stops at the first occupant it cannot
  penetrate** (i.e. once N pass-throughs are spent, the next occupant is the terminal hit).
- **On hitting the outer boundary with no occupant found:** **reflect** diagonally
  (bounce) and continue. **[LOCKED OQ5]** boundary reflection is **independent of
  penetration** and **always applies** (reflection never consumes penetration).
- **Per-PO bounce budget (`detection`-mode rays).** In `detection` mode there is **no**
  global 5-bounce all-field terminator; instead each detection-mode ray reflects **at most
  the count specified by THAT PO's effect** (`attack_profile.bounce_budget`, §4.2). When the
  budget is exhausted with no discovery, the ray terminates harmlessly. A discovery (a hit on
  the "?" entity) ends the ray immediately — that hit is the *find*, and damage is irrelevant.
- **Destroyed occupants are passable** (treated as empty; do not stop or count against
  penetration). Gaps between canvases are **NOT walls** — rays pass through freely
  (ruling 1). The boundary (outer edge) is the **only** reflecting surface.
- **Bounce damage scaling (`battle`-mode only)** (per bounce count on this ray):
  bounce 1–2 → +0%; bounce 3 → +50%; bounce 4 → +100%;
  **bounce 5 → +150% AND, instead of continuing, immediately hit ALL occupants on the
  target field at +150%, then terminate the ray.** **This scaling and the global 5-bounce
  all-field terminator apply in `battle` mode ONLY.** In **`detection`** mode a hit is a
  *find, not damage*, so bounce scaling is irrelevant and the global 5-bounce terminator is
  **replaced by a per-PO bounce budget** (next bullet). In **`unlock`** mode rays behave as
  `battle` for the purpose of dealing HP damage to the centered entity.
- **AOE splash on landing:** if the skill carries `aoe:R`, on the primary hit's landing
  cell it also splashes to every occupant within radius `R`. **[LOCKED OQ6]** AOE radius
  is measured in **shared-field cells** (Chebyshev distance on the A1:Z18 plane), not
  canvas-local cells.

### 2.3 Termination
A ray terminates on any of: (a) its terminal (non-penetrable) hit; (b) **[`battle`/`unlock`
only]** the 5th-bounce all-field strike; (c) **[`detection` only]** exhausting this PO's
per-PO bounce budget (§2.2) or scoring a discovery hit; (d) leaving no further legal step
(should not occur given boundary reflection, but the loop caps total steps at a **[TUNABLE
step budget = 512]** as a determinism/DoS guard, logging `ray_abort`).

---

## 3. Ray resolution algorithm (the combat core)

### 3.1 Per-fire inputs
A skill fire carries: `field` (opposing plane), `entry` cell (§4.3), `dir` (from the
entry cell's edge rule), `pen` (penetration, ≥0), `aoe` (radius, ≥0), and the AST verbs
to apply on hit (`strike`/`multi_strike` damage, `apply_status`, etc.).

### 3.2 Walk
```
walk(field, cell, dir, pen):
  bounces = 0; passed = 0
  loop (bounded by step budget):
    cell = step(cell, dir)                      # one diagonal cell
    if outside(cell):                            # boundary
      dir = reflect(dir, which_edge)             # ↘↔↗ / ↙↔↖ mirror on that axis
      bounces += 1
      if mode == "detection":                    # per-PO budget REPLACES the global term.
        if bounces > this_po.bounce_budget: return  # no discovery → harmless end
        continue                                 # (no scaling; a hit is a find, not damage)
      if bounces == 5:                           # battle/unlock only:
        strike ALL live occupants at mult(5)     # +150%, then:
        return  (aoe still splashes per §3.4 at last in-field cell)
      continue                                   # reflection does NOT consume pen
    occ = liveOccupant(field, cell)
    if occ == null: continue                     # empty / destroyed = passable
    dealHit(occ, mult(bounces))                  # primary hit at current bounce mult
    if passed < pen: passed += 1; continue       # penetrate; keep travelling
    landing = cell; break                        # terminal hit
  if aoe > 0: splash(field, landing, aoe, mult(bounces))
```
`mult(b)` = `1.0 (b≤2) / 1.5 (b=3) / 2.0 (b=4) / 2.5 (b=5)`.

### 3.3 dealHit
Applies the skill's AST verbs to the occupant: `strike`/`multi_strike` → damage
(`multi_strike`'s `k` sub-hits each a **separate `on_hit` event**, **[LOCKED OQ19]**,
enabling per-hit status stacking); `apply_status`/`add_on_hit_status` → push stacks (§7).
Damage is scaled by `mult(bounces)` before block/HP application (block pool absorbs first,
§7). On the player field the occupant is a BP (Backpack-as-HP); on the enemy field it is
an enemy entity (HP only).

### 3.4 splash
Every live occupant within Chebyshev radius `aoe` of `landing` takes the skill's damage
verb (not statuses unless the skill's profile says `aoe_statuses:true`) at `mult(bounces)`.
The landing occupant is NOT double-hit (primary hit already applied).

### 3.5 Symmetry
The identical `walk` runs for player→enemy (on the enemy field) and enemy→player (on the
player field). The only difference is which plane's occupancy map is consulted (ruling 2).

### 3.6 Monitor / replay events (for the spectate view, golden k)
Each fire emits, in order: `ray_fire` (entry, dir, pen, aoe), one `ray_step` per straight
segment (batched cell list), a `ray_bounce` per reflection (with `new_dir`, `bounce`),
`ray_hit` per occupant struck (with `bounce_mult`), `ray_aoe` on splash, and any
`apply_status`. This lets the client animate the diagonal, the bounces, and the splash
without re-simulating (§1.5).

---

## 4. Skills & the attack-profile (unifies player POs and monster skills)

### 4.1 One pipeline, two owners (ruling 3)
A **skill** is an effect (or effect bundle) authored in the **same content pipeline,
effect-AST, and closed vocab** as player POs (`content/vocab.json` v4 triggers/verbs/
statuses). The difference is only *ownership*:
- a **player PO** carries its skill via its `effects[]` and fires through placement
  triggers (`every_secs`, `on_hit`, `battle_start`, …) after the compile fold (§1.4);
- a **monster POSSESSES its skills directly** — a list of skill ids on the enemy def, with
  **no backpack/placement/socket relationship** (ruling 3). A monster has **HP only**;
  everything else is a skill.

Both go through S1–S8 (content_pipeline.md) unchanged.

### 4.2 Attack-profile schema (added to offensive effects) — **[VX-4]**
Any effect that emits a ray gains an **attack-profile** block. This is a *schema
extension on the effect object*, not new vocab (it introduces no verbs/statuses):
```jsonc
"attack_profile": {
  "edge": ["top"],          // one or more of: top | left | right | bottom
  "direction": "front",     // semantic label; see §4.3 (front=top, side=left|right, …)
  "penetration": 1,         // N occupied pass-throughs (≥0)
  "aoe": 0,                 // splash radius in shared-field cells (≥0)
  "aoe_statuses": false,    // do splash targets also receive the effect's statuses?
  "bounce_budget": 3        // detection-mode ONLY: max reflections (replaces the global
                            //   5-bounce terminator; ignored in battle/unlock, §2.2/§6.1)
}
// The owning PO/skill carries a separate closed-vocab `modes` list (§9-schema, default
//   ["battle"]) that gates whether the effect fires at all in a given encounter (§6.1).
// damage/statuses themselves stay in the existing AST verbs:
//   {"verb":{"t":"strike","n":[22,38]}}, {"verb":{"t":"apply_status","status":"Burn","n":[4,6]}}
```
**Skill direction typing** (ruling 7, generalized from the user's examples):
- **bow-type** → `edge:["left","right"]`, `direction:"side"`, typically `penetration:0`.
- **spear-type** → `edge:["top"]`, `direction:"front"`, `penetration:1`.
- others compose freely (e.g. a mortar: `edge:["top"]`, `aoe:2`).
The profile is **shared verbatim** by player POs and monster skills.

### 4.3 Entry-cell selection (ruling 4 — deterministic + bounded seeded jitter)
The entry cell is derived from **the attacker's field position projected onto the skill's
designated edge**, then jittered within a bounded segment via a seeded sub-stream. Concrete
rule (specified exactly so it is reproducible):

1. **Attacker anchor.** Take the attacker's occupied-cell **centroid** on ITS OWN field:
   `(rowc, colc)` = mean of its occupied cells (BP footprint for a PO; enemy footprint for
   a monster), rounded half-up.
2. **Pick the edge.** If `attack_profile.edge` lists more than one edge, pick one
   deterministically by `idx = floor(u0 * edges.length)` where `u0` is the first draw from
   the `.../ray` sub-stream; `u0∈[0,1)`.
3. **Project onto the edge to get a base coordinate** on the OPPOSING field:
   - top/bottom edge → base = `colc` (column A..Z); left/right edge → base = `rowc` (row 1..18).
4. **Base segment.** Center a segment of half-width `J` **[TUNABLE J=2 cells]** on the base
   coordinate, clamped to the edge's valid range.
5. **Jitter within it (seeded).** `offset = round((u1*2 - 1) * J)`, `u1` the next `.../ray`
   draw; `entryCoord = clamp(base + offset, edge_min, edge_max)`.
6. **Entry cell = (edge, entryCoord)** with the edge's fixed diagonal `dir` (§2.2).

Rationale: an attacker on the left of its field tends to fire rays entering near the left
of the opposing field (position matters — formations matter), but the seeded `±J` jitter
keeps encounters from being perfectly static while staying fully reproducible. All ray
randomness is confined to the `.../ray` sub-stream, isolated from damage/timing streams.

### 4.4 Enemy def schema v2 (shrunk by ruling 3) — **[VX-2]** (schema only, no new vocab)
```jsonc
{
  "id": "gnoll_skirmisher",
  "name": "Gnoll Skirmisher",
  "hp": [40, 60],                 // rolled per spawn from range; the ONLY stat
  "footprint": [1, 1],            // cells occupied on the enemy field (default 1×1)
  "skills": ["bite", "howl"],     // skill ids; each is a PO-pipeline effect it POSSESSES
  "i18n": { "en": { "name": "Gnoll Skirmisher" } },
  "rarity": "common",             // pack-role weighting (§4.6)
  "pack_role": "line"             // anchor | line | support (§4.6)
}
```
Gone vs v0.1: `block`, `actions[]`, `reach`, per-action `telegraph`, `resist`,
`rarityBudget` folded — enemies are HP + skills. Bosses use the SAME schema with a larger
`footprint` and hand-authored skills incl. signature ones (**[LOCKED OQ18]**: bosses are
hand-authored enemy defs, not a rarity roll — rationale: signature boss skills need
authoring control; the schema already supports it).

### 4.5 Telegraph (derived, no field)
There is **no telegraph field** in v0.2. The telegraph shown in the monitor is **derived
from the next scheduled skill**: display its **name + entry edge + direction** at a fixed
lead `L` **[TUNABLE L=0.6s]** before it fires. The `ray_fire` preview and the `telegraph`
log line (§1.5) carry `skill`, `edge`, `dir`. `aoe`/`penetration` may also be surfaced as
danger hints.

### 4.6 Pack grammar (RETAINED from v0.1, re-expressed as formation placement)
A **pack** is `1..n` enemies (golden h). Composition still uses PoE roles + rarity, but is
now expressed as a **formation-placement template on the enemy field**:
- **Roles** (deterministic slots, seeded): `anchor` (1, tanky/backline), `line` (0..m
  attackers), `support` (0..1, buffs pack). Roles map to **enemy-field placement
  templates** (anchors back, line front) analogous to player formations (§5).
- **Pack rarity** (common/magic/rare, **[TUNABLE weights common .7 / magic .25 / rare
  .05]**) applies pack-wide affixes drawn from a small table — flat multipliers on `hp`,
  on skill `every_secs.s`, or "add a skill id" — all citing existing vocab. Magic = 1
  affix; Rare = 2–3 + a name.
- **Pack budget:** `Σ (per-enemy hp-weight × rarityMult)` bounded per encounter difficulty
  so packs scale with sortie level, not hand-authoring **[TUNABLE]**.

### 4.7 Targeting AI (deterministic, dumb, watchable)
Enemies do not choose a *target*; they choose a **skill to fire** (its scheduled
`every_secs` occurrence) and the ray geometry (§3–4.3) decides what it hits. No pathing,
no aggro table. Support skills (`target:"pack"`-style buffs) resolve on the enemy's OWN
field/side. **[LOCKED OQ10]** statuses are symmetric: enemy skills inflict DoTs on BPs;
BPs suffer them (§7).

---

## 5. Formations as content (the 4 from formation.xlsx)

### 5.1 Formation defs
A **formation** is a content def naming the 4 player squad canvases as 8×8 boxes on the
shared field, plus their squad-slot labels. **[VX-2]**-adjacent (schema, no vocab).
```jsonc
{ "id":"formation2", "i18n":{...},
  "canvases": { "unit1":"J2:Q9", "unit2":"B6:I13", "unit3":"R6:Y13", "unit4":"J10:Q17" } }
```
The four ratified defs (boxes/labels from formation.xlsx):

| id | unit1 | unit2 | unit3 | unit4 | note |
|---|---|---|---|---|---|
| formation1 | F2:M9 | N2:U9 | B10:I17 | R10:Y17 | standard; 2 front cover 2 back (top-entry only) |
| formation2 | J2:Q9 | B6:I13 | R6:Y13 | J10:Q17 | unit1 tank up top; unit4 well protected |
| formation3 | B2:I9 | R2:Y9 | F10:M17 | N10:U17 | corner squads tank top diagonals |
| formation4 | E5 (left wing) | M5 (center-top) | U5 (right wing) | M14 (backline) | **corrected** — see §5.2 |

> `E5` / `M5` / `U5` / `M14` in the formation4 row above are historical ANCHOR MARKER cells
> from the deleted `formation.xlsx` (provenance, not geometry). Do NOT "fix" them to track a
> box move; the authoritative boxes are in S5.2.

### 5.2 formation4 corrections (ratified fixes to the sheet errors)
The xlsx had (a) a backline box `J11:Q19` overrunning row 18, and (b) no squad labels.
**Ratified v0.3 (2026-07-21):** backline_center box **corrected to `J10:Q17`**. The v0.2
correction to `J11:Q18` was itself INCOMPLETE: it cured the row-19 field overrun but predates
the 2026-07-15 24x16 / B2:Y17 margin ruling, and `J11:Q18` still sits ON the row-18 margin.
`J10:Q17` seats backline_center directly below center_top and wholly inside B2:Y17. Squad
labels taken from the xlsx marker cells: **unit1 = left wing (E5)**, **unit2 = center-top
(M5)**, **unit3 = right wing (U5)**, **unit4 = backline (M14)**. (The `E5/M5/U5/M14` cells
are the box anchor labels; each box is the 8×8 region positioned from that anchor per the
sheet.) formation4's four boxes: left_wing `B2:I9`, center_top `J2:Q9`, right_wing
`R2:Y9`, backline_center `J10:Q17`.

> **Data has NOT moved yet.** `content/live/dungeon/formations.json` and
> `sim/lib/formation.cjs` still carry `J11:Q18` as of 2026-07-21. REQ-0258 owns that change.
> Until it lands the data and this spec disagree, and THIS SPEC is the ratified value.

> Note (retained from proposal, informational): formation1's side-entry rays at rows 10–17
> hit the backline squads first (inter-canvas gaps don't bounce). This is **intended
> counterplay**, not a bug — it is why formation choice is a real decision.

### 5.3 Formation selection & slot assignment (v1 defaults)
- **[LOCKED]** The **room creator picks the troop formation** from the content list at
  room creation (one of the 4 above). Rationale: the formation is a shared, troop-level
  battlefield decision; centralizing it on the creator matches the room-creation flow
  (REQ-0036 golden c) and keeps the field deterministic for all 4 joiners.
- **[LOCKED]** **Squad slot assignment = join order** (1st joiner → unit1, …), **swappable
  pre-start** (before the run begins). Rationale: simplest deterministic default; a
  pre-start swap UI is cheap and lets a troop optimize front/back. Both defaults are
  **vetoable** by the user.

---

## 6. Encounter types (all resolved as combat) — RETAINED, mode-gating ratified

> **AMENDED by REQ-0049 (2026-07-09) — Layered Encounters.** Detection/unlock
> objectives (trap/chest/door) are no longer *sequential standalone encounters*; they
> are **attachments on a battle encounter** (`encounterDef.attachments[]`, cap ≤2),
> resolved in PARALLEL on the same field and the same battle clock. Battle POs fight
> the pack while detection POs hunt the "?" and unlock POs chip the chest — same ray
> grammar, **mode-pure transparency** (a ray interacts ONLY with occupants of its own
> mode; battle rays pass through ?/chest/door, detection/unlock rays pass through live
> enemies). The encounter ends on pack clear, THEN end-of-encounter attachment
> settlement (an undiscovered-unexpired trap fires its end volley; an unresolved
> chest/door is lost). The per-type clock outcomes in the table below are RETAINED but
> now run on the battle clock, and anti-rush tension is deliberate (melting the pack
> too fast can cost the chest/door). Pure detection/unlock rooms REMAIN legal as rare
> puzzle rooms ([TUNABLE p≈0.1/run]); §6.2's pause-not-accumulate rule now applies only
> there. New replay events: `att_reveal` / `att_disarm` / `att_open` / `att_lost` /
> `att_fire`. Sim: `sim/lib/encounter.cjs` (multi-objective loop) + `sim/dungen.cjs`
> (attachment rolls). See REQ-0049 for the full design.

Golden q: doors/chests/traps are **monster-typed entities**; only **mode-matching POs
act**. Each encounter declares a **mode** = one entry from the ratified closed **mode-tag**
vocabulary `{ battle, detection, unlock }` (§6.1). During an encounter, a PO or skill
**participates** iff its `modes` list includes the encounter's mode; **all other POs idle**
(their `every_secs` schedules **pause, they do not accumulate** — see §6.2). Non-matching
offense is **inert** for that encounter (a battle weapon cannot "pick the lock").

**[LOCKED OQ12]** discovery/unlock is **strictly mode-gated** — combat (`battle`) weapons do
NOT contribute to trap/door detection or chest unlocking (no bruteforce). Rationale: makes
utility builds meaningful; golden q's role-shaping only bites if `battle` POs can't
substitute. `timeout` is an **encounter/entity-def field** (`timeout_secs`), **not** vocab
growth — one per encounter/entity, not a new tag or verb.

| encounter | mode | is a "monster" (HP + skills) with… | win condition | timeout / forced end |
|---|---|---|---|---|
| **standard pack** | **battle** | §4 enemies on the enemy field | all enemies' HP → 0 | not cleared by `T_pack` → escalating pressure / possible wipe (no forced win). |
| **trap** | **detection** | 1 hidden **"?" entity** occupying a **few** enemy-field cells (harder to find ⇒ **smaller** footprint) | **DISCOVERY = win** (golden n): a hit from a **detection**-mode PO's ray finds the entity before `timeout_secs`. | `t>timeout_secs` → **trap fires its skill payload once** (a `battle`-style volley on the player field, rolled), then the encounter ends (golden n「発動」). No disarm step. |
| **hidden door** | **detection → unlock** (chain, golden o) | two-stage entity: a `detection` "?" entity, then, once found, an `unlock` door entity | **stage 1** discover (detection hit) **then stage 2** reduce the door's HP to 0 before its `unlock` `timeout_secs` → **shortcut** (big progress jump, §8). | stage 2 `t>timeout_secs` → "keyhole breaks" (golden q, = the unlock timeout): forced end, no shortcut, run continues. |
| **chest** | **unlock** | "chest" entity at the **enemy-field center** (footprint from its def) | **unlock**-mode POs reduce its HP to 0 before its `timeout_secs` → **reward roll** (§8). | timeout → chest lost, no penalty. |
| **boss** | **battle** | one large §4 enemy (rare-tier block, hand-authored signature skills, larger footprint) at 100% | HP → 0 → **run victory** (golden p). | no timeout; clear or wipe. |

**Existing POs default to `modes: ["battle"]`** — pack/boss combat is unaffected by the new
axis. "Discovery/unlock damage" reuses the combat loop verbatim (golden q "resolved AS
COMBAT"), with the mode-specific ray semantics of §6.1.

### 6.1 Mode tags — **RATIFIED closed vocabulary (RESOLVES VX-3)** — **[USER]**
Mode-gating is driven by a **third, separate vocabulary axis** — **mode tags** — ratified
by the user (2026-07-05). It is **NOT** a `po_tags` entry: it is its own closed vocabulary,
exactly the "separate vocabulary, same pattern" relationship that PO Tags already have with
Socket Types. The closed list is:

**`modes = { battle, detection, unlock }`** — attached to **POs and skills** (a `modes`
field, §4.2/§9-schema). **Existing POs default to `["battle"]`.**

- **`battle`** — the **default** mode for normal **pack / boss** encounters. Ray geometry is
  the full §2–3 system (bounce damage scaling AND the global 5-bounce all-field terminator
  apply here — see §2.2/§3.2).
- **`detection`** — the encounter opens as *"something might be here."* The hidden entity is
  a **"?" enemy** occupying a **few** cells; **the harder it is to find, the SMALLER its
  footprint**. Only **detection**-mode POs fire; their rays fly, and **a hit = DISCOVERY**
  (= victory for traps, golden n). **Reflections are limited to the count specified by THAT
  PO's effect** — a **per-PO bounce budget REPLACES the global 5-bounce terminator in this
  mode** (§2.2). **Bounce damage scaling is irrelevant here**: a hit is a *find*, not damage.
- **`unlock`** — the **door / chest** entity sits at the **CENTER of the enemy field**
  (footprint from its def). **Only `unlock`-mode POs can act.** Hits **deal damage**; reduce
  the entity's HP to **0 BEFORE its "timeout" fires** = victory. (Golden q's "keyhole broke"
  **is** that timeout, i.e. the entity's `unlock` `timeout_secs`.)

The `Tool` `po_tags` placeholder proposed in v0.2 is **DEAD** — mode tags supersede it, and
**VX-3 is RESOLVED** (§11). No new `po_tags` entry is added.

### 6.2 Mode filtering & entity placement (orchestrator defaults, vetoable)
- **Mode filtering.** During an encounter, **only POs whose `modes` include the encounter's
  mode fire**; all other POs **idle**. Their `every_secs` schedules **pause** for the
  encounter's duration — they **do not accumulate** a backlog to dump when a matching
  encounter next opens. *Rationale: an idle utility PO shouldn't silently bank charges.*
- **`timeout` is a field, not vocab.** Each encounter/entity def carries `timeout_secs`; it
  is a numeric field, never a new tag/verb. *Rationale: no closed-vocab growth for a scalar.*
- **Hidden door = two-stage chain** (golden o): a `detection` stage that reveals the door,
  then an `unlock` stage against the revealed door entity (§6 table). *Rationale: matches the
  golden-o "find then open" grammar with the two existing modes, no third door mode.*
- **Trap that times out UNDISCOVERED fires its skill payload once** — a `battle`-style volley
  on the player field — **then the encounter ends** (golden n「発動」). *Rationale: the trap
  "goes off" as a single punishing event, not an ongoing fight.*
- **"?" entity position is masked** in the replay/spectate log **until discovered**
  (spectator-safe events, §1.5). *Rationale: a spectator must not see the answer before the
  troop does.*
- **Unlock entity placement:** the door/chest sits at the **enemy-field center**, footprint
  taken from its def. *Rationale: a fixed, fair, deterministic target for unlock rays.*

---

## 7. Status system (RETAINED — exact `vocab.statuses` semantics)

Statuses: `Burn, Poison, Chill, Regen, Spikes, Stun, Weakness, Haste`. Magnitudes are
`[lo,hi]` at authoring, resolved to a scalar at application. Model: **stacks + optional
expiry**, one damage cadence constant, one tiny interaction matrix. **Block pool** absorbs
incoming ray damage before HP and decays per this table.

| status | on whom | stacking | duration / decay | per-second effect |
|---|---|---|---|---|
| **Burn** | enemy or BP | stacks add (`n`/appl.) | −1 stack per period `P` **[TUNABLE P=1.0s]** | `1×stacks` dmg each `P`; **amp_status** (Ignite/Oil) multiplies the applied `n`, not the tick. |
| **Poison** | enemy or BP | stacks add | same `P`, −1/tick | `1×stacks` each `P`. Distinct from Burn so amp/cleanse/immunities can target one. |
| **Chill** | enemy or BP | stacks add, cap `C` **[TUNABLE C=10]** | −1/`P` | slows target's action cadence by `stacks×s%` **[TUNABLE 4%/stack]**. |
| **Regen** | BP (ally) | stacks add | −1/`P` | heals owning BP `1×stacks` each `P`. |
| **Spikes** | BP (ally) | stacks add, no time decay | **[LOCKED OQ9] consumed per hit** | when the BP is hit, attacker takes `1×stacks`; **1 stack consumed per hit**. Rationale: bounds reflect DPS, matches BB Spikes cap-vs-hit. |
| **Stun** | enemy (mostly) | no magnitude stack; refresh duration | duration `= n` s | scheduled actions **suspended** while active (timer pauses, resumes on expiry). |
| **Weakness** | enemy or BP | stacks add | duration `= n` s (refresh) | target deals **−X% dmg** per stack **[TUNABLE 5%/stack]**. |
| **Haste** | ally (self) | stacks add | duration `= n` s | speeds owner's `every_secs` cadence by `stacks×s%` **[TUNABLE 4%/stack]** (dual of Chill; also the `haste` verb's target). |

**Interaction matrix (kept tiny):**
1. **Chill ↔ Haste** = one cadence axis, opposite sign → they **net** (one number).
2. **Burn ↔ amp_status** — `amp_status`/Ignite multiplies the named status `n` at
   application; no other status is amplifiable unless an `amp_status` names it.
3. **cleanse** removes all **debuff** statuses (Burn/Poison/Chill/Weakness/Stun); buffs
   (Regen/Spikes/Haste) untouched.
4. **Stun** pauses action timers only; DoTs keep ticking through Stun.
5. Everything else independent. This is the whole matrix.

**[LOCKED OQ10]** statuses are **symmetric**: enemy skills inflict offense-DoTs
(Burn/Poison/Chill/Weakness/Stun) on player BPs, and BPs suffer them; ally-only statuses
are Regen/Spikes/Haste. **[LOCKED OQ7]** the only legal `buff_host`/buff `stat` in v1 is
`"damage"` (the sole value in live data); other stats deferred until a def needs them.

---

## 8. Run integration (RETAINED)

### 8.1 Progress
A run is `0 → 100%` (golden m), advanced by **completing encounters**, not by time. Each
cleared encounter grants `Δ%` from its def **[TUNABLE]**; the schedule sums a clean run to 100%.

### 8.2 Encounter scheduling
Loop-Hero-style ordered sequence generated at run start from dungeon+level+master seed: a
list with `at%` positions. Standard packs are the backbone; traps/doors/chests seeded in;
boss pinned at 100%. **[LOCKED OQ13]** attrition is **permanent within a run — no
auto-heal between encounters** (only in-combat Regen/heal_bp heal). Rationale: golden l
makes end-of-run BP HP drive the cooldown, so BP HP must persist across encounters.

### 8.3 Shortcut jumps
A solved **hidden door** applies `+J%` **[TUNABLE J=15–25%]**, skipping encounters between
current% and the target%. Skipped encounters yield **no reward** (speed-vs-loot trade).

### 8.4 Reward accrual + distribution
- Mid-run rewards (chests, special packs) and boss reward accrue to the run.
- **[LOCKED OQ14]** distribution is **uniform random per item** (golden p): on success,
  each reward item goes to a participating player by uniform seeded draw, independent of
  contribution. Items land in the **WAREHOUSE** (200 cap / 7-day TTL, golden e), never
  direct to inventory. On **wipe, nothing is gained** (golden i) — accrued rewards discarded.

### 8.5 Wipe / level-down / cooldowns (formulas)
All constants **[TUNABLE]**; `failure_step` default 1 (golden i).
- **Wipe** (all BPs of all 4 Squads downed): `L ← max(L_min, L − failure_step)`; nothing
  lost/gained; a **wipe cooldown** applies before re-sortie.
- **Post-run cooldown (success)** scales with **finishing BP HP** (golden l). Let
  `H = Σ bp.hp / Σ bp.hpMax` (troop HP fraction at finish, 0..1):
  ```
  CD_run = CD_min + (CD_max − CD_min) × (1 − H)     [TUNABLE CD_min, CD_max]
  ```
  **[LOCKED OQ15/16/17]** the cooldown model is **linear in (1−H)**, a **single unified
  H-curve**, and a **wipe = the same curve at H=0** (`CD_wipe = CD_max`); constants are
  S4-tunable. Rationale: one formula, fewer knobs, "healthy finish rewarded / wipe = worst
  case" falls out naturally; S4 can bend it later if data demands.

---

## 9. Locked defaults (all v0.1 open questions resolved)

Each is orchestrator-decided; the user may veto async.

| # | ruling (default) | one-line rationale |
|---|---|---|
| OQ1 | float64 + server-only authoritative sim | no cross-platform replay need; clients replay the log, never re-sim |
| OQ2 | dynamic buffs minimal (compile-fold) | matches all live defs; avoids a recompute engine |
| OQ3 | BP hp = flat `hpMax` field on BP def | **verified: NO existing hp field on BP objects** → VX-1 is genuinely new (see §10) |
| OQ4/5/6 | **SUPERSEDED** by formation-ray | targeting/geometry now fully defined by §2–4 |
| OQ5 (pen) | pen = occupied pass-throughs; reflection independent & always applies; stop at first non-penetrable | matches ratified ruling 5 |
| OQ6 (aoe) | AOE radius in **shared-field cells** (Chebyshev) | matches ratified ruling 6 |
| OQ7 | buff `stat` = `"damage"` only (v1) | only value in live data |
| OQ8 | **Unit combat role DEFERRED** — links have NO combat effect in v0.2 | glossary "items first; Unit applications follow"; no balance baked on undesigned system |
| OQ9 | Spikes consumed per hit | bounds reflect DPS; matches BB pattern |
| OQ10 | statuses symmetric (enemies inflict on BPs; BPs suffer DoTs) | ruling 10; enables enemy DoT skills |
| OQ11 | **RESOLVED (user design)** → mode-gating uses the ratified `modes` closed vocabulary `{battle, detection, unlock}` (§6.1), not a `po_tags` entry | user ratified a third vocabulary axis; former `Tool` placeholder dead |
| MODE-1 | `timeout` = an encounter/entity-def field (`timeout_secs`), not vocab growth | a scalar per entity needs no new tag/verb |
| MODE-2 | hidden door = two-stage `detection → unlock` chain (golden o) | reuses the two existing modes; no third door mode |
| MODE-3 | a trap that times out UNDISCOVERED fires its skill payload once (battle-style volley), then the encounter ends (golden n「発動」) | the trap "goes off" as one punishing event, not a fight |
| MODE-4 | the "?" entity's position is masked in the replay/spectate log until discovered | spectators must not see the answer before the troop |
| MODE-5 | unlock entity placement = enemy-field center, footprint from its def | fixed, fair, deterministic unlock target |
| MODE-6 | mode filtering: only POs whose `modes` include the encounter mode fire; the rest idle, their `every_secs` **pauses (does not accumulate)** | an idle utility PO shouldn't silently bank charges |
| MODE-7 | schema: PO defs + skill defs get a `modes: ["battle"]`-style field (default `battle`); `vocab.json` gains a `modes` closed list | closes VX-3; new closed vocabulary + field |
| OQ12 | discovery strictly mode-gated (weapons don't pick locks) | makes utility builds meaningful |
| OQ13 | permanent attrition; no auto-heal between encounters | golden l: end-of-run BP HP drives cooldown |
| OQ14 | uniform random per item | golden p ("fully random") |
| OQ15/16/17 | linear, single unified H-curve, wipe = curve at H=0; constants S4-tunable | one formula, fewer knobs |
| OQ18 | bosses = hand-authored enemy defs (same schema, signature skills) | authoring control for signatures |
| OQ19 | each `multi_strike` sub-hit = separate `on_hit` event | enables per-hit status stacking |

---

## 10. Tuning & testing surface (S4 simulate gate) — RETAINED, ray-aware

Per content_pipeline §3, `tools/simulate.cjs` (S4) is reserved until this spec exists —
this section defines what it measures. It runs auto-battles of sample canvases (placed per
a formation) vs reference enemy packs using the §1–3 sim and asserts bands.

**S4 measures:**
- **DPS per PO / per canvas** vs `vocab.dps_ceiling_warn` (Common 12 / Uncommon 15 /
  Rare 18 / Relic 24). Over-ceiling ⇒ warn. **Ray-aware:** effective DPS now includes
  bounce-scaling and AOE, so the sim must attribute multi-hit ray damage per fire.
- **EHP per BP / troop** = `hpMax + expected block absorbed + expected Regen`; time-to-down
  under a reference pack, banded per defensive-piece rarity.
- **Run-length distribution** across seeds ×N: run duration + clear-rate at a reference
  level; flag trivially-fast or unwinnable runs.
- **Status saturation**: Burn/Poison/Chill stacks over time; flag runaway `amp_status` loops.
- **Ray sanity (new):** distribution of bounce counts and 5th-bounce all-field triggers;
  flag skills that near-always reach the +150% all-field terminator (a balance smell).

**Key constants (all [TUNABLE]):**

| constant | symbol | default | governs |
|---|---|---|---|
| status tick period | `P` | 1.0 s | Burn/Poison/Chill/Regen cadence |
| Chill/Haste per-stack | — | 4 %/stack | cadence slow/speed |
| Chill cap | `C` | 10 | max slow |
| Weakness per-stack | — | 5 %/stack | damage reduction |
| entry-cell jitter half-width | `J` | 2 cells | ray entry spread (§4.3) |
| ray step budget | — | 512 | determinism/DoS guard (§2.3) |
| telegraph lead | `L` | 0.6 s | derived-intent warning time |
| pack rarity weights | — | common .7 / magic .25 / rare .05 | pack grammar |
| shortcut jump | `J%` | 15–25 % | hidden-door progress skip |
| failure step | — | 1 | level-down on wipe |
| success cooldown floor/ceil | `CD_min/CD_max` | tbd | unified H-curve; `CD_wipe = CD_max` |
| dps ceilings | — | 12/15/18/24 | from vocab.dps_ceiling_warn (do not diverge) |

---

## 11. Vocabulary / schema extension requests (final state)

> Per content_pipeline §2, growing a **closed vocabulary** is a golden-adjacent design
> event needing user approval. **Schema** extensions (new fields, no new vocab entries)
> are listed for visibility but are not vocab growth.
>
> **Open items: NONE — design complete pending final user pass.** VX-3 is now RESOLVED by
> the user-ratified `modes` vocabulary; VX-1/VX-2/VX-4 are schema-only requests seeking a
> blessing, not open design questions.

- **[VX-1] BP HP field (schema — genuinely NEW).** BPs need an HP magnitude (`hpMax`,
  current `hp`). **Verified against the server:** engine BP objects carry only
  `{id, name, shape, origin, unit}` (`mock-src/engine.js`) and no schema file defines
  `hp` — there is **no existing hp field to confirm**. So OQ3's "confirm existing field"
  resolves to: **there is none; VX-1 is a real schema addition** on the BP/frame def.
  *Approval sought: sanction a BP-def `hpMax`.* (No new vocab entry.)
- **[VX-2] Enemy-def v2 + formation-def schema (schema, no vocab).** Enemy def fields
  `hp, footprint, skills[], i18n, rarity, pack_role`, and formation defs (`canvases` box
  map). Enemy skills reuse `vocab.verbs`/`vocab.statuses` — **no new verbs/statuses**.
  Flagged so S2's closed-vocab check isn't surprised. *Approval sought: bless the shapes.*
- **[VX-3] RESOLVED — `modes` closed vocabulary + `modes` field (VOCAB GROWTH, user-ratified).**
  The v0.2 `Tool` `po_tags` placeholder is **DEAD**. The user ratified (2026-07-05) a **third,
  separate closed vocabula