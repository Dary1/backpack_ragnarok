# REQ-0264 — art-ray-hit-vfx-kind: rayとhitのVFXは、アニメーションできないstill-image(静止画)pipeline上で、first-classなregistry artとなる

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKEDである。作業を開始する前に
ユーザーの判断が必要な点が4つある:(0) **§9.2の1行のsim変更が、12個すべてのreplay goldenを動かす**
— §9.4がその手順である(REQ-0256 §13.1のもの、無変更)。これは本programにおける、それらhashの
4回目の移動であり(0256、0257、0263、そして本REQ)、determinism-contract(決定性契約)の移動でも
ある。これは裁定Q1がカバーする範囲だが、本REQはそれを黙って継承するのではなく、自覚的に費やさなけ
ればならない。**art REQ**がdeterminism契約を動かすというのは、本file中で最も予期されない事柄で
あるため、最初に取り上げる。(1) §6 — ray/hit VFXが**新しいart kind `vfx`**を得るか(推奨)、それ
とも**`custom`**を再利用するかという点。2つの現行の先例が互いに矛盾しており(REQ-0175は
`gacha_pack`に対し*"add the kind, required not optional"*(訳:kindを追加せよ、必須でありoptional
ではない)と裁定した;REQ-0179はその1日後、まさに*gacha_pack向けに*`custom`を出荷した)、LLMは
2つのユーザー裁定の間を選ぶことはできない。(2) §7.3 — **hit effectはアニメーションできない。**
批准済みのrouteは、temporal coherence(時間的一貫性)もvideo nodeも持たないstill-image(静止画)
のtxt2img graphである。本REQはstillとrenderer駆動のrampを規定し、pipelineを発明するのではなく
代替案のコストを述べる。(3) §10 — **no-baked-glow**(発光を焼き込まない)というauthoring ruleは
新しいgoldenであり、ユーザーがまだ見ていないartを制約する。
**予約日:** 2026-07-18
**スラッグ:** art-ray-hit-vfx-kind
**ブランチ:** req-expedition-spec(仕様のみ)
**依頼者:** user、2026-07-18 — 仕様項目(i)、原文まま:「Rayは一旦すべて同一の線、ヒットエフェクト
は同一エフェクトとしますが、**差し替えられるようにしておき、artworkに追加する為のREQ**を起こして
ください」。
**依存先:** **REQ-0262**(expedition-ray-vfx) — HARD(必須)。その§9のseam(`RayVfxKey`/
`RayVfxStyle`/`RayVfxProvider`/`DefaultRayVfx`)が本REQのlanding surface(着地面)であり、本REQ
はそのkeyをそのまま採用し、並行する別のkeyを発明することはない。**REQ-0151**(artwork registry +
sizing law)、**REQ-0152**(inspection kit群)、**REQ-0179**(`custom` kind — 最も近い先例であり、
§6の代替案)、**REQ-0211**(art kind `gimic` == art kind `monster` — 「同一に設定する」という、
本REQが適合する箇所では従い、適合しない箇所では離れる先例)。
**ブロック対象:** なし。本REQはleaf(末端)である:per-skillのVFX artをPOSSIBLE(可能)にするが、
それをcommission(発注)することはない。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §6。

## 1. ゴール

仕様項目(i)には3つの節があり、これらは同じ依頼ではない:

1. **"一旦すべて同一の線 / 同一エフェクト"** — 今はray line 1本、hit effect 1つのみを出荷せよ、
   という意味である。**REQ-0262 §9.2が既にこれを行っている**(`DefaultRayVfx`、1つのconstant
   style)。本REQはこれをやり直さない。
2. **"差し替えられるようにしておき"** — それらをswappable(差し替え可能)にしておけ、という意味で
   ある。**REQ-0262 §9.2が既にこれも行っている**(`RayVfxProvider`インターフェース)。本REQはこ
   れもやり直さない。
3. **"artworkに追加する為のREQを起こしてください"** — VFXを**artwork registryに追加できる**よう
   にするためのREQを起こせ、という意味である。**これが本REQの全てであり**、REQ-0262がカバーして
   いない唯一の節である。

したがって作業範囲は狭く、正確である:**ray/hitのVFXを、artwork registryが保持・生成・inspect
(検査)・adopt(採用)・exportできる一種のものにすること** — そしてREQ-0262のseamをそこから読み
取るよう配線すること。fallbackは決してblank(空)にならず、決してcrashしない。

**出荷されるもの:2つのasset**(`vfx_ray_default`、`vfx_hit_default`) — まさにユーザーの
"one line, one hit effect"(訳:ray line 1本、hit effect 1つ)である。**ENABLE(有効化)される
もの:最大162**(81 skills × 2 roles、§8.2)。**ENABLEされることはCOMMISSION(発注)されること
ではない。** ユーザーが2つを求めているのに162個のassetを黙って示唆するart REQはscopeを誤って
いる;本REQは2つと述べ、ユーザーが後にそれを望んだ場合の上限のコストを述べる。

**明示的にscope外:** rayのmotion(動き)、trail、impact highlight、glow budget、nova
coalescing、reduced-motionの挙動 — **すべてREQ-0262**。Skill icon — **REQ-0265**。あらゆる
artのgeneration(生成) — ユーザーがart pipelineを実行する(PROJECT.md HANDS-OFF〔ハンズオフ〕);
本REQは**request(依頼)**であり、`ComfyUI`を実行することも、`monster_matte_variants/`や
`*-artsession`treeに触れることも決してない。

## 2. これを承認する裁定

ブリーフ§6より、原文まま:

> Ray VFX (g,h,i): … One ray line + one hit effect for now, but behind a swappable seam (i) ->
> art REQ-0264.

(訳:Ray VFX(g,h,i):……ray line 1本 + hit effect 1つをさしあたり用いるが、swappableなseamの
裏側に置く(i) -> art REQ-0264。)

REQ-0262 §13(「Out」= 含まれないもの)は、本REQに2つの事柄を名指しで割り当てている:

> **`skill` on `ray_fire`** (§9.3) and **any art** — REQ-0264. The seam ships inert.

(訳:`ray_fire`上の`skill`〔§9.3〕と、あらゆるart — REQ-0264。seamはinert〔不活性〕な状態で
出荷される。)

**したがって本REQはSIM変更**(`ray_fire`上の`skill`)を所有しており、art変更だけではない。§9が
それを規定する。これはscope creep(scopeの肥大)ではない — REQ-0262は、seamが選んだkeyが**wire
上に存在しない**ことを実測しており、そのfieldを本REQに明示的に手渡した。

## 3. 検証済みの現状 — すべての行を読んだ、あるいは実測したものである

| fact | source | evidence |
|---|---|---|
| art kindはちょうど6つである | `server/services/art_sizing.cjs:24` | `const KINDS = ['po', 'si', 'unit', 'monster', 'bpskin', 'custom'];` — **VFX kindは存在しない** |
| …そしてマージ後は`gimic`が7つ目になる | `git show req-0211-gimic-content-kind:server/services/art_sizing.cjs` | REQ-0211 ruling 3;REQ-0255がそれをマージする |
| すべてのkindのsizeはLOCKED(固定)かDERIVED(導出)のいずれかである | `art_sizing.cjs:83-108` | `si`->256x256、`unit`->512x512、`bpskin`->1024x1024は**locked**;`po`->mask bboxの256px/cell、
`monster`->{w,h}の128px/cellは**derived**;`custom`->operatorが型指定 |
| **routeはSTILL-IMAGE(静止画)のtxt2img graphである。いかなるanimation nodeも存在しない。** | `docs/llm_managed/art_pipeline.md` §2 | `UnetLoaderGGUF -> CLIPTextEncode -> CFGGuider ->
SamplerCustomAdvanced -> VAEDecode -> SaveImage`。AnimateDiffなし、video modelなし、
frame-sequence nodeなし。§7.3 |
| **seamless(シームレス)なtilingはEXISTS(存在)し、実測されている** | `art_pipeline.md` §2;
`tools/art_route.py:25,104-109,210-211` | `build_txt2img(..., tiling=True)`は`VAEDecode`を
**`CircularVAEDecode`**へ差し替える。実測seam ratio(継ぎ目比率)は**0.76-1.43、平均1.00**、対する
plain-decodeのcontrolは0.92-2.73。§7.2 |
| …そして`tiling`は**既にANY kind(あらゆるkind)向けのper-renderフラグである** | `server/routes/art.cjs:282` | `const tiling = art.kind === 'bpskin' ? true : !!b.tiling;` — bpskin以外の
artworkも、`tiling:true`を渡すことで既にtile可能な状態でgenerateできる。**rayのために新しい
capability(能力)は一切必要ない。** §7.2 |
| `tiling`はjobに届き、`params`内に記録される | `tools/art_job.py:108,133-134,153,181`;
`server/services/art_jobs.cjs:123,128,159` | `"tiling": bool(job.get("tiling", False))`がrenderの
paramsに刻印される — したがってgateはそれをassertできる |
| `custom`はinspection kitを**ZERO(ゼロ)**しか持たない | `tools/inspect_kits.json`(fileまるごと) | `applies_to`に`custom`を挙げているkitは1つもない。`kitsFor('custom')`は`[]`を返す。§6.2 |
| `tiling.seam`は存在するが、bpskinにscopeされている | `tools/inspect_kits.json` | `{"kit_id":"tiling.seam","kit_version":"1","applies_to":["bpskin"],"blocking":false}` —
band(帯)[0.83, 1.10] **[S7]** |
| kit routingは**kind**単位の粒度であり、shape単位の粒度ではない | `server/services/kit_registry.cjs:19` | `kitsFor(kind) => kits().filter(k => k.applies_to.includes(kind))` — §12.2 |
| …しかしkitは**確かに**shapeを受け取る | `kit_registry.cjs:43-50` | `kitParams(artwork)`は`{kind, shape, gen_width, gen_height}`を返す。**したがって、routingを変
更することなくshape-awareなkitが可能である。** §12.2 |
| `custom`のpromptはpassthrough(素通し)である — **style templateなし** | `server/routes/art.cjs:195`;`tools/art_job.py:96-101` | `defaultsForKind('custom') -> {prompt_template:'{main_object}'}`;
`if kind == "custom": return subject, subject`(`KIND_TO_STYLE`にentryなし) |
| style mapは4つのkindで閉じている | `tools/art_job.py:15`;`tools/art_style.py:51` | `KIND_TO_STYLE = {"po":"item","si":"item","unit":"unit","monster":"monster"}`;
`KIND_TEMPLATE = {"item":"anime","unit":"anime","monster":"concept_art_fantasy"}` |
| export pathは`content/art/<kind>/<system_name>.png`である | `server/services/art_export.cjs:39-41` | `path.join(exportRoot(), adopted.kind)` + `system_name + '.png'` |
| artwork registryは**pg専用**である;filesバックエンドは`{}`を返す | `server/lib/content.cjs:227` | `if (process.env.STORAGE_BACKEND !== 'pg') return {};` — §11のfallbackはこれをsurvive
(生き延び)なければならない |
| `ray_fire`は`skill`/`element`/`cause`のいずれも**運ばない** | REQ-0262 §3、golden-Aで実測 | field集合`seq,t,ev,src,field,entry,dir,pen,aoe` — §9 |
| `telegraph`には**確かに**`skill`が含まれる | REQ-0262 §3、実測 | field集合`seq,t,ev,src,skill,edge,fires_at` — 値は存在するが、間違ったevent上にある。§9.2 |
| telegraph->fireのjoinは**既に不完全である** | REQ-0262 §9.3、実測 | golden-Aにおいて、36件の`ray_fire`に対し**telegraphは35件**。§9.2 |
| glow法則、原文まま | `web/redesign/styleguide.html:553-554` | 「発光は4つの瞬間のみ — ①焦点(hover/選択) ②伝説級以上の顕現 ③生存する連結ビーム ④命中の瞬間。
…外発光は blur ≤ 8px(等倍)・1要素1色。パネルは内影のみ。**同時発光源は ≤ 3/画面。**」 |
| REQ-0262はglowをimpactに限定してrationし(配給制にし)、上限を3に定めている | REQ-0262 §8 R1/R2 | trailとheadは**glowしない**;impact glowは≤3、優先順位はnova > hit > aoe、cullされた
impactも非glowのhighlightを保持する |
| 最大**19**本のrayが同時に飛行中である | REQ-0262 §4、実測 | §10のauthoring ruleが生き延びさせようとしている数値である |
| `G2` — artの中にgameplay stateを入れない | `docs/llm_managed/unit_icon_pipeline.md` §1 | *"Connection shapes, charge progress, link rays, team/enemy tint are renderer overlays. An
icon containing an arrow, gauge, or beam is a FAIL regardless of beauty."*(訳:接続の形状、
charge進捗、link ray、team/enemyのtintはrenderer overlayである。矢印・gauge・beamを含むiconは、
美しさに関わらずFAILである。) — §10はそれのlight(発光)版の類似物である |

## 4. MEASURED(実測) — VFXのassetが実際に耐えなければならないもの

REQ-0262の批准済みgeometry(§5.3、§7、§11.2)から、REQ-0260の`EXP_CELL = 40`のもとで導出:

```
one diagonal          = EXP_CELL * sqrt(2)          = 56.57 px      (a 45 deg step)
trail length          = EXP_TRAIL_DIAGONALS (6)     = 339.4 px      (6 x 56.57)
impact cell highlight = EXP_CELL                    = 40 x 40 px
nova shockwave (peak) = ~3 cells across            ~= 120 px
ray flight, longest   = RAY_STEP_BUDGET 512 diagonals = 28,964 px of path
```

**全体のasset契約を決める2つの数値:**

1. **rayのpath長は、authoring時点でUNBOUNDED(無制限)である**(512diagonalが維持されているbudget
   であり、中央値のrayは28.25diagonal = 1,598 pxである)。**固定サイズのrasterではそれを覆えない。**
   したがってassetは**stretch(引き伸ばし)ではなくtile(タイル張り)**されなければならない —
   1,598 pxの上に256 pxのstripをstretchすれば6.2倍のsmear(にじみ)になる。§7.2。
2. **hitは40〜120 pxで、`EXP_IMPACT_GLOW_MS = 180`ms続く。** 60fpsでは、これは**約11フレーム**で
   ある。§7.3は、なぜこの11フレームがauthoringできず、rampでなければならないのかを示す。

## 5. pipelineがCAN(生成できる)ものとCANNOT(生成できない)もの — §7を形作る答えであるため、正直に述べる

**本REQが存在する理由そのものが、この節である。** 既存のart kindはすべて、sizing lawを伴う
**stillのraster(静止raster)**を生成する。仕様項目(i)が求めているのは*line(線)*と*effect
(効果)*である。それらはstillではなく、そうでないふりをすればbuild不可能なart requestが生まれて
しまう。

### 5.1 CAN(できること) — 今日、新しいcapabilityゼロで

| capability | evidence | what it buys |
|---|---|---|
| [16, 16384]内の任意の/16サイズのstill raster | `art_sizing.cjs:27,31-33` | hit burst(§7.3)、ray tile(§7.2) |
| **SEAMLESSLYにTILEABLEな(継ぎ目なくタイル張りできる)still** | `art_route.py:104-109,210-211`;
実測ratio 0.76–1.43、平均1.00(`art_pipeline.md` §2) | **ray strip(§7.2) — これが(i)をbuild可能に
するfindingである** |
| **bpskin以外**のartworkに対する、render単位でのtiling | `routes/art.cjs:282` — `!!b.tiling` | 新しいflagなし、新しいplumbing(配線)なし |
| 機械によるseam check | `tiling.seam` kit、`tools/inspect_kits.json` | rayの唯一の正しさの性質が、**既存のkitによって**測定可能である |
| 透明度へのalpha matte | `matte.coverage_band`;rembg `birefnet-general`(`art_pipeline.md` §5) | VFXはfieldの上にcompositeされる;白背景の上に置かれることは決してない |
| shape conditioning | `shape_lock`(REQ-0186/0183) | **po専用**(`art_job.py:po_shape_mask`は他のいかなるkindに対しても`None`を返す)。VFXには利用不可;
必要でもない。 |

### 5.2 CANNOT(できないこと) — どれだけprompt engineeringを重ねても変わらない

| asked-for thing | why it cannot be produced | evidence |
|---|---|---|
| **アニメーションするhit effect(sprite sheet)** | graphには**temporal node(時間軸のnode)が存在しない**。Nフレーム = N回の独立したtxt2img呼び出し
である。`seed=1`、`cfg=1.0`、LoRAなしのFLUX.2 kleinには**frame間のcoherence(一貫性)を保つ機構が
ない** — 8つの「フレーム」は8つの無関係なburstであり、再生するとstrobe(明滅)する。 | `art_pipeline.md` §2(graph全体);§0(*"no LoRAs"*、*"no negative"*(訳:LoRAなし、negativeなし)) |
| **videoまたはinterpolated(補間)effect** | video modelはinstallされておらず、boxはそれを保持できない。FLUX.2 + Qwen3-4Bエンコーダは**既に
8GBに同居できていない** — ComfyUIはpromptごとに30〜170秒かけてそれらをswapしている。 | `art_pipeline.md` §2(「The box」):RTX 2080、**8GB VRAM** |
| **bounceで曲がる方向性を持つray** | bounceは一定速度でのhard corner(鋭角)である(REQ-0262 §5.1);rasterはcornerがどこにあるか知り得
ない | REQ-0262 §5.3 — trailは**polyline**であり、rendererがその頂点を所有する |
| **path全体をstretchしたray** | pathは最大28,964 pxに達する(§4) | §4 |

### 5.3 ユーザーが本物のanimationをいつか望むなら必要になる新しいcapability — そのコストを一度だけ述べる

**sprite-sheet routeは本REQで規定されておらず、推測されてはならない。** ユーザーが後に本物の
animationするhitを望むなら、正直なコストは次の通りである:新しいmodel(AnimateDiffやSVD等)を、
8GBのbox上に追加すること。そのboxは、既に持っているmodel単体でも実測cold loadが**450〜540秒**
であり、自身のtext encoderとさえco-resident(同居)できない。それは**新しいREQ、新しいroute、そし
てhardwareについての対話**であり — parameterではない。**安価であるかのように再発見されないよう、
ここに記録する。**

**§7.3のstill+rampは、欠けている機能に対する回避策ではなく、いずれにせよ正しい設計である**。§7.3
は、それをpipelineの限界にではなく、それ自体の長所に基づいて論じる。

## 6. kindの決定 — **USER RULING REQUIRED(ユーザー裁定が必須)**

### 6.1 2つの現行の先例が互いに矛盾している

| REQ | state | what it ruled |
|---|---|---|
| **REQ-0175**(`artadmin-gacha-pack-artwork-kind`) | **draft/**、"CLEARED TO IMPLEMENT"(訳:実装着手可) | user、2026-07-14:**「The art KIND itself — Add it — `artworks.kind = gacha_pack` is required,
not optional.」**(訳:art KINDそのもの — それを追加せよ — `artworks.kind = gacha_pack`は必須で
ありoptionalではない。)**locked 768×768**を伴い、*"exactly as `unit` is locked at 512"*(訳:
`unit`が512にlockされているのとまさに同じように) |
| **REQ-0179**(`custom-art-kind`) | **built/** | user、2026-07-15 — **その1日後** — `custom`を追加し*"so a custom artwork can be assigned 'just
as a texture' to content that has no art-kind of its own (**e.g. `gacha_pack`** / bp_gacha)"*
(訳:custom artworkを、自身のart-kindを持たないcontent〔例:**`gacha_pack`**/bp_gacha〕に「単な
るtextureとして」割り当てられるようにするため) |

**両方とも`gacha_pack`を名指ししている。一方はそれ専用のkindが必要だと言い、他方はそれが不要であ
るよう`custom`が存在すると言う。** REQ-0175は依然として`draft/`にあり、supersede(上書き)も撤回
もされていない。**これはboard上の現行の矛盾であり、解決されるのではなく報告される**(§16) —
しかしそれは同時に、本REQがVFXについてまさに答えなければならない問いでもあるため、回避することは
できない。

### 6.2 本REQが抽出するdiscriminator(判別基準)、そしてそれはコイン投げではない

両REQを合わせて読むと、どちらも明言していないが両方が従っているルールが浮かび上がる:

> **assetにLAW(法則)があるときkindが存在する。それがないとき`custom`が存在する。**

- `si`がkindであるのは**256×256がlockされている**からである。`unit`は**512×512がlockされている**
  から。`bpskin`は**1024×1024がlockされている**、*かつ*blockingなframe gateを持つから。
  `po`/`monster`は**sizeがshapeから導出される**から。REQ-0175が`gacha_pack`をkindにしたかったの
  は**768×768が「他のすべてのkindと同様にlockされたgateでなければならない」**からである — これ
  はその言葉そのものである。
- `custom`はlawの**不在**である:operatorが型を指定するresolution、**style templateを持たない**
  operator所有のprompt、そして — 実測、`tools/inspect_kits.json` — **kitが一切ない**。

**このルールに照らして判断すると、VFXはkindを必要としており、その理由は美的なものではなく具体的
なものである:**

| property | VFXにlawはあるか? | `custom`のもとでの帰結 |
|---|---|---|
| **size** | **YES** — §8が256×64(ray) / 256×256(hit)をlockする。rayの4:1というaspectは、それ自体
がtiling契約**である**。 | operatorが300×70と入力する;stripはmis-tile(誤ったタイル張り)する;
**何もそれを捉えない** |
| **tiling** | **YES** — tileしないray stripは**壊れている、醜いのではない**。 | `routes/art.cjs:282`は、render毎に手で`!!b.tiling`を渡す必要が生じる;一度でも忘れればseamがそ
のまま出荷される |
| **機械によるcheck** | **YES** — `tiling.seam`は、まさにrayの唯一の正しさの性質を測定する | **`custom`はZERO個のkitへrouteされる**(実測)。唯一存在する、起こり得る唯一の問題を捉えるkitに
**到達できない**。これが決定的な論拠である。 |
| **style coherence(一貫性)** | **YES** — G5(roster coherence)が適用される:今日2つ、後に最大
162のassetが、1つのfamilyのように見えなければならない | `custom`のpromptは**templateを持たない
passthrough**である(`art_job.py:96-101`) — すべてのVFX assetが、そのstyleを手作業で背負うこと
になる |
| **fallback chain** | **YES** — §11の3段階chainは名前のconventionをkeyにする | `custom`はすべ
てのtextureが共有するflatなnamespaceである;強制可能なconventionは存在しない |

### 6.3 kindは1つか2つか? — 役割discriminatorを伴う1つ

ray strip(4:1、tiled、flat)とhit burst(1:1、still、ramped)は**異なるgeometry**である。それ
は2つのkind(`ray` + `hitfx`)を主張する論拠になる。**却下する**、なぜならそれらは、*kind*が実際
に意味するものすべてを共有しているからである:1つのprompt template、1つのauthoring law(§10の
no-baked-glow)、1つのfallback chain、1つのseam、1つのmigration、1つのadmin branch、1つのkit
routing entry。2つのkindは、**1つのboolean**を表現するためだけに、それら全てを2倍にしてしまう。

**ADOPTED(採用):1つのart kind `vfx`。その`shape`が、閉じたvocabularyのroleを運ぶ。**

```
shape = { role: 'ray' | 'hit' }
```

**これはREQ-0211の`behavior`patternであり、意図的に再利用したものである。** `gimic/1`は、粗く
閉じたvocabularyのdiscriminator(`trap|treasure|hidden_door`)を運んでおり、その*"map is the
single place the vocabulary is declared — **extensible**"*(訳:mapがvocabularyの宣言される唯一
の場所である — **拡張可能**)という性質を持つ。`vfx.shape.role`は同じ構成である:今日は2つの値、
1箇所で宣言され、3つ目(REQ-0262 §8.4のlink beamがいつかそのREQを得たときの`beam` role)へ、新し
いkindも新しいmigrationもなしに拡張可能である。

**そしてそれは、適合する箇所ではREQ-0211 ruling 3に従い、適合しない箇所ではそこから離れる。**
Ruling 3は*"art kind `gimic` == art kind `monster`, configured identically"*(訳:art kindとし
てのgimicはmonsterと同じであり、同一に設定される)である。**registryのplumbing(配線)について
はこれに適合する** — `vfx`は`KINDS`に加わり、`shapeAndSize`のbranchを得て、artadminのshape
editorを得て、ENUM値を得て、export dirを得る:すべてが既存のkindのshapeからそのまま複製される。
**sizing lawについては適合しない。** `gimic`は本当に`monster`**である** — 両方とも同じboard上で
`w×h`のcell footprintを占めるため、128px/cellのlawを共有することは*truth(真実)*であり、単なる
便宜ではない。**VFXはcellを一切占めない。** それに`{w,h}`を与えることは、footprintを持たないもの
にcell footprintを型入力することを意味する — `shape`のjsonbが恒久的な嘘を運ぶことになり、§8.3
はその嘘がどれほどのコストになるかを示す。

### 6.4 再発見されないよう記録された、代替案の数々

- **Option A — 新しいkind `vfx` + `shape.role`(RECOMMENDED、本REQが規定するもの)。** 1回の
  ENUM migration + REQ-0179のchecklistのコストがかかる。size law、seam kit、style template、
  fallback conventionが手に入る。REQ-0175の裁定に従う。
- **Option B — `custom`を再利用する。** migrationはゼロ;今日出荷できる。コスト:**kitなし、
  size lawなし、templateなし**(§6.2)。rayのseamは機械によって検証不能になる。ユーザーが
  REQ-0179をREQ-0175をsupersede(上書き)するものと読む場合に**限り**擁護可能である。
- **Option C — 2つのkind(`ray` + `hitfx`)。** 却下、§6.3。
- **Option D — registryを一切持たない;VFXを永遠にproceduralなままにする。** これが今日出荷され
  るもの(`DefaultRayVfx`)であり、**「そもそもこれは必要なのか?」に対する正当な答えの1つ**であ
  る — しかしユーザーは、原文まま「artworkに追加する為の」REQを求めており、依頼は明示的である。
  完全性のためだけに記録する。

## 7. asset契約 — §5の現実に基づいて設計する

### 7.1 seamが実際に必要としているもの(REQ-0262 §9.2より、ここで新たに発明したものではない)

```ts
export interface RayVfxStyle {
  trailColor: number;  trailWidth: number;  trailDiagonals: number;
  headRadius: number;
  impactColor: number; impactGlowMs: number; impactGlowBlur: number;
}
```

**すべてのfieldはNUMBER(数値)である。texture用のfieldは存在しない。** したがって本REQによる
最初のclient変更は、`RayVfxStyle`を2つのoptionalなtexture handleで拡張することである —
**optionalであることが要点である**:textureを持たないstyleは、まさに今日の`DefaultRayVfx`その
ものであり、それこそがregistryが空のときにも動き続けなければならないものである(§11)。

```ts
// REQ-0264 -- ADDITIVE. Both optional; null/absent == today's procedural draw.
export interface RayVfxStyle {
  /* ...every REQ-0262 field, unchanged... */
  rayTexture?: string | null;   // artwork system_name; tiled along the trail polyline (s7.2)
  hitTexture?: string | null;   // artwork system_name; ramped at the impact  (s7.3)
}
```

### 7.2 ray — TILEABLEなSEGMENT(タイル張り可能な区間)である、path長がunboundedであるため

**契約:**

```
asset      : one horizontal strip, 256 x 64, seamless in X          (s8)
tile length: ONE DIAGONAL. The renderer maps 1 tile -> 56.57 px of path (EXP_CELL * sqrt(2)).
             So a 6-diagonal trail (REQ-0262 s5.3) draws 6 tiles = 339.4 px, and a
             28-diagonal ray draws 28 tiles. Path length is a TILE COUNT, never a scale.
rendered   : as a TilingSprite along REQ-0262's trail polyline, in the ray's local space
             (+X = direction of travel), with REQ-0262's head->tail alpha ramp applied by the
             renderer on top. The art supplies TEXTURE; the renderer supplies LENGTH and FADE.
downscale  : 256 px source -> 56.57 px per diagonal = 4.5x headroom
caps       : NONE in v1. A head cap would be a 3rd role and a 3rd asset for an effect that is
             56 px long and moving at 25 cells/sec. REQ-0262 s5.2 already draws the head as a
             `headRadius` disc. Deferred, not forgotten -- s8.4's role vocabulary is extensible.
```

**なぜstretch(引き伸ばし)ではなくtileなのか — その論拠は数値そのものである。** §4:中央値の
rayは28.25diagonal = 1,598 pxを移動する;維持されているbudgetは512diagonal = 28,964 pxである。
256 pxのstripを1本、1,598 pxの上にstretchすれば**6.2倍のsmear**になる;budget上限まで伸ばせば
**113倍**である。tilingはどんな長さにおいてもtextureを4.5倍の*downscale*に保つ。**ここでの
tilingは最適化ではなく、それだけが機能する唯一の方法である。**

**なぜこれが今日build可能なのか:`tiling=True`は実測済みで、既に出荷されているcapabilityである**
(§3、§5.1) — `CircularVAEDecode`、seam ratio平均**1.00**。stripは、`bpskin`のfillが既に生成さ
れているのとまったく同じ方法で生成される。**本REQは新しいcapabilityを何も発明しない;既存のもの
を新しいkindへrouteするだけである。**

**両軸でseamlessであることは無害である。** `CircularVAEDecode`はX*と*Y両方向でcircular(円環的)
である;rayが必要とするのはXのみである。stripは1tile分の高さしかないため、Y方向のseamlessness
は未使用であるが、誤りではない。ミスマッチのように見えるが実際はそうではないため、明記する。

**rayは自身のtexture内部でbounceしない。** REQ-0262 §5.3のpolylineはbounce時にV字に折れ、
*"passes through it without smoothing"*(訳:smoothingなしにそこを通過する)。tilingはpolyline
に沿って走るため、bounceは**2つのtile runの間のseam**であり、bakeされたものではなくrenderer
によって描かれる。stripの中に曲がりをauthorしようとする試みはFAILである(§10、V3)。

### 7.3 hit — STILL + RENDERER-DRIVENなRAMP(renderer駆動のramp)、そしてこれは長所そのものにおいて正しい

**契約:**

```
asset      : one square, 256 x 256, radially composed, centred, alpha-matted    (s8)
rendered   : a Sprite at the impact cell (REQ-0262 s7.1: the ray's own last ray_advance),
             driven over EXP_IMPACT_GLOW_MS = 180 ms by the RENDERER:
                 scale(t) : ease-out  from 0.35 -> 1.0     (the expansion)
                 alpha(t) : ease-out  from 1.0  -> 0.0     (the decay)
             This IS REQ-0262 s11.2's shockwave ring, with a Sprite in place of a Graphics.
downscale  : 256 px source -> ~120 px at peak = 2.1x headroom
```

**これは§5.2によって強いられたcompromise(妥協)ではない。実測されたcontentを生き延びる設計で
ある**。そしてこの論拠は、たとえ明日video modelが現れたとしても成り立つ:

1. **REQ-0262 §4は、MEDIAN INTER-ARRIVAL(中央値の到達間隔)0.08秒で17個のnovaを実測しており、
   1.1秒のwindow内に最大14個が収まる。** authoringされた11フレームのanimationは**固定**duration
   を持つ。REQ-0262 §11.2は、`EXP_NOVA_COALESCE_MS = 180`以内に着地するnovaをcoalesce(合体)さ
   せ、coalesceされたgroupは**1つ**のeffectを描く。rampは(`t`を変えるだけで)自明にcoalesceで
   きる;sprite sheetはinstanceごとにplayheadを持ち、14個のplayheadこそが、§11.2が防ごうとして
   いるstrobeである。
2. **REQ-0260 §10は、確定済みplaybackに0.5/1/2/4×とBACKWARD(逆方向)scrubを与える。** rampは
   **clockのpure function(純関数)**である — REQ-0262 §5.2のarchitecture全体であり、そのgate 2
   でもある。authoringされたsheetはplayheadを必要とし、それはseekのたびに、**逆方向にも**cancel
   /rebuildされなければならない。REQ-0262 §5.2は、まさにこの理由により、ray headに対してまさに
   この形を却下した。
3. **REQ-0262 §8 R2は、4つ目の同時glowをCULL(間引き)する。** cullされたimpactも、非glowの
   highlightは引き続き描く。rampのglowはrenderer filterであり — droppable(間引き可能)である。
   **bakeされたanimationのglowはpixelであり — droppableではない。** §10。

**したがってstill+rampは、sim clock、playback制御、そしてglow budgetのすべてが、独立してそれぞれ
要求するものである。** pipelineがアニメーションできないという事実は、ここでは制約に一切なって
いない。

## 8. sizing law(サイズ規則)

### 8.1 規則

```js
// server/services/art_sizing.cjs
const KINDS = ['po', 'si', 'unit', 'monster', 'gimic', 'bpskin', 'custom', 'vfx'];

case 'vfx': {
  const role = shape && shape.role;
  if (role === 'ray') return { width: 256, height: 64 };    // 4:1 strip, tiled along the path
  if (role === 'hit') return { width: 256, height: 256 };   // 1:1 still, renderer-ramped
  throw sizingError("vfx shape must be {role:'ray'|'hit'}");
}
```

**derivedではなくLOCKED(固定)である — `si`/`unit`/`bpskin`と同様、そしてREQ-0175が裁定した
`gacha_pack`と同様である。** どちらも/16-legal(256/16=16、64/16=4)であるため、`snap16`はno-op
であり、この規則はapproximate(近似)ではなくexact(正確)である。

### 8.2 なぜこれらの数値なのか — それぞれが導出されたものであり、1つも恣意的に選ばれていない

| number | derivation |
|---|---|
| **ray、幅256** | 1tile = 1diagonal = 画面上で**56.57 px**(§4)。256/56.57 = **4.5倍のdownscale headroom(余裕)** —
rasterが望む2倍を余裕を持って上回っており、これは`po`のlawが1cellに使う256と同じ数値である
(`art_sizing.cjs:85`、`genSize(bb.w, bb.h, 256)`)。**system内で新しい数値ではない。** |
| **ray、高さ64(4:1)** | 56.57 px/diagonalにおいて、4:1のstripは幅**14.1 px**でrenderされる — `EXP_CELL=40`のcellを
飲み込むことなく読み取れるtrail幅である。**aspectそのものが契約である**:それがpath長に対する
`trailWidth`を固定するものであるため、形の狂ったstripは*スケールの狂ったray*となる。だからこそ
型入力ではなくlockしgateしなければならない(§6.2)。 |
| **hit、256×256** | novaは**約120 px**でpeakになる(§4) = **2.1倍のheadroom**;そして256×256は**`si`のlocked
sizeそのもの**である(`art_sizing.cjs:88`)。それを再利用するということは、`si.subject_frame`の
geometryに関する前提(単一の中央被写体 + margin、*"for 256×256 SIs"*(訳:256×256のSI向けに)と
authorされたもの)が無変更のまま成立し続けることを意味する — §12.2。 |

### 8.3 なぜmonster/gimicの128px/cell lawではないのか — REQ-0211からの離脱を論じる

REQ-0211 ruling 3は`gimic`にmonsterのlawをそのまま与えた。**ここで類推すべき動きは、128px/cellで
の`shape = {w,h}`ということになるだろう。** それは誤りであり、しかもわずかな誤りではない:

- **VFXはcellを一切占めない。** `monster`のlawが読み取るのは**cell footprint**(`{w,h}`、それぞ
  れ1..12)であり、そのものの*board上の*サイズである。REQ-0188はそのfootprintを**authoritative
  (正式)**なものにしている:*"the art is authoritative; fix the CELL SHAPE side"*(訳:artが正式
  であり、CELL SHAPE側を修正せよ)。そして`derive --write`はart shapeをdef footprintへ伝播させ
  る。**rayにはdefもfootprintも存在しない。** それに`{w:1,h:1}`を与えることは、`shape`のjsonbに
  恒久的な虚偽を書き込むことになる — そしてREQ-0188のdoctrine(教義)のもとでは、その虚偽は
  *authoritative*なものとなってしまう。
- **rayの実際のサイズで4:1を表現できない。** `{w:4,h:1}` × 128 = 512×128。これは、run毎に何千回
  もtileされるassetに対して必要pixel数の2倍(9.1倍のdownscale)であり、何も得るものがない。
- **errata(正誤表)は、この危険が理論上のものではなく現実のものであることを証明している。**
  `frost_gnoll`のdef footprintは**`[1,1]`**である(実測、`content/live/dungeon/enemies.json`)が、
  その**art shapeは`{w:3,h:4}`**である — REQ-0188は批准されたが`derive --write`は**未実行のまま
  放置され**、そのため今日、defとそのartはareaにおいて**12倍**食い違っている。そのdriftが*可能*
  であるのは、まさに`monster.shape`がboard geometryを記述すると主張しているからである。**board
  の何も記述しないshapeを持つkindは、boardからdriftし得ない。** §8.1の`{role}`は構造上falsify
  できない(反証不可能な)ものであり、これは現在、実測で違反され続けているlawよりも厳密に優れた
  性質である。

## 9. SEAM — REQ-0262のkeyそのまま、そして本REQが所有するsim field

### 9.1 keyは`skill`である。本REQはそれを再決定しない。

REQ-0262 §9.1は3つの候補を判定し、**`skill` idをADOPT(採用)し**、`element`(*"Not a field on
a skill def at all"*(訳:そもそもskill def上のfieldではない) — 実際のdefは
`{trigger, verb, attack_profile, modes}`である)と`attack_profile`(*"It is a struct, not an
identity. Two unrelated skills sharing `pen:2` would be forced to share art"*(訳:それはstruct
であり、identityではない。`pen:2`を共有する無関係な2つのskillが、artを共有することを強いられて
しまう))を却下した。**その分析は健全であり、本REQはそれを無変更のまま採用する。** ここで独立に
確認した内容:`content/live/dungeon/skills.json`の81entryは**`element` fieldを一切運んでいない**
(実測、§16)ため、`element`は単に配線されていないのではなく — そもそも存在しない。

`RayVfxKey`(REQ-0262 §9.2)は**書かれた通りに**消費される:`{skill, cause, pen, aoe, field}`。
**本REQはkey fieldを一切追加せず、並行するvocabularyも定義しない。**

### 9.2 `ray_fire`上の`skill` — REQ-0262が本REQに割り当てたsim変更

**実測:`ray_fire`は`skill`を運ばない**(§3)。REQ-0262 §13は、そのfieldを本REQに割り当てている。

```
ray_fire  {t, seq, ev, ray, src, field, entry, dir, pen, aoe,
           skill}   // NEW -- REQ-0264. The skill def id (`skills.json` entry id).
```

**それは1つのfieldであり、simは既にその値を手中に持っている。** REQ-0262 §9.3は、`telegraph`に
**既に`skill`が含まれている**ことを実測しており、その`fires_at`は*このfieldがlabelする、まさに
そのfireのtimestamp*である。したがってその値は既に算出され、既にserializeされている — 0.6秒
早いevent上に。

**`telegraph` -> `ray_fire`をclient側でjoinしては*ならない*。** REQ-0262は、golden-Aにおいて
**36件の`ray_fire`に対しtelegraphは35件**であることを実測している:joinは**実データ上で既に
不完全**であり、36本中1本を黙って誤ってlabelしてしまうheuristicは、keyなしより悪い。fieldは、
それを必要とするevent自身の上に置くべきである。

> **35対36のgapは、findingとして継承されており、ここでは追跡しない。** REQ-0262がこのREQのため
> にそれを記録した。1本のrayがtelegraphなしでfireする — おそらくtelegraphする対象を持たない
> reactive/charge fireである。**これは本REQをblockしない**:emissionの場で`ray_fire`に`skill`
> を置けば、telegraphの有無に関わらず36本すべてがlabelされる。§14 gate 6は、まさにこのgapがこの
> field内に隠れられないよう、36/36をassertする。36本目になぜtelegraphがないのか*その理由*を追跡
> するのは、REQ-0256/0257に属する。

### 9.3 コスト

**新しいeventはゼロ。既存の36 events上に1つのfield**(golden-A)。REQ-0257 §10.2が既に受け入れた
**3.75倍**のlog増加に対して、これは測定不能なほど小さい — REQ-0263 §4.4が`hp_after`に対して
取っているのと同じ姿勢である。

**測定不能であることは不可視であることと同じではなく、本REQはどちらとも述べていない。** 36
eventsの上の1つのfieldは**replay JSONLを変化させ**、それが**12個すべてのgoldenの
`jsonl_sha256`**を変化させる。本REQの初稿は"rebaseline"という語を**一度も**使わなかった — そし
て§14 gate 11は`tools/ci.sh`のGREENを要求するが、`ci.sh:107`はstep **[2/7]**で
`sim/tests/goldens.cjs`を実行する。**したがってgate 11は、§9.2がそのfieldを追加した瞬間から、
満たすことが不可能になっていた。** これはsim変更を内包するart REQであり、そのsim変更は、他のど
こであっても持つのと同じ帰結を持つ。

### 9.4 Goldenのrebaseline — REQUIRED(必須)

**手順はREQ-0256 §13.1およびREQ-0257 §14.1のものである。第二のconventionを発明してはならない**
— これは本programにおいて、これらhashを動かす4番目のREQであり(0256、0257、0263、そして本REQ)、
1つのfileに対して4つのconventionがあれば、rebaselineはレビュー可能でなくなる。

```
node sim/tests/goldens.cjs          # CONFIRM RED first -- 12 DRIFT lines. If green, `skill` did not land.
node sim/tests/goldens.cjs gen      # writes sim/tests/goldens/replay_hashes.json
git diff sim/tests/goldens/replay_hashes.json
```

1. **12個すべての`jsonl_sha256`が動くと想定せよ。**
2. **`def_sha256`は、9個のdungenのcaseにおいて決して動いてはならない** — 本REQは`dungen.cjs`に
   触れないためである。もし1つでも動けば、**STOP(停止)せよ**(REQ-0256 §13.1のルール、同じ理由)。
3. **`events`のcountは一切MOVE(変化)してはならない。** 既存のevents上の1フィールド;新規event
   はゼロ。**countが動いたなら、§9.2以外の何かが着地したことを意味する。** REQ-0263 §10.1 step 3
   と同じcheck、同じ鋭さである。
4. **差分が1つのfieldであることを証明せよ。** `batch002/golden-A`について、前後の
   `combat.toJSONL(r.events)`をdumpし、TEXTとしてdiffせよ。**異なる行はすべて`ray_fire`でなけれ
   ばならず、追加された`skill` keyによってのみ異なっていなければならない。** `t`は動かず、
   `amount`は動かず、行の追加・削除・並べ替えは一切ない。**`skill`は`s.effect`から読まれ、これ
   はemissionの場で既にscope内にある — RNGを一切引かない。** もし`amount`が動いたなら、stream
   が乱されており、§9.2は誤って実装されている。
5. **36/36のcheck(§14 gate 6)は、古いlogではなく REBASELINEされたlog上で実行される**。

**順序。** 本REQは0256、0257、0263の**後に**rebaselineする。その差分は4つの中で最もtrivially
(自明に)レビュー可能である — 1つのkeyが、1つのevent kind上に、count変化なしで — だからこそ、
それは他の誰のものとも一緒にfoldされてはならない。**rebaselineされないもの:**
`forecast_parity.cjs`(geometry変更なし — 18/18は無変更のまま期待される)、
`sim/s4_thresholds.json`(手作業でauthorされたもの — REQ-0256 §13.3)、`docs/user_managed/*`
(禁止)。

**`sim/s4/metrics.cjs:117`は`case 'ray_fire'`を読み取り、今後は無視するはずの`skill` fieldを目
にすることになる。** 無害であることを検証済み — それはeventをspread(展開)するのではなく、名前
指定したfield(`:121`:`src`、`field`、`cause`、`mode`)をselectしているため、追加されたkeyはS4
corpusに届き得ない。**S4のbaselineは本REQによっては動かない**(それらが動くのは0256/0257の
*outcome(結果)*変更のためであり、このfieldのためではない)。

## 10. AUTHORING RULES(作画ルール) — VFXのgolden。**USER RULING REQUIRED(ユーザー裁定が必須)、V2について。**

これらはCODEではなくARTを拘束する。goldenとして記述するのは、`unit_icon_pipeline.md` §1のG1〜
G7が*"a rule the art itself must obey"*(訳:art自身が従わなければならないルール)の先例である
ためである。

- **V1 — art_goldenが無変更のまま適用される。** Aspect ratioは不可侵である(rayの4:1は、それ自
  体がtiling契約**である**、§8.2);illustration-first(イラスト優先);assetは配線される前に
  承認される。
- **V2 — NO BAKED GLOW(発光を焼き込まない)。これは光に適用されたG2である。** authorされたVFX
  assetは、outer glow、bloom、softなluminance haloを含んではならない。**Glowは RENDERER
  overlayである**、`EXP_IMPACT_GLOW_BLUR ≤ 8`で描かれ、`EXP_GLOW_BUDGET = 3`(REQ-0262 §8)に
  対してカウントされる。§10.1がその論拠である。
- **V3 — rendererがgeometryを所有する。** ray stripに曲がり・corner・head・tail・方向を示す矢印
  をbakeしない;hitにcell grid・ring・radiusの目印をbakeしない。polyline、bounceのV字、expansion
  ramp、impact cellはすべてREQ-0262のものである(§5.3、§7、§11.2)。**bounceを含むstripはFAIL
  である** — beamを含むiconをG2がFAILとするのとまったく同様に。
- **V4 — 1要素1色。** `styleguide.html:554`:「1要素1色」。2色のray stripはそれをtexture内で違
  反しており、rendererはそれを修正できない。
- **V5 — ray stripはTILEしなければならない。** `tiling.seam`(§12.2)によってseam checkされ、
  **かつ**そのkit自身のルールが要求する、必須のhalf-shift目視check(`art_pipeline.md` §8:seam
  metricは*"reads high on low-contrast tiles"*(訳:低contrastなtileでは高く出る)、
  *"stays a FILTER, never a verdict"*(訳:あくまでFILTERであり続け、判定にはならない))によ
  っても検証される。
- **V6 — roster coherence(G5の類似物)。** 一緒に出荷されるrayとhitは、1つのeffect familyとし
  て読めなければならない。2assetでは自明だが、**162では拘束力を持つ**(§8.2の上限)。

### 10.1 なぜV2はpreference(好み)ではなくhard rule(厳格な規則)なのか

**taskのframingはこれをまさに正しく捉えており、実測がそれを裏付ける:これは光に適用されたG2の
構造である。** G2はこう述べている:*"connection shapes, charge progress, link rays… are renderer
overlays. An icon containing an arrow, gauge, or beam is a FAIL regardless of beauty"*(訳:接続
の形状、charge進捗、link rayは……renderer overlayである。矢印・gauge・beamを含むiconは、美し
さに関わらずFAILである) — なぜなら**rendererはframe毎にstateを制御できなければならず、bakeさ
れたpixelは制御できない**からである。

**Glowも同じ種類のものであり、REQ-0262はそれを実測によって証明している:**

- `styleguide.html:554`は**同時glow sourceを≤3/画面**に制限する。
- REQ-0262 §4は**t=1.98時点で19本のrayが飛行中**であると実測した — budgetを**6.3倍**超過した。
- REQ-0262 §8 R1/R2はそれを解決する:**trailとheadは一切glowせず**、impact glowは**優先順位付
  きcullを伴い3にhard-capされる**(nova > hit > aoe)。

**cullはrenderer operationである。** `GlowFilter`を1つ落とすのは1行である。**textureからhaloを
un-bake(焼き込みを外す)することは不可能である。** したがって:

> **もしray stripがbaked glowを伴って出荷されれば、19本の同時rayにおいて19個のcull不能なglow
> sourceが生まれ、≤3のbudgetは、それを強制する機構が皆無のまま6.3倍違反され、REQ-0262 §8の解決
> 全体 — まさにユーザーに裁定を求めている当のもの — が、1つのart assetによって黙って無効化され
> てしまう。**

REQ-0262 §14.5のgate(「どのframeにおいてもlive glow sourceが`EXP_GLOW_BUDGET`を超えないことを
assertする」)は、**それでもPASSしてしまう**だろう。なぜならそれはrendererのglow objectを数えて
おり、bakeされたhaloはそれに該当しないからである。**artは、gateの死角を通してlawを破ることにな
る。** だからこそこれは、rendererのgateに委ねるのではなく、**それ自身の**機械checkを備えた
*authoring*ルールでなければならない(§12.2の`vfx.flatness`)。

**必要な裁定:** V2は、魔法のrayを描く最も自然な方法を禁じている。flatでglowしないstripは**意図
的に**非魔法的な見た目であり、それこそが§6.1の4つの容認された瞬間が実際にlicense(許可)してい
るものである — REQ-0262 §8 R1:*"a projectile in flight is not one of them"*(訳:飛行中の
projectileはそのうちの1つではない)。**162個のassetがV2に沿ってauthorされる前に、ユーザーはflat
なrayを見るべきである。** 選択肢:

- **(A) RECOMMENDED — 記述通りのV2。** Artはflatである;rendererはimpactのみをglowさせる、≤3、
  blur ≤8。§6.0/§6.1をそのまま尊重する。コスト:rayがshimmer(きらめき)しない。
- **(B) HITにのみbaked glowを許可する**(rayには決して許可しない — 19本の同時trailがhard case
  であり、impactはR2によって既に3にcapされているため)。より弱いが、失敗の仕方は穏やかである:
  budget超過した*impact*は3sourceであり、19ではない。**それでもR2のcullを無効化してしまう**
  ため、≤3が「≤3のrenderer glow + 最大3つのbaked分」= 最大6になってしまう。
- **(C) `#/expedition`向けに§6.0のglow lawをamend(改正)する。** これは**REQ-0262 §8.3の
  Option B**であり、SAME(同一)の裁定である。ユーザーがそちらでbudgetを引き上げれば、V2はこち
  らでも自動的に緩和される。**この2つは共に答えられなければならない** — それこそが要点である:
  art ruleとrenderer budgetは1つの決定である。

## 11. Resolution(解決)とFallback — 決してblankにならず、決してcrashしない

### 11.1 命名のlaw

VFXには**content defが存在しない**ため、REQ-0174の`artwork_ref` columnとexact-nameのconvention
(`system_name == def id`、`resolveItemArtNames`:*"def.artwork_ref adopted -> exact-name adopted ->
omitted"*(訳:def.artwork_refがadoptされていればそれを、なければexact-nameがadoptされていればそ
れを、なければomitted〔なし〕))は**keyにするものが何もない**。したがって、合成名がconvention
となる:

```
vfx_<role>_default          # the shipped default. ROLE in {ray, hit}.  -> 2 assets, TODAY
vfx_<role>_<skill_id>       # an optional per-skill override.           -> up to 162, LATER
```

実測、これはcollision-free(衝突なし)である:81個のskill idは一意であり(§16)、既存のartwork名
はすべて素のdef idであるため、`vfx_`prefixはいかなるcontent idとも衝突し得ない。

### 11.2 chain — 3つのstep、そして最後のstepは決して失敗し得ない

```
styleFor(key: RayVfxKey) -> RayVfxStyle:
  1. key.skill && artwork('vfx_ray_' + key.skill) adopted   -> use it
  2. artwork('vfx_ray_default') adopted                     -> use it
  3. DefaultRayVfx's procedural style                       -> ALWAYS AVAILABLE (REQ-0262 s9.2)
```

**Step 3が保証であり、それを維持するコストはゼロである**。REQ-0262 §9.2が既に、動作する
proceduralな描画として`DefaultRayVfx`を出荷しているためである。本REQは**providerを追加するので
あり、置き換えるのではない**:

```ts
// client/src/expedition/rayVfx.ts -- REQ-0264 adds ONE class. REQ-0262's file, unedited otherwise.
export class RegistryRayVfx implements RayVfxProvider {
  constructor(private artUrls: Record<string,string>, private fallback = new DefaultRayVfx()) {}
  styleFor(key: RayVfxKey): RayVfxStyle {
    const base = this.fallback.styleFor(key);          // every NUMBER comes from the default
    return { ...base,
      rayTexture: this.pick('ray', key.skill),          // null if absent -> procedural draw
      hitTexture: this.pick('hit', key.skill) };
  }
}
```

**これはREQ-0262 §9.2自身のacceptance criterion 13を果たすものである**(*"swapping in a stub
provider changes the ray's look with no change to `ExpeditionRayLayer`"*(訳:stub providerに差し
替えるとrayの見た目が変わるが、`ExpeditionRayLayer`には変更がない)) — そしてこれは、REQ-0262
§9.2が名指しした`chargeRing.ts`のpatternである:**REQ-0264はproviderを1つ登録するのみであり、
他の何も動かない。**

### 11.3 これが空になり得る4つの経路、そしてそれぞれのdegrade(縮退)のしかた

| condition | behaviour |
|---|---|
| **filesバックエンド**(`STORAGE_BACKEND !== 'pg'`) — `computeArtUrls`は`{}`を返す(`content.cjs:227`) | step 2が外れる -> **procedural(手続き的描画)**。これはerrorではなく、**通常のdev/e2e path**
である。REQ-0263 §12.9をmirrorする。 |
| あるskillに対しadoptされたartworkがない | step 1が外れる -> step 2 -> 出荷済みのdefault。**ユーザーの「一旦すべて同一の線」とは、まさに
このpathのことである**。そしてこれは、初日において81/81のskillが取るpathである。 |
| `key.skill === null`(§9.2のfieldが着地する前) | step 1は試行されない -> step 2。**seamはsim変更が一切なくても機能する** — sim変更が買うのは
per-skillのartであって、正しさではない。 |
| PNGが404になる/decodeに失敗する | **procedural**、一度だけlogされ、frame毎に再試行されることは決してない。REQ-0262 §12.2の姿勢:
*"a renderer must never be the thing that takes the page down"*(訳:rendererは、ページを落とすも
のになってはならない)。 |

### 11.4 preload(事前読み込み)をしてはならない

1回のrunでliveになるtextureは最大`2 + 2N`個である(N = field上のdistinctなskill数)。**roster
単位でresolveせよ、namespace全体を決してresolveするな。** 上限では、162 × 256pxのPNGは18pxの
badgeぶんの画面のためだけに数MBのdownloadとなる — REQ-0265 §11がskill iconについて述べているの
と同じ規律である。

### 11.5 Dexへの帰結:**NONE(なし)。**

**VFXはcontentではない。** `content_defs`のrowを持たず、Dex tabを持たず、`art_urls`のentryも
持たない:`computeArtUrls()`(`server/lib/content.cjs:226-249`)は`items`/`sis`/`tms`/`monsters`
をjoinする — **すべてcontent-defのidのnamespaceである**。`vfx_ray_default`は何のidでもない。
§11.1のconventionにより、`/api/art/vfx_ray_default.png`で直接fetchされる。

**したがって`computeArtUrls`は本REQによって拡張され*ない*** — これはREQ-0265からの意図的な離
脱である。REQ-0265はそれを**確かに**拡張する(skillは**content defである**ため)。「art_urlsに
追加せよ」が反射的な発想であるため、明示的に述べる — ここでそれを行えば、idでkeyされたmapに非
idを入れることになってしまう。

## 12. surfaces(表層)

### 12.1 Registry / admin — REQ-0179のchecklistを適用する

REQ-0179は最も近い先例であり(*"adding a NEW art kind"*(訳:新しいart kindを追加する))、その
scope tableに一点一点、忠実に従う:

| REQ-0179のstep | this REQ |
|---|---|
| **A. migration** | `server/migrations/0NN_artwork_kind_vfx.sql`:`ALTER TYPE artwork_kind ADD VALUE IF NOT EXISTS
'vfx';` — top-level(ADD VALUEはtxn内で実行できない)、`IF NOT EXISTS`でidempotent(冪等)。
**番号はここでは固定しない — §16のcollision findingを見よ。** |
| **B. sizing law** | `art_sizing.cjs`:`KINDS += 'vfx'`;§8.1の`case`。単一source;clientがmirrorする。 |
| **C. route** | `routes/art.cjs`:`shapeAndSize('vfx', shape)`は`{role}`を閉じたvocabularyに照らして検証し、
`{shape:{role}, size:deriveSize(...)}`を返す。`defaultsForKind('vfx')` -> §12.3。**加えて`:282`
に1行**:`const tiling = (art.kind === 'bpskin' \|\| (art.kind === 'vfx' && art.shape?.role ===
'ray')) ? true : !!b.tiling;` — rayは、bpskinのfillが常にそうであるのとまったく同様に、**常に**
tileされる。operatorの選択ではなく、lawである。 |
| **D. python composer** | `tools/art_job.py`:`KIND_TO_STYLE += {"vfx": "vfx"}`;`tools/art_style.py`:
`KIND_TEMPLATE += {"vfx": ...}` -> §12.3。 |
| **E. artadmin** | `artShared.ts`:`Kind`/`KINDS` += `'vfx'`;`deriveSizeClient`が§8.1をmirrorする;
`defaultTemplate('vfx')`;`ArtDraft`が`role`を得る。`CreatePanel.tsx` / `Workspace.tsx` /
`ArtAdminPage.tsx`:**2択のrole selector**(testid `art-vfx-role`)+ 読み取り専用の
`art-resolution`表示。`ShapeEditors.tsx`:`vfx`のbranch(radioの対 — **file中で最も単純な
shape editor**、意図的にそうしてある:`{role}`は1bitである)。CSS `.aa-kind--vfx`。 |
| **F. contentadmin picker** | **拡張しない。** `Workspace.tsx:56`の`typeChips`は、*content def*がartworkをlinkできるように
するために存在する;**vfxをlinkするdefは存在しない**(§11.5)。そこに`vfx`を追加すれば、
operatorに無意味なlinkを提示することになる。**REQ-0179 step Fからの意図的な離脱**である。同step
が拡張したのは、まさに`gacha_pack`のdefがそのartを**確かに**linkするからである。 |
| **G. tests** | §14。 |

### 12.2 Kit registry — kindを求める論拠を、ここで現金化する

```json
// tools/inspect_kits.json
{"kit_id":"tiling.seam","kit_version":"1","applies_to":["bpskin","vfx"],"blocking":false}
{"kit_id":"matte.coverage_band","kit_version":"1","applies_to":["po","si","unit","vfx"],"blocking":false}
{"kit_id":"vfx.flatness","kit_version":"1","applies_to":["vfx"],"blocking":false}   // NEW, s12.2.2
```

**12.2.1 — routingはkind単位の粒度であり、shapeはそうではない。両方の事実が重要である。**
`kitsFor(kind)`は`applies_to.includes(kind)`でfilterする(`kit_registry.cjs:19`) — **kitはrole
によってrouteされ得ない。** したがって`tiling.seam`は、tileされない`hit`assetに対しても実行され
てしまい、誤ってWARNしてしまうだろう。

**修正にrouting変更は不要であり、その根拠は`kit_registry.cjs`自身の中にある:**
`kitParams(artwork)`は**`{kind, shape, gen_width, gen_height}`**を返す(`:43-50`) — **kitは既に
`shape`を、したがって`role`を受け取っている。** したがって`tiling.seam`は
`params.shape.role !== 'ray'`を読み取り、not-applicable(非該当)を返せばよい。これは、
`content_checks.cjs`が適用されないdialectに対し`applicable:false`を報告するのとまったく同様であ
る(REQ-0211の先例)。**findingとして記録する**:shape-awareなkitは今日既に可能であり、tree内で
それを使っているものはまだ何もない。

> **述べておくべき現実の帰結:** `shape`は`kitInputSha256`の一部である(`kit_registry.cjs:58-61`)。
> したがって**artworkの`role`を切り替えると、そのinspectionは正しくinvalidate(無効化)され**、
> stale badgeが切り替わる。それは望ましい挙動であり、無償で手に入る — しかしこれは、`role`が
> 装飾的なlabelではなく、renderのinspection identityの一部であることを意味する。

**12.2.2 — `vfx.flatness` v1 [S7]:V2のための機械check。** V2はauthoring ruleである;測定を伴わ
ないauthoring ruleはsuggestion(提案)に過ぎない。bakeされたouter glowは、被写体の周囲に**幅広い
中間alphaの帯**を作る(flatなassetは薄いantialiasing帯しか持たない)。したがって:

```
soft_alpha_band = fraction of pixels with 8 < alpha < 200
verdict [S7]:  <= 0.12 -> PASS ;  else WARN + a mandatory eyeball
```

**閾値は[S7]としてmarkされており、批准され*ていない*** — `monster.render_sanity`や
`si.subject_frame`が出荷されているのと同じ姿勢である(`art_pipeline.md` §8のroster table)。
その数値は、ここで推測されたものではなく、最初のgalleryからcalibrate(較正)される。
**Advisory(助言的)であり、決してblockingではない**(`inspect_kits.json`自身のルール:block
するのは`bpskin.frame_gate`のみであり、しかもrecipe内でのみである)。

### 12.3 style template — design上の問い、推測せずflagする

`KIND_TEMPLATE`には3つのentryがある:`anime`(item、unit)、`concept_art_fantasy`(monster)。
**どちらも合わない。** Anime templateは*"anime++, bold outline, cel-shaded coloring, shounen,
seinen"*(訳:アニメ++、太いoutline、セル塗り、少年、青年)を付加する — **「bold outline」はVFX
stripにとって積極的に誤りである**、そしてpipelineは、隣接するcaseで既にこの正確な失敗を実測して
いる:*"The Anime template's 'bold outline' + cel-shading turn a fill brief into a discrete bordered
OBJECT: asked for a leather texture, it produced a stitched, black-outlined leather patch"*(訳:
Anime templateの「bold outline」+ セル塗りは、fillのbriefを、境界線で区切られた個別のOBJECT
〔物体〕に変えてしまう:レザーのtextureを求めたところ、縫い目のある黒いoutline付きのレザーpatch
が生成された)(`art_pipeline.md` §3)。**Anime templateのもとでray stripを求めれば、energy beam
ではなくoutline付きのobjectが返ってくることになる。**

**`FILL_STYLE`が既存のものの中で最も近い** — それが存在するのはまさに、fillが
*"allover, edge to edge, no focal object, no border, no outline, no frame"*(訳:全面に、端から
端まで、焦点となる被写体なし、境界線なし、outlineなし、frameなし)と言わなければならないからで
ある。**ray strip**はまさにその文法を求めている(tileable、境界線なし、焦点被写体なし);
**hit burst**はその逆を求めている(1つの中央に置かれた焦点被写体)。

**したがって`vfx`には独自のtemplateが必要であり、2つのroleには2つのtemplateが必要かもしれない。**
**これはDESIGN(意匠)の問いであり、LLMはユーザーのart directionを発明してはならない** — 現行の
directionは2026-07-13に*ユーザーがInvokeAIの結果を見て*批准したものであり、REQ-0175は
`gacha_pack`について同一のgapを記録している(*"`gacha_pack` -> **???**, a design question, not
an inference"*(訳:`gacha_pack` -> **???**、design上の問いであり、推測ではない))。**ここでも
同様に記録する。**

**具体的な出発点、あくまで提案として:** ray -> `FILL_STYLE`のno-border文法 + energyを表す名詞;
hit -> `concept_art_fantasy`(その*"glazed brushstrokes, otherworldly"*(訳:艶やかな筆致、異世
界的)という性質はburstに適しており、強制的なoutlineを伴わない)。**ユーザーが裁定し;§15がそれ
にgateする。**

## 13. Scope(範囲)

**含まれるもの:**

1. `server/migrations/0NN_artwork_kind_vfx.sql` — **NEW。** `artwork_kind` ENUM += `vfx`。
   (§16:番号について。)
2. `server/services/art_sizing.cjs` — `KINDS += 'vfx'`;§8.1の`case`。
3. `server/routes/art.cjs` — `shapeAndSize`/`defaultsForKind`のbranch;`role:'ray'`向けの`:282`
   **forced-tiling(強制tiling)**の行。
4. `tools/art_job.py` + `tools/art_style.py` — `KIND_TO_STYLE`/`KIND_TEMPLATE` += `vfx`(§12.3、
   **ユーザーのdirection裁定の後**)。
5. `tools/inspect_kits.json` — `tiling.seam` + `matte.coverage_band`が`vfx`を得る;**NEW**
   `vfx.flatness` v1。加えて`tiling.seam`のrole no-op(§12.2.1)。**`kit_version`のbumpはなし**:
   kindを`applies_to`に追加することは、*"a threshold nor an algorithm change"*(訳:閾値の変更
   でもalgorithmの変更でもない)のいずれでもない(manifest自身のbumpルール)ため、**既存の
   bpskin/po/si/unitのinspectionはstaleに*なってはならない*。** §14 gate 8がそれをpinする。
6. `client/src/artadmin/*` — `artShared.ts`、`CreatePanel.tsx`、`Workspace.tsx`、
   `ArtAdminPage.tsx`、`ShapeEditors.tsx`、`artadmin.css`(§12.1 E)。
7. `client/src/expedition/rayVfx.ts` — **REQ-0262のfile。** `RayVfxStyle`が2つの**optional**な
   texture handleを得る;**NEW** `RegistryRayVfx`(§11.2)。`DefaultRayVfx`は**編集されない**。
8. `client/src/expedition/ExpeditionRayLayer.ts` — **REQ-0262のfile。** `rayTexture`がsetされて
   いれば`TilingSprite`を(§7.2)、`hitTexture`がsetされていればrampされた`Sprite`を描く(§7.3);
   proceduralな描画は`null`のbranchとして残る。
9. **Sim(additive、加算的):** `ray_fire`上の`skill`(§9.2)。**1つのfield、新規eventはゼロ —
   しかし12個すべてのREPLAY GOLDENを動かす**(§9.4)。これはdeterminism-contractの変更を内包す
   るart REQであり、それに対する脚注としてではなく、sim変更としてscopeに列挙する。
9b. **§9.4に従うrebaseline** — `sim/tests/goldens/replay_hashes.json`。本programにおいて、これ
   らhashを動かす4回目である(0256、0257、0263の後)、そして最もレビューしやすい:1つのkey、
   1つのevent kind、count変化ゼロ。
10. **Art request(ユーザーのpipeline向け、ここでは実行しない):2つのasset** —
    `vfx_ray_default`(256×64、`tiling:true`)、`vfx_hit_default`(256×256)。§15。

**含まれないもの:**

- **rayのmotion / trail / impact / glow budget / nova / reduced-motion** — REQ-0262。本REQが変
  えるのは**引数**であり、構造ではない。
- **Skill icon** — REQ-0265。
- **あらゆる画像のgeneration、matting、adoption** — ユーザーがart pipelineを実行する
  (PROJECT.md HANDS-OFF)。本REQは`ComfyUI/`、`monster_matte_variants/`、`*-artsession`の
  worktree、いかなるGPU出力にも一切触れない。
- **per-skill VFXのcommissioning(発注)**(最大162、§8.2)。**Enabled ≠ commissioned。**
- **sprite-sheet / video capability** — §5.3。新しいREQ、新しいroute、hardwareについての対話。
- **Head/tail cap** — §7.2。3つ目のrole、先送り;vocabularyは拡張可能である。
- **Link beam** — REQ-0262 §8.4が、それらを(g)/(h)/(i)のscope外であると宣言し、描かないことを
  推奨した。もしそれらがいつか戻ってきたら、それらは新しいkindではなく**3つ目の`role`**である。
  seamの、設計上唯一想定された拡張として記録する。
- **REQ-0175とREQ-0179の解決**(§6.1) — boardの矛盾;報告する(§16)。
- REQ-0188の`frost_gnoll`のdrift(§8.3)に対する**`derive --write`の実行** — 報告する;
  REQ-0188のものである。
- **`docs/user_managed/*`** — 禁止されており、ここでは何もそれを必要としない。

## 14. Gates

**E2Eのport(規則:`5000 + REQ*10 + index`):`7640` static / `7641` api / `7642` proxy。** 番号採
番規則により予約され、`tools/check_e2e_ports.cjs`によって機械的に強制される。**裁定Q2(「e2eを通
す必要はない」)により、E2Eは本programにとってgateでは*ない*ため、harnessは構築されず、この10番
台は未使用のまま残される** — REQ-0262 §14が7620-7622について取るのと、REQ-0263 §11が
7630-7632について取るのと、同じ姿勢である。

実際に適用されるgate:

1. **sizing law(REQ-0179のG2 testを拡張したもの)。** `deriveSize('vfx',{role:'ray'})` ===
   `{256,64}`;`{role:'hit'}` === `{256,256}`;`{role:'beam'}` / `{}` / `null`は`BAD_SHAPE`を
   throwする。**未知の値を受け入れる閉じたvocabularyは、閉じていない。**
2. **rayは常にtileされる。** `vfx`/`ray`を作成し、`b.tiling`を**渡さずに**generateし、renderに
   記録された`params.tiling === true`をassertする(`art_jobs.cjs:159`がそれを刻印する)。次に
   `b.tiling`なしの`hit`は -> `params.tiling === false`。**これは、tileしないrayが決してadopt
   されないようにするgateである。**
3. **Kitがrouteされ、roleのno-opが機能する。** `kitsFor('vfx')`は`tiling.seam`、
   `matte.coverage_band`、`vfx.flatness`を返す。`hit`においては、`tiling.seam`はWARNではなく
   **not-applicable(非該当)**を記録する(§12.2.1)。
4. **`role`はinspection identityの一部である。** artworkの`role`を切り替え;`kitInputSha256`が
   変化し、stale badgeが切り替わることをassertする(§12.2.1)。
5. **fallback chainはblankになり得ない。** golden-Aを、(a)すべての`vfx` artworkを削除、
   (b)`vfx_ray_default`のみ存在、(c)`STORAGE_BACKEND=files`(`art_urls === {}`)、(d)404になる
   PNG、の4条件でreplayする。**4つすべてにおいて:rayはproceduralに描かれ、何もthrowせず、何も
   blankにならない。** (c)は**デフォルトのe2e path**であり、edge caseではない。
6. **`skill`はすべての`ray_fire`上にある。** Golden-A:**36/36**が、`skills.json`内で解決可能な
   非nullの`skill`を運ぶ。**§9.2を35-telegraphのgapに対してpinする**:countは35ではなく36でな
   ければならない。
7. **seamは、assertionによってではなく実際に行使することによって証明される。** `DefaultRayVfx`
   -> `RegistryRayVfx`をstubの`artUrls`と共に差し替える;`ExpeditionRayLayer.ts`への編集**ゼロ**
   でrayの見た目が変わる。(REQ-0262 AC-13、実際のproviderによって果たされる。)
8. **どのkitもstaleにならない。** §13.5の`applies_to`編集の後、既存のすべての`bpskin`/`po`/
   `si`/`unit`のrenderの`kit_input_sha256`が**無変更**であることをassertする。誤った大量stale
   化は、単なるrouting編集のためにinspection履歴全体を無効化してしまうだろう。
9. **V2には実効力がある。** 意図的にbloomさせたfixtureに対する`vfx.flatness` -> WARN;flatな
   fixtureに対しては -> PASS。これがなければ、§10のルールは単なる文章に過ぎない。
10. **Migrationはadditive(加算的)かつidempotent(冪等)である。** 2回適用する;`artwork_kind`
    = {po,si,unit,monster,bpskin,custom,gimic,vfx}。古いcodeは`vfx`を決してemitしない
    (REQ-0179のmigration-firstの論拠)。
11. `pnpm exec tsc --noEmit` + lint + **`tools/ci.sh`がGREENであること — これは§9.4のrebaseline
    を先に要求する。** `ci.sh:107`はstep**[2/7]**で`sim/tests/goldens.cjs`を実行し、§9.2の
    `skill` fieldは12個すべての`jsonl_sha256`を動かす。**§9.4なしにはこのgateはPASSできない**
    — 当初書かれた時点で既に満たすことが不可能であり、本REQは"rebaseline"という語を一度も使わ
    なかった。順序:§9.4に従いrebaselineし、§9.4の4つのcheckに照らして差分をreviewし、**その後**
    `ci.sh`を実行する。
12. **`node sim/tests/goldens.cjs`が12件すべてでgreenであること、§9.4に従いrebaselineされてい
    ること**、9個すべてのdungen caseで`def_sha256`が無変更であること、そして**すべての
    `events`countが無変更であること**(§9.4 step 3)。
13. **`node server/tests/api_test.cjs`(determinism)がgreenであること。** 再生成すべきものは何も
    ない — それはre-simulate(再シミュレート)しdeep-equalsする(REQ-0256 §13.2)。**ここでの
    REDは、baselineのartifactではなく、本物のdeterminism破壊である。** rebaselineしてはならない。

## 15. Acceptance criteria(受け入れ基準)

1. operatorは`vfx` artworkを作成し、`role` = ray|hitを選択し、**読み取り専用**の導出済み
   resolution(256×64 / 256×256)を見て、それをgenerate、inspect、adopt、そして
   `content/art/vfx/<name>.png`へexportできる — VFX専用のpathなしに、**既存のmachineryを通じて**。
2. **`vfx_ray_default`と`vfx_hit_default`が存在し、adoptされている。** これがユーザーの「一旦す
   べて同一の線、ヒットエフェクトは同一エフェクト」であり — **2つのassetであって、162ではない。**
3. `rayTexture`がsetされたrayは、REQ-0262のtrail polylineに沿って、stripを**1diagonalにつき
   1tileの割合でtile**して描く;28diagonalのrayは、28倍にstretchした1枚ではなく**28個のtile**
   を描く(§7.2)。
4. `hitTexture`がsetされたhitは、`EXP_IMPACT_GLOW_MS = 180`にわたってscale 0.35->1.0 /
   alpha 1.0->0.0にrampされる**stillを描き**、**0.5/1/2/4×および逆方向scrubのもとでも正しい**
   — それがplayheadを持たない、clockのpure functionであるためである(§7.3)。
5. **何も決してblankにならない。** §14.5の4条件すべてが、proceduralな描画へdegrade(縮退)する。
6. **seam keyは`skill`である** — REQ-0262 §9.1のものであり、並行する別のものではない。`grep`は、
   `element`または`attack_profile`をkeyにしたVFX lookupがどこにも存在しないことを示す(§9.1)。
7. **`ray_fire`は`skill`を運び、golden-Aで36/36である**(§9.2)、そして**client側でのtelegraph
   joinは存在しない**:`client/src/expedition/`内で`fires_at`に対する`grep`は、joinをゼロ件返す
   (§9.2)。
8. **adoptされたいかなる`vfx` assetもbaked glowを含まない**(V2) — `vfx.flatness`のPASS + ユー
   ザーのgalleryでの目視。
9. **texture導入後も≤3のglow budgetが維持される。** `RegistryRayVfx`を有効にした状態でREQ-0262
   §14.5のgateを再実行する:liveな**renderer**のglow sourceは≤3であり、artは**ゼロ**を追加する
   (§10.1)。
10. `ExpeditionRayLayer`は**構造上の変更を一切必要としなかった** — 2つのtexture branchのみであ
    る(§13.8)。
11. **ユーザーが以下について裁定していること:§6(新しいkind `vfx` vs `custom` — そして暗黙のう
    ちにREQ-0175 vs REQ-0179)、§10のV2(baked glowなし、REQ-0262 §8のbudget裁定と共同で)、そし
    て§12.3(VFXのstyle direction)。** それより前に実装は開始されない。

## 16. ブリーフ、taskのframing、コード、そして姉妹REQへの訂正

| claim | reality | evidence |
|---|---|---|
| task:*"is this a new art kind (`vfx`? `ray`? `hitfx`?), two kinds, or a reuse of `custom`? Read
REQ-0179's `custom` kind properly — **it may already be the intended home**"*(訳:これは新しいart
kindなのか〔`vfx`?`ray`?`hitfx`?〕、2つのkindなのか、それとも`custom`の再利用なのか?
REQ-0179の`custom` kindをきちんと読め — **それが既に意図されたhomeであるかもしれない**) | **そうではなく、決定的な理由は測定可能である:`custom`はZERO個のinspection kitへrouteされる。**
`tools/inspect_kits.json`内で`applies_to`に`custom`を挙げているentryは1つもなく、
`kitsFor('custom')`は`[]`を返す。ray stripの**唯一**の正しさの性質はtileすることであり、
`tiling.seam`はまさにそれを測定するが、**`custom`からは到達できない**。`custom`にはsize lawも
style templateも存在しない。 | §6.2、`tools/inspect_kits.json` |
| **REQ-0175とREQ-0179はCONTRADICT(矛盾)し合っており、両方とも現行である**(NEW finding) | REQ-0175(**draft/**、"CLEARED TO IMPLEMENT"〔訳:実装着手可〕、2026-07-14に裁定):
*"**The art KIND itself — Add it** — `artworks.kind = gacha_pack` is **required, not optional**"*
(訳:art KINDそのもの — それを追加せよ — `artworks.kind = gacha_pack`は**必須でありoptionalで
はない**)、locked 768×768。REQ-0179(**built/**、2026-07-15に依頼):`custom`を追加し
*"so a custom artwork can be assigned 'just as a texture' to content that has **no art-kind of its
own** (e.g. **`gacha_pack`**/bp_gacha)"*(訳:custom artworkを、**自身のart-kindを持たない**
content〔例:**`gacha_pack`**/bp_gacha〕に「単なるtextureとして」割り当てられるようにするため)。
**両方とも`gacha_pack`を名指ししている;一方はそれにkindを与え、他方は`custom`がそれをcoverす
ると言う。** REQ-0175は撤回もsupersede(上書き)のmarkもされていない。**「Xはkindを得るか?」に、
これが解決されるまでboardは答えられない** — そして本REQとREQ-0265の両方がそれを問うている。 | §6.1 |
| **020番でのMIGRATION NUMBER COLLISION(番号衝突)**(NEW finding) | `master`/このworktreeには**`020_render_variant.sql`**がある(REQ-0223)。
`req-0211-gimic-content-kind`branchには**`020_content_kind_gimic.sql`** +
`021_artwork_kind_gimic.sql`がある。**REQ-0255は0211をマージする -> 2つの異なる`020_*`file。**
致命的ではない(**先例が存在する**:`016_content_artwork_ref.sql`と
`016_content_kind_gacha_pack.sql`は既に共存している)が、これは**マージ前には次の空き番号を`ls`
から導出できない**ことを意味する。したがって本REQは`0NN`と書き、**implementation時点、マージ後
のbaseline上で**番号を確定する — マージ後の次の空き番号は**022**である。REQ-0255にflagする。 | §12.1、§13.1 |
| task:*"a ray line is a *tiling/stretching* asset"*(訳:ray lineはtiling/stretchingのassetで
ある) | **Tilingである。stretchingでは決してない — その論拠は数値そのものである。** 中央値のrayは
pathを**1,598 px**移動し、維持されているbudgetは**28,964 px**である(512diagonal × 56.57)。
256pxのstripを中央値までstretchすれば**6.2倍のsmear**;budgetまでなら**113倍**である。 | §4、§7.2 |
| task:*"a hit effect is an *animated* burst … a sprite-sheet **or** a still + renderer-driven
scale/alpha ramp"*(訳:hit effectはanimateするburstである……sprite-sheet、**または**stillと
renderer駆動のscale/alpha ramp) | **sprite sheetは単に利用不可というだけでなく — ここではWRONG(誤った)設計である**、そして3つ
の批准済みの制約が独立にそれを語っている:novaは実測**中央値inter-arrival 0.08秒**でcoalesce
する(sheetは14個のplayheadを必要とする);playbackは**0.5/1/2/4×とBACKWARD**で走る(sheetは
seek毎のteardownを必要とする — REQ-0262 §5.2がheadに対して既に却下した形である);そして
REQ-0262 §8 R2はglowを**cull**する(bakeされたframeはcullできない)。**still+rampは、限界にで
はなく長所において勝る。** | §7.3 |
| task:*"State honestly what the current pipeline … CAN and CANNOT produce"*(訳:現在のpipeline
がCANとCANNOTのものを、正直に述べよ) | **CAN、そしてこれが(i)をそもそもbuild可能にしているfindingである:seamlessなtilingは既に出荷
されており、実測されており(seam ratio平均1.00)、`routes/art.cjs:282`は既に`tiling`をANY kind
向けのper-render flagとして公開している。** rayは**新しいcapabilityを一切必要としない** —
それをrouteするkindが必要なだけである。**CANNOT:あらゆるanimation。** graphにはtemporal node
がない;cfg 1.0でLoRAなしのkleinにはframe coherenceがない;そしてbox(**8GB**)は、video model
はおろか、FLUX + 自身のtext encoderさえco-residentできない。 | §5.1、§5.2 |
| task:*"Follow REQ-0211 ruling 3's precedent ('configured IDENTICALLY to monster') where it
fits"*(訳:適合する箇所ではREQ-0211 ruling 3の先例〔「monsterとIDENTICALLYに設定する」〕に従え) | **PLUMBING(配線)については適合するが、LAWについては適合しない。** `gimic`は本当に`monster`
である — 両方とも`w×h`の**board footprint**を占めるため、128px/cellを共有することはtruthであ
る。**VFXはcellを一切占めない**;`{w,h}`は`shape`のjsonbにおける恒久的な嘘になってしまう —
そしてREQ-0188は`shape`を**authoritative(正式)**なものにしているため、それは*authoritative*
な嘘になってしまうだろう。 | §6.3、§8.3 |
| **REQ-0188のdriftは現実のものであり、本REQはdef側を実測した** | `frost_gnoll`のdef footprintは**`[1,1]`**である(実測、`content/live/dungeon/enemies.json`)
のに対し、errataのart shapeは`{w:3,h:4}`である — **12倍のarea不一致**が現行で存在している、
REQ-0188が批准され**`derive --write`が未実行のまま放置された**ためである。§8.3のための*証拠*と
してここに引用する:boardを記述すると主張するshapeはboardからdrift**し得る**;`{role}`はし得
ない。 | §8.3 |
| ブリーフ§6(無言) | **`ray_fire`は`skill`を運ばない。** REQ-0262 §9.1がそれを実測し、§13がそのfieldを**本REQに**
割り当てた。したがって(i)の「skillごとに差し替え可能」は、artにではなく**sim変更に**gateされ
ている — ブリーフもtaskもこの事実を述べていない。 | §9.2 |
| REQ-0262 §9.1:*"`element` … Not a field on a skill def at all"*(訳:`element`……そもそも
skill def上のfieldではない) | **独立した実測によりCONFIRMED(確認済み)。** `content/live/dungeon/skills.json`の**81**
entryすべてが、まさに`{id, name_en, name_ja, trigger, verb, attack_profile, modes}`
(+ optionalな`note`)を運ぶ。**`element` fieldは存在しない。** 配線されていないのではなく —
そもそも存在しない。 | §9.1 |
| REQ-0262 §9.3の35対36のtelegraph gap | **継承されており、追跡はされない**が、**無害化される**:`ray_fire`自身のemission箇所で
`skill`をemitすれば、telegraphの有無に関わらず36本すべてがlabelされ、§14.6は35ではなく**36**
にgateする — したがってこのgapはこのfieldの中に隠れることができない。 | §9.2 |
| `tools/inspect_kits.json` — kit routing(NEW finding) | **Routingはkind単位の粒度である**(`kit_registry.cjs:19`)ため、kitを`role`にscopeすること
はできない。**しかし`kitParams`は既に`shape`を渡している**(`:43-50`) — したがって
**shape-awareなkitは今日既に可能**であり、tree内でそれを行っているものはまだない。
`tiling.seam`はそれを使って`hit`でno-opする。 | §12.2.1 |
| `art_pipeline.md` §3が実測したAnime-templateの失敗 | *"asked for a leather texture, it produced a stitched, black-outlined leather patch"*
(訳:レザーのtextureを求めたところ、縫い目のある黒いoutline付きのレザーpatchが生成された)。
**同じ失敗がray stripを襲うことになる**:「bold outline」は*object*を作ってしまい、beamは
objectではない。**`vfx`はAnime templateを再利用できず**、正しいtemplateは**ユーザーのdesign
裁定**である(REQ-0175は同一のgapを記録している:*"`gacha_pack` -> ???, a design question, not
an inference"*〔訳:`gacha_pack` -> ???、design上の問いであり、推測ではない〕)。 | §12.3 |
| `unit_icon_pipeline.md` §0:unitに対する*"`target_px` 256×256, **`gen_px`
1024×1024**"*(訳:`target_px`256×256、**`gen_px`1024×1024**) | **Dead(死んでいる)。** `art_sizing.cjs:96`は`unit`を**512×512**にlockする。fileの自身の
SUPERSEDEDバナーがそれをcoverしている(*"generation sizes … out of date"*〔訳:generation
sizeは……時代遅れである〕)ため、これはcontradictionではない — しかしこれは、読者が拾ってしまう
stale(陳腐化した)数値である。修正はせず、報告のみする(そのart側は`art_pipeline.md`によって
まるごとsupersedeされている)。 | §3 |
