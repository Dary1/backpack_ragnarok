#!/usr/bin/env bash
# tools/content_admin_e2e.sh -- REQ-0157 G4: the contentadmin UI, isolated.
#
# Bringup, isolation, readiness and the lock+run tail live in
# tools/e2e_harness.sh (REQ-0251). What is specific to THIS harness:
#   - CONTENT_EXPORT_ROOT to a temp dir so adoption export lands there and never
#     in content/; CONTENT_EXPORT_GIT stays unset (no git during e2e).
#   - No GPU and no python: the machine checks are pure Node subprocesses
#     spawned via the api's own node.
#   - The sprite backfill (below) is seeded AFTER the api is up.
#
# NOTE: ports and the lock no longer key off a REQ number (REQ-0323); the harness
# NAME "content_admin_e2e" is the single identifier used throughout.
#
# Requires DATABASE_URL (source server/.env first). Run:
#   set -a; source ~/backpack_ragnarok/server/.env; set +a; bash tools/content_admin_e2e.sh
source "$(dirname "$0")/e2e_harness.sh"

e2e_harness_name content_admin_e2e

e2e_harness_api_env \
  ALLOW_DEV_CLEAR=1 \
  CONTENT_EXPORT_ROOT="$EXPORTDIR"

# REQ-0133: seed THIS isolated registry with the sprite-backfill (INSERT-only,
# adopted renders; no GPU/python -- Playwright rasterizes the SVG symbols) so the
# contentadmin wiring test can prove registry-first art vs the sprite fallback.
e2e_h_after_ready() {
  local log=/tmp/content_admin_e2e_backfill.log
  e2e_harness_node node "$WT/tools/backfill_sprite_art.cjs" > "$log" 2>&1
  echo "[content_admin_e2e] sprite backfill seeded ($(tail -1 "$log"))"
}

e2e_harness_run --config=e2e/contentadmin.config.ts
