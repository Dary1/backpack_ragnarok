// Global teardown — restores the live profile file AND both live content
// files byte-for-byte from the backups global-setup.ts made, no matter
// how the run ended (Playwright always invokes globalTeardown once
// globalSetup has completed, including after failed tests -- see
// Playwright docs on globalSetup/globalTeardown semantics). Also deletes
// a file entirely if it did not exist before the run (a test creating it
// from nothing should not leave it behind) -- see global-setup.ts's
// module comment for why content/live/*.json is tracked here too
// (REQ-0035's admin edit-mode E2E spec).
//
// REQ-0037 addition: also deletes every file guest-auth.spec.ts registered
// in the tracked-files ledger (GUEST_AUTH_TRACKED_FILES_PATH) -- these are
// brand-new player registry files (data/players/<id>.json) and their
// profile files (data/profiles/<id>.json), all created FRESH by the test
// run and therefore always following the "absent before the run" cleanup
// path (verified by sha256 of "file does not exist" being consistent
// before/after, exactly like restoreOne()'s existing absent-marker
// handling), not a restore-to-prior-content path.
import { execFileSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import {
  BACKUP_MARKER_PATH,
  GUEST_AUTH_TRACKED_FILES_PATH,
  LIVE_ITEMS_BACKUP_MARKER_PATH,
  LIVE_ITEMS_PATH,
  LIVE_SIS_BACKUP_MARKER_PATH,
  LIVE_SIS_PATH,
  PROFILE_PATH,
  clearDevWarehouseDebris,
  clearDevEinherjarRecords,
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

interface TrackedFile {
  path: string;
  label: string;
}

/** REQ-0037: deletes every file guest-auth.spec.ts registered as created-
 * fresh-by-this-run (player registry files + their profile files). Proves
 * deletion via a sha256 "before vs after" comparison, exactly mirroring
 * restoreOne()'s absent-marker convention: "before" is always
 * '(missing)' is NOT assumed -- it is computed from whatever the file's
 * actual pre-deletion content hash was (recorded by the spec at creation
 * time would be circular; instead we simply verify the file is GONE
 * after -- existsSync false -- and print both states for an operator to
 * audit, throwing if deletion somehow didn't take). */
function cleanupGuestAuthFiles(): void {
  if (!existsSync(GUEST_AUTH_TRACKED_FILES_PATH)) {
    console.log('[global-teardown] no guest-auth tracked-files ledger found -- nothing to clean up');
    return;
  }
  let tracked: TrackedFile[] = [];
  try {
    tracked = JSON.parse(readFileSync(GUEST_AUTH_TRACKED_FILES_PATH, 'utf8'));
  } catch (e) {
    console.warn('[global-teardown] guest-auth tracked-files ledger unreadable/corrupt -- skipping cleanup:', e);
    return;
  }
  if (tracked.length === 0) {
    console.log('[global-teardown] guest-auth tracked-files ledger is empty -- nothing to clean up');
    return;
  }
  const errors: Error[] = [];
  for (const { path: filePath, label } of tracked) {
    try {
      const hashBefore = sha256(filePath);
      if (existsSync(filePath)) rmSync(filePath);
      const hashAfter = sha256(filePath);
      const ok = hashAfter === '(missing)';
      console.log(`[global-teardown] guest-auth: removed ${label} (${filePath}) -- sha256 before=${hashBefore} after=${hashAfter} deleted=${ok}`);
      if (!ok) {
        throw new Error(`guest-auth cleanup FAILED for ${label} (${filePath}): file still present after rmSync (hash=${hashAfter})`);
      }
    } catch (e) {
      errors.push(e instanceof Error ? e : new Error(String(e)));
    }
  }
  if (errors.length > 0) {
    throw new Error('global-teardown guest-auth cleanup failures: ' + errors.map((e) => e.message).join(' | '));
  }
}

export default async function globalTeardown(): Promise<void> {
  // Restore ALL tracked files even if one throws partway -- collect
  // errors and raise after attempting every restore, so a failure
  // restoring the profile (say) never skips restoring the content files
  // or the REQ-0037 guest-auth player cleanup.
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
  try {
    cleanupGuestAuthFiles();
  } catch (e) {
    errors.push(e instanceof Error ? e : new Error(String(e)));
  }
  // fix: e2e pg teardown -- delete every warehouse row the run just
  // left on the dev player (in pg mode those rows live in Postgres, so
  // the file restores above never covered them; ~55-60 per full run
  // against the 200-row cap). Same errors-collect contract as the
  // restores: a failed cleanup is LOUD, never silently skipped. See
  // clearDevWarehouseDebris' doc comment in global-setup.ts.
  try {
    await clearDevWarehouseDebris('global-teardown');
  } catch (e) {
    errors.push(e instanceof Error ? e : new Error(String(e)));
  }
  // REQ-0066: leave the dev player's hall exactly as empty as global-setup
  // found it -- see clearDevEinherjarRecords' own doc comment.
  try {
    await clearDevEinherjarRecords('global-teardown');
  } catch (e) {
    errors.push(e instanceof Error ? e : new Error(String(e)));
  }
  if (errors.length > 0) {
    throw new Error('global-teardown restore failures: ' + errors.map((e) => e.message).join(' | '));
  }
}
