# 2026-07-14 — Cowork mount silently truncates files (root cause of tail truncation)

Premise: the Cowork mount truncates on Windows-write -> Linux-read (stale size cache) and cannot host git.
Expires-when: a coherence retest passes after a Cowork update -- then retire the PROJECT.md rule with it.

Status: measured and reproduced. Rule lives in PROJECT.md ("Where to edit — NON-NEGOTIABLE");
this file is the evidence behind it.

## The environment has two filesystems

- **Sandbox native fs** — `/tmp`, `~` inside the Cowork Linux sandbox. A normal Linux fs.
  Everything works, including git (clone / commit / push, verified against the server).
  The Read/Write/Edit tools CANNOT see it.
- **Cowork mount** — `/sessions/*/mnt/...`, the bridge to the Windows-side folders
  (the outputs scratch and the user folder). This is the ONLY thing Read/Write/Edit see.
  It is defective in two independent ways.

Confusing the two is what produced the tail-truncation bug.

## Defect 1 — stale size cache (the actual cause of tail truncation)

bash and the Read/Write/Edit tools reach the same file by different paths. The mount caches
a file's SIZE and never refreshes it when the Windows-side tools write to that file.

- Write/Edit GROWS a file  -> bash reads it CLIPPED to the old size. Tail lost.
- Write/Edit SHRINKS a file -> bash reads it NUL-padded out to the old size.
- Permanent. `sleep`, `ls -l`, re-`stat`, reopen do not refresh it.
- `cp` / `scp` / `rsync` copy the truncated view. That is how the corruption reaches the
  server and becomes real.
- Nothing errors. The tool reports success.

### Measurements

| test | setup | Read tool sees | bash sees |
|---|---|---|---|
| grow | 5-byte file, Write tool writes 47 bytes | 47 bytes (correct) | 5 bytes (`THIS_`) |
| shrink | 5-byte file, Write tool writes `AB` | `AB` (correct) | 5 bytes: `AB` + 3 NULs |
| real edit | 673-byte file, Edit adds 7 bytes at line 30 | correct | 673 bytes, tail cut by exactly 7 |
| real edit | 801-line file, Edit lengthens line 400 | correct | last line gone entirely; `git diff` on the server after `scp` showed `-module.exports = ...` |

The number of bytes lost off the end equals exactly the number of bytes the edit added.
Reproduced on both the outputs scratch and the user folder. Full Read vs partial Read
(offset/limit) makes no difference.

Control: bash writing and bash reading the same mounted file is coherent (5 -> 16 bytes OK).
bash write -> Read tool is also coherent. **The only broken direction is
Windows-side write -> Linux-side read.**

## Defect 2 — git cannot run on the mount

`git init` and `git clone` onto the mount fail:

    fatal: bad config line 1 in file .../.git/config

`.git/config` is written as NUL bytes. Granting Cowork delete permission does NOT fix it —
the accompanying `unable to unlink config.lock: Operation not permitted` warning is a side
effect, not the cause (plain `mv` on the mount works fine and preserves content). The same
clone into the sandbox native fs succeeds.

## Secondary mechanism — output token cap

Independent of the mount: whole-file writes (the Write tool, or `cat > f <<'EOF'`) put the
entire file into the model's output. Long files get cut mid-stream and the tool still
reports success. Diffs are small and immune. This is why edits must travel as diffs even
after the mount is out of the picture.

## Verified working loop

The server worktree stays the one and only working copy. The sandbox only composes the patch.

    K=~/.ssh/backpack_ed25519; S=qtie@192.168.0.6
    WT=~/backpack_ragnarok_worktrees/req-00NN-slug

    # 1. read straight from the server
    ssh -i $K $S "sed -n '380,420p' $WT/path/to/file.js"

    # 2. the model emits ONLY a unified diff; bash writes it to the sandbox NATIVE fs
    cat > /tmp/fix.patch <<'PATCH'
    --- a/path/to/file.js
    +++ b/path/to/file.js
    @@ -398,5 +398,5 @@
     // context
    -old line
    +new line
     // context
    PATCH

    # 3. apply INSIDE the worktree, and verify THERE
    scp -i $K /tmp/fix.patch $S:/tmp/fix.patch
    ssh -i $K $S "cd $WT && git apply /tmp/fix.patch && git diff --stat && \
      bash -lc 'node --check path/to/file.js'"

A `git clone` of the worktree into `/tmp` (sandbox native fs, where git fully works) is an
OPTIONAL read cache for heavy grepping. If used, NEVER commit there: writes always go back
to the worktree as a patch. It is a cache, not a second source of truth.

Proof runs (2026-07-14): (a) 801-line file, one line replaced with a LONGER line via
`git apply` in a server worktree -> 801 lines, tail intact, `node --check` OK. (b) the same
edit made with the Edit tool on the mount and shipped by `scp` arrived truncated, short by
exactly the number of bytes the edit added.

## Notes

- Verification must run ON THE SERVER. Sandbox-side `wc` / `md5sum` / `diff` can read the
  stale view and will "confirm" a file that is actually broken.
- `git push` into a branch checked out in a worktree is refused by git. Ship patches, or
  push to a temp branch and `git merge --ff-only` inside the worktree.
- `node` is under nvm on the server; a non-login ssh shell has no `node` on PATH.
  Use `ssh ... 'bash -lc "..."'`.
- Cowork's own default guidance ("prefer the file tools over shell commands for file
  operations") is WRONG in this project. That is precisely why the PROJECT.md rule has to
  state that it overrides it.
