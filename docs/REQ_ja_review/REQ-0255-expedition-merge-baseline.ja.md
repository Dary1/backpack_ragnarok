# REQ-0255 — expedition-merge-baseline: expeditionプログラムのための単一ベースライン

**ステータス:** draft — 仕様は書き上げ済み、ユーザーレビュー待ちでBLOCKED。ユーザーが承認するまで、
本REQの内容は一切実行してはならない。マージ自体はユーザーの承認済みだが(§2参照)、本REQのレビュー
ゲートは、ランブックを実行してよいというゴーサインとは別物である。
**予約日:** 2026-07-18
**スラッグ:** expedition-merge-baseline
**ブランチ:** req-expedition-spec(仕様のみ。マージのランブックは`master`上で実行される)
**依頼者:** user、2026-07-18 — Q2裁定(§2参照)。
**依存先:** なし。expeditionプログラムのROOT(起点)である。
**ブロック対象:** REQ-0256(battle-tick-core)、REQ-0258(formation-map-padding)、REQ-0260
(expedition-fullscreen-route) — 下流の全REQはマージ後のベースラインから分岐する。
**元ブリーフ:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §5。

## 1. ゴール

影響を受ける、実装済みだが未マージの4ブランチを`master`にマージし、expeditionプログラム
(REQ-0255..0265)が分岐元とする単一のベースラインを持つようにする。11個のREQがそれぞれ4本の
未マージツリーをまたいでリベースする、という状態を解消する。

## 2. これを承認する裁定

`master`および本番サービスの`backpack-api` / `backpack-web` / `backpack-tunnel`は、PROJECT.mdにより
("編集・マージ・再起動の前には必ず調整すること")、ユーザーからの明示的かつ最新のゴーサインなしには
HANDS-OFF(手を触れてはならない)と定められている。ユーザーは2026-07-18、Q2裁定において、その
ゴーサインを次の通り出した(原文まま):

> 影響があるモノを全てマージして、それをmasterとして新規。e2eを通す必要はない。

これは**マージ**を承認するものであり、**デプロイ**を承認するものではない — §8参照。

## 3. 実測した系譜(2026-07-18に検証、ブリーフからの転記ではない)

以下の数値はすべて`git rev-list` / `git merge-base`で実測したものであり、転記ではない。

- **masterの先端 = `f918a65`**("docs: REQ-0223a+b built -> done (merged 8e77828, deployed,
  live-verified)"、2026-07-17)。ブリーフの内容をCONFIRM(確認)する。
- **4ブランチはすべてmasterとの間で単一のmerge-base `cc575e2`を共有する**("docs: REQ-0234 built ->
  done")。4ブランチとも、masterより**79コミット遅れている**。ブリーフはこれに触れていないが、重要な
  点である。なぜなら、以下のマージはすべて、masterの79コミット分のドリフトをまたぐ本物の3-wayマージ
  であり、fast-forwardではないからだ。

| branch | tip | masterに対して先行 | 含むもの |
|---|---|---|---|
| `req-0211-gimic-content-kind` | `e4c4666` | **+10** | — |
| `req-0185-dungeon-content-kind` | `b591420` | **+19** | 0211のすべて(`--is-ancestor` = true) |
| `req-0239-sortie-squad-board` | `5848c9d` | **+24** | 0211、および0185の**`ce78af5`まで** |
| `req-0240-monitor-redesign-pacing` | `d691325` | **+24** | 0211、および0185の**`ce78af5`まで** |

**4ブランチの和集合 = 31個の異なるコミット**(`git rev-list master..A master..B master..C
master..D | sort -u | wc -l` = 31)。

### 3.1 ブリーフへの訂正 — この件数はNESTED(入れ子)であり、加算ではない

ブリーフ§5は「(+10)」「(+19)」「(+24)」「(+24)」を、あたかも4つの独立した貢献であるかのように
列挙している。しかし実際はそうではない:

- `req-0211`は`req-0185`のANCESTOR(祖先)である(`git merge-base --is-ancestor` = true)。0185の+19は
  0211の+10を**含んでおり**、0185自身が単独で追加するのは**9コミットのみ**である。
- 0239の+24 = 0185の`ce78af5`まで(18) + **自身の6コミット**。0240の+24 = 同じ18 + **自身の6コミット**。
- したがってマージ後は10 + 9 + 6 + 6 = **31**となり、これは実測した和集合と完全に一致する。0185単体を
  マージするだけでも0211は既に引き込まれる。0211を明示的に先にマージするステップは、履歴を読みやすく
  するためであり、0185に欠けている何かを補うためではない。

### 3.2 ブリーフへの訂正 — `ce78af5`に関する注意点は0240だけでなく0239にも当てはまる

ブリーフはこれを0240についてのみ指摘している:

> `req-0240` … contains 0185's built state as of `ce78af5` but the `req-0185` BRANCH has since
> advanced, so 0185 must be merged EXPLICITLY, not assumed.

(訳:`req-0240`…は0185の`ce78af5`時点でのbuilt状態を含むが、`req-0185`ブランチはその後も進んでいる
ため、0185は前提とせず明示的にマージしなければならない。)

そして0239については、この注意点なしに単に「0185+0211のbuiltを含む」とだけ記している。**実測する
と、この注意点は両者に等しく当てはまる:**

```
git merge-base --is-ancestor req-0185-dungeon-content-kind req-0239-sortie-squad-board     -> NO
git merge-base --is-ancestor req-0185-dungeon-content-kind req-0240-monitor-redesign-pacing -> NO
git merge-base --is-ancestor ce78af5 req-0239-sortie-squad-board                            -> YES
git merge-base --is-ancestor ce78af5 req-0240-monitor-redesign-pacing                       -> YES
```

0239にも0240にも含まれていない0185の唯一のコミットは**`b591420`**――「REQ-0185: correct stale REQ
metadata + record post-reboot re-verification」であり、ファイル1つ(`docs/REQ/built/REQ-0185-dungeon
-content-kind.md`、+49/-4)のみを変更するdocs限定のコミットである。コードではないが、"actively misled
the PROJECT.md recovery read"(PROJECT.mdの障害復旧手順の読解を実際に誤らせていた)REQヘッダーを修正
するコミットである。これは必ず取り込まれなければならない。ブリーフが0185の明示的マージが必要と述べ
ている点は正しいが、どのブランチに警告が必要かについては誤っている。

### 3.3 使い捨てブランチについての注記

タスクブリーフは、既存の`tmp-mergetest`ブランチを前例として参照していた。**そのようなブランチは存在
しない。** リポジトリ内に存在する唯一のtmpブランチは`tmp-r215-e2e-on-0217`(先端`4e9bad9`、REQ-0215の
e2eマージ)であり、これは読み取り専用で調査されただけで、手つかずのまま残されている。§5のコンフリク
ト証跡は、`master`から新規に切った`tmp-expedition-mergetest`worktree(`/tmp/bp_mergetest`)上で作成
されたものであり、このworktreeとブランチはその後どちらも破棄した(`git worktree remove --force` +
`git branch -D`)。`master`は書き込み用にcheckoutされたことは一度もなく、今も`f918a65`のままである。

## 4. マージ順序と各ブランチの内容

順序: **0211 -> 0185 -> 0239 -> 0240**。これは系譜に従ったものである。0211は他の3つすべてに含まれる。
0185は(`ce78af5`まで)0239と0240に含まれる。0239と0240は兄弟関係にあり(それぞれ6コミットずつで、
どちらも他方のancestorではない — `git rev-list --left-right --count` = 6 / 6)。

| # | branch | 含む内容 |
|---|---|---|
| 1 | `req-0211-gimic-content-kind` | `gimic`のcontent kind + art kindを追加。レガシーのtrap / treasure / hidden-doorエンティティを`entities.json`から`gimics.json`へ移行(git RENAME、類似度55%)。migration 020/021を追加。art kind `gimic`のサイズ扱いは`monster`と同じ。 |
| 2 | `req-0185-dungeon-content-kind` | 事前生成コンテンツとしてのdungeon(`dungeon/1` kind):roller、validator、authored defs、registry統合、配信先の切り替え(serving repoint)、クライアント側の配線(dungeon DEFピッカー、dungeonId単位のforecast、contentadmin)。migration 022を追加。 |
| 3 | `req-0239-sortie-squad-board` | SORTIEページ(`#/sortie`)+ `#/schedule`上のSQUAD STATUS BOARD、atomicな`/sorties`、rooms `lastRun`、sortieのdeferred-cancelデフォルト。旧create-room-form e2eフローを廃止。 |
| 4 | `req-0240-monitor-redesign-pacing` | 現行のBattle Monitor(6ゾーンレイアウト)+ サーバー側のpresentation-pacing層(`pt`/coalesce/clamp)、`ApiRunView`のroster + `pacingVersion`。これはexpeditionの全画面ボタンが乗る先のmonitorである(REQ-0260)。 |

## 5. コンフリクト — 実測であり、予測ではない

`master`から切った`tmp-expedition-mergetest`上で実際に4回のマージを実行し(`--no-ff --no-edit`)、
各ステップで`git diff --name-only --diff-filter=U`を記録して得たものである。

| # | マージ | exit | コンフリクト |
|---|---|---|---|
| 1 | `master` <- 0211 | **0** | **NONE(なし)。**クリーン。 |
| 2 | +0185 | 1 | **13ファイル — すべてコミット済みの`web/app`バンドル。**ソースのコンフリクトはZERO(ゼロ)。 |
| 3 | +0239 | **0** | **NONE(なし)。**クリーン。 |
| 4 | +0240 | 1 | **SOURCEファイル2件** + バンドルファイル10件。 |

### 5.1 マージ2(0185):ビルド済みバンドルのみの衝突

検証済み:`git diff --name-only --diff-filter=U | grep -v "^web/app/"`の出力は**何もなし**。すべての
コンフリクトは、両側がそれぞれリビルドしたVite content-hashed出力である:

```
CONFLICT (rename/rename): web/app/assets/browserAll-Fc3VWJAB.js -> browserAll-DmkOHUUB.js (HEAD)
                                                                -> browserAll-B1lRUI7q.js (0185)
CONFLICT (rename/rename): web/app/assets/index-CsxwC_kA.css / index-DRqz3ZN3.js / init-Tu0j7bJL.js  (same shape)
CONFLICT (content):       web/app/index.html   (the script/link tags naming those hashes)
```

`shared/content_validate.cjs`と`tools/ci.sh`は**自動マージがクリーンに完了した** — 0185の実体である
ソースコードはmasterと衝突しない。

### 5.2 マージ4(0240):本物のソースコンフリクトはこの2件のみ

**`client/src/api.ts` — コンフリクト1件、両側とも純粋な追加のみ。** `export type { … } from
'../../shared/dto'`という長い1行のre-export文。0239は`ApiRoomLastRun`、`ApiSortieBody`を追加し、0240
は`ApiRunRoster`、`ApiRunRosterSlot`、`ApiRunRosterEnemy`を追加した。**解決方法:UNION(和集合)。**
これは推測ではなく、証明可能な形で安全である:`shared/dto.ts`自体はコンフリクト**ゼロ**でマージされ、
マージ後のファイルは5つの型宣言すべてを保持している。HEAD側の行を採用し、`ApiRunView,`の後にroster
関連の3つの型を挿入する:

```
… ApiRoom, ApiRoomLastRun, ApiCreateRoomBody, ApiSortieBody, ApiRunEvent, ApiRunView,
  ApiRunRoster, ApiRunRosterSlot, ApiRunRosterEnemy, ApiSealMeta, …
```

`pnpm build`(`tsc -b`)がこの解決方法の正しさを証明する。型の取りこぼしはコンパイルエラーになるので
あり、サイレントなバグにはならない。

**`client/e2e/schedule.spec.ts` — 絡み合ったコンフリクト2件。単純なUNIONで解決してはならない。**

両ブランチとも`test.describe`ブロックをEOF(ファイル末尾、どちらもbase行1535)に追加しており、gitの
diffは2つのブロックの**間**に、見せかけの共通Playwright定型コード(`await page.goto('/app/#/invite/
…')`、`.nav-link Schedule`)を整列させてしまい、その結果、各side(側)の内容が両方のコンフリクト領域
にまたがって分断されている。コンフリクトマーカーを単純に削除すると、無関係な2つのdescribeが互い違い
に混ざり、ファイルの構造が崩れる。

どちらのsideも単純な追記ではない(merge base `ce78af5`との比較で実測):

- 0239側:**+93 / -165** — base行139 / 181 / 289にまたがるhunkでcreate-room-formのテスト(sortieフロ
  ーにより廃止済み)を削除し、EOFに93行を追加している。
- 0240側:**+106 / -52** — 433 / 1080 / 1247 / 1294 / 1328 / 1344 / 1360 / 1408のhunkにまたがって
  monitorのテストをその場で書き換え(6ゾーンレイアウト)、EOFに72行を追加している。

これらのin-place編集はすべて**自動マージされる**。衝突するのはEOFへの追記部分のみである。正しい解決
方法は、自動マージされたprefix(先頭部分)をそのまま残し、追記された2つのブロックをまるごと連結する
ことである。0239を先にする:

```
prefix = working-tree lines 1 .. (first "<<<<<<<" - 1)      # all auto-merged content
b239   = the "+" lines of the LAST hunk of: git diff <base> HEAD           -- 93 lines
b240   = the "+" lines of the LAST hunk of: git diff <base> req-0240-...   -- 72 lines
result = prefix + b239 + b240 + (lines after the last ">>>>>>>")
```

適用前に検証:各ブロックはそれぞれ単体で完結した`test.describe`であり(`REQ-0239: sortie page + squad
status board` / `REQ-0240: monitor six zones, feed filters, ro…`)、波括弧・丸括弧のバランスは
**(0, 0)**。適用後:**コンフリクトマーカーは0件**となり、2つのテストスイートは独立したdescribeとして
並存する。

### 5.3 バンドルのルール:リビルドせよ、絶対に手でマージするな

`web/app/`はコミットされたBUILD OUTPUT(ビルド成果物)である。ファイル名はcontent hashなので、`pnpm
build`を実行した2つのブランチは構造上必ず衝突し、その衝突自体には何の情報もない。絶対に手でマージし
てはならない。片側をまるごと採用してインデックスをクリアし、その後**マージ済みソースからリビルド**
してコミットする — 前例は0185自身の`b8182b3`("rebuild web/app from merged source (post-0217 rebase;
stale bundle dropped from client-wiring commit)")である。

```
rm -rf web/app && git checkout <branch> -- web/app && git add -A web/app   # clear the conflict
# ... after ALL four merges land:
cd client && pnpm install --frozen-lockfile && pnpm build                  # tsc -b && vite build
git add -A web/app && git commit -m "expedition baseline: rebuild web/app from merged source"
```

出荷するバンドルは、最後にマージされたブランチのものを引き継ぐのではなく、FINAL(最終)なマージ済み
ソースからビルドしたものでなければならない。マージ4の時点では0240のバンドルがツリーに残っているが、
0239のソースも存在するようになった時点でそれは既にstale(陳腐化)している。このリビルドは省略可能な
事務作業ではない — `web/app`は`backpack-web`が配信するdocroot(ドキュメントルート)である。

## 6. ランブック

MAIN checkout(`~/backpack_ragnarok`)の`master`上で実行する — masterへのマージが行える唯一の場所で
あり、HANDS-OFF territory(手を触れてはならない領域)である。最新のゴーサイン(§2)なしに開始しては
ならない。サービスの再起動は行わない。マージはデプロイを意味しない。

```
cd ~/backpack_ragnarok
git status --porcelain          # MUST be empty before starting
git log -1 --format=%H          # MUST be f918a65... ; if master moved, RE-MEASURE §3 first
git branch backup/master-pre-expedition-baseline master    # cheap, reversible undo point

git merge --no-ff req-0211-gimic-content-kind       # expect: CLEAN
git merge --no-ff req-0185-dungeon-content-kind     # expect: 13 bundle conflicts -> §5.3
git merge --no-ff req-0239-sortie-squad-board       # expect: CLEAN
git merge --no-ff req-0240-monitor-redesign-pacing  # expect: api.ts + schedule.spec.ts -> §5.2, bundle -> §5.3

cd client && pnpm install --frozen-lockfile && pnpm build && cd ..
git add -A web/app && git commit -m "expedition baseline: rebuild web/app from merged source"
```

`--no-ff`は意図的である:4つの名前付きマージコミットにより、ベースラインをブランチ単位でbisect(二分
探索)可能にする。マージが失敗した場合は`git merge --abort`、実行全体が失敗した場合は`git reset --hard
backup/master-pre-expedition-baseline`を使う。

## 7. ゲート — E2Eはゲートに含まれない

**Q2ははっきりと述べている:「e2eを通す必要はない」 — e2eはこのプログラムのゲートではない。** これを
理由にベースラインをブロックしてはならない。これはユーザーによる意図的なトレードオフである:sortie
フロー(0239)とmonitor(0240)はどちらも`schedule.spec.ts`の大部分を書き換えており、しかもREQ-0256/
0257がどのみち全ゴールデンをrebaseline(再基準化)しようとしている。今すぐ動くベースラインに対して
e2eスイートをグリーンにするコストを払うのは無駄である。

代わりにチェックされるのは以下である — これらはすべて、コンフリクトテストの際に完全にマージされた
ツリーに対して実際にRUN(実行)されたものであり、期待値は願望ではなく実測値である:

| ゲート | コマンド | マージ後ツリーでの実測値 |
|---|---|---|
| simユニットテスト | `CONTENT_ROOT=$PWD/content node sim/tests/run.cjs` | **117 passed, 0 failed** |
| simリプレイgoldens | `node sim/tests/goldens.cjs`(**CONTENT_ROOTなし** — §7.1) | `goldens OK (12 cases, replay determinism intact)` |
| forecast parity | `CONTENT_ROOT=$PWD/content node sim/tests/forecast_parity.cjs` | **18 passed, 0 failed** |
| clientの型チェック + ビルド | `cd client && pnpm build`(`tsc -b && vite build`) | green — これが§5.2の`api.ts`のUNION(和集合)の正しさを証明する |
| lint | `cd client && pnpm lint`(`oxlint`) | green |

### 7.1 CONTENT_ROOTの罠 — ゲートの結果を信じる前にこれを読むこと

`server/lib/content_files.cjs:19`と`sim/dungen.cjs:63`は、テスト対象のツリーではなく、**`os.homedir()`
**にcontentを固定している:

```
const CONTENT_ROOT = process.env.CONTENT_ROOT || path.join(os.homedir(), 'backpack_ragnarok', 'content');
```

`content_files.cjs`自身のヘッダーには、なぜこれが危険なのか(REQ-0145a)が記録されている:"a
worktree-launched server read the MAIN checkout's content, never its own tree's."(worktreeから起動
したサーバーは、自分自身のツリーではなく常にMAIN checkoutのcontentを読んでしまう)。**`tools/ci.sh`は
`CONTENT_ROOT`を一切設定しない。** このマージに対する影響は、どちらもMEASURED(実測)している:

- `CONTENT_ROOT`なしでworktreeから`sim/tests/run.cjs`を実行すると、**13件のFAIL**になる。すべて
  `ENOENT … /home/qtie/backpack_ragnarok/content/live/dungeon/gimics.json`(と`dungeons.json`)であ
  り、これはテストがMASTERのcontentを読んでいるためである。MASTERには、このREQのマージが着地するまで
  どちらのファイルも存在しない。この失敗はharness(テスト実行基盤)側のアーティファクトであり、マージ
  そのものの問題ではない。`CONTENT_ROOT=$PWD/content`を指定すれば、同じツリーで**117/0のgreen**にな
  る。
- 逆に、`sim/tests/goldens.cjs`には`CONTENT_ROOT`を**渡してはならない**。このテストは`os.homedir()`
  をfixture用のhomeにremapすることで、自身のbatch-002 rosterを固定している。`CONTENT_ROOT`を設定す
  ると、`liveDungeonDir()`内の`process.env`分岐が使われてこの固定が回避され、実際のcorpus(コーパス)
  に対して実行されることになり、`Error: compileEnemyPack: missing enemy def ghost`で落ちる。実測済
  み。

つまりこの2つのゲートは、互いに正反対の起動方法を要求する。マージがmaster上に乗ってしまえば、この
違いは意味を持たなくなる(main checkout自体がそのツリーになるため)。だからこそ、誠実な検証順序は
「masterでマージしてから、そこでゲートを実行する」である。worktree上でのドライランを行う場合は、上
記の使い分けを守らなければ、存在しない失敗を報告したり、実際にある失敗を隠したりすることになる。

## 8. デプロイは本REQの範囲外であり、マージはデプロイを引き起こさない

REQ-0211とREQ-0185はそれぞれDB ENUMのmigrationと、本番registryのbackfillを伴う。**マージはこれらを
実行しない。** これらはデプロイ手順であり、両REQが既に記録している通り("NOT run (deploy steps …):
… the live migration … + live backfill")、ユーザーによって別途ゲートされる。デプロイが誰かを驚かせ
ることのないよう、ここに一覧化する — 両ブランチ上のREQファイルを読んで判明したものである:

| REQ | migration | 内容 |
|---|---|---|
| 0211 | `server/migrations/020_content_kind_gimic.sql` | `ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'gimic';` |
| 0211 | `server/migrations/021_artwork_kind_gimic.sql` | `ALTER TYPE artwork_kind ADD VALUE IF NOT EXISTS 'gimic';` |
| 0185 | `server/migrations/022_content_kind_dungeon.sql` | `ALTER TYPE content_kind ADD VALUE IF NOT EXISTS 'dungeon';` |

3つとも冪等(idempotent、`ADD VALUE IF NOT EXISTS`)であり、単独のトップレベル文である(`ALTER TYPE
… ADD VALUE`はトランザクションブロック内では実行できない)。各ファイルのヘッダーに従い、postgresの
superuserとして適用する:`docker exec -i supabase-db psql -U postgres < server/migrations/0NN_*.sql`。

Backfill(`tools/backfill_content_registry.cjs`、新規ソースは`gimic <- gimics.json`と`dungeon <-
dungeons.json`):REQ-0211は**`gimic` = 4**レコード(すべてPASS、すべて採用)と記録し、REQ-0185は
**`dungeon` = 3**(採用)と記録している。

Migration-first(先にmigrationを当てる順序)は本番デプロイにおいて安全である(旧コードは`gimic`/
`dungeon`を決して出力せず、新コードは出力する)が、それを主張するのはDEPLOY REQの役目であり、本REQ
の役目ではない。本REQはマージコミットで完結する。

**Migration番号の衝突について、フラグを立てる。** マージ1の後、ツリーには**2つの`020_`migration**
が存在することになる:`020_content_kind_gimic.sql`(REQ-0211)と`020_render_variant.sql`(`cc575e2`
の後にmasterに着地したもの)である。どちらもマージ後に残る — `git ls-tree`で検証済み。これはREQ-0184
が記録済みの既知の危険("Migration numbers are hand-claimed and DO collide (the tree already carries
two `016_`s)"、migration番号は手動で採番されており実際に衝突する。ツリーには既に`016_`が2つ存在す
る)であり、ここでは無害である:2つの020は独立したDDLであり、互いの順序に依存しない。**リナンバーし
てはならない** — この番号は履歴であり、021/022は既にヘッダーで"001..020"を参照している。デプロイ担
当者への注記:適用は明示的なファイル名で行い、番号の一意性を仮定したglob指定は行わないこと。

> `git diff master req-0211-gimic-content-kind -- server/migrations/`を実行すると
> `D 020_render_variant.sql`と表示される。これはTIP-DIFF ARTIFACT(tip同士の差分が生む見かけ上の
> 産物)であり、削除ではない:0211は`cc575e2`の時点で分岐しており、その時点ではmaster上にこのファ
> イルはまだ存在しなかった。MERGEはこのファイルを保持する(検証済み)。何かを"復元"する必要はな
> く、tip-diffをマージのプレビューとして読んではならない — これはまさに、実測によるマージテストが
> 防ごうとしている種類の誤りである。

## 9. docs/REQフォルダ状態への影響(REQポリシー)

PROJECT.md:"a REQ's status IS its folder … never let a REQ exist in two folders."(REQのステータス
とはそのフォルダそのものである…REQを2つのフォルダに同時に存在させてはならない)。ブランチごとに実測
したフォルダ状態(`git ls-tree -r --name-only <branch> docs/REQ`):

| branch | REQ-0185 | REQ-0211 | REQ-0239 | REQ-0240 |
|---|---|---|---|---|
| `master` | `draft/` | — | — | — |
| `req-0211` | `draft/` | `built/` | — | — |
| `req-0185` | `built/` | `built/` | — | — |
| `req-0239` | `built/` | `built/` | `built/` | — |
| `req-0240` | `built/` | `built/` | — | `built/` |

マージ後、4つとも`built/`に着地する。これはCORRECT(正しい):4つとも実装済みでゲートはgreen、かつ
どれもデプロイされていない — これはまさにPROJECT.mdが定める`built/`の定義そのものである。masterで
0185が`draft/`のままなのは矛盾ではない。masterは単に、この移動より79コミット遅れているだけである。

**REQ-0185の`draft/` -> `built/`への移動はgit RENAMEであり、クリーンにマージされる** — 検証済み:
masterはmerge-base以降`docs/REQ/draft/REQ-0185-dungeon-content-kind.md`に一切触れていないため
(`git log cc575e2..master -- <path>`は空)、rename/modifyコンフリクトは発生せず、この4回のマージから
重複が生じることもない。

それでも、前提とするのではなく必ずCHECK(確認)しなければならない。rename/modifyコンフリクトを不用
意に解決してしまう(両方のパスに対して`git add`してしまう)ことこそが、REQが2つのフォルダに存在して
しまう典型的な原因であり、その結果できあがるボードは気づかれないまま誤りを示すことになる —
`ls docs/REQ/*/`がステータスボードの全てなので、重複が1つあるだけでボードは嘘をつく。最後のマージの
後に実行する検証ステップ:

```
ls docs/REQ/*/ | grep -oE 'REQ-[0-9]{4}[a-z]?' | sort | uniq -d     # MUST print nothing
```

何か出力された場合、そのREQは2つのフォルダに存在している:WRONG(誤った)フォルダ側のコピーを
`git rm`する(より完成度の低い状態が負ける。`built/`が`draft/`に勝つ)。これは独立したコミットとして
行い、コミットメッセージは`docs: REQ-NNNN <- remove duplicate <state>/ copy left by the expedition
baseline merge`とする。PROJECT.mdに従い、フォルダ移動はそれ自体で独立したコミットとする — コードと
束ねてはならない。

## 10. 受け入れ基準

1. `master`が31コミットすべてを含むこと:`git rev-list master..<4ブランチそれぞれ>`が4ブランチとも
   空であること。
2. `git log --oneline --merges -4 master`が、0211、0185、0239、0240の順で4つの名前付きマージコミッ
   トを示すこと。
3. `docs/REQ/built/`にREQ-0185、REQ-0211、REQ-0239、REQ-0240が揃っており、§9の重複チェックが何も
   出力しないこと。
4. §7のゲートがmaster上でgreenであること(CONTENT_ROOTの罠が問題にならない場所):sim 117/0、
   goldens 12 OK、forecast 18/0、`pnpm build` + `pnpm lint`がgreen。
5. `web/app`がマージ済みソースから独立したコミットとしてリビルドされていること。
6. migrationの適用、backfillの実行、サービスの再起動のいずれもNOであること。`backpack-api` /
   `backpack-web` / `backpack-tunnel`は無変更であること。
7. 4つのソースブランチが引き続き存在し、無変更であること(ロールバック経路として機能する)。

## 11. 対象外

- **デプロイ。** Migration 020/021/022 + 2件のbackfill + あらゆるサービス再起動。ユーザーゲート、
  別対応(§8)。
- **E2E。** 明示的にゲートではない(Q2、§7)。`schedule.spec.ts`を、2つのスイートの構文的に正しい
  unionにする以上の修復は、tickの書き直し後もそれらのテストがまだ必要とされるのであれば、REQ-0260
  以降の課題である。
- **e2eハーネス。** 本REQはこれを一切追加せず、必要としない:実行時に露出する表面を何も出荷せず、
  e2eはゲートではない(Q2)。そのdecade(10番台のポート帯)**7550 / 7551 / 7552**
  (`5000 + 255*10 + {0,1,2}` = static / api / proxy、PROJECT.mdのderived-port ruleに基づく)は、
  番号によって予約されているだけで未使用のまま残る。本プログラムの後続REQは、自身の番号から自分自
  身のdecadeを導出すること。0255のdecadeを借用してはならない。
- **挙動の変更。** 本REQはマージするのみであり、修正はしない。formation4のバグはREQ-0258が扱う。
  tickの書き直しはREQ-0256/0257が扱う。
- **4ブランチをmasterにリベースすること。** 4ブランチは現状のまま維持される。`--no-ff`マージはその
  履歴をそのまま保持する。
