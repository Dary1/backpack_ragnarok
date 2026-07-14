#!/usr/bin/env bash
# tools/e2e_ports.sh -- REQ-0172. Derive a harness's ports from its REQ number.
#
#   PORT = <REQ number> * 10 + <index 0-9>
#
# Each REQ owns exactly one decade, so two harnesses can NEVER collide by
# construction, and a port names its owner on sight (1562 -> REQ-0156, index 2).
# Index convention: 0 = static, 1 = api, 2 = proxy. 3-9 are free for a harness
# that needs more.
#
#   REQ-0152 (art_inspect)  -> 1520 / 1521 / 1522
#   REQ-0156 (artadmin)     -> 1560 / 1561 / 1562
#   REQ-0157 (contentadmin) -> 1570 / 1571 / 1572
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
#   # -> STATICPORT=1560 APIPORT=1561 PROXYPORT=1562, each already checked free
#
# The derived value is the DEFAULT, not a hardcode: STATICPORT/APIPORT/PROXYPORT
# already set in the environment win, so a caller can still override.
#
# See PROJECT.md, "E2E / harness port allocation" for the rule itself.

# Lowest REQ whose decade clears the privileged 1024 line (103*10 = 1030), and
# highest whose decade stays under 65535 (6553*10+9 = 65539 would overrun, so
# 6553 is the last SAFE base... 6553*10 = 65530, +9 = 65539 > 65535). Cap at 6552.
_E2E_PORTS_MIN_REQ=103
_E2E_PORTS_MAX_REQ=6552

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
    echo "[e2e-ports]   below it the decade dips under the privileged 1024 line;" >&2
    echo "[e2e-ports]   above it it overruns 65535. The rule needs revisiting -- see PROJECT.md." >&2
    return 64
  fi

  local base=$((req * 10))
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
