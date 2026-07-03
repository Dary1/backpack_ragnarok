// Global setup — REQ-0031 Phase A profile safety.
//
// This E2E suite exercises the REAL live API against the REAL live
// profile file (~/backpack_ragnarok/data/profiles/default.json) -- there
// is no separate test/staging profile (server/README.md: fixed allowlist
// of exactly one profile id, "default"). Several tests PUT canvas state
// (Save button, or a raw PUT used as test-fixture setup) which overwrites
// that file. To make this safe to run against the live dev server without
// ever leaving the user's actual saved canvas corrupted:
//   1. globalSetup (this file) copies the current file to a timestamped
//      backup under /tmp BEFORE any test runs.
//   2. globalTeardown (global-teardown.ts) copies it back byte-for-byte
//      AFTER the whole run (Playwright guarantees globalTeardown runs
//      even if tests fail/throw, as long as globalSetup completed).
// A sha256 of the pre-run file is also stashed alongside the backup so an
// operator (or a follow-up script) can independently verify restoration
// separately from Playwright's own run.
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PROFILE_PATH = join(homedir(), 'backpack_ragnarok', 'data', 'profiles', 'default.json');
export const BACKUP_MARKER_PATH = '/tmp/backpack_e2e_profile_backup_path.txt';

function sha256(path: string): string {
  if (!existsSync(path)) return '(missing)';
  return execFileSync('sha256sum', [path]).toString().trim().split(/\s+/)[0];
}

export default async function globalSetup(): Promise<void> {
  const ts = Date.now();
  const backupPath = `/tmp/default_profile_backup_${ts}.json`;
  if (existsSync(PROFILE_PATH)) {
    copyFileSync(PROFILE_PATH, backupPath);
  } else {
    // No profile saved yet (fresh dev box) -- record that fact so
    // teardown knows to DELETE any file a test created, not just restore
    // bytes into a pre-existing one.
    writeFileSync(backupPath + '.absent', '');
  }
  const hash = sha256(PROFILE_PATH);
  writeFileSync(BACKUP_MARKER_PATH, `${backupPath}\n${hash}\n`);
  console.log(`[global-setup] backed up profile -> ${backupPath} (sha256 ${hash})`);
}
