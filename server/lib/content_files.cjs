'use strict';
// server/lib/content_files.cjs -- REQ-0145a (sc): THE one content-file
// loader. Every server-side resolution of a content/ path goes through
// contentPath() (and, where a call site wants the shared lenient cache,
// readJSONCached()). Before this REQ the same os.homedir()-anchored
// path + mtime-cache + module-evict test seam was hand-rolled in
// lib/content.cjs, services/core.cjs, services/market.cjs,
// services/ragnarok.cjs and admin.cjs -- so a worktree-launched server
// read the MAIN checkout's content, never its own tree's.
//
// CONTENT_ROOT (env, optional) overrides the root; the default
// expression is byte-equivalent to the pre-REQ behavior. Captured at
// module load (not per call) so the existing evict-and-re-require test
// seam rebinds it exactly like every other homedir-derived constant.
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(os.homedir(), 'backpack_ragnarok', 'content');

// contentPath('live', 'live_items.json') -> <CONTENT_ROOT>/live/live_items.json
function contentPath(/** @type {string[]} */ ...segs) {
  return path.join(CONTENT_ROOT, ...segs);
}

function statMtimeMs(p) {
  try { return fs.statSync(p).mtimeMs; } catch (e) { return null; }
}

// loadJSON: strict read -- throws on missing/corrupt (used where the
// content file is REQUIRED and failing loudly is the correct mode).
function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// readJSONCached: lenient shared mtime-cache -- returns null for a
// missing/corrupt file and re-reads only when the file's mtime changes
// (the contract the hand-rolled caches in services/market.cjs and
// services/ragnarok.cjs implement; offered here so future readers stop
// re-rolling it. The existing derived-value caches keep their own
// mtime-keyed memoization and only take PATHS from this module).
const jsonCache = new Map(); // absolute path -> { mtime, doc }
function readJSONCached(p) {
  const mtime = statMtimeMs(p);
  const hit = jsonCache.get(p);
  if (hit && hit.mtime === mtime) return hit.doc;
  let doc = null;
  if (mtime != null) {
    try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { doc = null; }
  }
  jsonCache.set(p, { mtime, doc });
  return doc;
}

module.exports = { CONTENT_ROOT, contentPath, statMtimeMs, loadJSON, readJSONCached };
