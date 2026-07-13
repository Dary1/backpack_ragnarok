// backpack_ragnarok — server/storage/market.cjs
// REQ-0145a (sb): market persistence (listings / furnace ledger / dex
// price history) extracted verbatim from the pre-split server/storage.cjs
// (origin lines 693-875 @ commit fda9ffb). REQ-0064 roots -- see the
// section comment below.
'use strict';
const fs = require('fs');
const path = require('path');
const { REPO_ROOT, NAMESPACE, backendMode, namespacedId, atomicWriteJSON } = require('./lib.cjs');

// ---- REQ-0064: Market persistence (listings / furnace ledger / dex price history) ----
// Same "one persistence root per concern, files+pg parity" convention as
// every root above. Three new roots (server/migrations/004_market.sql):
//   listings:    data/market/listings/<listingId>.json | pg: market_listings
//   furnace:     data/market/furnace/<entryId>.json    | pg: market_furnace
//     (APPEND-ONLY ledger -- one immutable row per settlement burn;
//     there is deliberately no update/delete API for it)
//   dex history: data/market/dex_history/<itemId>.json | pg: market_dex_history
//     (rolling last-5 settled prices per content item id)
// pg-mode test isolation reuses the SAME NAMESPACE prefix as everything
// else. Listings are a GLOBAL root (the market is market-wide, unlike
// the per-player warehouse): listMarketListings() returns every listing
// in the namespace; per-seller/state filtering is the service's job
// (server/services/market.cjs) at today's scale, while the pg table
// already carries indexed seller_id/state columns for the day volume
// warrants pushing those filters into SQL.

const MARKET_DIR = path.join(REPO_ROOT, 'data', 'market');
const MARKET_LISTINGS_DIR = path.join(MARKET_DIR, 'listings');
const MARKET_FURNACE_DIR = path.join(MARKET_DIR, 'furnace');
const MARKET_DEX_HISTORY_DIR = path.join(MARKET_DIR, 'dex_history');

function ensureMarketDirs() {
  fs.mkdirSync(MARKET_LISTINGS_DIR, { recursive: true });
  fs.mkdirSync(MARKET_FURNACE_DIR, { recursive: true });
  fs.mkdirSync(MARKET_DEX_HISTORY_DIR, { recursive: true });
}
ensureMarketDirs();

function marketListingPath(id) { return path.join(MARKET_LISTINGS_DIR, id + '.json'); }
function marketFurnacePath(id) { return path.join(MARKET_FURNACE_DIR, id + '.json'); }
function marketDexHistoryPath(itemId) { return path.join(MARKET_DEX_HISTORY_DIR, itemId + '.json'); }

// ---- market listings: files backend ----

function readMarketListingFiles(id) {
  const p = marketListingPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeMarketListingFiles(id, doc) {
  atomicWriteJSON(MARKET_LISTINGS_DIR, marketListingPath(id), doc);
  return doc;
}
function listMarketListingsFiles() {
  ensureMarketDirs();
  const files = fs.readdirSync(MARKET_LISTINGS_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(MARKET_LISTINGS_DIR, f), 'utf8'))); }
    catch (e) { /* skip unreadable/corrupt */ }
  }
  return out;
}

// ---- market listings: pg backend ----

function readMarketListingPg(id) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM market_listings WHERE listing_id = $1', [namespacedId(id)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeMarketListingPg(id, doc) {
  const { querySync } = require('../pg_sync.cjs');
  // seller_id/state/created_at are always derived from the doc itself
  // (writeMarketListing's contract), so the columns can never drift
  // from the document -- same doc-is-truth posture as writeRun's
  // roomId-column derivation above.
  querySync(
    'INSERT INTO market_listings (listing_id, seller_id, state, doc, created_at, updated_at) ' +
    'VALUES ($1, $2, $3, $4::jsonb, $5, now()) ' +
    'ON CONFLICT (listing_id) DO UPDATE SET seller_id = EXCLUDED.seller_id, state = EXCLUDED.state, doc = EXCLUDED.doc, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at',
    [namespacedId(id), namespacedId(doc.sellerId), doc.state, JSON.stringify(doc), doc.createdAt]
  );
  return doc;
}
function listMarketListingsPg() {
  const { querySync } = require('../pg_sync.cjs');
  const prefix = NAMESPACE + ':';
  const res = querySync('SELECT doc FROM market_listings WHERE listing_id LIKE $1', [prefix + '%']);
  return res.rows.map((r) => r.doc);
}

// ---- market listings: public API ----
// `doc` must carry sellerId/state/createdAt (the pg backend derives its
// real columns from them; the files backend stores the doc verbatim).

function readMarketListing(id) {
  return backendMode() === 'pg' ? readMarketListingPg(id) : readMarketListingFiles(id);
}
function writeMarketListing(id, doc) {
  if (!doc || typeof doc.sellerId !== 'string' || !doc.sellerId || typeof doc.state !== 'string' || !doc.state) {
    throw new Error('writeMarketListing: doc.sellerId and doc.state are required');
  }
  return backendMode() === 'pg' ? writeMarketListingPg(id, doc) : writeMarketListingFiles(id, doc);
}
function listMarketListings() {
  return backendMode() === 'pg' ? listMarketListingsPg() : listMarketListingsFiles();
}

// ---- market furnace ledger (append-only): files + pg backends ----

function writeMarketFurnaceEntryFiles(doc) {
  atomicWriteJSON(MARKET_FURNACE_DIR, marketFurnacePath(doc.id), doc);
  return doc;
}
function writeMarketFurnaceEntryPg(doc) {
  const { querySync } = require('../pg_sync.cjs');
  // ON CONFLICT DO NOTHING: the ledger is append-only -- a duplicate id
  // (can only arise from a caller bug) must never rewrite history.
  querySync(
    'INSERT INTO market_furnace (entry_id, doc, burned_at, updated_at) VALUES ($1, $2::jsonb, $3, now()) ' +
    'ON CONFLICT (entry_id) DO NOTHING',
    [namespacedId(doc.id), JSON.stringify(doc), doc.t]
  );
  return doc;
}
function listMarketFurnaceEntriesFiles() {
  ensureMarketDirs();
  const files = fs.readdirSync(MARKET_FURNACE_DIR).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const out = [];
  for (const f of files) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(MARKET_FURNACE_DIR, f), 'utf8'))); }
    catch (e) { /* skip */ }
  }
  return out;
}
function listMarketFurnaceEntriesPg() {
  const { querySync } = require('../pg_sync.cjs');
  const prefix = NAMESPACE + ':';
  const res = querySync('SELECT doc FROM market_furnace WHERE entry_id LIKE $1', [prefix + '%']);
  return res.rows.map((r) => r.doc);
}

// ---- market furnace ledger: public API ----
// `doc` must carry {id, amount, listingId, t} (see services/market.cjs's
// buyListing step 6/7). Append-only by design: write + list, no
// update/delete surface at all.

function writeMarketFurnaceEntry(doc) {
  if (!doc || typeof doc.id !== 'string' || !doc.id || typeof doc.t !== 'string') {
    throw new Error('writeMarketFurnaceEntry: doc.id and doc.t are required');
  }
  return backendMode() === 'pg' ? writeMarketFurnaceEntryPg(doc) : writeMarketFurnaceEntryFiles(doc);
}
function listMarketFurnaceEntries() {
  return backendMode() === 'pg' ? listMarketFurnaceEntriesPg() : listMarketFurnaceEntriesFiles();
}

// ---- market dex price history: files + pg backends ----

function readMarketDexHistoryFiles(itemId) {
  const p = marketDexHistoryPath(itemId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeMarketDexHistoryFiles(itemId, doc) {
  atomicWriteJSON(MARKET_DEX_HISTORY_DIR, marketDexHistoryPath(itemId), doc);
  return doc;
}
function readMarketDexHistoryPg(itemId) {
  const { querySync } = require('../pg_sync.cjs');
  const res = querySync('SELECT doc FROM market_dex_history WHERE item_id = $1', [namespacedId(itemId)]);
  return res.rows.length > 0 ? res.rows[0].doc : null;
}
function writeMarketDexHistoryPg(itemId, doc) {
  const { querySync } = require('../pg_sync.cjs');
  querySync(
    'INSERT INTO market_dex_history (item_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ' +
    'ON CONFLICT (item_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = EXCLUDED.updated_at',
    [namespacedId(itemId), JSON.stringify(doc)]
  );
  return doc;
}

// ---- market dex price history: public API ----

function readMarketDexHistory(itemId) {
  return backendMode() === 'pg' ? readMarketDexHistoryPg(itemId) : readMarketDexHistoryFiles(itemId);
}
function writeMarketDexHistory(itemId, doc) {
  return backendMode() === 'pg' ? writeMarketDexHistoryPg(itemId, doc) : writeMarketDexHistoryFiles(itemId, doc);
}

module.exports = {
  MARKET_LISTINGS_DIR,
  MARKET_FURNACE_DIR,
  MARKET_DEX_HISTORY_DIR,
  marketListingPath,
  readMarketListing,
  writeMarketListing,
  listMarketListings,
  writeMarketFurnaceEntry,
  listMarketFurnaceEntries,
  readMarketDexHistory,
  writeMarketDexHistory,
};
