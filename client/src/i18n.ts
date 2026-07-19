// Client chrome i18n -- REQ-0038. Standard EN-keyed dictionary + t()
// lookup, replacing the scattered inline `locale === 'ja' ? '...' : '...'`
// ternaries every chrome component used to carry directly. This module
// covers UI CHROME strings only (nav labels, buttons, status text,
// placeholders, tooltips) -- it is a SEPARATE concern from content i18n
// (item/SI name/flavor text, which lives in content/live/*.json's
// `i18n.ja.{name,flavor}` map, served by server/api.cjs and read via
// client/src/api.ts's ApiItemEntry/ApiSIEntry -- see Dex.tsx/
// ItemDetailCard.tsx for that side). Both are driven by the SAME single
// `Locale` state (store.ts's `locale` field / setLocale()) -- switching
// the one JA/EN toggle in Header.tsx flips both the chrome dictionary
// AND which content-locale fields the Dex reads, per the REQ-0038 design
// note ("language toggle drives both content and chrome").
//
// No i18n library dependency -- this is intentionally a plain object +
// one lookup function, matching the rest of this app's "no framework
// beyond React/PixiJS" posture. Keys are grouped by feature area (dot-
// path-free, flat -- e.g. 'nav.backpacks', 'dex.searchPlaceholder') so a
// component only imports the keys it actually uses; there is no runtime
// namespacing/nesting to resolve.//
// REQ-0145b (ce): this file is now the BARREL over src/i18n/ per-domain
// modules (nav / common / canvas / dex / schedule / warehouse / workshop /
// market / ragnarok / settings), each contributing its en/ja key group.
// The merged DICT below is type- and value-identical to the old flat
// dictionary (gated at the split commit: key sets AND values equal, en+ja,
// both directions -- scripts/dump_module_exports.mjs --values diff).
// ADD NEW KEYS IN THE MATCHING src/i18n/*.ts MODULE, NOT HERE -- a new
// feature area gets a new module + one import/spread line below.
import type { Locale } from './store';
import { navEn, navJa } from './i18n/nav';
import { commonEn, commonJa } from './i18n/common';
import { canvasEn, canvasJa } from './i18n/canvas';
import { dexEn, dexJa } from './i18n/dex';
import { scheduleEn, scheduleJa } from './i18n/schedule';
import { sortieEn, sortieJa } from './i18n/sortie'; // REQ-0239
import { warehouseEn, warehouseJa } from './i18n/warehouse';
import { workshopEn, workshopJa } from './i18n/workshop';
import { marketEn, marketJa } from './i18n/market';
import { ragnarokEn, ragnarokJa } from './i18n/ragnarok';
import { settingsEn, settingsJa } from './i18n/settings';
import { guideEn, guideJa } from './i18n/guide';

/** The merged chrome dictionary. Exported for the key-parity gate and
 * future tooling ONLY -- UI code goes through t(), never DICT directly.
 * Spreads are key-disjoint by construction (buckets partition the key
 * prefixes), so merge order cannot change the result. */
export const DICT = {
  en: { ...navEn, ...commonEn, ...canvasEn, ...dexEn, ...scheduleEn, ...sortieEn, ...warehouseEn, ...workshopEn, ...marketEn, ...ragnarokEn, ...settingsEn, ...guideEn },
  ja: { ...navJa, ...commonJa, ...canvasJa, ...dexJa, ...scheduleJa, ...sortieJa, ...warehouseJa, ...workshopJa, ...marketJa, ...ragnarokJa, ...settingsJa, ...guideJa },
} as const;

export type TranslationKey = keyof typeof DICT.en;

/**
 * Translates `key` for `locale`, substituting any `{placeholder}` tokens
 * from `args` (e.g. t('en', 'invite.welcome', {name: 'Alice'}) ->
 * "Welcome, Alice!"). Falls back to the EN string if `locale` somehow
 * lacks the key (should not happen -- both DICT.en/DICT.ja are built from
 * the same key set at compile time via TranslationKey -- but defensive
 * against a future key added to only one side by mistake).
 */
export function t(locale: Locale, key: TranslationKey, args?: Record<string, string | number>): string {
  const table = DICT[locale] ?? DICT.en;
  let str: string = (table as Record<string, string>)[key] ?? DICT.en[key] ?? key;
  if (args) {
    for (const argKey in args) {
      str = str.split(`{${argKey}}`).join(String(args[argKey]));
    }
  }
  return str;
}
