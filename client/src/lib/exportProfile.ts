// client/src/lib/exportProfile.ts -- REQ-0377 item 7, EXPORT half.
//
// "Export = download of the profile JSON via existing reads" (the REQ's own
// scoping). So this adds NO endpoint: it composes GET /api/me and
// GET /api/profile/:id/canvas, both of which the app already calls on every
// boot, into one file the player can keep.
//
// The DELETE half of item 7 is deliberately NOT here -- it needs a hand-written
// cascade across every per-player storage subsystem in BOTH backends (there is
// no FK cascade to lean on; server/migrations/001_init.sql says so in as many
// words), which is a REQ, not a function. It is split out as REQ-0377a.
//
// Why the envelope carries `build` and `schemaVersion`: an export is only worth
// having if it can be read back later, and the reader will need to know which
// version of the game wrote it. The canvas doc's own schema_version rides along
// inside `profile`; `build` names the code.
import { fetchCanvas, fetchHealth, fetchMe } from '../api';
import type { ApiCanvasDoc, ApiMe } from '../api';

export interface ProfileExport {
  kind: 'backpack_ragnarok.profile_export';
  version: 1;
  exportedAt: string;
  build: string | null;
  account: ApiMe;
  /** null when the player has never saved a canvas (a fresh account). */
  profile: ApiCanvasDoc | null;
}

/** Composes the export document. Pure-ish: does the reads, does no DOM work,
 * so it is callable from a test without a browser. */
export async function buildProfileExport(): Promise<ProfileExport> {
  const account = await fetchMe();
  // Both of these are best-effort relative to the account read: a player whose
  // canvas 404s (never saved) or whose /api/health hiccups must still get their
  // account data, not an error dialog. fetchCanvas already maps 404 -> null.
  const [profile, build] = await Promise.all([
    fetchCanvas(account.playerId).catch(() => null),
    fetchHealth().then((h) => h.build).catch(() => null),
  ]);
  return {
    kind: 'backpack_ragnarok.profile_export',
    version: 1,
    exportedAt: new Date().toISOString(),
    build,
    account,
    profile,
  };
}

/** Filename stem: player id + UTC date, so repeated exports sort and never
 * silently overwrite each other in a downloads folder. */
export function exportFilename(playerId: string, now = new Date()): string {
  const safe = playerId.replace(/[^A-Za-z0-9_-]/g, '_');
  return `backpack_ragnarok_${safe}_${now.toISOString().slice(0, 10)}.json`;
}

/** Triggers the browser download. Split from buildProfileExport so the data
 * shape can be tested without jsdom. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    // Firefox requires the anchor to be IN the document for a programmatic
    // click to count as a user-initiated download.
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Revoking synchronously can race the download start in some browsers;
    // one tick is enough and the object cannot leak past it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
