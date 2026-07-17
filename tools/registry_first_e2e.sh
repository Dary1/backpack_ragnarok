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
# This harness closes that blind spot. Standard rig (tools/e2e_harness_lib.sh),
# with the two things that make it different spelled out below:
#   - --fleet: the temp HOME is shaped like a FLEET WORKER's (w0/home/...) so
#     the spec-side path construction (client/e2e/e2e-env.ts) resolves into
#     this run's namespace rather than an unseeded /tmp/bp_e2e_workers tree;
#   - the registry is SEEDED (tools/seed_registry_e2e.cjs: one adopted po_def)
#     BEFORE the api boots, and --forbid-skip fails the run if any test skips,
#     so "skips on CI" can never again be the norm for registry behaviour.
#
# Requires DATABASE_URL (source server/.env first) and a built client (web/).
set -euo pipefail

# REQ-0172: ports are DERIVED from this harness's REQ number, never hand-picked.
source "$(dirname "$0")/e2e_ports.sh" 0221
source "$(dirname "$0")/e2e_harness_lib.sh"

e2e_harness_init registry_first_e2e
e2e_harness_home --fleet

e2e_harness_say "api :$APIPORT  proxy :$PROXYPORT"

# Seed FIRST: the api builds its registry view lazily on first request, so a
# pre-boot seed is always visible without any cache invalidation dance.
e2e_harness_node "/tmp/req${E2E_REQ4}_e2e_seed.log" -- "$WT/tools/seed_registry_e2e.cjs"
e2e_harness_say "seeded ($(tail -1 "/tmp/req${E2E_REQ4}_e2e_seed.log"))"

e2e_harness_start_api
e2e_harness_start_proxy
e2e_harness_wait

# The whole point of this harness: the api must actually SERVE from the
# registry before the specs run, or the guard tests would silently skip.
REG_COUNT="$(e2e_harness_api_json /api/content/dev/sources '(d.items&&d.items.registry)||0')"
if [ "${REG_COUNT:-0}" -lt 1 ]; then
  e2e_harness_fatal "registry serving count is '$REG_COUNT' after seeding -- the seed did not take (see $E2E_API_LOG)"
fi
e2e_harness_say "registry serves $REG_COUNT item(s) -- running specs"

# REQ-0221: a SKIP here is the failure mode this harness exists to prevent, and
# playwright reports it as success -- so it is turned into a hard failure.
e2e_harness_run e2e/registry.config.ts --forbid-skip
