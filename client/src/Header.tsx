// App header — REQ-0026 T0.1: title, data-source badge, JA/EN toggle.
// Extended REQ-0027 T0.2: Save/Load buttons + a status line mirroring the
// mock's #canvasIoStatus (localized message, green on success / red on
// error). Both buttons call straight into store.ts's saveGame()/loadGame()
// (which own the actual fetch + in-place state replacement); this
// component only renders the current ioStatus snapshot field.
import type { DataSource, Locale } from './store';

interface HeaderProps {
  source: DataSource | null;
  locale: Locale;
  onToggleLocale: () => void;
  onSave: () => void;
  onLoad: () => void;
  ioStatus: { message: string; isError: boolean } | null;
  canEdit: boolean;
}

export function Header({ source, locale, onToggleLocale, onSave, onLoad, ioStatus, canEdit }: HeaderProps) {
  const badgeLabel = source === 'live' ? 'live' : source === 'error' ? 'error' : '…';
  const badgeClass = source === 'live' ? 'badge-live' : source === 'error' ? 'badge-error' : 'badge-pending';
  return (
    <header className="app-header">
      <h1>backpack_ragnarok</h1>
      <div className="header-controls">
        <span className={`data-source-badge ${badgeClass}`}>{badgeLabel}</span>
        {ioStatus && (
          <span className="io-status" style={{ color: ioStatus.isError ? '#c05050' : '#5cb573' }}>
            {ioStatus.message}
          </span>
        )}
        <button type="button" className="io-btn" onClick={onSave} disabled={!canEdit}>
          {locale === 'ja' ? '保存' : 'Save'}
        </button>
        <button type="button" className="io-btn" onClick={onLoad} disabled={!canEdit}>
          {locale === 'ja' ? '読込' : 'Load'}
        </button>
        <button type="button" className="lang-toggle" onClick={onToggleLocale}>
          {locale === 'ja' ? '🇬🇧 EN' : '🇯🇵 日本語'}
        </button>
      </div>
    </header>
  );
}
