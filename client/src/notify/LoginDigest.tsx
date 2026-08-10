// client/src/notify/LoginDigest.tsx -- REQ-0368 spec item 4: the "what
// happened while I was away" modal, the single most important screen in an
// AFK-first design and the one the product did not have.
//
// It is a PURE AGGREGATION of the notification rows (buildDigest), shown
// ONCE per app boot: the first poll that lands decides. If that poll carries
// no digestible entries the modal is retired for the session -- a run that
// settles ten minutes into a play session is live news for the bell and the
// nav badges, not a login summary. Dismissing acks exactly the entries the
// summary was built from, so the bell does not then re-report the same news.
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import type { Locale } from '../store';
import { setRoute } from '../store';
import { useNotificationCenter } from './notifyContext';
import { buildDigest } from './digest';
import type { NotificationDigest } from './digest';

type Phase = 'waiting' | 'shown' | 'done';

export function LoginDigest({ locale }: { locale: Locale }) {
  const { notifications, loaded, ack } = useNotificationCenter();
  const [phase, setPhase] = useState<Phase>('waiting');
  const [digest, setDigest] = useState<NotificationDigest | null>(null);

  useEffect(() => {
    if (phase !== 'waiting' || !loaded) return;
    const d = buildDigest(notifications);
    if (d.ids.length === 0) { setPhase('done'); return; } // no news at boot -- never ask again this session
    setDigest(d);
    setPhase('shown');
  }, [phase, loaded, notifications]);

  if (phase !== 'shown' || digest === null) return null;

  const close = () => {
    ack(digest.ids);
    setPhase('done');
  };
  const goto = (route: 'schedule' | 'warehouse') => {
    close();
    setRoute(route);
  };

  return (
    <div className="scrim notify-digest-scrim" data-testid="notify-digest" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal panel ornate notify-digest" role="dialog" aria-modal="true" aria-label={t(locale, 'notify.digest.title')}>
        <i className="k tl" /><i className="k tr" /><i className="k br" /><i className="k bl" />
        <div className="row notify-digest-head">
          <h3 className="ph3 dj">{t(locale, 'notify.digest.title')}</h3>
          <span className="en">{t(locale, 'notify.digest.titleEn')}</span>
        </div>
        <ul className="notify-digest-rows">
          {digest.wins + digest.losses > 0 ? (
            <li className="notify-digest-row" data-testid="notify-digest-runs">
              <span className="notify-digest-rune" aria-hidden="true">ᚱ</span>
              <span>{t(locale, 'notify.digest.runs', { wins: String(digest.wins), losses: String(digest.losses) })}</span>
            </li>
          ) : null}
          {digest.spoils > 0 ? (
            <li className="notify-digest-row" data-testid="notify-digest-spoils">
              <span className="notify-digest-rune" aria-hidden="true">ᛗ</span>
              <span>{t(locale, 'notify.digest.spoils', { count: String(digest.spoils) })}</span>
            </li>
          ) : null}
          {digest.marketSales > 0 ? (
            <li className="notify-digest-row" data-testid="notify-digest-market">
              <span className="notify-digest-rune" aria-hidden="true">ᚠ</span>
              <span>{t(locale, 'notify.digest.market', { net: String(digest.marketNet), count: String(digest.marketSales) })}</span>
            </li>
          ) : null}
          {digest.expired > 0 ? (
            <li className="notify-digest-row is-loss" data-testid="notify-digest-expired">
              <span className="notify-digest-rune" aria-hidden="true">ᚷ</span>
              <span>{t(locale, 'notify.digest.expired', { count: String(digest.expired) })}</span>
            </li>
          ) : null}
          {digest.expiring > 0 ? (
            <li className="notify-digest-row is-warn" data-testid="notify-digest-expiring">
              <span className="notify-digest-rune" aria-hidden="true">ᚷ</span>
              <span>{t(locale, 'notify.digest.expiring', { count: String(digest.expiring) })}</span>
            </li>
          ) : null}
        </ul>
        <div className="row notify-digest-actions">
          {/* Cross-refs (REQ-0368): the digest is a jumping-off point, not a
              dead end -- each CTA lands on the hall that owns the news. */}
          {digest.wins + digest.losses > 0 ? (
            <button type="button" className="btn btn-ghost" data-testid="notify-digest-goto-schedule" onClick={() => goto('schedule')}>
              {t(locale, 'notify.digest.gotoSchedule')}
            </button>
          ) : null}
          {digest.expiring + digest.expired > 0 ? (
            <button type="button" className="btn btn-ghost" data-testid="notify-digest-goto-warehouse" onClick={() => goto('warehouse')}>
              {t(locale, 'notify.digest.gotoWarehouse')}
            </button>
          ) : null}
          <button type="button" className="btn btn-forge" data-testid="notify-digest-dismiss" onClick={close}>
            {t(locale, 'notify.digest.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
