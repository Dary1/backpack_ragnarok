// client/src/i18n/canvas.ts -- REQ-0145b (ce): canvas/backpacks-page chrome -- app shell captions, canvas stagehead, squad tabs, item panel, REQ-0142 beam-trace panel, REQ-0057 forecast overlay.
// en/ja key groups merged by ../i18n.ts (the barrel); en/ja key parity
// is gated at the barrel (see the split-commit gate record in the REQ).

export const canvasEn = {

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

  // Squad tabs (SquadTabs.tsx)
  'squad.add': 'Squad+',

  // Item panel (ItemPanel.tsx)
  'itemPanel.items': 'Items',
  'itemPanel.socketItems': 'Socket Items',
  // REQ-0142 (link-trace diagnostics): the beam-trace panel. Plain
  // language on purpose -- these lines exist to make an ABSENT link
  // explainable, and a player who needed the explanation is not helped by
  // the word "first-hit resolution". canvas_spec's own vocabulary (Unit,
  // ray, receiver, dud) is kept; nothing else is invented.
  'beam.title': 'Link trace',
  'beam.summary': '{links} linked · {mutual} mutual · {duds} dud',
  'beam.dir.0': 'N',
  'beam.dir.1': 'NE',
  'beam.dir.2': 'E',
  'beam.dir.3': 'SE',
  'beam.dir.4': 'S',
  'beam.dir.5': 'SW',
  'beam.dir.6': 'W',
  'beam.dir.7': 'NW',
  'beam.row.linked': 'Links {to}',
  'beam.row.mutual': 'mutual',
  // The three "why not" reasons (REQ-0142 gate).
  'beam.row.blocked': '{blocked} is further along this ray, but {blocker} at {at} takes the first hit — a beam stops at the first Unit it meets, so {blocked} never receives it.',
  'beam.row.noReceiver': 'No Unit stands on this ray — the beam leaves the canvas. (An intentional dud is a legitimate build.)',
  'beam.row.dirNotInSet': 'This direction is not in the Unit\'s set — no beam is fired here.',
  'beam.row.dirNotInSetWould': 'This direction is not in the Unit\'s set — no beam is fired here. {would} at {at} would receive one if it were.',
  // REQ-0057: Ray Forecast Overlay ("weather map").
  'forecast.toggle': 'Ray forecast',
  'forecast.loading': 'Reading the weather...',
  'forecast.error': 'Forecast unavailable: {msg}',
  'forecast.typeDefault': 'Auto-Generated',
  'forecast.typeFixed': 'Niflheim Depths (fixed)',
  'forecast.slotLabel': 'Squad slot',
  'forecast.slotN': 'Slot {n}',
  'forecast.legend': 'Expected pressure',
  'forecast.unit': 'dmg/s',
  'forecast.dps': '{n} dmg/s',
  'forecast.statusRate': 'status rays: {n}/s',
  'forecast.disclaimer': 'A distribution, not a promise \u2014 entry jitter and pack composition vary every run.',
  'forecast.slotSummaryTitle': 'Expected pressure by slot',
} as const;

export const canvasJa = {

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

  'squad.add': '型を鋳る＋', // REQ-0070: mock boardfoot copy (EN stays 'Squad+')

  'itemPanel.items': 'アイテム',
  'itemPanel.socketItems': 'ソケットアイテム',
  // REQ-0142: 平易な日本語で。連結が「なぜ起きないか」を説明するための行なので、
  // 専門用語は canvas_spec の語彙（ユニット／光線／受信／空撃ち）に留める。
  'beam.title': 'ビーム診断',
  'beam.summary': '連結 {links} · 相互 {mutual} · 空撃ち {duds}',
  'beam.dir.0': '北',
  'beam.dir.1': '北東',
  'beam.dir.2': '東',
  'beam.dir.3': '南東',
  'beam.dir.4': '南',
  'beam.dir.5': '南西',
  'beam.dir.6': '西',
  'beam.dir.7': '北西',
  'beam.row.linked': '{to} と連結',
  'beam.row.mutual': '相互',
  'beam.row.blocked': 'この光線上の先には {blocked} がいますが、手前の {blocker}（{at}）が最初の命中を取ります。ビームは最初に出会ったユニットで止まるため、{blocked} には届きません。',
  'beam.row.noReceiver': 'この光線上にユニットがいません（盤外へ抜けます）。意図的な空撃ちも正当な構成です。',
  'beam.row.dirNotInSet': 'この方向はユニットのビーム方向に含まれていません（発射されません）。',
  'beam.row.dirNotInSetWould': 'この方向はユニットのビーム方向に含まれていません（発射されません）。有効なら {would}（{at}）が受信します。',
  // REQ-0057: Ray Forecast Overlay ("weather map").
  'forecast.toggle': '\u5c04\u7dda\u4e88\u5831',
  'forecast.loading': '\u5929\u5019\u3092\u8aad\u3093\u3067\u3044\u307e\u3059\u2026',
  'forecast.error': '\u4e88\u5831\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093: {msg}',
  'forecast.typeDefault': '\u81ea\u52d5\u751f\u6210',
  'forecast.typeFixed': '\u30cb\u30f4\u30eb\u30d8\u30a4\u30e0\u306e\u6df1\u5c64\uff08\u56fa\u5b9a\uff09',
  'forecast.slotLabel': '\u5206\u968a\u67a0',
  'forecast.slotN': '\u67a0{n}',
  'forecast.legend': '\u4e88\u60f3\u88ab\u5f3e\u91cf',
  'forecast.unit': 'dmg/\u79d2',
  'forecast.dps': '{n} dmg/\u79d2',
  'forecast.statusRate': '\u72b6\u614b\u5f3e: {n}/\u79d2',
  'forecast.disclaimer': '\u3053\u308c\u306f\u5206\u5e03\u3067\u3042\u3063\u3066\u7d04\u675f\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u2014\u2014\u5165\u5c04\u4f4d\u7f6e\u306e\u3086\u3089\u304e\u3068\u6575\u7fa4\u306e\u69cb\u6210\u306f\u6bce\u56de\u5909\u308f\u308a\u307e\u3059\u3002',
  'forecast.slotSummaryTitle': '\u67a0\u5225\u306e\u4e88\u60f3\u88ab\u5f3e\u91cf',
} as const;
