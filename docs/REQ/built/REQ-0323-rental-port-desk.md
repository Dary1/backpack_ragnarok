# REQ-0323 — Replace the REQ-derived port rule with a simple rental port desk

- **State**: built (the folder is authoritative). Implemented on branch
  `req-0323-e2e-port-lease-allocator`; not merged, not deployed.
- **Owner decision**: 2026-07-27, ratified in chat — stop deriving ports from REQ
  numbers, hand out a free one at call time. **Simplified further 2026-07-28**: a
  plain "rental port desk", no lease ledger, no boot_id, no grace window.
- **Supersedes**: REQ-0321 (the `5000 + REQ*10 + index` derived rule) and REQ-0322
  (the derived-port gate's regex blind spot — moot, there is no derived rule left
  to gate).

## Why the derived rule goes

The old rule derived every harness port from its REQ number. It dragged a
permanent tail of arithmetic — a base, a kernel-ephemeral ceiling, two "poisoned"
decades, a REQ-2775 wall — plus a gate (`tools/check_e2e_ports.cjs`) to enforce
it, and that gate was found broken twice in one day. None of it tested anything.
Ask the OS what is free instead.

## What was built

`tools/port_desk.sh` — the rental port desk. Pool **9000-9200**. It scans upward
and hands out the **lowest free port** (or the lowest run of N consecutive ports).
If the whole pool is busy it wraps to 9000, **kills** whatever holds the needed
port, and takes it — every listener in this range is one of our own test
processes, so there is nothing else it could hit. There is no lease file, no
ledger, no cursor and nothing to garbage-collect: the kernel's answer to "is
anything listening on this port" is the only source of truth.

    PORT=$(tools/port_desk.sh)      # one free port
    BASE=$(tools/port_desk.sh 10)   # base of 10 consecutive free ports (BASE..BASE+9)
    tools/port_desk.sh --busy       # show the pool's current occupants

`tools/e2e_ports.sh` is now a thin shim over the desk: sourced with **no REQ
number**, it leases a free decade and exports STATICPORT / APIPORT / PROXYPORT /
E2E_PORT_BASE with the same index convention as before, so no harness body
changed.

## What was deleted

- The derived-port rule inside `tools/e2e_ports.sh` (base 5000, range 0001-2775,
  poisoned 0380/0381, ceiling arithmetic, every worked example).
- `tools/check_e2e_ports.cjs` and its `tools/ci.sh` `[0/8]` step — there is no
  derived rule left to enforce.

## Call sites updated (they drop the REQ argument)

`tools/e2e_harness.sh` and `tools/ci.sh` now `source tools/e2e_ports.sh` with no
argument. The four harnesses reach their ports through `e2e_harness.sh`, so their
bodies were untouched. `e2e_harness_req <REQ> <name>` still takes a REQ, but only
as the harness's label and lock-file name — never for ports.

## Outcome

Implemented 2026-07-28. Smoke-tested (not a full `ci.sh` run — owner's scope
choice):
- empty pool → 9000; 9000+9001 busy → 9002; block of 10 → base 9002.
- full pool (shrunk to a 2-port range, both busy) → the holder was killed and the
  port re-issued.
- `source tools/e2e_ports.sh` (no arg) → leased 9000-9009, exported
  static:9000 api:9001 proxy:9002.

Follow-up, not done here: run the full `tools/ci.sh` e2e gate; optionally retire
the now-cosmetic REQ label in `e2e_harness_req`.

PROJECT.md's port sections are user-maintained (LLMs may not edit them); the
plain-English replacement text was presented to the owner separately.
