// Global setup — REQ-0031 Phase A profile safety, extended REQ-0035 to
// also cover content/live/*.json (the admin-edit E2E round-trip test
// PUTs real edits there).
//
// This E2E suite exercises the REAL live API against the REAL live
// profile file (~/backpack_ragnarok/data/profiles/default.json) -- there
// is no separate test/staging profile (server/README.md: fixed allowlist
// of exactly one profile id, "default"). Several tests PUT canvas state
// (Save button, or a raw PUT used as test-fixture setup) which overwrites
// that file. REQ-0035 adds a second category: the admin edit-mode E2E
// spec edits content/live/live_items.json (or live_sis.json) via the real
// PUT /api/admin/item/:id endpoint, exactly the same "real file, no
// staging copy" situation the profile file has always been in. Both
// categories get the identical safety treatment:
//   1. globalSetup (this file) copies each tracked file to a timestamped
//      backup under /tmp BEFORE any test runs.
//   2. globalTeardown (global-teardown.ts) copies it back byte-for-byte
//      AFTER the whole run (Playwright guarantees globalTeardown runs
//      even if tests fail/throw, as long as globalSetup completed).
// A sha256 of each pre-run file is also stashed alongside its backup so
// an operator (or a follow-up script) can independently verify
// restoration separately from Playwright's own run.
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(homedir(), 'backpack_ragnarok');

export const PROFILE_PATH = join(REPO_ROOT, 'data', 'profiles', 'default.json');
export const BACKUP_MARKER_PATH = '/tmp/backpack_e2e_profile_backup_path.txt';

// REQ-0035 additions: both live content files are tracked (a test may
// edit an item living in either one, and both are cheap to back up
// regardless of which one is actually touched).
export const LIVE_ITEMS_PATH = join(REPO_ROOT, 'content', 'live', 'live_items.json');
export const LIVE_SIS_PATH = join(REPO_ROOT, 'content', 'live', 'live_sis.json');
export const LIVE_ITEMS_BACKUP_MARKER_PATH = '/tmp/backpack_e2e_live_items_backup_path.txt';
export const LIVE_SIS_BACKUP_MARKER_PATH = '/tmp/backpack_e2e_live_sis_backup_path.txt';

function sha256(path: string): string {
  if (!existsSync(path)) return '(missing)';
  return execFileSync('sha256sum', [path]).toString().trim().split(/\s+/)[0];
}

function backupOne(sourcePath: string, backupPrefix: string, markerPath: string): void {
  const ts = Date.now();
  const backupPath = `/tmp/${backupPrefix}_backup_${ts}.json`;
  if (existsSync(sourcePath)) {
    copyFileSync(sourcePath, backupPath);
  } else {
    // Not expected for content/live/*.json (checked into git, always
    // present), but handled the same defensive way as the profile file
    // for symmetry -- teardown then knows to DELETE rather than restore.
    writeFileSync(backupPath + '.absent', '');
  }
  const hash = sha256(sourcePath);
  writeFileSync(markerPath, `${backupPath}\n${hash}\n`);
  console.log(`[global-setup] backed up ${sourcePath} -> ${backupPath} (sha256 ${hash})`);
}

export default async function globalSetup(): Promise<void> {
  backupOne(PROFILE_PATH, 'default_profile', BACKUP_MARKER_PATH);
  backupOne(LIVE_ITEMS_PATH, 'live_items', LIVE_ITEMS_BACKUP_MARKER_PATH);
  backupOne(LIVE_SIS_PATH, 'live_sis', LIVE_SIS_BACKUP_MARKER_PATH);
}
