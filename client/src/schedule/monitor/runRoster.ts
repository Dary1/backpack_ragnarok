// REQ-0240 (03 spec ss4 component tree): reduce RELEASED events + the run
// roster (M1) into per-squad + per-enemy HP/KO state shared by the dock, the
// stage plates, and the feed tones. A single, deterministic fold over the
// released slice (idempotent -- recomputed from scratch each render).
import type { ApiRunEvent, ApiRunRoster } from '../../api';

export interface SquadReadout {
  slot: string; index: number;
  hpMax: number; hp: number;
  ko: boolean; untouched: boolean;
  charge: number | null; // null => no charge telemetry (pips hidden cleanly, M3)
}
export interface EnemyReadout { id: string; name: string; hpMax: number; hp: number; discovered: boolean; }
export interface RunRosterState { squads: SquadReadout[]; enemies: EnemyReadout[]; }

/** Reduce the released event slice into HP/KO state. Player HP is exact once
 * run_end airs (troop_bp_hp is emitted in slot order, matching roster.slots);
 * mid-run the dock shows full bars (a documented M1 fallback -- per-BP mid-run
 * HP is not attributable from cell-labelled hit events). Enemy HP tracks the
 * last hp_after seen for each discovered enemy id against its roster hpMax. */
export function reduceRunRoster(roster: ApiRunRoster | null, released: ApiRunEvent[], locale: 'en' | 'ja'): RunRosterState {
  const squads: SquadReadout[] = (roster?.slots ?? []).map((sl) => {
    const hpMax = sl.bps.reduce((s, b) => s + (b.hpMax || 0), 0);
    return { slot: sl.slot, index: sl.index, hpMax, hp: hpMax, ko: false, untouched: true, charge: null };
  });
  const enemyById = new Map<string, EnemyReadout>();
  for (const en of roster?.enemies ?? []) {
    enemyById.set(en.id, { id: en.id, name: locale === 'ja' ? en.nameJa : en.name, hpMax: en.hpMax, hp: en.hpMax, discovered: false });
  }

  const markEnemy = (id: unknown, hpAfter: unknown): void => {
    if (typeof id !== 'string' || id === '?') return;
    const e = enemyById.get(id);
    if (!e) return;
    e.discovered = true;
    if (typeof hpAfter === 'number') e.hp = Math.max(0, hpAfter);
  };

  const runEnd = released.find((e) => e.ev === 'run_end');
  if (runEnd && Array.isArray(runEnd.troop_bp_hp) && roster) {
    // troop_bp_hp is allBps.map(b=>b.hp) in slot order (unit1..unit4).
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

  for (const ev of released) {
    if (ev.ev === 'ray_hit' && ev.field === 'enemy') markEnemy(ev.dst, ev.hp_after);
    else if ((ev.ev === 'ray_aoe' || ev.ev === 'ray_hit_all') && ev.field === 'enemy' && Array.isArray(ev.hits)) {
      for (const h of ev.hits as Array<{ dst?: string; hp_after?: number }>) markEnemy(h.dst, h.hp_after);
    }
  }
  return { squads, enemies: Array.from(enemyById.values()) };
}
