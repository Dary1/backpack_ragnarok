#!/usr/bin/env bash
# tools/ci.sh -- REQ-0047 (a): THE quality gate. Run before every commit
# that touches code. Everything must be green.
#
# Env toggles (for environments missing a dependency):
#   SKIP_PG=1      skip the Postgres-backend api_test pass (needs DATABASE_URL)
#   SKIP_CLIENT=1  skip client typecheck+build
#   SKIP_E2E=1     skip Playwright e2e (needs installed browsers + running services)
#
# REQ-0159: "CI GREEN" below means LITERALLY green. There is no accounted/
# remembered failure set any more -- if this script prints CI GREEN, every gate
# it ran passed. Do not re-introduce a "these reds are fine" convention: a red
# is either a real defect or a stale gate, and both must be fixed, not memorized.
set -euo pipefail
cd "$(dirname "$0")/.."

# REQ-0172: cheap + first. A harness port collision is invisible until the
# harnesses actually run (REQ-0159 lost a whole ci cycle to one: two harnesses had
# hand-picked the same band, and the second one's specs died on ECONNREFUSED). This
# gate makes the "ports are derived from the REQ number" rule machine-checked, and
# it costs milliseconds, so it goes in front of everything.
echo "==== [0/8] e2e harness port rule (REQ-0172) ===="
node tools/check_e2e_ports.cjs
echo "==== [1/7] sim tests ===="
node sim/tests/run.cjs
echo "==== [2/7] sim replay goldens (determinism contract) ===="
node sim/tests/goldens.cjs
echo "==== [2.5/7] S4 post-processor tests (REQ-0050) ===="
node sim/tests/s4_test.cjs
echo "==== [2.6/7] forecast<->sim ray parity (REQ-0057) ===="
node sim/tests/forecast_parity.cjs
echo "==== [2.7/7] REQ-0203 grave-legion gates (dialect / sim verbs / transpose / packs / additive promote) ===="
node sim/tests/req0203_grave_legion_test.cjs
echo "==== [2.75/7] REQ-0207 wildlands gates (dialect / transpose / packs / determinism / additive promote) ===="
node sim/tests/req0207_wildlands_test.cjs
echo "==== [2.76/7] REQ-0219 deepstone-legions gates (dialect / transpose / packs / determinism / additive promote) ===="
node sim/tests/req0219_deepstone_test.cjs
echo "==== [2.8/7] unit charge runtime (REQ-0200) ===="
node sim/tests/unit_charge_test.cjs
echo "==== [2.9/7] unit charge encounter fusion (REQ-0200) ===="
node sim/tests/unit_charge_encounter_test.cjs
echo "==== [3/7] mock-src engine tests ===="
node mock-src/tests/run.cjs
echo "==== [3.5/7] typecheck (server modules + shared, checkJs) ===="
if [ -x node_modules/.bin/tsc ]; then
  node_modules/.bin/tsc -p tsconfig.server.json
else
  echo "typescript missing -- run: pnpm install --frozen-lockfile" >&2; exit 1
fi
echo "==== [3.6/7] engine type-surface drift check ===="
node tools/check_engine_types.cjs
echo "==== [3.7/7] vocab self-test (verbs/triggers/render + range validation) ===="
node tools/self_test_vocab.cjs
echo "==== [3.8/7] unit + gacha-pack content gate (REQ-0170) ===="
node tools/check_units.cjs
echo "==== [3.9/7] units003 charge acceptance corpus (REQ-0200) ===="
node tools/units003_acceptance.cjs
echo "==== [4/7] server api tests (files backend) ===="
node server/tests/api_test.cjs
echo "==== [4.5/7] pg_sync worker crash-recovery (DB-free) ===="
node server/tests/pg_sync_test.cjs
echo "==== [4.6/7] artwork backfill mapping + adoption matcher (DB-free, REQ-0151) ===="
node server/tests/backfill_registry_test.cjs
echo "==== [4.65/7] content backfill mapping + skip rules (DB-free, REQ-0157) ===="
node server/tests/backfill_content_registry_test.cjs
echo "==== [4.655/7] content registry parity classifier (DB-free, REQ-0178) ===="
DATABASE_URL= node server/tests/verify_content_registry_parity_test.cjs
echo "==== [4.66/7] content-check schema dialects (DB-free, REQ-0161) ===="
node server/tests/content_checks_dialect_test.cjs
echo "==== [4.665/7] art-authoritative cell geometry: drift guard + seed<->derive transpose (DB-free, REQ-0188) ===="
node server/tests/content_checks_geometry_test.cjs
echo "==== [4.666/7] content-check unit_def deep validation (DB-free, REQ-0201) ===="
node server/tests/content_checks_unit_deep_test.cjs
echo "==== [4.67/7] pack biography aggregation + veteran luck (DB-free, REQ-0060) ===="
node server/tests/bio_test.cjs
echo "==== [4.68/7] bp-skin cosmetic-slot store (files backend, REQ-0126) ===="
node server/tests/bpskin_test.cjs
echo "==== [4.69/7] bp-skin seed migration on a copied profile fixture (DB-free, REQ-0126) ===="
node server/tests/bpskin_migration_test.cjs
echo "==== [4.71/7] UGC moderation verdict pipeline (DB-free, REQ-0144) ===="
MODPY="${ART_KIT_PYTHON:-$HOME/backpack_ragnarok/.venv/bin/python}"
if [ -x "$MODPY" ] && "$MODPY" -c 'import numpy,scipy,PIL' 2>/dev/null; then
  "$MODPY" tools/tests/moderation_gate_test.py
else
  echo "SKIP moderation_gate_test (needs a numpy/scipy/PIL python; set ART_KIT_PYTHON)"
fi
echo "==== [4.72/7] UGC moderation storage mappers/validators (DB-free, REQ-0144) ===="
DATABASE_URL= node server/tests/moderation_test.cjs
echo "==== [4.7/7] inspection kit golden vectors (REQ-0152, G3/G2 purity) ===="
KITPY="${ART_KIT_PYTHON:-$HOME/backpack_ragnarok/.venv/bin/python}"
if [ -x "$KITPY" ] && "$KITPY" -c 'import numpy,scipy,rembg' 2>/dev/null; then
  "$KITPY" tools/tests/inspect_kits_test.py
else
  echo "SKIP inspect_kits_test (needs a numpy/scipy/rembg python; set ART_KIT_PYTHON)"
fi
if [ "${SKIP_PG:-0}" != "1" ]; then
  echo "==== [5/7] server api tests (pg backend) ===="
  : "${DATABASE_URL:?SKIP_PG=1 or set DATABASE_URL}"
  STORAGE_BACKEND=pg node server/tests/api_test.cjs
  echo "==== [5.1/7] server artwork registry tests (pg backend, REQ-0151) ===="
  STORAGE_BACKEND=pg node server/tests/artwork_test.cjs
  echo "==== [5.15/7] artwork queue/cancel + list aggregates (pg backend, REQ-0156) ===="
  STORAGE_BACKEND=pg node server/tests/artqueue_test.cjs
  echo "==== [5.16/7] art queue family scheduling: gen/matte grouping + barrier (pg backend, REQ-0233) ===="
  ART_KIT_PYTHON="${ART_KIT_PYTHON:-$HOME/backpack_ragnarok/.venv/bin/python}" STORAGE_BACKEND=pg node server/tests/artfamily_test.cjs
  echo "==== [5.2/7] inspection kits (pg backend, REQ-0152 G1/G2 + auto-run) ===="
  ART_KIT_PYTHON="${ART_KIT_PYTHON:-$HOME/backpack_ragnarok/.venv/bin/python}" STORAGE_BACKEND=pg node server/tests/inspection_test.cjs
  echo "==== [5.3/7] content-data registry tests (pg backend, REQ-0155 G1/G2/G3 + flow) ===="
  STORAGE_BACKEND=pg node server/tests/content_test.cjs
  echo "==== [5.35/7] content-def list aggregates + recheck (pg backend, REQ-0157) ===="
  STORAGE_BACKEND=pg node server/tests/contentagg_test.cjs
  echo "==== [5.355/7] art-authoritative seed + derive no-op (pg backend, isolated ns, REQ-0188) ===="
  STORAGE_BACKEND=pg node server/tests/seed_derive_pg_test.cjs
  echo "==== [5.36/7] registry-first content serving (pg backend, REQ-0178) ===="
  STORAGE_BACKEND=pg node server/tests/content_serving_test.cjs
  echo "==== [5.37/7] registry-first SCHEDULE serving -- roll/sim authority path (pg backend, REQ-0176) ===="
  STORAGE_BACKEND=pg node server/tests/schedule_serving_test.cjs
  echo "==== [5.4/7] pack biography storage parity (pg backend, REQ-0060) ===="
  STORAGE_BACKEND=pg node server/tests/bio_test.cjs
  echo "==== [5.45/7] bp-skin cosmetic-slot store parity (pg backend, REQ-0126) ===="
  STORAGE_BACKEND=pg node server/tests/bpskin_test.cjs
  echo "==== [5.46/7] UGC moderation storage + appeal path (pg backend, REQ-0144) ===="
  STORAGE_BACKEND=pg node server/tests/moderation_test.cjs
else
  echo "==== [5/7] server api tests (pg backend) SKIPPED ===="
fi
if [ "${SKIP_CLIENT:-0}" != "1" ]; then
  # REQ-0125a: unit-icon resolution chain + G7 charge-ring geometry. Pure
  # functions driven from plain Node (vite ssrLoadModule, same rig as
  # check_sprites.mjs) -- no browser, no Pixi, so it is cheap and belongs in
  # front of the build. It also pins the NO-DIFF contract: the legacy glyph must
  # still land on exactly its old 44x44 @ (x-22,y-22) placement now that the
  # unit sprite goes through the shared contain-fit. Guarded by SKIP_CLIENT
  # because it needs client/node_modules (vite).
  echo "==== [5.6/7] client unit-icon chain + G7 ring (REQ-0125a) ===="
  (cd client && node scripts/check_unit_icon.mjs)
  # REQ-0142: link-trace query layer (client/src/board/linkTrace.ts) driven
  # against the REAL engine, with canvas_spec.md's own decoded example as the
  # golden. Pure functions, no browser, no Pixi -- same rig and the same reason
  # as the unit-icon gate above, so it sits beside it, in front of the build.
  echo "==== [5.7/7] client link-trace queries (REQ-0142) ===="
  (cd client && node scripts/check_link_trace.mjs)
  # REQ-0184: the monster_pack board's footprint resolution. A monster's cell size
  # lives in TWO vocabularies -- enemy/1 footprint [fh,fw] (what the sim places by)
  # and artwork shape {w,h} (what the art is generated at) -- and the board crosses
  # that transpose on every member. Pure functions, no browser: same vite rig and
  # the same reason as the two gates above, so it sits beside them.
  echo "==== [5.75/7] client monster_pack board footprints (REQ-0184) ===="
  (cd client && node scripts/check_pack_board.mjs)
  echo "==== [5.76/7] client monster_pack board -- batch-005 grave-legion resolves footprints from art (REQ-0203) ===="
  (cd client && node scripts/check_pack_board_grave_legion.mjs)
  echo "==== [5.77/7] client monster_pack board -- batch-006 wildlands resolves footprints from art (REQ-0207) ===="
  (cd client && node scripts/check_pack_board_wildlands.mjs)
  echo "==== [5.78/7] client monster_pack board -- batch-007 deepstone-legions resolves footprints from art (REQ-0219) ===="
  (cd client && node scripts/check_pack_board_deepstone.mjs)
  # REQ-0059: circuit-chimes deterministic event->note mapping (+ prefs).
  # Pure functions, no browser/Pixi/AudioContext -- same vite-ssrLoadModule
  # rig as the two gates above, so it sits beside them in front of the build.
  echo "==== [5.8/7] client circuit-chime mapping (REQ-0059) ===="
  (cd client && node scripts/check_chime_mapping.mjs)
  # REQ-0118c: Supabase auth wiring (session token accessor + Bearer header
  # assembly + OAuth redirect construction + guest/discord/link dispatch),
  # driven against the REAL modules with an injected fake supabase client.
  # Same vite-ssrLoadModule rig as the checks above; no browser, no live auth.
  echo "==== [5.9/7] client supabase-auth wiring (REQ-0118c) ===="
  (cd client && node scripts/check_auth.mjs)
  echo "==== [5.9b/7] client bp-skin resolver/registry/composite chain (REQ-0126) ===="
  (cd client && node scripts/check_bpskin.mjs)
  echo "==== [5.9c/7] bp-skin S3 validation harness -- deterministic composite machine gate (REQ-0126) ===="
  (cd client && node scripts/bpskin_harness.mjs)
  echo "==== [5.9d/7] overlay accessibility harness -- CVD sim + contrast, emits BS-G2 numbers (REQ-0143) ===="
  (cd client && node scripts/overlay_a11y_harness.mjs)
  echo "==== [6/7] client typecheck + build ===="
  (cd client && pnpm run build)
else
  echo "==== [6/7] client typecheck + build SKIPPED ===="
fi
# REQ-0159 (class C): the admin trio (artadmin/artinspect/contentadmin) is
# testIgnore'd out of the default suite (client/playwright.config.ts explains
# why: they need the isolated HOME-remap harnesses, and their opening
# dev/clear-all is 403'd by REQ-0156's ALLOW_DEV_CLEAR hardening in any
# non-harness run). They are covered HERE instead, as an explicit step, so
# retiring them from the default suite costs zero coverage.
#
# Needs BOTH a built client (the harnesses serve web/ statically) and
# DATABASE_URL (they run STORAGE_BACKEND=pg), hence the SKIP_CLIENT/SKIP_PG/
# SKIP_E2E guards. Each harness takes the same box lock via tools/e2e_run.sh,
# so they queue against each other and against the default suite -- never
# concurrent, never touching the live namespace.
if [ "${SKIP_E2E:-0}" != "1" ] && [ "${SKIP_PG:-0}" != "1" ] && [ "${SKIP_CLIENT:-0}" != "1" ]; then
  echo "==== [6.5/8] admin e2e harnesses (artadmin + artinspect + contentadmin, REQ-0156/0152/0157) ===="
  : "${DATABASE_URL:?SKIP_PG=1 or set DATABASE_URL}"
  bash tools/artadmin_e2e.sh
  bash tools/art_inspect_e2e.sh
  bash tools/content_admin_e2e.sh
else
  echo "==== [6.5/8] admin e2e harnesses SKIPPED ===="
fi
if [ "${SKIP_E2E:-0}" != "1" ]; then
  echo "==== [7/7] client e2e (default suite -- admin trio excluded, see above) ===="
  # REQ-0080: default to the local ingress proxy (localhost, ~40x less latency
  # than the public tunnel) and GPU-accelerated rendering (ANGLE/Vulkan -> the
  # box's real GPU instead of CPU SwiftShader). Both are overridable: force the
  # old path with PLAYWRIGHT_BASE_URL=https://backpack-dev.qtie.jp E2E_GPU=0.
  (cd client && PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:8803}" \
                E2E_GPU="${E2E_GPU:-1}" \
                E2E_PARALLEL="${E2E_PARALLEL:-4}" pnpm run e2e) # REQ-0083: 4 isolated-backend workers (E2E_PARALLEL=0 -> serial)
else
  echo "==== [7/7] client e2e SKIPPED ===="
fi
echo "CI GREEN"
