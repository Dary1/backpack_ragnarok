// client/src/sortie/SquadShelf.tsx -- REQ-0239 (design 01 sec 6): the shelf of
// SquadMiniCard for EVERY preset. Click a ready card -> assign to the first
// empty slot; click an assigned card -> unassign. Conflicted / deployed /
// recovering / undeployable cards are not assignable (tooltip explains why).
import { t } from '../i18n';
import type { Locale } from '../store';
import { setRoute } from '../store';
import { SquadMiniCard } from './SquadMiniCard';
import type { SquadCardEntry } from './deriveSquadCard';

interface SquadShelfProps {
  locale: Locale;
  entries: SquadCardEntry[];
  onAssign: (squadIndex: number) => void;
  onUnassign: (squadIndex: number) => void;
}

export function SquadShelf({ locale, entries, onAssign, onUnassign }: SquadShelfProps) {
  if (entries.length === 0) {
    return (
      <div className="sortie-empty-state sortie-shelf-empty">
        <span className="sortie-empty-rune" aria-hidden="true">ᛝ</span>
        {t(locale, 'sortie.shelf.empty')}
        <button type="button" className="btn" onClick={() => setRoute('backpacks')}>{t(locale, 'sortie.shelf.goBackpacks')}</button>
      </div>
    );
  }
  return (
    <div className="sortie-shelf" role="list">
      {entries.map((entry) => {
        const idx = entry.info.index;
        const clickable = entry.assignable || entry.assignedSlot != null;
        return (
          <SquadMiniCard
            key={idx}
            locale={locale}
            info={entry.info}
            stateKey={entry.stateKey}
            assignedOrdinal={entry.assignedOrdinal}
            conflicted={entry.conflicted}
            conflictStrip={entry.conflictStrip}
            conflictTooltip={entry.conflictTooltip}
            blocksStrip={entry.blocksStrip}
            showSharedBadge={entry.showSharedBadge}
            deployedDungeonName={entry.deployedDungeonName}
            freesLabel={entry.freesLabel}
            disabled={!clickable}
            onClick={clickable ? () => (entry.assignedSlot != null ? onUnassign(idx) : onAssign(idx)) : undefined}
            testId={`sortie-squad-card-${idx}`}
          />
        );
      })}
    </div>
  );
}
