#!/usr/bin/env bash
# tools/e2e_ports.sh -- REQ-0323. LEASE a block of ports at run time.
#
# THE RULE IS GONE. Ports are no longer derived from a REQ number. There is no
# base, no ceiling, no poisoned decade and no REQ-2775 wall: this asks the OS
# what is free, takes the lowest free block, and writes down that it took it.
# (Superseded: REQ-0172 / REQ-0251 / REQ-0321's PORT = 5000 + REQ*10 + index,
# and REQ-0322's blind spot in the gate that enforced it.)
#
# USAGE -- from a harness, WITH NO ARGUMENTS:
#
#     source "$(dirname "$0")/e2e_ports.sh"
#     # -> E2E_PORT_BASE, STATICPORT, APIPORT, PROXYPORT   (already probed free)
#
# and release it when done (tools/e2e_harness.sh does this from its cleanup trap):
#
#     e2e_ports_release
#
# Inspection (run it, do not source it):
#     tools/e2e_ports.sh --who    # live leases: block, caller, pid, age, BOUND NOW
#     tools/e2e_ports.sh --gc     # reclaim stale leases now and report
#     tools/e2e_ports.sh --pool   # the pool constants, as JSON
#
# PASSING A REQ NUMBER IS AN ERROR (exit 64). Every pre-REQ-0323 call site
# passed one; making it fail loudly is the point, so that a site this REQ missed
# breaks immediately and visibly instead of silently deriving a port nobody owns.
#
# The mechanics live in tools/e2e_port_lease.py -- pool constants, the three
# reclaim conditions, and the O_EXCL lease. Read that file for the design.
#
# ---------------------------------------------------------------------------
# BASH TRAP, READ BEFORE CHANGING A CALL SITE.
# `source file` WITHOUT arguments does not clear the positional parameters -- the
# sourced file sees the CALLER's "$@". So sourcing this from inside a function
# that was itself called with arguments (e2e_harness_req 0152 art_inspect_e2e)
# would make it look as though a REQ number had been passed, and the guard below
# would reject a correct call site. Every caller therefore sources it from a
# ZERO-ARGUMENT wrapper function. Keep that shape.
# ---------------------------------------------------------------------------

_E2E_PORTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_E2E_PORTS_PY="$_E2E_PORTS_DIR/e2e_port_lease.py"

# Every port a caller is entitled to bind is INSIDE its leased block. Anything
# else is a bug, so a pre-set APIPORT/PROXYPORT is not honoured (the old
# ${VAR:-<derived>} seam existed because the value was a guess; a lease is not).
e2e_ports_allocate() {
  local caller="${E2E_PORTS_CALLER:-$(basename -- "${BASH_SOURCE[2]:-${BASH_SOURCE[1]:-shell}}")}"
  local base rc owner
  # WHO OWNS THE LEASE. Two traps here, both observed rather than reasoned about:
  #   * $$ inside a ( ... ) subshell is still the PARENT's pid, so ten
  #     backgrounded leasers would record one owner between them.
  #   * BASHPID must be captured HERE, on its own line. Expanded inside the
  #     command substitution below it names the SUBSTITUTION SUBSHELL, which
  #     exits the instant python returns -- every lease would then read as a
  #     dead pid while its harness was still running and bound. (Caught by the
  #     two-harness concurrency gate, G3: `--who` said STALE for two live runs.
  #     No block was ever mis-issued even so, because the bind probe refuses a
  #     block whose ports are busy no matter what the ledger says -- which is
  #     the whole point of "the ledger is a hint".)
  owner="${BASHPID:-$$}"
  base="$(python3 "$_E2E_PORTS_PY" allocate --caller "$caller" --pid "$owner")"
  rc=$?
  if [ "$rc" -ne 0 ] || [ -z "$base" ]; then
    echo "[e2e-ports] FATAL: could not lease a port block (exit $rc)." >&2
    return "${rc:-75}"
  fi
  E2E_PORT_BASE="$base"
  E2E_PORT_BLOCK_END="$((base + 9))"
  STATICPORT="$base"          # vestigial: REQ-0234 dropped the static server, so
                              # nothing binds this. Still exported (REQ-0323 2.5)
                              # so no harness body has to change.
  APIPORT="$((base + 1))"
  PROXYPORT="$((base + 2))"
  E2E_FLEET_PORT_BASE="$((base + 4))"
  export E2E_PORT_BASE E2E_PORT_BLOCK_END STATICPORT APIPORT PROXYPORT E2E_FLEET_PORT_BASE
  # stdout, in plain words: a human AND an LLM read this transcript to find out
  # what actually happened (REQ-0323 2.5).
  echo "[e2e-ports] leased block ${base}-${E2E_PORT_BLOCK_END} for ${caller} (pid ${owner})"
  echo "[e2e-ports]     YOUR API PORT IS ${APIPORT}.  YOUR PROXY PORT IS ${PROXYPORT}."
  echo "[e2e-ports]     YOUR FLEET WORKERS ARE ${E2E_FLEET_PORT_BASE}-${E2E_PORT_BLOCK_END}."
  echo "[e2e-ports]     release it with: e2e_ports_release    inspect with: tools/e2e_ports.sh --who"
  return 0
}

# Drop this shell's lease. Safe to call twice and safe to call with nothing held.
e2e_ports_release() {
  local base="${1:-${E2E_PORT_BASE:-}}" owner
  [ -z "$base" ] && return 0
  owner="${BASHPID:-$$}"   # captured OUTSIDE the substitution -- see e2e_ports_allocate
  python3 "$_E2E_PORTS_PY" release "$base" --pid "$owner" 2>/dev/null || true
  if [ "$base" = "${E2E_PORT_BASE:-}" ]; then unset E2E_PORT_BASE; fi
  return 0
}

e2e_ports_who()  { python3 "$_E2E_PORTS_PY" who "$@"; }
e2e_ports_gc()   { python3 "$_E2E_PORTS_PY" gc "$@"; }
e2e_ports_pool() { python3 "$_E2E_PORTS_PY" pool "$@"; }

_e2e_ports_reject_req() {
  cat >&2 <<'MSG'
[e2e-ports] REQ-0323: e2e_ports.sh takes NO arguments. Ports are LEASED at run
[e2e-ports] time from a pool, not derived from a REQ number -- the derived rule
[e2e-ports] (PORT = 5000 + REQ*10 + index) is deleted, along with its base, its
[e2e-ports] ceiling, its poisoned decades and its REQ-2775 wall.
[e2e-ports]
[e2e-ports]   was:  source "$(dirname "$0")/e2e_ports.sh" 0156
[e2e-ports]   now:  source "$(dirname "$0")/e2e_ports.sh"
[e2e-ports]         ... use $APIPORT / $PROXYPORT / $E2E_PORT_BASE as before ...
[e2e-ports]         e2e_ports_release      # from your cleanup trap
[e2e-ports]
[e2e-ports] If you are SOURCING this from inside a function that takes its own
[e2e-ports] arguments, wrap the source in a zero-argument function -- bash lets a
[e2e-ports] sourced file see the caller's "$@". See the header of this file.
MSG
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  # Executed, not sourced: inspection subcommands only.
  case "${1:-}" in
    --who) shift; e2e_ports_who "$@"; exit $? ;;
    --gc)  shift; e2e_ports_gc "$@";  exit $? ;;
    --pool) shift; e2e_ports_pool "$@"; exit $? ;;
    --release) shift; python3 "$_E2E_PORTS_PY" release "$@"; exit $? ;;
    "" | -h | --help)
      sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) _e2e_ports_reject_req; exit 64 ;;
  esac
fi

# Sourced. Any argument here is a pre-REQ-0323 call site: fail loudly.
if [ "$#" -gt 0 ] && [ -n "${1:-}" ]; then
  _e2e_ports_reject_req
  # EXIT, not return: every caller is a harness that can do nothing useful
  # without ports, and an unnoticed non-zero return would let it sail on and
  # fail later in a way that hides the cause.
  exit 64
fi

e2e_ports_allocate || exit $?
