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
import { request } from '@playwright/test';
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

// fix: e2e pg teardown -- the backup/restore net above only covers
// FILES. The live API runs STORAGE_BACKEND=pg (server/.env), so the
// warehouse rows this suite grants/claims for the dev player (admin
// grant hook, run rewards, gacha) live in Postgres and survived every
// run (~55-60 rows each) until the dev player's 200-row warehouse cap
// turned POST /api/admin/warehouse/grant into 409 warehouse-full
// cascades across the granting specs. Both global setup AND teardown
// call the dev-only debris-cleanup hook (POST /api/warehouse/dev/
// clear-debris, server/routes/schedule.cjs): setup so leftovers from a
// crashed or pre-hook run never eat the cap, teardown so a completed
// run leaves zero debris. The hook is gated exactly like the
// dev/backdate hooks (callerIsDevFallback -- NO token, dev_mode:true;
// any real guest token gets 403) and only ever clears the RESOLVED
// caller's (= dev player's) own rows; it dispatches through
// storage.cjs's files/pg chokepoint, so this stays correct (and green)
// when the API runs files mode too.
//
// The request goes to the API service port DIRECTLY (8802) rather than
// the tunnel baseURL: playwright.config.ts's use-the-tunnel constraint
// exists because BROWSER pages fetch /api/* relative to the page origin
// and only the tunnel ingress maps /api/* -> :8802 -- a server-side
// call from this rig (which already assumes same-box via its direct
// homedir() file access above) can hit :8802 itself and not depend on
// Cloudflare being healthy for cleanup. No auth header is attached,
// deliberately: the hook only honors the dev_mode NO-token fallback.
export const API_ORIGIN = 'http://127.0.0.1:8802';

export async function clearDevWarehouseDebris(phase: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_ORIGIN });
  try {
    const res = await ctx.post('/api/warehouse/dev/clear-debris');
    const bodyText = await res.text();
    if (res.status() === 404) {
      // The RUNNING API predates this hook (deployed code lags the repo
      // until backpack-api.service is restarted). Warn loudly rather
      // than brick the whole run over a cleanup step -- the only
      // consequence is the old debris-accumulation behavior, and it is
      // visible in this log line.
      console.warn(`[${phase}] POST /api/warehouse/dev/clear-debris -> 404 (running API predates the hook?) -- dev warehouse debris NOT cleared`);
      return;
    }
    if (!res.ok()) {
      throw new Error(`dev warehouse debris cleanup failed: POST ${API_ORIGIN}/api/warehouse/dev/clear-debris -> ${res.status()} ${bodyText}`);
    }
    const { deleted } = JSON.parse(bodyText) as { deleted: number };
    console.log(`[${phase}] cleared dev-player warehouse rows (POST /api/warehouse/dev/clear-debris deleted=${deleted})`);
  } finally {
    await ctx.dispose();
  }
}

// REQ-0066 addition: einherjar (Hall of Ragnarok devotion) records are
// immutable/permanent by design once a rite completes (server/services/
// ragnarok.cjs's S3 doc block) -- there is no gameplay path that ever
// clears one. Without this hook, ragnarok.spec.ts's own FULL RITE test
// permanently devotes the dev player, and every LATER run's "fresh
// player sees the empty hall" assertions (HALL STRIP, EMPTY/FIRST-
// SEASON) fail forever from that point on -- the same debris-
// accumulation class clearDevWarehouseDebris already handles for
// warehouse rows. Same call convention: direct to the API service port
// (8802), no auth header (dev_mode NO-token fallback only).
// clearDevScheduleRooms (REQ-0082): sibling of clearDevWarehouseDebris --
// bulk-clears the dev fallback player's accumulated schedule rooms (canceled
// rooms otherwise pile up every run; 154 seen in REQ-0082, which collapsed the
// create panel's zero-rooms auto-open and broke the REQ-0043 specs). Same
// dev_mode NO-token fallback caller, same 404-tolerance (deployed API may lag
// the repo until backpack-api.service restarts).
export async function clearDevScheduleRooms(phase: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_ORIGIN });
  try {
    const res = await ctx.post('/api/schedule/rooms/dev/clear');
    const bodyText = await res.text();
    if (res.status() === 404) {
      console.warn(`[${phase}] POST /api/schedule/rooms/dev/clear -> 404 (running API predates the hook?) -- dev schedule rooms NOT cleared`);
      return;
    }
    if (!res.ok()) {
      throw new Error(`dev schedule-rooms cleanup failed: POST ${API_ORIGIN}/api/schedule/rooms/dev/clear -> ${res.status()} ${bodyText}`);
    }
    const { deleted } = JSON.parse(bodyText) as { deleted: number };
    console.log(`[${phase}] cleared dev-player schedule rooms (POST /api/schedule/rooms/dev/clear deleted=${deleted})`);
  } finally {
    await ctx.dispose();
  }
}

export async function clearDevEinherjarRecords(phase: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_ORIGIN });
  try {
    const res = await ctx.post('/api/ragnarok/einherjar/dev/clear');
    const bodyText = await res.text();
    if (res.status() === 404) {
      // The RUNNING API predates this hook (deployed code lags the repo
      // until backpack-api.service is restarted) -- warn loudly rather
      // than brick the whole run over a cleanup step.
      console.warn(`[${phase}] POST /api/ragnarok/einherjar/dev/clear -> 404 (running API predates the hook?) -- dev einherjar records NOT cleared`);
      return;
    }
    if (!res.ok()) {
      throw new Error(`dev einherjar cleanup failed: POST ${API_ORIGIN}/api/ragnarok/einherjar/dev/clear -> ${res.status()} ${bodyText}`);
    }
    const { deleted } = JSON.parse(bodyText) as { deleted: number };
    console.log(`[${phase}] cleared dev-player einherjar records (POST /api/ragnarok/einherjar/dev/clear deleted=${deleted})`);
  } finally {
    await ctx.dispose();
  }
}

// REQ-0064 addition: nothing in market.spec.ts ever withdraws the
// listings seedSellerListing seeds (several tests never buy/withdraw
// what they created), so every suite run permanently adds more ACTIVE
// listings to the shared live market. Exact-count browse assertions
// (BUY: browse renders listing cards) can only ever pass against a
// browse view with nothing else already on the shelf -- see
// services/market.cjs's devClearAllListings() doc comment. Same call
// convention as clearDevWarehouseDebris/clearDevEinherjarRecords.
export async function clearAllMarketListings(phase: string): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_ORIGIN });
  try {
    const res = await ctx.post('/api/market/listings/dev/clear-all');
    const bodyText = await res.text();
    if (res.status() === 404) {
      console.warn(`[${phase}] POST /api/market/listings/dev/clear-all -> 404 (running API predates the hook?) -- market listings NOT cleared`);
      return;
    }
    if (!res.ok()) {
      throw new Error(`market listings cleanup failed: POST ${API_ORIGIN}/api/market/listings/dev/clear-all -> ${res.status()} ${bodyText}`);
    }
    const { cleared } = JSON.parse(bodyText) as { cleared: number };
    console.log(`[${phase}] cleared active market listings (POST /api/market/listings/dev/clear-all cleared=${cleared})`);
  } finally {
    await ctx.dispose();
  }
}

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
  // fix: e2e pg teardown -- start the run with full 200-row warehouse
  // cap headroom no matter what a previous (crashed, or pre-hook) run
  // left behind. See clearDevWarehouseDebris' own doc comment above.
  await clearDevWarehouseDebris('global-setup');
  await clearDevScheduleRooms('global-setup');
  // REQ-0066: start the run with a guaranteed-empty dev-player hall. See
  // clearDevEinherjarRecords' own doc comment above.
  await clearDevEinherjarRecords('global-setup');
  // REQ-0064: start the run with an empty market browse view. See
  // clearAllMarketListings' own doc comment above.
  await clearAllMarketListings('global-setup');
}
