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

# REQ-0231 (gate 2, orphan half): every background service below is setsid'd
# into its OWN process group (leader pid == pgid), and cleanup kills exactly
# those GROUPS -- polite TERM, brief grace, then KILL for stragglers. Killing
# the recorded pid alone (the pre-2026-07-18 code) orphaned every child a
# service had spawned; the orphan survived and kept holding this REQ's decade.
# NEVER kill by name/pattern: on a shared box another session's harness must be
# untouchable (a contentadmin Playwright run was SIGKILLed cross-session on
# 2026-07-17 by exactly that kind of cleanup).
PIDS=()   # setsid group leaders: pid == pgid
cleanup() {
  for p in "${PIDS[@]:-}"; do kill -TERM -- "-$p" 2>/dev/null || true; done
  sleep 0.5
  for p in "${PIDS[@]:-}"; do kill -KILL -- "-$p" 2>/dev/null || true; done
  rm -rf "$TMPHOME" "$EXPORTDIR"
}
trap cleanup EXIT
# Do NOT add a `trap ... TERM/INT` here. Measured on this box 2026-07-18:
#   - bash ALREADY runs the EXIT trap when an untrapped SIGTERM kills the
#     shell, and it does so promptly -- so a trap buys nothing;
#   - a TERM trap actively HARMS: bash defers a trap until the current
#     foreground command returns, so a SIGTERMed harness ran its whole 30s
#     spec suite to completion, holding this REQ's decade the entire time,
#     and cleaned up only afterwards. Prompt death is the desired behaviour.

echo "[content_admin_e2e] api :$APIPORT  static :$STATICPORT  proxy :$PROXYPORT"

# REQ-0233: the family barrier restarts comfyui.service -- a LIVE, box-global
# systemd unit this hermetic harness has no business touching (REQ-0217: an e2e
# run never touches live services). Everything else here is already isolated
# (TMPHOME namespace, mock art route, temp model/export dirs); the barrier is the
# one thing that reached out. Off via the seam the REQ ships for exactly this.
HOME="$TMPHOME" PORT="$APIPORT" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" ALLOW_DEV_CLEAR=1 \
  CONTENT_EXPORT_ROOT="$EXPORTDIR" \
  ART_FAMILY_BARRIER=0 \
  setsid node "$WT/server/api.cjs" > /tmp/req0155_e2e_api.log 2>&1 &
PIDS+=($!)

# REQ-0234 (F7): the REQ-0217 local-proxy serves /app + /preview from the
# worktree ITSELF and routes headerless /api to E2E_FLEET_BASE_PORT+0 -- the
# old E2E_STATIC_PORT/E2E_API_PORT knobs no longer exist, so point the
# "fleet" base at this harness's single api (without this, /api fell through
# to the DEFAULT fleet base 8810 and every spec died on 502). The python
# static server this harness used to run is dropped with them: nothing
# routes to it any more, and its single-threaded accept loop was the
# goto-under-load flake source (REQ-0222).
E2E_PROXY_PORT="$PROXYPORT" E2E_FLEET_BASE_PORT="$APIPORT" \
  setsid node "$WT/client/e2e/local-proxy.cjs" > /tmp/req0155_e2e_proxy.log 2>&1 &
PIDS+=($!)

for i in $(seq 1 80); do
  if curl -s -o /dev/null "http://127.0.0.1:$APIPORT/api/content" 2>/dev/null; then break; fi
  sleep 0.5
done
for i in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:$PROXYPORT/api/content" 2>/dev/null && curl -s -o /dev/null "http://127.0.0.1:$PROXYPORT/app/" 2>/dev/null; then break; fi
  sleep 0.5
done

# REQ-0133: seed THIS isolated registry with the sprite-backfill (INSERT-only,
# adopted renders; no GPU/python -- Playwright rasterizes the SVG symbols) so the
# contentadmin wiring test can prove registry-first art vs the sprite fallback.
HOME="$TMPHOME" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" PLAYWRIGHT_BROWSERS_PATH="$PW_CACHE" \
  node "$WT/tools/backfill_sprite_art.cjs" > /tmp/req0155_e2e_backfill.log 2>&1
echo "[content_admin_e2e] sprite backfill seeded ($(tail -1 /tmp/req0155_e2e_backfill.log))"

# REQ-0234 (F2): this harness shares nothing box-global (own HOME remap, own
# REQ decade), so it takes its OWN serialization lock instead of the box lock
# -- which the REQ-0217 freeze daemon holds indefinitely and which only
# guards the legacy shared-port path. Same-harness runs still queue.
# REQ-0231 (gate 2): setsid the run into its OWN process group and record
# it, so an aborted harness reaps the whole playwright tree -- the orphan
# actually observed was a playwright worker, a grandchild no PIDS entry
# covered. Backgrounded only so the pid is knowable.
E2E_LOCK_FILE="${E2E_LOCK_FILE:-$HOME/.cache/backpack/e2e.0157.lock}" \
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" setsid bash "$WT/tools/e2e_run.sh" --config=e2e/contentadmin.config.ts &
RUN=$!
PIDS+=($RUN)
# `wait` propagates the real exit status, which ci.sh depends on.
wait "$RUN"
