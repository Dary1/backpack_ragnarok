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
// namespacing/nesting to resolve.
import type { Locale } from './store';

export type TranslationKey = keyof typeof DICT.en;

const DICT = {
  en: {
    // Nav (Nav.tsx)
    'nav.backpacks': 'Backpacks',
    'nav.schedule': 'Schedule',
    'nav.friends': 'Friends',
    'nav.dex': 'Dex',
    'nav.settings': 'Settings',

    // Header (Header.tsx)
    'header.status.saved': 'saved ✓',
    'header.status.saving': 'saving…',
    'header.status.offline': 'offline',
    'header.langToggle': '🇯🇵 日本語',

    // App shell (App.tsx)
    'app.canvasTitle': 'Canvas',
    'app.inventoryTitle': 'Inventory',
    'app.inventoryNote': 'items parked here take no effect',

    // Placeholder route (PlaceholderPage.tsx)
    'placeholder.comingSoon': 'This feature is coming soon.',

    // Invite banner (InviteBanner.tsx)
    'invite.welcome': 'Welcome, {name}!',
    'invite.dismiss': 'Dismiss',

    // Preset tabs (PresetTabs.tsx)
    'preset.add': 'Preset+',

    // Item panel (ItemPanel.tsx)
    'itemPanel.items': 'Items',
    'itemPanel.socketItems': 'Socket Items',

    // Settings (Settings.tsx)
    'settings.title': 'Settings',
    'settings.account': 'Account',
    'settings.name': 'Name',
    'settings.roles': 'Roles',
    'settings.rolesNone': '(none)',
    'settings.logout': 'Log out',
    'settings.accountLoadError': 'Failed to load account info',
    'settings.botTitle': 'API / Bot mode',
    'settings.botComingSoon': 'Coming soon',
    'settings.botNote': 'Programmatic access for bots/automation will land in a future update.',

    // Dex display (Dex.tsx)
    'dex.tabItems': 'Items',
    'dex.tabSocketItems': 'Socket Items',
    'dex.tabBps': 'BPs',
    'dex.tabSearchPresets': 'Search Presets',
    'dex.reservedTitle': 'reserved for later',
    'dex.searchPlaceholder': 'Search by name or id…',
    'dex.rarityAll': 'Rarity: all',
    'dex.tagAll': 'Tag: all',
    'dex.noMatch': 'No items match.',
    'dex.backToList': '← Back to list',

    // Dex detail (ItemDetailCard.tsx)
    'dex.detail.tags': 'Tags (hierarchy)',
    'dex.detail.type': 'type',
    'dex.detail.shape': 'Shape',
    'dex.detail.ports': 'Ports',
    'dex.detail.sockets': 'Sockets',
    'dex.detail.effects': 'Effects',
    'dex.detail.effectsNone': '(none)',
    'dex.detail.rawAst': 'Raw AST (JSON)',
    'dex.detail.flavor': 'Flavor text',
    'dex.detail.part': 'Part / assembly',
    'dex.detail.assemblesInto': 'assembles into',
    'dex.detail.role': 'role',
    'dex.detail.stretchNote': 'This item carries the stretch flag.',
    'dex.detail.provenance': 'Provenance',
    'dex.detail.provenanceUnresolved': 'No per-item provenance mapping available yet (content/registry.json has no item-id list per batch today).',
    'dex.detail.rarity': 'rarity',
    'dex.detail.diagramLabel': 'Diagram',

    // Dex root (DexRoot.tsx)
    'dex.loadFailed': 'Failed to load the dex: ',
    'dex.loading': 'Loading…',
    'dex.viewMode': 'View',
    'dex.editMode': 'Edit mode',

    // Dex admin (DexAdmin.tsx)
    'dexAdmin.selectPrompt': 'Select an item from the list to edit.',
    'dexAdmin.editing': 'Editing: ',
    'dexAdmin.rarity': 'Rarity',
    'dexAdmin.tags': 'Tags',
    'dexAdmin.tagsNote': 'tags[0] is the TYPE ROOT tag (fixed as the first slot)',
    'dexAdmin.tagsTypeFirst': 'type (first)',
    'dexAdmin.tagsAdditional': 'Additional tags (comma-separated)',
    'dexAdmin.effects': 'Effects',
    'dexAdmin.effectAdd': '+ Add effect',
    'dexAdmin.effectDelete': 'Delete',
    'dexAdmin.trigger': 'Trigger',
    'dexAdmin.verb': 'Verb',
    'dexAdmin.viewOnlyNote': 'Shape and port tiles are view-only. Geometry editing comes later (fit/art pipeline).',
    'dexAdmin.save': 'Save',
    'dexAdmin.saving': 'Saving…',
    'dexAdmin.saveOk': 'Saved ✓',
    'dexAdmin.localeSwitchLabel': 'Editing language',
    'dexAdmin.nameField': 'Name',
    'dexAdmin.flavorField': 'Flavor',
  },
  ja: {
    'nav.backpacks': 'バックパックス',
    'nav.schedule': 'スケジュール',
    'nav.friends': 'フレンズ',
    'nav.dex': '図鑑',
    'nav.settings': '設定',

    'header.status.saved': '保存済み ✓',
    'header.status.saving': '保存中…',
    'header.status.offline': 'オフライン',
    'header.langToggle': '🇬🇧 EN',

    'app.canvasTitle': 'キャンバス',
    'app.inventoryTitle': 'インベントリ',
    'app.inventoryNote': '格納中のアイテムは効果を発揮しません',

    'placeholder.comingSoon': 'この機能は近日公開予定です。',

    'invite.welcome': 'ようこそ、{name} さん！',
    'invite.dismiss': '閉じる',

    'preset.add': 'プリセット＋',

    'itemPanel.items': 'アイテム',
    'itemPanel.socketItems': 'ソケットアイテム',

    'settings.title': '設定',
    'settings.account': 'アカウント',
    'settings.name': '名前',
    'settings.roles': '権限',
    'settings.rolesNone': '（なし）',
    'settings.logout': 'ログアウト',
    'settings.accountLoadError': 'アカウント情報の読み込みに失敗しました',
    'settings.botTitle': 'API・ボットモード',
    'settings.botComingSoon': '近日公開予定',
    'settings.botNote': 'ボットや自動化向けのプログラム的アクセスは今後追加予定です。',

    'dex.tabItems': 'アイテム',
    'dex.tabSocketItems': 'ソケットアイテム',
    'dex.tabBps': 'BP',
    'dex.tabSearchPresets': '検索プリセット',
    'dex.reservedTitle': '今後対応予定',
    'dex.searchPlaceholder': '名前またはIDで検索…',
    'dex.rarityAll': 'レアリティ: すべて',
    'dex.tagAll': 'タグ: すべて',
    'dex.noMatch': '該当するアイテムがありません。',
    'dex.backToList': '← 一覧に戻る',

    'dex.detail.tags': 'タグ（階層）',
    'dex.detail.type': '型',
    'dex.detail.shape': '形状',
    'dex.detail.ports': 'ポート',
    'dex.detail.sockets': 'ソケット',
    'dex.detail.effects': '効果',
    'dex.detail.effectsNone': '（なし）',
    'dex.detail.rawAst': '生のAST（JSON）',
    'dex.detail.flavor': 'フレーバーテキスト',
    'dex.detail.part': 'パーツ／組み立て',
    'dex.detail.assemblesInto': '組み立て先',
    'dex.detail.role': '役割',
    'dex.detail.stretchNote': 'このアイテムはstretchフラグを持ちます。',
    'dex.detail.provenance': '来歴（provenance）',
    'dex.detail.provenanceUnresolved': 'このアイテムに対応する来歴情報は見つかりませんでした（registry.jsonにアイテム単位の対応表がまだありません）。',
    'dex.detail.rarity': 'レアリティ',
    'dex.detail.diagramLabel': '図解',

    'dex.loadFailed': '図鑑の読み込みに失敗しました: ',
    'dex.loading': '読み込み中…',
    'dex.viewMode': '閲覧',
    'dex.editMode': '編集モード',

    'dexAdmin.selectPrompt': '編集するアイテムを左から選択してください。',
    'dexAdmin.editing': '編集中: ',
    'dexAdmin.rarity': 'レアリティ',
    'dexAdmin.tags': 'タグ',
    'dexAdmin.tagsNote': 'tags[0] は「型」ルートタグです（先頭固定）',
    'dexAdmin.tagsTypeFirst': '型（先頭）',
    'dexAdmin.tagsAdditional': '追加タグ（カンマ区切り）',
    'dexAdmin.effects': '効果',
    'dexAdmin.effectAdd': '＋ 効果を追加',
    'dexAdmin.effectDelete': '削除',
    'dexAdmin.trigger': 'トリガー',
    'dexAdmin.verb': '動詞',
    'dexAdmin.viewOnlyNote': '形状・ポートのタイルは閲覧専用です。形状編集は今後対応予定（fit/アートパイプライン）。',
    'dexAdmin.save': '保存',
    'dexAdmin.saving': '保存中…',
    'dexAdmin.saveOk': '保存しました ✓',
    'dexAdmin.localeSwitchLabel': '編集言語',
    'dexAdmin.nameField': '名前',
    'dexAdmin.flavorField': 'フレーバー',
  },
} as const;

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
