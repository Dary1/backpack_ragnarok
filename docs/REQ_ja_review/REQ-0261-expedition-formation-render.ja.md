# REQ-0261 — expedition-formation-render: 両方の`IBattleInstancesFormationMap`をCELL=40で描画する

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKED。作業を開始する前に
ユーザーの判断が必要な点が3つある:(1) §4 — spec (d)「Backpacks画面をそのまま1/2のサイズにして、
持ってきて」は、`BoardRenderer`をreuseすることでは満たせず、本REQは代わりに新しいread-onlyな
rendererを提案する;ユーザーは「同じ画面」を求めており、「同じLOOK(見た目)を、read-onlyとして
再構築する」というのは1つの解釈である;(2) §8 — enemy平面は今日時点では**全く描画できない**:
wire上にstaticなenemyの位置が存在せず、これを解決するにはサーバー側の変更に加えてspoilerに関する
裁定が必要である;(3) §8.3.1 — monsterのartはEXISTS(存在する)が、そのfootprintはartから
**drift(乖離)している**(REQ-0188が`derive --write`を未実行のまま残した)ため、defのfootprintの
位置にartを描画すると、少なくとも`frost_gnoll`については、承知の上で目に見える形で誤りとなる。
**予約日:** 2026-07-18
**スラッグ:** expedition-formation-render
**ブランチ:** req-expedition-spec(仕様のみ)
**依頼者:** user、2026-07-18 — 仕様項目(d)、(e)、(f)。
**依存先:** **REQ-0260**(expedition-fullscreen-route) — shell、stage、fit-scale、clock、定数
module。**REQ-0258**(formation-map-padding) — `formation4.unit4 = J10:Q17`、およびringを占有
不能にするvalidator。**REQ-0255**を推移的に(REQ-0240のroster)。
**ブロック対象:** REQ-0262(expedition-ray-vfx)、REQ-0263(expedition-instance-hud)。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §2、§6。

## 1. ゴール

REQ-0260が描画する2枚の空の平面を埋める。spec (d)/(e)/(f)に従う:

- **(d)** player平面は、採用されたformationに従って配置された4つのsquadからなる、Backpacks board
  のcompositionをCELL=40で示す;
- **(e)** enemy平面はplayer平面とSAME(同じ)サイズである;
- **(f)** 各平面は26x18であり、別の色で描かれたpadding-1のringを持つ。このringは**どのinstance
  も占有してはならない**——rendererだけでなく、validator(REQ-0258)によって強制される。

**静的なcompositionのみ。** RayはREQ-0262である。HP bar、cooldown overlay、charge ringはREQ-0263
である。本REQはboardを現状のまま描画し、dataが変わるたびに再描画する。

## 2. 検証済みの現状 — 以下は全て自分で読んで確認した

| fact | source | evidence |
|---|---|---|
| Backpacksのcanvasは26x18ではなく**8x8**である | `content/live/scenario.json:249` | `"ROWS": 8`(および`COLS: 8`);`GameData.LAYOUT`(`api/content.ts:51`)が`BoardRenderer.mount`の`PAD*2 + COLS*CELL` = **716x716**に供給される |
| `BoardRenderer.render`はliveなengine + GameStateを必要とする | `BoardRenderer.ts:323` | `render(state: GameState)`;`const { engine, items, textures, layout, ops } = this.deps;` |
| ……そしてlocal stateにbindされた`BoardOps`も | `BoardRenderer.ts:96-108` | `BoardDeps { engine: EngineInstance; …; ops: BoardOps }` |
| unit coreは定数ではなく**literal**で描画される | `BoardRenderer.ts:928` | `core.circle(x, y, 26);` — 一方`geom.ts:42`は`UNIT_CORE_RADIUS = 26`をexportしている |
| unitのart boxもliteralである | `BoardRenderer.ts:973` | `fitSpriteToBox(sprite, x - 22, y - 22, 44, 44)` |
| 方向を示すdotはliteralである | `BoardRenderer.ts:1000-1006` | `dot.circle(x + cos*30, y + sin*30, 4)` |
| `chargeRing`はparameterise**されている** | `chargeRing.ts:124-125` | `radius: number = RING_RADIUS, width: number = RING_WIDTH` |
| monitorは既に26x18上で4つのsquadをread-onlyで描画している | `MonitorRenderer.ts:213-300` | `mountSquads()` + `parseBoxToPixelRect(squad.box, FIELD_CELL_PX)` + `computeFootprintCells` |
| ……だが**module定数**のcellサイズで | `MonitorRenderer.ts:30-33` | `export const FIELD_CELL_PX = 18;` / `FIELD_W = FIELD_COLS * FIELD_CELL_PX` — そのfile1つの中で21箇所から参照 |
| `parseBoxToPixelRect`はcell pxでparameterise**されている** | `fieldGeometry.ts:88` | `parseBoxToPixelRect(box: string, cellPx: number)` |
| rayのcellは`[row,col]`というNUMBER TUPLES(数値タプル)で届く | `fieldGeometry.ts:29-60` | `RawCell`型 + BUG#4のcrash-loop事後検証 |
| symbolは**2倍**でrasterizeされる | `sprites.ts:56` | `const RASTER_SCALE = 2;` |
| sprite sheetはv11ではなく**v12**である | `sprites.ts:53` | `import spriteSheetSource from '../../../content/sprite_all_v12.svg?raw';` |
| texture mapは**共有されcacheされる** | `sprites.ts:229-247` | `let boardLoadPromise` — session1つにつき、すべてのboardに対して`Map<string,Texture>`が1つ |
| Pixiのmipmapはdefaultで**OFF**である | `pixi.js@8.19.0` `TextureSource.mjs:75` | `this.autoGenerateMipmaps = false;` |
| monster idはart mapに**存在する** | `server/lib/content.cjs:230-241` | REQ-0208:`Object.keys(monstersFromCore().monsters || {})`が`computeArtUrls()`とjoinする |
| ……そしてboardのtexture mapにも到達する | `store/boot.ts:181` -> `itemArt.ts:47-55` | `setItemArtUrls(gameData.ART_URLS)`;`itemIconRasters()`はすべてのkeyについて`item:<id>`をemitする |
| enemy側はfootprintではなく**1x1**のrectを描画する | `MonitorRenderer.ts:454`(0240) | `graphic.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX)` |
| `MonitorEnemyDef`は**宣言されているが一切使われていない** | `MonitorRenderer.ts:101` | tree全体で参照ゼロ(`git grep`) |
| footprintは`[fh, fw]`——HEIGHT FIRST(高さが先)である | `shared/content_validate.cjs:472-479` | `const fh = fp[0]…; const fw = fp[1]…; for (dr<fh) for (dc<fw) cells.push([row+dr, col+dc])` |
| rosterはenemyのPOSITION(位置)を落としている | `server/services/pacing.cjs:226-237` | `m.at`を含むkeyでdedupし、`{id,name,nameJa,hpMax,footprint,packId}`をemitする——**`at`はない** |
| enemyのfield cellはサーバー側には存在する | `sim/lib/packs.cjs:38` | `fieldCells: cellsFor(anchor, def.footprint || [1,1])` — 一切serialiseされない |
| `PLACEABLE`は既にclient側にもmirrorされている | `contentShared.ts:373-374` | `export const FIELD_COLS = 26, FIELD_ROWS = 18;` + `PLACEABLE = {colMin:2,rowMin:2,colMax:25,rowMax:17}` |

## 3. バグ:小さいmonitorは、本物のformation boxを一度も描画したことがない

spec (d)のsquad配置をtraceしている最中に見つかった。**これは`master`、`req-0239`、
`req-0240`のいずれにおいてもliveである。** これはexpeditionについてのfindingではない——
expeditionがコピーするよう指示されたコードについてのfindingである。

`content/live/dungeon/formations.json`は、各formationのboxを**`unit1`..`unit4`**という
keyで持つ:

```json
"canvases": { "unit1": "F2:M9", "unit2": "N2:U9", "unit3": "B10:I17", "unit4": "R10:Y17" }
```

`server/services/core.cjs:389-394`(`listDungeonsAndFormations`)はこれらを**そのまま**
通過させ(`canvases: f.canvases`)、`ApiFormationEntry.canvases`は`Record<string,string>`である
——つまりclientは`unit1..unit4`を受け取る。実際のfileを読み込んで検証済み:4つのformationの
いずれも、正確に`["unit1","unit2","unit3","unit4"]`というkeyを持つ。

`client/src/schedule/Monitor.tsx:446`(master;0240ブランチでは`:180`)は次のようにlookupする:

```ts
const withRealBoxes = squads.map((u) => ({ ...u, box: formation?.canvases[`squad${u.slotIndex + 1}`] ?? u.box }));
//                                                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^ always undefined
```

**`canvases['squad1']`は常に`undefined`である。** そのため`box`はplaceholderのままになる——
`Monitor.tsx:394`はそれをliteral文字列`` `squad${idx + 1}` ``にsetしている。実際のコードを通して
trace(読むのではなく、実際の`formations.json`に対してnode上で実行して):

```
parseBoxToPixelRect("squad1", 18)
  "squad1".split(":")            -> ["squad1"]            (no colon)
  tl = "squad1", br = undefined
  cellIdToColRow("squad1")       -> /^([A-Za-z]+)(\d+)$/ MATCHES: letters "squad", digits "1"
                                 -> col = colLetterToIndex("squad") = 'S' - 'A' + 1 = 19, row = 1
  cellIdToColRow(undefined)      -> {col: 1, row: 1}      (the defensive fallback)
  rect.w = (1 - 19 + 1) * 18 = -306 px
  rect.h = (1 -  1 + 1) * 18 =   18 px
```

`rect.w <= 0`であるため、`MonitorRenderer.mountSquads:227-238`はそのREQ-0169 M3の
degenerate-box(退化box)分岐を取る:**roomを開くたびに、薄暗いfallback輪郭が横一列に4つ、
加えて`console.warn`が4回。**

これを単なるtypo以上に悪くしている点が2つある:

- **REQ-0169 M3は症状を見て、fallbackを出荷した。** その自身のcomment(`MonitorRenderer.ts:228-231`)
  はこう書いている:*"a degenerate box (w/h 0) means the formation-canvas JOIN failed silently
  upstream (Monitor.tsx's fetchDungeons lookup returned no real 'F2:M9'-style box, so the placeholder
  'squad1' string parsed to a zero-size rect)"*(訳:degenerateなbox〔w/hが0〕は、formation-canvasの
  JOIN〔結合〕が上流で静かに失敗したことを意味する〔Monitor.tsxの`fetchDungeons`のlookupが本物の
  'F2:M9'形式のboxを返さず、placeholderの'squad1'という文字列がサイズ0のrectとしてparseされた〕)。
  原因を**正確に**diagnose(診断)しておきながら、それを引き起こしている1単語を直すのではなく、
  失敗を可視化しただけだった。以来ずっとそのfallbackがrenderされ続けており、それらしい8x8の
  正方形を4つ横一列に描くため、一見動いているように見える。
- **バグから2行離れたcommentが、CORRECT(正しい)keyを説明している。** `Monitor.tsx:422-423`:
  *"`box` above is a placeholder key (**"unit1".."unit4"**)"*(訳:上記の`box`はplaceholderの
  key〔**"unit1".."unit4"**〕である)——一方`:394`は`squad${idx+1}`と書いている。このcommentは
  正しい設計の化石であり、コードの方だけがdriftし、commentはdriftしなかった。

**修正(1単語、2箇所とも):** `canvases[`unit${u.slotIndex + 1}`]`、そしてplaceholderは
自身のcommentに合わせて`unit${idx+1}`になる。**この修正は本REQが引き受ける**。REQ-0261はまさに
この同じjoinを行わなければならず、壊れたkeyのコピーを抱えたままexpeditionを出荷すれば、バグを
二重化することになるからである。これが、本REQが小さいmonitorのfileに対して行う唯一の編集であり、
純粋なbug fixであり、そして小さいmonitorが初めて本物のformation boxを描画し始めることになる——
`#/schedule`への**目に見える変更**であり、ユーザーはこれを予期しておくべきである。
「今ある画面は放置して」が意味するのは*redesignするな*ということであって、*壊れたままにしておけ*
という意味ではあり得ない。

**Pinする:** dungeonsのpayload内のすべてのformationについて、clientがlookupするすべての
`canvases` keyが`/^[A-Z]\d{1,2}:[A-Z]\d{1,2}$/`にmatchする文字列に解決されることをテストする。
これが生き延びてきた理由は、そのjoinがBOX(box)を生成していることを、何一つassertしていなかった
からである——REQ-0258の8x8-onlyなvalidatorと同じ形の失敗であり、教訓も同じである:
*ルールの半分しか見ていないゲートは、そのルールを何も見ていないのと同じである。*

## 4. 何がreuseされ、何がrebuildされるか — 本当の推奨

spec (d):「Backpacks画面をそのまま1/2のサイズにして、持ってきて」——*Backpacks画面をそのまま
半分のサイズにして持ってくる*。候補となる読み方は3つある;sourceと突き合わせて生き残るのはその
うち1つだけである。

### 4.1 Option A — CELL=40で`BoardRenderer`をreuseする。REJECTED(却下)。

「ぎこちなくなる」という話ではない——**呼び出すことができない。** `BoardRenderer.render(state:
GameState)`(`:323`)が要求するのは:

1. **liveな`EngineInstance`と`GameState`**(`BoardDeps`、`:96-108`)。expeditionが描画するのは
   **run**である——`fetchRun(roomId)`を通じて到達するサーバー側のdataである。runにはengine
   instanceが存在しない。`ops.container(state)`はcaller自身のlocalなcanvasを返すが、runのsquad
   はそれではない。
2. **`BoardOps`**(`:105-107`)——canvas/inventoryのengine呼び出しsurface
   (`canPlacePO`/`movePO`/…)。read-onlyなviewにはbindすべきmutatorも、登録すべき`boardId`も
   存在しない。
3. **8x8の`layout`**——`mount()`は**1つ**のsquadのためにappを`PAD*2 + COLS*CELL` = 716x716に
   sizeする。expeditionが必要とするのは、**1つの共有された26x18**平面上にある、formation座標に
   配置された**4つ**のsquadである。これはparameterの違いではなく、scene graphそのものの違いで
   ある。

そして`render()`が実際に行っているのは、compositionとinteractionを分離不能な形でinterleave
することである:`core.eventMode = 'static'; core.cursor = 'grab'; core.on('pointerdown', …)`が
**unit描画loopの真ん中に**座っている(`:929-931`);constructorは`globalpointermove`、windowの
`keydown`、canvasの`pointermove`/`pointerleave`、そして`registerBoard()`を`drag.ts`の
cross-board registryに配線している(`:224-228`、`:1409`の`wireGlobalInteraction()`);
drop-targetのtint、ghost、`flash()`、link-traceのring、beam-hover stateが、同じ300行の関数の中に
織り込まれている。1682行あり、read-onlyな半分はlayerではない——混ざり合った少数派である。

したがって「純粋なcomposition経路をextractする」ということは、**それをrewriteすること**を
意味し、しかもinteractiveなboardをpixel-identicalなまま残すという*追加の*制約付きである
(REQ-0125aのgolden G7;e2eスイートは`canvas.board-canvas`でselectする)。これは両方の選択肢の
悪いところ取りである:rewriteのコストを全部払った上に、appの中で最も重要なたった1つの画面に
regressionのsurfaceを抱え、さらにread-onlyな観戦viewと、要件が永遠に乖離していくdrag-and-drop
editorとの間に、恒久的な結合を生んでしまう。

### 4.2 Option B — `MonitorRenderer`をparameteriseしてreuseする。REJECTED(却下)。

魅力的であり、Aよりもずっと近い:`mountSquads()`(`:213-300`)は**既に**共有された26x18平面上に
4つのsquadをread-onlyで描画しており、既に`parseBoxToPixelRect`と`computeFootprintCells`を呼んで
おり、既に共有texture mapからPO iconをresolveしている。これはtree内で最も近い、正しいコードで
あり、もしユーザーがこれを制約していなければ、これが答えだっただろう。

これはユーザー自身の制約によって失敗する。`FIELD_CELL_PX = 18`は**module定数**であり、
`FIELD_W`/`FIELD_H`はload時にそこから導出され、そのfile内**21箇所**から参照され、label-fitの
logicのために**export**もされている。cellサイズをinstance fieldにすることは、**小さいmonitorの
すべてのdraw site**を編集することを意味する——まさにユーザーが放っておけと言った画面である
(「今ある画面は放置して」)。このrefactorの被害範囲こそが、触れるなと言われていたものであり、
その見返りは、468pxのdev-grade dot-plotterと、要求されるfidelityが正反対の2112pxの観戦stageとの
間で、1つのclassを共有することである。(§3と対比せよ:あちらの編集は1単語であり、bug fixであり、
避けられないものである。)

### 4.3 Option C — ADOPTED(採用)。PUREなmoduleをreuseする、新しいread-only renderer。

**新規:`client/src/expedition/ExpeditionRenderer.ts`。** frameworkに依存せず、read-onlyで
あり、cellサイズは最初の行から**constructor parameter**である。

```ts
export interface ExpeditionRendererOpts {
  cellPx: number;               // EXP_CELL (40) — a PARAMETER, never a module const (§4.2's lesson)
  textures: Map<string, Texture>;
  layout: 'row' | 'column';
}
```

**importによって、無変更のまま**、既にpureであるすべてのmoduleをreuseする:

| module | 何を提供するか | なぜ共有して安全なのか |
|---|---|---|
| `board/sprites.ts` -> `loadBoardTextures()` | 唯一の共有texture map(SVG symbol + `unit:*` + `item:*`のraster) | 既にmodule単位でcacheされ、既に3つのconsumerで共有されている;§6 |
| `render/itemCard.ts` -> `computeFootprintCells(shape, rot)`、`fitBoxInBounds(...)` | 回転したfootprint + aspect-lawによるcontain-fit | framework非依存であるよう明示的に構築されており、PixiとDOMのDexの両方で共有されている(`itemCard.ts:1-35`);`MonitorRenderer`も既にこれを使用 |
| `board/unitIcon.ts` -> `resolveUnitIcon`、`unitIconKey` | 批准済みのG6 skin chain(skin -> default -> legacy glyph -> placeholder) | *"Deliberately pure: no Pixi, no DOM, no I/O. Availability is injected as a `has(key)` predicate"*(訳:意図的にpureである:Pixiもなく、DOMもなく、I/Oもない。可用性は`has(key)`というpredicateとしてinjectされる)(`:22-26`) |
| `board/itemArt.ts` -> `resolveItemIcon`、`getItemArtUrl` | registryを優先するitem/monster art | `unitIcon`と同じ形;`:41-55` |
| `board/chargeRing.ts` -> `drawChargeRing(g,x,y,c,radius,width)` | REQ-0125aのG7の時計回りring | radius/widthは既にparameterである(`:124-125`) |
| `schedule/fieldGeometry.ts` -> `parseBoxToPixelRect`、`cellIdToXY`、`cellIdToColRow`、`RawCell`、`FIELD_COLS/ROWS` | 26x18 <-> pixelの算術すべて | `cellPx`は両関数において既にparameterである;§7.2 |
| `contentadmin/contentShared.ts` -> `PLACEABLE`、`isPlaceable`、`cellsFor`、`parseA1` | ringのpredicate + footprint->cells | REQ-0258 §9.1はこのfileを、ringに関するREQ-0261のsourceとして名指ししている |

**本当に新しいものは小さい:** 2平面分のscene graph、ring/gridのbackdrop、squad-boxのpass、
BP/PO/unitのpass、そして`setLayout`形の再配置。*compositionのlogic*は`MonitorRenderer.mountSquads`
(最も近い正しいコード)からportされ、その*fidelity*は、`BoardRenderer`が呼んでいるのと同じpureな
helperを呼ぶことでBackpacksの水準まで引き上げられる。**`BoardRenderer`からcopy-pasteされるものは
何もない**——重要な部分はすべて、既に上記のpureなmoduleにextractされている。そのextractionは
REQ-0038 R2 / REQ-0125a / REQ-0133によって、まさに2人目のconsumerがboardをforkせずに済むように
行われたものであり、これはその2人目のconsumerが到着した場面である。それらのREQが設定した指標——
*"both consumers stay byte-for-byte in sync by construction, not by convention"*(訳:2つのconsumer
は、慣習によってではなく構造によって、byte-for-byteで同期したままになる)(`geom.ts:157-162`)——
に照らせば、option Cはそれらを使う側であり、A/Bはそれらを迂回する側である。

**Cの正直なコスト:** 最初のrendererからdriftしてはならない、2つ目のrendererを持つことである。
その緩和策はculturalではなくstructuralである——共有moduleそのものがanti-drift機構である
(`computeFootprintCells`を変更すれば両方が動く)、そして§14が、共有されていない唯一の数値
(`EXP_CELL === CELL / 2`)をpinする。

**spec (d)の正直な読み方:** ユーザーはBackpacks画面を半分のサイズで求めた。Cが提供するのは、
半分のサイズで、read-onlyで、4つのsquadを一度に見せる、Backpacksの*composition*である。
「そのまま」という語は、コードが忠実には守れない仕事を課している——Backpacks画面は1つの8x8
interactive canvasであり、expeditionは26x18のread-only平面上にある4つの8x8 squadである。
**これは1つの解釈であり、そのようにflagされている**(Status blocker 1)。

### 4.4 意図的に描画しないもの

Backpacks boardは、観戦用の平面上では意味を持たないものを描画している。それらを落とすのは
怠慢ではない;描画する方が嘘になる:

| Backpacks | expedition | 理由 |
|---|---|---|
| drop-targetのtint、ghost、拒否時の`flash()` | **なし** | dragが存在しないため |
| BPのmove-handle badge(`gBadges`、REQ-0042) | **なし** | それはgrab handleであるため |
| 空socketの輪郭 + glyph(`SOCK_GLYPH`) | **なし** | REQ-0263がseated SIを追加する可能性がある;EMPTY(空)なsocketはediting用のaffordanceである |
| chain-linkのtoggle | **なし** | canvas限定のediting control(`ops.isCanvas`) |
| port target ◇ / connection ◆マーク | **0263へ延期** | 意味はあるが、これらはcompositionではなくHUDである |
| beam(`traceBeams`) | **0262へ延期** | LIVEなlink beamは§6.0が認める4つのglowの1つであり、VFXの予算に属する |
| BPのcolour grid tint、BPの輪郭、name label | **あり** | composition |
| 配置されたPOのart、unit core + icon、方向dot | **あり** | composition |

## 5. Scale定数 — そして、その名の通りには動かない1つ

### 5.1 表

| `board/geom.ts` | value | expedition | rationale |
|---|---|---|---|
| `CELL` | 80 | **40**、`expedition/expeditionGeom.ts`の`EXP_CELL`として(REQ-0260 §6) | spec (d)。**`geom.ts`は編集されない**——それは稼働中のBackpacks boardを半分にしてしまう(REQ-0260 §6.2)。 |
| `PAD` | 38 | **存在しない** | padding-1のRINGが、この平面のmarginであり、cell単位で、grid内側にある。ブリーフ自身のC5の算術(26*40 x 18*40 = 1040x720)にPAD項はない。REQ-0260 §6.1。 |
| `UNIT_CORE_RADIUS` | 26 | **13** | 半分。**ただし§5.2を参照——定数を半分にしても、円は半分にならない。** |
| `SOCKET_SEARCH_RADIUS` | 26 | **portしない** | **interactive専用。** `geom.ts:11-13`:*"Nearest-socket search radius in board-canvas pixels"*(訳:board-canvas pixel単位での、最も近いsocketの検索半径)——drop時の最近傍socket検索。read-onlyな平面はdropを一切行わない。半分にするのではなく:**存在しない**。 |
| `DRAG_ARM_THRESHOLD` 5、`DBLCLICK_WINDOW_MS` 300、`FLASH_MS` 350、`CLAIM_PULSE_*` | | **portしない** | すべてinteraction専用。 |
| `BEAM_HOVER_SLOP` | 12 | **portしない**(REQ-0263が再検討する可能性あり) | hover専用。そのdoc内の理由付け*"still smaller than half a cell (40)"*(訳:それでもcellの半分〔40〕より小さい)に注意——`EXP_CELL=40`ではcellの半分は**20**であるため、反射的に6へ半減させると、従順に見えながらそのcommentの主張そのものを黙って無効化してしまう。 |
| `BEAM_DIM_ALPHA` 0.16、`INV_UNIT_ALPHA` 0.22 | | **無変更**でreuse | alphaは長さではないため。 |
| `chargeRing`の`RING_RADIUS`/`RING_WIDTH` | 30 / 3 | **15 / 1.5**をARGS(引数)として渡す | 既にparameterise済み(`:124-125`)。**定数自体は変更してはならない**——REQ-0125aのgolden G7がBackpacks boardについて30/3をpinしている。(REQ-0263が消費する;半減がここ1箇所で完結するよう、ここで規定する。) |
| unitのart box | `x-22, y-22, 44, 44` | `x-11, y-11, 22, 22` | `BoardRenderer.ts:973`のliteralであり、定数ではない。§5.2。 |
| 方向dot | radius 30、dot r 4 | 15 / 2 | `:1000-1006`のliteral。§5.2。 |

### 5.2 `UNIT_CORE_RADIUS`は嘘であり、codebaseは既にそれを警告していた

`geom.ts:38-42`:

```ts
// REQ-0142: the Unit core circle's radius (BoardRenderer draws it with
// core.circle(x, y, 26)). Named here because the link-trace hover hit-test
// needs the SAME number the core is drawn with -- a hover target that does
// not match its own visual is a bug waiting to happen.
export const UNIT_CORE_RADIUS = 26;
```

`BoardRenderer.ts:928`:

```ts
core.circle(x, y, 26);      // <-- the LITERAL. Not UNIT_CORE_RADIUS.
```

**この定数は、描画箇所の数値に名前を与えるために導入されたが、その描画箇所自身がそれを使う
ように変更されることは一度もなかった。** すべての*consumer(消費者)*はこの定数を使っている
(`:558`、`:574`、`:590`、`:1367`、`:1371`、`:127-128`——link-traceのring、beam-hoverの
hit-test、破線shadowのinset);*producer(生産者)*はそうではない。これが正しくあり続けたのは、
単に両方がたまたま26だったからにすぎない。

本REQにとっての帰結を、誰もtaskのframingにつられて崖から落ちないよう、はっきりと述べておく:
**「`UNIT_CORE_RADIUS`を26->13に半減させる」は、hit-testとlink-traceのringを変えてしまい、
描画される円の方は26のまま残ってしまう。** Backpacks boardの上では、これは即座に、commentが
予告していたバグそのものになる——*「自分自身のvisualと一致しないhover target」*——しかも半減
された値は2倍分ずれている。

`geom.ts`は編集されない(§5.1)ため、Backpacks boardは本REQによるriskを負わない。しかし
潜在的なバグは本物であり、善意による1つの編集だけでいつでも発火し得る。**ここでzero-riskな修正
として推奨する:** `BoardRenderer.ts:928`を`core.circle(x, y, UNIT_CORE_RADIUS);`にする。
今日時点ではpixel-identical(26 === 26)であるため、goldenは動かず、テストの変更も不要である;
これによってこの定数は真実になり、それこそが誰もが安全にこれについて推論できる唯一の状態である。
同じ、ゼロコストのついでに、他の3つのliteralにも名前を与える:`UNIT_ART_BOX = 44`(`:973`)、
`UNIT_DIR_DOT_RADIUS = 30`、`UNIT_DIR_DOT_SIZE = 4`(`:1000-1006`)。

**expeditionのrendererは、半減させたliteralからではなく、4つすべてを`cellPx`から導出する:**

```
coreRadius   = cellPx * 0.325   // 26/80  -> 13.0 at cellPx=40
artBox       = cellPx * 0.55    // 44/80  -> 22.0
dirDotRadius = cellPx * 0.375   // 30/80  -> 15.0
dirDotSize   = cellPx * 0.05    //  4/80  ->  2.0
```

**magic numberではなく比率。** `cellPx = 40`では、これらは正確に表の値を与える;他のどの
cellサイズでも、比例したまま保たれる。実際のinvariant(不変条件)は比率の方である——半分になった
整数は、`EXP_CELL`がちょうど`CELL/2`であることの偶然の一致にすぎず、cellサイズがconstructor
parameterであるrenderer(§4.3)は、その偶然を埋め込んではならない。

## 6. CELL=40におけるtextureの鮮明さ — 検証済みであり、問いは反転する

taskは問う:*CELL=40において、2倍のrasterで十分か?* **答えはyes——圧倒的に十分である。
本当のriskはその逆の方である。** 推測ではなく、実測している。

**Sheet。** `content/sprite_all_v12.svg`、26個の`<symbol>`。それらのviewBoxを数えると:

| viewBox | count | cells |
|---|---|---|
| `0 0 64 64` | 13 | 1x1 |
| `0 0 64 128` | 6 | 1w x 2h |
| `0 0 128 128` | 3 | 2x2 |
| `0 0 192 128` | 2 | 3w x 2h |
| `0 0 64 192` | 1 | 1w x 3h |
| `0 0 128 192` | 1 | 2w x 3h |

すべてのdimensionは64の倍数である——**このsheetの規約は、grid cell 1つあたりSVG単位で64、
というものである。**

**Raster。** `sprites.ts:56`の`RASTER_SCALE = 2`;`standaloneSvgString`は
`width = sym.width * RASTER_SCALE`をemitし、`rasterize()`は同じサイズのcanvas上にdrawする。
したがって1x1のsymbolは**128x128 px**のtextureになる。

**算術。**

| | 画面上のbox | texture | box当たりのtexture比 |
|---|---|---|---|
| Backpacks、`CELL=80` | 80 px | 128 px | **1.6x** |
| Expedition、`EXP_CELL=40` | 40 px | 128 px | **3.2x** |
| Expedition、1920x1080時(fit-scale 0.909) | 36.36 px | 128 px | **3.52x** |

**したがって、CELL=40において2倍は単に十分というだけではない——expeditionは、そのartが
authoringされた対象であるboard自体よりも、よくsupersampleされている。** under-samplingの問いに
答える必要は一切ない。

**本当のrisk:MINIFICATION ALIASING(縮小によるエイリアシング)。** Pixi v8.19.0の
`TextureSource`は`this.autoGenerateMipmaps = false`をsetしており(
`node_modules/.pnpm/pixi.js@8.19.0/node_modules/pixi.js/lib/rendering/renderers/shared/texture/sources/TextureSource.mjs:75`
を読んで検証済み)、`Texture.from(canvas)`(`sprites.ts:170`)はそのdefaultをそのまま受け取る。
128pxのtextureを36-40pxのboxに描画すると、**mip chainなしでbilinearにsampleされる、約0.3倍への
縮小**になる——高周波のdetail(iconの1pxの輪郭線、hatching)はshimmer(ちらつき)、crawl(揺れ)
することになる。そしてそれは、まさにこの画面の趣旨そのものである*stageがanimateしている最中に*
crawlする。

**取り得るleverは3つあり、そのうち使えるのは1つだけである:**

1. **expeditionのために`RASTER_SCALE`を下げる** — **不可能。** `sprites.ts:229`の
   `let boardLoadPromise`は、session全体について`Map<string,Texture>`を**1つだけ**cacheし、
   `Board`、`InventoryBoard`、`MonitorRenderer`のいずれにも共有される。consumerごとのraster
   というものは存在しない。`RASTER_SCALE`を変更すると、Backpacks boardの分も変わってしまう。
   **誰かがこれを自明な修正として提案する前に知っておく価値がある。**
2. **expedition用に、1倍の2つ目のtexture mapを持つ** — 却下。decode時間とVRAMが倍になり、
   art pipelineをforkしてしまい、*upscale*されるportraitのケース(REQ-0260 §8、scale 1.038)を
   crispに保っている3.2倍分のheadroomを捨ててしまう。
3. **共有mapに対してmipmapをONにする** — **ADOPTED(採用)、計測待ち。** 唯一のconstruction
   site(`sprites.ts:170`)で`texture.source.autoGenerateMipmaps = true`とし、uploadの後に
   `source.updateMipmaps()`を行う。これは**Backpacks boardにも役立つ**(1.6倍の縮小もaliasは
   するが、より軽度である)し、どちらにも害はない;26symbolのsheetに対して+33%のtexture memory
   は無に等しい。

実装時に、想定だけで済ませず検証すべき点が2つある:

- **Non-POT。** 64と128は2のべき乗であるが、**192はそうではない**——2つのsymbolが幅192、2つが
  高さ192であり、2倍で384pxのrasterとなり、これもnon-POTである。Non-POTなmipmapはWebGL1では
  非合法であり、WebGL2/WebGPUでは合法である;Pixi v8の下限はWebGL2であるため、これは問題ない
  はずである——しかし`TextureSource._refreshPOT()`が存在し、`autoGenerateMipmaps`との相互作用を、
  これをdoneと呼ぶ前に実際のcontext上で確認しなければならない。もしnon-POTなmipmapが不調な
  挙動を示した場合のfallbackは、mipmapをoffのままにしてshimmerを受け入れることである(これは
  correctnessの問題ではなくqualityのregressionである)——sheetをPOTになるようpaddingすること
  では**ない**。それはすべてのviewBoxをre-authoringし、64-units-per-cellという規約を壊して
  しまうことになる。
- **想定ではなく、A/Bテストしなければならない。** 「mipmapはaliasingを修正する」は一般論としての
  真実であって、実測ではない。同じstageを36.36pxのcellで、mipmapありとなしで比較し、目に見えて
  良くなる場合にのみその変更を採用する。Bilinear-with-mipsは*より柔らかく*見える。これは36pxの
  iconにおいては、多少のcrawlより悪い結果になり得る。

**UnitとmonsterのRASTER(raster)は、別の、より悪い話であり**、上記ではカバーされない:これらは
registryのPNGであり(`unit_icon_pipeline.md` §0——1x1 cell、1:1 aspect、**256x256**が目標)、
`RASTER_SCALE`を一切経由せず`Assets.load`(`sprites.ts:198`)経由でloadされる。256pxのunit
portraitを22pxのart box(§5.2)に入れると、**約0.086倍**への縮小になる——symbolより一桁悪く、
mipmapが本当に重要になる場所である。REQ-0263がこの平面上でのunit/monster artを所有する;この
数値は、0263がこれを再導出せずに済むよう、ここに記録しておく。

## 7. Squad配置(spec d)

### 7.1 chain(連鎖)

```
room.formationId                                   (ApiRoom, dto.ts:399)
  -> fetchDungeons().formations.find(f => f.id === room.formationId)     (api/schedule.ts:27)
    -> formation.canvases["unit1".."unit4"]        (§3 — NOT "squad1"..)
      -> parseBoxToPixelRect(box, EXP_CELL)        (fieldGeometry.ts:88)
        -> { x, y, w, h } on the 26x18 plane, w === h === 8 * EXP_CELL === 320
room.slots[i].squadIndex
  -> snapshot.state.presets.store[squadIndex]      (the LOCAL client store — see §7.3)
    -> squadCanvas.bps[] / .pos[]                  (8x8 local coords)
```

`parseBoxToPixelRect`は**既に**`cellPx`でparameterise済みであり、既にA1正しい
(`x = (a.col - 1) * cellPx`)。`EXP_CELL = 40`では、`"F2:M9"` -> `{x: 200, y: 40, w: 320, h: 320}`
となる。CELL=40における8x8のsquad boxは、Backpacks boardの8x8 gridを半分のサイズにしたものと
**正確に**一致する(`8*40 = 320 = (8*80)/2`)。**spec (d)は、何かを強制することなく、geometryから
自然に導かれる**——これは、CELL=40が恣意的な半減ではなく正しい論理的選択であることの、最も強力な
証拠である。

**REQ-0258への依存:** `formation4.unit4`は(row-18のpadding ring上に乗っている`J11:Q18`
から)`J10:Q17`になる。本REQはcontentが述べていることをそのまま読んで描画する;どのboxも
**再導出したり「修正」したりはしない**。もし0258がまだ入っていなければ、formation4のbacklineは
**ring上に**描画されてしまう——これはillegalな状態をrendererが忠実に描画しているだけであり、
まさにこれこそが、(f)がrendererではなくvalidatorによって強制される理由である(§9)。

### 7.2 `fieldGeometry.ts`をreuseせよ、再導出するな — それが記憶しているcrash-loop

`fieldGeometry.ts`はsimの`parseBox`/`colLetterToIndex`のclient側mirrorであり、その長いdoc
commentは、本REQが繰り返してはならない、実際に実測された障害を記録している。そのまま引用する
(`:36-60`):

> **BUG #4 FIX (REQ-0041)** — root cause: this function used to assume its argument was ALWAYS a
> "M9"-style string and called `cellId.trim()` unconditionally. sim/combat.cjs's actual
> ray_fire/ray_bounce/ray_step events carry `entry`/`at`/`path[]` as raw **`[row,col]` NUMBER TUPLES,
> never strings** … *"TypeError: e.trim is not a function"* … Since Monitor.tsx's poll effect only
> advances `lastEventIndexRef` AFTER applyEvents() returns successfully, this exception fired again on
> **EVERY subsequent ~2s poll tick forever** … pegging the render thread in a **permanent crash-loop**
> … the browser tab's renderer becoming unresponsive within a few poll cycles.

(訳:BUG #4の修正(REQ-0041)——根本原因:この関数はかつて、自分の引数が常に"M9"形式の文字列で
あると想定しており、無条件に`cellId.trim()`を呼んでいた。sim/combat.cjsの実際の
ray_fire/ray_bounce/ray_stepイベントは、`entry`/`at`/`path[]`を、文字列では決してなく、生の
**`[row,col]`というNUMBER TUPLES(数値タプル)**として運ぶ……*"TypeError: e.trim is not a
function"*……Monitor.tsxのpoll effectは、applyEvents()が成功裏にreturnした後にのみ
`lastEventIndexRef`を進めるため、この例外は**それ以降のおよそ2秒ごとのpoll tickのたびに永遠に**
再発火し……render threadを**恒久的なcrash-loop**に固定してしまい……browser tabのrendererは
数回のpoll cycleのうちに応答不能になった。)

そして:**このwire上には2つの座標表記が共存しており、それらは互換ではない。**
`"F2:M9"`形式のSTRINGS(文字列)はauthoring/box構文である(formation canvases、pack memberの
anchorである`m.at`)。`[row,col]`というNUMBER TUPLESはruntimeの位置である
(`ray_fire.entry`、`ray_bounce.at`、`ray_step.path[]`)。`"M9"`形式の文字列idがevent内に現れる
のは、entity/actorのLABEL(`maskLabel`)としてのみであり、位置としては決して現れない。
`cellIdToColRow`は設計上両方を受け付け、不正な入力に対しても**決してthrowしない**
(`{col:1,row:1}`にfallbackする——死ぬくらいなら隅に描画する)。

**`ExpeditionRenderer`は`fieldGeometry.ts`をimportする。`colLetterToIndex`を再実装すること
はない。** このparserの3つ目のコピーは、BUG #4が再発見される3つ目の場所になってしまう——そして
2つ目のコピーは、既にtabのhangという代償を払っている。

この系(corollary)も同じくload-bearing(構造を支える)であり、REQ-0262がloopを所有するとは
いえ、これがこのrendererのcontractの性質であるため、ここに記録しておく:**expeditionのevent
適用は、cursorの前進をsuccess(成功)に依存させてはならない。** そのcrash-loopの深刻さは、まったく
もって*「applyEvents()が成功裏にreturnした後にのみcursorを進める」*という点から生じていた——
1つの不正なeventが、その後永遠にre-throwし続けたのである。cursorを先に進めるか、event単位で
wrapすること。

### 7.3 playerのdataはLOCAL(ローカル)なstoreから来る — rosterでは埋まらないgap

`Monitor.tsx:152-174`(0240)は、そのsquadを**`snapshot.state.presets`**——*閲覧している
clientそれ自身が*保存したsquad canvas——から構築し、`room.slots[i].squadIndex`によってのみrunと
結び付けている。**squadのcompositionについては、何一つserverのrun viewからは来ていない。**

これが今日成立しているのは、roomが`visibility: 'self'`であり(`dto.ts:398`)、runnerが
viewer自身だからである。これは3つの帰結を伴い、expeditionはそれを継承する。それらは黙って継承
するのではなく、はっきりと述べておくべきである:

1. **spectator-safe(観戦者に対して安全)ではない。** 誰かが他人のexpeditionを見た瞬間、
   player平面は*viewer自身の*squadを描画してしまう。これは本REQが解決すべき問題ではない;
   本REQはこれを悪化させてはならない、というだけである。
2. **これはrun開始時点ではなく、NOW(今)のsnapshotである。** run中に`#/backpacks`でsquadを
   編集すると、simはsortie時点のsquadのまま戦い続けているのに、平面の方は足元で変わってしまう。
   `ApiRunRosterSlot`(`dto.ts:464-468`)は`result.bps.squadSlot`から`bps: {id, hpMax}[]`——
   **本物の**compileされたroster——を運ぶが、idとhpMaxのみである:**`shape`も`origin`も`pos`も
   ない。** つまりrunは*どの*BPが戦ったかを知っており、clientは*それらがどう見えるか*を知って
   いるが、両方を知っている者はどちらにもいない。
3. **`squadIndex === presets.active`はspecial-caseされている**(`Monitor.tsx:158`:
   `slot.squadIndex === squadStore.active ? activeCanvas : squadStore?.store[slot.squadIndex]`)。
   active squadは`presets.store`ではなく`state`に住んでいるためである。expeditionはこれを
   再現しなければならず、さもなければactive squadは古いまま描画されてしまう。

**本REQは同じjoinをreuseし**(2つ目のsource of truthを発明しない)、active-squadの
special caseを再現し、それを埋めるのではなく**gapとして記録する**。それを埋めるということは、
compileされたsquad snapshotをwire上に載せることを意味する——`sim/lib/compile.cjs`の
`compileSquadSnapshot`は既にサーバー側でまさにこの形を構築している——が、これはそれ自体で1つの
サーバー側REQである。REQ-0240自身の正直な「Data-gap status(データ欠落状況)」を再発見するので
はなく、その上に積み上げる:**これはM1の、明言されていない5つ目のgapである。**

## 8. enemy平面(spec e、f) — 今日時点では描画できない

### 8.1 spec (e):同じサイズ — free(タダ)

`PLANE_W x PLANE_H` = 1040x720が両方とも、REQ-0260 §6より。両平面は同じ
`IBattleInstancesFormationMap`である;enemy平面はより小さいinsetではない。`MonitorRenderer`に
おいては既にそうなっている(`drawFieldBackdrop`は両方に対して同一に呼ばれる、`:180-181`)。
決定すべきことは何もない。

### 8.2 blocker(障壁):wire上にenemyのPOSITIONS(位置)が存在しない

enemyの絶対field cellは**存在する**——`sim/lib/packs.cjs:38`は、pack memberの`at`という
anchorから、compile時に`fieldCells: cellsFor(anchor, def.footprint || [1,1])`を計算している。
それらは単に**一切serialiseされない**だけである。

`buildRoster`(`server/services/pacing.cjs:220-239`)は`pack.members`を歩き、dedup用のkey
`packId + '/' + m.enemy + '/' + (m.at || '')`を構築する——**`m.at`を手の中に持っている**——
そしてそれからemitする:

```js
enemies.push({ id: def.id, name: def.name, nameJa: …, hpMax: …, footprint: def.footprint || [1,1], packId });
//             ^ the DEF id, not an instance id                                              ^ no `at`
```

したがって今日時点では、enemy側は**遅延的に、ray eventから**描画される:
`addOrUpdateEnemyMarker`(`MonitorRenderer.ts:440-473`)は、**最初に観測されたray-eventのcell**に
markerを作成し、そのcellでkeyされる。帰結は、いずれも検証済みであり:

- **最初のrayが着弾するまで何も描画されない。** enemy平面はt=0において空である。spec (f)が
  求めているのはformation MAP(map)——最初から存在する静的な配置である。根本的に非互換である。
- **Markerは、enemyごとではなく、CELLごとにkeyされる**
  (`mapKey = `${cellId[0]},${cellId[1]}``)。1つのcellでhitした2体のenemyは1つのmarkerを共有し、
  2つのcellでhitした1体のenemyは2つのmarkerになる。
- **Footprintは一切描画されない。** `graphic.rect(0, 0, FIELD_CELL_PX, FIELD_CELL_PX)`——defが
  何と言っていようと、**1x1**のrectである。2x2の`frostback_bear`も1cellとして描画される。
- **`footprint`を運ぶ`MonitorEnemyDef`(`:101`)は、宣言されているが、tree内のどこからも一切
  参照されていない。** これは意図の化石である。

> **ブリーフへの訂正。** §6と`MonitorRenderer.ts`のmodule commentは、いずれもenemy側を
> *"simple footprint blobs + name label"*(訳:単純なfootprintの塊 + name label)と説明し、これを
> *"the explicit spec, not a placeholder shortcut"*(訳:placeholderの近道ではなく、明示的な仕様
> である)と呼んでいる。**name-label**の側は正確であり、**spec-not-shortcut**という位置づけも
> 妥当である。しかし**footprintの塊にfootprintは存在しない**:実際にはrayのcellに固定された1x1の
> rectである。ブリーフを読んだ者は「blobをartに差し替えればよい」と見積もるだろうが、実際の作業は
> **「そもそも位置を得る」**ことである。

**seam(サーバー側、additive):** `ApiRunRosterEnemy`と`buildRoster`をextendする。必要な情報は
既にscope内に揃っている:

```ts
export interface ApiRunRosterEnemy {
  id: string;                      // the DEF id (unchanged)
  instanceId: string;              // NEW — the sim's own entity id ("frostback_bear#0"); §8.4
  at: string;                      // NEW — the A1 top-left anchor, verbatim from the pack member
  fieldCells: [number, number][];  // NEW — cellsFor(parseA1(at), def.footprint), DERIVED server-side
  name: string; nameJa: string; hpMax: number;
  footprint: number[];             // [fh, fw] — unchanged, DISPLAY ONLY; §8.5
  packId: string | null;
  masked: boolean;                 // NEW — traps/gimics are masked; §8.6
}
```

`fieldCells`は、clientに`cellsFor`を再実行させるのではなく、**derived(導出済み)**の状態で
送られる。理由は2つある:transposeのhazardを構造的に取り除くこと(§8.5)、そして
`shared/content_validate.cjs`の`cellsFor`こそが、layoutをADJUDICATE(裁定)した権威であること
である。anchorだけを送ってclientに再導出させることは、importできない権威にmirrorが同意する
ことを求めるようなものである——REQ-0258 §9.1がまさに指摘しているanti-patternである。
debuggabilityのため、そしてREQ-0262のentry-cell projectionのために、`at`も併せて送る。

**Spoiler surface(ネタバレ面)——本物のものである。** t=0時点でのstaticなenemyの位置は、
最初のrayより前に、enemy formation全体を暴露してしまう。REQ-0240はまさにこれを避けるために
*"a leak-safe HINT the client reveals on first-seen"*(訳:漏洩を防ぐHINT〔手がかり〕であり、
clientはfirst-seen〔初めて見えた〕時点でこれをrevealする)(`dto.ts:470-472`)を選んでおり、
`server/routes/schedule.cjs:234-240`も同じ精神でrun viewを"spectator-safe"(訳:観戦者に対して
安全)と呼んでいる。**しかしexpeditionはformation mapそのものである;formationを隠すことは、
この画面の意義を損なう。** 推奨:位置を送り、instanceごとに`masked`を尊重し(§8.6)、まだ
first-seenでないenemyは**footprintのsilhouette(輪郭)**——形とサイズのみ、artなし、name
なし——として表示する。配置は見えるが、正体は見えない。**これはユーザーが確認しなければならない
designの判断である**(Status blocker 2)。

### 8.3 Monster artはEXISTS(存在する) — ブリーフはこの点でstale(陳腐化)している

ブリーフ§6と`MonitorRenderer.ts:12-13`はどちらも、enemyのartはunbound(未結合)であると
述べている(*"no real enemy art exists yet, per the task brief"*(訳:taskのブリーフによれば、
本物のenemy artはまだ存在しない))。**それはREQ-0036/0169の時点では真実だったが、
REQ-0188/0208以降は真実ではない。** そのchainは完結しており、liveであり、end to endで検証済み
である:

1. **Artworkは存在する。** REQ-0188のoutcome section:*"Seed run live: **created=19**, re-run
   no-op"*(訳:Seed run実行:**created=19**、re-runはno-op)、そして`monsters-003-flux2:gnoll`
   (monster art `{w:3,h:4}`)は**ADOPTED(採用済み)**である。
2. **`monster`はfirst-classなart kindである。** `server/services/art_sizing.cjs:24`:
   `const KINDS = ['po','si','unit','monster','bpskin','custom'];`(+ REQ-0255によるREQ-0211の
   mergeの後は`gimic`)。
3. **Monster idは`art_urls`にjoinされる。** `server/lib/content.cjs:230-241`(REQ-0208)、そのまま
   引用:*"monster ids join the resolved map for the Dex's monster catalog. resolveItemArtNames is
   kind-generic … and monster artworks follow the exact-name convention (artwork system_name ==
   enemy id — REQ-0184/0188), so no new resolver is needed."*(訳:monster idはDexのmonster
   catalog用に解決されたmapにjoinする。resolveItemArtNamesはkindを問わず汎用であり……monsterの
   artworkはexact-nameの規約に従う〔artworkのsystem_name == enemy id——REQ-0184/0188〕ため、
   新しいresolverは不要である。)
4. **それらはclientに到達する。** `api/content.ts:107`の`ART_URLS = payload.art_urls ?? {}`;
   `store/boot.ts:181`の`setItemArtUrls(gameData.ART_URLS)`。
5. **それらはBOARD TEXTURE MAP(boardのtexture map)に、既に到達している。**
   `itemArt.ts:47-55`の`itemIconRasters()`は`ITEM_ART_URLS`の**すべての**keyをiterateする——
   1つのflatなmapであるため、monster idも含まれる——そして`item:<id>`というentryをemitする;
   `sprites.ts:243`がそれらを共有mapへmergeする。**`textures.get('item:' + enemyId)`は今日
   時点で、新しい配線を一切必要とせずresolveする。**
6. **これはproductionで実証されている。** `client/src/dex/MonsterCatalog.tsx:11-15, 65`は、
   liveなDex上で`getItemArtUrl(monster.id)`を通じてmonsterのportraitをrenderしている。

**したがって「今日時点で何が描画できるか」への正直な答えは:** §8.2の位置さえ与えられれば、
monsterの**採用済みのart**は、boardが既に使っているresolverを通じて即座に描画できる。欠けている
のは**geometryとidentityであり、artではない。**

**留意点、いずれも実在する:**

- **pg限定。** `computeArtUrls()`は`if (process.env.STORAGE_BACKEND !== 'pg') return {};`で
  始まる——files backendの下ではmapは空であり、すべてのenemyがplaceholderにfall throughする。
  これはNORMAL(通常)のdegraded状態であり、`MonsterCatalog`が扱っているのとまさに同じであり、
  描画を妨げてはならない。
- **§8.3.1。**

#### 8.3.1 FootprintはARTからDRIFTしている(乖離している) — それを取り繕うな

REQ-0188の批准済みgolden 1は*"**Art is the authority** for a thing's cell geometry"*(訳:
物のcell geometryについては**artが権威である**)である。そのoutcome sectionは、この
reconciliation(整合化)が**一度も完了しなかった**ことを記録している:

> `derive --check`: **2 drifts** (`frost_gnoll` `[1,1]->[4,3]` from `monsters-003-flux2:gnoll` — a REAL
> gameplay footprint change that would overlap `enc_pack_1` neighbors and needs pack re-composition +
> user sign-off; …). **`derive --write` NOT run**; stays todo pending the user ruling on those two.

(訳:`derive --check`:**2件のdrift**(`frost_gnoll`が`monsters-003-flux2:gnoll`から
`[1,1]->[4,3]`——これはREAL〔本物の〕gameplay上のfootprint変更であり、`enc_pack_1`の隣接体と
重なってしまうため、packの再構成 + ユーザーのsign-offが必要である;……)。**`derive --write`は
未実行**;この2件についてユーザーの裁定が出るまでtodoのままである。)

したがって`content/live/dungeon/enemies.json`は`frost_gnoll`を`"footprint": [1, 1]`だと
述べている(読んで検証済み)一方、その採用済みartは幅3、高さ4の絵である。**そのartを1x1の
boxに描画すると、cellサイズに関わらず、3x4のmonsterが1つのcellに押し潰される**ことになる。

**本REQは、artの形を優先することでこれを「修正」してはならない。** SIMが戦っている相手は
footprintの方である——`packs.cjs:38`は`def.footprint`から`fieldCells`を導出し、rayが命中する
のは**その**cellである。4x3のart形状を描画するrendererは、*描かれた*身体が*実際にhitされる*
身体と一致しないmonsterをplayerに見せることになる。これは潰れたiconよりも悪い:ルールが動いて
いることを示すことこそが存在意義である画面の上で、game ruleについて嘘をついていることになる。

**したがって:artをDEFのfootprint boxにcontain-fitさせる**(`fitBoxInBounds`——aspect law
〔縦横比の法則〕であり、引き伸ばしは決してしない)。`frost_gnoll`について言えば、これは1つの
40x40 cellの中に3:4のportraitをletterboxすることを意味する。見た目は悪くなる。**正直に悪い**
のであり、そうしているのはこのrendererではなく、REQ-0188の未解決の裁定である。きれいな解決策を
伴うhardな依存として記録しておく:**ユーザーが2件のdriftについて裁定を下し、
`tools/derive_def_geometry.cjs --write`が実行されれば、`frost_gnoll`は`[4,3]`になり、
`fieldCells`は12cellになり、artはそのboxにぴったり収まる——rendererの変更はゼロで済む。**
ArtとgeometryはDATA(データ)として到着する。これがREQ-0188の設計のすべてである。

### 8.4 Instanceのidentity — rosterの`id`はeventの`dst`ではない

rosterの`id`は**def**のidであり(`buildRoster`:`id: def.id`)、そのdedup keyは`at`を含む
ため、**`ice_archer`を3体含むpackは、いずれも`id: 'ice_archer'`を持つ3つのroster entryを生む。**
それらを区別できるのは、rosterがその後捨ててしまう`at`によってのみである(§8.2)。

一方simのeventは、`maskLabel(entity)`(`sim/lib/replay.cjs:21-23`)を介してentityにlabelを
付ける:`return entity.masked ? '?' : entity.id;`——ここで`entity.id`はinstance suffixを伴う。
REQ-0240のdeviation 4はこれを名指ししており(*"e.g. `frostback_bear#0` instance suffix"*
(訳:例:`frostback_bear#0`というinstance suffix))、deviation 3はその帰結をはっきりと述べて
いる:

> **Enemy HP ticks on the stage deferred.** `ray_hit`'s masked `dst` label does not resolve to a roster
> enemy id/hpMax, so per-enemy HP bars are not drawn.

(訳:stage上でのenemy HPの更新は延期。`ray_hit`のmaskされた`dst`labelはrosterのenemy id/hpMax
に解決されないため、enemyごとのHP barは描画されない。)

**rosterとevent logは、2つの異なるnamespaceに属している。** REQ-0263はHPのためにこのjoinを
必要とする;**REQ-0261はplacementとidentityのためにこれを必要とする**——これがなければ、
`at="R5"`にいる静的なenemyを、それを倒す`ray_hit dst="ice_archer#1"`と結び付けることができず、
平面は死んだinstanceをgrey outすることさえできない。§8.2の`instanceId`がそのjoinであり、
これはサーバーが発明しなければならない新しい事実ではない:simはcompile時点で、entity上に既に
それを持っている。これはREQ-0240のM-gapリストが、正直な6つ目の項目を得るということであり、
ここでこれを埋めることは、REQ-0263のdeviation-3のblockerも無料で解消することになる。

### 8.5 Transpose(転置)の規約 — それを尊重せよ。そして、それがほぼ誤っている唯一の箇所

`enemy/1`は、footprintを**`[fh, fw]` = 高さ、幅**という綴りにしている。独立した確認が2つ
ある:

- **REQ-0188のschema表**(`docs/REQ/built/REQ-0188-…:107`):
  `| enemy/1 | footprint: [fh, fw] = height, width |`、**「THE risk: the transpose」**
  (訳:THE risk〔まさにそのrisk〕:転置)と題されたsectionの下にあり、gate G4が4つの綴りすべてに
  わたって24個のNON-SQUARE(正方形でない)fixtureをpinし、転置された綴りがFAIL(失敗)することを
  要求している。
- **これをadjudicate(裁定)するコード**、`shared/content_validate.cjs:472-479`:
  ```js
  const fh = fp[0] …; const fw = fp[1] …;
  for (let dr = 0; dr < fh; dr++) for (let dc = 0; dc < fw; dc++) cells.push([anchor.row + dr, anchor.col + dc]);
  ```
  `fp[0]`はROWS(行)を展開する。曖昧さはない。

**したがって、どのrendererにおいても:`w = footprint[1] * cellPx`、`h = footprint[0] *
cellPx`である。** `w = fp[0]`と書くことが、静かで醜いバグである——2x2のbearについては見えない
が、3x4のgnollについては90°誤っており、それでも*monsterのように見えてしまう*ため、そのまま
出荷されてしまうのである。

**本REQが`fieldCells`(§8.2)を送るのは、まさにrendererがgeometryのために`footprint`に
一切触れないようにするためである。** cellのlistは転置しようがない。`footprint`は表示専用として
wire上に残り(Dexがこれをprintする)、rendererにとって唯一footprintから導出される値は、**与え
られたcellから**計算するbounding boxである。これはvigilance(注意深さ)による修正ではなく、
structural(構造的)な修正である——REQ-0188は転置を*「risk(危険)のすべて」*と呼んでおり、その
ようなriskを打ち破る方法は、注意深くあることではなく、その機会自体を削除することである。

> **隣接するfinding、本REQが修正すべきものではない:** `client/src/dex/MonsterCatalog.tsx:53-55`
> は`` `${fp[0]}×${fp[1]}` ``——すなわちheight×width——をprintしている。もしその列headerが
> "W×H"と書かれていれば、それはtransposeを表示していることになる。Dexを所有する誰かが一瞥する
> 価値がある;見失われないようここに記録しておく。

### 8.6 Gimic(REQ-0259 / REQ-0211)

spec (f):enemy平面は**monsterとgimicの両方**を保持する。ブリーフ§3 C4/Q4により、
`monster_pack.members[]`はgimic idも参照できるようwidenされ、両方とも`IBattleInstance`に
compileされ、`validateMonsterPackEntry`もそれに合わせてwidenされる。**両方ともREQ-0259が
所有する。**

このrendererにとって、これはほぼ無料である——平面上のgimicは、`fieldCells`、`mode`、artを
持つinstanceである。差分は3つある:

1. **Art kind——ブリーフがcloseされていると仄めかしているが、実際はcloseされていないgap。**
   `gimic`はREQ-0211を通じて(REQ-0255のmergeの中で)`art_sizing.cjs`の`KINDS`に加わり、
   ブリーフ§5は*"art kind gimic == monster"*(訳:art kindとしてのgimicはmonsterと同じ)と記録
   している。**しかし`computeArtUrls()`は`monstersFromCore().monsters`のみをjoinし**
   (`content.cjs:240`)、`monstersFromCore()`は`src.enemyDefsById`を読む(`:432-442`)。
   **Gimic idは`art_urls`にjoinされず**、そのため`textures.get('item:' + gimicId)`はmissし、
   すべてのgimicがglyphにfallする。修正は`computeArtUrls`の`names`concatの1行のwideningである
   ——gimicの配線を所有する**REQ-0259のためにflagしておく**。本REQはこれを黙って前提として
   はならない。
2. **Glyphのfallbackは存在し、批准済みである——それをreuseせよ。** REQ-0240 M4:
   *"`att_*` events carry no `gimicId` today, so gimic art binding is not wired; the feed/rail use
   the spec's class-glyph fallback (**ᚦ** trap / **ᚷ** chest / **ᛞ** door)."*(訳:今日時点では
   `att_*`のeventは`gimicId`を運ばないため、gimicのartのbindingは配線されていない;feed/railは
   仕様のclass-glyph fallback(**ᚦ** trap / **ᚷ** chest / **ᛞ** door)を使う。)4つ目の語彙を
   発明してはならない。
3. **Masked。** trapは`masked`である(`sim/lib/skills.cjs:323`の`entityDef {…, masked?}`)
   ため、`maskLabel`は`'?'`を返す。§8.2の`masked`フラグが、silhouette処理を駆動する。

## 9. Padding ring(spec f)

**別の色**で描画される——ringは、平面のうち*field*ではあるが*placeable(配置可能)*ではない
唯一の部分であり、rayが生まれる場所である(`combat_spec` §2.2のentry cell = row1/row18/colA/colZ、
これはまさにringである)。

```
ring cells = row 1, row 18, col A, col Z            (26x18 minus B2:Y17)
placeable  = PLACEABLE, imported from contentadmin/contentShared.ts:374 — NOT re-declared
```

処理:平面自身の`--panel (#131820)`という本体に対して、低いalphaの`--stone (#3D434C)`塗り
に`--gold-lo (#857038)`の内側edgeを添える——frostのplayer tintともemberのenemy tintとも異なる、
「外側」として判読可能なものにする。**glowしてはならない**:REQ-0260 §11.2——§6.0はglowを4つの
瞬間に配給しており、画面あたり同時発光を3箇所までにcapしている;常時点灯するframeは、その予算の
3分の1を、装飾のためだけに永遠に食いつぶしてしまう。

**`PLACEABLE`を導出するのではなくimportするのは意図的である。** REQ-0258 §9.1は、geometry
定数が既に、強制されたmodule境界の下、3箇所に存在していることを文書化しており
(`sim/lib/field.cjs`、`shared/content_validate.cjs`、`client/src/contentadmin/contentShared.ts`)、
それぞれがparity test(`sim/tests/run.cjs:1823/1830/1840`)でpinされており、`contentShared.ts`
をclient側のsourceとして、*"REQ-0261 will need … for rendering"*(訳:REQ-0261がrenderingの
ために……必要とすることになる)と名指ししている。**本REQは4つ目のコピーを作ってはならない。**

**強制は本rendererの仕事ではない。** ブリーフ§6、そのまま引用:*"drawn in a distinct
colour, and NO instance may occupy it — **enforced by the validator, not only by the renderer**"*
(訳:別の色で描画され、どのinstanceもそこを占有してはならない——**rendererだけでなく、validatorに
よって強制される**)。そのvalidatorが**REQ-0258**である:強化された`validateFormationBoxes`
(8x8**かつ**`PLACEABLE`の内側であることを、load時のassertとして)、および既存の
`validateMonsterPackEntry`のbounds check(`shared/content_validate.cjs:519-522`)。本REQは
**ringを描画する**、そして**与えられたものをそのまま描画する**——もし0258がまだ入っていなければ、
ring上に座っているinstanceも含めて。

これは意図的であり、この分業の要点である。illegalなinstanceをclipしたり隠したりする
rendererは、**validatorが捕まえるために存在しているバグを隠してしまう**ことになる。REQ-0258
§3.1は、このまさに同じバグ(`formation4.unit4 = J11:Q18`)が、ルールの半分しか見ていないgateの
背後で1年間生き延びていたことを示している;それを静かに片付けてしまうrendererは、もう半分の方も
隠してしまっていたことだろう。

**dev限定のassertionが、正しい中間点である:** mount時に、すべてのinstanceのcellを
`isPlaceable()`(`contentShared.ts:426`)に対してtestし、違反があれば`console.warn`する——dev
では見え、throwは決してせず、隠しもしない。`MonitorRenderer.ts:227-238`のdegenerate-box警告と
同じ姿勢であり、これは、もし誰かがconsoleを読んでいれば§3のバグを表面化させて*いたであろう*
patternである。(そうならなかったことは、この件についてではなく、警告一般についての教訓である;
警告はgateではなくfloor〔最低限の網〕である。)

## 10. Data gap — REQ-0240自身のlistの上に積み上げる

REQ-0240の「Data-gap status(03 §8)」は正直であり、本REQはそれを再導出するのではなく
extendする:

| REQ-0240のgap | そのstatus | REQ-0261が必要とするもの |
|---|---|---|
| **M1 roster** — DONE | slotごとの`bps[{id,hpMax}]` + enemyの`{id,name,nameJa,hpMax,footprint,packId}` | **不十分。** enemyの`at`/`fieldCells`/`instanceId`/`masked`がない(§8.2、§8.4);playerのBPの`shape`/`origin`/`pos`がない(§7.3)。 |
| **M2 pt + pacingVersion** — DONE | eventは`pt`を運ぶ;`durationSecs`はPRESENTATION時間である | ここでは無関係;clockはREQ-0260 §9が所有する。 |
| **M3 charge tick** — feature-flagでOFF | *"charge events are not slot-attributable without more plumbing"*(訳:charge eventは、追加の配線なしにはslotに帰属させられない) | 本REQのものではなく**REQ-0263のもの**。`chargeRing.ts`はcall-ready(呼び出し可能)であり、production上のすべてのcall siteは`null`を渡している。 |
| **M4 gimic art** — glyphでfallback | `att_*`は`gimicId`を運ばない | §8.6——加えて、gimic idがそもそも`art_urls`に一切joinされないという、別の、listされていない事実。 |

**REQ-0240がlistしていない2つのgapを、ここで見つけた:**

- **M5(新規)——player平面のcompositionには、サーバー側のsourceが存在しない。** §7.3。rosterは
  *どの*BPが戦ったかを知っており、それらがどう見えるかを知っているのはlocal storeだけであり、
  両方を知っている者はいない。
- **M6(新規)——enemy instanceのidentityには、wire上の表現が存在しない。** §8.4。rosterのdef id
  とevent logの`dst`instance labelは異なるnamespaceであり、これがREQ-0240自身のdeviation 3の、
  言明されていない根本原因である。

## 11. ブリーフへの訂正

| brief | 実際 | evidence |
|---|---|---|
| §6:*"reuse the Backpacks board composition at CELL=40. The board is `BoardRenderer.ts` + `geom.ts` …"*(訳:Backpacks boardのcompositionをCELL=40でreuseする。そのboardは`BoardRenderer.ts` + `geom.ts`である……) | `EngineInstance` + `GameState` + `BoardOps` + 8x8のlayoutなしには、`BoardRenderer`は**呼び出すことができない**;expeditionはこの4つのいずれも持たない。共有されたPUREなmoduleの上に構築される新しいread-only renderer。 | §4.1、§4.3 |
| §6:*"`board/sprites.ts` (**sprite_all_v11.svg** symbols -> Pixi textures)"*(訳:`board/sprites.ts`(**sprite_all_v11.svg**のsymbol -> Pixiのtexture)) | 実際は**v12**である。`sprites.ts:53`は`sprite_all_v12.svg`をimportしている;そのfile内のprose commentはすべて依然としてv11と書かれている。ブリーフはstaleなcommentを継承してしまった。 | §2 |
| §6:*"UNIT_CORE_RADIUS=26 halves to 13"*(訳:UNIT_CORE_RADIUS=26は13に半減する) | 描画箇所は定数ではなく**literalの26**を使っている(`BoardRenderer.ts:928`)。定数を半減させるとhit-testの方が動いてしまい、円は残ってしまう——`geom.ts:38-41`が予告している、まさにそのバグである。 | §5.2 |
| taskのframing:*"`geom.ts` CELL=80->40, PAD=38"* | `geom.ts`を編集すると**稼働中のBackpacks board**が半分になってしまう。そしてこの平面には**PADが存在しない**——ブリーフ自身のC5の算術がそれを証明している。 | §5.1、REQ-0260 §6 |
| taskのframing:*"`SOCKET_SEARCH_RADIUS`=26 (interactive-only — say so)"*(訳:`SOCKET_SEARCH_RADIUS`=26(interactive専用——そう明記せよ)) | interactive専用であることを**確認済み**であり、したがって半減するのではなく**一切portしない**。 | §5.1 |
| task/ブリーフ:*"is the 2x raster enough at CELL=40?"*(訳:CELL=40において2倍のrasterで十分か?) | **十分であり、3.2倍のover-sampleである。** 問いは反転する:riskはminification aliasingの方であり、Pixi v8.19の`autoGenerateMipmaps`はdefaultで**false**である。加えて:`RASTER_SCALE`はconsumerごとに変更**できない**——session全体で1つのcacheされたmapである。 | §6 |
| §6 + `MonitorRenderer.ts:12-13`:*"simple footprint blobs + name label … no real enemy art exists yet"*(訳:単純なfootprintの塊 + name label……本物のenemy artはまだ存在しない) | **両半分ともstale。** blobはrayのcellに固定された**1x1のrect**である——footprintと呼べるものは一切ない——そしてmonster artはREQ-0188/0208以来存在し、clientまで配線されている(Dexでliveに実証済み)。欠けているのはartではなく**位置**である。 | §8.2、§8.3 |
| §6(無言) | enemy平面には**wire上にstaticな位置が一切ない**;`buildRoster`は`m.at`を保持しているが、それを捨てている。最初のrayまで何も描画されない。サーバー側の変更が必要。 | §8.2 |
| §6(無言) | **`frost_gnoll`のfootprintは自身のartからdriftしている**([1,1] vs {w:3,h:4});REQ-0188はユーザーの裁定待ちで`derive --write`を未実行のまま残した。 | §8.3.1 |
| §6(無言) | **payloadのkeyが`unit1..unit4`であるのに対し、`Monitor.tsx`は`canvases['squad1']`をlookupしている。** 小さいmonitorは、どのbranchにおいても、本物のformation boxを一度も描画したことがない。 | §3 |
| §6(無言) | Gimic idは`art_urls`に**joinされない**(`computeArtUrls`は`enemyDefsById`のみを読む)ため、「art kind gimic == monster」はまだ、gimic artがclientに届くことを意味しない。 | §8.6 |
| §7の地図:`0261 depends on 0260, 0258` | **確認済み**——そして0258は2重にload-bearingである(このrendererが描画する`J10:Q17`のbox、そしてこのrendererが意図的に行わ**ない**ringの強制)。 | §7.1、§9 |
| REQ-0211の`[fh, fw]`という高さ優先の規約 | **2重に確認済み**——REQ-0188のschema表、AND `content_validate.cjs:472-479`。`fieldCells`を送ることで構造的に遵守される。 | §8.5 |

## 12. Scope

**含むもの:**
1. `client/src/expedition/ExpeditionRenderer.ts` — 新規。Read-onlyであり、`cellPx`は
   constructor param;2枚の平面;ring + gridのbackdrop;squad box;BPのfootprint + 輪郭 +
   label;配置されたPOのart;unit core + G6 icon + 方向dot;enemy instance(footprint
   silhouette / art / glyph);`setLayout`形の再配置(再配置 + `renderer.resize`、決して
   re-initしない)。
2. `client/src/expedition/expeditionGeom.ts` — §5.2の比率がREQ-0260の定数に加わる。
3. `client/src/expedition/ExpeditionStage.tsx` — REQ-0260のcanvas hostが、renderer、
   textureのload(`loadBoardTextures()`)、formation/rosterのjoin、dev限定のring assertion
   を得る。
4. **`client/src/schedule/Monitor.tsx` — §3のbug fix。** `:446`(master)/`:180`(0240)の
   `canvases[`unit${…}`]`;`:394`のplaceholderは`unit${idx+1}`になる;`:422`のcommentも
   修正される。**小さいmonitorへの唯一の編集。**
5. `client/src/board/BoardRenderer.ts` — §5.2のzero-riskな真実化:`:928`が`UNIT_CORE_RADIUS`
   を使うようになる;`:973`/`:1000-1006`のliteralは`geom.ts`内の名前付き定数になる。
   **Pixel-identical。**
6. `client/src/board/sprites.ts` — §6.3の`autoGenerateMipmaps`、**A/Bテストがより良いことを
   示した場合に限り**。
7. **Server(additive):** `server/services/pacing.cjs`の`buildRoster`が`instanceId`、`at`、
   `fieldCells`、`masked`をemitする;`shared/dto.ts`の`ApiRunRosterEnemy`がwidenする。既存
   のfieldは無変更であるため、小さいmonitorとすべてのREQ-0240のテストは影響を受けない。

**含まないもの:**
- **Ray / trail / bounce / hit FX** — REQ-0262(§7.2の`RawCell`契約も継承する)。
- **HP bar、cooldown overlay、charge ring、passive flash、monster skill icon** — REQ-0263、
  REQ-0264、REQ-0265。§5.1がringの半減させた引数を規定しており、0263がそれを渡す。
- **ringの強制。** REQ-0258。本REQはそれを描画し、警告するのみである。§9。
- **`frost_gnoll`のfootprint driftの修正。** REQ-0188の未解決のユーザー裁定。§8.3.1。
- **gimicのために`computeArtUrls`をwideningすること。** REQ-0259。§8.6。
- **compileされたsquad snapshotをwire上に載せること。** §7.3——それ自体で1つのサーバー側REQ。
- **`MonitorRenderer`のcellサイズをparameteriseすること。** §4.2——「今ある画面は放置して」。
- **spectator/multi-viewerに関するあらゆるsupport。** §7.3。

## 13. Gates

**E2Eポート(規則:`5000 + REQ*10 + index`):`7610` static / `7611` api / `7612` proxy。**
番号付け規則によって予約され、`tools/check_e2e_ports.cjs`(ciのstep `[0/8]`)によって機械的に
強制される。**Q2裁定(「e2eを通す必要はない」)により、E2Eは本プログラムのgateでは**ない**ため、
harnessは構築せず、この decade(10番台)は未使用のまま残す**——REQ-0258 §10が7580/7581/7582に
ついて、REQ-0260 §14が7600-7602について取っているのと同じ姿勢である。

適用されるunit/typecheckのgate:

1. **§3のregression guard。** dungeonsのpayload内のすべてのformationについて、clientがlookupする
   すべてのkeyが`/^[A-Z]\d{1,2}:[A-Z]\d{1,2}$/`に解決される。今日時点ではfailし、修正後はpass
   する。**これが、それが存在しなかったためにこのバグを生かし続けてしまったgateである。**
2. **`EXP_CELL`での`parseBoxToPixelRect`。** `"F2:M9"` -> `{x:200, y:40, w:320, h:320}`;
   4つのformationすべての16個のboxが`w === h === 320`を生み、`PLANE_W x PLANE_H`の内側に収まる。
3. **Transpose gate。** NON-SQUARE(正方形でない)fixture(footprint `[4,3]`)は4行x3列で
   renderされなければならない。REQ-0188のG4がそうしているように、failするはずの綴りを明示的に
   pinする——正方形のfixtureは何も証明しない。
4. **`EXP_CELL === CELL / 2`**(REQ-0260 §14.2と共有)、および§5.2の比率:`cellPx=40`では
   13 / 22 / 15 / 2を生む。
5. **§5.2の真実化の後、`BoardRenderer`はpixel-identicalである**——既存のboard testスイートは
   green、goldenは1つも動かない。
6. **geometryの4つ目のコピーはない。** `ExpeditionRenderer`が`fieldGeometry.ts`から
   `FIELD_COLS`/`FIELD_ROWS`を、`contentShared.ts`から`PLACEABLE`をimportしており、どちらも
   宣言していないことをassertする(REQ-0258 §9.1)。
7. **rendererはread-onlyである。** `client/src/expedition/`内で`eventMode = 'static'`がゼロ、
   `.on('pointerdown'`がゼロ、`registerBoard`がゼロであることをassertする——grepテストである。
   そうしなければ「read-only」は性質ではなく単なる約束にとどまってしまうためである。
8. **Server:** 既存のroster fieldは無変更(additiveなfieldを除いてdeep-equal);
   `server/tests/api/schedule.cjs`のroster assertion(`:480-485`)は引き続きgreen。
9. `pnpm exec tsc --noEmit` + lint。

## 14. 受け入れ基準

1. `EXP_CELL=40`において、player平面は、採用されたformationの本物のA1座標において、
   **4つ**の320x320のsquad boxを描画する——fallbackの輪郭ではなく`formations.json`に対して
   検証済み。
2. **`Monitor.tsx`はroomを開いてももはやconsole.warnしない**、そして`#/schedule`のplayer平面
   は、初めて本物のformation boxを描画する。§3のgateは修正前のコードではfailする。
3. 各squad boxは、**すべての**BPをそれぞれのoriginに、**すべての**配置済みPOをそれぞれのcellに
   renderする——REQ-0045 (d)の契約を、`MonitorRenderer`の色付きblobではなく、Backpacksの
   fidelity(unit core + G6でresolveされたicon + 方向dot)で。
4. Padding ringは、**両方の**平面において、別の、**glowしない**色で描画される;`PLACEABLE`は
   importされ、再宣言されない;ring上のinstanceは描画**され、かつ**警告も出る。
5. REQ-0258が入った状態では、formation4のbacklineは`J10:Q17`で描画され、どのformation box
   もringに触れない。
6. NON-SQUAREなmonsterは、`footprint[0]`行 x `footprint[1]`列でrenderされる。rendererは
   geometryのために`footprint`ではなく`fieldCells`を読む。
7. 採用済みのartを持つenemyは、そのartをfootprint boxにcontain-fitさせて(決して引き伸ばさず)
   描画する;採用済みのartを持たないenemyはsilhouette/glyphを描画する;**どちらの経路もthrow
   しない**、そしてfiles backend(`art_urls`が空)でも平面全体がエラーなくrenderされる。
8. `frost_gnoll`はその3:4のartを1つのcellの中にletterboxして描画し、**REQ-0188の裁定が下る
   まで、それは想定通りとして記録される。**
9. `BoardRenderer`の出力は、§5.2の前後でbyte-identicalである。
10. `client/src/expedition/`にはinteractionの配線が一切含まれない(gate 13.7)。
11. ユーザーが、§4における「そのまま」の解釈、§8.2の位置とspoilerに関するseam、そして§8.3.1の
    既知の不良である`frost_gnoll`のrenderについて、裁定を下している。
