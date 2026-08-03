#!/usr/bin/env python3
"""tools/tests/push_gate_test.py -- REQ-0343.

Drives the REAL tools/pre_receive_gate.sh, installed into a REAL bare repo built
in a temp dir, with REAL `git push`es. Nothing here is a mock: the assertions are
on git's exit status and on the text the pusher actually sees.

Why a test at all, when the mechanism is 300 lines of shell: because the failure
mode of a gate is that it silently stops gating, and that failure is invisible
from a green run. REQ-0340 is the record of a gate in this repo that was assumed
to be a check while being a free pass, for three REQs. So [0.6/7] watches this
one REJECT -- no receipt, wrong tree, and a too-narrow scope -- on every CI run.

Synthetic on purpose (same reasoning as tools/tests/ci_scope_test.py): a test
that reads the live worktree changes meaning whenever someone edits an unrelated
file. The only real files used are tools/ci_scope.sh, tools/ci_receipt.sh and
tools/pre_receive_gate.sh, copied in.

stdlib only, assert-style, offline.
"""
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FAILURES = []
CHECKS = [0]


def check(label, cond, detail=''):
    CHECKS[0] += 1
    if cond:
        print('PASS  %s' % label)
    else:
        print('FAIL  %s' % label)
        if detail:
            print('        %s' % detail.replace('\n', '\n        '))
        FAILURES.append(label)


def run(cmd, cwd=None, env=None, check_rc=None):
    e = dict(os.environ)
    e.update({
        'GIT_AUTHOR_NAME': 't', 'GIT_AUTHOR_EMAIL': 't@t',
        'GIT_COMMITTER_NAME': 't', 'GIT_COMMITTER_EMAIL': 't@t',
        'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
    })
    if env:
        e.update(env)
    p = subprocess.run(cmd, cwd=cwd, env=e, shell=isinstance(cmd, str),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out = p.stdout.decode('utf-8', 'replace') + p.stderr.decode('utf-8', 'replace')
    if check_rc is not None and p.returncode != check_rc:
        raise AssertionError('cmd %r rc=%d (wanted %d)\n%s' % (cmd, p.returncode, check_rc, out))
    return p.returncode, out


def write(path, text):
    d = os.path.dirname(path)
    if d and not os.path.isdir(d):
        os.makedirs(d)
    with open(path, 'w') as f:
        f.write(text)


def main():
    tmp = tempfile.mkdtemp(prefix='bpk_pushgate_test_')
    try:
        bare = os.path.join(tmp, 'bare.git')
        work = os.path.join(tmp, 'work')

        # ---- a bare repo, seeded, THEN the hook installed. Mirrors reality:
        # the gate is installed on a repo that already has a master.
        run(['git', 'init', '-q', '--bare', '-b', 'master', bare], check_rc=0)
        run(['git', 'init', '-q', '-b', 'master', work], check_rc=0)
        for rel in ('tools/ci_scope.sh', 'tools/ci_receipt.sh', 'tools/pre_receive_gate.sh'):
            dst = os.path.join(work, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(REPO, rel), dst)
        write(os.path.join(work, 'client/src/board/Board.tsx'), 'v0\n')
        write(os.path.join(work, 'client/src/artadmin/Queue.tsx'), 'v0\n')
        write(os.path.join(work, 'docs/notes.md'), 'v0\n')
        run(['git', 'add', '-A'], cwd=work, check_rc=0)
        run(['git', 'commit', '-qm', 'seed'], cwd=work, check_rc=0)
        run(['git', 'remote', 'add', 'origin', bare], cwd=work, check_rc=0)
        run(['git', 'push', '-q', 'origin', 'master'], cwd=work, check_rc=0)

        rc, out = run(['bash', os.path.join(REPO, 'tools/install_push_gate.sh'), bare], cwd=work)
        check('I1 install_push_gate.sh installs the hook', rc == 0, out)
        rc, out = run(['bash', os.path.join(REPO, 'tools/install_push_gate.sh'), '--check', bare], cwd=work)
        check('I2 --check reports installed and identical', rc == 0, out)
        os.makedirs(os.path.join(bare, 'ci-receipts'), exist_ok=True)

        def receipt_dir_of_work():
            rc, out = run(['bash', 'tools/ci_receipt.sh', 'dir'], cwd=work)
            return out.strip()

        check('I3 ci_receipt.sh derives the receipt dir from origin, matching the hook default',
              receipt_dir_of_work() == os.path.join(bare, 'ci-receipts'),
              receipt_dir_of_work())

        def tree_of_head():
            return run(['git', 'rev-parse', 'HEAD^{tree}'], cwd=work, check_rc=0)[1].strip()

        def commit(path, text, msg):
            write(os.path.join(work, path), text)
            run(['git', 'add', '-A'], cwd=work, check_rc=0)
            run(['git', 'commit', '-qm', msg], cwd=work, check_rc=0)

        def push(extra=None):
            cmd = ['git', 'push']
            if extra:
                cmd += extra
            cmd += ['origin', 'master']
            return run(cmd, cwd=work)

        def master_on_bare():
            return run(['git', '--git-dir=' + bare, 'rev-parse', 'master'], check_rc=0)[1].strip()

        def issue(scope):
            rc, out = run(['bash', 'tools/ci_receipt.sh', 'write', scope, '1', 'push_gate_test'], cwd=work)
            assert rc == 0, out
            return out

        # =====================================================================
        # V1 -- a public-surface commit with NO receipt is rejected.
        # =====================================================================
        before = master_on_bare()
        commit('client/src/board/Board.tsx', 'v1\n', 'public change')
        rc, out = push()
        check('V1a push with no receipt is REJECTED', rc != 0, out[-400:])
        check('V1b the rejection names the required scope', 'required scope   public' in out, out[-600:])
        check('V1c the rejection says what to run', 'tools/ci.sh' in out, out[-600:])
        check('V1d the rejection states the forgeability limit',
              'memory aid, not a wall' in out, out[-600:])
        check('V1e master on the bare repo did not move', master_on_bare() == before)

        # =====================================================================
        # V2 -- issue the receipt, push the SAME tree: accepted.
        # =====================================================================
        issue('public')
        rc, out = push()
        check('V2a push with a covering receipt is ACCEPTED', rc == 0, out[-600:])
        check('V2b the hook says which scope it required', "required 'public'" in out, out[-600:])
        check('V2c master advanced', master_on_bare() != before)

        # =====================================================================
        # V3 -- tree binding. A receipt for one tree does not cover another.
        # =====================================================================
        stale_tree = tree_of_head()
        commit('client/src/board/Board.tsx', 'v2\n', 'another public change')
        new_tree = tree_of_head()
        check('V3a the code change produced a different tree', stale_tree != new_tree)
        rc, out = push()
        check('V3b a receipt for a DIFFERENT tree does not let the push through', rc != 0, out[-400:])
        check('V3c the rejection names the tree it looked for', new_tree in out, out[-600:])

        # A receipt copied onto another tree's filename is caught as a mistake.
        rdir = os.path.join(bare, 'ci-receipts')
        shutil.copy2(os.path.join(rdir, stale_tree), os.path.join(rdir, new_tree))
        rc, out = push()
        check('V3d a COPIED receipt (tree= field disagrees with the filename) is ignored',
              rc != 0 and 'copied, not issued' in out, out[-600:])
        os.remove(os.path.join(rdir, new_tree))

        # =====================================================================
        # V4 -- message-only amend keeps the receipt: the key is the tree.
        # =====================================================================
        issue('public')
        run(['git', 'commit', '-q', '--amend', '-m', 'reworded, same code'], cwd=work, check_rc=0)
        check('V4a amending the message left the tree alone', tree_of_head() == new_tree)
        rc, out = push()
        check('V4b the receipt survives a message-only amend', rc == 0, out[-600:])

        # =====================================================================
        # V5 -- the hook COMPUTES, it does not trust. A `public` receipt on a
        # diff that touches an admin path is rejected; `admin` is accepted.
        # =====================================================================
        commit('client/src/artadmin/Queue.tsx', 'v1\n', 'admin change')
        issue('public')
        rc, out = push()
        check('V5a a public receipt does NOT cover an admin-touching diff', rc != 0, out[-400:])
        check('V5b the hook computed admin from the pushed tree',
              'required scope   admin' in out and "PUSHED tree's tools/ci_scope.sh" in out, out[-800:])
        check('V5c the rejection names the receipt scope it found',
              "scope='public'" in out, out[-800:])
        issue('admin')
        rc, out = push()
        check('V5d an admin receipt covers an admin-touching diff', rc == 0, out[-600:])

        # `both` covers everything.
        commit('client/src/artadmin/Queue.tsx', 'v2\n', 'admin change 2')
        issue('both')
        rc, out = push()
        check('V5e a both receipt covers an admin-touching diff', rc == 0, out[-600:])

        # =====================================================================
        # V6 -- --no-verify does not reach a server-side hook.
        # =====================================================================
        commit('client/src/board/Board.tsx', 'v3\n', 'public change 3')
        rc, out = push(['--no-verify'])
        check('V6a git push --no-verify is still REJECTED', rc != 0, out[-400:])
        check('V6b ...by the pre-receive hook, not by anything client-side',
              'PUSH REJECTED' in out, out[-400:])
        # ...and it really is the *client* hook that --no-verify skips:
        hookdir = run(['git', 'rev-parse', '--git-path', 'hooks'], cwd=work, check_rc=0)[1].strip()
        prepush = os.path.join(work, hookdir, 'pre-push')
        write(prepush, '#!/bin/sh\necho CLIENT-HOOK-RAN >&2\nexit 1\n')
        os.chmod(prepush, 0o755)
        rc, out = push()
        check('V6c a client pre-push hook DOES block a normal push',
              rc != 0 and 'CLIENT-HOOK-RAN' in out, out[-400:])
        rc, out = push(['--no-verify'])
        check('V6d --no-verify skips the client hook but NOT the server one',
              rc != 0 and 'CLIENT-HOOK-RAN' not in out and 'PUSH REJECTED' in out, out[-400:])
        os.remove(prepush)

        # =====================================================================
        # V7 -- refs other than master are free; master deletion is refused.
        # =====================================================================
        run(['git', 'checkout', '-qb', 'req-9999-scratch'], cwd=work, check_rc=0)
        commit('client/src/board/Board.tsx', 'v4\n', 'branch change, no receipt')
        rc, out = run(['git', 'push', 'origin', 'req-9999-scratch'], cwd=work)
        check('V7a a feature branch pushes with no receipt', rc == 0, out[-400:])
        check('V7b ...and the hook says so rather than staying silent',
              'not gated' in out, out[-400:])
        rc, out = run(['git', 'push', 'origin', ':master'], cwd=work)
        check('V7c deleting master is refused', rc != 0 and 'refusing to delete' in out, out[-400:])

        # =====================================================================
        # V8 -- fail closed: an all-ignored (docs-only) diff still requires the
        # full gate, because tools/ci_scope.sh says so. Same rule, one place.
        # =====================================================================
        run(['git', 'checkout', '-q', 'master'], cwd=work, check_rc=0)
        # V6 left rejected commits on local master; drop them so the pushed
        # range really is docs-only.
        run(['git', 'reset', '-q', '--hard', 'origin/master'], cwd=work, check_rc=0)
        commit('docs/notes.md', 'v1\n', 'docs only')
        issue('public')
        rc, out = push()
        check('V8a a docs-only push requires `both`, not nothing',
              rc != 0 and 'required scope   both' in out, out[-800:])
        issue('both')
        rc, out = push()
        check('V8b ...and a both receipt satisfies it', rc == 0, out[-600:])

        # =====================================================================
        # V9 -- fail closed: a pushed tree with no classifier requires `both`.
        # =====================================================================
        run(['git', 'rm', '-q', 'tools/ci_scope.sh'], cwd=work, check_rc=0)
        run(['git', 'commit', '-qm', 'remove the classifier'], cwd=work, check_rc=0)
        issue('public')
        rc, out = push()
        check('V9 a tree with no tools/ci_scope.sh fails closed to both',
              rc != 0 and 'no tools/ci_scope.sh' in out, out[-800:])
        run(['git', 'reset', '-q', '--hard', 'HEAD~1'], cwd=work, check_rc=0)

        # =====================================================================
        # V10 -- fail closed: a force-push is not a range.
        # =====================================================================
        run(['git', 'reset', '-q', '--hard', 'HEAD~1'], cwd=work, check_rc=0)
        commit('client/src/board/Board.tsx', 'forced\n', 'rewritten history')
        issue('public')
        rc, out = push(['--force'])
        check('V10 a non-fast-forward push to master fails closed to both',
              rc != 0 and 'NON-FAST-FORWARD' in out and 'required scope   both' in out, out[-900:])

        # =====================================================================
        # V11 -- one bad ref rejects the WHOLE push (pre-receive semantics).
        # =====================================================================
        head_before = master_on_bare()
        rc, out = run('git push origin +HEAD:refs/heads/master HEAD:refs/heads/req-9998-other',
                      cwd=work)
        check('V11a a push carrying one gated-and-failing ref is rejected entirely', rc != 0, out[-400:])
        check('V11b master did not move', master_on_bare() == head_before)
        rc2, _ = run(['git', '--git-dir=' + bare, 'rev-parse', '--verify', '-q', 'refs/heads/req-9998-other'])
        check('V11c ...and neither did the ungated ref in the same push', rc2 != 0)

        # =====================================================================
        # V12 -- branch creation of the gated ref has no base: requires both.
        # =====================================================================
        run(['git', '--git-dir=' + bare, 'update-ref', '-d', 'refs/heads/master'], check_rc=0)
        run(['git', 'reset', '-q', '--hard', head_before], cwd=work, check_rc=0)
        issue('public')
        rc, out = push()
        check('V12 creating the gated branch fails closed to both',
              rc != 0 and 'branch creation' in out, out[-800:])

        # =====================================================================
        # V13 -- --classify-stdin is the same table as the file-reading modes,
        # and needs no worktree at all.
        # =====================================================================
        cs = os.path.join(REPO, 'tools/ci_scope.sh')
        outside = tempfile.mkdtemp(prefix='bpk_notarepo_')
        try:
            for paths, want in (
                ('client/src/artadmin/x.tsx\n', 'admin'),
                ('client/src/board/x.ts\n', 'public'),
                ('client/src/artadmin/x.tsx\nclient/src/board/y.ts\n', 'both'),
                ('server/storage/x.cjs\n', 'both'),
                ('docs/x.md\n', 'both'),
                ('', 'both'),
                ('quantum_widgets/thing.txt\n', 'both'),
                ('tools/ci_scope.sh\n', 'both'),
            ):
                p = subprocess.run(['bash', cs, '--classify-stdin'], input=paths.encode(),
                                   cwd=outside, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                got = p.stdout.decode().strip()
                check('V13 --classify-stdin %-45r -> %s' % (paths.replace('\n', ' ').strip()[:45], want),
                      got == want, 'got %r rc=%d %s' % (got, p.returncode, p.stderr.decode()[-200:]))
        finally:
            shutil.rmtree(outside, ignore_errors=True)

        # =====================================================================
        # V14 -- the coverage algebra, all nine cells, as ci_receipt.sh has it.
        # The hook re-states the same four lines; this pins the shared meaning.
        # =====================================================================
        bad = []
        for have in ('admin', 'public', 'both'):
            for need in ('admin', 'public', 'both'):
                want = (have == 'both') or (have == need)
                rc, _ = run(['bash', 'tools/ci_receipt.sh', 'covers', have, need], cwd=work)
                if (rc == 0) != want:
                    bad.append('%s>=%s' % (have, need))
        check('V14 coverage: both covers all, admin covers admin, public covers public', not bad, str(bad))

    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print('')
    if FAILURES:
        print('push_gate_test: %d passed, %d FAILED -- %s'
              % (CHECKS[0] - len(FAILURES), len(FAILURES), ', '.join(FAILURES)))
        return 1
    print('push_gate_test: %d passed, 0 failed' % CHECKS[0])
    return 0


if __name__ == '__main__':
    sys.exit(main())
