#!/usr/bin/env python3
"""
Reserve the next REQ number and create a stub under docs/REQ/reserved/.

Server-side, concurrency-safe successor to the original
touch_next_req_reserved.py. Multiple git worktrees on the SAME host may call
this simultaneously; it guarantees a REQ number is NEVER handed out twice --
even under fully concurrent access -- and that numbers are monotonic (never
reused; gaps are allowed).

Why a shared counter (and not a docs/REQ scan)?
    Each worktree only sees the REQ files on its own branch, so scanning
    docs/REQ cannot know about numbers reserved on other, not-yet-merged
    branches. A single allocator state directory shared by every worktree on
    the host is therefore the only authoritative source of the next number.
    A docs/REQ scan is used ONLY for one-time seeding (--seed-only /
    --reconcile-root), never per allocation, so normal reservations are
    strictly contiguous.

Allocator state directory (outside any git tree; shared by all worktrees):
    counter        - text file: highest number issued so far (e.g. "0093")
    counter.lock   - advisory lock (flock) serialising allocation
    issued/NNNN    - one marker file per issued number (created with O_EXCL)

Allocation (inside an exclusive flock on counter.lock):
    1. base = max(counter value, highest issued/ marker[, --reconcile-root scans])
    2. n = base; repeat n += 1 and O_EXCL-create issued/NNNN until it succeeds.
       O_EXCL makes each claim atomic at the kernel level, so even if the lock
       were ever bypassed two callers can never win the same number.
    3. persist counter = n (atomic rename + fsync); release the lock.

flock is released automatically when the process exits, so a crashed caller
can never leave a stale lock (unlike a hand-rolled lock file). issued/ markers
are never deleted -- that is what makes numbering monotonic / non-reusable.

Seeding (run ONCE at migration, then never again):
    python3 touch_next_req_reserved.py --seed-only \
        --reconcile-root /path/to/main/docs/REQ \
        --reconcile-root /path/to/worktreeA/docs/REQ ...
    raises the counter to the global maximum across all given roots.

The stub is then created in the CURRENT worktree's docs/REQ/reserved/ and,
unless --no-commit, committed on the current branch (only the stub is staged).

Usage:
    python3 touch_next_req_reserved.py <slug>
        [--req-dir PATH] [--state-dir PATH]
        [--lock-timeout SECONDS] [--no-commit]
    python3 touch_next_req_reserved.py --seed-only
        [--reconcile-root PATH ...] [--state-dir PATH]

Exit code:
    0: reserved (or seeded) successfully (git auto-commit failure only warns)
    1: error (missing REQ dir, invalid slug, lock timeout, file collision)
"""

import argparse
import contextlib
import errno
import fcntl
import os
import re
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

REQ_NUM_PATTERN = re.compile(r"REQ-(\d+)", re.IGNORECASE)
SLUG_SANITIZE_PATTERN = re.compile(r"[^a-z0-9]+")

DEFAULT_STATE_DIR = Path.home() / "backpack_ragnarok_state" / "req"
DEFAULT_LOCK_TIMEOUT = 30.0


# ---------------------------------------------------------------------------
# scanning / slug helpers
# ---------------------------------------------------------------------------

def scan_max_req_number(req_dir: Path) -> int:
    """Highest REQ-#### under req_dir (recursive), or 0 if none/missing."""
    max_num = 0
    if not req_dir.is_dir():
        return 0
    for path in req_dir.rglob("*"):
        if path.is_file():
            m = REQ_NUM_PATTERN.search(path.name)
            if m:
                max_num = max(max_num, int(m.group(1)))
    return max_num


def sanitize_slug(raw_slug: str) -> str:
    """Normalise slug for a filename (lowercase, hyphen-separated)."""
    lowered = raw_slug.strip().lower()
    return SLUG_SANITIZE_PATTERN.sub("-", lowered).strip("-")


def slug_to_title(slug: str) -> str:
    return " ".join(word.capitalize() for word in slug.split("-") if word)


# ---------------------------------------------------------------------------
# concurrency-safe allocation
# ---------------------------------------------------------------------------

@contextlib.contextmanager
def exclusive_lock(lock_path: Path, timeout: float):
    """Acquire an exclusive advisory flock, retrying until timeout."""
    fd = os.open(str(lock_path), os.O_CREAT | os.O_RDWR, 0o644)
    deadline = time.monotonic() + timeout
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as exc:
                if exc.errno not in (errno.EAGAIN, errno.EACCES):
                    raise
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"could not acquire {lock_path} within {timeout}s")
                time.sleep(0.02)
        yield
    finally:
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


def read_counter(counter_path: Path) -> int:
    try:
        return int((counter_path.read_text(encoding="utf-8").strip() or "0"))
    except (FileNotFoundError, ValueError):
        return 0


def highest_marker(issued_dir: Path) -> int:
    max_num = 0
    if issued_dir.is_dir():
        for entry in issued_dir.iterdir():
            if entry.name.isdigit():
                max_num = max(max_num, int(entry.name))
    return max_num


def _write_counter(counter_path: Path, value: int) -> None:
    tmp = counter_path.with_name(counter_path.name + ".tmp")
    fd = os.open(str(tmp), os.O_CREAT | os.O_WRONLY | os.O_TRUNC, 0o644)
    try:
        os.write(fd, f"{value:04d}\n".encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(str(tmp), str(counter_path))  # atomic publish


def _state_paths(state_dir: Path):
    issued_dir = state_dir / "issued"
    issued_dir.mkdir(parents=True, exist_ok=True)
    return issued_dir, state_dir / "counter", state_dir / "counter.lock"


def seed_counter(state_dir: Path, timeout: float, reconcile_roots) -> int:
    """Raise the counter to the global max across reconcile_roots (one-off)."""
    issued_dir, counter_path, lock_path = _state_paths(state_dir)
    with exclusive_lock(lock_path, timeout):
        floor = max(
            [read_counter(counter_path), highest_marker(issued_dir)]
            + [scan_max_req_number(Path(r).expanduser().resolve()) for r in reconcile_roots]
        )
        _write_counter(counter_path, floor)
    return floor


def allocate_number(state_dir: Path, timeout: float, reconcile_roots=()) -> int:
    """Atomically reserve and return the next monotonic REQ number."""
    issued_dir, counter_path, lock_path = _state_paths(state_dir)
    with exclusive_lock(lock_path, timeout):
        base = max(
            [read_counter(counter_path), highest_marker(issued_dir)]
            + [scan_max_req_number(Path(r).expanduser().resolve()) for r in reconcile_roots]
        )
        n = base
        while True:
            n += 1
            marker = issued_dir / f"{n:04d}"
            try:
                fd = os.open(str(marker), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
                os.close(fd)
                break
            except FileExistsError:
                continue  # number already burned by a prior/crashed run
        _write_counter(counter_path, n)
    return n


# ---------------------------------------------------------------------------
# git auto-commit (optional; commits only the new stub on the current branch)
# ---------------------------------------------------------------------------

def run_git(repo_root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=str(repo_root),
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def git_toplevel(start: Path):
    result = run_git(start, "rev-parse", "--show-toplevel")
    if result.returncode == 0 and result.stdout.strip():
        return Path(result.stdout.strip())
    return None


def ensure_git_identity(repo_root: Path) -> None:
    for key, fallback in (("user.name", "backpack-ragnarok autocommit"),
                          ("user.email", "autocommit@backpack-ragnarok.local")):
        result = run_git(repo_root, "config", key)
        if result.returncode != 0 or not result.stdout.strip():
            run_git(repo_root, "config", key, fallback)


def auto_commit_stub(stub_path: Path, message: str) -> None:
    """Commit ONLY the new stub on the current branch. Never fatal."""
    try:
        repo_root = git_toplevel(stub_path.parent)
        if repo_root is None:
            print("info: not a git worktree; skipping auto-commit.", file=sys.stderr)
            return
        ensure_git_identity(repo_root)
        add = run_git(repo_root, "add", "--", str(stub_path))
        if add.returncode != 0:
            print(f"warning: git add failed: {add.stderr.strip()}", file=sys.stderr)
            return
        commit = run_git(repo_root, "commit", "-m", message, "--", str(stub_path))
        if commit.returncode != 0:
            print(f"warning: git commit failed: {commit.stderr.strip()}", file=sys.stderr)
            return
        head = run_git(repo_root, "rev-parse", "--short", "HEAD")
        branch = run_git(repo_root, "rev-parse", "--abbrev-ref", "HEAD")
        print(f'committed {head.stdout.strip()} "{message}" ({branch.stdout.strip()})')
    except FileNotFoundError:
        print("warning: git not found; skipping auto-commit.", file=sys.stderr)
    except Exception as exc:  # reservation already succeeded; never fatal
        print(f"warning: unexpected error during auto-commit: {exc}", file=sys.stderr)


# ---------------------------------------------------------------------------

def resolve_state_dir(arg_value):
    if arg_value:
        return Path(arg_value).expanduser().resolve()
    env = os.environ.get("BACKPACK_REQ_STATE_DIR")
    return Path(env).expanduser().resolve() if env else DEFAULT_STATE_DIR


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reserve the next REQ number (concurrency-safe) and create a stub."
    )
    parser.add_argument("slug", nargs="?", help="slug for the filename, e.g. warehouse-claim-feedback")
    parser.add_argument("--req-dir", default=None,
                        help="path to docs/REQ (default: <script>/../docs/REQ)")
    parser.add_argument("--state-dir", default=None,
                        help="shared allocator state dir "
                             "($BACKPACK_REQ_STATE_DIR or ~/backpack_ragnarok_state/req)")
    parser.add_argument("--reconcile-root", action="append", default=[],
                        help="scan this docs/REQ for a max floor (repeatable; seeding only)")
    parser.add_argument("--seed-only", action="store_true",
                        help="raise the counter to the global max and exit (no reservation)")
    parser.add_argument("--lock-timeout", type=float, default=DEFAULT_LOCK_TIMEOUT,
                        help=f"seconds to wait for the allocator lock (default {DEFAULT_LOCK_TIMEOUT})")
    parser.add_argument("--no-commit", action="store_true",
                        help="do not git-commit the stub (create the file only)")
    args = parser.parse_args()

    state_dir = resolve_state_dir(args.state_dir)
    state_dir.mkdir(parents=True, exist_ok=True)

    if args.seed_only:
        try:
            floor = seed_counter(state_dir, args.lock_timeout, args.reconcile_root)
        except TimeoutError as exc:
            print(f"error: {exc}", file=sys.stderr)
            sys.exit(1)
        print(f"seeded: counter = {floor:04d} (state: {state_dir})")
        sys.exit(0)

    if not args.slug:
        print("error: slug is required (unless --seed-only)", file=sys.stderr)
        sys.exit(1)

    if args.req_dir:
        req_dir = Path(args.req_dir).expanduser().resolve()
    else:
        req_dir = (Path(__file__).resolve().parent.parent / "docs" / "REQ").resolve()
    if not req_dir.is_dir():
        print(f"error: REQ directory not found: {req_dir}", file=sys.stderr)
        sys.exit(1)

    slug = sanitize_slug(args.slug)
    if not slug:
        print(f"error: invalid slug: {args.slug!r}", file=sys.stderr)
        sys.exit(1)

    try:
        next_num = allocate_number(state_dir, args.lock_timeout, args.reconcile_root)
    except TimeoutError as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)

    reserved_dir = req_dir / "reserved"
    reserved_dir.mkdir(parents=True, exist_ok=True)
    filename = f"REQ-{next_num:04d}-{slug}.md"
    target_path = reserved_dir / filename
    if target_path.exists():
        print(f"error: file already exists: {target_path}", file=sys.stderr)
        sys.exit(1)

    title = slug_to_title(slug)
    content = (
        f"# REQ-{next_num:04d} - {title}\n\n"
        f"**Status:** Reserved\n"
        f"**Reserved:** {date.today().isoformat()}\n"
        f"**Slug:** {slug}\n\n"
        f"_This number has been reserved. Requirement details pending._\n"
    )
    target_path.write_text(content, encoding="utf-8")
    print(f"reserved: REQ-{next_num:04d} ({filename})")
    print(str(target_path))

    if not args.no_commit:
        auto_commit_stub(target_path, f"docs: reserve REQ-{next_num:04d}-{slug}")
    sys.exit(0)


if __name__ == "__main__":
    main()
