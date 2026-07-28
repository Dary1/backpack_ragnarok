#!/usr/bin/env bash
# tools/artadmin_e2e.sh -- REQ-0156 G2: the artadmin queue UI, isolated.
#
# Bringup, isolation, readiness and the lock+run tail live in
# tools/e2e_harness.sh (REQ-0251). What is specific to THIS harness:
# ART_MOCK_DELAY_MS holds each mock job in flight ~1.5 s, which is the only
# reason the cancel spec can observe a PENDING queue entry at all -- an instant
# mock job would be done before the spec could look at it.
#
# The client must be BUILT into web/ first (cd client && pnpm run build).
# Requires DATABASE_URL (source server/.env first). Run:
#   set -a; source ~/backpack_ragnarok/server/.env; set +a; bash tools/artadmin_e2e.sh
source "$(dirname "$0")/e2e_harness.sh"

e2e_harness_name artadmin_e2e

VENV_PY="${ART_KIT_PYTHON:-/home/qtie/backpack_ragnarok/.venv/bin/python}"

e2e_harness_api_env \
  ALLOW_DEV_CLEAR=1 \
  ART_ROUTE_MOCK=1 \
  ART_MOCK_DELAY_MS="${ART_MOCK_DELAY_MS:-1500}" \
  ART_MODEL_DIR="$MODELDIR" \
  ART_EXPORT_ROOT="$EXPORTDIR" \
  ART_JOB_PYTHON="$VENV_PY" \
  ART_KIT_PYTHON="$VENV_PY" \
  ART_KIT_MATTE_METHOD=borderkey

e2e_harness_run --config=e2e/artadmin.config.ts
