'use strict';
// server/services/pacing.cjs -- REQ-0240: the PRESENTATION-PACING pass.
//
// User directive #7 ("raise the battle wait / slow playback -- visualization
// first"): the sim resolves INSTANTLY and its event log is combat truth
// (each event carries sim time `t`). This module assigns every event a
// monotonic PRESENTATION time `pt` (ms) from a per-class min-gap / gap-after
// table, coalesces same-target bursts into one watchable beat, and clamps
// the whole presentation into a [45s, 300s] budget. All WATCH surfaces
// (visibleEvents gating, run clock, progress, rail, transport, board
// runEndsAt) run on `pt`; combat math and event ORDER never change.
//
// STORAGE MODEL (why the goldens AND the run-determinism gate stay intact):
// this is a SEPARATELY STORED presentation timeline (the option the REQ-0240
// brief offers). `run.events` is persisted BYTE-IDENTICAL to sim/combat.cjs's
// output -- so sim/tests/goldens.cjs (which hashes a separate combat.runDungeon
// call) AND the api determinism gate (which deep-equals the stored log to a
// fresh sim run) both keep passing. The `pt` array + coalesce annotations live
// in a parallel `run.presentation` object and are merged onto a COPY of each
// event only at SERVE time (decorateVisible). Nothing in sim/ imports this
// file; `pt` can never enter sim-hashed content.
//
// Pure + deterministic: computeTimeline(events) depends only on the event
// list, so a paced timeline is fully reproducible.

const path = require('path');
const PACING = require(path.join(__dirname, '..', '..', 'shared', 'pacing.json'));

// class(e): map an event's `ev` token to a pacing class. Most map 1:1;
// reflect_damage folds onto the `reflect` pair; any unknown/future token
// falls through to the `default` floor (forward-compatible: a new event
// type is spaced like a ray_hit, never dropped -- 03 spec ss11).
function classOf(ev) {
  const e = ev && ev.ev;
  if (e === 'reflect_damage') return 'reflect';
  return typeof e === 'string' ? e : 'default';
}

function minGapMs(cls) {
  const m = PACING.minGapMs;
  return typeof m[cls] === 'number' ? m[cls] : m.default;
}

// gapAfter is per-class EXCEPT ray_step, whose hold scales with the volley
// length (a long rake must be SEEN travelling), clamped to [minMs, maxMs].
function gapAfterMs(cls, ev) {
  if (cls === 'ray_step') {
    const cells = ev && Array.isArray(ev.path) ? ev.path.length : 1;
    const rs = PACING.rayStep;
    return Math.max(rs.minMs, Math.min(rs.maxMs, rs.perCellMs * Math.max(1, cells)));
  }
  const g = PACING.gapAfterMs;
  return typeof g[cls] === 'number' ? g[cls] : g.default;
}

// Coalescing (BEFORE spacing). A run of >= coalesce.minHits CONSECUTIVE
// same-target ray_hit events within coalesce.windowMs sim-time collapses to
// ONE presentation beat: every member shares the beat's pt, the LAST member
// is the representative (annotated {hits,amount} so the feed prints one "xN"
// line / the stage draws one summed number), the others are hidden. Returns
// a Map: eventIndex -> { groupId, first, rep, hits, amount }.
function detectCoalesceGroups(events) {
  const marks = new Map();
  const windowSecs = PACING.coalesce.windowMs / 1000;
  const minHits = PACING.coalesce.minHits;
  let i = 0;
  let groupId = 0;
  while (i < events.length) {
    const e = events[i];
    if (e.ev !== 'ray_hit' || typeof e.dst !== 'string') { i++; continue; }
    let j = i + 1;
    const startT = typeof e.t === 'number' ? e.t : 0;
    while (j < events.length) {
      const n = events[j];
      if (n.ev !== 'ray_hit' || n.dst !== e.dst) break;
      const nt = typeof n.t === 'number' ? n.t : startT;
      if (nt - startT > windowSecs) break;
      j++;
    }
    const len = j - i;
    if (len >= minHits) {
      let amount = 0;
      for (let k = i; k < j; k++) { const a = events[k].amount; if (typeof a === 'number') amount += a; }
      for (let k = i; k < j; k++) marks.set(k, { groupId, first: k === i, rep: k === j - 1, hits: len, amount });
      groupId++;
      i = j;
    } else { i++; }
  }
  return marks;
}

// computeTimeline(events) -> { pt:number[], coalesce:{idx:{hits,amount}},
// hidden:{idx:true}, durationSecs, version }. Does NOT mutate `events`.
function computeTimeline(events) {
  const list = Array.isArray(events) ? events : [];
  const intro = PACING.introMs;
  const outro = PACING.outroMs;
  const pt = new Array(list.length);
  const coalesce = {};
  const hidden = {};
  if (list.length === 0) {
    return { pt, coalesce, hidden, durationSecs: (intro + outro) / 1000, version: PACING.version };
  }
  const groups = detectCoalesceGroups(list);
  const groupPt = new Map();
  let ptPrev = null;
  let prevEv = null;
  for (let i = 0; i < list.length; i++) {
    const ev = list[i];
    const g = groups.get(i);
    if (g && !g.first) {
      pt[i] = groupPt.get(g.groupId);
      if (g.rep) coalesce[i] = { hits: g.hits, amount: g.amount };
      else hidden[i] = true;
      continue;
    }
    const cls = classOf(ev);
    pt[i] = ptPrev === null ? intro : ptPrev + Math.max(gapAfterMs(classOf(prevEv), prevEv), minGapMs(cls));
    ptPrev = pt[i];
    prevEv = ev;
    if (g && g.first) { groupPt.set(g.groupId, pt[i]); hidden[i] = true; }
  }

  // Budget clamp: uniform stretch/compress of the [intro, maxPt] span,
  // anchored at introMs (a minimal, monotonicity-preserving deviation from
  // the spec's per-class gapAfter re-scaling; hits the SAME budget contract).
  let maxPt = intro;
  for (const v of pt) if (typeof v === 'number' && v > maxPt) maxPt = v;
  const spanMs = maxPt - intro;
  const minMs = PACING.minPresentSecs * 1000;
  const maxMs = PACING.maxPresentSecs * 1000;
  let presentMs = maxPt + outro;
  if (spanMs > 0) {
    let scale = 1;
    if (presentMs < minMs) scale = (minMs - outro - intro) / spanMs;
    else if (presentMs > maxMs) scale = (maxMs - outro - intro) / spanMs;
    if (scale !== 1 && Number.isFinite(scale) && scale > 0) {
      for (let i = 0; i < pt.length; i++) if (typeof pt[i] === 'number') pt[i] = Math.round(intro + (pt[i] - intro) * scale);
      maxPt = intro;
      for (const v of pt) if (v > maxPt) maxPt = v;
      presentMs = maxPt + outro;
    }
  }
  return { pt, coalesce, hidden, durationSecs: presentMs / 1000, version: PACING.version };
}

// paceEvents(events) -> { presentation, durationSecs, pacingVersion }.
// The presentation timeline is stored on the run doc as `run.presentation`
// (parallel to the clean `run.events`); durationSecs is the PRESENTATION
// duration the player watches; pacingVersion tags the run as paced.
function paceEvents(events) {
  const tl = computeTimeline(events);
  return {
    presentation: { version: tl.version, durationSecs: tl.durationSecs, pt: tl.pt, coalesce: tl.coalesce, hidden: tl.hidden },
    durationSecs: tl.durationSecs,
    pacingVersion: tl.version,
  };
}

// presentationDurationSecs(run): pt-based for a paced run, else legacy max-t.
function presentationDurationSecs(run) {
  if (run && run.pacingVersion >= 1 && run.presentation) return run.presentation.durationSecs;
  let maxT = 0;
  for (const e of (run && run.events) || []) if (typeof e.t === 'number' && e.t > maxT) maxT = e.t;
  return maxT;
}

// The presentation time (secs) an event (by index) becomes visible at:
// pt/1000 for a paced run, else its sim `t`.
function eventPtSecs(run, index) {
  const ev = run.events[index];
  if (run && run.pacingVersion >= 1 && run.presentation && typeof run.presentation.pt[index] === 'number') {
    return run.presentation.pt[index] / 1000;
  }
  return ev && typeof ev.t === 'number' ? ev.t : Infinity;
}

// decorateVisible(run, elapsedSecs): the SERVE-time view -- every event
// whose presentation time <= elapsedSecs, each returned as a COPY carrying
// its `pt` (+ coalesce annotations) so the client obeys the timeline. The
// stored `run.events` is never mutated. Legacy runs (pacingVersion 0) gate
// on sim `t` and return the raw events, exactly as before.
function decorateVisible(run, elapsedSecs) {
  const events = (run && run.events) || [];
  const paced = run && run.pacingVersion >= 1 && run.presentation ? run.presentation : null;
  const out = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (paced) {
      const ptv = paced.pt[i];
      const visSecs = typeof ptv === 'number' ? ptv / 1000 : (typeof ev.t === 'number' ? ev.t : Infinity);
      if (visSecs > elapsedSecs) continue;
      const dec = Object.assign({}, ev, { pt: ptv });
      if (paced.coalesce && paced.coalesce[i]) dec.pcoalesce = paced.coalesce[i];
      if (paced.hidden && paced.hidden[i]) dec.pcoalesceHidden = true;
      out.push(dec);
    } else {
      const visSecs = typeof ev.t === 'number' ? ev.t : Infinity;
      if (visSecs <= elapsedSecs) out.push(ev);
    }
  }
  return out;
}

// buildRoster (M1): per-slot player BP pools (id + exact hpMax, from
// result.bps' squadSlot tag) + enemy hints (id/name/hpMax/footprint/packId)
// from the ROLLED def + content defs. Player hpMax is exact; enemy hpMax is
// the def's upper bound (hp[1]) so hp_after/hpMax never exceeds 100%.
function buildRoster(result, dungeonDef, defs) {
  const monsterPackDefsById = (defs && defs.monsterPackDefsById) || {};
  const enemyDefsById = (defs && defs.enemyDefsById) || {};
  const SLOTS = ['unit1', 'unit2', 'unit3', 'unit4'];
  const bySlot = new Map(SLOTS.map((s) => [s, []]));
  for (const b of (result && result.bps) || []) {
    if (b.squadSlot && bySlot.has(b.squadSlot)) bySlot.get(b.squadSlot).push({ id: b.id, hpMax: b.hpMax });
  }
  const slots = SLOTS.map((slot, i) => ({ slot, index: i, bps: bySlot.get(slot) }));
  const enemies = [];
  const seen = new Set();
  for (const enc of (dungeonDef && dungeonDef.encounters) || []) {
    const packId = enc.enemyPack && enc.enemyPack.packId;
    const pack = packId ? monsterPackDefsById[packId] : null;
    for (const m of (pack && pack.members) || []) {
      const def = m && m.enemy ? enemyDefsById[m.enemy] : null;
      if (!def) continue;
      const key = packId + '/' + m.enemy + '/' + (m.at || '');
      if (seen.has(key)) continue;
      seen.add(key);
      const hp = Array.isArray(def.hp) ? def.hp : [def.hp, def.hp];
      enemies.push({
        id: def.id,
        name: def.name,
        nameJa: (def.i18n && def.i18n.ja && def.i18n.ja.name) || def.name,
        hpMax: Number.isFinite(hp[1]) ? hp[1] : (Number.isFinite(hp[0]) ? hp[0] : 0),
        footprint: def.footprint || [1, 1],
        packId: packId || null,
      });
    }
  }
  return { slots, enemies };
}

module.exports = {
  PACING,
  classOf,
  minGapMs,
  gapAfterMs,
  detectCoalesceGroups,
  computeTimeline,
  paceEvents,
  presentationDurationSecs,
  eventPtSecs,
  decorateVisible,
  buildRoster,
};
