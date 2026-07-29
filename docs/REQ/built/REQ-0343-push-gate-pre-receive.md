# REQ-0343 — master advances by push, and the push is gated on a CI receipt

## Status
built — implemented and gated 2026-07-29. Awaiting user acceptance / merge.

One line. `refs/heads/master` on `/srv/bpkgit/backpack_ragnarok.git` now only
accepts a push whose **tree** carries a CI receipt covering the scope the hook
**computes for itself** from the pushed range. It never asks what the change
needs, and `--no-verify` does not reach it. It is a memory aid, not a wall —
§6 says exactly how far it goes and where it stops.

---

## 1. Why — the judgement REQ-0339 left on the table

REQ-0339 took away the small judgement call ("which tests does my change
need?") by making the scope a function of `git diff`. Its own §1 says why that
mattered: an agent *asked to judge* relevance drifts, a little, every time,
toward the cheaper answer, and the drift is invisible because the gate still
prints CI GREEN.

It left the bigger one, which nothing in `tools/` could answer:

> **Did anyone run the gate before this reached master?**

That question is answered from memory, at the end of a long session, by the
person or agent who has just finished the change and wants to be finished. It
is the one that gets skipped, and skipping it leaves no trace at all — a merge
commit looks identical whether or not a gate ran before it.

The evidence is from this session, not hypothetical. `tools/release.sh` was run
with a polluted environment (a full `source server/.env`, which sets
`STORAGE_BACKEND=pg`) that silently turned `ci.sh`'s `[4/7]` **files-backend**
api_test into a **second pg run**. The files-backend contract went untested and
the log still read like a full gate. It was noticed only because that second pg
run happened to fail. A run that lies about what it covered is bad; a merge with
no run at all is worse, and nothing was watching for it.

### What was considered and rejected

| option | why not |
|---|---|
| **A rule in PROJECT.md** | A rule is a thing to remember. The failure being guarded against *is* forgetting. It also cannot distinguish "ran the gate" from "says they ran the gate". |
| **A client-side `pre-commit` / `pre-push` hook** | `git push --no-verify` skips every client-side hook — measured, §8 V5/V6. Worse, a client hook lives in the same tree and under the same user as the change: "the hook was in the way" and "the hook is gone" are one keystroke apart. |
| **Run the whole gate inside the hook** | 480 s inside `receive-pack`, needing Postgres, a built client, Playwright browsers and the box lock `tools/ci.sh:95` already serialises on — and it would run as the pushing user anyway, so it buys no trust it does not already have. The hook's job is to check that the gate happened, not to be the gate. |
| **Sign the receipts (gpg / HMAC)** | The key would have to live where the pusher can read it. That is theatre: it converts a forgeable file into a forgeable file plus a ritual. The real upgrade is a receipt store the pusher cannot write — §6. |
| **Gate every ref, not just master** | Feature branches exist on `origin` for backup and for moving work between worktrees. Paying 480 s to save work in progress is how a gate gets uninstalled. `tools/pre_receive_gate.sh:103`. |

---

## 2. What was built

| file | |
|---|---|
| `tools/ci_receipt.sh` (303 L) | **new** — write/read a receipt; the tree-key rule; the coverage algebra; `--selftest` |
| `tools/pre_receive_gate.sh` (298 L) | **new** — the hook body, tracked here, installed into the bare repo |
| `tools/install_push_gate.sh` (64 L) | **new** — install it, and `--check` for drift |
| `tools/tests/push_gate_test.py` (342 L) | **new** — 46 assertions driving real `git push`es at a real bare repo |
| `tools/ci_scope.sh` | `--classify-stdin`: classify a path list with no worktree (`:47`, `:367`) |
| `tools/ci.sh` | `[0.6/7]` new stage (`:191`); writes the receipt on CI GREEN (`:492-518`) |
| `tools/release.sh` | re-issues the receipt for the post-dist tree (`:29-48`) |

No product code, no content, no test assertion changed.

### `tools/ci_receipt.sh` — what a receipt is

A receipt is one file, named for a tree sha, in
`/srv/bpkgit/backpack_ragnarok.git/ci-receipts/`. Real example, the one this
REQ's own gate wrote:

    version=1
    tree=3a823e5f4fc9138b3452faeace48bd3fbcc7a8b4
    scope=both
    utc=2026-07-29T09:17:42Z
    seconds=487
    host=llmlocal
    branch=req-0343-push-gate-pre-receive
    head=9f12c4f541d691a6106e4f75b7dbfef30cd29fc1
    dirty=0
    source=tools/release.sh

Nothing in it is secret and nothing in it is a path outside the repo. The
directory is resolved from `remote.origin.url` (`ci_receipt.sh:97`) rather than
hard-coded, so a receipt always lands in the repo it will be checked by —
including in a throwaway clone, which is what made §8 testable at all.

### `tools/ci.sh` — two refusals, and they are the mechanism

`tools/ci.sh:492-518`, below `echo "CI GREEN"` on purpose so nothing in the
block can change what CI GREEN means.

1. **A run with `SKIP_PG` / `SKIP_CLIENT` / `SKIP_E2E` set writes no receipt.**
   Those flags exist for environments missing a dependency, and a run that uses
   them still prints CI GREEN. If they could mint a receipt, the whole gate
   would collapse to `SKIP_E2E=1 tools/ci.sh && git push` — which is worse than
   no gate, because it looks like one. Verified firing, §8 V7.
   A **scope**-skipped stage is emphatically not this case: the scope is
   computed, the receipt carries it, and the hook re-derives the requirement
   and checks it.
2. **Failure to write is loud but NOT fatal.** The verdict of a test gate must
   not depend on a USB disk being plugged in (§7). The consequence of a missing
   receipt is that the push is refused, visibly, with the reason — not that the
   gate lies about the tests.

### `tools/release.sh` — the receipt is re-issued after the dist commit

`release.sh` runs `ci.sh` (which receipts the tree as it stood then), *then*
rebuilds `web/app` and may commit it. That commit moves the tree, so the receipt
`ci.sh` wrote would be for a tree nobody is pushing, and the hook would reject
the very commit `release.sh` just made. `tools/release.sh:47` re-issues.

That is honest **here and only here**, for two reasons stated in the file:
`web/*` classifies `ignored` (`ci_scope.sh` row 1), so the dist commit cannot
change the required scope; and since REQ-0341 the bundle is a pure function of
`client/src` — it reads no `VITE_*` — which `ci.sh` had just built and e2e'd at
`[6/7]`. Same gate, same code. If either stops being true, that line stops being
honest and must go.

The scope is written as the literal `both` rather than read back from anywhere,
so weakening the gate above cannot silently weaken the claim below.

### `[0.6/7]` — the gate watches this gate fail, every run

REQ-0340 is this repo's record of a check that was *assumed* to be a gate while
being a free pass, for three REQs. So `tools/ci.sh:191` runs
`ci_receipt.sh --selftest` (9 checks) and `tools/tests/push_gate_test.py`
(46 checks) on every CI run, ~2 s, offline. The python test builds a real bare
repo in a temp dir, installs the real hook, and asserts on the exit status and
the visible text of real `git push`es — including that the push is **rejected**
with no receipt, with a receipt for another tree, with a copied receipt, and
with a `public` receipt under an admin-touching diff.

---

## 3. It computes. It never asks.

This hook does not read a scope out of the receipt and believe it. It computes
what the pushed range requires and *then* checks the receipt against that. There
is no flag, no commit-message trailer, no `[scope: admin]` convention — nothing
a pusher can assert. The only thing a pusher supplies is a receipt, and a
receipt is a claim about a tree, which the hook verifies is the tree being
pushed.

The classifier is **REQ-0339's `tools/ci_scope.sh`, not a second one**, read out
of the **pushed tree** (`git show <newrev>:tools/ci_scope.sh`) and run in the new
`--classify-stdin` mode. That mode was the only change needed: `ci_scope.sh`
otherwise `cd`s to a worktree and reads `git status`, neither of which exists in
a bare repo. `--classify-stdin` takes the path list on stdin, touches no git
repository at all, and uses the identical table and identical aggregation
(`ci_scope.sh:47-50`, `:193`, `:367`; asserted equivalent in `push_gate_test.py`
V13).

### The pushed tree is judged by its own classifier — deliberately

A push that changes `tools/ci_scope.sh` is judged by the **new** table, not the
one on master. That was a real decision:

- The property that matters is that the hook **agrees with the `ci.sh` run that
  produced the receipt**, and that run used the new table — it was sitting in
  the worktree. Judging by the old one would reject correctly-gated pushes every
  time the table legitimately grows a row (`client/src/newsurface/` plus its
  classification, in one commit, is the normal case), and a gate that rejects
  correct work is a gate that gets disabled.
- The residual risk — a push that weakens the table and is then judged by its
  own weakening — is bounded twice. `tools/ci_scope.sh` classifies **itself** as
  `both` (row 14), so any push touching it needs a full-gate receipt; and
  `ci.sh [0.5/7]` runs `ci_scope.sh --selftest`, so a table that has stopped
  describing the tree fails the gate and **no receipt is written at all**.
- And it is not the weak link anyway: anyone willing to rewrite the classifier
  to smuggle a change past the gate can simply write the receipt (§6).

The **hook body**, by contrast, is the *installed* copy and never the pushed one
(`tools/install_push_gate.sh` states this asymmetry). A hook that arrived in the
push it is judging is not a hook.

---

## 4. Tree binding — why the key is `HEAD^{tree}` and not the commit

A commit sha covers the message, the author, the parents and the date. None of
those can break a test. `git commit --amend` to fix a typo produces a new commit
over an **identical** tree; the gate's verdict is still true, and a
commit-keyed receipt would throw away 480 s for a reworded sentence. Change one
byte of one source file and the tree changes and the verdict really is void.
The tree sha *is* the identity of "the code that was tested".

Measured, both directions (§8 V3):

| | commit | tree | pushed |
|---|---|---|---|
| gated commit | `9f12c4f5` | `3a823e5f` | accepted |
| same code, message reworded | `94794664` | `3a823e5f` | **accepted** |
| one comment line appended to `tools/ci.sh` | `a3b4be13` | `b2947cdf` | **rejected** |

It follows for free that a receipt survives rebase, cherry-pick or a merge that
genuinely reproduces the same content, and dies when it does not.

### The dirty-worktree hole, and how it is closed

`ci_receipt.sh:111`. Running `ci.sh` with uncommitted changes is *normal* here —
`ci_scope.sh` goes out of its way to classify the dirty tree for exactly that
reason. So a naive `git rev-parse HEAD^{tree}` would attest the **committed**
tree while the gate tested the **working** tree, and committing those changes
and pushing would sail through on a receipt for code that was never run. That is
the REQ-0340 free pass in a new place, and it would have been the default.

Instead the receipt is keyed on the **effective tree**: the tree the working
state would produce if committed right now, computed with `git add -A` semantics
in a **scratch `GIT_INDEX_FILE`** so a gate run can never disturb a half-staged
commit. On a clean tree that is exactly `HEAD^{tree}` (asserted, C2). On a dirty
tree it is what `git add -A && git commit` will produce (asserted, C4) — so the
normal *edit → gate → commit → push* loop needs **one** gate run, and any edit
between gate and commit changes the tree and is rejected. `dirty=1` and the HEAD
it was computed over go in the receipt either way.

Consequence worth knowing: if the gate ran dirty and you then `git commit -a`
while an **untracked** file is present, the committed tree will differ from the
receipted one and the push is refused. Fail-closed, and the rejection message
says so.

---

## 5. Fail closed — every case, and what it does

Every uncertainty resolves to `both` (the full gate), never to *accept*.
`set -euo pipefail` is part of this: an unhandled error aborts the hook with a
non-zero status, which **rejects**. There is no path through
`tools/pre_receive_gate.sh` where an unexpected failure lets a push through.

| situation | required scope | asserted |
|---|---|---|
| normal fast-forward to master | whatever the pushed tree's classifier says | V2, V4 |
| **branch creation** (`oldrev` all zeroes) — no base to diff | `both` | V12 |
| **force-push / non-fast-forward** — "the pushed range" is not a range | `both` | V10 |
| **deletion of master** | *refused outright* — a receipt cannot attest a deletion | V7c |
| pushed tree has **no** `tools/ci_scope.sh`, or it is empty | `both` | V9 |
| the classifier fails to run, or prints anything but `admin\|public\|both` | `both` | — |
| `git diff` of the range fails | `both` | — |
| **all paths ignored** (docs-only) | `both` | V8 |
| several refs, one of them gated and failing | whole push rejected, no ref updated | V11 |
| any ref that is not `refs/heads/master` | not gated, allowed, and *said out loud* | V7a/b |

Two of those are worth arguing rather than listing.

**Docs-only pushes cost a full gate.** `ci_scope.sh` returns `both` for an
all-ignored diff, and REQ-0339 §2 gives the reason: a scope that runs no e2e at
all must not be reachable by accident. So a `git mv` of a REQ file between
status folders needs a `both` receipt before it can reach master. That is the
single largest operational cost of this REQ and it is real. It was **not**
special-cased here on purpose: the fix, if one is wanted, belongs in
`ci_scope.sh` where the one classifier lives, not in a second rule inside the
hook. Note also that `web/*` is `ignored`, so an "ignored means free" shortcut
would let an arbitrary `web/app` bundle reach master ungated — which is
precisely the REQ-0266/0337 accident.

**Multiple refs are all-or-nothing.** `pre-receive` runs once for the whole
push, so a non-zero exit rejects every ref in it, including ungated ones
(V11c: the feature branch in the same push was not created either). The
alternative is the `update` hook, which is per-ref; all-or-nothing was kept
because a half-applied push is a state nobody reasons about.

---

## 6. The honest limit — receipts are forgeable, and this is not a wall

**Receipts are ordinary files written by the same unix user that pushes. Anyone
who can push can fabricate one, with one command. This hook does not detect
that and cannot.**

§8 V4 does it deliberately, in one line, to show the shape of it:

    $ bash tools/ci_receipt.sh write public 1 'hand-written, NOT a real gate run'
    [ci-receipt] WROTE scope=public tree=16f74044... -> /srv/bpkgit/.../ci-receipts/16f74044...

What this mechanism actually buys is a change in the **shape** of the failure.
Skipping the gate stops being something that happens by forgetting and becomes
something you have to do on purpose, by name, in a way that leaves a file with
your hostname and a timestamp in it. **"I forgot" becomes "I deliberately
lied."** That is the failure mode worth raising, and raising it is the whole
claim. Nothing more is claimed.

This is stated in three places rather than one, because a limit that lives only
in a document is a limit nobody reads: in `ci_receipt.sh`'s header, in **every
acceptance line** the hook prints (`a receipt is a memory aid, not proof: it is
forgeable by anyone who can push`), and in **every rejection message**.

**The known upgrade path**, deliberately not built here: a receipt store owned
by a unix user the pusher cannot write as — a `bpkci` user owning
`ci-receipts/`, with `ci.sh` reaching it through a narrow `sudoers` entry or a
socket-activated helper that only ever appends `<tree> <scope>` after running
the gate itself. That is what would make this a wall. It is a different REQ: it
needs a second account, a privilege boundary, and a decision about what happens
when the helper is unavailable. Everything in this REQ is compatible with it —
only `receipt_dir()` and the write path would change.

A weaker but cheap increment also not taken: append-only receipts (`chattr +a`,
or a log the hook reads instead of a directory). It raises the cost of erasing
history but not of writing a false entry, which is the operation that matters.

---

## 7. What changes operationally

### master now advances by push to `origin`

Before this REQ, master advanced by `git merge` in the main checkout
`~/backpack_ragnarok`. That path still exists and is **not gated** — a local
merge writes to the local `refs/heads/master` and no hook sees it. What is gated
is `git push origin … master` into `/srv/bpkgit/backpack_ragnarok.git`, which is
now where master-as-published lives. **The gate is on publication, not on the
local ref**, and that distinction is not cosmetic: it is why this REQ can be
landed at all without touching the main checkout, and it is the gap someone
would fall through by merging locally and never pushing.

### If the external disk is not plugged in

`/etc/fstab:7` mounts it `nofail,x-systemd.device-timeout=10`, so the box boots
without it and `/srv/bpkgit` is simply an empty directory on the root
filesystem. Tested by pointing every consumer at a path that does not exist —
**not** by unmounting, which the boundaries for this REQ forbid, so treat this
as a faithful simulation rather than a physical test:

    $ bash tools/ci_receipt.sh write both 1 tools/ci.sh          # BPK_RECEIPT_DIR=<absent>
    [ci-receipt] receipt directory '…/ci-receipts' does not exist (external disk not mounted?) -- no receipt written
    rc=1
    $ git push <absent>/backpack_ragnarok.git HEAD:refs/heads/master
    fatal: '…/backpack_ragnarok.git' does not appear to be a git repository
    rc=128
    $ bash tools/install_push_gate.sh --check <absent>/backpack_ragnarok.git
    [push-gate] '…/backpack_ragnarok.git' does not exist (external disk not mounted?)
    rc=1

So with the disk out: **the gate still runs and still tells the truth**, it
just cannot record; **nothing can be published**; and `offsite` is unaffected
(verified reachable in the same run). That is the right failure — the disk is a
publication dependency, not a testing dependency. `ci.sh` is explicitly written
so a green gate never depends on it (`ci.sh:492-518`).

### the `offsite` mirror keeps its role, ungated

`offsite` (`git@github.com:Dary1/backpack_ragnarok.git`) is untouched by all of
this — a `pre-receive` hook is a property of the receiving repository, and this
one was installed on `/srv/bpkgit/…` only. It remains the **off-box copy**: the
thing that survives the SSD failing, the box failing, or someone deleting
`/srv/bpkgit`. It is deliberately **not** gated:

- GitHub cannot run this hook, and no client-side substitute would be a gate
  (§1);
- gating the backup would mean a red gate can cost you your off-site copy,
  which is exactly backwards;
- and it is not the deploy line. Nothing reads `offsite`.

Its role is therefore *durability*, and `origin`'s role is *publication with a
gate*. Two remotes, two jobs, stated so nobody later "tidies" one into the other.
Verified still working, §8 V6.

### hook drift is not machine-checked

The installed hook is a **copy** of `tools/pre_receive_gate.sh`.
`tools/install_push_gate.sh --check` compares them byte for byte and reports
drift, but nothing runs it automatically, because the only place it could run —
`ci.sh` — must not acquire a dependency on the external disk (above). **This is
a real hole and it is listed rather than papered over**: an edited or deleted
`hooks/pre-receive` is invisible until someone checks. Running `--check` is
cheap and is the recommended first line of any session that touches this
machinery.

---

## 8. Verified — with the gate actually failing

Everything below is real output. `master` on the real bare repo was **1e6e2fd
before and 1e6e2fd after**, never moved, never merged. Accept-path pushes were
run against a byte-identical throwaway clone (`git clone --bare`, same hook
installed, `ci-receipts` symlinked to the real store); the real repo's accept
path was additionally proven by feeding the **installed** hook the exact stdin a
master push produces.

### V1 — no receipt ⇒ rejected (real repo, real `git push`)

    $ git push origin HEAD:refs/heads/master
    remote:  PUSH REJECTED -- refs/heads/master is gated and this tree has no valid CI receipt
    remote:  ref              refs/heads/master
    remote:  commit           9f12c4f5  REQ-0343: push gate -- CI receipts + pre-receive hook
    remote:  tree             3a823e5f4fc9138b3452faeace48bd3fbcc7a8b4
    remote:  required scope   both
    remote:                   (computed by the PUSHED tree's tools/ci_scope.sh over 8 changed path(s))
    remote:  receipt          NONE
    remote:                   looked for: /srv/bpkgit/backpack_ragnarok.git/ci-receipts/3a823e5f…
    remote:  the classifier said:
    remote:    [ci-scope] both (admin+public) -- base=<stdin>, 8 path(s): 0 admin, 0 public, 7 shared, 1 ignored, 0 unclassified
    …TO FIX / HONEST LIMIT blocks…
    remote: [push-gate] v1 -- push rejected, NO ref was updated.
     ! [remote rejected] HEAD -> master (pre-receive hook declined)
    PUSH rc=1
    master AFTER:  1e6e2fd76aee30efbea212e17de9c26b5726f109

### V2 — run the gate, push the same tree ⇒ accepted

`tools/release.sh` **CI GREEN** (§ Gate results) wrote
`ci-receipts/3a823e5f…` with `scope=both`. The same stdin that produced V1 then
produced, against the same installed hook, with master still at 1e6e2fd:

    [push-gate] refs/heads/master OK -- required 'both' (computed by the PUSHED tree's tools/ci_scope.sh over 8 changed path(s))
    [push-gate]   tree 3a823e5f…, receipt scope='both' issued 2026-07-29T09:17:42Z by tools/release.sh on branch req-0343-push-gate-pre-receive
    [push-gate]   (a receipt is a memory aid, not proof: it is forgeable by anyone who can push)
    SIMULATED HOOK EXIT=0

and a real push of that tree to the throwaway clone's master:

    remote: [push-gate] refs/heads/master OK -- required 'both' …
    To /tmp/bpk_gate_scratch.git
       1e6e2fd..9f12c4f  HEAD -> master
    push rc=0

### V3 — a receipt for a different tree ⇒ rejected (tree binding)

    receipted tree : 3a823e5f4fc9138b3452faeace48bd3fbcc7a8b4
    this tree      : b2947cdf7f314514a87b5fe14de27b3763b06f61     # one comment line appended to tools/ci.sh
    remote:  commit           a3b4be13  probe: one comment line appended to tools/ci.sh
    remote:  tree             b2947cdf7f314514a87b5fe14de27b3763b06f61
    remote:  receipt          NONE
    remote:                   looked for: …/ci-receipts/b2947cdf7f314514a87b5fe14de27b3763b06f61
     ! [remote rejected] HEAD -> master (pre-receive hook declined)

and the other direction, same run — reword the message, tree unchanged:

    old commit 9f12c4f5… tree 3a823e5f4fc9138b3452faeace48bd3fbcc7a8b4
    new commit 94794664… tree 3a823e5f4fc9138b3452faeace48bd3fbcc7a8b4
       1e6e2fd..9479466  HEAD -> master
    push rc=0

`push_gate_test.py` V3d additionally proves a receipt **copied** onto another
tree's filename is ignored (`tree=` field disagrees with the name) — an
accident check, not a security one, since a forger would write both fields.

### V4 — a `public` receipt on a diff that touches admin ⇒ rejected

A `public` receipt was hand-written for the tree — the forgery of §6, used here
as the test instrument:

    $ git diff --name-only <scratch-master>...HEAD
    client/src/artadmin/__req0343_probe.ts
    $ bash tools/ci_receipt.sh write public 1 'REQ-0343 verification (hand-written, NOT a real gate run)'
    [ci-receipt] WROTE scope=public tree=16f74044…

    remote:  required scope   admin
    remote:                   (computed by the PUSHED tree's tools/ci_scope.sh over 1 changed path(s))
    remote:  receipt          FOUND but scope='public', which does not cover 'admin'
    remote:  the classifier said:
    remote:    [ci-scope] admin (admin only) -- base=<stdin>, 1 path(s): 1 admin, 0 public, 0 shared, 0 ignored, 0 unclassified
     ! [remote rejected] HEAD -> master (pre-receive hook declined)

Replacing it with an `admin` receipt for the same tree — nothing else changed —
is accepted. **The hook computed `admin` from the pushed tree and refused the
pusher's narrower claim.** That is the whole design in one exchange.

### V5 — `git push --no-verify` ⇒ still rejected (real repo)

    $ git push --no-verify origin HEAD:refs/heads/master
    remote:  PUSH REJECTED -- refs/heads/master is gated and this tree has no valid CI receipt
    remote:  required scope   both
     ! [remote rejected] HEAD -> master (pre-receive hook declined)
    master AFTER: 1e6e2fd76aee30efbea212e17de9c26b5726f109

The claim in §1 was checked rather than believed: `push_gate_test.py` V6c/V6d
installs a client-side `pre-push` hook that echoes `CLIENT-HOOK-RAN` and exits
1, then shows a normal push blocked by it, and `--no-verify` **skipping that
hook while still being rejected by pre-receive**. Both halves, one test.

### V6 — `offsite` (GitHub) still works

A **`--dry-run`**, not a real push — deliberately, to keep GitHub quiet. It is a
full ref negotiation with the real remote, so it proves reachability and
non-interference:

    $ git push --dry-run offsite HEAD:refs/heads/req-0343-push-gate-pre-receive
    To github.com:Dary1/backpack_ragnarok.git
       9bd9419..9f12c4f  HEAD -> req-0343-push-gate-pre-receive
    rc=0

### V7 — the two refusals inside `ci.sh` fire

    $ SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh
    …
    CI GREEN
    [ci-receipt] NOT WRITTEN -- this run set SKIP_PG/SKIP_CLIENT/SKIP_E2E, so CI GREEN
                 does not mean the whole gate ran. The push gate will reject this tree.
    === receipts after: ===   (unchanged: only 3a823e5f… present)

and the write-failure path, `ci.sh`'s exact construct under `set -euo pipefail`:

    [ci-receipt] receipt directory '/nonexistent/ci-receipts' does not exist (external disk not mounted?) -- no receipt written
    [ci-receipt] NOT WRITTEN (see above). CI is still GREEN; the push gate will reject this tree until a receipt exists.
    SCRIPT CONTINUED, exit 0

### V8 — the machine checks

    $ bash tools/ci_receipt.sh --selftest        ->  9 PASS, GREEN
    $ python3 tools/tests/push_gate_test.py      ->  46 passed, 0 failed  (1.1 s)
    $ bash tools/ci_scope.sh --selftest          ->  11 PASS (S1a-S6), GREEN
    $ python3 tools/tests/ci_scope_test.py       ->  20 passed, 0 failed
    $ bash tools/install_push_gate.sh --check    ->  installed and identical

### What is NOT verified

- **Nothing here was pushed to master.** The real bare repo's accept path was
  proven by running the installed hook on the exact stdin (exit 0) and by real
  pushes to a byte-identical clone — not by moving master.
- **The disk was never physically unplugged** (§7 is a simulation with absent
  paths; unmounting is out of scope for this REQ).
- **Every push tested went over a local path**, which is the production path
  (`origin` is `/srv/bpkgit/…`). The hook has not been exercised over ssh; it
  would be the same `receive-pack`, but it has not been run that way.
- **Hook drift is not machine-checked** (§7), only checkable on demand.
- **Concurrent pushes** from two sessions were not tested. `receive-pack` locks
  each ref, and the hook only reads, so no problem is expected — but expected is
  not measured.
- **No receipt proves a gate ran.** §6.

---

## 9. Deliberately NOT done

- **Not merged, not deployed, master untouched.** Stops at `built/`.
- **No second classifier.** REQ-0339's table is the only one; the hook adds a
  mode to it, not a copy of it.
- **No signing, no append-only store, no privileged receipt user.** §6 says why
  the first is theatre and records the third as the real upgrade.
- **No gating of feature branches or tags.** §1.
- **No docs-only fast path.** §5, and if wanted it belongs in `ci_scope.sh`.
- **`release.sh`'s always-full-gate behaviour not weakened** — it still forces
  `CI_SCOPE=both` (`release.sh:18`) and now also records that it did.
- **Nothing added to the main checkout**, no service restarted, `/srv/bpkgit`
  neither reformatted nor unmounted.

---

## Log
- 2026-07-29 reserved as REQ-0343 on branch `req-0343-push-gate-pre-receive`
  (off master 1e6e2fd).
- 2026-07-29 implemented (9f12c4f). Hook installed at
  `/srv/bpkgit/backpack_ragnarok.git/hooks/pre-receive`. Six verifications run
  with the gate actually failing (§8); `master` left at 1e6e2fd throughout.
  The dirty-worktree hole in §4 was found while designing the receipt key and
  closed before anything was written; `push_gate_test.py` V8a caught a wrong
  *test* assumption (not a code defect) on the first run and was corrected.
  reserved -> built.
- 2026-07-29 the two docs commits above (1d667a0, 8b11da8) moved the tree to
  `cbeab9b4`, so the `3a823e5f` receipt no longer covers the branch tip -- confirmed
  by running the installed hook against it, which rejects. That is §4 working, not a
  defect: whoever merges this to master runs `tools/release.sh` on the merge result
  and pushes that. No receipt for a tree nobody is publishing.

## Gate results (2026-07-29)
- Syntax: `bash -n` clean on `tools/{ci,ci_scope,release,ci_receipt,pre_receive_gate,install_push_gate}.sh`.
- `tools/ci_scope.sh --selftest` 11/11 PASS · `tools/tests/ci_scope_test.py` **20 passed, 0 failed**.
- `tools/ci_receipt.sh --selftest` **9 PASS, GREEN** · `tools/tests/push_gate_test.py` **46 passed, 0 failed**.
- `tools/release.sh` — **CI GREEN**, 487 s wall (479.7 s summed over 76 stages),
  `dist unchanged -- nothing to commit`. Full gate as designed:

      [ci-scope] admin+public (both) -- forced by CI_SCOPE env: admin e2e AND client e2e will run

  Counts: admin trio **8 / 1 / 28**, registry **4/4**, default e2e **206 passed
  / 0 failed / 1 skipped** — identical to the pre-REQ baseline. Top stages
  `[7/7]` 204.5 s, `[6.5/8]` 188.3 s, `[6.6/8]` 11.4 s, `[0.6/7]` ~2 s.
- The run's own receipt: `scope=both tree=3a823e5f… seconds=487 source=tools/release.sh`.
