#!/usr/bin/env bash
# tools/e2e_ports.sh -- name a harness's ports.
#
# It no longer derives anything from a REQ number. It asks the rental port desk
# (tools/port_desk.sh) for a free block of 10 consecutive ports and names them.
# Source it with NO argument:
#
#   source "$(dirname "$0")/e2e_ports.sh"
#   # -> STATICPORT, APIPORT, PROXYPORT, E2E_PORT_BASE  (a free decade)
#
# Index convention (unchanged, so no harness body changes): 0 = static, 1 = api,
# 2 = proxy; 4..9 = e2e fleet workers. Any of the four names already set in the
# environment wins, so a caller can still override.
_desk="$(dirname "${BASH_SOURCE[0]}")/port_desk.sh"
E2E_PORT_BASE="$("$_desk" 10)" || { echo "[e2e-ports] the port desk gave no block" >&2; exit 75; }
STATICPORT="${STATICPORT:-$E2E_PORT_BASE}"
APIPORT="${APIPORT:-$((E2E_PORT_BASE + 1))}"
PROXYPORT="${PROXYPORT:-$((E2E_PORT_BASE + 2))}"
export STATICPORT APIPORT PROXYPORT E2E_PORT_BASE
echo "[e2e-ports] leased decade ${E2E_PORT_BASE}-$((E2E_PORT_BASE + 9)) -> static:$STATICPORT api:$APIPORT proxy:$PROXYPORT" >&2
