#!/usr/bin/env bash
# tools/registry_first_e2e.sh -- REQ-0221: registry-first serving coverage that
# the default (files-backend) fleet structurally cannot provide.
#
# The e2e fleet runs STORAGE_BACKEND=files and the content registry is pg-only,
# so in ci.sh's default suite the registry is ALWAYS EMPTY and every
# registry-first code path -- the AUTHORITY path for po/si/tm serving since
# REQ-0178 -- is unreachable at the code level: the REQ-0178 serving drift
# shipped through a green ci.sh, and the REQ-0182b 409 guard could only ever SKIP
# there (it was the REQ-0234 audit run's sole skip).
#
# Bringup and isolation live in tools/e2e_harness.sh (REQ-0251). What is specific
# to THIS harness is the two things that close that blind spot:
#   - the registry is SEEDED BEFORE the api boots (the api builds its registry
#     view lazily on first request, so a pre-boot seed is always visible with no
#     cache-invalidation dance);
#   - --no-skip: the run FAILS if any spec skips, so "skips on CI" can never
#     again become the norm for registry behaviour.
# It deliberately does NOT ask for ALLOW_DEV_CLEAR: it never clears anything.
#
# Requires DATABASE_URL (source server/.env first) and a built client (web/).
source "$(dirname "$0")/e2e_harness.sh"

e2e_harness_name registry_first_e2e

e2e_h_seed_preboot() {
  e2e_harness_node node "$WT/tools/seed_registry_e2e.cjs"
}

# The whole point of this harness: the api must actually SERVE from the registry
# before the specs run, or the guard tests would silently skip.
e2e_h_after_ready() {
  local count
  count="$(curl -s "http://127.0.0.1:$APIPORT/api/content/dev/sources" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);console.log((s.items&&s.items.registry)||0)})')"
  if [ "${count:-0}" -lt 1 ]; then
    echo "[registry_first_e2e] FATAL: registry serving count is '$count' after seeding -- the seed did not take (see /tmp/req0221_e2e_api.log)" >&2
    exit 1
  fi
  echo "[registry_first_e2e] registry serves $count item(s) -- running specs"
}

e2e_harness_run --no-skip --config=e2e/registry.config.ts
