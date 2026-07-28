'use strict';
// bot/lib/pool.cjs -- REQ-0330 pool-account selection. Pure, side-effect-free
// helpers over an ORDERED list of pool account ids (the REQ-0329 vault order).
// The owner spec item 2 is literal: while joining, take "the FIRST" not-yet-used
// account. So selection is first-fit over the fixed vault order, skipping any
// account currently committed to a troop (in-use). As accounts are marked
// in-use one-per-tick, first-fit naturally walks the pool like a round-robin
// (acct0, then acct1, ...), which is exactly the drip the spec describes.

// selectFirstAvailable(orderedIds, inUse) -> the first id NOT in the in-use
// set, or null if every account is committed. `inUse` may be a Set or an array.
function selectFirstAvailable(orderedIds, inUse) {
  const busy = inUse instanceof Set ? inUse : new Set(inUse || []);
  for (const id of (orderedIds || [])) {
    if (!busy.has(id)) return id;
  }
  return null;
}

// nextRoundRobin(orderedIds, lastId) -> the id AFTER lastId in vault order,
// wrapping to the front (and to index 0 when lastId is null/unknown). Exposed
// for callers that want strict rotation rather than first-fit; the daemon uses
// selectFirstAvailable (first-not-in-use), but the two coincide on the drip
// path where each chosen account is immediately marked in-use.
function nextRoundRobin(orderedIds, lastId) {
  const ids = orderedIds || [];
  if (ids.length === 0) return null;
  const i = ids.indexOf(lastId);
  return ids[(i + 1) % ids.length];
}

module.exports = { selectFirstAvailable, nextRoundRobin };
