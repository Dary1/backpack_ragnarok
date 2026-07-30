'use strict';
// server/lib/route_auth.cjs -- REQ-0349: TRANSITIONAL SHIM. The implementation
// moved to lib/route_kit.cjs, which owns the whole request preamble (caller
// resolution + method guard + JSON body + domain-error mapping + validators)
// rather than caller resolution alone. This file re-exports the pre-REQ-0349
// names so families migrate one commit at a time instead of in one 17-file
// change; it is DELETED in REQ-0349's final commit, once no requirer remains.
//
// Name mapping:
//   resolveCallerOr401  -> unchanged
//   loadOwnCanvas       -> unchanged
//   requireOwnCanvas    -> unchanged
//   scheduleErrToStatus -> domainErrToStatus (same table + FORBIDDEN, which the
//                          schedule copy already had -- see route_kit.cjs's
//                          CODE_TO_STATUS note)
//   sendScheduleError   -> sendDomainError   (byte-identical body)
const kit = require('./route_kit.cjs');

module.exports = {
  resolveCallerOr401: kit.resolveCallerOr401,
  loadOwnCanvas: kit.loadOwnCanvas,
  requireOwnCanvas: kit.requireOwnCanvas,
  scheduleErrToStatus: kit.domainErrToStatus,
  sendScheduleError: kit.sendDomainError,
};
