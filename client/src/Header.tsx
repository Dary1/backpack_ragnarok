// App header — REQ-0026 T0.1: title, data-source badge, JA/EN toggle.
// Extended REQ-0027 T0.2 with Save/Load buttons; REQ-0031 Phase B RETIRES
// those buttons (auto-save runs in the background after every mutation --
// see store.ts's notifyStateChanged()/scheduleAutoSave()) and replaces the
// old one-shot ioStatus line with a small persistent auto-save indicator:
// "saved ✓" / "saving…" / "offline" (store.ts's autoSaveStatus). Load stays
// fully automatic at boot (main.tsx calls store.ts's boot(), unchanged).
// REQ-0038: status text + the lang-toggle button label go through
// ./i18n.ts's t() instead of an inline STATUS_TEXT/ternary table.
//
// REQ-0069: the global Nav moved OUT of this header into the MJOLNIR
// left rail (see Nav.tsx; App.tsx composes both side by side now), and
// the header itself is restyled as the mock's slim sticky HUD bar
// (index.css .app-header). Contents are unchanged on purpose — the h1
// title, .data-source-badge, .auto-save-status and .lang-toggle keep
// their exact classes/text (the E2E suite selects on all four); the
// page-port REQs (0070+) will grow the HUD (resources/season chips)
// per the mock once that data exists in the client.
import { t } from './i18n';
import { TmHud } from './TmHud'; // REQ-0205: global held-TM balance strip
import { NotificationBell } from './notify/NotificationBell'; // REQ-0368
import type { DataSource, Locale } from './store';

interface HeaderProps {
  source: DataSource | null;
  locale: Locale;
  onToggleLocale: () => void;
  autoSaveStatus: 'saved' | 'saving' | 'offline';
}

const STATUS_KEY: Record<'saved' | 'saving' | 'offline', 'header.status.saved' | 'header.status.saving' | 'header.status.offline'> = {
  saved: 'header.status.saved',
  saving: 'header.status.saving',
  offline: 'header.status.offline',
};

const STATUS_COLOR: Record<'saved' | 'saving' | 'offline', string> = {
  saved: '#5cb573',
  saving: '#9a917f',
  offline: '#c05050',
};

export function Header({ source, locale, onToggleLocale, autoSaveStatus }: HeaderProps) {
  const badgeLabel = source === 'live' ? 'live' : source === 'error' ? 'error' : '…';
  const badgeClass = source === 'live' ? 'badge-live' : source === 'error' ? 'badge-error' : 'badge-pending';
  return (
    <header className="app-header">
      <h1>backpack_ragnarok</h1>
      {/* REQ-0205: held-TM balance HUD -- renders on every route via this
          app-wide header; self-renders null when the player holds no TM. */}
      <TmHud />
      <div className="header-controls">
        {/* REQ-0368: the notification bell. Placed FIRST in the control
            cluster so the unread count sits at the edge of the HUD where the
            eye lands, ahead of the status chips. The four E2E-selected
            elements below (.data-source-badge, .auto-save-status,
            .lang-toggle, the h1) keep their exact classes and order. */}
        <NotificationBell locale={locale} />
        <span className={`data-source-badge ${badgeClass}`}>{badgeLabel}</span>
        <span className="auto-save-status" style={{ color: STATUS_COLOR[autoSaveStatus] }} data-status={autoSaveStatus}>
          {t(locale, STATUS_KEY[autoSaveStatus])}
        </span>
        <button type="button" className="lang-toggle" onClick={onToggleLocale}>
          {t(locale, 'header.langToggle')}
        </button>
      </div>
    </header>
  );
}
