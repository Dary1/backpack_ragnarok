// Schedule route (#/schedule) -- REQ-0036 P1-C. Replaces the
// PlaceholderPage stub App.tsx used to render for this route (see
// App.tsx's own comment on the swap). Owns the Rooms/Warehouse tab
// toggle (golden f: "Warehouse tab inside Schedule screen", NOT a
// separate top-level nav route) and the room list + create-room form.
// Follows the same "fetch on mount, loading/error states, t()" shape
// DexRoot.tsx/Settings.tsx already established for a route-level
// component.
//
// UX pass (schedule-ux-improvements): the Rooms list used to render
// EVERY room the caller ever created, canceled or not, in one flat
// unfiltered list, with the create-room form pinned below it. On any
// account with real history, canceled clutter buries both the few rooms
// that still need attention and the create action itself below a long
// scroll. This pass (a) defaults to hiding canceled rooms -- a toggle +
// live count stays visible so nothing is silently lost, just collapsed
// -- and (b) turns "Create a room" into a toggle pinned ABOVE the list
// instead of a panel below it (auto-opens itself, harmlessly, whenever
// the caller has zero rooms at all -- there's nothing else useful to
// show yet in that case).
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  createRoom as apiCreateRoom,
  fetchDungeons,
  fetchMe,
  fetchRooms,
  type ApiCreateRoomBody,
  type ApiDungeonsPayload,
  type ApiMe,
  type ApiRoom,
} from '../api';
import { t } from '../i18n';
import type { Locale } from '../store';
import { CreateRoomForm, localizedName } from './CreateRoomForm';
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
  const [me, setMe] = useState<ApiMe | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  // UX pass: create panel is a manual toggle (see showCreatePanel below,
  // which also force-opens it once the caller genuinely has zero rooms).
  const [createOpen, setCreateOpen] = useState(false);
  // UX pass: canceled rooms are hidden by default -- the count badge
  // next to the toggle keeps this discoverable/reversible rather than a
  // silent filter.
  const [hideCanceled, setHideCanceled] = useState(true);

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
    // REQ-0043: /api/me failure is non-fatal here too (same "roles-less
    // on failure" convention DexRoot.tsx/Settings.tsx already use) -- it
    // just means the dev-only genSeed field stays hidden, same as a
    // plain guest.
    fetchMe()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      });
    void reloadRooms();
    return () => {
      cancelled = true;
    };
  }, [reloadRooms]);

  const isAdmin = !!me && Array.isArray(me.roles) && me.roles.includes('item_admin');

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

  // UX pass: resolves a room's dungeonId against the already-fetched
  // dungeons list (same lookup+locale convention CreateRoomForm.tsx's
  // own <select> options already use) so RoomCard can show a real name
  // instead of just the room's own opaque id. Falls back to the
  // existing schedule.dungeonUnknown key if content has since removed
  // that dungeon.
  function dungeonNameFor(dungeonId: string): string {
    const entry = dungeons?.dungeons.find((d) => d.id === dungeonId);
    return entry ? localizedName(locale, entry) : t(locale, 'schedule.dungeonUnknown');
  }

  const hasRooms = rooms !== null && rooms.length > 0;
  const canceledCount = rooms ? rooms.filter((r) => r.status === 'canceled').length : 0;
  const visibleRooms = rooms ? (hideCanceled ? rooms.filter((r) => r.status !== 'canceled') : rooms) : [];
  // Force the create panel open whenever the caller has zero rooms --
  // nothing else useful to show, and a brand-new/fully-cleared account
  // shouldn't have to know a toggle exists just to find the only action
  // available.
  const showCreatePanel = createOpen || (rooms !== null && rooms.length === 0);

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

          {hasRooms ? (
            <div className="schedule-rooms-toolbar">
              <button
                type="button"
                className="schedule-create-toggle-btn"
                onClick={() => setCreateOpen((o) => !o)}
                data-testid="schedule-create-toggle"
              >
                {showCreatePanel ? t(locale, 'schedule.collapse') : t(locale, 'schedule.createTitle')}
              </button>
              {canceledCount > 0 ? (
                <label className="schedule-hide-canceled-toggle">
                  <input
                    type="checkbox"
                    checked={hideCanceled}
                    onChange={(e) => setHideCanceled(e.target.checked)}
                    data-testid="schedule-hide-canceled-checkbox"
                  />
                  {t(locale, 'schedule.hideCanceledToggle', { count: canceledCount })}
                </label>
              ) : null}
            </div>
          ) : null}

          {showCreatePanel ? (
            <div className="schedule-create-panel">
              <h3>{t(locale, 'schedule.createTitle')}</h3>
              {createError ? <div className="schedule-error">{createError}</div> : null}
              <CreateRoomForm locale={locale} dungeons={dungeons} creating={creating} isAdmin={isAdmin} onCreate={handleCreate} />
            </div>
          ) : null}

          <div className="schedule-rooms-list">
            {rooms === null ? (
              <div className="schedule-loading">{t(locale, 'schedule.loading')}</div>
            ) : rooms.length === 0 ? (
              <div className="schedule-empty">{t(locale, 'schedule.noRooms')}</div>
            ) : visibleRooms.length === 0 ? (
              <div className="schedule-empty" data-testid="schedule-all-hidden">{t(locale, 'schedule.allHidden')}</div>
            ) : (
              visibleRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  locale={locale}
                  dungeonName={dungeonNameFor(room.dungeonId)}
                  expanded={expandedRoomId === room.id}
                  onToggleExpand={() => setExpandedRoomId((cur) => (cur === room.id ? null : room.id))}
                  onChanged={reloadRooms}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <WarehouseTab locale={locale} />
      )}
    </div>
  );
}
