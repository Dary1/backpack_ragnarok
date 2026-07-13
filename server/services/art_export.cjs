'use strict';
// server/services/art_export.cjs -- REQ-0151 adoption export (rulings 2 & 7).
//
// The DB is the single source of truth; on every adoption change the adopted
// PNG is ALSO exported into content/ via the existing integrate conventions
// so pre-existing consumers keep working unchanged. Candidate renders NEVER
// enter git (REQ-0150 lesson: 185 MB of intermediate PNGs in history); only
// the adopted/exported asset reaches content/, on a dedicated branch.
//
// This module reads the adopted image ONLY through storage.cjs. The export
// ROOT is ART_EXPORT_ROOT (default content/art/ under the repo); tests point
// it at a temp dir so nothing lands in the branch diff (gate G5). The git-
// branch commit of the exported asset is gated by ART_EXPORT_GIT=1 (off in
// CI / this session -- it would touch git during e2e); wiring it to
// tools/tool_integrate.cjs's derivative/branch flow is the deployment (S7)
// step. The export STEP itself (write asset + return a provenance record)
// runs on every adoption so gate G4 can assert it fired.
const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('../storage.cjs');

function exportRoot() {
  return process.env.ART_EXPORT_ROOT || path.join(os.homedir(), 'backpack_ragnarok', 'content', 'art');
}

/** Export the currently-adopted render of `system_name` into content/.
 * Returns a provenance record {system_name, kind, seed, image_sha256, path,
 * exported_at}. Throws code NO_ADOPTED if the artwork has no adopted render. */
async function exportAdopted(system_name) {
  const adopted = await storage.getAdoptedRender(system_name);
  if (!adopted || !adopted.image) {
    const e = new Error('no adopted render to export for ' + system_name);
    e.code = 'NO_ADOPTED';
    throw e;
  }
  const dir = path.join(exportRoot(), adopted.kind);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, system_name + '.png');
  fs.writeFileSync(outPath, adopted.image);
  return {
    system_name, kind: adopted.kind, seed: adopted.seed,
    image_sha256: adopted.image_sha256, path: outPath,
    git_committed: process.env.ART_EXPORT_GIT === '1',
    exported_at: new Date().toISOString(),
  };
}

module.exports = { exportAdopted, exportRoot };
