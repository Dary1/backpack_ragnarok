// client/src/sortie/DungeonDossier.tsx -- REQ-0239 (design 01 sec 5): the
// selected dungeon's dossier -- 21:9 hero, authored encounter/loot summary
// (from encounterSummary, REQ-0185 D3), LevelStepper + slot-pressure forecast,
// formation select, and the Advanced fold. Consequence gets art (design 00 P-A).
import { useEffect, useState } from 'react';
import { getItemArtUrl } from '../board/itemArt';
import { SlotPressureSummary } from '../forecast/SlotPressureSummary';
import { t } from '../i18n';
import { localizedName } from '../lib/contentName';
import type { Locale } from '../store';
import type { ApiDungeonEntry, ApiFormationEntry } from '../api';
import { AdvancedFold, type SortieAdvanced } from './AdvancedFold';
import { themeMeta } from './DungeonCard';
import { LevelStepper } from './LevelStepper';

interface DungeonDossierProps {
  locale: Locale;
  dungeon: ApiDungeonEntry;
  formations: ApiFormationEntry[];
  level: number;
  onLevelChange: (level: number) => void;
  formationId: string;
  onFormationChange: (id: string) => void;
  advanced: SortieAdvanced;
  onAdvancedChange: (next: SortieAdvanced) => void;
  isAdmin: boolean;
}

export function DungeonDossier(props: DungeonDossierProps) {
  const { locale, dungeon, formations, level, onLevelChange, formationId, onFormationChange, advanced, onAdvancedChange, isAdmin } = props;
  const art = getItemArtUrl(dungeon.id);
  const meta = themeMeta(dungeon.theme);
  const name = localizedName(locale, dungeon);
  const summary = dungeon.encounterSummary;
  const belowBand = dungeon.levelMin != null && level < dungeon.levelMin;

  // Debounce the level fed to the forecast fetch (design 01 sec 7: 300ms).
  const [forecastLevel, setForecastLevel] = useState(level);
  useEffect(() => {
    const id = window.setTimeout(() => setForecastLevel(level), 300);
    return () => window.clearTimeout(id);
  }, [level]);

  const loot = summary?.lootPreview ?? [];
  const lootIcons = loot.slice(0, 5);

  return (
    <section className="sortie-dossier panel" data-testid="sortie-dossier">
      <div className="sortie-dossier-hero" style={{ ['--dungeon-accent' as string]: meta.accent }}>
        {art
          ? <img className="sortie-dossier-hero-img" src={art} alt="" />
          : <div className="sortie-dossier-hero-fallback dex-portrait-well" aria-hidden="true">ᛝ</div>}
        <div className="sortie-dossier-hero-scrim">
          <h3 className="t-h2 dj sortie-dossier-name">{name}</h3>
          <div className="sortie-dossier-hero-chips">
            <span className="chip sortie-theme-chip" style={{ color: meta.accent, borderColor: meta.accent }}>
              <span aria-hidden="true">{meta.glyph}</span>{dungeon.theme ?? ''}
            </span>
            {dungeon.levelMin != null && dungeon.levelMax != null ? (
              <span className="chip sortie-band-chip tnum">
                {t(locale, 'sortie.dossier.recommended')} {t(locale, 'sortie.dungeon.levelBand', { min: dungeon.levelMin, max: dungeon.levelMax })}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="sortie-dossier-body">
        <div className="sortie-dossier-encounters">
          <span className="den sortie-dossier-den">{t(locale, 'sortie.dossier.encounters')}</span>
          <div className="sortie-encounter-chips">
            {summary ? (
              <>
                <span className="chip sortie-enc-chip">{t(locale, 'sortie.dossier.packs', { n: summary.packs })}</span>
                {summary.gimics.trap > 0 ? <span className="chip sortie-enc-chip">{t(locale, 'sortie.dossier.trap', { n: summary.gimics.trap })}</span> : null}
                {summary.gimics.chest > 0 ? <span className="chip sortie-enc-chip">{t(locale, 'sortie.dossier.chest', { n: summary.gimics.chest })}</span> : null}
                {summary.gimics.door > 0 ? <span className="chip sortie-enc-chip">{t(locale, 'sortie.dossier.door', { n: summary.gimics.door })}</span> : null}
              </>
            ) : null}
          </div>
        </div>

        {lootIcons.length > 0 ? (
          <div className="sortie-dossier-loot">
            <span className="den sortie-dossier-den">{t(locale, 'sortie.dossier.loot')}</span>
            <div className="sortie-loot-icons">
              {lootIcons.map((id, i) => {
                const url = getItemArtUrl(id);
                return url
                  ? <img key={i} className="sortie-loot-icon" src={url} alt="" loading="lazy" />
                  : <span key={i} className="sortie-loot-icon sortie-loot-dot" aria-hidden="true" />;
              })}
              {loot.length > lootIcons.length ? <span className="sortie-loot-more t-micro tnum">+{loot.length - lootIcons.length}</span> : null}
            </div>
          </div>
        ) : null}

        <div className="sortie-dossier-controls">
          <LevelStepper locale={locale} level={level} onChange={onLevelChange} belowBand={belowBand} />
          <label className="sortie-formation">
            <span className="den">{t(locale, 'sortie.formation.label')}</span>
            <select
              className="sortie-formation-select"
              data-testid="sortie-formation-select"
              value={formationId}
              onChange={(e) => onFormationChange(e.target.value)}
            >
              {formations.map((f) => <option key={f.id} value={f.id}>{localizedName(locale, f)}</option>)}
            </select>
          </label>
        </div>

        <div className="sortie-dossier-forecast">
          <SlotPressureSummary locale={locale} dungeonId={dungeon.id} level={forecastLevel} formationId={formationId} />
        </div>

        <AdvancedFold locale={locale} isAdmin={isAdmin} value={advanced} onChange={onAdvancedChange} />
      </div>
    </section>
  );
}
