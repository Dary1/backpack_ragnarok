// Schedule route (#/schedule) -- REQ-0036 P1-C. Replaces the
// PlaceholderPage stub App.tsx used to render for this route (see
// App.tsx's own comment on the swap). Owns the Rooms/Warehouse tab
// toggle (golden f: "Warehouse tab inside Schedule screen", NOT a
// separate top-level nav route) and the room list + create-room form.
// Follows the same "fetch on mount, loading/error states, t()" shape
// DexRoot.tsx/Settings.tsx already established for a route-level
// component.
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  createRoom as apiCreateRoom,
  fetchDungeons,
  fetchRooms,
  type ApiCreateRoomBody,
  type ApiDungeonsPayload,
  type ApiRoom,
} from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { CreateRoomForm } from './CreateRoomForm';
import { RoomCard } from './RoomCard';
import { WarehouseTab } from './WarehouseTab';

interface SchedulePageProps {
  locale: Locale;
}

type ScheduleTab = 'rooms' | 'warehouse';

// Rooms list poll cadence -- generous (this list only needs to notice a
// NEW auto-started run or a cooldown clearing; per-run event detail
// polling at a faster cadence is Monitor.tsx's own, separate concern for
// whichever room is currently expanded).
const ROOMS_POLL_MS = 4000;

export function SchedulePage({ locale }: SchedulePageProps) {
  const [tab, setTab] = useState<ScheduleTab>('rooms');
  const [rooms, setRooms] = useState<ApiRoom[] | null>(null);
  const [dungeons, setDungeons] = useState<ApiDungeonsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);

  const reloadRooms = useCallback(async () => {
    try {
      const res = await fetchRooms();
      setRooms(res.rooms);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await fetchDungeons();
        if (!cancelled) setDungeons(d);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    void reloadRooms();
    return () => {
      cancelled = true;
    };
  }, [reloadRooms]);

  // Rooms list poll -- keeps status/cooldown/lastRunId reasonably fresh
  // even while nothing is expanded (Monitor.tsx polls the RUN endpoint
  // separately, at its own faster cadence, only for the expanded room).
  useEffect(() => {
    const id = setInterval(() => void reloadRooms(), ROOMS_POLL_MS);
    return () => clearInterval(id);
  }, [reloadRooms]);

  const handleCreate = useCallback(
    async (body: ApiCreateRoomBody) => {
      setCreating(true);
      setCreateError(null);
      try {
        await apiCreateRoom(body);
        await reloadRooms();
      } catch (e) {
        setCreateError(e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));
      } finally {
        setCreating(false);
      }
    },
    [reloadRooms]
  );

  return (
    <div className="schedule-page">
      <div className="schedule-tab-row">
        <button
          type="button"
          className={`schedule-tab${tab === 'rooms' ? ' schedule-tab-active' : ''}`}
          onClick={() => setTab('rooms')}
        >
          {t(locale, 'schedule.tabRooms')}
        </button>
        <button
          type="button"
          className={`schedule-tab${tab === 'warehouse' ? ' schedule-tab-active' : ''}`}
          onClick={() => setTab('warehouse')}
        >
          {t(locale, 'schedule.tabWarehouse')}
        </button>
      </div>

      {tab === 'rooms' ? (
        <div className="schedule-rooms-view">
          {loadError ? <div className="schedule-error">{t(locale, 'schedule.loadFailed')}{loadError}</div> : null}

          <div className="schedule-rooms-list">
            {rooms === null ? (
              <div className="schedule-loading">{t(locale, 'schedule.loading')}</div>
            ) : rooms.length === 0 ? (
              <div className="schedule-empty">{t(locale, 'schedule.noRooms')}</div>
            ) : (
              rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  locale={locale}
                  expanded={expandedRoomId === room.id}
                  onToggleExpand={() => setExpandedRoomId((cur) => (cur === room.id ? null : room.id))}
                  onChanged={reloadRooms}
                />
              ))
            )}
          </div>

          <div className="schedule-create-panel">
            <h3>{t(locale, 'schedule.createTitle')}</h3>
            {createError ? <div className="schedule-error">{createError}</div> : null}
            <CreateRoomForm locale={locale} dungeons={dungeons} creating={creating} onCreate={handleCreate} />
          </div>
        </div>
      ) : (
        <WarehouseTab locale={locale} />
      )}
    </div>
  );
}
