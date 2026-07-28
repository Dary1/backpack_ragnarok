#!/usr/bin/env bash
# tools/art_inspect_e2e.sh -- REQ-0152 G4: the artwork-inspection kits, isolated.
#
# Bringup, isolation, readiness and the lock+run tail all live in
# tools/e2e_harness.sh (REQ-0251). Only what makes THIS harness different is here:
# the kits are the one rig in the family that needs a real python -- numpy/scipy/
# rembg out of the project venv -- while the art ROUTE stays mocked (no GPU, no
# real weights). Matte method is pinned to borderkey: model-free and fast, so a
# gate run does not wait on rembg's model download.
#
# Requires DATABASE_URL (source server/.env first). Run:
#   set -a; source ~/backpack_ragnarok/server/.env; set +a; bash tools/art_inspect_e2e.sh
source "$(dirname "$0")/e2e_harness.sh"

e2e_harness_name art_inspect_e2e

VENV_PY="${ART_KIT_PYTHON:-/home/qtie/backpack_ragnarok/.venv/bin/python}"

e2e_harness_api_env \
  ALLOW_DEV_CLEAR=1 \
  ART_ROUTE_MOCK=1 \
  ART_MODEL_DIR="$MODELDIR" \
  ART_EXPORT_ROOT="$EXPORTDIR" \
  ART_JOB_PYTHON="$VENV_PY" \
  ART_KIT_PYTHON="$VENV_PY" \
  ART_KIT_MATTE_METHOD=borderkey

e2e_harness_run --config=e2e/artinspect.config.ts
