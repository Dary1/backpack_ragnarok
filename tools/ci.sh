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
#
# ---------------------------------------------------------------------------
# REQ-0238: SERVING-MODE COVERAGE MAP -- which stage proves which backend.
#
# Read this before adding, moving or "fixing" any registry-related gate. The
# stages below run in TWO serving modes; a test placed in the wrong one proves
# nothing and fails silently by skipping. Nothing named this split, and the
# cost of that has now been paid three times: REQ-0221 was filed asserting
# "green ci.sh proves nothing about registry-first behaviour" when (B) already
# existed; a second agent re-derived the same false conclusion from the same
# tree; and a third duplicated work already merged. The coverage was never the
# defect -- its legibility was.
#
# (A) FILES mode -- the registry is EMPTY BY DESIGN. computeRegistryData
#     (server/lib/content.cjs) is pg-only, so with STORAGE_BACKEND=files there
#     is no registry at all and every registry-first path is unreachable at the
#     code level. Deliberate: this is the file-serving contract's own coverage.
#       [4/7]    server/tests/api_test.cjs   (files backend)
#       [7/7]    the e2e fleet -- tools/e2e_fleet.cjs spawns every worker
#                STORAGE_BACKEND=files DATABASE_URL='' .
#     => A test needing an ADOPTED def CANNOT live here; it will skip or
#        vacuously pass. A skip in [7/7] is therefore not automatically a hole:
#        check (B) before "fixing" one. Do not teach the fleet pg -- that
#        rebuilds (B).
#
# (B) PG registry-first -- an adopted def is SEEDED, so the authority path for
#     po/si/tm/units/packs actually fires. Gated by SKIP_PG only (CI does not
#     set it): MANDATORY on every real CI run.
#       [5/7]    api_test.cjs (pg)
#       [5.355]  seed_derive_pg_test.cjs      art-authoritative seed/derive
#       [5.36]   content_serving_test.cjs     REQ-0178 gate D: registry-first
#                serving, file fallback, kind filter, cache invalidation, source
#                accounting, parity classifier, and REQ-0182b's
#                registryServedKindFor predicate (adopted -> kind; empty -> null)
#       [5.37]   schedule_serving_test.cjs    REQ-0176: roll/sim authority
#       [6.5/8]  content_admin_e2e.sh         ROUTE level, pg + isolated ns:
#                contentadmin.spec.ts:884 seeds an adopted po_def and asserts
#                REQ-0182b's 409 + registry_kind + edit_at, UNCONDITIONALLY;
#                :903 covers the relocated grant-to-warehouse control.
#       [6.6/8]  registry_first_e2e.sh        REQ-0221: runs the FLEET-SHAPED
#                spec (dex-admin.spec.ts) against a seeded pg registry so its
#                409 test runs instead of skipping, and FAILS the run if any
#                spec skips.
#
# NOTE -- [6.5] and [6.6] BOTH assert the REQ-0182b 409. That overlap is
# intentional but is NOT a licence for a third: [6.5] proves the assertion
# (and predates [6.6]); [6.6] proves the fleet-shaped spec does not skip.
# Verified 2026-07-17 by injecting `if (false && servedKind)` into
# server/routes/admin.cjs: [6.5] alone went 28 passed -> 1 failed at
# contentadmin.spec.ts:884, and the run wrote content/live/live_items.json
# behind the ledger -- the exact drift REQ-0182b guards. So a re-enabled legacy
# PUT is caught even with [6.6] removed.
#
# => New registry-first coverage belongs in (B): serving/unit semantics in
#    [5.x]; route or UI behaviour needing an adopted def in [6.5]. Add a new
#    harness only if neither fits -- and say here which mode it proves.
# ---------------------------------------------------------------------------
set -euo pipefail

# REQ-0231: ONE ci run per box at a time. The e2e box lock only ever
# serialized the Playwright phase; everything else (sim suites, pg tests,
# tsc, vite build, chromium warmup) ran concurrently across agent sessions
# and saturated the box (2026-07-17: load 13.7, sshd unresponsive ~40 min,
# a mid-CI reboot). Sessions had converged on an ad-hoc `flock
# /tmp/bpk_ci.lock` convention enforced nowhere; it is machine-enforced
# HERE instead: the whole run holds one exclusive lock. Seams:
#   CI_LOCK_NONBLOCK=1  fail fast (exit 75) instead of queueing
#   CI_LOCK_WAIT=secs   queue timeout (default 7200)
#   CI_LOCK_FILE=path   override (tests)
CI_LOCK_FILE="${CI_LOCK_FILE:-$HOME/.cache/backpack/ci.box.lock}"
if [ "${CI_BOX_LOCK_HELD:-0}" != "1" ]; then
  mkdir -p "$(dirname "$CI_LOCK_FILE")"
  if ! flock -n "$CI_LOCK_FILE" true 2>/dev/null; then
    echo "[ci-lock] $CI_LOCK_FILE is HELD (holder pid(s):$(fuser "$CI_LOCK_FILE" 2>/dev/null || echo ' unknown')) -- queueing (CI_LOCK_NONBLOCK=1 to fail fast)" >&2
  fi
  if [ "${CI_LOCK_NONBLOCK:-0}" = "1" ]; then
    exec env CI_BOX_LOCK_HELD=1 flock -n -E 75 "$CI_LOCK_FILE" bash "$0" "$@"
  fi
  exec env CI_BOX_LOCK_HELD=1 flock -w "${CI_LOCK_WAIT:-7200}" -E 75 "$CI_LOCK_FILE" bash "$0" "$@"
fi

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
echo "==== [2.65/7] dungeon roller determinism + structure (REQ-0185) ===="
node sim/tests/dungeon_roll_test.cjs
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
echo "==== [2.95/7] REQ-0269 balance sim harness (determinism / fixture matchup / OP-item + injection flags) ===="
node sim/tests/balance_sim_test.cjs
echo "==== [2.96/7] REQ-0272 candidate one-door gate (validate/static/dynamic; known-good pass, over-band static flag, in-band sim flag, junk validate) ===="
node sim/tests/candidate_gate_test.cjs
echo "==== [3/7] shared engine tests ===="
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
echo "==== [3.95/7] REQ-0268 corpus normalizer + stats tests (stdlib python3) ===="
python3 tools/tests/corpus_test.py
echo "==== [3.96/7] REQ-0268 stat-band lint self-test (corpus dps bands; ci runs self-test only) ===="
node tools/check_stat_bands.cjs --self-test
echo "==== [3.97/7] REQ-0270 corpus browser generator test (stdlib python3) ===="
python3 tools/tests/corpus_browser_test.py
echo "==== [3.98/7] REQ-0272 gen_context context-pack builder test (stdlib python3) ===="
python3 tools/tests/gen_context_test.py
echo "==== [3.99/7] REQ-0275 enemy-side stat bands test (stdlib python3) ===="
python3 tools/tests/enemy_bands_test.py
echo "==== [3.995/7] REQ-0293 enemy level-scaling coverage gate (self-test + live total-coverage) ===="
node tools/check_scaling_coverage.cjs --self-test
node tools/check_scaling_coverage.cjs --gate
echo "==== [3.996/7] REQ-0298 monster-pack formation-fill inspection (self-test + HARD --gate: every monster_pack >= 30% fill; REQ-0303 flipped from advisory) ===="
node tools/inspect_pack_formation.cjs --self-test
node tools/inspect_pack_formation.cjs --gate
echo "==== [4/7] server api tests (files backend) ===="
node server/tests/api_test.cjs
echo "==== [4.05/7] REQ-0240 presentation-pacing unit gates (paceEvents floors/coalesce/clamp/legacy passthrough/roster) ===="
node server/tests/pacing_test.cjs
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
echo "==== [4.685/7] per-profile skin selection store (files backend, REQ-0266) ===="
node server/tests/skin_prefs_test.cjs
echo "==== [4.69/7] bp-skin seed migration on a copied profile fixture (DB-free, REQ-0126) ===="
node server/tests/bpskin_migration_test.cjs
echo "==== [4.695/7] e2e profile redirect -- dev-fallback isolation (DB-free, REQ-0214) ===="
node server/tests/e2e_profile_redirect_test.cjs
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
  # REQ-0266: files+pg parity for the skin selection, same posture as [4.685]/[5.45].
  # DEPLOY ORDER: this step needs server/migrations/024_skin_prefs.sql applied (it is
  # HAND-applied, like every migration since 001) -- until then it fails with
  # "relation skin_prefs does not exist", which is a pending migration, not a defect.
  # It is deliberately NOT wrapped in a skip: a gate that quietly passes on a table
  # that does not exist proves nothing, and REQ-0159 forbids a remembered-red convention.
  echo "==== [5.455/7] per-profile skin selection store parity (pg backend, REQ-0266) ===="
  STORAGE_BACKEND=pg node server/tests/skin_prefs_test.cjs
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
  # REQ-0273: rolled-BP first-fit vs the real engine -- pins the bug-2 producer
  # fix (a claim must never MOVE an unrelated free PO; post-claim state must be
  # engine-legal on every page, unit cells clear). Same vite rig as above.
  echo "==== [5.9e/7] client claim placement legality (REQ-0273) ===="
  (cd client && node scripts/check_placement.mjs)
  # REQ-0273: per-PO footprint outline geometry -- boundary loops (interior on
  # the left), collinear merge, touching-corner and hole handling, exact 3px
  # rectilinear inset. Pure module, no Pixi import by construction.
  echo "==== [5.9f/7] client PO outline geometry (REQ-0273) ===="
  (cd client && node scripts/check_po_outline.mjs)
  # REQ-0286: squad compositor cell->px convention (client/src/board/squadCellGeom.ts).
  # Pins the board-canon 1-indexed (c-1)*cellPx mapping so the /schedule monitor's
  # squad boxes stay flush + PO-on-cell (guards the REQ-0283 +1-cell skew). Pure
  # arithmetic, no browser/Pixi -- same vite-ssrLoadModule rig as check_po_outline.
  echo "==== [5.9g/7] client squad-cell geometry convention (REQ-0286) ===="
  (cd client && node scripts/check_squad_cell_geom.mjs)
  echo "==== [6/7] client typecheck + build ===="
  (cd client && pnpm run build)
  # REQ-0278: the committed-bundle path had no machine check that a worktree's
  # freshly built web/app actually carries the Supabase env. A worktree missing the
  # gitignored, main-only client/.env.local builds a degraded bundle (sign-in "not
  # configured", REQ-0118c) that this same-tree build + the e2e proxy cannot see --
  # the trap that bit the REQ-0266 deploy (42238f8). Present env-file -> assert the
  # marker is in the built bundle; absent -> report not-applicable WITH a reason.
  echo "==== [6.1/7] client bundle Supabase-env tripwire (REQ-0278) ===="
  bash tools/check_bundle_env.sh
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
  # REQ-0221: the default fleet is files-backed and the registry is pg-only,
  # so registry-first serving (the AUTHORITY path for po/si/tm since
  # REQ-0178) is unreachable in [7/7] -- the REQ-0178 drift shipped through a
  # green ci.sh, and the REQ-0182b 409 guard could only skip. This stage
  # boots an isolated pg api SEEDED with one adopted def and runs the
  # registry-guard specs, failing if any of them skips.
  echo "==== [6.6/8] registry-first serving e2e (pg, seeded adopted def, REQ-0221) ===="
  bash tools/registry_first_e2e.sh
else
  echo "==== [6.5/8] admin e2e harnesses SKIPPED ===="
fi
if [ "${SKIP_E2E:-0}" != "1" ]; then
  # REQ-0234 (F2, implements REQ-0225's default-flip): from a req-NNNN
  # REQ-0238: [7/7] is FILES-mode -- registry EMPTY by design, so no
  # registry-first path fires here. See the SERVING-MODE COVERAGE MAP at
  # the top of this file before adding registry coverage or "fixing" a skip.
  # worktree the e2e stage runs SCOPED by default -- its own fleet root and
  # REQ-decade ports, sharing nothing box-global, so it neither queues
  # against other sessions nor touches the box lock the REQ-0217 freeze
  # daemon holds. The main checkout (no req- branch) and any run with an
  # explicit PLAYWRIGHT_BASE_URL keep the legacy path unchanged.
  E2E_REQ="${E2E_REQ:-$(git rev-parse --abbrev-ref HEAD 2>/dev/null | sed -n 's/^req-\([0-9]\{4\}\).*/\1/p')}"
  if [ -n "$E2E_REQ" ] && [ -z "${PLAYWRIGHT_BASE_URL:-}" ]; then
    echo "==== [7/7] client e2e (SCOPED hermetic run, REQ-$E2E_REQ decade -- admin trio excluded, see above) ===="
    source tools/e2e_ports.sh "$E2E_REQ"
    (cd client && E2E_FLEET_ROOT="/tmp/bp_e2e_workers_req${E2E_REQ}" \
                  E2E_PROXY_PORT="$PROXYPORT" \
                  E2E_FLEET_BASE_PORT="$((E2E_PORT_BASE + 4))" \
                  PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" \
                  E2E_GPU="${E2E_GPU:-1}" \
                  E2E_PARALLEL="${E2E_PARALLEL:-4}" pnpm exec playwright test)
  else
    echo "==== [7/7] client e2e (default suite -- admin trio excluded, see above) ===="
    # REQ-0080: default to the local ingress proxy (localhost, ~40x less latency
    # than the public tunnel) and GPU-accelerated rendering (ANGLE/Vulkan -> the
    # box's real GPU instead of CPU SwiftShader). Both are overridable: force the
    # old path with PLAYWRIGHT_BASE_URL=https://backpack-dev.qtie.jp E2E_GPU=0.
    (cd client && PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:8803}" \
                  E2E_GPU="${E2E_GPU:-1}" \
                  E2E_PARALLEL="${E2E_PARALLEL:-4}" pnpm run e2e) # REQ-0083: 4 isolated-backend workers (E2E_PARALLEL=0 -> serial)
  fi
else
  echo "==== [7/7] client e2e SKIPPED ===="
fi
echo "CI GREEN"
