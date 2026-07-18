# REQ-0262 — expedition-ray-vfx: rayは、identity(識別性)とtrailを備え、rationedなimpactを伴って描かれるprojectile(投射物)となる

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKED。作業を開始する前にユーザ
ーの判断が必要な点が3つある:(1) §8 — 批准済みのglow法則(`styleguide.html` §6.0:*"同時発光源は
≤ 3/画面"*)と、批准済みの戦闘モデルが正面から衝突する。**実測:最大19本のrayが同時に飛行しており、
そのうち47%がall-fieldのnovaで終わる。** どの実装も両方を満たすことはできない;§8は解決策を提案
しており、ユーザーが選ばなければならない。(2) §10 — `styleguide.html` §6.6は**戦闘再生 (combat
playback)**を、`prefers-reduced-motion`の下ではCONSTRUCT(構築)すらされてはならないものとして
名指ししている。存在意義そのものが動きであるfull-screenのbattle monitorは、それに文字通り従う
ことはできない;§10は解釈を提案しており、ユーザーが確認しなければならない。(3) §11 — 5回目の
bounceによるnovaはクライマックスではなく、**全rayダメージの72.2%**である(実測);本REQが規定する
VFXはそれを意図的に控えめに扱っており、これはデザイン上の判断である。
**予約日:** 2026-07-18
**スラッグ:** expedition-ray-vfx
**ブランチ:** req-expedition-spec(仕様のみ)
**依頼者:** user、2026-07-18 — 仕様項目(g)、(h)、(i)。
**依存先:** **REQ-0257**(ray-flight-entity) — HARD(必須)な依存。本REQは同REQのeventスキーマの
§10を描画に用いるのみで、独自のeventは一切発明しない。**REQ-0261**(expedition-formation-render)
— HARD(必須)、しかも二重に:その`ExpeditionRenderer`が本REQの描画先となるsceneであり、その
**server側でのroster拡張**(`instanceId`/`at`/`fieldCells`/`masked`)こそが、(h)が被弾した
instanceのcell shapeをハイライトすることを可能にする唯一の手段である(§7.2)。**REQ-0260**
(§9.3)が、本REQが補間の基準とするclockを所有する。
**ブロック対象:** REQ-0264(art-ray-hit-vfx-kind) — §9のseamがその着地面となる。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q1, §3 C2/C4, §6。

## 1. ゴール

仕様項目(g)、(h)、(i)。3つのことである:

- **(g)** rayは**trail**を示し、4tickごと(0.04秒)に1diagonal進む = **25 diagonal-steps/sec**。
  これは「再生側が許すならヌルヌル動くように」描画される。つまり:diagonal間をrAFで補間すること;
  rendererを25Hzに**gateしてはならない**。
- **(h)** impactは、被弾したcellと被弾したinstanceの**cell shape**の**両方**を、「一瞬」ハイライト
  する。
- **(i)** ray line 1本 + hit effect 1つを**さしあたり**用い、後でartがskillごとに差し替えられる
  よう**swappableなseam**の裏側に置く。

そしてもう1つ、ユーザーが求めたわけではないがコードが強制する点がある:**rayは今やidentityを持つ。**
REQ-0257はそれらをinterleave(交錯)するliveなentityにしており、rendererの単一slotのray状態では
それに耐えられない(§6)。

**明示的にscope外:** HP bar、cooldown overlay、charge ring、monster skill badge — すべて
REQ-0263。静的な構図 — REQ-0261。tick loop — REQ-0256。Ray物理 — REQ-0257。

## 2. これを承認する裁定

裁定**Q1**、原文まま:**シムを全面tick化** — *"Ray flight is PHYSICAL and changes combat
results."*(訳:Ray flightはPHYSICAL(物理的)であり、戦闘結果を変化させる。)

仕様項目**(g)**、ブリーフ§6より、原文まま:

> Ray VFX (g,h,i): trail + 25 diagonal-steps/sec, interpolated smoothly when the display allows
> (rAF, not a 25Hz gate). Impact highlights BOTH the struck cell AND the struck instance's cell
> SHAPE (h). One ray line + one hit effect for now, but behind a swappable seam (i) -> art REQ-0264.

(訳:Ray VFX(g,h,i):trail + 25 diagonal-steps/sec、表示側が許せばsmoothに補間する〔rAF、25Hzでの
gateではない〕。Impactは被弾したcellと、被弾したinstanceのcell SHAPE(形状)の両方をハイライトする
(h)。ray line 1本 + hit effect 1つをさしあたり用いるが、swappableなseamの裏側に置く(i) -> art
REQ-0264。)

裁定**C4**、原文まま:*"**#/expedition plays the sim clock 1:1 (realtime, tick-accurate).**"* —
§5.2がheadを`t`にlockし、tween timerには決してlockしない理由である。
(訳:#/expeditionはsim clockを1:1で再生する〔realtime、tick精度〕。)

## 3. 検証済みの現状 — すべての行を読んだものであり、想定ではない

| fact | source | evidence |
|---|---|---|
| `ray_fire`は**skill idもelementも運ばない** | measured(実測)、golden-A | golden-Aのfield集合:
`seq,t,ev,src,field,entry,dir,pen,aoe` — §9はこれに依存する。**`cause`は別の話である — 以下の3行
を見よ:`ray_fire`には確かに存在するが、golden-Aが通るいかなるpathにも現れないだけである。** |
| **`telegraph`にはskillが確かに含まれる** | measured(実測)、golden-A | field集合:
`seq,t,ev,src,skill,edge,fires_at` — §9.3:simはfire時点で既にskill idをscope内に持っている |
| `ray_hit`は**cellを運ばない** | measured(実測)、golden-A |
`{"seq":23,"t":18,"ev":"ray_hit","dst":"beta","amount":11.36,"bounce_mult":1,"hp_after":78.64}`
— §7.1:どこに命中したかを知っているのはrayだけである |
| `ray_hit_all`は**cellを運ばない** | measured(実測)、golden-A |
`{"seq":33,"t":1.09,"ev":"ray_hit_all","bounce_mult":2.5,"hits":[…]}` |
| small monitorはnovaに対して**hardcodeされた**cellをpulseする | `MonitorRenderer.ts:746-755`
(0240) | `case 'ray_hit_all': … this.pulseCell('N9')` — そのコード自身のコメント:*"No specific
cell carried on these two event kinds today"*(訳:今日時点では、これら2種類のeventにはcellが運ば
れていない) |
| `cause`は**ray eventに刻印**されている — CHARGE(charge)のpathによって |
`sim/lib/encounter.cjs:62,79` | `for (const re of rayEvents) events.push(Object.assign({ t, seq:
heap.nextSeq(), cause: 'charge' }, re));` — `rayEvents`は`fireSkillRay`から直接来るため、
**`ray_fire`/`ray_hit`/…はすべて`cause:'charge'`を運ぶ**、`chargeStrike`(`:62`)と`fireItems`
(`:79`)のpathにおいて。この行は以前は`:119`/`:136`のみを引用していたが、これらは
**`unit_charge_transfer`/`unit_charge_shieldbreak`であり、ray eventではない。** rayの箇所が見落
とされていた。 |
| `cause:'pulse'`は**ちょうど2つのeventにのみ刻印**されており、**どちらもray eventではない** |
`sim/lib/encounter.cjs:447,452` | `pulse_payload`(`:447`)と`apply_status`(`:452`)。**ray event
が`cause:'pulse'`を刻印されることは決してない** — `sim/`全体を`cause:`でgrepすると6箇所が見つか
る:`:62`、`:79`(ray、`'charge'`)、`:119`、`:136`(charge関連の帳簿処理であり、rayではない)、
`:447`、`:452`(pulse、rayではない)。 |
| **`MonitorRenderer`のgold pulse-ray分岐はDEAD CODE(死んだコード)である** |
`MonitorRenderer.ts:616`(0240) | `case 'ray_step': { … const pulseRay = ev.cause === 'pulse'; …
animateStep(path, pulseRay ? 0xffd166 : 0x59d6d6) }` — `pulseRay`は**決してtrueになり得ない**。
`ray_step`が`cause:'pulse'`を刻印されることは決してないためである(上の行)。gold tintはこれまで
一度も描画されたことがない。**注:本REQは以前`:718`を引用していたが、正しい行は`:616`である**
(`:718`は`reset()`の内部にある)。§9.2。 |
| golden-Aの**events中に`cause`は1件も現れない** — その理由はREQ-0256の§8.5が述べている |
measured(実測)、golden-A | golden-Aがcharge pathを一切通らないのは、**goldenがcharge managerを
そもそも構築していないため**である:`sim/tests/goldens.cjs:63`は`unitDefsById`を省略しており、
その結果`UNIT_DEFS = {}`となり`chargeBps`は空になる。**PRODUCTIONでは実際に機能している** —
`server/services/runs.cjs:83-91`がそれを渡しており、**54体中42体のliveなunitが`charge`blockを
持つ**(REQ-0263 §5.5)。**したがってgolden-Aのfield集合はwireのfield集合ではない**;それだけを
根拠に実装してはならない。 |
| rayのcellは生の`[row,col]`というNUMBER TUPLE(数値の組)である | `fieldGeometry.ts:23-34` +
BUG#4のpostmortem(事後検証) | `RawCell = [number, number]`;`"M9"`という文字列は常にentityの
LABEL(ラベル)にすぎない |
| `STEP_ANIM_MS = 200`は、REQ-0257が削除する演出である | `MonitorRenderer.ts:34` |
`const STEP_ANIM_MS = 200; // per ray_step segment` |
| expeditionのclockはrAF駆動であり`t`を読む | REQ-0260 §9.3 |
`simElapsedSecs = (Date.now() - Date.parse(run.startedAt)) / 1000`;*"reads `t`. never `pt`."*
(訳:`t`を読む。`pt`は決して読まない。) |
| 確定済みのplaybackには**0.5/1/2/4× + scrub**がある | REQ-0260 §10 |
§5.2のpure-function-of-clock(clockの純関数)設計こそが、4×と逆方向scrubを無償にしている |
| `RayMonitor`には**reduced-motionのguardがない** | `fx.js:88-283` | `REDUCED`(`:4`で定義され、
`initParticles`の`:8`で尊重されている)は`RayMonitor`の内部では**一度も参照されない**;
`requestAnimationFrame(tick)`が`:275`で無条件に実行される |
| `RayMonitor`はblurの上限を**最大3倍**超えている | `fx.js:209,219,240` | `shadowBlur = 10`
(trail)、`14`(head)、`18`(hit flash) — 上限は**8**である |
| `RayMonitor`は自身のclockをACCUMULATE(累積)している | `fx.js:268-270` | `const dt = …;
t += dt;` — まさにREQ-0256 §10.3が禁じているpatternである(`t`はCOMPUTE(算出)されなければ
ならない) |
| `RayMonitor`のnovaは**平面全体**を覆うwash(掃き)であり、1.1秒続く | `fx.js:245-258` |
`createRadialGradient(...paneW*0.7)` + `fillRect(x0, oy, paneW, ROWS*cell)`、
`novas.filter(f => t - f.t < 1.1)`、`globalAlpha = a * 0.55` |
| `RayMonitor`はtrailではなく、通過した経路の**全体**を描画する | `fx.js:211-216` |
`for (let i = 0; i < n; i++)`がindex 0から始まる — full-length(全長)のstreak(筋) |

### 3.1 taskブリーフにおけるframingの誤り — 訂正済み

taskブリーフはこう述べている:*"`client/src/schedule/MonitorRenderer.ts` (742 lines — read fully;
note `:160` `currentRayField` …)"*(訳:742行 — 全文を読むこと;`:160`の`currentRayField`に注意 …)。
**これらは実は2つの異なるファイルである。** 実測:

| file | 行数 | `currentRayField`はあるか? |
|---|---|---|
| `req-expedition-spec` worktree(0240以前) | **742** | **NO** — 出現ゼロ |
| `req-0240-monitor-redesign-pacing` branch | **852** | **YES** — `:160-162` |
`currentRayField`はREQ-0240での追加である。REQ-0255が0240をmergeするため、**本REQが編集するのは
852行版のファイルである**、そして以下のすべての行番号はそのファイルのものである。REQ-0257 §11.1
は0240 branchを引用しており正しい;taskのframingはこの2つを混同している。742行版のファイルに対
して`:160`を適用してしまうと、誤った行を編集することになる。

## 4. MEASURED(実測) — VFXが実際に耐えなければならないもの

**手法:** `batch002/golden-A`を、golden harnessと全く同じfixture読み込み
(`sim/tests/goldens.cjs:22-39`)で`combat.runDungeon`に通してreplayし、その上でREQ-0257の物理法則
(`diagonals × RAY_TICKS_PER_DIAGONAL × TICK_SECS` = `cells × 4 × 0.01`)のもとで各rayのflight
windowを導出した。

**これはREQ-0257 §4.1を独立に、正確に再現している** — 330 events;`ray_fire` 36;`ray_step` 109が
1017個のcellを運ぶ;`ray_hit_all` 17;`ray_hit` 21 — したがってその数値は確認済みであり、単に信頼
しているだけではない。

本REQが必要とし、REQ-0257では計測されていなかった新しい数値:

```
flight per ray:   min 0.04s  |  median 1.48s  |  mean 1.130s  |  max 2.68s
run ray span:     t=0.90 -> t=24.50  =  23.60s
MAX simultaneous rays in flight:  19          (at t=1.98)
share of ray-span time with >3 rays in flight:  13.0%
concurrency distribution (% of ray-span time):
  0:80.5%  1:5.0%  2:0.8%  3:0.7%  4:0.7%  5:0.8%  6:0.5%  7:0.4%  8:0.3%  9:0.8%
  10:1.2%  11:1.2%  12:0.5%  13:0.5%  14:1.5%  15:0.1%  16:0.3%  17:0.2%  18:3.6%  19:0.4%
novas: 17 of 36 rays = 47%
nova inter-arrival: min 0.01s | median 0.08s | max 0.41s
MAX novas landing inside RayMonitor's own 1.1s nova lifetime:  14
ray damage: direct ray_hit = 284.7 | nova ray_hit_all = 740.2 | ray_aoe = 0.0
  -> the nova is 72.2% of all ray damage
```

**5つの帰結があり、それぞれが以下のいずれかの節の形を決めている:**

1. **19本の同時rayに対し、予算は3。** §6.0のglow法則はpeak時に**6.3倍**超過する。§8。
2. **rayはBURSTY(突発的)であり、定常的ではない。** ray span(ray区間)の80.5%は飛行中のrayが
   *ゼロ*である;peakは19。したがってこの衝突は、調整で解消できる一定のoverdrawではなく、
   *static(静的)*な予算では吸収できず*priority rule(優先順位ルール)*でしか吸収できないspike
   である。§8。
3. **novaは「1秒に2回」ではない。** ray span全体での平均rateは0.72/sだが、**中央値のinter-arrival
   (到達間隔)は0.08秒**であり、1.1秒のwindow内に**14**個が着弾し得る。novaはvolley(一斉射撃)
   で到来する。§11。
4. **novaはmain gun(主砲)である**(rayダメージの72.2%)、クライマックスではない。§11。
5. **`ray_hit`はcellを運ばない。したがってtrailは演出ではなく、(h)にとって唯一のpositional
   source(位置情報の出所)である。** §7.1。

> **但し書き、埋もれさせず明記する:** これらは**1個**のcontent batch(batch-002)上の**1個**の
> goldenであり、**今日時点の**REQ-0256/0257適用前のfire timeに対して計測されたものである。
> REQ-0256は全fire timeをrequantize(再quantize化)し、REQ-0257はどのrayが数えられる対象として
> 存在するかを変えるため、正確な数値は動く。**しかしorder of magnitude(桁)は動かない** —
> flight timeは`cells × 0.04s`であり、cell数はgeometry(幾何)であって、これはREQ-0257 §9が
> verbatim(そのまま)存続すると確認している。0257が着地したら再計測すること(§14 gate 1)。

## 5. (g) trailと補間 — 正確に

### 5.1 何が、どれだけの時間をかけて、どんなeasingで補間されるか

**何が:** その平面上における**rayのheadのpixel位置** — それ以外の何物でもない。色でもなく、幅
でもなく、alphaでもなく、trailの形でもない。1つの2-vector(2次元ベクトル)である。

**何と何の間で:** **同じ`ray` id**を持つ、連続する2つの`ray_advance` eventのcell中心の間。
REQ-0257 §10.1によれば、`ray_advance`は`{t, seq, ev:'ray_advance', ray, cell:[r,c], bounces}`
であり、rayがそのcellに到達したtickにdiagonalごとに1回emitされる。

**どれだけの時間をかけて:** `RAY_TICKS_PER_DIAGONAL × TICK_SECS` = `4 × 0.01` = **40ms** —
ただし**この時間はtimerとして使われることは決してない**。それは入力ではなく、結果である。§5.2。

**どんなeasingで: LINEAR(線形)。easingなし。** これには根拠がある。ここは「とにかく全部
ease-outする」という反射的な判断が、積極的に間違いとなる唯一の場所だからである:

- **rayは一定速度の物理的projectileである。** REQ-0257 §5はtick数を規定しているのではなく、
  **rate(速度)**を規定しており、`1 / (RAY_TICKS_PER_DIAGONAL * TICK_SECS) === 25`という
  assertionでそれを固定している。25 diagonal-steps/secは*velocity(速度)*である。easingとは
  定義上、変動するvelocityのことである。easingされたrayは、一定速度のobjectを加速するobjectと
  して描いてしまう — その絵は、自らが描いているはずのmodelと矛盾することになる。
- **40msでのeasingは、smoothnessではなく25Hzのstutter(カクつき)である。** diagonalごとの
  ease-outは、headが各cellに入るたびに減速し、そこから飛び出すことを意味する — **1秒間に25回。**
  ユーザーが求めたのは「ヌルヌル」(*smooth/fluid*)であり、diagonalごとのeasingはその正反対、
  目に見えるpulsing(明滅)を生み出してしまう。diagonalの境界をまたいだlinear補間こそが、25個の
  離散的な位置を1つの連続したglide(滑らかな動き)として読ませるものである。
- **§6.0の120–180ms ease-out法則は、ここには適用されない。** その対象は遷移 — *transitions*、
  すなわち2つの静止状態の間のstate change(状態変化)である(hoverのon/off、panelのopen/closed)。
  飛行中のprojectileには静止状態が存在せず、決して「settling(落ち着く)」ことがない。transitionの
  法則をballistics(弾道)に適用するのはcategory error(カテゴリーの誤り)であり、§7.3はこの
  法則がこの画面上で*実際に*適用される箇所を示している(impactのハイライトであり、これはまさに
  state changeである)。
- **bounceもまた決定点ではない。** combat_spec §2.2(REQ-0257 §9により不変であると確認済み)は、
  反射を速度変化ではなく**direction flip(方向反転)**として扱っている。したがってbounceにおいて
  ease-in/ease-outは存在しない:headは一定速度のまま鋭角に曲がる。trailはそのcornerを**曲線では
  なくV字**として描く(§5.3)。

### 5.2 headはどのようにsim clockにlockされ続けるか — drift(ずれ)が構造的に不可能になる仕組み

**headの位置はclockのPURE FUNCTION(純関数)である。tween objectもelapsed accumulator(経過時間
の累積)も、ray単位のtimerも、`setInterval`も存在しない。**
```
// evaluated fresh every rAF frame, for every live ray
headPos(ray, clock):
    n     = the last ray_advance of `ray` with t <= clock          // cached cursor, not a rescan
    next  = the first ray_advance of `ray` with t >  clock
    if next == null:  return centre(n.cell)                        // CLAMP -- never extrapolate
    alpha = (clock - n.t) / (next.t - n.t)                         // exact; both t are tick-quantized
    return lerp(centre(n.cell), centre(next.cell), clamp01(alpha))
```

`clock`はREQ-0260 §9.3の`simElapsedSecs`である。4つの性質がここから導かれ、それらがこの形になっ
ている理由のすべてである:

1. **drift(ずれ)は累積し得ない。なぜなら何も累積していないからである。** dropされたframe、
   backgroundに回ったtab、GPU stall、200msのGC pause — 次のframeは`clock`から`headPos`を再計算
   し、simが述べる通りの位置にrayを正確に着地させる。**視覚上のheadがauthoritative(正式)な位置
   からdesynchronise(同期を失う)することはあり得ない。それを追跡しているのではなく、そこから
   導出しているからである。** これはREQ-0256 §10.3の裁定(*"`t` is COMPUTED, never
   ACCUMULATED"*(訳:`t`はCOMPUTE(算出)されるのであり、ACCUMULATE(累積)されることは決してな
   い))を、同じwireのclient側に適用したものである。**`RayMonitor`はその正反対を行っており**
   (`fx.js:270`:`t += dt`)、したがってここに移植することはできない — 継承してはならないもう
   1つの違反である(§3)。
2. **速度controlとscrubbingは無償で手に入る。** REQ-0260 §10は確定済みplaybackに0.5/1/2/4×と、
   **逆方向**を含むclickableなscrubを与える。tweenベースのheadであればseekのたびにray単位の
   cancel/rebuildロジックが必要になるが、pure functionであれば何も要らない — `clock`を変えれば
   headは正しくなる。逆方向scrubも特別扱いなしに機能する。
3. **Extrapolation(外挿)はFORBIDDEN(禁止)である。** clientのevent bufferが尽きたとき
   (`next == null`)、headは`n.cell`で**clamp(固定)**される。`dir`に沿って外挿してはならない。
   根拠:rayはまさに次のdiagonalでbounceしたり、命中したり、消滅したりし得る;外挿するとhead
   が壁を*突き抜けて*描かれたり、targetを*通り過ぎて*描かれたりしてしまい、真実が届いた時点で
   snap-back(瞬間的に戻る)することになる。**clampのコストはたかだかdiagonal 1つ分のstall
   (40ms)であり、これは知覚できない;snap-backはそうではない。** `?clock=sim`のもとでは
   serverが既にeventsを`t`でgateしているため(REQ-0260 §9.2)、これはerror pathではなく、あらゆ
   るliveなframeで生じる通常のbuffer終端の状態である。
4. **`alpha`は厳密である。** `n.t`と`next.t`はどちらも`TICK_SECS`のtick-quantizedな倍数であり
   (REQ-0256の不変条件)、したがって直線的なdiagonalにおいて`next.t - n.t`は正確に`0.04`となる
   — floatの意外な挙動はなく、`alpha`はきれいな0..1のrampになる。

**rendererは25Hzにgateされて*いない***(ブリーフ§6、原文まま:*"rAF, not a 25Hz gate"*
(訳:rAFであり、25Hzでのgateではない))。serverは25Hzで真実をemitする;clientはrAFが与える
タイミングで描画する。REQ-0257 §10.1がこの分担を述べており、これはそのclient側半分である。

### 5.3 trail

```
EXP_TRAIL_DIAGONALS = 6          // 6 diagonals = 0.24s of flight = 240px at EXP_CELL=40
```

- trailは、headの背後にある**直近`EXP_TRAIL_DIAGONALS`個のdiagonalのcell中心**を通る折れ線
  (polyline)であり、それに加えて補間されたhead自身が先頭の頂点となる。
- polyline全体にわたって**alphaはhead(1.0) -> tail(0)へrampする**。widthは一定である。
- **bounceの箇所でV字に折れる。** `ray_bounce`の頂点は鋭角のcornerであり(§5.1)、polylineはそれ
  を滑らかにすることなく通過する。bounceの頂点にsparkを置くことは許可されるが**glowしてはなら
  ない**(§8、R1) — `RayMonitor`のgold bounce ring(`fx.js:226-233`)は既にglowしない`stroke`
  であり、これは無変更でportされる唯一の部分である。
- **長さに上限があること自体が要点であり、これは実測に基づく。** `RayMonitor`はindex 0から
  **全体**の通過経路を描画する(`fx.js:211`)。ray 1本あたり平均28.25diagonal(§4)では、それは
  平面全体を横切るstreakになる;実測されたpeakである**19本の同時ray**では、19本のfull-plane
  streakとなり、平面は毛糸玉のようになってしまう。6diagonalは、方向と速度を一目で読み取るのに
  十分な長さでありながら、19本あっても19本とも判読可能なdartのままでいられるだけ短い。
- **なぜms単位のdurationではなくdiagonal数なのか:** 一定の25diagonal/secにおいてはこの2つは
  同じ量である(`6 diagonals === 240ms`)ため、どちらを選んでも自由に見える — しかしdiagonalが
  2つの理由で勝る。trailは**bounce**の箇所で折れなければならず、bounceはmillisecondsではなく
  diagonalで数えられる;また、REQ-0260 §10の4×playbackのもとでは、*wall clock(実時間)*で240ms
  のtrailは*ray*にとって24diagonal分になってしまいsmear(にじみ)を起こすが、6diagonalはどの
  速度でも6diagonalのままである。playerが読んでいるのはrayであり、wall clockではない。
- **trailはglowしない。** §8。

## 6. Rayのidentityとlifecycle — REQ-0257の名前を使う。新しい名前は作らない

### 6.1 `currentRayField`は壊れる。しかも静かに壊れる

`MonitorRenderer.ts:160-162`(0240 branch)、原文まま:

```ts
  /** REQ-0240: the field the most recent ray_fire targeted -- ray_hit carries
   * no field, so damage numbers read their side from here. */
  private currentRayField: 'player' | 'enemy' = 'enemy';
```

`:706`(`case 'ray_fire'`)でsetされ、`:735`(`ray_hit` -> `floatDamage`)と`:743`
(`ray_aoe` -> `floatDamage`)でreadされる。**これは「直近のray」を保持する単一slotである。**
今日これが健全であるのはただ1つの理由による:rayは瞬時であるため、`ray_fire`とその帰結のすべて
がlog上で隣接しており、2本目のrayがその間にinterleave(割り込む)ことはあり得ない。

REQ-0257はその前提を壊し、§4はそれがどれほど深刻かを計測している:**t=1.98の時点で19本のrayが
空中にある。** それらのeventはinterleaveする。「直近の`ray_fire`」は、処理対象の`ray_hit`が属す
るrayとは*別の*rayを指すようになり、あらゆるダメージ数値が、直近に発火した側に誤って帰属させら
れてしまう。**これは静かに失敗する** — 数値はそれらしい平面上に表示され続けるため、何もthrowさ
れず、何も壊れているようには見えない。

**修正、REQ-0257 §10.1に従う:`Map<rayId, RayVisual>`とし、`ray_fire`時にpopulateし、`ray`tagが
付いたすべてのeventがそれを読む。** `currentRayField`は修理されるのではなく、削除される。

### 6.2 lifecycle — REQ-0257のeventに基づく

REQ-0257 §10.1は`ray`(`IBattleRay.id`)を**すべての**ray eventに追加しており、それを
*"NEW and non-negotiable"*(訳:新規であり、交渉の余地はない)と呼んでいる。本REQはそのスキーマ
を**そのまま消費するだけであり、何も発明しない**:

| REQ-0257のevent | field(その§10.1) | 本REQが行うこと |
|---|---|---|
| `ray_fire` | `{t, seq, ev, ray, src, field, entry, dir, pen, aoe}` | **SPAWN(生成)。**
`rays.set(ev.ray, {id, field: ev.field, entry, dir, advances: [], bounceIdx: new Set(), alive:
true, lastT: ev.t})`。**`field`はRAYごとに保存される** — これが`currentRayField`を置き換える
行である。まだ何も描画されない:REQ-0257 §12.2により、rayはfireしたtickでは動かない。 |
| `ray_advance` | `{t, seq, ev, ray, cell, bounces}` | **ADVANCE(前進)。** `push({t, cell,
bounces})`。この配列こそがtrailであり、補間の元データである(§5)。`cell`は生の`[row,col]`という
tupleである(`fieldGeometry.ts:23-34`) — **決して**`.trim()`してはならない(§13)。 |
| `ray_bounce` | `{t, seq, ev, ray, at, new_dir, bounce}` | **BOUNCE(跳ね返り)。** V字折れと
glowしないspark(§5.3)のために頂点indexを記録する。 |
| `ray_hit` | `{t, seq, ev, ray, dst, amount, bounce_mult, hp_after}` | **IMPACT(命中)。** §7。 |
| `ray_aoe` | `{t, seq, ev, ray, center, radius, hits}` | **IMPACT(命中)**(splash)。`center`は
確かにcellである — 自身の位置情報を運ぶ唯一のimpact eventである。 |
| `ray_hit_all` | `{t, seq, ev, ray, bounce_mult, hits}` | **NOVA。** §11。 |
| `ray_end` / `ray_abort` | `{t, seq, ev, ray, reason, steps}` | **END(終了)。** `alive =
false`;trailは`EXP_TRAIL_DIAGONALS`分のclockをかけてfadeし、その後entryはdropされる。 |

**並行するvocabulary(語彙)は導入されない。** 本REQが追加する唯一のものはclient側のstruct
(`RayVisual`)であり、これはwireの名前ではない。

### 6.3 Reaping(回収) — 不正な形のlogのもとでも上限が保証される

`ray_end`が通常のreaper(回収役)である。しかしrendererは、それを欠くlogに対してもleak(漏れ)
を起こしてはならない:

```
EXP_RAY_REAP_SECS = 21        // > REQ-0257 s5.1 worst case: 512 diagonals x 0.04s = 20.48s
```

`lastT`が`clock - EXP_RAY_REAP_SECS`より古いrayは、`alive`の値に関わらずdropされる。
**21は導出された値であり、任意に選ばれたものではない:**REQ-0257 §5.1は、維持されている
`RAY_STEP_BUDGET = 512`が、今やdiagonal単位で数えられ、*"2048 ticks = 20.48 seconds of
flight"*(訳:2048 tick = 20.48秒のflight)であると述べている。これより低いreap閾値では、正当に
mid-flight(飛行中)でabortしているrayを消してしまうことになる — まさにこのbudgetが可視化する
ために存在している、その事象そのものである。

### 6.4 Reset、retarget、scrub

`MonitorRenderer.reset()`は既にすべてのtickerをcancelし、ray層をpurge(一掃)しており、これが
存在する理由は*"an in-flight self-removing tick can never fire against an already-cleared/destroyed
graphic after a retarget or a replay seek"*(訳:飛行中の自己削除tickが、retargetやreplay seekの
後に、既にクリア/破棄済みのgraphicに対して発火することは決してない)というその自身のdoc comment
の通りである。**ray mapもそのpurgeに加わる。** 逆方向scrubの際、mapはeventから再構築される;
§5.2がheadをclockのpure functionにしているため、ray単位のteardown(後片付け)は不要である —
mapの内容が、それまでに適用されたeventと一致してさえいればよい。

## 7. (h) impact — 両半分と、それぞれのコスト

### 7.1 被弾したCELL — そしてなぜ(h)は§6なしには不可能なのか

**実測:`ray_hit`はcellを運ば*ない*。** そのfield集合の全体は
`seq,t,ev,dst,amount,bounce_mult,hp_after`であり、`dst`はposition(位置)ではなくentityの
**label**である(`fieldGeometry.ts:29-34`は明示的である:*"A `"M9"`-style STRING id is only ever
used for entity/actor LABELS … never for a position"*(訳:`"M9"`のようなSTRING idは常に
entity/actorのLABELとしてのみ使われ……位置として使われることは決してない))。

したがって被弾したcellは**hit eventの中には存在しない**。それは
`rays.get(ev.ray).advances[last].cell` — rayが命中した瞬間に立っていたcell — である。**これが、
REQ-0257の`ray` idが本REQにとって交渉の余地なく必要である、load-bearingな理由である**:それなし
には、仕様項目(h)の前半 — *被弾したcellをハイライトする* — は、そもそもdata sourceを一切持た
ない。現行rendererの答えは`pulseCell('N9')`という、hardcodeされた定数である(`:746-755`) —
それは位置ではなく、詫び言である。

`ray_aoe`は例外である:`center`という、実在するcellを運ぶ。それをそのまま使えばよい。

**仕様:**
```
EXP_IMPACT_CELL_MS = 150        // inside s6.0's 120-180ms transition band
```
被弾したcellを**glowしない**fillで、150ms、ease-outし、その後消える。1cell分、`EXP_CELL`四方。

### 7.2 被弾したINSTANCEのCELL SHAPE — そのhardな依存関係

(h)の後半には、`dst` -> instance -> そのinstanceのfootprint cellという経路が必要である。

**player側(`dst` = BP id、例:`"beta"`):** BPはlocalのsquad store内にある(REQ-0261 §7.3の
join)。その形状 -> **`computeFootprintCells(shape, rot)`**(`client/src/render/itemCard.ts:71`)
-> cell -> `EXP_CELL`での平面pixel。これは`BoardRenderer`と`MonitorRenderer`が既に呼んでいるのと
同じpureなhelperであり(REQ-0261 §4.3)、したがってこのハイライトは、それがハイライトする対象の
構図とbyte単位で一致する。

**enemy側(`dst` = instance label、例:`"frost_gnoll#0"`):** **これは今日時点では描画できない。**
REQ-0261 §8.4がその典拠であり、本REQの§4はその根拠を計測により確認している:
`ray_hit_all.hits[]`は確かに`{"dst":"frost_gnoll#0"}`を運ぶ一方、`buildRoster`は確かに
`id: def.id`(= `"frost_gnoll"`)をemitする。2つの異なるnamespace(名前空間)である。
**REQ-0261 §8.2のroster拡張(`instanceId` + `fieldCells`)が修正であり、本REQはそれにhardに依存
する** — REQ-0261のrendererにではなく、その**server側の変更**に対して。

**REQ-0261 §8.5を構造的に尊重すること:`fieldCells`を読み、`footprint`は決して読まないこと。**
`[fh, fw]`というheight-first(高さ優先)の規約は実在しており(`shared/content_validate.cjs:472-479`)、
cellのlistはtranspose(転置)され得ない。したがって本REQはgeometryのために`footprint`に一切触れ
ることがなく、transpose bugは注意深さによってではなく、構造そのものによって発生し得ない。

**maskされたinstanceは正直にdegrade(縮退)する。** `maskLabel`(`sim/lib/replay.cjs:21-23`)は
maskされている間`'?'`を返す。`dst === '?'`はinstanceなしとして解決され、したがって**被弾したcell
のみがハイライトされ、shapeのハイライトはskipされる。** (h)の半分だけになるが、それが正直な半分
である — 代替案は、playerがまだ発見していないentityのshapeをでっち上げることであり、それは
spoiler(ネタバレ)であると同時に嘘でもある。

**仕様:**
```
EXP_IMPACT_SHAPE_MS = 150       // same band, same curve as the cell -- they are one event
```
instanceのfootprintの各cell全体にわたる**glowしない**輪郭線 + 淡いfill、150ms、ease-out。

### 7.3 duration — 食い違う2つの法則に照らして

styleguideは、どちらもimpactを規定していそうな2つの数値を述べており、それらは桁が1つ異なる:

| 法則 | 文言 | 対象 |
|---|---|---|
| §6.0 | 「遷移は **120–180ms** ease-out」 | 遷移 = **transitions**(遷移) — 静止状態間のstate
change(状態変化) |
| §6.1 ④ | 「④ 命中の光 hit flash once … 拡大しながら退色 ・ **~0.7s** ・ 実体は canvas 描画
(§6.4 RayMonitor)」 | 単発のcanvas **effect** |

**両者は矛盾しているのではなく、別々のものを規定している — そして本REQはその両方を必要とする:**

- **cellのハイライトとshapeのハイライトはtransitionsである** — それらは「このものは、一瞬の間、
  被弾状態にある」ということを表している。それらは**150ms**、この帯域の中間値をかける。ユーザー
  の言う「一瞬」とは、まさにこの帯域のことである。
- **hit glowは§6.1 ④**であり、認可された「命中の瞬間」である。

**しかし④の~0.7秒は、実測されたcontentとの接触に耐えられず、本REQはそれを短縮する:**

```
EXP_IMPACT_GLOW_MS = 180        // NOT 700
```

**根拠。** §6.1の~0.7秒は`RayMonitor`——**hardcodeされたpackを持つscriptedなdemo**——を基準に
書かれたものである — ブリーフ自身がそう述べている:*"port its LOOK, not its code (it is a scripted
mock with hardcoded packs and no real data)"*(訳:そのLOOK〔見た目〕をportせよ、コードをportする
な〔それはhardcodeされたpackを持ち、実データを持たないscriptedなmockである〕) — そこではhitは
稀な見せ場である。実測された現実(§4):**中央値のinter-arrivalが0.08秒のnovaが17回、加えて直接
hitが21回。** 0.08秒間隔で700msのdecay(減衰)が起きるということは、**nova単独だけで約9個の重な
り合うglow**を意味する — それは「flash(瞬き)」ではなく恒常的なwashであり、§6.0が強制するために
存在するrationing(配給制)を無力化してしまう。180ms——transition帯域の上限であり、*もう一方の*
法則のもとでも依然として合法な数値——であれば、hitはsnap(一瞬の弾け)として読み取れ、§8の予算
は達成可能になり、それでもglowはそれに付随する150msのハイライトより長く残るため、hitはなお際立つ。

**これは批准済みの数値(§6.1の~0.7秒)からの逸脱であり、逸脱として明示的にflagされている。**
これは一方的に採用されるのではなく、§8のruling request(裁定依頼)に組み込まれる。

### 7.4 Blur

```
EXP_GLOW_BLUR_MAX = 8           // s6.0: "外発光は blur <= 8px(等倍)・1要素1色"
```
`RayMonitor`の10 / 14 / 18(`fx.js:209,219,240`)は**portされない**。同じ条項により、1要素につき
1色。

## 8. GLOW BUDGET(発光予算)の衝突 — **USER RULING REQUIRED(ユーザー裁定が必須)**

### 8.1 衝突する、2つの批准済みの事柄

**視覚上の法則**、`styleguide.html` §6.0、原文まま:

> 発光は4つの瞬間のみ — ①焦点(hover/選択) ②伝説級以上の顕現 ③生存する連結ビーム ④命中の瞬間。
> 静止テキスト・待機パネルは光らせない。
> 外発光は blur ≤ 8px(等倍)・1要素1色。パネルは内影のみ。**同時発光源は ≤ 3/画面。**

**戦闘モデル**、Q1により批准され、REQ-0257によって規定される。

**この衝突は、論じられたものではなく、実測されたものである(§4):**

| | budget(予算) | 実測されたpeak | 超過 |
|---|---|---|---|
| 同時発光source | **≤ 3** | 飛行中の**19**本のray | **6.3倍** |
| | | + 1.1秒のwindow内に最大**14**個のnova | |

ray spanの13.0%が、飛行中のray 3本という数を超過している。**これはtuning(調整)の問題ではない。**
色、blur、durationをどう選んでも、19個の同時objectを3個にすることはできない。objectがglowしない
か、budgetが守られないか、そのどちらかである。

### 8.2 本REQが提案する解決策

4つのruleがある。**R1は妥協ではなく、§6.1が既に述べていることそのものである** — これが要となる
洞察である:

- **R1 — trailとheadはGLOWしない。** §6.1はglowを4つの瞬間に配給している:①focus ②legendary+
  のmanifestation(顕現) ③liveなlink beam ④命中の瞬間。**「飛行中のprojectile」はそのいずれでも
  ない。** 飛行中のrayはhoverでもmanifestationでもlink beamでもhitでもなく、hitと*hitの間*にある
  0.04秒間のintervalである。したがって`RayMonitor`がそのtrail(`shadowBlur=10`)とhead
  (`shadowBlur=14`)をglowさせているのは、**そもそも§6.1によって許可されていない** — それは、
  自らが実演するために作られたはずの法則を超過している参照実装なのである。trailをflat(平坦)に
  することは犠牲ではなく遵守であり、これだけで予算超過の19個のsource全19個が一度に取り除かれる。
- **R2 — glowはIMPACTSに配給され、3という上限がhardに設定される。**
  ```
  EXP_GLOW_BUDGET = 3            // s6.0: "同時発光源は <= 3/画面"
  ```
  最大でも同時に3個までのimpact glowしか生存できない。4個目が発生した場合、**priorityによって
  cull(間引き)する**:`ray_hit_all`(nova) > `ray_hit`(direct) > `ray_aoe`(splash);同点の場合
  はmost-recent-first(直近優先)で決着させる。**cullされたimpactも、glowしないcell + shapeの
  ハイライトは引き続き描画する(§7)。** したがってhitが不可視になることは決してない — 失われる
  のはその*glow*だけである。読み取りやすさは保たれ、budgetは守られる。
- **R3 — novaはvictimごとにはglowしない。** novaはN人のoccupant(`hits[]`)に命中するが、それぞれ
  をglowさせると1つのeventからN個のsourceが生まれてしまう。rayの終端cellに**1個**のglowを置き、
  それに加えてすべてのvictimに**glowしない**shapeハイライトを置く。§11。
- **R4 — blur ≤ 8px、1要素につき1色**(§7.4)。`RayMonitor`の10/14/18はportされない。

**R1–R4適用後のbudgetの算術:** trail 0 + head 0 + impact ≤3 = **≤3。** 法則は守られる — この画面
において、実測された最悪ケースにおいて。

### 8.3 それでもなぜ裁定が必要なのか

**R2はcullする。** burst(連射)の中では、一部のhitは④命中の光を得られなくなる。これは:

- **問題ない** — §6.0の「≤3」は*budget*であり、cullすることは単にそのbudgetを強制する方法に
  すぎない;あるいは
- **違反である** — §6.1 ④は*命中の瞬間*がglowすると述べており、ここでは一部の瞬間がglowしない。

**どちらであるかをLLMが決めるべきではない。** §6.0と§6.1はユーザーの視覚上の法則であり、19個の
同時projectileを想定していない。選択肢:

- **Option A — CULL(間引き)(推奨、かつ本REQが規定する内容)。** Glow ≤3、priorityはnova > hit >
  aoe、cullされたhitもglowしないハイライトは保持する。§6.0を文言通り忠実に守る。コスト:volley
  の中では、一部のhitはglowせずにflashする。今日すぐに実装可能であり、styleguideの編集は不要。
- **Option B — `#/expedition`のためにbudgetを引き上げる。** expeditionを明示的な例外として宣言
  する:§6.0の≤3は、battle monitorのためにではなく、*app*の各画面(panel、card、hover、単一の
  ambient loop)のために書かれたものである。§6.0にexpedition用の条項(例:≤8)を追加する。
  **ユーザー自身が視覚上の法則を編集する必要がある**;LLMが批准済みのgoldenを改訂することは
  できない。
- **Option C — 「glow source」をray層全体として再定義する**(1つのcanvas、1つのcomposite = 1
  source)。法律家的な解釈であり、文言は満たすが意図を放棄している。**非推奨**であり、後になって
  新しい選択肢であるかのように再発見されないよう、ここに記録しておく。

**この裁定にはこれも組み込まれる:** §7.3による§6.1 ④の**~0.7秒から180msへの短縮**。これは規模
が異なるだけの同じ問いである — 実測されたevent rateによって成立しなくなる、批准済みの数値という
点で。

### 8.4 本REQが発見したが、単独では埋められないREQ-gap

REQ-0261 §4.4は、Backpacksの**link beam**(`traceBeams`)を**本REQ**へ委ねており、その理由は:
*"a LIVE link beam is one of §6.0's four sanctioned glows and belongs with the VFX budget"*
(訳:liveなlink beamは§6.0が認める4つのglowの1つであり、VFXのbudgetに属する)。その理由付けは
正しい — ③生存する連結ビームはglowであり、beamは**persistent(持続的)**であるため、多くの連結
されたUnitを持つtroopは、ray 1本もfireされないうちからbudgetを継続的に消費してしまう。

**しかしbeamはユーザーの仕様項目(g)/(h)/(i)のいずれにも含まれていない。** つまりREQ-0261は
beamを、それを含まないscopeを持つREQへ委ねてしまったのである。**本REQはbeamをOUT(scope外)で
あると宣言し**、ユーザーが求めていない作業を黙って抱え込んだり、姉妹REQが引き継いだ作業を黙って
落としたりする代わりに、このgapを記録する。ユーザーまたはorchestrator(発注側)のための、正直な
2つの解決策:

1. beamはexpedition上では**描画されない**((d)の最も単純な解釈:平面は構図を示すものであり、
   REQ-0261 §4.4は既に他のすべてのinteractiveなaffordanceを落としている);あるいは
2. beamは自身のREQを持ち、そのREQは§8.3のbudgetの問いに2度目の回答をしなければならなくなる —
   持続的な③のglowと配給制の④のglowが、同じ≤3を奪い合うことになるためである。

**推奨:(1)。** これには裁定もbudgetも新しいREQも不要であり、REQ-0261 §4.4自身が挙げる、観戦用
の平面が描画しないものの一覧とも整合する。

## 9. (i) swappableなseam

### 9.1 seamは何をkeyにしなければならないか — そしてblocker(障害)

ユーザーの(i):**今は**ray line 1本 + hit effect 1つ、後で**skillごとに**swappableにする。

**実測されたblocker:`ray_fire`はskill idを運ばない。** そのgolden-Aのfield集合は
`seq,t,ev,src,field,entry,dir,pen,aoe`である。`skill`も`element`もない。**したがってseamは今日
時点ではskill idをkeyにすることができず**、(i)の「後で」はart側ではなくsim側の変更にgateされて
いる。

**`cause`は例外であり、§9.2でそれを活用する。** golden-Aには存在しないが、**wire上には存在
する**:`encounter.cjs:62,79`は、`fireSkillRay`がcharge pathで発するすべてのeventに
`cause:'charge'`を刻印しており、それらのpathはproductionにおいて**54 unit中42 unit**でliveである
(§3、REQ-0263 §5.5)。goldenがこれを示せないのは、goldenがcharge managerを構築していないため
である(`goldens.cjs:63`は`unitDefsById`を省略している)。**wireの形をgolden-Aから読み取って
しまったことが、本REQの唯一の架空の主張を生んだ**(§9.2);教訓はその訂正だけでなく、§3の各行に
ある。

**候補となる3つのkey、それぞれの判定:**

| candidate | wire上にあるか? | verdict |
|---|---|---|
| **`skill` id** | **ない**(ただし§9.3を見よ) | **keyとしてADOPTED(採用)。** artが基準とする
identity(識別性)そのものである。 |
| `element` | ない | **Rejected(却下)。** そもそもskill defのfieldではない — 実測によれば、
liveなskill defは`{trigger, verb, attack_profile, modes}`である(`goldens.cjs:37-39`)。keyにでき
るものが何もない。 |
| `attack_profile` | 部分的にある(`pen`、`aoe`は`ray_fire`上にある) | **Rejected(却下)。**
これはidentityではなく*struct*(pen/aoe/bounce_budget)である。無関係な2つのskillが`pen:2`を
共有していれば、artも共有することを強制されてしまい、「pen 2のrayはすべて同じ見た目」という
design ruleが偶然生まれてしまう。attack profileは*ballistics(弾道)*であり、artは*identity*に
従う。 |

**blockerがあるにもかかわらずなぜ`skill` idなのか:** これはREQ-0265がmonster skill icon用に
使うのと同じkeyだからである(skillは`content/live/dungeon/skills.json`においてidで参照される —
実測、81entry)。2つのart REQに対して1つのkeyを使うか、1つのconceptに対して2つのvocabularyを
使うかの違いである。

### 9.2 seamの形

```ts
// client/src/expedition/rayVfx.ts -- NEW
export interface RayVfxKey {
  skill: string | null;      // ray_fire.skill -- NOT on the wire yet (s9.3). null until REQ-0264.
  cause: string | null;      // ray_fire.cause -- ON THE WIRE TODAY as 'charge' (encounter.cjs:62,79),
                             //   null otherwise. Live in production, absent from golden-A (s3).
                             //   REQ-0263 s7 adds further values; it does not introduce the field.
  pen: number;               // ray_fire.pen  -- on the wire today
  aoe: number;               // ray_fire.aoe  -- on the wire today
  field: 'player' | 'enemy'; // ray_fire.field -- on the wire today
}

export interface RayVfxStyle {
  trailColor: number;  trailWidth: number;  trailDiagonals: number;
  headRadius: number;
  impactColor: number; impactGlowMs: number; impactGlowBlur: number;
}

export interface RayVfxProvider {
  styleFor(key: RayVfxKey): RayVfxStyle;
}
```

**今すぐ出荷されるもの:`DefaultRayVfx`** — 1つの実装であり、**keyのすべてのfieldを無視**して
1つの定数styleを返す。ただし**`cause === 'charge'`という1つの分岐だけは例外**であり、これが
seamのproof-of-shape(形の証明)となる:実際に値が変動するfieldを使って、seamがwireのfieldに
よってrayを実際に*変化させ得る*ことを示すものである。

**この分岐はre-base(作り直)されており、branchそのものよりもこの訂正の方が重要である。** 初稿
は`DefaultRayVfx`が*"preserves the `cause === 'pulse'` gold branch … using the one wire field that
varies today"*(訳:今日wire上で変動する唯一のfieldを使い、`cause === 'pulse'`のgold分岐を保存
する)と主張していた、すなわちproductionでliveな挙動をexpeditionへ引き継いでいると主張していた。
**それは両方の意味で架空だった:**

- **`cause:'pulse'`がray eventに刻印されることは決してない。** これはちょうど2つのevent —
  `pulse_payload`(`encounter.cjs:447`)と`apply_status`(`:452`) — にのみ存在し、どちらもray
  ではない。したがって`MonitorRenderer.ts:616`の`case 'ray_step': const pulseRay = ev.cause ===
  'pulse'`は**dead codeであり、最初からずっとそうだった。** gold tintはこれまで一度も描画された
  ことがない。**誰も、そこに存在しないliveな挙動をコピーすることで保存することはできない。保存
  すべきliveな挙動がそこには存在しないからである** — これをportしていれば、dead codeを新しい
  fileへ持ち込み、それをrequirementであるかのように装うことになっていたはずである。
- **rayにおいて実際に変動するwireのfieldは`cause:'charge'`である**(`encounter.cjs:62,79`、
  §3)。これは`fireSkillRay`がcharge-strikeとcharge-fireのpathで生成するすべてのeventに刻印さ
  れる。これは**productionにおいてlive**である — 54 unit中42unitが`charge`blockを持ち、
  `runs.cjs:83-91`がそのdefを渡している(REQ-0263 §5.5) — そして**golden-Aには不可視である**。
  goldenはcharge managerを構築しないためである(`goldens.cjs:63`)。この組み合わせこそが、初稿
  が誤った理由そのものである:golden-Aのfield集合を読み、`cause`が見当たらなかったため、それを
  示せないlogを根拠にwireについて推論してしまったのである。

```ts
// DefaultRayVfx -- the ONE branch, on a field that is real
styleFor(key: RayVfxKey): RayVfxStyle {
  return key.cause === 'charge' ? EXP_RAY_STYLE_CHARGE : EXP_RAY_STYLE_DEFAULT;
}
```

**`MonitorRenderer.ts:616`の`pulseRay`分岐をportしてはならない。** それはsmall monitor上でも
deadであり、そこでそれを削除することは別個の、些細なcleanupであって**本REQのscopeには含まれない**
(§13) — 本REQは単にそれを継承しないだけである。次の読者がこれを失われた機能として「復元」しない
よう、ここに記録しておく。

**`cause`をkeyにした分岐はstopgap(場当たり的な対処)であり、designそのものではない。** §9.1は
本当のkeyとして`skill` idを採用しているが、それはまだwire上に存在せず(§9.3)、REQ-0264がそれを
供給することになる。`cause`があるおかげで、seamは、変動する値によって一度も行使されたことのない
interfaceを持つproviderを出荷する代わりに、**今日時点で**liveなfieldの上でその形を証明できる。

**これは意図的に`chargeRing.ts`のpattern**(REQ-0125a)である:描画は完成させて出荷するが
inert(不活性)な状態にしておき、後続のREQには*structure(構造)*ではなく*argument(引数)*だけを
変えさせる。`chargeRing.ts:28-30`はこのpatternを自身の言葉で述べている — *"REQ-0129 supplies the
real value; when it does, it changes ONE argument at the call site and this module needs no edit"*
(訳:REQ-0129が実際の値を供給する;それが供給されたとき、呼び出し箇所の引数を1つ変えるだけで、
このmoduleは編集を必要としない) — そしてREQ-0263 §5.1は、その約束がどれほど守られたかを監査
している。ここでのseamはその約束を守るよう設計されている:**REQ-0264はproviderを登録するだけで
あり、それ以外は何も動かない。**

### 9.3 REQ-0264が追加しなければならないもの、そしてそれが安価であるという根拠

**`ray_fire`に`skill`を追加する。** field 1つだけである。しかもこれは、simが新たに発明しなけれ
ばならない情報ではない:

**実測 — `telegraph`には既にそれが含まれている:** field集合`seq,t,ev,src,skill,edge,fires_at`。
simはtelegraphの時点で既にskill idを手にしており、`fires_at`は*本REQがlabelを付けたいと望んで
いる、まさにそのfireのtimestamp*である。つまり`skill`は既に計算済みで、既にserialize済みで、
既にwire上にある — ただ、それを必要とするeventより0.6秒前のevent上にあるだけである
(`TELEGRAPH_LEAD_SECS`、combat_spec §4.5)。

`telegraph` -> `ray_fire`をclient側で相関させること(`src` + `fires_at === ray_fire.t`でのjoin)
は**可能ではあるが、行ってはならない**:実測によれば、golden-Aには**36個の`ray_fire`に対し35個
のtelegraph**しかなく、joinは実データの上で既に不完全であり、36本に1本の割合でrayを黙って見逃
すheuristicなjoinは、keyが全くないよりも悪い。**`skill`は`ray_fire`に置くこと。**

> **REQ-0264のためのfinding、本REQがこれを計測したためここに記録する:** 35対36というgapは、
> telegraphを伴わずにfireするrayが1本あることを意味する。これは必ずしもbugではない
> (reactive/chargeによるfireにはtelegraphすべきものがない)が、event-joinのheuristicを腐らせる
> 類の非対称性である。本REQが追うべきものではない。

## 10. Reduced motion — **USER RULING REQUIRED(ユーザー裁定が必須)**

### 10.1 法則はこの画面を明示的に名指ししている

`styleguide.html` §6.6、原文まま:

> OS/ブラウザで動きを減らす設定の利用者には、動きを**二段構え**で退ける。①CSS共通の
> `@media (prefers-reduced-motion: reduce)` が全 `animation`/`transition` を 0.001s に短絡
> (ui.css・mjolnir.css)。②粒子・視差・**戦闘再生など**JS生成のものは `fx.js`/`particles.ts` が
> **生成自体を行わない**(rAFループを起動しない)。

**戦闘再生——"combat playback"——はtier②において名指しされている。** この画面はまさに戦闘再生
*そのもの*である。文字通りに読めば:rAFループを起動するな、ということになる。それは、ユーザーが
まさに求めたfull-screenのbattle monitorを空白にしてしまう。

**そして批准済みの参照実装は、自らのruleに違反している。** 実測(§3):`fx.js:4`は`REDUCED`を
定義しており;`initParticles`は`:8`でそれを尊重している(`if (REDUCED) return;`);
**`RayMonitor`(`:88-283`)はそれを一度も参照せず**、`:275`で無条件に`requestAnimationFrame(tick)`
を呼ぶ。したがってstyleguide自身の戦闘再生demoは、今日、mock上で、`prefers-reduced-motion`の
もとでもfull motionのまま動作している。**報告済み;`fx.js`を修正することはscope外である**
(それはmockであり、ブリーフはそのlookをportせよ、コードはportするなと述べている)。

### 10.2 本REQが提案する解釈

**Tier②が禁じているのはJSの*effect(演出)*をconstruct(構築)することであり、*state(状態)*を
描画することを禁じているのではない。**

この区別は法律家的な屁理屈ではなく、実質的な働きをしている。§6.6自身の例——粒子(particles)、
視差(parallax)——は、JSが*generate(生成)*するものである:それらはscriptが発明したからこそ存在
する。**時刻TにおけるrayのpositionはGENERATEされたものではなく、authoritative(正式)なlogから
読み取られたものである。** ここでJSがGENERATEしているのは、(a) *2つの位置の間のtween*と(b)
*glow*である。それらがeffectである。それらは停止する。

**`prefers-reduced-motion: reduce`のもとでは、`#/expedition`はplaybackではなく、STATE
VIEW(状態表示)となる:**

| rule | 挙動 |
|---|---|
| **RM-1** | **rAFループは起動されない。** REQ-0260 §9.3の`useExpeditionClock`は
`requestAnimationFrame`を呼んではならない。 |
| **RM-2** | clockのcursorは**250msの`setInterval`**で前進する;sceneはfireごとに離散的に再描画
される。これは§6.6の文言 — *"rAFループを起動しない"* — をそのまま満たし、かつその意図も満たす:
250msは知覚できる帯域である約200msを上回るため、結果は**離散的な更新であり、動きとしては読め
ない**。 |
| **RM-3** | **rayは飛ばない。** 補間はなく(§5.2は評価されない)、headもtrailのgradientもない。
飛行中のrayは、その物理的なflight windowの間**静的なfull-pathのpolyline**として描画され、その
後消える。これはstateである:その期間、rayはfield上に「存在している」。 |
| **RM-4** | **glowもflashもnova washもない。** impactは被弾したcell + shapeを、cursorのstepちょ
うど1つ分だけ**静的な輪郭線**でマークする。animationとしてではなく、redraw(再描画)として構築
される。 |
| **RM-5** | REQ-0263のHP bar / cooldown overlay / charge ringは**同一に**描画される — それらは
stateであり、§6.6はそれらには一度も適用されたことがない。 |

**なぜ「rayをimpactへ即座にjumpさせ、trailなし」にしないのか:** これは検討されたが、より悪い
選択肢である。これはflightが*付け加える*唯一のもの — REQ-0257 §8.5の指摘する、+150%の
terminator(終端処理)が今や**rayが辿る可視の軌道そのものによってtelegraph(予告)される**という
性質 — を破壊してしまう。reduced-motionのuserは、animationだけでなく情報そのものを失うことに
なる。RM-3の静的なfull pathは、動くpixelを一切残さずに軌道の判読可能性を保つ。

### 10.3 なぜユーザーが裁定しなければならないのか

**これは、まさにこの画面を名指ししている批准済みの法則に対するINTERPRETATION(解釈)である。**
正直な選択肢:

- **Option A(推奨、上記で規定した内容)。** Reduced motion = 4Hzでの離散的なstate view。戦闘は
  観戦可能であり、何も滑らかには動かず、effectは何も構築されない。
- **Option B — §6.6を文字通りに解釈する。** expeditionは再生を拒否する:静的なformationを描画
  し、確定済みのresultか、「それでも再生する」というopt-inを提示する。最大限に忠実である;だが
  おそらく実用性がなく、vestibular(前庭覚)に配慮が必要なuserに対して、機能を適応させるのでは
  なく完全に否定してしまう。
- **Option C — §6.6を改訂**し、戦闘再生の対象を*mock*のplaybackに限定した上で、expeditionには
  独自の条項を与える。視覚上の法則へのユーザー自身による編集が必要。

**Aを一方的に採用することはできない**、なぜなら§6.6は「戦闘再生の動きを減らせ」とは述べておら
ず、戦闘再生をgenerateしてはならないと述べているからである。Option Aは1つの解釈であり、それを
所有するのはユーザーである。

## 11. 実測されたrateにおけるnova — そしてREPORTED(報告)されるbalance上のfinding

### 11.1 mockは、存在しないeventに合わせてcalibrateされている

`RayMonitor`は5回目のbounceによるnovaを、稀なクライマックスとして扱っている:**平面全体を覆う
radial gradient**、alpha 0.55、**1.1秒**のlifetime(`fx.js:245-258`)。実測された現実(§4):

- rayの**47%**(17/36)がそこに到達する — これは*edge caseではなく中央値の結果*である。
- 中央値のinter-arrivalは**0.08秒**;1.1秒のnova lifetime内に**14**個のnovaが着弾し得る。
- rayダメージ合計1024.9のうち**740.2**をnovaが与える = **72.2%**。

mockのnovaをそのままportすることは、**alpha 0.55のfull-plane gradientが14個重なる**ことを意味
する — 平面は数秒間にわたり単色のorangeのwashで飽和し、戦闘モデルにおいて最も重要な単一のevent
が、背景と見分けがつかなくなってしまう。

**安全性の観点もあり、これは後になって発見されるべきではない。** 1.1秒以内に14回のfull-plane
輝度flashが起きるということは、≈**12.7Hz**である。WCAG 2.3.1のgeneral flash thresholdは、広い
面積に対して**1秒あたり3flash**である;12.7Hzは3–55Hzという光過敏帯域のまさに内側に位置する。
その頻度でのfull-planeのorange/whiteのwashは、単に見苦しいだけでなく、正真正銘のseizure-risk
(発作リスク)pattern(パターン)である。**これは好みに依存しない、§11.2のための論拠である。**

### 11.2 novaがvolleyで発生するときの見た目

- **full-planeのwashではない。** rayの**終端cell**から拡がる**shockwave ring(衝撃波の輪)**
  — このcellは今や判明可能である:`rays.get(ev.ray).advances[last].cell`(§7.1)。現行renderer
  の`pulseCell('N9')`というhardcodeは、ここで役目を終える。
- **`EXP_IMPACT_GLOW_MS = 180`**(§7.3)、glow sourceは**1個**(§8 R3)、`EXP_GLOW_BUDGET`に対
  してcountされる。
- **`hits[]`内のすべてのvictimが、glowしない150msのshapeハイライトを得る**(§7.2)。victimこそ
  が情報であり、ringはその句読点にすぎない。
- **Nova coalescing(合流):**
  ```
  EXP_NOVA_COALESCE_MS = 180     // == EXP_IMPACT_GLOW_MS: coalesce within one nova's own lifetime
  ```
  **同じfield上で**`EXP_NOVA_COALESCE_MS`以内に着弾したnovaは、**1個**のshockwaveのみを描画し
  (直近のnovaの終端cellにて)、**victimのハイライト集合を統合する**。根拠:中央値のgapが0.08秒
  である以上、「何個のnovaが着弾したか」は人間が読み取れる情報ではなく、strobe(明滅)にすぎ
  ない。**誰が被弾したか**こそが情報であり、coalescingはそれをすべて保存する。14個のringは1個
  のringと14セット分のvictimハイライトになり、失われる真実は何もない。
- **先例、そしてその限界。** REQ-0240は既に同一targetへのhitをcoalesceしており
  (`detectCoalesceGroups`、`pacing.cjs:62-89`)、したがってcoalescingはここでの発明ではなく、
  批准済みのideaである。**しかし`pacing.cjs`は再利用できない**:C4は`#/expedition`が`pt`と
  pacing層全体を無視すると裁定しており、REQ-0260 §9.2はpacing gateが*server側*であることを
  示している。したがってexpeditionは、**renderer内で、sim clockに基づいて**、**独自の**
  coalescingを行う。同じideaだが異なる層であり、この重複は選択されたものではなくC4によって強制
  されたものである。

### 11.3 balance上のfinding — REPORTED(報告)され、明示的にここでは修正しない

`combat_spec` §10は、S4の指標として次のように規定している:

> **Ray sanity (new):** distribution of bounce counts and 5th-bounce all-field triggers; flag skills
> that near-always reach the +150% all-field terminator (**a balance smell**).

(訳:**Ray sanity(新規):** bounce回数の分布と5回目のbounceでのall-field発動の分布;ほぼ常に
+150%のall-field terminatorへ到達してしまうskillにflagを立てる〔**balance上の悪臭**〕。)

**batch-002/golden-Aで、今日時点のcontentに対し、REQ-0256にもREQ-0257にも何も変更が加わる前の
状態で実測:**

```
bounce histogram: {1:18, 2:18, 3:18, 4:17, 5:17}
17 of 36 rays (47%) reach bounce 5 and nova
nova damage 740.2 vs direct 284.7  ->  the terminator is 72.2% of all ray damage
```

**ユーザーが規定したgateは、ユーザーの現行contentに対して、今日の時点で発動することになる。**
rayは実質的にほとんど早期停止しない:18本のrayが少なくとも1回はbounceし、そのうち17本はbounce
5まで乗り切ってしまう。

**本REQはこれを修正しない。また、修正してはならない。** これはrendererであり、ここでの
re-balancing(再調整)はVFXのdiffの中に隠されたcontent変更になってしまう。REQ-0257 §14.3は既に
同じ裁定を下しており(*"Report the before/after distribution to the user as a finding. Do not tune
anything"*(訳:before/afterの分布をfindingとしてユーザーに報告すること。何もtuneしないこと))、
本REQもそれに同意し、findingのpresentation(表示)側の半分を付け加える:

> **VFXはnovaをクライマックスとして正直に提示することはできない。なぜならそれはクライマックス
> ではないからである。** それを稀な見せ場としてdesignすること——これはまさに§6.4の`RayMonitor`が
> 行っていることであり、ブリーフがそのlookをportせよと述べている対象でもある——は、playerに対し、
> 自分のダメージが実際にはどう与えられているかについて、積極的な誤情報を与えることになる。§11.2
> は意図的にnovaを*spectacle(見世物)*ではなく*punctuation(句読点)*にしている。**もしbalanceが
> 変化しnovaが稀になるなら、§11.2は再検討されるべきである** — このVFXは実測されたrateに合わせて
> calibrateされており、それはcontentへの依存であるため、忘れられないようここに記録しておく。

これはREQ-0257のfindingとともに届けられる、**ユーザーのためのfinding**である。どちらのREQもこれ
に基づいて行動を起こすことはない。

## 12. RawCellのcontract — 継承されるものであり、交渉の余地はない

REQ-0261 §7.2は、本REQに対しdefault(不履行)してはならない負債を引き渡している。
`fieldGeometry.ts:36-60`のBUG#4のpostmortem(事後検証)、重要な部分を原文まま:

> sim/combat.cjs's actual ray_fire/ray_bounce/ray_step events carry `entry`/`at`/`path[]` as raw
> **`[row,col]` NUMBER TUPLES, never strings** … *"TypeError: e.trim is not a function"* … Since
> Monitor.tsx's poll effect only advances `lastEventIndexRef` AFTER applyEvents() returns
> successfully, this exception fired again on **EVERY subsequent ~2s poll tick forever** … pegging
> the render thread in a **permanent crash-loop**.

(訳:sim/combat.cjsの実際のray_fire/ray_bounce/ray_step eventは、`entry`/`at`/`path[]`を、文字
列では決してなく生の**`[row,col]`というNUMBER TUPLE**として運ぶ……*"TypeError: e.trim is not a
function"*……Monitor.tsxのpoll effectはapplyEvents()が正常にreturnした後にのみ
`lastEventIndexRef`を前進させるため、このexceptionはその後**約2秒ごとのpoll tickのたびに永遠に**
再発し……render threadを**恒久的なcrash-loop**に固定してしまった。)

**REQ-0261が触れただけのevent loopを本REQは所有しており、それゆえに拘束力を持つ3つの帰結が
ある:**

1. **`ray_advance.cell`は`RawCell`であり、文字列ではない。** REQ-0257 §11.4はこれを確認して
   いる:*"`ray_advance`'s `cell` is the same raw `[row, col]` NUMBER TUPLE. The contract is
   unchanged; only the field name moves."*(訳:`ray_advance`の`cell`も同じ生の`[row, col]`という
   NUMBER TUPLEである。契約は変わらない;field名が移るだけである。)`RawCell`と`cellIdToXY`を
   `fieldGeometry.ts`からimportすること。**`colLetterToIndex`を再実装してはならない** — 3つ目の
   コピーは、BUG#4が起き得る3つ目の場所になってしまう。
2. **cursorはsuccess(成功)にgateされて*はならない*。** これはREQ-0261 §7.2がREQ-0262に対して
   明示的に割り当てているcorollary(帰結)である:*"the expedition's event application must not
   gate its cursor on success … Advance the cursor first, or wrap per-event."*(訳:expeditionの
   event適用は、cursorをsuccessにgateしてはならない……先にcursorを前進させるか、event単位で
   wrapすること。)crash-loopの*深刻さ*は、cursorが不正なeventを決して通り過ぎなかったことに完全
   に起因していた。**仕様:`applyOneEvent`はevent単位でtry/catchにwrapする;cursorは無条件に前進
   する;throwしたeventは1度だけcountされlogされ、再試行されることはない。**
   `MonitorRenderer.addTicker`は既にまさにこの姿勢をmodel化している(`try { done = step(); }
   catch { done = true; }`) — rendererが、ページ全体を落とす原因になることは決してあってはなら
   ない。
3. **未知の`ray` idはerrorではない。** buffer内に`ray_fire`を持たないrayに対する`ray_advance`
   (mid-flight〔飛行中〕に着地したscrub、切り詰められたtailなど)は、何も描画せずthrowもしない。
   `cellIdToColRow`の`{col:1,row:1}`というfallbackと同じ姿勢である:degrade(縮退)しても、決し
   てdie(停止)しない。

## 13. Scope(範囲)

**含まれるもの:**

1. `client/src/expedition/rayVfx.ts` — **NEW。** §9の`RayVfxKey` / `RayVfxStyle` /
   `RayVfxProvider` + `DefaultRayVfx`(1つのstyle、加えて§9.2の`cause === 'charge'`という単一の
   分岐 — これは実在するwireのfieldである(`encounter.cjs:62,79`)。これは、本REQの初稿が
   「preserve(保存)」しようと提案していた`cause === 'pulse'`分岐——`MonitorRenderer.ts:616`に
   あるdead codeであり、一度も描画されたことがない——とは異なる)。
2. `client/src/expedition/ExpeditionRayLayer.ts` — **NEW。** `Map<rayId, RayVisual>`(§6)、
   pure functionのhead(§5.2)、上限付きのtrail(§5.3)、impact/novaのeffect(§7、§11.2)、glow
   budget + priorityによるcull(§8 R2)、reaper(§6.3)。REQ-0261の`ExpeditionRenderer`のscene
   graphへ描画する。
3. `client/src/expedition/expeditionGeom.ts` — §5/§7/§8/§11の定数がREQ-0260のmoduleに加わる:
   `EXP_TRAIL_DIAGONALS=6`、`EXP_IMPACT_CELL_MS=150`、`EXP_IMPACT_SHAPE_MS=150`、
   `EXP_IMPACT_GLOW_MS=180`、`EXP_GLOW_BLUR_MAX=8`、`EXP_GLOW_BUDGET=3`、
   `EXP_NOVA_COALESCE_MS=180`、`EXP_RAY_REAP_SECS=21`。
4. `client/src/expedition/useExpeditionClock.ts` — REQ-0260 §9.3のhookに、§10のreduced-motion分岐
   が加わる(RM-1/RM-2:rAFなし;250msのcursor)。
5. `client/src/schedule/MonitorRenderer.ts`**(852行版の0240版 — §3.1)** — REQ-0257 §11.1の編集
   内容。本REQはray loopを所有するため、これを継承する:`STEP_ANIM_MS`を削除;
   `ray_step` -> `ray_advance`;**`currentRayField`を削除**し、ray単位のfield mapに置き換える
   (§6.1)。small monitorはdev-grade(開発者向け)のlookのままとする——「今ある画面は放置して」——
   これはredesignではなく正しさの修正である。

**含まれないもの:**

- **HP bar、cooldown overlay、charge ring、passive flash、monster skill badge** — REQ-0263。
- **`ray_fire`への`skill`の追加**(§9.3)と**あらゆるart** — REQ-0264。seamはinert(不活性)な
  状態で出荷される。
- **Link beam** — §8.4。REQ-0261 §4.4がこれをここへ委ねたが、これは(g)/(h)/(i)のいずれにも含ま
  れていない。黙って抱え込むのではなく、推奨案とともにOUT(scope外)と宣言する。
- **47%というnova発生率のre-balancing**(§11.3)。これはfindingであり、修正ではない。
- **`fx.js`の`RayMonitor`の修正**(§3、§10.1) — それはmockであり、ブリーフはそのlookをportせよ、
  コードはportするなと述べている。その違反は報告されるのみで、修理はされない。
- **enemy rosterの拡張**(`instanceId`/`fieldCells`) — REQ-0261 §8.2がこれを所有する。本REQは
  それにhardに依存するが、複製はしない。
- **`pacing.cjs` / `shared/pacing.json`への変更** — REQ-0257 §11.2が`ray_advance`のentryを所有
  する。C4は、expeditionをpacing層から完全に除外している。
- **`docs/user_managed/*`** — 禁止されており、本REQにはそもそもそれを必要とするものがない。

## 14. Gate

**E2Eのport(規則:`5000 + REQ*10 + index`):`7620` static / `7621` api / `7622` proxy。** 採番規則
により予約され、`tools/check_e2e_ports.cjs`によって機械的に強制される。**裁定Q2
(「e2eを通す必要はない」)により、E2Eは本programにとってgateでは*ない*ため、harnessは構築されず、
この10番台は未使用のまま残される** — REQ-0257 §15が7570-7572について取るのと、REQ-0261 §13が
7610-7612について取るのと、同じ姿勢である。

実際に適用されるgate:
1. **§4をREQ-0257の実際の出力に対して再計測すること。** §4のconcurrency(同時実行数)/novaの数
   値は*今日時点の*fire timeから導出されている。0257が着地した後、実際の`ray_advance`/
   `ray_hit_all` eventから`MAX simultaneous rays`とnova rateを数え直すこと。**もしpeakの
   concurrencyが依然として>3であれば、§8の裁定は規定通り有効である;もし0256/0257が何らかの形で
   それを≤3に縮小させていたなら、§8は無意味になっており、古い証拠のまま出荷するのではなく再検討
   されなければならない。**
2. **headはclockのpure functionである。** 固定されたevent listが与えられたとき、
   `headPos(ray, t)`は、どんな順序で、何回呼ばれても、同じ`t`に対して同じ出力を返す。**逆方向
   scrubを明示的にpinする:**`t`を降順に評価し、昇順の場合と同じ位置になることをassertする。これ
   は、誰かがaccumulatorを再導入した場合にそれを捕らえるtestである。
3. **accumulatorが存在しないこと。** `client/src/expedition/`全体に対するgrep gate:`+= dt`は
   ゼロ件、`elapsed +=`はゼロ件、ray clockとして使われる`performance.now()`もゼロ件。
   (`RayMonitor`の`t += dt`が、締め出そうとしているanti-patternである。)
4. **interleaving(交錯)が表現可能であること。** 反対側のmap上を飛行する2本のrayがあり、その
   eventがinterleaveする;各hitのダメージ数値が、それぞれ*自分自身*のrayのfieldに帰属することを
   assertする。**このtestは今日時点では表現不可能であり**、§6.1に対する直接のregression guard
   である — これはREQ-0257 §16.6のacceptance criterionを、renderer上でassertするものである。
5. **Glow budgetが守られること。** golden-Aのevent stream(0257適用後)を投入し、どのframeに
   おいてもliveなglow sourceの数が`EXP_GLOW_BUDGET`を超えないことをassertする。**このgateは
   `RayMonitor`を素朴にportした場合には失敗し、それこそが§8の要点である。**
6. **Blurの上限。** Grep gate:`client/src/expedition/`内に、`EXP_GLOW_BLUR_MAX`を超える
   `shadowBlur`/`GlowFilter`の値が存在しないこと。§7.4を、`fx.js`の10/14/18のcopy-pasteから固定
   して守る。
7. **Reduced motionは何も構築しないこと。** `prefers-reduced-motion: reduce`のもとで、expedition
   のmoduleによって`requestAnimationFrame`が**一度も呼ばれない**こと(spy/stubで検証)、そして
   glow/flashのGraphicsが一切構築されないことをassertする。これは§6.6のtier②の文字通りの要件で
   あり、このgateに`fx.js`の`RayMonitor`を通せば今日時点では失敗するはずである(§3、§10.1)。
8. **Trailに上限があること。** 28diagonalのrayにおいて、trailのpolylineの頂点数は——どの
   playback速度(0.5/1/2/4×)でも——`EXP_TRAIL_DIAGONALS + 1`を超えない。§5.3のms単位ではなく
   diagonal数を選んだことを固定して守る。
9. **RawCellのcontract。** `ray_advance.cell`はtupleとして扱われる;不正な形のcellはfallback
   位置に描画され、**throwしない**;throwしたeventはcursorを**止めない**(§12)。
10. `pnpm exec tsc --noEmit` + lint。

## 15. Acceptance criteria(受け入れ基準)

1. rayのheadは、sim clockに対して**正確に**25diagonal/secで前進し、rAFのrateで滑らかに補間さ
   れ、**easingはない**(§5.1) — `headPos`を1/240秒間隔でsamplingし、diagonal内およびdiagonalの
   境界をまたいでも速度が一定であることをassertすることで検証する。
2. **headは決してdriftしない。** 人為的にstallさせたframe(500msのgapをsimulate)の後でも、head
   は`clock`が示す位置に正確に存在し、500ms遅れてはいない(§5.2)。
3. 逆方向scrubと4×playbackは、ray単位のteardownなしに正しいhead位置を生成する(§5.2)。
4. **反対側のmap上を飛行する2本のinterleaveしたrayが、それぞれ自分自身のhitに正しく帰属する。**
   `currentRayField`はどこにも現れない:`grep -rn "currentRayField"`はゼロ件を返す(§6.1)。
5. すべてのray eventが`ray`によって相関付けられる;未知のrayに対する`ray_advance`は何も描画せず、
   throwもしない(§12.3)。
6. impactは、被弾したcellと被弾したinstanceのcell shapeの**両方**を150msハイライトする(§7)。
   **masked**なinstanceの場合、cellのみがハイライトされ、何もthrowしない(§7.2)。
7. 被弾したcellは**そのray自身の最後の`ray_advance`**から導出され、hardcodeされたcellから導出
   されることは決してない。`client/src/expedition/`内で`grep -rn "'N9'"`はゼロ件を返す(§7.1)。
8. instanceのshapeは`fieldCells`(enemy)/`computeFootprintCells`(player)から導出される。`grep`
   により、`client/src/expedition/`がgeometryのために`footprint`を読むことは決してないと示され
   る(§7.2、REQ-0261 §8.5)。
9. **Glow sourceは3を決して超えず**、blurは8を決して超えず、1要素につき1色である — golden-Aの
   全replayにわたってassertされる(§8、§14.5、§14.6)。
10. cullされたimpactも、glowしないハイライトは引き続き表示する — **hitが不可視になることは決し
    てない**(§8 R2)。
11. `prefers-reduced-motion`のもとでは、**rAFループは起動されず、glow/flash objectも構築されな
    い**;戦闘は4HzのSTATE VIEWとして引き続き観戦可能である(§10、§14.7)。
12. 1.1秒以内の14個のnovaは、coalesce windowごとに**1個**のshockwaveと**14セット**分のvictim
    ハイライトを描画する — 14個のfull-plane gradientが積み重なることは決してない(§11.2)。
13. `DefaultRayVfx`が唯一のproviderである;stubのproviderに差し替えると、**`ExpeditionRayLayer`
    には一切変更を加えることなく**rayの見た目が変わる(§9.2) — seamは、assertionによってではな
    く実際に行使することによって証明される。
14. **ユーザーが、§8(glow budget)、§10(reduced motion)、および§7.3による§6.1 ④の~0.7秒から
    180msへの短縮について、裁定を下していること。** それより前に実装は開始されない。

## 16. ブリーフ、taskのframing、そしてsourceへの訂正

| 主張 | 実際 | evidence |
|---|---|---|
| task:*"`MonitorRenderer.ts` (742 lines … note `:160` `currentRayField`)"*(訳:742行……`:160`の
`currentRayField`に注意) | **2つの異なるfileである。** 742行のworktree版には`currentRayField`が
**ゼロ件**存在する;それは852行の`req-0240`版にのみ、`:160-162`に存在する。REQ-0255が0240を
mergeするため、対象となるのは852行のfileである。 | §3.1 |
| ブリーフ§6 / task:*"§6.4's `RayMonitor` … is the ratified reference implementation … port its
LOOK"*(訳:§6.4の`RayMonitor`……が批准済みの参照実装である……そのLOOKをportせよ) | そのlookは
**scriptedなmock**に合わせてcalibrateされている。文字通りportすると、19個のglowするfull-plane
streakと14個の積み重なったnovaが生まれる。さらに§6.0にも違反しており(blur 10/14/18 vs ≤8)、
§6.6にも違反しており(§6.6が名指ししているまさにその対象に、reduced-motionのguardが**ない**)、
REQ-0256 §10.3が禁じる**clockのaccumulate**(`t += dt`)も行っている。 | §3、§5.2、§10.1、§11.1 |
| task:*"the 5th-bounce nova … `RayMonitor` treats the nova as a rare climax"*(訳:5回目のbounce
によるnova……`RayMonitor`はnovaを稀なクライマックスとして扱っている) — 暗示されている修正は
presentational(表示上)のもの | 正しい、しかも述べられている以上に深刻である:novaは**全rayダ
メージの72.2%**である(740.2 vs 284.7、実測)。これはクライマックスではなく**主要なダメージ経
路**である。 | §4、§11.1 |
| task:*"a sibling agent measured 47% of rays (17/36) reach it"*(訳:姉妹agentが、rayの47%
〔17/36〕がそこに到達すると計測した) | **独立したreplayによりCONFIRMED(確認済み)。** 併せて確
認された内容:330 events、36件の`ray_fire`、109件の`ray_step`/1017cell、17件の`ray_hit_all`、
21件の`ray_hit`。REQ-0257 §4.1は健全である。 | §4 |
| task:*"what the nova looks like when it happens twice a second"*(訳:1秒に2回発生するときのnova
の見た目) | **burstを過小評価し、平均を過大評価している。** ray span全体での平均は0.72 nova/s;
**中央値のinter-arrivalは0.08秒**;1.1秒のwindow内に最大**14**個。novaは一定の2Hzではなく
volleyで到来する — だからこそ§11.2は単に短縮するのではなくcoalesceする。 | §4、§11.2 |
| ブリーフ§6(無言) | **`ray_hit`はcellを運ばない。** したがって(h)は、REQ-0257の`ray` idなしに
は不可能である — 被弾したcellは、そのray自身の`ray_advance`のtrail上にのみ存在する。現行
rendererは`pulseCell('N9')`をhardcodeしている。 | §3、§7.1 |
| ブリーフ§6(無言) | **`ray_fire`は`skill`も`element`も運ばない。** (i)の「skillごとに
swappable」は、art側ではなくsim側の変更でblockされている。**`telegraph`には既に`skill`が含まれ
ている** — そのfieldは存在するが、間違ったevent上にある。**`cause`は確かに`ray_fire`上にあり**
(`encounter.cjs:62,79`、`'charge'`)、これが§9.2のseamが分岐する対象である。 | §3、§9.1、§9.3 |
| task/本REQ自身の初稿:*"`DefaultRayVfx` preserves the `cause === 'pulse'` gold branch, the one
wire field that varies today"*(訳:`DefaultRayVfx`は、今日wire上で変動する唯一のfieldを使い、
`cause === 'pulse'`のgold分岐を保存する) | **両方の意味でFALSE(誤り)。** `cause:'pulse'`はちょ
うど2つのevent(`encounter.cjs:447,452`)にのみ刻印されており、**どちらもray eventではない**。
したがって`MonitorRenderer.ts:616`の`pulseRay`分岐は**一度も描画されたことのないdead codeであ
る** — そこには保存すべきliveな挙動は存在しない。rayに関わる`cause`は`'charge'`である
(`:62,79`)。seamはそれを基準にre-baseされた。 | §3、§9.2 |
| ブリーフ§6(無言) | 実測された19本の同時rayという状況において、**§6.0の≤3というglow budgetと戦
闘モデルは相容れない。** ブリーフもstyleguideも、これを想定していない。 | §4、§8 |
| ブリーフ§6(無言) | **§6.6はtier②において戦闘再生を明示的に名指ししている。** full-screenの
battle monitorはそれに文字通り従うことはできず、ブリーフは、自らの§6がそのruleを引用しながら、
まさにそのruleを破る画面を規定していることに気づいていない。 | §10.1 |
| REQ-0261 §4.4 | **link beam**をREQ-0262へ委ねている — しかしbeamは(g)/(h)/(i)のいずれにも含
まれていない。scopeがそれを除外しているREQへの委譲である。ここでOUT(scope外)と宣言し、推奨案
を添える。 | §8.4 |
| REQ-0257 §11.1:*"`:746-755` `case 'ray_hit_all'` -> `pulseCell('N9')` **unchanged**"*
(訳:`:746-755`の`case 'ray_hit_all'` -> `pulseCell('N9')`は**無変更**) | **expedition上では無
変更のままであるべきでは*ない*。** すべてのeventが`ray`を運ぶようになれば、novaの発生源は判明可
能になる(そのrayの最後の`ray_advance`)ため、`'N9'`のhardcodeは*REQ-0257自身の変更によって*時
代遅れになる。small monitorに関しては0257が正しく、`#/expedition`に関しては本REQがそれに優先す
る。 | §7.1、§11.2 |
| REQ-0257 §8.5:*"REQ-0262 should surface [the telegraphed terminator]"*(訳:REQ-0262は〔
telegraphされるterminator〕を可視化すべきである) | **受諾済み、かつ規定済み** — §5.3の上限付き
trailと§10.2のRM-3の両方が、novaをtelegraphする軌道を保存する。この引き継ぎが失われないよう記
録する。 | §5.3、§10.2 |
| `combat_spec` §10自身の「balance smell」gate | 本program中のいかなるREQも着地する前の**今日時
点の**ユーザーの現行contentに対して**発動することになる**:47%のterminator発生率、rayダメージ
の72.2%。REQ-0257 §14.3と共同で報告済み。**ここでは修正しない。** | §11.3 |
