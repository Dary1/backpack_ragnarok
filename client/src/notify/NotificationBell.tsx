// client/src/notify/NotificationBell.tsx -- REQ-0368 spec item 2: the header
// bell. Shows the number of UNSEEN entries; opening it lists them newest
// first and marks them read (the REQ's "mark-read on open"), which is also
// what clears the nav-rail badges, since those read the same unseen set.
//
// No poll of its own -- the feed arrives through NotificationCenter (see
// that module's header for why there is exactly one poller).
import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import type { Locale } from '../store';
import { useNotificationCenter } from './notifyContext';
import { notificationLine, notificationRune } from './notifyText';

export function NotificationBell({ locale }: { locale: Locale }) {
  const { notifications, ack } = useNotificationCenter();
  const [open, setOpen] = useState(false);
  // The list is FROZEN when the panel opens. Opening acks everything, so
  // the live unseen set empties immediately -- without a snapshot the panel
  // would blank out the instant the player looked at it.
  const [shown, setShown] = useState<typeof notifications>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const unread = notifications.length;

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function toggle() {
    if (open) { setOpen(false); return; }
    // Newest first (the feed arrives ascending by id).
    const snapshot = [...notifications].reverse();
    setShown(snapshot);
    setOpen(true);
    ack(snapshot.map((n) => n.id));
  }

  return (
    <div className="notify-bell-root" ref={rootRef}>
      <button
        type="button"
        className={`notify-bell${unread > 0 ? ' has-unread' : ''}`}
        aria-label={t(locale, 'notify.bell.label', { count: String(unread) })}
        aria-expanded={open}
        data-testid="notify-bell"
        data-unread={unread}
        onClick={toggle}
      >
        <span className="notify-bell-rune" aria-hidden="true">ᛊ</span>
        {unread > 0 ? (
          <span className="notify-bell-count" data-testid="notify-bell-count">{unread > 99 ? '99+' : unread}</span>
        ) : null}
      </button>
      {open ? (
        <div className="notify-panel panel" role="dialog" aria-label={t(locale, 'notify.bell.title')} data-testid="notify-panel">
          <div className="notify-panel-head">{t(locale, 'notify.bell.title')}</div>
          {shown.length === 0 ? (
            <div className="notify-panel-empty" data-testid="notify-panel-empty">{t(locale, 'notify.bell.empty')}</div>
          ) : (
            <ul className="notify-panel-list">
              {shown.map((n) => {
                const line = notificationLine(locale, n);
                if (line === null) return null;
                return (
                  <li key={n.id} className="notify-panel-item" data-kind={n.kind}>
                    <span className="notify-panel-rune" aria-hidden="true">{notificationRune(n.kind)}</span>
                    <span className="notify-panel-text">{line}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
