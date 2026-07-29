#!/usr/bin/env bash
# tools/ci_receipt.sh -- REQ-0343. Write and read CI RECEIPTS: the record that a
# SPECIFIC TREE passed the gate at a SPECIFIC SCOPE.
#
# WHY A RECEIPT EXISTS AT ALL
# -----------------------------------------------------------------------------
# REQ-0339 removed the small judgement call ("which tests does my change need?")
# by computing the scope from the diff. It left the big one: DID ANYONE RUN THE
# GATE BEFORE MERGING? That question is answered by memory, and memory is what
# drifts. tools/pre_receive_gate.sh turns it into a machine check -- but a hook
# in a bare repo cannot re-run a 500 s gate, so the gate must leave something
# behind. This is that something.
#
# WHY THE KEY IS THE TREE AND NOT THE COMMIT
# -----------------------------------------------------------------------------
# A commit sha covers the message, the author, the parents and the date. None of
# those can break a test. `git commit --amend` to fix a typo in a commit message
# produces a new commit over an IDENTICAL tree -- the gate's verdict is still
# true, and a commit-keyed receipt would throw it away and demand another 500 s
# run for nothing. Conversely, changing one byte of one source file produces a
# new tree, and the verdict really is void. The tree sha is exactly the identity
# of "the code that was tested", which is exactly what a receipt attests. So:
#   git rev-parse HEAD^{tree}
# and never git rev-parse HEAD.
#
# It also means a receipt survives rebase, cherry-pick and merge-with-no-changes
# whenever those genuinely reproduce the same content, and dies whenever they do
# not. That is the correct behaviour in both directions, for free.
#
# THE DIRTY-WORKTREE CASE -- READ THIS, IT IS A REAL HOLE IF GOT WRONG
# -----------------------------------------------------------------------------
# Running ci.sh with uncommitted changes is NORMAL here; tools/ci_scope.sh goes
# out of its way to classify the dirty tree precisely because of that. So the
# naive `HEAD^{tree}` would attest the COMMITTED tree while the gate actually
# tested the WORKING tree -- and then committing those changes and pushing would
# sail through on a receipt for code that was never run. That is the REQ-0340
# free pass in a new place.
#
# Instead the receipt is keyed on the EFFECTIVE tree: the tree the working state
# would produce if committed right now (`git add -A` semantics, computed in a
# scratch index so the real index is untouched). On a clean tree that is exactly
# HEAD^{tree}. On a dirty tree it is the tree that `git add -A && git commit`
# will produce -- so the normal "edit, gate, commit, push" loop needs ONE gate
# run, and any further edit between gate and commit changes the tree and is
# rejected. `dirty=1` and the HEAD it was computed over are recorded either way.
#
# WHAT A RECEIPT IS NOT
# -----------------------------------------------------------------------------
# It is not a signature and not a capability. Receipts are plain files written by
# the same unix user that pushes, so anyone who can push can also write one by
# hand. See tools/pre_receive_gate.sh and docs/REQ/.../REQ-0343-*.md S5 -- this
# is stated everywhere it is relevant rather than left to be discovered.
#
# Nothing secret goes in a receipt: tree, scope, timestamp, wall seconds, host,
# branch, HEAD, dirty flag, and which script issued it. No paths outside the
# repo, no env, no tokens.
#
# USAGE
#   tools/ci_receipt.sh write <scope> [<seconds>] [<source>]
#   tools/ci_receipt.sh tree                 -> the effective tree sha
#   tools/ci_receipt.sh dir                  -> the resolved receipt directory
#   tools/ci_receipt.sh show  <tree>         -> the receipt, or exit 1
#   tools/ci_receipt.sh scope <tree>         -> just its scope, or exit 1
#   tools/ci_receipt.sh covers <have> <need> -> exit 0 if <have> covers <need>
#   tools/ci_receipt.sh --selftest
#
# The receipt directory is, in order:
#   1. $BPK_RECEIPT_DIR                     (tests, and the only override)
#   2. <remote.origin.url>/ci-receipts      when origin is a local path
# and it is an ERROR if neither resolves -- never a silent no-op.
set -euo pipefail

RECEIPT_VERSION=1

# Resolved BEFORE the cd, because $0 may be relative.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

# cd to the toplevel of the worktree we were INVOKED IN -- not to $0/.. -- so
# that a copy of this file run from inside another repo (the selftest's
# synthetic repos, a throwaway clone) operates on THAT repo. Every git command
# below is then relative to one unambiguous root.
if [ "${1:-}" != "--selftest" ]; then
  _top="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -z "${_top:-}" ]; then
    echo "[ci-receipt] not inside a git worktree -- nothing to receipt" >&2; exit 2
  fi
  cd "$_top"
fi

# =============================================================================
# Where receipts live
# =============================================================================
# Deriving the default from remote.origin.url rather than hard-coding
# /srv/bpkgit/... keeps this file honest in a throwaway clone: the receipts a
# tree writes always land in the repo that tree pushes to, which is the repo
# whose pre-receive hook will look for them. One fact, one place.
receipt_dir() {
  if [ -n "${BPK_RECEIPT_DIR:-}" ]; then printf '%s\n' "${BPK_RECEIPT_DIR%/}"; return 0; fi
  local url
  url="$(git config --get remote.origin.url 2>/dev/null || true)"
  case "$url" in
    /*) printf '%s/ci-receipts\n' "${url%/}" ;;
    '') echo "[ci-receipt] no remote 'origin' -- set BPK_RECEIPT_DIR or add the origin remote" >&2; return 1 ;;
    *)  echo "[ci-receipt] remote 'origin' is '$url', not a local path -- receipts need the bare repo on this box; set BPK_RECEIPT_DIR" >&2; return 1 ;;
  esac
}

# =============================================================================
# The effective tree -- see the header
# =============================================================================
effective_tree() {
  if [ -z "$(git status --porcelain 2>/dev/null)" ]; then
    git rev-parse HEAD^{tree}
    return 0
  fi
  local idx rc=0
  idx="$(mktemp "${TMPDIR:-/tmp}/bpk_receipt_idx.XXXXXX")"
  # A scratch GIT_INDEX_FILE: the real index is never read or written, so a
  # gate run can never disturb a half-staged commit someone is composing.
  # `git add -A` honours .gitignore, so node_modules/ and data/ stay out.
  if GIT_INDEX_FILE="$idx" git read-tree HEAD >/dev/null 2>&1 \
     && GIT_INDEX_FILE="$idx" git add -A >/dev/null 2>&1; then
    GIT_INDEX_FILE="$idx" git write-tree
  else
    rc=1
  fi
  rm -f "$idx"
  return "$rc"
}

is_dirty() { [ -n "$(git status --porcelain 2>/dev/null)" ]; }

# =============================================================================
# Coverage -- the whole scope algebra, in one place, used by the hook too
# =============================================================================
# `both` covers everything. `admin` covers `admin`. `public` covers `public`.
# Nothing else covers anything. Deliberately NOT a partial order with clever
# cases: three values, one table, no room to be subtly wrong.
receipt_covers() {
  local have="$1" need="$2"
  if [ "$have" = both ]; then return 0; fi
  if [ "$have" = "$need" ]; then return 0; fi
  return 1
}

# =============================================================================
# write
# =============================================================================
receipt_write() {
  local scope="$1" secs="${2:-0}" source="${3:-unknown}"
  case "$scope" in
    admin|public|both) ;;
    *) echo "[ci-receipt] refusing to write a receipt for scope '$scope' -- must be admin|public|both" >&2; return 2 ;;
  esac
  case "$secs" in ''|*[!0-9]*) secs=0 ;; esac

  local dir tree head branch dirty tmp
  dir="$(receipt_dir)" || return 1
  if [ ! -d "$dir" ]; then
    echo "[ci-receipt] receipt directory '$dir' does not exist (external disk not mounted?) -- no receipt written" >&2
    return 1
  fi
  if ! tree="$(effective_tree)"; then
    echo "[ci-receipt] could not compute the effective tree -- no receipt written" >&2
    return 1
  fi
  head="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  if is_dirty; then dirty=1; else dirty=0; fi

  # Written to a temp file in the same directory and renamed, so a reader can
  # never see half a receipt.
  tmp="$dir/.tmp.$$.$RANDOM"
  {
    printf 'version=%s\n' "$RECEIPT_VERSION"
    printf 'tree=%s\n'    "$tree"
    printf 'scope=%s\n'   "$scope"
    printf 'utc=%s\n'     "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'seconds=%s\n' "$secs"
    printf 'host=%s\n'    "$(hostname)"
    printf 'branch=%s\n'  "$branch"
    printf 'head=%s\n'    "$head"
    printf 'dirty=%s\n'   "$dirty"
    printf 'source=%s\n'  "$source"
  } > "$tmp"
  mv -f "$tmp" "$dir/$tree"
  chmod 664 "$dir/$tree" 2>/dev/null || true

  printf '[ci-receipt] WROTE scope=%s tree=%s (%ss, %s) -> %s\n' \
    "$scope" "$tree" "$secs" "$source" "$dir/$tree" >&2
  if [ "$dirty" = 1 ]; then
    printf '[ci-receipt] the worktree was DIRTY: this receipt is for the tree `git add -A && git commit` would produce.\n' >&2
    printf '[ci-receipt] Commit exactly that, with no further edits, or the push gate will (correctly) reject it.\n' >&2
  fi
}

# =============================================================================
# read
# =============================================================================
receipt_field() { sed -n "s/^$2=//p" "$1" | head -1; }

receipt_show() {
  local dir; dir="$(receipt_dir)" || return 1
  [ -f "$dir/$1" ] || { echo "[ci-receipt] no receipt for tree $1 in $dir" >&2; return 1; }
  cat "$dir/$1"
}

receipt_scope() {
  local dir f s; dir="$(receipt_dir)" || return 1
  f="$dir/$1"
  [ -f "$f" ] || return 1
  s="$(receipt_field "$f" scope)"
  case "$s" in admin|public|both) printf '%s\n' "$s" ;; *) return 1 ;; esac
}

# =============================================================================
# selftest
# =============================================================================
_rc=0
_ok()  { printf 'PASS  %s\n' "$1"; }
_bad() { printf 'FAIL  %s\n' "$1"; _rc=1; }
_eq()  { if [ "$2" = "$3" ]; then _ok "$1"; else _bad "$1 (got '$2', want '$3')"; fi; }

receipt_selftest() {
  echo '==== ci_receipt selftest (REQ-0343) ===='
  local d r
  d="$(mktemp -d)"

  # C1 -- the coverage table, all nine cells.
  local have need got want bad=''
  for have in admin public both; do
    for need in admin public both; do
      if [ "$have" = both ] || [ "$have" = "$need" ]; then want=yes; else want=no; fi
      if receipt_covers "$have" "$need"; then got=yes; else got=no; fi
      if [ "$got" != "$want" ]; then bad="$bad have=$have,need=$need->$got(want $want)"; fi
    done
  done
  if [ -z "$bad" ]; then _ok 'C1 coverage table: both>=all, admin>=admin, public>=public, nothing else'
  else _bad "C1 coverage table:$bad"; fi

  # C2 -- a synthetic repo: clean tree receipt is keyed on HEAD^{tree}.
  r="$d/repo"; mkdir -p "$r"
  ( cd "$r" && git init -q . && git config user.email t@t && git config user.name t \
    && echo one > a.txt && git add -A && git commit -qm one ) >/dev/null 2>&1
  mkdir -p "$d/receipts"
  local t_head t_eff
  t_head="$(cd "$r" && git rev-parse 'HEAD^{tree}')"
  t_eff="$(cd "$r" && BPK_RECEIPT_DIR="$d/receipts" bash "$SELF" tree)"
  _eq 'C2 clean worktree: effective tree == HEAD^{tree}' "$t_eff" "$t_head"

  # C3 -- write then read back, and the file is named for the tree.
  ( cd "$r" && BPK_RECEIPT_DIR="$d/receipts" bash "$SELF" write both 42 selftest ) >/dev/null 2>&1
  _eq 'C3a receipt file is named for the tree' "$([ -f "$d/receipts/$t_head" ] && echo yes || echo no)" yes
  _eq 'C3b scope reads back' \
    "$(cd "$r" && BPK_RECEIPT_DIR="$d/receipts" bash "$SELF" scope "$t_head")" both

  # C4 -- a DIRTY worktree keys on the tree a commit would produce, NOT
  # HEAD^{tree}. This is the hole described in the header; assert it directly.
  ( cd "$r" && echo two > a.txt ) 
  t_eff="$(cd "$r" && BPK_RECEIPT_DIR="$d/receipts" bash "$SELF" tree)"
  if [ "$t_eff" = "$t_head" ]; then _bad 'C4a dirty worktree must NOT key on HEAD^{tree}'
  else _ok 'C4a dirty worktree keys on a different tree than HEAD^{tree}'; fi
  ( cd "$r" && git add -A && git commit -qm two ) >/dev/null 2>&1
  _eq 'C4b that tree is exactly what the commit produced' \
    "$(cd "$r" && git rev-parse 'HEAD^{tree}')" "$t_eff"

  # C5 -- an amend that changes only the message keeps the receipt valid.
  local before after
  before="$(cd "$r" && git rev-parse 'HEAD^{tree}')"
  ( cd "$r" && git commit -q --amend -m 'two, reworded' ) >/dev/null 2>&1
  after="$(cd "$r" && git rev-parse 'HEAD^{tree}')"
  _eq 'C5 message-only amend leaves the tree (and so the receipt) unchanged' "$after" "$before"

  # C6 -- a bad scope is refused rather than recorded.
  if ( cd "$r" && BPK_RECEIPT_DIR="$d/receipts" bash "$SELF" write sortof 1 selftest ) >/dev/null 2>&1; then
    _bad 'C6 an invalid scope must be refused'
  else _ok 'C6 an invalid scope is refused, not recorded'; fi

  # C7 -- a missing receipt directory (the external disk unplugged) is an
  # error with a reason, never a silent success.
  if ( cd "$r" && BPK_RECEIPT_DIR="$d/definitely_not_here" bash "$SELF" write both 1 selftest ) >/dev/null 2>&1; then
    _bad 'C7 a missing receipt directory must fail'
  else _ok 'C7 a missing receipt directory fails loudly'; fi

  rm -rf "$d"
  if [ "$_rc" = 0 ]; then echo 'ci_receipt selftest GREEN'; else echo 'ci_receipt selftest RED' >&2; fi
  return "$_rc"
}

# =============================================================================
# main
# =============================================================================
case "${1:---help}" in
  write)  shift; receipt_write "$@" ;;
  tree)   effective_tree ;;
  dir)    receipt_dir ;;
  show)   shift; receipt_show "$@" ;;
  scope)  shift; receipt_scope "$@" ;;
  covers) shift; receipt_covers "$@" ;;
  --selftest) if receipt_selftest; then exit 0; else exit 1; fi ;;
  -h|--help) sed -n '2,60p' "$0"; exit 0 ;;
  *) echo "ci_receipt: unknown command '$1'" >&2; exit 2 ;;
esac
