#!/usr/bin/env bash
# tools/artadmin_e2e.sh -- REQ-0156 gate G2 isolated e2e bringup.
#
# The artinspect harness's twin (tools/art_inspect_e2e.sh), pointed at
# e2e/artadmin.config.ts on its own REQ decade. Runs on the standard rig
# (tools/e2e_harness_lib.sh: HOME-remapped pg namespace, hermetic, never
# touches the live services or the live artwork rows). What is specific here:
#   - ART_ROUTE_MOCK=1 (no GPU) plus ART_MOCK_DELAY_MS, which holds each mock
#     job in flight ~1.5 s so the cancel spec can observe pending queue
#     entries (REQ-0156);
#   - artadmin.config.ts carries NO globalSetup/webServer.
#
# The client must be BUILT into web/ first (cd client && pnpm run build).
# Requires DATABASE_URL in the environment (source server/.env first). Run:
#   set -a; source ~/backpack_ragnarok/server/.env; set +a; bash tools/artadmin_e2e.sh
set -euo pipefail

# REQ-0172: ports are DERIVED from this harness's REQ number, never hand-picked.
source "$(dirname "$0")/e2e_ports.sh" 0156
source "$(dirname "$0")/e2e_harness_lib.sh"

e2e_harness_init artadmin_e2e
e2e_harness_home

VENV_PY="${ART_KIT_PYTHON:-/home/qtie/backpack_ragnarok/.venv/bin/python}"
e2e_harness_mktemp MODELDIR
e2e_harness_mktemp EXPORTDIR
for f in flux-2-klein-4b-Q8_0.gguf qwen_3_4b.safetensors flux2-vae.safetensors; do echo standin > "$MODELDIR/$f"; done

e2e_harness_say "api :$APIPORT  proxy :$PROXYPORT"

e2e_harness_start_api ALLOW_DEV_CLEAR=1 ART_ROUTE_MOCK=1 \
  ART_MOCK_DELAY_MS="${ART_MOCK_DELAY_MS:-1500}" \
  ART_MODEL_DIR="$MODELDIR" ART_EXPORT_ROOT="$EXPORTDIR" \
  ART_JOB_PYTHON="$VENV_PY" ART_KIT_PYTHON="$VENV_PY" ART_KIT_MATTE_METHOD=borderkey
e2e_harness_start_proxy
e2e_harness_wait

e2e_harness_run e2e/artadmin.config.ts
