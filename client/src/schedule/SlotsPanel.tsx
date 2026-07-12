// Slots UI (golden b/d) -- REQ-0036 P1-C. 4 slot cards (unit1..unit4),
// each a dropdown of the player's OWN squad names (reusing the same
// snapshot.state.presets the rest of the app already has -- see
// store.ts's StoreSnapshot / SquadTabs.tsx for how squad names/indices
// are read today) to assign squadIndex via PUT .../slots/:slotIndex.
// 409 deploy-gate errors are surfaced as human-readable, i18n'd inline
// messages (schedule/errors.ts's friendlyScheduleError), matching how
// DexAdmin.tsx shows a save-error inline rather than a toast library
// (this app has none). Swap-while-active renders a "queued" badge using
// the room's own pendingSwap field once it comes back from the server.
import { useState } from 'react';
import { assignSlot, swapSquad, type ApiRoom } from '../api';
import { friendlyScheduleError } from './errors';
import { t } from '../i18n';
import type { Locale } from '../store';
import { useGameStore } from '../store';

// REQ-0041 feedback 5 client-side deploy gate: a squad with zero BP has
// no HP pool ("dead on arrival") and must be pre-emptively disabled in
// this dropdown -- NOT merely rejected after the fact by the server's
// own 409 empty_squad (server/schedule.cjs's assignSlot; see errors.ts's
// friendlyScheduleError for the message-side handling of that 409, which
// still applies as defense-in-depth for any path that bypasses this
// disabled state, e.g. a stale render). Computed directly off the live
// engine/state (same pattern this file already avoids duplicating --
// see store.ts's own __backpackDebug hook for the same
// engine.isSquadDeployable(state, n) call). Pure/cheap: SQUAD_COUNT is
// small (a handful of squads), so recomputing on every render is fine.

interface SlotsPanelProps {
  room: ApiRoom;
  locale: Locale;
  onChanged: () => void | Promise<void>;
}

const SQUAD_SLOTS = 4;

export function SlotsPanel({ room, locale, onChanged }: SlotsPanelProps) {
  const snapshot = useGameStore();
  const squads = snapshot.state?.presets;
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);
  const [slotErrors, setSlotErrors] = useState<Record<number, string>>({});

  const squadNames = squads?.names ?? [];
  const engine = snapshot.engine;
  const state = snapshot.state;
  // Index -> deployable (true if unknown/engine not ready yet -- fails
  // open into "let the server's own 409 catch it" rather than disabling
  // every option before the engine has booted).
  const deployableByIndex = (idx: number): boolean => {
    if (!engine || !state) return true;
    return engine.isSquadDeployable(state, idx);
  };

  const handleSelect = async (slotIndex: number, value: string) => {
    if (value === '') return;
    const squadIndex = parseInt(value, 10);
    setPendingSlot(slotIndex);
    setSlotErrors((prev) => ({ ...prev, [slotIndex]: '' }));
    try {
      // While a run is active, use the swap endpoint (queues rather than
      // applies immediately -- golden j); otherwise assign directly.
      if (room.status === 'active') {
        await swapSquad(room.id, slotIndex, squadIndex);
      } else {
        await assignSlot(room.id, slotIndex, squadIndex);
      }
      await onChanged();
    } catch (e) {
      const key = room.status === 'active' ? 'schedule.slots.swapFailed' : 'schedule.slots.assignFailed';
      setSlotErrors((prev) => ({ ...prev, [slotIndex]: t(locale, key) + friendlyScheduleError(locale, e) }));
    } finally {
      setPendingSlot(null);
    }
  };

  return (
    <div className="schedule-slots-panel">
      <h4 className="schedule-slots-title">{t(locale, 'schedule.slots.title')}</h4>
      {squadNames.length === 0 ? <div className="schedule-slots-no-squads">{t(locale, 'schedule.slots.noSquads')}</div> : null}
      <div className="schedule-slots-grid">
        {Array.from({ length: SQUAD_SLOTS }, (_, slotIndex) => {
          const slot = room.slots[slotIndex];
          const currentValue = slot && slot.squadIndex != null ? String(slot.squadIndex) : '';
          const queued = room.pendingSwap && room.pendingSwap.slot === slotIndex ? room.pendingSwap : null;
          return (
            <div className="schedule-slot-card" key={slotIndex} data-testid={`schedule-slot-${slotIndex}`}>
              <div className="schedule-slot-label">{t(locale, 'schedule.slots.squadLabel', { n: slotIndex + 1 })}</div>
              <select
                className="schedule-select schedule-slot-select"
                value={currentValue}
                disabled={pendingSlot === slotIndex || squadNames.length === 0}
                onChange={(e) => void handleSelect(slotIndex, e.target.value)}
                data-testid={`schedule-slot-select-${slotIndex}`}
              >
                <option value="">{t(locale, 'schedule.slots.selectSquad')}</option>
                {squadNames.map((name, idx) => {
                  const deployable = deployableByIndex(idx);
                  return (
                    <option key={idx} value={idx} disabled={!deployable} title={deployable ? undefined : t(locale, 'schedule.slots.emptySquadReason')}>
                      {deployable ? name : t(locale, 'schedule.slots.emptySquadOption', { name })}
                    </option>
                  );
                })}
              </select>
              {slot && slot.squadIndex == null ? <span className="schedule-slot-empty">{t(locale, 'schedule.slots.empty')}</span> : null}
              {queued ? (
                <span className="schedule-slot-queued-badge" data-testid={`schedule-slot-queued-${slotIndex}`}>
                  {t(locale, 'schedule.slots.queuedBadge')}
                </span>
              ) : null}
              {slotErrors[slotIndex] ? <div className="schedule-slot-error">{slotErrors[slotIndex]}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
