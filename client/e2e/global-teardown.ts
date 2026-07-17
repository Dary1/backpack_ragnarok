// Global teardown -- REQ-0217 hermetic e2e. The run owns NOTHING outside
// its throwaway worker HOMEs (/tmp/bp_e2e_workers, built by global-setup
// via tools/e2e_fleet.cjs), so teardown is just: sweep the guest-auth
// ledger (worker-HOME files registered by guest-creating specs -- swept
// BEFORE the fleet's own rm so the sweep can still see them and stay an
// independent, auditable pass), then stop the fleet (which removes the
// worker HOMEs wholesale). The old live-state restore machinery (live
// profile + content/live backups, dev-player pg cleanup hooks) is retired
// WITH the live coupling itself -- a hermetic run has no live state to
// restore. See docs/REQ/REQ-0217-hermetic-e2e.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { GUEST_AUTH_TRACKED_FILES_PATH } from './global-setup';

interface TrackedFile {
  path: string;
  label: string;
}

function cleanupGuestAuthFiles(): void {
  if (!existsSync(GUEST_AUTH_TRACKED_FILES_PATH)) {
    console.log('[global-teardown] no guest-auth tracked-files ledger found -- nothing to sweep');
    return;
  }
  let tracked: TrackedFile[] = [];
  try {
    tracked = JSON.parse(readFileSync(GUEST_AUTH_TRACKED_FILES_PATH, 'utf8'));
  } catch (e) {
    console.warn('[global-teardown] guest-auth tracked-files ledger unreadable/corrupt -- skipping sweep:', e);
    return;
  }
  for (const { path: filePath, label } of tracked) {
    try {
      if (existsSync(filePath)) {
        rmSync(filePath);
        console.log(`[global-teardown] guest-auth: removed ${label} (${filePath})`);
      }
    } catch (e) {
      console.warn(`[global-teardown] guest-auth sweep failed for ${label} (${filePath}):`, e);
    }
  }
}

export default async function globalTeardown(): Promise<void> {
  cleanupGuestAuthFiles();
  try {
    execFileSync('node', [process.cwd() + '/../tools/e2e_fleet.cjs', 'stop'], { stdio: 'inherit' });
  } catch (e) {
    console.warn('[global-teardown] fleet stop failed (best-effort):', e);
  }
}
