# REQ-0259 — battle-mode-verb-gating: Battleがmode方針を所有し、VERB(動詞)をgateする

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKED。**本REQはQ4裁定
(§3)のINTERPRETATION(解釈)に立脚しており、レビューすべき対象はまさにこの解釈である。** Q4は
一文にすぎない;§3は、それが許容する4つのreading(読み方)を列挙し、そのうち1つを採用し、残り3
つが何を犠牲にするかを示す。もしユーザーの意図が別のものであったなら、それを述べるべき場所は§3
である — 本REQの残り全体は、この選択から導かれる。さらに2つのgateがある:(1) §9は、LLMが編集で
きない`docs/user_managed/game_golden.md` §4についてユーザーに確認を求める;(2) §7はliveな
contentのschemaを拡張する。
**予約日:** 2026-07-18
**スラッグ:** battle-mode-verb-gating
**ブランチ:** req-expedition-spec(仕様のみ)
**依頼者:** user、2026-07-18 — Q4裁定。
**依存先:** REQ-0256(battle-tick-core) — `IBattleInstance.mode`(その§8.3)、および本REQがgate
する対象であるflatな`cooldownSkills`を宣言している。REQ-0258(formation-map-padding) —
`IBattleInstancesFormationMap`。REQ-0255(expedition-merge-baseline) — **hard(必須)な依存**。
gimic(REQ-0211)がbuilt-but-unmerged(構築済みだが未merge)であり、§7がそのschemaを参照するため
である。
**ブロック対象:** 本プログラム内には何もない。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q4, §3 C6, §4。

## 1. ゴール

mode-gatingをPOからOFF(外)し、BattleへとON(移す)。そしてそれが**verb(動詞)**をgateするよう
にする:

1. `Battle.modeConfig = { activeModes: Mode[], verbGate: (rayMode, verb, targetMode) -> bool }`。
   **THREE(3つの)引数である。** brief §3 C6は`verbGate: (mode, verb) -> bool`と書いているが —
   **ここでbriefは誤っており、本REQは意図的にこれから逸脱する。** 2引数のgateでは、touch(接触)
   したinstanceのmodeを見ることができないため、**Reading B**(battleは単一のmodeを持つ)または
   **Reading C**(targetのmodeのみが問題になる)しか表現できない — そして**§3.5は両方をREJECT
   (却下)する**:Bは、既に出荷済みの機能であるREQ-0049の並行layering(重ね合わせ)を殺してしま
   う。Cは「battleのrayとdetectionのrayが、同じinstanceに対して異なる振る舞いをする」ことを表現
   できない。採用された設計は**Reading A**であり、これはrayのmodeとtargetのmode両方を必要とする
   ため、3引数になる。§3.5の表がその論拠であり、§5.3がそのsignature(署名)である。この1行はそ
   れらの要約であり、二度とそこから逸脱してはならない。
2. 各`IBattleInstance`は、それ自身の`mode`を持つ。
3. あるverbが、touchしたinstanceに対してeffective(有効)であるのは、Battleの`modeConfig`が、
   そのinstanceの`mode`に対して`(ray.mode, verb.t)`をIFF(その場合に限り)許可する場合である。
4. `monster_pack`の`members[]`は、enemy idに加えて**gimic id**も受け入れるよう拡張される;どち
   らも`IBattleInstance`にcompileされる。

## 2. 裁定

Q4、原文まま:

> **Battle側の設定でどのmodeかで、有効な動詞を制限する実装をする。**

この一文が疑いなく定めている3つのことがある:

- **`Battle側の設定`** — 設定は**Battle**上に存在する。POでもskillでもない。これはRELOCATION
  (再配置)であり、曖昧さはない。
- **`有効な動詞を制限する`** — 制限されるのは**verb(動詞)**(`動詞`)であり、その述語は
  **effectiveness(有効性)**(`有効`)であって、fireすることではない。gateされたverbはINERT
  (不活性)になるのであって、スケジュールから外れるのではない。
- **`どのmodeかで`** — この制限は**どのmodeであるか**をキーとしている。

**この一文が定めていないこと:`どのmode`が誰のmodeを指すのか。** それが§3の主題である。

## 3. そのINTERPRETATION(解釈) — flagされており、vetoすることができる

**これはQ4に対するorchestrator(発注側)の解釈であり、ユーザーの裁定そのものではない。ユーザー
はこれをvetoすることができる。** combat_spec自身の慣例に従えば、これは`[LOCKED]`のデフォルトで
ある:orchestratorが決定し、ユーザーは非同期にvetoできる。これをfileの奥に埋めず冒頭で明示して
いるのは、以下の全てがこれに依存しているからである。

`どのmodeかで`は、本当に曖昧な指示対象を持つ。4つのreading(読み方)がある:

### Reading A — (ray.mode, verb) 対 instance.mode — **ADOPTED(採用)**

Battleはpolicy table(方針表)を保持する。mode `M`のrayが運ぶverbが、mode `N`のinstanceに対して
effectiveであるのは、`verbGate(M, verb.t)`が`N`に対してそれを許可する場合に限る(IFF)。

```
Battle.modeConfig = {
  activeModes: Mode[],                        // which modes are live in THIS battle
  verbGate: (rayMode, verb, targetMode) -> bool
}
```

**採用理由:REQ-0049とOQ12の両方が真であり続ける唯一のreadingだからである**。また、これは他の
3つのstrict generalisation(厳密な一般化)になっている唯一のreadingでもある(§3.5)。

### Reading B — `どのmode` = BATTLEの単一mode

Battleは1つのmodeを持ち、gateはその中でどのverbがeffectiveかを述べる。実質的には、現状の
MODE-6をBattleオブジェクトへ持ち上げただけのものである。

**REJECTED(却下) — これはREQ-0049を殺してしまう。** REQ-0049(完了済み、live)は、battle + 最
大2つのattachmentを**1つのfieldと1つのclock上でparallel(並行)に**解決する。ONE(単一)のmode
しか持たないBattleでは、「battle packとunlock chestが同時に存在する」ことを表現できない。
brief §4は`activeModes: Mode[]` — つまりLIST(リスト)である — と述べており、これ自体が、ユーザ
ーがBを意図していないことのevidenceである。Bを採用すれば、既に出荷済みの機能を静かに削除してし
まうことになる。

### Reading C — `どのmode` = TOUCH(接触)されたINSTANCEのmodeのみ

Battleは`instance.mode -> 許可されたverb`をmapし、rayのmodeは無視する。unlock chestは、誰が
fireしようとunlock verbのみを受け付ける。

**SPECとしてはREJECTEDだが、これはAの内部でREPRESENTABLE(表現可能)である点に注意**(第1引数
を無視する`verbGate`はまさにCそのものである)。これはOQ12を保ち、mode-purity(mode純粋性)のほ
ぼ全てすら保つ。これが却下されるのは、ただ一点、「battleのrayとdetectionのrayが、同じinstance
に対して異なる振る舞いをする」ことを表現できないからである — これはREQ-0049のtransparency
(透過性)ルールが現状依拠している区別であり、保持してもコストはかからない。**もしユーザーがC
の単純さを好むなら、それはredesign(再設計)ではなく、gateへの1行の変更で済む。** これこそが、A
を採用する最も強い理由である:AはCになり得るが、CはAにはなり得ない。

### Reading D — `どのmode` = FIRE(発火)するinstanceのmode

instance自身のmodeが、ITS(そのinstance自身)のverbのうちどれがliveであるかを決める。

**REJECTED — これは`有効`を読み誤っている。** 「Effective(有効)」とは、verbがtargetにON(命
中)する際の性質であって、instanceがactする(行動する)ことを許されているという性質ではない。D
はまた、既に別のところでcoverされている:あるinstanceがどのskillをFIREするかは、`cooldownSkills`
+ `activeModes`が決めるものであり(§5.2)、verb gateが決めるものではない。

### 3.5 なぜAが残りをsubsume(包摂)するのか

| reading | gateのsignature | Aの中でexpressible(表現可能)か? |
|---|---|---|
| A | `(rayMode, verb, targetMode)` | — |
| B | `(battleMode, verb)` | yes(可能) — 長さ1の`activeModes` + `targetMode`を無視する |
| C | `(verb, targetMode)` | yes(可能) — `rayMode`を無視する |
| D | `(firerMode, verb)` | そもそもtarget gateではない;§5.2に属する |

Aが一般形である。これを採用するコストは1つの余分な引数だが、その見返りとして、**別のinterface
変更なしに**BやCへと修正できる能力を得られる — これは重要である。なぜならこのinterfaceは
REQ-0256の`IBattleInstance`によって消費されており、二度動かすのは高くつくからである。

**ユーザーに、正確に次のように尋ねること:** *「battle-modeのrayとdetection-modeのrayが、同じ
chestにtouchするとする。それらは異なる振る舞いをしてよいか?」* Yes → A。No → C。同時にliveな
modeが常に1つだけ → B(この場合REQ-0049を再検討しなければならない)。

## 4. 検証済みの現状 — 現状mode-gatingは8箇所に散在している

Q4は、方針をBattleへと移すよう述べている。ここでは、それがどこからFROM(移されるのか)を示す。
**`sim/lib/encounter.cjs`全体に対して`modes`をgrepした;これが全箇所である:**

| line | code | 何をgateするか |
|---|---|---|
| `:163` | `modes: po.def.modes \|\| ['battle']` | 各schedulableに、そのPOのmodesを刻印する |
| `:430-431` | `const modes = eff.modes \|\| (po.def && po.def.modes) \|\| ['battle'];`<br>`if (!modes.includes(encounterDef.mode)) return;` | REQ-0048のpulse payload |
| `:520-521` | `const attActive = hasAtt && s.modes.some(m => (m === 'detection' && …) \|\| (m === 'unlock' && …));`<br>`if (s.modes.includes(encounterDef.mode) \|\| attActive) { scheduleEffect(…) }` | **初回スケジューリング** — MODE-6の「pause(一時停止)し、蓄積しない」ルール |
| `:553-554` | `const modes = eff.modes \|\| (po.def && po.def.modes) \|\| ['battle'];`<br>`if (!modes.includes(encounterDef.mode)) continue;` | REQ-0048のbattle_start pulse opener |
| `:595` | `if (s.modes.includes(encounterDef.mode) && … verb.t === 'pulse')` | pulseのfire |
| `:601` | `} else if (s.modes.includes(encounterDef.mode)) {` | **主要なrayのfire** |
| `:663` | `} else if (hasAtt && s.modes.includes('detection')) { resolveDetection(s, ev.t); }` | REQ-0049のdetection |
| `:665` | `} else if (hasAtt && s.modes.includes('unlock')) { resolveUnlock(s, ev.t); }` | REQ-0049のunlock |

加えて`sim/lib/skills.cjs:309-311`:

```js
function effectModesOf(effect, ownerModes) {
  return effect.modes || ownerModes || ['battle'];
}
```

— exportされているが、**simのどこからも一度も呼ばれていない**(grep済み)。このルールに名前を
与えたhelperを、どのgating箇所も使っていない;8箇所全てが`||`チェーンを手で再実装している。**こ
れこそがQ4が終わらせるscattering(散在)であり、Q4を恣意的なものとして扱うのではなく、この裁定
のJUSTIFICATION(正当化根拠)として述べておく価値がある:**同じ3項のfallbackが8回書き出されて
おり、そのうち1つは微妙に異なっている(`:163`は`eff.modes`の項を省いている)。しかもhelperは使
われないまま存在している。これはPROJECT.mdの「ルールの半分しか見ていないゲートは、そのルールを
何も見ていないのと同じである」の、別の衣装をまとった姿である。

**その他の検証済みの事実:**

| fact | source | evidence |
|---|---|---|
| `modes`はratified(批准済み)のCLOSED(閉じた)語彙である | `content/vocab.json` | `"modes": ["battle", "detection", "unlock"]` — top-level key, alongside `po_tags`/`socket_tags` |
| verbは31個存在する | `content/vocab.json` `verbs` | `strike, multi_strike, block, heal_bp, apply_status, add_on_hit_status, amp_status, buff_host, buff_self_per_tag, buff_adjacent, cleanse, reflect_damage, lifesteal, haste, slow_enemy, bonus_vs_blocked, status_immune, bonus_vs_status, pulse, buff_linked, buff_self, damage_reduction, grant_charge, advance_cooldown, fire_items, grant_shield, grant_lifesteal, heal_ally, charge_strike, transfer_status, shield_break` |
| 現状encounterはONE(単一)のmodeしか持たない | `sim/lib/encounter.cjs` (8箇所) | 全てのgateがscalarな`encounterDef.mode`と比較している |
| attachmentが並行mode(parallel-mode)を運ぶ手段である | `sim/lib/encounter.cjs:279-334` | `encounterDef.attachments[]`, `ATTACH_CAP = 2` |
| `members[]`はenemy idのみをONLY(受け付ける) | `shared/content_validate.cjs:505` | `if (typeof m.enemy !== 'string' \|\| !m.enemy) throw new Error(mctx + ': enemy (monster id) is required');` |
| …そしてfootprintをenemy defから解決する | `shared/content_validate.cjs:509-512` | `const def = enemyDefs[m.enemy]; if (!def) throw new Error(mctx + ': names monster "' + m.enemy + '", which has no live def');` |

## 5. `Battle.modeConfig`

### 5.1 その形

```js
// sim/lib/mode_gate.cjs -- REQ-0259. THE mode policy. One table, one place.
// Replaces the eight hand-written `modes.includes(encounterDef.mode)` checks
// listed in REQ-0259 s4. Q4: "Battle側の設定でどのmodeかで、有効な動詞を制限する".
const MODES = ['battle', 'detection', 'unlock'];   // == content/vocab.json `modes`, pinned by a test

function makeModeConfig(activeModes) {
  return {
    activeModes,                      // Mode[] -- may hold >1 (REQ-0049 parallel layering)
    verbGate(rayMode, verb, targetMode) { ... },   // s5.3
  };
}
```

`Battle`(brief §4より)は、`playerMap` / `enemyMap`と並んで`modeConfig: BattleModeConfig`を持
つ。**`Battle`はREQ-0256 §7.0(`sim/lib/battle.cjs`)によって生成され、そこで`modeConfig`フィー
ルドがRESERVE(予約)され、読まれることなく`null`にinitialiseされている。THIS REQ(本REQ)がそ
れにデータを投入する対象である** — §5.4の`battle.modeConfig.verbGate(...)`が走る時点までに、オ
ブジェクトも、フィールドも、その唯一のreaderも、全て揃っている。このchainはあえて述べる価値が
ある。なぜならそれは以前は途切れていたからである:REQ-0256 §7.0より前は、本プログラム内のどの
REQも`Battle`を一切生成していなかった。そして本REQの中心となる呼び出しは、誰も構築していないオ
ブジェクトに対して行われていたことになる。

### 5.2 `activeModes` — それが行わないこと

`activeModes`は、battle構築時にderive(導出)される:

```
activeModes = [encounterDef.mode]
              ∪ { att.mode for att in encounterDef.attachments }   // REQ-0049
```

現状のcontentでは、これは通常のpackであれば`['battle']`を、layeredなencounterであれば
`['battle','detection']`または`['battle','unlock']`を生む — **これは、現状`encounter.cjs:520`
の`attActive`式が手作業でinlineに計算しているものと、正確に同じである。** `activeModes`とはそ
の式に名前を与え、hoist(引き上げ)たものである。

**`activeModes`はSCHEDULING(スケジューリング)をgateするのであって、effectivenessをgateする
のではない。** あるinstanceの`cooldownSkills`のslotがliveであるのは、そのskillの`modes`が
`activeModes`とintersect(交差)する場合に限る(IFF)。これは**MODE-6**をVERBATIM(そのまま)保
つ:

> mode filtering: only POs whose `modes` include the encounter mode fire; the rest idle, their
> `every_secs` **pauses (does not accumulate)**

(訳:mode filtering(モードによる絞り込み):`modes`にencounterのmodeを含むPOのみがfireする;
残りはidle(待機)し、その`every_secs`は**pauseする(蓄積しない)**)

REQ-0256のモデルのもとでは、これは現状よりもさらに文字通りのものになる:`activeModes`の外にあ
るslotは、単に**`remainingTicks`を持たない** — 蓄積すべきtimerがそもそも存在しない。
`encounter.cjs:524-525`のコメントは、既にこれを意図として記述している(*「一致しないeffect:
このencounterがactiveである間は単にスケジュールされない(backlogするtimerが存在しない)」*);
tickモデルは、これをincidental(偶発的)なものではなくstructural(構造的)なものにする。

**この2つのgateは異なる問いであり、混同してはならない:**

| gate | 問い | 答え |
|---|---|---|
| `activeModes` | このinstanceのskillは、そもそもこのbattleでFIREし得るか? | scheduling(§5.2) |
| `verbGate` | このverbは、rayがtouchした対象に対してEFFECTIVEか? | effectiveness(§5.3) |

Q4が扱っているのはSECOND(2番目)の方である。1番目は既に存在しており、単にtidy(整理)されるだ
けである。

### 5.3 `verbGate` — そのpolicy table(方針表)

```js
verbGate(rayMode, verb, targetMode) -> bool
```

v1のtableであり、現状の挙動を正確に再現するものである:

| rayMode | targetMode | 許可されるverb | source |
|---|---|---|---|
| `battle` | `battle` | **ALL(全て)** | combat_spec §6.1:battleは§2-3の完全なsystemである |
| `battle` | `detection` | **NONE(なし)** | OQ12 — bruteforce(力任せの突破)は不可;REQ-0049のmode-purity(「battleのrayは?/chest/doorを無視する」) |
| `battle` | `unlock` | **NONE(なし)** | OQ12 — 「battleの武器は鍵を開けられない」 |
| `detection` | `detection` | **hitそのもの** — ダメージは無関係 | combat_spec §6.1:「hit = DISCOVERY(発見)」;§2.2:「hitとは*find(発見)*であって、ダメージではない」 |
| `detection` | `battle` | **NONE(なし)** | REQ-0049:「detection/unlockのrayは、生きているenemyを無害に通過する(ダメージなし、penetrationコストなし、停止なし)」 |
| `detection` | `unlock` | **NONE(なし)** | door chainは2つのSTAGE(段階)であって、cross-mode(mode横断)ではない(MODE-2) |
| `unlock` | `unlock` | **ダメージ系verb**(`strike`、`multi_strike`) | combat_spec §6.1:「Hitはダメージを与える;timeout前にHPを0にすれば勝利」 |
| `unlock` | `battle` | **NONE(なし)** | REQ-0049のtransparency(透過性) |
| `unlock` | `detection` | **NONE(なし)** | 同上 |

**対角線を読むこと。** このtableは:同一mode → 許可;cross-mode(mode横断) → inert(不活性)、
というものである。それこそがmode-purity(§6)であり、control flow(制御フロー)として8回書かれ
る代わりに、dataとして一度だけ表現されている。

**`detection`の行こそが、実質的な内容を持つ行である**。そしてこれこそが、gateが単なるmodeの組
ではなくVERB(動詞)を引数に取る理由である:detection modeにおいて、`strike`verbのDAMAGE(ダメ
ージ)はeffectiveではないが、TOUCH(接触)の方はeffectiveである — hitそのものがfindなのである。
`ray.cjs:74`は現状これを実装している(`if (mode === 'detection' && hitResult.isDiscovery) return …`)。
また`skills.cjs:236,242,251,261`はダメージの抑制を実装している(`if (mode !== 'detection' && verbEff.verb.t === 'strike')`
— `mode !== 'detection'`というguardは、`splashFn`だけで**4回**現れる)。**これら4箇所のinline
guardこそが、まさに`verbGate`が置き換える対象である。**

### 5.4 gateがCALL(呼び出)される場所

**1箇所のみ:hit boundary(命中境界)。** `sim/lib/skills.cjs`の`dealHitOnField` — 全てのhitが既
に流れ込む単一のchokepoint(絞込点)である(`skills.cjs:216, 222`、および`splashFn`の
verbごとのguard、`:236-276`)。

```js
// before applying any verb to `occ`:
if (!battle.modeConfig.verbGate(ray.frozen.mode, verb, occ.mode)) continue;   // INERT
```

**Inert(不活性)とは:ダメージなし、statusなし、penetrationコストなし、停止なし、を意味する。**
rayは、そのcellが空であるかのように通過する — これは、REQ-0049のtransparencyルールと
combat_spec §2.2の「破壊された占有者は通行可能である」に従えば、walkが既にnativeに(組み込み
として)扱っている形である(§6.2)。

`ray.frozen.mode`は、REQ-0257 §7.1のfrozenなフィールドである:**AT FIRE TIME(発火時点)の
mode。** rayのmodeは飛行中に変化し得ない。これはREQ-0257で述べられており、ここではそれに依拠し
ている。

## 6. これはREQ-0049とOQ12をPRESERVE(保持)する — 主張するのではなく、示す

### 6.1 Parallel layering(並行レイヤリング)はsurviveする — `activeModes`は2つ以上を保持し得る

REQ-0049の設計(`docs/REQ/done/REQ-0049-layered-encounters.md:42-49`)、原文まま:

> ### Mode-pure ray transparency — [LOCKED, vetoable]
> A ray interacts ONLY with occupants matching its own mode:
> - battle rays ignore "?"/chest/door entities (pass through; cannot break a chest);
> - detection/unlock rays pass through live enemies harmlessly (no damage, no penetration cost, no
>   stop).
> Rationale: dense packs must not shield traps (frustration), weapons must not bruteforce locks
> (OQ12), and cross-mode interference would make ray outcomes illegible. Boundary reflection &
> bounce budgets unchanged per mode (§2.2).

(訳:### Mode-pure(モード純粋)なrayのtransparency(透過性) — [LOCKED、vetoable(拒否可能)]
rayはONLY(自らのmodeに一致する占有者とのみ)相互作用する:
- battleのrayは"?"/chest/door entityを無視する(通過する;chestを壊せない);
- detection/unlockのrayは、生きているenemyを無害に通過する(ダメージなし、penetrationコストな
  し、停止なし)。
根拠:密集したpackがtrapを覆い隠してしまってはならず(frustration=不満の原因になる)、武器は
lockをbruteforce(力任せに突破)してはならず(OQ12)、cross-mode(mode横断)の干渉はrayの結果を
判読不能にしてしまう。boundary reflection(境界反射)とbounce budgetはmodeによらず不変
(§2.2)。)

**それぞれの条項は、§5.3のtableへとそのまま対応する:**

| REQ-0049の条項 | §5.3の行 |
|---|---|
| 「battleのrayは?/chest/doorを無視する(通過する;chestを壊せない)」 | `(battle, detection) → NONE`, `(battle, unlock) → NONE` |
| 「detection/unlockのrayは、生きているenemyを無害に通過する」 | `(detection, battle) → NONE`, `(unlock, battle) → NONE` |
| 「ダメージなし、penetrationコストなし、停止なし」 | §5.4の「inert」— 3つとも該当 |
| 「boundary reflectionとbounce budgetはmodeによらず不変」 | **無変更** — gateはHIT boundary(命中境界)にある;反射はgeometryである(REQ-0257 §9) |
| 「rayは自らのmodeに一致する占有者とのみ相互作用する」 | **tableの対角線** |

**`activeModes: Mode[]`こそが、並行する半分を生かし続けているものである。** layeredな
encounterは`['battle','detection']`を持つ;battleのinstanceと"?"のinstanceはBOTH(両方)がfield
上に存在し、BOTH(両方)がtickしており、それぞれのrayは互いを通過する。これはREQ-0049の設計その
ものであり、無変更のまま、`encounter.cjs:520`のinlineな`attActive`の論理和式と`:663/:665`の
else-ifチェーンの代わりに、1つのtableとして表現されているだけである。

### 6.2 `(battle, unlock)`のケースは既にfree(無料)で手に入っている

REQ-0049の実装ノート(`encounter.cjs:279-284`)は、mode-purityが現状**structurally(構造的に)**
達成されていると述べている、原文まま:

> Mode-pure by construction: attachment POs (detection/unlock) resolve ONLY against attachments;
> battle rays only ever target enemies -> neither can touch the other's occupants.

(訳:構造によってmode-pureになっている:attachmentのPO(detection/unlock)はattachmentに対して
のみ解決される;battleのrayは常にenemyのみをtargetにする -> どちらも互いの占有者にtouchできな
い。)

すなわち、現状purity(純粋性)が保たれているのは、この2つが`targetActors`リストを一切共有しな
いからである — `resolveDetection`/`resolveUnlock`(`:354-385`)はそもそもrayを一切fireしない;
それらはattachmentへ直接short-circuit(直結)し、`ray_fire`/`ray_hit`イベントを**synthesise
(合成)する**(`:359, :378-379`)。

**本REQは、purityをemergent(創発的)なものからEXPLICIT(明示的)なものへと変える。これは実質
的な強化である。** gimicが`IBattleInstance`にcompileされ、monsterと同じmap上に立つようになれば
(§7)、この構造的な保証はEVAPORATE(蒸発)する — battleのrayの`liveOccupantFn`は、今やその経路
上にchestを見出すことになる。**その瞬間にOQ12を真であり続けさせるのが`verbGate`である。** 本
REQなしでは、§7の統一は、剣がchestを壊すことを静かに許してしまうことになる。

それが、この依存関係を一文にまとめたものである:**§7は、OQ12を(たまたま)強制していた偶然を取
り除く;§5はそれをルールで置き換える。** §5なしに§7をlandしてはならない。

### 6.3 OQ12はsurviveする — 具体的なケース

combat_spec **[LOCKED OQ12]**、原文まま:

> discovery/unlock is **strictly mode-gated** — combat (`battle`) weapons do NOT contribute to
> trap/door detection or chest unlocking (no bruteforce).

(訳:discovery/unlockは**strictly mode-gated(厳密にmodeでgateされて)いる** — combat
(`battle`)の武器は、trap/doorの検知やchestのunlockに一切貢献しない(bruteforce不可)。)

**§5.3に照らしてテストする:** 剣によるbattle-modeの`strike`が、unlock-modeのchestにtouchす
る。`verbGate('battle', {t:'strike'}, 'unlock')` → 行`(battle, unlock)` → **NONE** → inert →
rayは通過し、chestは何も受けない。**OQ12は成立する。** これが§16.3の受け入れテストの、原文ま
まの内容である。

## 7. Monster/gimicのunification(統一)

### 7.1 その依存関係

**gimicはREQ-0211である(構築済み、UNMERGED=未merge)。** REQ-0255がこれをmergeする
(`req-0211-gimic-content-kind`、merge-base `cc575e2`から+10コミット)。本REQはそのmergeに依存
し、それより前に開始してはならない。branchから読む
(`git show req-0211-gimic-content-kind:docs/REQ/built/REQ-0211-gimic-content-kind.md`)、
`gimic/1`のschema:

| field | value |
|---|---|
| `id` | 安定したid、例:`trap_frost_deadfall` |
| `behavior` | **判別子**:`trap` \| `treasure` \| `hidden_door` |
| `type` | engineのsubtype:`trap` \| `door_stage1` \| `door_stage2` \| `chest` |
| **`mode`** | **`detection`(trap/隠されたものがFOUND=発見される) \| `unlock`(chest/doorがOPENED=開かれる)** |
| `footprint` | `[fh, fw]` — 「simのpack boardが使うtranspose(転置)の慣例」 |
| `hp` | detectionのtrap/doorは1;chest/door-stage2は実際のraceのHP |
| `masked` | 発見されるまでreplay上で`"?"`として表示される |
| `timeout_secs` | interaction(操作)のclock |
| `skills` | gimicがfireするskill id |

そして`GIMIC_BEHAVIOR_MODES = {trap:[detection], treasure:[unlock], hidden_door:[detection,unlock]}`
が、そのvalidatorによって強制されている。

**gimicのschemaはALREADY(既に)`mode`をCARRY(保持)している。** これが§7における単一最重要の
事実である:`IBattleInstance.mode`(REQ-0256 §8.3)は新しいauthoring(content制作)上の負担では
ない — それはgimicのdefからそのまま読み取れる。そしてREQ-0211は既に`behavior → 許可されるmode`
を強制しているため、「unlockであるtrap」は、本REQが目にする前から既に表現不可能である。**この
unificationは、briefが示唆するよりも安上がりである**。その理由は、REQ-0211がそれと知らずにこれ
に備えた設計をしていたからである。

`IBattleInstance.mode`は次のように解決される:

| instanceの由来 | `mode` |
|---|---|
| BP(player) | `'battle'` — BPが取り得る唯一のmode |
| enemy(`enemies.json`) | `'battle'` — enemyのdefは`mode`フィールドを持たない;デフォルト値 |
| gimic(`gimics.json`) | **`def.mode`** — そのまま |

### 7.2 `members[]`が拡張される

現状の`content/live/dungeon/packs.json`(検証済み、live):

```json
{ "id": "pack_frost_scouts", "name": "Frost Scouts",
  "members": [ { "enemy": "frost_gnoll", "at": "B2" }, { "enemy": "ice_archer", "at": "C2" } ] }
```

**再定義するのではなく、ALTERNATIVE(代替)なキーで拡張する:**

```json
"members": [
  { "enemy": "frost_gnoll",         "at": "B2" },
  { "gimic": "trap_frost_deadfall", "at": "M9" }
]
```

**各memberについて、`enemy`か`gimic`のちょうど一方が必須である;両者はmutually exclusive
(相互排他的)である。**

**なぜ`enemy`キーを拡張するのではなく、2つ目のキーにするのか:** `enemy: "trap_frost_deadfall"`
はデータの中でのlie(嘘)になってしまう。そして`content/live/dungeon/packs.json`のport_noteは、
これらのレイアウトが**PORT(移植)であり、リバランスではない**と明言している — 既存の全member
は、その`enemy`キーをBYTE-IDENTICALLY(バイト単位で完全一致)に保つため、12個のgoldenはschema
変更だけでは動き得ない(§8)。discriminated(判別された)キーはまた、validatorのエラーメッセー
ジをnameable(名指し可能)にする(`members[3] ("trap_frost_deadfall")…`)。これは
`validateMonsterPackEntry`が既に`:507, :511, :520, :529`で使っている形である。

### 7.3 `validateMonsterPackEntry`が拡張される

`shared/content_validate.cjs:490`。signature:

```js
function validateMonsterPackEntry(pack, enemyDefs)              // today
function validateMonsterPackEntry(pack, enemyDefs, gimicDefs)   // after
```

唯一必要な変更、`:505-512`にて:

```js
// today
if (typeof m.enemy !== 'string' || !m.enemy) throw new Error(mctx + ': enemy (monster id) is required');
...
if (enemyDefs) {
  const def = enemyDefs[m.enemy];
  if (!def) throw new Error(mctx + ': names monster "' + m.enemy + '", which has no live def');
  if (def.footprint !== undefined) footprint = def.footprint;
}

// after: exactly one of enemy|gimic; resolve footprint from the matching registry
const hasEnemy = typeof m.enemy === 'string' && m.enemy;
const hasGimic = typeof m.gimic === 'string' && m.gimic;
if (hasEnemy === hasGimic) {
  throw new Error(mctx + ': exactly one of enemy (monster id) or gimic (gimic id) is required');
}
const memberId = hasEnemy ? m.enemy : m.gimic;
const defs = hasEnemy ? enemyDefs : gimicDefs;
if (defs) {
  const def = defs[memberId];
  if (!def) throw new Error(mctx + ': names ' + (hasEnemy ? 'monster' : 'gimic') + ' "' + memberId + '", which has no live def');
  if (def.footprint !== undefined) footprint = def.footprint;
}
```

この関数内のそれ以外の全て — `PLACEABLE`の範囲チェック(`:519-524`)、`claimed`によるoverlap
(重なり)検知(`:526-533`)、`parseA1`/`cellsFor` — は**idに依存せず、無変更である。** gimicは
ring(リング)チェックとoverlapチェックをfree(無料)で得ることになるが、これは正しい:chestが
marginに立つことが許されないのは、gnollと何ら変わらないからである。

**`hasEnemy === hasGimic`は、BOTH(両方)の失敗パターンを1行で捕捉する** — どちらのキーもない
場合(両方false)と、両方のキーがある場合(両方true)。2つの別々のチェックとしてではなく、この形
で書くこと;これは腐らない類のsymmetry(対称性)である。

### 7.4 Gimic-as-member(memberとしてのgimic)対REQ-0049のattachment — 両者はCOEXIST(共存)す
る。その理由

**これはbriefの中の欠落であり、実装前に埋めなければならない。なぜなら、今やgimicをfield上に置
く仕組みが2つ存在することになるからである。**

| | REQ-0049のattachment | REQ-0259のpack member |
|---|---|---|
| 宣言場所 | `encounterDef.attachments[]`, cap 2 | `monster_pack.members[]` |
| 配置方法 | seeded placement(乱数シードによる配置)(`encounter.cjs:302-315` `takeCluster`) | **authoring(制作)された**`at`アンカー |
| 保持するもの | reward、`timeout_secs`、doorの`stage`、`settled`/`discovered`状態 | positionとfootprintのみ |
| 解決方法 | `resolveDetection`/`resolveUnlock`(`:354-385`)+ encounter終了時のsettlement(`:393-399`) | 通常のray/hit経路 |
| 由来 | `dungen.cjs`のattachment抽選 | 手作業でauthoringされたpack |

**裁定:両者は共存する。本REQはこれらを統一しない。** attachmentとは*run-integration record
(runへの統合記録)*である — `runDungeon`に届くreward、shortcut、timeoutの結果を保持する
(`:789`が`attachmentRewards`、`doorShortcut`をreturnする)。gimicのpack memberとは*field上に立
つもの*である。どちらも`IBattleInstance`にcompileされる;attachmentだけが、それに加えてrunの状
態を保持する。

ここで統一しない根拠:REQ-0049のreward/timeout/stageの仕組みを`members[]`へ折り込むことは、そ
れ自体のuser-facingな(ユーザーに影響する)帰結を持つrun-integrationの再設計である(手作業で
authoringされたpack内のchestは何をDROP=ドロップするのか?)。これはQ4のmandate(委任事項)には
含まれておらず、Q4はverb gatingについてのものである。**REQ-0184のport noteおよびREQ-0258 §10と
同じ流儀である:修正はリバランスではなく、両者を混ぜればdiffが読めなくなる。** follow-up REQと
してflagしておく。

**ただし、この帰結は正直に書き留めておく:** 本REQの後、gimicは異なる能力を持つ2つの経路のどち
らからでもfieldに到達し得ることになり、これはwart(いぼ、すなわち小さな欠陥)である。これは、
mandateのない再設計よりは小さなwartであり、後になって発見されるのではなく、ここに書き留めてお
く。

## 8. Blast radius(影響範囲) — MEASURED(実測済み)

spec作成時点の`req-expedition-spec` @ `f918a65`で測定した。

| gate | command | 現在の実測値 | 本REQ後 |
|---|---|---|---|
| sim unit tests | `node sim/tests/run.cjs` | **117 passed, 0 failed** | green + 新規gateテスト(§16) |
| sim replay goldens | `node sim/tests/goldens.cjs` | **`goldens OK (12 cases)`** | **UNMOVED(不変)** — §8.1 |
| forecast parity | `node sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** | **UNMOVED(不変)** — geometryの変更なし |
| S4 post-processor | `node sim/tests/s4_test.cjs` | **14 passed, 0 failed** | green |
| REQ-0203 / 0207 / 0219 rosters | (3つのcommand) | **15 / 13 / 13, 0 failed** | green |
| REQ-0200 charge | `node sim/tests/unit_charge_test.cjs` | **13 passed, 0 failed** | green |
| REQ-0200 charge fusion | `node sim/tests/unit_charge_encounter_test.cjs` | **23 passed, 0 failed** | green |
| content check | `shared/content_validate.cjs`のconsumer | — | **新規ケース** — §8.2 |

### 8.1 goldenは動かない — これは主張であるため、その論拠を示す

**期待される結果:`goldens OK (12 cases)`、byte-identical(バイト完全一致)。** 独立した3つの
理由がある:

1. **§5.3のtableは、現状の挙動を正確に再現している。** 全ての行は、simが既に実装しているルー
   ルから書き写されたものである(`splashFn`内の4箇所の`mode !== 'detection'`guard、
   `ray.cjs:74`のdiscoveryのshort-circuit、8箇所の`modes.includes`site)。決定は同じであり、場
   所が1つになっただけである。
2. **gimicを通るgoldenは1件もない。** `goldens.cjs:63`の`baseOpts`は`formationId: 'formation1'`
   とbatch-002のcorpusに固定されている;12件のケースは`batch002/golden-{A,B,C}`、
   `dungen/default/L{1,3,5,8}/dg-{11,22}`、`dungen/test_fixed`である。**§7の`members[]`拡張は純
   粋にadditive(追加のみ)である** — 既存の全memberはその`enemy`キーをbyte単位で完全一致のまま
   保つため(§7.2)、`def_sha256`もまた動き得ない。
3. **REQ-0211が、まさにこの主張を既に証明している。** その自身のnote、原文まま:*「`gimics.json`
   はbyte-identicalなdungen defを生成する — **12個のリプレイgoldenはUNMOVED(不変)である**(証
   明済み、`goldens.cjs`はgreen)」*。

**もしgoldenが実際に動いてしまったら、本REQは意図しない挙動変化を起こしたということである。**
rebaselineするのではなく、debugすること。それが、「単なる再配置は再配置に過ぎない」という主張
にとって、利用可能な中で最も強い証明である。(注記:REQ-0256/0257の後にlandするということは、
goldenは既に2度動いていることを意味する;ここでの主張は、本REQが、その自分自身のbaseの上にさら
なる変化を追加しない、というものである。)

### 8.2 Contentのvalidation(検証)

`validateMonsterPackEntry`は*「機械的なチェックとsimの両方が共有する、唯一の定義」*である
(`shared/content_validate.cjs:542`)。これを拡張すれば、全ての呼び出し元に影響する。以下の新規
テストケースが必要である:

- `gimic`と有効なdefを持つmember → pass(合格)する、footprintはgimicのdefから
- `enemy`と`gimic`のBOTH(両方)を持つmember → `exactly one of…`をthrowする
- NEITHER(どちらも)持たないmember → `exactly one of…`をthrowする
- `PLACEABLE`(B2:Y17)の外にあるgimic member → `outside the placeable area`をthrowする(継承に
  より無料で得られる)
- enemy memberとoverlap(重なり)するgimic member → `overlaps members[...]`をthrowする(継承に
  より無料で得られる)
- **既存の全packが引き続き無変更でvalidateされること** — §8.1の主張のためのregression net(回
  帰防止網)

### 8.3 CONTENT_ROOT — 継承

REQ-0255 §7.1 / REQ-0256 §12.3。merge後は、この分割された呼び出し方が必須になる。そしてこれ
は本REQに特に影響する:**`gimics.json`は、その不在が13件のphantom(幻の)ENOENT失敗を引き起こ
す2つのfileのうちの1つである。**

```
CONTENT_ROOT=$PWD/content node sim/tests/run.cjs    # and forecast_parity, s4_test, roster tests
node sim/tests/goldens.cjs                          # NO CONTENT_ROOT -- it pins its own roster
```

## 9. `game_golden.md` §4 — その論拠を検証する。成立しない箇所はどこか

brief(§2)は次のように主張している:

> **asymmetric-combat golden is NOT violated.** game_golden §4 says "enemies do NOT have backpack
> systems". The user's (b) makes the INTERFACE symmetric, not the CONTENT: enemies still have no
> canvas/BP/socket/link — they are born flat. Players are compiled flat. Same interface, different
> provenance. This is combat_spec ruling 3 restated.

(訳:**asymmetric-combat(非対称戦闘)のgoldenに違反していない。** game_golden §4は「enemyは
backpack systemを持たない」と述べている。ユーザーの(b)がsymmetric(対称)にするのはINTERFACE
(インターフェース)であって、CONTENT(中身)ではない:enemyは依然としてcanvas/BP/socket/link
を持たない — enemyはflat(平坦)な状態で生まれる。playerはflatにcompileされる。同じinterface、
異なるprovenance(出自)。これはcombat_spec ruling 3の言い換えである。)

**判定:この論拠は、それが引用している条項についてはHOLD(成立)する。ただしbriefはgoldenの半
分しか引用していない。** `docs/user_managed/game_golden.md:44-45`、原文まま — **両方**の文:

> - **Asymmetric combat [DECIDED, review round 2]:** enemies do **NOT** have backpack
>   systems. Only players hold canvases; enemies run bespoke stat/behavior algorithms.

(訳: - **Asymmetric combat(非対称戦闘)[DECIDED(決定済み)、review round 2]:** enemyはbackpack
systemを**持たない**。canvasを持つのはplayerのみである;enemyはbespoke(専用に作られた)な
stat/behaviorアルゴリズムで動く。)

### 9.1 第1文 — HOLD(成立)しており、成立し続ける

*「enemyはbackpack systemを持たない。canvasを持つのはplayerのみである」* — **現状もTRUE(真)
であり、本プログラムの後もTRUE(真)である。** 検証済み:enemyは`sim/lib/packs.cjs`の
`compileEnemyPack`によって`enemies.json`(`hp`、`footprint`、`skills[]`)からcompileされる;
enemyはcanvasもBPもsocketもlinkも`linkEdges`も持たない。REQ-0256のflatteningは、PLAYER側を
enemyの形へTOする(compileする)のであって、enemyにbackpackを与えるのではない。**異なる
provenance(出自)、同じinterface** — briefはここでは全く正しい。そしてこれこそが設計意図を担
う条項である(P1「Fit is power」はPLAYER側の柱である;enemyにcanvasを与えれば、それを骨抜き
にしてしまう)。

### 9.2 第2文 — 本プログラムが何かに触れるより前から、既にFALSE(偽)である

*「enemyはbespokeなstat/behaviorアルゴリズムで動く」* — **現状NOT TRUE(真ではない)。** brief
はこの文に一切言及していない。sourceに対して検証した:

- `combat_spec §4.1`(ruling 3)、原文まま:*「**skill**とは、player側のPOと**同じcontent
  pipeline、effect-AST、closed vocab**でauthoringされたeffect(またはeffectの束)である……両者
  ともS1–S8(content_pipeline.md)を無変更のまま通過する。」*
- `combat_spec §3.5`、原文まま:*「同一の`walk`が、player→enemy(enemy側のfield上)とenemy→
  player(player側のfield上)の両方で走る。唯一の違いは、どちらの平面のoccupancy mapが参照され
  るかだけである。」*
- コードもこれに一致する:`sim/lib/skills.cjs`の`fireSkillRay`は、player側のfire
  (`encounter.cjs:611`)とenemy側のfire(`encounter.cjs:691`)の両方について、**同じ**関数、同
  じ`walkRay`、同じ`dealHitOnField`、同じstatus systemで呼ばれる。

**bespokeなenemyアルゴリズムなど存在しない。combat_spec v0.2(2026-07-05)以降、それは一度も存
在していない。** これはgame_golden v2(2026-07-02にratify=批准)よりLATER(後)であり、かつユ
ーザーがratifyしたものである。したがってこの文は、その後のユーザー裁定によってsupersedeされて
おり、docの方が一度も更新されなかっただけである。

### 9.3 本REQがこれに対して行うこと:ASK(確認する)。編集はしない。

PROJECT.md:*「`docs/user_managed` = golden、ユーザー検証済みであり編集禁止」*。`game_golden.md`
自身の1行目:**「LLM MAY NOT EDIT THIS FILE BUT ONLY THE USER(LLMはこのファイルを編集してはな
らず、編集できるのはユーザーのみである)」**。したがって本REQはこれに触れてはならない。

**本REQはこのdrift(乖離)をCAUSE(引き起こ)していない** — それは3週間前から既にliveなもので
ある。しかし本REQはこれを最大限visible(可視)にする:§7の後、monsterもgimicもBPも全てが
`IBattleInstance`となり、1つのtableでgateされ、1つのloopでfireされる。§4を読む者は、enemyが
何かbespokeなものを動かしていると結論づけてしまうだろうが、実際にはそうではない。

**依頼する改訂内容。ユーザーが一度の作業で行えるよう、正確な行を示す:**

| 行 | 現状 | 依頼する内容 |
|---|---|---|
| **45** | `  systems. Only players hold canvases; enemies run bespoke stat/behavior algorithms.` | 第1文はVERBATIM(そのまま)保つ(これがload-bearing=結論を支える文である、§9.1)。第2の節を`Only players hold canvases; enemies are born as flat HP + skill lists and run the SAME combat pipeline as players (combat_spec ruling 3, 2026-07-05). The asymmetry is in the CONTENT (who has a backpack), not in the ENGINE.`に置き換える。 |

**これはdesignの変更ではなく、documentationの修正である。** そしてユーザーは、これと正反対の
裁定を下すことも同様にあり得る:goldenの方が正しく、combat_spec ruling 3の方が行き過ぎていた、
という裁定である。それはもっと大きなfindingになるだろう — ruling 3、enemyのschema(VX-2)、そ
して本プログラムの§7全体を再検討することになる。**まさにそれゆえに、これは静かに片付けられるの
ではなく、問いとしてユーザーに委ねられるのである。** REQ-0258 §7.2の`backpack_battle_spec.md`
の改訂とは異なり、こちらは**hard blocker(必須の障壁)ではない**:コードは既にこの通りになっ
ているため、本REQはstale(陳腐化)したdocのまま出荷することができる。そうすべきではないが、そ
れは可能である。

## 10. Scope(範囲)

**In(対象):**
1. `sim/lib/mode_gate.cjs` — NEW(新規)。`makeModeConfig`、`activeModes`、`verbGate`(§5)。
   `MODES`は`content/vocab.json`に対してpinされる。
2. `sim/lib/encounter.cjs` — 散在していた8箇所の`modes.includes(...)`(§4)は、`activeModes`
   (scheduling)+ `verbGate`(effectiveness)へとcollapse(収束)する。`:520`のinlineな
   `attActive`は、§5.2のderivation(導出)になる。
3. `sim/lib/skills.cjs` — `dealHitOnField`のhit boundaryで`verbGate`が呼ばれる(§5.4);
   `splashFn`の4箇所の`mode !== 'detection'`guard(`:236, :242, :251, :261`)はこれによって置
   き換えられる;未使用の`effectModesOf`は**その2箇所、すなわち定義(`:309-311`)ANDエクスポー
   ト(`:404`)の両方で削除される**。定義だけを削除すると、モジュールがロード時に壊れる。
3b. `sim/README.md:312` — **`effectModesOf`のdocumentationも、それと運命を共にする。** 現状の
   原文:*「effect自身の`modes`(存在する場合)は、それを所有するPOの`modes`を上書きする
   (combat.cjs内の`effectModesOf`参照) — これにより、必要であれば単一のPOが異なるmodeにgate
   された複数のeffectを持つことができる。ただし現状のcontentはPOレベルでgateしている。」* こ
   れをそのまま残すことには2つの問題がある:その関数はもはや存在しないこと、そしてこの段落は
   **POレベルのmode gating**を文書化しているが、これはまさに本REQがBattleへと移す方針そのもの
   である(§1)。単に削除するのではなく、`mode_gate.cjs`の`verbGate`へと向け直す — 読者は、
   mode gatingがどこにあるのかを引き続き知る必要があるからである。(このdocは既に置き場所を誤
   っている点にも注意:*「combat.cjs内」*と書かれているが、実際には`sim/lib/skills.cjs`内であ
   る。)
4. `sim/lib/compile.cjs` / `sim/lib/packs.cjs` — §7.1に従って`IBattleInstance.mode`が投入され
   る。
5. `shared/content_validate.cjs` — `validateMonsterPackEntry`が拡張される(§7.3)。
6. `content/live/dungeon/packs.json` — **データの変更はNO(なし)。** schemaは拡張されるが、
   dataは無変更である(§7.2、§8.1)。
7. `sim/tests/run.cjs` — §16のgateテスト;§8.2のvalidatorケース。
8. `docs/llm_managed/combat_spec_draft.md` — §6.1/§6.2/MODE-6/OQ12を、gateがBattle上にあると
   述べるよう改訂する;**RULE(ルール)自体は無変更である**(§6)。
9. `docs/user_managed/game_golden.md:45`(§9.3)についてのASKをユーザーに行う。

**Out(対象外):**
- **REQ-0049のattachmentとpack memberを統一すること**(§7.4)。Follow-up(後続対応)とする。
- **いかなるmode RULE(ルール)も変更すること。** §5.3はtranscribe(書き写す)のであって、
  legislate(立法)するのではない。もしある行が誤っているなら、それはユーザーの決定事項であり、
  本REQの決定事項ではない。
- **`docs/user_managed/*`を編集すること。** 禁止(§9.3)。
- **tickループ / `cooldownSkills`** — REQ-0256。**Ray flight / `ray.frozen.mode`** — REQ-0257。
- **Gimicのアート / Dex** — REQ-0211、既に構築済み。
- **gimic memberをUSE(使用)するようpackをre-authoring(再制作)すること。** schemaは拡張され
  るが、それを使うことは、それ自体のratification(批准)を要するcontent制作作業である。
  REQ-0184のport noteと同じ流儀である。
- **e2eのharness(試験装置)。** 本プログラムのgateではない(Q2)。decade
  **7590 / 7591 / 7592**(`5000 + 259*10 + {0,1,2}`)は、numberingにより予約済みだが未使用のま
  まとする。

## 11. Acceptance criteria(受け入れ基準)

1. **`grep -rn "modes.includes" sim/`がZERO(ゼロ)件を返すこと。** 8箇所全て(§4)が
   `mode_gate.cjs`を経由するようになること。**`grep -rn "effectModesOf" .`が`docs/REQ/`の外で
   ZERO件を返すこと** — 3つの参照全てが消えていること:定義(`skills.cjs:309-311`)、エクスポ
   ート(`skills.cjs:404`)、そしてdocumentation(`sim/README.md:312`、§10.3bに従って
   `verbGate`へ向け直される)。定義だけをgrepしていたことが、残り2つが最初のdraftで生き残って
   しまった原因である。
2. `sim/lib/mode_gate.cjs`の`MODES`が、テストによって`content/vocab.json`の`modes`と等しくpin
   されること — closed vocabularyの出所は1つになる。
3. **OQ12をテストとして:** unlock-modeのchestに対するbattle-modeの`strike`がINERT(不活性)で
   あること — ダメージなし、statusなし、**penetrationコストなし、停止なし**(4つ全て、
   §5.4)。chestのHPは無変更であり、rayは継続する(§6.3)。
4. **REQ-0049のtransparencyをテストとして:** detection-modeのrayが、生きているbattle-modeの
   enemyをダメージ/pen/停止なしに通過し、それでもなおその背後の"?"をdiscover(発見)するこ
   と。これは§6.2が「structuralであることをやめ、ルールになる」と述べているケースである。
5. **Parallel layeringをテストとして:** battle + detectionのlayeredなencounterにおいて、
   `activeModes.length === 2`であり、両方のinstance集合がtickし、どちらのrayも互いの占有者に
   影響しないこと。
6. **MODE-6をテストとして:** その`modes`が`activeModes`の全エントリーを除外しているPOは、
   `cooldownSkills`のtimerをNO(全く持たない)こと — これは単にfireされないというだけでなく、
   slotがABSENT(存在しない)ことをassertすることで証明される(§5.2)。counterがないため、
   backlogを蓄積することができない。
7. `validateMonsterPackEntry`が`{gimic, at}`を受け入れ、両方のキーとどちらのキーもない場合を
   `exactly one of…`メッセージでrejectし、`PLACEABLE` + overlapチェックをgimic memberに適用す
   ること(§8.2)。
8. 既存の`packs.json`の全エントリーが**無変更で**validateされること。
9. **`sim/tests/goldens.cjs`がbyte-identical — 12ケースがUNMOVED(不変)**であること、本REQ自
   身のbaseにおいて(§8.1)。もし動いたら、rebaselineするのではなく、debugすること。
10. `sim/tests/forecast_parity.cjs`が18/0、不変であること。`sim/tests/run.cjs`がgreenであるこ
    と。
11. gimic instanceの`mode`が`def.mode`から読まれること;enemyのそれはデフォルトで`'battle'`に
    なること;BPのそれは`'battle'`であること(§7.1)。3つ全てについてassertされること。
12. §3の解釈がユーザーにPUT TO(提示)され、ratify(批准)されるか置き換えられるかしているこ
    と。**本REQは、一文の裁定に対する未レビューの解釈のまま出荷されることはない。**
13. §9.3の`game_golden.md`についての問いが、ユーザーに問われ、答えられていること(改訂する
    か、あるいはcombat_spec ruling 3が行き過ぎていたと裁定するか — 後者は§7を再検討すること
    になる)。
