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

// REQ-0337: an empty slot no longer means "you still owe me a squad". Once the
// player has seated at least one squad, the slots they leave empty ARE the
// public recruitment -- so the ghost text must stop reading as a shortfall and
// start reading as an open seat. Purely a copy switch on the SAME element (no
// new control, no new layout); the slot stays droppable exactly as before, so a
// player who changes their mind just fills it and the recruitment shrinks.
function emptySlotKey(recruiting: boolean): TranslationKey {
  return recruiting ? 'sortie.slot.openSeat' : 'sortie.slot.empty';
}

export function TroopSlots({ locale, assigned, entriesByIndex, onUnassign }: TroopSlotsProps) {
  const filled = assigned.filter((x) => x != null).length;
  const recruiting = filled >= 1 && filled < 4;
  return (
    <div className="sortie-troop" data-testid="sortie-troop" data-recruiting={recruiting ? 'true' : 'false'}>
      {assigned.map((squadIndex, slot) => {
        const entry = squadIndex != null ? entriesByIndex.get(squadIndex) ?? null : null;
        const ord = t(locale, ORD_KEYS[slot] ?? ORD_KEYS[0]);
        return (
          <div
            key={slot}
            className={`sortie-slot${entry ? ' is-filled' : recruiting ? ' is-empty is-open-seat' : ' is-empty'}`}
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
              <span className="sortie-slot-empty-ghost t-micro">{t(locale, emptySlotKey(recruiting))}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
