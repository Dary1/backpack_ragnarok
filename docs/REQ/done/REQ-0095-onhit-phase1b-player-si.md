# REQ-0095 — OnHit taxonomy Phase 1b: player-side (PO) + SI (OnPOHit) reactive firing

- Continues the REQ-0078 `OnHit`/`OnBeenHit` reactive-trigger taxonomy to the PLAYER side.
  REQ-0078 landed the ENEMY side only (`OnUnitBeenHit` retaliation + `OnHit`/`OnUnitHit`
  riders, causedBy dispatch, isolated reactive RNG, determinism preserved). This REQ fires
  the same taxonomy for player POs and adds `OnPOHit` (SI).
- **Out of scope (owned elsewhere):** Linker combat effects — `on_link_pulse` / `pulse` /
  `buff_linked` are REQ-0048 (ratified, todo); link-destination triggers
  (`OnLinkDestinationHit`/`BeenHit`) are REQ-0079 (built spec). This REQ does not touch the
  Linker layer.

## Scope
1. **Player-side PO reactive firing** (reuse REQ-0078 causedBy dispatch + `applyReactiveVerbToTarget`):
   - Offensive riders when a player PO's attack lands a DIRECT hit on an enemy:
     `OnHit` (the firing PO itself), `OnBPHierarchyHit` (any PO in the firing PO's BP),
     `OnUnitHit` (any PO in the firing unit) → verb applied to the struck enemy.
   - Defensive when a player BP takes a DIRECT hit (enemy attack lands): `OnBPBeenHit`
     (POs in that BP), `OnUnitBeenHit` (POs in that unit) → retaliation / self-buff per OQ-F.
2. **OnPOHit (SI)**: compile SIs into the sim snapshot (`compile.cjs` currently builds only
   BPs + grid POs — SIs are absent), attach their effects, and fire an SI's `OnPOHit` when
   its host PO lands a direct hit (rider on the struck target). This lights up the 3 live
   `OnPOHit` SIs (Frost Orb→Chill, Poison Coat→Poison, Guard→Block).

## Design notes / open questions
- No new event types beyond `reactive_proc`; reuse OQ-A..F, depth-1 (OQ-C), isolated
  `reactive/<trigger>/…` RNG (OQ-D).
- Scoping predicates need PO→BP→unit membership at runtime. `compile.cjs` gives
  `pos[].bpId`; unit membership must be threaded through the party (partyPos may need a
  `unitId`/`unitSlot`).
- SI compilation is the main new surface: resolve each SI's host PO (socket/seating) and
  fold host-scoped semantics; determinism-safe because SIs are absent from the sim today.
- **Determinism contract:** existing goldens stay byte-identical (no current player content
  uses the new triggers; SIs are not yet compiled). New coverage = new fixtures only.

## Gates (fill on build)
- `sim/tests/run.cjs`: player offensive-rider, player defensive, `OnPOHit` fixtures;
  deterministic replay; baseline (no new triggers) emits no `reactive_proc`.
- Full CI green: sim units, goldens (12 identical), mock, check_engine_types, api_test.

## Commits / outcome
- (filled on implementation)

## Build results (2026-07-07) — all gates green
Branch `req-0095-onhit-phase1b-player-si` off `req-0078-onhit-taxonomy`.
- **Player-side PO firing** (`sim/lib/{dungeon,encounter}.cjs`): `dungeon.cjs` tags
  `unitSlot` onto pos/bps (lost by the 4-unit flatMap); `encounter.cjs`
  `dispatchPlayerOffensive` fires OnHit / OnBPHierarchyHit / OnUnitHit riders on struck
  enemies, `dispatchPlayerDefensive` fires OnBPBeenHit / OnUnitBeenHit retaliation rays.
  Reuses REQ-0078 `applyReactiveVerbToTarget` + isolated reactive RNG.
- **OnPOHit** (`sim/lib/compile.cjs`): SIs seated in a PO (`{po,si}` host) compiled into
  the snapshot (`siDefsById` threaded through `runDungeon`); OnPOHit rides the host PO's
  landed hits.
- Commits: `8a2c933` (player firing) · `9b3064d` (player tests) · `e60123e` (OnPOHit) ·
  `37fd398` (OnPOHit test).
- **Gates:** sim 66/0 · goldens 12 byte-identical (determinism intact) · mock 97/0 ·
  check_engine_types OK · api_test 134/0.
- **Deferred (follow-ups):** SI `'bond'` (assembly) + `'inv'` (unseated) host resolution —
  the 3 live OnPOHit SIs are 'bond'/'inv', so OnPOHit stays dormant on live content until
  a `{po,si}`-seated SI or bond-resolution lands. The server must pass `siDefsById` to
  `runDungeon` for OnPOHit to fire in production (sim-level support complete). Self-buff
  reactive riders (`block`/`heal_bp`) per OQ-F Phase-1c. Linker triggers = REQ-0048 / REQ-0079.
