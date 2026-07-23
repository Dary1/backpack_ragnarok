'use strict';
// sim/lib/level_scale.cjs -- REQ-0293: enemy level-scaling engine.
//
// PURE and RNG-FREE. Given a scaling profile (content/scaling_profile.json,
// schema "scaling/1") and an effLevel (= attackLv - dungeon.baseDifficulty),
// it derives a per-field multiplicative factor and applies it to the enemy
// stats that are declared scalable. Every rule is one of:
//   { kind: "geometric", g }  -> factor = g^effLevel  (v ranges scale both ends)
//   { kind: "flat" }          -> factor = 1           (explicitly un-scaled)
//
// v1 ships NEUTRAL: every live rule is identity (geometric g=1.0 or flat), so
// every factor is EXACTLY 1 and the engine returns the SAME object references
// it was handed -- byte-identical output, and REQ-0121's shared-skill-ref
// invariant preserved. The math is still proven by sim/tests/run.cjs against
// SYNTHETIC non-identity profiles. Determinism contract: no RNG, no side
// effects on shared inputs (a scaled result is always a fresh deep copy).
const { deepCopy } = require('./core.cjs'); // REQ-0121: the same structural clone the pack compiler uses

// A numeric leaf is a bare number or a [lo, hi]-style all-numeric array (the
// range shape verb.n / trigger.s / enemy.hp use).
function isNumericLeaf(v) {
  if (typeof v === 'number') return true;
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'number');
}

// The scalable numeric keys of a verb (n, hits, mult, frac, ... -- anything
// numeric), skipping the discriminator (t) and string params (status).
function verbNumericKeys(verb) {
  const out = [];
  for (const k of Object.keys(verb)) if (k !== 't' && isNumericLeaf(verb[k])) out.push(k);
  return out;
}

// loadProfile: accept a raw parsed manifest; return it (normalized) or null.
// Normalization is identity for now -- the nested field-keyed shape IS the
// working shape. A missing/mismatched schema yields null so callers fall back
// to "no scaling" rather than crashing.
function loadProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (raw.schema !== 'scaling/1') return null;
  return raw;
}

// factorFor: the ONE place a rule becomes a number. Returns EXACTLY 1 for a
// flat rule, a g===1 geometric rule, effLevel===0, or a missing rule (so the
// neutral case is byte-identical); geometric otherwise is Math.pow(g, effLevel)
// -- monotone non-decreasing in effLevel for g>=1, deterministic, RNG-free.
function factorFor(rule, effLevel) {
  if (!rule) return 1;
  if (rule.kind === 'geometric') {
    const g = rule.g;
    if (g === 1 || effLevel === 0) return 1;
    return Math.pow(g, effLevel);
  }
  // flat -- and any declared-but-non-geometric kind -- is identity in v1.
  return 1;
}

// resolveVerbRule: a verb leaf's rule is its verb.t-specific rule if present,
// else the _default rule for that key (first match wins). undefined when
// neither exists -> factorFor treats it as identity, and the coverage gate
// (tools/check_scaling_coverage.cjs) is what turns an undefined rule red.
function resolveVerbRule(skill, verbT, key) {
  const verb = (skill && skill.verb) || {};
  const specific = verb[verbT] && verb[verbT][key];
  if (specific !== undefined) return specific;
  return verb._default && verb._default[key];
}

// ---- enemy.hp ------------------------------------------------------------
function hpFactor(profile, effLevel) {
  return factorFor(profile && profile.enemy && profile.enemy.hp, effLevel);
}

// scaleEnemyHpRange: scale [hp0, hp1] by the hp factor. Rounding stays with the
// caller (hpStream.range() + Math.round). When the factor is 1 the ORIGINAL
// array reference is returned -- so a neutral profile draws the identical roll.
function scaleEnemyHpRange(hp, profile, effLevel) {
  const f = hpFactor(profile, effLevel);
  if (f === 1) return hp;
  return [hp[0] * f, hp[1] * f];
}

// ---- skill leaves --------------------------------------------------------
// Multiply one leaf (scalar or [lo,hi] range) in place; f===1 is a no-op.
function applyFactorToLeaf(obj, key, f) {
  if (f === 1) return;
  const v = obj[key];
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = v[i] * f; }
  else obj[key] = v * f;
}

// Would ANY leaf of these skills scale (factor !== 1) under this profile at
// this effLevel? Mirrors the walk scaleSkillInPlace performs, but only asks
// the question -- so the neutral case returns the shared refs untouched.
function anyLeafScales(skills, profile, effLevel) {
  const skill = profile.skill || {};
  for (const s of skills) {
    if (!s) continue;
    if (s.trigger && s.trigger.t === 'every_secs' && isNumericLeaf(s.trigger.s)) {
      const rule = skill.trigger && skill.trigger.every_secs && skill.trigger.every_secs.s;
      if (factorFor(rule, effLevel) !== 1) return true;
    }
    if (s.verb) {
      const vt = s.verb.t;
      for (const key of verbNumericKeys(s.verb)) {
        if (factorFor(resolveVerbRule(skill, vt, key), effLevel) !== 1) return true;
      }
    }
    if (s.attack_profile) {
      for (const key of Object.keys(s.attack_profile)) {
        if (!isNumericLeaf(s.attack_profile[key])) continue;
        const rule = skill.attack_profile && skill.attack_profile[key];
        if (factorFor(rule, effLevel) !== 1) return true;
      }
    }
  }
  return false;
}

// Scale every declared numeric leaf of ONE (already-copied) skill in place.
function scaleSkillInPlace(s, profile, effLevel) {
  if (!s) return;
  const skill = profile.skill || {};
  if (s.trigger && s.trigger.t === 'every_secs' && isNumericLeaf(s.trigger.s)) {
    const rule = skill.trigger && skill.trigger.every_secs && skill.trigger.every_secs.s;
    applyFactorToLeaf(s.trigger, 's', factorFor(rule, effLevel));
  }
  if (s.verb) {
    const vt = s.verb.t;
    for (const key of verbNumericKeys(s.verb)) {
      applyFactorToLeaf(s.verb, key, factorFor(resolveVerbRule(skill, vt, key), effLevel));
    }
  }
  if (s.attack_profile) {
    for (const key of Object.keys(s.attack_profile)) {
      if (!isNumericLeaf(s.attack_profile[key])) continue;
      const rule = skill.attack_profile && skill.attack_profile[key];
      applyFactorToLeaf(s.attack_profile, key, factorFor(rule, effLevel));
    }
  }
}

// scaleSkillsForLevel: returns the ORIGINAL skills array reference UNCHANGED
// when every applicable factor === 1 (no profile / identity profile / effLevel
// 0) -- which is what keeps REQ-0121's shared-skill-ref invariant and the
// goldens byte-identical at neutral. Otherwise returns a DEEP-COPIED skills
// array with each scaled numeric leaf multiplied; the input is never mutated.
// skillIds is accepted (parallel id list, REQ-0280) for signature symmetry;
// scaling keys only off the skill defs themselves.
function scaleSkillsForLevel(skills, skillIds, profile, effLevel) {
  if (!profile || !effLevel) return skills;            // identity / effLevel 0
  if (!anyLeafScales(skills, profile, effLevel)) return skills; // nothing to do
  const copy = deepCopy(skills);
  for (const s of copy) scaleSkillInPlace(s, profile, effLevel);
  return copy;
}

module.exports = {
  loadProfile,
  factorFor,
  resolveVerbRule,
  hpFactor,
  scaleEnemyHpRange,
  scaleSkillsForLevel,
  // exported for the coverage gate so it resolves leaves EXACTLY as the engine does:
  isNumericLeaf,
  verbNumericKeys,
};
