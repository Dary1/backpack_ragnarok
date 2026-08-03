#!/usr/bin/env node
'use strict';
// bot/bin/fleet.cjs -- REQ-0330 entry point for the reactive fleet daemon.
// `node bot/bin/fleet.cjs` (or the systemd unit) boots the fleet: it loads the
// REQ-0329 pool vault, clears each account through the identity guard, then runs
// the watcher/drip-joiner/auto-seller loops until stopped (SIGTERM/SIGINT ->
// clean stop; `systemctl --user stop backpack-fleet` is the kill switch).
//
// There is NO LLM here and no persuasion/tactics -- a deterministic daemon.
const { buildFleet } = require('../lib/fleet.cjs');
const { config } = require('../lib/config.cjs');

function main() {
  console.log('[fleet] REQ-0330 reactive test-play fleet starting');
  console.log('[fleet] apiBase=' + config.apiBase + ' vault=' + config.vaultRoot +
    ' joinInterval=' + config.joinIntervalMs + 'ms rateFloor=' + config.rateMinMs + 'ms');
  let fleet;
  try {
    fleet = buildFleet({});
  } catch (e) {
    console.error('[fleet] fatal: ' + e.message);
    process.exit(1);
  }
  const shutdown = (sig) => {
    console.log('[fleet] ' + sig + ' -- stopping');
    fleet.stop();
    // Give in-flight loops a moment to observe running=false, then exit.
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  fleet.start().catch((e) => { console.error('[fleet] crashed: ' + e.message); process.exit(1); });
}

main();
