#!/usr/bin/env bash
# tools/content_admin_e2e.sh -- REQ-0155 G4 isolated e2e bringup.
#
# Runs the contentadmin Playwright spec against an ISOLATED instance of THIS
# worktree's api + local proxy on the standard rig (tools/e2e_harness_lib.sh:
# HOME-remapped pg namespace, hermetic, never touches the live services or the
# live content rows). What is specific to this harness:
#   - CONTENT_EXPORT_ROOT=<temp> so adoption export lands in a temp dir, never
#     in content/, and no CONTENT_EXPORT_GIT (no git during e2e). No GPU, no
#     python: the machine checks are pure Node subprocesses spawned via the
#     api's own node;
#   - the sprite-backfill seed below;
#   - contentadmin.config.ts carries NO globalSetup/webServer.
#
# Requires DATABASE_URL in the environment (source server/.env first). Run:
#   set -a; source ~/backpack_ragnarok/server/.env; set +a; bash tools/content_admin_e2e.sh
set -euo pipefail

# REQ-0172: ports are DERIVED from this harness's REQ number, never hand-picked.
source "$(dirname "$0")/e2e_ports.sh" 0157
source "$(dirname "$0")/e2e_harness_lib.sh"

e2e_harness_init content_admin_e2e
e2e_harness_home

e2e_harness_mktemp EXPORTDIR

e2e_harness_say "api :$APIPORT  proxy :$PROXYPORT"

e2e_harness_start_api ALLOW_DEV_CLEAR=1 CONTENT_EXPORT_ROOT="$EXPORTDIR"
e2e_harness_start_proxy
e2e_harness_wait

# REQ-0133: seed THIS isolated registry with the sprite-backfill (INSERT-only,
# adopted renders; no GPU/python -- Playwright rasterizes the SVG symbols) so the
# contentadmin wiring test can prove registry-first art vs the sprite fallback.
BACKFILL_LOG="/tmp/req${E2E_REQ4}_e2e_backfill.log"
e2e_harness_node "$BACKFILL_LOG" -- "$WT/tools/backfill_sprite_art.cjs"
e2e_harness_say "sprite backfill seeded ($(tail -1 "$BACKFILL_LOG"))"

e2e_harness_run e2e/contentadmin.config.ts
