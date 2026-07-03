// App header — REQ-0026 T0.1: title, data-source badge, JA/EN toggle.
// Save/Load are explicitly T0.2 (see REQ-0026 spec); this header only
// shows status for T0.1's read-only render.
import type { DataSource, Locale } from './store';

interface HeaderProps {
  source: DataSource | null;
  locale: Locale;
  onToggleLocale: () => void;
}

export function Header({ source, locale, onToggleLocale }: HeaderProps) {
  const badgeLabel = source === 'live' ? 'live' : source === 'error' ? 'error' : '…';
  const badgeClass = source === 'live' ? 'badge-live' : source === 'error' ? 'badge-error' : 'badge-pending';
  return (
    <header className="app-header">
      <h1>backpack_ragnarok</h1>
      <div className="header-controls">
        <span className={`data-source-badge ${badgeClass}`}>{badgeLabel}</span>
        <button type="button" className="lang-toggle" onClick={onToggleLocale}>
          {locale === 'ja' ? '🇬🇧 EN' : '🇯🇵 日本語'}
        </button>
      </div>
    </header>
  );
}
