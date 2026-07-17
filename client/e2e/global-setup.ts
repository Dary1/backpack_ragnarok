// Global setup -- REQ-0217 hermetic e2e.
//
// An e2e run owns NOTHING outside its throwaway per-worker backends:
// tools/e2e_fleet.cjs builds one HOME per Playwright worker under
// /tmp/bp_e2e_workers from THIS WORKTREE's code/content plus the committed
// fixtures in client/e2e/fixtures/, and client/e2e/local-proxy.cjs routes
// every /api request to a fleet backend (headerless -> worker 0; NEVER the
// live api on :8802) while serving /app from the worktree build. The old
// model -- live api + dev player + backup/restore of the live profile and
// content/live files + dev-scoped pg cleanup hooks -- is retired: its
// files-era safety net stopped protecting anything when storage moved to
// pg (2026-07-17 incident: a full-CI run overwrote the live dev profile
// with fixtures; see docs/REQ/REQ-0217-hermetic-e2e.md), and a hermetic
// run has no live state to protect in the first place.
//
// What remains here: the REQ-0117 box-lock probe (fleet/proxy PORTS are
// still box-global), the unconditional fleet boot, and the guest-auth
// tracked-files ledger reset (specs register the worker-HOME files they
// mint; global-teardown sweeps them independently of the fleet's own rm).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { E2E_DATA_ROOT } from './e2e-env';

// Guest-auth ledger: guest-creating specs mint fresh players via
// server/cli_invite.cjs INTO THEIR WORKER'S HOME (e2e-env.ts) and register
// the created files here so teardown can sweep them independently.
// These paths are computed dynamically (the playerIds are generated at
// test-setup time, not known ahead of the run), so this file exports
// PLAYERS_DIR/PROFILES_DIR + a small helper the spec itself calls to
// register exactly which files it created.
export const PLAYERS_DIR = join(E2E_DATA_ROOT, 'data', 'players');
export const PROFILES_DIR = join(E2E_DATA_ROOT, 'data', 'profiles');
// A JSON array of {path, markerPath} pairs the guest-auth spec appends to
// as it creates test players, so THIS module (global-teardown) can loop
// over an a-priori-unknown set of files without hardcoding playerIds.
export const GUEST_AUTH_TRACKED_FILES_PATH = '/tmp/backpack_e2e_guest_auth_tracked_files.json';



// REQ-0117: box-serialization safety net + orphaned-drift self-heal.
// The real exclusive lock is held by tools/e2e_run.sh (fd 9, whole-run
// lifetime, crash-safe). This in-harness probe only catches a DIRECT
// `playwright test` that bypassed the wrapper.
const BOX_LOCK_FILE = process.env.E2E_LOCK_FILE || join(homedir(), '.cache', 'backpack', 'e2e.box.lock');

function probeBoxLock(): void {
  if (process.env.E2E_BOX_LOCK_HELD === '1') return; // our own wrapper holds it
  mkdirSync(dirname(BOX_LOCK_FILE), { recursive: true });
  try {
    // acquire + immediately release: exit 0 => the box was free
    execFileSync('flock', ['-n', BOX_LOCK_FILE, '-c', 'true'], { stdio: 'ignore' });
    console.warn('[global-setup] WARNING (REQ-0117): e2e was not launched via tools/e2e_run.sh, so no box lock is held. No collision now, but this run is UNPROTECTED against a concurrent run -- prefer `pnpm run e2e`.');
  } catch {
    throw new Error(`[global-setup] ABORT (REQ-0117): the e2e box is busy -- another run holds ${BOX_LOCK_FILE}. Starting now would collide (concurrent global-setup clears shared dev state and races the live profile/content). Re-run via \`pnpm run e2e\` (queues up to E2E_LOCK_WAIT s) or set E2E_LOCK_NONBLOCK=1 to fail fast.`);
  }
}


export default async function globalSetup(): Promise<void> {
  // REQ-0117: fail fast if another run holds the box -- the proxy/fleet
  // PORTS are the only box-global resource a hermetic run still shares.
  probeBoxLock();
  // REQ-0217: the fleet is UNCONDITIONAL -- serial mode is a fleet of one.
  // Every worker backend is built fresh from the worktree + committed
  // fixtures (tools/e2e_fleet.cjs buildHome) and torn down after the run.
  const parallelWorkers = Math.max(1, Number(process.env.E2E_PARALLEL || 1));
  execFileSync('node', [join(process.cwd(), '..', 'tools', 'e2e_fleet.cjs'), 'start', String(parallelWorkers)], { stdio: 'inherit' });
  // REQ-0037: reset the tracked-files ledger for guest-creating specs at
  // the START of every run (each spec appends the worker-HOME files it
  // creates; teardown sweeps whatever is registered).
  writeFileSync(GUEST_AUTH_TRACKED_FILES_PATH, '[]\n');
  console.log('[global-setup] reset guest-auth tracked-files ledger');
}
