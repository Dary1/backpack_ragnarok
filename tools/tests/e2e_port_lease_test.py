#!/usr/bin/env python3
"""tools/tests/e2e_port_lease_test.py -- REQ-0323 gates G3, G5, G8-G11.

The old REQ-derived port rule could only be ARGUED about: "derived ports cannot
collide" was a claim about arithmetic, and the only thing a gate could check was
that the arithmetic was written down correctly. A lease allocator can be
MEASURED, so it is -- that is the point of REQ-0323, and this file is where the
measurement lives permanently.

The owner's requirement (REQ-0323 sec.9, 2026-07-27) is that a lease can NEVER
hold an idle block. Two of the tests below are the negatives that make that
claim mean something:

  * test_grace_window_protects_a_just_taken_lease -- a lease inside the grace
    window is NOT reclaimed. Without this, "reclamation happens" could pass by
    reclaiming everything always, which would let allocator B steal a block from
    allocator A in the instant between A choosing it and A binding it.
  * test_a_bound_block_is_never_reclaimed -- a live run is never evicted, no
    matter how old its lease is.

REQ-0322 existed because a detector was never proved to detect. Testing only
that reclamation happens would repeat exactly that shape.

Runs against the REAL pool (so the bind probes mean something) but an ISOLATED
state dir, and with a short grace window so the time-based tests cost seconds
rather than minutes. tools/ci.sh holds the box lock for a whole run, so no real
harness can be leasing concurrently.
"""
import json
import io
import os
import contextlib
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
LEASE_PY = os.path.join(TOOLS, "e2e_port_lease.py")

GRACE = int(os.environ.get("E2E_PORT_LEASE_TEST_GRACE", "2"))
STATE = tempfile.mkdtemp(prefix="e2e_ports_test_")
os.environ["E2E_PORTS_STATE_DIR"] = STATE
os.environ["E2E_PORTS_GRACE"] = str(GRACE)

sys.path.insert(0, TOOLS)
import e2e_port_lease as L  # noqa: E402

FAILS = []
PASSES = []


def check(name, cond, detail=""):
    if cond:
        PASSES.append(name)
        print("  ok   %s%s" % (name, (" -- " + detail) if detail else ""))
    else:
        FAILS.append(name)
        print("  FAIL %s%s" % (name, (" -- " + detail) if detail else ""))


class Args(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


def allocate(caller="test", pid=None):
    """Returns the base port, or None if the pool refused."""
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = L.cmd_allocate(Args(caller=caller, pid=pid or os.getpid()))
    if rc != 0:
        return None
    return int(buf.getvalue().strip())


def release(base, pid=None):
    L.cmd_release(Args(base=base, pid=pid or os.getpid(), force=True))


def write_bogus_lease(base, pid, boot_id, age_s, caller="bogus"):
    path = L.lease_path(base)
    payload = json.dumps({"base": base, "block_size": L.BLOCK_SIZE, "pid": pid,
                          "boot_id": boot_id, "caller": caller,
                          "ts": time.time() - age_s, "host": "test"}) + "\n"
    with open(path, "w") as fh:
        fh.write(payload)
    old = time.time() - age_s
    os.utime(path, (old, old))
    return path


def clear_state():
    for n in os.listdir(STATE):
        os.unlink(os.path.join(STATE, n))


# ------------------------------------------------------------------ G3 -------
def test_concurrent_allocators_get_distinct_blocks():
    """G3. Two at once, then ten at once, in REAL separate processes."""
    for n in (2, 10):
        clear_state()
        env = dict(os.environ)
        procs = [subprocess.Popen([sys.executable, LEASE_PY, "allocate",
                                   "--caller", "concurrent%d" % i, "--pid", str(os.getpid())],
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
                 for i in range(n)]
        bases = []
        for p in procs:
            out, _ = p.communicate()
            if p.returncode == 0:
                bases.append(int(out.strip()))
        check("G3 %2d concurrent allocators all succeeded" % n,
              len(bases) == n, "%d/%d got a block" % (len(bases), n))
        check("G3 %2d concurrent allocators got DISTINCT blocks" % n,
              len(set(bases)) == len(bases),
              "blocks %s" % (sorted(bases),))
        check("G3 %2d blocks are non-overlapping" % n,
              all(abs(a - b) >= L.BLOCK_SIZE for i, a in enumerate(sorted(bases))
                  for b in sorted(bases)[i + 1:]),
              "min gap >= %d" % L.BLOCK_SIZE)
    clear_state()


# ---------------------------------------------------------------- G8 / G4 ----
def test_killed_holder_is_reclaimed():
    """G8/G4. kill -9 the holder; its sockets die with it, so the very next
    allocation reclaims the block immediately -- no timeout to wait out."""
    clear_state()
    victim = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(300)"])
    base = allocate(caller="victim", pid=victim.pid)
    check("G8 victim leased a block", base is not None, "block %s" % base)
    victim.kill()
    victim.wait()
    got = allocate(caller="after_kill")
    check("G8 killed holder's block is reclaimed and re-issued IMMEDIATELY",
          got == base, "killed pid %d held %s; next allocate got %s" % (victim.pid, base, got))
    check("G8 no lease file left over from the dead holder",
          len(os.listdir(STATE)) == 1, "%d lease file(s)" % len(os.listdir(STATE)))
    clear_state()


# ------------------------------------------------------------------ G9 -------
def test_bogus_lease_past_grace_is_reclaimed():
    """G9 positive. A hand-written lease over an UNBOUND block, older than the
    grace window, dies on reclaim condition 3 whatever else it claims."""
    clear_state()
    base = L.POOL_START
    write_bogus_lease(base, os.getpid(), L.BOOT_ID, age_s=GRACE + 5)
    verdict, reason = L.lease_verdict(base, *L.read_lease(base), now=time.time())
    check("G9+ bogus unbound lease past grace is judged STALE",
          verdict == "stale", reason)
    got = allocate(caller="reclaimer")
    check("G9+ and the block is re-issued", got == base, "got %s, expected %s" % (got, base))
    clear_state()


def test_grace_window_protects_a_just_taken_lease():
    """G9 NEGATIVE -- the half that makes the positive mean anything.

    A lease over an unbound block INSIDE the grace window must NOT be reclaimed.
    This is the 'chosen but not yet bound' instant: without it, a second
    allocator would steal the block out from under the first one every time.
    """
    clear_state()
    base = L.POOL_START
    write_bogus_lease(base, os.getpid(), L.BOOT_ID, age_s=0)
    verdict, reason = L.lease_verdict(base, *L.read_lease(base), now=time.time())
    check("G9- unbound lease INSIDE the grace window is judged LIVE",
          verdict == "live", "verdict=%s %s" % (verdict, reason))
    got = allocate(caller="thief")
    check("G9- a second allocator does NOT steal it",
          got is not None and got != base,
          "protected %s, thief got %s" % (base, got))
    # ...and once the window passes, the SAME lease becomes reclaimable.
    time.sleep(GRACE + 1)
    verdict2, reason2 = L.lease_verdict(base, *L.read_lease(base), now=time.time())
    check("G9- the same lease becomes STALE once the window passes",
          verdict2 == "stale", reason2)
    clear_state()


def test_a_bound_block_is_never_reclaimed():
    """A live run must never be evicted, however old its lease is. Condition 3
    is 'no port bound AND past grace' -- both halves, not either."""
    clear_state()
    import socket
    base = L.POOL_START
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("0.0.0.0", base + L.IDX_API))
    s.listen(1)
    try:
        write_bogus_lease(base, os.getpid(), L.BOOT_ID, age_s=GRACE * 100)
        verdict, reason = L.lease_verdict(base, *L.read_lease(base), now=time.time())
        check("a lease whose block IS bound stays LIVE far past grace",
              verdict == "live", "age %ds, verdict=%s %s" % (GRACE * 100, verdict, reason))
        got = allocate(caller="intruder")
        check("...and the allocator routes around it", got != base, "got %s" % got)
    finally:
        s.close()
    clear_state()


# ----------------------------------------------------------------- G10 -------
def test_foreign_boot_id_is_reclaimed_even_with_a_live_pid():
    """G10. PIDs are reused across a reboot: a lease naming pid 1234 can find an
    unrelated LIVE pid 1234 after a restart and hold its block forever. boot_id
    is what makes that impossible, so test it with a pid that IS alive."""
    clear_state()
    base = L.POOL_START
    write_bogus_lease(base, os.getpid(), "00000000-0000-0000-0000-000000000000",
                      age_s=0, caller="previous_boot")
    check("G10 the planted lease names a LIVE pid",
          L.pid_alive(os.getpid()), "pid %d" % os.getpid())
    verdict, reason = L.lease_verdict(base, *L.read_lease(base), now=time.time())
    check("G10 foreign boot_id is STALE despite the live pid and zero age",
          verdict == "stale" and "boot_id" in reason, reason)
    got = allocate(caller="after_reboot")
    check("G10 and the block is re-issued", got == base, "got %s" % got)
    clear_state()


# ----------------------------------------------------------------- G11 -------
def test_full_pool_cycle_leaks_nothing():
    """G11. Fill the pool, confirm it refuses, release everything, fill it
    again. A leak would show up as fewer blocks on the second pass."""
    clear_state()
    # How many blocks are ACTUALLY free right now? Not necessarily all of them:
    # anything already bound in the pool is correctly withheld, which is the
    # design working, not a leak. (Observed: a concurrent e2e run held 9022 and
    # 9024, so 99 blocks were available -- asserting a flat 100 would have made
    # this test fail for being right.) The leak question is the NEXT assertion:
    # does the same set come back after a full release?
    free_now = [b for b in L.all_bases() if L.block_all_free(b)]
    first = []
    while True:
        b = allocate(caller="filler")
        if b is None:
            break
        first.append(b)
    check("G11 the pool hands out every block whose ports are actually free",
          len(first) == len(free_now),
          "%d handed out, %d were bindable (of %d total)"
          % (len(first), len(free_now), L.BLOCK_COUNT))
    check("G11 an exhausted pool REFUSES rather than reusing a block",
          allocate(caller="overflow") is None)
    for b in first:
        release(b)
    check("G11 release removes every lease file", len(os.listdir(STATE)) == 0,
          "%d file(s) left" % len(os.listdir(STATE)))
    second = []
    while True:
        b = allocate(caller="refiller")
        if b is None:
            break
        second.append(b)
    check("G11 a second full cycle gets the SAME blocks back -- no leak",
          sorted(second) == sorted(first),
          "%d blocks, identical set: %s" % (len(second), sorted(second) == sorted(first)))
    clear_state()


# ------------------------------------------------------------------ G5 -------
def test_who_reports_bound_vs_idle():
    """G5 / sec.9.4. --who must show whether the block is ACTUALLY bound, so a
    'leased but idle' row is visible at a glance instead of being inferred."""
    clear_state()
    import socket
    idle = allocate(caller="idle_holder")
    busy = allocate(caller="busy_holder")
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("0.0.0.0", busy + L.IDX_PROXY))
    s.listen(1)
    try:
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            L.cmd_who(Args(json=True))
        rows = {r["base"]: r for r in json.loads(buf.getvalue())}
        check("G5 --who lists exactly the live leases", set(rows) == {idle, busy},
              "%s" % sorted(rows))
        check("G5 --who reports the bound block as bound",
              rows[busy]["bound"] and rows[busy]["bound_ports"] == [busy + L.IDX_PROXY],
              "bound_ports=%s" % rows[busy]["bound_ports"])
        check("G5 --who reports the idle block as NOT bound",
              not rows[idle]["bound"], "bound=%s" % rows[idle]["bound"])
        check("G5 --who carries caller and pid",
              rows[idle]["caller"] == "idle_holder" and rows[idle]["pid"] == os.getpid())
    finally:
        s.close()
    clear_state()


def test_gc_is_a_convenience_not_a_prerequisite():
    """sec.9.4: --gc reclaims now and reports, but allocation already reclaims
    as it scans, so nothing depends on gc ever being run."""
    clear_state()
    write_bogus_lease(L.POOL_START, os.getpid(), L.BOOT_ID, age_s=GRACE + 5)
    write_bogus_lease(L.POOL_START + L.BLOCK_SIZE, os.getpid(), L.BOOT_ID, age_s=0)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        L.cmd_gc(Args())
    out = buf.getvalue()
    check("gc frees the stale lease", "1 lease(s) reclaimed" in out, out.strip().splitlines()[-1])
    check("gc leaves the in-grace lease alone",
          os.path.exists(L.lease_path(L.POOL_START + L.BLOCK_SIZE)))
    clear_state()


def test_half_written_lease_is_not_treated_as_dead():
    """A torn/unparseable lease must fall through to condition 3 (grace +
    unbound), not be read as 'no pid, therefore dead' -- that would reopen the
    steal-it-before-it-binds hole the grace window closes."""
    clear_state()
    base = L.POOL_START
    with open(L.lease_path(base), "w") as fh:
        fh.write('{"base": 90')  # torn write
    verdict, _ = L.lease_verdict(base, *L.read_lease(base), now=time.time())
    check("a torn lease inside the grace window is LIVE", verdict == "live")
    old = time.time() - (GRACE + 5)
    os.utime(L.lease_path(base), (old, old))
    verdict2, reason2 = L.lease_verdict(base, *L.read_lease(base), now=time.time())
    check("a torn lease past the grace window is STALE", verdict2 == "stale", reason2)
    clear_state()


def test_reclamation_happens_as_the_scan_walks():
    """sec.9.4 says the scan reclaims stale leases AS IT WALKS -- and the walk
    STOPS at the first usable block. So a stale lease above that point survives
    until demand reaches it, or until --gc sweeps. That is deliberate, and worth
    pinning: making every allocation sweep all %d blocks would cost %d bind
    probes per call for no benefit, since a stale lease higher up has never
    denied anybody a block.

    What must hold is the useful guarantee: NO ALLOCATION IS EVER REFUSED
    BECAUSE OF A STALE LEASE. Under pressure the scan reaches it and reclaims
    it -- proved here by filling everything below it.
    """ % (L.BLOCK_COUNT, L.BLOCK_COUNT * L.BLOCK_SIZE)
    clear_state()
    low, high = L.POOL_START, L.POOL_START + 50 * L.BLOCK_SIZE
    write_bogus_lease(low, os.getpid(), L.BOOT_ID, age_s=GRACE + 5, caller="stale_low")
    write_bogus_lease(high, os.getpid(), L.BOOT_ID, age_s=GRACE + 5, caller="stale_high")
    got = allocate(caller="walker")
    check("a stale lease AT the scan head is reclaimed and re-issued", got == low,
          "got %s, expected %s" % (got, low))
    check("a stale lease ABOVE the first free block is left alone (the scan stops)",
          os.path.exists(L.lease_path(high)), "block %d" % high)
    # ...but it can never deny anyone a block: fill up to it and it yields.
    taken = [got]
    while True:
        b = allocate(caller="pressure")
        if b is None or b > high:
            break
        taken.append(b)
    check("under pressure the scan reaches it, reclaims it and hands it out",
          high in taken, "blocks taken up to %s" % (max(taken) if taken else None))
    clear_state()
    # ...and --gc reclaims it explicitly, without waiting for pressure.
    write_bogus_lease(high, os.getpid(), L.BOOT_ID, age_s=GRACE + 5, caller="stale_high")
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        L.cmd_gc(Args())
    check("--gc reclaims it without waiting for demand",
          not os.path.exists(L.lease_path(high)), buf.getvalue().strip().splitlines()[-1])
    clear_state()


def main():
    print("e2e_port_lease_test: pool %d-%d, %d blocks of %d, grace %ds, state %s"
          % (L.POOL_START, L.POOL_END, L.BLOCK_COUNT, L.BLOCK_SIZE, L.GRACE_SECONDS, STATE))
    for fn in (test_concurrent_allocators_get_distinct_blocks,
               test_killed_holder_is_reclaimed,
               test_bogus_lease_past_grace_is_reclaimed,
               test_grace_window_protects_a_just_taken_lease,
               test_a_bound_block_is_never_reclaimed,
               test_foreign_boot_id_is_reclaimed_even_with_a_live_pid,
               test_full_pool_cycle_leaks_nothing,
               test_who_reports_bound_vs_idle,
               test_gc_is_a_convenience_not_a_prerequisite,
               test_half_written_lease_is_not_treated_as_dead,
               test_reclamation_happens_as_the_scan_walks):
        print("[%s]" % fn.__name__)
        fn()
    try:
        os.rmdir(STATE)
    except OSError:
        pass
    print("\ne2e_port_lease_test: %d passed, %d failed" % (len(PASSES), len(FAILS)))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
