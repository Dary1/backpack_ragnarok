// Global teardown — restores the live profile file byte-for-byte from the
// backup global-setup.ts made, no matter how the run ended (Playwright
// always invokes globalTeardown once globalSetup has completed, including
// after failed tests -- see Playwright docs on globalSetup/globalTeardown
// semantics). Also deletes the file entirely if it did not exist before
// the run (a test creating it from nothing should not leave it behind).
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { PROFILE_PATH, BACKUP_MARKER_PATH } from './global-setup';

function sha256(path: string): string {
  if (!existsSync(path)) return '(missing)';
  return execFileSync('sha256sum', [path]).toString().trim().split(/\s+/)[0];
}

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(BACKUP_MARKER_PATH)) {
    console.warn('[global-teardown] no backup marker found -- skipping restore (global-setup may not have run)');
    return;
  }
  const [backupPath, expectedHashBefore] = readFileSync(BACKUP_MARKER_PATH, 'utf8').trim().split('\n');
  const absentMarker = backupPath + '.absent';
  if (existsSync(absentMarker)) {
    if (existsSync(PROFILE_PATH)) rmSync(PROFILE_PATH);
    rmSync(absentMarker);
    console.log('[global-teardown] profile did not exist before the run -- removed any file a test created');
    return;
  }
  copyFileSync(backupPath, PROFILE_PATH);
  const hashAfter = sha256(PROFILE_PATH);
  const ok = hashAfter === expectedHashBefore;
  console.log(`[global-teardown] restored profile from ${backupPath}`);
  console.log(`[global-teardown] sha256 before=${expectedHashBefore} after=${hashAfter} match=${ok}`);
  if (!ok) {
    throw new Error(`profile restore verification FAILED: sha256 mismatch (before=${expectedHashBefore} after=${hashAfter})`);
  }
}
