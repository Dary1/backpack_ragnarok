# TM Content Pipeline — v1.0 (2026-07-12, REQ-0110)

> **Scope**: TM (Transmutator) content — `content/live/live_tms.json`,
> schema `tm/1`. Executing the steps top-to-bottom adds one batch of TMs.
> Shared principles, infra, REQ workflow, vocab, build and quality gates
> (`ci.sh`): see `common_content_pipeline.md`. PO/SI: see
> `item_content_pipeline.md`. Enemy/dungeon: see
> `monster_content_pipeline.md` (REQ-0111).
>
> Every claim below was verified against source on master
> (2026-07-12, REQ-0110); file references are authoritative if they drift.

## 0. What a TM is (and is not)

- TMs are the game's **stackable, inventory-only barter tokens and crafting
  reagents** (REQ-0042). They have **no shape, no sockets, no ports, no
  effects** — they never enter the placement engine and never appear on a
  canvas. `tool_integrate.cjs` has no TM path *by design*.
- Economy role (binding; see `economy.md` law 1 "barter in kind"): a market
  price is an integer quantity of ONE TM. The v1 trade TM is `lrdst`
  (`server/services/market.cjs` `MARKET_TM_ID`); 8% of every settled trade
  is burned (law 2, "the furnace tithe").
- A TM def alone **does nothing**. Every TM's mechanic (gacha pull, reshape,
  market role, …) is code owned by its own REQ (`server/services/gacha.cjs`
  `readLrdstBalance()` is the pattern: it just sums `tms[]` qty on the
  profile). This pipeline ships **defs + i18n + icon**; behavior ships
  separately.
- TMs are **few by nature**. Each TM is a mechanic hook, not bulk content —
  a batch of 1–3 is normal (contrast items' 8–16).

## 1. Data model (`tm/1`, as built)

`content/live/live_tms.json` → `{ "schema": "tm/1", "entries": [ ... ] }`.

Per entry (all fields of the live exemplar `lrdst`; REQ-0042):

| field | rule |
|---|---|
| `id` | snake/lower, unique across live TMs **and** live items **and** live SIs |
| `name` | EN, plain names (`common_content_pipeline.md` §2 discipline) |
| `short` | uppercase ticker for compact UI (e.g. `LRDST`) |
| `rarity` | must be in `vocab.rarities` |
| `icon` | `"icon-<id>"` — SVG sprite symbol (see Step 5) |
| `stackable` | always `true` (inventory-only stack semantics) |
| `flavor` | EN flavor text |
| `i18n.ja` | `{name, flavor}` — REQUIRED, as for items/SIs |

**No `effects` field exists in tm/1** (no use-effect v1, per REQ-0042).
A TM with effects/use-verbs would be a schema+vocab design event: user
approval, `shared/content_validate.cjs` extension, engine work — its own REQ.

Forward-looking seat (queued, do not implement here): chance-based TMs get
`respects_bio_luck: true` when REQ-0060 lands; the current roster is
deterministic and stays so.

## 2. Where TMs surface (integration map)

- `server/lib/content.cjs` — loads `live_tms.json` into the content cache;
  served by `GET /api/content` as `tms` (REQ-0042). `withBackCompatI18n`
  applied; **no** `eff_en`/`eff_ja` rendering (no effects).
- `server/services/gacha.cjs` — Workshop pull price (`readLrdstBalance`).
- `server/services/market.cjs` — barter currency (laws 1–2).
- `client/src/dex/Dex.tsx` — TMs render as a **display-only, non-selectable
  catalog strip** below the PO/SI grid (deliberately NOT a third DexEntry
  kind; see the REQ-0042 comment block there before "improving" this).
- `tools/tool_gen_data.cjs` — does **NOT** bake TM defs into
  `mock-src/data.js` (only empty `tms:[]` profile pages). The live client
  reads TMs from `/api/content`; there is no baked mirror to regenerate.

## 3. Pipeline steps

### Prerequisites

- Work in worktree `~/backpack_ragnarok_worktrees/req-00NN-slug`, branch
  `req-00NN-slug` (never the main checkout).
- **Nothing is written into `content/live/` until Step 7 is green.**

### Step 1 — Decide the brief

Write at the top of `content/batches/batch-NNN-slug/notes.md`:
theme / count (1–3 typical) / rarity / the TM's **mechanic owner** (which
REQ implements its behavior, or "none yet — catalog-only") / **faucet and
sink** (how players earn it, what consumes it — every TM must name both;
`economy.md` faucet/sink invariant) / deterministic or chance-based.

### Step 2 — Write `draft.json`

Location: `content/batches/batch-NNN-slug/draft.json`, shape
`{ "tms": [ ... ] }`, entries exactly per the §1 table. Model entry:

```json
{ "id": "lrdst", "name": "weathervane", "short": "LRDST",
  "rarity": "Common", "icon": "icon-lrdst", "stackable": true,
  "flavor": "…", "i18n": { "ja": { "name": "…", "flavor": "…" } } }
```

### Step 3 — Static validation (hand-rolled; no validator kind exists)

`shared/content_validate.cjs` `validateBody()` accepts `kind` =
`'item' | 'si'` **only** — there is no `'tm'` kind and no admin-PUT edit
surface for TMs today (`server/admin.cjs` routes items/SIs only). Extending
the validator is a code change owned by whichever REQ first needs it; do
NOT bolt it on inside a content batch. Until then, validate by script:

```js
// tools/scratch_validate_tms.cjs (throwaway, repo root)
const fs = require('fs');
const vocab = JSON.parse(fs.readFileSync('content/vocab.json','utf8'));
const live = ['live_items','live_sis','live_tms']
  .flatMap(f => (JSON.parse(fs.readFileSync(`content/live/${f}.json`,'utf8')).entries||[]).map(e=>e.id));
const batch = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
let bad = 0;
const req = ['id','name','short','rarity','icon','stackable','flavor','i18n'];
for (const e of batch.tms || []) {
  const err = m => { bad++; console.error('TM', e.id, m); };
  for (const k of req) if (!(k in e)) err(`missing ${k}`);
  if (e.stackable !== true) err('stackable must be true');
  if (!vocab.rarities.includes(e.rarity)) err(`bad rarity ${e.rarity}`);
  if (e.icon !== `icon-${e.id}`) err('icon must be icon-<id>');
  if (!e.i18n || !e.i18n.ja || !e.i18n.ja.name || !e.i18n.ja.flavor) err('i18n.ja {name,flavor} required');
  for (const k of ['shape','sockets','ports','effects','part']) if (k in e) err(`forbidden key ${k} (tm/1 has none)`);
  if (live.includes(e.id)) err('id collides with live content');
}
console.log(bad ? `FAIL ${bad}` : 'S2 OK'); process.exit(bad ? 1 : 0);
```

Also hand-check name collisions (EN + ja) against all live content.

### Step 4 — Integration check (server-side, not engine-side)

TMs skip `tool_integrate.cjs` (no placement semantics). Instead prove the
serving path on the draft: temporarily point a scratch copy of
`live_tms.json` + run the server test suite (same invocation `ci.sh` uses,
from the repo root) —

```
node server/tests/api_test.cjs
```

`GET /api/content` must return the new entries under `tms` with
`name_ja`/`flavor_ja` back-compat fields derived from `i18n.ja`. Any red →
back to Step 2. (If the TM's mechanic REQ has landed, its tests run here
too; if not, catalog-only is fine — see Step 1's "mechanic owner".)

### Step 5 — Icon (SVG sprite route — NOT the AI raster route)

TM icons are **SVG sprite symbols**: `icon-<id>` in the current
`content/sprite_all_vN.svg` (`icon-lrdst` exists since v11). The REQ-0073
AI-raster route is items-only today; adopting it for TMs is **not ratified**
(and would follow the REQ-0136 checkpoint outcome anyway; REQ-0135 is settled —
LayerDiffuse NO-GO, matte route unchanged). So: author the
`<symbol>` into the next `content/sprite_all_vN.svg` version (the sheet is
hand-maintained; the client imports it via
`client/src/board/sprites.ts` + `client/src/dex/dexIcons.ts` — currently
`sprite_all_v12.svg`; bump both imports when versioning), and verify the
Dex strip renders it. 1×1 display; coverage/aspect rules of
`common_content_pipeline.md` §2 apply.

### Step 6 — Preview deploy

The Dex TM catalog strip IS the review surface. Point a dev profile at the
draft content and screenshot the strip (EN + ja), or build a minimal
`web/preview/batch-NNN/` page (self-contained, relative paths, dark theme)
if the batch warrants it. Public check: `https://backpack-dev.qtie.jp/…`.

### Step 7 — USER REVIEW (STOP here)

Verdicts per entry (green / fix / cut). **Nothing touches live until
green.** Chance-based TMs additionally need their odds surfaced in the
review material (transparent-odds discipline, REQ-0062).

### Step 8 — Merge, build, register

1. Append approved entries to `content/live/live_tms.json` `entries[]`.
2. No `mock-src/data.js` regeneration is needed for TM defs (§2) — but run
   `bash tools/ci.sh` (with `SKIP_PG=1`/`SKIP_CLIENT=1`/`SKIP_E2E=1` as
   needed) to green anyway; the server suite covers `/api/content`.
3. Append id / counts / review outcome / provenance to
   `content/registry.json`.
4. Commit (batch changes together). Rollback = git history.

## 4. Open items (tracked elsewhere; do not solve in a content batch)

- `'tm'` kind in `shared/content_validate.cjs` + admin edit surface — owned
  by the first REQ that needs admin PUTs for TMs.
- `respects_bio_luck` schema seat — REQ-0060.
- Use