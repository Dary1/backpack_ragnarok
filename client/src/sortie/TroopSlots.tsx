// client/src/sortie/TroopSlots.tsx -- REQ-0239 (design 01 sec 5): the four
// troop slots. Empty = dashed border + ordinal (壱/弐/参/肆) + ghost text;
// filled = the assigned squad's SquadMiniCard + a unassign affordance.
// Keyboard: slot focus + Delete/Backspace unassigns.
import { t, type TranslationKey } from '../i18n';
import type { Locale } from '../store';
import { SquadMiniCard } from './SquadMiniCard';
import type { SquadCardEntry } from './deriveSquadCard';

const ORD_KEYS: readonly TranslationKey[] = [
  'schedule.room.ord1', 'schedule.room.ord2', 'schedule.room.ord3', 'schedule.room.ord4',
];

interface TroopSlotsProps {
  locale: Locale;
  assigned: (number | null)[];
  entriesByIndex: Map<number, SquadCardEntry>;
  onUnassign: (slotIndex: number) => void;
}

export function TroopSlots({ locale, assigned, entriesByIndex, onUnassign }: TroopSlotsProps) {
  return (
    <div className="sortie-troop">
      {assigned.map((squadIndex, slot) => {
        const entry = squadIndex != null ? entriesByIndex.get(squadIndex) ?? null : null;
        const ord = t(locale, ORD_KEYS[slot] ?? ORD_KEYS[0]);
        return (
          <div
            key={slot}
            className={`sortie-slot${entry ? ' is-filled' : ' is-empty'}`}
            data-testid={`sortie-slot-${slot}`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (entry && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); onUnassign(slot); }
            }}
          >
            <span className="sortie-slot-ord dj" aria-hidden="true">{ord}</span>
            {entry ? (
              <>
                <SquadMiniCard
                  locale={locale}
                  info={entry.info}
                  stateKey={entry.stateKey}
                  assignedOrdinal={ord}
                  blocksStrip={entry.blocksStrip}
                  testId={`sortie-slot-card-${slot}`}
                />
                <button
                  type="button"
                  className="sortie-slot-unassign"
                  aria-label={t(locale, 'sortie.slot.unassign')}
                  title={t(locale, 'sortie.slot.unassign')}
                  onClick={() => onUnassign(slot)}
                >✕</button>
              </>
            ) : (
              <span className="sortie-slot-empty-ghost t-micro">{t(locale, 'sortie.slot.empty')}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
