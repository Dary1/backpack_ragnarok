// REQ-0240 M2 helper: derive expedition-rail nodes from the run event log.
// Split out of ExpeditionRail.tsx so the component file only exports a
// component (react-refresh cleanliness).
import { t } from '../../i18n';
import type { Locale } from '../../store';
import type { ApiRunEvent } from '../../api';

export interface RailNode {
  ptMs: number;
  kind: 'pack' | 'boss' | 'trap' | 'chest' | 'door';
  passed: boolean;
  failed: boolean;
  label: string;
}

export function railNodesFrom(events: ApiRunEvent[], locale: Locale): RailNode[] {
  const nodes: RailNode[] = [];
  for (const ev of events) {
    const ptMs = typeof ev.pt === 'number' ? ev.pt : (typeof ev.t === 'number' ? ev.t * 1000 : 0);
    if (ev.ev === 'encounter_start') {
      nodes.push({ ptMs, kind: ev.kind === 'boss' ? 'boss' : 'pack', passed: false, failed: false, label: ev.kind === 'boss' ? t(locale, 'schedule.monitor.kind.boss') : t(locale, 'schedule.monitor.kind.pack') });
    } else if (ev.ev === 'att_reveal' && (ev.kind === 'trap' || ev.kind === 'chest' || ev.kind === 'door')) {
      nodes.push({ ptMs, kind: ev.kind, passed: false, failed: false, label: t(locale, ('schedule.monitor.kind.' + ev.kind) as never) });
    }
  }
  return nodes;
}
