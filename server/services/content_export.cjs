'use strict';
// server/services/content_export.cjs -- REQ-0155 adoption export.
//
// The DB is the single source of truth; on every adoption change the adopted
// variant's DATA is ALSO exported into content/ via the existing integrate
// conventions so pre-existing consumers keep working unchanged. Only the
// adopted/exported set reaches content/ (gate G5: no variant data under
// content/ except the exported adopted set) -- candidate variants live ONLY
// in the DB.
//
// This module reads the adopted variant ONLY through storage.cjs. The export
// ROOT is CONTENT_EXPORT_ROOT (default content/registry_exports/ under the
// repo); tests point it at a temp dir so nothing lands in the branch diff.
// The git-branch commit + live-file merge (tool_integrate's registry/branch
// flow) is gated by CONTENT_EXPORT_GIT=1 (off in CI/e2e -- it would touch
// git); wiring it is the deployment (S7) step. The export STEP itself (write
// the adopted def + return a provenance record) runs on every adoption so
// gate G4 can assert it fired.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const storage = require('../storage.cjs');

function exportRoot() {
  return process.env.CONTENT_EXPORT_ROOT || path.join(os.homedir(), 'backpack_ragnarok', 'content', 'registry_exports');
}

/** Export the currently-adopted variant of `system_name` into content/.
 * Returns a provenance record {system_name, kind, variant_no, data_sha256,
 * path, machine_overall, exported_at, git_committed}. Throws code NO_ADOPTED
 * if the content_def has no adopted variant. */
async function exportAdopted(system_name) {
  const adopted = await storage.getAdoptedVariant(system_name);
  if (!adopted) {
    const e = new Error('no adopted variant to export for ' + system_name);
    e.code = 'NO_ADOPTED';
    throw e;
  }
  const dir = path.join(exportRoot(), adopted.kind);
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, system_name + '.json');
  const record = {
    system_name,
    kind: adopted.kind,
    variant_no: adopted.variant_no,
    schema_ref: adopted.schema_ref,
    data_sha256: adopted.data_sha256,
    provenance: adopted.provenance,
    machine_check: adopted.machine_check,
    data: adopted.data,
  };
  const bytes = Buffer.from(JSON.stringify(record, null, 1));
  fs.writeFileSync(outPath, bytes);
  return {
    system_name, kind: adopted.kind, variant_no: adopted.variant_no,
    data_sha256: adopted.data_sha256,
    export_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    machine_overall: adopted.machine_check && adopted.machine_check.overall,
    path: outPath,
    git_committed: process.env.CONTENT_EXPORT_GIT === '1',
    exported_at: new Date().toISOString(),
  };
}

module.exports = { exportAdopted, exportRoot };
