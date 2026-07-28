'use strict';
// bot/lib/identity.cjs -- REQ-0330 IDENTITY GUARD. The fleet must refuse to act
// for any account that is the dev user or carries any role (PROJECT.md dev_user
// hazard). Fail CLOSED: a forbidden identity throws, and the caller aborts that
// account's session non-zero rather than acting with elevated/dev privileges.

// isForbiddenIdentity(me) -> true if this /api/me result must NOT be acted on.
// Forbidden when: playerId is exactly 'dev', OR `roles` is a non-empty array,
// OR the shape is unusable (no string playerId). Pure.
function isForbiddenIdentity(me) {
  if (!me || typeof me.playerId !== 'string' || me.playerId === '') return true;
  if (me.playerId === 'dev') return true;
  if (Array.isArray(me.roles) && me.roles.length > 0) return true;
  return false;
}

// assertHumanEquivalent(me) -> me, or throw. The single choke point every
// account session passes through before the fleet issues any join/sell for it.
function assertHumanEquivalent(me) {
  if (isForbiddenIdentity(me)) {
    const who = me && me.playerId != null ? me.playerId : '(unknown)';
    const roles = me && Array.isArray(me.roles) ? me.roles.join(',') : '';
    const err = new Error(
      'identity guard REFUSED playerId=' + who + ' roles=[' + roles + '] -- ' +
      'the fleet only acts for human-equivalent accounts (never dev, never a roled account)');
    err.code = 'IDENTITY_GUARD';
    throw err;
  }
  return me;
}

module.exports = { isForbiddenIdentity, assertHumanEquivalent };
