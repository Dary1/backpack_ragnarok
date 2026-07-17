#!/usr/bin/env bash
# tools/artadmin_e2e.sh -- REQ-0156 gate G2 isolated e2e bringup.
#
# Same HOME-remap harness pattern as tools/art_inspect_e2e.sh (REQ-0152),
# pointed at e2e/artadmin.config.ts on its own spare ports. Stands up an
# ISOLATED instance of THIS worktree's api + static web + local proxy, then
# runs the artadmin Playwright spec through tools/e2e_run.sh (box lock).
# Never touches the live services or the live artwork rows:
#   - HOME is remapped to a temp dir whose backpack_ragnarok symlinks back to
#     the worktree, so storage_art's NAMESPACE (hash of $HOME/backpack_ragnarok)
#     is UNIQUE to this run while content/code still resolve to the worktree.
#   - api on a spare port, STORAGE_BACKEND=pg, ART_ROUTE_MOCK=1 (no GPU),
#     ART_MOCK_DELAY_MS holds each mock job in flight ~1.5 s so the cancel
#     spec can observe pending queue entries (REQ-0156).
#   - artadmin.config.ts carries NO globalSetup/webServer.
#
# The client must be BUILT into web/ first (cd client && pnpm run build).
# Requires DATABASE_URL in the environment (source server/.env first). Run:
#   set -a; source ~/backpack_ragnarok/server/.env; set +a; bash tools/artadmin_e2e.sh
set -euo pipefail
: "${DATABASE_URL:?source server/.env first (DATABASE_URL required)}"

WT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_PY="${ART_KIT_PYTHON:-/home/qtie/backpack_ragnarok/.venv/bin/python}"

# REQ-0172: ports are DERIVED from this harness's REQ number, never hand-picked.
#   PORT = REQ * 10 + index   (0 = static, 1 = api, 2 = proxy)
# so REQ-0156 owns 1560..1569 and can never collide with another REQ's harness.
# The helper also preflights each port and aborts with ONE clear line if it is
# busy, instead of letting the specs die later on ECONNREFUSED. See PROJECT.md,
# "E2E / harness port allocation".
source "$(dirname "$0")/e2e_ports.sh" 0156


TMPHOME="$(mktemp -d)"
MODELDIR="$(mktemp -d)"
EXPORTDIR="$(mktemp -d)"
ln -s "$WT" "$TMPHOME/backpack_ragnarok"
for f in flux-2-klein-4b-Q8_0.gguf qwen_3_4b.safetensors flux2-vae.safetensors; do echo standin > "$MODELDIR/$f"; done

PIDS=()
cleanup() {
  for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done
  rm -rf "$TMPHOME" "$MODELDIR" "$EXPORTDIR"
}
trap cleanup EXIT

echo "[artadmin_e2e] api :$APIPORT  static :$STATICPORT  proxy :$PROXYPORT"

HOME="$TMPHOME" PORT="$APIPORT" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" ALLOW_DEV_CLEAR=1 \
  ART_ROUTE_MOCK=1 ART_MOCK_DELAY_MS="${ART_MOCK_DELAY_MS:-1500}" \
  ART_MODEL_DIR="$MODELDIR" ART_EXPORT_ROOT="$EXPORTDIR" \
  ART_JOB_PYTHON="$VENV_PY" ART_KIT_PYTHON="$VENV_PY" ART_KIT_MATTE_METHOD=borderkey \
  node "$WT/server/api.cjs" > /tmp/req0156_e2e_api.log 2>&1 &
PIDS+=($!)

# REQ-0222: node event-loop static server (keep-alive) replaces python's
# http.server -- see tools/e2e_known_flaky.tsv (goto-under-load) and the
# REQ-0222 file for the measured load-scaling evidence.
E2E_STATIC_PORT="$STATICPORT" E2E_STATIC_ROOT="$WT/web" node "$WT/client/e2e/static-server.cjs" > /tmp/req0156_e2e_static.log 2>&1 &
PIDS+=($!)

E2E_STATIC_PORT="$STATICPORT" E2E_API_PORT="$APIPORT" E2E_PROXY_PORT="$PROXYPORT" \
  node "$WT/client/e2e/local-proxy.cjs" > /tmp/req0156_e2e_proxy.log 2>&1 &
PIDS+=($!)

# wait for the api + proxy to accept connections
for i in $(seq 1 80); do
  if curl -s -o /dev/null "http://127.0.0.1:$APIPORT/api/content" 2>/dev/null; then break; fi
  sleep 0.5
done
for i in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:$PROXYPORT/api/content" 2>/dev/null && curl -s -o /dev/null "http://127.0.0.1:$STATICPORT/app/" 2>/dev/null; then break; fi
  sleep 0.5
done

PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" bash "$WT/tools/e2e_run.sh" --config=e2e/artadmin.config.ts
