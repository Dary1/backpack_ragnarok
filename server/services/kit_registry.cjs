'use strict';
// server/services/kit_registry.cjs -- REQ-0152. The Node-side view of the
// inspection-kit registry (tools/inspect_kits.json is the SINGLE source, also
// read by the Python runner). Provides kit routing (kits_for(kind)), the
// current kit_version (for the UI stale badge), and the kit_input_sha256 the
// staleness/re-run logic keys on. NO DB access here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST = path.join(__dirname, '..', '..', 'tools', 'inspect_kits.json');

let _kits = null;
function kits() {
  if (!_kits) _kits = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).kits;
  return _kits;
}
/** Kits registered for a kind (po|si|unit|monster|bpskin), in manifest order. */
function kitsFor(kind) { return kits().filter((k) => k.applies_to.includes(kind)); }
function kitMeta(kitId) { return kits().find((k) => k.kit_id === kitId) || null; }

// DEV/TEST-ONLY in-memory version override. Lets a test (or the e2e dev hook)
// simulate a kit_version BUMP without editing the manifest, so the stale-badge
// + re-run path is exercisable. Never used in production.
const _override = {};
function setVersionOverride(kitId, ver) { _override[kitId] = String(ver); }
function clearVersionOverrides() { for (const k of Object.keys(_override)) delete _override[k]; }
function kitVersion(kitId) {
  if (Object.prototype.hasOwnProperty.call(_override, kitId)) return _override[kitId];
  const k = kitMeta(kitId); return k ? k.kit_version : null;
}

/** Deterministic JSON (sorted keys) so Node and any other reader hash the
 * same bytes for the same value. */
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/** The declared kit params that (with the image) define a kit's input. Shape
 * + derived size are the only artwork fields any kit consults. */
function kitParams(artwork) {
  return {
    kind: artwork.kind,
    shape: artwork.shape == null ? null : artwork.shape,
    gen_width: artwork.gen_width,
    gen_height: artwork.gen_height,
  };
}

/** Staleness key: sha256 over the render's image identity (image_sha256 IS
 * sha256 of the stored PNG bytes) + kit id/version + kit params. Recomputed
 * identically at write time (the runner) and at staleness-check time (the
 * route), so a re-generated image (new image_sha256), an edited shape, or a
 * kit_version bump all flip it. */
function kitInputSha256(imageSha256, kitId, kitVer, artwork) {
  const canon = String(imageSha256) + '|' + kitId + '|' + kitVer + '|' + stableStringify(kitParams(artwork));
  return crypto.createHash('sha256').update(canon).digest('hex');
}

module.exports = { kits, kitsFor, kitMeta, kitVersion, kitInputSha256, kitParams, stableStringify, setVersionOverride, clearVersionOverrides };
