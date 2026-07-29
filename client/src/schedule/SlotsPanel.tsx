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
import { isOwnSeat, isTroopRoom } from './seats'; // REQ-0337
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
  /** REQ-0168 U7: the caller's full rooms list, so this panel can pre-
   * disable a squad already committed to another slot of THIS room, or to
   * any slot of another ACTIVE room (either can only ever 409). */
  rooms: ApiRoom[];
  onChanged: () => void | Promise<void>;
}

const SQUAD_SLOTS = 4;

export function SlotsPanel({ room, locale, rooms, onChanged }: SlotsPanelProps) {
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

  // REQ-0169 M4: compute each squad's deployability ONCE per render -- the
  // dropdowns would otherwise call the engine predicate squads x slots
  // times; this per-render memo of the synchronous engine fan-out is the
  // second M4 freeze suspect's remedy (the first, loadBoardTextures, is
  // already shared module-wide via boardLoadPromise, so it never re-
  // rasterizes per monitor).
  const deployableFlags = squadNames.map((_name, idx) => deployableByIndex(idx));
  // REQ-0168 U4: how many of the caller's squads are deployable (>=1 BP).
  // A run only auto-starts once 4 DIFFERENT deployable squads fill the
  // slots, so surface how many more the player still needs to build.
  const deployableCount = deployableFlags.reduce((acc, flag) => acc + (flag ? 1 : 0), 0);

  // REQ-0168 U7: squad indices committed to any slot of another ACTIVE
  // room -- assigning them here can only ever 409 (deployed_overlap), so
  // pre-disable them in the dropdowns exactly like empty squads.
  const otherActiveRoomSquads = new Set<number>();
  for (const r of rooms) {
    if (r.id === room.id) continue;
    if (r.status !== 'active') continue;
    // REQ-0337: only the VIEWER's own seats gate the viewer's dropdowns. On a
    // co-op Troop the other three seats belong to other players and their
    // squadIndex indexes THEIR canvas -- counting those here would pre-disable
    // squads of the viewer's that are in fact perfectly free.
    for (const sl of r.slots) if (isOwnSeat(sl, r)) otherActiveRoomSquads.add(sl!.squadIndex!);
  }
  // A squad already sitting in a DIFFERENT slot of THIS room (a duplicate
  // within the room -> same_room_duplicate 409).
  const usedInAnotherSlotOfThisRoom = (idx: number, slotIndex: number): boolean =>
    room.slots.some((sl, j) => j !== slotIndex && !!sl && sl.squadIndex === idx);

  // REQ-0337: a co-op Troop's seats are NOT editable through this panel. Both
  // endpoints it drives are the SOLO surface: PUT /rooms/:id/slots/:i writes a
  // solo-shaped `{squadIndex}` slot, which would OVERWRITE a co-op seat's
  // ownerId and silently reassign another player's seat to the host; and
  // .../swap queues a solo swap. Seats on a Troop are taken and released only
  // through /troops/:id/join and .../leave, by each seat's own owner. So the
  // panel renders read-only here rather than offering an action that corrupts.
  const troop = isTroopRoom(room);

  const handleSelect = async (slotIndex: number, value: string) => {
    if (troop) return;
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
      {/* REQ-0168 U4(a): permanent explainer -- a run only auto-starts once
          all four slots hold four DIFFERENT squads. */}
      <div className="schedule-slots-autostart-hint">{troop ? t(locale, 'schedule.slots.troopHint') : t(locale, 'schedule.slots.autoStartHint')}</div>
      {squadNames.length === 0 ? <div className="schedule-slots-no-squads">{t(locale, 'schedule.slots.noSquads')}</div> : null}
      {/* REQ-0168 U4(b): fewer than 4 deployable squads is otherwise a
          silent dead-end -- point the player at the Backpacks screen with
          the exact shortfall. */}
      {deployableCount < 4 && !troop ? (
        <div className="schedule-slots-need-squads" data-testid="schedule-slots-need-squads">
          <span>{t(locale, 'schedule.slots.needSquads', { n: 4 - deployableCount })}</span>
          <a className="schedule-slots-need-squads-link" href="#/backpacks">
            {t(locale, 'schedule.slots.goToBackpacks')}
          </a>
        </div>
      ) : null}
      <div className="schedule-slots-grid">
        {Array.from({ length: SQUAD_SLOTS }, (_, slotIndex) => {
          const slot = room.slots[slotIndex];
          // REQ-0337: on a Troop, only OUR OWN seats resolve against our squad
          // list -- another owner's squadIndex indexes THEIR canvas, so binding
          // the select to it would display (and, on any stray change, submit)
          // the wrong squad entirely. Their seat renders as the inert
          // placeholder instead.
          const showValue = !troop || isOwnSeat(slot, room);
          const currentValue = showValue && slot && slot.squadIndex != null ? String(slot.squadIndex) : '';
          const queued = room.pendingSwap && room.pendingSwap.slot === slotIndex ? room.pendingSwap : null;
          return (
            <div className="schedule-slot-card" key={slotIndex} data-testid={`schedule-slot-${slotIndex}`}>
              <div className="schedule-slot-label">{t(locale, 'schedule.slots.squadLabel', { n: slotIndex + 1 })}</div>
              <select
                className="schedule-select schedule-slot-select"
                value={currentValue}
                disabled={troop || pendingSlot === slotIndex || squadNames.length === 0}
                onChange={(e) => void handleSelect(slotIndex, e.target.value)}
                data-testid={`schedule-slot-select-${slotIndex}`}
              >
                {/* REQ-0337: on a Troop the select is inert -- a seat shows who
                    holds it (or that it is open), and nothing here can change it. */}
                <option value="">{troop ? t(locale, 'schedule.slots.troopSeatOpen') : t(locale, 'schedule.slots.selectSquad')}</option>
                {squadNames.map((name, idx) => {
                  const deployable = deployableFlags[idx];
                  // REQ-0168 U7: a deployable squad already committed
                  // elsewhere (another slot of this room, or any slot of
                  // another active room) would only 409 -- pre-disable it,
                  // labelled "(deployed)".
                  const deployedElsewhere = deployable && (otherActiveRoomSquads.has(idx) || usedInAnotherSlotOfThisRoom(idx, slotIndex));
                  const disabled = !deployable || deployedElsewhere;
                  const label = !deployable
                    ? t(locale, 'schedule.slots.emptySquadOption', { name })
                    : deployedElsewhere
                      ? t(locale, 'schedule.slots.deployedOption', { name })
                      : name;
                  return (
                    <option key={idx} value={idx} disabled={disabled} title={deployable ? undefined : t(locale, 'schedule.slots.emptySquadReason')}>
                      {label}
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
