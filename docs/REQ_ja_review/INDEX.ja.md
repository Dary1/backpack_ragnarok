# Expedition Monitor 全面再定義 — REQ レビュー一式 (日本語)

生成: 2026-07-18 / ブランチ `req-expedition-spec` / 元ブリーフ: `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md`

これはユーザー確認用の**一時レビューコピー**である。原本(英語・正)は同ブランチ `docs/REQ/draft/` にあり、全て `draft/` = 「仕様は書けたが着手前のユーザーレビュー待ち」状態。確認後にこの `REQ_ja_review/` は削除する。

## 依存グラフ / 実装順

```
0255 (マージ基盤) ─┬─ 0256 (tick中核) ─┬─ 0257 (ray実体) ─── 0262 (ray VFX) ─── 0264 (art: ray/hit)
                  │                   └─ 0259 (mode動詞制限)
                  ├─ 0258 (formation map + padding)
                  └─ 0260 (全画面route) ─── 0261 (formation描画) ─── 0263 (instance HUD) ─── 0265 (art: skillアイコン)
```

| REQ | 内容 | 対応するユーザー仕様 |
|---|---|---|
| 0255 | 影響ブランチ(0211/0185/0239/0240)をmasterへマージし新規基盤とする | Q2 |
| 0256 | シムを0.01s tickループへ全面書換。BPを平坦skillへビルド。`Battle`/`IBattleInstance`導入 | (b)(c) |
| 0257 | `IBattleRay`を実体化。4tickで1diagonal飛来。発火時snapshotで凍結 | (c)(g) |
| 0258 | `IBattleInstancesFormationMap`共通化。両陣padding-1輪。formation4修正(J11:Q18→J10:Q17) | (b)(f) |
| 0259 | mode gatingを`Battle`側へ。有効動詞を制限。monster/gimic統合 | (b) Q4 |
| 0260 | `#/expedition`全画面route。全画面ボタン。縦横で並び切替。等倍fit-scale | (a) Q3 |
| 0261 | 両`IBattleInstancesFormationMap`描画。Backpacks盤を1/2で再利用 | (d)(e)(f) |
| 0262 | ray軌跡+命中VFX。被弾セル+被弾instance形状のhighlight。差替seam | (g)(h)(i) |
| 0263 | HPバー/item cooldown/Unit charge/monster skill charge のHUD | (j)(k)(l) |
| 0264 | ray線/命中エフェクトを registry art 化(art REQ) | (i) |
| 0265 | monster/gimic skillアイコンを registry art 化(art REQ, 81枚) | (l) |

## 特に確認いただきたい「要ユーザー判断」25件

各REQ末尾の rulings 節に詳細。主要な争点:
- **0259 §3**: Q4「Battle側でmode毎に有効動詞を制限」の解釈4案(A/B/C/D)から A を採用。要承認。
- **0262 §8**: styleguide §6.0 の発光≤3同時 vs 実測ray同時19本(6.3倍超過)。cull方針を提案。
- **0262 §10 / §6.6**: reduced-motionで styleguide が「戦闘再生」自体を名指しで禁止。4Hz離散表示を提案。
- **0263 §5.2**: ユーザーの「背景をClockwise」= wedge か、既存golden G7 の ring か。wedge推奨だがG7改定が必要。
- **0263 §4.5**: 敵hpMax を実ロール値か def上限(hp[1])か。
- **0264/0265**: 新art kind (`vfx`/`skill`) を作るか `custom` 流用か。**REQ-0175 と REQ-0179 が矛盾**(未解決)。
- **0265 §7**: badgeは18px = G4のFAIL下限64pxの3.6倍下。art よりrune placeholderの方が可読な可能性。81枚発注可否。
- **0258 §7**: `docs/user_managed/backpack_battle_spec.md`(ユーザー所有・LLM編集不可)の J11:Q18 記述を J10:Q17 へ要改定。**唯一の hard doc blocker**。

## レビューで判明した重大事項(ブリーフ/コードの誤りを実測で修正済)

- formation4 修正は goldens を動かさない(formation4 を使う golden が無い)。ブリーフの過大評価を訂正。
- tick化で RNG stream 名に `t` が埋まっているため全ダメージ値が動く(0256/0257分割の根拠)。
- 「charge保持unitは無い」は**誤**。54中42がcharge保持でproduction live(goldenには映らない)。→0256で危険度を再評価。
- 小型モニターは formation box を一度も正しく描けていない(`canvases['squad'+n]` vs `unit1..4`キー)。→0261で修正。
- ray命中の72.2%が5th-bounce nova。HP barが`ray_hit_all`/`ray_aoe`の`hp_after`欠落で大半を見落とす。→0257で`hp_after`追加。
