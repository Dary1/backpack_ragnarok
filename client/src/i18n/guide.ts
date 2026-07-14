// client/src/i18n/guide.ts -- REQ-0141 first-run guided tour + contextual hints
// + the Settings replay control. en/ja key groups merged by ../i18n.ts (the
// barrel); en/ja key parity is gated at the barrel.
export const guideEn = {
  'guide.ariaLabel': 'First-run guide',
  'guide.stepCount': 'Step {n} of {total}',
  'guide.next': 'Next',
  'guide.finish': 'Got it',
  'guide.skip': 'Skip guide',

  'guide.step.bp.title': 'Your first Backpack',
  'guide.step.bp.body': 'This is your Squad Canvas, and the pack on it is a Backpack -- the vessel that carries one Unit and offers up its cells for gear.',
  'guide.step.po.title': 'Pieces that fit',
  'guide.step.po.body': 'The shapes filling the pack are Placement Objects -- items and weapons slotted in like puzzle pieces. Fit is power: how you arrange them is your strength.',
  'guide.step.unit.title': 'One voice per pack',
  'guide.step.unit.body': 'Every Backpack speaks through a single Unit, seated on one cell. A Unit casts linking beams across the canvas to bind pack to pack.',
  'guide.step.links.title': 'The Moment',
  'guide.step.links.body': 'Line your packs up so one Unit beam reaches another Unit. When they link, your synergy circuit ignites -- the exact moment that decides a clash.',
  'guide.step.depart.title': 'March your Troop',
  'guide.step.depart.body': 'Fill packs, chain their Units, then depart on an Expedition to win new pieces, shapes, and relics. Field four squads solo, or pour everything into one and march with friends.',

  'guide.hint.rotation': 'Tip: double-tap a piece to rotate it. The right angle often makes an awkward layout snap into place.',
  'guide.hint.tagMismatch': 'That port needs a matching tag to connect -- ports only link to a piece whose tag sits in the same family.',
  'guide.hint.dudBeam': 'That beam found no Unit on its path -- a dud. Re-arrange so its line crosses another Unit to forge the link.',
  'guide.hint.dismiss': 'Dismiss',

  'guide.settings.title': 'First-run guide',
  'guide.settings.desc': 'Replay the guided introduction to the canvas -- backpacks, pieces, Units, and link beams.',
  'guide.settings.replay': 'Replay the guide',
} as const;

export const guideJa = {
  'guide.ariaLabel': '初回ガイド',
  'guide.stepCount': 'ステップ {n} / {total}',
  'guide.next': '次へ',
  'guide.finish': 'はじめる',
  'guide.skip': 'ガイドをスキップ',

  'guide.step.bp.title': '最初の背嚢',
  'guide.step.bp.body': 'ここがスクワッド・キャンバス。乗っているのが背嚢（バックパック）です。ユニットを一つ宿し、装備を収めるセルを備えた器です。',
  'guide.step.po.title': '噛み合うピース',
  'guide.step.po.body': '背嚢を満たす形は配置オブジェクト（物品・武器）。パズルのように収めます。「収まりこそ力」――並べ方がそのまま強さになります。',
  'guide.step.unit.title': '背嚢の声はひとつ',
  'guide.step.unit.body': 'どの背嚢もひとつのユニットを通して語ります。ユニットはキャンバスへ連結ビームを放ち、背嚢と背嚢を結びます。',
  'guide.step.links.title': 'その瞬間',
  'guide.step.links.body': '背嚢を並べ、ユニットのビームを別のユニットへ届かせましょう。結ばれた瞬間、あなたのシナジー回路が起動します――勝敗を決するその一瞬です。',
  'guide.step.depart.title': '部隊を進めよ',
  'guide.step.depart.body': '背嚢を満たし、ユニットを連ね、遠征へ発って新たなピース・形・遺物を勝ち取りましょう。単独で四つのスクワッドを率いるも、すべてを一つに注いで仲間と進むも自由です。',

  'guide.hint.rotation': 'ヒント：ピースをダブルタップすると回転します。向きを変えるだけで収まりが一気に良くなることも。',
  'guide.hint.tagMismatch': 'そのポートは同じタグ同士でしか繋がりません。ポートは同じ系統のタグを持つピースにのみ連結します。',
  'guide.hint.dudBeam': 'そのビームは経路上にユニットを見つけられませんでした（空撃ち）。線が別のユニットを横切るよう並べ替えて連結を結びましょう。',
  'guide.hint.dismiss': '閉じる',

  'guide.settings.title': '初回ガイド',
  'guide.settings.desc': 'キャンバスの導入ガイドをもう一度再生します――背嚢、ピース、ユニット、連結ビーム。',
  'guide.settings.replay': 'ガイドを再生',
} as const;
