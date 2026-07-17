#!/usr/bin/env bash
# tools/content_admin_e2e.sh -- REQ-0155 G4 isolated e2e bringup.
#
# Stands up an ISOLATED instance of THIS worktree's api + static web + local
# proxy, then runs the contentadmin Playwright spec through tools/e2e_run.sh
# (box lock). Never touches the live services or the live content rows:
#   - HOME is remapped to a temp dir whose backpack_ragnarok symlinks back to
#     the worktree, so storage_content's NAMESPACE (hash of $HOME/
#     backpack_ragnarok) is UNIQUE to this run while content/code still
#     resolve to the worktree.
#   - api on a spare port, STORAGE_BACKEND=pg, CONTENT_EXPORT_ROOT=<temp>
#     (adoption export lands in a temp dir, never in content/), no
#     CONTENT_EXPORT_GIT (no git during e2e). No GPU, no python: the machine
#     checks are pure Node subprocesses spawned via the api's own node.
#   - contentadmin.config.ts carries NO globalSetup/webServer.
#
# Requires DATABASE_URL in the environment (source server/.env first). Run:
#   set -a; source ~/backpack_ragnarok/server/.env; set +a; bash tools/content_admin_e2e.sh
set -euo pipefail
: "${DATABASE_URL:?source server/.env first (DATABASE_URL required)}"

WT="$(cd "$(dirname "$0")/.." && pwd)"

# REQ-0133: Playwright chromium lives in the REAL home cache; the per-run HOME
# remap below would hide it, so capture the real path now (before any remap).
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"

# REQ-0172: ports are DERIVED from this harness's REQ number, never hand-picked.
#   PORT = REQ * 10 + index   (0 = static, 1 = api, 2 = proxy)
# so REQ-0157 owns 1570..1579 and can never collide with another REQ's harness.
# The helper also preflights each port and aborts with ONE clear line if it is
# busy, instead of letting the specs die later on ECONNREFUSED. See PROJECT.md,
# "E2E / harness port allocation".
source "$(dirname "$0")/e2e_ports.sh" 0157

TMPHOME="$(mktemp -d)"
EXPORTDIR="$(mktemp -d)"
ln -s "$WT" "$TMPHOME/backpack_ragnarok"

# REQ-0231: every background service below is setsid'd into its OWN process
# group (leader pid == pgid), and cleanup kills exactly those groups -- polite
# TERM, then KILL for stragglers. NEVER kill by name/pattern: on a shared box
# another session's harness must be untouchable (a contentadmin Playwright run
# was SIGKILLed cross-session on 2026-07-17 by exactly that kind of cleanup).
# The INT/TERM traps convert fatal signals into exits so the EXIT trap still
# runs and an aborted harness leaves no orphans behind.
PIDS=()   # setsid group leaders: pid == pgid
cleanup() {
  for p in "${PIDS[@]:-}"; do kill -TERM -- "-$p" 2>/dev/null || true; done
  sleep 0.5
  for p in "${PIDS[@]:-}"; do kill -KILL -- "-$p" 2>/dev/null || true; done
  rm -rf "$TMPHOME" "$EXPORTDIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "[content_admin_e2e] api :$APIPORT  static :$STATICPORT  proxy :$PROXYPORT"

HOME="$TMPHOME" PORT="$APIPORT" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" ALLOW_DEV_CLEAR=1 \
  CONTENT_EXPORT_ROOT="$EXPORTDIR" \
  setsid node "$WT/server/api.cjs" > /tmp/req0155_e2e_api.log 2>&1 &
PIDS+=($!)

setsid python3 -m http.server "$STATICPORT" --directory "$WT/web" > /tmp/req0155_e2e_static.log 2>&1 &
PIDS+=($!)

# REQ-0231 x REQ-0217 fallout: the post-0217 local-proxy routes /api by
# X-E2E-Worker to E2E_FLEET_BASE_PORT+index (headerless -> +0) and no longer
# honours E2E_API_PORT. Point the "fleet" at THIS harness's single api, and
# pin it EXPLICITLY so an ambient E2E_FLEET_BASE_PORT from a scoped outer CI
# run can never leak in and 502 the specs.
E2E_STATIC_PORT="$STATICPORT" E2E_API_PORT="$APIPORT" E2E_PROXY_PORT="$PROXYPORT" E2E_FLEET_BASE_PORT="$APIPORT" \
  setsid node "$WT/client/e2e/local-proxy.cjs" > /tmp/req0155_e2e_proxy.log 2>&1 &
PIDS+=($!)

for i in $(seq 1 80); do
  if curl -s -o /dev/null "http://127.0.0.1:$APIPORT/api/content" 2>/dev/null; then break; fi
  sleep 0.5
done
for i in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:$PROXYPORT/api/content" 2>/dev/null && curl -s -o /dev/null "http://127.0.0.1:$STATICPORT/app/" 2>/dev/null; then break; fi
  sleep 0.5
done

# REQ-0133: seed THIS isolated registry with the sprite-backfill (INSERT-only,
# adopted renders; no GPU/python -- Playwright rasterizes the SVG symbols) so the
# contentadmin wiring test can prove registry-first art vs the sprite fallback.
HOME="$TMPHOME" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" PLAYWRIGHT_BROWSERS_PATH="$PW_CACHE" \
  node "$WT/tools/backfill_sprite_art.cjs" > /tmp/req0155_e2e_backfill.log 2>&1
echo "[content_admin_e2e] sprite backfill seeded ($(tail -1 /tmp/req0155_e2e_backfill.log))"

PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" bash "$WT/tools/e2e_run.sh" --config=e2e/contentadmin.config.ts
