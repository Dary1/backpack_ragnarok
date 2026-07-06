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
    'nav.workshop': 'Workshop', // REQ-0042
    'nav.friends': 'Friends',
    'nav.dex': 'Dex',
    'nav.settings': 'Settings',
    // REQ-0069: MJOLNIR chrome -- routes from the mock rail whose real
    // pages land in later REQs, + the rail logo's accessible label.
    'nav.market': 'Market',
    'nav.ragnarok': 'Ragnarok',
    'nav.logoLabel': 'Back to title',

    // Header (Header.tsx)
    'header.status.saved': 'saved ✓',
    'header.status.saving': 'saving…',
    'header.status.offline': 'offline',
    'header.langToggle': '🇯🇵 日本語',

    // App shell (App.tsx)
    'app.canvasTitle': 'Canvas',
    'app.inventoryTitle': 'Inventory',
    'app.inventoryNote': 'items parked here take no effect',
    // REQ-0070: MJOLNIR canvas re-skin. The stagehead EN sub-captions are
    // EMPTY for the EN locale on purpose (the ja titles adopt the mock's
    // named halls -- 編成の間 -- and show a small latin caption under the
    // mock's convention; the EN titles ARE already that caption, so
    // rendering it twice would be noise -- App.tsx skips empty subs).
    'app.canvasSub': '',
    'app.inventorySub': '',
    // Canvas-page chrome (CanvasChrome.tsx): stagehead stats chip, embark
    // dock CTA, boardfoot auto-save seal.
    'canvas.statBp': 'Packs',
    'canvas.statItems': 'Items',
    'canvas.statLinks': 'Linked',
    'canvas.embark': 'Depart on Expedition',
    'canvas.saveState.saved': 'Saved',
    'canvas.saveState.saving': 'Saving…',
    'canvas.saveState.offline': 'Offline',

    // Placeholder route (PlaceholderPage.tsx)
    'placeholder.comingSoon': 'This feature is coming soon.',

    // Landing / title screen (landing/LandingPage.tsx) -- REQ-0069.
    // EN side is authored natural English; ja mirrors the mock's copy.
    'landing.menu.continue': 'Continue',
    'landing.menu.continueNote': 'To the canvas',
    'landing.menu.expeditions': 'Watch expeditions',
    'landing.menu.hall': 'Hall — Ragnarok',
    'landing.menu.settings': 'Settings',
    'landing.menu.settingsNote': 'Language & logout',
    'landing.signedInAs': 'Signed in as {name}',
    'landing.copyright': 'backpack_ragnarok © 2026',

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
    'dex.detail.name': 'Name',
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

    // Dex TM (Transmutator) catalog strip (REQ-0042, display-only)
    'dex.tmSectionTitle': 'Transmutators',
    'dex.tmStackable': 'Stackable',

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
    'dexAdmin.grantToWarehouse': 'Acquire to warehouse',
    'dexAdmin.grantToWarehouseSuccess': 'Added to your warehouse.',
    'dexAdmin.grantToWarehouseFailed': 'Could not add to warehouse: ',

    // Schedule (Schedule.tsx / schedule/*) -- REQ-0036 P1-C
    'schedule.title': 'Dungeon Schedule',
    'schedule.tabRooms': 'Rooms',
    'schedule.tabWarehouse': 'Warehouse',
    'schedule.loading': 'Loading…',
    'schedule.loadFailed': 'Failed to load the schedule: ',
    'schedule.noRooms': 'No rooms yet. Create one below to get started.',
    'schedule.createTitle': 'Create a room',
    'schedule.dungeonLabel': 'Dungeon',
    'schedule.dungeonTypeLabel': 'Generation type',
    'schedule.levelLabel': 'Level',
    'schedule.genSeedLabel': 'Generator seed (dev)',
    'schedule.genSeedPlaceholder': 'Leave blank for random',
    'schedule.formationLabel': 'Formation',
    'schedule.visibilityLabel': 'Visibility',
    'schedule.visibilitySelfOnly': 'Self only',
    'schedule.cancelPolicyLabel': 'Cancel policy',
    'schedule.cancelPolicyImmediate': 'Cancel immediately',
    'schedule.cancelPolicyAfterRun': 'Cancel after current run',
    'schedule.createButton': 'Create room',
    'schedule.creating': 'Creating…',
    'schedule.createFailed': 'Failed to create room: ',
    'schedule.statusIdle': 'Idle',
    'schedule.statusCooldown': 'Cooldown',
    'schedule.statusRunning': 'Running',
    'schedule.statusCancelPending': 'Cancel pending',
    'schedule.statusCanceled': 'Canceled',
    'schedule.nextRunIn': 'Next run in {time}',
    'schedule.levelLine': 'Level {level}',
    'schedule.dungeonUnknown': 'Unknown dungeon',
    'schedule.formationUnknown': 'Unknown formation',
    'schedule.cancelButton': 'Cancel',
    'schedule.cancelConfirm': 'Cancel this room’s schedule?',
    'schedule.expand': 'Expand',
    'schedule.collapse': 'Collapse',
    'schedule.roomId': 'Room',
    'schedule.hideCanceledToggle': 'Hide canceled ({count})',
    'schedule.allHidden': 'All rooms are canceled and hidden. Uncheck above to view them.',
    'schedule.cancelConfirmYes': 'Yes, cancel it',
    'schedule.cancelConfirmNo': 'No',

    // Slots panel (SlotsPanel.tsx)
    'schedule.slots.title': 'Units',
    'schedule.slots.unitLabel': 'Unit {n}',
    'schedule.slots.empty': '(empty)',
    'schedule.slots.selectPreset': 'Select a preset…',
    'schedule.slots.noPresets': 'You have no presets yet -- create one on the Backpacks screen first.',
    'schedule.slots.queuedBadge': 'Swap queued',
    'schedule.slots.assignFailed': 'Could not assign this unit: ',
    'schedule.slots.swapFailed': 'Could not swap this unit: ',
    'schedule.slots.emptyUnitOption': '{name} (no Backpack -- cannot deploy)',
    'schedule.slots.emptyUnitReason': 'This preset has no Backpack items, so it cannot be deployed.',

    // 409 deploy-gate error mapping (errors.ts)
    'schedule.error.notIndependent': 'This preset shares an item with one of your other presets. Make it independent (no shared items) before deploying it.',
    'schedule.error.crossRoomOverlap': 'This preset already has a unit deployed in another active schedule. Wait for that run to finish, or choose a different preset.',
    'schedule.error.noWarehouseSpace': 'Your inventory is full (all 5 pages) -- the item stays in your warehouse until you free up space.',
    'schedule.error.emptyUnit': 'This preset has no Backpack items -- it cannot be deployed (a unit with no Backpack has no HP).',

    // Monitor (Monitor.tsx / MonitorRenderer.ts)
    'schedule.monitor.progress': 'Progress',
    'schedule.monitor.encounter': 'Encounter',
    'schedule.monitor.telegraph': 'Telegraph',
    'schedule.monitor.noTelegraphYet': 'Waiting for the first move…',
    'schedule.monitor.resultVictory': 'Victory',
    'schedule.monitor.resultWipe': 'Wipe',
    'schedule.monitor.resultIncomplete': 'Incomplete',
    'schedule.monitor.rewardsTitle': 'Rewards',
    'schedule.monitor.rewardsNone': 'No rewards this run.',
    'schedule.monitor.rewardsWipeNote': 'No rewards on a wipe.',
    'schedule.monitor.levelDropped': 'Level dropped to {level}.',
    'schedule.monitor.cooldownUntil': 'Next run available in {time}',
    'schedule.monitor.playerField': 'Your party',
    'schedule.monitor.enemyField': 'Enemy field',
    'schedule.monitor.masked': '?',
    'schedule.monitor.settled': 'Settled',
    'schedule.monitor.awaitingRun': 'No run yet -- fill all 4 unit slots to start one.',
    // REQ-0045 (g): expanded-view Log tab.
    'schedule.monitor.tabField': 'Field',
    'schedule.monitor.tabLog': 'Log',
    'schedule.monitor.copyJsonl': 'Copy raw JSONL',
    'schedule.monitor.copied': 'Copied!',
    'schedule.monitor.copyFailed': 'Copy failed',
    'schedule.monitor.logEmpty': 'No events yet.',

    // Warehouse tab (WarehouseTab.tsx)
    'schedule.warehouse.title': 'Warehouse',
    'schedule.warehouse.cap': '{count} / {cap}',
    'schedule.warehouse.empty': 'Your warehouse is empty.',
    'schedule.warehouse.harvested': 'Harvested {time}',
    'schedule.warehouse.expiresIn': 'Expires in {time}',
    'schedule.warehouse.expired': 'Expired',
    'schedule.warehouse.claimButton': 'Claim',
    'schedule.warehouse.claiming': 'Claiming…',
    'schedule.warehouse.claimedToast': 'Moved to your inventory.',
    'schedule.warehouse.claimFailed': 'Could not claim this item: ',
    'schedule.warehouse.loadFailed': 'Failed to load the warehouse: ',
    'schedule.warehouse.claimNoSpace': 'No space in any inventory page -- the item stays in your warehouse.',
    'schedule.warehouse.claimedOnOtherPage': 'Placed on page {page}.',
    'schedule.warehouse.capWarning': 'Space is running low. Claim soon or new rewards may be lost.',
    'schedule.warehouse.capFull': 'Warehouse is full. New expedition rewards are being lost until you claim space.',
    'schedule.warehouse.claimAllButton': 'Claim all',
    'schedule.warehouse.claimingAll': 'Claiming all…',

    // Workshop (WorkshopPage.tsx) -- REQ-0042
    'workshop.commonBpGacha': 'Common BP Gacha',
    'workshop.cost': 'Cost: {cost} LRDST',
    'workshop.balance': 'Balance: {balance} LRDST',
    'workshop.rollButton': 'Roll',
    'workshop.rolling': 'Rolling…',
    'workshop.rolledToast': 'A new Backpack was placed!',
    'workshop.rolledOnOtherPage': 'Placed on page {page}.',
    'workshop.insufficientFunds': 'Insufficient LRDST balance.',
    'workshop.noSpace': 'No space in any inventory page for the rolled Backpack.',
    'workshop.spendFailed': 'Failed to deduct LRDST -- please try again.',
    'workshop.rollFailed': 'Roll failed: ',
    'workshop.rollResultTitle': 'You rolled:',
    'workshop.rollResultDismiss': 'Dismiss',
    'workshop.rollResultHpMax': 'Max HP',
    'workshop.rollResultCellCount': 'Cells',
  },
  ja: {
    // REQ-0069: the ja rail labels adopt the mock's vocabulary (編成/
    // 遠征) -- they also FIT the 86px rail, which the old katakana names
    // do not. EN labels stay as-is (the E2E suite clicks them by text).
    'nav.backpacks': '編成',
    'nav.schedule': '遠征',
    'nav.workshop': '工房',
    'nav.friends': 'フレンズ',
    'nav.dex': '図鑑',
    'nav.settings': '設定',
    'nav.market': '市場',
    'nav.ragnarok': '殿堂',
    'nav.logoLabel': 'タイトルへ戻る',

    'header.status.saved': '保存済み ✓',
    'header.status.saving': '保存中…',
    'header.status.offline': 'オフライン',
    'header.langToggle': '🇬🇧 EN',

    // REQ-0070: the ja canvas title adopts the mock's hall name (編成の間);
    // EN keeps 'Canvas'.
    'app.canvasTitle': '編成の間',
    'app.inventoryTitle': 'インベントリ',
    'app.inventoryNote': '格納中のアイテムは効果を発揮しません',
    'app.canvasSub': 'CANVAS',
    'app.inventorySub': 'INVENTORY',
    'canvas.statBp': '背嚢',
    'canvas.statItems': '物品',
    'canvas.statLinks': '連結',
    'canvas.embark': '遠征へ発つ',
    'canvas.saveState.saved': '保存済み',
    'canvas.saveState.saving': '保存中…',
    'canvas.saveState.offline': 'オフライン',

    'placeholder.comingSoon': 'この機能は近日公開予定です。',

    'landing.menu.continue': '続きから',
    'landing.menu.continueNote': '編成の間へ',
    'landing.menu.expeditions': '遠征を見守る',
    'landing.menu.hall': '殿堂 — ラグナロク',
    'landing.menu.settings': '設定',
    'landing.menu.settingsNote': '言語・ログアウト',
    'landing.signedInAs': '{name} としてログイン中',
    'landing.copyright': 'backpack_ragnarok © 2026',

    'invite.welcome': 'ようこそ、{name} さん！',
    'invite.dismiss': '閉じる',

    'preset.add': '型を鋳る＋', // REQ-0070: mock boardfoot copy (EN stays 'Preset+')

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
    'dex.detail.name': '名前',
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

    'dex.tmSectionTitle': '変成器（トランスミューテーター）',
    'dex.tmStackable': 'スタック可能',

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
    'dexAdmin.grantToWarehouse': 'アイテムを倉庫に取得',
    'dexAdmin.grantToWarehouseSuccess': '倉庫に追加しました。',
    'dexAdmin.grantToWarehouseFailed': '倉庫に追加できませんでした: ',

    // Schedule (Schedule.tsx / schedule/*) -- REQ-0036 P1-C
    'schedule.title': 'ダンジョンスケジュール',
    'schedule.tabRooms': 'ルーム',
    'schedule.tabWarehouse': '倉庫',
    'schedule.loading': '読み込み中…',
    'schedule.loadFailed': 'スケジュールの読み込みに失敗しました: ',
    'schedule.noRooms': 'まだルームがありません。下記から作成してください。',
    'schedule.createTitle': 'ルームを作成',
    'schedule.dungeonLabel': 'ダンジョン',
    'schedule.dungeonTypeLabel': '生成タイプ',
    'schedule.levelLabel': 'レベル',
    'schedule.genSeedLabel': '生成シード（開発者用）',
    'schedule.genSeedPlaceholder': '空欄でランダム',
    'schedule.formationLabel': '陣形',
    'schedule.visibilityLabel': '公開範囲',
    'schedule.visibilitySelfOnly': '自分のみ',
    'schedule.cancelPolicyLabel': 'キャンセルポリシー',
    'schedule.cancelPolicyImmediate': '即時キャンセル',
    'schedule.cancelPolicyAfterRun': '現在のランの終了後にキャンセル',
    'schedule.createButton': 'ルームを作成',
    'schedule.creating': '作成中…',
    'schedule.createFailed': 'ルームの作成に失敗しました: ',
    'schedule.statusIdle': '待機中',
    'schedule.statusCooldown': 'クールダウン中',
    'schedule.statusRunning': '実行中',
    'schedule.statusCancelPending': 'キャンセル予約中',
    'schedule.statusCanceled': 'キャンセル済み',
    'schedule.nextRunIn': '次のランまで {time}',
    'schedule.levelLine': 'レベル {level}',
    'schedule.dungeonUnknown': '不明なダンジョン',
    'schedule.formationUnknown': '不明な陣形',
    'schedule.cancelButton': 'キャンセル',
    'schedule.cancelConfirm': 'このルームのスケジュールをキャンセルしますか？',
    'schedule.expand': '展開',
    'schedule.collapse': '折りたたむ',
    'schedule.roomId': 'ルーム',
    'schedule.hideCanceledToggle': 'キャンセル済みを非表示（{count}件）',
    'schedule.allHidden': 'すべてキャンセル済みのため非表示です。上のチェックを外すと表示されます。',
    'schedule.cancelConfirmYes': 'はい、キャンセルする',
    'schedule.cancelConfirmNo': 'いいえ',

    // Slots panel (SlotsPanel.tsx)
    'schedule.slots.title': 'ユニット',
    'schedule.slots.unitLabel': 'ユニット {n}',
    'schedule.slots.empty': '（空き）',
    'schedule.slots.selectPreset': 'プリセットを選択…',
    'schedule.slots.noPresets': 'プリセットがまだありません。先にバックパックス画面で作成してください。',
    'schedule.slots.queuedBadge': '交換予約中',
    'schedule.slots.assignFailed': 'ユニットを割り当てられませんでした: ',
    'schedule.slots.swapFailed': 'ユニットを交換できませんでした: ',
    'schedule.slots.emptyUnitOption': '{name}（バックパックがなく展開不可）',
    'schedule.slots.emptyUnitReason': 'このプリセットにはバックパックアイテムがないため、展開できません。',

    // 409 deploy-gate error mapping (errors.ts)
    'schedule.error.notIndependent': 'このプリセットは他のプリセットとアイテムを共有しています。デプロイする前に、アイテムを共有しない独立した状態にしてください。',
    'schedule.error.crossRoomOverlap': 'このプリセットはすでに他のアクティブなスケジュールでユニットとしてデプロイされています。そのランが終わるのを待つか、別のプリセットを選んでください。',
    'schedule.error.noWarehouseSpace': 'インベントリが満杯です（全5ページ）。空きができるまでアイテムは倉庫に保管されます。',
    'schedule.error.emptyUnit': 'このプリセットにはバックパックアイテムがないため展開できません（バックパックがないユニットはHPを持ちません）。',

    // Monitor (Monitor.tsx / MonitorRenderer.ts)
    'schedule.monitor.progress': '進行状況',
    'schedule.monitor.encounter': 'エンカウント',
    'schedule.monitor.telegraph': '予兆',
    'schedule.monitor.noTelegraphYet': '最初の行動を待っています…',
    'schedule.monitor.resultVictory': '勝利',
    'schedule.monitor.resultWipe': '全滅',
    'schedule.monitor.resultIncomplete': '未完了',
    'schedule.monitor.rewardsTitle': '報酬',
    'schedule.monitor.rewardsNone': '今回のランに報酬はありません。',
    'schedule.monitor.rewardsWipeNote': '全滅時は報酬がありません。',
    'schedule.monitor.levelDropped': 'レベルが {level} に低下しました。',
    'schedule.monitor.cooldownUntil': '次のランまで {time}',
    'schedule.monitor.playerField': '自パーティ',
    'schedule.monitor.enemyField': '敵フィールド',
    'schedule.monitor.masked': '？',
    'schedule.monitor.settled': '確定済み',
    'schedule.monitor.awaitingRun': 'まだランがありません -- 4体すべてのユニットスロットを埋めると開始します。',
    // REQ-0045 (g): expanded-view Log tab.
    'schedule.monitor.tabField': 'フィールド',
    'schedule.monitor.tabLog': 'ログ',
    'schedule.monitor.copyJsonl': '生のJSONLをコピー',
    'schedule.monitor.copied': 'コピーしました！',
    'schedule.monitor.copyFailed': 'コピーに失敗しました',
    'schedule.monitor.logEmpty': 'まだイベントがありません。',

    // Warehouse tab (WarehouseTab.tsx)
    'schedule.warehouse.title': '倉庫',
    'schedule.warehouse.cap': '{count} / {cap}',
    'schedule.warehouse.empty': '倉庫は空です。',
    'schedule.warehouse.harvested': '{time}に獲得',
    'schedule.warehouse.expiresIn': '有効期限まで {time}',
    'schedule.warehouse.expired': '期限切れ',
    'schedule.warehouse.claimButton': '受け取る',
    'schedule.warehouse.claiming': '受け取り中…',
    'schedule.warehouse.claimedToast': 'インベントリに移動しました。',
    'schedule.warehouse.claimFailed': 'このアイテムを受け取れませんでした: ',
    'schedule.warehouse.loadFailed': '倉庫の読み込みに失敗しました: ',
    'schedule.warehouse.claimNoSpace': 'どのインベントリページにも空きがありません -- アイテムは倉庫に保管されたままです。',
    'schedule.warehouse.claimedOnOtherPage': 'ページ {page} に配置しました。',
    'schedule.warehouse.capWarning': '空き容量が少なくなっています。早めに受け取らないと新しい報酬が失われる可能性があります。',
    'schedule.warehouse.capFull': '倉庫が満杯です。空きができるまで、新しい遠征報酬は失われ続けます。',
    'schedule.warehouse.claimAllButton': 'すべて受け取る',
    'schedule.warehouse.claimingAll': '一括受け取り中…',

    'workshop.commonBpGacha': 'コモンBPガチャ',
    'workshop.cost': 'コスト: LRDST {cost}個',
    'workshop.balance': '所持数: LRDST {balance}個',
    'workshop.rollButton': 'ガチャを回す',
    'workshop.rolling': '回しています…',
    'workshop.rolledToast': '新しいバックパックが配置されました！',
    'workshop.rolledOnOtherPage': 'ページ {page} に配置しました。',
    'workshop.insufficientFunds': 'LRDSTが不足しています。',
    'workshop.noSpace': 'ロールしたバックパックを置くスペースがどのページにもありません。',
    'workshop.spendFailed': 'LRDSTの消費に失敗しました -- もう一度お試しください。',
    'workshop.rollFailed': 'ガチャに失敗しました: ',
    'workshop.rollResultTitle': 'ロール結果:',
    'workshop.rollResultDismiss': '閉じる',
    'workshop.rollResultHpMax': '最大HP',
    'workshop.rollResultCellCount': 'セル数',
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
