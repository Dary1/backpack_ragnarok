// Floating item tooltip panel -- REQ-0119.
//
// A single-tap on an item icon (a placed PO, an assembled blade, a seated
// or free-placed SI) on the canvas board or ANY inventory-page board floats
// this panel, styled to web/redesign/styleguide.html's tooltip anatomy. The
// CSS classes are .item-tip / .item-tip-* (index.css), a faithful copy of
// the mock's .tooltip / .tt-* rules under a NEW class name: index.css
// already owns a different, older `.tooltip` (ItemPanel.tsx's desktop hover
// tooltip), and reusing that class would collide -- see the note beside it.
//
// Mounted ONCE at App level (outside the route switch, like Header /
// InviteBanner) so it floats above every route and every board. Item icons
// "span multiple pages" (the canvas page, the inventory tabs, and the
// warehouse/expedition surfaces that reuse the same inventory BoardRenderer
// via a portal) -- hooking the tap inside BoardRenderer and rendering one
// app-level overlay covers them all with no per-page wiring.
//
// Content is resolved from the store's already-loaded ITEMS / SI_DEFS (name,
// rarity, tags, effect, flavor -- the same fields ItemPanel's detail card
// reads), the honest 1-based dex number (dexNo.ts's contract: a PO's ordinal
// in content.items; SIs carry none, so their No. chip is omitted), and the
// caller's own 分解値 -- the per-item dismantle COUNT from
// /api/dismantle/ledger, fetched once and cached module-side. The mock's
// "分解: ᚠ 120" is a placeholder rune amount with no backing datum here
// (dismantle yields a flat Weathervane; the engraved per-item number IS the
// 分解値 count, not a currency), so this shows the real count, exactly like
// the Dex / DismantlePanel.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { clearItemTip, getItemTip, subscribeItemTip } from './board/itemTip';
import { fetchDismantleLedger } from './api';
import { dexNoLabel } from './market/marketShared';
import type { ItemDef, Offset, SIDef } from './engine/engine.d.ts';
import { t } from './i18n';
import { useGameStore, type Locale } from './store';

/** JA-preferring localized string read (mirrors ItemPanel's own helper). */
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

/** Game rarity -> its theme ramp color (name is the rarity-colored element,
 * per the styleguide anatomy). Relic wears the LEGENDARY color, matching
 * ItemPanel's rarClass mapping. */
const RARITY_COLOR: Record<string, string> = {
  Common: 'var(--r-common)',
  Uncommon: 'var(--r-uncommon)',
  Rare: 'var(--r-rare)',
  Relic: 'var(--r-legend)',
};

/** WxH of an unrotated shape's bounding box (offsets engine-normalized to
 * non-negative [dr,dc], anchored at [0,0]). */
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

// Module-cached dismantle ledger (itemId -> dismantle count). The panel is
// read-only; the count only ever grows (via the Workshop dismantle flow, a
// different surface), so one fetch per app load suffices. A failed/absent
// fetch yields an empty map -> counts read 0 ("nothing engraved yet"),
// still honest.
let ledgerPromise: Promise<Map<string, number>> | null = null;
function loadLedger(): Promise<Map<string, number>> {
  if (!ledgerPromise) {
    ledgerPromise = fetchDismantleLedger()
      .then((r) => {
        const m = new Map<string, number>();
        for (const e of r.entries) m.set(e.itemId, e.dismantleCount);
        return m;
      })
      .catch(() => new Map<string, number>());
  }
  return ledgerPromise;
}

const GAP = 12; // px between the icon and the panel
const MARGIN = 8; // min px from any viewport edge

export function FloatingItemTip() {
  const tip = useSyncExternalStore(subscribeItemTip, getItemTip, getItemTip);
  const snapshot = useGameStore();
  const locale = snapshot.locale;
  const gameData = snapshot.gameData;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [ledger, setLedger] = useState<Map<string, number> | null>(null);

  // Load the dismantle ledger once, lazily, on the first tip.
  useEffect(() => {
    if (!tip || ledger) return;
    let alive = true;
    loadLedger().then((m) => {
      if (alive) setLedger(m);
    });
    return () => {
      alive = false;
    };
  }, [tip, ledger]);

  // Resolve the def for the shown item (tolerates a stale/unknown id).
  const def: ItemDef | SIDef | null =
    tip && gameData ? (tip.kind === 'po' ? gameData.ITEMS[tip.id] ?? null : gameData.SI_DEFS[tip.id] ?? null) : null;

  // Measure the rendered panel, then anchor it beside the icon, flipping
  // left if it would overflow the right edge and clamping into the viewport.
  // Reset to unmeasured whenever the target changes so no stale position
  // flashes (the panel renders hidden until `pos` is computed).
  useLayoutEffect(() => {
    if (!tip || !def) {
      setPos(null);
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const a = tip.anchor;
    let left = a.left + a.width + GAP;
    if (left + pw > vw - MARGIN) left = a.left - pw - GAP;
    left = Math.max(MARGIN, Math.min(left, vw - pw - MARGIN));
    let top = a.top;
    top = Math.max(MARGIN, Math.min(top, vh - ph - MARGIN));
    setPos({ left, top });
  }, [tip, def]);

  // Dismiss on Esc, or on a pointerdown outside the panel AND outside any
  // board canvas. A tap on another board item is a SWITCH (the board's own
  // pointerup re-publishes the tip), so canvas taps must not dismiss here;
  // an empty-board tap is dismissed by the board's own stage handler.
  useEffect(() => {
    if (!tip) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (el && el.closest && (el.closest('.item-tip') || el.closest('canvas.board-canvas'))) return;
      clearItemTip();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearItemTip();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [tip]);

  if (!tip || !def) return null;

  const name = localized(def, 'name', locale);
  const flavor = localized(def, 'flavor', locale);
  const eff = effText(def, locale);
  const rarity = def.rarity;
  const nameColor = RARITY_COLOR[rarity] ?? 'var(--bone)';

  // Tags line, fixed order per the styleguide anatomy:
  //   PO: RARITY ・ type ・ WxH ・ elements
  //   SI: RARITY ・ SI ・ slot ・ required-tags
  let tags: string;
  let dexNo: number | null = null;
  if (tip.kind === 'po') {
    const d = def as ItemDef;
    const type = d.tags?.[0] ?? '';
    const elements = (d.tags ?? []).slice(1).join(' ・ ');
    tags = [rarity.toUpperCase(), type, shapeDims(d.shape), elements].filter(Boolean).join(' ・ ');
    if (gameData) {
      // Honest dex number: a PO's 1-based ordinal in content.items, which
      // is exactly ITEMS' own key order (api.ts builds ITEMS by iterating
      // payload.items) -- the same value dexNo.ts's dexNoOf derives.
      const idx = Object.keys(gameData.ITEMS).indexOf(tip.id);
      dexNo = idx >= 0 ? idx + 1 : null;
    }
  } else {
    const d = def as SIDef;
    const reqs = d.reqTags && d.reqTags.length ? d.reqTags.join(' ・ ') : '';
    tags = [rarity.toUpperCase(), 'SI', d.slot, reqs].filter(Boolean).join(' ・ ');
  }

  const count = ledger?.get(tip.id) ?? 0;
  const sellParts = [`${t(locale, 'dexcard.dismantleCount')} ${count}`];
  if (dexNo != null) sellParts.push(t(locale, 'market.dexChip', { no: dexNoLabel(dexNo) }));
  const sell = sellParts.join(' ・ ');

  return (
    <div
      ref={panelRef}
      className="item-tip"
      role="tooltip"
      data-tip-kind={tip.kind}
      data-tip-id={tip.id}
      style={{
        left: pos ? pos.left : tip.anchor.left,
        top: pos ? pos.top : tip.anchor.top,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="item-tip-name" style={{ color: nameColor }}>
        {name}
      </div>
      <div className="item-tip-tags">{tags}</div>
      {eff
        ? eff
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, i) => (
              <div className="item-tip-stat" key={i}>
                {line}
              </div>
            ))
        : null}
      {flavor ? <div className="item-tip-flavor">{flavor}</div> : null}
      <div className="item-tip-sell">{sell}</div>
    </div>
  );
}
