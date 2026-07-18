# REQ-0258 — formation-map-padding: 26x18の単一抽象化、**両**平面へのpaddingリング、formation4の修正

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKED。作業を開始する前にユーザ
ーの判断が必要な点が2つある:(1) §7にある`docs/user_managed/backpack_battle_spec.md`の改訂 — これ
はLLMが自分自身で行ってはならない。(2) formation4のboxを動かしてよいかの確認 — これはQ1裁定により
認められてはいるものの、実際のゲームプレイに影響する変更であり、§8で示す通り既存のgoldenには一切カ
バーされていない。
**予約日:** 2026-07-18
**スラッグ:** formation-map-padding
**ブランチ:** req-expedition-spec(仕様のみ)
**依頼者:** user、2026-07-18 — 仕様項目(b)(`IBattleInstancesFormationMap`)および項目(f)(player平
面へのpadding-1リング)。ブリーフ§2 / §3 C3 / §4で整合を取っている。
**依存先:** REQ-0255(expedition-merge-baseline) — 今日時点のmasterではなく、マージ後のベースライン
から分岐すること。
**ブロック対象:** REQ-0259(battle-mode-verb-gating)、REQ-0261(expedition-formation-render)。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §2, §3 C3, §4。
**継承元:** ユーザーによる2026-07-15の24x16/B2:Y17裁定(REQ-0184)。

## 1. ゴール

3つの事柄を1つのREQにまとめている。これらは1つの事実だからである:

1. `IBattleInstancesFormationMap`を、player・enemy**両**平面で使われるSHARED(共有)な26x18抽象化
   にする。現状はenemy平面にのみvalidatorが強制するplaceable areaがあり、player平面には何もない。
2. padding-1リングを**両**平面で強制する。現状はenemy平面にのみ強制されている。
3. `formation4.unit4`を修正する。リングに違反している唯一のbox — `J11:Q18` -> `J10:Q17`。

## 2. 継承する裁定 — 引用であり、言い換えではない

placeable areaは新しい決定ではない。`content/live/dungeon/packs.json`は、その`port_note`にユーザー
の2026-07-15裁定を原文のまま保持している(ファイルを読んで検証済み):

> These layouts are the PORT of the pre-REQ-0184 placement, not a rebalance. `compileEnemyPack()`
> used to fill from the box origin left-to-right, and `encounter.cjs` handed it the WHOLE A1:Z18
> plane — so every pack stood on the margin (frost_gnoll at A1, etc). **The user ruled 2026-07-15
> that 24x16/B2:Y17 is canon and the margin-riding was a bug.** The fix is a pure origin shift
> A1 -> B2 …

(訳:これらのレイアウトはREQ-0184以前の配置のPORT(移植)であり、リバランスではない。
`compileEnemyPack()`はかつてbox原点から左から右へ詰めて配置しており、`encounter.cjs`はA1:Z18の平面
全体を渡していた — そのため、すべてのpackがmargin(余白)上に乗っていた(frost_gnollがA1にいる、な
ど)。**ユーザーは2026-07-15、24x16/B2:Y17を正典(canon)としmargin上に乗っていたのはバグであると裁
定した。** その修正は、A1 -> B2への純粋な原点シフトである…)

そして`note`には:

> The placeable area is B2:Y17 (24x16) inside the 26x18 field — see the port note below.

(訳:placeable areaは26x18のfield内のB2:Y17(24x16)である — 詳細は下記のport note参照。)

ユーザーの2026-07-18項目(f)は、この同じルールをplayer平面へEXTEND(拡張)するものである。これがす
べての要件である:1つのルールを、両平面に。

## 3. 検証済みの現状(すべて実際に読んで確認した)

| fact | source | evidence |
|---|---|---|
| fieldは26x18 | `sim/lib/field.cjs:7` | `const FIELD_ROWS = 18, FIELD_COLS = 26;` |
| placeableはB2:Y17 = 24x16 | `shared/content_validate.cjs:436-437` | `const FIELD_COLS = 26, FIELD_ROWS = 18;` / `const PLACEABLE = { colMin: 2, rowMin: 2, colMax: FIELD_COLS - 1, rowMax: FIELD_ROWS - 1 };` |
| enemy平面はring強制されている | `shared/content_validate.cjs:519-522` | `validateMonsterPackEntry`内で、導出される全セルが`PLACEABLE`に対して範囲チェックされ、`outside the placeable area`をthrowする |
| player平面はring強制されていない | `sim/lib/formation.cjs:52-64` | `validateFormationBoxes`は**8x8のみ**をチェック |
| formation4.unit4 = `J11:Q18` | `sim/lib/formation.cjs:45` | `unit4: 'J11:Q18', // backline_center` |
| formations.jsonも同じ値 | `content/live/dungeon/formations.json` | `"unit4": "J11:Q18"` |

### 3.1 C3の指摘事項、box単位で検証 — 16個すべて

実際の`FORMATIONS`テーブルを読み込み、各boxを実際の`PLACEABLE`に対してテストして算出した(目視で
はない):

| box | 値 | 列 | 行 | 8x8か? | B2:Y17内か? |
|---|---|---|---|---|---|
| formation1.unit1 | `F2:M9` | F-M | 2-9 | OK | yes |
| formation1.unit2 | `N2:U9` | N-U | 2-9 | OK | yes |
| formation1.unit3 | `B10:I17` | B-I | 10-17 | OK | yes |
| formation1.unit4 | `R10:Y17` | R-Y | 10-17 | OK | yes |
| formation2.unit1 | `J2:Q9` | J-Q | 2-9 | OK | yes |
| formation2.unit2 | `B6:I13` | B-I | 6-13 | OK | yes |
| formation2.unit3 | `R6:Y13` | R-Y | 6-13 | OK | yes |
| formation2.unit4 | `J10:Q17` | J-Q | 10-17 | OK | yes |
| formation3.unit1 | `B2:I9` | B-I | 2-9 | OK | yes |
| formation3.unit2 | `R2:Y9` | R-Y | 2-9 | OK | yes |
| formation3.unit3 | `F10:M17` | F-M | 10-17 | OK | yes |
| formation3.unit4 | `N10:U17` | N-U | 10-17 | OK | yes |
| formation4.unit1 | `B2:I9` | B-I | 2-9 | OK | yes |
| formation4.unit2 | `J2:Q9` | J-Q | 2-9 | OK | yes |
| formation4.unit3 | `R2:Y9` | R-Y | 2-9 | OK | yes |
| **formation4.unit4** | **`J11:Q18`** | J-Q | **11-18** | OK | **NO — 行18はmarginにあたる** |

**結果:16box中16すべてが8x8をpassし、PLACEABLEに違反しているのはちょうど1件。** ブリーフのC3は
CONFIRM(確認)された:`formation4.unit4`が16個中唯一の違反者である。

上の表が既存のゲートについて示している点に注目してほしい:**16box全てが8x8であり、壊れているboxも
例外ではない。** 8x8のみのチェックでは、このバグを見つけることはできない — これはSHAPE(形状)の
エラーではなく、POSITION(位置)のエラーだからである。

## 4. 修正内容: `J11:Q18` -> `J10:Q17`

根拠(ブリーフの3つのパートを、それぞれ上の表と照らして検証):

- **(a) これが唯一の合法な配置である。** このboxは8x8を維持し、J..Q列帯にとどまり(これは
  `backline_center`であり、`center_top` = `J2:Q9`の下に位置する)、front rowより下に位置しなければ
  ならない。B2:Y17内で、行2-9より下にある8行分の帯は**行10-17**しかない。`J10:Q17`は選択の余地なく
  一意に決まる。
- **(b) これにより正確な3x2タイリングが復元される。** B2:Y17は24x16であり、これは8列3組(B-I、
  J-Q、R-Y)×8行2組(2-9、10-17)にちょうど一致する。修正後のformation4 = `B2:I9` + `J2:Q9` +
  `R2:Y9` + `J10:Q17` — 6タイル中4タイルがグリッドにちょうど一致する。検証済み:`unit2`
  (`J2:Q9`、行2-9)との重なりはない(`J10:Q17`は行10-17)。
- **(c) formation4が明示している意図を保つ。** `docs/user_managed/backpack_battle_spec.md`は
  formation4を"wings (left/right) absorb most damage; center-top frontline only handles top-center
  fire; backline is well protected"(左右のwingsが大半のダメージを吸収し、center-topのfrontlineは
  top-centerからの砲火のみを受け持ち、backlineはよく守られている)と説明している。backlineを1行上に
  動かしても、`center_top`の下に中央揃えのまま、wingsの後方に位置する点は変わらない。意図は変わら
  ず、失われるのは違反していた行だけである。

`J10:Q17`は実際に合法であることが既に証明されている — `formation2.unit4`が現在まさにこのboxであり、
すべてのゲートをpassしている。

## 5. 歩調を合わせて変更しなければならない利用箇所

ツリー全体で`J11:Q18`をgrepして見つけたものである(`node_modules`、`web/app/assets`、`.git`は除
外)。これはCOMPLETE(完全)なリストであり、他には存在しない。

### 5.1 コード — 変更が必要

| file:line | 現状 | 変更後 |
|---|---|---|
| `sim/lib/formation.cjs:45` | `unit4: 'J11:Q18', // backline_center` | `unit4: 'J10:Q17', // backline_center` |
| `sim/lib/formation.cjs:39-40` | `note:`文字列。`unit4=backline_center=J11:Q18 (8 rows, in-bounds)`と主張している | 書き換える:`J10:Q17`とし、その理由を明記する(in-boundsであることは元々ルールの全体ではなかった — B2:Y17のplaceableリング内にも収まっている必要がある) |
| `content/live/dungeon/formations.json` | `"unit4": "J11:Q18"` + エントリの`note` + ファイルレベルの`note` | 同じboxに変更 + noteを修正 |
| **`sim/tests/run.cjs:1292`** | **`eq(combat.FORMATIONS.formation4.canvases.unit4, 'J11:Q18', 'formation4 unit4 must be the CORRECTED box, not the xlsx J11:Q19 error');`** | `'J10:Q17'`に固定し、文言も変更する — 旧メッセージはJ11:Q18を"the CORRECTED box"(正しい修正済みのbox)と呼んでおり、これはまさに本REQが覆す考え方である |
| `sim/tests/run.cjs:1283` | テスト名:`formation defs: all 4 boxes parse to exactly 8x8, formation4 uses CORRECTED J11:Q18` | 新しいboxの値にリネームする |
| `sim/README.md:89` | "formation4 uses the CORRECTED `J11:Q18` box" | `J10:Q17`に修正 |

> **`sim/tests/run.cjs:1292`は、ブリーフが触れていない箇所であり、しかも最初に落ちる箇所である。**
> あるテストが、壊れた値をhard-pin(固定値として決め打ち)している。実測(§8):修正を適用しそれ以
> 外は何も触らない場合、simスイート全体でFAILするassertionはこれ1件のみである。これは巻き添え被害
> ではない — 間違った定数を見ていたゲートであり、それを正しい対象に向け直すこと自体がこの修正の一
> 部である。

### 5.2 生成物 — リビルドせよ、手で編集するな

`web/preview/batch-002/index.html:100`と`web/preview/batch-004/index.html:108`は、生成されたSVG
formationギャラリーの中にformation4のboxとnoteを埋め込んでいる。これらは`tools/build_preview`の出力
である。再生成すること。生成されたHTMLを手で編集してはならない。

### 5.3 `formations.json`と`sim/lib/formation.cjs` — ミラーリングの主張を検証する

`docs/user_managed/backpack_battle_spec.md:3`は次のように宣言している:

> source: "content/live/dungeon/formations.json (authoritative; **mirrored byte-for-byte by
> sim/lib/formation.cjs**). The original formation.xlsx was RETIRED and deleted 2026-07-14
> (REQ-0166): it carried the stale J11:Q19 box and pre-pivot Unit1-4 labels."

(訳:source: "content/live/dungeon/formations.json(authoritative=正、**sim/lib/formation.cjsにより
byte-for-byteでミラーリングされる**)。元のformation.xlsxはRETIRED(廃止)され2026-07-14に削除され
た(REQ-0166):古いJ11:Q19のboxとpre-pivotのUnit1-4ラベルを保持していた。")

**検証済み:このミラーリングの主張は現時点でHOLD(成立)している。** 16box全てをプログラムで比較し
た。JSONと実際の`FORMATIONS`テーブルとの比較で:**不一致0件、formation 4/4、box 16/16が完全一致。**
つまり現状では両方のコピーが`J11:Q18`を保持しており、両者を同時に動かさなければこの主張は崩れる。

このミラーについて知っておくべきことが2つある:

- **機械的にチェックされていない。** `sim/tests/`内には`formations.json`と`FORMATIONS`を比較するも
  のが何もない。このミラーは現状、人手で維持されているに過ぎない。本REQはこの固定されていないミラ
  ーの両側を編集するため、これも併せて固定(pin)しなければならない — §6.1参照。(8x8のみの半分チ
  ェックと同じ教訓である:見張られていない不変条件は、いずれ成り立たなくなる不変条件である。)
- **この2つはDIFFERENT(異なる)利用者に読まれている**。だからこそこのミラーが存在する:
  `sim/lib/compile.cjs:56`は実際のrunでsquadを配置するために`FORMATIONS`テーブルを読み(`const
  formation = FORMATIONS[formationId];`)、一方`server/services/core.cjs:52`(`const FORMATIONS_PATH
  = path.join(LIVE_DUNGEON_DIR, 'formations.json');`)は`GET /api/schedule/dungeons`経由でこのJSON
  をclientに提供する。片方だけ変更すると、clientはsimが実際には使わないboxを描画することになる。
- **`formations.json`自身のファイルレベルnoteは、別の点で既にstale(陳腐化)している**:ミラー元
  のテーブルを"sim/combat.cjs's hardcoded FORMATIONS table"と記載しているが、そのテーブルは
  `sim/lib/formation.cjs`にMOVED(移動済み)である(REQ-0047 (d)、そのヘッダーには"Moved VERBATIM
  from sim/combat.cjs"と記録されている)。noteを編集する際にこのパス参照も修正すること。

## 6. 強化されたload-time assert

`sim/lib/formation.cjs:52-64`の`validateFormationBoxes`、現状:

```js
const w = box.colMax - box.colMin + 1, h = box.rowMax - box.rowMin + 1;
if (w !== 8 || h !== 8) {
  throw new Error('Formation box ' + fid + '.' + squad + ' (' + cv[squad] + ') is ' + w + 'x' + h + ', expected 8x8');
}
```

このコード自身のコメントは意図を次のように述べている:"Sanity-check every formation box is exactly
8x8 … fail fast on any typo."(すべてのformation boxがちょうど8x8であることをsanity-checkする…タ
イプミスがあれば即座に落とす)。実際にそれだけを行っており、それ以上のことは行っていない。

**なぜこれが`J11:Q18`を通してしまったのか:`J11:Q18`は実際に8x8である。** 列J..Q = 8、行11..18 = 8。
このboxは、正しいSHAPE(形状)を持ちながら、間違ったPLACE(場所)にある。このvalidatorは「8x8か?」
だけを問い、「placeable area内にあるか?」を一度も問わない。そのため、完璧な形状のboxが、rayが生ま
れるmargin上に乗ったままでいることができてしまう。このルールにはSHAPEとPOSITIONという2つの半分が
あり、ゲートはそのうち片方しか見ていなかった。

これはPROJECT.md自身の教訓であり、原文のまま引用する:

> **A gate that watches one half of a rule watches none of it.**

(訳:ルールの半分しか見ていないゲートは、そのルールを何も見ていないのと同じである。)

PROJECT.mdはこれを`check_e2e_ports.cjs`について記録している。このコードは"only ever read
`tools/*_e2e.sh`, so the rule rotted in the half it could not see"(`tools/*_e2e.sh`しか読んでおら
ず、そのためルールは見えていない半分側で腐っていった)という。失敗の形は同じで、ファイルが違うだけ
である:`J11:Q18`を導入した修正(combat_spec §5.2)は、範囲外の半分(行19 -> 行18)は治したが、
margin側の半分は一度も見ていない。なぜならmarginルールはまだ存在していなかったからだ — それは
2026-07-15、1年分のコミットを経てから裁定されたものである。この半分だけのチェックは、その結果バグ
をその場に凍結させた:毎回green(合格)になり、ジオメトリはvalidate済みだと報告し続けた。

**新しいassert — 両方の半分を、すべてのboxに対して:**

```js
// Every formation box is exactly 8x8 AND lies entirely inside the placeable
// ring B2:Y17. 8x8 alone is not the rule: J11:Q18 was 8x8 and still sat on the
// row-18 margin (REQ-0258). Shape and position are one rule; check both or the
// half you skip is the half that rots.
(function validateFormationBoxes() {
  for (const fid of Object.keys(FORMATIONS)) {
    const cv = FORMATIONS[fid].canvases;
    for (const squad of Object.keys(cv)) {
      const box = parseBox(cv[squad]);
      const w = box.colMax - box.colMin + 1, h = box.rowMax - box.rowMin + 1;
      if (w !== 8 || h !== 8) {
        throw new Error('Formation box ' + fid + '.' + squad + ' (' + cv[squad] +
          ') is ' + w + 'x' + h + ', expected 8x8');
      }
      if (box.colMin < PLACEABLE.colMin || box.colMax > PLACEABLE.colMax ||
          box.rowMin < PLACEABLE.rowMin || box.rowMax > PLACEABLE.rowMax) {
        throw new Error('Formation box ' + fid + '.' + squad + ' (' + cv[squad] +
          ') is outside the placeable area B2:Y17 (the padding ring is 1 cell on ' +
          'every side of the ' + FIELD_COLS + 'x' + FIELD_ROWS + ' field)');
      }
    }
  }
})();
```

これはLOAD-TIME(ロード時)のassert(モジュールロード時に実行されるIIFE)のままでなければならず、
テストにしてはならない:これによって、不正なformationは単に報告されるだけでなく、そもそも表現不可
能になる。

### 6.1 ミラーをpin(固定)する

`sim/tests/run.cjs`の、既存のREQ-0184 parityブロックの隣に追加する:`content/live/dungeon/
formations.json`と`FORMATIONS`が16box全てで一致すること、かつJSON側の各boxが独立して8x8 +
PLACEABLEを満たすことをテストする。これにより§5.3のギャップが埋まる — `backpack_battle_spec.md`が
主張しているミラーが機械的にチェックされるようになり、次に片方のコピーだけを編集する人が、もう片方
を気づかないまま置き去りにすることができなくなる。

## 7. boxが動いた瞬間にWRONG(誤り)になるドキュメント

以下の2つは、現時点では`J11:Q18`がCORRECT(正しい)値であると主張している。本REQの後は、単に
stale(陳腐化)になるだけでなく、正典(canon)の正反対を述べることになる。

### 7.1 `docs/llm_managed/combat_spec_draft.md` — LLM所有、本REQが編集する

| 行 | 現状 | 対応 |
|---|---|---|
| 379 | `**Ratified v0.2:** backline_center box **corrected to `J11:Q18`** (8 rows, in-bounds); squad` | `J10:Q17`に書き換える。v0.2の"correction"自体が不完全だったことを記録する — 行19の超過は修正したが、2026-07-15のmargin裁定より前のものである |
| 384 | ``R2:Y9`, backline_center `J11:Q18`.`` | -> `J10:Q17` |

> **ブリーフへの訂正。** ブリーフは§5.1と§5.2が「どちらもJ11:Q18の"correction"を主張している」と
> 述べている。検証済み:**`J11:Q18`が現れるのは§5.2のみ**(379行目と384行目)。§5.1のformation
> テーブル(375行目)にはboxそのものが一切含まれていない — そのformation4の行は`E5 (left wing) |
> M5 (center-top) | U5 (right wing) | M14 (backline) | **corrected** — see §5.2`となっており、つ
> まり廃止済みxlsxのアンカーMARKER(マーカー)セルを保持しつつ§5.2に委ねている。したがって編集は
> §5.2に対して行う。§5.1に必要なのは、`M14`が削除済みの`formation.xlsx`由来の歴史的なアンカーラベ
> ルであってbox定義ではないという注記のみである — §5.2のboxがauthoritative(正)である。M14をM13
> に"修正"してはならない。アンカーはprovenance(来歴)であり、ジオメトリではない。

また、`docs/llm_managed/user_managed_rename_suggestions.md:133,140,149`にも`J11:Q18`が確定値として
繰り返し記載されている。LLM所有であり、同じコミットで修正すること。さもなければ3つ目のstaleな記述
になってしまう。

### 7.2 `docs/user_managed/backpack_battle_spec.md` — USER-OWNED(ユーザー所有)。**ASK(確認せよ)。編集するな。**

PROJECT.md:"`docs/user_managed` = golden, user-verified (do NOT edit)"(`docs/user_managed`は
golden、ユーザー検証済みであり編集禁止)。したがって本REQはこのファイルに一切触れてはならない。代
わりに、ユーザーに改訂をASK(依頼)しなければならない。**ユーザーが一度の作業で変更できるよう、該
当行を正確に示す:**

| 行 | 現状 | 依頼する改訂内容 |
|---|---|---|
| **85** | `      unit4: "J11:Q18"  # backline_center` | `      unit4: "J10:Q17"  # backline_center` |
| **87** | `      RESOLVED. The old sheet's backline_center box (J11:Q19) extended to row 19,` | 歴史的記述として残すが、これは今や2回ある修正のうちの最初のものという位置づけになる |
| **89** | `      The ratified fix is J11:Q18. The four boxes now carry an explicit` | `The ratified fix is J10:Q17.`に変更 — さらに、先のJ11:Q18修正はfieldの超過のみを治したものであり、J11:Q18は依然として行18のmargin上にあり、それは2026-07-15の24x16/B2:Y17裁定が禁じているものであった、という点を注記する |
| **91** | `      The sim asserts at load time that EVERY formation box is exactly 8x8.` | `The sim asserts at load time that EVERY formation box is exactly 8x8 AND lies entirely inside the placeable area B2:Y17.` |
| **98** | `  - "formation4: the row-18 boundary overrun is fixed (J11:Q18)."` | `  - "formation4: the row-18 MARGIN overrun is fixed (J10:Q17); the earlier J11:Q18 fix addressed only the row-19 field overrun."` |

3行目と92行目にも、廃止済みxlsxの値として`J11:Q19`が記載されているが、これらは歴史的記述として引き
続き正しく、変更は不要である。3行目の"mirrored byte-for-byte by sim/lib/formation.cjs"も引き続き正
しい。§5.1/§5.3により両方のコピーが同時に動かされるためである。

**順序について:** これは儀礼的なものではなく、hard dependency(必須の依存関係)である。
`backpack_battle_spec.md`はgolden sourceであり、`formations.json`をauthoritative(正)であると名指
ししている。コードが動いてgolden docが動かなければ、そのdocはツリーの中で最も誤った成果物になりな
がら、なお人が信頼する対象であり続けてしまう。ユーザーが本REQを承認する一環としてこれを改訂する
か、さもなければ本REQは出荷されない。

## 8. Goldens / forecastへの影響 — 実測結果とブリーフの誇張

ブリーフはこの修正について"changes formation4 runs. Sanctioned under Q1's rebaseline"(formation4
のrunを変える。Q1のrebaselineにより認可済み)と述べており、タスクの依頼文でも「goldens/forecastへ
の影響」を求めている。**実測すると、影響はない。** 修正を`sim/lib/formation.cjs`に適用し、simスイ
ート全体を実行した後、変更をrevert(復元)した(ツリーはcleanなまま、`git status` = 0件の変更):

| gate | `J10:Q17`適用時 | 理由 |
|---|---|---|
| `sim/tests/goldens.cjs` | **`goldens OK (12 cases, replay determinism intact)`** — byte-identical(バイト完全一致) | **formation4を使うgoldenは1件もない。** `goldens.cjs:63`の`baseOpts`にある`formationId: 'formation1'`が、このファイル内で唯一のformationIdであり、12件全てのケース(`batch002/golden-A..C`、`dungen/default/L{1,3,5,8}/dg-{11,22}`、`dungen/test_fixed`)がこれを継承している。 |
| `sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** — 変化なし | `formation4-full`フィクスチャ(`forecast_parity.cjs:155`)は実行時に`combat.FORMATIONS.formation4.canvases`からDERIVED(導出)されるため、テーブルと共に動く。parityは同じテーブルを読む2つの実装の間で取られているため、テーブルが動けば両側とも等しく動く。 |
| `sim/tests/run.cjs` | **116 passed, 1 failed** | 唯一の失敗は§5.1のhard-pin:`formation defs: … formation4 uses CORRECTED J11:Q18 -- expected "J11:Q18" got "J10:Q17"`。 |

**したがって、正直なところ影響範囲はテストassertion1件とドキュメントのみであり、rebaselineではな
い。** 本REQはgoldenを動かさないため、進めるためにQ1のgolden sanction(承認)は必要ない。"Q1により
認可済み"という表現が、実測では示されないchurn(揺らぎ)を連想させてしまわないよう、これは明確に述
べておく。golden diffを予測しながら実際には何も生じないREQは、それ自体が仕様の立て方を誤っている。

**実際に変わるのはlive gameplay(本番のゲームプレイ)であり**、これこそがQ1の対象範囲である。
`formationId`はclientから`POST /api/schedule/rooms`で届き、`compile.cjs:56`でlookupされる。
formation4は選択可能なformationであるため、これを使う実際のrunは、backlineが1行上に配置され、異な
るray命中を受けることになる。このパスを現在カバーしているテストコーパスは存在しない — これこそが
このバグが生き残った理由であり、ユーザーのsign-off(§ Status)がgoldensに対してではなくgameplayの
変更に対して求められている理由でもある。

REQ-0256/0257が先に着地すれば、それらのrebaselineがこれを自明に吸収する。両者の順序は問題にならず、
互いに衝突もしない(それらが触れるのはtick/rayのcoreであり、formationテーブルではない)。

## 9. 共有される`IBattleInstancesFormationMap`

ブリーフ§4に基づく、normative(規範となる)インターフェース。**新規ファイル:
`sim/lib/formation_map.cjs`。**

```
IBattleInstancesFormationMap                 // 26x18, padding ring 1, placeable B2:Y17
  instances : IBattleInstance[]
  rays      : IBattleRay[]                   // rays in flight ON THIS map (a ray is fired ONTO
                                             //   the opposing map, so it lives there)
  tickInstances()                            // the FIRE phase: forwards tick to instances,
                                             //   in stable instance index order (REQ-0256 s10.1)
  tickRays()                                 // the ADVANCE phase: advances rays (REQ-0257 s12.1)
  tick()                                     // === tickInstances(); tickRays()
                                             //   brief s4's single-map entry point. See below:
                                             //   `Battle` does NOT call this one.
```

これは`sim/lib/field.cjs`への追加ではなく新規ファイルとする。理由は、`field.cjs`が寸法定義+静的な
占有インデックス(`FIELD_ROWS`、`cellKey`、`buildOccupancyIndex`)であり、そのヘッダーが
determinism contract(決定性契約)に固定されているからである("Moved VERBATIM from sim/combat.cjs.
Determinism contract: goldens must stay byte-identical" — sim/combat.cjsからそのまま移動。決定性契
約:goldensはbyte単位で完全一致し続けなければならない)。一方このmapはLIVE(生きた)、tickするオブ
ジェクトである。静的なジオメトリのプリミティブと、battleごとに変化するmutable(可変)な状態は分離
しておく。`formation_map.cjs`は`field.cjs`をrequireする側であり、その逆ではない。

本REQがこのインターフェースのうち実際に届けるのは:MAPそのもの — formation(player平面)または
monster_pack(enemy平面)からの構築、`instances`リスト、placeable/ring述語、そして両平面での強制で
ある。**本REQはtickループを持ってはならない。**

**tick側は本REQでDECLARED(宣言)されるが、実装は別の場所で行われる。3つのREQがこの1ファイルを共有
しており、その分割はdisjoint(重複がない)。この表がその継ぎ目である:**

| メンバー | 宣言 | 実装 |
|---|---|---|
| `instances`、construction(構築)、ring述語 | **本REQ** | **本REQ** |
| `rays[]` | **本REQ** | REQ-0257(§12.1) — それまでは空リスト |
| `tickInstances()` | **本REQ** | **REQ-0256**(§7.1a) |
| `tickRays()` | **本REQ** | REQ-0257(§12.1)。**REQ-0256はこれをno-opにstubする** — `rays[]`は0257まで常に空(REQ-0256 §11)。 |
| `tick()`(= 両フェーズ) | **本REQ** | **REQ-0256**(§7.1a) |

**なぜmapがbrief §4の単一の`tick()`だけでなく、2つのphaseメソッドを持つのか — あえてここで明示す
る。これはnormative interfaceに対する意図的な洗練だからである。** ブリーフ§4は*"`tick()` // spec
c: forwards tick to instances, then advances rays"*(tickをinstancesに転送し、その後rayを進める)と
述べているが、これは単一のmapを想定して書かれたものである。実際にはmapは2つあり、`Battle`は**全
て**のfireを**あらゆる**advanceより先に実行しなければならない(REQ-0257 §12.1)。単一の`tick()`を
2つのmapに対して単純に合成すると、代わりに`playerInstances, playerRays, enemyInstances, enemyRays`
という順序になってしまう — そしてrayはそれが撃たれたONTO(向けて撃たれた)先のmap上に存在するた
め、この順序ではplayerが撃ったrayがその誕生tickのうちに進んでしまう一方、enemyが撃ったrayは待たさ
れることになる。つまり**map側の順序という理由だけで、playerのrayが1tick早く到達してしまう**。その
ため`tick()`はbrief §4が定める単一map向けのエントリポイントとして存在し続け、`Battle`は代わりに2
つのphaseを呼び出す。

**REQ-0256 §7.1aがこの決定とその全根拠を所有し、REQ-0257 §12.1がphaseの順序を明記する。3つのREQは
すべて同じことを述べており、ユーザーによる却下(veto)があれば3つとも変更される。** 本REQがここで
これに言及するのは、`formation_map.cjs`自身のインターフェースが、この話の4つ目の、より目立たない
バージョンになってしまわないようにするためだけである。

**両平面、単一の抽象化 — これが本REQの要点である。** 現状、player平面のジオメトリは`formation.cjs`
(8x8チェック)にあり、enemy平面のそれは`validateMonsterPackEntry`(PLACEABLEチェック)にある。本
REQの後は、両方とも`IBattleInstancesFormationMap`を構築するようになり、ring述語は1箇所で、両方に
対して一度だけ問われるようになる。formation4を腐らせた非対称性こそが、本REQが取り除くものである。

### 9.1 `shared/`のimportルール — 尊重せよ、"直そう"とするな

`shared/content_validate.cjs`は**`shared/`の外を`require()`してはならない。** このルールは
PLACEABLE定数自体のところに文書化されている(`shared/content_validate.cjs:432-435`)。原文のまま引
用する:

> These constants are duplicated here rather than require()d from `sim/lib/field.cjs` on purpose:
> **shared/ may not require() out of shared/** (the same rule `sim/tests/forecast_parity.cjs`
> documents in its header), so a parity test pins them equal instead of a cross-tree import.

(訳:これらの定数は、`sim/lib/field.cjs`からrequire()するのではなく、意図的にここに複製している:
**shared/はshared/の外をrequire()してはならない**(これは`sim/tests/forecast_parity.cjs`もそのヘ
ッダーで文書化している同じルールである)。そのため、ツリーをまたぐimportの代わりに、parityテスト
がそれらを同じ値であると固定している。)

`forecast_parity.cjs`のヘッダーも同じルールと、それが厳格に封じられている理由を述べている:

> CONSTANTS ARE PINNED. shared/ may not require() out of shared/, so FIELD_ROWS / FIELD_COLS /
> RAY_STEP_BUDGET / ENTRY_JITTER_HALF_WIDTH are re-declared there. That is a drift hazard — so it
> is nailed shut here: change a sim TUNABLE without changing the forecast's copy and CI goes red.

(訳:定数はPINされている。shared/はshared/の外をrequire()できないため、FIELD_ROWS / FIELD_COLS /
RAY_STEP_BUDGET / ENTRY_JITTER_HALF_WIDTHはそこで再宣言されている。これはdrift(値のズレ)の危険源
である — そのためここで厳格に封じている:simのTUNABLE(調整可能値)を、forecast側のコピーを変えず
に変更すればCIはredになる。)

つまり:**`shared/content_validate.cjs`は`sim/lib/formation_map.cjs`をimportしてはならない。** 自
身の`PLACEABLE`を保持し続ける。`formation_map.cjs`(`shared/`ではなく`sim/`に置かれる)は
`sim/lib/field.cjs`をrequireしてよい。この抽象化は、importによってではなく、CONTRACT(契約)と
parityテストによって共有される。

この前例は既に確立されており、新たに発明するのではなく、それを拡張しなければならない。
`sim/tests/run.cjs:1816`は次のように述べている:

> REQ-0184: the geometry constants exist in THREE places — `sim/lib/field.cjs` (the sim's own),
> `shared/content_validate.cjs` (the validator's, which may not require() out of shared/), and
> `client/src/contentadmin/contentShared.ts` (the preview's mirror, which cannot require a .cjs at
> all). Duplication is forced by those module boundaries; SILENT duplication is not. These pin
> them equal, the same way `sim/tests/forecast_parity.cjs` pins the forecast's copies.

(訳:REQ-0184:ジオメトリ定数はTHREE(3つ)の場所に存在する — `sim/lib/field.cjs`(simそのもの)、
`shared/content_validate.cjs`(validatorのもの。shared/の外をrequire()できない)、そして
`client/src/contentadmin/contentShared.ts`(previewのミラー。.cjsを一切requireできない)。重複はこ
れらのモジュール境界によって強制されるものだが、SILENT(サイレント)な重複は強制されるものではな
い。これらは、`sim/tests/forecast_parity.cjs`がforecast側のコピーを固定するのと同じ方法で、互いを
同じ値として固定している。)

既に3つのparityテストが存在しており、これらは引き続きpassし続けなければならない:

| テスト | 固定する内容 |
|---|---|
| `sim/tests/run.cjs:1823` | `shared/content_validate.cjs`のfield寸法 == `sim/lib/field.cjs` |
| `sim/tests/run.cjs:1830` | `PLACEABLE`が、fieldをちょうど1inset(内側に1縮小)したものと一致すること(26x18中の24x16) |
| `sim/tests/run.cjs:1840` | `client/src/contentadmin/contentShared.ts`が同じ寸法を宣言していること(TEXTとして読む — clientはTS/ESMでありnodeのテストからrequireできないため) |

**もし`formation_map.cjs`がringの独自コピーを宣言してしまうと、それはFOURTH(4つ目)のコピーとな
り、4つ目のparityテストが必要になる。** 望ましいのは、何も宣言しないことである — `sim/lib/
field.cjs`から`FIELD_ROWS`/`FIELD_COLS`をrequireし(同一ツリー内のimportであり合法)、そこから
ringを導出する。そうすれば既存のチェーンがそれを既にカバーしており、新たなコピーは生まれない。コ
ピーが真にやむを得ない場合にのみ、新しいparityテストを追加する。ルールは、重複はやむを得ず生じる
ことがあっても、沈黙(silence)は決して許されない、というものである。

`client/src/contentadmin/contentShared.ts:373-374`にも`export const FIELD_COLS = 26, FIELD_ROWS =
18;` + 独自の`PLACEABLE`が存在する。これは変更されない(寸法は無変更)が、REQ-0261はレンダリング
のためにringを必要とするようになる — その際はここから読み取ることになる。

## 10. スコープ

**対象内:**

1. `sim/lib/formation.cjs` — `formation4.unit4` -> `J10:Q17`。noteを書き換え。
   `validateFormationBoxes`を8x8 AND PLACEABLEへ強化。
2. `content/live/dungeon/formations.json` — 同じbox。エントリnote + ファイルnoteを修正(staleな
   `sim/combat.cjs`パスの記載も含む)。
3. `sim/lib/formation_map.cjs` — 新規。両平面向けの`IBattleInstancesFormationMap`(§9)。
4. `sim/tests/run.cjs` — `J11:Q18`のpin(1292)とそのテスト名(1283)をretarget(対象変更)。§6.1の
   mirror-parityテストを追加。強化されたassertがring外の8x8 boxをREJECT(拒否)することを確認する
   テストを追加(このバグそのものに対するregressionガード)。
5. `sim/README.md:89` — 修正。
6. `docs/llm_managed/combat_spec_draft.md` §5.2の379/384行目 + §5.1のアンカーnote。
   `docs/llm_managed/user_managed_rename_suggestions.md:133,140,149`。
7. `web/preview/batch-002` + `batch-004` — `tools/build_preview`経由で再生成。
8. `docs/user_managed/backpack_battle_spec.md`の85/87/89/91/98行目について、ユーザーへのASK
   (§7.2)。

**対象外:**

- **`docs/user_managed/backpack_battle_spec.md`の編集。** 禁止。ASKする(§7.2)。
- **`tick()` / `rays[]`の実装** — ここで宣言するのみ。実装するのはREQ-0256 / REQ-0257。
- **ringのレンダリング** — REQ-0261。本REQはvalidator内でこれを強制する。ブリーフの項目(f)は、
  ringが"by the validator, not only by the renderer"(rendererだけでなくvalidatorによっても)強制
  されるべきだと明示している。
- **他のformationの組み直し。** 残り15個のboxは合法であり、触れない。REQ-0184のport noteと同じ考
  え方である:修正はリバランスではなく、両者を混ぜるとdiffが読めなくなる。
- **`validateMonsterPackEntry`を拡張してgimic idを受け付けるようにすること** — REQ-0259(ブリーフ
  §3 C4/Q4)。
- **e2eハーネス。** 不要:この変更はsim + validator + docsであり、simのユニットテストでカバーされ
  る。decade **7580 / 7581 / 7582**(`5000 + 258*10 + {0,1,2}`)は番号によって予約されているだけ
  で、未使用のまま残る。

## 11. 受け入れ基準

1. `FORMATIONS.formation4.canvases.unit4 === 'J10:Q17'`であり、`formations.json`もこれに一致する
   こと — §5.3のミラーは引き続き成立し、今や機械的にチェックされている(§6.1)。
2. 16box全てが8x8 AND B2:Y17内であることをpassすること。§3.1のsweepを再実行すると
   **violators=0**と出力されること。
3. `validateFormationBoxes`が、ring外に置かれた8x8 boxに対してTHROW(例外を投げる)すること — こ
   れはテストによって証明され、目視確認ではない。現状と同じテーブルを与えた場合、`J11:Q18`に対し
   てthrowしていたはずである。
4. `sim/tests/run.cjs`がgreenであること(1292のpinは今や`J10:Q17`を読む)。`sim/tests/goldens.cjs`
   は引き続き`12 cases OK`かつbyte完全一致(§8)。`sim/tests/forecast_parity.cjs`は引き続き18/0。
5. `J11:Q18`が、CURRENT(現在の)assertionとしてはどこにも残っていないこと。歴史的記述としてのみ
   残る(廃止済みxlsxの経緯、`docs/REQ/done/REQ-0165-*`。これはterminal history(確定済みの履
   歴)であり編集しない)。
6. `shared/content_validate.cjs`に`shared/`の外への新たな`require()`が存在しないこと(§9.1)。既
   存の3つのparityテストが引き続きpassすること。ジオメトリのpinされていない4つ目のコピーが存在し
   ないこと。
7. ユーザーが§7.2に従って`backpack_battle_spec.md`を改訂したこと、またはそれを明示的に保留したこ
   と。
