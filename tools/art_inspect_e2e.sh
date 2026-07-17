#!/usr/bin/env bash
# tools/art_inspect_e2e.sh -- REQ-0152 G4 isolated e2e bringup.
#
# Runs the artinspect Playwright spec against an ISOLATED instance of THIS
# worktree's api + local proxy on the standard rig (tools/e2e_harness_lib.sh:
# HOME-remapped pg namespace, hermetic, never touches the live services or the
# live artwork rows). What is specific to this harness:
#   - ART_ROUTE_MOCK=1 (no GPU), ART_KIT_MATTE_METHOD=borderkey (fast,
#     model-free matte), ART_KIT_PYTHON=<project venv> (numpy/scipy/rembg for
#     the kits), and temp model/export dirs;
#   - artinspect.config.ts carries NO globalSetup/webServer.
#
# Requires DATABASE_URL in the environment (source server/.env first). Run:
#   set -a; source ~/backpack_ragnarok/server/.env; set +a; bash tools/art_inspect_e2e.sh
set -euo pipefail

# REQ-0172: ports are DERIVED from this harness's REQ number, never hand-picked.
source "$(dirname "$0")/e2e_ports.sh" 0152
source "$(dirname "$0")/e2e_harness_lib.sh"

e2e_harness_init art_inspect_e2e
e2e_harness_home

VENV_PY="${ART_KIT_PYTHON:-/home/qtie/backpack_ragnarok/.venv/bin/python}"
e2e_harness_mktemp MODELDIR
e2e_harness_mktemp EXPORTDIR
for f in flux-2-klein-4b-Q8_0.gguf qwen_3_4b.safetensors flux2-vae.safetensors; do echo standin > "$MODELDIR/$f"; done

e2e_harness_say "api :$APIPORT  proxy :$PROXYPORT"

e2e_harness_start_api ALLOW_DEV_CLEAR=1 ART_ROUTE_MOCK=1 \
  ART_MODEL_DIR="$MODELDIR" ART_EXPORT_ROOT="$EXPORTDIR" \
  ART_JOB_PYTHON="$VENV_PY" ART_KIT_PYTHON="$VENV_PY" ART_KIT_MATTE_METHOD=borderkey
e2e_harness_start_proxy
e2e_harness_wait

e2e_harness_run e2e/artinspect.config.ts
