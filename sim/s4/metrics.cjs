'use strict';
// sim/s4/metrics.cjs -- REQ-0050: S4 simulate-gate post-processor.
//
// Pure, dependency-free functions over replay event arrays (the JSONL
// contract frozen by sim/tests/goldens.cjs). No LLM, no I/O, no RNG:
// tools/simulate.cjs feeds runDungeon outputs through processRun(), pools
// the records with aggregate(), and gates on evaluate() against
// sim/s4_thresholds.json. Unit-tested on hand-crafted fixtures in
// sim/tests/s4_test.cjs -- keep every function deterministic.

// ---------- small stats helpers ----------
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function p95(xs) {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
function round(x, d = 4) { const m = Math.pow(10, d); return Math.round(x * m) / m; }

// ---------- per-run pass ----------
// runOutput: the object runDungeon returns ({events, result, finalProgressPct,
// rewards, lrdstReward, cooldownSecs, level, H}).
// meta: { boardId, dungeonKey, formationId, level, seed, playerBpIds: [..],
//         poRarity: {poId: rarity}, defAtt: {trap,chest,door}, variant }
function processRun(runOutput, meta) {
  const events = runOutput.events;
  const playerBp = new Set(meta.playerBpIds || []);
  const rec = {
    meta: Object.assign({}, meta),
    result: runOutput.result,
    H: runOutput.H,
    finalPct: runOutput.finalProgressPct,
    lrdst: runOutput.lrdstReward || 0,
    rewards: (runOutput.rewards || []).map(a => (a.item && a.item.id) || a.item || 'item'),
    cooldownSecs: runOutput.cooldownSecs || 0,
    durationSecs: 0,          // sum of encounter durations (cumulative run clock)
    battleSecs: 0,            // sum of battle-encounter (pack/boss) durations -- the A1 DPS denominator
    dmgBySrc: {},            // player-side damage dealt, per firing src label
    dotBySrc: {},            // DoT damage credited to the applier src
    raysBySrc: {},           // {src: {fired, idle, bounces:[..], terminators, hits, aoeExtra, penExtra}}
    aborts: 0,
    pulse: { linkPulses: 0, payloads: 0, fizzles: {}, hopHist: {}, fanout: {} },
    statuses: {},            // {status: {applies, stacksApplied, tickDamage, tickHeal, firstHalfApplies, secondHalfApplies}}
    healTotal: 0,
    blockApplied: 0,
    dmgTakenTotal: 0,
    dmgTakenByBp: {},        // player bp -> damage taken
    dmgTakenSideEntry: 0,    // damage from rays whose entry col hugs a side edge (player field)
    bpFirstDownT: {},        // player bp -> first t at hp<=0
    wipeT: null,
    overkillDmg: 0,
    cellVisits: { player: {}, enemy: {} }, // 'r,c' -> visits (ray_step paths)
    encounters: [],          // {enc, kind, mode, startT, endT, result}
    att: { reveal: {}, disarm: {}, open: {}, lost: {}, fire: {} }, // kind -> count
    attFireDmg: 0,
    shortcuts: [],           // {jump_pct, via}
    cascade: { beforeDmg: 0, beforeSecs: 0, afterDmg: 0, afterSecs: 0 },
  };

  // ray context state machine: walkRay/fireSkillRay emit contiguous blocks.
  let ray = null;           // {src, field, cause, mode, entry, bounces, hits, sawHit}
  const deadDst = new Set();
  const dotApplier = {};    // 'dst|status' -> src label
  let firstDownSeen = false;
  let curEnc = null;
  let maxT = 0;
  let encOffset = 0;        // cumulative run seconds before the current encounter
  let firstDownCum = null;
  const cum = (t) => (curEnc ? encOffset + Math.max(0, t - curEnc.startT) : encOffset);

  const finishRay = () => {
    if (!ray) return;
    const r = rec.raysBySrc[ray.src] = rec.raysBySrc[ray.src] || { fired: 0, idle: 0, bounces: [], terminators: 0, hits: 0, aoeExtra: 0, penExtra: 0 };
    r.fired++;
    r.bounces.push(ray.bounces);
    if (ray.terminator || ray.bounces >= 5) r.terminators++;
    if (!ray.sawHit) r.idle++;
    if (ray.hitCount > 1) r.penExtra += ray.hitCount - 1;
    ray = null;
  };
  const creditDamage = (src, amount, isPlayerSide) => {
    if (!isPlayerSide || !src) return;
    rec.dmgBySrc[src] = (rec.dmgBySrc[src] || 0) + amount;
  };
  const trackTaken = (dst, amount, t, sideEntry) => {
    if (!playerBp.has(dst)) return;
    rec.dmgTakenTotal += amount;
    rec.dmgTakenByBp[dst] = (rec.dmgTakenByBp[dst] || 0) + amount;
    if (sideEntry) rec.dmgTakenSideEntry += amount;
    if (firstDownSeen) rec.cascade.afterDmg += amount; else rec.cascade.beforeDmg += amount;
  };
  const trackDown = (dst, hpAfter, t) => {
    if (!playerBp.has(dst)) return;
    if (hpAfter <= 0 && !(dst in rec.bpFirstDownT)) {
      rec.bpFirstDownT[dst] = cum(t);
      if (!firstDownSeen) firstDownCum = cum(t);
      firstDownSeen = true;
    }
  };

  for (const ev of events) {
    const t = typeof ev.t === 'number' ? ev.t : 0;
    if (t > maxT) maxT = t;
    switch (ev.ev) {
      case 'encounter_start':
        curEnc = { enc: ev.enc, kind: ev.kind, mode: ev.mode || null, startT: t, endT: null, result: null };
        rec.encounters.push(curEnc);
        break;
      case 'encounter_end':
        if (curEnc && curEnc.enc === ev.enc) {
          curEnc.endT = t; curEnc.result = ev.result;
          const dur = Math.max(0, t - curEnc.startT);
          encOffset += dur;
          if (curEnc.kind === 'pack' || curEnc.kind === 'boss') rec.battleSecs += dur;
        }
        break;
      case 'ray_fire': {
        finishRay();
        const entryCol = Array.isArray(ev.entry) ? ev.entry[1] : null;
        ray = {
          src: String(ev.src || '?'), field: ev.field, cause: ev.cause || null, mode: ev.mode || null,
          bounces: 0, sawHit: false, hitCount: 0, terminator: false,
          sideEntry: entryCol !== null && (entryCol <= 2 || entryCol >= 25),
        };
        if (Array.isArray(ev.entry)) {
          const key = ev.entry[0] + ',' + ev.entry[1];
          const f = ev.field === 'player' ? 'player' : 'enemy';
          rec.cellVisits[f][key] = (rec.cellVisits[f][key] || 0) + 1;
        }
        break;
      }
      case 'ray_step': {
        const f = ray && ray.field === 'player' ? 'player' : 'enemy';
        if (Array.isArray(ev.path)) for (const c of ev.path) {
          if (Array.isArray(c)) { const k = c[0] + ',' + c[1]; rec.cellVisits[f][k] = (rec.cellVisits[f][k] || 0) + 1; }
        }
        break;
      }
      case 'ray_bounce':
        if (ray) ray.bounces++;
        break;
      case 'ray_hit': {
        const amount = ev.amount || 0;
        const dst = String(ev.dst || '?');
        if (ray) {
          ray.sawHit = true; ray.hitCount++;
          if (deadDst.has(dst)) rec.overkillDmg += amount;
          creditDamage(ray.src, amount, ray.field === 'enemy' && (ray.mode === null || ray.mode === 'battle'));
          trackTaken(dst, amount, t, ray.sideEntry);
        }
        if (ev.hp_after !== undefined && ev.hp_after <= 0) { deadDst.add(dst); trackDown(dst, ev.hp_after, t); }
        break;
      }
      case 'ray_aoe': {
        const hits = Array.isArray(ev.hits) ? ev.hits : [];
        if (ray) ray.aoeSeen = true;
        for (const h of hits) {
          const amount = h.amount || 0; const dst = String(h.dst || '?');
          if (ray) {
            creditDamage(ray.src, amount, ray.field === 'enemy' && (ray.mode === null || ray.mode === 'battle'));
            trackTaken(dst, amount, t, ray.sideEntry);
            const r = rec.raysBySrc[ray.src];
            if (r) r.aoeExtra++;
          }
          if (h.hp_after !== undefined && h.hp_after <= 0) { deadDst.add(dst); trackDown(dst, h.hp_after, t); }
        }
        break;
      }
      case 'ray_hit_all': {
        if (ray) { ray.sawHit = true; ray.terminator = true; }
        const hits = Array.isArray(ev.hits) ? ev.hits : [];
        for (const h of hits) {
          const amount = h.amount || 0; const dst = String(h.dst || '?');
          if (ray) {
            creditDamage(ray.src, amount, ray.field === 'enemy' && (ray.mode === null || ray.mode === 'battle'));
            trackTaken(dst, amount, t, ray.sideEntry);
          }
          if (h.hp_after !== undefined && h.hp_after <= 0) { deadDst.add(dst); trackDown(dst, h.hp_after, t); }
        }
        break;
      }
      case 'ray_abort':
        rec.aborts++;
        break;
      case 'ray_end':
        break;
      case 'apply_status': {
        const st = rec.statuses[ev.status] = rec.statuses[ev.status] || { applies: 0, stacksApplied: 0, tickDamage: 0, tickHeal: 0, firstHalfApplies: 0, secondHalfApplies: 0 };
        st.applies++;
        st.stacksApplied += ev.n || 1;
        if (curEnc && curEnc.endT === null) {
          // halves resolved later against encounter midpoints; approximate with startT anchor
          st._applyTs = st._applyTs || []; st._applyTs.push(cum(t));
        }
        if (ray) dotApplier[String(ev.dst || '?') + '|' + ev.status] = ray.src;
        break;
      }
      case 'status_tick': {
        const st = rec.statuses[ev.status] = rec.statuses[ev.status] || { applies: 0, stacksApplied: 0, tickDamage: 0, tickHeal: 0, firstHalfApplies: 0, secondHalfApplies: 0 };
        const amount = ev.amount || 0;
        const dst = String(ev.dst || '?');
        if (ev.hp_after !== undefined && amount >= 0 && ev.status !== 'Regen') {
          st.tickDamage += amount;
          const src = dotApplier[dst + '|' + ev.status];
          if (src) rec.dotBySrc[src] = (rec.dotBySrc[src] || 0) + amount;
          trackTaken(dst, amount, t, false);
          if (ev.hp_after <= 0) { deadDst.add(dst); trackDown(dst, ev.hp_after, t); }
        } else {
          st.tickHeal += amount;
          rec.healTotal += amount;
        }
        break;
      }
      case 'reactive_proc': {
        if (ev.heal) { rec.healTotal += ev.heal; }
        else if (ev.amount) {
          const dst = String(ev.dst || '?');
          creditDamage(ev.src ? String(ev.src) : 'reactive:' + ev.trigger, ev.amount, !playerBp.has(dst));
          trackTaken(dst, ev.amount, t, false);
          if (ev.hp_after !== undefined && ev.hp_after <= 0) { deadDst.add(dst); trackDown(dst, ev.hp_after, t); }
        }
        break;
      }
      case 'link_pulse': {
        rec.pulse.linkPulses++;
        const hop = ev.hop || 1;
        rec.pulse.hopHist[hop] = (rec.pulse.hopHist[hop] || 0) + 1;
        const from = String(ev.from || '?');
        rec.pulse.fanout[from] = rec.pulse.fanout[from] || new Set();
        rec.pulse.fanout[from].add(String(ev.to || '?'));
        break;
      }
      case 'pulse_payload':
        rec.pulse.payloads++;
        if (ev.verb === 'heal' && ev.amount) rec.healTotal += ev.amount;
        break;
      case 'pulse_fizzle':
        rec.pulse.fizzles[ev.reason || '?'] = (rec.pulse.fizzles[ev.reason || '?'] || 0) + 1;
        break;
      case 'att_reveal': rec.att.reveal[ev.kind] = (rec.att.reveal[ev.kind] || 0) + 1; break;
      case 'att_disarm': rec.att.disarm['trap'] = (rec.att.disarm['trap'] || 0) + 1; break;
      case 'att_open': rec.att.open[ev.kind] = (rec.att.open[ev.kind] || 0) + 1; break;
      case 'att_lost': rec.att.lost[ev.kind] = (rec.att.lost[ev.kind] || 0) + 1; break;
      case 'att_fire': {
        rec.att.fire['trap'] = (rec.att.fire['trap'] || 0) + 1;
        rec._inTrapVolley = true;
        break;
      }
      case 'shortcut':
        rec.shortcuts.push({ jump_pct: ev.jump_pct, via: ev.via || 'door' });
        break;
      case 'run_end':
        rec.wipe = ev.result === 'wipe';
        break;
      default:
        break;
    }
  }
  finishRay();
  rec.durationSecs = encOffset > 0 ? encOffset : maxT;

  // status halves: split each status's applies at the run's midpoint (cumulative clock).
  const midT = rec.durationSecs / 2;
  for (const s of Object.keys(rec.statuses)) {
    const st = rec.statuses[s];
    for (const t of (st._applyTs || [])) { if (t <= midT) st.firstHalfApplies++; else st.secondHalfApplies++; }
    delete st._applyTs;
  }
  // fanout Sets -> counts (JSON-safe)
  const fan = {};
  for (const k of Object.keys(rec.pulse.fanout)) fan[k] = rec.pulse.fanout[k].size;
  rec.pulse.fanout = fan;
  // cascade windows (cumulative clock)
  if (firstDownCum !== null) {
    rec.cascade.beforeSecs = firstDownCum;
    rec.cascade.afterSecs = Math.max(0, rec.durationSecs - firstDownCum);
  } else {
    rec.cascade.beforeSecs = rec.durationSecs;
  }
  // wipe autopsy
  if (rec.wipe) {
    const we = rec.encounters.filter(e => e.result === 'wipe');
    rec.wipeEnc = we.length ? we[we.length - 1].enc : null;
    if (we.length) {
      let cumT = 0;
      for (const e of rec.encounters) {
        const d = e.endT === null ? 0 : Math.max(0, e.endT - e.startT);
        if (e === we[we.length - 1]) { cumT += d; break; }
        cumT += d;
      }
      rec.wipeT = cumT;
    } else rec.wipeT = null;
  }
  return rec;
}

// ---------- aggregation over run records ----------
// ctx: { dpsCeilings: {rarity: n}, poRarity: {poId: rarity}, liveItemIds: [..],
//        skillPen: {srcId: penetrationBudget} }
function aggregate(records, ctx) {
  ctx = ctx || {};
  const out = { runs: records.length, groups: {}, A: {}, B: {}, C: {}, D: {}, E: {} };
  const byKey = (r) => [r.meta.boardId, r.meta.dungeonKey, 'L' + r.meta.level, r.meta.formationId].join('/');
  const groups = {};
  for (const r of records) (groups[byKey(r)] = groups[byKey(r)] || []).push(r);
  out.groupKeys = Object.keys(groups).sort();

  // ---- A1 per-PO effective DPS (player side) ----
  const perPo = {}; // poId -> [per-instance dps per run]
  for (const r of records) {
    if (r.meta.variant && r.meta.variant !== 'base') continue;
    const dur = Math.max(r.battleSecs, 1e-9);
    const seen = {};
    for (const src of Object.keys(r.dmgBySrc)) seen[src] = (seen[src] || 0) + r.dmgBySrc[src];
    for (const src of Object.keys(r.dotBySrc)) seen[src] = (seen[src] || 0) + r.dotBySrc[src];
    for (const src of Object.keys(seen)) {
      const poId = src.split('#')[0];
      // replay src labels do not disambiguate instances: 4 squads x N board
      // copies of a PO all share one label. Normalize to per-instance DPS.
      const inst = (r.meta.poInstances || {})[poId] || 1;
      (perPo[poId] = perPo[poId] || []).push(seen[src] / dur / inst);
    }
  }
  out.A.dpsPerPo = {};
  for (const poId of Object.keys(perPo).sort()) {
    const rarity = (ctx.poRarity || {})[poId] || null;
    const ceiling = rarity && ctx.dpsCeilings ? ctx.dpsCeilings[rarity] : null;
    out.A.dpsPerPo[poId] = { mean: round(mean(perPo[poId])), p95: round(p95(perPo[poId])), rarity, ceiling };
  }
  // ---- A2 status saturation ----
  out.A.statuses = {};
  const stAgg = {};
  for (const r of records) for (const s of Object.keys(r.statuses)) {
    const st = r.statuses[s];
    const a = stAgg[s] = stAgg[s] || { applies: 0, stacks: 0, tickDamage: 0, tickHeal: 0, firstHalf: 0, secondHalf: 0 };
    a.applies += st.applies; a.stacks += st.stacksApplied; a.tickDamage += st.tickDamage;
    a.tickHeal += st.tickHeal; a.firstHalf += st.firstHalfApplies; a.secondHalf += st.secondHalfApplies;
  }
  for (const s of Object.keys(stAgg).sort()) {
    const a = stAgg[s];
    a.growthRatio = a.firstHalf > 0 ? round(a.secondHalf / a.firstHalf) : (a.secondHalf > 0 ? Infinity : 0);
    out.A.statuses[s] = a;
  }
  // ---- A3 heal/block throughput (report-only; block + overheal not derivable from replay v1) ----
  out.A.healPerRunMean = round(mean(records.map(r => r.healTotal)));
  // ---- A4 circuit metrics ----
  const circuitBase = records.filter(r => r.meta.variant === 'base' && r.pulse.linkPulses > 0);
  const delinked = records.filter(r => r.meta.variant === 'delinked');
  if (circuitBase.length) {
    const pulsesPerSec = circuitBase.map(r => r.pulse.linkPulses / Math.max(r.durationSecs, 1e-9));
    const totalPulses = circuitBase.reduce((a, r) => a + r.pulse.linkPulses, 0);
    const capFizzles = circuitBase.reduce((a, r) => a + (r.pulse.fizzles.rate_cap || 0), 0);
    const hopHist = {};
    for (const r of circuitBase) for (const h of Object.keys(r.pulse.hopHist)) hopHist[h] = (hopHist[h] || 0) + r.pulse.hopHist[h];
    const dmgOf = (rs) => mean(rs.map(r => Object.values(r.dmgBySrc).reduce((a, b) => a + b, 0) + Object.values(r.dotBySrc).reduce((a, b) => a + b, 0)));
    const linkedDmg = dmgOf(circuitBase);
    const delinkedByKey = {};
    for (const r of delinked) (delinkedByKey[byKey(r)] = delinkedByKey[byKey(r)] || []).push(r);
    let amp = null;
    if (delinked.length) {
      const linkedKeys = new Set(circuitBase.map(byKey));
      const paired = Object.keys(delinkedByKey).filter(k => linkedKeys.has(k));
      if (paired.length) {
        const dl = dmgOf(paired.flatMap(k => delinkedByKey[k]));
        amp = dl > 0 ? round(linkedDmg / dl) : Infinity;
      }
    }
    out.A.circuit = {
      pulsesPerSecMean: round(mean(pulsesPerSec)),
      hopHist,
      fanoutMean: round(mean(circuitBase.flatMap(r => Object.values(r.pulse.fanout)))),
      pulseCapHitRate: round(totalPulses + capFizzles > 0 ? capFizzles / (totalPulses + capFizzles) : 0),
      amplificationFactor: amp,
      linkedDmgMean: round(linkedDmg),
    };
  }
  // ---- B1 bounce distribution / terminator rate per skill ----
  out.B.bounceBySkill = {};
  const skillRays = {};
  for (const r of records) for (const src of Object.keys(r.raysBySrc)) {
    const a = skillRays[src] = skillRays[src] || { fired: 0, idle: 0, bounces: [], terminators: 0, aoeExtra: 0, penExtra: 0 };
    const s = r.raysBySrc[src];
    a.fired += s.fired; a.idle += s.idle; a.terminators += s.terminators;
    a.aoeExtra += s.aoeExtra; a.penExtra += s.penExtra;
    a.bounces.push.apply(a.bounces, s.bounces);
  }
  for (const src of Object.keys(skillRays).sort()) {
    const a = skillRays[src];
    out.B.bounceBySkill[src] = {
      fired: a.fired,
      bounceMean: round(mean(a.bounces)),
      terminatorRate: round(a.fired ? a.terminators / a.fired : 0),
      idleRate: round(a.fired ? a.idle / a.fired : 0),
      aoeExtraPerRay: round(a.fired ? a.aoeExtra / a.fired : 0),
      penExtraPerRay: round(a.fired ? a.penExtra / a.fired : 0),
    };
  }
  // ---- B2 heatmap: safe cells + dead columns (both fields) ----
  out.B.heatmap = {};
  for (const f of ['player', 'enemy']) {
    const visits = {};
    for (const r of records) for (const k of Object.keys(r.cellVisits[f])) visits[k] = (visits[k] || 0) + r.cellVisits[f][k];
    const cols = {};
    for (const k of Object.keys(visits)) { const c = Number(k.split(',')[1]); cols[c] = (cols[c] || 0) + visits[k]; }
    out.B.heatmap[f] = { visitedCells: Object.keys(visits).length, deadColumns: [], totalVisits: Object.values(visits).reduce((a, b) => a + b, 0) };
    // dead columns among 1..26 (enemy field cols) that never saw a ray
    for (let c = 1; c <= 26; c++) if (!cols[c]) out.B.heatmap[f].deadColumns.push(c);
  }
  // ---- B4 coverage series ----
  const coverage = records.filter(r => String(r.meta.variant || '').startsWith('cov'));
  if (coverage.length) {
    const byCov = {};
    for (const r of coverage) (byCov[r.meta.variant] = byCov[r.meta.variant] || []).push(r);
    const series = Object.keys(byCov).sort().map(v => ({
      variant: v,
      coverage: Number(v.replace('cov', '')) || 0,
      dmgTakenMean: round(mean(byCov[v].map(r => r.dmgTakenTotal))),
      clearRate: round(mean(byCov[v].map(r => (r.result === 'victory' ? 1 : 0)))),
    })).sort((a, b) => b.coverage - a.coverage);
    let dominated = series.length >= 2;
    for (let i = 1; i < series.length; i++) {
      if (!(series[i].dmgTakenMean < series[i - 1].dmgTakenMean && series[i].clearRate >= series[i - 1].clearRate)) { dominated = false; break; }
    }
    out.B.coverage = { series, minimalDominates: dominated };
  }
  // ---- B5 formation equity ----
  const byFormation = {};
  for (const r of records) {
    if (r.meta.variant && r.meta.variant !== 'base') continue;
    (byFormation[r.meta.formationId] = byFormation[r.meta.formationId] || []).push(r);
  }
  const fKeys = Object.keys(byFormation).sort();
  if (fKeys.length >= 2) {
    const winRates = {};
    const sideShare = {};
    for (const f of fKeys) {
      winRates[f] = round(mean(byFormation[f].map(r => (r.result === 'victory' ? 1 : 0))));
      const taken = byFormation[f].reduce((a, r) => a + r.dmgTakenTotal, 0);
      const side = byFormation[f].reduce((a, r) => a + r.dmgTakenSideEntry, 0);
      sideShare[f] = round(taken > 0 ? side / taken : 0);
    }
    const rates = fKeys.map(f => winRates[f]);
    out.B.formationEquity = { winRates, spreadPts: round((Math.max.apply(null, rates) - Math.min.apply(null, rates)) * 100), sideEntryDamageShare: sideShare };
  }
  // ---- B6 ray aborts ----
  out.B.rayAborts = records.reduce((a, r) => a + r.aborts, 0);
  // ---- C1 time-to-first-down / wipe, death order ----
  const firstDowns = records.map(r => { const ts = Object.values(r.bpFirstDownT); return ts.length ? Math.min.apply(null, ts) : null; }).filter(x => x !== null);
  const wipeTs = records.filter(r => r.wipe && r.wipeT !== null).map(r => r.wipeT);
  const downFreqBySlotBp = {};
  for (const r of records) for (const bp of Object.keys(r.bpFirstDownT)) downFreqBySlotBp[bp] = (downFreqBySlotBp[bp] || 0) + 1;
  out.C.timeToFirstBpDownMean = round(mean(firstDowns));
  out.C.timeToWipeMean = round(mean(wipeTs));
  out.C.bpDownCounts = downFreqBySlotBp;
  // ---- C2 overkill / idle ----
  const totalDealt = records.reduce((a, r) => a + Object.values(r.dmgBySrc).reduce((x, y) => x + y, 0), 0);
  const totalOverkill = records.reduce((a, r) => a + r.overkillDmg, 0);
  const totalRays = records.reduce((a, r) => a + Object.values(r.raysBySrc).reduce((x, s) => x + s.fired, 0), 0);
  const idleRays = records.reduce((a, r) => a + Object.values(r.raysBySrc).reduce((x, s) => x + s.idle, 0), 0);
  out.C.overkillPct = round(totalDealt + totalOverkill > 0 ? totalOverkill / (totalDealt + totalOverkill) : 0);
  out.C.idleRayPct = round(totalRays > 0 ? idleRays / totalRays : 0);
  // ---- C3 cascade ----
  const cascades = records.map(r => {
    const b = r.cascade.beforeSecs > 0 ? r.cascade.beforeDmg / r.cascade.beforeSecs : 0;
    const a = r.cascade.afterSecs > 0 ? r.cascade.afterDmg / r.cascade.afterSecs : null;
    return (a !== null && b > 0) ? a / b : null;
  }).filter(x => x !== null);
  out.C.cascadeFactorMean = round(mean(cascades));
  // ---- D1 encounter durations per kind ----
  out.D.encounterDurations = {};
  const durByKind = {};
  for (const r of records) for (const e of r.encounters) {
    if (e.endT === null) continue;
    (durByKind[e.kind] = durByKind[e.kind] || []).push(e.endT - e.startT);
  }
  for (const k of Object.keys(durByKind).sort()) out.D.encounterDurations[k] = { mean: round(mean(durByKind[k])), p95: round(p95(durByKind[k])), n: durByKind[k].length };
  // ---- D2 clear-rate vs level + monotonicity ----
  const byLevel = {};
  const hasLevelAxis = records.some(r => r.meta.levelCurve);
  for (const r of records) {
    if (r.meta.variant && r.meta.variant !== 'base') continue;
    if (hasLevelAxis && !r.meta.levelCurve) continue;
    (byLevel[r.meta.level] = byLevel[r.meta.level] || []).push(r);
  }
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
  out.D.clearRateByLevel = {};
  for (const l of levels) out.D.clearRateByLevel[l] = round(mean(byLevel[l].map(r => (r.result === 'victory' ? 1 : 0))));
  out.D.monotonicityViolations = [];
  for (let i = 1; i < levels.length; i++) {
    const a = out.D.clearRateByLevel[levels[i - 1]], b = out.D.clearRateByLevel[levels[i]];
    if (b > a + 1e-9) out.D.monotonicityViolations.push('L' + levels[i] + '(' + b + ') > L' + levels[i - 1] + '(' + a + ')');
  }
  // ---- D3 finishing-H distribution ----
  const hs = records.filter(r => typeof r.H === 'number').map(r => r.H);
  if (hs.length) {
    const lo = hs.filter(h => h <= 0.1).length / hs.length;
    const hi = hs.filter(h => h >= 0.9).length / hs.length;
    const mid = 1 - lo - hi;
    out.D.hDistribution = { n: hs.length, mean: round(mean(hs)), fracLow: round(lo), fracHigh: round(hi), fracMid: round(mid) };
  }
  // ---- D4 utility EV ----
  const attTotals = { trap: 0, chest: 0, door: 0 };
  const attReveals = { trap: 0, chest: 0, door: 0 };
  const attOpens = { chest: 0, door: 0 };
  const attLost = { chest: 0, door: 0 };
  let disarms = 0, fires = 0;
  for (const r of records) {
    for (const k of ['trap', 'chest', 'door']) {
      attTotals[k] += (r.meta.defAtt || {})[k] || 0;
      attReveals[k] += r.att.reveal[k] || 0;
    }
    for (const k of ['chest', 'door']) { attOpens[k] += r.att.open[k] || 0; attLost[k] += r.att.lost[k] || 0; }
    disarms += r.att.disarm.trap || 0;
    fires += r.att.fire.trap || 0;
  }
  out.D.utility = {
    trapDiscoveryRate: round(attTotals.trap > 0 ? attReveals.trap / attTotals.trap : 0),
    trapDisarms: disarms, trapFires: fires,
    chestCompletionRate: round(attTotals.chest > 0 ? attOpens.chest / attTotals.chest : 0),
    chestLostRate: round(attTotals.chest > 0 ? attLost.chest / attTotals.chest : 0),
    attTotals,
  };
  // scout vs control comparison (same dungeon/level/formation axes)
  const scout = records.filter(r => r.meta.boardId === 'scout_heavy' && (!r.meta.variant || r.meta.variant === 'base'));
  const control = records.filter(r => r.meta.boardId === 'no_utility_control' && (!r.meta.variant || r.meta.variant === 'base'));
  if (scout.length && control.length) {
    const evOf = (rs) => ({ rewards: mean(rs.map(r => r.rewards.length)), H: mean(rs.filter(r => typeof r.H === 'number').map(r => r.H)), dmg: mean(rs.map(r => Object.values(r.dmgBySrc).reduce((a, b) => a + b, 0))) });
    const s = evOf(scout), c = evOf(control);
    out.D.scoutNetEV = {
      rewardsDelta: round(s.rewards - c.rewards),
      hDelta: round(s.H - c.H),
      battleDpsForegoneRatio: round(c.dmg > 0 ? 1 - s.dmg / c.dmg : 0),
    };
  }
  // ---- D5 door shortcut throughput ----
  const jumps = records.flatMap(r => r.shortcuts.map(s => s.jump_pct || 0));
  out.D.shortcut = { count: jumps.length, jumpPctMean: round(mean(jumps)), perRun: round(jumps.length / Math.max(records.length, 1)) };
  // ---- D6 wipe autopsy ----
  const wipes = records.filter(r => r.wipe);
  const encHist = {};
  for (const r of wipes) if (r.wipeEnc !== null && r.wipeEnc !== undefined) encHist[r.wipeEnc] = (encHist[r.wipeEnc] || 0) + 1;
  out.D.wipes = {
    count: wipes.length, rate: round(wipes.length / Math.max(records.length, 1)),
    encounterIndexHist: encHist,
    earlyWipeRate: round(wipes.length ? wipes.filter(r => (r.wipeEnc || 0) <= 1).length / wipes.length : 0),
  };
  // ---- E1 economy throughput ----
  const cycles = records.map(r => r.durationSecs + (r.cooldownSecs || 0)).filter(x => x > 0);
  const cycleMean = mean(cycles);
  const rewardsPerRun = mean(records.map(r => r.rewards.length));
  const lrdstPerRun = mean(records.map(r => r.lrdst));
  out.E.economy = {
    cycleSecsMean: round(cycleMean),
    itemsPerHour: round(cycleMean > 0 ? rewardsPerRun * 3600 / cycleMean : 0),
    lrdstPerHour: round(cycleMean > 0 ? lrdstPerRun * 3600 / cycleMean : 0),
    itemsPerDay: round(cycleMean > 0 ? rewardsPerRun * 86400 / cycleMean : 0),
  };
  // ---- E2 gacha audit: not derivable in-sim (no gacha API in sim scope) ----
  out.E.gachaAudit = 'n/a-v1 (no gacha generator in sim scope; server-side gacha lands with its own REQ)';
  // ---- E3 plateau ETA ----
  out.E.plateau = {};
  for (const l of levels) {
    const rs = byLevel[l];
    const clr = out.D.clearRateByLevel[l];
    const cyc = mean(rs.map(r => r.durationSecs + (r.cooldownSecs || 0)));
    out.E.plateau['L' + l] = {
      clearRate: clr,
      expectedRunsToClear: clr > 0 ? round(1 / clr) : null,
      daysPerClear: (clr > 0 && cyc > 0) ? round(cyc / clr / 86400) : null,
    };
  }
  // ---- E4 adoption ----
  const boardDmg = {};
  for (const r of records) {
    if (r.meta.variant && r.meta.variant !== 'base') continue;
    const d = Object.values(r.dmgBySrc).reduce((a, b) => a + b, 0);
    (boardDmg[r.meta.boardId] = boardDmg[r.meta.boardId] || []).push(d);
  }
  const boardMeans = Object.keys(boardDmg).map(b => ({ board: b, dmg: mean(boardDmg[b]) })).sort((a, b) => b.dmg - a.dmg);
  const topN = Math.max(1, Math.ceil(boardMeans.length / 10));
  const topBoards = new Set(boardMeans.slice(0, topN).map(x => x.board));
  const seenInTop = new Set();
  for (const r of records) {
    if (!topBoards.has(r.meta.boardId)) continue;
    for (const src of Object.keys(r.raysBySrc)) seenInTop.add(src.split('#')[0]);
  }
  const liveIds = ctx.liveItemIds || [];
  out.E.adoption = {
    topDecileBoards: Array.from(topBoards).sort(),
    liveItemsInTopDecile: liveIds.filter(id => seenInTop.has(id)).sort(),
    adoptionRate: round(liveIds.length ? liveIds.filter(id => seenInTop.has(id)).length / liveIds.length : 0),
  };
  return out;
}

// ---------- threshold evaluation ----------
// thresholds: parsed sim/s4_thresholds.json. Returns {warns:[..], hards:[..]}.
function evaluate(summary, thresholds) {
  const warns = [], hards = [];
  const th = thresholds || {};
  const add = (cls, msg) => (cls === 'hard' ? hards : warns).push(msg);
  // A1 dps ceilings
  for (const po of Object.keys(summary.A.dpsPerPo || {})) {
    const d = summary.A.dpsPerPo[po];
    if (d.ceiling !== null && d.ceiling !== undefined && d.mean > d.ceiling) {
      add(th.a1_dps_ceiling_class || 'warn', 'A1 ' + po + ': mean DPS ' + d.mean + ' > ' + d.rarity + ' ceiling ' + d.ceiling);
    }
  }
  // A2 runaway status
  for (const s of Object.keys(summary.A.statuses || {})) {
    const a = summary.A.statuses[s];
    if (a.applies >= (th.a2_min_applies || 20) && a.growthRatio > (th.a2_runaway_growth_ratio || 3)) {
      add('hard', 'A2 ' + s + ': runaway growth ratio ' + a.growthRatio + ' (applies ' + a.applies + ')');
    }
  }
  // A4 circuit
  if (summary.A.circuit) {
    const c = summary.A.circuit;
    if (c.amplificationFactor !== null && c.amplificationFactor > (th.a4_amplification_warn || 2.5)) {
      add('warn', 'A4 circuit amplification ' + c.amplificationFactor + 'x > ' + (th.a4_amplification_warn || 2.5) + 'x');
    }
    if (c.pulseCapHitRate > (th.a4_pulse_cap_hit_rate_warn || 0.05)) {
      add('warn', 'A4 PULSE_CAP hit rate ' + c.pulseCapHitRate + ' > ' + (th.a4_pulse_cap_hit_rate_warn || 0.05));
    }
  }
  // B1 terminator
  for (const src of Object.keys(summary.B.bounceBySkill || {})) {
    const b = summary.B.bounceBySkill[src];
    if (b.fired >= (th.b1_min_rays || 10) && b.terminatorRate > (th.b1_terminator_rate_warn || 0.3)) {
      add('warn', 'B1 ' + src + ': all-field terminator rate ' + b.terminatorRate + ' > ' + (th.b1_terminator_rate_warn || 0.3));
    }
  }
  // B4 coverage dominance
  if (summary.B.coverage && summary.B.coverage.minimalDominates) {
    add('hard', 'B4 minimal-coverage builds strictly dominate the coverage series');
  }
  // B5 formation equity
  if (summary.B.formationEquity && summary.B.formationEquity.spreadPts > (th.b5_win_rate_spread_pts_warn || 15)) {
    add('warn', 'B5 formation win-rate spread ' + summary.B.formationEquity.spreadPts + 'pt > ' + (th.b5_win_rate_spread_pts_warn || 15) + 'pt');
  }
  // B6 aborts
  if ((summary.B.rayAborts || 0) > (th.b6_ray_abort_allowed || 0)) {
    add('hard', 'B6 ray_abort count ' + summary.B.rayAborts + ' > ' + (th.b6_ray_abort_allowed || 0));
  }
  // D1 pacing bands
  const bands = th.d1_duration_bands || {};
  for (const kind of Object.keys(bands)) {
    const d = (summary.D.encounterDurations || {})[kind];
    if (d && (d.mean < bands[kind][0] || d.mean > bands[kind][1])) {
      add('warn', 'D1 ' + kind + ': mean duration ' + d.mean + 's outside band [' + bands[kind][0] + ',' + bands[kind][1] + ']');
    }
  }
  // D2 monotonicity
  for (const v of (summary.D.monotonicityViolations || [])) add('hard', 'D2 monotonicity: ' + v);
  // D2 target band
  const band = th.d2_on_level_clear_band;
  if (band && summary.D.clearRateByLevel) {
    const onLevel = summary.D.clearRateByLevel[th.d2_on_level || 3];
    if (onLevel !== undefined && (onLevel < band[0] || onLevel > band[1])) {
      add('warn', 'D2 on-level clear rate ' + onLevel + ' outside target band [' + band[0] + ',' + band[1] + ']');
    }
  }
  // D3 bimodal H
  if (summary.D.hDistribution) {
    const h = summary.D.hDistribution;
    if (h.n >= (th.d3_min_runs || 10) && (h.fracLow + h.fracHigh) > (th.d3_bimodal_extreme_frac || 0.8) && h.fracMid < (th.d3_bimodal_mid_frac || 0.1)) {
      add('hard', 'D3 finishing-H distribution is bimodal (low ' + h.fracLow + ' + high ' + h.fracHigh + ', mid ' + h.fracMid + ') -- voids the linear cooldown curve');
    }
  }
  // D4 chest loss
  if (summary.D.utility && summary.D.utility.attTotals.chest >= (th.d4_min_chests || 5) && summary.D.utility.chestLostRate > (th.d4_chest_lost_rate_warn || 0.4)) {
    add('warn', 'D4 chest lost rate ' + summary.D.utility.chestLostRate + ' > ' + (th.d4_chest_lost_rate_warn || 0.4));
  }
  // D4 scout EV band
  if (summary.D.scoutNetEV && th.d4_scout_reward_delta_band) {
    const b2 = th.d4_scout_reward_delta_band;
    if (summary.D.scoutNetEV.rewardsDelta < b2[0] || summary.D.scoutNetEV.rewardsDelta > b2[1]) {
      add('warn', 'D4 scout-vs-control reward delta ' + summary.D.scoutNetEV.rewardsDelta + ' outside band [' + b2[0] + ',' + b2[1] + ']');
    }
  }
  // D6 early wipes
  if (summary.D.wipes && summary.D.wipes.count >= (th.d6_min_wipes || 4) && summary.D.wipes.earlyWipeRate > (th.d6_early_wipe_rate_warn || 0.25)) {
    add('warn', 'D6 early-wipe rate ' + summary.D.wipes.earlyWipeRate + ' > ' + (th.d6_early_wipe_rate_warn || 0.25) + ' (frustration detector)');
  }
  return { warns, hards };
}

module.exports = { processRun, aggregate, evaluate, _stats: { mean, p95, round } };
