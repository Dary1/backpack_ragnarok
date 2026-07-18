# REQ-0263 — expedition-instance-hud: すべての`IBattleInstance`上のHP、cooldown、charge、skill badge

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKED。作業を開始する前にユー
ザーの判断が必要な点が5つある:(0) **本REQは、REQ-0256とREQ-0257に続き、12個の全リプレイgolden
を3度目に動かす。** §6.4/§7.1は`ray_fire`に3つのfieldを追加し、§5.4は2つのeventを追加するため、
replayのJSONLが動き、したがってすべての`jsonl_sha256`が動く。初稿はこれを一切述べておらず、その
結果§11のgateは満たせないままになっていた(`tools/ci.sh:107`はstep [2/7]で
`sim/tests/goldens.cjs`を実行する)。**§10.1がその手順である** — REQ-0256 §13.1 / REQ-0257
§14.1が規定するのと同じ手順に、1つだけより厳しいcheckを加えたもの:本REQでは`events`の件数が
**一切動いてはならない**。これが最初に挙げられているのは、これがdeterminism-contract(決定性契
約)の変更であり、ユーザーがまさにその点について裁定(Q1)を下しているためである。(1) §5.2 —
ユーザーの「Unitの**背景**をClockwiseに増加させる」と、批准済みのgolden **G7**(「Unitのcharge
状態overlayは**ring fill(輪の塗り)**である」)は**同じcontrolではない**;§5.2はその食い違いを
明らかにし、G7の改訂を推奨するが、それはLLMが行ってよいことではない。(2) §4.4 — wire上の
enemy`hpMax`はdefの*上限値*であるため、すべてのenemyがt=0から可視であるformation map上では、
**すべてのenemyのHP barが100%未満から始まってしまい**、「既にダメージを受けている」ように読めて
しまう。(3) §6/§7 — cooldownとchargeのdata gapを埋めるには**sim eventへの新しいfield**が必要で
ある;§6.3は素朴なencodingがrun 1回あたり約300,000eventになることを示し、代替案を規定する。
(4) §8.3 — **skill iconはそもそも存在せず**、本REQが出荷するplaceholderは新しい視覚的
vocabularyである。
**予約日:** 2026-07-18
**スラッグ:** expedition-instance-hud
**ブランチ:** req-expedition-spec(仕様のみ)
**依頼者:** user、2026-07-18 — 仕様項目(j)、(k)、(l)。
**依存先:** **REQ-0261**(expedition-formation-render) — HARD(必須)、特にその**server側の変更**
(§8.2の`instanceId`/`at`/`fieldCells`/`masked`)に対して。これが、enemyのHP barをそもそも成立さ
せる唯一のjoinである(§4.3)。**REQ-0256**(battle-tick-core) — HARD(必須);そのinstance単位の
`cooldownSkills: Map<int,{skill, remainingTicks}>`が本REQのdata sourceである(§6)。**REQ-0257**
(ray-flight-entity) — **HARD(必須)、しかも必ず先に着地しなければならない。** 本REQは`ray_fire`
に3つのfieldを追加するが(§6.4の`slot`/`cooldownTicks`、§7.1の`cause`)、REQ-0257は
**`ray_fire`を丸ごと書き直す**(その§10.1/§10.1a:3つのemission site全てにおける`ray` id、廃止
される`ray_step`、不均一なschema)。**もし本REQが先に着地すると、0257の書き直しがこれら3つの
fieldを静かに消してしまう** — どのgateもそれを捕らえられない。加算的なevent上でwireのfieldが欠
落しても、red testとしてではなく、空白のHUDとして失敗するだけだからである。REQ-0257 §10.1bは本
REQの§4.4の引き継ぎ(`ray_hit_all.hits[]` / `ray_aoe.hits[]`上の`hp_after`)もACCEPT(受諾)して
おり、したがって§4.4は今や0257側が届けるべきものとなり、本REQは単にそれを消費するだけである。
**順序制約:0256 -> 0257 -> 0263。** **REQ-0260**(§9.3)が、本REQのあらゆるrampが評価の基準とす
るclockを所有する。
**ブロック対象:** REQ-0265(art-monster-skill-icons) — §8.3のplaceholderがその着地面となる。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §1, §4, §6。

## 1. ゴール

仕様項目(j)、(k)、(l) — 両平面上の、instance単位の表示:

- **(j)** 各`IBattleInstance`の下に**HP bar**を置く:player BPの場合は**Unit ICON**の下に;
  monster/gimicの場合は**CELL SHAPE**の下に。
- **(k)** **Item cooldown** = **item上の**半透明黒のoverlay。**Unit charge** = 「Unitの背景を
  Clockwiseに増加させるUI技法」。passiveな発動条件を持つitemは**発動時にflashする**
  (「パッシブ的な発動条件のアイテムもちゃんと発動したら、光る」)。
- **(l)** **Monster/gimic skill**:円 + skill icon、clockwiseな半透明黒のcharge、**描画された
  artの右上**に配置、skillごとに1つ、passiveも含む、そして**frame(枠)が発動時に光る**。

**本REQを貫く一本の筋、そしてこれが描画よりもむしろWIREについてのREQである理由:** これらはいず
れも、今や**0.01秒**でtickするsim上における*連続的な*量である(HPの割合、cooldownの残量、charge
量)。0.01秒間隔では、*どんな*tickごと・entityごとのstreamも、entity 1つあたり1秒間に100event
になってしまう。§6.3は、素朴なencodingがrun 1回あたり**約300,000event**になることを実測してい
る。**以下のgapはすべて、rampのPARAMETERS(パラメータ)を1度だけ送り、そのrampをclockに対して評
価することで埋められる** — これはREQ-0262 §5.2がray headに対して行っているのと同じ、同じ理由に
よるarchitecturalな判断である。

**Scope外:** ray、trail、impact — REQ-0262。静的な構図 — REQ-0261。tick loop — REQ-0256。実際
のart — REQ-0265。

## 2. Terminology(用語) — 確定させる。(j)がそれに依存するため

ブリーフ§1は、「プレイヤーのUnit(または内部名称BP)」を**BP:Unit law(BP:Unit法則)**
(REQ-0165)によって解決している:

> **A BP and a Unit are 1:1. Every BP carries exactly one Unit; a BP with no Unit cannot exist.**

(訳:BPとUnitは1:1である。すべてのBPはちょうど1つのUnitを持つ;Unitを持たないBPは存在し得ない。)

したがって:**`IBattleInstance`(player)== 1つのBP**であり、そのHPはBPの`hpMax`であり、
「Unitの下にHPバー」とは*Unit ICONの下*を意味し、それはそのBPの特定の1cellに位置する。
**SquadはIBattleInstanceではない**(HPを持たない — `backpack_battle_spec`:*"a squad itself has
no HP"*(訳:squad自体はHPを持たない));それは多くのBPを収める8x8のcanvasである。
**`IBattleInstance`(enemy)== 1つのmonsterまたは1つのgimic entity。**

### 2.1 CORRECTION(訂正) — Unitは`bp.unit.off`にあり、`bp.linker.off`には**ない**

taskのframingは*"the Unit sits at `bp.linker.off` — verify against `mock-src/engine.js`'s
`unitCell(bp)`"*(訳:Unitは`bp.linker.off`に位置する——`mock-src/engine.js`の`unitCell(bp)`に
照らして検証せよ)と述べている。**検証済みであり、これは誤りである。** `mock-src/engine.js:103`:

```js
const unitCell=bp=>[bp.origin[0]+bp.unit.off[0],bp.origin[1]+bp.unit.off[1]];
```

`bp.unit.off`である。`linker`モデルは**廃止済み**であり、tree内の4箇所がそれを裏付けている:

| 根拠 | source |
|---|---|
| accessorが`bp.unit`をdereferenceしている | `mock-src/engine.js:103` |
| mintが`linker`ではなく`unit`を刻印する | `server/services/gacha.cjs:208` —
`unit: { id: picked.unit, off: seat },` |
| 廃止は明示されている | `server/services/gacha.cjs:133` — *"The retired model rolled `linker:
{off, dirs}`"*(訳:廃止されたmodelは`linker: {off, dirs}`をrollしていた) |
| **testがそれが消えたことを固定している** | `server/tests/api/workshop.cjs:61` —
`assert.strictEqual(rolled.linker, undefined, 'the retired linker field is GONE -- not renamed,
not shadowed');` |
| simも`unit`を読む | `sim/lib/compile.cjs:150` — `const u = bpDef && bpDef.unit;` |

**`docs/llm_managed/terminology_unit_squad.md`はまさにこの点でstale(古く)なっており**、しかも
これはtaskが典拠として引用しているfileである。そのBP:Unit law段落はこう述べている:

> `mock-src/engine.js:92` `unitCell(bp)` dereferences `bp.linker` unconditionally.

(訳:`mock-src/engine.js:92`の`unitCell(bp)`は無条件に`bp.linker`をdereferenceする。)

**両方とも誤りである**:正しくは行**103**であり92ではなく、dereferenceしているのは**`bp.unit`**であっ
て`bp.linker`ではない。**LAW(法則)自体は今も成立している**——`gacha.cjs:208`はrollされたすべてのBPに
対して無条件に`unit:{id,off}`を刻印するため、Unitを持たないBPは依然として存在し得ない——古びたのはそ
の引用元の根拠だけであり、rename(改名)の影響を受けたのである。**本REQはそのdocを編集しない**(それは
本REQが修正すべきfileではない)が、その行参照に従う実装者は誰であれ、testが`undefined`であると断言し
ているfieldをdereferenceすることになる。

> **残しておく価値のあるnuance(機微)。** `unitCell`自体(`:103`)は無条件であり、Unitを持たないBPに対
> しては*throwするはずである*——しかしその呼び出し元はguardしている:`unitMap`(`:105`)と`:883`はどちら
> も`if(!bp.unit)continue;`を行う。したがってengineは、lawが存在し得ないとしている状態そのものに対し
> て防御を行っている。バーは**guardされた**読み取りから描くべきであり、engine自身の姿勢に合わせるこ
> と;rendererを生かし続けるためにlawに依存してはならない。

反証には**当たらない**legacyの残存:`mock-src/ui.js:319,397`(廃止されたmock UI)と`mock-src/tests/run.
cjs:187`(legacyのfixture)は今も`linker`と綴っている。これらは、`terminology_unit_squad.md`自身の"Del
iberate legacy survivals"(意図的なlegacyの残存)条項に従えば、historyである。

## 3. 検証済みの現状 — すべての行を読んだ、あるいは実測したものである

| 事実 | source | 根拠 |
|---|---|---|
| player BPの`hpMax`はwire上にあり、**exact(正確)**である | `shared/dto.ts:464-467`(0240) | `ApiRunRosterSlot { slot, index, bps: { id: string; hpMax: number }[] }` — REQ-0240 M1:*"Player hpMax exact (from `result.bps.squadSlot`)"*(訳:Player hpMaxは正確である〔`result.bps.squadSlot`由来〕) |
| enemyの`hpMax`はdefの**上限値**である | `dto.ts:471-479`(0240) | *"hpMax is the def's upper bound, so an hp_after/hpMax tick is honest and never exceeds 100%"*(訳:hpMaxはdefの上限値であるため、hp_after/hpMaxのtickは正直であり、100%を超えることは決してない) |
| `ray_hit`は`dst` + `hp_after`を運ぶ | 実測、golden-A | `{"ev":"ray_hit","dst":"beta","amount":11.36,"bounce_mult":1,"hp_after":78.64}` |
| **`ray_hit_all`は`hp_after`を運ばない** | 実測、golden-A | field集合は`seq,t,ev,bounce_mult,hits`;`hits[]` = `[{"dst":"frost_gnoll#0","amount":21.94},…]` — **`amount`のみ** |
| **`ray_aoe`は`hp_after`を運ばない** | 実測、golden-A | field集合は`seq,t,ev,center,radius,hits`;`{dst,amount}`と同じ形 |
| enemyの`dst`は**instance-suffix付き**である | 実測、golden-A | `"frost_gnoll#0"`、`"ice_archer#1"` |
| …一方rosterの`id`は**def**のidである | `pacing.cjs:220-239` | `enemies.push({ id: def.id, … })` — REQ-0261 §8.4:2つのnamespace |
| maskされたentityは`'?'`をemitする | `sim/lib/replay.cjs:21-23` | `function maskLabel(entity) { return entity.masked ? '?' : entity.id; }` |
| production上で唯一の`drawChargeRing`呼び出し箇所は`null`を渡している | `BoardRenderer.ts:986` | `drawChargeRing(ring, x, y, null);` — tree全体をgrepしてもproductionの呼び出しは**ちょうど1件**しか返らない |
| `chargeRing`のradius/widthは既にparameter化されている | `chargeRing.ts:118-126` | `radius: number = RING_RADIUS, width: number = RING_WIDTH` |
| `chargeRingArc`はpure(純粋)かつtotal(全域)である | `chargeRing.ts:76-88` | `null`/`0`/`NaN`/`Infinity`/負値 -> `null`;1超はclampされる;throwすることはない |
| **live unitの54体中42体が`charge`blockを持つ** | 実測、`content/live/dungeon`/`content/live/live_units.json` | 54件のentry;トップレベルの`charge`を持つものが42件 — 例:`alchemist {trigger:every_secs, spend:fire_on_full, capacity:[2,3]}` |
| productionはunit registryを**渡している** | `server/services/runs.cjs:83-91` | `combat.runDungeon({ …, unitDefsById, connShapes })` |
| …しかし**goldenは渡していない** | `sim/tests/goldens.cjs:63` | `baseOpts`には**`unitDefsById`がない** -> `UNIT_DEFS = {}`(`compile.cjs:94`) -> `bp.charge`もない |
| charge managerは、chargeを持つBPが1体でも存在する場合に限り構築される | `sim/lib/encounter.cjs:40,140` | `const chargeBps = troopBps.filter(b => b && b.charge);` / `const chargeMgr = chargeBps.length ? … : null` |
| charge instanceのidは、BPのidと**同一である** | `unit_charge_encounter.cjs:169` | `chargeBps.map(bp => ({ id: bp.id, unitId: bp.unitId, charge: bp.charge }))` |
| **charge counterを運ぶeventは存在しない** | `unit_charge.cjs:176,210,230` + `unit_charge_encounter.cjs:109-161` | すべてのemissionはDISCRETE(離散的)である(`_spend`/`_stack`/`_transform`/`_strike`/`_onhit`/`_lifesteal`/`_reflect`/`_transfer`/`_shieldbreak`);`counter`を運ぶものは1つもない |
| capacityは**instanceごとにrollされる** | `unit_charge.cjs:128` | `capacity: resolveRolledRange(spec.charge.capacity, rolls, spec.id + ':cap')` — defは`[2,3]`と言い、instanceは`2.5`と言う |
| live enemyが持つskill数の最大値 = **3** | 実測、`content/live/dungeon/enemies.json` | 44件のentry;分布は`{1:10, 2:33, 3:1}`;最大は`hrimgrimnir`(footprint `[3,3]`) |
| live gimicが持つskill数の最大値 = **1**、そして**2体のgimicは0**である | 実測、`gimics.json`(req-0211) | 4件のentry;分布は`{0:2, 1:2}` |
| **live skill全81件は`every_secs`である** | 実測、`content/live/dungeon/skills.json` | triggerの分布:`{"every_secs": 81}` — **passiveは0件** |
| live skillの**verb(動詞)**taxonomy(分類)は6種類で閉じている | 実測、同上 | `strike:30, apply_status:27, bonus_vs_status:9, lifesteal:7, multi_strike:6, heal_ally:2` |
| **`skill`というart kindは存在しない** | `server/services/art_sizing.cjs:24` | `const KINDS = ['po','si','unit','monster','bpskin','custom'];`(REQ-0255後は+`gimic`) |
| `cause`は、既にliveで使われているdiscriminator(判別子)の前例である | `MonitorRenderer.ts:718`;`encounter.cjs:119,136` | `ev.cause === 'pulse'` -> 金色のray;`unit_charge_transfer`/`_shieldbreak`上の`cause:'charge'` |
| …しかし実際のrunにおいては、`cause`を持つray eventは**1件もない** | 実測、golden-A | `cause`を運ぶeventは0件 |

## 4. (j) HP bar

### 4.1 Unit ICONの下 — player BP

Unitのfield cell(§2.1):

```
unitFieldCell(bp) = squadBoxTopLeft + bp.origin + bp.unit.off          // engine.js:103, guarded
unitCentre        = cellIdToXY(unitFieldCell, EXP_CELL) + EXP_CELL/2   // fieldGeometry.ts:76
```

```
EXP_HP_BAR_W      = EXP_CELL * 0.80     // 32px at EXP_CELL=40
EXP_HP_BAR_H      = 3
EXP_HP_BAR_GAP    = 2
barTop            = unitCentre.y + RING_RADIUS*0.5 + EXP_HP_BAR_GAP    // = +17 at EXP_CELL=40
```

**clearance(間隔)の項は`RING_RADIUS*0.5`(=15)であって`coreRadius`(=13)ではない — これは誤植ではな
い。** REQ-0261 §5.1は、expeditionがcharge ringの`radius`/`width`引数として`15 / 1.5`を渡すと定めて
いる(`RING_RADIUS=30` / `WIDTH=3`をCALL SITE(呼び出し箇所)で半分にするのであって、定数自体を編集する
のではない。なぜならREQ-0125aのgolden G7がBackpacksのboardに対して30/3を固定しているからである)。rin
gはr=15で、coreはr=13で描かれるため、**ringはUnitの周囲で最も外側にあるもの**であり、barは*それ*をcl
earしなければならない。13をclearするだけではbarがringを貫通してしまう — HPの読み取りとchargeの読み取
りが重なり合ってしまうということであり、これはこのsection全体が回避しようとしているまさにその衝突で
ある。+17であればbarの上端はUnit自身の40pxのcell内(半cell = 20)に収まり続けるため、barが隣のBPを侵す
ことは決してない。

**Live HPは今日時点で、新しいplumbing(配線)なしに解決する:** `ray_hit.dst`は**BPのid**であり(実測:`d
st:"beta"`)、`ray_hit.hp_after`がその値である。`dst` -> `ApiRunRosterSlot.bps[].id` -> `hpMax`とjoin
する(REQ-0240 M1によりexact(正確))。Bar fraction(barの割合) = `hp_after / hpMax`。

**2つ目のscaleを発明するのではなく、REQ-0240の色のthresholdを再利用すること。** `SquadDock.tsx:11-14
`:`frac >= 0.7 -> hp-full`、`>= 0.4 -> hp-mid`、それ以外は`hp-low`。dockとstageは、「low」が何を意味
するかについて食い違ってはならない;数値をコピーするのではなくpredicate(述語)を抽出すること。

### 4.2 CELL SHAPEの下 — monster/gimic

掛ける対象となるiconが存在しない:barはinstanceの**footprint bounding box(footprintの外接矩形)**の幅
いっぱいに、その下端の下に広がる。

```
box     = bounds(instance.fieldCells)          // REQ-0261 s8.2 -- cells, NEVER footprint
barW    = box.w                                 // spans the shape, so size reads as presence
barTop  = box.bottom + EXP_HP_BAR_GAP
```

**`fieldCells`を読むこと;`footprint`は決して読まないこと。** REQ-0261 §8.5がserver側でderive(導出)さ
れた`fieldCells`を送るのは、まさにどのrendererも`[fh, fw]`をtransposeできないようにするためである。c
ellのlistには、間違えようのある向きというものが存在しない。本REQはそのdisciplineを無変更のまま継承し
ており、§11のgateがそれを固定する。

> **新たなfinding — `shared/dto.ts`自身の中にあるtransposeの罠。** `dto.ts:201`は`ApiMonsterEntry`(*
> *enemy/1**方言)についてこう記述している:*"`footprint` is **[w,h]** in cells (the REQ-0188 drift gu
> ard keeps the def field in agreement with the linked artwork)"*(訳:`footprint`はcell単位で**[w,h]*
> *である〔REQ-0188のdrift guardが、defのfieldを紐づいたartworkと一致させ続けている〕)。**それはtran
> sposeされている。** 本当のconventionは`[fh, fw]`——heightが先——であり、これは`shared/content_valida
> te.cjs:472-479`(`fp[0]`がROWSをexpandする)とREQ-0188自身のschema表(`| enemy/1 | footprint: [fh, f
> w] = height, width |`)による。そのcommentはREQ-0188を引用していながら、それと矛盾してさえいる。**`
> dto.ts:229`は、同じfieldについて`ApiGimicEntry`のfootprintを記述しており、こちらは正しい**(*"`foot
> print` is [fh,fw] in cells"*(訳:`footprint`はcell単位で[fh,fw]である))——つまり1つのfileが1つのconv
> entionを2通りに記述しているのである。REQ-0261 §8.5は`MonsterCatalog.tsx:53-55`で類似のbugを発見し
> ている;これはその2件目の実例であり、**shared DTO**という、最悪の場所で起きている。**本REQが修正す
> べきものではない**(Dexのtypeには一切触れず、`footprint`も読まない)が、これはまさに、次に誰かがその
> typeからrendererを書くときにtransposeを生み出す化石そのものである。

### 4.3 REQ-0257は`dst` -> rosterの解決を修正するか? **NO(いいえ)。**

taskはこれを直接的に問うている。**はっきり述べる:REQ-0257はそれを修正しないし、修正できない。**

REQ-0240のDeviation 3、原文まま:

> **Enemy HP ticks on the stage deferred.** `ray_hit`'s masked `dst` label does not resolve to a ros
> ter enemy id/hpMax, so per-enemy HP bars are not drawn.

(訳:stage上でのenemy HPのtickは見送られた。`ray_hit`のmaskされた`dst`labelはrosterのenemy id/hpMaxに
解決されないため、enemyごとのHP barは描画されない。)

**REQ-0257 §10.1が追加するのは`ray`——`IBattleRay.id`である。** それが答えるのは*"which ray did this?
"*(訳:どのrayがこれを行ったか)であり、*"which enemy is this?"*(訳:これはどのenemyか)に答えることは決
してない。このgapが0257によっても無傷のまま生き残る、独立した3つの理由:

1. **`maskLabel`はREQ-0257のscopeに含まれていない。** その§15は編集するすべてのfileを列挙している
が、`sim/lib/replay.cjs`はその中にない。`dst`は今も`maskLabel(entity)`から得られ、maskされている場合
は今も`'?'`を返す。
2. **namespaceの分裂は変わっていない。** 実測:`dst = "frost_gnoll#0"`(instance-suffix付き) vs roster
の`id = "frost_gnoll"`(def id)。REQ-0257はeventに*ray*のidを追加するが、rosterに*instance*のidを追加
することはない。
3. **`#N`を取り除くことは修復にならない。** `ice_archer`を3体含むpackは、**すべて`id:'ice_archer'`を
持つ3件のroster entry**を生む(REQ-0261 §8.4)——唯一のdisambiguator(判別子)は`at`であり、`buildRoster`
はそれを保持した後に落としてしまう(`pacing.cjs:220-239`)。したがって`ice_archer#1`と`ice_archer#2`
は、client側のいかなるparseによっても区別できない。その情報はそもそもencodeされていない。

**何を変えなければならないか——そしてそれは既に、姉妹REQによって規定されている:** REQ-0261 §8.2による
rosterの拡張。

```ts
export interface ApiRunRosterEnemy {
  id: string;                      // the DEF id (unchanged)
  instanceId: string;              // NEW -- "frost_gnoll#0". THE JOIN. This is what closes Deviation 3.
  at: string;                      // NEW
  fieldCells: [number, number][];  // NEW -- s4.2's geometry
  masked: boolean;                 // NEW -- s4.5
  name: string; nameJa: string; hpMax: number; footprint: number[]; packId: string | null;
}
```

**したがってREQ-0263がhardに依存しているのはREQ-0261のSERVER側の変更であり、そのrendererではない。**
 もしREQ-0261がclient側の半分だけを出荷するなら、**enemyについて(j)は届けられなくなり**、本REQは止ま
らなければならない。REQ-0261 §8.4もその側から同じことを述べている(*"closing it here also closes REQ-
0263's deviation-3 blocker for free"*(訳:ここで解決すれば、REQ-0263のdeviation-3のblockerも無償で解
決される))。本REQはこの依存が実在することを確認し、それを最適化ではなくblockerとして名指しする。

### 4.4 誰も名指ししていないgap: **novaは`hp_after`を運ばない**

**実測されたものであり、これは本REQがこのprogramに提供するfindingである:**

| event | `hp_after`を運ぶか? | rayダメージに占める割合(golden-A) |
|---|---|---|
| `ray_hit` | **yes(運ぶ)** | 284.7 = 27.8% |
| `ray_hit_all`(nova) | **NO(運ばない)** — `hits[] = [{dst, amount}]`のみ | **740.2 = 72.2%** |
| `ray_aoe` | **NO(運ばない)** — 同じ形 | 0.0(このrunでは) |

**`hp_after`によって駆動されるHP barは、game内のダメージの72.2%に対して盲目である。** それはnova——ma
in gun(主砲)(REQ-0262 §11)——の間は静止したままになり、その後、次のdirect hitで飛ぶことになる。novaが
その働きをする*enemy*側では、barはほとんどの時間にわたって誤ったものになる。

REQ-0240(enemy barを丸ごと見送ったため、そもそもこれに突き当たらなかった)も、REQ-0257(`ray_hit_all`
に`ray`を追加するが、その`hits[]`に`hp_after`は追加しない)も、REQ-0261(barを一切描かない)も、これを
名指ししていない。これはbarを実際に描こうとして初めて表面化する。

**これを埋める2つの方法:**

- **(a) `amount`をclient側でaccumulate(累積)する。** **却下。** これはclientがdamageからHPをre-deriv
  eすることを要求する——つまり、block、shield、`reduceIncoming`(`skills.cjs:240`)、heal、lifesteal
  を、それらすべてを所有しているserverに対して、clientで、TypeScriptで、再実装するということである。
  それはre-simulate(再シミュレーション)であり、`combat_spec §1.2 [LOCKED OQ1]`がそれを名指しで禁じて
  いる(*"clients replay the log, never re-simulate"*(訳:clientはlogをreplayするのみであり、決してre-
  simulateしない))。またそれは静かにdriftしていくことにもなる。
- **(b) ADOPTED(採用) — `ray_hit_all.hits[]`と`ray_aoe.hits[]`に`hp_after`を追加する。** serverは既
  にそれを持っている:`dealHitFn`はdirect pathについて`hp_after`を計算しており(`ray_hit`はそれを運
  ぶ)、したがってnovaのvictimがそれぞれ被弾する瞬間にその値は存在している(`skills.cjs:212-220`がそれ
  らを列挙しdamageを適用する)。それは**同じfieldが、姉妹eventの上にある**というだけのことである。**
  コスト、実測:** golden-Aには17件のnovaがあり平均~2victim = **run 1回あたり約34個の追加の数値**。RE
  Q-0257 §10.2で既に受諾済みの**3.75倍のlog増加**(330 -> 約1238event)と比べれば、これは**ノイズ**で
  ある——eventを1つも追加せず、既存のarray memberにfieldを1つ追加するだけである。

**これはどのREQの仕事か? — 決着済み:REQ-0257のものである。ACCEPT(受諾)された。**

これは黙って前提とするのではなく、cross-REQ(REQをまたぐ)引き継ぎとして提起され、**REQ-0257 §10.1bは
今や書面でそれを受諾している**:`hp_after`は0257において`ray_hit_all.hits[]`と`ray_aoe.hits[]`に追加
される。0257はまさにこれらのemissionを書き直している最中であり、goldenの変動は3度目のrebaselineへ先
送りされるのではなく**0257 §14.1**のrebaselineに組み込まれる。0257のacceptance criterion(受け入れ基
準)17がそのgateである。

**それが本REQにとって具体的に意味すること:**

- **本REQは`sim/lib/skills.cjs`に一切触れない。** そのfieldは0257と共にやって来る。§10のscopeがそう
  述べている。
- **これはORDERING(順序)の依存関係となり、しかもhard(必須)なものになる。** REQ-0257が先に着地しなけ
  ればならない(**依存先**参照)。もし本REQが先に出荷されていたら、そのHP barは0257が着地するまでrayダ
  メージの72.2%に対して盲目のままになり——しかも*静かに*盲目になる。動かないbarはbugのようには見え
  ず、barそのものに見えてしまうからである。
- **本REQが回避したblast radius(被害範囲):** もし0257が断っていたら、本REQは`sim/lib/skills.cjs`**
  と、0256・0257に続く全12個のgoldenの3度目のrebaseline**を引き継ぐことになっていた。それが、この引
  き継ぎによって支払わずに済んだコストであり、だからこそ前提とするのではなく問うだけの価値があったの
  である。

**もし0257のacceptanceがいつか覆されるなら、本REQはSTOP(停止)し、ユーザーに差し戻される** — 静かにそ
のfieldを再び自ら引き取ってはならず、`combat_spec §1.2 [LOCKED OQ1]`が名指しで禁じている0263 §4.4のo
ption (a)にfall backしてもならない。

### 4.5 Enemyの`hpMax`はHINT(ヒント)である。そしてformation map上ではそれが可視になる — **USER RULING(ユーザー裁定)**

REQ-0240 M1は、enemyの`hpMax = hp[1]`——defの**上限**——を意図的に選んだ:*"so an `hp_after/hpMax` tick
 never exceeds 100% (a leak-safe HINT the client reveals on first-seen)"*(訳:`hp_after/hpMax`のtick
が100%を超えることは決してないようにするためであり〔これはclientがfirst-seen時に明かす、漏洩安全なHI
NTである〕)。

**その選択は、enemyがray-eventの最初のcellでlazyに描画されていた頃には安全だった。** REQ-0261 §8.2は
その前提を変える:expeditionはformation mapで**ある**ため、maskされていないすべてのenemyは`t=0`から画
面上に存在する。そして、実際にrollされたHPが`hp[0]`に近いenemyは、**1発も撃たれていないfull healthの
状態で**、`hp[0]/hp[1]`というbarを示すことになる——目に見えて部分的なbarである。**すべてのenemyが、既
にダメージを受けているかのように見えてしまう。**

これは新しい問題である:small monitorはenemy barを一切描いていなかったため(Deviation 3)、このhintのコ
ストはこれまで一度も支払われたことがなかった。選択肢:

- **(A) 推奨 — instanceの実際にrollされた`hpMax`を、`masked`で条件分岐して送る。** **maskされていな
  い**instanceについては、真実を送る:REQ-0261 §8.2は、formation map上ではそれらのposition、footprin
  t、identityがt=0から可視であると既に定めており、したがってその`hpMax`は**既に明かされているものよ
  り大きなspoilerにはならない**。**maskされた**instanceについては、何も送らない(discoveryまでbarを持
  たない、§4.6)。
- **(B) `hp[1]`のままにする。** server側の変更はゼロ;run全体を通じて、すべてのenemyが既にダメージを
  受けているように読めてしまう。barは厳密には嘘ではないが、読めるものでもない。
- **(C) first-seen時のHPに正規化する。** 却下:1HPのtrapと500HPのbossが同一のbarを描くことになり、こ
  れはbarの存在意義そのものを破壊する。
- **(D) 最初のhitまでenemy barを出さない。** 却下:Deviation 3をfeatureとして再現してしまい、ユーザー
  が見ている側で(j)を半分未実装のままにしてしまう。

**これはspoiler/designの判断であり、ユーザーに属するものである**。そしてこれはREQ-0261 §8.2自身が抱
える未解決のspoiler裁定と連動している——(A)が正当化できるのは、まさに0261がどう回答されるか*次第*だか
らであり、両者は一緒に回答されるべきである。

### 4.6 Maskされたinstance

`masked:true`のgimic(実測:`trap_frost_deadfall`と、4件のうちもう1件)は`dst:'?'`をemitする。**discove
ryまではbarを出さない。** そのinstanceを実際のidで名指しする最初のeventが来た時点で、barが現れる。こ
れはREQ-0261 §8.2のsilhouette(シルエット)の扱い(*"The arrangement is visible; the identity is not"*(
訳:配置は可視であるが、identityはそうではない))と一致しており、`MonitorRenderer.markDiscovered`(`:44
5-455`)が既にまさにこのreveal latch(開示ラッチ)を実装している——その意味論を再利用すること。2つ目を発
明してはならない。

## 5. (k) Unit charge — そしてユーザーの判断を生き延びられないかもしれないgolden

### 5.1 `chargeRing.ts`が約束していることをauditする — その約束は成立しているが、そのcommentは成立していない

`chargeRing.ts:28-30`は、具体的で検証可能な主張をしている:

> REQ-0129 (charge trigger taxonomy) supplies the real value; when it does, it changes **ONE argumen
> t
> at the call site** and this module needs **no edit**.

(訳:REQ-0129〔charge triggerのtaxonomy〕が実際の値を供給する;そうなったとき、変わるのはcall site〔呼
び出し箇所〕の**引数1つ**だけであり、このmoduleは**編集不要**である。)

**主張ごとに検証:**

| claim | verdict | evidence |
|---|---|---|
| *"every production call site passes NULL today"*(訳:今日時点で、production呼び出し箇所はすべてNULLを渡している) | **TRUE(真)**、しかも述べられているより強い:production呼び出し箇所は正確に**1件**しかない。 | tree全体をgrep:`BoardRenderer.ts:986` `drawChargeRing(ring, x, y, null);`。それ以外はすべて`check_unit_icon.mjs` / `build_ring_preview.mjs`(testとpreview)である。 |
| *"changes ONE argument … this module needs no edit"*(訳:変わるのは引数1つ……このmoduleは編集不要である) | **TRUE(真) — ringについては。** `radius`/`width`は既にparameter化されており(`:124-125`)、REQ-0261 §5.1の`15 / 1.5`は編集不要である。`chargeRingArc`はpureかつtotalである。 | `chargeRing.ts:118-126, 76-88` |
| *"THERE IS NO CHARGE DATA IN THIS CODEBASE … sim/ has no per-unit charge either. The only `cooldown` in the tree is sim/lib/dungeon.cjs's cooldownForH()"*(訳:このcodebaseにはcharge dataが一切存在しない……sim/にもunitごとのchargeは存在しない。tree内で唯一の`cooldown`はsim/lib/dungeon.cjsのcooldownForH()である) | **2026-07-12時点ではTRUE(真)。今日ではFALSE(偽)。** | REQ-0200(**merge済み**)が`sim/lib/unit_charge.cjs`(unit instanceごとのcounter/capacityランタイム)と`sim/lib/unit_charge_encounter.cjs`を追加した。そして**live unitの54体中42体が`charge`blockを持つ**(実測)。 |
| *"REQ-0129 supplies the real value"*(訳:REQ-0129が実際の値を供給する) | **FALSE(偽) — 誤って割り当てられている。** REQ-0129は**`docs/REQ/done/`**にある:それは出荷済みであり、それでも`:986`は今も`null`を渡している。それが届けたのは*vocabulary(語彙)*(`vocab.json` v13の`charge`block)——それこそが42体のunitが今chargeを持つ*理由*である——であり、ringを光らせるものであったことは一度もない。**data sourceはREQ-0200である。** ブリーフ§6がそう述べている。 | `docs/REQ/done/REQ-0129-…`;`BoardRenderer.ts:986` |

> **ついでに発見されたREQ-policy違反、報告のみで未修正。** `REQ-0129`自身のheaderには
> `**Status:** todo`と書かれているが、fileは`docs/REQ/done/`に置かれている。PROJECT.mdは明確である:
> *"a REQ's status IS its folder. Nothing else records REQ status."*(訳:REQのstatusとはそのfolder
> そのものである。それ以外の何ものもREQのstatusを記録しない。) file内のstatus行は存在すべきではな
> い。
> 本REQが編集すべきfileではない;boardを所有する者へのflagとして記録する。

**つまり:このmoduleは正真正銘call-readyであり、約束は成立している。そのmodule commentは実質的にfalse
である。** REQ-0263は`chargeRing.ts`のheader(および`BoardRenderer.ts:981-987`の、それを反映したcomme
nt)に**doc-onlyの**編集を行う——挙動の変更は一切ない——なぜなら、42体のunitがcharge blockを持ち、merge
済みのランタイムがそれらを計算しているにもかかわらず、次の読み手に*"there is no charge data in this 
codebase"*(訳:このcodebaseにはcharge dataが一切存在しない)と告げるcommentは、commentが無いことよりも
悪いからである。**Backpacksの呼び出し箇所は`null`のままである**が、`null`のままである理由は変わる:*"
no data exists"*(データが存在しない)からではなく、*"canvas units are dormant — out of combat, per RE
Q-0030"*(訳:canvas上のunitは休眠状態にある——REQ-0030により、戦闘外である)からであり、これは元のaudit
の条項のうち今も真実である唯一のものである。

### 5.2 「背景」 vs G7のRING — その隔たりは実在する。**USER RULING REQUIRED(ユーザー裁定が必須)。**

**G7**、`unit_icon_pipeline.md` §1(2026-07-12にratify済み、「ALL GREEN」)、原文まま:

> **G7 — Charge overlay language.** The Unit charge-state overlay is a **ring fill** (radial progres
> s
> around the icon), renderer-drawn per G2 and identical across all skins.

(訳:G7 — Charge overlayの言語。Unitのcharge状態overlayは**ring fill(輪の塗り)**〔iconを囲むradial
progress〕であり、G2に従いrendererが描画し、すべてのskinで同一である。)

**ユーザー**は、2026-07-18、spec (k)にて、原文まま:「Unitの**背景**をClockwiseに増加させるUI技法」
— *"a UI technique that increases the Unit's **background** clockwise."*

**それらは同じcontrolなのか? Noである。**

| | **G7 — ring fill(輪の塗り)** | **user — 背景wedge(扇形)** |
|---|---|---|
| geometry(幾何形状) | **stroked annulus(縁取りされた円環)**:`g.arc(x,y,30,…); g.stroke({width:3})`(`chargeRing.ts:132-140`) | 中心から掃引する**filled sector(塗りつぶされた扇形)** |
| 何が掃引するか | 円の円周に沿った**arc(弧)** | **area(面)** |
| どこに位置するか | core discの**外側**(r=30、coreはr=26) | iconの**背後** |
| artとの関係 | *"hugs the OUTSIDE of the unit core disc so it never occludes the character's face — G4 demands the silhouette stay readable at 64px"*(訳:unit core discの外側に沿うため、characterの顔を決して覆わない——G4は64pxでもsilhouetteが判読可能であることを要求している)(`chargeRing.ts:37-40`) | 背後に描かれる**限り**何も覆わない;上に描かれれば**すべてを**覆う |
| どう読めるか | progress **ring(輪)** | **pie/cooldown sweep(扇形の掃引)** |

**両者は和解させることが**できる**。そしてその和解案こそが推奨案である:** unit artの**背後に描かれる
**、clockwiseに掃引する**半透明のwedge(扇形)**(icon spriteより下のz-order)は、「背景」を文字通り満た
し、*かつ*G4を保つ——背後にある以上、顔を覆うことはできない。**しかしそれはring fillではないため、書
かれている通りのG7はそれには生き残れない。**

**決定的な論拠は、ユーザーの仕様は自己整合的であり、G7の方が例外だということである。** 同じ指示の中
を見渡すと:

- **(k)** item cooldown = **item上の**半透明の黒 — 半透明黒のoverlay;
- **(k)** Unit charge = **clockwise**に増加する背景;
- **(l)** monster skill = **clockwiseな半透明黒の**chargeを伴う円。

**この3つはすべて1つのidiom(慣用表現)である:「これが発動するまでの時間」を意味する、clockwiseな半透
明のsweepである。** G7のもとでは、Unitだけがstroked ring(縁取りされた輪)になってしまう——sweepだらけ
の画面の中で、*同じ量*を表しているにもかかわらず、唯一異なる読み方をする要素である。ユーザーは事実上
vocabulary(語彙)を統一しており、G7はその統一より前のものである。

**選択肢:**

- **(A) 推奨 — wedgeを採用し、G7を改訂する。** Unit / item / monster skillを通じて1つのidiomにする。
  **`chargeRingArc()`の数学はそのまま生き残る**(`{startAngle, endAngle, sweep, full}`はまさにwedgeの
  parameterそのものである——それは元々decoration〔装飾〕ではなくgeometry〔幾何〕だった);新しい`drawCh
  argeWedge()`がfillを供給する。`RING_START_ANGLE = -PI/2`とclockwiseのsweepは無変更のまま引き継がれ
  るため、12時方向からのclockwise——ユーザーが*同意している*G7の部分——は保たれる。
- **(B) G7を維持し、Unitはringのままにする。** codeリスクはゼロ(`chargeRing.ts`は今日時点でcall-read
  y、§5.1)。コスト:1つのconceptに対して2つのidiom、そしてUnitだけが例外になる。
- **(C) 両方** — 背後のwedge *と* 外側のringの両方。**却下**:1つの数値に対して2つのcontrol。

**なぜLLMがこれを決めてはならないのか。** `unit_icon_pipeline.md`は`docs/llm_managed/`の配下にあるた
め、そのfile自体は*技術的には*LLMが編集可能である——**しかしG7はユーザーによるratification(批准)を記
録しており**(*"Ratified via 2026-07-12 review, ALL GREEN"*(訳:2026-07-12のreviewを経てratify済み、AL
L GREEN))、G7はまさに**どのunit iconもoverlayと衝突するようなring状のframingを焼き込まない**ようにす
るために予約されたものである。したがってそれを改訂することはdocの編集ではなく、**既に出荷済みのartを
支配している**制約への変更である。もしwedgeが採用されれば、既存のすべてのunit iconを*新しい*overlay
形状に照らして再チェックしなければならない——artの背後にあるwedgeは、その外側にあるringとは異なる衝突
特性を持つ(G2/G4の再検証、`art_golden`)。**それはart-pipeline上の帰結であり、ユーザーの判断でなけれ
ばならない。**

### 5.3 chargeのDATA gap — REQ-0240 M3が実際に発見したこと、そして実際にそれを埋めるもの

REQ-0240 M3、原文まま:

> **M3 (charge ticks) — feature-flagged OFF cleanly.** No `unit_charge_*` -> dock/plate pip mapping
> was wired (**charge events are not slot-attributable without more plumbing**); dock charge pips ar
> e
> hidden when charge telemetry is absent (`charge:null`).

(訳:M3〔charge tick〕— feature-flagによってきれいにOFFにされている。`unit_charge_*` -> dock/plate
のpip mappingは一切配線されておらず〔charge eventはこれ以上のplumbingなしにはslotに帰属させられ
ない〕、dockのcharge pipはcharge telemetryが存在しない場合〔`charge:null`〕は非表示になる。)

**M3の診断は半分正しく、そして見逃している半分こそが、ringにとって重要な半分である。**

**「slotに帰属させられない」について:** 実測すると、eventは**確かに**BP idを運んでいる。`unit_charg
e.cjs:210`は`{ev:'unit_charge_spend', id: s.id, …}`をemitし、`unit_charge_encounter.cjs:169`は`charg
eBps.map(bp => ({ id: bp.id, … }))`としてinstanceを構築する——**`id`はBPのidそのものである**。BP -> s
quad slotはそこから判明可能である(`ApiRunRosterSlot.bps[].id`、そしてsimはREQ-0095に従い`b.squadSlot
`をtagする)。したがってslotへの帰属は今日時点で*導出可能*である;M3のblockerは、その文言が示唆するよ
りも緩やかなものである。**しかし本REQが必要としているのはBPへの帰属であり、slotへの帰属ではない——そ
してそれは既に得られている。**

**M3が名指ししていない本当のgap: どのeventもCOUNTERを運んでいない。** すべての`unit_charge_*`のemiss
ionは**discrete(離散的)**である——`_spend`(capacity到達時)、`_stack`、`_transform`、`_strike`、`_onhi
t`、`_lifesteal`、`_reflect`、`_transfer`、`_shieldbreak`。**`counter`を運ぶものは1つもない。** した
がって:

- `spend:'fire_on_full'`(42体のうち大多数)については、clientは**発動の瞬間だけ**を見る——100%でflash
  させることはできるが、*満ちていく*controlを描くことは一切できない;
- `spend:'passive_per_stack'`については、`unit_charge_stack {id, stacks}`が`stacks`を与えるが、それ
  はstacksが*変化した*ときだけである。

**counterを持たないringはringではない。これがgapであり、これはplumbing(配管)のgapではなくwireのgapで
ある。**

### 5.4 これを埋めるencoding — streamではなくparameter

**素朴な修正は致命的である。** instanceごと・tickごとの`unit_charge_tick {t, id, counter, capacity}`
は、`TICK_SECS=0.01`で23.6秒のrunにおいて、**chargeを持つBP 1体あたり2,360event**になる——32体のcharg
e BPを持つtroopでは**約75,500event**、REQ-0257 §10.2が既に3.75倍の問題として指摘している約1,238と比
べての数字である。**ringを1つ描くために約60倍に膨れ上がる。それはない。**

**ADOPTED(採用) — counterが時間の関数であるかどうかで分割する:**

```
NEW  unit_charge_arm  {t, seq, ev, id, capacity, trigger, period?}
       // emitted at encounter start and after every spend/rearm. ONE per spend.
       // `capacity` is MANDATORY: it is per-instance ROLLED (unit_charge.cjs:128 --
       // the def says [2,3], the instance says 2.5), so the client CANNOT derive it
       // from content. This is the field that makes the whole scheme possible.

NEW  unit_charge_gain {t, seq, ev, id, counter}
       // ONLY for non-every_secs triggers. ONLY when the counter changes.

     unit_charge_spend {…}   // EXISTS. client snaps to full, flashes, resets to 0, awaits re-arm.
```

- **`trigger === 'every_secs'`** -> counterは**純粋なramp(傾斜)**である:`counter(t) = (t - t_arm)/pe
  riod`。clientはこれをREQ-0260 §9.3のclockに対してinterpolateする。ちょうどREQ-0262 §5.2がray head
  をinterpolateするのと同じである。**追加のtrafficはゼロ。** これはまさに、放っておけば毎tick emitさ
  れて*しまう*であろうtriggerであり、それをwireから外しておくことこそが利益のすべてである。
- **event駆動のtrigger**(live unit上で実測:`on_damage_dealt`、`OnBPBeenHit`、`on_heal_done`、`on_con
  nected_unit_attack`、`on_connected_unit_spend`、`on_kill`、…) -> counterは`t`の関数**ではない**;戦
  闘eventに応じて飛ぶ。interpolateできないため、送信される——ただし変化したときのみ。**tickではなく戦
  闘eventによって上限が定まる:** golden-Aには36件のfire + 21件のhit + 17件のnovaがあり、したがってga
  inはrun 1回あたり数万ではなく**数百**のオーダーである。
- **ringは、存在しない場合はきれいに隠れる——既に、編集なしで。** `charge`blockを持たないBP(54体中12
  体)は`arm`を一切emitしないため、clientは`null`を保持し続け、`chargeRingArc(null)`は`null`を返し、*
  *何も描画されず、何のコストもかからない**(`chargeRing.ts:77`、そして`check_unit_icon.mjs:123`が既
  にまさにこのcaseをtestしている:*"null charge -> no ring (the production case today)"*(訳:chargeがn
  ullならringなし〔今日のproductionにおけるcaseである〕))。**検証済み:このmoduleは、chargeが存在しな
  い場合について編集を必要としない。** これは§5.1の約束のうち、一切の留保を必要としない唯一の部分で
  ある。

**なぜ*すべての*triggerについて一律に、変化のたびに`counter`を送らないのか?** `every_secs`について
は、counterは**構造上、毎tick変化する**からである(`unit_charge.cjs:297-305`がtimerに従ってrampさせ
る)——「変化のたびに」は、まさにその、氾濫を引き起こすtriggerにとってのtickごとのstreamそのものになっ
てしまう。arm/rampの分割はoptimisation(最適化)ではない;それは75,500eventと約0eventの違いである。

### 5.5 訂正 — **live unitの54体中42体は、確かにcharge blockを持つ**

taskはこう述べている:*"note NO live unit carries a `charge` block today (`unit_charge.cjs`'s guard: 
`troopBps.filter(b => b && b.charge)` — verify)"*(訳:今日時点でcharge blockを持つlive unitは1つもな
いことに注意せよ〔`unit_charge.cjs`のguard:`troopBps.filter(b => b && b.charge)`——検証せよ〕)。**検
証済み。それは誤りである**。そしてこの訂正が重要なのは、それが本REQのriskを反転させるからである。

**実測**(`content/live/live_units.json`、54件のentry):**42体がトップレベルの`charge`blockを持つ** — 
`alchemist {every_secs, fire_on_full, [2,3]}`、`darkknight {OnBPBeenHit, passive_per_stack, [12,18]}
`、`dragonknight {on_damage_dealt, fire_on_full, [80,120]}`、`hero`、`jester`、`bard`、`cleric`、…。

**その主張がどこから来ているのか、そしてなぜそれがstale(古びている)のか:** `sim/lib/compile.cjs:142-
144`、原文まま:

```js
// REQ-0200: attach the unit def's `charge` block (if any) so runEncounter can build
// a charge manager keyed on this BP. undefined for ALL current content (no live unit
// carries a charge block, and callers with no unit registry resolve UNIT_DEFS = {})
// -> no new property is set -> byte-identical goldens.
```

最初の節は**時代遅れである**(REQ-0129が`vocab.json` v13のcharge blockを出荷し、rosterはそれに対して
書かれた)。**2番目の節は今も真実であり、これこそが本当に重要な節である** — そしてそれを辿ると、真に
重要なfindingが得られる:

| caller(呼び出し元) | `unitDefsById`を渡すか? | -> `bp.charge`は? | -> charge managerは? |
|---|---|---|---|
| **production** `server/services/runs.cjs:83-91` | **YES(渡す)** | 42体について**YES(ある)** | **YES(構築される)** — `chargeBps.length`は非ゼロである(`encounter.cjs:40,140`) |
| **golden** `sim/tests/goldens.cjs:63`(`baseOpts`) | **NO(渡さない)** | no(ない) | no(構築されない) |

**つまりcharge engineはproduction上ではLIVE(稼働中)でありながら、12個のreplay goldenからはINVISIBLE(
不可視)である。** goldenは`UNIT_DEFS = {}`でcompileされ、`chargeMgr`を一切構築しないため、determinis
m契約はcharge runtimeを一切カバーしていない。それは本REQが修正すべきものではない——しかしそれが意味す
るのは、(a) §5.4のeventさえ存在すればringには**実データが既に待っている**ということ(riskはtaskが想定
していたより*低い*)、そして(b) **どのgoldenもcharge regression(退行)を捕らえない**ということである(
誰も想定していなかった、別種の、*より高い*risk)。`sim/tests/unit_charge_test.cjs`(13件pass)と`unit_c
harge_encounter_test.cjs`(23件pass)だけがsafety netである。**orchestratorへ報告済み;REQ-0256/0257のr
ebaseline会話に属する話であり、ここでの話ではない。**

同じ文への小さな訂正:guardは`unit_charge.cjs`内ではなく**`sim/lib/encounter.cjs:40`**にある。

## 6. (k) Item cooldown — overlayと、存在してはならないstream

### 6.1 Control

「アイテムのクールダウンは、アイテムの上に半透明の黒」 — item**の上の**半透明黒のoverlay。

```
EXP_CD_OVERLAY_FILL  = 0x000000
EXP_CD_OVERLAY_ALPHA = 0.55
```

12時方向からの**clockwiseなwedge(扇形)**として描かれ(`RING_START_ANGLE = -PI/2`、`chargeRing.ts:47`
からそのまま再利用)、円ではなくitemの**footprint cell**にclipされる——POはpolyomino(ポリオミノ)だから
である。cellは`computeFootprintCells(shape, rot)`(`itemCard.ts:71`)から得られる。これはREQ-0261 §4.3
がそもそもitemを描画するのに使っているのと同じhelperであり、したがってmaskがartからdriftすることはあ
り得ない。

**残っている**`frac`はcooldownの経過につれて1 -> 0へと縮んでいく:準備が整うにつれ、黒がitemを*覆いを
外して*いく。**sweepの向きとその意味論はユーザーのものである** — (l)における「増加」はchargeが*満ち
ていく*ことを描写している;cooldownについては、同じclockwiseのsweepが*目減りしていく*。どちらも「wedg
eが発動までの時間を追跡する」ということであり、これが§5.2の単一のidiomである。

### 6.2 データ — REQ-0256の`cooldownSkills`

ブリーフ§4 / REQ-0256:

```
IBattleInstance.cooldownSkills : Map<int, {skill: IBattleInstanceSkill, remainingTicks: int}>
  tick()  // decrement each remainingTicks by 1; on reaching 0 -> fire, then RESET
          //   ("数値を戻します") to a freshly rolled cooldown from the skill def
```

HUDが必要としているのは、**itemごと(PO)・tickごと**の`remainingTicks / cooldownTicks`である。

### 6.3 素朴なstreamは約300,000eventになる。実測であり、懸念ではない。

tickごと・itemごとのeventは、`TICK_SECS = 0.01`でgolden-Aの23.6秒(= **2,360 tick**)の間で:

| troopの規模 | item数 | event数 |
|---|---|---|
| 4 squad × 約8 BP × 約2-4 PO | 約64–128 | **151,000 – 302,000** |

今日時点で**330event**のrunであることと、REQ-0257 §10.2が既に3.75倍の問題として指摘している約**1,238
**という数字に照らして——それは*"belongs in front of the user BEFORE the work starts"*(訳:作業開始前
にユーザーの前に置かれるべきである)。**これは、四角形1つをanimateするために、log全体の100–240倍にな
ってしまうということである。** これはtuningの問題ではない;encodingそのものが単純に間違っているのであ
る。

### 6.4 ADOPTED(採用) — rampを導出する;何も送らない

**cooldownは、system全体の中で最も完璧に線形な量である。** REQ-0256自身の契約は、`remainingTicks`が
例外もeasingもなく**tickごとにちょうど1ずつ**減少すると述べている。したがって:

```
frac_remaining(t) = clamp01( 1 - (t - t_arm) / (cooldownTicks * TICK_SECS) )
```

clientが必要とするのは**fireごとに2つの数値**である:`t_arm`(これはfire event自身の`t`である)と`coold
ownTicks`。前者は既に持っている。

**したがって:`ray_fire`に2つのfieldを追加し、新しいeventは一切追加しない。**

```
ray_fire  {t, seq, ev, ray, src, field, entry, dir, pen, aoe,
           slot,           // NEW -- the cooldownSkills slot index (REQ-0256 s10.1 orders by it)
           cooldownTicks}  // NEW -- the freshly rolled cooldown this fire re-armed to
```

**コスト、実測:golden-Aでは36件のfire = 既に存在する36件のeventが、2つのfieldを得るだけ。新しいevent
はゼロ。** 302,000と比較せよ。**あらゆるitemの、あらゆるframeにおける**、どんなplayback速度でのoverl
ayも、そこからはclockの純粋な関数になる——ちょうどREQ-0262 §5.2のray headと同じであり、まったく同じ理
由で0.5/1/2/4×倍速とbackward scrub(逆方向scrub)のもとでも正しい。

**なぜ新しい`skill_arm`eventではなく`ray_fire`なのか:** fireは*すなわち*armである。REQ-0256の`tick()
`は同じstepでfireとre-armを行う(*"on reaching 0 -> fire, then RESET"*(訳:0に達したら発動し、その後RE
SETする))。したがってこの2つの瞬間は1つの瞬間であり、1つのeventがそれを運ぶべきである。並行する`skil
l_arm`は、fireのたびに`ray_fire`の`t`と`src`を重複させてしまい、それらを再接続するためのjoin keyを別
途必要としてしまう。

**4つの留保。これらはこの仕組みを壊しかねないものであるため、明記する:**

1. **rayを伴わないfireには`ray_fire`がない。** verbが`heal_ally`(実測:live skill 81件中2件)や`apply_
status`(81件中27件)であるskillは、rayなしに解決されることがある。それらのfireは、**実際にemitするど
のeventであれ**、同じ2つのfieldを必要とする。**本REQは、REQ-0256の実装を手にしない限りその集合を列挙
できない**——REQ-0256へのinterface要件としてflagする:*every fire, ray or not, emits `slot` + `cooldow
nTicks`*(訳:rayであるかどうかを問わず、すべてのfireは`slot` + `cooldownTicks`をemitする)。もしfireが
何のeventも一切emitしない場合、そのitemのoverlayは導出不能となり、REQ-0256が1つ追加しなければならな
い。
2. **Chill/Hasteはcooldownの途中でre-rollしてはならない。** ブリーフ§4:`cadenceMultiplier()`は*"to t
he ROLLED SECONDS before conversion"*(訳:変換前のROLLされた秒数に対して)適用される、すなわち**fire**
の時点で適用される——したがってmultiplierはarmの時点で既に`cooldownTicks`に焼き込まれており、rampは正
確に線形なままである。**もしREQ-0256がその代わりに、statusが付与された際に既にarmされたcooldownをre-
rollまたはscaleするなら、この導出は静かに壊れる**(barはsimから、目に見えない形でdriftしていくことに
なる)。**gateすること**(§11.4):armされた`remainingTicks`が、Chillの付与をまたいでも`(t_arm, cooldown
Ticks, t)`の純粋な関数であることをassertする。これは、後になって発見されるのではなく、**REQ-0256への
依存の前提として、あらかじめ記録しておく**ものである。
3. **`ray_fire`にはemission site(発行箇所)が3つあり、留保1の逆——cooldownを持たない`ray_fire`——は生じ
ない。その理由をここに述べる。答えは自明ではなく、逆が前提とされていたからである。** REQ-0257 §10.1a
はそのsiteを実測している:`skills.cjs:195`(本物のray)、そして`encounter.cjs:359` / `:378`——detection
とunlockのray、**合成されたもの**であり、`mode`を運び`dir`/`pen`/`aoe`を欠く。この2つにはslotもrolle
d cooldownも存在せず、したがって`slot`/`cooldownTicks`はnullable(null許容)でなければならない、と結論
づけるのは自然に思える。**しかしdispatchを読むと、その結論は崩れる**(`encounter.cjs:663-670`、原文の
構造そのまま):

   ```js
   } else if (s.modes.includes(encounterDef.mode)) { …fireSkillRay… }      // site 1
   } else if (hasAtt && s.modes.includes('detection')) { resolveDetection(s, ev.t); }  // site 2
   } else if (hasAtt && s.modes.includes('unlock'))    { resolveUnlock(s, ev.t); }     // site 3
   // reschedule regardless of match
   scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, ev.t, …);                 // :670
   ```

   **3つのsiteはすべて同じschedulableな`s`によって駆動されており、`:670`は3つすべてに対して同一の方
法でre-armする。** REQ-0256 §8.5のもとでは、その`scheduleEffect`は**同じ`cooldownSkills`slot上の`rol
lCooldownTicks`になる**。したがってdetection/unlockのrayは、戦闘rayが持つのとまったく同じslotと、新
しくrollされたcooldownを持つ。**裁定:`slot`と`cooldownTicks`は3つのsiteすべてにおいてNON-NULL(null不
可)であり、特別扱いはされない。** REQ-0256/0257が果たすべきなのは**そのslotを`resolveDetection`/`res
olveUnlock`に通すこと**である。これらは今日`s`を受け取ってはいるものの、自身のslot indexを知らない——
留保1のものと並んで、これらへのinterface要件としてここに記録する。

   **HUDへの帰結は現実のものであり、机上のものではない:** player BP上のunlock skillは、そのitemに*確
かに*cooldown overlayを得ることになるし、そうあるべきである——itemは正真正銘re-armされるからである。
もし`null`が規定されていたら、playerがchestを開けた瞬間、そのoverlayは静かに消え去っていただろう。

   **それでもclientがguardしなければならないこと(REQ-0257 §10.1a):** site 2/3では`dir`/`pen`/`aoe`は
**存在しない**のであって0なのではなく、site 1では`mode`が存在しない。golden-Aは**attachmentを持たな
い**`batch002`のrunであるため、**site 1のみ**を経由し、これを示すことができない。**golden-Aの`ray_fi
re`の形に合わせてHUDを書いてはならない。** `slot`/`cooldownTicks`/`cause`を読み、それ以外はすべてgua
rdすること。
4. **`cooldownTicks`はfireの後にrollされるため、そのfieldはBACK-PATCH(後から書き戻す)されなければな
らない——emit時にstampすることはできず、そしてそのrollの順序が動いてはならない。** REQ-0256 §8.5は、f
ireがrollに先行することを明示しており(*"on reaching 0 -> fire, then RESET"*)、*"the stream name, the
 draw order, and the multiply are IDENTICAL"*(訳:streamの名前、draw順序、multiplyは今日の`scheduleEf
fect`と同一である)とも明示している。**数値を手元に置くために早めにrollすることは、RNGのdrawの順序を
入れ替えてしまい、本REQとは何の関係もない理由ですべてのgoldenを動かしてしまうことになる。** したがっ
て:fireの最中に`ray_fire`をemitし、`rollCooldownTicks`が値を返した時点で、既にemitされたeventに対し
て`cooldownTicks`をserialize前に書き込む。これは**3つすべての**siteに適用される。これは実装上の制約
であるが、それは*determinism(決定性)*の制約が実装の衣をまとったものであり、だからこそ好みに任せるの
ではなくここで規定するのである。

## 7. (k)/(l) passiveのflash — そしてそれをcooldown fireと区別すること

「パッシブ的な発動条件のアイテムもちゃんと発動したら、光る」 — passive-triggerのitemは、それが本当に
発動したときに**光る**。

### 7.1 Discriminator(判別子)

| | **cadence fire(周期的な発動)** | **passive fire(受動的な発動)** |
|---|---|---|
| trigger | `trigger.t === 'every_secs'` — countdownが0に達する | **条件**(OnHit、OnBPBeenHit、on_kill、hpbelow、…) |
| rampを持つか? | **yes(持つ)** — §6.4のoverlay | **no(持たない)** — countdownすべきものが何もない |
| 発動時にflashするか? | yes | **yes** — これがユーザーの論点である |

**ルール:overlay ⟺ cadence。Flash ⟺ 発動全般。** flashは普遍的である(「発動したら」——それが発動する*
たびに*);overlayはcountdownを持つものにだけ属する。passiveにcooldownのwedgeを描くことは、存在しないt
imerを発明することになる。

**wire上では——`cause`を使う。これは発明ではなく、ここでは既に確立された前例である:**

```
ray_fire  {…, cause}   // NEW field, existing vocabulary
   'cadence'  -> an every_secs cooldown fire   (gets the s6.4 overlay + a flash)
   'reactive' -> a passive/condition fire      (flash only)
   'charge'   -> a charge spend                (flash only; already emitted, encounter.cjs:119,136)
   'pulse'    -> a linker pulse                (already emitted; MonitorRenderer.ts:718 reads it)
```

**前例、検証済み:** `cause`はこのwire上に既に存在しており、既にvisualなbranchを駆動している——`Monito
rRenderer.ts:718`は`ev.cause === 'pulse'`のときpayload rayを金色に着色し、`encounter.cjs:119/136`は`
cause:'charge'`をstampする。**実測された留保:golden-Aのeventのうち`cause`を持つものは0件である**、な
ぜならそのrunはpulse経路もcharge経路も一切通らないからである。したがって`cause`は実在するが**疎(まば
ら)**であり、本REQはそれを**fire event上でtotal(全域的)**なものにする——`'cadence'`は不在ではなく明示
的なdefaultになる。

**なぜtriggerをclient側でdefから読まないのか?** clientは*確かに*defを持っているため、`skill.trigger.
t`をlookupすることはできる。**却下:** これはclientがどのskillが発動したかを知っていることを要求する
が、実測すると、**`ray_fire`は`skill`を運んでいない**(REQ-0262 §9.1)——まさにREQ-0264が追加しなければ
ならないfieldである。出荷されていないfieldに依存するdiscriminatorは、discriminatorではない。`cause`
はfield1つであり、joinを必要とせず、そして既にそのpatternである。

### 7.2 flashそのもの — そしてなぜそれはglowしないのか

```
EXP_FIRE_FLASH_MS = 150      // s6.0's 120-180ms transition band
```

itemの**frame(枠)が明るくなる**、150ms、ease-out。**Non-glowing(glowしない)** — borderまたはfillが明
るくなるだけで、`shadowBlur`はない。

**正当化。そしてこれは慎重を期しているのではなく、実在の制約である:** `styleguide.html` §6.1はglowを
4つの瞬間に配給している — ①focus ②legendary+のmanifestation ③liveなlink beam ④**命中の瞬間**。**skil
lのFIRING(発動)はHIT(命中)ではない。** それはその4つのいずれでもない。したがってglowするfire-flashは
許可されておらず、REQ-0262 §8が示す、rayによって*既に*6.3倍も超過しているその≤3のbudgetを奪い合うこ
とになる。player planeでは最大約128個のitemがrun全体を通じて発動し得るため、fire-flashだけでhitを圧
倒してしまうだろう。

**「光る」は文字通りには"shines/glows"(光る・輝く)を意味し、それをglowしないbrightenとして描画するこ
とはinterpretation(解釈)である。** 1つの解釈として記録する(§12)。その読み方はこうである:ユーザーの意
図は「それが発動したことを見て取れなければならない」ということであり——「ちゃんと発動したら」は輝度で
はなく*確認*を強調している——150msのframe brightenはbudgetをゼロに保ったままそれを実現する。もしユー
ザーが文字通りのglowを望むなら、それはREQ-0262 §8のbudget裁定の内側に入ることになり、その裁定はそれ
を織り込まなければならなくなる。

## 8. (l) Monster / gimicのskill badge

### 8.1 Control

instanceごとに、**skillごとに**1つのbadge、passiveを含む:

- **円** + skill **icon**、
- **clockwiseな半透明黒**のcharge wedge(§6.1のidiomと定数 — 単一のvocabulary)、
- **描画されたartの右上**に配置、
- **frameが発動時に光る**(§7.2のnon-glowingな150msのbrighten)。

### 8.2 N個のskillに対するlayoutのrule — MEASURED(実測)。そしてtaskの前提は間違っている

**taskは、enemyが「1-2」個のskillを持つと述べている。全live contentにわたって実測:**

| source | entry数 | skill数の分布 | **MAX(最大)** |
|---|---|---|---|
| **`content/live/dungeon/enemies.json`** | 44 | `{1:10, 2:33, 3:1}` | **3**(`hrimgrimnir`、footprint `[3,3]`) |
| `content/live/dungeon/gimics.json`(req-0211) | 4 | `{0:2, 1:2}` | **1** |
| batch-002 | 7 | `{1:3, 2:3, 3:1}` | 3 |
| batch-005 | 8 | `{2:8}` | 2 |
| batch-006 | 12 | `{1:4, 2:8}` | 2 |
| batch-007 | 17 | `{1:3, 2:14}` | 2 |

**したがってN ∈ [0, 3]であり、[1, 2]ではない。** ここから2つの訂正が導かれ、2つ目こそがtaskが完全に
見落としているものである:

- **Nは3になり得る**(`hrimgrimnir`、live boss)。2を前提とするlayoutは、bossの3つ目のskillを切り取っ
  てしまう。
- **Nは0になり得る。** 4体のlive gimicのうち2体(`door_rimefast_stage2`、`chest_frostbound_cache`)は*
  *skillを一切持たない**。**N=0はbadge clusterを一切描かない** — 空の円でもplaceholderでもない。trea
  sure chestの上に空のbadgeを置けば、存在しないmechanicを主張してしまうことになる。

**制約となるのはNそのものではなく、FOOTPRINTに対するNである。** 実測されたcross-tab(クロス集計):

```
fp1x1  skills=2 -> 2 enemies   (rime_shaman, niflheim_stalker)   <-- WORST CASE
fp1x1  skills=1 -> 3
fp3x3  skills=3 -> 1           (hrimgrimnir)
fp4x3  skills=2 -> 11          (the modal case)
fp10x10 skills=2 -> 2          (bone_dragon, kraken)
```

**Rule:**

```
EXP_BADGE_D    = clamp(cellPx * 0.45, 12, 20)     // 18px at EXP_CELL=40
EXP_BADGE_GAP  = 2
anchor         = top-right corner of bounds(instance.fieldCells)
direction      = stack DOWNWARD along the box's right edge
```

**なぜleftward(左方向)ではなくdownward(下方向)なのか:**

- **HP barと決して衝突しない。** §4.2はHP barをshapeの**下端**の下に置く。leftwardのstackingはartの
  顔の上を進んでいってしまう——silhouetteはG4が保護しようとしているものである;downwardはその輪郭の外
  側に沿って進む。
- **右端はREQ-0261 §8.2の`fieldCells`のbounding boxのもとで安定したanchorである**。またenemyのshape
  は横より縦が長いこともその逆と同じくらいよくある(`[3,4]`と`[4,3]`のどちらも出現する)ため、widthに
  基づくruleは一般化できない。

**そしてこれは実際のcontentに——正確に、2pxの余裕を持って——収まる:**

| case | badge数 | 必要な高さ | 利用可能な高さ | 収まるか? |
|---|---|---|---|---|
| `rime_shaman` `[1,1]`、2skill | 2 | `2*20 - 2 = 38px` | `1 * 40 = 40px` | **yes、2pxの余裕で** |
| `hrimgrimnir` `[3,3]`、3skill | 3 | `3*20 - 2 = 58px` | `3 * 40 = 120px` | yes |
| `bone_dragon` `[10,10]`、2 | 2 | 38px | 400px | 自明にyes |

**2pxの余裕で収まる、ということは運によって収まっているということである——だからpinする。** §11.5のga
teは、すべてのlive enemyとgimicについて、`N * (EXP_BADGE_D + EXP_BADGE_GAP) - EXP_BADGE_GAP <= footp
rint[0] * EXP_CELL`をassertする。**このgateは、誰かが3skillを持つ1×1のenemyをauthorした瞬間に発火す
る** — そうでなければ静かに切り取られたbadgeとして出荷されてしまう、まさにそのcontent driftである。
これはREQ-0258の教訓をlayoutに適用したものである:*ruleの半分しか見ていないgateは、そのruleを何も見て
いないのと同じである*。

**Runtime overflow policy(実行時のoverflow方針)**(gateの後にdeployされるcontentのため):収まりきらな
いbadgeは**単一の`+N`badgeへcollapseする**。決して重なり合わず、決してshapeの外へ溢れ出さない。

**planeの端でのclippingはriskではない。padding ringがその理由である。** 配置可能な最も右のcolumn(Y、
`PLACEABLE = {colMax:25}`による)にいるenemyは、そのbadgeがcolumn Zの上に来ることになる——これは**padd
ing ring**(spec f)であり、fieldではあるが占有不可能である。余地は常にある。これは、これから起きるbug
のように見えて実はREQ-0258のgeometryによって既に解決されている、という類のことなので明記する価値があ
る。

### 8.3 Skill iconはそもそも存在しない — 今回出荷するplaceholder

**検証済み:** `server/services/art_sizing.cjs:24` — `const KINDS = ['po','si','unit','monster','bpsk
in','custom'];`(REQ-0255によるREQ-0211のmerge後は+`gimic`)。**`skill`というkindは存在しない。** live
 skill 81件、artはゼロ。

**候補、判定:**

| candidate(候補) | verdict(判定) |
|---|---|
| **styleguideの§5のrune vocabulary(ルーン語彙)**(`ᚨ`表題 `ᛗ`編成 `ᚱ`遠征 `ᚷ`倉庫 `ᚲ`図鑑 `ᛈ`工房 `ᚠ`市場 `ᛏ`殿堂 — `styleguide.html:249-256`) | **却下。** これらは意味を割り当てられた**navigation(ナビゲーション)**symbolである。`ᚷ`は既にnav内で倉庫を意味し、**かつ**REQ-0240 M4では"chest"(宝箱)を意味する。それらをskillに転用すればglyph(字形)の三重予約になる。 |
| **REQ-0240 M4のclass glyph**(`ᚦ` trap / `ᚷ` chest / `ᛞ` door) | **そのままでは却下** — **3symbolのgimic-family**語彙では**81**個のskillに名前を付けられない。しかしその*原則*(ratify済みのclass->glyph fallback、正直であり、決して空白にしない)はまさに正しい。 |
| skill idの頭文字 | **却下。** `hrim_cleave`/`hrim_blizzard_volley`/`hrim_deep_freeze`はすべて"h"になってしまう。 |
| **VERB-CLASS(動詞クラス)glyph — ADOPTED(採用)** | verbの軸は**閉じていて小さい**:実測すると、live skill全81件は**6個のverb**を使う。これはREQ-0240 M4のpatternを、実際に値が少ない軸に適用したものである。 |

**ADOPTED(採用):badge上、wedgeの上に、verb-classのruneを置く。**

```
strike           (30/81)  -> ᛊ     apply_status  (27/81) -> ᛁ
bonus_vs_status   (9/81)  -> ᛉ     lifesteal      (7/81) -> ᚢ
multi_strike      (6/81)  -> ᚺ     heal_ally      (2/81) -> ᛒ
```

styleguideに既存のrune face(`styleguide.html:36`)である`--f-rune`で描画される。**nav setとREQ-0240 M
4のclass glyphの両方に対してcollision-check済み — この6つのうちどれも、どちらにも使われていない。**

**なぜverbなのか、そのコストも正直に述べる:** verbは**既にdef上にある**(`skillDefsById[s.id] = {trig
ger, verb, attack_profile, modes}`)ため、placeholderは**新しいwire fieldも新しいartも必要としない**—
—badgeが出荷されるその日に、これも出荷される。それは*そのskillが何をするか*を語り、それは真実であり
有用である。**そのコスト:30個のskillが`ᛊ`を共有する。** 「これはattackである」と告げるだけのplacehol
derはlow-resolution(解像度が低い)である——そしてこれこそが、REQ-0265がglyphをartに**skill idごとに**
置き換えることで埋めるgapそのものであり、map1つ、layoutの変更なしで済む。glyphがなくてもbadgeは空白
ではないことに注意:それは今もlive countdownのwedgeを運んでおり、既に「あと何秒かで何かが発動する」こ
とを伝えている;glyphが伝えるのは*どんな種類か*である。

**これは新しい視覚的vocabularyであり、ユーザーへflagする**(§12) — 6つのruneがproductのsymbol集合に加
わることはdesign上の判断であり、実装の細部ではない。

### 8.4 「passiveを含む」は、存在しないcontentを描写している

spec (l)は、badgeがpassiveを含むと述べている。**実測:live monster skillのうちpassiveであるものは1つ
もない。** `content/live/dungeon/skills.json` — 全**81**件のentryが`trigger.t === 'every_secs'`を持
つ。triggerの分布は文字通り`{"every_secs": 81}`である。

したがって**monster/gimic**側では、すべてのbadgeが本物のcountdown ramp(§6.4)を持つ**cadence**badgeで
あり、**(l)のpassive branchはlive contentによって行使されないまま出荷される。** それは規定され実装さ
れている(§7.1の`cause`discriminatorは両平面を通じて一様である)ため、そのようなcontentがauthorされた
その日に、rampを持たないflashするbadgeを描くことになる。

**Passiveは実在する——しかしPLAYER側においてである**、だからこそ(k)がそれらを必要とする:item effectは
reactive(反応的)なtrigger(REQ-0078のOnHit taxonomy)を持ち、§5.5で実測されたunit-chargeのtriggerはほ
とんどがevent駆動である(`on_damage_dealt`、`OnBPBeenHit`、`on_heal_done`、`on_connected_unit_attack
`、`on_connected_unit_spend`)。**したがって(k)のpassive flashには今日時点でcontentがあり、(l)には無
い。** 「monsterのpassive badgeは決して現れない」ということが、bugとしてではなく*正しい*こととして読
まれるよう、ここに記録する。

### 8.5 Gimicのartはclientに届かない — REQ-0261 §8.6からの継承

REQ-0261 §8.6は、`computeArtUrls()`が`monstersFromCore().monsters`のみをjoinしており(`content.cjs:24
0`)、その結果**gimicのidは`art_urls`に一切joinされず**、`textures.get('item:' + gimicId)`が外れるこ
とを発見した。**REQ-0259がその1行の修正を所有する。** 本REQにとっての帰結は限定的であり、明記する価
値がある:gimicの**badge**は影響を受けない(badgeはruneであり、artではない)が、それが掛かるinstance自
体はREQ-0240 M4のclass glyphに落ちる。4体のlive gimicのうち2体が**ゼロ**個のskillを持つため(§8.2)、
今日時点での実際の影響範囲は**それぞれ1つのbadgeを持つ2体のgimic**である。

## 9. Reduced motion — 本REQはほとんどが適用除外であり、それは抜け道ではない

REQ-0262 §10がhardな`prefers-reduced-motion`裁定を担っている(styleguide §6.6はtier②において**戦闘再
生**を名指ししている)。**本REQのcontrolはほぼすべてEFFECT(演出)ではなくSTATE(状態)であり、§6.6はstat
eには一度も適用されたことがない:**

| control | reduced motionのもとでは |
|---|---|
| HP bar(§4) | **無変更。** barの長さは事実である。 |
| cooldown overlay(§6) | **値は無変更、更新はdiscrete(離散的)。** wedgeはrAF frameごとではなくREQ-0262 §10.2の250msのcursorに対して評価される——sweepするのではなくstepする。それは決して*animateされる*のではなく、*再計算される*のである。 |
| charge ring/wedge(§5) | cooldown overlayと同じ。 |
| skill badge(§8) | **無変更。** |
| fire flash(§7.2)、badgeのframe light | **CONSTRUCT(構築)されない。** これらは本REQにおける唯一の真の*effect*である——150msのease-out transitionは、まさに§6.6のtier①がshort-circuitし、tier②が生成を禁じているものそのものである。**発動したitemは、代わりに1つの250msのcursor stepの間、静的な「発動済み」frameを保持し**、その後それを外す。ユーザーが求めた確認は保たれ、animationは保たれない。 |

**これを正当にしている区別**(そしてこれはREQ-0262 §10.2のものを一貫して適用している):時刻Tにおけるco
oldownの残りのfractionは、scriptによってgenerateされるのではなく**logから読まれる**。それを4Hzでstep
させることで、情報を保ったままmotionを取り除く。**flashはgenerateされる**、だから消える。

## 10. Scope(範囲)

**In(範囲内):**

1. `client/src/expedition/ExpeditionHudLayer.ts` — **NEW(新規)。** HP bar(§4)、item cooldown overlay
(§6)、unit charge control(§5)、fire flash(§7)、monster/gimic skill badge(§8)。REQ-0261の`ExpeditionR
enderer`のscene graphへ描画する。
2. `client/src/expedition/skillGlyph.ts` — **NEW(新規)。** §8.3のverb -> rune mapと`+N`のoverflow co
llapse。REQ-0265が置き換える単一のseam。
3. `client/src/board/chargeRing.ts` — **DOC-ONLYの**headerの訂正(§5.1)。挙動の変更なし;Backpacksの呼
び出し箇所は`null`のままであり、真の理由を得る。**加えて**、もしユーザーがwedgeに裁定するなら(§5.2 O
ption A):新しい`drawChargeWedge()`を`drawChargeRing()`に**並べて**追加し、`chargeRingArc()`をそのま
ま再利用する。`chargeRingArc`、`RING_RADIUS`、`RING_WIDTH`、`RING_START_ANGLE`は**一切触れない**——RE
Q-0125aのgolden G7がBackpacksのboardのためにそれらを固定しており、REQ-0261 §5.1が呼び出し箇所でそれ
らを半分にしている。
4. `client/src/board/BoardRenderer.ts` — **COMMENT-ONLY(commentのみ)**(`:981-987`)。現在chargeRingの
staleなauditを繰り返している(*"no charge data exists anywhere in the codebase"*(訳:このcodebaseのど
こにもcharge dataは存在しない))。pixel単位で同一。
5. `client/src/expedition/expeditionGeom.ts` — 定数がREQ-0260のmoduleに加わる:`EXP_HP_BAR_W/H/GAP`、
`EXP_CD_OVERLAY_FILL/ALPHA`、`EXP_FIRE_FLASH_MS=150`、`EXP_BADGE_D`、`EXP_BADGE_GAP`。
6. **Sim(加算的)。そしてこれらはすべて既存のeventに対するFIELDであり、新しいstreamでは決してない:**
   - `ray_fire` + `slot`、`cooldownTicks`(§6.4)、`cause`(§7.1)。
   - **NEW(新規)** `unit_charge_arm {t, seq, ev, id, capacity, trigger, period?}`と`unit_charge_gain
 {t, seq, ev, id, counter}`(§5.4) — 本REQにおける唯一の新しいeventであり、どちらもO(spend数)/O(戦闘e
vent数)であってO(tick数)ではない。
   - `ray_hit_all.hits[]` / `ray_aoe.hits[]` + `hp_after` — **本REQのものではない。REQ-0257 §10.1bが
この引き継ぎをACCEPT(受諾)し**、それを届ける(§4.4)。ここに列挙するのは、読者にHUDがそれに依存してい
ることを知らせるためだけである;**本REQは`sim/lib/skills.cjs`に一切触れない。**
   - **これらのsimへの追加は、12個のreplay golden全てをMOVE(動かす)する。§10.1がそのrebaseline手順で
あり、それは省略できない。**

### 10.1 Goldenのrebaseline — REQUIRED(必須)。そしてこれまで欠けていたもの

**本REQはreplayのJSONLを動かす。したがって12個すべてのgoldenの`jsonl_sha256`を動かす。** 初稿はこれ
をどこにも述べておらず、そのため§11のgate一覧は書かれている通りには満たせないものになっていた:`tools
/ci.sh`はstep**[2/7]**(`ci.sh:107`)で`sim/tests/goldens.cjs`を実行するため、`ray_fire`がfieldを得た
瞬間、CIがgreenになることは不可能だった。**何がlogを動かすか:**

| change(変更) | § | logへの影響 |
|---|---|---|
| `ray_fire` + `slot`、`cooldownTicks` | §6.4 | 既存の36件のevent(golden-A)に3つのfield。**新しいeventはなし。** |
| `ray_fire` + `cause` | §7.1 | 同じevent、fieldがもう1つ |
| **NEW(新規)** `unit_charge_arm`、`unit_charge_gain` | §5.4 | **新しいevent — しかし12個のgolden全てにおいてZERO(ゼロ)件。** 以下参照。 |

**`unit_charge_*`のeventはgoldenに何も追加しない。そしてその事実こそが§5.5のfindingそのものである。*
* `sim/tests/goldens.cjs:63`の`baseOpts`は`unitDefsById`を省いているため、すべてのgoldenは`UNIT_DEFS
 = {}`でcompileされ、charge managerを一切構築せず、**charge eventを一切emitできない**。したがってこ
の2つの新しいeventはdeterminism契約からは不可視である——§5.5が実測したまさにその盲点が、今、本REQ自身
のgateに噛みついているのである。**帰結をはっきり述べる:goldenは`ray_fire`のfieldを確認するが、charge
 eventについては何も語らない。** それらをカバーするのはgate 8とgate 9である;greenなrebaselineを§5.4
のcoverageと取り違えてはならない。

**手順 — REQ-0256 §13.1とREQ-0257 §14.1が規定するのと**同じ**ものである。2つ目のconventionを発明して
はならない:**

```
node sim/tests/goldens.cjs          # CONFIRM RED first -- 12 DRIFT lines. If green, the fields did not land.
node sim/tests/goldens.cjs gen      # writes sim/tests/goldens/replay_hashes.json
git diff sim/tests/goldens/replay_hashes.json
```

1. **12個すべての`jsonl_sha256`が動くことを期待する。**
2. **9個のdungen caseにおいて`def_sha256`は動いてはならない** — generatorは本REQによって一切触れられ
ていない。**もし1つでも動いたらSTOP(停止)する:** 何かが触れるべきでない`dungen.cjs`に触れてしまって
いる。(REQ-0256 §13.1のrule、無変更かつ同じ理由による。)
3. **`events`の件数は一切動いてはならない。** 本REQは既存のeventにFIELDを追加するのみであり、その2つ
の新しいevent種別はどのgoldenにおいても発火し得ない(上記)。**これは本REQにとって利用可能な最も鋭いch
eckである** — 0256や0257のものより鋭い。なぜならそれらはどちらも正当にcountを動かしdeltaについて論じ
なければならないのに対し、本REQの正しいdeltaはちょうど**ゼロ**だからである。**`events`のcountが動い
たなら、本REQは自分でも把握していないstreamをemitしたということである — 止まって、それを見つけるこ
と。**
4. **差分がfieldのみであることを証明する。** `batch002/golden-A`について`combat.toJSONL(r.events)`を
変更前後でdumpし、TEXTとしてdiffする:すべての行は追加されたkeyの分**だけ**異ならなければならず、行の
追加・削除・並べ替えは一切なく、すべての`t`は無変更でなければならない。§6.4留保4のback-patchが、これ
を成立させている——**もし`t`や`amount`が動いていたら、`cooldownTicks`のrollがそのfireより前に持ち上げ
られ、RNGのdraw順序が変わってしまったということである。** それがこのstepが捕らえる特定のregressionで
ある。

**順序。** 0256と0257はそれぞれ、本REQが存在するより前にrebaselineする(0256 §13.1、0257 §14.1)。**こ
れは同じ12個のhashの3度目の移動であり、`events`のcountが変化してはならない唯一のものである** — だか
らこそ他の2つの後にbisect(二分探索)可能であり、だからこそ依存先の順序(0256 -> 0257 -> 0263)は単に整
えられているのではなくhard(必須)なのである。

**rebaselineされないもの:** `sim/tests/forecast_parity.cjs`(本REQはgeometryを一切追加しない — REQ-02
56 §12.2の理由付けにより18/18が無変更であることを期待する)、`sim/s4_thresholds.json`(手作業でauthor
されたdesign intent — REQ-0256 §13.3)、そして`docs/user_managed/*`(禁止)。

**Out(範囲外):**

- **enemy rosterの拡張**(`instanceId`/`at`/`fieldCells`/`masked`) — **REQ-0261 §8.2が所有する。** 本
  REQはそれにhardに依存しており(§4.3)、重複させない。
- **Ray、trail、impact、glow budget、nova** — REQ-0262。
- **本物のskill art / `skill`というart kind** — REQ-0265。§8.3がplaceholderを出荷する。
- **`ray_fire`上の`skill`** — REQ-0262 §9.3 / REQ-0264。
- **gimicのための`computeArtUrls`の拡張** — REQ-0259(§8.5)。
- **G7の改訂**(§5.2) — ユーザーのものであり、art-pipeline上の帰結を伴う。
- **`dto.ts:201`の`[w,h]`のtranspose commentの修正**(§4.2) — Dex側のdoc bug;報告済み。
- **`terminology_unit_squad.md`のstaleな`bp.linker`引用の修正**(§2.1) — 報告済み。
- **REQ-0129のfile内`Status:`行の修正**(§5.1) — board-policyの問題;報告済み。
- **goldenのcharge engineに対する盲点**(§5.5) — REQ-0256/0257のrebaselineに属する。
- **`docs/user_managed/*`** — 禁止であり、本REQはそれを一切必要としない。

## 11. Gate

**E2Eのport(rule:`5000 + REQ*10 + index`):`7630` static / `7631` api / `7632` proxy。** 採番ruleによ
って予約されており、`tools/check_e2e_ports.cjs`によって機械的に強制される。**裁定Q2(「e2eを通す必要
はない」)により、E2Eは本programにおけるgateでは*ない*ため、harnessは構築されず、この10番台は未使用の
まま残される** — REQ-0261 §13が7610-7612について取っているのと、REQ-0262 §14が7620-7622について取っ
ているのと同じ姿勢である。

実際に適用されるgate:

1. **Unitのanchorは`bp.unit.off`である。** grep gate:`client/src/expedition/`は`.linker`を**ゼロ**件
しか含まない。読者が辿ってしまうかもしれないstaleなdocに対して§2.1を固定する。Positive test:`unit.of
f`が非ゼロであるBPは、そのbarをBPのoriginではなく**Unitの**cellの下に描く。
2. **HP barはcharge ringをclearする。** `EXP_CELL=40`において、`barTop >= unitCentre.y + 15`をassert
する — すなわち`coreRadius`では**なく**`RING_RADIUS*0.5`をclearする。13対15の混同こそが、このgateが
存在する理由であるbugである(§4.1)。
3. **geometryのために`footprint`は一切読まれない。** `client/src/expedition/`全体に対するgrep gate:g
eometryは`fieldCells` / `computeFootprintCells`のみから得られる。加えて、barが**3**列にまたがり第**4
**行の下に位置する**非正方形**のfixture(`[4,3]`) — 正方形のfixtureは何も証明しない(REQ-0188 G4の教
訓)。
4. **cooldownのrampは、status変化をまたいでも正確に線形である。** cooldownの途中でChillを適用する;`r
emainingTicks`が今も`cooldownTicks - (t - t_arm)/TICK_SECS`に等しいことをassertする。**これは§6.4の
導出全体を守るgateである**。REQ-0256がarmされたcooldownをre-rollするなら、これは派手に失敗する。
5. **Badgeはfootprintに収まる。** **すべての**live enemyとgimicについて:`N * (EXP_BADGE_D + EXP_BADG
E_GAP) - EXP_BADGE_GAP <= footprint[0] * EXP_CELL`。今日時点ではpassする(worst:`rime_shaman`、38 <= 
40)。合成した1x1-with-3-skillsのfixtureでは**失敗しなければならない** — 失敗するcaseを明示的にpinす
る(§8.2)。
6. **N=0は何も描かない。** skillを持たないgimic(`chest_frostbound_cache`)は**ゼロ**個のbadgeを描画す
る — 空の円ではない。
7. **ring/wedgeは、存在しない場合はきれいに隠れる。** `charge`blockを持たないBPは何も描かず、何のコ
ストもかからない:`chargeRingArc(null) === null`(既に`check_unit_icon.mjs:123`によってpin済み;expedit
ionのpathがそれを尊重することをassertする)。
8. **charge controlはclockの純粋な関数である** — `every_secs`のtriggerについて:1つの`unit_charge_arm
`が与えられれば、`t`におけるcontrolの値は、どんな順序で呼ばれても、どんな速度でも、backward scrubの
もとでも同一である(§5.4)。REQ-0262 §14.2を反映している。
9. **tickごとのstreamは一切存在しない。** golden-Aの全replayに対するevent-count gate:runの総event数
はREQ-0257 §10.2が述べる約3.75倍の枠**にO(spend数) + O(gain数)を加えたもの**の中に収まらなければなら
ず、tick数に比例して増えては**ならない**。**これは、誰かが値をただstreamするだけで§5.4や§6.4を「修
正」しようとした場合に捕らえるgateである** — 本REQが存在する理由であるまさにその失敗を防ぐ(§6.3:約30
0,000event)。
10. **Enemyのbarはnovaを追跡する。** `hp_after`を運ぶ`ray_hit_all`が与えられれば(§4.4)、enemyのbarは
nova上で動く。**今日時点では失敗する** — そのfieldが存在しないためである — そしてこれが§4.4の引き継
ぎに対するacceptance testである。
11. **Reduced motionはflashを構築しない**(§9):`prefers-reduced-motion: reduce`のもとで、flash/transi
tion objectが一切生成されないことをassertする;barとoverlayは引き続き描画される。
12. §10.4のcomment-onlyな編集の後、`BoardRenderer`の出力は**byte単位で同一**である。
13. `pnpm exec tsc --noEmit` + lint。
14. **`node sim/tests/goldens.cjs`が12 caseすべてでgreenになる。§10.1に従いREBASELINE(再基準化)済み*
*であり、9個のdungen caseすべてで`def_sha256`が無変更、かつ**`events`のcountがすべて無変更**である(§
10.1 step 3)。rebaselineなしには、このgate——そしてそれを実行する`tools/ci.sh`のstep [2/7](`ci.sh:107
`)——は**passできない**。本REQが`ray_fire`にfieldを追加するためである。
15. **`node server/tests/api_test.cjs`(determinism gate)がgreenになる**。REQ-0256 §13.2に従う:regene
rateすべきものは何もない——それはre-simulateしてdeep-equalするため、両側が共に動く。**もしそれがredに
なったら、それはbaselineの副作用ではなく本物のdeterminismの破綻である。** rebaselineによってそれを「
修正」してはならない。

## 12. Acceptance criteria(受け入れ基準)

1. すべてのplayer BPは、`bp.unit.off`にanchorされた**Unit iconの下**にHP barを示し、charge ringをcle
arし、REQ-0240の`hp-full/mid/low`のthresholdを用いる(§4.1)。
2. maskされていないすべてのenemy/gimicは、**そのcell shapeの下**にHP barを示し、shapeの幅いっぱいに
広がり、`fieldCells`から導出される(§4.2)。**maskされた**instanceはdiscoveryまでbarを**示さない**(§4.
6)。
3. **Enemy HP barはnova上でも動く**。direct hitの上だけではない(§4.4) — 現在不可視になっている72.2%
のダメージである。
4. cooldown中のitemは、その**footprint**にmaskされたclockwiseな半透明黒のwedgeを示し、0.5/1/2/4倍速
およびbackward scrubのもとでもsim clockに対して正確であり、**`ray_fire`上の2つのfield**によって駆動
され、**tickごとの新しいeventはゼロ**である(§6.4)。
5. chargeを持つUnitは、§5.2で裁定されたcontrolが12時方向からclockwiseに満ちていく様子を示す;`charge`
blockを持たないUnitは**何も**示さない(§5.4)。
6. **passive**なfireはflashし、cooldown wedgeを**示さない**;**cadence**なfireはflashし**、かつ**wedg
eを示す — client側のdef lookupによってではなく、`cause`によって区別される(§7.1)。
7. `hrimgrimnir`(3skill、`[3,3]`)は**3**個のbadgeを示す;`rime_shaman`(2skill、`[1,1]`)は、重なりも溢
れもなく**2**個を示す;`chest_frostbound_cache`(0skill)は**何も**示さない(§8.2)。
8. 各badgeはそのverb rune、clockwiseなwedgeを運び、発動時にframeが光る。`skillGlyph.ts`をstubに差し
替えると、`ExpeditionHudLayer`への変更**なし**にすべてのiconが変わる — 実演によって証明されたREQ-026
5のseam(§8.3)。
9. HUD全体は、**files backend**(空の`art_urls`)に対しても、throwすることなく描画される(§8.5)。
10. **ユーザーが以下について裁定済みである:§5.2(G7のring対ユーザーの背景wedge)、§4.5(enemyの`hpMax` 
— 実際の値対`hp[1]`)、§8.3(6つの新しいruneがsymbol集合に加わること)、そして§7.2(「光る」をnon-glowin
gなbrightenとして描画すること)。** それより前に実装は開始しない。
11. REQ-0261の**server側**のrosterの拡張が着地済みである(§4.3)。`instanceId`なしには基準2は届けられ
ず、本REQは停止する。

## 13. ブリーフ、taskのframing、そしてsourceへの訂正

| 主張 | 現実 | 根拠 |
|---|---|---|
| task:*"the Unit sits at `bp.linker.off`"*(訳:Unitは`bp.linker.off`に位置する) | **`bp.unit.off`である。** `linker`モデルは**廃止済み**であり、`server/tests/api/workshop.cjs:61`は**`rolled.linker === undefined`をassertしている**。 | §2.1 |
| `terminology_unit_squad.md`:*"`mock-src/engine.js:92` `unitCell(bp)` dereferences `bp.linker` unconditionally"*(訳:`mock-src/engine.js:92`の`unitCell(bp)`は無条件に`bp.linker`をdereferenceする) | **2重に誤り**:行は**103**であり、しかも`bp.unit`である。**BP:Unit LAWそのものは今も成立している**(`gacha.cjs:208`が無条件に`unit:{id,off}`を刻印する)——古びたのはrenameの影響を受けたその引用根拠だけである。 | §2.1 |
| task:*"NO live unit carries a `charge` block today"*(訳:今日時点でcharge blockを持つlive unitは1つもない) | **FALSE(偽) — 54体中42体が持つ**(実測)。その主張は`compile.cjs:142-144`のstaleなcommentに由来する。**実際の話は、より良くもあり、より悪くもある:** productionは`unitDefsById`を渡すため(`runs.cjs:83-91`)chargeは**LIVE(稼働中)**である;goldenは渡さないため(`goldens.cjs:63`)chargeは**12個のdeterminism golden全てから不可視**である。 | §5.5 |
| task:*"`unit_charge.cjs`'s guard: `troopBps.filter(b => b && b.charge)`"*(訳:`unit_charge.cjs`のguard:`troopBps.filter(b => b && b.charge)`) | guardは`unit_charge.cjs`内ではなく**`sim/lib/encounter.cjs:40`**にある。 | §3、§5.5 |
| `chargeRing.ts:12-30`:*"THERE IS NO CHARGE DATA IN THIS CODEBASE … sim/ has no per-unit charge"*(訳:このcodebaseにはcharge dataが一切存在しない……sim/にもunitごとのchargeは存在しない) | **2026-07-12時点ではTrue(真)、REQ-0200(merge済み)以降はFalse(偽)。** `sim/lib/unit_charge.cjs`はunitごとのcharge runtimeである;42体のlive unitがcharge blockを持つ。 | §5.1 |
| `chargeRing.ts:28-30`:*"REQ-0129 supplies the real value"*(訳:REQ-0129が実際の値を供給する) | **誤って割り当てられている。** REQ-0129は**`done/`**にあり、`:986`は今も`null`を渡している。それが出荷したのは*vocabulary*(v13のcharge block)である;*data source*は**REQ-0200**である。 | §5.1 |
| `chargeRing.ts:28-30`:*"changes ONE argument … this module needs no edit"*(訳:変わるのは引数1つ……このmoduleは編集不要である) | **TRUE(真) — 検証済み、ringについては。** radius/widthは既にparamである;`chargeRingArc`はpure/totalである;`null`はきれいに隠れる。**§5.2に条件付き**:もしwedgeが採用されれば、arcの数学はそのまま生き残るが*draw(描画)*は生き残らない。 | §5.1、§5.2 |
| task:*"G7 says RING — reconcile: is a ring fill the same thing the user is asking for?"*(訳:G7はRINGと言っている——調停せよ:ring fillはユーザーが求めているものと同じものか?) | **Noである。** annulus(円環)のstroke対filled sector(塗りつぶされた扇形);discの外側対artの背後;arc対area。和解は可能である(iconの**背後**のwedgeはG4を保つ)、**しかし書かれている通りのG7はそれには生き残れない**。ユーザー自身の(k)+(l)は1つのidiomである;**G7の方が例外である**。 | §5.2 |
| REQ-0240 M3:*"charge events are not slot-attributable without more plumbing"*(訳:charge eventはこれ以上のplumbingなしにはslotに帰属させられない) | **半分正しい。** eventは**確かに**BP idを運んでおり(`unit_charge_encounter.cjs:169`)、帰属は導出可能である。**M3が名指ししていない本当のgap:どのeventもCOUNTERを運んでいない** — すべてのemissionはdiscreteである。spendのみのtelemetryからringを描くことはできない。 | §5.3 |
| task:*"enemies today carry 1-2 [skills]"*(訳:今日時点でenemyは1-2個の〔skillを〕持つ) | **N ∈ [0, 3]である。** liveの最大は**3**(`hrimgrimnir`);**4体のlive gimicのうち2体は0を持つ**。2を前提とするlayoutはbossを切り取り、chestに幻のbadgeを描いてしまう。 | §8.2 |
| spec (l):*"passives included"*(訳:passiveを含む) | **live monster skillのうちpassiveであるものは1つもない** — 全**81**件が`every_secs`である。このbranchは行使されないまま出荷される。Passiveは**player**側においては実在し、それは(l)ではなく(k)の問題である。 | §8.4 |
| **`shared/dto.ts:201`**(新たなfinding):`ApiMonsterEntry`(enemy/1)上の*"`footprint` is **[w,h]** in cells"*(訳:`footprint`はcell単位で**[w,h]**である) | **Transposeされている。** conventionは`[fh, fw]`である(`content_validate.cjs:472-479`;REQ-0188のschema表)——そして**`dto.ts:229`は`ApiGimicEntry`について同じfieldを正しく記述している**。1つのfile、1つのfieldに、2つのconventionが、**shared DTO**の中に。REQ-0261 §8.5が`MonsterCatalog.tsx`で発見したbugの2件目の実例である。 | §4.2 |
| **`ray_hit_all` / `ray_aoe`は`hp_after`を運ばない**(新たなfinding) | REQ-0240、REQ-0257、REQ-0261のいずれによっても名指しされていない。**`hp_after`によって駆動されるHP barは、全rayダメージの72.2%に対して盲目である。** 修正:既存のarray memberに1つのfield、run 1回あたり約34個の数値。 | §4.4 |
| REQ-0257対REQ-0240のDeviation 3 | **REQ-0257は`dst` -> rosterの解決を修正*しない*。** それが追加するのは`ray`(**ray**のid)であって**instance**のidではない;`maskLabel`には一切触れない;そして`#N`は取り除けない、3体の`ice_archer`が1つのroster`id`を共有しているためである。**REQ-0261 §8.2の`instanceId`こそが修正である。** | §4.3 |
| `REQ-0129`のheader:`done/`に置かれているにもかかわらず`**Status:** todo` | PROJECT.mdの*"a REQ's status IS its folder. Nothing else records REQ status."*(訳:REQのstatusとはそのfolderそのものである。それ以外の何ものもREQのstatusを記録しない)に違反している。 | §5.1 |
