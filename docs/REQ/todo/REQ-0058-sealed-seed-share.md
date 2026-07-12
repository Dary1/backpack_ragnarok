> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0058 — Sealed Seed Share (同一スケジュール共有)

- **Status**: ADOPTED WITH USER REDESIGN (2026-07-06) — implementation QUEUED
- Origin: brainstorm batch 2 item 11 (ghost racing). User's redesign: **only seeds
  that have NEVER been run are shareable** — "share the same schedule with friends".
  Rationale ties to the item-12 rejection: anyone who has SEEN a seed run gains a
  counter-pick advantage; sealing removes it. Grudge Rematch (12) stays REJECTED.

## User spec
「ランがまだ実行されたことがないSeedはシェア可能にすることで同機能に対応します。
(フレンドに同スケジュールを共有機能)　リンカーは無関係でgreen。」

## Design
- **Sealed schedule token**: `POST /api/schedule/seal` mints
  `{dungeonType, level, genSeed, affixes(REQ-0055), sealId}` with a SERVER-generated
  seed (bypasses nothing: REQ-0043's admin-only custom-seed gate is untouched —
  sealing always mints fresh, so no caller ever supplies a seed).
- **Sealing invariant**: a seed is shareable IFF it has zero runs at mint time —
  guaranteed by construction (freshly minted, never exposed before sealing).
  The sealed tuple is frozen; recipients' rooms copy it verbatim.
- **Share**: link/token to friends (invite-auth scale); each participant may run a
  given sealId **once** [TUNABLE 1]; the run is otherwise a normal scheduled run
  (rewards, cooldowns, warehouse — no special economy).
- **Anti-spoiler visibility [ORCH default, vetoable]**: replays/results of OTHER
  participants' runs of a sealId are hidden from you until YOUR run of it settles
  (then everything unlocks). Consistent with the "?"-masking philosophy: spectators
  must not see answers before the troop — here, before themselves.
- **Comparison view** (post-settle): side-by-side timelines per participant —
  clear time, finishing H, per-encounter durations, damage taken, attachments
  resolved (REQ-0049), with links into each replay. Chimes (REQ-0059) make the
  side-by-side audible for flavor.
- Storage: `sealed_seeds` table/file (files+pg parity, storage.cjs chokepoint rule);
  participant run registry keyed (sealId, playerId).
- **Not built**: leaderboards beyond the participant set, global discovery, rewards
  for "winning" a comparison — friendly benchmarking only, per retention philosophy
  (no appointments, no pressure).

## Test plan
- server: seal mint freshness-by-construction, one-run-per-participant 409, copy
  fidelity (tuple byte-equal across rooms), visibility gate (403/masked until own
  settle), files+pg parity.
- sim: none (ordinary runs).
- E2E: seal → share → two guests run → masked-until-settle → comparison view.
