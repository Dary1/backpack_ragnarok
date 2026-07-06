// client/src/ragnarok/EternalOrderTable.tsx -- REQ-0066. The stone-tablet
// ranking from web/redesign/ragnarok.html: the tier chip row, the top-N
// table with the gap row and the always-present me-row, find-by-name
// search, and the pending-devotion projection line ("+2% (予測)").
//
// Data is GET /api/ragnarok/order (server-paginated: top-N + around=me +
// find-by-name; NEVER fetch the whole 12k+ table client-side). Tier
// thresholds come from the response's `tiers` array -- NOT hardcoded
// (REQ-0066: "read them from the API"). VALHALLA is rendered in the chip
// row (client-side horizon) but the server never assigns it, so no row is
// ever tagged VALHALLA.
//
// REQ-0067 items honored: the projection is ALWAYS labeled a forecast
// (「予測」 + a tooltip), never stated as fact (item 8); the me-row is
// always present even when unranked (rank null -> "not yet in the stone",
// item 2 empty state); an entirely-empty Order renders an explicit
// "be the first" state rather than a blank table.
import { useMemo } from 'react';
import type { Locale } from '../store';
import { t } from '../i18n';
import type { ApiRagnarokOrderEntry, ApiRagnarokOrderResponse, ApiRagnarokProjection, ApiRagnarokTier } from '../api';
import { emblemSrc, fmtNum, tierLabel, TIER_LADDER, RAGNAROK_RUNE } from './ragnarokShared';

function rowClass(rank: number | null): string {
  if (rank === 1) return 'top1';
  if (rank === 2) return 'top2';
  if (rank === 3) return 'top3';
  return '';
}

function OrderRow({ entry }: { entry: ApiRagnarokOrderEntry }) {
  return (
    <tr
      className={rowClass(entry.rank)}
      data-testid="ragnarok-order-row"
      data-player-id={entry.playerId}
      data-rank={entry.rank ?? ''}
    >
      <td><span className="num">{entry.rank != null ? fmtNum(entry.rank) : '—'}</span></td>
      <td><span className="sg"><img src={emblemSrc(entry.emblem)} alt="" /></span></td>
      <td><span className="nm">{entry.name}</span></td>
      <td className="ein">{fmtNum(entry.einherjarCount)}</td>
      <td className="sc">{fmtNum(entry.score)}</td>
    </tr>
  );
}

interface EternalOrderTableProps {
  locale: Locale;
  order: ApiRagnarokOrderResponse;
  /** The live preview projection for the currently-selected devotion
   * candidate, if any -- drives the me-row's "+ this devotion" forecast
   * line. Null when no eligible candidate is selected. */
  projection: ApiRagnarokProjection | null;
  /** Find-by-name search state (lifted to the page so it can drive the
   * server query). */
  query: string;
  onQueryChange: (q: string) => void;
}

export function EternalOrderTable({ locale, order, projection, query, onQueryChange }: EternalOrderTableProps) {
  const { top, me, total, matches } = order;
  const activeTier: ApiRagnarokTier = me.tier;

  // The projection as a forecast string. topPercentile is "you would
  // stand within the top N%" -- the DTO field that is actually defined
  // pre-REQ-0068 (raw score gain is undefined while every score is 0). We
  // surface it as the me-row forecast, ALWAYS labeled 予測 (REQ-0067 #8).
  const projLine = useMemo(() => {
    if (!projection || projection.topPercentile == null) return null;
    return `top ${projection.topPercentile}%`;
  }, [projection]);

  // Whether the me-row is already inside the shown top slice (avoid
  // duplicating it below the gap when the caller is, say, rank 2).
  const meInTop = me.rank != null && top.some((e) => e.playerId === me.playerId);
  const showGapAndMe = !meInTop;

  const isSearching = query.trim() !== '';
  const orderEmpty = total === 0;

  const cols = (
    <thead>
      <tr>
        <th style={{ width: 64 }}>{t(locale, 'ragnarok.order.colRank')}</th>
        <th style={{ width: 44 }}>{t(locale, 'ragnarok.order.colEmblem')}</th>
        <th>{t(locale, 'ragnarok.order.colName')}</th>
        <th style={{ width: 130, textAlign: 'right' }}>{t(locale, 'ragnarok.order.colEinherjar')}</th>
        <th style={{ width: 140, textAlign: 'right' }}>{t(locale, 'ragnarok.order.colScore')}</th>
      </tr>
    </thead>
  );

  return (
    <section className="panel ornate mat-stone tablet ragnarok-tablet" data-testid="ragnarok-order">
      <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <h2 className="dj">{t(locale, 'ragnarok.order.title')}</h2>
        <span className="en">{t(locale, 'ragnarok.order.titleEn')}</span>
        <span className="chip">{t(locale, 'ragnarok.order.subtitle')}</span>
        <span className="grow" />
        <span className="t-micro" data-testid="ragnarok-order-engraved">{t(locale, 'ragnarok.order.engraved', { n: fmtNum(total) })}</span>
      </div>

      {/* tier chip row -- thresholds are from the API (order.tiers), not
          hardcoded; the caller's active tier is lit. */}
      <div className="ragnarok-tier-row" data-testid="ragnarok-tier-row">
        {TIER_LADDER.map((tier, i) => {
          const isValhalla = tier === 'VALHALLA';
          const on = tier === activeTier;
          const mythic = tier === 'EINHERJAR';
          const cls = ['chip', 'ragnarok-tier-chip', on ? 'is-on' : '', mythic ? 'chip-myth' : '', isValhalla ? 'chip-valhalla' : ''].filter(Boolean).join(' ');
          return (
            <span key={tier} style={{ display: 'contents' }}>
              {i > 0 ? <span className="ragnarok-tier-sep">→</span> : null}
              <span className={cls} data-testid={`ragnarok-tier-${tier}`} data-active={on ? 'true' : 'false'}>
                <span className="rune" style={{ color: on || mythic ? 'var(--gold)' : 'var(--bone-3)' }}>{RAGNAROK_RUNE}</span> {tierLabel(locale, tier)}
              </span>
            </span>
          );
        })}
      </div>

      {/* find-by-name search (server query; ?q=) */}
      <div className="ragnarok-order-search">
        <input
          type="text"
          value={query}
          placeholder={t(locale, 'ragnarok.order.searchPlaceholder')}
          onChange={(e) => onQueryChange(e.target.value)}
          data-testid="ragnarok-order-search"
          aria-label={t(locale, 'ragnarok.order.searchPlaceholder')}
        />
        {isSearching ? (
          <button type="button" className="btn btn-ghost" onClick={() => onQueryChange('')} data-testid="ragnarok-order-search-clear">
            {t(locale, 'ragnarok.order.searchClear')}
          </button>
        ) : null}
      </div>

      {isSearching ? (
        // Search results view: server matches (capped at top). Me-row is
        // NOT appended here -- this is a lookup, not the standings.
        <div className="ragnarok-tscroll">
          <div className="ragnarok-affected-title">{t(locale, 'ragnarok.order.searchTitle')}</div>
          {matches && matches.length > 0 ? (
            <table className="ragnarok-rk">
              {cols}
              <tbody data-testid="ragnarok-search-results">
                {matches.map((e) => <OrderRow key={e.playerId} entry={e} />)}
              </tbody>
            </table>
          ) : (
            <div className="ragnarok-order-empty" data-testid="ragnarok-search-none">{t(locale, 'ragnarok.order.searchNone')}</div>
          )}
        </div>
      ) : (
        <div className="ragnarok-tscroll">
          <table className="ragnarok-rk">
            {cols}
            <tbody>
              {orderEmpty ? (
                <tr><td colSpan={5}><div className="ragnarok-order-empty" data-testid="ragnarok-order-empty">{t(locale, 'ragnarok.order.empty')}</div></td></tr>
              ) : (
                top.map((e) => <OrderRow key={e.playerId} entry={e} />)
              )}

              {/* gap row + me-row: always show the me-row (even when
                  unranked -- rank null), below a gap, unless the caller is
                  already visible in the top slice. */}
              {showGapAndMe ? (
                <>
                  <tr className="gap"><td colSpan={5}>⋯</td></tr>
                  <tr
                    className="me"
                    data-testid="ragnarok-me-row"
                    data-player-id={me.playerId}
                    data-rank={me.rank ?? ''}
                    data-unranked={me.rank == null ? 'true' : 'false'}
                  >
                    <td><span className="num">{me.rank != null ? fmtNum(me.rank) : '—'}</span></td>
                    <td><span className="sg"><img src={emblemSrc(me.emblem)} alt="" /></span></td>
                    <td>
                      <span className="ragnarok-me-you">{t(locale, 'ragnarok.order.you')}</span>
                      <span className="nm">{me.name}</span>
                      {me.rank == null ? <div className="t-micro" data-testid="ragnarok-me-unranked">{t(locale, 'ragnarok.order.unranked')}</div> : null}
                    </td>
                    <td className="ein">{fmtNum(me.einherjarCount)}</td>
                    <td className="sc">
                      <span data-testid="ragnarok-me-score">{fmtNum(me.score)}</span>
                      {projLine ? (
                        <div className="ragnarok-proj" data-testid="ragnarok-me-projection">
                          <span className="forecast-tag" title={t(locale, 'ragnarok.order.forecastTip')} data-testid="ragnarok-forecast-tag">
                            {t(locale, 'ragnarok.order.projection', { pct: projLine, forecast: t(locale, 'ragnarok.order.forecast') })}
                          </span>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                </>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
