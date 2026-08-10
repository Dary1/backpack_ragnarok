#!/usr/bin/env bash
# tools/ci.sh -- REQ-0047 (a): THE quality gate. Run before every commit
# that touches code. Everything must be green.
#
# Env toggles (for environments missing a dependency):
#   SKIP_PG=1      skip the Postgres-backend api_test pass (needs DATABASE_URL)
#   SKIP_CLIENT=1  skip client typecheck+build
#   SKIP_E2E=1     skip Playwright e2e (needs installed browsers + running services)
#
# REQ-0339: the two e2e families are also SCOPED from the diff -- see the
# "computed test scope" block below. CI_SCOPE=both forces the full gate.
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
#       [6.7/8]  signed_out_e2e.sh            REQ-0365: NOT a registry stage --
#                listed here only so this map stays the whole [6.x] inventory.
#                It is FILES mode like (A), with one worker seeded
#                dev_mode:false so /api/me 401s and the signed-out client path
#                is reachable at all. Needs no pg.
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

# REQ-0343: wall clock for the CI RECEIPT written at the bottom. Started AFTER
# the flock re-exec above on purpose -- time spent queueing behind another
# session's run is not gate work, and a receipt that claimed it would be a lie
# about how long the gate takes.
CI_RUN_T0=$(date +%s)

# ---- REQ-0339: computed test scope ------------------------------------
# The two e2e families are 357 s of a 439 s run and each is irrelevant to
# changes on the other surface. Which of them a run needs is DERIVED from
# `git diff` by tools/ci_scope.sh -- it is never asked, never a flag someone
# picks, and never a judgement call, because the failure mode being guarded
# against is drift in exactly that judgement. Read tools/ci_scope.sh's header
# for the table and the fail-closed rule; anything it cannot classify comes
# back as `both`.
#
# SEAMS (both can only ever ADD work, never remove it):
#   CI_SCOPE=both            force the full gate -- what tools/release.sh does
#   CI_SCOPE=admin|public    force one family (debugging this mechanism)
#   CI_SCOPE_BASE=<ref>      compare against something other than master
if [ -n "${CI_SCOPE:-}" ]; then
  case "$CI_SCOPE" in
    admin|public|both) ;;
    *) echo "[ci-scope] CI_SCOPE='$CI_SCOPE' is not one of admin|public|both" >&2; exit 2 ;;
  esac
  CI_SCOPE_SRC="forced by CI_SCOPE env"
else
  CI_SCOPE="$(bash tools/ci_scope.sh "${CI_SCOPE_BASE:-master}")"
  CI_SCOPE_SRC="computed from git diff vs ${CI_SCOPE_BASE:-master}"
fi
case "$CI_SCOPE" in
  both)   echo "[ci-scope] admin+public (both) -- $CI_SCOPE_SRC: admin e2e AND client e2e will run" ;;
  admin)  echo "[ci-scope] admin -- $CI_SCOPE_SRC: [6.5/8]+[6.6/8] run, [7/7] SKIPPED" ;;
  public) echo "[ci-scope] public -- $CI_SCOPE_SRC: [7/7] runs, [6.5/8]+[6.6/8] SKIPPED" ;;
esac
scope_has() { [ "$CI_SCOPE" = both ] || [ "$CI_SCOPE" = "$1" ]; }

# ---- REQ-0334: stage timing -------------------------------------------
# Every gate below announced itself with a bare echo and no clock, so "ci.sh is
# slow" could not be answered with a number -- only by watching which banner it
# was parked on. stage() prints the SAME banner and closes the previous stage
# with its wall time; the run ends with them sorted slowest-first. Wall, not
# cpu: a stage may fork workers, and wall is what the person waiting pays.
# (coreutils here ignores the %3N precision modifier and emits full
# nanoseconds, so divide rather than trusting the format string.)
# CI_STAGE_TIMINGS=<path> also appends "<ms>\t<label>" so runs can be compared
# over time rather than only within one run.
__stage_t0=$(( $(date +%s%N) / 1000000 )); __stage_name=""; __stage_rows=""
__stage_close() {
  [ -z "$__stage_name" ] && return 0
  local now ms
  now=$(( $(date +%s%N) / 1000000 )); ms=$(( now - __stage_t0 ))
  __stage_rows="${__stage_rows}${ms}	${__stage_name}"$'\n'
  if [ -n "${CI_STAGE_TIMINGS:-}" ]; then
    printf '%s\t%s\n' "$ms" "$__stage_name" >> "$CI_STAGE_TIMINGS"
  fi
  return 0
}
stage() {
  __stage_close
  __stage_name="$1"; __stage_t0=$(( $(date +%s%N) / 1000000 ))
  printf '==== %s ====\n' "$1"
}
stage_summary() {
  __stage_close; __stage_name=""
  printf '\n==== stage timings (wall, slowest first) ====\n'
  printf '%s' "$__stage_rows" | sort -rn | awk -F'\t' \
    '{ t += $1; printf "  %8.1fs  %s\n", $1/1000, $2 } END { printf "  %8.1fs  TOTAL\n", t/1000 }'
}


# REQ-0323: ports now come from the rental port desk (tools/port_desk.sh) at run
# time, so there is no derived-port rule to machine-check here any more.

# REQ-0339: this stage is the whole point of the scoping REQ. The classification
# table in tools/ci_scope.sh is hand-written, and a hand-written map of a moving
# tree rots silently -- the failure would be a stage quietly not running, which
# is the one failure a green gate cannot show you. --selftest asserts the table
# against the tree (top-level inventory, client/src and server/routes
# inventories + which of them are admin, every e2e spec classifies, the
# playwright testIgnore set == the specs classified admin, and every spec an
# isolated harness actually drives is admin-or-both). It is first because a red
# here invalidates every scoping decision made above it. ~0.3 s.
stage "[0.5/7] ci scope table self-check + classifier tests (REQ-0339)"
bash tools/ci_scope.sh --selftest
python3 tools/tests/ci_scope_test.py
# REQ-0343: the push gate rests on the receipt this run writes at the bottom and
# on the classifier above, and its own failure mode is the familiar one -- a
# check that silently stops checking. [0.6] proves, on every run, that a receipt
# binds to a tree and that the hook REJECTS: no receipt, wrong tree, and a
# public receipt under an admin-touching diff are all asserted to be rejected,
# against a real bare repo built in a temp dir. ~2 s, no network, no services.
stage "[0.6/7] push-gate receipt + pre-receive hook tests (REQ-0343)"
bash tools/ci_receipt.sh --selftest
python3 tools/tests/push_gate_test.py
stage "[1/7] sim tests"
node sim/tests/run.cjs
stage "[2/7] sim replay goldens (determinism contract)"
node sim/tests/goldens.cjs
stage "[2.5/7] S4 post-processor tests (REQ-0050)"
node sim/tests/s4_test.cjs
stage "[2.65/7] dungeon roller determinism + structure (REQ-0185)"
node sim/tests/dungeon_roll_test.cjs
stage "[2.7/7] REQ-0203 grave-legion gates (dialect / sim verbs / transpose / packs / additive promote)"
node sim/tests/req0203_grave_legion_test.cjs
stage "[2.75/7] REQ-0207 wildlands gates (dialect / transpose / packs / determinism / additive promote)"
node sim/tests/req0207_wildlands_test.cjs
stage "[2.76/7] REQ-0219 deepstone-legions gates (dialect / transpose / packs / determinism / additive promote)"
node sim/tests/req0219_deepstone_test.cjs
stage "[2.8/7] unit charge runtime (REQ-0200)"
node sim/tests/unit_charge_test.cjs
stage "[2.9/7] unit charge encounter fusion (REQ-0200)"
node sim/tests/unit_charge_encounter_test.cjs
stage "[2.95/7] REQ-0269 balance sim harness (determinism / fixture matchup / OP-item + injection flags)"
node sim/tests/balance_sim_test.cjs
stage "[2.96/7] REQ-0272 candidate one-door gate (validate/static/dynamic; known-good pass, over-band static flag, in-band sim flag, junk validate)"
node sim/tests/candidate_gate_test.cjs
stage "[3/7] shared engine tests"
node mock-src/tests/run.cjs
# REQ-0310: the client-authoritative player actions (gacha roll, warehouse
# claim, fresh-profile seed) as pure state transitions in shared/. G4(b) and
# G4(d) are the currency-loss and item-loss goldens -- a red there is a release
# blocker, not a test bug. Dependency-free, so it sits with the other shared
# suites in front of the typecheck.
stage "[3.2/7] shared player actions (REQ-0310 G4/G5 goldens)"
node shared/tests/player_actions.cjs
stage "[3.5/7] typecheck (server modules + shared, checkJs)"
if [ -x node_modules/.bin/tsc ]; then
  node_modules/.bin/tsc -p tsconfig.server.json
else
  echo "typescript missing -- run: pnpm install --frozen-lockfile" >&2; exit 1
fi
stage "[3.6/7] engine type-surface drift check"
node tools/check_engine_types.cjs
stage "[3.7/7] vocab self-test (verbs/triggers/render + range validation)"
node tools/self_test_vocab.cjs
stage "[3.8/7] unit + gacha-pack content gate (REQ-0170)"
node tools/check_units.cjs
stage "[3.9/7] units003 charge acceptance corpus (REQ-0200)"
node tools/units003_acceptance.cjs
stage "[3.95/7] REQ-0268 corpus normalizer + stats tests (stdlib python3)"
python3 tools/tests/corpus_test.py
stage "[3.96/7] REQ-0268 stat-band lint self-test (corpus dps bands; ci runs self-test only)"
node tools/check_stat_bands.cjs --self-test
stage "[3.97/7] REQ-0270 corpus browser generator test (stdlib python3)"
python3 tools/tests/corpus_browser_test.py
stage "[3.98/7] REQ-0272 gen_context context-pack builder test (stdlib python3)"
python3 tools/tests/gen_context_test.py
stage "[3.99/7] REQ-0275 enemy-side stat bands test (stdlib python3)"
python3 tools/tests/enemy_bands_test.py
stage "[3.995/7] REQ-0293 enemy level-scaling coverage gate (self-test + live total-coverage)"
node tools/check_scaling_coverage.cjs --self-test
node tools/check_scaling_coverage.cjs --gate
stage "[3.996/7] REQ-0298 monster-pack formation-fill inspection (self-test + HARD --gate: every monster_pack >= 30% fill; REQ-0303 flipped from advisory)"
node tools/inspect_pack_formation.cjs --self-test
node tools/inspect_pack_formation.cjs --gate
stage "[3.997/7] REQ-0306 predeploy powerLevel recalibration (self-test, DB-free) + calibration-drift ADVISORY"
node tools/predeploy_recalibrate_powerlevel.cjs --self-test
# ADVISORY ONLY (report-only, REQ-0306): dirty = level-affecting content changed
# since the last calibration IN THIS CHECKOUT (--check is checkout-relative;
# = live only on the main checkout @ master). HARD enforcement lives in the
# predeploy script (content-deploy runbook step, docs/llm_managed/
# content_deploy_runbook.md), NOT here: a hard ci gate would block WIP branches
# that edited content before recalibrating. "Flip to hard gate" = delete the
# || echo guard below.
node tools/autobalance_pack_powerlevel.cjs --check || echo "[advisory] powerLevel drift -- run: node tools/predeploy_recalibrate_powerlevel.cjs (REQ-0306)"
stage "[4/7] server api tests (files backend)"
node server/tests/api_test.cjs
stage "[4.05/7] REQ-0240 presentation-pacing unit gates (paceEvents floors/coalesce/clamp/legacy passthrough/roster)"
node server/tests/pacing_test.cjs
stage "[4.5/7] pg_sync worker crash-recovery (DB-free)"
node server/tests/pg_sync_test.cjs
stage "[4.6/7] artwork backfill mapping + adoption matcher (DB-free, REQ-0151)"
node server/tests/backfill_registry_test.cjs
stage "[4.65/7] content backfill mapping + skip rules (DB-free, REQ-0157)"
node server/tests/backfill_content_registry_test.cjs
stage "[4.655/7] content registry parity classifier (DB-free, REQ-0178)"
DATABASE_URL= node server/tests/verify_content_registry_parity_test.cjs
stage "[4.656/7] kind-list agreement gate (DB-free, REQ-0352)"
DATABASE_URL= node server/tests/kind_lists_agree_test.cjs
stage "[4.657/7] serving check + STALE + advisory overall (DB-free, REQ-0354)"
DATABASE_URL= node server/tests/serving_check_test.cjs
stage "[4.66/7] content-check schema dialects (DB-free, REQ-0161)"
node server/tests/content_checks_dialect_test.cjs
stage "[4.665/7] art-authoritative cell geometry: drift guard + seed<->derive transpose (DB-free, REQ-0188)"
node server/tests/content_checks_geometry_test.cjs
stage "[4.666/7] content-check unit_def deep validation (DB-free, REQ-0201)"
node server/tests/content_checks_unit_deep_test.cjs
stage "[4.67/7] pack biography aggregation + veteran luck (DB-free, REQ-0060)"
node server/tests/bio_test.cjs
stage "[4.68/7] bp-skin cosmetic-slot store (files backend, REQ-0126)"
node server/tests/bpskin_test.cjs
stage "[4.685/7] per-profile skin selection store (files backend, REQ-0266)"
node server/tests/skin_prefs_test.cjs
stage "[4.69/7] bp-skin seed migration on a copied profile fixture (DB-free, REQ-0126)"
node server/tests/bpskin_migration_test.cjs
stage "[4.695/7] e2e profile redirect -- dev-fallback isolation (DB-free, REQ-0214)"
node server/tests/e2e_profile_redirect_test.cjs
stage "[4.697/7] registry overlay: one snapshot, per-kind isolation, name-set subset (DB-free, REQ-0348)"
# DB-free although it sets STORAGE_BACKEND=pg in-process: it stubs
# storage.resolveAdoptedContentData, so no DATABASE_URL and no pg round trip.
# Belongs in (A) FILES mode per the coverage map above -- it pins the snapshot
# RULES, not any adopted content, so it is exactly the kind of test that must NOT
# be moved into the pg block where it would prove less.
node server/tests/registry_overlay_test.cjs
stage "[4.71/7] UGC moderation verdict pipeline (DB-free, REQ-0144)"
MODPY="${ART_KIT_PYTHON:-$HOME/backpack_ragnarok/.venv/bin/python}"
if [ -x "$MODPY" ] && "$MODPY" -c 'import numpy,scipy,PIL' 2>/dev/null; then
  "$MODPY" tools/tests/moderation_gate_test.py
else
  echo "SKIP moderation_gate_test (needs a numpy/scipy/PIL python; set ART_KIT_PYTHON)"
fi
stage "[4.72/7] UGC moderation storage mappers/validators (DB-free, REQ-0144)"
DATABASE_URL= node server/tests/moderation_test.cjs
stage "[4.7/7] inspection kit golden vectors (REQ-0152, G3/G2 purity)"
KITPY="${ART_KIT_PYTHON:-$HOME/backpack_ragnarok/.venv/bin/python}"
if [ -x "$KITPY" ] && "$KITPY" -c 'import numpy,scipy,rembg' 2>/dev/null; then
  "$KITPY" tools/tests/inspect_kits_test.py
else
  echo "SKIP inspect_kits_test (needs a numpy/scipy/rembg python; set ART_KIT_PYTHON)"
fi
if [ "${SKIP_PG:-0}" != "1" ]; then
  stage "[5/7] server api tests (pg backend)"
  : "${DATABASE_URL:?SKIP_PG=1 or set DATABASE_URL}"
  STORAGE_BACKEND=pg node server/tests/api_test.cjs
  stage "[5.1/7] server artwork registry tests (pg backend, REQ-0151)"
  STORAGE_BACKEND=pg node server/tests/artwork_test.cjs
  stage "[5.15/7] artwork queue/cancel + list aggregates (pg backend, REQ-0156)"
  STORAGE_BACKEND=pg node server/tests/artqueue_test.cjs
  stage "[5.16/7] art queue family scheduling: gen/matte grouping + barrier (pg backend, REQ-0233)"
  ART_KIT_PYTHON="${ART_KIT_PYTHON:-$HOME/backpack_ragnarok/.venv/bin/python}" STORAGE_BACKEND=pg node server/tests/artfamily_test.cjs
  stage "[5.2/7] inspection kits (pg backend, REQ-0152 G1/G2 + auto-run)"
  ART_KIT_PYTHON="${ART_KIT_PYTHON:-$HOME/backpack_ragnarok/.venv/bin/python}" STORAGE_BACKEND=pg node server/tests/inspection_test.cjs
  stage "[5.3/7] content-data registry tests (pg backend, REQ-0155 G1/G2/G3 + flow)"
  STORAGE_BACKEND=pg node server/tests/content_test.cjs
  stage "[5.35/7] content-def list aggregates + recheck (pg backend, REQ-0157)"
  STORAGE_BACKEND=pg node server/tests/contentagg_test.cjs
  stage "[5.355/7] art-authoritative seed + derive no-op (pg backend, isolated ns, REQ-0188)"
  STORAGE_BACKEND=pg node server/tests/seed_derive_pg_test.cjs
  stage "[5.36/7] registry-first content serving (pg backend, REQ-0178)"
  STORAGE_BACKEND=pg node server/tests/content_serving_test.cjs
  stage "[5.37/7] registry-first SCHEDULE serving -- roll/sim authority path (pg backend, REQ-0176)"
  STORAGE_BACKEND=pg node server/tests/schedule_serving_test.cjs
  stage "[5.4/7] pack biography storage parity (pg backend, REQ-0060)"
  STORAGE_BACKEND=pg node server/tests/bio_test.cjs
  stage "[5.45/7] bp-skin cosmetic-slot store parity (pg backend, REQ-0126)"
  STORAGE_BACKEND=pg node server/tests/bpskin_test.cjs
  # REQ-0266: files+pg parity for the skin selection, same posture as [4.685]/[5.45].
  # DEPLOY ORDER: this step needs server/migrations/024_skin_prefs.sql applied (it is
  # HAND-applied, like every migration since 001) -- until then it fails with
  # "relation skin_prefs does not exist", which is a pending migration, not a defect.
  # It is deliberately NOT wrapped in a skip: a gate that quietly passes on a table
  # that does not exist proves nothing, and REQ-0159 forbids a remembered-red convention.
  stage "[5.455/7] per-profile skin selection store parity (pg backend, REQ-0266)"
  STORAGE_BACKEND=pg node server/tests/skin_prefs_test.cjs
  stage "[5.46/7] UGC moderation storage + appeal path (pg backend, REQ-0144)"
  STORAGE_BACKEND=pg node server/tests/moderation_test.cjs
else
  stage "[5/7] server api tests (pg backend) SKIPPED"
fi
if [ "${SKIP_CLIENT:-0}" != "1" ]; then
  # REQ-0125a: unit-icon resolution chain + G7 charge-ring geometry. Pure
  # functions driven from plain Node (vite ssrLoadModule, same rig as
  # check_sprites.mjs) -- no browser, no Pixi, so it is cheap and belongs in
  # front of the build. It also pins the NO-DIFF contract: the legacy glyph must
  # still land on exactly its old 44x44 @ (x-22,y-22) placement now that the
  # unit sprite goes through the shared contain-fit. Guarded by SKIP_CLIENT
  # because it needs client/node_modules (vite).
  stage "[5.6/7] client unit-icon chain + G7 ring (REQ-0125a)"
  (cd client && node scripts/check_unit_icon.mjs)
  # REQ-0142: link-trace query layer (client/src/board/linkTrace.ts) driven
  # against the REAL engine, with canvas_spec.md's own decoded example as the
  # golden. Pure functions, no browser, no Pixi -- same rig and the same reason
  # as the unit-icon gate above, so it sits beside it, in front of the build.
  stage "[5.7/7] client link-trace queries (REQ-0142)"
  (cd client && node scripts/check_link_trace.mjs)
  # REQ-0184: the monster_pack board's footprint resolution. A monster's cell size
  # lives in TWO vocabularies -- enemy/1 footprint [fh,fw] (what the sim places by)
  # and artwork shape {w,h} (what the art is generated at) -- and the board crosses
  # that transpose on every member. Pure functions, no browser: same vite rig and
  # the same reason as the two gates above, so it sits beside them.
  stage "[5.75/7] client monster_pack board footprints (REQ-0184)"
  (cd client && node scripts/check_pack_board.mjs)
  stage "[5.76/7] client monster_pack board -- batch-005 grave-legion resolves footprints from art (REQ-0203)"
  (cd client && node scripts/check_pack_board_grave_legion.mjs)
  stage "[5.77/7] client monster_pack board -- batch-006 wildlands resolves footprints from art (REQ-0207)"
  (cd client && node scripts/check_pack_board_wildlands.mjs)
  stage "[5.78/7] client monster_pack board -- batch-007 deepstone-legions resolves footprints from art (REQ-0219)"
  (cd client && node scripts/check_pack_board_deepstone.mjs)
  # REQ-0059: circuit-chimes deterministic event->note mapping (+ prefs).
  # Pure functions, no browser/Pixi/AudioContext -- same vite-ssrLoadModule
  # rig as the two gates above, so it sits beside them in front of the build.
  stage "[5.8/7] client circuit-chime mapping (REQ-0059)"
  (cd client && node scripts/check_chime_mapping.mjs)
  # REQ-0370: audio mixer prefs normaliser (pure module, same ssr rig).
  stage "[5.85/7] client audio mixer prefs (REQ-0370)"
  (cd client && node scripts/check_audio_prefs.mjs)
  # REQ-0118c: Supabase auth wiring (session token accessor + Bearer header
  # assembly + OAuth redirect construction + guest/discord/link dispatch),
  # driven against the REAL modules with an injected fake supabase client.
  # Same vite-ssrLoadModule rig as the checks above; no browser, no live auth.
  stage "[5.9/7] client supabase-auth wiring (REQ-0118c)"
  (cd client && node scripts/check_auth.mjs)
  stage "[5.9b/7] client bp-skin resolver/registry/composite chain (REQ-0126)"
  (cd client && node scripts/check_bpskin.mjs)
  stage "[5.9c/7] bp-skin S3 validation harness -- deterministic composite machine gate (REQ-0126)"
  (cd client && node scripts/bpskin_harness.mjs)
  stage "[5.9d/7] overlay accessibility harness -- CVD sim + contrast, emits BS-G2 numbers (REQ-0143)"
  (cd client && node scripts/overlay_a11y_harness.mjs)
  # REQ-0273: rolled-BP first-fit vs the real engine -- pins the bug-2 producer
  # fix (a claim must never MOVE an unrelated free PO; post-claim state must be
  # engine-legal on every page, unit cells clear). Same vite rig as above.
  stage "[5.9e/7] client claim placement legality (REQ-0273)"
  (cd client && node scripts/check_placement.mjs)
  # REQ-0273: per-PO footprint outline geometry -- boundary loops (interior on
  # the left), collinear merge, touching-corner and hole handling, exact 3px
  # rectilinear inset. Pure module, no Pixi import by construction.
  stage "[5.9f/7] client PO outline geometry (REQ-0273)"
  (cd client && node scripts/check_po_outline.mjs)
  # REQ-0286: squad compositor cell->px convention (client/src/board/squadCellGeom.ts).
  # Pins the board-canon 1-indexed (c-1)*cellPx mapping so the /schedule monitor's
  # squad boxes stay flush + PO-on-cell (guards the REQ-0283 +1-cell skew). Pure
  # arithmetic, no browser/Pixi -- same vite-ssrLoadModule rig as check_po_outline.
  stage "[5.9g/7] client squad-cell geometry convention (REQ-0286)"
  (cd client && node scripts/check_squad_cell_geom.mjs)
  # REQ-0367: the single-step undo store driven against the REAL engine and
  # REAL store modules (arm -> mutate -> undo -> key-order-insensitive deep
  # equal; refused-rotate arm discipline; excluded-op clear; one-step slot
  # consumption). Same vite-ssrLoadModule rig as check_auth.mjs above.
  stage "[5.9h/7] client single-step undo store (REQ-0367)"
  (cd client && node scripts/check_undo.mjs)
  # REQ-0341: there is no [6.1/7] bundle-env tripwire any more, and there is no
  # env to provision either. The client no longer reads VITE_SUPABASE_* at all
  # (client/src/auth/client.ts fetches GET /api/config at runtime), so web/app is
  # a pure function of client/src and cannot vary with client/.env.local. What
  # replaced the tripwire is a SOURCE-level check inside [5.9/7]'s check_auth.mjs
  # -- "no client/src file reads a VITE_SUPABASE_* value" -- plus
  # client/e2e/runtime-config.spec.ts, which asserts in a real browser that the
  # served bundle carries no such value AND still reaches a configured sign-in UI.
  stage "[6/7] client typecheck + build"
  (cd client && pnpm run build)
else
  stage "[6/7] client typecheck + build SKIPPED"
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
if [ "${SKIP_E2E:-0}" != "1" ] && [ "${SKIP_PG:-0}" != "1" ] && [ "${SKIP_CLIENT:-0}" != "1" ] \
   && scope_has admin; then
  stage "[6.5/8] admin e2e harnesses (artadmin + artinspect + contentadmin, REQ-0156/0152/0157)"
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
  stage "[6.6/8] registry-first serving e2e (pg, seeded adopted def, REQ-0221)"
  bash tools/registry_first_e2e.sh
elif [ "${SKIP_E2E:-0}" != "1" ] && [ "${SKIP_PG:-0}" != "1" ] && [ "${SKIP_CLIENT:-0}" != "1" ]; then
  # REQ-0339: not a skip flag -- the DIFF says this run touches no admin-surface
  # path. Both banners are printed so "which stages ran" stays greppable.
  stage "[6.5/8] admin e2e harnesses SKIPPED -- ci-scope is '$CI_SCOPE' (no admin-surface path in the diff; CI_SCOPE=both forces)"
  stage "[6.6/8] registry-first serving e2e SKIPPED -- ci-scope is '$CI_SCOPE' (same reason)"
else
  stage "[6.5/8] admin e2e harnesses SKIPPED"
fi
# REQ-0365: [6.7/8] the SIGNED-OUT app (dev_mode OFF).
#
# Not foldable into [7/7]: every worker of that fleet seeds dev_mode:true, which
# is what the other 45 spec files rely on for their identity (they present no
# credential at all). tools/signed_out_e2e.sh boots the same hermetic rig with
# E2E_DEV_MODE_OFF=0 for one worker, so /api/me actually 401s and the signed-out
# client path is reachable.
#
# Grouped with the PUBLIC scope, not admin: it needs no pg and no registry, and
# every path it covers (store/boot.ts, App.tsx, LandingPage, Settings) is
# client-public. It is guarded by SKIP_E2E/SKIP_CLIENT only -- deliberately NOT
# by SKIP_PG, unlike [6.5]/[6.6].
if [ "${SKIP_E2E:-0}" != "1" ] && [ "${SKIP_CLIENT:-0}" != "1" ] && scope_has public; then
  stage "[6.7/8] signed-out e2e (dev_mode OFF fleet worker, REQ-0365)"
  bash tools/signed_out_e2e.sh
elif [ "${SKIP_E2E:-0}" != "1" ] && [ "${SKIP_CLIENT:-0}" != "1" ]; then
  stage "[6.7/8] signed-out e2e SKIPPED -- ci-scope is '$CI_SCOPE' (no public-surface path in the diff)"
else
  stage "[6.7/8] signed-out e2e SKIPPED"
fi
if [ "${SKIP_E2E:-0}" != "1" ] && scope_has public; then
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
    stage "[7/7] client e2e (SCOPED hermetic run, REQ-$E2E_REQ decade -- admin trio excluded, see above)"
    source tools/e2e_ports.sh
    (cd client && E2E_FLEET_ROOT="/tmp/bp_e2e_workers_req${E2E_REQ}" \
                  E2E_PROXY_PORT="$PROXYPORT" \
                  E2E_FLEET_BASE_PORT="$((E2E_PORT_BASE + 4))" \
                  PLAYWRIGHT_BASE_URL="http://127.0.0.1:$PROXYPORT" \
                  E2E_GPU="${E2E_GPU:-1}" \
                  E2E_PARALLEL="${E2E_PARALLEL:-4}" pnpm exec playwright test)
  else
    stage "[7/7] client e2e (default suite -- admin trio excluded, see above)"
    # REQ-0080: default to the local ingress proxy (localhost, ~40x less latency
    # than the public tunnel) and GPU-accelerated rendering (ANGLE/Vulkan -> the
    # box's real GPU instead of CPU SwiftShader). Both are overridable: force the
    # old path with PLAYWRIGHT_BASE_URL=https://backpack-dev.qtie.jp E2E_GPU=0.
    # REQ-0342: the E2E_GPU=1 below is now REDUNDANT (GPU is the config default)
    # and is kept only so this line still reads as the explicit statement of
    # intent it always was. Removing it would change nothing.
    (cd client && PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://127.0.0.1:8803}" \
                  E2E_GPU="${E2E_GPU:-1}" \
                  E2E_PARALLEL="${E2E_PARALLEL:-4}" pnpm run e2e) # REQ-0083: 4 isolated-backend workers (E2E_PARALLEL=0 -> serial)
  fi
elif [ "${SKIP_E2E:-0}" != "1" ]; then
  # REQ-0339: not SKIP_E2E -- the DIFF says this run touches no public-surface
  # path. tools/release.sh always forces CI_SCOPE=both, so nothing ever leaves
  # the repo on a scoped run.
  stage "[7/7] client e2e SKIPPED -- ci-scope is '$CI_SCOPE' (no public-surface path in the diff; CI_SCOPE=both forces)"
else
  stage "[7/7] client e2e SKIPPED"
fi
stage_summary
echo "CI GREEN"

# ---- REQ-0343: the CI receipt -----------------------------------------
# Everything above this line decides whether the gate is green. This block only
# RECORDS that it was, for tools/pre_receive_gate.sh to check at push time. It
# is deliberately below `echo "CI GREEN"` so that nothing here can change what
# CI GREEN means, and so the receipt banner is the last thing on screen.
#
# Two refusals, both of which are the point of the mechanism rather than
# exceptions to it:
#
#   * A run with SKIP_PG / SKIP_CLIENT / SKIP_E2E set prints CI GREEN while
#     having skipped whole families of gates. Those flags exist for environments
#     missing a dependency; they must never be able to mint a receipt, or the
#     push gate degrades to `SKIP_E2E=1 tools/ci.sh && git push`, which is worse
#     than no gate because it looks like one. Note that a SCOPE-skipped stage is
#     NOT this case: scope is computed from the diff and the receipt carries it,
#     so the push gate re-derives the requirement and checks it.
#   * A failure to write (no origin, external disk unmounted) is LOUD but NOT
#     fatal. The verdict of a test gate must not depend on a USB disk being
#     plugged in; the consequence is simply that the push gate will reject the
#     tree until a receipt exists, which is the correct and visible outcome.
CI_RUN_SECS=$(( $(date +%s) - CI_RUN_T0 ))
if [ "${SKIP_PG:-0}" = "1" ] || [ "${SKIP_CLIENT:-0}" = "1" ] || [ "${SKIP_E2E:-0}" = "1" ]; then
  echo "[ci-receipt] NOT WRITTEN -- this run set SKIP_PG/SKIP_CLIENT/SKIP_E2E, so CI GREEN does not mean the whole gate ran. The push gate will reject this tree." >&2
else
  bash tools/ci_receipt.sh write "$CI_SCOPE" "$CI_RUN_SECS" tools/ci.sh \
    || echo "[ci-receipt] NOT WRITTEN (see above). CI is still GREEN; the push gate will reject this tree until a receipt exists." >&2
fi
