// One room's card -- REQ-0036 P1-C. Status label, current dungeon level,
// next-run countdown (computed client-side from cooldownUntil, ticked
// every second via plain setInterval/Date.now() -- no library needed for
// this), cancel button, and an expand toggle that reveals the SlotsPanel
// + Monitor for this room.
//
// UX pass (schedule-ux-improvements): the collapsed card used to show
// nothing but an opaque room_xxxxxxx id + level, so same-level rooms
// were indistinguishable at a glance -- now also shows the resolved
// dungeon display name (passed down from SchedulePage.tsx, which joins
// room.dungeonId against the already-fetched dungeons list, same
// localizedName() CreateRoomForm.tsx uses) and a formatted createdAt
// (room document already carries this field field-for-field from the
// server, see api.ts's ApiRoom -- nothing new to fetch). Also swaps the
// native window.confirm() cancel prompt for an inline confirm row that
// matches the rest of this dark theme (still just local state + two
// buttons -- no modal library, same "no library" posture as this file's
// own countdown formatter already has).
//
// REQ-0071 (MJOLNIR re-skin; mock: web/redesign/expedition.html's .room
// cards): the card adopts the mock anatomy -- ornate panel + gold-knot
// corners, a circular emblem (the mock's emblem_*.png images are
// placeholder art, so the disc renders the dungeon name's own first
// glyph instead -- honest, derived from real data), the dungeon name in
// the display serif with an inline Lv, a status CHIP row (dot colors per
// status, cooldown countdown as its own chip beside it, and the mock's
// 「◆ 監視中」marker while this card is the expanded/watched one), and
// the mock's 2x2 slot-preview grid (壱/弐/参/肆 numerals via i18n; slot
// entries resolve squadIndex -> the player's own squad names from the
// SAME store snapshot SlotsPanel already reads -- real data, no new
// fetch). The mock's lap counter / reward multiplier footer (周回 2/3 ・
// 報酬倍率 ×1.2), Jormungandr cooldown RING, and the locked/未踏 room
// variant have no backing data and are omitted -- see
// docs/REQ-0071-redesign-expedition.md. BEHAVIOR UNCHANGED: status
// derivation, countdown arithmetic, cancel flow (inline confirm +
// cancelRoom call) and every data-testid/class the E2E suite selects are
// exactly as before.
import { useEffect, useState } from 'react';
import { cancelRoom as apiCancelRoom, cancelTroop as apiCancelTroop, type ApiRoom } from '../api';
import { isOwnSeat, isRecruiting, isTroopRoom, seatsTaken } from './seats'; // REQ-0337
import { t, type TranslationKey } from '../i18n';
import type { Locale } from '../store';
import { useGameStore } from '../store';

interface RoomCardProps {
  room: ApiRoom;
  locale: Locale;
  /** Resolved display name for room.dungeonId. Falls back to
   * schedule.dungeonUnknown (existing key) if the id doesn't match
   * anything currently in the dungeons list. */
  dungeonName: string;
  /** REQ-0071: resolved display name for room.dungeonType (the dungeons
   * payload's `types` list, same localizedName() convention as
   * dungeonName). Undefined for a legacy room without the field, or
   * while the dungeons list hasn't loaded -- the meta line simply skips
   * it. */
  dungeonTypeName?: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onChanged: () => void | Promise<void>;
}

type RoomUiStatus = 'idle' | 'cooldown' | 'running' | 'cancelPending' | 'canceled' | 'recruiting';

/** Derives the room's own friendly UI status (per the task brief's exact
 * mapping): 'running' = status:'active'; 'cancelPending' =
 * cancelRequested:true (checked before cooldown/idle, since a
 * cancel-after-current-run flag is meaningful even while technically
 * 'open'); 'cooldown' = status:'open' with cooldownUntil in the future;
 * 'idle' = status:'open', slots incomplete or cooldown already elapsed;
 * 'canceled' = status:'canceled'. */
function deriveStatus(room: ApiRoom): RoomUiStatus {
  if (room.status === 'canceled') return 'canceled';
  // REQ-0337: a Troop still gathering its four squads. Checked BEFORE the
  // cancelRequested/active/cooldown branches: REQ-0324 deliberately parks a
  // recruiting Troop's `status` OFF the solo run lanes ('recruiting', not
  // 'open'), so without this it would fall through to the 'idle' default and
  // read as a dormant solo room, which is exactly wrong -- it is waiting on
  // PEOPLE, not on a cooldown.
  if (isRecruiting(room)) return 'recruiting';
  // Checked BEFORE the plain 'active' -> 'running' mapping: a room that
  // is currently running but flagged cancelRequested (golden g,
  // cancelPolicy.immediate:false) should read as "cancel pending" to the
  // player, not plainly "running" -- the cancellation is already
  // committed, only deferred until the in-flight run settles.
  if (room.cancelRequested) return 'cancelPending';
  if (room.status === 'active') return 'running';
  if (room.cooldownUntil && Date.parse(room.cooldownUntil) > Date.now()) return 'cooldown';
  return 'idle';
}

const STATUS_KEY: Record<RoomUiStatus, TranslationKey> = {
  idle: 'schedule.statusIdle',
  cooldown: 'schedule.statusCooldown',
  running: 'schedule.statusRunning',
  cancelPending: 'schedule.statusCancelPending',
  canceled: 'schedule.statusCanceled',
  recruiting: 'schedule.statusRecruiting',
};

// REQ-0071: the mock numbers its four slots 壱/弐/参/肆 -- localized via
// i18n (EN uses roman numerals).
const ORD_KEYS: readonly TranslationKey[] = ['schedule.room.ord1', 'schedule.room.ord2', 'schedule.room.ord3', 'schedule.room.ord4'];
const SQUAD_SLOTS = 4;

/** Formats a millisecond duration as "Xm Ys" / "Ys" -- small, dependency-
 * free, matches this codebase's existing "no library for simple
 * countdown formatting" posture (see store.ts's welcome-banner timer for
 * the same spirit, though that one doesn't render a countdown string). */
export function formatCountdown(ms: number, locale: Locale): string {
  const totalSecs = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  // REQ-0168 U13(c): JA renders its own 「3分51秒」shaped units, not the
  // EN 「3m 51s」form -- callers thread the active locale through.
  if (locale === 'ja') return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function RoomCard({ room, locale, dungeonName, dungeonTypeName, expanded, onToggleExpand, onChanged }: RoomCardProps) {
  // REQ-0071: squad names for the slot-preview grid -- same snapshot
  // source SlotsPanel.tsx's dropdown options already read.
  const snapshot = useGameStore();
  const squadNames = snapshot.state?.presets?.names ?? [];
  const [now, setNow] = useState(() => Date.now());
  const [cancelPending, setCancelPending] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const status = deriveStatus(room);
  const troop = isTroopRoom(room);
  // REQ-0337: the live seat fill, the ONE number that matters while a Troop
  // recruits ("2/4"). Derived from the slots the 4s rooms poll already returns
  // -- no extra fetch, no second poll loop.
  const taken = seatsTaken(room);
  const cooldownRemainingMs = room.cooldownUntil ? Date.parse(room.cooldownUntil) - now : 0;
  const createdAtLabel = new Date(room.createdAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

  // REQ-0337: a Troop MUST be disbanded through POST /api/schedule/troops/:id/
  // cancel, never through the solo DELETE /api/schedule/rooms/:id this button has
  // always sent. The solo path is owner-guarded and would "work" for the host --
  // silently, and wrongly: it returns NO seats to the other members (their uids
  // stay deploy-gated and market-frozen) and emits NO REQ-0327 troop_disbanded
  // notification, so every recruit is stranded with no signal. Same button, same
  // confirm row; only the endpoint differs.
  const runCancel = async () => {
    setConfirmingCancel(false);
    setCancelPending(true);
    try {
      if (troop) await apiCancelTroop(room.id);
      else await apiCancelRoom(room.id);
      await onChanged();
    } finally {
      setCancelPending(false);
    }
  };

  return (
    <article
      className={`panel ornate schedule-room-card schedule-room-status-${status}${expanded ? ' schedule-room-card-open' : ''}`}
      data-testid="schedule-room-card"
      data-room-id={room.id}
      data-room-status={status}
      role="button"
      tabIndex={0}
      aria-pressed={expanded}
      onClick={onToggleExpand}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggleExpand();
        }
      }}
    >
      <i className="k tl" />
      <i className="k tr" />
      <i className="k br" />
      <i className="k bl" />

      <div className="schedule-room-head">
        {/* The mock's circular emblem art is a placeholder asset -- the
            disc shows the dungeon name's own first glyph instead. */}
        <span className="schedule-room-emblem dj" aria-hidden="true">
          {dungeonName.charAt(0)}
        </span>
        <div className="schedule-room-head-main">
          <div className="schedule-room-name dj">
            <span data-testid="schedule-room-dungeon">{dungeonName}</span>
            <span className="schedule-room-lv den">{t(locale, 'schedule.levelLine', { level: room.level })}</span>
          </div>
          <div className="schedule-room-meta t-micro">
            {dungeonTypeName ? <span className="schedule-room-type">{dungeonTypeName}</span> : null}
            <span data-testid="schedule-room-created">{createdAtLabel}</span>
          </div>
        </div>
      </div>

      <div className="schedule-room-status-row">
        <span className={`chip schedule-status-badge schedule-status-badge-${status}`} data-testid="schedule-room-status-badge">
          <span className="dot" aria-hidden="true" />
          {t(locale, STATUS_KEY[status])}
        </span>
        {status === 'cooldown' ? (
          <span className="chip schedule-room-countdown tnum" data-testid="schedule-room-countdown">
            {t(locale, 'schedule.nextRunIn', { time: formatCountdown(cooldownRemainingMs, locale) })}
          </span>
        ) : null}
        {/* REQ-0337: seat fill, shown only while a Troop is actually recruiting --
            once it departs the count is a constant 4/4 and says nothing. */}
        {troop && status === 'recruiting' ? (
          <span className="chip schedule-room-seats tnum" data-testid="schedule-room-seats">
            {t(locale, 'schedule.room.seatsFilled', { taken, total: room.slots.length })}
          </span>
        ) : null}
        <span className="schedule-room-grow" aria-hidden="true" />
        {expanded ? <span className="schedule-room-watching t-micro">{t(locale, 'schedule.room.watching')}</span> : null}
      </div>

      {/* REQ-0071: the mock's 2x2 slot-preview grid on the collapsed
          card -- squadIndex resolved to the player's own squad names. */}
      <div className="schedule-room-slots">
        {Array.from({ length: SQUAD_SLOTS }, (_, i) => {
          const slot = room.slots[i];
          const squadIndex = slot && slot.squadIndex != null ? slot.squadIndex : null;
          // REQ-0337: on a co-op Troop a seat's `squadIndex` indexes THAT SEAT
          // OWNER's canvas, not the viewer's. Resolving someone else's index
          // against our own `squadNames` would confidently print the wrong squad
          // name, so a seat we do not own is labelled as a recruit instead.
          // (Every room here came from listOwnRooms, so room.ownerId IS the
          // viewer -- see schedule/seats.ts.)
          const ownSeat = !troop || isOwnSeat(slot, room);
          const name = squadIndex == null
            ? null
            : ownSeat
              ? squadNames[squadIndex] ?? `P${squadIndex + 1}`
              : t(locale, 'schedule.room.slotRecruit');
          const emptyLabel = status === 'recruiting'
            ? t(locale, 'schedule.room.slotOpenSeat')
            : t(locale, 'schedule.room.slotEmpty');
          return (
            <span
              key={i}
              className={`schedule-room-slot${name == null ? (status === 'recruiting' ? ' schedule-room-slot-empty schedule-room-slot-open' : ' schedule-room-slot-empty') : ''}${name != null && !ownSeat ? ' schedule-room-slot-recruit' : ''}`}
              data-testid={`schedule-room-slot-chip-${i}`}
            >
              <b>{t(locale, ORD_KEYS[i])}</b>:{name ?? emptyLabel}
            </span>
          );
        })}
      </div>

      <div className="schedule-room-foot">
        <span className="schedule-room-id">
          {t(locale, 'schedule.roomId')} {room.id.slice(0, 12)}
        </span>
        <span className="schedule-room-grow" aria-hidden="true" />
        <div className="schedule-room-card-actions">
          <button
            type="button"
            className="schedule-expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            data-testid="schedule-room-expand-toggle"
          >
            {expanded ? t(locale, 'schedule.unwatch') : t(locale, 'schedule.watch')}
          </button>
          {status !== 'canceled' && !confirmingCancel ? (
            <button type="button" className="schedule-cancel-btn" onClick={(e) => { e.stopPropagation(); setConfirmingCancel(true); }} disabled={cancelPending} data-testid="schedule-room-cancel-btn">
              {t(locale, 'schedule.cancelButton')}
            </button>
          ) : null}
        </div>
      </div>

      {confirmingCancel ? (
        <div className="schedule-room-cancel-confirm" data-testid="schedule-room-cancel-confirm" onClick={(e) => e.stopPropagation()}>
          <span>{t(locale, 'schedule.cancelConfirm')}</span>
          <div className="schedule-room-cancel-confirm-actions">
            <button type="button" className="schedule-cancel-btn" onClick={(e) => { e.stopPropagation(); void runCancel(); }} disabled={cancelPending} data-testid="schedule-room-cancel-confirm-yes">
              {t(locale, 'schedule.cancelConfirmYes')}
            </button>
            <button type="button" className="schedule-expand-btn" onClick={(e) => { e.stopPropagation(); setConfirmingCancel(false); }} disabled={cancelPending} data-testid="schedule-room-cancel-confirm-no">
              {t(locale, 'schedule.cancelConfirmNo')}
            </button>
          </div>
        </div>
      ) : null}

    </article>
  );
}
