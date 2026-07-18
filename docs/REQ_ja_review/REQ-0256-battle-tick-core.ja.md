# REQ-0256 — battle-tick-core: simは0.01秒のtickループになり、バックパックは1つのIBattleInstanceにコンパイルされる

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKED。作業を開始する前に、ユー
ザーの判断が必要な点が4つある:(1) 本REQは`combat_spec_draft.md`の批准済みコアをSUPERSEDE(置き換
え)する(消滅する行を正確に引用しているのが下記§3である)——これはruling Q1により認められている
が、Q1はわずか一文であり、本REQはその一文を使い切るREQである;(2) §12は12個の全リプレイgoldenお
よびS4ベースラインのrebaseline(再ベースライン化)を実測しており、これはdeterminism契約に対する意
図的かつ不可逆な変更である;(3) **§7.1aはbrief §4の`IBattleInstancesFormationMap.tick()`を2つの
フェーズメソッドに分割する**(`tickInstances()` / `tickRays()`)——brief §4は1つのmapに対して
`tick()`を書いたが、実際にはmapが2つ存在するためである。単一メソッドを2つのmapにまたいで合成する
と、player発のrayがenemy発のrayより1tick早く到達してしまう、map順序以外に理由のない結果になる。
spec (c)のBattle -> map -> instanceというカスケードそのものは無傷であり、分割されるのはmap内部の
「1メソッドである」という性質のみである。**これは解釈であり、拒否権(veto)行使が可能である**——
vetoの代償はbirth-tick非対称性であり、その場合はこれを受け入れた上でREQ-0257 §12.2に明記する必要
がある;(4) **12個のリプレイgoldenはcharge engineに対してblind(見えない)である**(§8.5)——
`goldens.cjs:63`は`unitDefsById`を省略しているため、golden側は`chargeMgr`を一切構築しないが、本番
環境では(`runs.cjs:83-91`)`charge`blockを持つ**54体のliveキャラクター駒のうち42体**に対してこれを
構築している。したがって§4.1bの`advance_cooldown`のrespec(再仕様化)は、ロスターの大半に対する
live(実働)な変更でありながら、いかなるgoldenからも見えない。本REQは**これを修正することを見送り**
(§14 Out)、代わりにlive-defテストを追加する(§15.15);**goldenのこの盲点を解消すること自体を独立
したREQとすべきか、また、それが本REQをブロックすべきかは、ユーザーが判断すべきである。**
**予約日:** 2026-07-18
**スラッグ:** battle-tick-core
**ブランチ:** req-expedition-spec(仕様のみ;実装はREQ-0255のマージ済みベースラインから分岐する)
**依頼者:** user、2026-07-18 — 仕様項目(c)、Q1裁定。
**依存先:** REQ-0255(expedition-merge-baseline)——マージ済みベースラインから分岐すること。今日時
点のmasterからではない。REQ-0258(formation-map-padding)にsoft依存する。0258は
`IBattleInstancesFormationMap.tick()`と`rays[]`をDECLARE(宣言)し、本REQはその`tick()`をIMPLEMENT
(実装)する。もし0258が先に着地すれば、その`sim/lib/formation_map.cjs`に実装する;そうでなければ本
REQがそのファイルを作成し、0258がそれを採用する。両者は衝突しない(0258はring/geometryを、0256は
clockを所有する)。
**ブロック対象:** REQ-0257(ray-flight-entity)、REQ-0259(battle-mode-verb-gating)、REQ-0263
(expedition-instance-hud——`cooldownSkills`がそのデータソースである)。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q1, §3 C1, §4。

## 1. ゴール

3つのことを、1つのREQにまとめる。なぜならそれらは1つの書き直しだからである:

1. 優先度イベントキュー方式のシミュレーターを**0.01秒のtickループ**に置き換える。`sim/lib/heap.cjs`
   (`EventHeap`)は廃止される。
2. **`IBattleInstance`**を導入する:各バックパックは、そのPO群+SI群+キャラクター駒自身のエフェクトを融合したFLAT(平
   坦)な`cooldownSkills`マップを持つ、1つのインスタンスにコンパイルされる——構造的にはmonsterの平
   坦なスキルリストと同一である。
3. determinism(決定性)の根拠を、`(t, seq)`のtie-break(同点判定)ではなく**tick順序**に置き直す。

Ray flightは本REQの範囲外である。Rayは引き続き1tick内で瞬時に解決される(§11)。

## 2. これを承認する裁定

Q1裁定、原文まま:

> **シムを全面tick化** — the server sim is rewritten to a 0.01s tick loop. Ray flight is PHYSICAL
> and changes combat results. Goldens / determinism gate / forecast parity / S4 baselines all
> rebaseline.

(訳:サーバー側simは0.01秒のtickループに書き直される。Ray flightはPHYSICAL(物理的)であり、戦
闘結果を変化させる。Golden群・determinismゲート・forecast parity・S4ベースラインは全てrebaseline
される。)

そして仕様項目(c)、原文まま:「仮に0.01秒tickだとして」。この「仮に」という語こそが、`TICK_SECS`
が定数ではなくTUNABLE(調整可能な値)である理由である(§5)。

## 3. 本REQがSUPERSEDE(置き換え)するもの——パラフレーズではなく引用

`docs/llm_managed/combat_spec_draft.md`はLLM-owned(LLMが所有する)ファイルであり、本REQはこれを編
集する。以下が、消滅する行の正確な引用である。

### 3.1 §1.1 — コアループ(58-59行目)、原文まま

> Combat is **not ticked**. It is a single **priority event queue** keyed on an absolute
> `t` in **seconds (float64)**. The simulator pops the earliest event, applies it, and
> pushes any follow-ups.

(訳:戦闘はtick化されていない。絶対値`t`(**秒、float64**)をキーとする単一の**優先度イベントキュー**
である。シミュレーターは最も早いイベントをpopし、それを適用し、後続のイベントをpushする。)

**SUPERSEDED(置き換え済み)。** 戦闘は実際にはtick化されている。§1.1の63-70行目にある擬似コードブ
ロック(`ev = queue.popMin()` … `schedule(ev.followups)`)は、§7のループに置き換えられる。

### 3.2 binding-inputsの行(32-33行目)、原文まま

> Binding inputs honored: auto-battle (no mid-run input); seconds with decimal `[lo,hi]`
> ranges, **no ticks**;

(訳:尊重されるbinding input:auto-battle(実行中の入力なし);小数`[lo,hi]`範囲を持つ秒指定、**tick
なし**;)

**SUPERSEDEされるのはちょうど1つの節のみである。** "no ticks"は消滅する。**"seconds with decimal
`[lo,hi]` ranges"はSURVIVES(存続)する**——`every_secs.s = [lo,hi]`は引き続きauthoring(コンテン
ツ制作)上の単位であり、秒・floatのままである。これこそがquantization seam(量子化の継ぎ目、§9)の
要点である:authoringは秒のまま留まり、整数になるのはSCHEDULER(スケジューラー)だけである。Q1を、
コンテンツをtickへと作り直すものと読んではならない。

### 3.3 §1.2 — tie-break(同点判定、84-85行目)、原文まま

> - **Tie-break (critical):** events at equal `t` order by stable `(t, seq)`, `seq` a
>   monotone integer assigned at schedule time. Same seed ⇒ same `seq` order ⇒ identical run.

(訳:**Tie-break(重要):** 等しい`t`を持つイベントは、安定した`(t, seq)`で順序付けられる。`seq`は
スケジュール時に割り当てられる単調増加の整数である。同一seed ⇒ 同一`seq`順序 ⇒ 同一のrun。)

**SUPERSEDED**——ORDERING LAW(順序付けの法則)としては置き換えられる(§10のtick内total orderに置
き換えられる)。**`seq`自体はwire field(通信フィールド)としてSURVIVES(存続)する**——それは引
き続き、発行される全イベントに刻印される単調増加の整数のままである。なぜならreplay log、
`shared/dto.ts`の`ApiRunEvent.seq`(447行目)、そしてあらゆるclient側の消費者がそれを読むからであ
る。`seq`は順序付けのINPUT(入力)であることをやめ、発行順のOUTPUT(出力)になる。この区別は
load-bearing(構造を支える)ものである:§6は`heap.nextSeq()`が3つのモジュールから呼ばれていること
を示しており、それらの呼び出しは全て引き続き動作しなければならない。

### 3.4 まるごと消滅するセクション

| §§ | 結末 |
|---|---|
| §1.1(コアループ) | **DIES(消滅)。** tickループへと書き直される。 |
| §1.2の第4項目(tie-break) | **DIES(消滅)。** §10に置き換えられる。§1.2の他3項目(master seed、named sub-streams、OQ1 float64/server-only)は**原文のままSURVIVE(存続)する**。 |
| §1.4(Simulated vs pre-computed) | **実質的にSURVIVES(存続)するが、1節のみ消滅する。** "Simulated live (event by event)"という見出しは"Simulated live (tick by tick)"になる。そこで定義されるcompile-foldの継ぎ目こそ、§8が拡張する対象そのものである。**[LOCKED OQ2]はそのまま残る。** |
| §1.5(Replayイベントログ形式) | **SURVIVES(存続)。** JSONLの形、`t`、`seq`、および列挙されている全イベントはその意味を保つ。`t`は今後常に`TICK_SECS`の倍数になる。ray eventを変更するのはREQ-0257の役割である。 |

**briefへの訂正。** brief §3 C1は「**combat_spec §1.1/§1.4/§1.5はSUPERSEDEされる。**」と述べてい
る。ファイルを実際に検証すると:**これは2セクション分、over-claim(過大に主張)している。** §1.4
は1語("event by event")を失うのみで、そのcompile-boundaryに関する裁定全体を保持している——これは
本REQがsupersedeするものではなく、依存するものである。§1.5は本REQによって一切touchされない;その
ray eventはREQ-0257で変わるが、その`t`/`seq`/JSONL契約は両REQを通じて存続する。実際に消滅するセク
ションは**§1.1と§1.2のtie-break項目のみ**である。ここで§1.5をsupersedeしてしまうことは、replayの
wire formatを壊してよいという許可証になってしまうが、それはQ1が求めているものでは全くなく、かつ
monitorをも黙って道連れにしてしまうことになる。

## 4. 検証済みの現状(以下は全て自分で読んで確認した)

| 事実 | 出典 | 根拠 |
|---|---|---|
| ループの正体はheap pop | `sim/lib/encounter.cjs:576-578` | `while (heap.size() > 0 && guardIters < 200000) { … const ev = heap.popMin();` |
| 順序は`(t,seq)` | `sim/lib/heap.cjs:11-15` | `_less(i,j) { … if (A.t !== B.t) return A.t < B.t; return A.seq < B.seq; }` |
| `EventHeap`のimportは1箇所のみ | `sim/lib/encounter.cjs:6` | `const { EventHeap } = require('./heap.cjs');` — ツリー内で唯一のimport |
| …そしてre-exportも1箇所のみ | `sim/combat.cjs:50,68` | `const heap = require('./lib/heap.cjs');` / `EventHeap: heap.EventHeap,` |
| `combat.EventHeap`にconsumer(利用者)は皆無 | `sim/tests`、`server/`、`client/`、`shared/`をgrep | ヒット0件。このpublic exportは死重(dead weight)であり、削除しても何も壊れない。 |
| `TICK_SECS`は存在しない | `sim/lib/core.cjs:9-99` | `TUNABLES`にはtick系の定数が一切存在しない |
| status tickはスケジュールされたイベントである | `sim/lib/encounter.cjs:561,590` | `heap.push({ t: t0 + TUNABLES.STATUS_TICK_PERIOD_SECS, seq: heap.nextSeq(), kind: 'status_tick' });` |
| compileは複数の別々のリストを返す | `sim/lib/compile.cjs:373` | `return { bps, pos, sis, formationId, squadSlot, box, linkEdges };` |
| enemyは既にflat(平坦)である | `sim/lib/encounter.cjs:531-535` | `e.raw.skills.forEach((skill, sIdx) => { if (skill.trigger && skill.trigger.t === 'every_secs') { enemySchedulable.push(…) } })` |
| POに対するcadence倍率はHARDCODED(直書き)で1.0 | `sim/lib/encounter.cjs:518` | `const cadenceMultFor = () => 1.0; // cadence buffs folded at compile-time (OQ2); no per-actor Haste/Chill on POs in v1 scope.` |
| …ただしcharge managerが存在する場合を除く | `sim/lib/encounter.cjs:146-153,670` | `playerCadenceMult(ownerUid)` → `Math.max(0.2, cadenceMultiplier(bp.statusBag))`、`chargeMgr`が存在する場合ONLY(のみ)`scheduleEffect`に渡される |
| enemyのreschedule(再スケジュール)は常に1.0 | `sim/lib/encounter.cjs:723` | `if (s && s.raw.alive) scheduleEffect(heap, rng, s.ownerUid, s.effIdx, s.effect, ev.t, 1.0);` |

### 4.1 素朴な書き直しが踏む3つの地雷

本REQが単なる「ループを差し替えてgenを再実行するだけ」で済まない理由がこれである。それぞれ実際に
コードを読んで発見したものであり、見落とせばいずれもhard blocker(致命的な障害)になる。

**(a) `heap.nextSeq()`はheapの外側で広く使われているSEQ ALLOCATOR(seq割り当て器)である。** heap
は単なるqueueではなく、replay log全体のための単調増加カウンターサービスでもある。`heap.nextSeq()`
の呼び出し箇所を実測すると:

| module | 件数 | 備考 |
|---|---|---|
| `sim/lib/encounter.cjs` | 30 | あらゆる`events.push({ t, seq: heap.nextSeq(), … })` |
| `sim/lib/unit_charge_encounter.cjs` | 6 | 109, 134, 144, 161, 172行目——managerはこの目的のためだけにheapをHANDED(渡され)る(`encounter.cjs:141`の`createEncounterChargeManager({ …, heap, … })`) |
| `sim/lib/skills.cjs` | 1 | 306行目、`scheduleEffect`内 |

したがって`EventHeap`は単純に削除することができない:**seq allocatorはheapの廃止後もSURVIVE(存続)
しなければならない。** これを`SeqCounter`(§6.2)へ抽出する。`unit_charge_encounter.cjs`の`heap`引数
はリネームされるが、その振る舞いは変わらない——このファイルは一度も`heap.push`しておらず、割り当て
るだけである(検証済み)。

**(b) `chargeOps.advanceCooldown`はheap配列の内部にREACHES INTO(直接手を伸ばして)いる。**
`sim/lib/encounter.cjs:82-93`、原文まま:

```js
advanceCooldown(bpId, n, t) {
  const uids = new Set(troopPos.filter(p => p.bpId === bpId).map(p => p.uid));
  if (!uids.size) return;
  let changed = false;
  for (const e of heap.a) {
    if (e.kind === 'skill_fire' && uids.has(e.ownerUid)) {
      const nt = Math.max(t, e.t - n);
      if (nt !== e.t) { e.t = nt; changed = true; }
    }
  }
  if (changed) { const items = heap.a.splice(0); for (const it of items) heap.push(it); }
}
```

これはREQ-0212の`advance_cooldown` charge verb(動詞)である。スケジュール済みの`skill_fire`イベン
トをその場でmutate(変更)し、re-heapify(heapを再構築)する。**heapが消滅すれば、これは拠り所
(substrate)を失う。** そのtickモデル上の等価物は、直接的で遥かにシンプルな`remainingTicks`の減算
である——§8.4。これは本REQにおける単一最大のbehavioural risk(振る舞い上のリスク)であり、それを
裏付ける2つの事実はいずれもMEASURED(実測済み)である:

- **54キャラクター駒中42体においてLIVE(実働)である。** 本番環境は`unitDefsById`を渡すため
  (`server/services/runs.cjs:83-91`)、`charge`blockを持つ**54体中42体のliveキャラクター駒**につい
  て`bp.charge`がセットされ、charge managerが実際に構築される(`encounter.cjs:40,140`)。これはロス
  ター大半における実際のgameplay変更であり、fixtureだけの話ではない。(`compile.cjs:142-144`のコメ
  ントは逆のことを主張しているが、それはSTALE(陳腐化)している。実測とその全面的な訂正はREQ-0263
  §5.5にあり、§8.5でも再掲する。)
- **12個のリプレイgoldenはこれをCANNOT see(見ることができない)。** `sim/tests/goldens.cjs:63`は
  `unitDefsById`を省略しているため、全goldenは`UNIT_DEFS = {}`でコンパイルされ、`chargeMgr`を一切構
  築しない。したがって構造上、§13.1のdiffはここについて何も語らない。

したがってguard(防御網)はgoldenでは**ない**。`sim/tests/unit_charge_encounter_test.cjs`
(23/23——§12で実測)こそが、このpathを実際に運動させるONLY(唯一)のゲートであり、それに加えて
§8.5が本REQに追加を求めるlive-defケースがある。respec(再仕様化)の内容とそれを何がカバーすべきか
は§8.5が詳しく述べる。

**(c) `encounter_end`のTIMESTAMP(タイムスタンプ)はheapの次イベントから読み取られている。**
`sim/lib/encounter.cjs:788`、原文まま:

```js
events.push({ t: heap.size() ? heap.a[0].t : deadlineSecs, seq: heap.nextSeq(), ev: 'encounter_end', enc: encIndex, result, troop_bp_hp: troopBps.map(b => b.hp) });
```

`heap.a[0].t`とは「まだ発火していないNEXT(次)のイベントが発火していたはずの時刻」であり、tickル
ープには存在しない量である。**これはportする(そのまま移植する)のではなく、respecify(再仕様化)
しなければならない。** 裁定:`encounter_end.t`は**ループがbreak(離脱)したtick**、すなわち
`currentTick * TICK_SECS`になり、ループがdeadlineによって終了する場合は`deadlineSecs`にfall back
(後退)する。理由:これは「このencounterはいつ終わったか」という問いに対する正直な答えである——旧
来の式が答えていたのは「次に何かが起きていたとしたらいつだったか」であり、それはencounterについて
の事実ではなく、queueというもののartifact(副産物)にすぎなかった。これにより、あらゆるgoldenにお
いて`encounter_end.t`が変化する。golden diff上ではバグのように見えるため、ここで明示的に指摘してお
く——実際にはバグではない;§13.1がreviewerに、どこを見ればよいかを教える。

なお、`tickAndEmit`(`sim/lib/encounter.cjs:792-798`)は`status_tick`イベントを**`seq`フィールドを
全く持たないまま**pushしている(795-796行目)——これは他の全emitterとの間に既存する不整合である。
**本REQではこれを直さないこと。** これはgolden内の1バイトであり、ここで直せば、無関係な修正を、た
だでさえ大きいrebaselineに混入させることになる。follow-up(後続対応)として記録しておく。

## 5. `TICK_SECS` — そのTUNABLE(調整可能値)

**`sim/lib/core.cjs`の`TUNABLES`への新規エントリー**(9-99行目のテーブル):

```js
// REQ-0256 (spec c, ruling Q1): the sim's tick period. The user's directive says
// "仮に0.01秒tickだとして" -- PROVISIONALLY 0.01s. It is a TUNABLE for that reason:
// the number is a design choice the user may move, not a law. NOTHING may hardcode
// 100 (= 1/TICK_SECS) or 0.01. Every seconds->ticks conversion goes through
// secsToTicks() so there is ONE place the quantization happens.
TICK_SECS: 0.01,
```

**simは100をhardcode(直書き)してはならない。** これはstyleの問題ではない。`TICK_SECS`は3つの派生
量に登場し、そのいずれも使用箇所でDERIVED(導出)されなければならず、リテラルとして書いてはならな
い:

| 派生量 | 式 | 現在の値 |
|---|---|---|
| status tickのcadence(周期) | `STATUS_TICK_TICKS = secsToTicks(TUNABLES.STATUS_TICK_PERIOD_SECS)` | 100 |
| roll済みのcooldown | `secsToTicks(rolledSecs)` | 一定しない |
| rayのdiagonal(斜め移動)cadence | `TUNABLES.RAY_TICKS_PER_DIAGONAL` | 4 — **これを追加するのは本REQではなくREQ-0257である** |

**ゲートを追加する**(`sim/tests/run.cjs`):`sim/lib/*.cjs`をTEXT(テキスト)としてgrepし、tickの
文脈で裸の`100`や`0.01`が現れないことを確認し、さらに`secsToTicks(1.0) === 100`が成り立つのはBECAUSE
(なぜなら)`TICK_SECS === 0.01`だからに過ぎないことをassertする——つまり、誰かが`TICK_SECS`を0.02
に動かしたのにsimが依然として0.01であるかのように振る舞っていたら、そのテストはFAILS(失敗)する。
先例:`sim/tests/forecast_parity.cjs:187-189`はまさにこの理由で、shared/境界をまたいで
`RAY_STEP_BUDGET` / `ENTRY_JITTER_HALF_WIDTH`をpinしている。誰もcheckしないtunable(調整可能値)は、
手間が増えただけの定数である。

## 6. `sim/lib/heap.cjs`の廃止 — consumer(利用者)の全数調査

### 6.1 全consumer、検証済み

`EventHeap|heap\.cjs|require.*heap`をツリー全体に対してgrepした(`node_modules`は除く)。**以下が
COMPLETE(完全)なリストであり、これで全てである:**

| file:line | 内容 | 結末 |
|---|---|---|
| `sim/lib/encounter.cjs:6` | `const { EventHeap } = require('./heap.cjs');` | **DELETE(削除)** |
| `sim/lib/encounter.cjs:27` | `const heap = new EventHeap();` | `const seq = new SeqCounter();`へ**REPLACE(置換)** |
| `sim/combat.cjs:50` | `const heap = require('./lib/heap.cjs');` | **DELETE(削除)** |
| `sim/combat.cjs:68` | `EventHeap: heap.EventHeap,`(public export) | **DELETE(削除)**——consumerゼロ(§4) |
| `sim/lib/heap.cjs` | ファイル本体(54行) | **DELETE(削除)**。ただし§6.3参照——47-50行目のdir-vectorコメントブロックはコードではなくorphaned(取り残された)散文である |

`heap`をPARAMETER(引数)として受け取り、`nextSeq()` / `push()`しか呼ばない間接的なconsumer:

| file:line | シグネチャ | 結末 |
|---|---|---|
| `sim/lib/skills.cjs:301` | `scheduleEffect(heap, rng, ownerUid, effIdx, effect, encounterStart, cadenceMult, pushEvFn)` | **ENTIRELY(丸ごと)DELETED(削除)**——§8.3。その本体全体がheapへのpushである。 |
| `sim/lib/unit_charge_encounter.cjs`(6箇所) | `createEncounterChargeManager({ …, heap, … })` | フィールド`heap` → `seq`へ**RENAME(改名)**。pushは一度も行わず、割り当てるのみ。振る舞いは同一。 |

### 6.2 heapの何がSURVIVE(存続)するか:`SeqCounter`

`heap.nextSeq()`の呼び出し箇所は37ある(§4.1a)。そのいずれも、heapを取り除いた後のheapのカウンタ
ーそのものである、わずか4行のオブジェクトに対して、引き続き動作し続ける:

```js
// sim/lib/seq.cjs -- REQ-0256. The replay log's monotone emission counter.
// This is EventHeap's _seq, extracted: the heap retired (REQ-0256) but `seq`
// is a WIRE FIELD (shared/dto.ts ApiRunEvent.seq) that every replay consumer
// reads, so the counter outlives the queue that used to own it. It no longer
// ORDERS anything -- ordering is the tick loop's (REQ-0256 s10) -- it only
// stamps emission order onto the log.
class SeqCounter {
  constructor() { this._seq = 0; }
  nextSeq() { return this._seq++; }
}
```

`core.cjs`に畳み込むのではなく、独立した`sim/lib/seq.cjs`に置く:`core.cjs`はtunables+deepCopyの純
粋なテーブルであり(そのヘッダー自身がそう述べている)、状態を持つカウンターはそこに属するもので
はない。

### 6.3 orphanになったコメントを失わないこと

`sim/lib/heap.cjs:47-50`には、heapについてのものでは**ない**コメントブロックが存在する:

```
// Diagonal direction vectors (S2.2/S3): (drow,dcol) terms.
// down-right=(+1,+1)  down-left=(+1,-1)  up-right=(-1,+1)  up-left=(-1,-1)
```

これはREQ-0047のファイル分割がheaderを置き去りにしたものである(同じパターンは`rng.cjs:42-45`——
event queueについてのコメントを持つ——や、replay helperについてのコメントを持つ`field.cjs:22-26`に
も存在する)。このコメントが文書化しているのは`geometry.cjs`の`DIR_VEC`である。`heap.cjs`を削除す
る際、この散文を消してはならない——本来これは`DIR_VEC`が実際に存在する`sim/lib/geometry.cjs:7`に属
すべきものである。同様に、`rng.cjs:42-45`の"Event queue -- binary min-heap keyed on (t, seq)"(イ
ベントキュー——`(t, seq)`をキーとする二分min-heap、の意)というコメントは、heapが消滅した瞬間に
FALSE(偽)になるため、同じcommit内で削除しなければならない。削除済みのsubsystem(サブシステム)を
説明する陳腐化したコメントは、コメントが無いことよりも悪い。

## 7. tickループ

`sim/lib/encounter.cjs`の`runEncounter`(832行)は、その構造をENTIRE(丸ごと)保つ——15-573行目の
compile、actor構築、attachment、pulse、hp-below、chargeのscaffolding(下地組み)は無傷のままである。
**書き直されるのは575-756行目のdriver(駆動部)のみである。** これは832行中およそ180行にすぎない。

### 7.0 `Battle`オブジェクト — `sim/lib/battle.cjs`(新規)

brief §4は`Battle`をnormative(規範)とし、仕様項目(b)はその存在を前提としている:「Battle」という
クラスがその二つの参照を持っていると仮定して続けます。ツリー内には今日、これを作るものが何もない。
**本REQがこれを作る。**

```js
// sim/lib/battle.cjs
createBattle({ playerMap, enemyMap, modeConfig, fire, rollCooldownTicks }) -> Battle

Battle
  playerMap  : IBattleInstancesFormationMap   // spec b -- REQ-0258's formation_map.cjs
  enemyMap   : IBattleInstancesFormationMap   // spec b
  modeConfig : BattleModeConfig | null        // RESERVED HERE, POPULATED BY REQ-0259 -- see below
  tickIndex  : int                            // the clock. THE integer tick counter (s10.3)
  t()        : float                          // === tickIndex * TICK_SECS. COMPUTED, never accumulated
  tick()                                      // spec c: the chain. See s7.1.
```

**`modeConfig`はreserved(予約)されているだけで、実装はされていない。** 0256はこのfieldを宣言し、
`null`で初期化する。**0256内のどこもこれを読まない**——ちょうど`IBattleInstance.mode`がここで
declared-but-inert(宣言はされるが不活性)であるのと同じである(§8.3)。これに値を入れるのはREQ-0259
であり、これに意味を与えるREQは0259だけである。ここで名前だけ用意しておくのは、0259が埋めるべき
fieldを持てるようにするためであり、そのために`battle.cjs`の形を改めて開く必要がないようにするため
である。

**`Battle`は`runEncounter`がDRIVES(駆動)するVALUE(値)であり、ループの新しい住処ではない。** これ
は1つの意思決定であるため、単なるデフォルトの帰結ではなく、その正当化根拠をここに示す:

- **`runEncounter`は832行あり、そのうちdriverはおよそ180行にすぎない。** 残りおよそ650行はcompile、
  actor構築、attachment、pulse、hp-below、chargeのscaffoldingである(§7前文)。ループを`Battle`に移
  すと、その全scaffolding——あるいはその一つ一つに対するcallback——を、既に12個全てのgoldenを
  rebaselineしている同じREQの中で、新しいmodule境界をまたいで引きずることになる。**1回のrebaseline
  に無関係な大きなdiffを2つ持ち込むことは、まさに§11が0256/0257について反対している事態そのもので
  ある。** そしてこの論拠は、2つ目のdiffがrefactorであるからといって適用されなくなるわけではない。
- **fireの本体はそのままの位置に留まる。** `Battle`/map/instanceには、`runEncounter`の既存scope上
  のclosureとして`fire`と`rollCooldownTicks`が渡される。chainが決めるのはWHEN(いつ)とWHAT ORDER
  (どの順序で)であり、fireが何をするか(WHAT)は引き続き`runEncounter`が所有する。既存のfire本体は
  1つも移動しない。
- **`runEncounter`はentry point(入口)、termination check(終了判定)、resultを保持し続ける。** これ
  らはencounterレベルの状態(deadline、attachment、`encIndex`、events配列)を読むが、それはBattleの
  管掌するところではない。`Battle`が所有するのはclockとtick chainのみであり、それが所有する全てで
  ある。

したがってその関係は次の通りである:**`runEncounter`はcompileの後で1つの`Battle`を構築し、tickご
とに1回`battle.tick()`を呼び、自分自身のtermination判定を行う。** follow-up REQが後になって
scaffoldingを`Battle`の裏に移すかもしれないが、本REQはそれを行わず、§14はそれをOUTとして記録する。

### 7.1 ループ

```js
const seq = new SeqCounter();
const TICK = TUNABLES.TICK_SECS;
const deadlineTicks = secsToTicks(deadlineSecs);
const STATUS_TICK_TICKS = secsToTicks(TUNABLES.STATUS_TICK_PERIOD_SECS); // 100 today

// s7.0: runEncounter builds the Battle from what compile() produced, then DRIVES it.
const battle = createBattle({
  playerMap : createFormationMap({ instances: playerInstances }),  // REQ-0258's formation_map.cjs
  enemyMap  : createFormationMap({ instances: enemyInstances }),
  modeConfig: null,               // s7.0: RESERVED. REQ-0259 populates it; nothing here reads it.
  fire,                           // the existing fire closures, unchanged -- s7.0
  rollCooldownTicks,              // s8.5
});

for (; battle.tickIndex <= deadlineTicks; battle.tickIndex++) {
  const t = battle.t();           // === tickIndex * TICK. NEVER `t += TICK` -- see s10.3
  simNow = t;
  if (hasAtt) checkAttachmentTimeouts(t);

  // 1. status cadence -- fires on the 100-tick boundary, NOT every tick (s7.2)
  if (battle.tickIndex > 0 && battle.tickIndex % STATUS_TICK_TICKS === 0) { …existing status_tick body verbatim… }

  // 2. THE CHAIN (spec c, brief s4). This is the whole of the fire step: battle ticks ->
  //    maps tick -> instances tick. The s10 total order is the chain's own shape (s7.1a).
  battle.tick();

  // 3. REQ-0048 pulse arrivals scheduled for THIS tick
  drainPulseArrivals(battle.tickIndex, t);

  // 4. termination -- the existing s743-755 block, verbatim
  if (…allEnemiesDead()… ) { result = 'clear'; break; }
  …
}
```

#### 7.1a チェーン — 誰が何を呼ぶか

仕様項目(c)は、tickがCASCADE(連鎖)することを要求する:**Battleがtickする -> mapがtickする ->
instanceがtickする。** brief §4はその中間のlinkを原文まま述べている:*"`tick()` // spec c: forwards
tick to instances, then advances rays"*(訳:`tick()` // spec c:tickをinstance群へ転送し、その後
rayを前進させる)。したがって上記のループは、fireを歩く処理をinlineで持たず、それを委譲する。この
chainの3階層は、§10.1のtotal order(全順序)の3階層——map、instance、slotの順——そのものである。だ
からこそ、このchainは単なるspec準拠にとどまらない:それはtotal orderを構造そのものとして体現した
ものであり、もしフラットなループにしていたら、その順序を別の場所にもう一度書くことになり、そこで
drift(ズレ)が生じ得た。

```js
// sim/lib/battle.cjs
tick() {
  // Phase A -- FIRES. Map order per s10.1: player, then enemy.
  this.playerMap.tickInstances();
  this.enemyMap.tickInstances();
  // Phase B -- RAY ADVANCES. Map order per REQ-0257 s12.3.
  this.playerMap.tickRays();      // NO-OP in 0256: rays[] is always empty (s11). REQ-0257 fills it.
  this.enemyMap.tickRays();
}

// sim/lib/formation_map.cjs (REQ-0258 declares the file; this REQ implements these two)
tickInstances() {
  for (const inst of this.instances) {      // stable instance index order (s10.1)
    if (inst.alive) inst.tick();
  }
}
tickRays() { /* REQ-0257 s12.1. Empty list in 0256 -> no-op. */ }
tick() { this.tickInstances(); this.tickRays(); }   // brief s4's single-map entry point; see below

// IBattleInstance
tick() {
  for (const [slot, cd] of this.cooldownSkills) {   // insertion order = slot order (s8.4)
    cd.remainingTicks -= 1;
    if (cd.remainingTicks > 0) continue;
    this.fire(slot, cd.skill);                      // existing fire bodies, unchanged
    cd.remainingTicks = this.rollCooldownTicks(slot, cd.skill);   // s8.5 RESET
  }
}
```

**`map.tick()`は2つのフェーズメソッドにSPLIT(分割)され、`Battle`は`tick()`ではなくその各フェーズ
を呼ぶ。これはbrief §4に対する、意図的でuser-visible(ユーザーから見える)な洗練であり、flagged
(明示的に示すもの)であって、smuggled(こっそり紛れ込ませたもの)ではない。** 理由は、brief §4が
`tick()`を1つのmapに対して書いたのに対し、実際にはmapが2つ存在するからである:

- brief §4の単一の`tick()` = mapごとにinstance群、**その後**rays群。mapが2つあると、これは
  `playerInstances, playerRays, enemyInstances, enemyRays`という順序に合成される。
- REQ-0257 §12.1が要求するのは`playerInstances, enemyInstances, playerRays, enemyRays`——**全て**の
  fireの後に**全て**のadvance、という順序である。

これらは**同じ順序ではなく**、その違いはcosmetic(見た目だけの問題)ではない。Rayは、それがfireさ
れたONTO(その上へと)map上に存在する(REQ-0257 §6)。したがって、あるplayer instanceのfireは
`enemyMap.rays`にrayを生む。map単位の合成の下では、そのrayが生まれた時点で`enemyMap`はまだtickして
いないため、そのrayは自らのbirth tick(誕生tick)上でadvance(前進)してしまう。一方、あるenemy
instanceのfireは`playerMap.rays`にrayを生むが、`playerMap`はALREADY(既に)tick済みであるため、その
rayは自らのbirth tick上ではadvanceしない。**player側のrayは、2つのmapがたまたま合成された順序以外
に理由がないまま、enemy側のrayより1tick早く到達してしまうことになる**——これはまさに、REQ-0257
§12.2が拒否しているbirth-order(誕生順)結合であり、§10.2が既に受け入れているものの上に積み重なる、
体系的なplayer側優位である。Phase分割はこれを取り除く:両陣営とも、あらゆるrayは、fireから最初の
diagonal(斜め移動)までにちょうど`RAY_TICKS_PER_DIAGONAL`tickを要する。

`tick()`は、brief §4のnormativeな単一map向けentry pointとしてmap上にretained(保持)される(これは
正確に`tickInstances(); tickRays()`である)が、**`Battle`はこれを呼ばない**——mapが2つある以上、こ
れでは§12.1の順序を表現できないためである。spec (c)が求めるcascadeは完全に無傷である:Battle ->
map -> instance、各階層につき1回の呼び出し。分割されるのはmap内部の「1メソッドである」という性質
のみであり、それもmapが2つ存在するという理由に限られる。**これは解釈であり、ユーザーはこれをveto
(拒否)することができる**(Statusブロック参照);vetoの代償は上記のbirth-tick非対称性であり、その
場合はこれを受け入れた上で0257 §12.2に文書化する必要がある。

### 7.2 Statusのtick処理:毎tickではなく100tickごと——その理由

これは本REQの中で最もsubtle(繊細)な正しさのポイントである。現状、`tickAndEmit`
(`sim/lib/encounter.cjs:793`)は次を呼んでいる:

```js
const ticks = tickStatuses(actor.statusBag, TUNABLES.STATUS_TICK_PERIOD_SECS);
```

ここで渡しているのは**delta(差分)ではなく`P`(=1.0)そのもの**である。そして`tickStatuses`
(`sim/lib/status.cjs:139-174`)は次のことを行う:

```js
bag._acc = (bag._acc || 0) + dtSecs;
if (bag.Stun) { bag.Stun.remain -= dtSecs; … }        // line 146
if (bag.Weakness) { bag.Weakness.remain -= dtSecs; … } // line 147
if (bag.Haste) { bag.Haste.remain -= dtSecs; … }       // line 148
while (bag._acc >= P) { bag._acc -= P; …Burn/Poison/Chill/Regen… }
```

素朴に「毎tick、dt=0.01で呼ぶ」とした場合、静かに壊れる帰結が2つある:

1. **Stun/Weakness/Haste の`remain`は、現状1.0秒GRANULARITY(粒度)でカウントダウンしている**。な
   ぜなら`dtSecs`は`P`そのものだからである。143行目のコメントは"real time, not period-quantized"
   (訳:period量子化されていない、実時間)と主張しているが——**そのコメントはFALSE(偽)である**。
   そしてそれは、この関数の唯一の呼び出し元が`P`を渡すようになって以来ずっとそうだった。`dt=0.01`
   で呼ぶようにすればそのコメントはTRUE(真)になるが、それは改善のように聞こえて、実際にはtickの
   書き直しの中に埋もれた、ゲーム内の全Stun/Weakness/Haste持続時間に対する、要求されていないバラン
   ス変更である。**やってはならない。**
2. **Floatのdrift(ズレ)。** `0.01`はbinary-representable(2進数で正確に表現可能)ではない。
   `_acc += 0.01`を100回積み上げると`1.0000000000000007`になり、そのdriftは600秒のdeadlineを通じて
   複利的に積み重なる。100tickに1回`P`を渡すことで、`_acc`は現状通りの正確な0→1.0→0のサイクルに
   留まる。

**裁定:status tickは`STATUS_TICK_TICKS`ごとに発火させ、引き続き`P`を渡す。** これにより現状の
status semantics(意味論)をEXACTLY(正確に)再現する。これはconservative(保守的)な選択であり、か
つ正しい選択でもある:本REQが動かすのはSCHEDULERであって、statusシステムではない。143行目の偽のコ
メントは同じcommit内で直すこと(コストはゼロであり、かつ積極的にmisleading(誤解を招く)ものだから
である)。

なお現状`STATUS_TICK_TICKS = secsToTicks(1.0) = 100`であり、これは正確である。将来`TICK_SECS`が
`P`を割り切らない値になった場合、`secsToTicks`はroundし、cadenceは`P`から1tick未満だけdriftする——
これは許容範囲であり文書化済みだが、それに気づくのは§5のgateである。

### 7.3 このループが変えないもの

あらゆるfire本体——`fireSkillRay`呼び出し、telegraph(予告)発行、REQ-0078のreactive dispatch
(`encounter.cjs:624-641, 700-711`)、REQ-0095のplayer側dispatch(462-515)、REQ-0121の`on_hp_below`
watcher群(212-277)、REQ-0049のattachment解決(279-399)、REQ-0200のchargeフック群(34-153, 584-589,
645-662, 712-720)、REQ-0212の`transfer_status` / `breakShield`操作(94-138)——は**原文のまま持ち越
される**。これらは異なるdriverから呼ばれるようになるだけであり、その本体は違いを一切知らない。変
わるのはそれらのSCHEDULING(スケジューリング)のみである。

`heap.push({kind:'pulse_arrive'})`(`encounter.cjs:408`)は、skillではないスケジュール済みイベント
の唯一の例である。これは、§7.1のstep 3でdrainされる`Map<tickIndex, PulseArrival[]>`になる。
`PULSE_HOP_LATENCY_SECS`(0.15秒)は同じ`secsToTicks`の継ぎ目を通じて量子化される → ちょうど15tick
になる。

## 8. 平坦化(「ビルド」) — `IBattleInstance`

### 8.1 ユーザーが要求していること

brief §1、REQ-0165と突き合わせてsource-verified(原典検証)済み:**バックパック:キャラクター駒の
法則——バックパックとキャラクター駒は1:1であり、あらゆるバックパックはちょうど1体のキャラクター駒
を持ち、キャラクター駒を持たないバックパックは存在し得ない。** したがって**IBattleInstance(player
側) == 1つのバックパック**であり、そのskillはPO群+SI群+キャラクター駒自身のエフェクトを平坦化した
ものである。brief §2、`content/live/dungeon/enemies.json`と突き合わせて確認済み:目標とする形は、
enemyがALREADY(既に)持っているもの(`hp`、`footprint`、`skills[]`)そのものである。player側はそれ
へとコンパイルされる——「平坦化したスキルを持つモンスターと同じ構造」。

### 8.2 変換の中身、正確に

`sim/lib/compile.cjs`の`compileSquadSnapshot`(54行目)は現状、373行目で次を返す:

```js
return { bps, pos, sis, formationId, squadSlot, box, linkEdges };
```

——encounterループがfireの度にre-correlate(再相関)しなければならない、4つの並行リストである
(`encounter.cjs:592-594`は`schedulable.some(...)`の後に`schedulable.find(...)`を行い;810-822行目は
`troopPos.find(p => p.uid === ownerUid)`の後に`troopBps.find(b => b.id === po.bpId)`でre-resolve
〔再解決〕する——fireごとにO(n)のlookupを、3重に行っている)。

**これはreturnフィールドを1つ追加で得るだけであり、何も失わない。**

```js
return { bps, pos, sis, formationId, squadSlot, box, linkEdges, instances };
```

`instances`は`IBattleInstance[]`であり、バックパック1つにつき1個、既存の全folding(compile.cjsの
pass 1-3、279-357行目)のAFTER(後)に走る新しい`buildInstances(bps, pos, sis)`のpassによって構築さ
れる。したがってこれはfinal(最終)でbuff-folded(バフ折り込み済み)のエフェクトを見ることになる。

**なぜ置き換えではなく追加なのか:** `bps`/`pos`/`sis`は`runEncounter`の`troopBps`/`troopPos`/
`troopSis`オプション(`encounter.cjs:17`)によって約40箇所で読まれており、`sim/lib/dungeon.cjs`から
も、S4ハーネスからも読まれている。ループを書き直す同じREQの中でこれらを削除すれば、golden diffの
原因を特定できなくなってしまう。**`instances`が新しい真実であり、flatなリスト群はcompatibility
surface(互換性のための表面)として保持され、全consumerが`instances`を読むようになった時点で、
follow-up REQで削除される。** これはREQ-0184のport note("修正はrebalanceではなく、両者を混ぜると
diffが読めなくなる")と同じdoctrine(教義)であり、brief自身が0256と0257を分割している理由でもある。

### 8.3 `IBattleInstance` — その形

```
IBattleInstance
  id           : string           // the BP id (player) | the enemy ownerId (enemy)
  kind         : 'bp' | 'enemy' | 'gimic'   // 'gimic' arrives with REQ-0259
  squadSlot    : 'unit1'..'unit4' | null      // player side only
  fieldCells   : [row,col][]      // footprint on its OWN map
  hp, hpMax    : number           // BP: VX-1 hpMax (compile.cjs:70). enemy: rolled (packs.cjs)
  alive        : boolean
  mode         : 'battle'|'detection'|'unlock'   // DECLARED here, USED by REQ-0259
  statusBag    : StatusBag        // the existing bag, verbatim
  cooldownSkills : Map<int, { skill: IBattleInstanceSkill, remainingTicks: int }>
```

`mode`は本REQで宣言され、あらゆるinstanceについてデフォルトで`'battle'`になる。**これに意味を持た
せるのはREQ-0259の役割である。** ここで(あちらではなく)宣言しておくことで、2つのREQをまたいで
interfaceが安定する;programの途中で現れるfieldは、2度目のcompile-surface変更を強制することになる。

### 8.4 `cooldownSkills` — PO + SI + キャラクター駒を融合するFLAT(平坦)なmap

キー`int`は**安定したslot index**であり、compile時に決定論的な順序で一度だけ割り当てられる。**その
順序こそがdeterminism(決定性)である**(§10)。したがってそれはiterationの運任せにはせず、正確に
規定する:

```
slot order for a player BP's cooldownSkills, in this exact sequence:
  1. the BP's POs, ordered by ASCENDING po.uid (string compare)   -- source: compile.cjs posRaw
       for each PO: its effects, in DEF ARRAY ORDER (effIdx 0,1,2,...)
  2. the SIs seated in those POs, ordered by ASCENDING si.uid       -- source: compile.cjs sis
       for each SI: its effects, in DEF ARRAY ORDER
  3. the Unit's OWN effects, in DEF ARRAY ORDER                    -- source: UNIT_DEFS[bp.unitId]
```

`trigger.t === 'every_secs'`を持つエフェクトのみが`cooldownSkills`のslotを得る——これは現状の
`schedulable`フィルター(`encounter.cjs:160-166`)、および現状のenemyフィルター
(`encounter.cjs:531-535`)そのものである。Reactive(反応的な)トリガー群(`on_hit`、`OnBPBeenHit`、
`on_hp_below`、`on_link_pulse`、`battle_start`、`passive`、`adjacent`)はcooldown駆動ではなく、既存
のdispatch経路がそのまま維持される。**`cooldownSkills`はTIMED-FIRE(時限発火)のmapであり、「全エ
フェクト」ではない。** 別の名付け方をすれば、誰かがreactiveをこれ経由でroutingしてしまう誘因にな
る。

**なぜarray順ではなくascending(昇順)uidなのか:** `posRaw`の順序は`st.pos.filter(p => p.loc ===
'grid')`(`compile.cjs:156`)——すなわちscenario.jsonのarray順——に由来しており、これはauthoring
(制作)上のincident(たまたまそうなっただけの事情)であって、contract(契約)ではない。`uid`は
instanceごとにmintされ、save(セーブ)をまたいでも安定している。これでsortすることで、slot mapはフ
ァイルのレイアウトではなくDATA(データ)そのものから再現可能になる。これは実質的な(ただし小さな)
振る舞いの変更であり、意図的なものである:これこそが§10のtotal orderをwell-defined(明確に定義さ
れた)ものにする要である。

**monsterのinstanceも同じ方法で構築される**、`e.raw.skills`からdef array順で(その`sIdx`は、現状
`encounter.cjs:531`が使っているものそのものである)。PlayerとEnemyの違いはprovenance(出自)のみで
ある——briefの言う"Same interface, different provenance"(訳:同一interface、異なる出自)。それこ
そがflattening(平坦化)である。

**`IBattleInstanceSkill`**は`{ trigger, verb, attack_profile, modes }`を持つ——これは`goldens.cjs:38`
がmonster skillに対して既に構築している、同じ4フィールドである
(`skillDefsById[s.id] = { trigger: s.trigger, verb: s.verb, attack_profile: s.attack_profile, modes: s.modes }`)。
PO由来のエフェクトについては、`attack_profile`は既存のprecedence(優先順位)を通じて解決される
(`encounter.cjs:163`):`eff.attack_profile || po.def.attack_profile || defaultAttackProfileFor(po)`。
このprecedenceは正確に保持すること;これはあらゆるliveアイテムにとってload-bearing(構造を支える)
ものである。

### 8.5 Tickのsemantics(意味論) — 減算、fire、RESET(リセット)

brief §4および仕様項目(c)による:

```
tick():  for each slot in cooldownSkills (insertion order):
           remainingTicks -= 1
           if remainingTicks === 0:
             fire(skill)
             remainingTicks = rollCooldownTicks(...)   // "数値を戻します"
```

`rollCooldownTicks`こそが、秒がtickになるONLY(唯一)の場所である:

```js
function rollCooldownTicks(inst, slot, skill, t) {
  const s = skill.trigger.s;                                   // [lo,hi] SECONDS, unchanged
  const stream = rng.stream(effectStreamName(ownerUid, effIdx) + '/timing');  // SAME name as today
  const secs = stream.range(s[0], s[1]) * cadenceMultFor(inst);  // s9: multiplier on SECONDS
  return secsToTicks(secs);
}
```

これが置き換える`sim/lib/skills.cjs:301-307`(`scheduleEffect`)と比較せよ:

```js
const stream = rng.stream(effectStreamName(ownerUid, effIdx) + '/timing');
const interval = stream.range(s[0], s[1]) * cadenceMult;
const fireAt = encounterStart + interval;
heap.push({ t: fireAt, seq: heap.nextSeq(), kind: 'skill_fire', … });
```

**stream名、draw(抽選)の順序、そしてmultiply(乗算)はIDENTICAL(同一)である。** 唯一の違いは最後
の行:`encounterStart + interval`の代わりに`secsToTicks(interval)`となっている点だけである。それ
が変更の全てであり、これをそれだけ小さく保つことで、golden diffをquantization(量子化)だけに帰属
させることができる。

**初回のroll**はcompile/battle-start時に行われ、`encounter.cjs:519-526`(player、modeでフィルタ済
み)と`:544`(enemy)を置き換える。streamも順序もmodeフィルターも同じである。

**`advance_cooldown`(§4.1b)はtrivial(自明)かつhonest(正直)なものになる:**

```js
advanceCooldown(bpId, n, t) {
  const inst = instanceOf(bpId);
  if (!inst) return;
  const dTicks = secsToTicks(n);
  for (const cd of inst.cooldownSkills.values()) {
    cd.remainingTicks = Math.max(1, cd.remainingTicks - dTicks);   // s9: floor at 1
  }
}
```

旧バージョンはイベントを`Math.max(t, e.t - n)`までしか引き寄せられなかった——決してNOW(現在時刻)
より前にはならない。新バージョンは1tickでfloor(下限)する——advanceによってTHIS tick(このtick)に
発火することは決してない。**これらは同じルールではなく**、その違いはcharge付きコンテンツに対する
実質的な振る舞いの変更である。

**これは54キャラクター駒中42体に影響するLIVE(実働)なgameplay変更であり、どのgoldenもこれを捉え
ない。** この文の両方の半分は実測されたものである;どちらも本REQの最初のdraftには無く、そのdraft
はこのrespecはunobservable(観測不能)だと主張していた。実際にはそうではない:

| fact | 出典 |
|---|---|
| **54体中42体のliveキャラクター駒が、トップレベルの`charge`blockを持つ**——`alchemist`、`darkknight`、`dragonknight`、`hero`、`jester`、`bard`、`cleric`、… | `content/live/live_units.json`、実測済み;**REQ-0263 §5.5** |
| 本番環境は**実際に**`unitDefsById`を渡している。したがって`bp.charge`はセットされ、`chargeBps`は空でなくなる -> charge managerは**実際に構築される** | `server/services/runs.cjs:83-91`; `sim/lib/encounter.cjs:40,140` |
| goldenは`unitDefsById`を**渡さない**(`baseOpts`がこれを省略している) -> `UNIT_DEFS = {}`でコンパイルされる -> **12個のうちどれ1つとして`chargeMgr`が構築されることはない** | `sim/tests/goldens.cjs:63` |
| `compile.cjs:142-144`のコメント*"no live unit carries a charge block"*(訳:chargeblockを持つliveunitは存在しない)は**STALE(陳腐化)している**——REQ-0129が`vocab.json` v13のcharge blockを出荷しており、ロスターはそれを前提にauthoringされている。その*2番目*の節("unit registryを持たない呼び出し元は`UNIT_DEFS = {}`に解決される")は依然として真であり、実際に効いているのはこちらである。 | `sim/lib/compile.cjs:142-144`; REQ-0263 §5.5 |

**本REQに対する帰結を率直に述べる:12個のリプレイgoldenは`advance_cooldown`に対してBLIND(盲目)で
ある。** §13.1のgolden diffは、本REQにおける単一最大のbehavioural riskについて何も語らない。した
がってgreenなrebaselineは、respecが安全であるというevidence(証拠)には**ならず**、そう読んではな
らない。

**実際にこれをcoverしているのは何か——goldenが語らない以上、名指ししておく:**

1. `sim/tests/unit_charge_encounter_test.cjs`(23テスト、fixture駆動)——**そもそもcharge managerを
   構築するONLY(唯一)のゲートである。** ここでの変動を見込むこと;変動する各assertionは全て、
   floor-at-1ルールに遡って追跡し、REQ内に記録すること(§15.10)。このsuiteは、そのサイズをはるか
   に超えてload-bearingになっている:これは片隅のunit testではなく、網そのものである。
2. `sim/tests/unit_charge_test.cjs`(13テスト)——charge runtime、encounterなし。
3. **本REQが要求するNEW(新規):** **live**なunit defの上に構築された`advance_cooldown`ケース——42体
   のうち1体(最もシンプルなのは`alchemist`の`{every_secs, fire_on_full, [2,3]}`)について
   `unitDefsById`を渡し、pull後のcooldownをassertする。既存の23件はsynthetic(合成)なfixtureを使っ
   ており、この動詞がplayerが実際にfieldできるコンテンツ上で機能することを、現状は何一つ証明して
   いない。§15.15。

**goldenのcharge盲目性を修正することはOUT(範囲外)である**(§14)——`unitDefsById`を`baseOpts`に渡
せば、goldenが何をsimulateするかが変わってしまう。これはtest fixの体裁をしたcontract変更であり、
tickの書き直しの下でではなく、それ単独を見ることができるREQに属する話である。これはStatusブロック
でユーザーに提起済みである。floor-at-1の正当化は§9と同じ論法で行う。

## 9. quantization seam(量子化の継ぎ目) — 秒がtickになるONE(唯一)の場所

```js
// sim/lib/core.cjs -- REQ-0256. THE quantization seam. Every seconds->ticks
// conversion in the sim goes through this function and no other.
function secsToTicks(secs) {
  return Math.max(1, Math.round(secs / TUNABLES.TICK_SECS));
}
```

brief §4、および、それが述べる"document it as the one quantization seam"(訳:これを唯一の
quantization seamとして文書化せよ)による。

### 9.1 なぜ`floor`/`ceil`ではなく`round`なのか

`round`はunbiased(偏りのない)選択である:`[lo,hi]`の一様抽選全体で見ると、`floor`はあらゆる
cooldownを平均で半tick(5ms)短くし、`ceil`は同じだけ長くしてしまう。`round`は平均誤差ゼロである。
`TICK_SECS = 0.01`のもとでは、現行コンテンツで0.6-6秒帯に収まる`every_secs`範囲に対する、fireごと
のworst-case(最悪)誤差は5msである——相対誤差にして1%未満。それがこのモデルの代償であり、それは
小さい;偏ったroundingであれば、300秒のrunを通じてinstanceごとに数秒単位のdriftへと複利的に積み重
なっていただろう。

### 9.2 なぜ`max(1, ...)`なのか — assumed(当然視)ではなくjustified(正当化済み)

1tickでのfloorこそが、tickモデルを**total(全域で定義された)**ものにする要である。互いに独立した、
それぞれ単独でも十分な3つの理由がある:

1. **0tickのcooldownはsame-tick(同一tick内)refire stormを引き起こす。** `remainingTicks = 0`は、
   `if (remainingTicks > 0) continue`のguardがSAME(同一)iterationで素通りし、再びfireし、再び0に
   resetされる、ということを意味する——1tickの内側での無制限ループであり、`guardIters`カウンター
   はこれを一切捕まえない(`encounter.cjs:576`の既存guardはheap popの回数を数えるものであり、heap
   はもう存在しない)。これはまさに、コードがALREADY(既に)類似の箇所でguardしているhazard(危険)
   と同じである:`encounter.cjs:150-152`、原文まま——*"Floor the net multiplier at 0.2 (<=5x
   cadence): unbounded Haste stacks would otherwise drive the interval to zero/negative -> same-tick
   refire storm (a determinism/DoS hazard the sim never had while POs ignored Haste). Documented
   guard."*(訳:net倍率を0.2でfloorする〔cadence上限5倍〕:そうしなければ無制限のHasteスタックが
   intervalをゼロ/負に追い込み、same-tick refire stormを引き起こす〔POがHasteを無視していた間はsim
   に存在しなかったdeterminism/DoS上のhazard〕。既知のguardとして文書化。)同じhazard、同じ答え、
   1段階下で。
2. **負の値もrepresentable(表現可能)である。** `cadenceMultiplier`(`status.cjs:116-122`)は
   `1 + (chill*0.04 - haste*0.04)`を返し、これはnet Hasteスタックが25以上でNEGATIVE(負)になる。既
   存の0.2 floorはcharge経路(`encounter.cjs:152`)にしか適用されない;enemy経路はhardcodeされた
   `1.0`(`:723`)を渡し、非charge player経路も`1.0`(`:670`)を渡す。`max(1, round(negative))`が最後
   の防衛線であり、それは各呼び出し元にではなく、この継ぎ目に属するべきものである。
3. **それがこのモデルにとって唯一honest(正直)な答えである。** tickループは「1tick未満でfireする」
   ということを表現できない。4msのcooldownを0にroundすることは、このモデルにできないことを主張し
   てしまうことになる;それを1にroundすることは、このモデルにCAN do(できる)最速のことを主張する
   ことになる。代替案——sub-tick(tick未満)のスケジューリング——は、まさに我々が削除しようとして
   いるevent queueである。

**その代償を率直に述べる:** `TICK_SECS/2`(0.005秒)未満でauthoringされた`every_secs.s`は、静かに
1tickになる。現行のliveコンテンツでこれに近いものは無い(最速のlive `every_secs`は数百msのオーダ
ーで実測されている)が、§5のgateはこれをassertすべきである。そうすれば、誰かが1msのcooldownを
authoringする日が来ても、mystery(謎)ではなくfailure(失敗)として現れる。

## 10. Determinism(決定性) — NEW(新しい)total order(全順序)

`combat_spec §1.2`の`(t, seq)`によるtie-breakは消滅する(§3.3)。これがその代わりとなる。

### 10.1 順序

1tickの内側で、instance fire群に対するtotal orderは次の通りである:

```
1. the PLAYER map, then the ENEMY map                    (map order)
2. within a map: instances by STABLE INSTANCE INDEX      (instance order)
3. within an instance: cooldownSkills by SLOT INDEX      (slot order, s8.4)
```

**Stable instance index(安定したinstance index)**はcompile時に割り当てられる:player instanceは
(`squadSlot`昇順`unit1..unit4`、その後BP id昇順)の順;enemy instanceは`monster_pack members[]`の
array順——これは`packs.json`自身のnoteが既にstable(安定)かつmeaningful(意味を持つ)と宣言してい
るものである:*"The two glacier_wisp members are distinct instances (glacier_wisp#1,
glacier_wisp#2) — member ORDER names the instance, so it is stable, not cosmetic."*(訳:2体の
glacier_wispメンバーは別個のinstanceである〔glacier_wisp#1、glacier_wisp#2〕——member ORDER〔メン
バー順〕がinstanceを名指すのであり、それゆえ安定していて、cosmetic〔見た目だけの問題〕ではない。)

このそれぞれの階層は、compile時に固定された有限集合に対するtotal orderである。break(解消)すべき
tieは存在しない——それこそが要点である:`(t, seq)`のtie-breakが存在したのは、float `t`が衝突し得
たからである;整数のtickと、辞書式(lexicographic)な(map, instance, slot)キーは、衝突し得ない。

### 10.2 なぜplayer-then-enemyなのか、そしてそれがなぜ実質的な選択なのか

これはCHOICE(選択)であり、結果を変化させる。したがってデフォルトの帰結としてではなく、正当化した
上で採用する:

- **現状のbias(偏り)と一致する。** 現行のheapでは、初期のplayerスケジュールは
  `encounter.cjs:519-526`でpushされ、enemyスケジュールは`:544`でpushされる——player先行である。し
  たがって、等しい`t`を持つイベントは、TODAY(現状)`seq`上でplayer-firstにbreakされる。player-first
  を維持することで、既存のtie-break biasを保存し、書き直しのsemantic(意味論)上の距離を最小化す
  る。
- **legible(読み解きやすい)。** 「1tickの中で、playerが行動し、その後enemyが反応する」という文は、
  designerが頭の中に保持できる文である。代替案(何らかのglobalキーによるinterleaving〔交互配置〕)
  はそうではない。
- **代償は実在し、それを受け入れる:** mutual-kill(相討ち)のtickではplayerが勝つ。0.01秒の
  granularityではこれはexchange(打ち合い)ごとにおよそ1tickの優位であり、人間が知覚できるおよそ
  200msの帯域をはるかに下回るが、これは体系的な優位であり、後から発見されるのではなく、そのように
  記録されるべきものである。

**検討した上で却下した代替案:** 両方のmapをまたいでinstance indexで順序付ける(単一のglobalな
list)。却下した理由は、これによって結果が、2つのmapがたまたまどう連結されたかに依存してしまうから
であり、それはまさに`(t,seq)`のtie-breakが既にworkaround(回避策)となっていた、あの種のincidental
coupling(偶発的な結合)そのものだからである。

### 10.3 `t`はCOMPUTED(算出)されるものであり、決してACCUMULATED(累積)されない

```js
const t = tick * TICK;      // CORRECT
let t = 0; t += TICK;       // FORBIDDEN
```

`0.01`はbinary-representableではない。累積するとdriftする(100回の加算 → `1.0000000000000007`);
単一のmultiply(乗算)はdriftしない——`tick * 0.01`は1つの正確な積に対する1回のroundingであり、ど
の`tick`に対してもreproducible(再現可能)である。600秒のdeadline(60,000tick)を通じて、累積形は
乗算形からlow bit(下位ビット)でdivergeし、それは`>=`比較を動かすには十分であり、したがってgolden
を動かすには十分である。`combat_spec §1.2 [LOCKED OQ1]`(float64、server-only、「clientはlogを
replayするのみで、決してre-simulateしない」)は**原文のままSURVIVE(存続)する**のであり、これこそ
がこの問題が重要である理由そのものである:logがauthoritative(正、権威を持つもの)である以上、その
`t`の値はtick indexのpure function(純粋関数)でなければならない。

### 10.4 RNGのsub-stream群はPRESERVED(保存)される — 1つ残らず

`sim/lib/rng.cjs`は**untouched(無傷)**である(`makeRng`、`djb2Hash`、`mulberry32`、
`djb2Hash(masterSeed + '|' + streamName)`からseedされるstreamごとの`mulberry32`状態)。名前付きの
sub-streamは全て、その名前とdraw順序を保つ:

| stream | 箇所 | 保存される理由 |
|---|---|---|
| `effect/<uid>/<idx>/timing` | `skills.cjs:303` | §8.5がSAME(同じ)名前からrollする |
| `effect/<uid>/<idx>/<t>`(damage) | `encounter.cjs:614,694` | `<t>`suffixは今後tick量子化済みの`t`を運ぶことになる — **STREAM NAME(stream名)がCHANGES(変化)する**(下記参照) |
| `.../ray` | `entry.cjs`(`selectEntryCell`経由) | ray entryのgeometryは本REQによってuntouched(無傷) |
| `compile/buff/<uid>`、`compile/dr/<bpId>` | `compile.cjs:238,298` | compile passはuntouched |
| `hpbelow/<...>` | `encounter.cjs:238,247,271` | untouched |
| `attach/<enc>/placement`、`attach/<enc>/<id>/hp` | `encounter.cjs:293,324` | untouched |
| `reactive/<trigger>/<uid>/<t>/<i>` | `encounter.cjs:475,487,704` | 同じ`<t>`量子化についての注記が当てはまる |
| `unlock/<uid>/<idx>/<t>` | `encounter.cjs:373` | 同上 |
| `charge-strike/`、`charge-fire/`、`pulse/`、`pulse-payload/` | `encounter.cjs:60,77,440,445` | 同上 |

**CALLED OUT(明示的に指摘する)——これは単一原因としてはgolden変動の最大の発生源であり、briefはこ
れに一切言及していない。** 多くのstream名は`t`を文字列としてEMBED(埋め込み)している
(`effectStreamName(...) + '/' + ev.t`)。現状`ev.t`は`1.6180339887498949`のような任意精度のfloat
である;明日はそれが`1.62`になる。**stream NAME(名前)が変わり、したがってseedが変わり、したがって
あらゆるdamage rollが変わる**——たとえquantizationがfire timeを5msしか動かしていなくても。これは
バグではなく、旧名を保存しようとして「修正」してはならない:要点はまさに、fire timeが今やtick量子
化されており、その名前はfire timeから導出される、という点にある。しかしこれは、**golden diffが
marginal(部分的)ではなくtotal(全面的)になる**ことを意味する——あらゆるlogの中のあらゆる`amount`
が動く。§13はreviewerに、それを見込んでおくこと、そしてそれがcorruption(破損)ではなくquantization
であることをどう検証するかを伝える。

## 11. RayはSTILL(依然として)瞬時に解決される — そしてこの分割はarbitrary(恣意的)ではない

**本REQにおいて、`sim/lib/ray.cjs`の`walkRay()`はUNCHANGED(無変更)のまま呼ばれる。** tick `k`での
fireは、そのentry → bounce → hit → splashを、ちょうど現状が単一の`t`の中で完全に解決しているのと
同じように、tick `k`の中で完全に解決する。tick化されるのはSCHEDULING(スケジューリング)のみである。
`sim/lib/ray.cjs`、`sim/lib/geometry.cjs`、`sim/lib/entry.cjs`、`shared/forecast.mjs`は**本REQによっ
てtouchされない**。

**Ray flightはREQ-0257の担当である。** この分割のrationale(論拠)は、brief §7による:

> 0256 and 0257 are deliberately SEPARATE despite sharing one rewrite: each moves the goldens, and
> splitting them keeps the two causes bisectable (tick quantization vs ray flight).

(訳:0256と0257は、1つの書き直しを共有しているにもかかわらず、意図的にSEPARATE〔分離〕されている:
それぞれがgoldenを動かすため、両者を分割しておくことで、2つの原因〔tick量子化 対 ray flight〕を
bisectable〔二分探索で切り分け可能〕なままにしておける。)

これが議論の全てであり、正しい。だが§10.4はこれを、単なるtidiness(整頓)よりも強いものへと研ぎ澄
ます。**両REQとも12個のgolden全てをtotally(全面的に)動かす**(0256はstream名のrequantization〔再
量子化〕経由で;0257はlive-field(発射中の場)traversal経由で)。もし両者が一緒にlandすれば、
reviewerは12golden分のtotal diffに直面し、どの行をどの原因に帰属させるかをNO way(手立て無く)判
断することになる——そしてgoldenそのものがcontractである以上、頼るべき第三の信号も存在しない。別々
にlandすれば、各段階での問いには答えが出せる:0256の後は「5msのfire-time shiftとそのstream改名で
は説明できない変化が何かあったか?」;0257の後は「rayが到達に時間を要することでは説明できない変化
が何かあったか?」**Bisectability(二分探索可能性)はここでは単なる便宜ではなく、唯一手に入る証明
である。** これはREQ-0184のport noteが、port中にpackを再合成しない理由として述べているのと同じ論
法であり、REQ-0258が、1つのboxを直す間はformationを再合成することを拒む理由と同じである。

## 12. Blast radius(影響範囲) — MEASURED(実測済み)

以下の各ゲートは全て、spec作成時点でこのworktree上でRUN(実行)された(`req-expedition-spec` @
`f918a65`、pre-merge baseline)。これらは、書き直しがreproduce(再現)するか、知った上でmoveさせる
必要がある数値である。

| ゲート | コマンド | 現在の実測値 | 本REQ適用後 |
|---|---|---|---|
| simのunit test | `node sim/tests/run.cjs` | **117 passed, 0 failed** | **MOVES(変動)**——§12.1参照 |
| simのreplay golden | `node sim/tests/goldens.cjs` | **`goldens OK (12 cases, replay determinism intact)`** | **12件全てをREBASELINE(再ベースライン化)**(§13.1) |
| forecast parity | `node sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** | **18/18、UNMOVED(不変)**——§12.2 |
| S4 post-processor | `node sim/tests/s4_test.cjs` | **14 passed, 0 failed** | green(合格)を見込む;S4のBASELINES(ベースライン群)はmoveする(§13.3) |
| REQ-0203 grave-legion | `node sim/tests/req0203_grave_legion_test.cjs` | **15 passed, 0 failed** | green(合格)を見込む(assertionであり、hashではない) |
| REQ-0207 wildlands | `node sim/tests/req0207_wildlands_test.cjs` | **13 passed, 0 failed** | green(合格)を見込む |
| REQ-0219 deepstone | `node sim/tests/req0219_deepstone_test.cjs` | **13 passed, 0 failed** | green(合格)を見込む |
| REQ-0200 unit charge | `node sim/tests/unit_charge_test.cjs` | **13 passed, 0 failed** | green(合格)を見込む(純粋なruntimeであり、heapを持たない) |
| REQ-0200 charge fusion | `node sim/tests/unit_charge_encounter_test.cjs` | **23 passed, 0 failed** | **MOVES(変動)**——§4.1bの`advance_cooldown` |
| api determinism | `node server/tests/api_test.cjs` | **NOT RUNNABLE HERE(ここでは実行不可)**——§12.3 | §13.2参照 |

### 12.1 `sim/tests/run.cjs` — 何が動き、何が動かないか

117テスト。注視すべきはray-geometryのブロックであり、これは本REQにおいてSAFE(安全)である:

- **9個のテストが`combat.walkRay`をDIRECTLY(直接)呼ぶ**(220, 253, 270, 289, 302, 322行目 + AOEテ
  スト)——`'ray geometry: entry projection+jitter…'`、`'…penetration exhaustion…'`、
  `'…boundary reflection…'`、`'…bounce damage scaling exactness…'`、
  `'…5-bounce all-hit-then-terminate…'`、`'…detection-mode per-PO bounce-budget stop…'`、
  `'…destroyed-BP passthrough…'`、`'…gap passthrough…'`、`'AOE: Chebyshev radius correctness…'`。
  **9個全てがgreenのまま留まる——`walkRay`はuntouched(無傷)である(§11)。** これらはREQ-0257の問
  題であり、本REQの問題ではない。
- **`run.cjs`には`ray_step`への参照がZERO(ゼロ)である**(grep済み)。そのwalkRayテスト群は
  `result.landing` / `result.bounces` / `result.aborted`を読んでおり、event streamを読んでいない。
  これが、§11を経てもこれらがSURVIVE(存続)する理由であり、REQ-0257がこれらにtouchする前に知って
  おく価値がある。
- **実際にMOVES(動く)もの:** 発行されたイベントの絶対`t`をassertするテスト、そして
  `encounter_end.t`をassertするテスト(§4.1c)。これらはtick量子化済みの値へとretarget(対象を再設
  定)すること;削除してはならない。

### 12.2 Forecast parity — UNMOVED(不変)、そしてこの点についてbriefは誤っている

**briefへの訂正。** brief §3 C1は`sim/tests/forecast_parity.cjs (18/18)`を、「ALL(全て)rebaseline
する」ものの一覧に含めている。**この一文には2つの誤りがある:**

1. **これはbaselineではない。** `forecast_parity.cjs`はASSERTION(表明)テストである——2つの実装を
   互いに比較する18個の`T(...)`ケースである。保存済みhashも`gen`モードも持たない。**rebaselineす
   べきものが何も無い。** これはregenerate(再生成)できない;pass(合格)させるか、変更するかのど
   ちらかしかできない。
2. **本REQはこれを一切動かさない。** 実測に基づく理由:これがpinしているもの全てが、ここでは
   untouchedである。pinしているのは`FIELD_ROWS`/`FIELD_COLS`(`:183-184`)、
   `RAY_STEP_BUDGET`/`ENTRY_JITTER_HALF_WIDTH`(`:188-189`)、geometryのprimitive群(`:192-236`)、
   `parseBox`(`:236`)、そして——最大のもの——fixtureコーパス全体にわたる
   `walkRayPath() == walkRay()`(`:261, :299, :336`)である。**§11はそれら全てにそのまま手をつけな
   い。** 本REQ適用後の期待結果:**18 passed, 0 failed、変化なし。**

**だがこれはREQ-0257にとってのcentral(中心的)な問題であり**、0257のspecもそう述べている:これら
のテストのうち3つ(`:261`、`:299`、`:336`)は、**`ray_step`イベントのbatch**からrayのcell経路を
reassemble(再構成)している(`:118` — `if (ev.ev === 'ray_step') for (const c of ev.path)
cells.push(...)`;`:323`も同様)。REQ-0257は`ray_step`を削除する。すると、それらのテストはSTRUCTURALLY
(構造的に)壊れる——空配列と比較することになってしまう——これもまたrebaselineではない。ここでこ
れを指摘するのは、briefの「forecast parityはrebaselineする」という一文が、`--gen`を連想させる言葉
の下に、構造的な破壊を隠してしまっているからである。

**本REQがこれについてMUST(必ず)行うべきことが1つある:** もし将来`TICK_SECS`/
`RAY_TICKS_PER_DIAGONAL`が`shared/forecast.mjs`から見える必要が生じたら、他の4つの定数
(`forecast_parity.cjs:187-189`)と同じ方法でそこにPINされなければならない。なぜなら**`shared/`は
`shared/`の外を`require()`することができない**からである——これは`shared/content_validate.cjs:432-435`
および`forecast_parity.cjs`のheaderに文書化されている。本REQはそこにこれらを必要としない(forecast
が予測するのはGEOMETRY〔幾何〕であり、timingではない)ため、**4つ目のコピーを追加しない。** これを
revisit(再訪)しなければならないのはREQ-0257だけである。

### 12.3 api determinismゲート — そしてCONTENT_ROOTの罠

このゲートは`tools/ci.sh`のstep `[4/7]` → `node server/tests/api_test.cjs`であり、具体的には
`server/tests/api/schedule.cjs:383`(*"schedule: run executes and persists a replay log + summary;
fixed seed -> deterministic re-simulation"*〔訳:schedule:runがreplay log+summaryを実行・永続化す
る;固定seed -> 決定論的なre-simulation〕)と`server/tests/api/schedule_ops.cjs:605`
(*"REQ-0043: two DIFFERENT rooms created with the SAME genSeed produce IDENTICAL replay logs"*
〔訳:REQ-0043:同一genSeedで作成された2つのDIFFERENT〔別々の〕roomはIDENTICAL〔同一〕なreplay
logを生成する〕)である。

**実測:これはbare(素の)worktreeではNOT RUNNABLE(実行不可)である。** ここで`node server/tests/api_test.cjs`
を実行すると`MODULE_NOT_FOUND: 'pg'`で死ぬ(`server/storage_moderation.cjs:11` →
`server/storage.cjs` → `server/tests/api/harness.cjs`)。`ls node_modules`は不在。PROJECT.mdによれ
ば、依存関係はworktree PER(ごと)にprovision(用意)される(`pnpm install --frozen-lockfile`);こ
のworktreeでは一度もそれが行われていない。**bare worktreeで実行可能なのはsimのゲートだけである**
——だからこそ§12の数値は全てsimの数値なのである。`[4/7]`について何かを信じる前に、provisionせよ。

**CONTENT_ROOTの罠が当てはまり、それはASYMMETRICALLY(非対称に)当てはまる。** REQ-0255 §7.1がこ
れを実測しており、ここではそれを原文のまま継承する——再導出してはならない:

- `server/lib/content_files.cjs:19`と`sim/dungen.cjs:63`は、テスト対象のツリーではなく
  **`os.homedir()`**にcontentをanchor(固定)する。**`tools/ci.sh`は`CONTENT_ROOT`を一度もsetしな
  い。**
- REQ-0255のmerge後、`CONTENT_ROOT`を持たないworktreeから`node sim/tests/run.cjs`を実行すると
  **13件のphantom(幻の)ENOENT失敗**が出る(`…/backpack_ragnarok/content/live/dungeon/gimics.json`、
  `dungeons.json`)——これはMASTER側のcontentを読んでいるためである。`CONTENT_ROOT=$PWD/content`
  を付ければ:green。
- **`sim/tests/goldens.cjs`には`CONTENT_ROOT`を与えてはならない。** これは`os.homedir()`をremap
  (再マップ)することで自身のbatch-002ロスターをpinしている(`goldens.cjs:51-59`、REQ-0207);
  `CONTENT_ROOT`をsetすると、`dungen.cjs`の`liveDungeonDir()`内の`process.env`分岐が使われ、その
  pinをbypass(迂回)してしまい、`compileEnemyPack: missing enemy def ghost`で死ぬ。

**THIS(この)ツリー上で検証済み(pre-merge):** 全simゲートは`CONTENT_ROOT`なしでgreenになる。なぜ
ならこのbranchのcontentとmasterのcontentは同一だからである(ここにも`gimics.json`は存在しない)。
**この罠は、REQ-0255のmergeがlandしたAFTER(後)にのみ噛みつく。** 本REQはそのマージ済みbaseline
から分岐する以上、初日から、この分割呼び出しはmandatory(必須)である:

```
CONTENT_ROOT=$PWD/content node sim/tests/run.cjs           # and forecast_parity, s4_test, the roster tests
node sim/tests/goldens.cjs                                 # NO CONTENT_ROOT -- it pins its own roster
```

### 12.4 briefが名指す、それ以外の全て

| briefで名指されているもの | 実際の正体 | 判定 |
|---|---|---|
| `sim/s4_baselines` | `sim/s4_baselines/default/` — S4のtuningコーパス | **REBASELINE(再ベースライン化)**(§13.3) |
| `sim/s4_matrices` | `sim/s4_matrices/default.json` + `default.golden.sha256` | **REBASELINE(再ベースライン化)**——SHAゲートである |
| `sim/s4_thresholds.json` | 849バイトのbandテーブル | **REVIEW(要レビュー)、blindly(何も考えず)regenしないこと**——§13.3 |
| `server/services/seals.cjs`(`clearTimeSecs`) | `:186` `clearTimeSecs: typeof run.durationSecs === 'number' ? run.durationSecs : endT` | **MOVES(変動)するが、コード変更は無い。** これは`run.durationSecs`を読み、`endT` = `runEnd.t`(`:128`)にfall backする。どちらもsimの出力である。tick量子化されたrun時間がこれらをshiftさせるが、式そのものはuntouchedである。`server/tests/api/seal.cjs:146,173`は`typeof === 'number'`だけをassertしている——これらはgreenのまま留まる。 |
| REQ-0240 `server/services/pacing.cjs` | presentation(表示)pacing | **本REQではNO CHANGE(変更なし)。** そのheaderがそう述べている:*"Nothing in sim/ imports this file; `pt` can never enter sim-hashed content."*(訳:sim/配下のどのファイルもこのファイルをimportしない;`pt`がsimでhash化されるcontentに入り込むことは決してない)。これは`t`を読み、`pt`にreassign(再代入)する。tick量子化された`t`が来ても問題なくfeed(供給)される。**これをdisturb(かき乱す)のはREQ-0257である**(その`:44-51`にある`ray_step`のspecial-case〔特別扱い〕)。 |

## 13. Rebaseline(再ベースライン化)手順 — artifactごとに

**順序が重要である。** Rebaselineはone-way door(一方通行の扉)である:一度regenerateすれば、旧
contractは失われ、diffだけがevidence(証拠)として残る。以下を順に行い、各stepでdiffを読むこと。

### 13.1 `sim/tests/goldens.cjs` — 12個のリプレイgolden

```
node sim/tests/goldens.cjs          # CONFIRM RED first -- 12 DRIFT lines. If green, the rewrite did nothing.
node sim/tests/goldens.cjs gen      # writes sim/tests/goldens/replay_hashes.json
git diff sim/tests/goldens/replay_hashes.json
```

**12個のキー全てがmoveすることを見込め**(`batch002/golden-{A,B,C}`、
`dungen/default/L{1,3,5,8}/dg-{11,22}`、`dungen/test_fixed`)。**9個のdungenケースにおいて
`def_sha256`はmoveしてはならない**——generatorは本REQによってuntouchedである;変わるのは
`jsonl_sha256`と`events`だけである。**もし`def_sha256`がmoveしたら、STOP(作業を止めよ):**何かが
`dungen.cjs`の中に、してはならない形で手を伸ばしている。

**regenerateする前に、そのdiffがquantizationによるものだと証明せよ。** hashはopaque(不透明)なの
で、1本のlogをdumpして読むこと:

1. `batch002/golden-A`について、前後の`combat.toJSONL(r.events)`をTEXT(テキスト)としてdiffする。
2. AFTER(適用後)ファイルの中のあらゆる`t`は、`TICK_SECS`(0.01)の正確な倍数でなければならない。
   これをmechanically(機械的に)assertせよ——これは、tickループがclockであることの、単一で最良
   の一行証明である。
3. Eventの順序はnear-identical(ほぼ同一)であるはずである;`amount`の値はALL(全て)differ(異な
   る)だろう(§10.4——stream名が`t`を運ぶため)。**それは想定通りである。** differしてはならない
   もの:eventのSET(集合)、`ev`トークン、`dst`ラベル、勝敗の`result`。
4. `encounter_end.t`は§4.1cに従ってmoveする。それが今やbreak tick(離脱tick)と等しくなっており、
   phantomなnext-event(次イベント)時刻ではないことを確認せよ。

前後の`events`件数をREQ内に記録すること。件数の大きな変化はred flag(危険信号)である(quantization
は、何件のことが起きるかをほとんど動かさないはずである)。

### 13.2 api determinismゲート

**regenerateすべきものは何も無い。** これはre-simulateし、保存済みlogに対してdeep-equal(深い等価
比較)する(`server/tests/api/schedule.cjs:383`);両辺が一緒にmoveする。依存関係をprovisionした
上で(§12.3)、次を行う:

```
pnpm install --frozen-lockfile
CONTENT_ROOT=$PWD/content node server/tests/api_test.cjs
```

**もしこれがredになったら、それはbaseline artifact(ベースライン上の産物)ではなく、REAL(本物)の
determinism破壊である**——それはSAME(同一)seedの2回のrunがdivergeしたことを意味しており、それは
まさに§10が防ぐために存在している事態そのものである。何かをrebaselineすることで「修正」してはな
らない。debugせよ。

### 13.3 S4 — `s4_baselines`、`s4_matrices`、`s4_thresholds.json`

`sim/s4_matrices/default.golden.sha256`は`default.json`に対するSHAゲートである;
`sim/s4_baselines/default/`はtuningコーパスである。両者ともrun結果のdownstream(下流)にあり、両
者ともmoveする。

```
node sim/tests/s4_test.cjs                   # 14/14 -- the POST-PROCESSOR, expected green (it tests the math, not the data)
<regen per sim/s4's own runbook>             # then re-hash default.golden.sha256
```

**`sim/s4_thresholds.json`はDIFFERENT(別物)であり、regenに巻き込んではならない。** これは
hand-authored(手作業で作成された)BAND(帯域)テーブルである(dps上限12/15/18/24は
`vocab.dps_ceiling_warn`に由来し、combat_spec §10の「diverge(乖離)させないこと」に従う)。その数
値はmeasurement(実測値)ではなくDESIGN INTENT(設計意図)である。**これをregenerateすれば、balance
の目標値を、新しいsimがたまたま生成する値へと静かに書き換えてしまうことになる——つまり、tuningゲ
ートに対して「simが正しいのはそれがsimだからだ」と主張させてしまうことになる。** コーパスを
rebaselineした後、S4レポートを読み、いずれかのbandが今やsystematically(体系的に)breach(逸脱)
していないか確認すること;もしそうなら、それは上書きすべきファイルではなく、ユーザーへのFINDING
(調査結果)である。

### 13.4 rebaselineされないもの

- `sim/tests/forecast_parity.cjs`——§12.2。baselineではない;18/18で変化なしを見込む。
- `sim/tests/run.cjs`、rosterテスト群、chargeテスト群——assertion suite(表明群)である。**個々の
  assertionをretarget(対象再設定)すること;決してregenerateしないこと。**
- `shared/pacing.json`、`server/services/pacing.cjs`——untouched(無傷)(§12.4)。
- `docs/user_managed/*`——forbidden(禁止)。

## 14. Scope(範囲)

**In(範囲内):**
1. `sim/lib/core.cjs`——`TICK_SECS: 0.01`のTUNABLE + `secsToTicks()`(§5、§9)。
2. `sim/lib/seq.cjs`——NEW(新規)。`SeqCounter`(§6.2)。
2b. `sim/lib/battle.cjs`——**NEW(新規)。** `Battle`オブジェクト(§7.0):`playerMap`/`enemyMap`(いず
    れも`IBattleInstancesFormationMap`)、`modeConfig`(`null`でreserved;REQ-0259がpopulateする)、
    `tickIndex` + `t()`(clock)、そして`tick()`(§7.1aのchain)。`runEncounter`によって構築・駆動さ
    れる;ループの住処ではない(§7.0)。
3. `sim/lib/heap.cjs`——**DELETED(削除)。** orphanなコメントはrehome(移設)する(§6.3)。
4. `sim/combat.cjs`——`heap`のrequire(`:50`)と`EventHeap`のexport(`:68`)をdropする。
5. `sim/lib/encounter.cjs`——driver(`:575-756`)をtickループへと書き直す(§7);`advanceCooldown`
   (`:82-93`)をrespecify(再仕様化)する(§8.5);`encounter_end.t`(`:788`)をrespecifyする(§4.1c);
   `status.cjs:143`の偽のコメントを直す(§7.2)。
6. `sim/lib/compile.cjs`——returnに`+instances`(`:373`);`buildInstances()`(§8.2-8.4)。
7. `sim/lib/skills.cjs`——`scheduleEffect`(`:301-307`)を**削除**;そのrollは`rollCooldownTicks`
   (§8.5)へ移る。
8. `sim/lib/unit_charge_encounter.cjs`——`heap`引数を`seq`にrename(6箇所、§6.1)。
9. `sim/lib/formation_map.cjs`——tick半分をimplement(実装)する(REQ-0258がこのファイルをDECLARE
   〔宣言〕する;§依存先参照):**`tickInstances()`**(fire phase、stable-index順)と**`tick()`**
   (= `tickInstances(); tickRays()`、brief §4の単一map向けentry point)。**`tickRays()`はここでは
   no-opのstubにする**——`rays[]`は0256では常に空である(§11)——これを実装するのはREQ-0257である。
   `Battle`は`tick()`ではなく2つのphaseメソッドを呼ぶ;§7.1aがその理由を述べ、これをinterpretation
   (解釈)としてflag(明示)している。
10. `sim/tests/run.cjs`——§5のtunable gate;retargetされた`t`のassertion群(§12.1)。
11. §13に従ったrebaseline群。
12. `docs/llm_managed/combat_spec_draft.md`——§1.1を書き直し、§1.2のtie-break項目を置換し、§1.4の
    "event by event" → "tick by tick"(§3)。

**Out(範囲外):**
- **Ray flight。** `walkRay`/`ray.cjs`/`geometry.cjs`/`entry.cjs`/`shared/forecast.mjs`はuntouched
  (§11)。REQ-0257が担当。
- **`mode`に意味を持たせること。** 宣言のみ(§8.3)、REQ-0259が使用する。
- compileのreturnから**`bps`/`pos`/`sis`を削除すること**(§8.2)。follow-up REQの仕事。
- **`runEncounter`の約650行のscaffoldingを`Battle`へ移すこと**(§7.0)。`Battle`が所有するのはclock
  とchainのみ;`runEncounter`は引き続きcompile、attachment、pulse、fire、resultを所有する。
  follow-up REQがさらにこれを裏へ移すかもしれない。
- **`modeConfig`にpopulateすること**(§7.0)。このfieldはreservedされ`null`で初期化される;本REQ内
  のどこもこれを読まない。REQ-0259がこれに意味を与える。
- **goldenのcharge engineに対する盲目性を治すこと**(§8.5)。`sim/tests/goldens.cjs:63`は
  `unitDefsById`を省略しており、どのgoldenも`chargeMgr`を構築しない。これを渡せば、12個のgoldenが
  SIMULATE(シミュレート)するものが変わってしまう——それはtest fixの体裁をしたcontract変更であり、
  tickの書き直しの下にride in(紛れ込ま)せてはならない。Statusブロックでユーザーに提起済み;訂正
  はREQ-0263 §5.5。
- **`status_tick`に`seq`が欠けている点を直すこと**(§4.1c)。follow-upの仕事;golden内の1バイトで
  ある。
- **Stun/Weakness/Hasteをreal-time(実時間)減衰に変更すること**(§7.2)。bug-fixのように見えるが、
  実際にはbalance変更である。
- **`sim/s4_thresholds.json`のregeneration**(§13.3)。
- **`docs/user_managed/*`の編集。** PROJECT.mdによりforbidden(禁止)。
- **e2eハーネス。** 不要——sim + compileのみであり、simのsuite群でカバーされる。E2Eはこのprogram
  (Q2)にとってのゲートではない。Decade(十番台)**7560 / 7561 / 7562**(`5000 + 256*10 + {0,1,2}`)
  はreserved-by-numbering(番号予約済み)のまま、未使用で残される。

## 15. Acceptance criteria(受け入れ基準)

1. `sim/lib/heap.cjs`が存在しないこと。ツリー全体に対する`grep -rn 'EventHeap'`は、`docs/`の外側
   では**ゼロ**件のヒットを返すこと。
2. `TUNABLES.TICK_SECS === 0.01`であること、かつ**リテラルの`100`や`0.01`がtick量として`sim/lib/`
   のどこにも一切現れない**こと。§5のgateが、`TICK_SECS`を動かして失敗が観測されることでこれを証
   明する。
3. 発行される全イベントのあらゆる`t`が`TICK_SECS`の正確な倍数であること(§13.1のstep 2)、機械的
   にassertされていること。
4. `compileSquadSnapshot`が`instances`を返すこと(バックパック1つにつき1個)、各`instances`が§8.4
   に正確に一致するslot順を持つ`cooldownSkills` Mapを持つこと。あるテストが、2つのPO + 1つのseated
   SI(座乗済みSI) + 1つのキャラクター駒エフェクトを持つfixture BPを構築し、slotの並びを件数では
   なくNAME(名前)でassertすること。
5. monster instanceとBP instanceが、`cooldownSkills`の境界においてSTRUCTURALLY IDENTICAL(構造的に
   同一)であること——両者を同じfire経路に投入するテストによってassertされること。これがflattening
   であり、testableでなければ、それは起きなかったことになる。
6. Determinismが成立していること:同一の`(snapshot, defs, seed)`が、1つのprocess内での2回のrun間、
   AND(かつ)2つのprocessをまたいでも、byte-identical(バイト単位で同一)なlogを生成すること
   (§10)。api determinismゲート(§13.2)がgreenであること。
7. `sim/tests/goldens.cjs`が12ケースでgreenであること、§13.1に従ってrebaselineされていること、9個
   のdungenケース全てで`def_sha256`が**動いていない**こと。
8. `sim/tests/forecast_parity.cjs`が**18 passed, 0 failed——UNCHANGED(不変)**であること(§12.2)。
   もし動いていたら、§11がviolate(違反)されたことになる。
9. `sim/tests/run.cjs`がgreenであること;その9個の`walkRay`テストがgreenであり、**untouched(無傷)**
   であること(§12.1)。
10. `sim/tests/unit_charge_encounter_test.cjs`が23件でgreenであること、変動があれば§8.5の
    `advance_cooldown`respecに遡って追跡され、REQ内に記録されていること。
11. `combat_spec_draft.md`の§1.1/§1.2がtickモデルを記載していること;ファイル内のどの行も
    "not ticked"や"no ticks"をもはや述べていないこと。
12. §12.3の分割呼び出しがREQのgateテーブルに書き込まれていること、そして`goldens.cjs`が
    `CONTENT_ROOT`-FORBIDDEN(禁止)として文書化されていること。
13. **chainが存在し、それが唯一のfire経路であること。** `sim/lib/battle.cjs`が`createBattle`を
    exportしていること;`runEncounter`がtickごとに正確に1回**`battle.tick()`**を呼び、**自前の
    instance-fire walkを一切持たない**こと(`grep -n 'cooldownSkills' sim/lib/encounter.cjs`がゼロ
    を返す——このwalkは`IBattleInstance.tick()`の中に存在する)。あるテストがこのcascadeを機械的に
    assertすること:`tickInstances()`が呼び出しを記録するstub mapを用意し、`battle.tick()`が
    player-then-enemyの順でそれぞれ正確に1回ずつ呼ぶことをassertし、あるinstanceの`tick()`が
    `runEncounter`をstackに含まない形で`battle.tick()`から到達されることをassertする。
14. **`battle.modeConfig === null`であり、どこもこれを読まないこと。** `grep -rn 'modeConfig' sim/`
    は、その宣言と初期化(§7.0)のみを返すこと。この基準をobsolete(不要)にするのはREQ-0259である。
15. **`advance_cooldown`のrespecが、fixtureだけでなくLIVE(実働)なコンテンツ上で証明されていること**
    (§8.5)。`sim/tests/unit_charge_encounter_test.cjs`内の新しいケースが、charge付きの42体のlive
    キャラクター駒のうち1体(例:`alchemist`)について`unitDefsById`を渡し、floor-at-1のpullを
    assertすること。**これがまさに必要とされる理由は、受け入れ基準7(golden群)がこの経路を全く見
    ることができないからである**——`goldens.cjs:63`が`unitDefsById`を省略している。greenなgolden
    rebaselineはchargeについてのevidence(証拠)ではなく、そう読んではならない。
