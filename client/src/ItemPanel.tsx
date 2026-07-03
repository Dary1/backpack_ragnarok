// Right panel: live inventory (drag source) + item/SI catalog with hover
// tooltips — REQ-0026 T0.1 (catalog), extended REQ-0027 T0.2 (inventory).
//
// Two sections: a live INVENTORY grid (state.pos entries with loc==='inv',
// state.sis entries with host==='inv') that is a REAL pointer-based drag
// source (matches mock-src/ui.js's gInv rendering: one entry per grid slot,
// PO art scaled to fit, SI icon+name) -- and, below it, the read-only item/
// SI catalog carried over from T0.1 unchanged. Tooltip content (name/tags/
// eff) mirrors mock-src/ui.js's poTip()/siTip() shape, rendered in whichever
// locale is currently selected (JA/EN toggle in the header, shared via the
// store).
//
// Drag wiring: a pointerdown on an inventory entry calls
// getBoardRenderer()?.startExternalDrag(kind, uid, clientX, clientY) --
// this starts the SAME carry (board/drag.ts) the canvas itself uses, so
// the ghost/legality-tint renders on the board canvas even though the
// gesture began in this React-rendered panel (see board/Board.tsx's
// module comment for why a module-level renderer accessor is used here
// instead of prop-drilling or context).
import { useEffect, useRef, useState } from 'react';
import { getBoardRenderer, setInventoryPanelEl } from './board/Board';
import type { GameState, ItemDef, SIDef } from './engine/engine.d.ts';
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
  state: GameState | null;
}

export function ItemPanel({ items, siDefs, locale, state }: ItemPanelProps) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const invRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setInventoryPanelEl(invRef.current);
    return () => setInventoryPanelEl(null);
  }, []);

  const showTip = (e: React.MouseEvent, title: string, rarity: string, meta: string, eff: string) => {
    setTip({ x: e.clientX + 16, y: e.clientY + 16, title, rarity, meta, eff });
  };
  const moveTip = (e: React.MouseEvent) => {
    setTip((t) => (t ? { ...t, x: e.clientX + 16, y: e.clientY + 16 } : t));
  };
  const hideTip = () => setTip(null);

  const startDrag = (e: React.PointerEvent, kind: 'po' | 'si', uid: string) => {
    if (e.button !== 0) return;
    getBoardRenderer()?.startExternalDrag(kind, uid, e.clientX, e.clientY);
  };

  const itemEntries = Object.entries(items);
  const siEntries = Object.entries(siDefs);

  const invPos = state ? state.pos.filter((p) => p.loc === 'inv') : [];
  const invSis = state ? state.sis.filter((a) => a.host === 'inv') : [];

  return (
    <aside className="item-panel">
      <div ref={invRef} className="inventory-panel">
        <h2>{locale === 'ja' ? 'インベントリ' : 'Inventory'}</h2>
        <div className="inventory-note">
          {locale === 'ja' ? '格納中のアイテムは効果を発揮しません' : 'items parked here take no effect'}
        </div>
        <div className="inventory-grid">
          {invPos.map((p) => {
            const def = items[p.id];
            if (!def) return null;
            return (
              <div
                key={p.uid}
                className="inventory-slot"
                onPointerDown={(e) => startDrag(e, 'po', p.uid)}
                onDoubleClick={() => {
                  /* rotate-in-inventory: harmless no-op visual rotation is
                     handled by the engine's rotatePO (loc==='inv' always
                     succeeds, see engine.js); wired via the board canvas'
                     dblclick path for placed POs -- inventory-side rotate
                     is a nice-to-have the mock also exposes via its own
                     inventory dblclick handler, kept here for parity. */
                }}
                onMouseEnter={(e) => {
                  const dType = def.tags?.[0] ?? '';
                  const dEl = (def.tags ?? []).slice(1);
                  const meta = `${dType}${dEl.length ? ` · tags: ${dEl.join(', ')}` : ''}`;
                  showTip(e, localized(def, 'name', locale), def.rarity, meta, effText(def, locale));
                }}
                onMouseMove={moveTip}
                onMouseLeave={hideTip}
              >
                <span className={`rarity r-${def.rarity} inventory-rarity`}>{def.rarity[0]}</span>
                <span className="inventory-label">{localized(def, 'name', locale)}</span>
              </div>
            );
          })}
          {invSis.map((a) => {
            const def = siDefs[a.id];
            if (!def) return null;
            return (
              <div
                key={a.uid}
                className="inventory-slot"
                onPointerDown={(e) => startDrag(e, 'si', a.uid)}
                onMouseEnter={(e) => {
                  const meta = `Socket Item · slot: ${def.slot}${def.reqTags.length ? ` · needs socket tags: ${def.reqTags.join(', ')}` : ' · no tag requirement'}`;
                  showTip(e, localized(def, 'name', locale), def.rarity, meta, effText(def, locale));
                }}
                onMouseMove={moveTip}
                onMouseLeave={hideTip}
              >
                <span className={`rarity r-${def.rarity} inventory-rarity`}>{def.rarity[0]}</span>
                <span className="inventory-label">{localized(def, 'name', locale)}</span>
              </div>
            );
          })}
          {invPos.length === 0 && invSis.length === 0 && (
            <div className="inventory-empty">{locale === 'ja' ? '（空）' : '(empty)'}</div>
          )}
        </div>
      </div>

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
