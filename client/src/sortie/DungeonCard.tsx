// client/src/sortie/DungeonCard.tsx -- REQ-0239 (design 01 sec 5): the
// illustrated destination card (16:9 key art, name, level band, theme glyph).
// Art resolves through the SAME art_urls chain as every other consumer
// (getItemArtUrl(dungeonId), REQ-0185 D4); when absent it shows the established
// rune-well fallback (ᛝ on --raised), NEVER a broken image.
import { getItemArtUrl } from '../board/itemArt';
import { t } from '../i18n';
import { localizedName } from '../lib/contentName';
import type { Locale } from '../store';
import type { ApiDungeonEntry } from '../api';

// design D2: theme -> glyph + accent token. Falls back to the rune ᛝ + bone.
const THEME_META: Record<string, { glyph: string; accent: string }> = {
  frost: { glyph: '❄', accent: 'var(--frost-hi)' },
  grave: { glyph: '✦', accent: 'var(--gold-hi)' },
  wild: { glyph: '❧', accent: 'var(--valid)' },
  venom: { glyph: '✿', accent: '#8FB84E' },
  demon: { glyph: '✷', accent: 'var(--ember-hi)' },
  fire: { glyph: '🔥', accent: 'var(--ember-hi)' },
};
export function themeMeta(theme: string | undefined): { glyph: string; accent: string } {
  return (theme && THEME_META[theme]) || { glyph: 'ᛝ', accent: 'var(--bone-2)' };
}

interface DungeonCardProps {
  locale: Locale;
  dungeon: ApiDungeonEntry;
  selected: boolean;
  locked?: boolean;
  onSelect: () => void;
}

export function DungeonCard({ locale, dungeon, selected, locked, onSelect }: DungeonCardProps) {
  const art = getItemArtUrl(dungeon.id);
  const meta = themeMeta(dungeon.theme);
  const name = localizedName(locale, dungeon);
  const band = (dungeon.levelMin != null && dungeon.levelMax != null)
    ? t(locale, 'sortie.dungeon.levelBand', { min: dungeon.levelMin, max: dungeon.levelMax })
    : '';
  const classes = [
    'sortie-dungeon-card', 'panel',
    selected ? 'ornate is-selected' : '',
    locked ? 'is-locked' : '',
  ].filter(Boolean).join(' ');
  return (
    <div
      className={classes}
      data-testid={`sortie-dungeon-card-${dungeon.id}`}
      role="button"
      aria-pressed={selected}
      aria-disabled={locked || undefined}
      tabIndex={locked ? -1 : 0}
      style={{ ['--dungeon-accent' as string]: meta.accent }}
      onClick={locked ? undefined : onSelect}
      onKeyDown={locked ? undefined : (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      {selected ? (<><i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" /></>) : null}
      <div className="sortie-dungeon-art">
        {art ? (
          <img className="sortie-dungeon-art-img" src={art} alt="" loading="lazy" />
        ) : (
          <div className="sortie-dungeon-art-fallback dex-portrait-well" aria-hidden="true">ᛝ</div>
        )}
        {locked ? <div className="sortie-dungeon-lock" aria-hidden="true">🔒</div> : null}
      </div>
      <div className="sortie-dungeon-body">
        <div className="dj sortie-dungeon-name" title={name}>{name}</div>
        <div className="sortie-dungeon-sub t-micro">
          {band ? <span className="tnum">{band}</span> : null}
          <span className="sortie-dungeon-glyph" style={{ color: meta.accent }} aria-hidden="true">{meta.glyph}</span>
          {locked && dungeon.levelMin != null ? (
            <span className="chip sortie-dungeon-lockchip">{t(locale, 'sortie.dungeon.lockedAt', { level: dungeon.levelMin })}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
