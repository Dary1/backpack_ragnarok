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
echo "==== [2.5/7] S4 post-processor tests (REQ-0050) ===="
node sim/tests/s4_test.cjs
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
echo "==== [3.7/7] vocab self-test (verbs/triggers/render + range validation) ===="
node tools/self_test_vocab.cjs
echo "==== [4/7] server api tests (files backend) ===="
node server/tests/api_test.cjs
echo "==== [4.5/7] pg_sync worker crash-recovery (DB-free) ===="
node server/tests/pg_sync_test.cjs
echo "==== [4.6/7] artwork backfill mapping + adoption matcher (DB-free, REQ-0151) ===="
node server/tests/backfill_registry_test.cjs
if [ "${SKIP_PG:-0}" != "1" ]; then
  echo "==== [5/7] server api tests (pg backend) ===="
  : "${DATABASE_URL:?SKIP_PG=1 or set DATABASE_URL}"
  STORAGE_BACKEND=pg node server/tests/api_test.cjs
  echo "==== [5.1/7] server artwork registry tests (pg backend, REQ-0151) ===="
  STORAGE_BACKEND=pg node server/tests/artwork_test.cjs
else
  echo "==== [5/7] server api tests (pg backend) SKIPPED ===="
fi
if [ "${SKIP_CLIENT:-0}" != "1" ]; then
  # REQ-0125a: unit-icon resolution chain + G7 charge-ring geometry. Pure
  # functions driven from plain Node (vite ssrLoadModule, same rig as
  # check_sprites.mjs) -- no browser, no Pixi, so it is cheap and belongs in
  # front of the build. It also pins the NO-DIFF contract: the legacy glyph must
  # still land on exactly its old 44x44 @ (x-22,y-22) placement now that the
  # unit sprite goes through the shared contain-fit. Guarded by SKIP_CLIENT
  # because it needs client/node_modules (vite).
  echo "==== [5.6/7] client unit-icon chain + G7 ring (REQ-0125a) ===="
  (cd client && node scripts/check_unit_icon.mjs)
  # REQ-0142: link-trace query layer (client/src/board/linkTrace.ts) driven
  # against the REAL engine, with canvas_spec.md's own decoded example as the
  # golden. Pure functions, no browser, no Pixi -- same rig and the same reason
  # as the unit-icon gate above, so it sits beside it, in front of the build.
  echo "==== [5.7/7] client link-trace queries (REQ-0142) ===="
  (cd client && node scripts/check_link_trace.mjs)
  echo "==== [6/7] client typecheck + build ===="
  (cd client && npm run build)
else
  echo "==== [6/7] client typecheck + build SKIPPED ===="
fi
if [ "${SKIP_E2E:-0}" != "1" ]; then
  echo "==== [7/7] client e2e ===="
  # REQ-0080: default to the local ingress proxy (localhost, ~40x less latency
  # than the public tunnel) and GPU-accelerated rendering (ANGLE/Vulkan -> the
  # box's real GPU instead of CPU SwiftShader). Both are overridable: force the
  # old path with PLAYWRIGHT_BASE_URL=https://backpack-dev.qtie.jp E2E_GPU=0.
  (cd client && PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:8803}" \
                E2E_GPU="${E2E_GPU:-1}" \
                E2E_PARALLEL="${E2E_PARALLEL:-4}" npm run e2e) # REQ-0083: 4 isolated-backend workers (E2E_PARALLEL=0 -> serial)
else
  echo "==== [7/7] client e2e SKIPPED ===="
fi
echo "CI GREEN"
