// Canvas right-side inventory panel -- REQ-0140 (canvas-side-panel-parity).
//
// Ports the ratified MJOLNIR mock's (web/redesign/canvas.html) right region
// into the live canvas screen: an inventory list with filter chips + a
// selected-item detail card. At 1280x800 the live app wasted the region right
// of the board and pushed the inventory below the fold; this panel fills it.
//
// Design notes / decisions (conservative, recorded per REQ-0140):
//  - The Pixi InventoryBoard (drag SOURCE, always-mounted per REQ-0034) is
//    kept. This panel is an ADDITIVE React surface. At the compact canvas
//    layout (narrow viewport, styles/canvas.css media query) the wide Pixi
//    inventory column is hidden and THIS panel is the inventory; at the wide
//    E2E viewport both coexist, so existing inventory-board specs are
//    untouched.
//  - Drag from panel to board is preserved by driving the SAME framework-free
//    carry seam the boards use (board/drag.ts's startCarry/armCarry): a
//    pointerdown on a list row starts a 'po' carry whose origin is the PO's
//    own inventory page; the always-mounted canvas board's global pointermove
//    computes the drop + ghost and the shared window pointerup commits it
//    (drag.ts's ensurePointerUpWired). No BoardRenderer/drag.ts edit needed --
//    the engine + carry are consumed AS-IS (adapter only).
//  - Selection wiring is BOTH ways via board/canvasSelection.ts: a board tap
//    already publishes to board/itemTip; this panel mirrors that into the
//    selection channel (board -> panel highlight + detail), and a row click
//    sets it directly (panel -> board ring, drawn by CanvasSelectionOverlay).
//  - Distinct class names (.canvas-side-panel / .canvas-item-detail) so the
//    REQ-0114 assertions (no .item-panel / .item-detail catalog on this view)
//    still hold; the rarity-tinted row styling reuses the theme's existing
//    .item-list .icard / .rar-* primitives.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { iconDataUrl } from '../dex/dexIcons';
import type { ItemDef, Offset } from '../engine/engine.d.ts';
import { t } from '../i18n';
import { useGameStore, type Locale } from '../store';
import { armCarry, cancelCarry, getCarry, startCarry } from '../board/drag';
import { getItemTip, subscribeItemTip } from '../board/itemTip';
import { getCanvasSelection, setCanvasSelection, subscribeCanvasSelection } from './canvasSelection';
import { EffectLines, effTextOf } from './effectText';
import { CanvasEmptyState } from './CanvasEmptyState';

const FILTERS = ['all', 'weapon', 'element', 'link', 'relic'] as const;
type Filter = (typeof FILTERS)[number];

// Best-effort tag-keyword classification for the mock's chips. The engine's
// tag vocabulary is open content data, so these are substring heuristics over
// an item's own tags (never a reimplementation of any engine rule); the one
// deterministic filter, `relic`, keys off the closed rarity vocabulary.
const WEAPON_KEYS = ['weapon', 'sword', 'axe', 'dagger', 'blade', 'spear', 'bow', 'mace', 'hammer', 'shield', 'polearm', '武', '剣', '刀', '斧', '槍', '弓', '短', '盾', '鎚'];
const ELEMENT_KEYS = ['frost', 'ice', 'ember', 'fire', 'flame', 'shock', 'storm', 'venom', 'poison', 'holy', 'shadow', 'element', '霜', '焔', '氷', '炎', '雷', '毒', '光', '影', '属'];
const LINK_KEYS = ['link', 'connect', 'conduit', 'prism', 'relay', 'bond', '連結', '連結晶', 'リンク', '結'];

function matchesFilter(def: ItemDef, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'relic') return def.rarity === 'Relic' || (def.tags || []).some((tg) => String(tg).toLowerCase() === 'relic');
  const hay = (def.tags || []).join(' ').toLowerCase();
  const keys = filter === 'weapon' ? WEAPON_KEYS : filter === 'element' ? ELEMENT_KEYS : LINK_KEYS;
  return keys.some((k) => hay.includes(k.toLowerCase()));
}

/** JA-preferring localized string (mirrors ItemPanel/FloatingItemTip). */
function localized<T extends { name_ja?: string }>(d: T, field: keyof T, locale: Locale): string {
  if (locale === 'ja') {
    const jaKey = `${String(field)}_ja` as keyof T;
    const jaVal = d[jaKey];
    if (typeof jaVal === 'string' && jaVal) return jaVal;
  }
  const val = d[field];
  return typeof val === 'string' ? val : '';
}

/** Theme rarity-frame class for a game rarity (Relic wears LEGENDARY). */
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

/** WxH of an unrotated shape's bounding box. */
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

function filterLabel(f: Filter, locale: Locale): string {
  switch (f) {
    case 'all':
      return t(locale, 'canvas.filter.all');
    case 'weapon':
      return t(locale, 'canvas.filter.weapon');
    case 'element':
      return t(locale, 'canvas.filter.element');
    case 'link':
      return t(locale, 'canvas.filter.link');
    case 'relic':
      return t(locale, 'canvas.filter.relic');
  }
}

export function CanvasSidePanel({ locale }: { locale: Locale }) {
  const snapshot = useGameStore();
  const selection = useSyncExternalStore(subscribeCanvasSelection, getCanvasSelection, getCanvasSelection);
  const [filter, setFilter] = useState<Filter>('all');

  // board -> panel: mirror the floating item-tip's tapped item into the
  // shared selection so a board tap highlights the matching entry + detail.
  useEffect(() => {
    const sync = () => {
      const tip = getItemTip();
      if (tip) setCanvasSelection({ kind: tip.kind, id: tip.id });
    };
    return subscribeItemTip(sync);
  }, []);

  if (snapshot.status !== 'ready' || !snapshot.gameData || !snapshot.state) {
    return (
      <aside className="canvas-side-panel panel ornate" aria-label="inventory">
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />
        <div className="canvas-side-panel-body" />
      </aside>
    );
  }

  const { ITEMS } = snapshot.gameData;
  const state = snapshot.state;

  // Aggregate the player's inventory POs across all pages; each row carries
  // the page it lives on (the drag origin). SIs seat on POs, so they are not
  // free-standing rows here -- matches the mock's item list.
  const entries: { uid: string; id: string; page: number; def: ItemDef }[] = [];
  const pages = state.inv?.pages ?? [];
  for (let pg = 0; pg < pages.length; pg++) {
    for (const po of pages[pg].pos) {
      const def = ITEMS[po.id];
      if (!def) continue;
      entries.push({ uid: po.uid, id: po.id, page: pg, def });
    }
  }

  const visible = entries.filter((e) => matchesFilter(e.def, filter));

  // Detail: the shared selection, else the first visible/known entry so the
  // card is populated from first paint (like the mock). Resolves against
  // ITEMS -- a board-tapped placed item may not be in inventory but has a def.
  const displayId = selection?.id ?? visible[0]?.id ?? entries[0]?.id ?? null;
  const detailDef: ItemDef | null = displayId ? ITEMS[displayId] ?? null : null;
  const dexNo = displayId ? Object.keys(ITEMS).indexOf(displayId) + 1 : 0;

  const startDrag = (e: React.PointerEvent<HTMLLIElement>, uid: string, page: number, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setCanvasSelection({ kind: 'po', id }); // pointerdown also selects (tap = select)
    const sx = e.clientX;
    const sy = e.clientY;
    startCarry({ kind: 'po', uid, originBoard: { loc: 'inv', page }, sx, sy, grabOff: [0, 0] });
    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 5) armCarry();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // A plain click (never armed) leaves a stale carry only if the shared
      // pointerup commit did not clear it; clear defensively.
      const c = getCarry();
      if (c && !c.armed) cancelCarry();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const renderDetail = () => {
    if (!detailDef || !displayId) return null;
    const icon = iconDataUrl(detailDef.icon);
    const name = localized(detailDef, 'name', locale);
    const flavor = localized(detailDef, 'flavor', locale);
    const eff = effTextOf(detailDef, locale);
    const meta = `PO ・ ${shapeDims(detailDef.shape)} ・ ${(detailDef.tags || []).join(' ・ ')}`;
    return (
      <div className={`canvas-item-detail rar ${rarClass(detailDef.rarity)}`} data-detail-id={displayId}>
        <span className="gem" aria-hidden="true" />
        <div className="canvas-item-detail-art">{icon ? <img src={icon} alt={name} /> : null}</div>
        <div className="canvas-item-detail-body">
          <div className="canvas-item-detail-name-row">
            <span className="canvas-item-detail-nm">{name}</span>
            <span className="rar-word">{detailDef.rarity}</span>
          </div>
          <div className="canvas-item-detail-meta">{meta}</div>
          {eff ? (
            <div className="canvas-item-detail-eff">
              <EffectLines text={eff} />
            </div>
          ) : (
            <div className="canvas-item-detail-eff canvas-item-detail-eff-empty">{t(locale, 'canvas.detail.noEffect')}</div>
          )}
          {flavor ? <div className="canvas-item-detail-flavor">{flavor}</div> : null}
          {dexNo > 0 ? (
            <div className="canvas-item-detail-dexno t-micro tnum">
              {t(locale, 'canvas.detail.dexNo', { no: String(dexNo).padStart(3, '0') })}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <aside className="canvas-side-panel panel ornate" aria-label="inventory">
      <i className="k tl" />
      <i className="k tr" />
      <i className="k br" />
      <i className="k bl" />
      <div className="canvas-side-panel-body">
        {renderDetail()}
        <div className="canvas-inv-filters" role="group" aria-label="filters">
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f}
              className={`chip canvas-inv-filter${filter === f ? ' is-on' : ''}`}
              data-filter={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {filterLabel(f, locale)}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <CanvasEmptyState variant="empty-inventory" locale={locale} />
        ) : (
          <ul className="item-list canvas-inv-list">
            {visible.map((e) => {
              const isSel = displayId === e.id;
              const name = localized(e.def, 'name', locale);
              const icon = iconDataUrl(e.def.icon);
              const sub = `PO ・ ${shapeDims(e.def.shape)} ・ ${e.def.tags?.[0] ?? ''}`;
              return (
                <li
                  key={e.uid}
                  className={`icard rar ${rarClass(e.def.rarity)}${isSel ? ' is-selected' : ''}`}
                  data-inv-uid={e.uid}
                  data-inv-id={e.id}
                  onPointerDown={(ev) => startDrag(ev, e.uid, e.page, e.id)}
                >
                  <span className="gem" aria-hidden="true" />
                  <span className="icard-thumb">{icon ? <img src={icon} alt="" /> : null}</span>
                  <span className="icard-main">
                    <span className="icard-nm">{name}</span>
                    <span className="icard-sub">
                      {sub} <span className="rar-word">{e.def.rarity}</span>
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
