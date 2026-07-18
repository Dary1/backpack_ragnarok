# REQ-0265 — art-monster-skill-icons: 81個のskill、artはゼロ — batch、law、そして18ピクセル問題

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKEDである。作業を開始する
前にユーザーの判断が必要な点が3つある:(1) §7 — **badgeは18 pxであり、批准済みgolden G4の可読性
のfloor(下限)は64 pxである。** badgeは**本programがこれまでに出荷したすべてのiconを支配する
lawのfloorを3.6倍下回っている**;批准済みのAnime style layerが作るのはillustration(イラスト)で
あり18-pxのpictogram(絵文字的記号)ではないため、direction(方向性)が`skill`用のtemplateを得るか
(ユーザーのdesign裁定が必要 — 現行のdirectionはユーザーが*結果を見て*批准したものである)、それ
とも、artはユーザーが置くよう求めた場所では読み取れないままになるかのいずれかである。(2) §6 —
**新しいart kind `skill` vs `custom`**。これについては、2つの現行の先例(REQ-0175 / REQ-0179)が
互いに矛盾しており、REQ-0264 §6とまったく同様である。(3) §5.4 — **batchは81個のasset**であり、
実測GPUコストは**約51分〜約4.4時間**である;このサイズのbatchはimplementation上の細部ではなく、
commissioning(発注)の決定である。
**予約日:** 2026-07-18
**スラッグ:** art-monster-skill-icons
**ブランチ:** req-expedition-spec(仕様のみ)
**依頼者:** user、2026-07-18 — 仕様項目(l)、原文まま:「モンスターの場合は、〇の中にスキルアイコ
ン(**存在しないので、要art向けのreq**)を書き…」。
**依存先:** **REQ-0263**(expedition-instance-hud) — HARD(必須)、しかも二重に:その**§8.2の
layout rule**が、このartのtarget sizeを定める唯一のものであり(§7)、その**§8.3のplaceholder**
(verb rune)が本REQのlanding surface(着地面)である。**REQ-0151**(registry + sizing law)、
**REQ-0152**(kit群)、**REQ-0179**(`custom` kind — §6の代替案)、**REQ-0211**(ruling 3の「同一
に設定する」という先例、そして81個のskillのうち2つを所有する`gimic`defs)。
**関連:** **REQ-0228**(dex-monster-skill-effects、`draft/`) — 自然な消費者である。§13は、両者
が補完的であること、そして**本REQがREQ-0228の未決定の(a)/(b)にstake(利害関係)を持つこと**を
示す。
**ブロック対象:** なし。本REQはskill artをPOSSIBLE(可能)にし、そのbatchを規定する。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §6。

## 1. ゴール

仕様項目(l)は、monster/gimicのinstanceごとに、skillごとの1つのbadgeを描く:「〇の中にスキルアイ
コン」 — 円の中のskill icon。**そのiconは存在しない。** REQ-0263 §8.3がそれを検証し、
placeholderを出荷した;本REQは、本物を**registry art**として作成する。

**deliverable(成果物)はART REQUESTであり、重要な問いはただ1つである:何個のassetを、どのsizeで、
どのruleに従って、どうやってcheckするのか。** §5が1つ目に答え(**81**)、§7が2つ目に答え
(**256×256、18 pxで消費される**)、§8/§9が3つ目に、§12が4つ目に答える。

**明示的にscope外:** badgeのcircle、wedge、layout、overflow、frame-flash — **すべてREQ-0263
§8**。Ray/hit VFX — **REQ-0264**。Dex内のskill*mechanics(機構)* — **REQ-0228**(§13)。あらゆる
artのgeneration — ユーザーがart pipelineを実行する(PROJECT.md HANDS-OFF);本REQは`ComfyUI/`、
`monster_matte_variants/`、`*-artsession`のworktree、いかなるGPU出力にも一切触れない。

## 2. これを承認する裁定

ブリーフ§6より、原文まま:

> Monster skill charge (l): a circle + skill icon, clockwise translucent-black charge, laid out
> top-right of the drawn art, one per skill, passives included. **Skill icons DO NOT EXIST** — art
> kinds today are `['po','si','unit','monster','bpskin','custom']`
> (`server/services/art_sizing.cjs` KINDS) (+`gimic` after REQ-0255's merge). -> art REQ-0265.

(訳:Monster skill charge(l):円 + skill icon、時計回りのtranslucent-black〔半透明の黒〕charge、
描かれたartの右上に配置、skillごとに1つ、passiveを含む。**Skill iconはDO NOT EXIST(存在しない)**
— 現在のart kindは`['po','si','unit','monster','bpskin','custom']`である
(`server/services/art_sizing.cjs`のKINDS)(REQ-0255のマージ後は+`gimic`)。-> art REQ-0265。)

REQ-0263 §10(「Out」= 含まれないもの)は、それを名指しで本REQに割り当てている:
*"**Real skill art / a `skill` art kind** — REQ-0265. §8.3 ships the placeholder."*(訳:本物の
skill art / `skill`というart kind — REQ-0265。§8.3がplaceholderを出荷する。)

## 3. 検証済みの現状 — すべての行が実測されたものであり、想定ではない

| fact | source | evidence |
|---|---|---|
| **`skill`というart kindは存在しない** | `server/services/art_sizing.cjs:24` | `const KINDS = ['po', 'si', 'unit', 'monster', 'bpskin', 'custom'];`(REQ-0255後は+`gimic`) |
| **81個のliveなskill、81個の一意なid** | 実測、`content/live/dungeon/skills.json` | `schema: "skill/1"`;81entry;`len(set(ids)) == 81` |
| …そして**`skills.json`は0211 branch上でBYTE-IDENTICAL(バイト単位で同一)である** | 実測 | `git diff HEAD req-0211-gimic-content-kind -- content/live/dungeon/skills.json` -> **空**。
**REQ-0255がREQ-0211をマージしても、batch sizeは動かない。** §5.3 |
| **81すべてが`name_en`と`name_ja`の両方を運ぶ** | 実測 | `missing name_en: 0`、`missing name_ja: 0` — §12 |
| …flatであり、`i18n`blockでは**ない** | 実測 | 81のうち`has i18n block: 0`。対照的に`packs.json`のentryは`i18n:{en:{name},ja:{name}}`を運ぶ
— **1つのtree内に2つのi18n dialect(方言)**(§16) |
| **81すべてのtriggerが`every_secs`である** | 実測 | `{'every_secs': 81}` — **passiveはゼロ。** REQ-0263 §8.4を裏付ける |
| verbのtaxonomy(分類体系)は**6つで閉じている** | 実測 | `strike:30, apply_status:27, bonus_vs_status:9, lifesteal:7, multi_strike:6, heal_ally:2` = 81。
**REQ-0263 §8.3を正確に裏付ける** |
| **`element` fieldは存在しない** | 実測 | 実際のentryは`{id, name_en, name_ja, trigger, verb, attack_profile, modes}`である
(+ optionalな`note`)。REQ-0262 §9.1を裏付ける |
| `modes`は**80がbattle + 1がunlock**である | 実測 | 外れ値は**`door_keeper_strike`**である(`modes:["unlock"]`) — gimicのdoor skillである。§5.2 |
| liveなenemy44体;enemy1体あたりのskill数`{1:10, 2:33, 3:1}` | 実測、`enemies.json` | **最大3 = `hrimgrimnir`**、footprint `[3,3]`。REQ-0263 §8.2を裏付ける |
| liveなgimic4体;gimic1体あたりのskill数`{0:2, 1:2}` | 実測、`git show req-0211…:content/live/dungeon/gimics.json` | `trap_frost_deadfall`(1)、`door_rimefast_stage1`(**0**)、`door_rimefast_stage2`(1)、
`chest_frostbound_cache`(**0**) |
| **`packs.json`はskillを一切referenceしない** | 実測 | `monster_pack/1`、14entry;memberの例は`{"enemy":"frost_gnoll","at":"B2"}`。**Packは
ENEMYをreferenceするのであり、skillではない。** §5.2 |
| すべてのenemyがいずれかのpackによって配置されている | 実測 | 44体中44体;**orphan(孤立)はゼロ** — §5.3 |
| `si`は**256×256**にlockされている | `art_sizing.cjs:87-88` | `case 'si': return { width: 256, height: 256 };` — §7.2 |
| `si.subject_frame`は**256×256向けに**authorされている | `tools/inspect_kits.json`;`art_pipeline.md` §8 | *"single-centered-subject + margin for 256×256 SIs"*(訳:256×256のSI向けの、中央に1つの被写体
+ margin);[S7]:content 0.03–0.92、largest_component ≥ 0.80、centroid_offset ≤ 0.25、
margin ≥ 0.02 |
| `custom`は**ZERO**個のkitへrouteされる | 実測、`tools/inspect_kits.json` | `applies_to`に`custom`を挙げているkitは1つもない — §6.2 |
| **G4 — 可読性のfloorは64 px** | `docs/llm_managed/unit_icon_pipeline.md` §1 | *"The silhouette must be identifiable at **64 px** (one board cell). … unreadable at 64 px =
**FAIL**."*(訳:silhouette〔輪郭〕は**64 px**〔board 1cell分〕で識別可能でなければならない。
……64 pxで判読不能 = **FAIL**。) — §7.3 |
| **G2 — artの中にgameplay stateを入れない** | 同上 | *"Connection shapes, **charge progress**, link rays, team/enemy tint are renderer overlays. An
icon containing an arrow, **gauge**, or beam is a **FAIL regardless of beauty**."*(訳:接続の形状、
**charge進捗**、link ray、team/enemyのtintはrenderer overlayである。矢印、**gauge**、beamを含む
iconは、美しさに関わらず**FAIL**である。) — §8 |
| **G7 — charge overlayはrendererにRESERVED(予約)されている** | 同上 | *"The Unit charge-state overlay is a ring fill…, renderer-drawn per G2… **Reserved here so no
icon bakes in ring-like framing that would collide with it**"*(訳:Unitのcharge-state overlay
はring fillであり……G2に従いrenderer側で描かれる……**それと衝突するようなring状のframingを
iconが焼き込まないよう、ここで予約する**) — §8 |
| Anime templateは**outline**を強制する | `tools/art_style.py`;`art_pipeline.md` §3 | `{prompt} anime++, bold outline, cel-shaded coloring, shounen, seinen`;
`KIND_TEMPLATE = {"item":"anime","unit":"anime","monster":"concept_art_fantasy"}` |
| style mapは4つのart kindで閉じている | `tools/art_job.py:15` | `KIND_TO_STYLE = {"po":"item","si":"item","unit":"unit","monster":"monster"}` — `custom`は
意図的に不在 |
| export pathは`content/art/<kind>/<system_name>.png`である | `server/services/art_export.cjs:39-41` | `path.join(exportRoot(), adopted.kind)` + `system_name + '.png'` |
| art resolutionは**kind-generic(kindに依存しない)**であり、exact-nameに対応している | `server/lib/content.cjs:230-240` | *"`resolveItemArtNames` is kind-generic (def.artwork_ref adopted -> exact-name adopted ->
omitted) and monster artworks follow the exact-name convention (artwork system_name == enemy
id)"*(訳:`resolveItemArtNames`はkind-genericである〔def.artwork_refがadoptされていればそれ
を、なければexact-nameがadoptされていればそれを、なければomitted〕、そしてmonster artworkは
exact-nameのconvention〔artwork system_name == enemy id〕に従う) — §10 |
| `computeArtUrls`はitems/sis/tms/**monsters**をjoinする — **skillもgimicもjoinしない** | `server/lib/content.cjs:226-249` | 1行の拡張は§10が所有する;gimic側はREQ-0259のものである(REQ-0261 §8.6) |
| `EXP_CELL=40`においてbadgeは**18 px**である | REQ-0263 §8.2 | `EXP_BADGE_D = clamp(cellPx * 0.45, 12, 20)` — §7.1がその算術を行う |
| GPU boxはpromptごとにswapする | `art_pipeline.md` §2 | RTX 2080、**8GB**:cold **450–540秒**;**prompt変更30–170秒**;同一prompt 2–20秒。
**"group work by prompt"**(訳:promptごとに作業をまとめよ) — §5.4 |

## 4. THE MEASUREMENT(実測) — batch size、そしてそれがどう数えられたか

**必要なasset数を述べないart REQは、actionable(行動可能)ではない。** そのため、taskが名指しする
すべてのsourceを横断して、これはestimate(推定)ではなくcount(計数)された。

**手法。** `content/live/dungeon/skills.json`(defのsource、`skill/1`)をparseし、次に
`enemies.json`(`enemy/1`)、gimic defs(`git show
req-0211-gimic-content-kind:content/live/dungeon/gimics.json`、`gimic/1` — **`entities.json`の
proxyではなく本物のfile**)、`packs.json`(`monster_pack/1`)がreferenceするすべてのskill idの
unionを取った。

```
skills.json (skill/1)                                   81 entries, 81 unique ids
  referenced by enemies.json    (44 enemies)            79 distinct skill ids
  referenced by gimics.json     (4 gimics, 0211 branch)  2 distinct skill ids
  referenced by packs.json      (14 packs)               0   <-- packs reference ENEMIES, not skills
  ------------------------------------------------------------
  UNION                                                 81
  skills.json ids NEVER referenced                       0
  referenced but absent from skills.json (dangling)      0
```

**このsurface(表面)はぴったり閉じる。** 79 + 2 = 81 = `skills.json`のすべてのentry。**飛ばすべ
き死んだcontentも、追跡すべき宙に浮いたreferenceも存在しない。**

### 4.1 ART BATCH SIZEは**81**である

```
81 skill icons.  One per skill id.  1:1, no variants, no rarity frames, no per-monster reskins.
```

**そのすべてが必要であり、これは想定ではなく実測に基づく主張である:**
- **参照されていないskillはゼロ** — `skills.json`の中に無駄な重みは何もない。
- **孤立したenemyはゼロ** — liveな44体のenemyすべてが、liveな14個のpackによって配置されており、
  したがって**enemy側の79個のskillすべてがplay中に到達可能である**。
- **2つのgimic側のskill**(`trap_deadfall_volley`、`door_keeper_strike`)はgimicを通じてのみ到達
  可能であり、これが§5.2が重要である理由である。

### 4.2 gimic defを読んで初めて見つかる2つのskill

**`packs.json`はskill idをZERO個しか提供しない** — memberの例は
`{"enemy": "frost_gnoll", "at": "B2"}`。**Packはenemyをreferenceし、enemyがskillをreferenceす
る。** したがってpackは*reachability(到達可能性)*のcheckであり(44体すべてのenemyがliveであ
ることを証明する)、skill idの*source*では決してない。**taskの前提 — 「`enemies.json` +
gimic defs + `packs.json`によってreferenceされる」 — はlookすべき箇所として正しく、
`packs.json`は何も生まないが;訂正すべき点は、その本当の貢献がreachabilityであるということであ
る**(§16)。

**gimicが存在するからこそ存在する2つのskill:**

| skill | owner | why it is easy to miss |
|---|---|---|
| `trap_deadfall_volley` | `trap_frost_deadfall`(`behavior:trap`、`masked:true`) | **masked(マスクされた)**gimicを通じてのみ到達可能;**それをreferenceするenemyは存在しない** |
| `door_keeper_strike` | `door_rimefast_stage2`(`behavior:hidden_door`、`mode:unlock`) | **tree内で`modes:["unlock"]`を持つ唯一のskill** — 80/81は`["battle"]`である。その`note`自身
が*"Included for completeness/symmetry"*(訳:完全性/対称性のために含まれている)と述べている |

**`enemies.json`だけから数えると79になり、両方を黙って落としてしまう。** REQ-0259はmonsterと
gimicを`IBattleInstance`として統一する;**art batchも統一されなければならない。さもなければ、
liveな4体のgimicのうち2体が、永遠にplaceholderのままbadgeされることになる** — そしてそのうちの
1つは*trap*、すなわちplayerが最も読み取る必要のあるものである。

### 4.3 batchはマージを通じて安定している — 検証済み

`git diff HEAD req-0211-gimic-content-kind -- content/live/dungeon/skills.json`は**空**である。
REQ-0211はgimic側での*rename + 1つのfieldの追加*であり、それ自身がそう述べている
(*"the 12 replay goldens are UNMOVED"*(訳:12個のreplay goldenはUNMOVED〔無変更〕である))。
**したがって81は、REQ-0255が0211をマージする前も後も81のままである**、そしてこのbatchはマージ
を待たずにcommission(発注)できる。**これは実際のscheduling上の事実である**、そしてこれが§5.4
のコストを今この時点で提示できる理由である。

### 4.4 81がboxにおいて何のコストになるか — 実測、なぜなら「81個のicon」はplanではないからである

`art_pipeline.md` §2は明確である:**"group work by prompt"**(訳:promptごとに作業をまとめよ)、
なぜならprompt変更は8GBカード上のQwen3-4B text encoderをreloadさせるからである。**81個のskill
= 81個の異なるprompt = 80回の避けられないprompt変更**であり、この項が支配的である:

| N candidates/skill | renders | GPU time (measured bounds) |
|---|---|---|
| 2 | 162 | **51分〜4.4時間** |
| 3 | 243 | **54分〜4.8時間** |
| 4 | 324 | **56分〜5.3時間** |

`= cold(450–540 s) + 80 × prompt_change(30–170 s) + 81×(N−1) × same_prompt(2–20 s)`

**operatorが開始前に(開始後にではなく)必要とする、2つの帰結:**

1. **候補はほぼ無料であり、skillはそうではない。** N=2からN=4にすると、下限で**約5分**増加する。
   **4つ目の候補の限界costは約2〜20秒;skillがもう1つ増える限界costは30〜170秒である。** したが
   って:**skillごとに気前よくgenerateせよ** — bottleneck(律速)なのはGPUではなく、gallery
   verdict(§7 S7)である。
2. **matte phaseは分離しなければならない。** `art_pipeline.md` §2:rembgの`alpha_matting`は
   **12〜13GB RSS**でpeakになり、*"will not fit beside a resident model. … This OOM has killed
   three runs."*(訳:常駐するmodelと同居できない。……このOOMはこれまで3回のrunを殺している。)
   したがって:`--no-matte`、**ComfyUIを停止**、`--rematte-only`。**81個のiconは、これを忘れる
   と何時間も無駄にする、まさにそのbatch sizeである。**

## 5. kindの決定 — **USER RULING REQUIRED(ユーザー裁定が必須)**

### 5.1 REQ-0264 §6.1が突き当たったのと同じboardの矛盾

| REQ | state | ruling |
|---|---|---|
| **REQ-0175** | `draft/`、"CLEARED TO IMPLEMENT"(訳:実装着手可) | user、2026-07-14:**「The art KIND itself — Add it — required, not optional」**(訳:art KIND
そのもの — それを追加せよ — 必須でありoptionalではない)、locked 768×768、
*"exactly as `unit` is locked at 512"*(訳:`unit`が512にlockされているのとまさに同じように) |
| **REQ-0179** | `built/` | user、2026-07-15:`custom`を追加し*"so a custom artwork can be assigned 'just as a texture' to
content that has no art-kind of its own"*(訳:custom artworkを、自身のart-kindを持たないcontent
に「単なるtextureとして」割り当てられるようにするため) — そしてREQ-0179 step Fは
**`skill_def`**を、picker(選択UI)の対象として明示的に名指ししている |

**REQ-0179 step Fは利用可能な最も鋭い証拠であり、両刃である。** 原文まま:
*"The artwork picker's `typeChips` gains `'custom'` … so a `gacha_pack` / `tm_def` /
**`skill_def`** def can filter to and link a custom artwork."*(訳:artwork pickerの
`typeChips`が`'custom'`を得る……したがって`gacha_pack` / `tm_def` / **`skill_def`**のdefが
custom artworkにfilterしlinkできるようになる。) **skill defが`custom` artworkをlinkすることは、
既にanticipate(想定)され、出荷され、機能しているpathである**
(`client/src/contentadmin/Workspace.tsx:56`)。したがって`custom`はここではhackではない —
**それは文書化された意図であり、今日機能している。** しかしREQ-0175は、asset classにlawがある
場合はいずれにせよkindを得るべきだと裁定した。**両方とも現行である。LLMは2つのユーザー裁定の間
を選ぶことはできない**(§16)。

### 5.2 discriminator(判別基準)、そして`skill`がそれにどう当てはまるか

REQ-0264 §6.2は、両先例が従っているルールを抽出している:**assetにLAWがあるときkindが存在する;
それがないとき`custom`が存在する。** 適用すると:

| property | law? | consequence under `custom` |
|---|---|---|
| **size** | **YES** — 81すべてに対して1つのlockされた正方形(§7.2) | 81個のartworkそれぞれに、operatorが型入力したresolutionがある。**256の代わりに250と型入力す
る機会が81回。** registryは*batch*のsystem of record(記録の基盤)である;81個の手打ちsizeを持
つbatchにはlawがない |
| **a machine check** | **YES** — `si.subject_frame`(単一の中央被写体 + margin、**256×256向けにauthorされた**)と
`matte.coverage_band`は、*まさに*このassetのcheckであり、既に存在している | **`custom`はZERO個のkitへrouteされる**(実測)。81個のassetが、いかなる機械inspectionも
**なしに**出荷される |
| **style coherence (G5)** | **YES、そしてこのscaleにおいては拘束力を持つ** — 81個のiconは1つのsetとして読めなければな
らない | `custom`のpromptは**templateを持たないpassthrough**である(`art_job.py:96-101`)。**81個
の手作業で背負われたstyleこそが、rosterがdriftする経緯である。** G5:*"A character that does
not sit in the roster lineup is a FAIL even if beautiful alone"*(訳:roster lineupに収まらない
characterは、単体では美しくてもFAILである) |
| **an authoring golden** | **YES** — §8のG2/G7ルールは*このasset classに固有*である | それをhangする場所がどこにもない |

**それを決するのはscale(規模)である。** **1つ**のtextureに対しては、`custom`が正しい — それが
REQ-0179のcaseであり、その論理は健全である。**sizeもstyleもkitもgoldenも共有しなければならない
81個のasset**に対しては、`custom`は*「lawは存在するが、それを強制するものが何もない、81回」*を
意味する。

### 5.3 ADOPTED(採用):art kind **`skill`**、**`si`と同一に**設定する — REQ-0211 ruling 3の動き

> **art kindとしての`skill` == art kindとしての`si`、同一に設定する。**

REQ-0211 ruling 3(*"Art kind `gimic` == art kind `monster`… same sizing law, same prompt default,
same shape editor — configured identically"*(訳:art kindとしてのgimic == art kindとしての
monster……同じsizing law、同じprompt default、同じshape editor — 同一に設定する))を直接model
にし、同じ方法で実装する:`art_sizing.cjs`内の**stacked case(積み重ねたcase)**
(`case 'skill': case 'si':`)であり、複製したconstantではない。

**命名。** art kindは素の名詞である;content kindは`<noun>_def`である。`po`のart ↔ `po_def`の
content;`si`のart ↔ `si_def`;**`skill`のart ↔ `skill_def`**(migration
`010_content_kind_skill_def.sql`)。**patternに完全に合致しており、ENUMの衝突もない** —
`artwork_kind`と`content_kind`は異なるtypeである。

### 5.4 monsterのskill iconは、PLAYERのPO iconと同じasset classなのか? — **論証:contentとしてはNO、lawとしてはYES**

taskはこれを直接問うており、それには異なる答えを持つ2つの半分がある。

**CONTENTとして:noであり、その違いはthematic(主題的)ではなくstructural(構造的)である。**

| | **PO — Placement Object**(`item_content_pipeline.md` §0.1) | **skill icon** |
|---|---|---|
| what it is | playerが8×8canvas上に**所有し配置するもの** | instanceがfireする**abilityのためのsymbol** |
| geometry | **cell footprintを持つ。** `po`のsizeは、256px/cellでの5×5 shape maskから*derive(導出)*さ
れる(`art_sizing.cjs:84-86`) | **cellを一切占めない。** footprintを持たず、boardに触れることは決してない |
| authority | REQ-0188:defのcell shapeに対して**artがauthoritative(正式)**である;`derive --write`はart
をdefへ伝播させる | **導出すべきものが何もない。** skillには、authoritativeであるべきshape fieldが存在しない |
| conditioning | `shape_lock`(REQ-0183/0186)はmaskに基づいてgenerationをconditionする — **po専用**
(`art_job.py:po_shape_mask`は他のいかなるkindに対しても`None`を返す) | **適用不能であり、適用され得ない** |
| sprite sheet | PO/SIは`content/sprite_all_v12.svg`内に`<symbol>`としても存在する | **symbolは存在せず、存在すべきでもない** — §11 |

**したがって:skill iconはPOでは*ない*。** それに`po`のlawを与えることは、cellを持たないものの
ために5×5のcell maskを描くことを意味する — REQ-0264 §8.3がVFXについて却下したのと同じ
category error(範疇の誤り)であり、同じ帰結を伴う:`shape`のjsonbが恒久的な虚偽を運ぶことにな
り、REQ-0188のdoctrineはそれを*authoritative*なものとして扱ってしまう。

**LAWとして:yesである — それは`si`であり、だからこそ`si`が正しいtemplateなのである。**

| | `si` — Socket Item | `skill` |
|---|---|---|
| geometry | **shapeなし。** `deriveSize('si', null)` — locked 256×256(user ruling 8、REQ-0151) | **shapeなし。** 同一 |
| composition | marginを伴う、中央の1つの被写体 — `si.subject_frame` | marginを伴う、中央の1つのsymbol — **同一** |
| consumed at | socket chip | 18pxのbadge / Dex chip |
| matte | `matte.coverage_band` | 同一 |

**`si`は、そのLAWが「geometryを持たないlockされた正方形」である、既存の唯一のkindである。** そ
れはまさにskill iconそのものである。**したがって:`si`のlawをそのまま再利用せよ;`po`のものは
再利用するな。** playerのPOがiconを持つことは事実だが、それは関連する先例では**ない** — 関連す
る先例は、*「導出すべきものが何もない、小さな中央の正方形」*を既に解決したkindである。

### 5.5 代替案

- **(A) RECOMMENDED — kind `skill`、`si`と同一に設定する。** 1回のENUM migration + REQ-0179の
  checklistのコストがかかる。lockされたsize、2つの既存kit、style template hook、そして§8の
  goldenを掛ける場所が手に入る。REQ-0175**と**REQ-0211 ruling 3の両方に従う。
- **(B) `custom`。** 今日出荷できる、migrationはゼロ、そして**REQ-0179 step Fは既に
  `skill_def`がcustom artworkをlinkすることを想定していた。** コスト:kitなし、size lawなし、
  templateなし — それが**81回**(§5.2)。ユーザーがREQ-0179をREQ-0175をsupersedeするものと読
  むなら擁護可能である。
- **(C) `si`そのもの、新しいkindなし。** 却下する:81個のnon-itemを、あらゆるfilter、あらゆる
  Dex query、あらゆる`content/art/si/`export dirにおいて「Socket Item」にしてしまうことになる。
  **lawは正しいが、identityは正しくない。** これはREQ-0211が、`gimic`に`monster`のlawをそのま
  ま与え*つつ*、それ自身のkindを与えたときに引いた区別であり — まさにその先例である。

## 6. Sizing(サイズ設定) — law、そしてREQ-0263が強いる算術

### 6.1 badgeが実際には何であるか — その算術を行う

REQ-0263 §8.2の批准済みルール、原文まま:`EXP_BADGE_D = clamp(cellPx * 0.45, 12, 20)`、REQ-0260の
`EXP_CELL = 40`において:

```
EXP_BADGE_D = clamp(40 * 0.45, 12, 20) = clamp(18.0, 12, 20) = 18 px      <-- the circle
icon inscribed in that circle        = 18 / sqrt(2)          = 12.7 px    <-- the ART
  DPR 1 -> circle 18 device px, icon 13 device px
  DPR 2 -> circle 36 device px, icon 25 device px
  DPR 3 -> circle 54 device px, icon 38 device px
```

**artは12.7〜18論理pxで消費される**(典型的な2〜3倍displayでは25〜38device px)。そしてREQ-0263
§8.2はその上に**時計回りのtranslucent-black(半透明の黒)wedge**を描く — したがって、その13px
の任意の割合が、いかなる瞬間においても**α=0.55の黒で覆われている**(`EXP_CD_OVERLAY_ALPHA`、
REQ-0263 §6.1)。

### 6.2 law:**locked 256×256 — `si`のものそのまま**

```js
// server/services/art_sizing.cjs
const KINDS = ['po', 'si', 'unit', 'monster', 'gimic', 'bpskin', 'custom', 'skill'];

case 'skill':
case 'si':
  return { width: 256, height: 256 };     // REQ-0211 ruling-3 style: a STACKED case, not a copy
```

| decision | derivation |
|---|---|
| **locked, not derived** | skillにはshapeがない(§5.4)。`si`/`unit`/`bpskin`と同様、そしてREQ-0175が裁定した
`gacha_pack`と同様である |
| **256** | **`si`の既存の数値である** — 新しいconstantはlawに入らず、`si.subject_frame`の[S7]閾値
(*"for 256×256 SIs"*(訳:256×256のSI向けに)とauthorされた)は**re-calibration(再較正)ゼロ**
で転用される(§10)。256/18 = badgeに対して**14.2倍のdownscale headroom**、そしてDex chip
(§13)でも4〜8倍で用が足りる |
| **/16-legal** | 256/16 = 16。`snap16`はno-op;lawは正確である |

### 6.3 なぜここでは128px/cellのmonster/gimic lawがWRONG(誤り)なのか — taskが疑った通り

taskの疑いは正しく、その理由はREQ-0264 §8.3がVFXについて挙げているのと同じものである:

- **`monster`のlawはCELL FOOTPRINTを読み取る**(`{w,h}`、それぞれ1..12、×128px/cell —
  `art_sizing.cjs:90-95`)。**skillはcellを一切占めない。** `{w:1,h:1}` -> 128×128は`shape`の
  jsonbに**嘘**を入れることになり、REQ-0188(*"the art is authoritative"*(訳:artがauthoritative
  である))のもとでは、その嘘は、skillが持たないfootprintに対して**authoritative**になってし
  まう。
- **128×128は単純に小さすぎもする**:badgeに対して128/18 = 7.1倍のheadroom、そして**Dex chip
  (§13)に対してはわずか2.7〜5.3倍**である。`si`の256は追加コストがかからない(GPUコストを支配
  するのはpixel数ではなく**prompt変更**である — §4.4)、そして将来のあらゆる消費者のための余地
  を残す。
- **driftの危険は理論上のものではなく現実のものである。** `frost_gnoll`のdef footprintは
  **`[1,1]`**である(実測)のに対し、そのart shapeは**`{w:3,h:4}`**である(errata) —
  **12倍のarea不一致**が今日出荷されている、REQ-0188が批准され**`derive --write`が未実行のまま
  放置された**ためである。**shapeを持たないkindは、一度も触れないboardからdriftし得ない。**

## 7. 18ピクセル問題 — **USER RULING REQUIRED(ユーザー裁定が必須)**

**これは、本REQのartを生成する価値があるかどうかを決めるfindingである**、そしてそれは好みではな
く算術である。

### 7.1 badgeは、出荷するすべてのiconを支配するlawのfloorを3.6倍下回っている

**G4**、`unit_icon_pipeline.md` §1(2026-07-12に批准、ALL GREEN)、原文まま:

> **G4 — Cell-size readability.** The silhouette must be identifiable at **64 px** (one board
> cell). Proposal galleries show every candidate at 256 px AND 64 px side by side; **unreadable at
> 64 px = FAIL.**

(訳:G4 — cell sizeでの可読性。silhouette〔輪郭〕は**64 px**〔board 1cell分〕で識別可能でなけれ
ばならない。Proposal galleryは、すべての候補を256 pxと64 pxの両方で並べて示す;**64 pxで判読不能
= FAIL。**)

```
G4's floor        : 64 px
this badge        : 18 px       ->  3.6x BELOW the floor
the art within it : 12.7 px     ->  5.0x BELOW the floor
```

**G4はstylisticな好みではなく、FAIL条件である。そしてそれが64pxを基準に批准されたのは、それが
board 1cell分だからである。** expeditionのbadgeは**board 1cellの5分の1**である。本program内の
いかなるgoldenも、artにそれを生き延びるよう求めたことは一度もない。

### 7.2 批准済みのstyle layerは、18pxで読めるものを作らない

- `KIND_TO_STYLE`は`si`/`po` -> **Anime**templateにmapする:`{prompt} anime++,
  **bold outline**, cel-shaded coloring, shounen, seinen`。
- **pipelineは、隣接するcaseにおいて、このtemplateが誤ったclassのobjectを生み出すことを既に実
  測している**:*"The Anime template's 'bold outline' + cel-shading turn a fill brief into a
  discrete bordered OBJECT: asked for a leather texture, it produced a stitched, black-outlined
  leather patch"*(訳:Anime templateの「bold outline」+ セル塗りは、fillのbriefを、境界線で区
  切られた個別のOBJECTに変えてしまう:レザーのtextureを求めたところ、縫い目のある黒いoutline付
  きのレザーpatchが生成された)(`art_pipeline.md` §3)。
- 256pxのanime iconは内部detailを含む — セル塗り、bold outline、描き込まれた被写体。
  **14.2倍downsampleして18pxにすると、内部detailはnoiseになり、bold outlineが残るpixelの大半
  を占める。** 結果は、暗い縁取りのある色のついたblob(塊)になる。12.7pxでは、α=0.55の黒い
  wedgeの下で、それはsmudge(にじみ)になる。

**18pxで読めるのはPICTOGRAM(絵文字的記号)である**:1つの形、1つの色、高contrast、内部detailな
し — illustrationではなくheraldry(紋章)である。**批准済みのdirectionはそれを生み出さない**、
そしてそのdirectionは2026-07-13に**ユーザーがInvokeAIの結果を見て**批准したものである。**LLM
はartのdirectionを再指定してはならない。** REQ-0175は`gacha_pack`について同一のgapを記録し、同
じ言葉でそれを未解決のまま残している:*"`gacha_pack` -> **???**, a design question, not an
inference."*(訳:`gacha_pack` -> **???**、design上の問いであり、推測ではない。)

### 7.3 気まずい帰結:**18pxにおいては、REQ-0263のplaceholderが本REQのartに勝るかもしれない**

REQ-0263 §8.3は**verb-class(動詞クラス)のrune**(`ᛊ` strike / `ᛁ` apply_status /
`ᛉ` bonus_vs_status / `ᚢ` lifesteal / `ᚺ` multi_strike / `ᛒ` heal_ally)を出荷しており、
`--f-rune`で描かれ、本REQが*"closes exactly that gap by replacing glyph -> art per skill id, one
map, no layout change."*(訳:glyph〔字形〕をskill idごとのartへ置き換えることで、まさにそのgap
を閉じる。1つのmap、layout変更なし。)ものであると主張している。

**18pxにおいては、その主張はchallenge(異議申し立て)に値し、本REQはそれを黙って継承するのでは
なく、実際に異議を申し立てる。** runeは**font glyph**である:hintingが効き、pure-vectorで、1色、
最大限のstroke contrast — **小さいsizeで読めるようengineeringされている。** 14.2倍downsample
されたillustrationはそうではない。**したがってREQ-0263のplaceholderは、本REQがcommissionでき
るいかなるrasterよりも、18pxではおそらくMORE(より)legible(可読)である** — 運ぶ情報ははるか
に少ないとしても(81skill中30が`ᛊ`を共有している、とREQ-0263 §8.3は正直に述べている)。

**それこそが、ユーザーが実際に裁定しなければならないtrade-offである**:*低legibilityでの
identity(識別性)*(81個の別々のicon、18pxではそれぞれがblob)対 *高legibilityでのclass(分類)*
(6つのrune、それぞれcrisp〔くっきり〕、30個のskillが1つを共有)。

**選択肢:**

- **(A) RECOMMENDED — PICTOGRAM方向の`skill` style templateを作り、81個をcommissionする。**
  新しい`KIND_TEMPLATE`entry(§10.3):flat、単色、高contrast、内部detailなし、outlineなし —
  Animeの姿勢よりも`FILL_STYLE`の「それが何であるかを肯定的に述べる」姿勢に近い、
  **heraldic/glyph(紋章的/字形的)**な文法。そうすればartはあらゆるsizeで勝り、runeは引退する。
  **コスト:ユーザーが見て批准しなければならない新しいart direction(S7)、そして§12の
  legibility gateが18pxでpassしなければならないこと。**
- **(B) DEX向けにはicon;BADGE上にはrune。** REQ-0228のDex表示面(4〜8倍で表示され、
  illustrationが*正しい*場所)向けに81個をcommissionし、**REQ-0263のruneをbadgeのsizeでは維
  持する。** 正直で安価であり、18pxをruneの仕事にする — それが得意とすることである。**コスト:
  (l)の「〇の中にスキルアイコン」は*icon*ではなく*rune*によって果たされることになり、ユーザー
  の文字通りの要望は、それを求めた場所では満たされない。**
- **(C) 既存のAnime templateのもとで81個をcommissionし、それでもbadgeに載せる。**
  **NOT RECOMMENDED(推奨しない)、既定として辿り着かれないようここに名指しする:** それは、
  crispなruneが既にある場所にblobを置くために**51分〜4.4時間**のGPUと81枚のS7 reviewを費やし、
  それを許可するようamendされたgoldenが何もないまま**G4に3.6倍違反する**。
- **(D) `EXP_BADGE_D`を引き上げる。** 却下する — **収まらない。** REQ-0263 §8.2は、
  `rime_shaman`(`[1,1]`、2skill)が*"by 2px"*(訳:2pxの余裕で)収まることを実測している:
  `2×20−2 = 38 ≤ 40`。`EXP_BADGE_D`は既に`clamp(...,12,20)`の上限という実質的な限界にある;
  それを拡大すれば、あるliveなenemyの2つ目のbadgeがclip(はみ出て切れる)される。**「とにかく
  大きくすればいい」は誰もが真っ先に言うことなので記録しておくが、contentがそれをnoと言ってい
  る。**

**§7は、本REQが最も必要としている裁定である**、なぜならそれが、§4.1のbatchがそもそも
commissionされるかどうかを決めるからである。**(A)と(B)はどちらも正直だが、(C)はそうではない。**

## 8. G2/G7 DISCIPLINE(規律) — 厳格なauthoring rule、そしてなぜそれがpedantry(杓子定規)ではないのか

### 8.1 ルール

> **S2 — NO GAMEPLAY STATE IN A SKILL ICON.** No ring. No circle. No arc. No gauge. No frame.
> No border. No countdown. No cooldown sweep. No charge indicator. **An icon that bakes in
> ring-like or frame-like framing is a FAIL regardless of beauty.**

(訳:S2 — skill iconにgameplay stateを入れない。ringなし。circleなし。arcなし。gaugeなし。
frameなし。borderなし。countdownなし。cooldown sweepなし。charge indicatorなし。**ring状また
はframe状のframingを焼き込んだiconは、美しさに関わらずFAILである。**)

これは**G2そのまま**である(*"Connection shapes, **charge progress**, link rays… are renderer
overlays. An icon containing an arrow, **gauge**, or beam is a FAIL regardless of beauty"*(訳:
接続の形状、**charge進捗**、link rayは……renderer overlayである。矢印、**gauge**、beamを含む
iconは、美しさに関わらずFAILである))に、**G7のreservation(予約)**を加え、新しいasset class
に適用したものである。

### 8.2 なぜか — 衝突はmechanical(機械的)であり、REQ-0263はそれが衝突する当のものを作った

**G7の目的、原文まま:** *"**Reserved here so no icon bakes in ring-like framing that would
collide with it**; implementation belongs to REQ-0125."*(訳:それと衝突するようなring状の
framingをiconが焼き込まないよう、ここで予約する;実装はREQ-0125に属する。)

**G7はUnit iconの周りにringを予約した。REQ-0263 §8.1は今、まさにそれをSKILL iconの周りに描い
ている:**

- **circle**(「〇の中にスキルアイコン」 — circleはbadgeであり、それは**rendererのもの**であ
  る)、加えて
- **時計回りのtranslucent-black charge wedge**(`EXP_CD_OVERLAY_FILL=0x000000`、
  `EXP_CD_OVERLAY_ALPHA=0.55`、`RING_START_ANGLE=-PI/2`からsweep)、加えて
- **火が灯るframe**(`EXP_FIRE_FLASH_MS=150`)。

**したがってrendererは、18pxのdiscの上に、circle、sweepするarc、そしてflashするframeを描く。**

**ringを焼き込んだiconは3つの方法で衝突し、それぞれが本物のバグである:**

1. **二重のring。** 焼き込まれたrim + badgeのcircle = 18pxにおいて約1px離れた2つの同心円。それ
   は「framedされている」とは読めず、**aliasing(エイリアシング)**として読める。
2. **charge wedgeが判読不能になる — load-bearing(構造を支える)失敗である。** wedgeの*全て
   の*仕事は、**どこまでsweepしたか**によって、残り時間が*どれだけ*かを示すことである。それは
   icon上でα=0.55の黒である。**もしiconが既に暗いringを持っていれば、wedgeの先端が対比する対
   象を失い、sweepの位置 — それが運ぶ唯一の情報 — が失われる。** REQ-0263 §6.1のcontrolは
   noiseへとdegrade(劣化)し、しかも*静かに*degradeする:staticなscreenshotでは、badgeは依然
   として問題なく見える。
3. **fire-flashのframeが、明るくする対象を失う。** REQ-0263 §7.2は150msの間*frame*を明るくす
   る。焼き込まれたframeは明るくできない — それらはただのpixelである。ユーザーの「ちゃんと発
   動したら光る」 — *発動したことの確認* — が**静かに起こらなくなる**。

**これが、S2が好みではなくFAILである理由である:焼き込まれたringはbadgeを醜くするのではなく、
badgeにLIE(嘘をつかせる)。** それは、何も追跡していないcontrolを表示することになる。それは
まさに、G2が防ぐために存在するharm(害)のclassそのものである。そしてG7は、REQ-0263がその衝突
を作る**6日前に**、その機構を予見していた。

### 8.3 その他のauthoring rule

- **S1 — art_goldenが無変更のまま適用される。** Aspectは不可侵(1:1);illustration-first;配
  線される前に承認される。
- **S3 — 中央の1つの被写体、marginを伴う。** `si.subject_frame`によって機械checkされる(§10)。
  skill iconはsceneでは**ない**:背景なし、地面なし、それを持つcharacterなし。
- **S4 — 18pxで判読可能であること** — **G4のfloorを、このbadgeの現実に引き下げたもの**
  (§7.1)。galleryは、すべての候補を**256 pxとAND 64 pxとAND 18 px**で並べて示さ**なければな
  らない** — G4自身の「256 AND 64」ルールを、このartが実際に使われるsizeにまで拡張したもので
  ある。**18pxで死ぬ候補はFAILである**、256でどれほど良く見えても。
- **S5 — roster coherence(G5)。** **81個のiconは1つのsetとして読めなければならない。** この
  batch sizeにおいては、G5はniceな心遣いではなく、拘束力を持つgoldenである:
  *"A character that does not sit in the roster lineup is a FAIL even if beautiful alone."*
  (訳:roster lineupに収まらないcharacterは、単体では美しくてもFAILである。)
- **S6 — textなし、数字なし、文字なし。** 18pxの81個のicon;焼き込まれたglyphは判読不能であ
  り、**かつ**81 × 2件のlocalisationが必要になってしまう(§12)。名前は`name_ja`/`name_en`で
  あり、tooltipの中に存在する。

## 9. placeholderとfallback — REQ-0263の選択、引用のみ、再審議しない

### 9.1 このartが着地する前に出荷されるもの:REQ-0263 §8.3のverb-class rune

taskの指示に従い、**REQ-0263 §8.3がそれを選び、本REQはその選択を採用する**:

```
strike           (30/81) -> ᛊ     apply_status  (27/81) -> ᛁ
bonus_vs_status   (9/81) -> ᛉ     lifesteal      (7/81) -> ᚢ
multi_strike      (6/81) -> ᚺ     heal_ally      (2/81) -> ᛒ
```

`--f-rune`(`styleguide.html:36`)で描かれ、REQ-0263によってnav set(`ᚨ`表題 `ᛗ`編成 `ᚱ`遠征
`ᚷ`倉庫 `ᚲ`図鑑 `ᛈ`工房 `ᚠ`市場 `ᛏ`殿堂)とREQ-0240 M4のclass glyph(`ᚦ`/`ᚷ`/`ᛞ`)の両方に対
して衝突checkされている。**ここで独立に確認:** verbの分布は**正確に**`{strike:30,
apply_status:27, bonus_vs_status:9, lifesteal:7, multi_strike:6, heal_ally:2}` = 81である(実
測、§3)。したがってREQ-0263 §8.3のmapは、liveなsurface全体にわたって完全かつtotalである —
**7つ目のverbは存在せず、glyphを持たないskillも存在しない。**

**seamは`client/src/expedition/skillGlyph.ts`である** — REQ-0263 §10.2は、それを
*"The single seam REQ-0265 replaces"*(訳:REQ-0265が置き換える唯一のseam)として構築し、その
AC-8は*"Swapping `skillGlyph.ts` for a stub changes every icon with **no** change to
`ExpeditionHudLayer`"*(訳:`skillGlyph.ts`をstubに差し替えると、`ExpeditionHudLayer`への変更
**なし**にすべてのiconが変わる)である。**本REQはresolverを1つ登録するのみであり、他の何も動
かない** — REQ-0262 §9.2が名指しした`chargeRing.ts`と同じ姿勢である。

**§7.3は、runeがbadge sizeでいつか引退すべきかどうかに異議を申し立てている。それは§7の裁定であ
り、§8.3の選択の再審議ではない** — いずれにせよruneは正しいplaceholderである。

### 9.2 fallback chain — 決してblankにならず、決してcrashしない

```
iconFor(skillId):
  1. art_urls[skillId]  (adopted artwork, exact-name -- s10)   -> the raster
  2. skillGlyph(verb)   (REQ-0263 s8.3's rune)                 -> ALWAYS RESOLVES (s9.1: total over 6 verbs)
  3. the badge with no glyph                                   -> still correct
```

**Step 2は外れ得ない**、なぜならverb mapはliveなsurface全体にわたってtotalであり(§9.1)、
`verb.t`はすべてのdef上にあるからである。**Step 3もblankではなく**、REQ-0263 §8.3がその理由を
述べている:*"the badge is not blank even without the glyph: it still carries a live countdown
wedge, so it already communicates 'something fires in N seconds'; the glyph adds what kind."*
(訳:glyphがなくてもbadgeはblankではない:それでもliveなcountdown wedgeを運んでおり、既に「何
かがN秒後にfireする」ことを伝えている;glyphはその種類を付け加えるだけである。)

**空になり得る4つの経路、それぞれのdegrade(縮退)のしかた:**

| condition | behaviour |
|---|---|
| **filesバックエンド**(`STORAGE_BACKEND !== 'pg'`) -> `computeArtUrls`は`{}`を返す
(`content.cjs:227`) | step 1が外れる -> **rune**。これは**通常のdev/e2e path**である(REQ-0263 AC-9)、errorでは
ない |
| あるskillに対しadoptされたartworkがない | rune。**これが初日における81/81のskillの状態であり**、batch後にauthorされたどのskillに
とってもそうである |
| 404/decode失敗 | rune;一度だけlogされ、frame毎に再試行されることは決してない(REQ-0262 §12.2の姿勢) |
| **新しい**7つ目のverbがauthorされる | **step 2が壊れる。** §12 gate 7がcontent-check時に発火するため、画面上ではなくCIで捕捉される |

## 10. Resolution:1行、そして実測により安全である

**exact-nameのconventionは既に存在し、kind-genericである。** `server/lib/content.cjs:230-240`、
原文まま:*"`resolveItemArtNames` is kind-generic (**def.artwork_ref adopted -> exact-name adopted
-> omitted**) and monster artworks follow the exact-name convention (**artwork system_name ==
enemy id** — REQ-0184/0188), so no new resolver is needed."*(訳:`resolveItemArtNames`は
kind-genericである〔**def.artwork_refがadoptされていればそれを、なければexact-nameがadoptされ
ていればそれを、なければomitted**〕、そしてmonster artworkはexact-nameのconvention〔**artwork
system_name == enemy id** — REQ-0184/0188〕に従うため、新しいresolverは不要である。)

**したがって:`artwork.system_name == skill.id`。** artworkの`gnoll_claw` ↔ skillの
`gnoll_claw`。**新しいresolverなし、新しいnaming schemeなし、`skill/1`上に`icon` fieldなし。**
(対照的にREQ-0264 §11.1では、VFXにはdefがなく、合成名を*発明しなければならない*。skillはdefを
**持つ**ため、conventionを継承する。)

**1行の拡張:**

```js
// server/lib/content.cjs computeArtUrls() -- the name set gains skill ids.
Object.keys(monstersFromCore().monsters || {}),
Object.keys(skillDefsById || {})            // REQ-0265: 81 skill ids join the resolved map
```

**これは、REQ-0259がgimicのために所有しているのと同じ、1行の動きである**(REQ-0261 §8.6は、
`computeArtUrls`が`monstersFromCore().monsters`のみをjoinしており、gimic idが`art_urls`に決し
て join しないことを発見した)。**並行するものとして記録する、重複としてではない** — REQ-0259が
gimicの行を所有し、本REQがskillの行を所有する。

### 10.1 衝突のrisk — 実測、そしてそれはZEROである

`art_urls`は**素のidをkeyにした1つのflat map**である。items/sis/tms/monstersが共有するmapに
81個のidを追加することが安全なのは、idが一切衝突しない場合に限られる — **静かなoverwriteは、
monsterのportraitをskill iconに入れ替えてしまうだろう。** そのため、これは想定ではなく実測され
た:

| namespace | ids | collisions with the 81 skill ids |
|---|---|---|
| `enemies.json` | 44 | **0** |
| gimics / `entities.json` | 4 | **0** |
| `dungeon/items.json` | 2 | **0** |
| `live_items.json`(po) | 8 | **0** |
| `live_sis.json`(si) | 6 | **0** |
| `live_units.json` | 54 | **0** |
| **他のあらゆるidのnamespaceのunion** | **118** | **0** |

**118個すべてのidにわたって衝突ゼロ。この拡張は安全であり、そして今や*evidence(証拠)によっ
て*安全である。** §12 gate 6が、それを将来のcontent driftに対してpinする。

## 11. Scope(範囲)

**含まれるもの:**

1. `server/migrations/0NN_artwork_kind_skill.sql` — **NEW。** `ALTER TYPE artwork_kind ADD VALUE
   IF NOT EXISTS 'skill';`(top-level;`IF NOT EXISTS`;REQ-0179/0211の先例)。**番号は
   implementation時点で確定する — §14のcollision findingを見よ。**
2. `server/services/art_sizing.cjs` — `KINDS += 'skill'`;**stacked**な`case 'skill': case
   'si':`。
3. `server/routes/art.cjs` — `shapeAndSize`:`skill`はshapeless branch(`return {shape: null,
   size: deriveSize(kind, null)}`)に落ちる — **編集は不要であり、既にdefault pathである**;
   `defaultsForKind('skill')` -> §7で裁定されたtemplate。
4. `tools/art_job.py` + `tools/art_style.py` — `KIND_TO_STYLE += {"skill": ...}`、そして**もし
   §7が(A)を裁定すれば**、新しいpictogramの`KIND_TEMPLATE`entry。
5. `tools/inspect_kits.json` — `matte.coverage_band`と`si.subject_frame`が`skill`を得る;
   **NEW** `skill.badge_legibility` v1 [S7](§12.5)。**`kit_version`のbumpはなし** — kindを
   `applies_to`に追加することは、*"a threshold nor an algorithm change"*(訳:閾値の変更でも
   algorithmの変更でもない)のいずれでもない(manifest自身のルール)ため、既存の`si`の
   inspectionは**stale化してはならない**。§12 gate 8。
6. `client/src/artadmin/*` — `artShared.ts`(`Kind`/`KINDS`/`deriveSizeClient`/
   `defaultTemplate`)、`CreatePanel.tsx`、`Workspace.tsx`、`ArtAdminPage.tsx`、
   `artadmin.css`(`.aa-kind--skill`)。**`ShapeEditors.tsx`にbranchは不要** — `skill`は`si`
   と同様shapelessである。
7. `client/src/contentadmin/Workspace.tsx:56` — `typeChips`が`'skill'`を得て、**`skill_def`**
   がREQ-0174の`artwork_ref`を介して明示的にそのartworkをlinkできるようになる(exact-nameの
   braceに対するbelt)。**REQ-0179 step Fは既にこのpicker内の`skill_def`を想定していた**
   (§5.1)。
8. `server/lib/content.cjs` — §10の、`computeArtUrls()`のname setに対する1行の拡張。
9. `client/src/expedition/skillGlyph.ts` — **REQ-0263のfile。** §9.2のstep 1(raster)が、そ
   のruneよりも先に得られる。**runeは削除されない** — それはfallbackであり、(§7 (B)の場合)
   永続的なbadgeになる可能性もある。
10. **Art request(ユーザーのpipeline向け、ここでは実行しない):81個のicon**、256×256、skill
    idごとに1つ、`<skill_id>`という名前。§4.4がoperatorのcost sheetである。

**含まれないもの:**

- **badgeのcircle / wedge / layout / overflow / `+N`のcollapse / frame-flash** — REQ-0263 §8。
- **Ray + hit VFX** — REQ-0264。
- **Dex内のskill MECHANICS(機構)** — REQ-0228(§13)。本REQは**art**を出荷し、そちらは
  **facts(事実)**を出荷する。
- **Dex内の`skill_def` catalog tab** — REQ-0228のoption (b)の領域(§13)。
- **GIMIC id向けの`computeArtUrls`の拡張** — REQ-0259(REQ-0261 §8.6)。§10の行は**skill**の
  行のみである。
- **`content/sprite_all_v12.svg`内の`<symbol>`。** Skill iconはmonsterと同様**registry
  raster**である(`itemIconRasters()` -> `item:<id>`)、sprite-sheetのsymbolではない。SVG
  sheetはlegacyのPO/SI/unit routeである。「sprite sheetに追加せよ」が反射的な発想であるため明
  記する — それはresolution pathを分岐させてしまうだろう。
- **あらゆる画像のgeneration / matting / adoption** — ユーザーがart pipelineを実行する
  (HANDS-OFF)。
- **monsterごとのskill reskin / rarity frame** — 81は**skill idと1:1**である。commissionされ
  ない。
- **REQ-0175とREQ-0179の解決**(§5.1) — boardの矛盾;報告する(§14)。
- **G4のamend(改正)**(§7.1) — 批准済みのgolden;ユーザーのものである。
- REQ-0188の`frost_gnoll`のdrift(§6.3)に対する**`derive --write`の実行** — 報告する;
  REQ-0188のものである。
- **`docs/user_managed/*`** — 禁止されており、ここでは何もそれを必要としない。

## 12. Gates

**E2Eのport(規則:`5000 + REQ*10 + index`):`7650` static / `7651` api / `7652` proxy。** 番号採
番規則により予約され、`tools/check_e2e_ports.cjs`によって機械的に強制される。**裁定Q2(「e2eを
通す必要はない」)により、E2Eは本programにとってgateでは*ない*ため、harnessは構築されず、この
10番台は未使用のまま残される** — REQ-0262 §14、REQ-0263 §11、REQ-0264 §14が取るのと同じ姿勢
である。

実際に適用されるgate:

1. **sizing law(REQ-0179のG2 testを拡張したもの)。** `deriveSize('skill', null)` ===
   `{256,256}`;`deriveSize('skill', {w:1,h:1})`は**それでも**`{256,256}` === である —
   **shapeはhonour(尊重)されるのではなくIGNORE(無視)されなければならない**。その非対称性が
   gateである:skillにはgeometryがないという§6.3の裁定をpinし、将来のどんな編集も黙ってそれに
   geometryを与えることができないようにする。
2. **BATCHがCOMPLETE(完全)であること — 本REQが存在する理由そのもののgate。** `skills.json`の
   **すべての**idについて、`<skill_id>`という名前のartworkが存在しadoptされている:**81/81**。
   そしてその逆も:liveなskill idではない名前を持つ`skill` artworkは存在しない。**完全性が機械
   checkされていないbatch REQは、単なるspreadsheetである。**
3. **unionは依然として81である。** `union(enemies.skills, gimics.skills, packs)`を
   `skills.json`のidに対して再計算し;**参照されていないもの0、宙に浮いたもの0、合計81**を
   assertする。**contentがdriftした瞬間に発火する** — 82個目のskillや、誰もfireしないskillが
   現れたとき。これは§4の実測を、checkとして凍結したものである。
4. **2つのgimic skillがbatchに含まれていること。** `trap_deadfall_volley`と
   `door_keeper_strike`がartをadoptしていることを明示的にassertする。**§4.2を、犯しやすい
   79対81の誤りに対してpinする。**
5. **fallback chainはblankになり得ない。** (a)artworkが一切ない、(b)81のうち40、
   (c)`STORAGE_BACKEND=files`(`art_urls === {}`)、(d)404になるPNG。**4つすべてにおいて:rune
   がrenderされ、何もthrowせず、blankなbadgeはない。** (c)は**デフォルトのe2e path**である。
6. **id衝突がないこと。** `skills.json`のidが、`art_urls`のname set(items ∪ sis ∪ tms ∪
   monsters ∪ gimics)内の他のあらゆるidとdisjoint(互いに素)であることをassertする。**今日は
   0/118でPASSする**(§10.1) — skillとmonsterがidを共有する合成fixtureでは**失敗しなければな
   らない**。失敗するcaseをpinせよ:flat map内の静かなoverwriteは、portraitがiconになるまで不
   可視である。
7. **verb->rune mapがTOTAL(全域)であること。** `skills.json`内のすべてのskillについて、
   `skillGlyph(verb.t)`が解決する。**7つ目のverbではFAILする** — つまり§9.2のstep 2は、望まれ
   ているだけではなく機械的に保証されている。
8. **どのkitもstaleにならない。** §11.5の`applies_to`編集の後、既存のすべての`si`/`po`/
   `unit`のrenderの`kit_input_sha256`が**無変更**である。大量staleは、単なるrouting編集のため
   にinspection履歴を無効化してしまうだろう。
9. **Legibility(可読性)には実効力がある(`skill.badge_legibility` v1 [S7])。** §7/§8のS4は
   測定を伴わない文章に過ぎない。adoptされた256pxのrenderを**18×18**にdownsampleし、測定する:
   ```
   silhouette_components  : connected components of alpha>8  == 1        (one shape, not confetti)
   badge_contrast         : stddev(luma) of the 18px downsample >= [S7]  (a mush flattens to a blob)
   soft_alpha_band        : fraction with 8 < alpha < 200      <= [S7]   (a crisp silhouette, not a haze)
   ```
   **閾値は[S7]としてmarkされており、ここで推測されたものではなく、FIRST(最初)のgalleryから
   calibrate(較正)される** — `monster.render_sanity`や`si.subject_frame`が出荷されたのと同じ
   姿勢である(`art_pipeline.md` §8)。**Advisory(助言的)であり、決してblockingではない**
   (`inspect_kits.json`自身のルール:blockするのは`bpskin.frame_gate`のみである)。
10. **S2には実効力がある(G2/G7)。** 意図的にring-framedにしたfixtureは捕捉される:
    `si.subject_frame`の`margin >= 0.02`と`centroid_offset <= 0.25`が、rimからedgeまでの
    compositionを既にFAILさせ、`soft_alpha_band`がsoftなrimを捕捉する。**gateとして名指しする
    のは、§8の失敗が静かであるためである** — ring-framedなiconはscreenshotでは問題なく見え、
    動いたときにのみ嘘をつく。
11. **Migrationはadditive(加算的)かつidempotent(冪等)である。** 2回適用する;`artwork_kind`
    = {po,si,unit,monster,bpskin,custom,gimic,skill}。古いcodeは`skill`を決してemitしない
    (REQ-0179のmigration-firstの論拠)。
12. `pnpm exec tsc --noEmit` + lint + `tools/ci.sh`がGREENであること。

## 13. i18nとDexへの帰結

### 13.1 i18n:**新しいi18nはない。taskが求めた通り検証済みである。**

**実測:81個のskillすべてが`name_en`とAND `name_ja`の両方を運び、欠落はゼロである** — 例:
`{"id":"gnoll_claw","name_en":"Gnoll Claw","name_ja":"ノールの爪"}`。したがって:

- **iconにはlocalisationが不要である** — **textを一切運ばない**からであり(§8.3のS6)、これが
  *まさに*S6がルールである理由である。
- **badgeのtooltip / `aria-label`は、既存の`name_ja`/`name_en`をlocaleごとに使う。** **何も追
  加されない。**
- **artworkの`main_object`は英語のart briefであり、user-facing(利用者に見える)ものではない。**
  それはprompt inputである。`name_en`と**混同してはならない** — `gnoll_claw`にとって良いbrief
  は*"three curved claw slashes"*(訳:湾曲した3本の爪の斬撃)であって、*"Gnoll Claw"*ではない
  かもしれない。`art_golden`のルール(*"gorgeous names do not yield better art"*(訳:豪華な名
  前がより良いartを生むわけではない))が適用される:**briefはPICTURE(絵)を記述し、名前は
  SKILLに名前を付ける。**

> **Finding — 1つのcontent tree内に2つのi18n dialectが生きている。** `skill/1`は**flat**な
> `name_en`/`name_ja`を使う(実測:81/81、そして`i18n`blockを運ぶentryは**ゼロ**)。
> `monster_pack/1`は**nested(入れ子)**なblockを使う:
> `{"name":"Frost Scouts","i18n":{"en":{"name":…},"ja":{"name":…}}}`(実測、`packs.json`)。
> `gimic/1`は`name` + `i18n.ja`を使う(REQ-0211のschema table)。**3つのkindにわたる3つの形状。**
> 本REQにとっては無害である(i18nを一切追加しないため)が、**将来の「Dexをlocaliseする」作業は
> これに突き当たることになる**、そしてこれは、誰かがその3つすべてに対応する1つのreaderを書くま
> で見えないままの種類のものである。**報告するのみで、修正はしない。**

### 13.2 Dex:REQ-0228が自然な消費者であり、**本REQはその未決定にstake(利害関係)を持つ**

**REQ-0228**(`draft/`、*"needs a design decision (payload shape + spoiler posture) before work
starts"*(訳:作業開始前にdesign裁定〔payload形状 + spoilerの姿勢〕が必要である))は、skillが
**DOES(何をするか)**を表示することを提案している。その未決定の点、原文まま:

> - **(a)** widen `monster_skills` entries with a display-safe mechanics slice … one map, no
> new section
> - **(b)** a separate **`skills` payload section keyed by id** … heavier but reusable by a
> future skill_def catalog tab

(訳:(a)`monster_skills`のentryを、表示に安全なmechanics〔機構〕sliceで拡張する……1つのmap、
新しいsectionなし。(b)idでkeyされた別個の**`skills` payload section**……より重いが、将来の
skill_def catalog tabで再利用可能。)

**両者は補完的であり重複しない — そしてその分割は明快である:**

| | REQ-0265(this) | REQ-0228 |
|---|---|---|
| ships | **art** — 81個のraster | **facts(事実)** — cadence、verb + damage band、edge/direction/pen/aoe |
| surface | expedition badge(18 px)**と**Dex chip | Dexのdetail line |
| payload | **`art_urls[skill_id]`** — §10の1行 | mechanics slice |

**どちらも互いをblockせず、どちらも互いを重複しない。しかし本REQは(a) vs (b)にstakeを持ち、
(b)を支持する:**

- **(a)のもとでは**、mechanicsは`monster_skills`に乗る — **monster専用**のmapである。
  **REQ-0211はgimicのskillを、別個の`gimic_skills` sectionを通じて提供している**(そのShips
  list:*"`gimicsFromCore()` serves the Dex `gimics` + `gimic_skills` sections"*(訳:
  `gimicsFromCore()`がDexの`gimics` + `gimic_skills` sectionを提供する))。したがって(a)は
  **同期を保たなければならない、idでkeyされた2つのskill map**を意味し、
  `door_keeper_strike`/`trap_deadfall_volley` — **本REQの81個のうち2つ** — は、2つ目のもの
  を通じてのみ到達可能である。
- **(b)のもとでは**、idでkeyされた1つの`skills` sectionが**monsterとgimicのskillを同一に**
  提供する — これはまさに**REQ-0259の`IBattleInstance`統一**がruntimeについて既にassertして
  いることである。**Dexのpayloadはそのときmodelと一致することになる。**
- **本REQのartは、ownerに関わらず、81すべてに対してskill idでkeyされる。** §10の`art_urls`
  拡張は構造上owner-agnostic(所有者に依存しない)であるため、**(a)でも(b)でも機能する** —
  本REQはblockされていない。**しかし(b)は、1つの消費者が1つのmapから両familyのicon +
  mechanicsをrenderできるようにする形状であり**、(a)のもとではgimic skillのiconはDex内に自
  然な居場所を持たない。

**REQ-0228の保留中の決定への入力として記録するのであり、要求としてではない。** REQ-0228がそれ
を所有している;これは、それが書かれた時点では持っていなかった証拠である —
**REQ-0211の`gimic_skills` sectionは、それより後に書かれたものである。**

## 14. ブリーフ、taskのframing、コード、そして姉妹REQへの訂正

| claim | reality | evidence |
|---|---|---|
| task:*"**Count the real surface yourself**: how many distinct skill ids … referenced by
`enemies.json` + the gimic defs + `packs.json`?"*(訳:**実際のsurfaceを自分で数えよ**:
`enemies.json` + gimic defs + `packs.json`によってreferenceされる、distinctなskill idはいく
つか?) | **81。** `skills.json`には81entry / 81個の一意なidがある;enemyは**79**をreferenceし、gimicは
**2**をreferenceし、**packはZERO**をreferenceする;union **= 81**、**参照されていないもの0、
宙に浮いたもの0**。surfaceはぴったり閉じる。**`packs.json`はskill idを一切提供しない** —
memberは`{"enemy":…,"at":…}`である;packはskillをreferenceする**enemy**をreferenceする。その
本当の価値は**reachability(到達可能性)**の証明である:44体すべてのenemyが配置されており、し
たがってenemy側の79個のskillすべてがliveである。 | §4 |
| task:*"REQ-0263 draws these … at CELL=40 logical scale (so each badge is SMALL — do the
arithmetic … and state the target px)"*(訳:REQ-0263はこれらを……CELL=40のlogical scaleで描
く〔したがって各badgeはSMALLである — 算術を行い……target pxを述べよ〕) | **18pxのcircle;その中のartは12.7px**(`clamp(40×0.45,12,20)=18`;`18/√2=12.7`)。**それは
批准済みgolden G4の64pxというFAIL floorを3.6倍下回っており、art自体についてはそれを5.0倍下回
っている。** 本program内のいかなるgoldenも、artにboard 1cellの5分の1を生き延びるよう求めたこ
とはない — そして**批准済みのAnime templateはそれができない**(`art_pipeline.md` §3は、
「bold outline」がtexture briefをoutline付きのobjectに変えてしまうことを既に実測している)。
**これが本REQの中心的なfindingであり、ユーザー裁定を必要とする。** | §6.1、§7 |
| task:*"A 128px/cell law (the monster/gimic law) is likely **wrong** here"*(訳:128px/cellの
law〔monster/gimicのlaw〕は、ここではおそらく**誤り**である) | **正しい、そしてそれはresolution(解像度)上の理由ではなく構造上の理由による:** `monster`の
lawは**cell footprint**を読み取るが、skillには**footprintが存在しない**。`{w:1,h:1}`は
`shape`のjsonbに嘘を書き込むことになり、**REQ-0188はそれをauthoritativeなものとして扱ってし
まう**。加えて単純に小さすぎる:128ではDex chipに対してわずか2.7〜5.3倍のheadroomしか得られな
い。**正しいlawは`si`のものである:locked 256×256、shapeなし。** | §5.4、§6.2、§6.3 |
| task:*"Note PLAYER POs/SIs already have icons … state whether a monster skill icon is the
same asset class as a PO icon"*(訳:PLAYERのPO/SIは既にiconを持っていることに注意……monsterの
skill iconがPO iconと同じasset classかどうかを述べよ) | **異なる2つの答えがあり、それらを混同することがtrap(罠)である。** **CONTENTとして:NO**
— POはplayerが**所有し配置する**ものであり、そのsizeは256px/cellでの**5×5 cell maskから
derive(導出)**され、そのartはそのmaskに対して**authoritative**である(REQ-0188);skillは
cellを一切占めず、maskを持たない。**LAWとして:それは`si`である** — そのlawが*「geometryを
持たないlockされた正方形」*である、既存の唯一のkindであり、それはまさにskill iconそのもので
ある。**したがって:`si`のlawを再利用せよ;`po`のものは決して再利用するな。** | §5.4 |
| **REQ-0175とREQ-0179はCONTRADICT(矛盾)し合っている**(finding、REQ-0264 §16と共有) | REQ-0175(`draft/`、"CLEARED TO IMPLEMENT"〔訳:実装着手可〕、2026-07-14):
*"**The art KIND itself — Add it — required, not optional**"*(訳:art KINDそのもの — それを
追加せよ — 必須でありoptionalではない)。REQ-0179(`built/`、2026-07-15)は`custom`を出荷し
*"for content that has no art-kind of its own"*(訳:自身のart-kindを持たないcontentのため)、
そして**そのstep Fは`skill_def`を名指しで**pickerの対象として挙げている、すなわち
**REQ-0179は明示的に、skill defが`custom` artworkをlinkすることを想定していた。**
REQ-0175は撤回もsupersedeもされていない。**「Xはkindを得るか?」に、これが解決されるまで
boardは答えられない**、そして本REQとREQ-0264の両方がそれを問わなければならない。 | §5.1 |
| **020番でのMIGRATION NUMBER COLLISION(番号衝突)**(finding、REQ-0264と共有) | `master`には`020_render_variant.sql`がある(REQ-0223);`req-0211`branchには
`020_content_kind_gimic.sql` + `021_artwork_kind_gimic.sql`がある。REQ-0255は0211をマージす
る -> **2つの`020_*`file**。致命的ではない(`016_content_artwork_ref.sql`と
`016_content_kind_gacha_pack.sql`は既に共存している)が、**マージ前には次の空き番号を`ls`か
ら導出できない**。マージ後の次の空き番号は**022**である;REQ-0264と本REQは**それぞれ1つず
つ**必要とする。REQ-0255にflagする。 | §11.1 |
| **本REQが「gapを閉じる……1つのmap、layout変更なし」というREQ-0263 §8.3の主張** | **mechanicalには真であり、18pxではCHALLENGE(異議申し立て)される。** runeは小さいsizeのた
めにengineeringされた**hintingの効いたvector font glyph**である;14.2倍downsampleされた
rasterはそうではない。**REQ-0263のplaceholderは、本REQがcommissionできるいかなるartよりも、
badge上ではおそらくMORE(より)legible(可読)である** — 運ぶ情報はより少ないとしても
(81skill中30が`ᛊ`を共有)。したがって「artがruneを置き換える」は**Dex**については真かもし
れないが、**badge**については偽かもしれない。§7 (B)がそのoptionであり、それは正直である。 | §7.3 |
| task:*"skills belong to BOTH monsters and gimics (REQ-0259 unifies them as
`IBattleInstance`)"*(訳:skillはmonsterとgimicの両方に属する〔REQ-0259はそれらを
`IBattleInstance`として統一する〕) | **CONFIRMED(確認済み)、そしてそれはちょうど2個のassetに相当する — それが要点である。**
`trap_deadfall_volley`と`door_keeper_strike`は、**どのenemyからもreferenceされていない**。
**`enemies.json`だけから数えると79になり、両方を黙って落としてしまう** — playerが最も読み取
る必要のある**trap**を含めて。`door_keeper_strike`はまた、**tree内で`modes:["unlock"]`を持
つ唯一のskill**でもある(80/81は`["battle"]`)。 | §4.2 |
| REQ-0263 §8.2の*"N ∈ [0,3]"*と§8.4の*"all 81 are `every_secs`"*(訳:81すべてが
`every_secs`である) | **両方とも独立にCONFIRMED(確認済み)。** Enemy `{1:10, 2:33, 3:1}`、最大**3**
(`hrimgrimnir`、`[3,3]`);gimic `{0:2, 1:2}`。Trigger:`{'every_secs': 81}` — **passiveはゼ
ロ**であり、したがって(l)の*"passives included"*(訳:passiveを含む)は、REQ-0263 §8.4が述
べる通り、行使されないまま出荷される。REQ-0263のverb tableは正確である:`{strike:30,
apply_status:27, bonus_vs_status:9, lifesteal:7, multi_strike:6, heal_ally:2}` = 81。 | §3 |
| ブリーフ§6:*"`board/sprites.ts` (**sprite_all_v11.svg** symbols -> Pixi textures)"*(訳:
`board/sprites.ts`〔**sprite_all_v11.svg**のsymbol -> Pixi texture〕) | **WRONG(誤り) — 正しくはv12である。** `client/src/board/sprites.ts:50`:
`import spriteSheetSource from '../../../content/sprite_all_v12.svg?raw';`。errataは正し
い。**そしてこのfileはそれ自身と矛盾している**:`:2`と`:47`のcomment自身は依然として
`sprite_all_v11.svg`と述べているが、importはv12と述べている。`content/`はv7..v12を保持して
いる。**報告する** — 真実からわずか2行の距離にある、陳腐化したcommentである。 | §11(含まれないもの) |
| **`custom`はZERO個のinspection kitへrouteされる**(finding) | `tools/inspect_kits.json`内で`applies_to`に`custom`を挙げているentryは1つもなく、
`kitsFor('custom')`は`[]`を返す。**1つ**のtexture(REQ-0179のcase)にとってはそれで問題な
い。**sizeもstyleもkitもgoldenも共有する81個のasset**にとっては、それはlawが存在するが何も
それを強制しないことを、81回意味する。**これがkindを求める決定的な論拠である** —
REQ-0264 §6.2が挙げているのと同じものである。 | §5.2 |
| **1つのcontent tree内の2つのi18n dialect**(finding) | `skill/1` = **flat**な`name_en`/`name_ja`(81/81、`i18n`blockは**ゼロ**)。
`monster_pack/1` = **nested**な`i18n:{en:{name},ja:{name}}`。`gimic/1` = `name` +
`i18n.ja`。**3つの形状、3つのkind、1つのtree。** ここでは無害である(本REQはi18nを一切追加
しない)が、その3つすべてに対応するために書かれる最初のreaderに噛みつくことになる。**報告す
るのみで、修正はしない。** | §13.1 |
| **REQ-0228の(a) vs (b)には、それ自身が知らないstakeがある**(finding) | REQ-0228は**REQ-0211**より前に書かれており、REQ-0211はgimicのskillを**別個の
`gimic_skills` Dex section**を通じて提供している。したがってそのoption**(a)**
(**monster専用**の`monster_skills`を拡張する)は、**本REQの81個のiconのうち2つ** — どちら
もgimic所有 — をDex内に自然な居場所のないまま残し、同期を保たなければならない、idでkeyされ
た2つのskill mapを生み出す。**(b)**(idでkeyされた1つの`skills` section)はREQ-0259の
`IBattleInstance`統一と一致する。**REQ-0228の保留中の決定への入力である;本REQはどちらのも
とでも機能する。** | §13.2 |
| **REQ-0188のdriftは現実に生きている**(ここで実測) | `frost_gnoll`のdef footprintは**`[1,1]`**である(実測、`enemies.json`)のに対し、art
shapeは`{w:3,h:4}`である — **12倍のarea不一致**が出荷されている、REQ-0188が批准され
**`derive --write`が未実行のまま放置された**ためである。§6.3のための**証拠**として引用する:
boardを記述すると主張するshapeはboardから**drift(乖離)し得る**;shapeを持たないkindはそう
なり得ない。**報告する;REQ-0188が修正すべきものである。** | §6.3 |
