> [Board triage 2026-07-12, integration owner] todo -> draft: blocked on REQ-0129 charge/trigger taxonomy vocab freeze (this REQ introduces new trigger vocabulary; naming must follow the frozen taxonomy).

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0056 — Death Wills (`on_bp_destroyed`) + unit-side last breath

- **Status**: ADOPTED by user (2026-07-06) — implementation QUEUED. User additionally
  ordered unit-side proposals (「リンカーも提案してください」) — §3.
- Origin: brainstorm batch 2 item 8. BP death is already dynamic terrain (destroyed
  BPs are passable); this REQ makes it a build moment — late-fight crescendos.

## User spec
「採用です」 — martyr/bequeath/final-pulse effect family on BP destruction.

## Design

### §1 Vocabulary [ratified by adoption; listed per pipeline §2]
- triggers += `on_bp_destroyed` (po_only + SI via `both`? v1: po_only; SI lens path
  in §3 uses its own trigger from REQ-0054). Fires when the HOST BP's hp reaches 0.

### §2 Launch effect patterns (content, existing verbs only)
| pattern | AST |
|---|---|
| Martyr (爆散) | `on_bp_destroyed: strike [n]` — fires the PO's own attack_profile ray(s) once |
| Bequeath (遺贈) | `on_bp_destroyed: pulse` — the dying BP's circuit fires one last time (charge transfer emerges once Capacitor lands) |
| Last ward | `on_bp_destroyed: block/heal_bp [n]` targeting `linked` BPs (uses REQ-0048 link scope) |

### §3 Unit-side last breath (user-ordered proposals)
- **Recommended: `testament_lens`** (REQ-0054 lens SI): on host BP destruction, the
  unit emits one final pulse with `hopsLeft +1`, bypassing PULSE_CAP once.
  Composable with any future unit type; no new axis; ships with the lens family.
- Alternative (deferred): a `Testament` unit TYPE — same behavior as an intrinsic;
  park until the unit-type axis (factorized set, selection pending) is ratified.
- **[LOCKED semantics]**: death resolution order = killing hit fully applies → host
  POs' `on_bp_destroyed` effects fire (canvas reading order) → unit last-breath
  emission → unit goes inert (REQ-0048 death rule unchanged thereafter). All at
  the death event's `t`, ordered by `seq`.

### §4 Cascade guard
Death effects may kill other BPs/enemies → their wills fire too. Depth cap
[TUNABLE 4] per originating death event; beyond cap, wills are suppressed with a
`will_suppressed` log line (mirrors ray step-budget discipline). Deterministic
ordering by `(t, seq)` as everywhere.

### §5 Replay / monitor
Events: `bp_destroyed` (exists), + `will_fire {uid, pattern}`, `last_breath {bp}`.
Monitor: brief flare on the dying BP; chimes (REQ-0059) give death a chord.

## Pack assignment (user ruling 2026-07-06; catalog = REQ-0062)
Death-will POs + `testament_lens` debut in the **Martyr Pack** (bundled with tanky
large shapes whose deaths are worth scripting); dungeon drops follow in-batch.

## Test plan
- sim: trigger firing order, cascade depth cap, testament emission-before-inert,
  determinism goldens; interaction tests with REQ-0048 (visited sets across a death),
  REQ-0049 (wills during layered encounters — mode gating applies to will payloads).
- engine: none (trigger is sim-side; vocab file + validators updated).
- client: E2E monitor flare + log lines; Dex renders the new trigger wording.
- S4: A-class DPS attribution includes will damage; wipe-autopsy (D6) tracks
  will-caused enemy deaths (posthumous clears are a legitimate outcome, not a bug).
