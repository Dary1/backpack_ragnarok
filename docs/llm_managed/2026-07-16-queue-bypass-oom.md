# 2026-07-16 — llmlocal OOM lockout: a matte run outside the job queue

**Impact.** llmlocal became fully unreachable for ~20 minutes: SSH refused at
banner exchange, physical console login unusable. Recovered only by SysRq
`s`-`u`-`b` at the keyboard. `journalctl -b -1` records **55 oom-kill events**.

**Cause.** During REQ-0193 verification an agent ran a standalone smoke script:

    ~/backpack_ragnarok/.venv/bin/python /tmp/smoke.py     # ART_KIT_MATTE_METHOD=auto

`auto` is the real rembg `birefnet-general` path (~12 GB RSS). The box has
23 GB. Whatever else was resident (a ComfyUI art session is ~11 GB, and the
user runs art separately by standing policy) plus birefnet exceeded RAM, and
the machine went into swap thrash — a state where even `login` cannot fork.

**The real fault is not "forgot to check free RAM".** `server/services/
art_jobs.cjs` already prevents exactly this, structurally:

    function pump() {
      if (running) return;   // single-flight: ONE python job at a time, ever
      ...
    }

Generation, inspection, pack and cutout all funnel through `pump()`, so
birefnet can never land on top of an in-flight ComfyUI job. That single flag
is the codified form of the conclusion REQ-0135b and REQ-0158 reached the hard
way. The smoke script started python from `/tmp`, outside `art_jobs.cjs`
entirely — **it bypassed the one interlock that exists to prevent this.** No
amount of pre-flight RAM checking is the lesson; using the queue is.

**Aggravating factor: the spec invited it.** REQ-0193's Verification section
as first written said "cutout_job.py smoke (borderkey + real birefnet)". A
standalone smoke of the *real model* is by definition a queue bypass. The spec
recommended the mine that was then stepped on. Fixed in the same commit.

## Rules this establishes

1. **Never start a matte / inspection / generation python by hand.** Not from
   `/tmp`, not from a worktree, not "just once to check". If it loads a model,
   it goes through the queue.
2. **Verify a real-model path through its API endpoint**, which enqueues and
   serialises (`POST .../renders/:seed/cutout`, `.../repack`, `.../generate`).
   This is also the production path, so it is the better test anyway.
3. **Standalone python is fine ONLY when model-free.**
   `ART_KIT_MATTE_METHOD=borderkey` is pure numpy; it is the intended way to
   exercise matte-consuming logic in tests, e2e, and smokes.
4. **A spec's Verification section is not exempt.** If a verification step
   requires bypassing an interlock, the step is wrong, not the interlock.

## Recovery reference (for the next person locked out)

SysRq is kernel-side and needs no login — it is the correct tool here, and it
is strictly safer than cutting power because it flushes first:

    Alt+SysRq+f      # manual OOM kill. Ubuntu default kernel.sysrq=176
                     # does NOT include 64/oom-kill, so expect this to no-op.
    Alt+SysRq+s      # sync            (16 — in 176)
    Alt+SysRq+u      # remount read-only (32 — in 176)
    Alt+SysRq+b      # reboot          (128 — in 176)

Always `s` -> `u` -> `b`, in that order. Uncommitted worktree writes older than
~30 s (`dirty_expire_centisecs`) are already on disk and survive either way;
in this incident all nine modified files plus the new `tools/cutout_job.py`
came back intact.

Services need no hand-holding after reboot: `backpack-api` / `backpack-web` /
`backpack-tunnel` are **user** units with linger on, so they self-start. Check
them with `systemctl --user is-active` (they are not-found at system level —
a system-level check will mislead you into thinking they died).
