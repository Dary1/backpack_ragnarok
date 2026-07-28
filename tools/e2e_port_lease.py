#!/usr/bin/env python3
"""tools/e2e_port_lease.py -- REQ-0323. Runtime port-block LEASE allocator.

Replaces the REQ-derived port rule (PORT = 5000 + REQ*10 + index, REQ-0172 /
REQ-0251 / REQ-0321). That rule's promise was "derived ports cannot collide",
which held only while every harness obeyed it -- so it needed a gate, and the
gate was found defective twice in one day (REQ-0321: it never read the configs;
REQ-0322: its port pattern could not match `E2E_PROXY_PORT=`). It also dragged a
permanent tail of arithmetic: a base, a ceiling pinned to the kernel's ephemeral
floor, two poisoned decades, and a REQ-2775 wall. None of that is about testing
anything.

CHECK REALITY INSTEAD OF PREDICTING IT. Ask the OS what is free, take it, write
down that you took it.

THE LEDGER IS A HINT. REALITY IS THE AUTHORITY.  (REQ-0323 sec.9, owner
requirement 2026-07-27: a lease must never be able to hold an idle block.)
Whether a block is usable is decided by BINDING ITS PORTS, never by trusting a
lease file. The lease exists for exactly one purpose: to cover the few
milliseconds between "I chose this block" and "I bound it". Everything below is
arranged so that a lease can be wrong for at most GRACE_SECONDS.

EXCLUSION IS O_EXCL AND NOTHING ELSE (sec.2.2). Creating the lease file with
O_CREAT|O_EXCL is atomic in the kernel, so two racing allocators cannot both
win: the loser's create fails and it walks to the next block. No flock, no lock
file, no queue -- an earlier draft proposed flock and it was cut as
over-engineering. This is the same primitive tools/touch_next_req_reserved.py
already uses for its issued/NNNN markers.
"""
from __future__ import annotations

import argparse
import errno
import json
import os
import socket
import sys
import time

# ------------------------------------------------------------------ pool -----
# The pool is described by exactly THREE named constants, one per dimension, so
# that a different reading of "10 sets" costs one line. (The owner said "10
# sets"; that is implemented here as 10 ports per block and 100 blocks -- about
# ten concurrent agents at ~5 blocks each, with 2x headroom.)
POOL_START = 9000        # first port of the pool
BLOCK_SIZE = 10          # ports per leased block (indexes 0..BLOCK_SIZE-1)
BLOCK_COUNT = 100        # number of aligned blocks in the pool
POOL_END = POOL_START + BLOCK_SIZE * BLOCK_COUNT - 1  # 9999, inclusive

# The ONLY tunable in this design (sec.9.3). It is the "chosen but not yet
# bound" allowance and nothing else: without it, allocator A leases a block and
# allocator B -- seeing no sockets yet -- would decide A's lease is bogus and
# steal it. Do not raise it without a measured reason, and do not remove it.
GRACE_SECONDS = int(os.environ.get("E2E_PORTS_GRACE", "60"))

# Index convention inside a block. Unchanged from the derived era on purpose, so
# no harness body changes: 0 = static, 1 = api, 2 = proxy, 3 spare,
# 4..9 = e2e fleet workers (E2E_PARALLEL <= 6 still fits a block).
IDX_API, IDX_PROXY, IDX_FLEET = 1, 2, 4

# Host-local, outside every git tree, sibling of the existing REQ-number
# allocator state dir. E2E_PORTS_STATE_DIR is a TEST seam only.
STATE_DIR = os.environ.get("E2E_PORTS_STATE_DIR") or os.path.join(
    os.path.expanduser("~"), "backpack_ragnarok_state", "e2e_ports")

BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id"
TAG = "[e2e-ports]"


def boot_id() -> str:
    """Identity of the current boot.

    Recorded in every lease because PIDS ARE REUSED ACROSS A REBOOT. A lease
    naming pid 1234 can find an unrelated live pid 1234 after a restart and hold
    its block FOREVER -- the exact failure the owner asked us to prevent, and
    the one a naive pid check makes worst.
    """
    try:
        with open(BOOT_ID_PATH, "r") as fh:
            return fh.read().strip()
    except OSError:
        return ""


BOOT_ID = boot_id()


# ------------------------------------------------------- reality, not ledger --
def port_free(port: int) -> bool:
    """True iff we can bind `port` right now. This is the authority.

    Deliberately does NOT set SO_REUSEADDR: a port still in TIME_WAIT must read
    as BUSY (sec.2.3). A just-released port can refuse a bind for tens of
    seconds, and handing it out would look exactly like the flake this REQ
    exists to remove.

    Binds the wildcard address, not 127.0.0.1, so a listener on ANY local
    address counts as busy. bind()+close() with no listen() never enters
    TIME_WAIT itself, so probing is free of side effects.
    """
    for family, addr in ((socket.AF_INET6, ("::", port)), (socket.AF_INET, ("0.0.0.0", port))):
        sock = None
        try:
            sock = socket.socket(family, socket.SOCK_STREAM)
            sock.bind(addr)
        except OSError as exc:
            if family is socket.AF_INET6 and exc.errno in (
                    errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL, errno.EPROTONOSUPPORT):
                continue  # no IPv6 on this box -- not a busy signal, keep probing v4
            return False
        finally:
            if sock is not None:
                sock.close()
    return True


def block_ports(base: int):
    return range(base, base + BLOCK_SIZE)


def block_all_free(base: int) -> bool:
    """True iff EVERY port in the block is bindable."""
    return all(port_free(p) for p in block_ports(base))


def block_busy_ports(base: int):
    return [p for p in block_ports(base) if not port_free(p)]


def pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists, owned by someone else
    except OSError:
        return True
    return True


# ------------------------------------------------------------------ leases ---
def lease_path(base: int) -> str:
    return os.path.join(STATE_DIR, "%d.lease" % base)


def all_bases():
    return [POOL_START + i * BLOCK_SIZE for i in range(BLOCK_COUNT)]


def read_lease(base: int):
    """Return (info_or_None, stat_or_None).

    info is None when the file is absent OR unparseable. An unparseable file is
    NOT treated as a dead lease: a half-written file is precisely the
    just-created case the grace window protects, so it falls through to reclaim
    condition 3 instead.
    """
    path = lease_path(base)
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return None, None
    except OSError:
        return None, None
    try:
        with open(path, "r") as fh:
            info = json.loads(fh.read())
        if not isinstance(info, dict):
            info = None
    except (OSError, ValueError):
        info = None
    return info, st


def lease_age(info, st, now: float) -> float:
    """Seconds since the lease was taken.

    Prefers the recorded ts, falls back to mtime, and IGNORES a ts in the future
    (a clock skew or a hand-written lease must not buy immortality)."""
    mtime = st.st_mtime if st is not None else now
    ts = None
    if isinstance(info, dict):
        raw = info.get("ts")
        if isinstance(raw, (int, float)):
            ts = float(raw)
    if ts is None or ts > now:
        ts = mtime
    return max(0.0, now - ts)


def lease_verdict(base: int, info, st, now: float):
    """('live', '') or ('stale', reason).

    THREE RECLAIM CONDITIONS -- ANY ONE INVALIDATES A LEASE (sec.9.2):
      1. boot_id mismatch  -- a lease from a previous boot is stale, full stop.
      2. dead pid          -- the ordinary kill -9 / crashed-harness path.
                              NOTE: reclaiming a lease is NOT the same as
                              handing the block out. If a dead harness left
                              ORPHANED children still holding its ports, the
                              lease goes but the allocator's bind probe still
                              refuses the block. Reality outranks the ledger in
                              both directions.
      3. NOTHING BOUND and older than the grace window -- the catch-all that
         makes the guarantee absolute. Whatever the cause (a bug, a container
         teardown, a half-written file), a lease with no live sockets behind it
         dies here, so a lease can be wrong for at most GRACE_SECONDS.

    Condition 3 fires even when the pid is alive. That is deliberate and is the
    owner's requirement: a live process that has held a block for more than
    GRACE_SECONDS without binding anything is holding an IDLE block. Bringup
    that legitimately outruns the window is covered by the caller's retry loop
    (sec.2.4), not by weakening this check.
    """
    if isinstance(info, dict):
        bid = info.get("boot_id")
        if isinstance(bid, str) and bid and BOOT_ID and bid != BOOT_ID:
            return "stale", "boot_id mismatch (lease predates the current boot)"
        pid = info.get("pid")
        if isinstance(pid, int) and pid > 0 and not pid_alive(pid):
            return "stale", "pid %d is dead" % pid
    age = lease_age(info, st, now)
    if age > GRACE_SECONDS and block_all_free(base):
        return "stale", ("no port in %d-%d is bound and the lease is %ds old (grace %ds)"
                         % (base, base + BLOCK_SIZE - 1, int(age), GRACE_SECONDS))
    return "live", ""


def reclaim(base: int, st) -> bool:
    """Delete a lease we have judged stale, guarding against deleting a FRESH
    one that replaced it between our read and this unlink (stat identity check).
    The residual race is bounded and is what the caller's retry loop absorbs."""
    path = lease_path(base)
    try:
        now_st = os.stat(path)
    except OSError:
        return False
    if st is not None and (now_st.st_ino != st.st_ino or now_st.st_mtime != st.st_mtime):
        return False  # someone re-took it -- not ours to remove
    try:
        os.unlink(path)
        return True
    except OSError:
        return False


def write_lease(base: int, caller: str, pid: int) -> bool:
    """O_EXCL-create the lease. False means someone else won the race."""
    payload = json.dumps({
        "base": base,
        "block_size": BLOCK_SIZE,
        "pid": pid,
        "boot_id": BOOT_ID,
        "caller": caller,
        "ts": time.time(),
        "host": socket.gethostname(),
    }, sort_keys=True) + "\n"
    try:
        fd = os.open(lease_path(base), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        return False
    except OSError as exc:
        print("%s cannot write a lease in %s: %s" % (TAG, STATE_DIR, exc), file=sys.stderr)
        raise SystemExit(74)
    try:
        os.write(fd, payload.encode("utf-8"))  # one syscall: no torn content
    finally:
        os.close(fd)
    return True


# --------------------------------------------------------------- commands ----
def cmd_allocate(args) -> int:
    os.makedirs(STATE_DIR, exist_ok=True)
    caller = args.caller or "unknown"
    pid = args.pid if args.pid and args.pid > 0 else os.getppid()
    now = time.time()
    reclaimed = []
    skipped_held = 0
    skipped_busy = 0
    lost_race = 0

    for base in all_bases():
        info, st = read_lease(base)
        if st is not None:
            verdict, reason = lease_verdict(base, info, st, now)
            if verdict == "live":
                skipped_held += 1
                continue
            if not reclaim(base, st):
                skipped_held += 1
                continue
            reclaimed.append((base, reason))
        # Reality check BEFORE claiming: the ledger said free, the OS decides.
        if not block_all_free(base):
            skipped_busy += 1
            continue
        if not write_lease(base, caller, pid):
            lost_race += 1
            continue
        # ...and again AFTER claiming, to close the window in which someone
        # bound between the probe and the create. Cheap; back out if it lost.
        if not block_all_free(base):
            reclaim(base, os.stat(lease_path(base)))
            skipped_busy += 1
            continue
        for rb, reason in reclaimed:
            print("%s reclaimed stale lease %d-%d: %s"
                  % (TAG, rb, rb + BLOCK_SIZE - 1, reason), file=sys.stderr)
        print(base)
        return 0

    print("%s POOL EXHAUSTED: no free block in %d-%d (%d blocks of %d). "
          "%d held by live leases, %d busy, %d lost to a race."
          % (TAG, POOL_START, POOL_END, BLOCK_COUNT, BLOCK_SIZE,
             skipped_held, skipped_busy, lost_race), file=sys.stderr)
    print("%s inspect with: tools/e2e_ports.sh --who    reclaim with: tools/e2e_ports.sh --gc"
          % TAG, file=sys.stderr)
    return 75


def _rows(now: float):
    rows = []
    for base in all_bases():
        info, st = read_lease(base)
        if st is None:
            continue
        verdict, reason = lease_verdict(base, info, st, now)
        busy = block_busy_ports(base)
        rows.append({
            "base": base,
            "end": base + BLOCK_SIZE - 1,
            "caller": (info or {}).get("caller", "?"),
            "pid": (info or {}).get("pid", None),
            "boot_id_ok": (not isinstance(info, dict)) or info.get("boot_id") == BOOT_ID,
            "age_s": int(lease_age(info, st, now)),
            "bound": bool(busy),
            "bound_ports": busy,
            "verdict": verdict,
            "reason": reason,
            "parsed": isinstance(info, dict),
        })
    return rows


def cmd_who(args) -> int:
    now = time.time()
    rows = _rows(now)
    if args.json:
        print(json.dumps(rows, sort_keys=True))
        return 0
    if not rows:
        print("%s no leases in %s (pool %d-%d, %d blocks of %d free)"
              % (TAG, STATE_DIR, POOL_START, POOL_END, BLOCK_COUNT, BLOCK_SIZE))
        return 0
    print("%-12s %-26s %-8s %-7s %-16s %s" % ("BLOCK", "CALLER", "PID", "AGE", "BOUND NOW", "LEASE"))
    for r in rows:
        # "bound now" is the point of sec.9.4: a `leased but idle` row is
        # visible at a glance instead of being inferred.
        bound = ("yes " + ",".join(str(p) for p in r["bound_ports"])) if r["bound"] else "NO (idle)"
        state = "live" if r["verdict"] == "live" else ("STALE: " + r["reason"])
        print("%-12s %-26s %-8s %-7s %-16s %s"
              % ("%d-%d" % (r["base"], r["end"]), str(r["caller"])[:26],
                 str(r["pid"]), "%ds" % r["age_s"], bound, state))
    return 0


def cmd_gc(args) -> int:
    """Reclaim now and report. A CONVENIENCE, never a prerequisite: allocation
    reclaims as it scans (sec.9.4), so the pool self-heals by being used."""
    now = time.time()
    freed = 0
    for base in all_bases():
        info, st = read_lease(base)
        if st is None:
            continue
        verdict, reason = lease_verdict(base, info, st, now)
        if verdict == "live":
            continue
        if reclaim(base, st):
            freed += 1
            print("%s freed %d-%d (%s): %s"
                  % (TAG, base, base + BLOCK_SIZE - 1, (info or {}).get("caller", "?"), reason))
    print("%s gc: %d lease(s) reclaimed" % (TAG, freed))
    return 0


def cmd_release(args) -> int:
    base = args.base
    info, st = read_lease(base)
    if st is None:
        return 0
    owner = (info or {}).get("pid")
    if not args.force and isinstance(owner, int) and args.pid and owner != args.pid:
        print("%s refusing to release %d: lease belongs to pid %s, not %s"
              % (TAG, base, owner, args.pid), file=sys.stderr)
        return 1
    try:
        os.unlink(lease_path(base))
    except OSError:
        return 0
    return 0


def cmd_pool(args) -> int:
    print(json.dumps({
        "pool_start": POOL_START, "pool_end": POOL_END,
        "block_size": BLOCK_SIZE, "block_count": BLOCK_COUNT,
        "grace_seconds": GRACE_SECONDS, "state_dir": STATE_DIR,
        "boot_id": BOOT_ID,
        "idx_api": IDX_API, "idx_proxy": IDX_PROXY, "idx_fleet": IDX_FLEET,
    }, sort_keys=True))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="e2e_port_lease.py", description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("allocate", help="lease the lowest free block; prints its base port")
    a.add_argument("--caller", default="", help="human name recorded in the lease")
    a.add_argument("--pid", type=int, default=0, help="pid that OWNS the lease (the harness shell, not this process)")
    a.set_defaults(fn=cmd_allocate)

    w = sub.add_parser("who", help="list live leases, with whether the block is actually bound")
    w.add_argument("--json", action="store_true")
    w.set_defaults(fn=cmd_who)

    g = sub.add_parser("gc", help="reclaim stale leases now and report")
    g.set_defaults(fn=cmd_gc)

    r = sub.add_parser("release", help="drop a lease this pid owns")
    r.add_argument("base", type=int)
    r.add_argument("--pid", type=int, default=0)
    r.add_argument("--force", action="store_true")
    r.set_defaults(fn=cmd_release)

    p = sub.add_parser("pool", help="print the pool constants as JSON")
    p.set_defaults(fn=cmd_pool)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
