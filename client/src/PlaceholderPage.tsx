// Placeholder route content — REQ-0034. Used for スケジュール/フレンズ/設定
// (Schedule/Friends/Settings) until their own features land (REQ-0036 owns
// Schedule; Friends/Settings have no REQ yet). Titled, empty, bilingual
// "coming soon" note -- same inline locale-ternary pattern every other
// component in this app already uses (no i18n library).
import type { Locale } from './store';

interface PlaceholderPageProps {
  titleJa: string;
  titleEn: string;
  locale: Locale;
}

export function PlaceholderPage({ titleJa, titleEn, locale }: PlaceholderPageProps) {
  return (
    <div className="placeholder-page">
      <h2>{locale === 'ja' ? titleJa : titleEn}</h2>
      <p className="placeholder-note">
        {locale === 'ja' ? 'この機能は近日公開予定です。' : 'This feature is coming soon.'}
      </p>
    </div>
  );
}
