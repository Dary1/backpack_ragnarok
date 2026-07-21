'use strict';
// sim/lib/rng.cjs -- REQ-0047 (d): seeded deterministic RNG (djb2 -> mulberry32) with named sub-streams.
// Moved VERBATIM from sim/combat.cjs. Determinism contract: goldens must
// stay byte-identical (sim/tests/goldens.cjs).


function djb2Hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0; // h*33 + c
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(masterSeed) {
  const streams = new Map();
  function stream(name) {
    const key = String(name);
    if (!streams.has(key)) {
      const seed = djb2Hash(masterSeed + '|' + key);
      streams.set(key, mulberry32(seed));
    }
    const gen = streams.get(key);
    return {
      next() { return gen(); },
      range(lo, hi) { return lo + gen() * (hi - lo); },
    };
  }
  return { masterSeed, stream };
}

module.exports = {
  djb2Hash,
  mulberry32,
  makeRng,
};
