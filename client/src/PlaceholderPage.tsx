// Placeholder route content — REQ-0034, migrated to formal chrome i18n
// (REQ-0038). Used for Schedule/Friends until their own features land
// (REQ-0036 owns Schedule; Friends has no REQ yet). Titled, empty,
// bilingual "coming soon" note, now driven by ./i18n.ts's t() instead of
// a locale ternary + hand-passed ja/en title pair -- `titleKey` reuses
// the SAME nav.* dictionary keys Nav.tsx already has (one source of
// truth for each route's display name).
import { t, type TranslationKey } from './i18n';
import type { Locale } from './store';

interface PlaceholderPageProps {
  titleKey: TranslationKey;
  locale: Locale;
}

export function PlaceholderPage({ titleKey, locale }: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      <h2>{t(locale, titleKey)}</h2>
      <p className="placeholder-note">{t(locale, 'placeholder.comingSoon')}</p>
    </div>
  );
}
