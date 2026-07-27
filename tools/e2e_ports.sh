#!/usr/bin/env bash
# tools/e2e_ports.sh -- REQ-0172. Derive a harness's ports from its REQ number.
#
#   PORT = 5000 + <REQ number> * 10 + <index 0-9>
#
# Each REQ owns exactly one decade, so two harnesses can NEVER collide by
# construction, and a port names its owner on sight: subtract the 5000 base,
# 6562 -> 1562 -> REQ-0156, index 2 (proxy).
# Index convention: 0 = static, 1 = api, 2 = proxy. 3-9 are free for a harness
# that needs more.
#
#   REQ-0152 (art_inspect)  -> 6520 / 6521 / 6522
#   REQ-0156 (artadmin)     -> 6560 / 6561 / 6562
#   REQ-0157 (contentadmin) -> 6570 / 6571 / 6572
#   REQ-0221 (registry)     -> 7210 / 7211 / 7212
#
# Read a port by subtracting the 5000 base: 6522 -> 1522 -> REQ-0152, index 2.
#
# WHY THIS EXISTS. The harnesses used to hand-pick their ports, and
# artadmin_e2e.sh and content_admin_e2e.sh both landed on 8921/8922/8923.
# Harmless while each was only ever run BY HAND, one at a time (REQ-0156/0157) --
# fatal the moment REQ-0159's tools/ci.sh ran all three back-to-back: the second
# could not bind while the first's processes were still coming down, its proxy
# never came up, and every spec in it died on ECONNREFUSED. Hand-picked ports
# collide eventually. Derived ports cannot.
#
# USAGE (from a harness):
#   source "$(dirname "$0")/e2e_ports.sh" 0156
#   # -> STATICPORT=6560 APIPORT=6561 PROXYPORT=6562, each already checked free
#
# The derived value is the DEFAULT, not a hardcode: STATICPORT/APIPORT/PROXYPORT
# already set in the environment win, so a caller can still override.
#
# See PROJECT.md, "E2E / harness port allocation" for the rule itself.

# REQ-0251: the 5000 base, and the REAL ceiling.
#
# The old rule was PORT = REQ*10, floored at REQ-0103 (below it the decade dips
# under the privileged 1024 line) and capped at REQ-6552 (above it it overruns
# 65535). Both bounds asked only what the PORT NUMBER FIELD allows, never what
# the KERNEL will let us bind:
#
#   /proc/sys/net/ipv4/ip_local_port_range = 32768 60999
#
# That is the ephemeral range -- the kernel hands those out to OUTGOING
# connections. A harness whose decade landed in it would bind fine most days and
# then, one run in fifty, lose the race to an unrelated outgoing socket and die
# on EADDRINUSE with nothing to point at. The old cap of 6552 put every REQ from
# 3277 up squarely inside it: a rule that "cannot collide" had quietly scheduled
# a flake for REQ-3277. It was ~3000 REQs away, so nobody hit it.
#
# So: base 5000 (which also clears the low registered ports -- the old rule put
# REQ-0152's api on 1521, Oracle's TNS listener), and the ceiling is the
# ephemeral FLOOR, not 65535:
#   5000 + 2775*10 + 9 = 32759  < 32768  OK
#   5000 + 2776*10 + 9 = 32769 >= 32768  overlaps the ephemeral range
# The 5000 base also means no REQ is too SMALL any more: REQ-0001 -> 5010.
_E2E_PORTS_BASE=5000
_E2E_PORTS_MIN_REQ=1
_E2E_PORTS_MAX_REQ=2775

# The permanent shared services are NOT REQ-scoped (PROJECT.md says so), but they
# sit inside the derivable band, so two decades are POISONED and must be refused
# rather than derived into a collision:
#   REQ-0380 -> 8800-8809, which contains backpack-web 8801, backpack-api 8802
#               and the e2e local proxy 8803
#   REQ-0381 -> 8810-8819, which contains the whole REQ-0083 fleet (8810 + up to
#               6 workers)
# Under the old REQ*10 rule these were REQ-0880/0881, ~630 REQs out; the 5000
# base pulls them in to ~130 REQs out, so this is a live concern now, not a
# theoretical one. A REQ that lands here does not get to hand-pick a port
# instead: it must move the shared service or revisit the rule.
_E2E_PORTS_POISONED="380 381"

e2e_ports_for_req() {
  local req_raw="${1:-}"
  if [ -z "$req_raw" ]; then
    echo "[e2e-ports] BUG: e2e_ports.sh must be sourced with a REQ number, e.g. 'source tools/e2e_ports.sh 0156'" >&2
    return 64
  fi
  # Strip a leading REQ- and any leading zeros (0156 -> 156) WITHOUT octal-parsing it.
  local req="${req_raw#REQ-}"
  req="$(printf '%s' "$req" | sed 's/^0*//')"
  case "$req" in
    ''|*[!0-9]*)
      echo "[e2e-ports] BUG: '$req_raw' is not a REQ number" >&2
      return 64
      ;;
  esac
  if [ "$req" -lt "$_E2E_PORTS_MIN_REQ" ] || [ "$req" -gt "$_E2E_PORTS_MAX_REQ" ]; then
    # Not a "pick another port" situation -- the RULE has run out of room and a
    # human has to decide what replaces it. Fail loudly rather than wrap.
    echo "[e2e-ports] REQ-$req is outside the derivable range ${_E2E_PORTS_MIN_REQ}-${_E2E_PORTS_MAX_REQ}:" >&2
    echo "[e2e-ports]   above it the decade overlaps the kernel ephemeral range (32768+)," >&2
    echo "[e2e-ports]   where an outgoing socket can steal the port mid-run. The rule needs" >&2
    echo "[e2e-ports]   revisiting -- see PROJECT.md, 'E2E / harness port allocation'." >&2
    return 64
  fi
  local _poisoned
  for _poisoned in $_E2E_PORTS_POISONED; do
    if [ "$req" = "$_poisoned" ]; then
      echo "[e2e-ports] REQ-$req's decade collides with the PERMANENT shared services" >&2
      echo "[e2e-ports]   (8801 web / 8802 api / 8803 proxy / 8810+ fleet), which are not" >&2
      echo "[e2e-ports]   REQ-scoped. This REQ cannot host a harness under the derived rule;" >&2
      echo "[e2e-ports]   do NOT hand-pick a port -- see PROJECT.md: move the service or" >&2
      echo "[e2e-ports]   revisit the rule." >&2
      return 64
    fi
  done

  local base=$((_E2E_PORTS_BASE + req * 10))
  STATICPORT="${STATICPORT:-$base}"
  APIPORT="${APIPORT:-$((base + 1))}"
  PROXYPORT="${PROXYPORT:-$((base + 2))}"
  E2E_PORT_BASE="$base"
  E2E_PORT_REQ="$req"
  export STATICPORT APIPORT PROXYPORT E2E_PORT_BASE E2E_PORT_REQ
}

# Fail fast on a busy port. Without this, a port that is still held (or squatted
# on by an unrelated process) does not announce itself -- the harness starts,
# the service silently fails to bind, and the specs die dozens of lines later on
# ECONNREFUSED with no hint of the real cause. That is exactly how REQ-0159's ci
# failure presented. One clear line beats forty confusing ones.
e2e_ports_preflight() {
  local busy=0 name port
  for name in STATICPORT APIPORT PROXYPORT; do
    port="${!name}"
    [ -z "$port" ] && continue
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      exec 3<&- 2>/dev/null || true
      echo "[e2e-ports] port $port ($name, REQ-$E2E_PORT_REQ) is BUSY -- aborting." >&2
      busy=1
    fi
  done
  if [ "$busy" -ne 0 ]; then
    echo "[e2e-ports] Another harness or a stray process still holds this REQ's decade." >&2
    echo "[e2e-ports] Ports are derived from the REQ number (PROJECT.md), so a collision here" >&2
    echo "[e2e-ports] is a LEFTOVER PROCESS, never two REQs clashing. Find it with:" >&2
    echo "[e2e-ports]   ss -lntp | grep -E ':(${STATICPORT}|${APIPORT}|${PROXYPORT})\\b'" >&2
    return 75
  fi
  return 0
}

# Sourcing with an argument does both steps -- that is the whole intended usage.
#
# On failure we EXIT rather than return: every caller is a harness that cannot do
# anything useful without its ports, and an unnoticed non-zero return would let it
# sail on and fail later in a way that hides the cause -- which is the entire class
# of bug this file exists to kill.
if [ -n "${1:-}" ]; then
  e2e_ports_for_req "$1" || exit $?
  e2e_ports_preflight || exit $?
  echo "[e2e-ports] REQ-$E2E_PORT_REQ -> static:$STATICPORT api:$APIPORT proxy:$PROXYPORT" >&2
fi
