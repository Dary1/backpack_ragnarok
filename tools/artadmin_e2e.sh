#!/usr/bin/env bash
# tools/artadmin_e2e.sh -- REQ-0156 G2: the artadmin queue UI, isolated.
#
# Bringup, isolation, readiness and the lock+run tail live in
# tools/e2e_harness.sh (REQ-0251). What is specific to THIS harness is ONE
# setting wearing two names:
#
#   ART_MOCK_DELAY_MS   holds each mock job in flight, which is the only reason
#                       the cancel spec can observe a PENDING queue entry at all
#                       -- an instant mock job would be done before the spec
#                       could look at it.
#   ART_ADMIN_POLL_MS   how often the console re-reads the queue and the
#                       selected artwork (REQ-0344; served to the browser via
#                       GET /api/config, production default 2000 ms).
#
# REQ-0344: the old pair was 1500/2000 and the 1500 was chosen AGAINST the 2000.
# A job had to outlive a poll gap to be seen, so the delay could never go below
# the poll -- and the poll was a production constant nobody could move. With the
# poll served at runtime the floor drops with it, and the two now move TOGETHER,
# here, in one block, which is the only reason it is safe to shorten either.
#
# What still bounds ART_MOCK_DELAY_MS from below: artadmin.spec.ts:231 queues 5
# jobs and cancels the LAST pending one, so the window it must click inside is
# 4 x ART_MOCK_DELAY_MS = 3.0 s at 750 ms. Measured need: ~0.5 s (one poll plus
# innerText plus the click). Do not shrink this without re-running the
# deliberate-regression check recorded in REQ-0344 -- a delay too small turns a
# real pending->cancel regression into a green run.
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
  ART_MOCK_DELAY_MS="${ART_MOCK_DELAY_MS:-750}" \
  ART_ADMIN_POLL_MS="${ART_ADMIN_POLL_MS:-250}" \
  ART_MODEL_DIR="$MODELDIR" \
  ART_EXPORT_ROOT="$EXPORTDIR" \
  ART_JOB_PYTHON="$VENV_PY" \
  ART_KIT_PYTHON="$VENV_PY" \
  ART_KIT_MATTE_METHOD=borderkey

e2e_harness_run --config=e2e/artadmin.config.ts
