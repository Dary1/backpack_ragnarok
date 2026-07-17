// client/src/dex/MonsterCatalog.tsx -- REQ-0208: the Dex "Monsters" tab.
//
// monster_def (the enemy/1 dialect) as a first-class catalog kind. Data is
// /api/content's `monsters` + `monster_skills` sections -- the display
// slice of the SAME registry-first payload the sim fights with (see
// server/lib/content.cjs monstersFromCore), so this wiki can never show a
// monster the battle would not serve. Full-display posture (user-ratified,
// REQ-0208): names, rarity, hp band, footprint, skills (localized through
// monster_skills), pack_role, adopted art.
//
// Art: monster ids ride the payload's art_urls map (exact-name adopted
// artwork -- REQ-0184/0188's convention), read through the SAME
// board/itemArt getItemArtUrl() chain every other art consumer uses. An
// absent id is a NORMAL state (files backend / portrait not yet adopted):
// the rune placeholder shows instead.
//
// Rarity: the enemy/1 dialect spells rarity LOWERCASE ('common'), while
// rarThemeClass and the .r-* word classes key on the capitalized app ramp
// -- so it is capitalized here for THEME lookups only; the data itself is
// displayed verbatim (uppercased for the rar-word, like every other card).
import { useEffect, useMemo, useState } from 'react';
import type { ApiMonsterEntry, ApiSkillName } from '../../../shared/dto';
import { getItemArtUrl } from '../board/itemArt';
import { t } from '../i18n';
import { rarThemeClass } from '../render/uiBits';
import type { Locale } from '../store';
import { SectionHead } from './DexDetail';
import { RegistryBadge } from './RegistryBadge';

interface MonsterCatalogProps {
  locale: Locale;
  monsters: Record<string, ApiMonsterEntry>;
  skillNames: Record<string, ApiSkillName>;
  /** REQ-0208: one-shot '#/dex/<id>' deep-link target (see Dex.tsx's
   * cross-tab routing of dexFocusId). Consumed, then reported back. */
  focusId?: string | null;
  onFocusConsumed?: () => void;
}

function monsterName(m: ApiMonsterEntry, locale: Locale): string {
  if (locale === 'ja') return m.i18n?.ja?.name || m.name_ja || m.name;
  return m.name;
}
/** enemy/1 rarity is lowercase; capitalize ONLY for theme-class lookups. */
function capRarity(r: string | undefined): string {
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : '';
}
function hpText(m: ApiMonsterEntry): string {
  const hp = Array.isArray(m.hp) ? m.hp : null;
  return hp ? `${hp[0]}–${hp[1]}` : '—';
}
function footprintText(m: ApiMonsterEntry): string {
  const fp = Array.isArray(m.footprint) ? m.footprint : null;
  return fp ? `${fp[0]}×${fp[1]}` : '—';
}

/** Portrait well: rune placeholder underneath, the adopted render (via the
 * art_urls chain) covering it when one exists. Same posture as the unit
 * portrait -- no adopted art is normal, never a broken-image glyph. */
function MonsterPortrait({ monster, large }: { monster: ApiMonsterEntry; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false); // the detail pane reuses one mounted node across selections
  }, [monster.id]);
  const url = getItemArtUrl(monster.id);
  return (
    <span className={`dex-portrait-well${large ? ' dex-portrait-well-lg' : ''}`}>
      <span className="dex-art-fallback rune" aria-hidden="true">
        ᛦ
      </span>
      {url && !failed ? (
        <img
          className="dex-portrait-img"
          src={url}
          alt={monster.name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}

function MonsterDetail({
  monster,
  locale,
  skillNames,
}: {
  monster: ApiMonsterEntry;
  locale: Locale;
  skillNames: Record<string, ApiSkillName>;
}) {
  const skillLabel = (sk: string): string => {
    const nm = skillNames[sk];
    if (!nm) return sk; // an unnamed skill id is still honest data
    return (locale === 'ja' ? nm.name_ja : undefined) || nm.name || sk;
  };
  return (
    <div className="dex-detail-drawer-panes">
      <article
        className={`dex-detail-panel panel ornate rar ${rarThemeClass(capRarity(monster.rarity))}`}
        data-testid="dex-monster-detail"
      >
        <i className="k tl" />
        <i className="k tr" />
        <i className="k br" />
        <i className="k bl" />

        <header className="dex-detail-masthead">
          <div className="dex-detail-namehead">
            <h3 className="dex-detail-name dj">{monsterName(monster, locale)}</h3>
            <span className="dex-detail-enname den">{monster.name.toUpperCase()}</span>
          </div>
          <div className="dex-detail-chiprow">
            <span className={`rar-word rarity r-${capRarity(monster.rarity)}`}>{monster.rarity.toUpperCase()}</span>
            <span className="chip dex-detail-kindchip">MONSTER</span>
            <span className="dex-detail-field-id">
              <span className="dex-detail-label">id</span> {monster.id}
            </span>
            {monster.pack_role ? <span className="chip dex-detail-tagchip">{monster.pack_role}</span> : null}
          </div>
        </header>

        <section className="dex-detail-col-portrait">
          <SectionHead rune="ᛦ" title={t(locale, 'dex.portraitTitle')} den={t(locale, 'dex.portraitDen')} />
          <MonsterPortrait monster={monster} large />
        </section>

        <div className="rune-divider dex-detail-section-divider" aria-hidden="true">
          ᛁ
        </div>

        <section className="dex-detail-col-info">
          <SectionHead rune="ᛗ" title={t(locale, 'dex.monsterStatsTitle')} den={t(locale, 'dex.monsterStatsDen')} />
          <dl className="dex-monster-stats">
            <div className="dex-monster-statrow">
              <dt>{t(locale, 'dex.hpLabel')}</dt>
              <dd className="tnum">{hpText(monster)}</dd>
            </div>
            <div className="dex-monster-statrow">
              <dt>{t(locale, 'dex.footprintLabel')}</dt>
              <dd className="tnum">{footprintText(monster)}</dd>
            </div>
            {monster.pack_role ? (
              <div className="dex-monster-statrow">
                <dt>{t(locale, 'dex.packRoleLabel')}</dt>
                <dd>{monster.pack_role}</dd>
              </div>
            ) : null}
          </dl>
          <div className="dex-monster-skills">
            <span className="dex-detail-label">{t(locale, 'dex.skillsLabel')}</span>
            {(monster.skills || []).map((sk) => (
              <span key={sk} className="chip dex-monster-skillchip" title={sk}>
                {skillLabel(sk)}
              </span>
            ))}
          </div>
          <RegistryBadge systemName={monster.id} />
        </section>
      </article>
    </div>
  );
}

export function MonsterCatalog({ locale, monsters, skillNames, focusId, onFocusConsumed }: MonsterCatalogProps) {
  const entries = useMemo(() => Object.values(monsters), [monsters]);
  const [query, setQuery] = useState('');
  const [rarityFilter, setRarityFilter] = useState('');
  // REQ-0120 contract kept: index=0 preselected so the detail pane is
  // populated on the very first paint of the tab.
  const [selectedId, setSelectedId] = useState<string | null>(() => entries[0]?.id ?? null);

  useEffect(() => {
    if (!focusId) return;
    if (entries.some((m) => m.id === focusId)) setSelectedId(focusId);
    onFocusConsumed?.();
  }, [focusId, entries, onFocusConsumed]);

  const rarities = useMemo(() => Array.from(new Set(entries.map((m) => m.rarity))).sort(), [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((m) => {
      if (rarityFilter && m.rarity !== rarityFilter) return false;
      if (q) {
        const hay = [m.id, m.name, m.name_ja || '', m.i18n?.ja?.name || ''].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, query, rarityFilter]);

  useEffect(() => {
    setSelectedId((cur) => (cur && filtered.some((m) => m.id === cur) ? cur : filtered[0]?.id ?? null));
  }, [filtered]);

  const selected = useMemo(() => filtered.find((m) => m.id === selectedId) ?? null, [filtered, selectedId]);

  return (
    <div className="dex-md">
      <div className="dex-md-list">
        <div className="dex-colhead">
          <span className="dex-colhead-rn rune">ᛦ</span>
          <h2 className="dj dex-colhead-title">{t(locale, 'dex.monsterCatalogTitle')}</h2>
          <span className="den dex-colhead-den">{t(locale, 'dex.monsterCatalogDen')}</span>
          <span className="dex-colhead-grow" />
          <span className="t-micro">{t(locale, 'dex.monsterCatalogNote')}</span>
        </div>

        <div className="dex-controls">
          <input
            type="text"
            className="dex-search"
            placeholder={t(locale, 'dex.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select className="dex-filter" value={rarityFilter} onChange={(e) => setRarityFilter(e.target.value)}>
            <option value="">{t(locale, 'dex.rarityAll')}</option>
            {rarities.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <span className="dex-count">
            {filtered.length} / {entries.length}
          </span>
        </div>

        <div className="dex-grid dgrid">
          {filtered.map((m) => {
            const isSel = m.id === selectedId;
            return (
              <div
                key={m.id}
                className={`dex-card dex-monster-card dcard rar ${rarThemeClass(capRarity(m.rarity))}${isSel ? ' dex-card-selected' : ''}`}
              >
                <button
                  type="button"
                  className="dex-card-summary dcard-btn"
                  aria-pressed={isSel}
                  onClick={() => setSelectedId(m.id)}
                >
                  <span className="gem" aria-hidden="true" />
                  <span className="dex-card-no dex-card-no-kind t-micro">MON</span>
                  <span className="dex-card-shape dthumb">
                    <MonsterPortrait monster={m} />
                  </span>
                  <div className="dex-card-summary-text">
                    <div className="dex-card-name dname">{monsterName(m, locale)}</div>
                    <div className="dex-card-sub dsub">
                      {m.pack_role ? <span className="dex-card-cat">{m.pack_role}</span> : null}
                      <span className="dex-card-enname">{m.name.toUpperCase()}</span>
                    </div>
                    <div className="dex-card-meta dfoot">
                      <span className={`rar-word rarity r-${capRarity(m.rarity)}`}>{m.rarity.toUpperCase()}</span>
                      <span className="dex-card-id">{m.id}</span>
                      <span className="dex-card-kind">
                        HP {hpText(m)} ・ {footprintText(m)}
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
          <MonsterDetail monster={selected} locale={locale} skillNames={skillNames} />
        ) : (
          <div className="dex-detail-empty">{t(locale, 'dex.detailEmpty')}</div>
        )}
      </div>
    </div>
  );
}
