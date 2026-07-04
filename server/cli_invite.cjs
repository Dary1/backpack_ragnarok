#!/usr/bin/env node
// backpack_ragnarok — server/cli_invite.cjs
// REQ-0037: operator CLI to mint a guest invite. NOT exposed via HTTP --
// run by hand over SSH. Creates a new player record (server/players.cjs)
// and prints an invite URL the operator can hand to a guest.
//
// Usage:
//   node server/cli_invite.cjs <name> [--roles r1,r2]
//
// --roles omitted -> roles: [] (safe default; grant item_admin etc.
// explicitly). The invite URL points at the deployed app's hash-routed
// invite handler (#/invite/<token>), which stores the token in
// localStorage, resolves /api/me, and redirects to #/backpacks --
// see docs/REQ/REQ-0037-guest-auth.md's "Client" section.
'use strict';
const players = require('./players.cjs');

const INVITE_BASE_URL = 'https://backpack-dev.qtie.jp/app/#/invite/';

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0].startsWith('--')) {
    return { error: 'usage: node server/cli_invite.cjs <name> [--roles r1,r2]' };
  }
  const name = args[0];
  let roles = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--roles') {
      const val = args[i + 1];
      if (!val) return { error: '--roles requires a comma-separated value' };
      roles = val.split(',').map((r) => r.trim()).filter(Boolean);
      i++;
    } else {
      return { error: 'unknown argument "' + args[i] + '"' };
    }
  }
  return { name, roles };
}

function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }
  const player = players.createPlayer(parsed.name, parsed.roles);
  console.log('Created player:');
  console.log('  playerId: ' + player.playerId);
  console.log('  name:     ' + player.name);
  console.log('  roles:    ' + JSON.stringify(player.roles));
  console.log('');
  console.log('Invite URL (hand this to the guest):');
  console.log(INVITE_BASE_URL + player.token);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, INVITE_BASE_URL };
