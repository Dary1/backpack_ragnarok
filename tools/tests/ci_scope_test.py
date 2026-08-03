#!/usr/bin/env python3
"""REQ-0339 -- tools/ci_scope.sh tests (stdlib, plain python3, assert-style).

Runs OFFLINE against a SYNTHETIC git repo built in a temp dir: a copy of the
real tools/ci_scope.sh plus empty files at exactly the paths the classification
table cares about. Nothing here reads the live worktree, so the tests do not
change meaning when someone edits an unrelated file.

Asserts:
  1. the table itself, path by path (--explain), including the three shared
     e2e scaffolding files that BOTH families load
  2. admin-only diff   -> admin
  3. public-only diff  -> public
  4. shared diff       -> both
  5. an unknown path FAILS CLOSED to both, and says so on stderr
  6. an empty diff     -> both
  7. an all-ignored diff -> both (conservative; there is no fourth value)
  8. a DIRTY worktree is classified even with nothing committed
  9. stdout is exactly one bare token -- ci.sh captures it with $(...)

The self-check (`ci_scope.sh --selftest`) is NOT re-run here; it asserts facts
about the REAL tree and ci.sh runs it as its own stage.
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REAL_SCOPE = os.path.join(TOOLS, "ci_scope.sh")

_pass = 0
_fail = 0


def check(name, cond, detail=""):
    global _pass, _fail
    if cond:
        print("PASS  " + name)
        _pass += 1
    else:
        print("FAIL  " + name + ((" -- " + str(detail)) if detail else ""))
        _fail += 1


# ---- synthetic repo -------------------------------------------------------
# Only the SHAPE matters: ci_scope.sh classifies strings, and asks git only for
# the changed-path list.
SEED = [
    "tools/ci.sh",
    "tools/artadmin_e2e.sh",
    "tools/art_job.py",
    "tools/inspect_kits.py",
    "tools/seed_registry_e2e.cjs",
    "tools/e2e_fleet.cjs",
    "tools/gen_unit_icons.py",
    "client/playwright.config.ts",
    "client/vite.config.ts",
    "client/scripts/check_auth.mjs",
    "client/src/artadmin/ArtAdmin.tsx",
    "client/src/contentadmin/ContentAdmin.tsx",
    "client/src/board/Board.tsx",
    "client/src/market/Market.tsx",
    "client/e2e/artadmin.spec.ts",
    "client/e2e/artinspect.spec.ts",
    "client/e2e/contentadmin.spec.ts",
    "client/e2e/artadmin.config.ts",
    "client/e2e/registry.config.ts",
    "client/e2e/dex-admin.spec.ts",
    "client/e2e/helpers.ts",
    "client/e2e/e2e-env.ts",
    "client/e2e/landing.spec.ts",
    "server/routes/art.cjs",
    "server/routes/content.cjs",
    "server/routes/admin.cjs",
    "server/routes/market.cjs",
    "server/services/art_export.cjs",
    "server/services/kit_registry.cjs",
    "server/services/gacha.cjs",
    "server/storage/profiles.cjs",
    "server/lib/content.cjs",
    "server/api.cjs",
    "server/router.cjs",
    "server/tests/api_test.cjs",
    "content/vocab.json",
    "sim/combat.cjs",
    "shared/engine.js",
    "mock-src/ui.js",
    "bot/lib/agent.js",
    "docs/handoff.md",
    "web/app/index.html",
    "types/coded-error.d.ts",
    "deploy/systemd/backpack-api.service",
    "package.json",
    "pnpm-lock.yaml",
    "README.md",
]

GIT_ENV = dict(os.environ)
GIT_ENV.update({
    "GIT_AUTHOR_NAME": "ci_scope_test", "GIT_AUTHOR_EMAIL": "t@example.invalid",
    "GIT_COMMITTER_NAME": "ci_scope_test", "GIT_COMMITTER_EMAIL": "t@example.invalid",
    "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_SYSTEM": os.devnull,
})


def git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args), check=True,
                          capture_output=True, text=True, env=GIT_ENV)


def write(repo, rel, body="x\n"):
    full = os.path.join(repo, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as fh:
        fh.write(body)


def make_repo(tmp):
    repo = os.path.join(tmp, "repo")
    os.makedirs(repo)
    subprocess.run(["git", "init", "-q", "-b", "master", repo], check=True,
                   capture_output=True, env=GIT_ENV)
    for rel in SEED:
        write(repo, rel)
    shutil.copyfile(REAL_SCOPE, os.path.join(repo, "tools", "ci_scope.sh"))
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    return repo


def scope(repo, *args):
    r = subprocess.run(["bash", os.path.join(repo, "tools", "ci_scope.sh")] + list(args),
                       capture_output=True, text=True, env=GIT_ENV)
    return r


def on_branch(repo, name, touched):
    """Fresh branch off master carrying exactly `touched`, committed."""
    git(repo, "checkout", "-q", "master")
    git(repo, "checkout", "-q", "-B", name, "master")
    for rel in touched:
        write(repo, rel, "changed\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", name)
    return scope(repo)


def explain_map(repo):
    r = scope(repo, "--explain")
    out = {}
    for line in r.stdout.splitlines():
        parts = line.split(None, 1)
        if len(parts) == 2 and parts[0] in ("admin", "public", "both", "ignored",
                                            "unclassified"):
            out[parts[1].strip()] = parts[0]
    return out


def main():
    tmp = tempfile.mkdtemp(prefix="ci_scope_test_")
    try:
        repo = make_repo(tmp)

        # ---- 1. the table, path by path ---------------------------------
        git(repo, "checkout", "-q", "-B", "tbl", "master")
        for rel in SEED:
            write(repo, rel, "changed\n")
        write(repo, "docs/REQ/todo/REQ-9999-x.md", "changed\n")
        # ci_scope.sh must classify ITSELF; append a comment so it shows up in
        # the diff while staying a runnable copy.
        with open(os.path.join(repo, "tools", "ci_scope.sh"), "a") as fh:
            fh.write("# touched by ci_scope_test\n")
        git(repo, "add", "-A")
        git(repo, "commit", "-qm", "touch everything")
        m = explain_map(repo)
        expect = {
            "client/src/artadmin/ArtAdmin.tsx": "admin",
            "client/src/contentadmin/ContentAdmin.tsx": "admin",
            "client/e2e/artadmin.spec.ts": "admin",
            "client/e2e/artinspect.spec.ts": "admin",
            "client/e2e/contentadmin.spec.ts": "admin",
            "client/e2e/artadmin.config.ts": "admin",
            "client/e2e/registry.config.ts": "admin",
            "server/routes/art.cjs": "admin",
            "server/routes/content.cjs": "admin",
            "server/routes/admin.cjs": "admin",
            "server/services/art_export.cjs": "admin",
            "server/services/kit_registry.cjs": "admin",
            "content/vocab.json": "admin",
            "tools/artadmin_e2e.sh": "admin",
            "tools/art_job.py": "admin",
            "tools/inspect_kits.py": "admin",
            "tools/seed_registry_e2e.cjs": "admin",
            # the three shared e2e scaffolding files -- REQ-0339's own refinement
            "client/e2e/dex-admin.spec.ts": "both",
            "client/e2e/helpers.ts": "both",
            "client/e2e/e2e-env.ts": "both",
            "client/playwright.config.ts": "both",
            # public
            "client/src/board/Board.tsx": "public",
            "client/src/market/Market.tsx": "public",
            "client/e2e/landing.spec.ts": "public",
            "server/routes/market.cjs": "public",
            "sim/combat.cjs": "public",
            "shared/engine.js": "public",
            "mock-src/ui.js": "public",
            "bot/lib/agent.js": "public",
            # shared / infra
            "server/services/gacha.cjs": "both",
            "server/storage/profiles.cjs": "both",
            "server/lib/content.cjs": "both",
            "server/api.cjs": "both",
            "server/router.cjs": "both",
            "server/tests/api_test.cjs": "both",
            "tools/ci.sh": "both",
            "tools/ci_scope.sh": "both",
            "tools/e2e_fleet.cjs": "both",
            "tools/gen_unit_icons.py": "both",
            "client/vite.config.ts": "both",
            "client/scripts/check_auth.mjs": "both",
            "types/coded-error.d.ts": "both",
            "deploy/systemd/backpack-api.service": "both",
            "package.json": "both",
            "pnpm-lock.yaml": "both",
            # ignored
            "docs/handoff.md": "ignored",
            "docs/REQ/todo/REQ-9999-x.md": "ignored",
            "web/app/index.html": "ignored",
            "README.md": "ignored",
        }
        wrong = {k: (m.get(k), v) for k, v in expect.items() if m.get(k) != v}
        check("table classifies all %d probe paths as specified" % len(expect),
              not wrong, wrong)

        # ---- 2..4. the three real scopes --------------------------------
        r = on_branch(repo, "adminonly",
                      ["client/src/artadmin/ArtAdmin.tsx", "content/vocab.json",
                       "server/routes/art.cjs"])
        check("admin-only diff -> admin", r.stdout.strip() == "admin",
              (r.stdout, r.stderr))

        r = on_branch(repo, "publiconly",
                      ["client/src/board/Board.tsx", "sim/combat.cjs",
                       "client/e2e/landing.spec.ts"])
        check("public-only diff -> public", r.stdout.strip() == "public",
              (r.stdout, r.stderr))

        r = on_branch(repo, "sharedonly", ["server/storage/profiles.cjs"])
        check("shared diff -> both", r.stdout.strip() == "both",
              (r.stdout, r.stderr))

        r = on_branch(repo, "mixed",
                      ["client/src/artadmin/ArtAdmin.tsx", "sim/combat.cjs"])
        check("admin+public diff -> both", r.stdout.strip() == "both",
              (r.stdout, r.stderr))

        # ---- 5. unknown path FAILS CLOSED -------------------------------
        r = on_branch(repo, "unknown", ["quantum_widgets/thing.txt"])
        check("unknown path -> both (fail closed)", r.stdout.strip() == "both",
              (r.stdout, r.stderr))
        check("unknown path is named on stderr, not swallowed",
              "quantum_widgets/thing.txt" in r.stderr and "FAILING CLOSED" in r.stderr,
              r.stderr)
        check("unknown path is counted in the banner",
              "1 unclassified" in r.stderr, r.stderr)
        # ...and it must beat an otherwise admin-only diff back up to both
        r = on_branch(repo, "unknown2",
                      ["client/src/artadmin/ArtAdmin.tsx", "quantum_widgets/thing.txt"])
        check("unknown path overrides an admin-only diff -> both",
              r.stdout.strip() == "both", (r.stdout, r.stderr))

        # ---- 6. empty diff ----------------------------------------------
        git(repo, "checkout", "-q", "master")
        r = scope(repo)
        check("empty diff -> both", r.stdout.strip() == "both", (r.stdout, r.stderr))
        check("empty diff says so", "empty diff" in r.stderr, r.stderr)

        # ---- 7. all-ignored diff ----------------------------------------
        r = on_branch(repo, "docsonly", ["docs/handoff.md", "README.md"])
        check("all-ignored diff -> both (conservative)", r.stdout.strip() == "both",
              (r.stdout, r.stderr))
        check("all-ignored diff says why", "all paths ignored" in r.stderr, r.stderr)

        # ---- 8. dirty worktree, nothing committed -----------------------
        git(repo, "checkout", "-q", "master")
        write(repo, "client/src/artadmin/ArtAdmin.tsx", "uncommitted\n")
        r = scope(repo)
        check("dirty worktree (tracked, uncommitted) -> admin",
              r.stdout.strip() == "admin", (r.stdout, r.stderr))
        write(repo, "client/src/board/NewThing.tsx", "untracked\n")
        r = scope(repo)
        check("dirty worktree incl. an UNTRACKED file -> both",
              r.stdout.strip() == "both", (r.stdout, r.stderr))
        git(repo, "checkout", "-q", "--", ".")
        os.remove(os.path.join(repo, "client/src/board/NewThing.tsx"))

        # ---- 9. stdout is one bare token --------------------------------
        r = on_branch(repo, "tok", ["sim/combat.cjs"])
        check("stdout is exactly one bare token (ci.sh captures it)",
              r.stdout.splitlines() == ["public"], repr(r.stdout))
        check("the human banner goes to stderr, not stdout",
              r.stderr.startswith("[ci-scope]"), repr(r.stderr))
        check("exit status 0 on a normal classification", r.returncode == 0,
              r.returncode)

        # ---- 10. explicit base ref --------------------------------------
        r = scope(repo, "master")
        check("explicit base ref accepted", r.stdout.strip() == "public",
              (r.stdout, r.stderr))
        r = scope(repo, "no-such-ref")
        check("unresolvable base ref -> both, loudly",
              r.stdout.strip() == "both" and "does not resolve" in r.stderr,
              (r.stdout, r.stderr))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n%d passed, %d failed" % (_pass, _fail))
    return 1 if _fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
