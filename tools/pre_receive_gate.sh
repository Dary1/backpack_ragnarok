#!/usr/bin/env bash
# tools/pre_receive_gate.sh -- REQ-0343. THE PUSH GATE.
#
# Installed (by tools/install_push_gate.sh) as
#   /srv/bpkgit/backpack_ragnarok.git/hooks/pre-receive
# and run by git-receive-pack, ON THE SERVER, for every push. It reads
#   <oldrev> <newrev> <refname>
# on stdin, one line per ref, and rejects the WHOLE push (git's pre-receive
# semantics: all refs or none) by exiting non-zero.
#
# =============================================================================
# WHY THIS EXISTS -- and why it is not a document and not a client-side hook
# =============================================================================
# REQ-0339 took away the small judgement call ("which tests does my change
# need?") by computing the scope from the diff. The big one survived: DID ANYONE
# RUN THE GATE? That one is answered from memory, under time pressure, by
# whoever is finishing the change -- and it is the one that gets skipped.
#
# A rule in PROJECT.md does not answer it: a rule is a thing to remember, and
# the failure being guarded against IS forgetting. A client-side hook
# (pre-commit / pre-push) does not answer it either: `--no-verify` skips every
# client-side hook, and more importantly a client hook lives in the same tree
# and under the same user as the change, so "the hook was in the way" and "the
# hook got edited" are one keystroke apart. pre-receive runs in the RECEIVING
# repository, after the objects arrive; there is no client flag that turns it
# off. `git push --no-verify` reaches it unchanged. (Verified, not assumed --
# see REQ-0343 S4 verification 5.)
#
# =============================================================================
# THE GATE COMPUTES. IT NEVER ASKS.
# =============================================================================
# This hook does not read a scope out of the receipt and believe it. It computes
# the scope the pushed range REQUIRES, itself, and then checks the receipt
# against that. There is no flag, no commit-message trailer, no "[scope: admin]"
# convention -- nothing a pusher can assert. The only thing a pusher supplies is
# a receipt, and a receipt is a claim about a TREE, which this hook verifies is
# the tree actually being pushed.
#
# The classifier is tools/ci_scope.sh (REQ-0339), read out of THE PUSHED TREE
# (`git show <newrev>:tools/ci_scope.sh`) and run in its --classify-stdin mode,
# which touches no worktree. Reasons, both of which matter:
#
#   * The pusher's local copy is not readable from here and would not be
#     trustworthy if it were. Only the pushed tree is.
#   * A push that CHANGES the classifier is therefore judged by the NEW
#     classifier. That is deliberate. The property that matters is that this
#     hook agrees with the ci.sh run that produced the receipt, and that run
#     used the new classifier -- it was sitting in the worktree. Judging by the
#     old one would reject correctly-gated pushes whenever the table legitimately
#     grows a row, which is exactly when people start disabling gates. The
#     residual risk (a push that weakens the table and is judged by its own
#     weakening) is bounded by two things: tools/ci_scope.sh classifies ITSELF
#     as `both` (row 14), so any push touching it needs a full-gate receipt; and
#     ci.sh [0.5/7] runs `ci_scope.sh --selftest`, so a table that has stopped
#     describing the tree fails the gate and no receipt is written at all. And a
#     deliberate attacker does not need this path anyway -- see the honesty
#     section below.
#
# =============================================================================
# FAIL CLOSED
# =============================================================================
# Every uncertainty resolves to `both` (the full gate), never to `accept`:
#   * branch creation (oldrev all zeroes) -- no base to diff from
#   * force-push / non-fast-forward       -- "the pushed range" is not a range
#   * the pushed tree has no tools/ci_scope.sh, or it fails to run
#   * git diff itself fails
#   * the classifier prints anything that is not admin|public|both
# `set -euo pipefail` is part of this: an unhandled error aborts the hook with a
# non-zero status, which REJECTS. There is no path through this file where an
# unexpected failure lets a push through.
#
# =============================================================================
# HONESTY -- THIS IS A MEMORY AID, NOT A WALL
# =============================================================================
# Receipts are ordinary files written by the same unix user that pushes. Anyone
# who can push can therefore also fabricate a receipt, with one command. This
# hook does not detect that and cannot.
#
# What it does is change the SHAPE of the failure: skipping the gate stops being
# something you can do by forgetting and becomes something you have to do on
# purpose, by name, in a way that leaves a file with your hostname and a
# timestamp in it. "I forgot" becomes "I deliberately lied". That is the failure
# mode worth raising, and raising it is the whole claim -- nothing more is
# claimed here.
#
# What would make it a wall: a receipt store owned by a unix user the pusher
# cannot write as (a `bpkci` user owning ci-receipts/, the gate invoked through
# a narrow sudoers entry or a socket-activated helper). That is a real, known
# upgrade path and it is deliberately NOT built here -- see REQ-0343 S5.
# =============================================================================
set -euo pipefail

PUSH_GATE_VERSION=1

# Refs this hook gates. Everything else is deliberately FREE:
#   * feature branches (refs/heads/req-*) exist on origin for backup and for
#     moving work between trees. Gating them would mean paying a 500 s gate to
#     save work in progress, which is how a gate gets uninstalled. Nothing
#     deploys from a feature branch.
#   * tags likewise. Nothing reads them; gating them would gate nothing.
# master is gated because master is the line that release/deploy reads, and
# "did the gate run before this reached master" is the entire question.
GATED_REF='refs/heads/master'

T="$(mktemp -d "${TMPDIR:-/tmp}/bpk_pushgate.XXXXXX")"
trap 'rm -rf "$T"' EXIT

say() { printf '%s\n' "$*" >&2; }
bar() { say '================================================================================'; }

is_zero() { case "$1" in *[!0]*) return 1 ;; *) return 0 ;; esac; }

GITDIR="$(git rev-parse --absolute-git-dir)"
RDIR="${BPK_RECEIPT_DIR:-$GITDIR/ci-receipts}"

# The same three-value algebra as tools/ci_receipt.sh. Duplicated here on
# purpose: the hook must not depend on any file out of the pushed tree except
# the classifier, and a four-line table is cheaper to keep honest than a
# dependency. tools/tests/push_gate_test.py asserts the two agree.
covers() {
  if [ "$1" = both ]; then return 0; fi
  if [ "$1" = "$2" ]; then return 0; fi
  return 1
}

# -----------------------------------------------------------------------------
# Compute the REQUIRED scope for oldrev..newrev. Sets REQ_SCOPE and REQ_WHY.
# -----------------------------------------------------------------------------
required_scope() {
  local oldrev="$1" newrev="$2"
  REQ_SCOPE=both

  if is_zero "$oldrev"; then
    REQ_WHY='branch creation -- there is no base to diff against, so the full gate is required'
    return 0
  fi
  if ! git cat-file -e "$oldrev^{commit}" 2>/dev/null; then
    REQ_WHY="the old tip $oldrev is not a commit here -- fail closed"
    return 0
  fi
  if ! git merge-base --is-ancestor "$oldrev" "$newrev" 2>/dev/null; then
    REQ_WHY="NON-FAST-FORWARD (history rewrite): the pushed range is not a range, so the full gate is required"
    return 0
  fi
  if ! git show "$newrev:tools/ci_scope.sh" > "$T/ci_scope.sh" 2>/dev/null; then
    REQ_WHY='the pushed tree has no tools/ci_scope.sh -- fail closed'
    return 0
  fi
  if [ ! -s "$T/ci_scope.sh" ]; then
    REQ_WHY='the pushed tree'"'"'s tools/ci_scope.sh is empty -- fail closed'
    return 0
  fi
  # Three-dot, matching what tools/ci_scope.sh does with its base ref. For a
  # fast-forward push merge-base(old,new) == old, so it is the plain range.
  if ! git diff --name-only "$oldrev...$newrev" > "$T/paths" 2>"$T/differr"; then
    REQ_WHY="could not compute git diff $oldrev...$newrev -- fail closed"
    return 0
  fi
  if ! bash "$T/ci_scope.sh" --classify-stdin < "$T/paths" > "$T/scope" 2>"$T/scopelog"; then
    REQ_WHY='the pushed tree'"'"'s tools/ci_scope.sh failed to run -- fail closed'
    return 0
  fi
  local s; s="$(head -1 "$T/scope" 2>/dev/null || true)"
  case "$s" in
    admin|public|both)
      REQ_SCOPE="$s"
      REQ_WHY="computed by the PUSHED tree's tools/ci_scope.sh over $(wc -l < "$T/paths" | tr -d ' ') changed path(s)"
      ;;
    *)
      REQ_WHY="the pushed tree's tools/ci_scope.sh printed '$s', which is not admin|public|both -- fail closed"
      ;;
  esac
  return 0
}

# -----------------------------------------------------------------------------
# The rejection message. This is the entire user experience of the gate, so it
# says what happened, what is required, and the exact commands -- never "see the
# docs".
# -----------------------------------------------------------------------------
reject() {
  local refname="$1" newrev="$2" tree="$3" need="$4" why="$5" have="$6"
  bar
  say " PUSH REJECTED -- $refname is gated and this tree has no valid CI receipt"
  bar
  say " ref              $refname"
  say " commit           $(git --no-pager log -1 --format='%h  %s' "$newrev" 2>/dev/null || echo "$newrev")"
  say " tree             $tree"
  say " required scope   $need"
  say "                  ($why)"
  if [ -z "$have" ]; then
    say " receipt          NONE"
    say "                  looked for: $RDIR/$tree"
  else
    say " receipt          FOUND but scope='$have', which does not cover '$need'"
    say "                  $RDIR/$tree"
  fi
  if [ -s "$T/scopelog" ]; then
    say ''
    say ' the classifier said:'
    sed 's/^/   /' "$T/scopelog" >&2
  fi
  say ''
  say ' TO FIX -- in the worktree that produced this commit:'
  say ''
  say '   export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh'
  say '   export XDG_RUNTIME_DIR=/run/user/$(id -u)'
  say '   export DATABASE_URL="$(grep -m1 ^DATABASE_URL= ~/backpack_ragnarok/server/.env | cut -d= -f2-)"'
  if [ "$need" = both ]; then
    say '   bash tools/release.sh          # full gate; writes a scope=both receipt'
  else
    say "   bash tools/ci.sh               # computes scope '$need' from the diff and receipts it"
    say '   # or bash tools/release.sh for the full gate -- both is accepted here'
  fi
  say ''
  say ' Then push again. Do NOT set SKIP_PG / SKIP_CLIENT / SKIP_E2E: a run that'
  say ' skipped stages deliberately writes no receipt.'
  say ''
  say ' The receipt is bound to the TREE, not the commit. Rewording a commit'
  say ' message (git commit --amend) keeps it valid; changing one byte of code'
  say ' does not. If the gate ran on a dirty worktree, commit exactly what it'
  say ' tested -- any further edit invalidates the receipt, by design.'
  say ''
  say ' HONEST LIMIT: this hook is a memory aid, not a wall. Receipts are plain'
  say ' files written by the same unix user that pushes, so anyone who can push'
  say ' can also fabricate one. What this raises is "I forgot" to "I deliberately'
  say ' lied" -- which is the failure worth raising. Making it a wall needs a'
  say ' receipt store owned by a user the pusher cannot write as; that is a known'
  say ' upgrade path and is not built. See docs/REQ/*/REQ-0343-*.md S5.'
  bar
}

# -----------------------------------------------------------------------------
# main
# -----------------------------------------------------------------------------
INPUT="$(cat)"
RC=0
GATED_SEEN=0

while read -r oldrev newrev refname; do
  # NB: an `[ ... ] && continue` here would abort the hook under `set -e`
  # whenever the test is false. Fail-closed means reject, but aborting on the
  # FIRST ref would skip the rest -- so the loop uses plain ifs throughout.
  if [ -z "${refname:-}" ]; then continue; fi

  if [ "$refname" != "$GATED_REF" ]; then
    say "[push-gate] $refname -- not gated (only $GATED_REF is), allowed"
    continue
  fi
  GATED_SEEN=1

  # Deleting the gated branch is not a coverage question; it is a destructive
  # act that no gate can attest. Refuse it here rather than pretend to measure
  # it. Recreating master, if ever genuinely needed, is a deliberate
  # `git update-ref` on the server by a person.
  if is_zero "$newrev"; then
    bar
    say " PUSH REJECTED -- refusing to delete $GATED_REF"
    say " A CI receipt cannot attest a deletion. If this is really wanted, do it"
    say " on the server with an explicit git update-ref, not through a push."
    bar
    RC=1
    continue
  fi

  required_scope "$oldrev" "$newrev"
  tree="$(git rev-parse "$newrev^{tree}")"

  have=''
  if [ -f "$RDIR/$tree" ]; then
    have="$(sed -n 's/^scope=//p' "$RDIR/$tree" | head -1)"
    case "$have" in admin|public|both) ;; *) have='' ;; esac
    # The tree is the filename AND a field. They can only disagree if a receipt
    # was copied rather than issued, which is a mistake worth naming -- it is
    # not a security check, because a forger would simply write both fields.
    rtree="$(sed -n 's/^tree=//p' "$RDIR/$tree" | head -1)"
    if [ -n "$rtree" ] && [ "$rtree" != "$tree" ]; then
      say "[push-gate] receipt $RDIR/$tree records tree=$rtree -- it was copied, not issued. Ignoring it."
      have=''
    fi
  fi

  if [ -n "$have" ] && covers "$have" "$REQ_SCOPE"; then
    say "[push-gate] $refname OK -- required '$REQ_SCOPE' ($REQ_WHY)"
    say "[push-gate]   tree $tree, receipt scope='$have' issued $(sed -n 's/^utc=//p' "$RDIR/$tree" | head -1) by $(sed -n 's/^source=//p' "$RDIR/$tree" | head -1) on branch $(sed -n 's/^branch=//p' "$RDIR/$tree" | head -1)"
    say "[push-gate]   (a receipt is a memory aid, not proof: it is forgeable by anyone who can push)"
  else
    reject "$refname" "$newrev" "$tree" "$REQ_SCOPE" "$REQ_WHY" "$have"
    RC=1
  fi
done <<< "$INPUT"

if [ "$RC" != 0 ]; then
  say "[push-gate] v$PUSH_GATE_VERSION -- push rejected, NO ref was updated."
elif [ "$GATED_SEEN" = 0 ]; then
  say "[push-gate] v$PUSH_GATE_VERSION -- nothing gated in this push."
fi
exit "$RC"
