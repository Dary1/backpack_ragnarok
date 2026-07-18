# REQ-0257 — ray-flight-entity: IBattleRayはliveなentityとなり、到達に時間がかかるようになる

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKED。作業を開始する前にユーザ
ーの判断が必要な点が4つある:(1) 本REQは戦闘のRESULT(結果)を、どのgateも正誤を判定できない形で変
化させる — §8はkill-steal(キル横取り)、over-kill(オーバーキル)の無駄、novaの再照準を詳しく述
べており、ユーザーがそれを望むかどうかが問題になる;(2) REQ-0256が既に12個の全リプレイgoldenを動
かした後で、本REQはそれらを2度目に動かす;(3) §10は`ray_step`イベントを廃止する。これは6件の実測
済みconsumer(利用者)を持つWIRE(通信)フォーマットの変更である(§11);(4) **§12.1はbrief §4の
`IBattleInstancesFormationMap.tick()`を`tickInstances()` / `tickRays()`に分割する** — brief §4は
1つのmapに対して`tick()`を書いたが、実際にはmapが2つ存在するためである。この判断はREQ-0256 §7.1a
が所有している。同じフラグがREQ-0256とREQ-0258にも現れており、**vetoすれば三者とも変わる**。その
代償は、§12.2が保証する「どちらの側が発火したかに関わらず、すべてのrayがfireから最初のdiagonalま
で同じ4tickを要する」という性質である。

**本REQがACCEPT(受諾)する2件の引き継ぎ事項を、静かに落とされないよう記録しておく:**
(a) **REQ-0263 §4.4** — `ray_hit_all.hits[]` / `ray_aoe.hits[]`上の`hp_after`。これらは**全ray
ダメージの72.2%**を運ぶ(§10.1b)。受諾済み;§14.1のrebaselineに組み込まれる。0263 §4.4はこれに
合わせて更新される。
(b) **`ray_fire`の3つの不均一なemission site(発行箇所)**(§10.1a) — `ray` idは3箇所すべてに刻
印され、schema(スキーマ)のoptional(任意)フィールドは0262/0263/0264向けに書き記される。これら
はgolden-Aの形状だけを根拠に実装されてはならない。
**予約日:** 2026-07-18
**スラッグ:** ray-flight-entity
**ブランチ:** req-expedition-spec(仕様のみ。実装はREQ-0256から分岐する)
**依頼者:** user、2026-07-18 — 仕様項目(c)および(g)、Q1裁定。
**依存先:** REQ-0256(battle-tick-core) — HARD(必須)な依存。「4tickごとに1diagonal進む」という
概念は、tickなしには存在し得ない。また、REQ-0258の`IBattleInstancesFormationMap.rays[]`宣言も継
承する。
**ブロック対象:** REQ-0262(expedition-ray-vfx) — そのper-tick(tickごとの)trailは§10のイベン
トを読む。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q1, §3 C2, §4。

## 1. ゴール

rayをFUNCTION CALL(関数呼び出し)からENTITY(エンティティ)へ変える。現状`walkRay()`は、entry
(進入)→bounce(跳ね返り)→hit(命中)→splash(飛散)を、1つのeventの中で1つの`t`のうちに解決す
る。本REQの後、rayはmap上に存在するオブジェクトとなり、`RAY_TICKS_PER_DIAGONAL`tickごとに1
diagonal進み、**到達した時点で**そこにいる相手に命中する — fireされた時点でそこにいた相手にでは
ない。

これは戦闘結果を変化させる。それは意図された結果であり、副作用ではない。

## 2. これを承認する裁定

Q1裁定、原文まま:

> **シムを全面tick化** — the server sim is rewritten to a 0.01s tick loop. **Ray flight is PHYSICAL
> and changes combat results.** Goldens / determinism gate / forecast parity / S4 baselines all
> rebaseline.

(訳:サーバー側simは0.01秒のtickループに書き直される。**Ray flightはPHYSICAL(物理的)であり、
戦闘結果を変化させる。** Golden群・determinismゲート・forecast parity・S4ベースラインは全て
rebaselineされる。)

仕様項目(g):0.04秒ごとに1diagonal = **25 diagonal-steps/sec**。

仕様項目(c)、freezeルール、原文まま:

> IBattleRayは発火時のスキル参照から作られ、そのあとのユニットやスキルの変化を影響を受けず、そこで状態が凍結して、飛来します

**§7の両半分はどちらもload-bearing(この結論を支える上で不可欠)である。** ブリーフはそう述べて
おり、それは正しい:rayはfrozen(凍結)されており、field(フィールド)はlive(生きた状態)であ
る。まさにそれだけを実装し、それ以上のことはしない。

## 3. `walkRay()`が現状行っていること — 全文を読む

`sim/lib/ray.cjs`は100行であり、`walkRay`は8-87行目である。simの中でこれを呼び出す箇所はちょうど
1つ(`sim/lib/skills.cjs:283`、`fireSkillRay`の内部)であり、あとはテストから呼ばれる(§13.1)。
その形は:

```js
function walkRay(opts) {
  const { field, entryCell, dir, mode, penetration, aoe, aoeStatuses,
          bounceBudget, dealHitFn, splashFn, liveOccupantFn, isDestroyedPassable } = opts;
  let cell = entryCell.slice(); let curDir = dir;
  let bounces = 0; let passed = 0; let steps = 0; let landing = null;
  const pathBatch = [];
  function flushSteps() { if (pathBatch.length > 0) { events.push({ ev: 'ray_step', path: pathBatch.slice() }); pathBatch.length = 0; } }
  for (;;) {
    steps++;
    if (steps > TUNABLES.RAY_STEP_BUDGET) { aborted = true; events.push({ ev: 'ray_abort', ... }); break; }
    const next = stepCell(cell, curDir);
    if (outside(next, ROWS, COLS)) { flushSteps(); ... bounces++; ... continue; }
    cell = next;
    pathBatch.push(cell.slice());
    const occ = liveOccupantFn(cell);
    if (occ == null) continue;
    flushSteps();
    const hitResult = dealHitFn(occ, mult(bounces), { allField: false });
    ...
    if (passed < penetration) { passed++; continue; }
    landing = cell.slice(); break;
  }
  ...
}
```

すべて — `for(;;)`全体 — が、呼び出し元の1つの`t`の内側で同期的に発生する。`pathBatch` +
`flushSteps()`が存在する理由は**ただ一つ**、通過したセルをバッチ化して`ray_step`イベントにまと
め、クライアントが**事後的に**それをアニメーションできるようにするためである。`MonitorRenderer.ts:34`
の`STEP_ANIM_MS = 200`とREQ-0240の`pacing.json`の`rayStep.perCellMs: 90`が、その事後的なアニメー
ションにあたる。**現状、flight(飛行)は演出にすぎない。** 本REQはそれをphysics(物理)にし、演
出を削除する。

`opts.isDestroyedPassable`が**destructure(分割代入)されているが一度も使われていない**
(`ray.cjs:11`)ことに注意 — 死んだパラメータである。通行可否は暗黙のうちに扱われている:
`liveOccupantFn`(`skills.cjs:204-210`)は`!a.alive`をskipするため、破壊された占有者は既にwalkか
らは見えなくなっている。再構築の際にこの死んだパラメータは削除すること。念のため残す、というよう
なことはしない。

## 4. 検証済みの現状

| fact | source | evidence |
|---|---|---|
| ray全体が1回の呼び出しである | `sim/lib/skills.cjs:283-291` | `const result = walkRay({ field: {...}, entryCell, dir, mode, penetration, ... });` |
| …1つの`t`のうちに | `sim/lib/encounter.cjs:616` | `for (const re of rayEvents) events.push(Object.assign({ t: ev.t, seq: heap.nextSeq() }, re));` — ray関連のeventは**全て**同じ`t`を持つ |
| `RAY_STEP_BUDGET` = 512 | `sim/lib/core.cjs:12` | `RAY_STEP_BUDGET: 512,` — 現状はCELL(セル)単位でカウントされている |
| ray flight用のtunableは存在しない | `sim/lib/core.cjs:9-99` | `TUNABLES`にはray timing用の定数がない |
| 破壊された = 通行可能 | `sim/lib/skills.cjs:204-210` | `liveOccupantFn(cell) { for (const a of targetActors) { if (!a.alive) continue; ... } return null; }` |
| 5回目のbounceによるnovaはLIVEな全員に命中する | `sim/lib/ray.cjs:56-57` | `const allHits = dealHitFn(null, mult(5), { allField: true }); events.push({ ev: 'ray_hit_all', ... })` |
| …呼び出し時点でのlivenessを読む | `sim/lib/skills.cjs:212-220` | `if (opts2.allField) { for (const a of targetActors) { if (!a.alive) continue; ... } }` |
| ダメージロールはfire時点のstreamに基づく | `sim/lib/skills.cjs:222`, `encounter.cjs:614` | `dmgStream`は`streamPrefix: effectStreamName(s.ownerUid, s.effIdx) + '/' + ev.t`から構築される |
| lifestealは既にownerの死亡をguardしている | `sim/lib/skills.cjs:268` | `if (attacker.selfActor && attacker.selfActor.alive) { ... }` |

### 4.1 MEASURED(実測): 実際のrunでrayが実際に何をするか

`batch002/golden-A`(最初のリプレイgolden)を実行し、全eventをtype別に数えた。**これが本REQが動
かす対象そのものであり、実測値であって推定値ではない:**

```
TOTAL events: 330
{"progress":5,"encounter_start":8,"telegraph":35,"ray_fire":36,"ray_step":109,
 "ray_bounce":88,"ray_hit_all":17,"encounter_end":8,"ray_hit":21,"ray_aoe":2,"run_end":1}

ray_step events: 109 | cells carried: 1017 | avg cells per ray_step: 9.33 | max: 17
bounce histogram: {"1":18,"2":18,"3":18,"4":17,"5":17}
```

5つの事実がここから導かれ、それぞれが本REQの形を決めている:

1. **36本のrayが合計1017セルを移動する** — 1rayあたり平均**28.25 diagonal**である。
   `RAY_TICKS_PER_DIAGONAL = 4`のもとでは、これは**平均的なrayについて1.13秒の飛行時間**にあた
   る。飛行時間は端数処理の些事ではない。このcontentにおけるほとんどの`every_secs`クールダウンよ
   り長い。rayは、そのownerが次にfireする時点でもまだ空中にいることが日常的に起こる。
2. **36本中17本(47%)のrayが5回目のbounceに到達し**、all-fieldのnova(`ray_hit_all`: 17)を発
   動させる。bounceのヒストグラム`{1:18, 2:18, 3:18, 4:17, 5:17}`が示す通り、rayはほぼ早期停止し
   ない — 18本のrayが少なくとも1回はbounceし、そのうち17本はbounce 5まで乗り切る。**このcontent
   において、novaはedge caseではなく、中央値の結果である。** combat_spec §10はこの状態そのものを
   バランス上の懸念として名指ししている:*「+150%のall-field terminatorにほぼ常に到達するskillに
   flagを立てる」*。ユーザーの現行contentに対してその指定されたgateが実際に発火するであろうこと
   は伝える価値があるが、それを直すのは**本REQの仕事ではない**(§15 Out)。
3. **直接の`ray_hit`はわずか21件、`ray_hit_all`は17件** — このrunにおけるダメージの大半はnovaに
   よってもたらされており、primary hit(直接命中)によるものではない。したがって§8の「ARRIVAL
   (到達)時点でのfield状態が結果を決める」というルールは、支配的なダメージ経路に適用されるので
   あって、その片隅にだけ適用されるのではない。
4. **`ray_step`は平均9.33セル**(最大17)。これが本REQによって除去されるバッチ処理であり、§10.2
   がその置き換えを定量化する。
5. **何もabortしない。** 36本のray中、`ray_abort`はゼロ — `forecast_parity.cjs`のヘッダーの注記
   にある「512の予算は**両方の実装にとって実務上dead code(死んだコード)である**」という記述と
   一致する。§5.1でこの予算を新しい単位のもとで再検討する。

## 5. `RAY_TICKS_PER_DIAGONAL` — そのTUNABLE(調整可能値)

**`sim/lib/core.cjs`の`TUNABLES`への新規エントリー:**

```js
// REQ-0257 (spec g): a ray advances ONE diagonal per this many ticks.
// 4 ticks x TICK_SECS(0.01) = 0.04s per diagonal = 25 diagonal-steps/sec.
// TUNABLE for the same reason TICK_SECS is: the user gave the RATE (25/sec),
// and the tick count is how that rate is expressed against TICK_SECS. If
// TICK_SECS moves, THIS must move with it to hold 25/sec -- they are coupled,
// which is exactly why neither may be a literal.
RAY_TICKS_PER_DIAGONAL: 4,
```

**この結合はTRAP(罠)であり、gateされなければならない。** `RAY_TICKS_PER_DIAGONAL = 4`が
「25/sec」を意味するのは、`TICK_SECS === 0.01`である間だけである。誰かが解像度のために
`TICK_SECS`を0.005に半減させれば、全rayの速度は気づかれないまま50/secに倍増する。tick数ではなく
DERIVED(導出された)rateをassertするテストを追加すること:

```js
// the user specified 25 diagonal-steps/sec (spec g). Assert the RATE.
eq(1 / (TUNABLES.RAY_TICKS_PER_DIAGONAL * TUNABLES.TICK_SECS), 25, 'ray diagonal rate');
```

これはREQ-0256 §5の教訓を1つ上の層に適用したものである:誰もチェックしないtunableは、手間が増え
ただけの定数にすぎず、誰もチェックしない2つの結合したtunableは、スケジュール表つきのバグである。

### 5.1 `RAY_STEP_BUDGET` = 512、DIAGONAL単位でカウントされるようになる

brief §4より:*「既存の`RAY_STEP_BUDGET = 512`はDoS guardとして維持され、diagonal単位でカウント
されるようになる」*。512という値はVERBATIM(そのまま)維持され、単位だけがcells-walked(歩いたセ
ル数)からdiagonals-advanced(進んだdiagonal数)に変わる。`walkRay`は既にdiagonalを試みるたびに
`steps`を1ずつ増やしているため(`ray.cjs:32`)、**この数値の意味は変わらない** — それは常に
diagonalであった;同期的なwalkにおいては「cells」と「diagonals」は同じ量だったのである。

変わるのは:**512 diagonalは、今や2048 tick = 20.48秒の飛行時間になる。** 決して終了しないray
は、数マイクロ秒ではなく20秒間、壁時計上の時間を占有することになる。実測(§4.1)では、これに近づ
くrayは1本もない — 実際に最悪のrayでも~28 diagonal程度である — そのため、この予算は引き続きdead
codeのままである。しかしそれはもはや*安価な*dead codeではない:abortするrayは、20秒間画面に描画さ
れ続けたrayだということになる。この数値自体には手を触れず(これはバランス調整のノブではなくDoS
guardである)、コストが変化したことだけを記録しておくこと。

## 6. `IBattleRay` — そのentity

brief §4より:

```
IBattleRay
  id        : int              // per-battle monotone; NEW -- s10 needs it to correlate events
  map       : IBattleInstancesFormationMap   // the map it flies ON (= the OPPOSING map)
  frozen    : { verbs, attackProfile, pen, aoe, aoeStatuses, bounceBudget, mode,
                mult basis, ownerRef, dmgStream }        // s7
  cell      : [row,col]        // current position
  dir       : 'DR'|'DL'|'UR'|'UL'
  bounces   : int
  passed    : int              // penetration pass-throughs spent
  steps     : int              // against RAY_STEP_BUDGET (s5.1)
  subTick   : int              // 0..RAY_TICKS_PER_DIAGONAL-1
  alive     : boolean
  advance() // called once per tick; moves ONE diagonal every RAY_TICKS_PER_DIAGONAL ticks
```

Rayは`IBattleInstancesFormationMap.rays[]`上に存在する(REQ-0258 §9で宣言されている)。**rayは
相手側のmapに向かってfireされるものであり、それゆえそこに存在する** — brief §4はこれを明言してお
り、これは重要な点である:player側POのrayは、ENEMY(敵)側のmap上のentityであり、そのenemy map
の`tick()`こそがそれを進めるのである。

### 6.1 `advance()` — walk、diagonal単位で1つずつ

`walkRay`の`for(;;)`本体(`ray.cjs:31-80`)が、そのまま`advance()`の本体になる。`continue`は
`return`(そのtickをyieldする)に、`break`は`this.alive = false`になる。**geometry(幾何)は書き
直されるのではなく、re-host(再配置)される。** 行ごとの対応:

| `walkRay` today | `advance()` |
|---|---|
| `steps++; if (steps > BUDGET) { abort }` | 同じ。diagonalごとに |
| `const next = stepCell(cell, curDir);` | 同じ |
| `if (outside(next)) { reflectDir; bounces++; ... continue; }` | 同じ。その後`return`(bounceはdiagonalを消費する) |
| `cell = next; pathBatch.push(...)` | `this.cell = next;` + `ray_advance`をemit(発行)する(§10.1) — **`pathBatch`/`flushSteps`はDELETE(削除)される** |
| `const occ = liveOccupantFn(cell); if (occ == null) continue;` | 同じ。その後`return` — **`liveOccupantFn`は、今やLIVE(生きた)mapを読む(§7.2)** |
| `dealHitFn(occ, mult(bounces), {allField:false})` | 同じ。FROZEN(凍結された)streamから(§7.1) |
| `if (passed < penetration) { passed++; continue; }` | 同じ。その後`return` |
| `landing = cell.slice(); break;` | `this.landing = ...; this.alive = false;`、その後splash |

**`walkRay`はPURE PATH FUNCTION(純粋な経路関数)として生かしておくこと。** これはoptional
(任意)ではない — §11.6が示す通り、`forecast_parity.cjs`と9件の`run.cjs`テストが同期的なwalkに
依存しており、forecastオーバーレイ(REQ-0057)は「今fireしたら、他に何も変化しないと仮定してどこ
へ行くか」という問いに引き続き答えなければならない*prediction*(予測)ツールである。`ray.cjs`を
以下のようにrefactor(再構築)する:

- `walkRayPath(field, entryCell, dir, pen, aoe, bounceBudget, mode, occupancyFn)` → pureな
  geometryであり、cellの並び + landing + bouncesを返す。**Snapshot(スナップショット)semantics
  (意味論)。** forecastとgeometryテストが呼ぶのはこれである。
- `IBattleRay.advance()` → liveなentityであり、LIVEなoccupancy(占有)関数に対して、呼び出しご
  とに1diagonalずつ、SAME(同じ)geometryを歩く。

両者は、同一のoccupancyが与えられれば同一のgeometryを生成しなければならない — **これはtestable
(テスト可能)なinvariant(不変条件)であり、単なる希望的観測ではない**(§16.4)。もし両者が乖離す
れば、forecastは嘘をつくことになる。

## 7. FREEZEルール — 正確に

rayはFIRE(発火)時点でsnapshotを取り、**ownerまたはそのskill**へのその後の変化に対して影響を受
けない。rayが通過するFIELDはLIVEである。両半分を正確に述べる:

### 7.1 fire時点でFROZEN(凍結)されるもの(attacker側)

| frozen | today's source | why it must freeze |
|---|---|---|
| `verbs` | `verbEff` (`skills.cjs` param) | 飛行中の`buff_host`のrefold(再合成)が、既に飛行中のrayをretro-buff(遡って強化)してはならない |
| `attackProfile` | `s.attackProfile` (`encounter.cjs:163`) | pen/aoe/edge/bounce_budgetはrayのidentity(識別情報)である |
| `pen`, `aoe`, `aoeStatuses`, `bounceBudget` | `attackProfile.*` (`skills.cjs:286-289`) | 同上 |
| `mode` | `encounterDef.mode` (`encounter.cjs:612`) | REQ-0259が`ray.mode`でgateする;それはAT FIRE(発火時点)のmodeでなければならない |
| mult basis | `mult(bounces)` table (`geometry.cjs:49-54`) | このtableは静的である;BOUNCE COUNT(bounce回数)がrayの持つliveな状態である |
| `ownerRef` | `attacker` (`encounter.cjs:602`) | lifesteal/spikesの帰属先を示すidentity |
| `outgoingBuffPct` | `chargeMgr.outgoingBuffPctFor(bpId)` (`encounter.cjs:602`) | **fire時に一度だけ読む。** 飛行中に着地するchargeバフが、既にfire済みのrayを増幅してはならない |
| `bonusVsStatus` | `bonusVsStatusForOwnerUid(...)` (`encounter.cjs:602`) | **LISTはfreezeするが、そのEVALUATION(評価)はliveのままである** — §7.3参照 |
| `dmgStream` | `rng.stream(streamPrefix)` (`skills.cjs`) | §7.4 |

### 7.2 飛行中LIVEであるもの(field側)

| live | why |
|---|---|
| occupancy — rayが進入するセルに誰がいるか | **これこそが本質である。** `liveOccupantFn`は、diagonalごとに、mapのCURRENT(現在)のoccupantに対して再評価される |
| targetの生存状況 | 飛行中に死んだtargetはもういない;破壊された占有者は既に通行可能である(`skills.cjs:206`、combat_spec §2.2) |
| targetの`statusBag` | TARGET上のWeakness/ChillはHIT(命中)時点で読まれる。飛行中にWeaknessを付与されたtargetに向かうrayは、weakenされた状態で着弾する |
| targetの`damageReduction` | `reduceIncoming`(`skills.cjs:240`)はliveなtargetを読む |
| 5-bounce novaのvictim(被害者)集合 | `{allField:true}`は**到達時点**でLIVEなoccupantを列挙する(`skills.cjs:212-220`)。§8.4 |
| OWNERの生死 | 死んだownerでも、飛行中のrayはそのまま存在し続け、飛び続ける。ただしlifestealは誰も回復させない(`skills.cjs:268`が既にguardしている) |

### 7.3 briefが行っていない曖昧さの解消 — 誰かが必ず間違えるポイント

**「Frozen」はATTACKER(攻撃側)に適用される。「Live」はDEFENDER(防御側)とFIELDに適用される。**
briefは*「rayのDAMAGE/verbs/pen/aoeはfire時点でsnapshotを取り、rayが通過するFIELDはliveである」*
と述べている — これは正しいが、1つのケースだけ本当に曖昧なまま残されており、コードはそのどちら
かを選ばなければならない:

**`bonusVsStatus`**(REQ-0093)は、ATTACKERが所有するfrozenな`{statuses, n}`ルールのLISTであり、
hit時点でLIVEなTARGETのstatus bagに対して評価される(`skills.cjs:239`、
`bonusVsStatusAmount(a.statusBag, attacker.bonusVsStatus, dmgStream)`)。**裁定:listはfreezeする
が、evaluationはliveのままとする。** 根拠:「burning状態のtargetに+Nダメージを与える」というルー
ルはattackerのskillの一部であり(frozen)、rayが着弾する時点でtargetがburning状態かどうかはfield
についての事実である(live)。EVALUATIONをfreezeしてしまうと、健康なtargetに向けてfireしたrayが
飛行中にそのtargetが炎上しても、ボーナスなしで着弾することになる — これは§7.2の「target
statusBagはliveである」と何の理由もなく矛盾する。同じ読み方が`weaknessMultiplier`と
`reduceIncoming`にも当てはまる:attacker側が所有するルールはfreezeし、target側が所有する状態は
arrival時点で読まれる。

これをfreezeするコード箇所にコメントとして明記すること。これは、一度書けば自明になるが、書かなけ
れば永遠に蒸し返される類の区別である。

### 7.4 damage streamはfreezeするが、DRAW(抽選)はarrival時点で行われる

`dmgStream`はfireごとに一度、`streamPrefix`から構築される(`encounter.cjs:614`:
`effectStreamName(s.ownerUid, s.effIdx) + '/' + ev.t`)。**rayはそのstreamオブジェクトを持ち運ぶ。**
drawはhitのたびに、hitの順序通りに発生する。これは現状と全く同じである。

**なぜfire時点で全ダメージをpre-roll(事前抽選)しない(完全にfreezeしない)のか?** 何回hitする
かは、rayが実際に飛んでみるまで分からないからである — それこそがこの変更の全てである。pre-roll
するには、hit数を事前に推測する必要があるが、それはまさに飛行が破壊する情報そのものである。

**帰結を率直に述べる:** streamのNAME(名前)は変わらないため、seedも変わらない。しかしrayは今
や、そこから異なるORDER(順序)で、異なるNUMBER OF TIMES(回数)だけ抽選を行う(命中する対象の
集合が異なるため)。**あらゆるダメージ数値が変動する。** これはREQ-0256 §10.4のstream名の
requantization(再量子化)と複合する — だからこそ、この2つのREQは別々にlandしなければならない
のである(§12.3)。

## 8. RESULT(結果)がCHANGE(変化)する点 — 具体的に述べる。これは意図された挙動である

Q1裁定は*「Ray flightはPHYSICALであり、戦闘結果を変化させる」*と述べている。それが具体的に何を
もたらすかがここに書かれている。**これらはどれもバグではない。すべてFEATURE(機能)である。** そ
れぞれを明記するのは、ユーザーがgolden diffの中でその帰結を発見するのではなく、このFEATUREそのも
のをvetoできるようにするためである。

### 8.1 飛行中にtargetが死んだrayは、そのまま飛び続ける

rayが到達した時点でtargetは既にいなくなっている。破壊された占有者は**既に**通行可能である —
combat_spec §2.2、原文まま:*「**破壊された占有者は通行可能である**(空とみなされる;停止せず、
penetrationとしてもカウントしない)」* — そして`skills.cjs:206`(`if (!a.alive) continue;`)が既
にこれを実装している。**したがってこのルールにはNO CHANGE(変更不要)である。** これは単に
MATTER(意味を持つ)ようになるだけである:現状targetはfireとfireの間でしか死ねないが、明日から
はfireと到達の間でも死ぬことができ、既存の通行可否ルールがそれを正しく自動的に処理する。

rayは次の占有者へと進むか、そのままbounceし続ける。retarget(標的の再選定)も、停止も、不発もし
ない。

### 8.2 Kill-stealing(キル横取り)が現実になる

同じ低HPのtargetに向けて2本のrayが飛行中である場合:先にARRIVE(到達)した方がそれを倒し、2本目
は空になった空間を通過する。現状は両方とも自分自身の`t`で解決されるため、2本目が死んだtargetを見
るのは、その`t`が厳密に後である場合に限られる。**このウィンドウは「2つのeventの間」から「1.13秒
の飛行時間」(§4.1)へと広がる。** 1runあたり36本のray、平均28diagonalという数字を踏まえると、飛
行の重なりは例外ではなく常態である。

### 8.3 Over-kill(オーバーキル)の無駄が現実になる

40ダメージを運ぶrayが3HPのtargetに到達すれば、37が無駄になる。現状も同種の無駄は存在するが、そ
れは1回の解決の内側だけで完結する;明日からは、そのrayはfire時点で60HPだったtargetに対して、
1.13秒前に既に*commit(コミット)*済みだったことになる。**これこそがphysicalなrayの設計意図であ
る** — 不確実性のもとでのcommitmentであり、これによって`every_secs`のcadence(周期)が単なる
DPSの除数ではなく、実質的な意思決定になる。

### 8.4 5回目のbounceによるnovaが自ら照準を変える — 最大の変化

`ray.cjs:56`は`dealHitFn(null, mult(5), { allField: true })`をfireし、これは**walkがbounce 5に
到達した瞬間**の**live**な占有者を列挙する(`skills.cjs:212-220`)。現状その瞬間はfireの瞬間その
ものである。明日からはそれが~28diagonal後、すなわち**約1.13秒後**になる。

**実測(§4.1):36本中17本のrayがここに到達する — 47%、中央値の結果であり、`ray_hit_all`(17件)
は、このrunにおいて直接の`ray_hit`(21件)よりも多くのダメージを運ぶ。** したがって、このcorpus
における支配的なダメージ経路は、「今生きている者」ではなく「~1.1秒後に生きている者」になる。これ
は本REQにおける単一最大の挙動変化であり、§14のrebaselineが全面的なものになる理由である。

### 8.5 Bounce回数のtimingは、もはや瞬時ではなくなる

`bounces`は、今や実時間をかけて増加する。bounce 4にいるrayは、~1秒間飛び続けており、まもなく
novaしようとしているrayである。**これはmonitor(モニター)にとっての好機であり、バランス上の事実
でもある**:+150%のterminatorは、今やray自身の可視のtrajectory(軌道)によってTELEGRAPH(予告)
される。REQ-0262はこれを可視化すべきである;combat_spec §4.5の`telegraph`リード
(`TELEGRAPH_LEAD_SECS = 0.6`)は、今やflightそのものと部分的に重複している。**本REQでは
telegraphには手を触れない** — follow-up(後続の対応)のためにこの重複を書き留めておくにとどめ
る。

### 8.6 変わらないもの

- **rayは決してretargetしない。** rayにはtargetがない — trajectoryがあるだけである。
  combat_spec §4.7は引き続き成立する:*「敵はtargetを選ばない;敵はfireするskillを選び、ray
  geometryが何にhitするかを決める」*。flightはこの裁定を強化するのであって、揺るがすものではな
  い。
- **entry cell(進入セル)の選定は無変更である。** `entry.cjs`の`selectEntryCell`は、現状と全く
  同様に、fire時点で`.../ray`サブストリームから実行される。rayがどこにENTER(進入)するかはfire
  時点の決定であり(frozen)、どこへGO(向かう)かはgeometryである(live)。
- **1つのdiagonal内での同時性。** rayは、到達したdiagonalの中でhitし、penetrateし、splashする。
  時間がかかるのはDIAGONALだけである。diagonal未満の順序はモデル化されておらず、モデル化しては
  ならない。

## 9. combat_specのうちVERBATIM(そのまま)にSURVIVE(存続)するもの — ルールごとに確認

タスクは§2.2/§2.3/§3.2のうちどれがsurviveするかを問うている。**それぞれをファイルと照合して確
認した。geometryのルールは全てsurviveし、1つもsupersede(置き換え)されない。** flightがWHEN
(いつwalkが起きるか)を変えるのであって、HOW(どうwalkするか)は決して変えない。

| combat_spec rule | § | verdict |
|---|---|---|
| 45°のdiagonal、1stepにつき1cell、edgeのentry cellから開始 | §2.2 | **SURVIVEする。** 今や4tickにつき1diagonalとなる。 |
| entry cellおよびedgeごとの固定方向(top→↙/↘、left→↘、right→↙、bottom→↗/↖) | §2.2 | **VERBATIM(そのまま)SURVIVEする。** `geometry.cjs:13-18`の`EDGE_DIRS`は無変更。 |
| penetration = N回の占有セルの通過;通過によってのみ消費される;penetration不可能な最初の対象で停止する | §2.2, OQ5 | **VERBATIM SURVIVEする。** `passed`/`pen`は、loopのローカル変数ではなくrayの状態になる。 |
| **boundary reflection(境界反射)はpenetrationとINDEPENDENT(独立)であり、ALWAYS(常に)適用される** | §2.2, OQ5 | **VERBATIM SURVIVEする。** `ray.cjs:65`(`continue; // reflection does NOT consume pen`)→`passed`を変更しないまま`return`になる。 |
| 破壊された占有者は通行可能である;隙間は壁ではない;反射面はboundaryのみである | §2.2 | **VERBATIM SURVIVEする** — そして§8.1が示す通り、これこそが静かにflightを機能させているルールである。 |
| bounce倍率table 1.0(≤2)/1.5(3)/2.0(4)/2.5(5) | §2.2, §3.2 | **VERBATIM SURVIVEする。** `geometry.cjs:49-54`の`mult(b)`は無変更。 |
| **5回目のbounce:+150%、かつfield上のALL(すべての)占有者にhitし、その後terminate(終了)する** | §2.2, §3.2 | **ルールそのものはVERBATIM SURVIVEするが、そのVICTIM SET(被害者集合)は今やarrival時点で評価される**(§8.4)。ルールの文言自体は変わらない — 「all occupants」は常に「fireした瞬間に生きていた全占有者」を意味していた(`skills.cjs:214` `if (!a.alive) continue;`)。flightが動かすのはその瞬間であって、ルールではない。 |
| detection-mode(検知モード)のPOごとの`bounce_budget`が、globalな5-bounce terminatorをREPLACE(置き換える) | §2.2, §6.1 | **VERBATIM SURVIVEする。** `ray.cjs:46-52`はunchangedのままre-host(再配置)される。 |
| detectionでのhit = FIND(発見);ダメージは無関係;rayを終了させる | §2.2, §6.1 | **VERBATIM SURVIVEする。** |
| 着地時のAOE splash、Chebyshev半径はSHARED-FIELD(共有field)のcellで測る;着地セルの占有者は二重にhitしない | §2.2 OQ6, §3.4 | **VERBATIM SURVIVEする。** `skills.cjs:226-281`の`splashFn`はre-hostされる;splashはlandingのdiagonalでfireする。 |
| determinism/DoS guardとしてのstep budget 512、`ray_abort`をログする | §2.3 | **SURVIVEする**。今やdiagonal単位でカウントされる(§5.1)。 |
| `mult(b)`はblock/HPの前に適用される;blockが先に吸収する | §3.3 | **VERBATIM SURVIVEする。** |
| player→enemyとenemy→playerで、`walk`は同一 | §3.5 | **VERBATIM SURVIVEする。** `IBattleRay`クラスは1つ、mapは2つ。 |
| §3.2の`walk()`疑似コードブロック | §3.2 | **PSEUDOCODE(疑似コード)としてのみSUPERSEDEされる** — その中の全RULEはsurviveし、`advance()`として再表現される(§6.1)。このブロックは更新するが、ルールは変更しない。 |

**§3.6(Monitor / replayイベント)は、死ぬ唯一のセクションである。** §10。

## 10. 新しいreplayイベント

### 10.1 `ray_step`は廃止され、`ray_advance`がそれに置き換わる

combat_spec §3.6、原文まま:

> Each fire emits, in order: `ray_fire` (entry, dir, pen, aoe), **one `ray_step` per straight
> segment (batched cell list)**, a `ray_bounce` per reflection (with `new_dir`, `bounce`),
> `ray_hit` per occupant struck (with `bounce_mult`), `ray_aoe` on splash … This lets the client
> animate the diagonal, the bounces, and the splash **without re-simulating**.

(訳:各fireは、順に以下をemitする:`ray_fire`(entry、dir、pen、aoe)、**直線segmentごとに1つ
の`ray_step`(セルリストをバッチ化したもの)**、反射ごとに1つの`ray_bounce`(`new_dir`、
`bounce`を伴う)、命中した占有者ごとの`ray_hit`(`bounce_mult`を伴う)、splash時の`ray_aoe`……
これによりクライアントは**再シミュレーションすることなく**diagonalの動き、bounce、splashをアニ
メーションできる。)

**SUPERSEDEされる。** バッチ化されたセルリストはpost-hoc(事後的)な経路である — これが存在す
るのは、まさにサーバーが`t`の時点で既にtrajectory全体を知っていたからに他ならない。自分自身の未
来を知らないrayのもとでは、これは存続し得ない。

| event | 現状 | 変更後 |
|---|---|---|
| `ray_fire` | **NOT UNIFORM(不均一) — §10.1a参照。** golden-Aの形は`{t, seq, ev, src, field, entry, dir, pen, aoe}`である;2つのsynthesised(合成)されたsiteは`{t, seq, ev, src, field, mode, entry}`をemitする | **+`ray`**(`IBattleRay.id`)**が3つのemission site全てに付く**。全consumerがこれで相関を取る。 |
| `ray_step` | `{ev:'ray_step', path:[[r,c],...]}` — batchされている | **DELETE(削除)される** |
| — | — | **新規`ray_advance`**:`{t, seq, ev:'ray_advance', ray, cell:[r,c], bounces}` — diagonalごとに1つ、rayがそのcellに到達したtickで発行される |
| `ray_bounce` | `{ev, at, new_dir, bounce}` | **+`ray`**。`t`は今やbounceの実際のtickになる。 |
| `ray_hit` | `{ev, dst, amount, bounce_mult, hp_after}` | **+`ray`**。`t`はarrivalのtickであり、fireのtickではない。 |
| `ray_aoe` / `ray_hit_all` | `{ev, center, radius, hits}` / `{ev, bounce_mult, hits}`。ここで`hits[] = [{dst, amount}]` — **`hp_after`なし** | **+`ray`**。`t` = arrivalのtick。**`hits[]`の全メンバーに`hp_after`が追加される** — REQ-0263 §4.4の引き継ぎ、ACCEPTED(受諾済み)(§10.1b)。 |
| `ray_abort` / `ray_end` | `{ev, reason, steps}` | **+`ray`**。 |

**なぜTICKごとではなくDIAGONALごとに1つのeventなのか。** タスクはこれを「クライアントは
per-tick(tickごと)の位置が必要である」と述べている。正確に言えば:rayの位置は
**`RAY_TICKS_PER_DIAGONAL`tickにつき一度だけ**変化する — 残りの3tickは静止している。tickごとに
emitすれば、同じcellを4回emitすることになる。**diagonalごとの`ray_advance`こそが、rayが実際に動
く解像度でのper-tick位置streamである**。そしてそれはtick単位で正確な`t`を伴うため、クライアント
は推測なしにそれを時計上に配置できる。2つの`ray_advance`eventの間は、クライアントがrAFで補間する
— brief §6、原文まま:*「trail + 25 diagonal-steps/sec、displayが許す限り滑らかに補間する
(rAFであって25Hzのgateではない)」*。サーバーは25Hzで真実をemitし、クライアントは60Hz以上で描
画する。それが正しい分担であり、だからこそ`ray_advance`には`subTick`が不要なのである。

**`ray` idはNEW(新規)であり、non-negotiable(交渉の余地がない)。** 現状`MonitorRenderer.ts:160`
は`this.currentRayField`を追跡している — *「直近のray_fireがtargetにしたfield — ray_hitはここ
からそのsideを読む」*。**これが機能するのは、rayが瞬時であり、それゆえ決してinterleave(交錯)
しないからにすぎない。** flightのもとではN本のrayが同時に空中にあり、それらのeventはinterleave
する;「直近のray_fire」は意味を失い、rendererは誤ったsideにhitを帰属させてしまうことになる。
§11.1。

### 10.1a `ray_fire`にはTHREE(3つ)のemission siteがあり、そのschemaはNOT UNIFORM(不均一)である

本REQの最初のdraftは、`ray_fire`を1つの形を持つ単一のemissionとして扱っていた — golden-Aの形で
ある。**実測すると、実際には3つ存在し、それらは一致しない:**

| # | site(箇所) | emit内容 | `mode`はあるか? | `dir`/`pen`/`aoe`はあるか? |
|---|---|---|---|---|
| 1 | `sim/lib/skills.cjs:195` — `fireSkillRay`、本物のray | `{ev, src, field, entry, dir, pen, aoe}`(`t`/`seq`は呼び出し元`encounter.cjs:616`で刻印される) | **ない** | **ある** |
| 2 | `sim/lib/encounter.cjs:359` — `resolveDetection`、**SYNTHESISED(合成)** | `{t, seq, ev, src, field:'enemy', mode:'detection', entry}` | **ある** | **ない** |
| 3 | `sim/lib/encounter.cjs:378` — `resolveUnlock`、**SYNTHESISED(合成)** | `{t, seq, ev, src, field:'enemy', mode:'unlock', entry}` | **ある** | **ない** |

site 2と3は、いかなるphysicalな意味においてもrayではない。**`walkRay`は一切走らず、geometryも
一切計算されず、trajectoryも存在しない** — attachment(付帯物)は直接解決されており
(`resolveUnlock`はその`unlock/...`streamからinlineでダメージをrollし、対になる`ray_hit`をemit
すらする、`:377-379`)、monitorに描画対象を与えるためだけに`ray_fire`が*事後的にsynthesise(合
成)される*。それらは、simのeventの名前を借りたPRESENTATION(表示用)artifact(人工物)にすぎ
ない。

**本REQが遵守しなければならない帰結。どれもoptionalではない:**

1. **`ray` idは3つのsite全てに刻印される**(§10.1)。`ray`で相関を取るconsumerは、それを持たない
   `ray_fire`に決して遭遇してはならない。さもなければ、`currentRayField`を置き換える
   `Map<rayId, field>`(§11.1)は静かにキーを1つ落とし、sideの帰属を誤る — それこそがこのidの存
   在理由であるバグそのものである。
2. **site 2/3は、ray idをmint(発行)し、同じtickでCLOSE(終了)する。** これらにはflightが存在
   しない:`IBattleRay`が存在しないため、`ray_advance`イベントもbounceもarrivalも存在しない。こ
   のidはcorrelation(相関)用のhandle(取っ手)であって、trajectoryの存在を約束するものではな
   い。**consumerは、`ray_fire`が後続の`ray_advance`を含意すると仮定してはならない。**
3. **site 2/3では`dir`/`pen`/`aoe`はABSENT(存在しない)のであって、ゼロなのではない** — そして
   site 1では`mode`が存在しない。下流のREQ群(0262 ray VFX、0263 HUD、0264 hit VFX)は
   **golden-Aの形だけを根拠に書かれてはならない**:golden-Aは`batch002`のcombat runであり
   attachmentを一切含まないため、**site 1しか通らない**。`{t, seq, ev, src, field, entry}`を除
   く`ray_fire`の全フィールドは、wire上ではOPTIONAL(任意)である。`ev.dir`をguardなしで読む
   rendererは、プレイヤーが最初にchestを開いた瞬間にクラッシュする。
4. **本REQはschemaを統一しない。** site 2/3に本物のrayをemitさせることはcombatの変更である
   (attachmentがphysicalに到達可能かつmiss可能になってしまう);`ray_fire`のemitをやめさせるこ
   とは、それ自体のconsumerを持つwireの変更である。どちらもOut(対象外)である(§15)。**本REQ
   が果たすべき責務は、真実を書き記すことであり**、それは今こうして書き記された。

### 10.1b REQ-0263 §4.4の引き継ぎ事項:**ACCEPTED(受諾)**

REQ-0263 §4.4は、`ray_hit_all.hits[]`と`ray_aoe.hits[]`が`{dst, amount}`を運んでおり、
**`hp_after`を持たない**ことを実測した。一方でこの2つのeventは、**golden-Aにおける全rayダメー
ジの72.2%**(1024.9のうち740.2)を運んでいる。したがって、`hp_after`によって駆動されるHPバーは、
nova — 主砲 — の間はじっと静止したままとなり、次の直接命中の際に飛び跳ねることになる。0263は、
`skills.cjs`に対して1フィールドのためだけに4つ目のREQを開くのではなく、これらのemissionを既に
書き直している本REQにこのフィールドを追加するよう推奨した。

**受諾する。そして本REQがこれを引き受ける。** 理由は0263のものであり、それらは成立している:

- **サーバーは既にその数値を持っている。** `dealHitFn`は直接経路について`hp_after`を計算してい
  る(だからこそ`ray_hit`はそれを運ぶ)。そしてnovaも、同じ経路を通じてそのvictimを列挙しダメー
  ジを与えている(`skills.cjs:212-220`)。その値は攻撃の瞬間には既に存在しているが、単に書き留め
  られていないだけである。**それは同じフィールドが、兄弟にあたるeventに載っていないだけのことで
  ある。**
- **代替案は禁じられている。** 0263が却下したoption (a) — クライアント側で`amount`を積算する —
  は、block、shield、`reduceIncoming`(`skills.cjs:240`)、heal、lifestealを通してHPをTypeScript
  上で再導出することを要求するが、それらは全てサーバーが所有している。`combat_spec §1.2 [LOCKED
  OQ1]`はこれを名指しで禁じている:*「clientはlogをreplayするのみであり、決してre-simulate
  (再シミュレーション)しない」*。
- **そのコストは、本REQが既に費やしているものに比べればnoise(誤差)にすぎない。** 1runあたり約
  34個の追加数値(17回のnova × 約2victim、golden-A)。**eventは1つも追加されない** — 既存の
  array要素に1フィールドが追加されるだけであり、§10.2が既に許容している3.75倍の増加に比べれば
  些細である。
- **断ることの方が高くつく選択である。** 0263は`sim/lib/skills.cjs`とgolden群をblast radius
  (影響範囲)として引き継ぐことになる。すなわち、0256と本REQの後、THIRD(3つ目)のREQが12個の
  goldenを再度動かすことになる — たった1フィールドのために、しかも本REQがどのみち開いている
  ファイルに対してである。それは1行のdiffと引き換えに、3回目のrebaselineを招くことになる。

**帰結。これをわざわざ言葉にする理由そのものでもある:goldenはこのためにも動く。** これは後回し
にされるのではなく、§14.1の単一のrebaselineに組み込まれる。そして§14.1のdiffレビューは
`hits[]`の中に`hp_after`が現れることを見込んでおかなければならない。**これはWIRE(通信)の変更
である**:`hits[]`のメンバーは2フィールドから3フィールドになる。そのconsumerは
`client/src/schedule/monitor/runRoster.ts:56`と`client/src/forecast/pressure.ts`である(§11.7、
§11.8) — どちらも`hits[]`を**読む**だけで、そのメンバーの形をvalidateしていないため、どちらも
フィールド追加を許容する。これは検証済みであり、仮定ではない。

**対称性についての注記。** `ray_hit`(直接命中)は`hp_after`を運んでいる;この変更後は
`ray_hit_all`と`ray_aoe`も、その全メンバーについて同様に運ぶことになる。**これにより、全ての
rayダメージがlogだけからHPに帰属可能になる。** これはREQ-0263が必要としている性質であり、
`combat_spec §1.2`が、logは本来既にそうあるべきだったと示唆している性質でもある。

### 10.2 logは~3.7倍に増大する — MEASURED(実測値)であり、推定ではない

§4.1の`batch002/golden-A`についての実測値より:

| | 現状 | 変更後 |
|---|---|---|
| `ray_step` event数 | **109**(1017 cellを運ぶ) | **0** |
| `ray_advance` event数 | 0 | **1017**(通過したcellごとに1つ) |
| run全体のTOTAL event数 | **330** | **~1238**(330 − 109 + 1017) |

**log全体で~3.75倍の増大;ray位置に関するeventだけを見れば109 → 1017(9.3倍)である。** これは
実際の予算に影響するため、率直に述べておく:

- **Storage(保存領域)。** `run.events`はrunごとに永続化される(`server/services/seals.cjs`が
  これを読む;`shared/dto.ts:505`の`events: ApiRunEvent[]`がクライアントへ運ぶ)。3.7倍のlogは
  3.7倍のrowになる。
- **Wire(通信)。** eventリスト全体がmonitorへ送信される。
- **REQ-0240のpacing pass**は全eventをiterate(反復処理)する(`detectCoalesceGroups`、
  `pacing.cjs:62-89`) — これは既にserveごとに実行されているpassにおいて、3.7倍の作業量になる。

**本REQはこれを最適化しない。** また、`ray_advance`を静かにバッチへ圧縮し直すようなこともしては
ならない — それは`ray_step`を再発明することになり、ユーザーが求めたper-tickのtimingを失わせて
しまう。しかしこの数値は、事後的なインシデントとしてではなく、作業が始まる**前**にユーザーの目の
前に置かれるべきものである。もしこれが受け入れがたいのであれば、正直なlever(手段)は
`RAY_TICKS_PER_DIAGONAL`である(rayを遅くすればsecondあたりのevent数は減るが、cellあたりのevent
数は変わらない)、あるいはstorageの真実性を保ったままSERVE(配信)境界でlogを削減するfollow-up
REQである。

## 11. Ray eventのconsumer — その全てと、その影響

`req-0240-monitor-redesign-pacing`(monitorを所有するbranchであり、REQ-0255がこれをmergeする)全
体に対して`ray_step|ray_bounce|ray_fire|ray_hit_all|ray_aoe|ray_abort|ray_end`をgrepした。
**これがCOMPLETE(完全)なリストである:**

### 11.1 `client/src/schedule/MonitorRenderer.ts` — small monitor(小型モニター)

| line | 現状 | 影響 |
|---|---|---|
| `:34` | `const STEP_ANIM_MS = 200; // per ray_step segment` | **DELETE(削除)。** flight timeは今や物理的なものであり、segmentごとに200msというアニメーション定数は、まさに本REQが置き換える対象の演出そのものである。 |
| `:716-722` | `case 'ray_step': { const path = ...; this.animateStep(path, ...); }` | `case 'ray_advance'`に**REPLACE(置き換え)** — rayのmarkerを`ev.cell`へ移動させる。rendererはアニメーションのタイムラインをOWN(所有)することをやめ、それをFOLLOW(追従)するようになる。 |
| `:160` | `currentRayField` — *"直近のray_fireがtargetにしたfield"* | interleaveするflightのもとでは**BREAK(破綻)する**。`ray_fire`で登録され、`ray`タグ付きの全eventから読まれる`Map<rayId, field>`に置き換える。§10.1。 |
| `:704-710` | `case 'ray_fire'` → `getOrCreateEnemyMarker(entry, ...)` | **+ ray idをregister(登録)する。** |
| `:723-727` | `case 'ray_bounce'` → `flashCell(at)` | 無変更(今や実際のbounce tickで発生する)。 |
| `:746-755` | `case 'ray_hit_all'` → `pulseCell('N9')` | 無変更。ただしそこにあるコメントを参照:*「現状、この2種類のeventには特定のcellが運ばれていない」*。これは今も真である。 |

### 11.2 `server/services/pacing.cjs` — REQ-0240のpresentation pacing(表示ペーシング)

| line | 現状 | 影響 |
|---|---|---|
| `:44-51` | `gapAfterMs(cls, ev)`: `if (cls === 'ray_step') { const cells = ev.path.length; return clamp(rs.perCellMs * cells, rs.minMs, rs.maxMs); }` | `ray_step`が死ぬ瞬間に**DEAD CODE(死んだコード)**になる。`rayStep`のspecial-case(特殊処理)全体は、バッチ化されたpathを、見えるのに十分な時間だけ画面上に保持するために存在している。 |
| `shared/pacing.json` | `"rayStep": {"perCellMs": 90, "minMs": 360, "maxMs": 900}`, `minGapMs.ray_step: 0`, `gapAfterMs.ray_step: 90` | **`rayStep`ブロック + `ray_step`関連の2エントリーはretire(廃止)する。** `ray_advance`用のエントリーが必要になる。 |
| `:33-37` | `classOf(ev)` → 未知のtokenは`default`にfall throughする | **これが我々を救う。** そのコメント:*「新しいevent typeはray_hitと同様に間隔を空けられ、決してdropされない — forward-compatible(将来互換)である」*。したがって、何も明記されなければ`ray_advance`は`default`(200ms)を受け取ることになる — **これは破滅的である**(1017 event × 200ms = 203秒のpacing)。**`minGapMs.ray_advance: 0`と`gapAfterMs.ray_advance: 0`は必ず明記されなければならない。** forward-compatibleなデフォルト値は、9倍の量のもとでは正しいデフォルト値ではない。 |

**brief §3 C4によれば、これは見た目ほど重要ではない。そして本REQはその理由を述べなければならな
い:**

> **#/expedition plays the sim clock 1:1 (realtime, tick-accurate).** The pacing layer stays alive
> ONLY for the legacy small monitor on #/schedule. `pacingVersion` remains on the wire; the
> expedition view ignores `pt` and reads `t`. No deletion of pacing.cjs in this program.

(訳:**#/expeditionはsimのclockを1:1で再生する(realtime、tick-accurate=tick単位で正確)。**
pacing層が生き残るのはlegacy(旧来)のsmall monitor、#/scheduleのためだけである。
`pacingVersion`はwire上に残る;expedition viewは`pt`を無視し、`t`を読む。本プログラムにおいて
pacing.cjsの削除はない。)

つまり:**`#/expedition`は`pt`を完全に無視する** — rayのtimingとはすなわちその`t`であり、それ
を引き伸ばせばrayとそれ自身のhitとの同期が崩れてしまう(これこそがC4が存在する理由の全てであ
る)。**pacingが生き残るのは`#/schedule`のsmall monitorのためだけであり**、そこでは3.7倍密度の
高いlogから、見るに堪えるtimelineを引き続き生成しなければならない。上記の`ray_advance`のエント
リーこそが、その画面を正直に保つものである。`pacing.cjs`はDELETE(削除)されず、bypassもされず、
拡張もされない — 1つのevent tokenのためにre-tune(再調整)されるだけである。

### 11.3 `server/lib/humanize.cjs`

`:14-15`:`case 'ray_step': return 't=' + t + 's ray travels through ' + ev.path.length + ' cell(s)';`
→ **`ray_advance`にretarget(向け直す)。** これはgolden-Aについて1017行を出力することになる点
に注意;humanizeはdebug用の画面であるため、同じ`ray`についての連続する`ray_advance`を1行に
collapse(圧縮)するか、その量をそのまま受け入れるかのどちらかを選ぶ。collapseする方を推奨する
— これはHUMAN(人間向け)の画面であり、wireにとって誤りであるバッチ化も、散文にとっては正しい
からである。

### 11.4 `client/src/schedule/fieldGeometry.ts`

`:23-27`は、*「ray_fireの`entry`、ray_bounceの`at`、ray_stepの`path[]`エントリー」*についての
raw-tuple(生タプル)契約を文書化している。**ドキュメント + 型の更新**:`ray_advance`の`cell`も、
同じ生の`[row, col]`のNUMBER TUPLE(数値タプル)である。契約自体は無変更であり、フィールド名だけ
が移る。

### 11.5 `client/src/schedule/chimes/chimeMapping.ts`

`:199-205`は、pulseの`ray_fire`/`ray_step`のonset(開始)が*「静かなままである」*と説明してい
る。**挙動の変更はない** — もはや存在しないsilentなeventは、それでもsilentである。コメントは更
新し、コードには触れない。`:246-261`(`ray_bounce`のpercussion(打楽器音)、5回目のbounceでの
cymbal抑制)は影響を受けない。

### 11.6 `sim/tests/forecast_parity.cjs` — structuralな破綻

**これはbriefが誤っている箇所であり、rebaselineでは済まない。** 18テストのうち3件が、rayのcell
経路を**`ray_step`イベントのバッチから**再構成している:

```
:113-118   // Reassemble the traversed cells from the ray_step batches. flushSteps() ...
           if (ev.ev === 'ray_step') for (const c of ev.path) cells.push([c[0], c[1]]);
:261       T('walkRayPath == sim walkRay: byte-equal cell path, landing, bounces, abort (full corpus)')
:299       T('walkRayPath == sim walkRay: bounce multiplier in force at each entered cell')
:323       else if (ev.ev === 'ray_step') for (const c of ev.path) expected.push([c[0], c[1], combat.mult(b)]);
:336       T('walkRayPath == sim walkRay: AOE splash centre / radius / multiplier')
```

`ray_step`を削除すれば、これらは**空配列**と比較することになる。有用なメッセージを伴って派手に
失敗するわけではない;何もないものとのbyte単位の一致比較として失敗する — あるいはもっと悪いこと
に、corpusのcoverageカウンタが他所で満たされていれば、vacuously(空虚に)passしてしまう可能性す
らある。

**修正方法は§6の`walkRayPath`リファクタリングであり、これを強制するのがこのテストである。**
parityテストの向き先を、eventストリームではなくPUREなpath関数(`walkRayPath`)に変える。これは
現状より厳密に優れている:現状のテストはsimのgeometryを*replay artifact(リプレイの副産物)*経由
で読んでいるが、変更後は2つのpath関数を直接比較する。forecastオーバーレイはsnapshot predictor
(スナップショット予測器)であり、正しさは保たれる — それが答えるのは「今の盤面に対してrayを撃て
ばどこへ行くか」であり、これはまさに`walkRayPath`が計算するものである。

**また、新しい定数群が万一`shared/`に入り込む場合は、それらもpin(固定)すること。** `shared/`
は`shared/`の外部を`require()`できない(`shared/content_validate.cjs:432-435`;
`forecast_parity.cjs`のヘッダー)。forecastが予測するのはTIMING(タイミング)ではなくGEOMETRY
(幾何)であるため、`RAY_TICKS_PER_DIAGONAL`はそこに現れる必要はないはずである — **4つ目のコピー
を追加しないこと。** 将来のオーバーレイがflight timeを必要とするなら、`RAY_STEP_BUDGET`が
`:188`でpinされているのと同じやり方でpinすべきであり、それ以外の方法をとってはならない。

### 11.7 `client/src/forecast/pressure.ts`

`:136`は、pressure folding(圧力の折り込み)についてのコメントの中でall-field terminator
(`ray_hit_all`)に言及している。**変更なし** — pressureは`walkRayPath`のgeometryに対する
snapshot forecastであり(§11.6)、§8.4が変えるのはnovaがvictimを選ぶWHEN(いつ)であって、そこ
に至るgeometryではない。

### 11.8 `client/src/schedule/monitor/runRoster.ts`と`monitor/feedCopy.ts`

`runRoster.ts:56`は`ev.field === 'enemy'`とともに`ray_aoe`/`ray_hit_all`の`hits[]`を読む;
`feedCopy.ts:65-66`はそれらを表示する。**変更なし** — どちらも存続する;どちらも`ray`フィール
ドを得るが、無視しても構わない。

## 12. REQ-0256のwithin-tick(tick内)順序との相互作用

REQ-0256 §10.1は、tick内のtotal orderを次のように定めている:**player map、その後enemy map;
instanceはstable(安定した)indexで;slotはslot indexで。** rayにも、この中に定義された位置が
必要である。

### 12.1 裁定:instanceがFIRST(先)にfireし、その後にrayがadvanceする

```
within one tick:
  1. status cadence      (every STATUS_TICK_TICKS ticks, REQ-0256 s7.2)
  2. ALL instance fires  (player map, then enemy map -- REQ-0256 s10.1)
       -- a fire CREATES an IBattleRay at its entry cell, subTick = 0
  3. ALL ray advances    (player map's rays, then enemy map's rays)
       -- each ray: subTick++; if subTick === RAY_TICKS_PER_DIAGONAL { subTick = 0; advance() }
  4. pulse arrivals scheduled for this tick
  5. termination check
```

**WHO CALLS WHAT(誰が何を呼ぶか) — このchainを所有するREQ-0256 §7.0/§7.1aと整合させる。** 本
REQの最初のdraftは、上記5stepを*「`IBattleInstancesFormationMap.tick()`の契約」*と呼んでいた。
**それは誤りだった**:単一のmapの`tick()`が、step 1、4、5をown(所有)することはできない(これ
らはencounterレベルのものである)。また単一のmapの`tick()`が、step 2と3を表現することもできな
い(これらはそれぞれ両方のmapにまたがる)。この5stepは**tickレベルの契約**であり、3者に分割し
て所有される:

| step | 所有者 | 呼び出し元 |
|---|---|---|
| 1. status cadence | `runEncounter`のloop本体 | REQ-0256 §7.1 |
| **2. 全instanceのfire** | **`Battle.tick()`のphase A** -> `playerMap.tickInstances()`、その後`enemyMap.tickInstances()` -> `instance.tick()` | REQ-0256 §7.1a |
| **3. 全rayのadvance** | **`Battle.tick()`のphase B** -> `playerMap.tickRays()`、その後`enemyMap.tickRays()` | **本REQ**が`tickRays()`を実装する;0256はこれをno-opとしてstub(仮実装)する |
| 4. pulse arrivals | `runEncounter`のloop本体 | REQ-0256 §7.1 |
| 5. termination | `runEncounter`のloop本体 | REQ-0256 §7.1 |

したがって`battle.tick()`が担うのはstep 2-3のみであり、それ以外は担わない。そして仕様(c)が求
めるcascade — Battle -> map -> instance — は無傷のまま保たれる。

**brief §4の`tick() // forwards tick to instances, then advances rays`は、
`tickInstances(); tickRays()`という合成として尊重されるが、`Battle`はこの2つのphaseを別々に呼
び、そうしなければならない。** brief §4は1つのmapに対して`tick()`を書いたが、実際にはmapが2つ
ある。map単位で合成すると、`playerInstances, playerRays, enemyInstances, enemyRays`という順序
で実行されることになる — これは上記の順序では**ない**。rayは、それがfireされたONTO(向けて)先
のmap上に存在するため(§6)、そのmap単位の順序では、player発のrayはその誕生tickでadvanceされる
(`enemyMap`はまだtickしていない)が、enemy発のrayはそうならない(`playerMap`は既にtick済みであ
る):**player側のrayはenemy側のrayより1tick早く到達することになり、それを決めるのはmap順序以
外の何物でもない** — これは§12.2が却下するbirth-order(誕生順)結合であり、REQ-0256 §10.2が
既に許容しているplayer-firstバイアスの上にさらに積み重なることになる。phase分割はこれを取り除
く:**どちら側のrayも、fireから最初のdiagonalまで、例外なく`RAY_TICKS_PER_DIAGONAL`tickを要す
る。**

これはbrief §4に対する、意図的かつユーザーに見える形でのrefinement(洗練)である。**これは
REQ-0256(§7.1aおよびそのStatusブロック)、REQ-0258(§9)、そしてここで、全く同じ形でflagされて
いる — 三者は同じことを言っており、もしユーザーがこれをvetoすれば、三者とも一緒に変わる。** そ
のとき失われるのが、§12.2が保証するfire-to-first-diagonal(fireから最初のdiagonalまで)の均一
性である。

### 12.2 なぜfireがadvanceに先行するのか — その正当化

- **このtickでfireされたrayは、このtickでは動かない。** それはstep 2で`subTick = 0`として生成
  され、step 3はそれを1に増やすが、これはまだ`RAY_TICKS_PER_DIAGONAL`には達していない。したが
  ってその最初のdiagonalはfireの4tick後に到達する — fireから最初のcellまで、きれいで均一な
  0.04秒であり、誕生時に1diagonalぶんテレポートしてしまうようなoff-by-oneは存在しない。step 2
  で生成されたrayは、step 3がiterateするlistに必ずappendされなければならず、step 3はそのappend
  を許容しなければならない(step 2の後に取られたlistのsnapshotをiterateするのであって、liveな
  配列をmutateしながらiterateするのではない)。
- **これは既存のbiasと一致する。** 現状、fireとその解決全体は1つの瞬間に起こる。すなわちfireは
  あらゆる結果に厳密に先行する。fireの後にadvanceという順序は、「tick内では原因が結果に先行す
  る」という性質を保つ。
- **代替案はより悪い。** fireより前にrayをadvanceさせてしまうと、tick kでfireされたrayがtick k
  のstep-3でadvanceされるかどうかが、list順序がたまたまそれを拾うかどうかに左右されてしまう —
  これはbirth-order依存であり、REQ-0256 §10.2が却下しているincidental coupling(偶発的な結合)
  そのものの類型である。

### 12.3 enemy map側のrayより先にplayer map側のray — その微妙さ

rayは、それがfireされたONTO(向けて)先のmap上に存在する(§6)。したがって、**「player map側の
ray」とは、player達に向かって飛行中のENEMY側のrayのことである。** ゆえにplayer map側のrayを先
にadvanceさせるということは、tick内でplayer側の攻撃より先にenemy側の攻撃が着弾することを意味す
る — **これはREQ-0256 §10.1のplayer-firstなinstance順序とは正反対である。**

**これは矛盾ではなく、2つの異なるものについての2つの異なる順序付けである**。これは書き留めてお
かなければならない。さもなければ、誰かがこれを「修正」してバグにしてしまうだろう:

- **instanceの順序はplayer-firstである**(REQ-0256 §10.1):相討ちのtickでは、playerの*fire*が
  先に行われる。
- **rayの順序はplayer-map-firstである**、すなわちenemyの*arrival(到達)*が先になる:相互到達
  のtickでは、enemy側のrayが先に着弾する。

この2つのbiasは互いに逆方向を向いており、そのためおおむね相殺する。これが誠実な帰結である。代
替案 — 両方をplayerに有利にすること — は、tickごとに体系的な優位を二重に積み重ねてしまうことに
なる。**裁定:rayはMAP identity(map識別子)で順序付ける(player map、その後enemy map)。理由
はREQ-0256がinstanceをmapで順序付けているのと同じである:それがstable(安定的)で、宣言的で、
data-independent(データに依存しない)キーだからである。** rayをowner side(所有者側)で順序付
けてはならない。それはこの結合を再導入してしまう。

## 13. Blast radius(影響範囲) — MEASURED(実測済み)

全ての数値は、spec作成時点の`req-expedition-spec` @ `f918a65`(merge前のbaseline)で測定した。
**REQ-0256の後は、これらの値ではなく0256が残す値になる** — 0257はrebaselineの前に、自分自身の
baseに対して再測定しなければならず、両REQのdiffは別々に読まれなければならない(REQ-0256の
§12.3)。

| gate | command | 現在の実測値 | 本REQ後 |
|---|---|---|---|
| sim unit tests | `node sim/tests/run.cjs` | **117 passed, 0 failed** | **MOVEする(変化する)** — §13.1 |
| sim replay goldens | `node sim/tests/goldens.cjs` | **`goldens OK (12 cases)`** | **12件全てをSECOND TIME(2度目)のREBASELINE**(§14.1) |
| forecast parity | `node sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** | **3テストがSTRUCTURALLY(構造的に)BREAKする**(§11.6) — rebaselineでは済まない |
| S4 post-processor | `node sim/tests/s4_test.cjs` | **14 passed, 0 failed** | green(合格);S4のBASELINEが動く(§14.3) |
| REQ-0203 grave-legion | `node sim/tests/req0203_grave_legion_test.cjs` | **15 passed, 0 failed** | greenになる見込み |
| REQ-0207 wildlands | `node sim/tests/req0207_wildlands_test.cjs` | **13 passed, 0 failed** | greenになる見込み |
| REQ-0219 deepstone | `node sim/tests/req0219_deepstone_test.cjs` | **13 passed, 0 failed** | greenになる見込み |
| REQ-0200 unit charge | `node sim/tests/unit_charge_test.cjs` | **13 passed, 0 failed** | green(rayとの結合なし) |
| REQ-0200 charge fusion | `node sim/tests/unit_charge_encounter_test.cjs` | **23 passed, 0 failed** | **MOVEする** — `chargeOps.strikeFromBp`/`fireItems`(`encounter.cjs:50-81`)は本物のrayをfireしており、それは今や時間を要するようになる |
| api determinism | `node server/tests/api_test.cjs` | **bareなworktreeではRUNNABLE(実行可能)ではない** | REQ-0256 §12.3 |

### 13.1 `sim/tests/run.cjs` — 9件のwalkRayテスト

9件のテストが`combat.walkRay`をDIRECTLY(直接)呼んでいる(`:220, :253, :270, :289, :302, :322`
+ AOEテスト):`'ray geometry: entry projection+jitter…'`、`'…penetration exhaustion…'`、
`'…boundary reflection…'`、`'…bounce damage scaling exactness…'`、
`'…5-bounce all-hit-then-terminate…'`、`'…detection-mode per-PO bounce-budget stop…'`、
`'…destroyed-BP passthrough…'`、`'…gap passthrough…'`、`'AOE: Chebyshev radius correctness…'`。

**朗報であり、実測済み:`run.cjs`には`ray_step`への参照がZERO(ゼロ)件である。** これらのテス
トは`result.landing` / `result.bounces` / `result.aborted`を読んでおり、eventストリームは読ん
でいない。**したがってこれらは`walkRayPath`(§6)へきれいにretargetでき、現状と全く同じものをテ
ストし続けることができる。** これらは「geometryが変わっていないこと」のためのregression net
(回帰防止網)であり、§16.4はこれらに依拠している。9件全てを維持すること;flightのテストへと書
き換えてはならない。flightにはflight自身のテストを別途用意する。

### 13.2 CONTENT_ROOT — 継承するものであり、再導出するものではない

REQ-0255 §7.1とREQ-0256 §12.3がこれを実測済みである。merge後は、この分割された呼び出し方が必
須になる:

```
CONTENT_ROOT=$PWD/content node sim/tests/run.cjs     # and forecast_parity, s4_test, roster tests
node sim/tests/goldens.cjs                           # NO CONTENT_ROOT -- it pins its own roster (goldens.cjs:51-59)
```

## 14. Rebaseline(再ベースライン化)の手順

### 14.1 12個のリプレイgolden

```
node sim/tests/goldens.cjs          # CONFIRM RED first -- 12 DRIFT lines
node sim/tests/goldens.cjs gen
git diff sim/tests/goldens/replay_hashes.json
```

**12個全ての`jsonl_sha256`が動くことを見込んでおく。9件のdungenケースについて`def_sha256`は
MUST NOT(決して)動いてはならない** — generatorは無変更である。もし1つでも動いたら、STOP(停
止)すること。

**`hits[]`内の`hp_after`もhashを動かすが、eventはZERO(ゼロ)件しか追加しない**(§10.1b)。diff
の中にこれを見込んでおくこと:`ray_hit_all.hits[]` / `ray_aoe.hits[]`の全メンバーが3つ目のフィ
ールドを得る。これは以下の`events`算術には**影響しない** — もし`events`件数が、この式で説明で
きない理由で動いた場合、`hp_after`は犯人ではなく、何か他の原因である。

**`events`件数は~3.7倍に跳ね上がる**(§10.2:golden-Aは330 → ~1238)。**これが利用可能な中で単
一最良のsanity check(健全性チェック)である** — golden fileの中で人間が読める唯一の数値だから
である。ケースごとに、§10.2の算術に対してこれを検証すること:

```
events_after ≈ events_before − ray_step_count + total_cells_traversed
```

もしあるケースの増加量がこの式から大きく外れていたら、rayは以前と同じgeometryを歩いていないと
いうことである。

**再生成する前に、そのdiffがflightによるものであることを証明すること。** `batch002/golden-A`
のJSONLを前後でdumpする:

1. 全ての`t`が引き続き`TICK_SECS`の倍数であること(REQ-0256の不変条件が成立していなければなら
   ない)。
2. **`ray_hit`の`t`が、そのray_fireの`t`よりSTRICTLY GREATER(厳密に大きい)ことを確認する** —
   新しい`ray` idで相関を取る。これがflightがphysicalであることの1行での証明である。現状は両者
   はEQUAL(等しい);もし依然として等しいなら、本REQは何も達成していないことになる。
3. そのgapは、およそ`diagonals_travelled × RAY_TICKS_PER_DIAGONAL × TICK_SECS`に等しいはずであ
   る。ray1本を手計算でspot-checkすること。
4. `ev`tokenのSET(集合)は、正確に1つの形でのみ変化する:`ray_step`が消え、`ray_advance`が現れ
   る。それ以外の出現・消失は全てバグである。
5. `ray_hit_all`の件数は動く(§8.4 — novaが1.13秒後にvictimを選ぶようになったため、以前は生き
   ているpackにnovaしていたrayの一部が、今や一掃済みのpackにnovaするようになる)。**これを見込
   み、読み解くこと**;これが挙動変化の目玉である。

### 14.2 forecast parity — UPDATE(更新)する。rebaselineはしない

**再生成すべきものは何もない**(REQ-0256 §12.2がその理由を説明している:これはhashを保存せ
ず、`gen`モードも持たないassertion suiteである)。3件のテストは、`ray_step`をscrapeする代わり
に`walkRayPath`を呼ぶようREWRITE(書き直)されなければならない(§11.6)。目標:**18 passed, 0
failed** — 同じ18件のままである。もし件数が減っていれば、テストがretargetされたのではなく削除
されたということであり、parity gateは静かに狭められてしまったことになる。

### 14.3 S4

REQ-0256 §13.3と同様。`sim/s4_matrices/default.golden.sha256`はre-hash(再ハッシュ化)される;
`sim/s4_baselines/default/`は再生成される。**`sim/s4_thresholds.json`は手で書かれたdesign
intent(設計意図)であり、これを再生成してはならない。**

**本REQが特に関係するS4項目が1つある。** combat_spec §10は、S4のmeasure(測定項目)として次を
挙げている:

> **Ray sanity (new):** distribution of bounce counts and 5th-bounce all-field triggers; flag
> skills that near-always reach the +150% all-field terminator (a balance smell).

(訳:**Ray sanity(新規):** bounce回数の分布、および5回目のbounceでのall-field発動の分布;
+150%のall-field terminatorにほぼ常に到達するskillにflagを立てる(バランス上の懸念)。)

§4.1は、batch-002において**rayの47%がterminatorに到達する**ことを実測した — 仕様が求めていた
このgateは、本REQ以前の現行contentに対して既に発動する状態にあったということである。flightはこ
の数値を動かすことになる(一掃済みのfieldに到達したnovaは自らを無駄にする)。**この前後の分布を
findingとしてユーザーに報告すること。** 何もtuneしないこと:本REQはmechanism(仕組み)の変更で
あり、その中でre-balancing(再調整)を行えばgolden diffが読めなくなってしまう — これはREQ-0184
のport noteが定め、REQ-0258 §10が従っている、それと同じ流儀である。

## 15. Scope(範囲)

**In(対象):**
1. `sim/lib/core.cjs` — `RAY_TICKS_PER_DIAGONAL: 4`というTUNABLE(§5);`RAY_STEP_BUDGET`の単位
   についての注記(§5.1)。
2. `sim/lib/ray.cjs` — `walkRayPath()`(pureなgeometry、snapshot)+ `IBattleRay`(liveなentity、
   `advance()`)に分割する(§6)。`pathBatch`/`flushSteps`は削除する。死んだパラメータ
   `isDestroyedPassable`は除去する(§3)。
3. `sim/lib/skills.cjs` — `fireSkillRay`はwalkする代わりに`IBattleRay`をCREATE(生成)して
   returnする;`dealHitFn`/`splashFn`/`liveOccupantFn`は、rayに紐づくcallbackになる(§6.1)。
   **`ray_hit_all.hits[]`と`ray_aoe.hits[]`の全メンバーに`hp_after`を追加**(§10.1b —
   REQ-0263 §4.4の引き継ぎ、受諾済み)。**`:195`に`ray` idを追加**(§10.1a site 1)。
4. `sim/lib/formation_map.cjs` — `rays[]` + **`tickRays()`**(§12.1)。REQ-0256のno-op stubを置
   き換える。REQ-0258がこのfileを宣言し、REQ-0256が`tickInstances()`/`tick()`を実装し、本REQが
   `tickRays()`を実装する。3つのREQ、1つのfile、3つの互いに素な部分 — そして§12.1の表がその
   継ぎ目である。
4b. `sim/lib/encounter.cjs:359` + `:378` — **2つのSYNTHESISED(合成)された`ray_fire`に`ray`
   idを刻印する**(§10.1a)。同じtickでmint(発行)されCLOSE(終了)する:`IBattleRay`もflight
   も`ray_advance`もない。
5. `sim/lib/encounter.cjs` — fireはもはやinlineで解決されない;`landedHits`
   (`:625, :643, :653, :703, :715`)はARRIVAL(到達)時点でdeliver(配送)されるため、
   REQ-0078/0095/0200のreactive dispatch(反応的な配送処理)は、rayのhit callbackへと移動する。
   **これは本REQの中で最大の、一見しては分かりにくい変更である** — `fr.landedHits`の全consumer
   は、`fireSkillRay`がreturnした時点でrayが既に解決済みであると想定していた。もはやそうではな
   い。
6. `shared/pacing.json` — `ray_advance`エントリーを0/0に;`rayStep`ブロック + `ray_step`エント
   リーを廃止する(§11.2)。
7. `server/services/pacing.cjs` — `:44-51`の`ray_step`special-caseを削除する(§11.2)。
8. `server/lib/humanize.cjs` — `:14`をretargetし、collapsing(圧縮)を行う(§11.3)。
9. `client/src/schedule/MonitorRenderer.ts` — `STEP_ANIM_MS`を削除;`ray_step`→`ray_advance`;
   `currentRayField`→`Map<rayId, field>`(§11.1)。
10. `client/src/schedule/fieldGeometry.ts` — tuple契約のドキュメント + 型(§11.4)。
11. `sim/tests/forecast_parity.cjs` — 3件のテストを`walkRayPath`へretarget(§11.6、§14.2)。
12. `sim/tests/run.cjs` — 9件のwalkRayテストを`walkRayPath`へretarget(§13.1);flight用の新規テ
    スト(§16)。
13. §14に従ったrebaseline。
14. `docs/llm_managed/combat_spec_draft.md` — §3.2の疑似コードを再表現する;§3.6を書き直す
    (§10.1);§2.2/§2.3のルールは**無変更**(§9)。

**Out(対象外):**
- **tickループ。** REQ-0256。
- **Mode/verb gating(モード・動詞ゲーティング)。** REQ-0259。本REQは`ray.mode`をfreezeする
  (§7.1);それに対してgateするのは0259である。
- **Ray VFX / trail(軌跡)。** REQ-0262が§10のeventを消費する。
- **47%のnova発生率をre-balancing(再調整)すること**(§4.1、§14.3)。これはfinding(所見)で
  あり、fix(修正)ではない。
- **telegraphに手を触れること**(§8.5)。flightは`TELEGRAPH_LEAD_SECS`と部分的に重複している;
  それを書き留めるにとどめ、対応はしない。
- **3.7倍のlogを最適化すること**(§10.2)。数値を可視化するにとどめ、再バッチ化はしない。
- **`ray_fire`の3つのschemaを統一すること**(§10.1a)。synthesisedされたdetection/unlockの
  siteに本物のrayをemitさせることはcombatの変更である(attachmentがphysicalに到達可能かつmiss
  可能になってしまう);`ray_fire`のemitをやめさせることは、それ自体のconsumerを持つwireの変
  更である。本REQは3箇所全てに`ray` idを刻印し、その形を書き記す。統一はfollow-upが行ってもよ
  い。
- **`sim/s4_thresholds.json`**(§14.3)。
- **`docs/user_managed/*`を編集すること。** 禁止。ここにはそれを必要とするものは何もない:
  `backpack_battle_spec.md`の`attack_line`セクションはGEOMETRYを記述しており、§9は全ての
  geometryルールがVERBATIMにsurviveすることを確認済みである。**出荷前にこの主張を検証するこ
  と** — もし§9のいずれかのverdictがSURVIVESから外れていれば、golden docが関与することになり、
  本REQは停止してユーザーに確認しなければならない。
- **e2eのharness(試験装置)。** 本プログラムのgateではない(Q2)。decade
  **7570 / 7571 / 7572**(`5000 + 257*10 + {0,1,2}`)は、numberingにより予約済みだが未使用のまま
  とする。

## 16. Acceptance criteria(受け入れ基準)

1. `1 / (TUNABLES.RAY_TICKS_PER_DIAGONAL * TUNABLES.TICK_SECS) === 25` — ユーザーが指定したRATE
   (割合)がassertされる(§5)。`TICK_SECS`だけを動かすとこのテストは失敗する。
2. **`ray_hit`の`t`が、その`ray_fire`の`t`より厳密に大きいこと**。実際のrunにおいて`ray` idで
   相関を取る。これが本REQを1つのassertionに凝縮したものである(§14.1のstep 2)。
3. fire→hitのgapが、手計算されたtrajectoryを持つfixtureのrayについて、正確に
   `diagonals × RAY_TICKS_PER_DIAGONAL × TICK_SECS`に等しいこと。
4. **`walkRayPath()`と`IBattleRay.advance()`が、同一の(frozenな)occupancyのもとでIDENTICAL
   (同一)なgeometryを生成すること** — cellの並び、landing、bounces、abort。
   `forecast_parity.cjs`の既存fixture corpusに対してassertされる。**もしこれらが乖離すれば、
   forecastはプレイヤーに嘘をつくことになる**(§6、§11.6)。
5. `ray_step`はどこにも現れないこと:`grep -rn "ray_step"`は`docs/`の外ではゼロ件になる。
   `ray_advance`はtick単位で正確な`t`と`ray` idを運ぶこと。
6. 全てのray eventが`ray`を運ぶこと;monitorはこれで相関を取り、「直近のray_fire」では決して
   相関を取らないこと(§11.1)。反対側のmapで2本のrayが交錯しながら飛行中であるテストによって証
   明される — これは現状では表現不可能なケースである。
7. **FREEZEが両半分について証明されること**(§7):ownerのダメージが飛行中にbuffされるfixture
   では、ORIGINAL(元)のダメージのまま着弾すること;TARGETが飛行中にWeaknessを得るfixtureで
   は、REDUCED(軽減された)ダメージで着弾すること。両方とも証明されなければ、このルールは半分
   しか実装されていないことになる。
8. **飛行中にtargetが死んだrayはそのまま飛び続け**、次の占有者にhitすること(§8.1) — 論証で
   はなくfixtureによって示すこと。
9. 5-bounce novaがvictimを**arrival時点**で列挙し、fire時点では列挙しないこと(§8.4) — 飛行
   中に敵が死に、`ray_hit_all.hits`から漏れているfixtureによって示すこと。
10. `sim/tests/goldens.cjs`が12件でgreenであること。§14.1に従ってrebaselineされ、9件全ての
    dungenケースで`def_sha256`が**unmoved(不変)**であり、各ケースの`events`増加が§14.1の式と
    一致すること。
11. `sim/tests/forecast_parity.cjs`が**18 passed, 0 failed**であること — retargetされた同じ
    18件であり、狭められていないこと(§14.2)。
12. `sim/tests/run.cjs`がgreenであること;その9件のgeometryテストが`walkRayPath`へretargetさ
    れ、**同じルールをテストし続けている**こと(§13.1)。
13. §9の全verdictが実装に対して再検証されること。VERBATIMにsurviveしなかったルールが1つでもあ
    れば、本REQは停止しユーザーに委ねられる — `docs/user_managed/backpack_battle_spec.md`はこの
    geometryを記述しており、LLMはこれを改訂できない。
14. `shared/pacing.json`が`ray_advance: 0/0`を持つこと;3.7倍のlog増大(§10.2)が、golden単位
    での実測された前後の`events`件数とともに、merge前にユーザーへ提示されること。
15. **`ray` idが3つの`ray_fire` site全てに刻印されること**(§10.1a):`skills.cjs:195`、
    `encounter.cjs:359`、`encounter.cjs:378`。**attachmentを伴う**runによってassertされること
    — golden-Aはattachmentを持たない`batch002`のcombat runであり、site 1しか通らないため、こ
    れを証明することが**できない**。chest/trapを含むdungenケース
    (`dungen/default/L{1,3,5,8}`)を使い、log中の全ての`ray_fire`が`ray`を持つことをassertす
    ること。
16. **不均一なschemaが尊重され、それによってクラッシュしないこと**(§10.1a):consumerテスト
    が、synthesisedされた`ray_fire`(`mode`はあるが`dir`/`pen`/`aoe`はABSENT)を
    `MonitorRenderer`に流し込んでもthrowしないこと。後続の`ray_advance`を伴わない`ray_fire`は
    合法でなければならない — site 2/3はidをmintし、同じtickでcloseする。
17. **`ray_hit_all.hits[]`と`ray_aoe.hits[]`の全メンバーに`hp_after`があること**(§10.1b)。
    それがvictimの被弾後HPと一致すること — 2体以上のvictimを持つnova fixtureによってassertさ
    れ、同じvictimに対する直接の`ray_hit`と突き合わせて検証されること。**これにより、全ての
    rayダメージがlogだけからHPに帰属可能になる**;これはREQ-0263 §4.4が必要としている性質であ
    り、それを届けるのは今や本REQの責務である。
