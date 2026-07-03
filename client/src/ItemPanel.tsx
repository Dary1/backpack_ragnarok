// Right panel: items + socket items list with hover tooltips — REQ-0026 T0.1.
// Read-only (no drag source yet -- T0.2 wires this into placement). Tooltip
// content (name/tags/eff) mirrors mock-src/ui.js's poTip()/siTip() shape,
// rendered in whichever locale is currently selected (JA/EN toggle in the
// header, shared via the store).
import { useState } from 'react';
import type { ItemDef, SIDef } from './engine/engine.d.ts';
import type { Locale } from './store';

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rarity: string;
  meta: string;
  eff: string;
}

function localized<T extends { name_ja?: string }>(d: T, field: keyof T, locale: Locale): string {
  if (locale === 'ja') {
    const jaKey = `${String(field)}_ja` as keyof T;
    const jaVal = d[jaKey];
    if (typeof jaVal === 'string' && jaVal) return jaVal;
  }
  const val = d[field];
  return typeof val === 'string' ? val : '';
}

function effText(d: { eff_en?: string; eff_ja?: string }, locale: Locale): string {
  return (locale === 'ja' ? d.eff_ja : d.eff_en) || d.eff_en || d.eff_ja || '';
}

interface ItemPanelProps {
  items: Record<string, ItemDef>;
  siDefs: Record<string, SIDef>;
  locale: Locale;
}

export function ItemPanel({ items, siDefs, locale }: ItemPanelProps) {
  const [tip, setTip] = useState<TooltipState | null>(null);

  const showTip = (e: React.MouseEvent, title: string, rarity: string, meta: string, eff: string) => {
    setTip({ x: e.clientX + 16, y: e.clientY + 16, title, rarity, meta, eff });
  };
  const moveTip = (e: React.MouseEvent) => {
    setTip((t) => (t ? { ...t, x: e.clientX + 16, y: e.clientY + 16 } : t));
  };
  const hideTip = () => setTip(null);

  const itemEntries = Object.entries(items);
  const siEntries = Object.entries(siDefs);

  return (
    <aside className="item-panel">
      <h2>{locale === 'ja' ? 'アイテム' : 'Items'}</h2>
      <ul className="item-list">
        {itemEntries.map(([id, def]) => {
          const dType = def.tags?.[0] ?? '';
          const dEl = (def.tags ?? []).slice(1);
          const meta = `${dType}${dEl.length ? ` · tags: ${dEl.join(', ')}` : ''}`;
          return (
            <li
              key={id}
              onMouseEnter={(e) => showTip(e, localized(def, 'name', locale), def.rarity, meta, effText(def, locale))}
              onMouseMove={moveTip}
              onMouseLeave={hideTip}
            >
              <span className={`rarity r-${def.rarity}`}>{def.rarity[0]}</span> {localized(def, 'name', locale)}
            </li>
          );
        })}
      </ul>
      <h2>{locale === 'ja' ? 'ソケットアイテム' : 'Socket Items'}</h2>
      <ul className="item-list">
        {siEntries.map(([id, def]) => {
          const meta = `Socket Item · slot: ${def.slot}${def.reqTags.length ? ` · needs socket tags: ${def.reqTags.join(', ')}` : ' · no tag requirement'}`;
          return (
            <li
              key={id}
              onMouseEnter={(e) => showTip(e, localized(def, 'name', locale), def.rarity, meta, effText(def, locale))}
              onMouseMove={moveTip}
              onMouseLeave={hideTip}
            >
              <span className={`rarity r-${def.rarity}`}>{def.rarity[0]}</span> {localized(def, 'name', locale)}
            </li>
          );
        })}
      </ul>
      {tip && (
        <div className="tooltip" style={{ left: tip.x, top: tip.y }}>
          <h3>
            {tip.title} <span className={`rarity r-${tip.rarity}`}>{tip.rarity}</span>
          </h3>
          <div className="tooltip-meta">{tip.meta}</div>
          <div className="tooltip-eff">{tip.eff}</div>
        </div>
      )}
    </aside>
  );
}
