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
//      still .nav-link / .nav-link-active with the same EN label text
//      REQ-0034 shipped ('Backpacks', 'Schedule', ... — see i18n.ts).
//
// REQ-0069 additions: '#/market' and '#/ragnarok' render PlaceholderPage
// until their own REQs land (the mock rail shows 市場/殿堂 pages). Entry
// ORDER follows the mock rail (canvas/expedition/dex/workshop/market/
// hall) with the two app-only routes (Friends, Settings) appended; the
// mock's 倉庫 (warehouse) rail entry is NOT added — the warehouse lives
// as a Schedule tab today (REQ-0072 owns its page-port). Rune glyphs for
// mock-mapped entries come straight from the mock; Friends (ᚹ wunjo) and
// Settings (ᛟ othala) have no mock counterpart and were chosen here.
// The landing itself has no rail entry — the logo IS the way back (the
// mock's 表題 rail entry collapses into the logo).
import { t, type TranslationKey } from './i18n';
import type { Locale, Route } from './store';
import { setRoute } from './store';

interface NavItem {
  route: Route;
  key: TranslationKey;
  /** Decorative rune glyph shown above the label (aria-hidden). */
  rune: string;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'backpacks', key: 'nav.backpacks', rune: 'ᛗ' },
  { route: 'schedule', key: 'nav.schedule', rune: 'ᚱ' },
  { route: 'dex', key: 'nav.dex', rune: 'ᚲ' },
  { route: 'workshop', key: 'nav.workshop', rune: 'ᛈ' }, // REQ-0042
  { route: 'market', key: 'nav.market', rune: 'ᚠ' }, // REQ-0069 placeholder
  { route: 'ragnarok', key: 'nav.ragnarok', rune: 'ᛏ' }, // REQ-0069 placeholder
  { route: 'friends', key: 'nav.friends', rune: 'ᚹ' },
  { route: 'settings', key: 'nav.settings', rune: 'ᛟ' },
];

interface NavProps {
  active: Route;
  locale: Locale;
}

export function Nav({ active, locale }: NavProps) {
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
      {NAV_ITEMS.map((item) => (
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
        </button>
      ))}
    </nav>
  );
}
