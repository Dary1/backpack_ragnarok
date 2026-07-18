# REQ-0260 — expedition-fullscreen-route: `#/expedition`、全画面戦闘シェル

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKED。作業を開始する前にユー
ザーの判断が必要な点が3つある:(1) §9.4 — simクロックを1:1で再生すると、全画面戦闘はroomが解放され
るより前に終了してしまう。REQ-0240によりroom占有時間がPRESENTATION(提示)時間として扱われるように
なったためであり、2つのクロックを両方とも満たすことはできず、ユーザーが選ばなければならない;(2)
§9.2 — C4裁定はクライアントのみの変更としては実装できない。pacingのgateがWIRE(通信経路)上に
あるため(サーバー側)であり、本REQはサーバー側のseamを追加しなければならない;(3) §7.3 — ruling
Q3を文字通りに解釈すると(「横長 → 横並び」)、実在するありふれたビューポート(1280x1024)において
算術的に誤りとなるため、本REQは正確な閾値を代わりに提案する。
**予約日:** 2026-07-18
**スラッグ:** expedition-fullscreen-route
**ブランチ:** req-expedition-spec(仕様のみ)
**依頼者:** user、2026-07-18 — 仕様項目(a)、(d)、(e)およびQ3裁定 / C4裁定。
**依存先:** REQ-0255(expedition-merge-baseline)— HARD(必須)。全画面ボタンはREQ-0240のmonitor
ヘッダー上にあり、これは未mergeである;§9はREQ-0240のpacing層、および同ブランチにしか存在しない
`run.simDurationSecs`に依存する。
**ブロック対象:** REQ-0261(expedition-formation-render)、およびそれを通じてREQ-0262 / REQ-0263。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q3、§3 C4、§3 C5、§6。

## 1. ゴール

**シェル**を立ち上げる:既存のBattle Monitor上の全画面ボタンから到達できる新しいルート
`#/expedition`であり、ビューポート全体を占有し、論理CELL=40で26x18の平面を2枚hostする——画面の向き
はビューポートから決定され、両平面は一様にfit-scaleされ、スクロールはなく、SIMクロックを再生する。

本REQが提供するのは**シェルのみ**である:ルート、deep link、mountの規律、画面の向き、fit-scale
変換、clockのseam、chrome。**空の平面を2枚描画するだけである。** その内側にあるもの——squad、
instance、ray、HP、cooldown——はすべてREQ-0261/0262/0263が扱う。この切り分けは意図的である:以下の
ジオメトリに関する決定(§7、§8)は証明可能な算術であり、単独でレビュー可能だが、renderingに関する
決定はart-and-dataの決定であり、そうはいかない。

既存の小さいmonitorは、追加されるボタン1つを除いて**UNTOUCHED(無変更)**である。ユーザー:
「今ある画面は放置して」。

## 2. 検証済みの現状 — 以下は全て自分で読んで確認した

| fact | source | evidence |
|---|---|---|
| `Route`は12個のメンバーからなるunionである | `client/src/store/core.ts:105-118` | `export type Route = 'landing' \| 'backpacks' \| … \| 'contentadmin';` |
| `VALID_ROUTES`はSEPARATE(別個)のarrayである | `client/src/store/core.ts:120` | `const VALID_ROUTES: Route[] = ['landing', …, 'contentadmin'];` — 手動管理の2つ目のlistである |
| 未知のhashは`'backpacks'`になる | `client/src/store/core.ts:143-147` | `routeFromHash()`: `return (VALID_ROUTES as string[]).includes(raw) ? (raw as Route) : 'backpacks';` |
| deep linkはregexであり、`routeFromHash`より先にチェックされる | `client/src/store/routing.ts:150-172` | `INVITE_HASH_RE` → `DEX_ITEM_HASH_RE` → `CONTENTADMIN_HASH_RE` → `ARTADMIN_HASH_RE` → `MARKET_SELL_HASH_RE` → else `routeFromHash` |
| backpacksビューは決してunmountされない | `client/src/App.tsx:198` | `<div className={`backpacks-view${route === 'backpacks' ? '' : ' route-hidden'}`}>` |
| `.route-hidden`は`display:none`である | `client/src/styles/base.css:691` | `.route-hidden { display: none; }` |
| chromeは既にroute単位で非表示になる | `client/src/App.tsx:177-183` | `const onLanding = route === 'landing';`が`<Nav>` + `<Header>`をgateする |
| railは厳選されたlistであり、「あらゆるroute」ではない | `client/src/Nav.tsx:44-52` | `NAV_ITEMS`は9個のentryを持つ;`artadmin`/`contentadmin`はrail entryを持たないrouteである |
| Monitorはrunではなく、ROOMをkeyとする | `Monitor.tsx`(0240)`:57-70` | `interface MonitorProps { room: ApiRoom; … }`;`fetchRun(room.id)` |
| runビューはROOM idで取得される | `client/src/api/schedule.ts:93` | `export function fetchRun(roomId: string): Promise<ApiRunView>` |
| `durationSecs`はPRESENTATION(提示)時間である | `server/services/runs.cjs:125-130`(0240) | `durationSecs: paced.durationSecs` + *"the room is occupied for as long as the paced replay lasts"*(訳:roomはpaced replayが続く間ずっと占有される) |
| SIM時間は保存されるが、配信はされない | `server/services/runs.cjs:142`(0240) | `simDurationSecs: computeDurationSecs(result.events)` — run DOC内にはあるが、`ApiRunView`には存在しない |
| pacingのgateはWIRE(通信経路)上にある | `server/services/runs.cjs:28-36` + `pacing.cjs:183-203`(0240) | `visibleEvents()` → `decorateVisible(run, clock.elapsedSecs)` → `if (visSecs > elapsedSecs) continue;` |
| `setLayout`が存在し、row/columnを切り替える | `MonitorRenderer.ts:207-218`(0240) | `setLayout(layout: 'row'\|'column')`が`enemyField`を動かし + `renderer.resize(...)` |
| `geom.ts`のCELL/PAD | `client/src/board/geom.ts:56-57` | `export const CELL = 80;` / `export const PAD = 38;` |
| reduced-motionはアプリ自身が持つ | `client/src/a11y/motionPrefs.ts:116` | `export function getReducedMotion(): boolean`(REQ-0143);`main.tsx:15`が`initMotionPrefs()`を呼ぶ |

## 3. ルートの配線

### 3.1 2つのリスト — 両方を拡張しなければバグになる

`client/src/store/core.ts`はroute集合を**2回**保持している:1回はTypeScriptのunion(コンパイル時)
として、もう1回はランタイムのarrayとして。両者は互いから導出されていない。

```ts
export type Route = … | 'contentadmin';                                        // :105-118
const VALID_ROUTES: Route[] = ['landing', …, 'contentadmin'];                    // :120
```

両方に`'expedition'`が加わる。unionだけをwideningするとtype-checkは通るが、そこで行き止まりに
なる:`routeFromHash('#/expedition')`は`VALID_ROUTES.includes('expedition')`を尋ね、`false`を得て
`'backpacks'`を返す——routeはどこにもエラーを出さないまま、静かに存在しないことになる。arrayだけを
wideningすると`as Route`のcastで`tsc`が失敗する。最初の失敗モードのほうが危険である:それはサイレ
ントだからだ。

> これはPROJECT.mdの**「ルールの半分しか見ていないゲートは、そのルールを何も見ていないのと同じ
> である」**の、あり得る最小の形である——1つの事実の両半分が、わずか4行しか離れていない場所にあり
> ながら、規律以外の何によっても結び付けられていない。本REQはこれを修正しない(unionから
> `VALID_ROUTES`を導出するにはconst-tupleへのrefactorが必要であり、これはroute利用箇所すべてに
> 触れることになる——それは本REQの仕事ではない)。本REQはこれを記録し、§14はテストでこれを固定
> することで、次に追加されるrouteが半端な状態のまま入り込めないようにする。

### 3.2 Deep link — 正体はROOM id

`#/expedition`単体では意味を持たない:viewはどのexpeditionを見ているのかを知らなければならない。
**運ぶべき正体はROOM idであり、run idではない。** これは推測ではなく根拠がある:

- `Monitor.tsx`(0240)は`room: ApiRoom`を受け取り、`fetchRun(room.id)`を行う——room idこそがkeyで
  ある。
- `client/src/api/schedule.ts:93`:`fetchRun(roomId: string)` → `GET /api/schedule/rooms/:id/run`。
  `GET /api/runs/:runId`は存在しない。runはそのroomを経由してのみaddressableである。
- `room.lastRunId`は存在するが、*存在確認*(`if (!room.lastRunId) return null`)としてのみ使われて
  いる。
- `room.formationId`——REQ-0261がsquad配置に必要とするもの——はROOMに属しており、runには属さない。

したがってhashは`#/expedition/<roomId>`となり、これは`DEX_ITEM_HASH_RE`の`#/dex/<id>`の形を正確に
ミラーしたものであり、`core.ts:98-104`の設計メモがこれをverbatim(そのまま)踏襲すべき先例である:

> a deep-link hash carrying an id SEGMENT, distinct from the plain '#/dex' route hash. Checked the
> same way INVITE_HASH_RE is … the route resolves to 'dex' (still a plain Route member, no union
> widening needed) AND dexFocusId is set

(訳:プレーンな'#/dex'というrouteのhashとは別物である、idというSEGMENT(区分)を運ぶdeep-linkのhash。
INVITE_HASH_REと同じ方法でチェックされる……routeは(union wideningを必要としないプレーンなRoute
memberのままの)'dex'に解決され、かつdexFocusIdがsetされる)

3つの帰結があり、いずれもload-bearing(構造を支える)である:

1. **`EXPEDITION_HASH_RE = /^#\/expedition\/(.+)$/`** を`core.ts`に、他の4つと並べて追加する。
2. **store field `expeditionRoomId: string | null`** + `routing.ts`内の`clearExpeditionRoomId()`を
   追加し、`dexFocusId`/`clearDexFocusId()`をミラーする。**dexの先例からの意図的な逸脱:** dex focus
   はONE-SHOT(一回限り)である(消費されてからclearされるので、その後のre-renderがjumpを再度強制
   することはない)。expeditionのroom idはone-shotでは**ない**——それはviewの主題そのものであり、
   routeがactiveである限り、あらゆるre-renderを生き延びなければならない。そのため、これは消費時で
   はなくROUTE EXIT(routeからの離脱)時にclearされる。このことをfieldのdoc commentにはっきりと書く
   こと。そうしなければ、`dexFocusId`にpattern-matchした読み手が、これをone-shotへと「修正」して
   しまい、画面を空白にしてしまうためである。
3. **specificなものをgenericなものより先にチェックする順序は必須である。** `routeFromHash
   ('#/expedition/room_abc')`は`#/`を取り除いて`expedition/room_abc`にするが、これは`VALID_ROUTES`
   に存在しないため、**`'backpacks'`**を返す。もしregexのチェックがfallbackの後に行われれば、
   あらゆるexpeditionのdeep linkがcanvasページに着地してしまう。`routing.ts:150-172`
   (`initRouting`)と`:174-206`(`onHashChange`)はそれぞれこのchainを持っており、**両方**がこの
   チェックを得なければならない——両者は同じladderの2つの独立したコピーだからである。

Bareな`#/expedition`(room segmentなし)は引き続きlegalであり、`VALID_ROUTES`経由で
`expeditionRoomId === null`のrouteに解決される。これがrenderするのはクラッシュではなくempty state
(§10.3)である。これは、素のhashをbookmarkしたユーザーや、roomが消滅した後にそこへ着地したユーザー
が得る結果である。

## 4. REQ-0034と新しいPixi Application

### 4.1 ルール、引用

`client/src/App.tsx:21-33`、そのまま引用する:

> REQ-0034 CRITICAL constraint (hard lesson from REQ-0031 Phase A bug 2 — see
> docs/REQ/REQ-0031-e2e-bugfix-squads-ui.md section 2 and docs/REQ/REQ-0034-global-navigation.md):
> the backpacks section (Board + InventoryBoard, each its own PixiJS Application) is rendered
> UNCONDITIONALLY below, exactly like before REQ-0034 — it is NEVER wrapped in
> `{route === 'backpacks' && ...}` or any other conditional that would unmount it. Switching to a
> different nav route only adds `.route-hidden` (display:none, see index.css) to its wrapping
> `<div className="backpacks-view">`; the components themselves, their Pixi Applications, and their
> `<canvas>` elements stay mounted in the DOM at all times. **This is what makes "route away and back
> N times, boards still interactive" hold — there is no remount for a route switch to ever race.**

(訳:REQ-0034のCRITICAL(重大)な制約(REQ-0031 Phase Aのbug 2から得たhard lesson——
docs/REQ/REQ-0031-e2e-bugfix-squads-ui.mdのsection 2およびdocs/REQ/REQ-0034-global-navigation.md
を参照):backpacksセクション(BoardとInventoryBoard、それぞれが自分自身のPixiJS Applicationを持つ)
は、REQ-0034以前と全く同じく、以下でUNCONDITIONALLY(無条件に)renderされる——これは`{route ===
'backpacks' && ...}`や、それをunmountさせるような他のいかなるconditionalでも決してwrapされない。
別のnav routeへ切り替えても、その`<div className="backpacks-view">`というwrapper自体に
`.route-hidden`(display:none、index.css参照)が加わるだけである;component自体、そのPixi
Application、そして`<canvas>`要素は、常にDOM上でmountされたままである。**これによって「N回route
を離れて戻ってきても、boardは操作可能なまま」が成立する——route切り替えでremountがraceすることは
決してない。**)

### 4.2 このルールが実際に禁じていること — スローガンではなく根本原因を読め

スローガンは「常にmountされている」である。**メカニズム**は`BoardRenderer.setOps()`
(`BoardRenderer.ts:268-288`)に文書化されており、実際にははるかに具体的である:

> destroying a PixiJS Application calls `GlContextSystem.destroy()`, which releases the WebGL context
> via the `WEBGL_lose_context` extension's `loseContext()` — per the WebGL spec this is ASYNCHRONOUS
> … InventoryBoard.tsx's old effect called `destroy()` in its cleanup and then, **in the SAME
> effect-flush**, ran a brand new `BoardRenderer.mount()` … before the browser had actually finished
> tearing down the old context. Under this box's software GL path (swiftshader …) that race left the
> driver in a state where every subsequent shader compile failed, which sent PixiJS's
> `checkMaxIfStatementsInShader()` into its `while(true){ compile; if(!ok) maxIfs=maxIfs/2\|0; else
> break; }` loop FOREVER … a real infinite busy-loop, not merely a slow stall.

(訳:PixiJS Applicationをdestroyすると`GlContextSystem.destroy()`が呼ばれ、これは`WEBGL_lose_context`
extensionの`loseContext()`を通じてWebGL contextを解放する——WebGL仕様上、これはASYNCHRONOUS(非同期)
である……InventoryBoard.tsxの旧effectは、そのcleanupで`destroy()`を呼び、その直後、**同じ
effect-flush内で**、新しい`BoardRenderer.mount()`を実行していた……ブラウザが実際には古いcontextの
tear downをまだ終えていないうちに。このマシンのsoftware GLパス(swiftshader……)の下では、この
raceはdriverを、以降のすべてのshader compileが失敗する状態に陥らせ、これがPixiJSの
`checkMaxIfStatementsInShader()`を、`while(true){ compile; if(!ok) maxIfs=maxIfs/2|0; else break; }`
というループにFOREVER(永遠に)送り込んだ……これは単なる遅いstallではなく、本物の無限busy-loopで
ある。)

**危険なのは、1回のflush内でdestroy-then-mount(destroyしてからmount)することであり、
「Pixi Applicationはbootの時点から存在しなければならない」ということではない。** この区別こそが、
以下の決定のすべてであり、スローガンだけを読むとそこを誤る。

### 4.3 決定:**初回訪問時にlazyにmountし、その後は二度とunmountしない**

| option | verdict |
|---|---|
| **(a) Board/InventoryBoardと同様、bootの時点からAlways-mounted(常時mount)** | **Rejected(却下)。** ほとんどのsessionが一度も開かないrouteのために、すべてのsessionでWebGL contextを1つ消費してしまう。Contextはbrowser全体で共有される、厳しく小さいbudgetである(Chromeは~16個を超えるとleast-recently-usedをevictする);appは既に**2つ**を無条件に(Board、InventoryBoard)、**さらに開いているroomカード1枚につき1つ**(`MonitorRenderer`、`Monitor.tsx:120-135`)を消費している。何も描画しないのに、1920x1080クラスのdrawing bufferまで確保する3つ目の無条件contextを、deep-linkでしか開かないrouteのために毎回のbootで持つのは、何の見返りもなく支払う実質的なコストである。Board/InventoryBoardがalways-mountedなのは、それらがBOOT route(起動時のroute)のcontentだからであり、本routeはそうではない。 |
| **(b) 訪問のたびにmountし、離れたらdestroyする** | **Rejected(却下)——これがREQ-0031のbugである。** routeを離れてから十分速く戻る(またはStrictModeのdouble-invoke下)と、destroyとmountが同じcanvasに対して1回のflush内に着地してしまう。これはrendererをhangさせたのとまさに同じ形である。 |
| **(c) 初回(FIRST)訪問時にmountする;Appのlifetimeが続く限りaliveのままにする;離れたら`.route-hidden`にする** | **ADOPTED(採用)。** |

(c)はREQ-0034を正確に遵守する。REQ-0034が述べているinvariant(不変条件)は**switch(切り替え)**
についてのものだからである:*"there is no remount for a route switch to ever race."*(訳:route切り
替えでremountがraceすることは決してない)。(c)の下ではそれは起こらない——最初のmountの後は、以降
のenter/leaveはすべて`backpacks-view`と同じCSS classのtoggleにすぎない。最初のmountはroute
switchではなく、まだ存在していなかったsurfaceのcold bootであり、raceする相手の古いcontextが存在
しない。

**具体的には、`App.tsx`において:**

```
{/* Expedition view: mounted on FIRST visit, then NEVER unmounted (REQ-0034).
    `mountedExpeditionOnce` latches true and never returns to false. */}
{mountedExpeditionOnce ? (
  <div className={`expedition-view${route === 'expedition' ? '' : ' route-hidden'}`}>
    <ExpeditionPage roomId={snapshot.expeditionRoomId} locale={snapshot.locale} />
  </div>
) : null}
```

`const [mountedExpeditionOnce, setMountedExpeditionOnce] = useState(false)`と、`route ===
'expedition'`でこれをlatchするeffectを伴う。**このlatchこそが安全性のすべてである**——false→true
にしか動かないbooleanは、destroy/mountのraceを表現し得ない。`ExpeditionPage`自身は、`Board.tsx`
のもの(そのeffectは`snapshot.status === 'ready'`をkeyにしている)ではなく、`Monitor.tsx`の実績ある
mount-once形(`mountedOnce` + `canvasEl` state + unmount effect内でのみ行う`destroy()`)に従う。

**Chrome:** `#/expedition`は全画面であるため、`landing`と全く同様に、railとheaderを隠す。
`App.tsx:177`は次のようになる:

```ts
// REQ-0069 (landing) + REQ-0260 (expedition): both are full-bleed screens that own
// the whole viewport and carry their own exits, so neither shows the rail/header.
const fullBleed = route === 'landing' || route === 'expedition';
```

`onLanding`は、その3箇所の使用箇所(`:181`、`:182`、`:183`)すべてで`fullBleed`にrenameされる。
これはまた、expedition routeにおいて`app-shell`が`with-rail`を失うことも意味する点に注意——これは
正しい挙動であり、これによってviewportが実際にfullになる(`base.css:94`の`.app-shell.with-rail`は
railのgutterを確保している)。

**railへのentryはなし。** `Nav.tsx`の`NAV_ITEMS`には手を加えない。先例:`artadmin`と
`contentadmin`はどちらも実在する`Route`のmemberでありながらrail entryを持たず、deep linkでのみ
到達できる。expeditionはmonitorの全画面ボタンから到達するものであり、rail entryを設けても、どの
roomも見ていない時には常にdead linkになってしまう。

## 5. 全画面ボタン

### 5.1 どこに、正確には

`client/src/schedule/monitor/MonitorHeader.tsx`(REQ-0240ブランチ——このファイルはmasterには存在
しない)。そのlayoutを、全体を読み込んだ上で示す:

```
.mon-header
└ .mon-header-banner            (dungeon 4:1 crop art, or the ᛝ fallback)
  ├ .mon-header-scrim
  └ .mon-header-row
    ├ .mon-header-title.dj      "{dungeonName} · Lv{level}"
    ├ .chip.is-live … | .chip.den.mon-replay-chip
    ├ .mon-header-grow          (aria-hidden spacer — everything after is RIGHT-aligned)
    ├ .mon-header-return        "returns at HH:mm"
    └ .mon-header-menu-wrap
      ├ button.mon-header-menu-btn  "⋯"
      └ .mon-header-menu (admin: seed + copy JSONL)
```

このボタンは**`.mon-header-return`と`.mon-header-menu-wrap`の間**に置く——すなわち、⋯という
overflowの手前にある、右寄せclusterの最後の項目である。理由:これはprimaryなactionであり(その
useful半分が`isAdmin`でgateされているoverflow menuの中に隠してはならない)、identityではない
(そのため`.mon-header-grow`の左には属さない)、そして⋯メニューはheaderの右端に固定されたpopoverを
開くため、行の最後であり続けなければならない。

```tsx
{onOpenFullscreen ? (
  <button
    type="button"
    className="btn btn-ghost mon-header-fullscreen"
    data-testid="monitor-fullscreen-btn"
    aria-label={t(locale, 'schedule.monitor.fullscreen')}
    onClick={onOpenFullscreen}
  >⛶</button>
) : null}
```

**`MonitorHeader`は新しいoptionalなprop`onOpenFullscreen?: () => void`を1つだけ得る。** optional
であるため、渡されない場合componentはbyte-identicalにrenderされる——これにより既存のREQ-0240テスト
は構造上すべてgreenのまま保たれ、`App.tsx`のREQ-0041 portalメモが述べているのと同じadditiveな姿勢
である("a STRICT ADDITIVE change … with no slot registered … this file's rendered output is
byte-identical to before")(訳:STRICT ADDITIVE〔厳密に加算のみ〕な変更……slotは登録されていない
……このfileのrendered outputは以前とbyte-identicalである)。

`Monitor.tsx`はこれを渡す:

```tsx
onOpenFullscreen={() => setRoute(`expedition/${room.id}` as Route)}   // WRONG — see §5.2
```

### 5.2 `setRoute()`はroom idを運べない — 本物のtrap

`setRoute()`(`routing.ts:10-19`)は、`Route`のunion memberから`location.hash = `#/${route}``を
書き込む。これにはdeep-linkの形が**存在しない**。このapp内の既存のdeep linkはすべて、`setRoute`
以外の何かによって生成されている:Dexカードのfooterは素の`<a href="#/dex/…">`であり、invite/market
のlinkは外部からやって来る。`setRoute('expedition/' + room.id as Route)`はtype-castで嘘をつくこと
になり、`onHashChange`がたまたまそれをparseできたとしても、`snapshot.route`はまず文字列リテラル
`'expedition/room_abc'`にsetされてしまう——これは`Route`ではなく、`App.tsx`内のどの`route === …`
testにも一致せず、hashchangeイベントが追いつくまでの間、空白のページをrenderしてしまう。
**これをやってはならない。**

正しい形を、優先順に示す:

1. **素のanchor**、Dexの先例に合わせる(`Monitor.tsx`の`schedule-monitor-rewards-hint-link`は既に
   `<a className="…" href="#/warehouse">`である):
   `<a className="btn btn-ghost mon-header-fullscreen" href={`#/expedition/${roomId}`}>⛶</a>`。
   middle-click/新しいタブが無料で使え、storeへのround-tripもcastも不要。**ADOPTED(採用)。**
2. スタイルの一貫性のために`<button>`が必要な場合は、`routing.ts`に
   `setRouteDeepLink(route: Route, segment: string)`を追加する——`snapshot.route`を本物の`Route`
   memberにsetし、AND(かつ)`location.hash`をsegment付きの形にする、この順序で。`setRoute`を
   overloadしてはならない。

したがって`MonitorHeader`の新しいpropは`fullscreenHref?: string | null`であり、callbackではない。
`Monitor.tsx`は`fullscreenHref={`#/expedition/${room.id}`}`を渡す。propが存在しない場合(runが
ない、またはそれを望まないcaller)、ボタンは完全に省略される。

### 5.3 手を加えないもの

`Monitor.tsx`、`MonitorRenderer.ts`、`ExpeditionRail.tsx`、`EventFeed.tsx`、`SquadDock.tsx`、
`useRunPlayhead.ts`、`pacingClient.ts`——いずれも変更しない。小さいmonitorは、その18pxのcell、
900pxにある`row`/`column`のbreakpoint、そのpacing、そのtransportをそのまま保つ。新しいexpedition
moduleの外で行う編集は**これだけである**:`core.ts`内の2つのlist、`routing.ts`内の2つのladder、
`App.tsx`内のcomposition + `fullBleed`、`MonitorHeader.tsx`内の1つのprop + 1つのanchor、
`Monitor.tsx`内の1つのprop pass、2つのi18n key、そして§9のサーバー側seam。

## 6. ジオメトリ — 論理ステージ(ブリーフ§3 C5)

定数を、新しいfile`client/src/expedition/expeditionGeom.ts`に置く。**これらは
`client/src/board/geom.ts`への編集ではない**——§6.2を参照。

```ts
export const EXP_CELL = 40;                 // spec (d): half of board/geom.ts CELL=80. LOGICAL.
export const EXP_GAP = 32;                  // gutter between the two planes (brief §3 C5)
export const PLANE_W = FIELD_COLS * EXP_CELL;  // 26 * 40 = 1040
export const PLANE_H = FIELD_ROWS * EXP_CELL;  // 18 * 40 =  720
export const ROW_STAGE_W = PLANE_W * 2 + EXP_GAP;  // 2112
export const ROW_STAGE_H = PLANE_H;                //  720
export const COL_STAGE_W = PLANE_W;                // 1040
export const COL_STAGE_H = PLANE_H * 2 + EXP_GAP;  // 1472
```

`FIELD_COLS`/`FIELD_ROWS`は**import**されるものであり、再宣言はしない——`client/src/schedule/
fieldGeometry.ts:16-17`から(`export const FIELD_COLS = 26; export const FIELD_ROWS = 18;`)。
REQ-0258 §9.1は、field寸法が強制されたmodule境界の下、既に3箇所に存在しており、それぞれがparity
testでpinされていることを文書化している(`sim/tests/run.cjs:1823/1830/1840`)。**本REQは4つ目の
コピーを作ってはならない。** `fieldGeometry.ts`は同一tree内のTypeScriptでありimport可能である;
ここには重複を強制するboundaryは存在しない。

### 6.1 PADは存在しない

ブリーフ§6はboardを「`geom.ts`(CELL=80、PAD=38)」と説明しており、taskのframingは`PAD=38`を
半分にすべき定数の中に挙げている。**この平面に関しては両方とも誤りであり、ブリーフ自身の§3 C5が
それを証明している:** そこでは`one plane = 26*40 x 18*40 = 1040 x 720`と計算されている。この算術
には**PAD項が存在しない**。19というhalf-PADを入れると平面は1078 x 758になってしまい、C5にある
すべての数値——1440、2080、2112、0.909のscale、36.4pxのcell——が誤りになる。

両者は同じ概念ではなく、だからこそ一方をscaleしてももう一方にはならない:

- `PAD = 38`は**Backpacks boardのcanvas margin**である:`BoardRenderer.mount()`はappを
  `PAD*2 + COLS*CELL`(= 38*2 + 8*80 = 8x8のcanvasについて**716x716**)にsizeし、`cx()/cy()`
  (`geom.ts:63-68`)はすべてのcellをこの分だけoffsetする。これが存在するのは、MJÖLNIR stageの
  座標rail(`CanvasChrome.tsx`の`BoardCoords`、`PAD 38 / CELL 80`をミラーする——`App.tsx:233-237`
  参照)が描画する場所を持つためである。これはgridの外側にある、pixel単位の**chrome**である。
- expedition平面のmarginは**padding-1リング**(spec (f))である:row 1、row 18、col A、col Z——
  **26x18 gridの内側にあるcell**であり、そこでrayが生まれ(`combat_spec` §2.2のentry cell)、
  REQ-0261によって別の色でdrawされ、REQ-0258のvalidatorによって強制される。これはgridの内側にある、
  cell単位の**field**である。

リングこそが平面のmarginである。その上にpixel単位のPADをさらに加えると、marginの周りにmargin
を描くことになってしまう。**`EXP_PAD`は存在しない。** `client/src/schedule/fieldGeometry.ts`の
`cellIdToXY(cell, cellPx)`と`parseBoxToPixelRect(box, cellPx)`は、既にpad項なしでcell A1をpixel
(0,0)にmapしている——これらはこの平面に対して、書かれた通りのままで正しく、これが2つ目の独立した
確認となる。

### 6.2 なぜ`geom.ts`は編集されないのか

taskのframingは「半分にすべきscale定数:`geom.ts` CELL=80->40」と述べている。これを文字通りに
受け取ると**Backpacks boardが半分になってしまう**。`CELL`/`PAD`は`BoardRenderer.ts:68`、
`ghosts.ts`、`commits.ts`、`linkTrace.ts`、`CanvasChrome.tsx:43`、およびforecast overlayによって
importされるmodule定数である;これらを変更すると、稼働中のcanvasページが変わり、`BoardCoords`の
ミラーされたジオメトリが壊れ、REQ-0125aのgolden G7が動いてしまう。expeditionは**自分自身の**
moduleに**自分自身の**定数を持つ。「1/2」は2つの数の間の関係(`EXP_CELL === CELL / 2`)であり、
本REQはまさにそれをテスト(§14)でpinし、その関係が記憶に頼るのではなく機械的にcheckされるように
する。

## 7. 画面の向き(Q3裁定)

### 7.1 裁定

> **Q3 — 横長の画面で表示されている場合は、横並び、縦並びの画面の場合は縦並びで**
> (横長のビューポート → 横並び;縦長のビューポート → 縦並び)

spec (a)により、**縦並びではenemy / monster_pack平面が上(TOP)に、player squadが下(BOTTOM)に
置かれる。** 横並びではplayer平面が左(LEFT)、enemy平面が右(RIGHT)に置かれる——これは
`MonitorRenderer`の既存の`playerField.x = 0` / `enemyField.x = FIELD_W + FIELD_GAP_PX`
(`MonitorRenderer.ts:172-175`)と一致しており、2つのviewがどちらの側がどちらかについて食い違う
ことは決してない。

`MonitorRenderer.setLayout('column')`はENEMY(enemy)のfieldを`y = FIELD_H + GAP`に置く点に
注意——すなわちenemyが下(BOTTOM)であり、spec (a)とは逆である。これは問題ない:それは小さい
monitor自身の選択であり、小さいmonitorには手を加えないからである。ここでこれを指摘しているのは、
後になって誰かがこれらを「調和させよう」として、2つのうち片方を黙って反転させてしまうことがない
ようにするためだけである。

### 7.2 正確なルール

```ts
/** The viewport aspect at which the row stage and the column stage fit EQUALLY well.
 * DERIVED, never hardcoded: it moves if EXP_GAP or the plane size moves (§7.3). */
export const ROW_COL_ASPECT_THRESHOLD = ROW_STAGE_W / COL_STAGE_H;   // 2112 / 1472 = 33/23 ≈ 1.43478

export function layoutFor(viewportW: number, viewportH: number): 'row' | 'column' {
  return viewportW / viewportH >= ROW_COL_ASPECT_THRESHOLD ? 'row' : 'column';
}
```

view rootに設置した`ResizeObserver`によって駆動される。`Monitor.tsx:139-147`が既に自身の900px
breakpointを駆動しているのと全く同じ方法である。`window.matchMedia('(orientation: landscape)')`
ではない——それはDEVICE(端末)の向きを報告するのであってelementのboxではなく、embedded/split-screen
のlayoutの中では誤りとなる。

### 7.3 文字通りに解釈したQ3裁定への訂正 — 算術付き

Q3裁定は「横長 → 横並び」と述べており、その素直なencodingは`W/H >= 1 ? 'row' : 'column'`である。
**これは実在するhardware上では算術的に誤りである。** 目分量ではなく、実際のstageサイズに対して
計算すると:

| viewport | aspect | fit-scale, row | fit-scale, column | 大きい方 | naive `a>=1` | 一致? |
|---|---|---|---|---|---|---|
| 1920x1080 | 1.778 | **0.9091** | 0.7337 | row | row | yes |
| 2560x1440 | 1.778 | **1.2121** | 0.9783 | row | row | yes |
| 1440x900 | 1.600 | **0.6818** | 0.6114 | row | row | yes |
| **1280x1024** | **1.250** | 0.6061 | **0.6957** | **column** | row | **NO** |
| 1080x1920 | 0.563 | 0.5114 | **1.0385** | column | column | yes |
| 820x1180 | 0.695 | 0.3883 | **0.7885** | column | column | yes |

**1280x1024**——SXGA、実在するありふれたpanel——では、naive(素朴)なruleは、stackedなら0.6957
になるところを、scale 0.6061で横並びを選んでしまう。これは、疑いようもなく「横長」である画面の
上で、**15%大きいbattlefieldを捨てている**ことになる。

この境界は正確であり、証明可能である。`a = W/H`とする。
- Rowがwidth-limited(幅で制限される)のは`W/2112 < H/720` ⟺ `a < 2.9333`のとき。
- Columnがwidth-limitedなのは`W/1040 < H/1472` ⟺ `a < 0.7065`のとき。
- `0.7065 <= a <= 2.9333`の範囲では——これは誰であれ使うことになるあらゆるviewportをcoverする——
  `S_row = W/2112`(width-limited)、`S_col = H/1472`(height-limited)となる。両者が等しくなるのは
  `W/2112 = H/1472` ⟺ `a = 2112/1472 = **33/23 ≈ 1.43478**`のときである。
- この帯の外側でも、単一の閾値はそのまま成り立つ:`a > 2.9333`では両方がheight-limited
  (`H/720`対`H/1472`)でありrowが常に勝つ;`a < 0.7065`では両方がwidth-limited(`W/2112`対
  `W/1040`)でありcolumnが常に勝つ。**閾値は1つだけであり、edge caseは存在しない。**

**したがって本REQは、Q3裁定を`a >= 1`としてではなく、INTENT(意図)として読む。** その意図——
battleができるだけ大きくなるよう、stageの形を画面の形に合わせる——を正確に実装しているのが
`a >= 33/23`であり、`a >= 1`はそれの損失を伴う近似にすぎない。stageがrow layoutにとって「十分に
横長」であることをやめる境目のaspectこそが、まさに`33/23`**である**。**ユーザーはこの読み方を
確認しなければならない**(Status blocker 3):これは意図に忠実であり、1280x1024において実証可能な
ほど優れているが、言葉そのものが述べていることではなく、aspectが1.2の横長画面はstackedになって
しまう——裁定を文字通りに読んだ者にとっては驚きかもしれない。

この閾値はDERIVED(導出されたもの)であり(`ROW_STAGE_W / COL_STAGE_H`)、`1.43478`と書き下される
ことは決してない。もし`EXP_GAP`が32から動けば、閾値もそれに伴って自動的に動く。ハードコードされた
1.43478は、誰かがgapを変更する日までは正しいが、その後は永遠に誤ったままとなり、それを知らせる
ものは何もない。

## 8. fit-scale(レターボックス) — viewportの変換

Neither stage fits 1080p: rowは幅2112(>1920)、columnは高さ1472(>1080)である。C5に
従い、LOGICAL(論理)サイズはCELL=40のまま保たれ、合成されたstageはviewportへと**uniformly
(一様に)**scaleされる。

```ts
export function fitStage(viewportW: number, viewportH: number, layout: 'row' | 'column') {
  const w = layout === 'row' ? ROW_STAGE_W : COL_STAGE_W;
  const h = layout === 'row' ? ROW_STAGE_H : COL_STAGE_H;
  const scale = Math.min(viewportW / w, viewportH / h);      // UNIFORM — one factor, both axes
  return { scale, x: (viewportW - w * scale) / 2, y: (viewportH - h * scale) / 2 };
}
```

`app.renderer.resize(viewportW, viewportH)` + `app.stage.scale.set(scale)` +
`app.stage.position.set(x, y)`として適用される。`<canvas>`に対するCSSの`transform: scale()`では
**ない**:CSSでのscalingはrenderされたbitmapを再サンプリングしてしまう(ぼやける上、
`getBoundingClientRect()`をbacking storeから非同期化してしまうが、これはまさに
`geom.ts:clientToLocal`のresolution/CSS-scale補正が修正するために存在しているものである)。
STAGE(stage)をscaleすることで、代わりにnative densityで再renderされる。

**`Math.min(scale, 1)`のclampはしない。** ここではupscalingは正当であり(2560x1440 → 1.212)、
かつ安全である:すべてのsymbol textureは64-units-per-cellのviewBoxに対して2倍でsupersampleされて
いるため(§REQ-0261 §5)、1x1のiconは1.212倍であっても128pxのtextureを48.5pxのcellに持ち込む。
clampしてしまうと、4K画面を理由なくletterboxしてしまうことになる。

**計算例、1920x1080、landscape**(これはブリーフ自身のC5の例であり、CORRECT(正しい)——検証
済みである):
```
a = 1920/1080 = 1.7778 >= 33/23  ->  row
stage = 2112 x 720
scale = min(1920/2112, 1080/720) = min(0.90909, 1.5) = 0.90909      (width-limited)
drawn = 1920.0 x 654.5     effective cell = 40 * 0.90909 = 36.36px
letterbox = 0 px left/right, (1080 - 654.5)/2 = 212.7 px top and bottom
```

**計算例、1080x1920、portrait:**
```
a = 1080/1920 = 0.5625 < 33/23  ->  column
stage = 1040 x 1472
scale = min(1080/1040, 1920/1472) = min(1.03846, 1.30435) = 1.03846  (width-limited)
drawn = 1080.0 x 1528.6    effective cell = 40 * 1.03846 = 41.54px   (UPSCALED — allowed)
letterbox = 0 px left/right, (1920 - 1528.6)/2 = 195.7 px top and bottom
```

**計算例、実在するphone(390x844 CSS px):** column、`scale = min(390/1040, 844/1472) = 0.375`、
実効cellサイズ**15.0px**。正直な帰結:15pxではcellはgeometryとしては判読できるが、その中のPO
iconは判読できない。本REQはこれを解決しない;これを既知の下限として記録し、phone固有の対応は
将来のREQに委ねる。15pxのcellでも、同じfieldを468pxのboxに表示する小さいmonitorの18pxのcellより
は、依然として明確に優れている——これはregressionではなく、単にphone UIではないというだけである。

**スクロールは決してしない。** stageは構造上、常に収まる:`fitStage`は収まるscaleを返し、
containerは`overflow: hidden`である。panもzoomもscrollbarも存在しない。C5に従う。

**Resolution。** `app.init({ …, resolution: window.devicePixelRatio, autoDensity: true })`。
既存のboardは`resolution`をPixiのdefaultのままにしている;`geom.ts:clientToLocal`は
`app.renderer.resolution`で割っており、これが既にこのcodebaseにおいて現に配慮されている事柄で
あることを証明している。expedition viewはfull-screenであるため、HiDPIのpanelはdevice密度で
renderしなければならない。さもなければ、3.2倍でsupersampleされたtextureの意義そのものが、最後の
段階で無駄になってしまう。

### 8.1 seamとしての`setLayout` — 検証済みだが、それでは不十分である

ブリーフ§3 C5は述べている:*"`MonitorRenderer.setLayout('row'|'column')` (REQ-0240) is the
existing seam for the flip."*(訳:`MonitorRenderer.setLayout('row'|'column')`(REQ-0240)が、
flipのための既存のseamである)。**「flipは解決済みの形であり、それをコピーせよ」という読み方
としては:TRUE(真)。「`MonitorRenderer`をCELL=40でreuseせよ」という読み方としては:FALSE(偽)
であり、これは正確を期す価値がある。**

`setLayout`(`MonitorRenderer.ts:207-218`)は正確に2つのことだけを行う——`enemyField`の
再配置と`app.renderer.resize(...)`——Applicationのteardownは行わない。このpatternは正しく、
本REQはこれをそのままコピーする。

しかし`MonitorRenderer`は**CELL=40でrenderすることができない**:`FIELD_CELL_PX = 18`は
**module定数**であり(`:30`)、`FIELD_W`/`FIELD_H`は**module load時に**そこから導出される
(`:32-33`)。`setLayout`自身も、これらのmodule定数へとresizeする。`FIELD_CELL_PX`はそのfile
1つの中で**21箇所**から参照されており(backdrop、grid、`parseBoxToPixelRect`、すべてのmarker、
flash、pulse、ray step)、さらに**export**もされていて、enemy-labelのfitting logicからも読まれる。
cellサイズをparameter化している箇所はどこにも存在しない。

それをparameter化すると、小さいmonitor内のすべてのdraw siteを編集することになる——これは
まさに「今ある画面は放置して」が禁じていることである。そこで:**expedition viewは自分自身の
renderer**(REQ-0261)を得ることになり、そのcellサイズは最初の行からconstructor parameterで
あり、classそのものではなく`setLayout`の*形*(再配置 + resize、決してre-initしない)をreuseする。

## 9. Pacing(ブリーフ§3 C4) — seam

### 9.1 裁定

> **C4** — `#/expedition` plays the sim clock 1:1 (realtime, tick-accurate). The pacing layer stays
> alive ONLY for the legacy small monitor on `#/schedule`. `pacingVersion` remains on the wire; the
> expedition view ignores `pt` and reads `t`. No deletion of `pacing.cjs` in this program.

(訳:`#/expedition`はsimクロックを1:1で(realtime、tick-accurateに)再生する。pacing層が生きたまま
残るのは`#/schedule`上のlegacyな小さいmonitorに対して**のみ**である。`pacingVersion`はwire上に
残り続ける;expedition viewは`pt`を無視し`t`を読む。本プログラムにおいて`pacing.cjs`の削除はない。)

REQ-0240の中で削除されるものやfeature-flag化されるものは何もない。`shared/pacing.json`、
`server/services/pacing.cjs`、`client/src/schedule/monitor/pacingClient.ts`、そして
`useRunPlayhead.ts`——その2500msの`liveLagTargetMs`、6000msの`catchupThresholdMs`、[45,300]sの
clamp、250ms/4-hitのcoalescing(`shared/pacing.json`、検証済み)を含めて——は、`#/schedule`に
変更なく提供され続ける。`#/expedition`は`useRunPlayhead`も`pacingClient`も一切importしない。

### 9.2 ブリーフへの訂正:C4はクライアントのみの変更では**ない**。pacingのgateはWIRE(通信経路)
上にある。

ブリーフはexpedition viewが「`pt`を無視し`t`を読む」と述べており、これはclient側の選択のように
読める。**そうではない。** sourceで検証すると:

```js
// server/services/runs.cjs:28-36  (REQ-0240 branch)
function visibleEvents(run) {
  const clock = runClock(run);
  return pacing.decorateVisible(run, clock.elapsedSecs);
}
// server/services/pacing.cjs:183-203
function decorateVisible(run, elapsedSecs) {
  …
  const visSecs = typeof ptv === 'number' ? ptv / 1000 : (…);
  if (visSecs > elapsedSecs) continue;      // <-- the gate. SERVER-SIDE.
  …
}
```

そして`server/routes/schedule.cjs:236`が`events: visible`をserveする。**serverは、`pt`がまだ
到達していないすべてのeventを保留する。** `pt`を無視して`t`を読むclientであっても、pacedな
cadence(歩調)で供給されることに変わりはない——それは単に、自分が読むことを許されたevent群から
`t`を読み取った状態で、座して待つだけになる。client側で`pt`を無視することは必要ではあるが、
十分にはほど遠い。

**seamを正確に言えば — query paramが1つとfieldが1つである:**

```
GET /api/schedule/rooms/:id/run?clock=sim
```

- デフォルト(`clock`が不在、または`clock=presentation`):**今日と完全にbyte-identical。**
  `pt`でgateし、`durationSecs` = presentation。既存のすべてのcaller、テスト、そして`#/schedule`
  monitor全体は、構造上まったく影響を受けない。
- `clock=sim`:`t`でgateする(`decorateVisible`には既にこの正確なbranchが存在する——これは
  `pacing.cjs:197-200`にある`pacingVersion 0`/legacyのpathであり、`ev.t`を読む
  `if (visSecs <= elapsedSecs) out.push(ev)`である)。加えて**`simDurationSecs`**を返す。

**`simDurationSecs`は、まさにこの理由のために既に存在している。** `server/services/runs.cjs:142`
は次のcommentとともに`simDurationSecs: computeDurationSecs(result.events)`を保存している:

> the LEGACY combat-time duration (max sim `t`) kept for consumers that must stay on **COMBAT TRUTH
> rather than presentation time** (seals' fair-benchmark clearTimeSecs). Presentation `durationSecs`
> above drives room occupancy / settle; this drives seal comparison.

(訳:LEGACY(旧来)のcombat-time duration(sim `t`の最大値)であり、**presentation時間ではなく
COMBAT TRUTH(戦闘の真実)**に留まらなければならないconsumer(sealのfair-benchmark clearTimeSecs)
のために保持されている。上記のpresentationの`durationSecs`はroom占有/settleを駆動し、これはseal
比較を駆動する。)

`server/services/seals.cjs:198`は既にこれをconsumeしている。これは単に**wire上に存在しない**
だけである——`ApiRunView`(`shared/dto.ts:493-517`)には`durationSecs`はあるが`simDurationSecs`は
ない。したがってserver側の変更全体は:1つのoptionalなquery paramを既存のbranchへrouteすることと、
1つの加算的なDTO fieldである。`pacing.cjs`に新しいlogicは一切加わらない。

**expedition viewは`ApiRunView.durationSecs`を使っては**ならない**。** これはpresentation
時間である(`runs.cjs:125-130`、そのまま引用すると:*"durationSecs is now the PRESENTATION duration
the player watches (pt-based) … The sim itself still resolves instantly"*(訳:durationSecsは今や、
playerが視聴するPRESENTATION(提示)時間である(ptベース)……simそのものは依然として即座にresolve
する))。これをsimの長さとして使うと、まさにC4が取り除こうとしているfactorの分だけbattleが
引き伸ばされてしまう。expeditionは`simDurationSecs`を読む;legacyなrun(`pacingVersion 0`)には
それが存在せず、その場合`durationSecs`は既にmax-`t`**そのもの**であり、それを使うのが正しい。

### 9.3 playhead

`client/src/expedition/useExpeditionClock.ts` — 新規であり、`useRunPlayhead`の意図的な縮小版
である:

```
simElapsedSecs = (Date.now() - Date.parse(run.startedAt)) / 1000        // LIVE: wall == sim, 1:1
releasedIdx    = count of events with ev.t <= simElapsedSecs            // reads `t`. never `pt`.
```

live lagはない。catch-upはない。coalescingはない。clampはない。`?clock=sim`の下での
`run.events`は既にserver側で`t`によってgateされているため、`releasedIdx`は第2のgateではなく、
poll間隔未満のinterpolationのためのsmoothing cursorである。poll駆動ではなくrAF駆動——REQ-0262の
毎秒25diagonal-stepsのray flightには連続的なclockが必要である(ブリーフ§6:*"interpolated smoothly
when the display allows (rAF, not a 25Hz gate)"*(訳:表示が許す限り滑らかにinterpolateされる
(25Hzのgateではなくrafで)))。

### 9.4 ブリーフが触れていない帰結 — **ユーザーの決定が必要**

REQ-0240は意図的に**room占有 = presentation時間**とした(`runs.cjs:126-127`:*"this IS the
battle wait increase — the room is occupied for as long as the paced replay lasts"*(訳:これこそが
battleのwait増加である——roomはpaced replayが続く間ずっと占有される))。そしてそれを**[45, 300]秒**
にclampしている(`shared/pacing.json`)。REQ-0240自身のdeviation 2は、*"generated content stretches
UP to the 45s floor"*(訳:生成されたcontentは45秒というfloorまで引き伸ばされる)と記録している——
すなわち、実際のsim runは通常**sim `t`にして45秒より短い**。

したがって、live(実働)のrunにおいては、2つのclockを両方とも満たすことはできない:

| | `#/schedule`(paced) | `#/expedition`(1:1 sim) |
|---|---|---|
| battleが終わるのは | `durationSecs`(wall時間で≥45秒) | `simDurationSecs`(wall時間でしばしば~10-30秒) |
| roomが解放されるのは | `startedAt + durationSecs` | —(roomはこのviewの関知するところではない) |

**全画面battleは終了し、その後roomはさらに15-35 wall秒の間busyなままである。** これは本仕様の
バグではない——2つの批准済み裁定が出会った結果としての算術である。両方ともユーザー自身のもので
ある:REQ-0240はユーザーのdirective #7(「スロー再生、可視化を優先」)に従って構築され、そして今、
C4/Q1はexpeditionがtick-accurateなrealtimeであるべきだと述べている。

選択肢は、ユーザーが選ぶべきものとして:

- **(A) PROVISIONALLY(暫定的に)採用 — 乖離を受け入れる。** `#/expedition`は、同じrunを別のclockで
  見る別のviewである。早く終わり、settleした結果を示し、「roomに戻る」を提供する。C4に最も忠実。
  コスト:同じlive runを表示する2つの画面が、何が起きたかについて食い違う——両方開くと、monitorが
  まだ向かっている途中のbossを、expeditionは既に倒していることになる。
- **(B) `pt`→`t`を反転させることで、expeditionをpacedなwall clockに固定する。** 2つのviewは同期
  したままになる。しかしこれはまさにpacingそのものであり、C4がその名指しで禁じているものであり、
  REQ-0257がphysicalにしたray flightを引き伸ばしてしまう——rayを自分自身のhitから非同期化して
  しまうが、これはまさにC4が防ごうとしている失敗そのものである。
- **(C) expedition時代のrunに対してpacingを完全に廃止する** — REQ-0256のtick simが導入され次第、
  `durationSecs = simDurationSecs`とし、room占有をcombat truthに委ねる。最もcleanな終着点であり、
  Q1が指し示しているのもおそらくここである。しかしこれはuser directive #7を黙って覆し、roomの
  経済性を変えてしまう(roomは≥45秒ではなく~20秒で解放されるようになる)ため、これ自体の裁定と
  これ自体のREQを必要とする。

**本REQは(A)を指定し、(B)や(C)を排除するようなものは何も実装しない**——clockは1つのhookと
1つのquery paramの裏に存在する。**ユーザーは実装開始前にこれを確認しなければならない。**

## 10. Transportコントロール

| state | `#/schedule`の現状(REQ-0240 M6) | `#/expedition` |
|---|---|---|
| LIVE | LIVE chip;`needsCatchup`のときはcatch-upボタン | **LIVE chipのみ。** play/pauseなし、speedなし、scrubなし。 |
| SETTLED | ▶/⏸、0.5/1/2/4×、skip-to-end、クリック可能なscrub | ▶/⏸、0.5/1/2/4×、skip-to-end、クリック可能なscrub — **SIMクロック上で** |

**Live:何もない。** 動かすべきplayheadが存在しない——viewそのものが1:1のsimクロックである。
liveなrunをscrubして先に進めるのはネタバレであり、後ろに戻すのはreplayである;どちらも定義上
「liveではない」。これはまた、小さいmonitorが既にliveで行っていることとまさに同じである
(`Monitor.tsx:340-346`:`settled ? … : …`というternaryはLIVE chip + catch-upのみをrenderする)。
**catch-upボタンも同様にない**——catch-upは、*paced*なrelease cursorより遅れてdriftしてしまった
clientのplayheadをre-syncするために存在する(`useRunPlayhead.ts:70-76`);1:1の下ではplayheadは
`Date.now() - startedAt`であり、これはintegrateされていないためdriftし得ない。backgroundに回った
tabは、reconcileすべきstateが何もないまま、wall clockが示す時点にちょうど再開する。

**Settled:そのすべてを保つ**、re-baseした上で。`clock.isSettled`になれば、`decorateVisible`は
gateに関係なく全logを返す(`elapsedSecs >= durationSecs >= every pt`)ため、**settled replayに
関しては、そもそもserver側の変更は一切不要である**——expeditionは今日時点で、配列全体から`t`を
読むことができる。`speed`はSIMクロックを乗算する:`playheadSecs += dt * speed`、
`releasedIdx = count(ev.t <= playheadSecs)`、scrubは`frac -> frac * simDurationSecs`にmapする。
同じcontrols、引き継がれる箇所では同じtestid、異なるclock。

**simクロック上での4×は、文字通り速い**——20秒のsim runが5秒でreplayされる。これは1:1が
もたらす正直な帰結であり、欠陥ではない;speed controlはまさにその名の通りのことを行っている
だけである。

### 10.3 States

| condition | render |
|---|---|
| `expeditionRoomId === null`(bareな`#/expedition`) | empty state + `#/schedule`へ戻るlink。クラッシュではない。 |
| room idがresolveしない / 404 / callerのroomではない | not-foundの文言を伴う同じempty state。空白のcanvasになることは決してない。 |
| roomはresolveするが、`room.lastRunId === null` | 「run待ち」——`Monitor.tsx:303-305`の既存の`schedule.monitor.awaitingRun`分岐をミラーする。 |
| runがresolveする | stage。 |

**exit(退出)のaffordanceは必須である**:railとheaderは隠されている(§4.3)ため、expeditionは
自分自身の退出手段(`#/schedule`へ戻る`←`)と`Escape`を持たなければならない。exitもrailもない
full-bleedな画面はtrapである。`LandingPage`が、full-bleedかつ自分自身のmenuを持つことの先例と
なっている。

## 11. MJÖLNIR skin — `web/redesign/styleguide.html` §6

### 11.1 Tokenとclass(引用せよ、創作するな)

すべて`client/src/theme/mjolnir.css:50-89`から(存在を検証済み):

| 用途 | token |
|---|---|
| letterboxの背後にあるstageのvoid | `--void: #0A0D12` |
| 平面backdrop / panel | `--panel: #131820`、`--raised: #1B222D`、`--border-lo: #28313E` |
| player平面のaccent | `--frost: #6FC4DE`(+ `--frost-hi`、`--frost-lo`、`--frost-glow`) |
| enemy平面のaccent | `--ember: #E25822` / `--blood: #B0413E`(+ `--ember-hi`、`--ember-glow`) |
| gold rim、formationの輪郭 | `--gold: #C9A959`、`--gold-hi: #EBD9A4`、`--gold-lo: #857038` |
| focus | `--focus-ring: 0 0 0 1px var(--gold), 0 0 8px rgba(201,169,89,.55)` |
| type | `--f-dj`(Shippori Mincho、`.dj`)、`--f-den`(Cinzel、`.den`)、`.t-micro`、`.tnum` |

frost/emberの分割はここで発明されたものではない:`MonitorRenderer.ts:180-181`(0240)は既に
`drawFieldBackdrop(this.playerField, 0x6fc4de)` / `(this.enemyField, 0xe06b5f)`を呼んでいる。
Chrome class(`.panel.ornate`、4つの`<i className="k tl|tr|br|bl"/>`というgold knot、`.chip`、
`.chip.is-live`)は`Monitor.tsx:308-309`からverbatim(そのまま)reuseされる。

### 11.2 §6.0 glowの規律 — binding(拘束力あり)

`styleguide.html:551-559`からの引用:

- **発光は4つの瞬間のみ** — ①focus (hover/selection) ②legendary+ manifestation ③a LIVE link beam
  ④**the instant of a hit**. Static text and idle panels do not glow.
- 外発光は **blur ≤ 8px** (at 1x) · one colour per element · panels get inner shadow only ·
  **≤ 3 simultaneous glow sources per screen**.
- Transitions **120–180ms ease-out**; hover response <100ms; press feedback immediate.
- Notifications: a **single message queue** — one at a time, never stacked.

(訳:①focus〔hover/selection〕②legendary+ manifestation③LIVEなlink beam④ヒットの瞬間、静的な
テキストとidleなpanelはglowしない。外発光はblur ≤ 8px〔1xにおいて〕・要素ごとに単一の色・panel
はinner shadowのみ・画面ごとに同時発光は3箇所まで。Transitionは120–180ms ease-out;hover反応は
100ms未満;press feedbackは即時。通知:単一のmessage queue——一度に1つ、決して積み重ねない。)

**本REQ(シェル)にとって効いてくるのは、許可の方ではなく上限の方である。** シェルはhitも
beamも描画しないため、シェル自身のglow budgetは**ゼロ**である:平面のbackdrop、padding ring、
grid、letterbox、そしてchromeはすべてidleなsurfaceであり、**glowしてはならない**。≤3の予算は
REQ-0262(hit flash)とREQ-0261(live link beam)によって使われる。ここでframeがglowしてしまうと、
装飾のために予算の3分の1を黙って食いつぶすことになる——これはまさに§6.0が禁じていることである。

**≤3という予算は、今日時点ではownerを持たないcross-REQのinvariant(不変条件)である。**
本REQはシェルをそのaccountant(会計担当)として指名する:expedition viewは、ray VFX、link beam、
focus ringのすべてが同時にliveになり得る唯一のsurfaceだからである。§14がこれをpinする。

### 11.3 2段構えのreduced-motionルール — そして参照実装はそれに**違反している**

`styleguide.html:737`(§6.6)、そのまま引用する:

> 動きを**二段構え**で退ける。①CSS共通の `@media (prefers-reduced-motion: reduce)` が全
> `animation`/`transition` を 0.001s に短絡(ui.css・mjolnir.css)。②粒子・視差・**戦闘再生**など
> **JS生成のもの**は `fx.js`/`particles.ts` が**生成自体を行わない**(rAFループを起動しない)。

Tier①は既にapp側に存在する:`client/src/theme/mjolnir.css:256-258`
(`@media (prefers-reduced-motion: reduce){ *, *::before, *::after{ animation-duration:.001s !important;
transition-duration:.001s !important; } }`)。expeditionのDOM chromeはこれを無料で継承する。

Tier②は本REQの責務であり、それは「loopを回してdrawingだけskipする」ということでは**ない**。
それは:**構築しない**ということである。その典拠は`client/src/a11y/motionPrefs.ts:116`の
`getReducedMotion()`である(REQ-0143——これは`navigator.webdriver`の下でreducedを強制ONにも
するため、e2eはbyte-identicalなまま保たれる)。生の`matchMedia`呼び出しでは**ない**。具体的には:
reduced motionの下ではexpeditionは**rAFループを一切起動しない**;stageはdataが変わるたびに1回
renderされ、clock hookはpoll cadenceにfallbackする。§6.6はtier②において**戦闘再生**を明示的に
名指ししている点に注意。それはまさにこの画面のことである。

> **§6.4の`RayMonitor`参照実装は、§6.0/§6.6の両方に違反している。この違反をportしてはならない。**
> `web/redesign/assets/fx.js`で検証済み:
> 1. **reduced-motionのguardがない。** `initParticles`(`:8`)、`countUp`(`:60`)、
>    `initParallax`(`:71`)はいずれも`if (REDUCED) …`で始まる。**`window.RayMonitor`(`:88`)には
>    それがなく**、無条件に(`:277`)`requestAnimationFrame(tick)`を実行する。styleguideがtier②
>    でカテゴリとして名指ししている唯一のJS effectが、それを実装していないものなのである。
> 2. **Glowのblurが§6.0の上限を超えている。** ray trailで`ctx.shadowBlur = 10`(`:209`)、ray head
>    で`14`(`:219`)、hit flashで`18`(`:238`)——**≤ 8px**という明記された上限に対して。
>    (Canvasの`shadowBlur`とCSSの`box-shadow`のblurはどちらも≈2σであるため、この比較は
>    like-for-like〔同種比較〕である;想定だけで済ませず実装時に確認すること。)
> 3. **そのgeometryへのapproachは、まさにC5が拒否しているものである。** `size()`(`:135-143`)は
>    viewportから`cell`を再計算する(`cell = Math.min((w-GAP-8)/(COLS*2), (h-26)/ROWS)`)——cell
>    サイズが*windowの関数*になってしまっている。C5はLOGICALなcellを40に固定し、STAGEの方をscale
>    する。`size()`をportすると「1/2」が無意味になってしまう。
>
> ブリーフは既に**「そのLOOK(見た目)をportせよ、コードをportするな」**(§6)と述べている——これは、
> その一文が何から守ろうとしているのかを示す具体的なリストである。見た目(bounce spark、hit flash、
> 5回目のbounceでのnova、trail)は批准済みであり、REQ-0262はそれを再現すべきである。blurの値は
> ≤8まで下げなければならず、rAFはreduced motionの下では起動してはならず、geometryはここ(§6/§8)
> から来る。
>
> **これらは批准済みの参照実装に対するfindingsであり、誰かが`fx.js`自体を修正すべきである**——
> これはstyleguideがliveでrenderしているmockであるため、今日時点ではstyleguideは、2セクション
> 下でルールを破りながら同じルールを実演していることになる。ここではscope外である
> (`web/redesign/`はmockでありappではない)ため、4度目の再発見が起きないよう記録しておく。

## 12. ブリーフへの訂正

| brief | 実際 | evidence |
|---|---|---|
| §6:boardは「`geom.ts`(CELL=80、**PAD=38**)」であり、taskのframingはPADが19に半減すると述べている | **expedition平面にPADは存在しない。** ブリーフ自身のC5の算術(1040x720 = 26*40 x 18*40)にPAD項はない;PADはBackpacks boardのchrome marginであり、padding-1のRINGがこの平面のmarginである。§6.1 |
| taskのframing:「`geom.ts` CELL=80->40」 | `geom.ts`を編集すると**稼働中のBackpacks boardが半分になってしまう**。新しいmodule、新しい定数、pinされた関係。§6.2 |
| §3 C5:「`setLayout`がflipのための既存のseamである」 | flipの**形**については真;reuseとしては偽——`FIELD_CELL_PX=18`は21箇所にあるmodule定数であり、`setLayout`はそこへとresizeする。§8.1 |
| §3 C4:「expedition viewは`pt`を無視し`t`を読む」 | **クライアントのみの話ではない。** gateはwire上でサーバー側にある(`decorateVisible`)。`?clock=sim`が必要。§9.2 |
| §3 C4(無言) | `ApiRunView.durationSecs`はPRESENTATION時間である;sim時間は`run.simDurationSecs`として存在するが、**wire上にはない**。§9.2 |
| §3 C4(無言) | 1:1のsim再生は、battleを**roomが解放されるより前に終わらせてしまう**。未解決のproduct上の分岐点。§9.4 |
| §0 Q3の文言通り(「横長 → 横並び」) | 1280x1024においてbattlefieldの15%分誤っている。正確な閾値は33/23 ≈ 1.435であり、導出されたものである。§7.3 |
| §6:「§6.4の`RayMonitor`……が批准済みの参照実装である」 | その通りである——そして**reduced-motionのguardがなく**、≤8の上限に対して**blur 10/14/18**を使っている。§11.3 |
| §6:route `#/expedition`;mockの`expedition.html`はSCHEDULEのredesignである | **確認済み。** `web/redesign/expedition.html`は遠征の間(room + 小さいmonitor)である。コード上の衝突はなく、route名はユーザー自身のものである。 |
| §3 C5:「1920x1080では……scale ~0.909 -> 実効cell ~36.4px」 | **正確に確認済み**——0.90909、36.36px。 |

## 13. Scope

**含むもの:**
1. `client/src/store/core.ts` — `Route`のunion + `VALID_ROUTES`の両方に`'expedition'`が加わる;
   `EXPEDITION_HASH_RE`;`StoreSnapshot.expeditionRoomId`;snapshotのseed。
2. `client/src/store/routing.ts` — 両方のladder(`initRouting`、`onHashChange`)内のregex、
   specificをgenericより先に;`clearExpeditionRoomId()`(route-exit時、one-shotではない——§3.2)。
3. `client/src/App.tsx` — `fullBleed`(旧`onLanding`);latchされ、決してunmountされない
   `.expedition-view`;`ExpeditionPage`。
4. `client/src/expedition/` — 新規:`ExpeditionPage.tsx`(shell、chrome、exit、empty state)、
   `expeditionGeom.ts`(§6、§7.2、§8)、`useExpeditionClock.ts`(§9.3)、`ExpeditionStage.tsx`
   (canvas host + `ResizeObserver` + fit-scale;**空の平面を2枚描画するのみ**——中身は0261)。
5. `client/src/schedule/monitor/MonitorHeader.tsx` — optionalなprop`fullscreenHref`を1つ、
   `.mon-header-return`と`.mon-header-menu-wrap`の間にanchorを1つ。`Monitor.tsx` — prop pass1つ。
6. `client/src/styles/expedition.css` — 新規。`client/src/i18n.ts` — `schedule.monitor.fullscreen`、
   `expedition.*`。
7. **Server:** `server/routes/schedule.cjs` — `?clock=sim`は`decorateVisible`の既存の`t`分岐へ
   routeする;`simDurationSecs`をrun viewに追加。`shared/dto.ts` —
   `ApiRunView.simDurationSecs?: number`。どちらも厳密にadditiveであり、デフォルトのresponseは
   byte-identicalなまま保たれる。

**含まないもの:**
- **平面の内側に描画されるものすべて** — squad、ring、instance、ray、HP、cooldown:
  REQ-0261/0262/0263。
- **小さいmonitorの挙動へのあらゆる変更** — 「今ある画面は放置して」。
- **REQ-0240のpacingコードの削除/flag化。** C4はそれが残ると述べている。
- **`Route`から`VALID_ROUTES`を導出すること。** 記録済み(§3.1)、pin済み(§14)だが、ここでは
  修正しない。
- **`web/redesign/assets/fx.js`の修正。** §11.3がこれを記録している;これはmockでありappでは
  ない。
- **§9.4の解決。** ユーザーの決定事項。

## 14. Gates

**E2Eポート(規則:`5000 + REQ*10 + index`):`7600` static / `7601` api / `7602` proxy。** 番号
付け規則によって予約され、`tools/check_e2e_ports.cjs`(ciのstep `[0/8]`)によって強制される。
**Q2裁定(「e2eを通す必要はない」)により、E2Eは本プログラムのgateでは**ない**ため、harnessは
構築せず、この decade(10番台)は未使用のまま残す**——REQ-0258 §10が7580/7581/7582について取って
いるのと同じ姿勢である。

適用されるunit/typecheckのgate:

1. **`VALID_ROUTES` ≡ `Route`** — union memberのすべてがarrayに存在し、かつその逆も成り立つ
   ことをassertするtest(`satisfies`ベース、または`const`タプル + `typeof T[number]`によるpin)。
   §3.1を完全にcloseする。今日のコードであればpassし、半端に追加されたrouteがあればfailする。
2. **`EXP_CELL === CELL / 2`** — `board/geom.ts`と`expedition/expeditionGeom.ts`の両方をimport
   する。spec (d)の「1/2」を機械的にcheckされる関係としてpinする(§6.2)。
3. **`ROW_COL_ASPECT_THRESHOLD`がderivedであること** — `layoutFor`が1920x1080で`'row'`を、
   1280x1024と1080x1920で`'column'`を返すこと、そして閾値がliteralではなく
   `ROW_STAGE_W / COL_STAGE_H`に等しいことをassertする(§7.3)。
4. **`fitStage`の算術** — §8の2つの計算例を、小数点以下5桁まで。
5. **Deep-linkの順序** — `routeFromHash('#/expedition/room_abc')`が`'backpacks'`を返すこと
   (fallbackがhazardであることの証明)AND そのhashで`initRouting()`が
   `{route:'expedition', expeditionRoomId:'room_abc'}`を出すこと(regexが勝つことの証明)。
6. **Server:** `clock`パラメータなしのrun viewは以前とbyte-identicalであること(additiveな
   fieldを除いた変更前の形とdeep-equal);`?clock=sim`付きでは`t`でgateし、`simDurationSecs`を
   運ぶこと。
7. **`pnpm exec tsc --noEmit`** + lint。`server/tests/api/schedule.cjs`がgreenであること
   (`:475`でrun doc上に`simDurationSecs`が存在することをassertしている)。

## 15. 受け入れ基準

1. `#/expedition/<roomId>`は、cold loadから、AND `hashchange`から、`route === 'expedition'`
   かつ`expeditionRoomId === '<roomId>'`に解決される;bareな`#/expedition`はnullなidで解決され、
   クラッシュではなくempty stateをrenderする。
2. `core.ts`内の両方のlistが`'expedition'`を持ち、どちらかがrevertされるとgate 14.1がfailする。
3. 全画面ボタンがREQ-0240のmonitor headerに、return clockと⋯メニューの間に現れ、
   `#/expedition/<room.id>`へnavigateする。`fullscreenHref`が不在の場合、`MonitorHeader`の
   出力はREQ-0240のものとbyte-identicalである。
4. expedition→backpacks→expeditionを**20回**navigateしても、両方のboardは操作可能なままであり、
   expeditionのstageはliveなままである;expeditionの`Application`は**正確に1回だけ**構築される
   (目視ではなく構築counterでassertする)、そしてroute切り替えで`destroy()`が呼ばれることは
   決してない。
5. 1920x1080ではstageは`row`、scale 0.90909、cell 36.36px、letterboxは上下212.7pxである。
   1080x1920では`column`、scale 1.03846、cell 41.54pxである。**1280x1024では`column`である**
   (§7.3)。
6. 390x844から3840x2160までのどのviewportにおいてもscrollbarは現れない;stageは常に収まる。
7. `#/expedition`は`useRunPlayhead`も`pacingClient`も一切importしない(import-graph/grepテスト
   でassertする)、そして`ev.pt`を決して読まない。`#/schedule`は引き続き両方を行い、無変更である。
8. `?clock=sim`なしのrun viewは、既存のすべてのconsumerにとって無変更である。
9. `#/expedition`ではrailとheaderが隠される;back用のaffordanceと`Escape`のどちらも
   `#/schedule`へ戻る。
10. `getReducedMotion() === true`の下では、expeditionは**rAFループを一切起動しない**(loopが
    何も描画しないことではなく、構築されていないことをassertする)。
11. シェルはglow sourceを**ゼロ**個描画する(§11.2)。
12. ユーザーが§9.4、§9.2のサーバー側seam、および§7.3の閾値について裁定を下している。
