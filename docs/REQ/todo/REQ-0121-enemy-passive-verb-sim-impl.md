> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0121 — Sim implementation for `buff_self` / `damage_reduction` / `on_hp_below`

> Status: **todo — ratified, cleared to implement, queued.**
> Filed 2026-07-09, split out of REQ-0077's S7 review (batch-004 "The Warren
> Ascendant") by explicit user instruction: these three vocab additions ship
> as authored content once REQ-0077 lands, but have **zero sim engine
> implementation** — they will render correctly in tooltips/previews but do
> **nothing** in actual combat until this REQ is done. Companion REQ: 0122
> (dynamic enemy content loading — separate concern, do not conflate).

## Background

REQ-0077 Rev.2 (2026-07-07) added 4 verbs + 1 trigger to `content/vocab.json`
to give batch-004's monsters passive/reactive skills: `buff_self`,
`status_immune`, `bonus_vs_status`, `damage_reduction`, and the
`on_hp_below` trigger. REQ-0093 (2026-07-09) already implemented
`status_immune`/`bonus_vs_status` in full (`sim/lib/status.cjs`,
`sim/lib/compile.cjs`, `sim/lib/packs.cjs`, `sim/lib/encounter.cjs`,
`sim/lib/skills.cjs`) — those two are done, tested, merged to master.

**Still zero implementation** (confirmed by grep across `sim/`: no case for
either verb string anywhere in `sim/lib/skills.cjs`'s dispatch, no runtime
handling of `on_hp_below` anywhere in `sim/lib/encounter.cjs`):
- `buff_self` — used by `orc_bloodlust` (`on_hp_below(0.5)` → `+4..6` self
  damage) and `behemoth_last_stand` (`on_hp_below(0.3)` → `+15..20` self
  damage).
- `damage_reduction` — used by `ogre_thick_hide` (`battle_start` →
  `-3..5` flat incoming damage).
- `on_hp_below` trigger itself — the fire condition both `buff_self` uses
  depend on.

Per REQ-0077's own design note: these 4 verbs are "passive stat-fold
modifiers, not ray-emitting effects" — none carry an `attack_profile`.

## Scope

1. **`content/vocab.json`**: bump version; widen `trigger_domains.on_hp_below`
   to `["PO", "EnemySkill"]` — **not** `["EnemySkill"]` only as REQ-0077
   originally proposed. User's explicit instruction (2026-07-09, in-chat):
   "on_hp_belowは、EnemySkill限定ではなく、仕様を考慮して、使ってよさそうな
   のはOKにしてください" (don't restrict to EnemySkill-only; extend it
   wherever the existing spec conventions make it reasonable). Rationale for
   PO specifically: every other trigger with a comparable domain
   (`every_secs`, `battle_start`) is already `["PO", "EnemySkill"]` — PO has
   a natural "HP" referent (its owning BP's `hp`/`hpMax`, the same object
   `OnBPBeenHit`/`OnBPHierarchyHit` already key off), so a player item that
   fires "while this BP is below X% HP" is a direct, low-risk mechanical
   parallel to orc/behemoth's enrage, not a stretch. Do **not** extend to
   `SI`/`Unit` — neither has an HP concept of its own to reference; this
   would need a host-resolution rule that doesn't exist yet, out of scope.
2. **`sim/lib/status.cjs`** (or a new small module, matching this project's
   one-module-per-concern pattern) — no obvious existing home for
   `on_hp_below` bookkeeping (it's not a status, it's a fire-once trigger
   condition on the actor itself); likely needs a per-actor
   `_hpBelowFired: Set<thresholdKey>` bookkeeping field, checked each time
   HP changes (every `applyDamage`/tick), analogous to how `status_tick`
   already re-checks periodically — but `on_hp_below` must fire the instant
   the threshold is crossed, not on the next tick boundary, so likely needs
   a check inline in `applyDamage` (both `makeBPActor`/`makeEnemyActor` in
   `sim/lib/skills.cjs`) rather than the periodic tick loop.
3. **`buff_self`**: at `battle_start` (permanent, foldable like `buff_host`)
   or `on_hp_below` (fires once, needs the live per-actor `_hpBelowFired`
   bookkeeping from item 2) — folds a flat `+n` onto the actor's own
   strike/multi_strike verbs, mirroring `applyFlatBonusToEffects` in
   `compile.cjs` but for enemies too (currently that folding logic is
   PO/BP-only; enemies have no equivalent fold pass at all — `packs.cjs`'s
   `compileEnemyPack` never touches `skill.verb.n`). **This REQ is the
   first time ANY enemy-side stat-fold exists** — worth designing
   deliberately, not bolting on ad hoc.
4. **`damage_reduction`**: at `battle_start`, folds a flat `-n` reduction
   into damage the actor TAKES — same chokepoint question as REQ-0093 faced
   with `bonus_vs_status`: fold at compile time (static, like `buff_host`)
   since `battle_start`-only usage is proposed today, no `on_hp_below`
   variant requested yet. Consider whether it should live alongside
   `weaknessMultiplier` in `status.cjs` (same "reduces damage this actor
   takes" shape) or as its own flat-subtraction pass — recommend the
   latter, since `weaknessMultiplier` is specifically status-bag-driven and
   this is a battle_start-folded constant, different lifecycle.
5. **`tools/eff_render.cjs`**: already has NO cases for `buff_self` /
   `damage_reduction` / the `on_hp_below` trigger prefix — REQ-0077's own
   preview tool (`build_dungeon_preview.py`) does its own separate
   rendering, not this shared module; confirm whether batch-004's preview
   depends on `eff_render.cjs` at all before deciding if this needs
   touching too (REQ-0093 found `build_dungeon_preview.py` has NO
   `eff_render.cjs` integration on master — verify current state, this may
   have changed given how fast master is moving).
6. **Tests**: `sim/tests/run.cjs` — squad coverage for `on_hp_below` fire-once
   semantics (fires exactly once per threshold crossing, not per tick;
   re-crossing upward then back down does NOT re-fire — confirm this
   against REQ-0077's "fires once on first crossing" wording, may need a
   clarifying question to the user if ambiguous for e.g. healed-back-above
   cases), `buff_self` both trigger forms, `damage_reduction` flat
   subtraction (including a floor-at-zero check, matching
   `weaknessMultiplier`'s `Math.max(0, ...)` pattern).
7. **`tools/self_test_vocab.cjs`**: extend `buildEffectForVerb` for both
   verbs + the new trigger, matching REQ-0093's pattern.

## Explicitly out of scope

- Re-litigating [LOCKED OQ2] beyond the PO+EnemySkill domain widening above
  — user already ruled on this (2026-07-09). No further scope creep into
  SI/Unit or other dynamic-recompute triggers.
- REQ-0122 (dynamic enemy content loading / the batch-002 hardcode) — fully
  separate concern; this REQ only makes the verbs/trigger DO something once
  fired, not change which batch's content is live.
- Actually wiring batch-004 live (depends on REQ-0122).

## Open questions for whoever picks this up

- `on_hp_below` re-crossing semantics (fires once ever per encounter, or
  once per crossing direction, or once per threshold with re-arm on
  healing back above?) — REQ-0077's wording ("fires once on first
  crossing") suggests "once ever," but confirm before implementing, since
  `orc_bloodlust`/`behemoth_last_stand` are enrage mechanics where
  re-arming behavior matters if healing is ever added to enemies.
- Whether `buff_self`'s enemy-side fold (item 3) should reuse/refactor
  `compile.cjs`'s existing PO fold machinery into a shared helper, or stay
  fully independent in `packs.cjs` — recommend independent for now (enemies
  and POs have different effect-list shapes today), revisit if a third
  fold consumer appears.
