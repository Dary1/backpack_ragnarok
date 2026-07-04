// Slots UI (golden b/d) -- REQ-0036 P1-C. 4 slot cards (unit1..unit4),
// each a dropdown of the player's OWN preset names (reusing the same
// snapshot.state.presets the rest of the app already has -- see
// store.ts's StoreSnapshot / PresetTabs.tsx for how preset names/indices
// are read today) to assign presetIndex via PUT .../slots/:slotIndex.
// 409 deploy-gate errors are surfaced as human-readable, i18n'd inline
// messages (schedule/errors.ts's friendlyScheduleError), matching how
// DexAdmin.tsx shows a save-error inline rather than a toast library
// (this app has none). Swap-while-active renders a "queued" badge using
// the room's own pendingSwap field once it comes back from the server.
import { useState } from 'react';
import { assignSlot, swapUnit, type ApiRoom } from '../api';
import { friendlyScheduleError } from './errors';
import { t } from '../i18n';
import type { Locale } from '../store';
import { useGameStore } from '../store';

interface SlotsPanelProps {
  room: ApiRoom;
  locale: Locale;
  onChanged: () => void | Promise<void>;
}

const UNIT_SLOTS = 4;

export function SlotsPanel({ room, locale, onChanged }: SlotsPanelProps) {
  const snapshot = useGameStore();
  const presets = snapshot.state?.presets;
  const [pendingSlot, setPendingSlot] = useState<number | null>(null);
  const [slotErrors, setSlotErrors] = useState<Record<number, string>>({});

  const presetNames = presets?.names ?? [];

  const handleSelect = async (slotIndex: number, value: string) => {
    if (value === '') return;
    const presetIndex = parseInt(value, 10);
    setPendingSlot(slotIndex);
    setSlotErrors((prev) => ({ ...prev, [slotIndex]: '' }));
    try {
      // While a run is active, use the swap endpoint (queues rather than
      // applies immediately -- golden j); otherwise assign directly.
      if (room.status === 'active') {
        await swapUnit(room.id, slotIndex, presetIndex);
      } else {
        await assignSlot(room.id, slotIndex, presetIndex);
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
      {presetNames.length === 0 ? <div className="schedule-slots-no-presets">{t(locale, 'schedule.slots.noPresets')}</div> : null}
      <div className="schedule-slots-grid">
        {Array.from({ length: UNIT_SLOTS }, (_, slotIndex) => {
          const slot = room.slots[slotIndex];
          const currentValue = slot && slot.presetIndex != null ? String(slot.presetIndex) : '';
          const queued = room.pendingSwap && room.pendingSwap.slot === slotIndex ? room.pendingSwap : null;
          return (
            <div className="schedule-slot-card" key={slotIndex} data-testid={`schedule-slot-${slotIndex}`}>
              <div className="schedule-slot-label">{t(locale, 'schedule.slots.unitLabel', { n: slotIndex + 1 })}</div>
              <select
                className="schedule-select schedule-slot-select"
                value={currentValue}
                disabled={pendingSlot === slotIndex || presetNames.length === 0}
                onChange={(e) => void handleSelect(slotIndex, e.target.value)}
                data-testid={`schedule-slot-select-${slotIndex}`}
              >
                <option value="">{t(locale, 'schedule.slots.selectPreset')}</option>
                {presetNames.map((name, idx) => (
                  <option key={idx} value={idx}>
                    {name}
                  </option>
                ))}
              </select>
              {slot && slot.presetIndex == null ? <span className="schedule-slot-empty">{t(locale, 'schedule.slots.empty')}</span> : null}
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
