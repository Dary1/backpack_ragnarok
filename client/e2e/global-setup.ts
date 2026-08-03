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
import { E2E_DATA_ROOT, E2E_FLEET_ROOT } from './e2e-env';
import { assertGpuRenderer } from './gpu';

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
// REQ-0234 (F4): scoped BY the fleet root -- two concurrent scoped runs
// used to share (and reset/sweep) one global /tmp ledger, falsifying the
// "scoped runs share nothing box-global" claim. The fleet root exists by
// the time this is written (fleet start mkdirs it, and the write below
// happens after the fleet boot).
export const GUEST_AUTH_TRACKED_FILES_PATH = join(E2E_FLEET_ROOT, 'guest_auth_tracked_files.json');



// REQ-0117: box-serialization safety net + orphaned-drift self-heal.
// The real exclusive lock is held by tools/e2e_run.sh (fd 9, whole-run
// lifetime, crash-safe). This in-harness probe only catches a DIRECT
// `playwright test` that bypassed the wrapper.
const BOX_LOCK_FILE = process.env.E2E_LOCK_FILE || join(homedir(), '.cache', 'backpack', 'e2e.box.lock');

function probeBoxLock(): void {
  // REQ-0217: a SCOPED run (custom E2E_FLEET_ROOT + proxy/fleet ports) shares
  // nothing box-global -- the box lock does not apply to it.
  if (process.env.E2E_FLEET_ROOT) { console.log('[global-setup] scoped run (E2E_FLEET_ROOT set) -- box lock not required'); return; }
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


// REQ-0344: the GPU flag list and the renderer probe that used to live here
// moved to e2e/gpu.ts, unchanged in behaviour. They were duplicated between
// this file and playwright.config.ts and absent from the four standalone
// admin/registry configs, which is the whole reason REQ-0342's default never
// reached [6.5/8]. One definition, six consumers.


export default async function globalSetup(): Promise<void> {
  // REQ-0225 (ratified via REQ-0234): a NON-local baseURL from a linked
  // worktree tests the DEPLOYED code, not this branch -- the mistake is
  // otherwise silent (REQ-0208 burned a full box-locked run on it). Warn
  // loudly; E2E_REQUIRE_WORKTREE=1 turns the warning into an abort.
  const base = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:8803';
  const isLocalBase = base.includes('127.0.0.1') || base.includes('localhost');
  if (!isLocalBase && process.cwd().includes('backpack_ragnarok_worktrees')) {
    const msg = '[global-setup] REQ-0225: baseURL ' + base + ' is NOT this worktree -- ' +
      'you are about to test the DEPLOYED master, not your branch. Canonical worktree run: ' +
      'tools/ci.sh (its [7/7] auto-scopes to this REQ\'s decade) or the scoped env block in ' +
      'docs/llm_managed/e2e_harness.md.';
    if (process.env.E2E_REQUIRE_WORKTREE === '1') throw new Error(msg + ' (E2E_REQUIRE_WORKTREE=1 -> abort)');
    console.warn('\n' + '='.repeat(78) + '\n' + msg + '\n' + '='.repeat(78) + '\n');
  }
  // REQ-0117: fail fast if another run holds the box -- the proxy/fleet
  // PORTS are the only box-global resource a hermetic run still shares.
  probeBoxLock();
  // REQ-0217: the fleet is UNCONDITIONAL -- serial mode is a fleet of one.
  // Every worker backend is built fresh from the worktree + committed
  // fixtures (tools/e2e_fleet.cjs buildHome) and torn down after the run.
  const parallelWorkers = Math.max(1, Number(process.env.E2E_PARALLEL || 1));
  // REQ-0234 (F6): a scoped run's fleet lives at decade indexes 4..9, so
  // more than 6 workers would silently claim the NEXT REQ's decade.
  const fleetBase = Number(process.env.E2E_FLEET_BASE_PORT || 0);
  if (process.env.E2E_FLEET_ROOT && fleetBase % 10 === 4 && parallelWorkers > 6) {
    throw new Error('[global-setup] E2E_PARALLEL=' + parallelWorkers + ' exceeds the 6 fleet slots a REQ decade holds (indexes 4-9, PROJECT.md port rule) -- lower it.');
  }
  execFileSync('node', [join(process.cwd(), '..', 'tools', 'e2e_fleet.cjs'), 'start', String(parallelWorkers)], { stdio: 'inherit' });
  // REQ-0331 (F1): prove the GPU path is real before 190+ tests rely on it.
  await assertGpuRenderer();
  // REQ-0037: reset the tracked-files ledger for guest-creating specs at
  // the START of every run (each spec appends the worker-HOME files it
  // creates; teardown sweeps whatever is registered).
  writeFileSync(GUEST_AUTH_TRACKED_FILES_PATH, '[]\n');
  console.log('[global-setup] reset guest-auth tracked-files ledger');
}
