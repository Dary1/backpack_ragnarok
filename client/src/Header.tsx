// App header — REQ-0026 T0.1: title, data-source badge, JA/EN toggle.
// Extended REQ-0027 T0.2 with Save/Load buttons; REQ-0031 Phase B RETIRES
// those buttons (auto-save runs in the background after every mutation --
// see store.ts's notifyStateChanged()/scheduleAutoSave()) and replaces the
// old one-shot ioStatus line with a small persistent auto-save indicator:
// "saved ✓" / "saving…" / "offline" (store.ts's autoSaveStatus). Load stays
// fully automatic at boot (main.tsx calls store.ts's boot(), unchanged).
// REQ-0034 adds the global Nav bar next to the title (see Nav.tsx).
import { Nav } from './Nav';
import type { DataSource, Locale, Route } from './store';

interface HeaderProps {
  source: DataSource | null;
  locale: Locale;
  onToggleLocale: () => void;
  autoSaveStatus: 'saved' | 'saving' | 'offline';
  route: Route;
}

const STATUS_TEXT: Record<'saved' | 'saving' | 'offline', { ja: string; en: string }> = {
  saved: { ja: '保存済み ✓', en: 'saved ✓' },
  saving: { ja: '保存中…', en: 'saving…' },
  offline: { ja: 'オフライン', en: 'offline' },
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
          {STATUS_TEXT[autoSaveStatus][locale]}
        </span>
        <button type="button" className="lang-toggle" onClick={onToggleLocale}>
          {locale === 'ja' ? '🇬🇧 EN' : '🇯🇵 日本語'}
        </button>
      </div>
    </header>
  );
}
