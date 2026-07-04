// Global teardown — restores the live profile file AND both live content
// files byte-for-byte from the backups global-setup.ts made, no matter
// how the run ended (Playwright always invokes globalTeardown once
// globalSetup has completed, including after failed tests -- see
// Playwright docs on globalSetup/globalTeardown semantics). Also deletes
// a file entirely if it did not exist before the run (a test creating it
// from nothing should not leave it behind) -- see global-setup.ts's
// module comment for why content/live/*.json is tracked here too
// (REQ-0035's admin edit-mode E2E spec).
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import {
  BACKUP_MARKER_PATH,
  LIVE_ITEMS_BACKUP_MARKER_PATH,
  LIVE_ITEMS_PATH,
  LIVE_SIS_BACKUP_MARKER_PATH,
  LIVE_SIS_PATH,
  PROFILE_PATH,
} from './global-setup';

function sha256(path: string): string {
  if (!existsSync(path)) return '(missing)';
  return execFileSync('sha256sum', [path]).toString().trim().split(/\s+/)[0];
}

function restoreOne(targetPath: string, markerPath: string, label: string): void {
  if (!existsSync(markerPath)) {
    console.warn(`[global-teardown] no backup marker found for ${label} -- skipping restore (global-setup may not have run)`);
    return;
  }
  const [backupPath, expectedHashBefore] = readFileSync(markerPath, 'utf8').trim().split('\n');
  const absentMarker = backupPath + '.absent';
  if (existsSync(absentMarker)) {
    if (existsSync(targetPath)) rmSync(targetPath);
    rmSync(absentMarker);
    console.log(`[global-teardown] ${label} did not exist before the run -- removed any file a test created`);
    return;
  }
  copyFileSync(backupPath, targetPath);
  const hashAfter = sha256(targetPath);
  const ok = hashAfter === expectedHashBefore;
  console.log(`[global-teardown] restored ${label} from ${backupPath}`);
  console.log(`[global-teardown] ${label} sha256 before=${expectedHashBefore} after=${hashAfter} match=${ok}`);
  if (!ok) {
    throw new Error(`${label} restore verification FAILED: sha256 mismatch (before=${expectedHashBefore} after=${hashAfter})`);
  }
}

export default async function globalTeardown(): Promise<void> {
  // Restore ALL tracked files even if one throws partway -- collect
  // errors and raise after attempting every restore, so a failure
  // restoring the profile (say) never skips restoring the content files.
  const errors: Error[] = [];
  for (const [targetPath, markerPath, label] of [
    [PROFILE_PATH, BACKUP_MARKER_PATH, 'profile'],
    [LIVE_ITEMS_PATH, LIVE_ITEMS_BACKUP_MARKER_PATH, 'content/live/live_items.json'],
    [LIVE_SIS_PATH, LIVE_SIS_BACKUP_MARKER_PATH, 'content/live/live_sis.json'],
  ] as const) {
    try {
      restoreOne(targetPath, markerPath, label);
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }
  if (errors.length > 0) {
    throw new Error('global-teardown restore failures: ' + errors.map((e) => e.message).join(' | '));
  }
}
