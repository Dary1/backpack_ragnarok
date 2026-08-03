'use strict';
// bot/lib/joiner.cjs -- REQ-0330 DRIP-JOINER. While a target troop is
// recruiting, join ONE not-yet-used pool account every `intervalMs` (owner spec
// item 2: 30s, literal). One join per tick, NEVER a burst-fill -- the cadence
// leaves a seat open for a human between ticks. Continue until the troop is full
// (REQ-0325 auto-departs it) or it disbands.
//
// The cadence DECISION is a pure function (dueToJoin / planDripTick) so it is
// exhaustively unit-testable with a fake clock; driveDripJoin is the thin async
// loop that performs the decided join through injected effects (so the canary
// drives it against a real API and unit tests drive it against fakes).

// dueToJoin(nowMs, lastJoinMs, intervalMs) -> boolean. The FIRST join (lastJoin
// null) is allowed immediately when a troop appears; every subsequent join must
// wait a full interval. This is the whole "no burst" invariant: a join is due
// at most once per interval.
function dueToJoin(nowMs, lastJoinMs, intervalMs) {
  if (lastJoinMs == null) return true;
  return (nowMs - lastJoinMs) >= intervalMs;
}

// planDripTick(ctx) -> { action:'join'|'wait'|'stop', reason?, accountId? }.
// Pure. ctx = { now, lastJoinMs, intervalMs, troop:{recruiting,full}, availableAccountId }.
function planDripTick(ctx) {
  const troop = ctx.troop || {};
  if (troop.full === true || troop.recruiting === false) {
    return { action: 'stop', reason: troop.full ? 'troop_full' : 'not_recruiting' };
  }
  if (!dueToJoin(ctx.now, ctx.lastJoinMs, ctx.intervalMs)) {
    return { action: 'wait', reason: 'cadence' };
  }
  if (ctx.availableAccountId == null) {
    return { action: 'wait', reason: 'pool_exhausted' };
  }
  return { action: 'join', accountId: ctx.availableAccountId };
}

// driveDripJoin(deps) -> { joins:[{accountId, atMs}], stopReason }. Loops:
// re-read the troop, plan a tick, and (when due) perform exactly ONE join, then
// sleep `pollMs`. Stops when the troop is full/disbanded, the pool is exhausted
// with the troop still open, or `deadlineMs` passes. deps:
//   now()            -> current ms
//   sleep(ms)        -> Promise
//   readTroop()      -> { recruiting, full } | null (null => gone/disbanded)
//   pickAccount()    -> next available accountId | null
//   join(accountId)  -> Promise<{ ok, troop }>  (performs the real join)
//   onJoined(id)     -> mark the account committed (optional)
//   intervalMs, pollMs, deadlineMs, log
async function driveDripJoin(deps) {
  const intervalMs = deps.intervalMs;
  const pollMs = deps.pollMs != null ? deps.pollMs : Math.min(1000, intervalMs);
  const deadlineMs = deps.deadlineMs != null ? deps.deadlineMs : Infinity;
  const log = deps.log || (() => {});
  const startedAt = deps.now();
  let lastJoinMs = null;
  const joins = [];

  while (true) {
    if (deps.now() - startedAt > deadlineMs) return { joins, stopReason: 'deadline' };

    const troopState = await deps.readTroop();
    if (troopState == null) return { joins, stopReason: 'troop_gone' };

    const availableAccountId = deps.pickAccount();
    const plan = planDripTick({
      now: deps.now(),
      lastJoinMs,
      intervalMs,
      troop: troopState,
      availableAccountId,
    });

    if (plan.action === 'stop') return { joins, stopReason: plan.reason };
    if (plan.action === 'wait') {
      if (plan.reason === 'pool_exhausted') return { joins, stopReason: 'pool_exhausted' };
      await deps.sleep(pollMs);
      continue;
    }
    // action === 'join': exactly one account this tick.
    const at = deps.now();
    const result = await deps.join(plan.accountId);
    lastJoinMs = at;
    joins.push({ accountId: plan.accountId, atMs: at });
    if (deps.onJoined) deps.onJoined(plan.accountId);
    log('joined ' + plan.accountId + ' into troop (' + joins.length + ' seat(s) filled by fleet)');

    // If that join filled the last seat, the server auto-departed the troop;
    // the next readTroop() will report full/gone and we stop.
    if (result && result.troop && result.troop.state && result.troop.state !== 'recruiting') {
      return { joins, stopReason: 'troop_departed' };
    }
    await deps.sleep(pollMs);
  }
}

module.exports = { dueToJoin, planDripTick, driveDripJoin };
