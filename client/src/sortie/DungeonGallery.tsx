// client/src/sortie/DungeonGallery.tsx -- REQ-0239 (design 01 sec 3/7): the
// horizontal, scroll-snap destination rail. Renders DungeonCard[]; ArrowLeft/
// ArrowRight move the selection (design 01 sec 7). Skeleton + empty/error
// states per design 01 sec 12.
import { useRef } from 'react';
import { t } from '../i18n';
import type { Locale } from '../store';
import type { ApiDungeonEntry } from '../api';
import { DungeonCard } from './DungeonCard';

interface DungeonGalleryProps {
  locale: Locale;
  dungeons: ApiDungeonEntry[] | null;
  loadError: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry?: () => void;
}

export function DungeonGallery({ locale, dungeons, loadError, selectedId, onSelect, onRetry }: DungeonGalleryProps) {
  const railRef = useRef<HTMLDivElement | null>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!dungeons || dungeons.length === 0) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const idx = dungeons.findIndex((d) => d.id === selectedId);
    const base = idx < 0 ? 0 : idx;
    const next = e.key === 'ArrowRight'
      ? Math.min(dungeons.length - 1, base + 1)
      : Math.max(0, base - 1);
    onSelect(dungeons[next].id);
    railRef.current?.querySelector(`[data-testid="sortie-dungeon-card-${dungeons[next].id}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  if (loadError) {
    return (
      <div className="sortie-gallery-error schedule-error">
        {t(locale, 'schedule.loadFailed')}{loadError}
        {onRetry ? <button type="button" className="btn" onClick={onRetry}>{t(locale, 'sortie.dest.retry')}</button> : null}
      </div>
    );
  }
  if (dungeons === null) {
    return (
      <div className="sortie-gallery" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="sortie-dungeon-card panel sortie-skeleton" aria-hidden="true" />)}
        <span className="sortie-gallery-loading t-micro den">{t(locale, 'sortie.dest.loading')}</span>
      </div>
    );
  }
  if (dungeons.length === 0) {
    return <div className="sortie-empty-state"><span className="sortie-empty-rune" aria-hidden="true">ᛝ</span>{t(locale, 'sortie.dest.empty')}</div>;
  }
  return (
    <div className="sortie-gallery" ref={railRef} role="listbox" aria-label={t(locale, 'sortie.dest.den')} tabIndex={0} onKeyDown={onKeyDown}>
      {dungeons.map((d) => (
        <DungeonCard key={d.id} locale={locale} dungeon={d} selected={d.id === selectedId} onSelect={() => onSelect(d.id)} />
      ))}
    </div>
  );
}
