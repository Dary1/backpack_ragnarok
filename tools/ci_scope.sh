#!/usr/bin/env bash
# tools/ci_scope.sh -- REQ-0339. Decide, FROM THE DIFF ALONE, which e2e family
# tools/ci.sh must run: the ADMIN surface, the PUBLIC surface, or both.
#
# WHY THIS IS COMPUTED AND NEVER ASKED
# -----------------------------------------------------------------------------
# ci.sh is 42 stages / ~439 s wall, and three stages are 84% of that:
#   [7/7]   client e2e, default suite (199 tests)              182 s
#   [6.5/8] admin e2e trio (artadmin+artinspect+contentadmin)  165 s
#   [6.6/8] registry-first e2e                                  10 s
# A change that does not touch the admin surface pays 176 s (40%) for admin
# coverage it cannot possibly have broken, and vice versa.
#
# The obvious "fix" -- let whoever runs the gate say which tests are relevant --
# is the one thing this must NOT do. The failure mode is not that an agent
# circumvents a hard block; it is that an agent asked to JUDGE relevance drifts,
# a little, every time, in the direction of the cheaper answer. So there is no
# prompt, no flag to choose, and no judgement call: the scope is a FUNCTION of
# `git diff`, evaluated here, and ci.sh only reads the answer. The one seam is
# CI_SCOPE=both, which can only ever ADD work.
#
# FAIL CLOSED. A path that matches no rule below counts as BOTH and is printed
# to stderr. A table that has silently stopped describing the tree must cost
# time, not coverage.
#
# THE HONEST LIMIT. This is an admin/public BIT, nothing finer. ~18 of the 40
# specs drive the PixiJS canvas by pixel coordinates and therefore have no
# static dependency edge to any source directory at all, so per-spec scoping is
# not derivable from the source tree. See docs/REQ/built/REQ-0339-*.md S6.
#
# USAGE
#   tools/ci_scope.sh [<base-ref>]            -> prints admin | public | both
#   tools/ci_scope.sh --explain [<base-ref>]  -> per-path classification first
#   tools/ci_scope.sh --selftest              -> fail if the table has drifted
#
# The classification is the union of `git diff --name-only <base>...HEAD` and
# the uncommitted working tree (`git status --porcelain`), because running the
# gate before committing is normal here and a dirty tree must be classified too.
set -euo pipefail

# REQ-0343: --classify-stdin classifies a path list read from STDIN and touches
# no git repository at all. That mode exists so the push gate
# (tools/pre_receive_gate.sh) can run THIS FILE, extracted from the tree being
# pushed, inside a BARE repo -- which has no worktree to cd into and no HEAD
# meaning what HEAD means here. Every other mode reads the worktree, so it still
# needs the cd. It must be the FIRST argument.
CI_SCOPE_STDIN=0
case "${1:-}" in
  --classify-stdin) CI_SCOPE_STDIN=1 ;;
  *) cd "$(dirname "$0")/.." ;;
esac

# =============================================================================
# THE TABLE. Ordered; FIRST MATCH WINS. Read it as four blocks: ignored, admin,
# shared(both), public, then the deliberate catch-alls.
# =============================================================================
ci_scope_classify() {
  case "$1" in
    # ---- ignored: nothing under these is an input to any gate ---------------
    # docs/ is prose; web/ is entirely build output or static docroots (app/
    # from the client build -- which ci.sh rebuilds at [6/7] from client/src
    # before any e2e runs -- preview/ from tools/build_preview.py, mock/ from
    # mock-src/build.py, redesign/ static mockups); data/ is gitignored runtime
    # state; *.md anywhere is documentation.
    docs/*|web/*|data/*|*.md) echo ignored ;;

    # ---- admin surface -----------------------------------------------------
    # Measured, not assumed: resolving every data-testid the three admin specs
    # query back to the file that defines it lands 37/12/42 hits almost entirely
    # in client/src/artadmin + client/src/contentadmin (2-3 crossover).
    client/src/artadmin/*|client/src/contentadmin/*) echo admin ;;
    client/e2e/artadmin.spec.ts|client/e2e/artinspect.spec.ts|client/e2e/contentadmin.spec.ts) echo admin ;;
    client/e2e/artadmin.config.ts|client/e2e/artinspect.config.ts|client/e2e/contentadmin.config.ts|client/e2e/registry.config.ts) echo admin ;;
    server/routes/art.cjs|server/routes/content.cjs|server/routes/admin.cjs) echo admin ;;
    server/services/art_*|server/services/kit_registry.cjs) echo admin ;;
    content/*) echo admin ;;
    tools/artadmin_e2e.sh|tools/art_inspect_e2e.sh|tools/content_admin_e2e.sh|tools/registry_first_e2e.sh) echo admin ;;
    tools/art_*|tools/inspect_*) echo admin ;;
    # REQ-0339 refinement: seeds the adopted def that [6.6] exists to exercise,
    # and nothing else reads it.
    tools/seed_registry_e2e.cjs) echo admin ;;

    # ---- shared: named e2e scaffolding that BOTH families load -------------
    # REQ-0339 refinement, and the reason a hand-written table needs the
    # self-check below. dex-admin.spec.ts is a member of the DEFAULT suite AND
    # the spec that client/e2e/registry.config.ts drives in [6.6/8]; it imports
    # helpers.ts and e2e-env.ts, and tools/e2e_harness.sh shapes the isolated
    # HOME specifically so e2e-env.ts's path construction resolves into it.
    # Classifying any of the three "public" would silently drop [6.6].
    client/e2e/dex-admin.spec.ts|client/e2e/helpers.ts|client/e2e/e2e-env.ts) echo both ;;
    client/playwright.config.ts) echo both ;;

    # ---- shared: server machinery both route families sit on ---------------
    server/storage/*|server/lib/*|server/tests/*|server/migrations/*) echo both ;;
    server/api.cjs|server/admin.cjs|server/schedule.cjs) echo both ;;

    # ---- shared: the gate's own machinery ----------------------------------
    tools/ci.sh|tools/ci_scope.sh|tools/release.sh|tools/e2e_*) echo both ;;

    # ---- public surface ----------------------------------------------------
    client/src/*) echo public ;;
    client/e2e/*) echo public ;;
    server/routes/*) echo public ;;
    sim/*|shared/*|mock-src/*|bot/*) echo public ;;

    # ---- deliberate catch-alls, all conservative (both) --------------------
    # These are NOT fail-closed fallout; they are decisions. Leaving them to
    # fall through would keep the unclassified counter permanently non-zero,
    # and a warning that is always on is a warning nobody reads.
    #   server/services/  -- the shared business layer under BOTH route
    #                        families (content_checks/content_export feed the
    #                        admin routes AND public serving).
    #   server/           -- router/players/storage*.cjs/pg_sync/tool_*: the
    #                        persistence chokepoint and its neighbours.
    #   client/           -- scripts/ (the [5.6]-[5.9g] gates), vite + tsconfig
    #                        + package.json: build inputs for the whole client.
    #   tools/            -- generators and content gates; blast radius is not
    #                        confined to one surface.
    #   types/ deploy/ and the root build files -- infrastructure.
    server/services/*) echo both ;;
    server/*) echo both ;;
    client/*) echo both ;;
    tools/*) echo both ;;
    types/*|deploy/*) echo both ;;
    package.json|pnpm-lock.yaml|tsconfig.server.json|.gitignore) echo both ;;

    # ---- fail closed -------------------------------------------------------
    *) echo unclassified ;;
  esac
}

# =============================================================================
# Declared inventories. The self-check compares these against the real tree in
# BOTH directions, so adding a directory without classifying it turns the build
# red instead of silently inheriting a catch-all.
# =============================================================================
KNOWN_TOPLEVEL='.gitignore bot client content deploy docs mock-src package.json
pnpm-lock.yaml server shared sim tools tsconfig.server.json types web'

KNOWN_CLIENT_SRC='a11y api artadmin audio auth board canvas contentadmin dex engine
guide i18n landing lib market notify ragnarok render schedule sortie store styles
theme warehouse'
KNOWN_CLIENT_SRC_ADMIN='artadmin contentadmin'

KNOWN_SERVER_ROUTES='admin.cjs art.cjs bio.cjs content.cjs dex.cjs dismantle.cjs
market.cjs me.cjs notifications.cjs profile.cjs public.cjs ragnarok.cjs
schedule.cjs skins.cjs starter.cjs warehouse.cjs workshop.cjs'
KNOWN_SERVER_ROUTES_ADMIN='admin.cjs art.cjs content.cjs'

# REQ-0365: the THIRD reason a spec can be testIgnore'd out of the default
# suite. Until now there was exactly one -- "only an admin harness can run it"
# -- and S5 below encoded that as `testIgnore set == admin specs`. signed-out
# .spec.ts breaks that equality without breaking the intent: it is PUBLIC
# surface (store/boot.ts, App.tsx, LandingPage, Settings) but it needs a fleet
# worker seeded dev_mode:false, and every worker of the default fleet seeds
# dev_mode:true because the other 45 specs rely on that fallback for their
# identity. So it runs under its own harness (tools/signed_out_e2e.sh, ci.sh
# [6.7/8]) while staying public for scope purposes -- an admin-only diff must
# NOT run it, and a public-only diff MUST.
#
# Declared here rather than inferred so the invariant stays checkable: this
# list is the ONLY licence to be in testIgnore without being admin, and S5/S6
# below both read it. Adding a name here is a deliberate act, not a side effect
# of editing playwright.config.ts.
KNOWN_HARNESS_ONLY_PUBLIC_SPECS='signed-out.spec.ts'

# =============================================================================
# Path collection
# =============================================================================
# git status --porcelain lines are "XY PATH"; a rename is "R  old -> new" and we
# want the new name. Paths containing spaces would be quoted -- this repo has
# none, and a quoted path simply fails to match a rule and therefore fails
# CLOSED, which is the safe direction.
ci_scope_paths() {
  local base="$1"
  {
    if git rev-parse --verify -q "$base" >/dev/null 2>&1; then
      git diff --name-only "$base...HEAD" 2>/dev/null || true
    else
      echo "[ci-scope] base ref '$base' does not resolve -- committed diff treated as empty" >&2
    fi
    git status --porcelain 2>/dev/null | cut -c4- | sed 's/^.* -> //' || true
  } | sed -e '/^$/d' -e 's#^"##' -e 's#"$##' | sort -u
}

# =============================================================================
# Scope computation
# =============================================================================
# Sets: SCOPE (admin|public|both), plus counters for the banner.
ci_scope_compute() {
  local base="$1" explain="$2"
  local p c has_admin=0 has_public=0
  local n_admin=0 n_public=0 n_both=0 n_ignored=0 n_unknown=0 n_total=0
  local unknown_list=''
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    n_total=$((n_total + 1))
    c="$(ci_scope_classify "$p")"
    case "$c" in
      admin)  has_admin=1; n_admin=$((n_admin + 1)) ;;
      public) has_public=1; n_public=$((n_public + 1)) ;;
      both)   has_admin=1; has_public=1; n_both=$((n_both + 1)) ;;
      ignored) n_ignored=$((n_ignored + 1)) ;;
      unclassified)
        # FAIL CLOSED, loudly.
        has_admin=1; has_public=1; n_unknown=$((n_unknown + 1))
        unknown_list="${unknown_list}  ${p}"$'\n' ;;
    esac
    if [ "$explain" = "1" ]; then printf '%-13s %s\n' "$c" "$p"; fi
  done < <(if [ "$CI_SCOPE_STDIN" = 1 ]; then cat; else ci_scope_paths "$base"; fi)

  local scope reason
  if [ "$n_total" -eq 0 ]; then
    # Nothing to compare -- someone running the gate on an empty diff gets the
    # WHOLE gate, never a reduced one.
    scope=both; reason='empty diff'
  elif [ "$has_admin" = 1 ] && [ "$has_public" = 1 ]; then
    scope=both; reason='admin+public'
  elif [ "$has_admin" = 1 ]; then
    scope=admin; reason='admin only'
  elif [ "$has_public" = 1 ]; then
    scope=public; reason='public only'
  else
    # Every changed path is in the ignored block. A fourth value ("none",
    # skipping every e2e family) was considered and REJECTED: the contract is
    # three values, and a scope that runs no e2e at all is exactly the state
    # that must not be reachable by accident.
    scope=both; reason='all paths ignored -- conservative'
  fi

  if [ -n "$unknown_list" ]; then
    printf '[ci-scope] %d path(s) match NO rule in tools/ci_scope.sh -- FAILING CLOSED to both:\n%s' \
      "$n_unknown" "$unknown_list" >&2
  fi
  printf '[ci-scope] %s (%s) -- base=%s, %d path(s): %d admin, %d public, %d shared, %d ignored, %d unclassified\n' \
    "$scope" "$reason" "$base" "$n_total" "$n_admin" "$n_public" "$n_both" "$n_ignored" "$n_unknown" >&2
  printf '%s\n' "$scope"
}

# =============================================================================
# Self-check -- REQ-0339's actual point.
#
# The table above is a hand-written mapping, and a hand-written mapping rots.
# These checks turn it from a rule someone has to remember into a fact that
# breaks the build when it is wrong. What they deliberately do NOT check: that
# a spec's assertions actually only touch its own surface -- see the honest
# limit at the top of this file.
# =============================================================================
_st_rc=0
_st_ok()  { printf 'PASS  %s\n' "$1"; }
_st_bad() {
  printf 'FAIL  %s\n' "$1"
  if [ -n "${2:-}" ]; then printf '%s\n' "$2"; fi
  _st_rc=1
  return 0
}

# $1 label  $2 actual set  $3 declared set  $4 remedy hint
_st_sets() {
  local label="$1" actual="$2" declared="$3" hint="$4" new stale msg=''
  # LC_ALL=C on BOTH sides: GNU sort collates by locale, GNU comm compares
  # bytes, and a set containing ".gitignore" or "pnpm-lock.yaml" is enough for
  # the two to disagree ("comm: file 1 is not in sorted order").
  new=$(comm -13 <(printf '%s\n' $declared | sed '/^$/d' | LC_ALL=C sort -u) \
                 <(printf '%s\n' $actual   | sed '/^$/d' | LC_ALL=C sort -u))
  stale=$(comm -23 <(printf '%s\n' $declared | sed '/^$/d' | LC_ALL=C sort -u) \
                   <(printf '%s\n' $actual   | sed '/^$/d' | LC_ALL=C sort -u))
  if [ -n "$new" ];   then msg="${msg}      on disk but NOT declared: $(echo $new)"$'\n'; fi
  if [ -n "$stale" ]; then msg="${msg}      declared but GONE from disk: $(echo $stale)"$'\n'; fi
  if [ -n "$msg" ]; then _st_bad "$label" "${msg}      -> ${hint}"; else _st_ok "$label"; fi
}

# $1 label  $2 space-separated offenders  $3 hint
_st_empty() {
  if [ -n "$2" ]; then _st_bad "$1" "      offenders:$2
      -> ${3}"; else _st_ok "$1"; fi
}

ci_scope_selftest() {
  echo '==== ci_scope table self-check (REQ-0339) ===='
  local e probe c bad got_admin

  # S1 -- every top-level repo entry is declared AND classifies.
  _st_sets 'S1a top-level repo entries match the declared inventory' \
    "$(git ls-files | awk -F/ '{print $1}' | sort -u)" "$KNOWN_TOPLEVEL" \
    'add it to KNOWN_TOPLEVEL and give it a rule in ci_scope_classify()'
  bad=''
  for e in $KNOWN_TOPLEVEL; do
    if [ -d "$e" ]; then probe="$e/__ci_scope_probe__"; else probe="$e"; fi
    c="$(ci_scope_classify "$probe")"
    if [ "$c" = unclassified ]; then bad="${bad} $e"; fi
  done
  _st_empty 'S1b every top-level entry classifies' "$bad" \
    'a top-level entry has no rule -- it would fail closed on every run'

  # S2 -- client/src subdirectories: inventory + which ones are admin.
  _st_sets 'S2a client/src/ subdirectories match the declared inventory' \
    "$(git ls-files client/src | awk -F/ 'NF>3{print $3}' | sort -u)" "$KNOWN_CLIENT_SRC" \
    'add it to KNOWN_CLIENT_SRC and decide admin vs public in ci_scope_classify()'
  bad=''; got_admin=''
  for e in $KNOWN_CLIENT_SRC; do
    c="$(ci_scope_classify "client/src/$e/__ci_scope_probe__")"
    if [ "$c" = unclassified ]; then bad="${bad} client/src/$e"; fi
    if [ "$c" = admin ]; then got_admin="${got_admin} $e"; fi
  done
  _st_empty 'S2b every client/src subdirectory classifies' "$bad" 'give it a rule'
  _st_sets 'S2c exactly the declared client/src dirs classify admin' \
    "$got_admin" "$KNOWN_CLIENT_SRC_ADMIN" \
    'the admin/public boundary moved -- update the table AND KNOWN_CLIENT_SRC_ADMIN'

  # S3 -- server/routes: inventory + which ones are admin.
  _st_sets 'S3a server/routes/ files match the declared inventory' \
    "$(git ls-files server/routes | awk -F/ 'NF==3{print $3}' | sort -u)" "$KNOWN_SERVER_ROUTES" \
    'add it to KNOWN_SERVER_ROUTES and decide admin vs public in ci_scope_classify()'
  bad=''; got_admin=''
  for e in $KNOWN_SERVER_ROUTES; do
    c="$(ci_scope_classify "server/routes/$e")"
    if [ "$c" = unclassified ]; then bad="${bad} server/routes/$e"; fi
    if [ "$c" = admin ]; then got_admin="${got_admin} $e"; fi
  done
  _st_empty 'S3b every server/routes file classifies' "$bad" 'give it a rule'
  _st_sets 'S3c exactly the declared server/routes files classify admin' \
    "$got_admin" "$KNOWN_SERVER_ROUTES_ADMIN" \
    'the admin/public boundary moved -- update the table AND KNOWN_SERVER_ROUTES_ADMIN'

  # S4 -- no e2e spec may fall through to unclassified (or be treated as prose).
  bad=''
  for e in client/e2e/*.spec.ts; do
    c="$(ci_scope_classify "$e")"
    case "$c" in admin|public|both) ;; *) bad="${bad} $e($c)" ;; esac
  done
  _st_empty 'S4 every client/e2e/*.spec.ts classifies to a real surface' "$bad" \
    'a spec that classifies to nothing would silently stop gating anything'

  # S5 -- cross-check against client/playwright.config.ts, which is maintained
  # independently of this file. The specs testIgnore'd out of the DEFAULT suite
  # are exactly the specs the default fleet cannot run: the admin-harness specs,
  # PLUS the declared harness-only PUBLIC specs (REQ-0365 -- see
  # KNOWN_HARNESS_ONLY_PUBLIC_SPECS at the top of this file for why that second
  # category exists). Two files, one fact.
  local ignored_specs harness_only
  ignored_specs=$(sed -n '/testIgnore:/p' client/playwright.config.ts \
    | grep -o '[A-Za-z0-9._-]*\.spec\.ts' | sort -u)
  harness_only=$( { for e in client/e2e/*.spec.ts; do
        if [ "$(ci_scope_classify "$e")" = admin ]; then basename "$e"; fi; done
      for e in $KNOWN_HARNESS_ONLY_PUBLIC_SPECS; do echo "$e"; done; } | sort -u)
  _st_sets 'S5 playwright testIgnore set == admin specs + declared harness-only public specs' \
    "$harness_only" "$ignored_specs" \
    'client/playwright.config.ts and this table disagree about what the default suite cannot run'

  # S5b (REQ-0365) -- every declared harness-only public spec must EXIST, and
  # must classify public. Without this the escape hatch above would also be a
  # way to silently downgrade an admin spec, or to keep a dead name forever.
  bad=''
  for e in $KNOWN_HARNESS_ONLY_PUBLIC_SPECS; do
    if [ ! -f "client/e2e/$e" ]; then bad="${bad} MISSING:$e"; continue; fi
    c="$(ci_scope_classify "client/e2e/$e")"
    [ "$c" = public ] || bad="${bad} $e=$c"
  done
  _st_empty 'S5b declared harness-only public specs exist and classify public' "$bad" \
    'the testIgnore escape hatch is only for PUBLIC specs that need their own fleet seed'

  # S6 -- every spec an isolated harness actually drives must NOT be public.
  # Derived from the tree: the harness scripts name their config, the config
  # names its testMatch. This is the check that found dex-admin.spec.ts, which
  # is in the default suite AND is what [6.6/8] drives.
  # REQ-0365: harness configs now live in TWO places -- client/e2e/<n>.config.ts
  # (the admin ones, which redefine every path) and client/<n>.config.ts (the
  # signed-out one, which SPREADS playwright.config.ts and so must sit beside
  # it for the inherited relative paths to resolve). Both shapes are collected;
  # a config this loop cannot find is a failure, never a silent skip.
  local cfg spec cfgpath
  bad=''
  for cfg in $(grep -ho -- '--config=[A-Za-z0-9._/-]*\.config\.ts' tools/*_e2e.sh \
               | sed 's#^--config=##' | sort -u); do
    cfgpath="client/$cfg"
    if [ ! -f "$cfgpath" ]; then bad="${bad} MISSING:$cfgpath"; continue; fi
    spec=$(grep -o 'testMatch:[^,]*' "$cfgpath" \
           | grep -o '[A-Za-z0-9._-]*\.spec\.ts' | head -1)
    if [ -z "$spec" ]; then bad="${bad} NO-testMatch:$cfg"; continue; fi
    c="$(ci_scope_classify "client/e2e/$spec")"
    case "$c" in
      admin|both) ;;
      public)
        # Allowed ONLY for a declared harness-only public spec (REQ-0365): its
        # harness is a PUBLIC-scoped ci.sh stage ([6.7/8]), so public is right.
        case " $KNOWN_HARNESS_ONLY_PUBLIC_SPECS " in
          *" $spec "*) ;;
          *) bad="${bad} $cfg->$spec=public-undeclared" ;;
        esac ;;
      *) bad="${bad} $cfg->$spec=$c" ;;
    esac
  done
  _st_empty 'S6 every spec an isolated harness drives is admin/both, or a declared harness-only public spec' "$bad" \
    'a spec [6.5]/[6.6] runs would be skipped by an admin-scoped run'

  if [ "$_st_rc" != 0 ]; then
    echo 'ci_scope self-check RED -- the classification table no longer describes the tree.' >&2
  else
    echo 'ci_scope self-check GREEN'
  fi
  return "$_st_rc"
}

# =============================================================================
# main
# =============================================================================
EXPLAIN=0
BASE=''
while [ $# -gt 0 ]; do
  case "$1" in
    --selftest) if ci_scope_selftest; then exit 0; else exit 1; fi ;;
    # REQ-0343: handled at the top (it suppresses the cd); here only to consume
    # the argument and to label the banner, since there is no base ref.
    --classify-stdin) BASE='<stdin>'; shift ;;
    --explain)  EXPLAIN=1; shift ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    -*) echo "ci_scope: unknown option $1" >&2; exit 2 ;;
    *)  BASE="$1"; shift ;;
  esac
done
ci_scope_compute "${BASE:-master}" "$EXPLAIN"
