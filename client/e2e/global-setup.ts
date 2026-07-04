// Global setup — REQ-0031 Phase A profile safety, extended REQ-0035 to
// also cover content/live/*.json (the admin-edit E2E round-trip test
// PUTs real edits there), extended REQ-0037 to also cover the player
// registry (data/players/) and any per-player profile files the guest-
// auth E2E spec creates.
//
// This E2E suite exercises the REAL live API against the REAL live
// profile file (~/backpack_ragnarok/data/profiles/default.json) -- there
// is no separate test/staging profile (server/README.md: profile ids are
// now "any known player id", but the DEV player's own profile is still a
// single real, persistent file exercised by most existing specs). Several
// tests PUT canvas state (Save button, or a raw PUT used as test-fixture
// setup) which overwrites that file. REQ-0035 adds a second category: the
// admin edit-mode E2E spec edits content/live/live_items.json (or
// live_sis.json) via the real PUT /api/admin/item/:id endpoint, exactly
// the same "real file, no staging copy" situation the profile file has
// always been in. REQ-0037 adds a THIRD category: guest-auth.spec.ts
// creates brand-new player registry files (data/players/<id>.json) via
// server/cli_invite.cjs and their own profile files (data/profiles/
// <id>.json) -- these did NOT exist before the run, so they are tracked
// here (for symmetry / a single safety net) but use the "absent" marker
// convention (see backupOne()) since there is nothing to back up, only
// something to make sure gets cleaned up afterward.
//
// All categories get the identical safety treatment:
//   1. globalSetup (this file) copies each tracked file to a timestamped
//      backup under /tmp BEFORE any test runs (or records its absence).
//   2. globalTeardown (global-teardown.ts) copies it back byte-for-byte
//      AFTER the whole run (Playwright guarantees globalTeardown runs
//      even if tests fail/throw, as long as globalSetup completed), or
//      DELETES it if it was absent before the run.
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

// REQ-0037 additions: the guest-auth E2E spec mints two fresh guest
// players via server/cli_invite.cjs (or the registry module directly).
// Both their registry files AND their profile files are tracked here so
// teardown can prove (sha256) that nothing test-created is left behind.
// These paths are computed dynamically (the playerIds are generated at
// test-setup time, not known ahead of the run), so this file exports
// PLAYERS_DIR/PROFILES_DIR + a small helper the spec itself calls to
// register exactly which files it created.
export const PLAYERS_DIR = join(REPO_ROOT, 'data', 'players');
export const PROFILES_DIR = join(REPO_ROOT, 'data', 'profiles');
// A JSON array of {path, markerPath} pairs the guest-auth spec appends to
// as it creates test players, so THIS module (global-teardown) can loop
// over an a-priori-unknown set of files without hardcoding playerIds.
export const GUEST_AUTH_TRACKED_FILES_PATH = '/tmp/backpack_e2e_guest_auth_tracked_files.json';

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
  // REQ-0037: reset the tracked-files ledger for guest-auth.spec.ts at the
  // START of every run (the spec itself appends to it as it creates
  // players) -- an empty array means "no guest-auth test has registered
  // anything yet"; global-teardown.ts tolerates this file being absent OR
  // an empty array equally (nothing to clean up).
  writeFileSync(GUEST_AUTH_TRACKED_FILES_PATH, '[]\n');
  console.log('[global-setup] reset guest-auth tracked-files ledger');
}
