// Global nav bar — REQ-0034, migrated to formal chrome i18n (REQ-0038,
// see ./i18n.ts). Renders next to the "backpack_ragnarok" title (composed
// into Header.tsx). Five routes, hash-synced via store.ts's setRoute()/
// Route type. Active item highlighted using the same cyan-accent /
// dim-default convention as .inv-tab/.preset-tab (index.css) -- see
// .nav-link/.nav-link-active below.
import { t, type TranslationKey } from './i18n';
import type { Locale, Route } from './store';
import { setRoute } from './store';

interface NavItem {
  route: Route;
  key: TranslationKey;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'backpacks', key: 'nav.backpacks' },
  { route: 'schedule', key: 'nav.schedule' },
  { route: 'workshop', key: 'nav.workshop' }, // REQ-0042
  { route: 'friends', key: 'nav.friends' },
  { route: 'dex', key: 'nav.dex' },
  { route: 'settings', key: 'nav.settings' },
];

interface NavProps {
  active: Route;
  locale: Locale;
}

export function Nav({ active, locale }: NavProps) {
  return (
    <nav className="global-nav" aria-label="primary">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.route}
          type="button"
          className={`nav-link${item.route === active ? ' nav-link-active' : ''}`}
          aria-current={item.route === active ? 'page' : undefined}
          onClick={() => setRoute(item.route)}
        >
          {t(locale, item.key)}
        </button>
      ))}
    </nav>
  );
}
