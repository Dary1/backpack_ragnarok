'use strict';
// sim/lib/replay.cjs -- REQ-0047 (d): replay-log helpers (S1 determinism surface): JSONL + label masking.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).


function toJSONL(events) {
  return events.map(e => JSON.stringify(e)).join('\n');
}

// Masking mechanism (documented interpretation, see sim/README.md): a
// "?" entity (detection target, or an undiscovered hidden-door stage1
// target) is represented internally with its real id, but any event
// that would reveal its identity/position to a spectator has that field
// replaced with the literal string "?" until a `discovery` event is
// emitted for it. We implement this by tagging such entities with
// `masked:true` and, when building events that reference them, using a
// `maskLabel(entity)` helper that returns "?" while masked and the real
// id once `entity.masked` is cleared (flipped false at the moment its
// discovery event fires).
function maskLabel(entity) {
  return entity.masked ? '?' : entity.id;
}

// =====================================================================
// Skill / effect firing helpers.
// =====================================================================
// Resolve a skill's own [lo,hi] ranges through its own owning-effect
// sub-stream (S1.2: "Every [lo,hi] range ... draws ... from the OWNING
// EFFECT's sub-stream").

module.exports = {
  toJSONL,
  maskLabel,
};
