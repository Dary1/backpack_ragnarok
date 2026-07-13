# REQ-0162 — cowork-mount-truncation (eliminate LLM tail truncation)

**Reserved:** 2026-07-14
**Slug:** cowork-mount-truncation
**Status:** the folder this file sits in. No status field is kept here.

## Problem

LLM sessions repeatedly shipped files to the server with their tails cut off
("tail truncation"). Nothing ever errored: the write tool reported
success and the damaged file was committed. The cause was unknown and the
program had no rule against whatever was producing it.

## Root cause (measured 2026-07-14, not assumed)

The Cowork sandbox exposes **two filesystems**, and the failure lives in the
seam between them.

- **Sandbox native fs** (`/tmp`, `~` in the sandbox) — a normal Linux fs.
  git works. The Read/Write/Edit tools cannot see it.
- **Cowork mount** (`/sessions/*/mnt/...` — the bridge to the Windows-side
  folders) — the only thing Read/Write/Edit can see. It is defective.

**Defect 1 — stale size cache.** The mount caches a file's SIZE and never
refreshes it when the Windows-side tools write. A Write/Edit that GROWS a file
is read back by bash **clipped to the old size**; one that SHRINKS a file is read
back **NUL-padded** to the old size. The stale size is permanent (`sleep`,
`ls -l`, re-`stat`, reopen do not clear it), and `cp`/`scp`/`rsync` then copy the
truncated view to the server, where it becomes real. No error is raised at any
point. Measured: a 5-byte file written with 47 bytes by the Write tool reads back
as 47 bytes via the Read tool and as 5 bytes (`THIS_`) via bash. An 801-line file
edited with Edit lost **exactly** the number of bytes the edit added, off the end.

**Defect 2 — git cannot run on the mount.** `git init`/`git clone` there fail with
`fatal: bad config line 1` because `.git/config` is written as NUL bytes. Granting
Cowork delete permission does not fix it. The same clone into the sandbox native
fs succeeds.

**Secondary mechanism — output token cap.** Independent of the mount: whole-file
writes (the Write tool, or `cat > f <<'EOF'`) place the entire file into the
model's output, so long files are cut mid-stream while the tool still reports
success. This is why edits must travel as diffs even once the mount is out of the
picture.

Full evidence, measurement table and reproduction:
`docs/llm_managed/2026-07-14-mount-truncation.md`.

## Decision (user, 2026-07-14)

The server worktree stays exactly as it is: **the one and only working copy**, and
the place where changes land and where every gate runs. Nothing about the existing
infrastructure was wrong. What was missing is a single prohibition:

> **NEVER PUT CODE ON THE COWORK MOUNT.** Edits travel as diffs, composed in the
> sandbox native fs (`/tmp`) and applied with `git apply` inside the server
> worktree. Never rewrite whole files. Run every gate on the server.

This **overrides Cowork's own default guidance** ("prefer the file tools over
shell commands for file operations"), which in this project silently corrupts
files. The rule states that override explicitly, because a bare imperative with no
stated reason loses to a competing instruction the moment the agent finds a
plausible local excuse to deviate.

A `/tmp` clone of the worktree is permitted **only as a read cache** for heavy
grepping, and must never be committed to. It is an optimisation, not part of the
loop.

## Deliverables

1. `docs/llm_managed/2026-07-14-mount-truncation.md` — the evidence: both mount
   defects, the measurement table, the token-cap mechanism, and the verified loop.
2. A short **"Where to edit — NON-NEGOTIABLE"** block in `PROJECT.md`, placed
   after `## Infrastructure` and before `## REQ Management Policy`. PROJECT.md
   forbids AI edits, so the block is pasted by the user; it is not part of this
   branch. It carries the rule, one line of mechanism, and a pointer to (1).

## Gates

- Reproduced the truncation deterministically, in both the grow and shrink
  directions, on both the outputs scratch and the user folder. PASS
- Confirmed the Read tool (Windows path) sees the correct bytes while bash (mount)
  sees the truncated ones — i.e. the file itself is fine and the **mount view** is
  the liar. PASS
- Confirmed `git clone`/`git init` fail on the mount and succeed in the sandbox
  native fs, with delete permission granted in both cases. PASS
- Ran the replacement loop end to end: 801-line file, one line replaced with a
  **longer** line via a unified diff + `git apply` on the server -> still 801
  lines, tail intact, `node --check` PASS.
- This REQ and its evidence doc were themselves authored under the new rule
  (bash-only writes, verified on the server): 109 lines in, 109 lines out. PASS

## Outcome

Merged to master. The rule is in PROJECT.md; the evidence is in
`docs/llm_managed/`. Truncation is now structurally impossible in the sanctioned
loop: no whole file ever passes through the model's output, and no repo file ever
touches the mount.

Note for future sessions: every mechanism this investigation *asserted* without
measuring was wrong (token cap, "the Edit tool is buggy", "unlink is denied").
Every claim that was *measured* held. Measure.
