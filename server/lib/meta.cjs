'use strict';
// server/lib/meta.cjs -- REQ-0047 (c): service identity constants.
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8802; // REQ-0083: env-overridable for the per-worker e2e API fleet
const VERSION = '0.1.0';
module.exports = { HOST, PORT, VERSION };
