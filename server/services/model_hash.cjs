'use strict';
// server/services/model_hash.cjs -- REQ-0151 ruling 4 / gate G3.
//
// "Fix filename-only model pinning": every render's params snapshot must
// record the unet/clip/vae FILENAMES *and* the sha256 CONTENT HASH of each
// model file. Hashing a multi-GB GGUF is expensive, so the spec is
// explicit: the hash is computed ONCE PER MODEL FILE and cached by
// (path, size, mtime) -- NOT recomputed per render. This module owns that
// cache (in-memory, keyed by path:size:mtimeMs) so the long-lived api
// process pays the cost once and every later render reuses it.
//
// Model files are resolved under ART_MODEL_DIR (default ~/ComfyUI/models),
// searching the standard ComfyUI subdirs. In the mocked-backend test/e2e
// environment ART_MODEL_DIR points at a temp dir holding three tiny
// stand-in files named exactly like the real models, so the recorded
// hashes are genuine content hashes (present + verifiable) without needing
// the real 5 GB weights or a GPU.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SUBDIRS = ['', 'unet', 'diffusion_models', 'clip', 'text_encoders', 'vae'];

// path:size:mtimeMs -> sha256. Persists for the life of the process.
const hashCache = new Map();

function modelBaseDir() {
  return process.env.ART_MODEL_DIR || path.join(os.homedir(), 'ComfyUI', 'models');
}

function resolveModelPath(filename) {
  const base = modelBaseDir();
  for (const sub of SUBDIRS) {
    const p = path.join(base, sub, filename);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

function sha256File(p) {
  const st = fs.statSync(p);
  const key = p + ':' + st.size + ':' + st.mtimeMs;
  const cached = hashCache.get(key);
  if (cached) return Promise.resolve(cached);
  // STREAMED, never fs.readFileSync: readFileSync refuses files > 2 GiB
  // (ERR_FS_FILE_TOO_LARGE) and the flux2 GGUF alone is 4.3 GB, so the
  // readFileSync version failed EVERY real generation after a successful
  // ComfyUI render, while the mocked test env (tiny stand-in model files)
  // stayed green. Mirrors tools/backfill_registry.cjs sha256Stream.
  // (hotfix 2026-07-15, user-approved)
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('data', (d) => h.update(d));
    s.on('end', () => { const hex = h.digest('hex'); hashCache.set(key, hex); resolve(hex); });
  });
}

/** Resolve + hash a single model filename. Returns
 * {file, sha256, hash_source}. hash_source is 'content' when the real file
 * was found and hashed, or 'missing_file_fallback' (sha256 of the filename
 * string) when it was not -- so a hash is ALWAYS present (gate G3) even on
 * a box without the weights, while still being honestly distinguishable
 * from a real content hash. */
async function hashOne(filename) {
  const p = resolveModelPath(filename);
  if (p) return { file: filename, sha256: await sha256File(p), hash_source: 'content' };
  const fallback = crypto.createHash('sha256').update('missing:' + filename).digest('hex');
  return { file: filename, sha256: fallback, hash_source: 'missing_file_fallback' };
}

/** Given the FLUX model map {unet, clip, vae} (filenames, straight from
 * art_route.FLUX at run time), return the same keys mapped to
 * {file, sha256, hash_source}. */
async function hashModelFiles(flux) {
  return {
    unet: await hashOne(flux.unet),
    clip: await hashOne(flux.clip),
    vae: await hashOne(flux.vae),
  };
}

module.exports = { hashModelFiles, hashOne, resolveModelPath, modelBaseDir };
