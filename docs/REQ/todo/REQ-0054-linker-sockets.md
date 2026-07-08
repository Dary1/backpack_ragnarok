# REQ-0054 — Linker Sockets (Lens SIs)

- **Status**: ADOPTED by user (2026-07-06) — implementation QUEUED
- Origin: brainstorm batch 2 item 7. The Linker is already a system PO (1×1); giving
  it ONE socket connects the SI economy to Linker customization using machinery that
  already exists (sockets, SI seating, hierarchy matching).

## User spec
「採用です」 — Linker gains a socket; "Beam lens" SI family customizes pulses.

## Design
- **Engine**: the system Linker PO def gains `sockets:[{t:"lens", tags:[...], ax,ay}]`
  (one socket). Seating/rejection reuses `sockets(st)` verbatim. Inventory world:
  lens SIs seat/unseat like any SI (linkers stay dormant there, standing rule).
- **Vocabulary [USER to ratify]**: `socket_tags` += `lens` (closed-list growth);
  triggers += `on_pulse_emit` (SI-only domain; fires when the host linker emits or
  relays a pulse). Both listed as design events per pipeline §2.
- **Launch lenses (3, content)**:
  | id | effect |
  |---|---|
  | hop_lens | emitted/relayed pulses get `hopsLeft +1` (stacks with Amplifier-type rules later; cap [TUNABLE +2 total]) |
  | dye_lens_burn | imprints Burn [n] on the pulse; downstream strike payloads add `apply_status` Burn (REQ-0048 §5.5 imprinting, first concrete carrier) |
  | guard_lens | `on_pulse_emit`: host BP gains block [n] (the circuit hums = the walls harden) |
- **Sim**: lens facts fold at compile onto the linker's edge records; runtime reads
  folded values (no per-event socket lookups). Replay: pulses carry `dye`/`hopBonus`
  fields for the monitor (and REQ-0059 chimes timbre).
- **Death interplay**: see REQ-0056 — the recommended "Testament" behavior ships as
  a lens, composing with everything here.
- **Dex**: lens SIs render on the linker's card (REQ-0052 kind `bp`/linker section).

## Pack assignment (user ruling 2026-07-06; catalog = REQ-0062)
Lens SIs debut as **Prism Pack** bonus slots (bundled with amplifier/splitter/
condenser-type linkers — the pack teaches lens-on-linker by construction) and also
enter dungeon drop tables in their batch.

## Test plan
- engine: lens seating/rejection matrix, one-socket cap, migrateState back-compat.
- sim: hop bonus math, dye propagation determinism, guard_lens block accounting,
  goldens updated.
- client: E2E seat/unseat lens on a linker, monitor shows dyed pulses; tsc/lint.
- S4: A4 circuit metrics re-run; dye saturation feeds A2 status saturation.
