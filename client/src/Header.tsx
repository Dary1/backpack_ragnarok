// App header — REQ-0026 T0.1: title, data-source badge, JA/EN toggle.
// Extended REQ-0027 T0.2 with Save/Load buttons; REQ-0031 Phase B RETIRES
// those buttons (auto-save runs in the background after every mutation --
// see store.ts's notifyStateChanged()/scheduleAutoSave()) and replaces the
// old one-shot ioStatus line with a small persistent auto-save indicator:
// "saved ✓" / "saving…" / "offline" (store.ts's autoSaveStatus). Load stays
// fully automatic at boot (main.tsx calls store.ts's boot(), unchanged).
// REQ-0034 adds the global Nav bar next to the title (see Nav.tsx).
// REQ-0038: status text + the lang-toggle button label now go through
// ./i18n.ts's t() instead of an inline STATUS_TEXT/ternary table.
import { Nav } from './Nav';
import { t } from './i18n';
import type { DataSource, Locale, Route } from './store';

interface HeaderProps {
  source: DataSource | null;
  locale: Locale;
  onToggleLocale: () => void;
  autoSaveStatus: 'saved' | 'saving' | 'offline';
  route: Route;
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

export function Header({ source, locale, onToggleLocale, autoSaveStatus, route }: HeaderProps) {
  const badgeLabel = source === 'live' ? 'live' : source === 'error' ? 'error' : '…';
  const badgeClass = source === 'live' ? 'badge-live' : source === 'error' ? 'badge-error' : 'badge-pending';
  return (
    <header className="app-header">
      <div className="header-title-row">
        <h1>backpack_ragnarok</h1>
        <Nav active={route} locale={locale} />
      </div>
      <div className="header-controls">
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
