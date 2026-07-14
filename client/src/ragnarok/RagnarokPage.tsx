// client/src/ragnarok/RagnarokPage.tsx -- REQ-0066. The Hall of Ragnarok
// route (#/ragnarok), 殿堂 / "Hall of Ragnarok". Mock NORMATIVE:
// web/redesign/ragnarok.html. Composes the hero + pledge (frozen verbatim
// from the mock), the season strip, the Eternal Order tablet, the
// Devotion rite section, and the Einherjar hall strip. Follows the same
// route-level component shape as WorkshopPage/MarketPage (fetch-on-mount,
// loading/error/t()), reads the SAME store facilities, and reuses
// MarketPage's EXACT race-guard mechanism (loadGame()).
//
// THE RACE GUARD (refreshAfterServerMutation, below): the Devotion rite
// rewrites the caller's canvas SERVER-side (squad slot deleted + every
// referenced item destroyed account-wide, directly in the DB) while this
// client holds an in-memory canvas whose debounced auto-save (~800ms,
// store/autosave.ts) would otherwise PUT a STALE pre-rite canvas back and
// resurrect the destroyed items (the REQ-0041 auto-save race class,
// called out verbatim in shared/dto.ts's ApiRagnarokDevotionResponse
// doc). We defuse it EXACTLY as MarketPage does: call the store's
// loadGame(), which re-GETs the fresh (already-rewritten) canvas and
// replaces state's own fields in place, THEN bumps stateVersion via
// notifyStateChanged() -- so any pending auto-save now PUTs the correct
// post-rite canvas, not the stale one. DevotionSection.confirm() AWAITS
// this before revealing the "engraved" success state.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '../store';
import { usePolledResource } from '../lib/usePolledResource';
import { loadGame, useGameStore } from '../store';
import { t } from '../i18n';
import {
  ApiError,
  fetchRagnarokSeason, fetchRagnarokOrder, fetchRagnarokEinherjar, fetchRagnarokDevotionPreview,
  type ApiRagnarokSeasonResponse, type ApiRagnarokOrderResponse, type ApiRagnarokEinherjarResponse,
  type ApiRagnarokDevotionPreviewResponse,
} from '../api';
import { SeasonStrip } from './SeasonStrip';
import { EternalOrderTable } from './EternalOrderTable';
import { DevotionSection, type SquadCandidate } from './DevotionSection';
import { Valknut, fmtNum, tierLabel } from './ragnarokShared';

interface RagnarokPageProps {
  locale: Locale;
}

/** Debounce for the find-by-name server query (ms). */
const SEARCH_DEBOUNCE_MS = 300;

export function RagnarokPage({ locale }: RagnarokPageProps) {
  const snapshot = useGameStore();

  const [order, setOrder] = useState<ApiRagnarokOrderResponse | null>(null);
  const [einherjar, setEinherjar] = useState<ApiRagnarokEinherjarResponse | null>(null);

  // Devotion candidate selection + its server preview (single source of
  // truth for BOTH the manifest and the me-row projection).
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [preview, setPreview] = useState<ApiRagnarokDevotionPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Find-by-name query (drives a server ?q= fetch, debounced).
  const [query, setQuery] = useState('');

  // Guard against setState after unmount / stale in-flight resolutions.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // Candidate squads from the live store (state.presets.names). This is
  // the CLIENT's list; eligibility per candidate is resolved lazily from
  // the server preview when one is selected.
  const candidates: SquadCandidate[] = useMemo(() => {
    const names = snapshot.state?.presets?.names;
    if (!names) return [];
    return names.map((name, index) => ({ index, name: name || `Squad ${index + 1}` }));
  }, [snapshot.state?.presets?.names, snapshot.stateVersion]);

  const loadOrder = useCallback(async (q?: string) => {
    // top-N + around=me always; ?q= only when searching. Server-paginated.
    const res = await fetchRagnarokOrder({ top: 8, around: 'me', ...(q && q.trim() ? { q: q.trim() } : {}) });
    if (aliveRef.current) setOrder(res);
  }, []);

  const loadEinherjar = useCallback(async () => {
    const res = await fetchRagnarokEinherjar();
    if (aliveRef.current) setEinherjar(res);
  }, []);

  // Initial load: season + order + einherjar together (REQ-0145b (cc):
  // rides usePolledResource's trackLoading mode -- loading starts true,
  // error cleared at load start, same composite Promise.all; `season`
  // is the hook's data, untouched on failure exactly as before).
  const { data: season, loading, error } = usePolledResource<ApiRagnarokSeasonResponse>(
    async () => {
      const [s] = await Promise.all([fetchRagnarokSeason(), loadOrder(), loadEinherjar()]);
      return s;
    },
    {
      trackLoading: true,
      formatError: (e) => t(locale, 'ragnarok.loadError') + (e instanceof Error ? e.message : String(e)),
    }
  );

  // Debounced find-by-name: refetch the order with ?q= whenever the query
  // changes (skips the very first mount, handled by the initial load).
  const firstQueryRef = useRef(true);
  useEffect(() => {
    if (firstQueryRef.current) { firstQueryRef.current = false; return; }
    const h = setTimeout(() => { void loadOrder(query).catch(() => {}); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [query, loadOrder]);

  // Fetch the preview for the selected candidate (drives manifest +
  // projection). A 404 here means the squad is unaddressable (already
  // devoted / out of range) -- surface it as an inline error.
  useEffect(() => {
    if (selectedIndex == null) { setPreview(null); setPreviewError(null); setPreviewLoading(false); return; }
    let alive = true;
    setPreviewLoading(true);
    setPreviewError(null);
    setPreview(null);
    (async () => {
      try {
        const res = await fetchRagnarokDevotionPreview(selectedIndex);
        if (alive && aliveRef.current) setPreview(res);
      } catch (e) {
        const status = e instanceof ApiError ? e.status : undefined;
        if (alive && aliveRef.current) setPreviewError(t(locale, status === 404 ? 'ragnarok.err.notFound' : 'ragnarok.err.generic'));
      } finally {
        if (alive && aliveRef.current) setPreviewLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [selectedIndex, locale, snapshot.stateVersion]);

  /** THE race guard. Called after a successful rite (awaited by
   * DevotionSection.confirm BEFORE it reveals 'engraved'). Re-GETs the
   * fresh canvas into the store FIRST (defusing the auto-save race), then
   * refreshes the order + hall (a new einherjar exists; the me-row's
   * einherjarCount moved -- though the ORDER standings themselves only
   * rebuild at the next dawn, the hall list is live).
   *
   * Deliberately does NOT clear selectedIndex/preview here (fixed
   * post-deploy E2E, 2026-07-07 -- this WAS here, "Clears the stale
   * selection/preview (the devoted squad slot is gone)"): this function
   * runs INSIDE DevotionSection.confirm(), awaited BEFORE it calls
   * setPhase('done'). DevotionSection has its own effect that resets
   * `phase` back to 'idle' whenever `selectedIndex` changes (its "picking
   * a new candidate starts fresh" rule) -- clearing the selection HERE
   * raced that effect against confirm()'s own setPhase('done'), and
   * whichever state update actually applied last won. When the reset
   * effect won, the engraved-modal never rendered at all: FULL RITE's own
   * e2e test caught this exact failure mode -- the hall list had already
   * updated with the new einherjar (proving the rite + this refresh both
   * genuinely succeeded), but the modal never appeared and the picker
   * silently fell back to its unselected state. closeDone()
   * (DevotionSection.tsx) already clears the selection itself, at the
   * CORRECT time -- once the user dismisses the modal -- via
   * onSelect(null); the selectedIndex-watching effect above
   * (`if (selectedIndex == null) { setPreview(null); ... }`) then clears
   * preview too, so nothing is lost by not duplicating either clear
   * here. */
  const refreshAfterServerMutation = useCallback(async () => {
    await loadGame(); // <-- fresh canvas GET -> store field replacement (defuses the auto-save race)
    await Promise.all([loadOrder(query).catch(() => {}), loadEinherjar().catch(() => {})]);
  }, [loadOrder, loadEinherjar, query]);

  // ---- HUD chip (header) values ----
  const derived = season?.derived ?? null;
  const seasonName = season?.season ? (locale === 'ja' ? season.season.name : season.season.nameEn || season.season.name) : null;

  if (loading) {
    return <div className="ragnarok-page" data-testid="ragnarok-page"><div className="ragnarok-loading" data-testid="ragnarok-loading">{t(locale, 'ragnarok.loading')}</div></div>;
  }
  if (error || !season || !order) {
    return <div className="ragnarok-page" data-testid="ragnarok-page"><div className="ragnarok-error" data-testid="ragnarok-error">{error || t(locale, 'ragnarok.loadError')}</div></div>;
  }

  const meTierLabel = tierLabel(locale, order.me.tier);

  return (
    <div className="ragnarok-page" data-testid="ragnarok-page">
      <div className="ragnarok-bgart" />

      {/* HUD chip strip -- order rank + tier, season + countdown. The
          season chip carries the same no-urgency number as the strip. */}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end', margin: '0 0 4px' }}>
        <span className="chip" data-testid="ragnarok-hud-rank">
          <span className="rune" style={{ color: 'var(--gold)' }}>ᛏ</span>{' '}
          {order.me.rank != null
            ? t(locale, 'ragnarok.hud.rank', { rank: fmtNum(order.me.rank), tier: meTierLabel })
            : t(locale, 'ragnarok.hud.rankUnranked', { tier: meTierLabel })}
        </span>
        <span className="chip" data-testid="ragnarok-hud-season">
          <span className="rune" style={{ color: 'var(--gold)' }}>ᛃ</span>{' '}
          {season.season && derived
            ? t(locale, 'ragnarok.hud.season', { index: season.season.index, name: seasonName || '', days: derived.daysToRagnarok })
            : t(locale, 'ragnarok.hud.seasonNone')}
        </span>
      </div>

      {/* ============ HERO ============ */}
      <section className="ragnarok-hero">
        <svg className="ragnarok-hero-mark" viewBox="0 0 100 84" fill="none" stroke="#C9A959" strokeWidth={3.4} strokeLinecap="round" aria-hidden="true">
          <path d="M50 12 a23 23 0 1 1 -20 34" />
          <path d="M69 27 a23 23 0 1 1 -33 27" />
          <path d="M31 27 a23 23 0 1 0 33 27" />
        </svg>
        <h1 className="ragnarok-hero-t">{t(locale, 'ragnarok.title')}</h1>
        <div className="ragnarok-hero-en">{t(locale, 'ragnarok.kicker')}</div>
        <blockquote className="ragnarok-pledge">
          {t(locale, 'ragnarok.pledge')}
          <cite>{t(locale, 'ragnarok.pledge.cite')}</cite>
        </blockquote>
      </section>

      {/* ============ SEASON STRIP ============ */}
      <SeasonStrip locale={locale} data={season} />

      <div className="rune-divider">ᛏ</div>

      {/* ============ ETERNAL ORDER ============ */}
      <EternalOrderTable
        locale={locale}
        order={order}
        projection={preview && preview.eligible ? preview.projection : null}
        query={query}
        onQueryChange={setQuery}
      />

      <div className="rune-divider">ᚷ</div>

      {/* ============ DEVOTION RITE ============ */}
      <DevotionSection
        locale={locale}
        candidates={candidates}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        preview={preview}
        previewLoading={previewLoading}
        previewError={previewError}
        onDevoted={refreshAfterServerMutation}
      />

      <div className="rune-divider">ᛗ</div>

      {/* ============ EINHERJAR HALL STRIP ============ */}
      <section data-testid="ragnarok-hall">
        <div className="row" style={{ gap: 14 }}>
          <h3 className="dj" style={{ margin: 0, fontSize: 17, fontWeight: 800, letterSpacing: '.22em' }}>{t(locale, 'ragnarok.hall.title')}</h3>
          <span className="en">{t(locale, 'ragnarok.hall.titleEn')}</span>
        </div>
        {einherjar && einherjar.einherjar.length > 0 ? (
          <div className="ragnarok-halls" data-testid="ragnarok-hall-strip">
            {einherjar.einherjar.map((e) => (
              <div className="ragnarok-mini rar rar-mythic" data-testid="ragnarok-hall-card" data-einherjar-id={e.id} key={e.id}>
                <span className="gem" />
                <Valknut size={20} className="ragnarok-valknut" />
                <div className="ragnarok-m-name">{e.squadName}</div>
                <div className="ragnarok-m-sub">
                  {t(locale, 'ragnarok.hall.season', { season: e.seasonDevoted ?? '—' })} ・ {t(locale, 'ragnarok.hall.score')} {fmtNum(e.score)}
                </div>
                <div className="ragnarok-m-ever">{t(locale, 'ragnarok.hall.ever')}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="ragnarok-hall-empty" data-testid="ragnarok-hall-empty">{t(locale, 'ragnarok.hall.empty')}</div>
        )}
      </section>

      <footer className="ragnarok-foot">{t(locale, 'ragnarok.foot')}</footer>
    </div>
  );
}
