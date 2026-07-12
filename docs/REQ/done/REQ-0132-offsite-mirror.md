# REQ-0132 — offsite-mirror

**Reserved:** 2026-07-12
**Slug:** offsite-mirror
**Directive:** user order (2026-07-12 chat): create the offsite-mirror REQ and
set it up to run automatically. That order is the ratification; no further
approval gate before implementation. Integration ownership was delegated to
the orchestrator in the same chat.

## Problem

The entire project (git history, docs, REQ board) lived on llmlocal with no
git remote and no backup automation. Two prior loss events (gen1 rollback
data loss; req-0073 branch-ref clobbering during a server restore) made this
the top program risk (2026-07-12 risk-analysis session).

## Decision record

- Mirror target: `github.com:Dary1/backpack_ragnarok` (private — verified 404
  anonymously, 2026-07-12).
- Auth: repo-scoped GitHub deploy key `backpack-github-mirror`
  (`SHA256:DTKBTANMdRmk35YIjgyMShXG8fPsUltKpY6l1bKcD3k`), private half at
  `~/.ssh/backpack_github_ed25519` on llmlocal ONLY, wired via `~/.ssh/config`
  (`IdentitiesOnly yes`). Write access enabled by the user, 2026-07-12. The
  key the user first registered (`SHA256:kbF4…`) had no private half available
  on the FS or the server; superseded by this one (user confirmed in chat).
- Remote name: **`offsite`** — llmlocal remains the source of truth; GitHub is
  a backup mirror, never a collaboration origin. Nothing may fetch/rebase from
  it as a workflow.
- Push semantics: `git push --all` + `git push --tags`. Deliberately NOT
  `--mirror`/`--prune`/`--force`: local damage must never propagate deletions
  to the mirror. Stale branches on the mirror are acceptable and pruned only
  by hand.
- Pre-push audit (2026-07-12): no blobs > 20 MB anywhere in history; the only
  secret-ish filename ever committed is `server/.env.example`. Safe to mirror.

## Implementation

- `tools/offsite_mirror.sh` — flock-guarded; pushes all heads + tags of
  `~/backpack_ragnarok` (worktree branches share one object DB, so all REQ
  branches are covered); writes a daily tarball of
  `~/backpack_ragnarok_state/` to `~/.local/state/backpack_mirror/` (keep 14);
  stamps `~/.local/state/backpack_mirror/last_success` on success.
- `tools/systemd/backpack-mirror.service` + `backpack-mirror.timer` —
  committed in-repo for recoverability; installed by copying to
  `~/.config/systemd/user/`, then `systemctl --user enable --now
  backpack-mirror.timer` (linger already on). Cadence: every 15 min
  (`OnCalendar=*:0/15`, `Persistent=true`) + 2 min after boot.

## Recovery notes

- Full restore after box loss: clone the mirror, re-create worktrees as
  needed, re-install the systemd units from `tools/systemd/`.
- The REQ counter (`~/backpack_ragnarok_state/`) is NOT in git by policy.
  After total box loss, re-seed from the restored board:
  `python3 tools/touch_next_req_reserved.py --seed-only --reconcile-root …`.
  The daily tarball is on-box convenience only.
- FS-side `.keys/` are not covered here (they are not on the server by
  design); FS backup remains the user's responsibility.

## Gate results

- bash -n: OK. shellcheck: 1 info (SC2012) accepted — tarball names are
  generated and date-based, no hostile filenames possible.
- systemd-analyze --user verify: clean after unit files set 644; the
  "ExecStart not executable" warning pre-merge was expected (unit points at
  the master copy) and re-verified clean after merge + install.
- Live push (2026-07-12, pre-merge from branch): mirror OK — master=a44627e,
  47 branches + tags accepted by github.com:Dary1/backpack_ragnarok.
- Post-merge: timer enabled + service run verified (see below; last_success
  stamp written).
