// client/src/dex/DexCardWindow.tsx -- REQ-0052: Dex Card API + In-App
// Subwindow System (Half 2 -- the client subwindow; Half 1 is
// server/routes/dex.cjs).
//
// <DexCardProvider> mounts ONCE at the app root (App.tsx) and exposes
// useDexCard() to any consumer that wants to pop open a read-only Dex
// card for an item/si/tm without navigating away from whatever page it
// is on -- board PO/SI long-press, the gacha result modal, warehouse
// rows, run-log entity mentions, and (wired in THIS pass) the Dex
// catalog's own preview trigger (Dex.tsx). Renders via a portal
// (react-dom's createPortal) directly onto document.body, exactly like
// every OTHER overlay in this app already does (board/inventorySlot.ts's
// portal, the workshop result modal) -- no new Pixi Application, no
// board involvement at all (standing "one Application per board,
// forever" lesson; this is plain DOM).
//
// Content composition: fetches the render-ready DTO from
// GET /api/dex/card/:kind/:id (client/src/api.ts's fetchDexCard) and
// renders it via ShapeGrid (the SAME shape-mounted-icon component the
// catalog grid / DexDetail / ItemDetailCard already use, per the
// project's "same math everywhere" rule -- render/itemCard.ts's
// composition math, which ShapeGrid itself wraps). This is a NEW
// presentational component (DexCardContent below), not a reuse of
// ItemDetailCard's existing JSX tree -- ItemDetailCard is keyed to a
// client-side-already-loaded DexEntry (kind:'po'|'si', full ApiContentPayload
// context for tag-tree rendering etc.), a materially different prop
// contract than this window's API-DTO-first, kind:'item'|'si'|'tm',
// zero-navigation-context shape. Sharing the LEAF rendering pieces
// (ShapeGrid, the rarity theme classes) while keeping the two
// containing components separate avoids forcing a risky contract change
// onto the existing full Dex page for this pass.
//
// Stack depth: capped at 2 (REQ-0052 spec: "a card may open one nested
// card, e.g. an SI from its host PO's card"). openCard() while already
// at the cap silently drops the OLDEST entry to make room for the new
// one, rather than refusing the open outright -- a nested-open action
// the user just took should always visibly succeed.
//
// Dismissal: ESC closes the TOPMOST card only (typical modal-stack UX,
// matches e.g. browser devtools/OS window stacking); clicking the scrim
// (anywhere outside every open card) closes ALL of them at once (a
// scrim click is "I'm done with this", not "pop one"). Each card's own
// ✕ button closes just itself via the same closeTop semantics when it
// is the topmost, or -- for a non-topmost card, which cannot currently
// happen since only the topmost is ever interactive per the stacked
// z-index -- is not reachable; documented rather than over-engineered
// for a depth-2 stack.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fetchDexCard } from '../api';
import type { ApiDexCardDto } from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { iconDataUrl, iconDims } from './dexIcons';
import { ShapeGrid } from './ShapeGrid';

export type DexCardKind = 'item' | 'si' | 'tm';

const MAX_STACK_DEPTH = 2; // REQ-0052 spec: nested open cap

interface CardStackEntry {
  kind: DexCardKind;
  id: string;
  status: 'loading' | 'ready' | 'error';
  card?: ApiDexCardDto;
  error?: string;
}

interface DexCardContextValue {
  /** Opens (kind, id) as a NEW top-level card, replacing whatever stack
   * currently exists -- the entry point every non-nested trigger (Dex
   * catalog preview, board long-press, warehouse rows, ...) uses. */
  openCard: (kind: DexCardKind, id: string) => void;
  /** Opens (kind, id) NESTED on top of the current stack (e.g. "view the
   * SI seated in this PO" from within an already-open card) -- capped at
   * MAX_STACK_DEPTH (drops the oldest entry to make room, see module
   * comment). Falls back to the same behavior as openCard when the
   * stack is currently empty (nothing to nest onto). */
  openNestedCard: (kind: DexCardKind, id: string) => void;
  closeAll: () => void;
}

const DexCardContext = createContext<DexCardContextValue | null>(null);

/** Hook for any consumer that wants to open a Dex card subwindow. Throws
 * if used outside <DexCardProvider> (mounted once at the app root, see
 * App.tsx) -- same "provider required" contract as any other React
 * context in this codebase. */
export function useDexCard(): DexCardContextValue {
  const ctx = useContext(DexCardContext);
  if (!ctx) throw new Error('useDexCard() called outside <DexCardProvider>');
  return ctx;
}

export function DexCardProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const [stack, setStack] = useState<CardStackEntry[]>([]);

  const openCard = useCallback((kind: DexCardKind, id: string) => {
    setStack([{ kind, id, status: 'loading' }]);
  }, []);

  const openNestedCard = useCallback((kind: DexCardKind, id: string) => {
    setStack((prev) => {
      if (prev.length === 0) return [{ kind, id, status: 'loading' }];
      const next = prev.length >= MAX_STACK_DEPTH ? prev.slice(prev.length - MAX_STACK_DEPTH + 1) : prev;
      return [...next, { kind, id, status: 'loading' }];
    });
  }, []);

  const closeAll = useCallback(() => setStack([]), []);
  const closeTop = useCallback(() => setStack((prev) => prev.slice(0, -1)), []);

  // Fetch any entry still in 'loading' status (a fresh push, or a
  // kind/id that changed). Keyed by stack length + the loading entries'
  // own (kind,id) via the dependency array below (a plain [stack]
  // dependency would also work but re-fires this effect on every status
  // transition churn; depending on the derived loading-keys string
  // avoids that).
  const loadingKey = stack
    .map((e, i) => (e.status === 'loading' ? `${i}:${e.kind}:${e.id}` : ''))
    .filter(Boolean)
    .join(',');
  useEffect(() => {
    if (!loadingKey) return;
    let cancelled = false;
    stack.forEach((entry, idx) => {
      if (entry.status !== 'loading') return;
      fetchDexCard(entry.kind, entry.id)
        .then((res) => {
          if (cancelled) return;
          setStack((prev) => {
            const cur = prev[idx];
            if (!cur || cur.kind !== entry.kind || cur.id !== entry.id || cur.status !== 'loading') return prev; // stale
            const copy = prev.slice();
            copy[idx] = { ...cur, status: 'ready', card: res.card };
            return copy;
          });
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setStack((prev) => {
            const cur = prev[idx];
            if (!cur || cur.status !== 'loading') return prev;
            const copy = prev.slice();
            copy[idx] = { ...cur, status: 'error', error: e instanceof Error ? e.message : String(e) };
            return copy;
          });
        });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingKey]);

  // ESC dismisses the TOPMOST card only (see module comment).
  useEffect(() => {
    if (stack.length === 0) return;
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') closeTop();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stack.length, closeTop]);

  const value: DexCardContextValue = { openCard, openNestedCard, closeAll };

  return (
    <DexCardContext.Provider value={value}>
      {children}
      {stack.length > 0
        ? createPortal(
            <div className="dexcard-scrim" data-testid="dexcard-scrim" onClick={closeAll}>
              {stack.map((entry, idx) => (
                <div
                  key={`${entry.kind}:${entry.id}:${idx}`}
                  className="dexcard-window panel ornate"
                  style={{ zIndex: 200 + idx, marginLeft: idx > 0 ? idx * 28 : 0, marginTop: idx > 0 ? idx * 28 : 0 }}
                  data-testid="dexcard-window"
                  onClick={(ev) => ev.stopPropagation()}
                >
                  <i className="k tl" />
                  <i className="k tr" />
                  <i className="k br" />
                  <i className="k bl" />
                  <DexCardContent entry={entry} locale={locale} onClose={closeTop} onOpenNested={openNestedCard} />
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </DexCardContext.Provider>
  );
}

function DexCardContent({
  entry,
  locale,
  onClose,
}: {
  entry: CardStackEntry;
  locale: Locale;
  onClose: () => void;
  onOpenNested: (kind: DexCardKind, id: string) => void;
}) {
  if (entry.status === 'loading') {
    return (
      <div className="dexcard-body dexcard-loading t-micro" data-testid="dexcard-loading">
        {t(locale, 'dexcard.loading')}
      </div>
    );
  }
  if (entry.status === 'error' || !entry.card) {
    return (
      <div className="dexcard-body dexcard-error" data-testid="dexcard-notfound">
        <div className="t-micro">{t(locale, 'dexcard.notFound')}</div>
        <button type="button" className="btn btn-ghost dexcard-close-btn" onClick={onClose}>
          {t(locale, 'dexcard.close')}
        </button>
      </div>
    );
  }
  const card = entry.card;
  const name = locale === 'ja' ? card.i18n?.ja?.name || card.name_ja || card.name : card.name;
  const flavor = locale === 'ja' ? card.i18n?.ja?.flavor || card.flavor_ja || card.flavor : card.flavor;
  const eff = locale === 'ja' ? card.eff_ja : card.eff_en;
  const icon = iconDataUrl(card.icon);
  const shape = card.shape && card.shape.length > 0 ? card.shape : ([[0, 0]] as Array<[number, number]>);

  return (
    <>
      <div className="dexcard-head">
        <span className={`rar-word rarity r-${card.rarity}`}>{card.rarity.toUpperCase()}</span>
        <span className="dexcard-name dname" data-testid="dexcard-name">
          {name}
        </span>
        <span className="dexcard-grow" />
        <button
          type="button"
          className="dexcard-close-btn"
          data-testid="dexcard-close-btn"
          onClick={onClose}
          aria-label={t(locale, 'dexcard.close')}
        >
          ✕
        </button>
      </div>
      <div className="dexcard-body">
        <div className="dexcard-fig">
          <ShapeGrid
            shape={shape}
            cellPx={28}
            iconUrl={icon}
            iconAlt={card.icon}
            iconDims={iconDims(card.icon)}
            iconStretch={card.stretch}
            iconAlign={card.align}
          />
        </div>
        <div className="dexcard-stats">
          {card.kind === 'si' && card.slot ? (
            <div className="dexcard-stat">
              <span className="dexcard-stat-k">{t(locale, 'dexcard.slot')}</span>
              <span>{card.slot}</span>
            </div>
          ) : null}
          {card.kind === 'tm' && card.short ? (
            <div className="dexcard-stat">
              <span className="dexcard-stat-k">{t(locale, 'dexcard.short')}</span>
              <span>{card.short}</span>
            </div>
          ) : null}
          {card.dismantle ? (
            <div className="dexcard-stat" data-testid="dexcard-dismantle-count">
              <span className="dexcard-stat-k">{t(locale, 'dexcard.dismantleCount')}</span>
              <span>{card.dismantle.count}</span>
            </div>
          ) : null}
          {card.dismantle ? (
            <div className="dexcard-stat" data-testid="dexcard-dismantle-suppression">
              <span className="dexcard-stat-k">{t(locale, 'dexcard.suppression')}</span>
              <span>{Math.round(card.dismantle.suppression * 100)}%</span>
            </div>
          ) : null}
          {eff ? (
            <div className="dexcard-eff" data-testid="dexcard-eff">
              {eff}
            </div>
          ) : null}
          {flavor ? <div className="dexcard-flavor">{flavor}</div> : null}
        </div>
      </div>
      <div className="dexcard-foot">
        <a className="dexcard-fulllink" data-testid="dexcard-fulllink" href={`#/dex/${encodeURIComponent(card.id)}`} onClick={onClose}>
          {t(locale, 'dexcard.viewFull')}
        </a>
      </div>
    </>
  );
}
