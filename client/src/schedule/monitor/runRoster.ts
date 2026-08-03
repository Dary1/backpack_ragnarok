// REQ-0240 (03 spec ss4 component tree): reduce RELEASED events + the run
// roster (M1) into per-squad + per-enemy HP/KO state shared by the dock, the
// stage plates, and the feed tones. A single, deterministic fold over the
// released slice (idempotent -- recomputed from scratch each render).
//
// REQ-0355: this fold now tracks HP MID-RUN on both sides. Player pools drain
// from slot/bpIdx-attributed ray_hit / status_tick / aoe-hits events (the sim
// tags player-target events since REQ-0355; before, three seats fielding the
// same content id were unattributable and the dock sat on the documented
// "full bars until run_end" fallback -- the user-reported "HP never moves").
// Enemy readouts key by INSTANCE id (`frost_giant#1`, the actual `dst` on the
// wire) with a def-id alias for legacy events; the old reduction required
// `ev.field === 'enemy'` on ray_hit -- a field ray_hit never carried -- so
// enemy HP never updated at all.
import type { ApiRunEvent, ApiRunRoster } from '../../api';

export interface SquadReadout {
  slot: string; index: number;
  hpMax: number; hp: number;
  ko: boolean; untouched: boolean;
  charge: number | null; // null => no charge telemetry (pips hidden cleanly, M3)
}
export interface EnemyReadout { id: string; name: string; hpMax: number; hp: number; discovered: boolean; }
export interface RunRosterState { squads: SquadReadout[]; enemies: EnemyReadout[]; }

interface HitLike { dst?: unknown; hp_after?: unknown; slot?: unknown; bpIdx?: unknown }

/** Reduce the released event slice into HP/KO state. Mid-run both sides track
 * the last hp_after seen per attributable target; run_end's troop_bp_hp stays
 * the final authority for the player side (slot-ordered, exact). */
export function reduceRunRoster(roster: ApiRunRoster | null, released: ApiRunEvent[], locale: 'en' | 'ja'): RunRosterState {
  const slots = roster?.slots ?? [];
  // Per-slot, per-BP hp pools (index = bpIdx), drained as attributed events air.
  const pools: number[][] = slots.map((sl) => sl.bps.map((b) => b.hpMax || 0));
  const squads: SquadReadout[] = slots.map((sl, i) => {
    const hpMax = sl.bps.reduce((s, b) => s + (b.hpMax || 0), 0);
    return { slot: sl.slot, index: sl.index ?? i, hpMax, hp: hpMax, ko: false, untouched: true, charge: null };
  });

  const readouts: EnemyReadout[] = [];
  const enemyByKey = new Map<string, EnemyReadout>();
  for (const en of roster?.enemies ?? []) {
    const r: EnemyReadout = { id: en.instanceId ?? en.id, name: locale === 'ja' ? en.nameJa : en.name, hpMax: en.hpMax, hp: en.hpMax, discovered: false };
    readouts.push(r);
    if (en.instanceId && !enemyByKey.has(en.instanceId)) enemyByKey.set(en.instanceId, r);
    if (!enemyByKey.has(en.id)) enemyByKey.set(en.id, r); // def-id alias: legacy events / def-labelled ticks
  }

  const markEnemy = (id: unknown, hpAfter: unknown): void => {
    if (typeof id !== 'string' || id === '?') return;
    const e = enemyByKey.get(id);
    if (!e) return;
    e.discovered = true;
    if (typeof hpAfter === 'number') e.hp = Math.max(0, hpAfter);
  };
  const applyPlayer = (slot: unknown, bpIdx: unknown, hpAfter: unknown): void => {
    if (typeof slot !== 'number' || typeof hpAfter !== 'number') return;
    const pool = pools[slot];
    const sq = squads[slot];
    if (!pool || !sq || pool.length === 0) return;
    const bi = typeof bpIdx === 'number' && bpIdx >= 0 && bpIdx < pool.length ? bpIdx : 0;
    pool[bi] = Math.max(0, hpAfter);
    sq.hp = pool.reduce((s, v) => s + v, 0);
    sq.untouched = sq.hpMax > 0 && sq.hp >= sq.hpMax;
    sq.ko = sq.hpMax > 0 && sq.hp <= 0;
  };
  const applyHit = (h: HitLike): void => {
    if (typeof h.dst === 'string' && enemyByKey.has(h.dst)) markEnemy(h.dst, h.hp_after);
    else if (typeof h.slot === 'number') applyPlayer(h.slot, h.bpIdx, h.hp_after);
  };

  for (const ev of released) {
    switch (ev.ev) {
      case 'ray_hit':
      case 'status_tick':
        applyHit(ev as HitLike);
        break;
      case 'ray_aoe':
      case 'ray_hit_all':
        if (Array.isArray(ev.hits)) for (const h of ev.hits as HitLike[]) applyHit(h);
        break;
      case 'heal_ally':
      case 'lifesteal_heal':
        if (typeof ev.dst === 'string' && enemyByKey.has(ev.dst)) markEnemy(ev.dst, ev.hp_after);
        break;
      default:
        break;
    }
  }

  const runEnd = released.find((e) => e.ev === 'run_end');
  if (runEnd && Array.isArray(runEnd.troop_bp_hp) && roster) {
    // troop_bp_hp is allBps.map(b=>b.hp) in slot order (unit1..unit4) -- exact.
    const hps = runEnd.troop_bp_hp as number[];
    let off = 0;
    for (const sq of squads) {
      const n = roster.slots[sq.index]?.bps.length ?? 0;
      let hp = 0; for (let k = 0; k < n; k++) hp += Math.max(0, hps[off + k] ?? 0);
      off += n;
      sq.hp = hp;
      sq.ko = sq.hpMax > 0 && hp <= 0;
      sq.untouched = sq.hpMax > 0 && hp >= sq.hpMax;
    }
  }
  return { squads, enemies: readouts };
}
