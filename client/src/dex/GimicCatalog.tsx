// client/src/dex/GimicCatalog.tsx -- REQ-0211: the Dex "Gimics" tab.
//
// gimic/1 (trap / treasure box / hidden door) as a first-class catalog kind.
// Data is /api/content's `gimics` + `gimic_skills` sections -- the display
// slice of the SAME registry-first payload the dungeon generator places from
// (see server/lib/content.cjs gimicsFromCore), so this wiki can never show a
// gimic the dungeon would not spawn. Full-display posture, mirroring the
// Monsters tab (REQ-0208): name, behavior, engine subtype/mode, hp, footprint,
// timeout, skills (localized through gimic_skills), adopted art.
//
// A gimic has NO rarity (unlike enemy/1), so the catalog filters by `behavior`
// (trap / treasure / hidden_door) instead, and the ornate frame is themed off
// the behavior rather than a rarity ramp.
//
// Art: gimic ids ride the payload's art_urls map (exact-name adopted artwork --
// the same convention monster art uses), read through the shared getItemArtUrl()
// chain. An absent id is a NORMAL state (files backend / not yet adopted): the
// rune placeholder shows instead.
import { useEffect, useMemo, useState } from 'react';
import type { ApiGimicEntry, ApiSkillName } from '../../../shared/dto';
import { getItemArtUrl } from '../board/itemArt';
import { t, type TranslationKey } from '../i18n';
import type { Locale } from '../store';
import { SectionHead } from './DexDetail';
import { RegistryBadge } from './RegistryBadge';

interface GimicCatalogProps {
  locale: Locale;
  gimics: Record<string, ApiGimicEntry>;
  skillNames: Record<string, ApiSkillName>;
  /** REQ-0211: one-shot '#/dex/<id>' deep-link target (see Dex.tsx's
   * cross-tab routing of dexFocusId). Consumed, then reported back. */
  focusId?: string | null;
  onFocusConsumed?: () => void;
}

function gimicName(g: ApiGimicEntry, locale: Locale): string {
  if (locale === 'ja') return g.i18n?.ja?.name || g.name_ja || g.name;
  return g.name;
}
function footprintText(g: ApiGimicEntry): string {
  const fp = Array.isArray(g.footprint) ? g.footprint : null;
  return fp ? `${fp[0]}×${fp[1]}` : '—';
}
const BEHAVIOR_KEY: Record<string, TranslationKey> = {
  trap: 'dex.behaviorTrap',
  treasure: 'dex.behaviorTreasure',
  hidden_door: 'dex.behaviorHiddenDoor',
};
function behaviorLabel(locale: Locale, behavior: string): string {
  const k = BEHAVIOR_KEY[behavior];
  return k ? t(locale, k) : behavior;
}
/** No rarity ramp -- the behavior drives the ornate frame accent so the three
 * families read apart at a glance (treasure = gold/legend, trap = rare, hidden
 * door = epic). Unknown behaviors fall to the common frame. */
function behaviorTheme(behavior: string): string {
  switch (behavior) {
    case 'treasure':
      return 'rar-legend';
    case 'trap':
      return 'rar-rare';
    case 'hidden_door':
      return 'rar-epic';
    default:
      return 'rar-common';
  }
}

function GimicPortrait({ gimic, large }: { gimic: ApiGimicEntry; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [gimic.id]);
  const url = getItemArtUrl(gimic.id);
  return (
    <span className={`dex-portrait-well${large ? ' dex-portrait-well-lg' : ''}`}>
      <span className="dex-art-fallback rune" aria-hidden="true">
        ᛥ
      </span>
      {url && !failed ? (
        <img
          className="dex-portrait-img"
          src={url}
          alt={gimic.name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

function GimicDetail({
  gimic,
  locale,
  skillNames,
}: {
  gimic: ApiGimicEntry;
  locale: Locale;
  skillNames: Record<string, ApiSkillName>;
}) {
  const skillLabel = (sk: string): string => {
    const nm = skillNames[sk];
    if (!nm) return sk;
    return (locale === 'ja' ? nm.name_ja : undefined) || nm.name || sk;
  };
  return (
    <div className="dex-detail-drawer-panes">
      <article
        className={`dex-detail-panel panel ornate rar ${behaviorTheme(gimic.behavior)}`}
        data-testid="dex-gimic-detail"
      >
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />

        <header className="dex-detail-masthead">
          <div className="dex-detail-namehead">
            <h3 className="dex-detail-name dj">{gimicName(gimic, locale)}</h3>
            <span className="dex-detail-enname den">{gimic.name.toUpperCase()}</span>
          </div>
          <div className="dex-detail-chiprow">
            <span className={`chip dex-gimic-behavior gimic-b-${gimic.behavior}`}>{behaviorLabel(locale, gimic.behavior)}</span>
            <span className="chip dex-detail-kindchip">GIMIC</span>
            <span className="dex-detail-field-id">
              <span className="dex-detail-label">id</span> {gimic.id}
            </span>
            {gimic.type ? <span className="chip dex-detail-tagchip">{gimic.type}</span> : null}
          </div>
        </header>

        <section className="dex-detail-col-portrait">
          <SectionHead rune="ᛥ" title={t(locale, 'dex.portraitTitle')} den={t(locale, 'dex.portraitDen')} />
          <GimicPortrait gimic={gimic} large />
        </section>

        <div className="rune-divider dex-detail-section-divider" aria-hidden="true">
          ᛁ
        </div>

        <section className="dex-detail-col-info">
          <SectionHead rune="ᛥ" title={t(locale, 'dex.gimicStatsTitle')} den={t(locale, 'dex.gimicStatsDen')} />
          <dl className="dex-monster-stats dex-gimic-stats">
            <div className="dex-monster-statrow">
              <dt>{t(locale, 'dex.behaviorLabel')}</dt>
              <dd>{behaviorLabel(locale, gimic.behavior)}</dd>
            </div>
            {gimic.mode ? (
              <div className="dex-monster-statrow">
                <dt>{t(locale, 'dex.modeLabel')}</dt>
                <dd>{gimic.mode}</dd>
              </div>
            ) : null}
            <div className="dex-monster-statrow">
              <dt>{t(locale, 'dex.hpLabel')}</dt>
              <dd className="tnum">{gimic.hp != null ? gimic.hp : '—'}</dd>
            </div>
            <div className="dex-monster-statrow">
              <dt>{t(locale, 'dex.footprintLabel')}</dt>
              <dd className="tnum">{footprintText(gimic)}</dd>
            </div>
            {gimic.timeout_secs != null ? (
              <div className="dex-monster-statrow">
                <dt>{t(locale, 'dex.timeoutLabel')}</dt>
                <dd className="tnum">{gimic.timeout_secs}s</dd>
              </div>
            ) : null}
          </dl>
          {(gimic.skills || []).length > 0 ? (
            <div className="dex-monster-skills">
              <span className="dex-detail-label">{t(locale, 'dex.skillsLabel')}</span>
              {(gimic.skills || []).map((sk) => (
                <span key={sk} className="chip dex-monster-skillchip" title={sk}>
                  {skillLabel(sk)}
                </span>
              ))}
            </div>
          ) : null}
          <RegistryBadge systemName={gimic.id} />
        </section>
      </article>
    </div>
  );
}

export function GimicCatalog({ locale, gimics, skillNames, focusId, onFocusConsumed }: GimicCatalogProps) {
  const entries = useMemo(() => Object.values(gimics), [gimics]);
  const [query, setQuery] = useState('');
  const [behaviorFilter, setBehaviorFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(() => entries[0]?.id ?? null);

  useEffect(() => {
    if (!focusId) return;
    if (entries.some((g) => g.id === focusId)) setSelectedId(focusId);
    onFocusConsumed?.();
  }, [focusId, entries, onFocusConsumed]);

  const behaviors = useMemo(() => Array.from(new Set(entries.map((g) => g.behavior))).sort(), [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((g) => {
      if (behaviorFilter && g.behavior !== behaviorFilter) return false;
      if (q) {
        const hay = [g.id, g.name, g.name_ja || '', g.i18n?.ja?.name || '', g.behavior].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, query, behaviorFilter]);

  useEffect(() => {
    setSelectedId((cur) => (cur && filtered.some((g) => g.id === cur) ? cur : filtered[0]?.id ?? null));
  }, [filtered]);

  const selected = useMemo(() => filtered.find((g) => g.id === selectedId) ?? null, [filtered, selectedId]);

  return (
    <div className="dex-md">
      <div className="dex-md-list">
        <div className="dex-colhead">
          <span className="dex-colhead-rn rune">ᛥ</span>
          <h2 className="dj dex-colhead-title">{t(locale, 'dex.gimicCatalogTitle')}</h2>
          <span className="den dex-colhead-den">{t(locale, 'dex.gimicCatalogDen')}</span>
          <span className="dex-colhead-grow" />
          <span className="t-micro">{t(locale, 'dex.gimicCatalogNote')}</span>
        </div>

        <div className="dex-controls">
          <input
            type="text"
            className="dex-search"
            placeholder={t(locale, 'dex.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="dex-filter" value={behaviorFilter} onChange={(e) => setBehaviorFilter(e.target.value)}>
            <option value="">{t(locale, 'dex.behaviorAll')}</option>
            {behaviors.map((b) => (
              <option key={b} value={b}>
                {behaviorLabel(locale, b)}
              </option>
            ))}
          </select>
          <span className="dex-count">
            {filtered.length} / {entries.length}
          </span>
        </div>

        <div className="dex-grid dgrid">
          {filtered.map((g) => {
            const isSel = g.id === selectedId;
            return (
              <div
                key={g.id}
                className={`dex-card dex-gimic-card dcard rar ${behaviorTheme(g.behavior)}${isSel ? ' dex-card-selected' : ''}`}
              >
                <button
                  type="button"
                  className="dex-card-summary dcard-btn"
                  aria-pressed={isSel}
                  onClick={() => setSelectedId(g.id)}
                >
                  <span className="gem" aria-hidden="true" />
                  <span className="dex-card-no dex-card-no-kind t-micro">GIM</span>
                  <span className="dex-card-shape dthumb">
                    <GimicPortrait gimic={g} />
                  </span>
                  <div className="dex-card-summary-text">
                    <div className="dex-card-name dname">{gimicName(g, locale)}</div>
                    <div className="dex-card-sub dsub">
                      <span className="dex-card-cat">{behaviorLabel(locale, g.behavior)}</span>
                      <span className="dex-card-enname">{g.name.toUpperCase()}</span>
                    </div>
                    <div className="dex-card-meta dfoot">
                      <span className={`chip dex-gimic-behavior gimic-b-${g.behavior}`}>{behaviorLabel(locale, g.behavior)}</span>
                      <span className="dex-card-id">{g.id}</span>
                      <span className="dex-card-kind">
                        HP {g.hp != null ? g.hp : '—'} ・ {footprintText(g)}
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
          {filtered.length === 0 ? <div className="dex-empty">{t(locale, 'dex.noMatch')}</div> : null}
        </div>
      </div>

      <div className="dex-md-detail" data-testid="dex-detail-pane">
        {selected ? (
          <GimicDetail gimic={selected} locale={locale} skillNames={skillNames} />
        ) : (
          <div className="dex-detail-empty">{t(locale, 'dex.detailEmpty')}</div>
        )}
      </div>
    </div>
  );
}
