#!/usr/bin/env bash
# tools/signed_out_e2e.sh -- REQ-0365. The SIGNED-OUT app, end to end.
#
# WHAT THIS PROVES. With dev_mode OFF and no credential the server 401s
# /api/me, and the client must stop at a signed-out title screen instead of
# booting a scenario board it can never save. That second half is not a
# hypothetical: measured on a scratch dev_mode:false api (2026-08-03),
# /api/content answers 200 while /api/profile/<id>/canvas 401s, and
# resolveGameData swallows the canvas 401 (`.catch(() => null)`) -- so before
# REQ-0365 boot() SUCCEEDED into a pristine board whose every auto-save failed
# in silence. Only an end-to-end run over a real dev_mode:false backend can
# tell that apart from the fix.
#
# WHY ITS OWN HARNESS. Every fleet worker seeds dev_mode:true (that is what the
# other 45 spec files rely on for their identity), so this cannot be a member of
# the default suite. It is NOT one of the isolated HOME-remap admin harnesses
# either -- it needs no pg namespace and touches no registry. It is the ordinary
# hermetic fleet, one worker, with E2E_DEV_MODE_OFF=0.
#
# Ports come from the rental desk (REQ-0323); never hand-pick.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=/dev/null
source tools/e2e_ports.sh
echo "[signed_out_e2e] proxy :$PROXYPORT  fleet base :$((E2E_PORT_BASE + 4))"

cd client
E2E_FLEET_ROOT=/tmp/bp_e2e_workers_signedout \
E2E_DEV_MODE_OFF=0 \
E2E_PROXY_PORT="$PROXYPORT" \
E2E_FLEET_BASE_PORT="$((E2E_PORT_BASE + 4))" \
PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" \
E2E_PARALLEL=1 \
  pnpm exec playwright test --config=signedout.config.ts
