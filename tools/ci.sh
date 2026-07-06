#!/usr/bin/env bash
# tools/ci.sh -- REQ-0047 (a): THE quality gate. Run before every commit
# that touches code. Everything must be green.
#
# Env toggles (for environments missing a dependency):
#   SKIP_PG=1      skip the Postgres-backend api_test pass (needs DATABASE_URL)
#   SKIP_CLIENT=1  skip client typecheck+build
#   SKIP_E2E=1     skip Playwright e2e (needs installed browsers + running services)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==== [1/7] sim tests ===="
node sim/tests/run.cjs
echo "==== [2/7] sim replay goldens (determinism contract) ===="
node sim/tests/goldens.cjs
echo "==== [3/7] mock-src engine tests ===="
node mock-src/tests/run.cjs
echo "==== [3.5/7] typecheck (server modules + shared, checkJs) ===="
if [ -x node_modules/.bin/tsc ]; then
  node_modules/.bin/tsc -p tsconfig.server.json
else
  echo "typescript missing -- run: npm install" >&2; exit 1
fi
echo "==== [3.6/7] engine type-surface drift check ===="
node tools/check_engine_types.cjs
echo "==== [4/7] server api tests (files backend) ===="
node server/tests/api_test.cjs
if [ "${SKIP_PG:-0}" != "1" ]; then
  echo "==== [5/7] server api tests (pg backend) ===="
  : "${DATABASE_URL:?SKIP_PG=1 or set DATABASE_URL}"
  STORAGE_BACKEND=pg node server/tests/api_test.cjs
else
  echo "==== [5/7] server api tests (pg backend) SKIPPED ===="
fi
if [ "${SKIP_CLIENT:-0}" != "1" ]; then
  echo "==== [6/7] client typecheck + build ===="
  (cd client && npm run build)
else
  echo "==== [6/7] client typecheck + build SKIPPED ===="
fi
if [ "${SKIP_E2E:-0}" != "1" ]; then
  echo "==== [7/7] client e2e ===="
  (cd client && npm run e2e)
else
  echo "==== [7/7] client e2e SKIPPED ===="
fi
echo "CI GREEN"
