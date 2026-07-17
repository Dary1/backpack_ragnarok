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
//
// REQ-0071 (MJOLNIR re-skin; mock: web/redesign/expedition.html): page
// chrome only -- fetch/poll cadence, tab switching, create flow, and
// every selector the E2E suite uses are unchanged. Additions: the mock's
// full-viewport key art (bg_expedition.jpg, referenced from the served
// /redesign/assets path like the canvas page's -- REQ-0070 convention),
// a pagehead strip (hall title + lede; the mock's Muninn NIGHT-REPORT
// headline, raven art and the 22:40->06:10 night arc have no backing
// data -- no sleep-session tracking exists -- and are omitted, see
// docs/REQ-0071-redesign-expedition.md), a rune divider, the mock rooms
// colhead (遠征房 N/M 稼働 -- REAL counts derived from the rooms list),
// and the rooms list is a responsive card grid in which the expanded
// card spans the full row (the mock's 3-column master/detail geometry
// is not reproducible without moving the Monitor OUT of its room card,
// which the E2E containment contract + the one-Pixi-app-per-monitor
// lifecycle both forbid).
//
// REQ-0072 (MJOLNIR warehouse; mock: web/redesign/warehouse.html): the
// pagehead strip + key art now switch identity with the active tab --
// the warehouse tab wears the mock's MUNINN'S HOARD kicker / 宝物庫
// title / bg_warehouse.jpg (and the divider's ᚷ rune) while the rooms
// view keeps the REQ-0071 expedition identity. The already-fetched
// rooms + dungeons are passed down to WarehouseTab so a row's
// sourceRoomId resolves to a real dungeon display name (provenance
// chip) with no second fetch path.
//
// REQ-0086: the Warehouse tab described above has been PROMOTED to its
// own top-level route + Nav.tsx rail entry (client/src/warehouse/
// WarehousePage.tsx, an extraction of the former WarehouseTab.tsx with
// no behavior change). This page now owns ONLY the Rooms view -- the
// tab toggle, the onWarehouse pagehead-identity swap, and the
// WarehouseTab embed are all removed; the pagehead permanently wears
// the Expedition identity it used to share with the Rooms tab. This
// supersedes REQ-0036 golden-f's original "Warehouse tab inside
// Schedule screen" placement -- see WarehousePage.tsx's own module
// comment for the full rationale.
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
import { Monitor } from './Monitor';
import { RoomCard } from './RoomCard';
import { SealPanel } from './SealPanel'; // REQ-0058
import { SlotsPanel } from './SlotsPanel';
import { SpoilsRail } from './SpoilsRail';

interface SchedulePageProps {
  locale: Locale;
}

// Rooms list poll cadence -- generous (this list only needs to notice a
// NEW auto-started run or a cooldown clearing; per-run event detail
// polling at a faster cadence is Monitor.tsx's own, separate concern for
// whichever room is currently expanded).
const ROOMS_POLL_MS = 4000;

export function SchedulePage({ locale }: SchedulePageProps) {
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
  // REQ-0100: bumped whenever the watched room's run settles (Monitor
  // detects settle) so the spoils rail refreshes its warehouse preview.
  const [spoilsRefresh, setSpoilsRefresh] = useState(0);

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
        // REQ-0168 U1: a successful create now gives immediate feedback --
        // collapse the create panel, select (watch) the brand-new room so
        // the detail pane shows its slots, and scroll its card into view.
        // Uses apiCreateRoom's own {ok, room} return so the new id is known
        // without guessing at list order.
        const { room } = await apiCreateRoom(body);
        setCreateOpen(false);
        setExpandedRoomId(room.id);
        await reloadRooms();
        // Best-effort: bring the new (now top-of-list, see U5 sort) card
        // into view once it has rendered.
        window.setTimeout(() => {
          document.querySelector(`[data-room-id="${room.id}"]`)?.scrollIntoView({ block: 'nearest' });
        }, 0);
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
  // REQ-0168 U5: pure display sort -- non-canceled first (createdAt DESC),
  // canceled last (also createdAt DESC), so a freshly created room lands at
  // the top of the list and the order stays stable across the 4s polls
  // (server storage order is arbitrary/append-ish).
  const visibleRooms = (rooms ? (hideCanceled ? rooms.filter((r) => r.status !== 'canceled') : rooms) : [])
    .slice()
    .sort((a, b) => {
      const aCanceled = a.status === 'canceled' ? 1 : 0;
      const bCanceled = b.status === 'canceled' ? 1 : 0;
      if (aCanceled !== bCanceled) return aCanceled - bCanceled;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  // REQ-0071: the mock colhead's 「遠征房 2/3 稼働」 -- real counts
  // (running = status 'active'; total = every non-canceled room).
  const runningCount = rooms ? rooms.filter((r) => r.status === 'active').length : 0;
  const liveRoomCount = rooms ? rooms.filter((r) => r.status !== 'canceled').length : 0;
  // Force the create panel open whenever the caller has zero rooms --
  // nothing else useful to show, and a brand-new/fully-cleared account
  // shouldn't have to know a toggle exists just to find the only action
  // available.
  const showCreatePanel = createOpen || (rooms !== null && rooms.length === 0);
  // REQ-0097: the room whose detail (slots + shared monitor) fills the center pane.
  const selectedRoom = expandedRoomId ? rooms?.find((r) => r.id === expandedRoomId) ?? null : null;

  const pageSub = t(locale, 'schedule.pageSub');
  const pageTitle = t(locale, 'schedule.pageTitle');
  const pageLede = t(locale, 'schedule.pageLede');

  return (
    <div className="schedule-page">
      {/* REQ-0071: full-viewport key art behind the page (mock .bgart) --
          referenced from the served /redesign/assets path, never bundled
          (same convention as .canvas-bgart, REQ-0070). position:fixed but
          nested inside this route-owned tree, so it unmounts with it. */}
      <div className="expedition-bgart" aria-hidden="true" />

      {/* REQ-0071: pagehead strip (mock .pagehead, adapted -- see module
          comment for what had no backing data and was omitted). REQ-0086:
          Warehouse moved to its own route (WarehousePage.tsx) with its
          own permanent pagehead identity -- this page keeps only the
          Expedition identity now, no more tab toggle / swap. */}
      <section className="schedule-pagehead">
        <div className="schedule-pagehead-main">
          {pageSub ? <div className="schedule-pagehead-kicker den">{pageSub}</div> : null}
          <h1 className="schedule-pagehead-title dj dj-wide">{pageTitle}</h1>
          <div className="schedule-pagehead-lede">{pageLede}</div>
        </div>
      </section>
      <div className="rune-divider schedule-pagehead-divider" aria-hidden="true">
        ᚱ
      </div>

      <div className="schedule-master-detail">
        <div className="schedule-rooms-col" data-testid="schedule-rooms-col">
          {loadError ? <div className="schedule-error">{t(locale, 'schedule.loadFailed')}{loadError}</div> : null}

          {/* REQ-0071: mock rooms colhead -- den label + live counts. */}
          <div className="schedule-colhead">
            <span className="schedule-colhead-den den">{t(locale, 'schedule.roomsDen')}</span>
            {rooms !== null ? (
              <span className="schedule-colhead-count t-micro">
                {t(locale, 'schedule.roomsActive', { running: runningCount, total: liveRoomCount })}
              </span>
            ) : null}
          </div>

          {hasRooms ? (
            <div className="schedule-rooms-toolbar">
              <button
                type="button"
                className="btn schedule-create-toggle-btn"
                onClick={() => setCreateOpen((o) => !o)}
                data-testid="schedule-create-toggle"
              >
                {showCreatePanel ? t(locale, 'schedule.collapse') : t(locale, 'schedule.createToggle')}
              </button>
              {canceledCount > 0 ? (
                <label className="chip schedule-hide-canceled-toggle">
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
            <div className="panel ornate schedule-create-panel">
              <i className="k tl" />
              <i className="k tr" />
              <i className="k br" />
              <i className="k bl" />
              <h3 className="dj">{t(locale, 'schedule.createTitle')}</h3>
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
        <div className="schedule-detail-pane" data-testid="schedule-detail-pane">
          {selectedRoom ? (
            <>
              <SlotsPanel room={selectedRoom} locale={locale} rooms={rooms ?? []} onChanged={reloadRooms} />
              <Monitor key={selectedRoom.id} room={selectedRoom} locale={locale} dungeonName={dungeonNameFor(selectedRoom.dungeonId)} isAdmin={isAdmin} onRunSettled={() => setSpoilsRefresh((n) => n + 1)} />
            </>
          ) : (
            <div className="schedule-detail-empty" data-testid="schedule-detail-empty">{t(locale, 'schedule.detail.empty')}</div>
          )}
        </div>
        <div className="schedule-spoils-col" data-testid="schedule-spoils-col">
          <div className="schedule-spoils-col-title den">{t(locale, 'schedule.spoils.colTitle')}</div>
          {/* REQ-0058: Sealed Seed Share -- mint/join/compare sealed runs. */}
          <SealPanel
            locale={locale}
            dungeons={dungeons}
            onOpenRoom={(roomId) => setExpandedRoomId(roomId)}
            onRoomsChanged={reloadRooms}
          />
          <SpoilsRail locale={locale} refreshSignal={spoilsRefresh} />
        </div>
      </div>
    </div>
  );
}
