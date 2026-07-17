#!/usr/bin/env bash
# tools/registry_first_e2e.sh -- REQ-0221: registry-first serving coverage
# that the default (files-backend) fleet structurally cannot provide.
#
# The e2e fleet runs STORAGE_BACKEND=files and the content registry is
# pg-only, so in ci.sh's default suite the registry is ALWAYS EMPTY and every
# registry-first code path -- the AUTHORITY path for po/si/tm serving since
# REQ-0178 -- is unreachable at the code level: the REQ-0178 serving drift
# shipped through a green ci.sh, and the REQ-0182b 409 guard could only ever
# SKIP there (it was the REQ-0234 audit run's sole skip).
#
# This harness closes that blind spot. Same rig family as
# tools/content_admin_e2e.sh (isolated pg namespace via HOME remap, this
# worktree's code), with two differences:
#   - the temp HOME is shaped like a FLEET WORKER's (w0/home/...) so the
#     spec-side path construction (client/e2e/e2e-env.ts) resolves into it;
#   - the registry is SEEDED (tools/seed_registry_e2e.cjs: one adopted
#     po_def) BEFORE the api boots, and the run FAILS if any test skips, so
#     "skips on CI" can never again be the norm for registry behaviour.
#
# Requires DATABASE_URL (source server/.env first) and a built client (web/).
set -euo pipefail
: "${DATABASE_URL:?source server/.env first (DATABASE_URL required)}"

WT="$(cd "$(dirname "$0")/.." && pwd)"

# REQ-0172: ports are DERIVED from this harness's REQ number, never hand-picked.
source "$(dirname "$0")/e2e_ports.sh" 0221

TMPROOT="$(mktemp -d)"
mkdir -p "$TMPROOT/w0/home"
ln -s "$WT" "$TMPROOT/w0/home/backpack_ragnarok"
HOMEDIR="$TMPROOT/w0/home"

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
  rm -rf "$TMPROOT"
}
trap cleanup EXIT
# Bash runs no EXIT trap when the shell dies on an uncaught fatal signal, so a
# SIGTERMed harness -- the exact abort gate 2 names -- used to leak everything.
# Convert the catchable ones into ordinary exits so the EXIT trap still runs.
trap 'exit 130' INT
trap 'exit 143' TERM

echo "[registry_first_e2e] api :$APIPORT  proxy :$PROXYPORT"

# Seed FIRST: the api builds its registry view lazily on first request, so a
# pre-boot seed is always visible without any cache invalidation dance.
HOME="$HOMEDIR" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" \
  node "$WT/tools/seed_registry_e2e.cjs"

HOME="$HOMEDIR" PORT="$APIPORT" STORAGE_BACKEND=pg DATABASE_URL="$DATABASE_URL" \
  setsid node "$WT/server/api.cjs" > /tmp/req0221_e2e_api.log 2>&1 &
PIDS+=($!)

# REQ-0234 (F7): headerless /api -> E2E_FLEET_BASE_PORT+0 = this api; /app +
# /preview are served from the worktree by the proxy itself (REQ-0217).
E2E_PROXY_PORT="$PROXYPORT" E2E_FLEET_BASE_PORT="$APIPORT" \
  setsid node "$WT/client/e2e/local-proxy.cjs" > /tmp/req0221_e2e_proxy.log 2>&1 &
PIDS+=($!)

for i in $(seq 1 80); do
  if curl -s -o /dev/null "http://127.0.0.1:$APIPORT/api/content" 2>/dev/null; then break; fi
  sleep 0.5
done
for i in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:$PROXYPORT/api/content" 2>/dev/null && curl -s -o /dev/null "http://127.0.0.1:$PROXYPORT/app/" 2>/dev/null; then break; fi
  sleep 0.5
done

# The whole point of this harness: the api must actually SERVE from the
# registry before the specs run, or the guard tests would silently skip.
REG_COUNT="$(curl -s "http://127.0.0.1:$APIPORT/api/content/dev/sources" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);console.log((s.items&&s.items.registry)||0)})')"
if [ "${REG_COUNT:-0}" -lt 1 ]; then
  echo "[registry_first_e2e] FATAL: registry serving count is '$REG_COUNT' after seeding -- the seed did not take (see /tmp/req0221_e2e_api.log)" >&2
  exit 1
fi
echo "[registry_first_e2e] registry serves $REG_COUNT item(s) -- running specs"

# REQ-0234 (F2): own serialization lock (nothing box-global is shared; the
# frozen box lock guards only the legacy shared-port path). Output is
# captured so a SKIP can be turned into a hard failure.
set +e
OUT="$(E2E_LOCK_FILE="${E2E_LOCK_FILE:-$HOME/.cache/backpack/e2e.req0221.lock}" \
  E2E_FLEET_ROOT="$TMPROOT" \
  PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" \
  bash "$WT/tools/e2e_run.sh" --config=e2e/registry.config.ts 2>&1)"
RC=$?
set -e
printf '%s\n' "$OUT"
if [ "$RC" -ne 0 ]; then exit "$RC"; fi
if printf '%s\n' "$OUT" | grep -qE '[0-9]+ skipped'; then
  echo "[registry_first_e2e] FATAL: a spec SKIPPED on the seeded pg harness -- registry coverage must never skip here (REQ-0221)" >&2
  exit 1
fi
