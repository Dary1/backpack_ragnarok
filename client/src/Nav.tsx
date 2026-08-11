// Global nav — REQ-0034, i18n'd in REQ-0038, restyled to the MJOLNIR
// left rail in REQ-0069 (design mock: web/redesign/*'s <nav class="rail">).
//
// Structure now: a fixed left rail (bottom bar under 840px, see
// index.css) containing
//   1. the LOGO (triple horn of Odin + vertical brand) ABOVE the nav
//      entries — clicking it returns to the landing/title route ('#/')
//      from anywhere (REQ-0069 requirement);
//   2. one .nav-link button per route, each a rune glyph over a short
//      label. Selector contract kept for the E2E suite: the buttons are
//      still .nav-link / .nav-link-active with the EN label text from
//      i18n.ts ('Squad', 'Schedule', ...). REQ-0377 item 9 renamed the
//      first entry's EN label 'Backpacks' -> 'Squad' and moved every
//      .nav-link hasText:'Backpacks' e2e selector in the same commit.
//
// REQ-0069 additions: '#/market' and '#/ragnarok' render PlaceholderPage
// until their own REQs land (the mock rail shows 市場/殿堂 pages). Entry
// ORDER follows the mock rail (canvas/expedition/warehouse/dex/workshop/
// market/hall) with the app-only Settings route appended. Rune glyphs for
// mock-mapped entries come straight from the mock; Settings (ᛟ othala)
// has no mock counterpart and was chosen here.
//
// REQ-0377 item 1 (user call: hide, not disable): Friends (ᚹ wunjo) is NO
// LONGER a rail entry. It had no REQ and no implementation, so the rail
// spent one of its nine slots on a door that opened onto PlaceholderPage's
// "coming soon" -- a dead door teaches the player to distrust the rail.
// The '#/friends' ROUTE and its PlaceholderPage (App.tsx) are deliberately
// KEPT: hiding is a NAV_ITEMS edit, so reviving the entry when the feature
// lands is a one-line revert, and an existing deep link still resolves.
//
// REQ-0086: lands the mock's 倉庫 (warehouse) rail entry that REQ-0069
// had explicitly deferred ("the warehouse lives as a Schedule tab
// today"; REQ-0072 only reskinned that tab in place). Rune ᚷ and rail
// position (right after 遠征/schedule) are read straight from the mock's
// shared rail markup (web/redesign/*.html), same as every other
// mock-mapped entry. This supersedes REQ-0036 golden-f's original
// "Warehouse tab inside Schedule screen" placement — see
// client/src/warehouse/WarehousePage.tsx's module comment.
// The landing itself has no rail entry — the logo IS the way back (the
// mock's 表題 rail entry collapses into the logo).
// REQ-0368: the rail carries unseen-count badges. Before this REQ it carried
// none at all while the LOWER-level inventory tabs already pulsed
// (lib/tabPulse.ts) -- the attention hierarchy was inverted. Counts come from
// the shared notification feed, so a badge clears the moment the bell is
// opened (both read the same unseen set).
import { useMemo } from 'react';
import { t, type TranslationKey } from './i18n';
import type { Locale, Route } from './store';
import { setRoute } from './store';
import { useNotificationCenter } from './notify/notifyContext';
import { navBadgeCounts } from './notify/digest';

interface NavItem {
  route: Route;
  key: TranslationKey;
  /** Decorative rune glyph shown above the label (aria-hidden). */
  rune: string;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'backpacks', key: 'nav.backpacks', rune: 'ᛗ' },
  { route: 'schedule', key: 'nav.schedule', rune: 'ᚱ' },
  { route: 'warehouse', key: 'nav.warehouse', rune: 'ᚷ' }, // REQ-0086 (mock rail slot, deferred by REQ-0069)
  { route: 'dex', key: 'nav.dex', rune: 'ᚲ' },
  { route: 'workshop', key: 'nav.workshop', rune: 'ᛈ' }, // REQ-0042
  { route: 'market', key: 'nav.market', rune: 'ᚠ' }, // REQ-0069 placeholder
  { route: 'ragnarok', key: 'nav.ragnarok', rune: 'ᛏ' }, // REQ-0069 placeholder
  { route: 'settings', key: 'nav.settings', rune: 'ᛟ' },
];

interface NavProps {
  active: Route;
  locale: Locale;
}

/** REQ-0368: the rail slots that a notification kind maps to, and the
 * screen-reader label for each. A route absent from this table never shows a
 * badge -- only halls where opening them IS the next action are badged. */
const BADGE_LABEL: Partial<Record<Route, TranslationKey>> = {
  schedule: 'notify.badge.schedule',
  warehouse: 'notify.badge.warehouse',
};

export function Nav({ active, locale }: NavProps) {
  const { notifications } = useNotificationCenter();
  const badges = useMemo(() => navBadgeCounts(notifications), [notifications]);
  const countFor = (route: Route): number =>
    route === 'schedule' ? badges.schedule : route === 'warehouse' ? badges.warehouse : 0;

  return (
    <nav className="nav-rail" aria-label="primary">
      <button
        type="button"
        className="nav-logo"
        aria-label={t(locale, 'nav.logoLabel')}
        title={t(locale, 'nav.logoLabel')}
        onClick={() => setRoute('landing')}
      >
        {/* triple horn of Odin mark — same path data as the landing logo */}
        <svg viewBox="0 0 100 84" fill="none" stroke="#C9A959" strokeWidth="3.4" strokeLinecap="round" aria-hidden="true">
          <path d="M50 12 a23 23 0 1 1 -20 34" />
          <path d="M69 27 a23 23 0 1 1 -33 27" />
          <path d="M31 27 a23 23 0 1 0 33 27" />
        </svg>
        <span className="nav-logo-text">RAGNARÖK</span>
      </button>
      {NAV_ITEMS.map((item) => {
        const count = countFor(item.route);
        const badgeKey = BADGE_LABEL[item.route];
        return (
          <button
            key={item.route}
            type="button"
            className={`nav-link${item.route === active ? ' nav-link-active' : ''}`}
            aria-current={item.route === active ? 'page' : undefined}
            onClick={() => setRoute(item.route)}
          >
            <span className="nav-rune" aria-hidden="true">
              {item.rune}
            </span>
            <span className="nav-lbl">{t(locale, item.key)}</span>
            {count > 0 && badgeKey ? (
              // Shape + number, never colour alone (REQ-0143): the two badge
              // shapes differ (round / square) and the count itself is the
              // information, so nothing here depends on hue.
              <span
                className={`nav-badge nav-badge-${item.route}`}
                data-testid={`nav-badge-${item.route}`}
                data-count={count}
                aria-label={t(locale, badgeKey, { count: String(count) })}
              >
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
