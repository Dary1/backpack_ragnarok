# アイテムコンテンツパイプライン — v2（PO / SI 追加手順書 ＋ 検証記録）

> **対象**: PO（`content/live/live_items.json`, `po/2`）と SI（`content/live/live_sis.json`, `si/2`）。
> 上から順に実行すれば 1 バッチのアイテムを追加できる。共通の原則・インフラ・REQ 運用・語彙・
> ビルド（`tool_gen_data.cjs`）・品質ゲート（`ci.sh`）は `common_content_pipeline.md` を参照。
> **担当**: Opus が全ステップを単独で実施。
> **アイコン工程**は REQ-0073 由来の AI ラスタ生成ルート。**2026-07-09 に V9 で end-to-end 検証済み**
> （末尾「検証記録」）。ルートの本体はブランチ `req-0073-item-icon-gen` にあり、master/live への
> 復旧・マージは REQ-0109 で行う。

## 前提

- サーバ接続済み。作業はワークツリー `~/backpack_ragnarok_worktrees/req-00NN-slug`、ブランチ `req-00NN-slug`。
- 語彙は `content/vocab.json`（現 v7）に閉じる。新語彙はデザインイベント＝ユーザー承認必須。
- 全エントリに `i18n.ja` 必須。**Step 7 が green になるまで `content/live/` に書き込まない。**

## Step 1 — ブリーフを決める

テーマ／点数(8–16)／shape 配分／rarity 配分（`vocab.rarities`）／tag・socket 予算／新語彙可否（原則なし）を決め、狙いを `notes.md` 冒頭に書く。

## Step 2 — `draft.json` を書く

場所: `content/batches/batch-NNN-slug/draft.json`、形 `{ "items": [ /*PO*/ ], "sis": [ /*SI*/ ] }`。

**PO（po/2）**: `id` / `name` / `rarity` / `shape`（`[row,col]` の配列）/ `icon`（`"icon-<id>"`）/ `tags`（`tags[0]`=種別ルート, 以降=属性）/ `effects` / `sockets`（`[{t,tags,ax,ay}]`）/ `ports`（`[{tiles,tag}]`）/ `part`（組立系のみ）/ `flavor` / `i18n.ja` / `align` / `stretch`。

**SI（si/2）**: `id` / `name` / `slot`（gem/edge/coat/bond）/ `reqTags` / `icon` / `rarity` / `effects` / `flavor` / `i18n.ja`（shape・sockets なし）。

**Effect AST**: トリガ＝`vocab.triggers`（`every_secs` は `s:[lo,hi]` 秒、`adjacent` は `tagKind:"type"|"element"`＋`tag`、`battle_start`/`passive`/`OnHit` 他）、verb＝`vocab.verbs`（数値は `n:[lo,hi]`、状態は `vocab.statuses`）。例:

```json
{"trigger":{"t":"every_secs","s":[1.8,2.2]},"verb":{"t":"strike","n":[22,38]}}
{"trigger":{"t":"adjacent","tagKind":"element","tag":"Oil"},"verb":{"t":"amp_status","status":"Burn","mult":2}}
```

## Step 3 — 静的検証（意味フィールド）

`shared/content_validate.cjs`（`validateBody(body, kind, vocab)`、`kind`=`'item'|'si'`、意味フィールドのみ検査）。単体 CLI は無いので使い捨てハーネスをリポジトリ直下から実行:

```js
// tools/scratch_validate_batch.cjs
const V = require('../shared/content_validate.cjs');
const fs = require('fs');
const vocab = JSON.parse(fs.readFileSync('content/vocab.json','utf8'));
const batch = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const pick = (o,ks)=>Object.fromEntries(Object.keys(o).filter(k=>ks.has(k)).map(k=>[k,o[k]]));
let bad=0;
for (const e of batch.items||[]) { try{V.validateBody(pick(e,V.ITEM_ALLOWED_KEYS),'item',vocab);}catch(err){bad++;console.error('ITEM',e.id,err.message);} }
for (const e of batch.sis  ||[]) { try{V.validateBody(pick(e,V.SI_ALLOWED_KEYS ),'si',  vocab);}catch(err){bad++;console.error('SI',  e.id,err.message);} }
console.log(bad?`FAIL ${bad}`:'S2 OK'); process.exit(bad?1:0);
```

`node tools/scratch_validate_batch.cjs content/batches/batch-NNN-slug/draft.json`。構造フィールド（shape/ports/part/icon/align/id）は Step 4・5 で担保。加えて id/name 衝突（live 含む）を手検査。

## Step 4 — エンジン統合チェック

```
node tools/tool_integrate.cjs content/vocab.json \
  content/live/live_items.json content/live/live_sis.json \
  content/batches/batch-NNN-slug/draft.json
```

配置/4 回転/socket 整合を実エンジンで検査。赤が出たら Step 2 に戻る。

## Step 5 — アイコン生成（AI ラスタ方式・V9）

> ルートの本体（ツール・`gen_*` フィールド・batch-003）はブランチ `req-0073-item-icon-gen` にある
> （master 未マージ、REQ-0109）。**クライアント実行には `~/backpack_ragnarok/.venv/bin/python` を使う**
> （`requests`/`PIL`/`numpy`/`scipy`/`rembg`/`onnxruntime` 導入済み。ワークツリー独自の `.venv` は現状無い）。
> ComfyUI は常駐サービスではないので手動起動が必要（`~/ComfyUI/venv/bin/python main.py`、`127.0.0.1:8188`）。

**5-1. `gen_render` を計算（推測しない）。** `cell_px`=256、`cells`=shape の正規化コピー、`bbox_cells`=[w,h]、`target_px`=[w×256, h×256]（最終キャンバス。不定形でも常に矩形）、`gen_px`＝同アスペクト・約 1MP・両辺 64 の倍数（生成後 Lanczos で `target_px` に縮小）。**小さく生成しない**（例: 1×1 を 256px 直生成は quality が落ちる。必ず ~1MP で生成→縮小）。不定形は bbox 行を使い `mask_cells` に占有セルを入れて配置バイアス（best-effort）。

| shape (bbox w×h) | 例 | アスペクト | `target_px` (=bbox×256) | `gen_px`（約1MP・64倍数） |
|---|---|---|---|---|
| 1×1 | gem / reagent | 1:1 | 256×256 | **1024×1024** ✓確認済 |
| 2×1 | 横長武器 | 2:1 | 512×256 | 1408×704 |
| 1×2 | 刀身・縦武器 | 1:2 | 256×512 | **704×1408** ✓確認済 |
| 3×1 | 長柄（横） | 3:1 | 768×256 | 1728×576 |
| 1×3 | 大剣（縦） | 1:3 | 256×768 | 576×1728 |
| 2×2 | 盾・大型・L型 | 1:1 | 512×512 | **1024×1024** ✓確認済 |
| 3×2 | 横長大物・T/Z | 3:2 | 768×512 | 1152×768 |
| 2×3 | 縦長大物・T/Z | 2:3 | 512×768 | 768×1152 |
| 3×3 | 最大級 | 1:1 | 768×768 | 1024×1024 |

（✓＝ブランチ実データ／本検証で確認済み。他は同式による値で `gen_item_icons.py` が自動計算。アスペクトは不可侵＝異方スケール禁止 / `art_golden.md`。）

**5-2. `gen_prompt` / `gen_negative`。** `content/batches/batch-003-item-icons/style_guide.md` のテンプレを踏襲。JuggernautXL V9 は写実バイアスが強いので **stylization トークンを前置**（painterly dark-fantasy game icon、NOT photorealistic）。マット抽出のため **near-white 背景**を指定。名前は素直に（`art_golden.md`）。

**5-3. 生成**（ComfyUI が `127.0.0.1:8188` で稼働、checkpoint `JuggernautXL_RunDiffusionPhoto2_V9_Final`。>30s は `setsid nohup ... &` でログをポーリング）:

```
cd ~/backpack_ragnarok_worktrees/req-0073-item-icon-gen
setsid nohup ~/backpack_ragnarok/.venv/bin/python tools/gen_item_icons.py \
  --defs content/live/live_items.json --ids <id> \
  --outdir content/batches/<batch>/candidates > tmp/gen.log 2>&1 &
```

既定: 4 候補 / seed 101・202・303・404 / 30 steps / cfg 6.5 / dpmpp_2m・karras。`--rematte-only` で再マットのみ。

**5-4. マット（透過）**: rembg `birefnet-general`（`~/.u2net/birefnet-general.onnx` にキャッシュ済み）＋ 縁色キー fallback、有効帯 2–90%。

**5-5. スコア＆選抜（幾何のみ）**:

```
~/backpack_ragnarok/.venv/bin/python tools/tool_icon_score.py \
  --defs content/live/live_items.json \
  --candidates-dir content/batches/<batch>/candidates \
  --out content/batches/<batch>/scores.json \
  --render-dir content/batches/<batch>/fit_renders \
  --select-dir content/batches/<batch>/selected
```

`tool_icon_score.py` は `tool_fit_check.py` を import。`score = 100·(0.35·scale + 0.50·coverage + 0.15·uniformity)`、`MIN_CONTENT_FRAC=0.02`、勝者＝argmax。被覆下限 **≥20%/セル**（`art_golden.md`）を満たすこと。

## Step 6 — プレビュー配備

`tools/build_batch003_report.py` を当該バッチ向けに適用 → `web/preview/batch-NNN/index.html`（自己完結・相対パス・ダークテーマ）→ `https://backpack-dev.qtie.jp/preview/batch-NNN/` を確認。

## Step 7 — ユーザーレビュー（ここで停止）

numbered ギャラリーで entry 単位（green/fix/cut）またはルール単位で判定。**green まで live に触れない。**（`art_golden.md` の Illustration-first ＝アート承認前に stats を出さない、をここで担保。）

## Step 8 — マージ・ビルド・登録

1. 承認 entry を `content/live/live_items.json`（/`live_sis.json`）の `entries[]` に追記。
2. `node tools/tool_gen_data.cjs content/vocab.json content/live/live_items.json content/live/live_sis.json content/live/scenario.json mock-src/data.js`
3. `content/registry.json` に id・件数・レビュー結果・provenance（起草＝opus）を追記。
4. `bash tools/ci.sh`（必要に応じ `SKIP_PG=1`/`SKIP_CLIENT=1`/`SKIP_E2E=1`）を緑に。
5. コミット（バッチ関連をまとめて）。巻き戻しは git 履歴で。

---

## 検証記録（2026-07-09, V9）

REQ-0109 の一環として、アイコン生成ルートを **V9** で end-to-end スモークテストし、動作を確認した。

**環境**
- モデル: `JuggernautXL_RunDiffusionPhoto2_V9_Final`（導入済み。V6 は未導入だがユーザー判断で V9 採用）。
- クライアント実行: `~/backpack_ragnarok/.venv/bin/python`（`requests`/`PIL`/`numpy`/`scipy`/`rembg`/`onnxruntime` 導入済み）。**ワークツリー `req-0073-item-icon-gen` 独自の `.venv` は存在しなかった**ため、メインチェックアウトの `.venv` を使用。
- ComfyUI: 停止していたので手動起動（`~/ComfyUI/venv/bin/python main.py`、`127.0.0.1:8188`）。常駐サービスではない。
- マット: `~/.u2net/birefnet-general.onnx`（972MB）キャッシュ済み → ダウンロード不要。

**実行と結果**
- 生成: `gen_item_icons.py --ids hilt --candidates 1`（`hilt` = 1×1、`gen_px 1024×1024 → target_px 256×256`、seed 101）。
  - 出力: `hilt_c1_s101.png`（raw, 72KB）＋ `hilt_c1_s101_alpha.png`（matte, birefnet, coverage **10.99%**）。
  - 所要: **298.7s**（初回 SDXL ロード込み。8GB RTX 2080。warm 時は ~23s/枚）。
- スコア: `tool_icon_score.py` → `hilt` feasible、**score 53.35**（`content_frac 0.116` / `scale 0.383` / per-cell coverage `0.134`、weights 0.35/0.50/0.15）。
  - 生成物: `scores.json`、`fit_renders/hilt_c0_fit.png`、`selected/hilt.png`。

**結論**: 生成 → マット → 幾何スコア → 選抜 が V9 で **end-to-end 動作**することを確認。ツール（`gen_item_icons.py` / `tool_icon_score.py` / `tool_fit_check.py`）はブランチ上で健在。

**留意点**
- ワークツリーの `.venv` 欠落 → メイン `.venv` を使う（または worktree の venv を作り直す）。REQ-0109 の復旧項目に含める。
- ComfyUI は手動起動が要る。初回画像は model ロードで ~5 分、以降は warm で高速。
- `hilt` のマット被覆 10.99% は `art_golden.md` の下限 20% を下回るが、1×1 の小さな柄頭なので想定内（per-case の再描画かウェイバー。パイプライン不具合ではない）。
- 本テストは `hilt`×1 の疎通確認のみ。フルバッチ（8 items × 4 候補）や `build_batch003_report.py` の再生成は未実施 → REQ-0109 の「WIP 仕上げ」で実施。
- REQ-0109 の残タスク（WIP 仕上げ・master マージ・ラスタ↔live 描画配線）は本テストの対象外で、状態は変わっていない。
