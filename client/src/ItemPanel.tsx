// Right panel: item/SI catalog — REQ-0026 T0.1, re-skinned REQ-0070 to the
// MJOLNIR canvas mock (web/redesign/canvas.html's .inv item cards +
// .detail card). REQ-0030 Phase 2 retired the old drag-source list; this
// panel remains the READ-ONLY catalog it has been since then — no drag
// sources, no engine calls, nothing here touches the boards.
//
// REQ-0070 changes (visual/additive only; the hover-tooltip contract is
// byte-compatible -- same .tooltip/.tooltip-meta/.tooltip-eff classes,
// same fixed positioning driven by mouse events):
//  - Catalog rows render as the mock's item cards (.icard): rarity frame
//    (theme .rar-* + corner .gem, colorblind-safe double encoding), a
//    sprite thumbnail (the app's OWN sprite sheet via dexIcons.ts's
//    iconDataUrl -- the mock's ic_*.png are placeholders and stay out of
//    item rendering, per the REQ), and a kind ・ WxH ・ tag ・ RARITY
//    sub-line composed from the real defs.
//  - Clicking a row selects it into the mock's detail card at the top of
//    the panel (art on a dark altar + name/rarity/meta/effect/flavor).
//    All fields come straight from ItemDef/SIDef -- flavor/effect fall
//    back across locales exactly like the tooltip always has. The mock's
//    「盤面へ配置 / 分解」action buttons are OMITTED: the catalog has no
//    placement/salvage backing actions (that would be fiction).
//  - Rarity mapping to the theme ramp: Common/Uncommon/Rare keep their
//    names; this game's top tier "Relic" wears the mock's LEGENDARY frame
//    (the mock itself labels its legendary tier「遺宝」= relic).
import { useState } from 'react';
import { iconDataUrl } from './dex/dexIcons';
import type { ItemDef, Offset, SIDef } from './engine/engine.d.ts';
import { t } from './i18n';
import type { Locale } from './store';

interface TooltipState {
  x: number;
  y: number;
  title: string;
  rarity: string;
  meta: string;
  eff: string;
}

type Selection = { kind: 'item' | 'si'; id: string };

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

/** Theme rarity-frame class for a game rarity (see module comment). */
function rarClass(rarity: string): string {
  switch (rarity) {
    case 'Uncommon':
      return 'rar-uncommon';
    case 'Rare':
      return 'rar-rare';
    case 'Relic':
      return 'rar-legend';
    default:
      return 'rar-common';
  }
}

/** WxH of an unrotated shape's bounding box (offsets are engine-normalized
 * to non-negative [dr,dc], anchored at [0,0]). */
function shapeDims(shape: Offset[] | undefined): string {
  if (!shape || shape.length === 0) return '1×1';
  let h = 1;
  let w = 1;
  for (const [dr, dc] of shape) {
    if (dr + 1 > h) h = dr + 1;
    if (dc + 1 > w) w = dc + 1;
  }
  return `${w}×${h}`;
}

interface ItemPanelProps {
  items: Record<string, ItemDef>;
  siDefs: Record<string, SIDef>;
  locale: Locale;
}

export function ItemPanel({ items, siDefs, locale }: ItemPanelProps) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const itemEntries = Object.entries(items);
  const siEntries = Object.entries(siDefs);
  // Detail card selection -- defaults to the first catalog item so the
  // card is populated from first paint, like the mock.
  const [selected, setSelected] = useState<Selection | null>(() =>
    itemEntries.length ? { kind: 'item', id: itemEntries[0][0] } : siEntries.length ? { kind: 'si', id: siEntries[0][0] } : null
  );

  const showTip = (e: React.MouseEvent, title: string, rarity: string, meta: string, eff: string) => {
    setTip({ x: e.clientX + 16, y: e.clientY + 16, title, rarity, meta, eff });
  };
  const moveTip = (e: React.MouseEvent) => {
    setTip((t) => (t ? { ...t, x: e.clientX + 16, y: e.clientY + 16 } : t));
  };
  const hideTip = () => setTip(null);

  const itemMeta = (def: ItemDef): string => {
    const dType = def.tags?.[0] ?? '';
    const dEl = (def.tags ?? []).slice(1);
    return `${dType}${dEl.length ? ` · tags: ${dEl.join(', ')}` : ''}`;
  };
  const siMeta = (def: SIDef): string =>
    `Socket Item · slot: ${def.slot}${def.reqTags.length ? ` · needs socket tags: ${def.reqTags.join(', ')}` : ' · no tag requirement'}`;

  // Resolve the selected def for the detail card (tolerates a stale id).
  const sel = selected;
  const selDef: ItemDef | SIDef | null = sel ? (sel.kind === 'item' ? items[sel.id] ?? null : siDefs[sel.id] ?? null) : null;

  const renderDetail = () => {
    if (!sel || !selDef) return null;
    const icon = iconDataUrl(selDef.icon);
    const name = localized(selDef, 'name', locale);
    const flavor = localized(selDef, 'flavor', locale);
    const meta =
      sel.kind === 'item'
        ? `PO ・ ${shapeDims((selDef as ItemDef).shape)} ・ ${itemMeta(selDef as ItemDef)}`
        : `SI ・ ${siMeta(selDef as SIDef)}`;
    const eff = effText(selDef, locale);
    return (
      <div className={`item-detail rar ${rarClass(selDef.rarity)}`} data-detail-id={sel.id}>
        <span className="gem" aria-hidden="true" />
        <div className="item-detail-art">{icon ? <img src={icon} alt={name} /> : null}</div>
        <div className="item-detail-body">
          <div className="item-detail-name-row">
            <span className="item-detail-nm">{name}</span>
            <span className="rar-word">{selDef.rarity}</span>
          </div>
          <div className="item-detail-meta">{meta}</div>
          {eff ? <div className="item-detail-eff">{eff}</div> : null}
          {flavor ? <div className="item-detail-flavor">{flavor}</div> : null}
        </div>
      </div>
    );
  };

  const renderCard = (
    kind: Selection['kind'],
    id: string,
    def: ItemDef | SIDef,
    subLead: string,
    meta: string
  ) => {
    const name = localized(def, 'name', locale);
    const icon = iconDataUrl(def.icon);
    const isSel = sel !== null && sel.kind === kind && sel.id === id;
    return (
      <li
        key={id}
        className={`icard rar ${rarClass(def.rarity)}${isSel ? ' is-selected' : ''}`}
        onClick={() => setSelected({ kind, id })}
        onMouseEnter={(e) => showTip(e, name, def.rarity, meta, effText(def, locale))}
        onMouseMove={moveTip}
        onMouseLeave={hideTip}
      >
        <span className="gem" aria-hidden="true" />
        <span className="icard-thumb">{icon ? <img src={icon} alt="" /> : null}</span>
        <span className="icard-main">
          <span className="icard-nm">{name}</span>
          <span className="icard-sub">
            {subLead} <span className="rar-word">{def.rarity}</span>
          </span>
        </span>
      </li>
    );
  };

  return (
    <aside className="item-panel panel ornate">
      <i className="k tl" />
      <i className="k tr" />
      <i className="k br" />
      <i className="k bl" />
      <div className="item-panel-body">
        {renderDetail()}
        <h2>{t(locale, 'itemPanel.items')}</h2>
        <ul className="item-list">
          {itemEntries.map(([id, def]) =>
            renderCard('item', id, def, `PO ・ ${shapeDims(def.shape)} ・ ${def.tags?.[0] ?? ''}`, itemMeta(def))
          )}
        </ul>
        <h2>{t(locale, 'itemPanel.socketItems')}</h2>
        <ul className="item-list">
          {siEntries.map(([id, def]) => renderCard('si', id, def, `SI ・ ${def.slot}`, siMeta(def)))}
        </ul>
      </div>
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
