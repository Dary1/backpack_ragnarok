// Global nav bar — REQ-0034. Renders next to the "backpack_ragnarok" title
// (composed into Header.tsx). Five routes, hash-synced via store.ts's
// setRoute()/Route type. Active item highlighted using the same
// cyan-accent / dim-default convention as .inv-tab/.preset-tab (index.css)
// -- see .nav-link/.nav-link-active below.
import type { Locale, Route } from './store';
import { setRoute } from './store';

interface NavItem {
  route: Route;
  ja: string;
  en: string;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'backpacks', ja: 'バックパックス', en: 'Backpacks' },
  { route: 'schedule', ja: 'スケジュール', en: 'Schedule' },
  { route: 'friends', ja: 'フレンズ', en: 'Friends' },
  { route: 'dex', ja: '図鑑', en: 'Dex' },
  { route: 'settings', ja: '設定', en: 'Settings' },
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
          {locale === 'ja' ? item.ja : item.en}
        </button>
      ))}
    </nav>
  );
}
