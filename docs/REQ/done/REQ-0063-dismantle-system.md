# REQ-0063 — Dismantle System (Dex-engraved 分解値 + personal loot shaping)

- **Status**: DONE (2026-07-07) — merged to `master` and live on
  `backpack-dev.qtie.jp` (see "Merged & deployed" below).
- Origin: user consultation (disposal of unwanted items) + orchestrator
  formalization, accepted as proposed. Companion principle: the market is the
  SOCIAL insurance for uniform-random rewards (economy.md); dismantling is the
  PERSONAL one.

## User spec
Dismantling yields a very small amount of currency items; each dismantle is also
engraved into the Dex as that item's 分解値. As an item's 分解値 rises, the
acquisition RNG narrows — you farm the item you want, and even off-target pulls
advance the hunt. Season reset: undecided (deliberately).

## Design

### §1 The ledger
- 分解値 = per-Dex-entry, per-profile permanent counter (+1 per dismantle).
- **Engraved forever** — the number is history and is never reset (record/power
  split, same law as REQ-0060: the RECORD is permanent, the POWER is bounded).
- Dex surfaces (REQ-0052 card section): the count AND the current mechanical
  suppression ("this item: −42% in your world") — loot shaping must be visible;
  invisible loot manipulation breeds distrust, visible shaping reads as a hunting
  record.

### §2 Loot shaping (the power half)
- At drop-table roll time, each entry's weight becomes
  `w = base × (1 − s(分解値))`, table renormalized.
- `s` is a diminishing curve with a **per-item cap [TUNABLE 60%]** and a hard
  **floor** — no entry ever reaches zero (discovery and re-evaluation stay alive).
- **Total-mass cap [TUNABLE]**: the summed suppression across the table is bounded
  so a veteran's table never collapses to a handful of entries.
- Self-tuning property (intended, document in Dex help): dismantling junk raises
  wanted items' relative share; dismantling surplus copies of a finished item
  retires it too — the table follows revealed preferences with zero extra UI.
- **Scope**: applies ONLY to the drop-table roll layer. OQ14 (uniform per-item
  distribution among party members) is UNTOUCHED. Pack odds (REQ-0062) are
  UNTOUCHED (declared tables stay honest; shaping is a dungeon-drop phenomenon).
- **Determinism**: the shaped weight snapshot is written onto the run record at
  deploy (same rank as the seed); replays and sealed-seed shares (REQ-0058) are
  unaffected by later dismantling. Sealed-seed participants each use their OWN
  snapshot (loot was never part of the comparison contract).

### §3 Yield (the currency half — deliberately tiny)
- The PRIMARY reward of dismantling is shaping, not currency; the yield must never
  make "dismantle everything instantly" the optimal reflex.
- **[USER pick]** (a) RECOMMENDED: new small-change TM **Scrap** (`scrap`, ja
  スクラップ): 1–3 by rarity per dismantle; 10 Scrap → 1 Weathervane (exchange at
  the Workshop); also gives the barter market its small denomination.
  (b) alternative: direct low-rate Weathervane (no roster growth, fractional
  accumulation hidden — not preferred).
- Roster growth (a) is a design event per economy.md; this REQ is its ratification
  vehicle if chosen.

### §4 Hooks & gates
- **Warehouse TTL soft landing**: expiry becomes **auto-dismantle at 50% yield
  [TUNABLE]** (with full Dex engraving) instead of deletion — the one
  appointment-pressure mechanic now degrades gracefully (retention-ruling
  compliance; closes the TTL [USER] flag from REQ-0053 §3 in spirit).
- Deployed items cannot be dismantled (existing deployedUidSets gate pattern).
- Fixed starter-job POs (REQ-0051) cannot be dismantled while fixed; discarding a
  starter BP engraves nothing (system grants are not hunting records) [ORCH,
  vetoable].
- Market tension (kept, on purpose): sell = value to others, dismantle = shaping
  for yourself — a real per-item decision every time.

### §5 Season reset (the user's open worry — resolved by deferral)
- Build NOW: the caps (§2) — they keep the answer safe either way.
- The RESET SWITCH for the mechanical suppression binds to the Ragnarok/season
  REQs (season registry now defined in REQ-0066 §1; the switch fires at REQ-0068
  §5 settlement, [USER] stance still pending). The engraving itself is never reset (§1).
- Precedent: bio_luck (REQ-0060) accepted on the same "Devotion/season resets the
  power, never the story" logic.

## [USER] decision list
1. Scrap TM adoption (§3a vs §3b).
2. Cap values: per-item suppression cap, total-mass cap, floor.
3. Season-reset stance confirmation at Ragnarok REQ time (§5).

## Test plan (gates before DONE)
- server: dismantle op atomicity (yield + engraving + item removal, files+pg),
  deploy/fixed gates, TTL auto-dismantle path, snapshot-onto-run-record.
- sim: shaped-weight determinism (same snapshot ⇒ identical rewards), floor/cap
  enforcement, OQ14 untouched (distribution tests unchanged).
- client: E2E dismantle flow + Dex engraving/suppression display + warehouse
  expiry messaging.
- S4: E1 gains Scrap faucet monitoring; new E-metric — shaped-table entropy across
  a simulated account-age matrix (verify caps hold; flag collapse below [TUNABLE]).

## Outcome (2026-07-07) — BUILT (server + client; not yet merged/deployed)

Implemented on `~/backpack_ragnarok` (192.168.0.6), worktree/branch
`req-0063-dismantle-system`, 6 lettered commits (a-f) plus a merge of
REQ-0052 (needed for §1's Dex-card surfacing) and two dist-rebuild commits.
All runnable gates green (details below).

### Corrected understanding, locked before implementation
The user personally corrected the orchestrator's own prior read of §2 mid-session:
「ドロップテーブルの重みを変える　は若干誤りで、アイテムの性能が決まる瞬間に、
最低値～最高値の最低値に補正が入ると、私が最初に説明したとおりです」 — §2's spec
text ("drop-table weight shaping") does NOT describe a real mechanic in this
codebase (`REWARD_ROLL_TO_ITEM_ID` is a fixed 1:1 map; no weighted item-selection
table exists anywhere to reweight). What actually ships is a **per-INSTANCE quality
roll**: at PO/SI mint time, a `q ∈ [0,1)` value (floor rising with that item id's
own 分解値, capped, asymptotic) narrows the item's strike/multi_strike damage range
by raising ONLY the minimum — `[lo,hi] -> [lo + q*(hi-lo), hi]`. Confirmed against
the live Dex detail page's own damage-range display
(`https://backpack-dev.qtie.jp/app/#/dex`, e.g. "22-28 damage") before implementing.
§2 as originally drafted is superseded by this; §1/§3/§4/§5 are otherwise unaffected
and shipped as specified.

### What shipped
- **Ledger** (`server/services/dismantle.cjs`, new; `server/dismantle.cjs` frozen
  facade): per-player, per-Dex-entry permanent 分解値 counter. New storage root
  (`server/storage.cjs`'s `readDismantleLedger`/`writeDismantleLedger`, files+pg
  parity) + `server/migrations/006_dismantle.sql`.
- **Suppression curve**: `s(n) = CAP*(1 - DECAY^n)`, `CAP=0.5` [USER locked: 「最大
  50%」], `DECAY=0.85` [TUNABLE — shape confirmed by the user (strong-early,
  diminishing-later, asymptotic); this exact constant is a flagged implementer
  judgment call].
- **Quality roll** (the corrected §2, see above): `rollQuality(playerId, itemId) =
  floor + Math.random()*(1-floor)`, minted ONCE at acquisition (plain `Math.random`,
  not the seeded sim RNG — a one-time mint decision, no replay/determinism
  contract). Wired into every PO/SI creation path: `warehouse.cjs`'s
  `grantWarehouseItem` (admin/dev grant) and `claimWarehouseItem` (surfaces `q` for
  the client's two-phase claim placement), `runs.cjs`'s `settleRun` (dungeon
  rewards), and `market.cjs`'s `buyListing` (the SAME instance's existing `q`
  travels to the buyer — selling transfers the physical item, never re-rolls it).
  `sim/lib/compile.cjs`'s new `applyQualityToEffects(effects, q)` remaps the
  strike/multi_strike range, applied in `foldBuffsForPO` BEFORE flat-bonus buff
  folding, mirroring `applyFlatBonusToEffects`'s exact shape. `q` defaults to 0 (an
  exact no-op) for any instance lacking the field — purely additive, byte-identical
  behavior for every pre-existing instance.
- **Dismantle action** (`POST /api/dismantle {itemUid, kind:'po'|'si'}`,
  `server/routes/dismantle.cjs`): generalizes market.cjs's PO-only
  `findInventoryPO` to also cover SI (per the user's explicit 「通常アイテム
  (PO/SI)」 scope), gates on deployed (reuses `market.cjs`'s own
  `deployedUidSet`), removes the item via a direct server-side canvas write
  (RULE-5 sanctioned, removal-only — same documented shape `market.cjs`'s
  `buyListing` already uses), engraves the ledger, and grants yield through the
  normal warehouse `grantTmQty` claimable-row path (never written straight onto
  the canvas). `GET /api/dismantle/ledger` returns the caller's own full ledger
  (backs the Workshop panel).
- **Yield** [USER pick: 「一旦weathervane1個で進めてください」]: flat 1 lrdst
  (Weathervane) per dismantle, regardless of rarity/kind. Rarity-tiered tuning
  captured for later in REQ-0088 (new draft), per the user's explicit request not
  to lose the idea.
- **TTL auto-dismantle** (`warehouse.cjs`'s `purgeExpiredWarehouseItems`): a
  non-tm warehouse row's expiry now engraves the ledger (always) and
  probabilistically (50% [TUNABLE]) grants the normal yield, instead of silently
  deleting with nothing — closes the TTL [USER] flag from REQ-0053 §3 in spirit.
  `kind:'tm'` rows are unaffected (plain delete, no Dex entry to engrave).
- **REQ-0052 Dex card overlay** (§1's "must be visible" requirement): `GET
  /api/dex/card/:kind/:id` stays auth-NOT-required (REQ-0052's own public
  posture, unchanged for anonymous callers), but for `kind:'item'|'si'` it now
  OPTIONALLY attempts `admin.resolveAuth()` on whatever token the request
  carries and, when it resolves, attaches the resolved caller's OWN `{count,
  suppression}` for that id (direct in-process read of the same ledger, not a
  second HTTP round-trip). A missing/invalid token simply omits the field —
  never a 401; the base card fetch always succeeds.
- **Workshop client UI** (`client/src/schedule/DismantlePanel.tsx`, new):
  replaces the REQ-0076 "opening soon" shell on the dismantle tile with a real
  modal — picker over the player's own inventory POs+SIs, a confirm action that
  shows the real ledger preview (fetched, never re-derived) and posts
  `/api/dismantle`, and a result toast with the actual yield. Deployed items lock
  on the server's own 409 rather than a client-side pre-scan (same posture
  `SellPane.tsx` already established for market listing).

### Scope cuts / deferrals (deliberate, flagged per this project's own norm)
- **§2 as originally drafted does not exist** — see "Corrected understanding"
  above; this is a correction, not a cut.
- **§5's season-reset switch** is deferred BY DESIGN to the Ragnarok/season REQs
  (REQ-0066 §1 registry exists; the actual switch fires at REQ-0068 §5
  settlement, [USER] stance still pending) — the engraving itself is never reset
  regardless.
- **§3's Scrap TM (option a)** was not built — the user's own interim pick was
  flat Weathervane (option b's shape, effectively) to unblock shipping. Rarity
  tiering AND the Scrap-denomination question are both captured in REQ-0088
  (new draft) for later revisit, not silently dropped.
- **Fixed starter-job POs (§4)**: no-op, documented — no "fixed starter PO"
  concept exists anywhere in this codebase yet (same absence `market.cjs`'s own
  `findInventoryPO` doc already notes for selling). Will apply automatically
  once REQ-0051 (starter jobs) ships, with zero changes needed here.
- **Client E2E**: one flagship scenario shipped (full dismantle flow + live
  cross-check against the REQ-0052 Dex card overlay, same session). A second
  scenario for the deployed-item lock was deliberately NOT added — that gate
  already has full, isolated server-side coverage, and reproducing it in E2E
  would need forcing a known-valid preset into the SHARED live dev profile
  before calling the real `assignSlot` endpoint, real fixture risk for a
  business rule this file isn't responsible for re-proving.

### Two real bugs caught during this pass (not hypothetical — both fixed)
- **Reentrancy in `purgeExpiredWarehouseItems`**: yield-granting originally ran
  INLINE inside the purge loop, and `grantTmQty() -> addToWarehouse() ->
  purgeExpiredWarehouseItems()` is re-entrant — calling it mid-iteration over
  the outer loop's own `items` snapshot caused a real double-engrave/
  double-delete on any item processed after the first yield-triggering one
  (test showed "4 !== 2"). Fixed by deferring ALL yield grants to a second pass,
  entirely after the deletion loop commits.
- **Stale `useMemo` dependency in `DismantlePanel.tsx`**: memoizing the
  inventory picker list on `[snapshot.state]` alone (matching
  `SellPane.tsx`'s own precedent) silently never recomputes after a dismantle,
  because `store/core.ts` keeps `state`'s object reference stable for the
  app's whole lifetime by design (mutated in place) — `stateVersion` exists
  specifically so consumers can detect in-place mutation, and was missing from
  the dependency array. Fixed; matches the same pattern already used by
  `Board.tsx`/`InventoryBoard.tsx`/`RagnarokPage.tsx`.

### Incident during test development (fully remediated)
An early draft of the server test suite's dismantle block used the test file's
OLD top-level `storage`/`playersFixture` bindings instead of re-requiring them
against the sandboxed `fakeRepoHome`, across a module-generation boundary the
test file's own prior structure already required extreme care around (two
internal `evictServerModuleTree()` + `os.homedir` swap points). Several
debugging iterations of this bug genuinely wrote real dismantle-ledger and
warehouse test rows into the LIVE production data directory
(`~/backpack_ragnarok/data/`) before the module-generation mismatch was
diagnosed (via `os.homedir()`/`require.resolve()` stack-trace prints showing
two different loads with different homedirs). Fully cleaned up: leaked files
were identified by cross-referencing test-only player ids, `q` fields, and a
tight modification-timestamp window against known-legitimate data, and removed
— nothing legitimate was touched. Fixed at the root by making the dismantle
test block fully self-contained (its own `dz`-prefixed re-requires against
`fakeRepoHome`, restoring the real homedir on exit), the same discipline the
rest of that test file already uses elsewhere.

### Gate results (this worktree)
- `node server/tests/api_test.cjs` (files) → **151 passed, 0 failed** (135
  pre-existing + 10 REQ-0063 dismantle cases + 5 REQ-0052 dex-card cases + 1
  REQ-0063 dex-card-overlay case).
- `STORAGE_BACKEND=pg node server/tests/api_test.cjs` (after applying
  `server/migrations/006_dismantle.sql` + its `GRANT ... TO backpack`) →
  **151 passed, 0 failed**.
- `tsc -p tsconfig.server.json` → **clean**. `node tools/check_engine_types.cjs`
  → **OK, 49 declared members verified**.
- `node sim/tests/run.cjs` → **63 passed, 0 failed**. `node
  sim/tests/goldens.cjs` → **12 cases, replay determinism intact (byte-identical)**.
- `node mock-src/tests/run.cjs` → **97 passed, 0 failed**.
- `cd client && npm run build` (`tsc -b && vite build`) → **clean**, dist rebuilt
  to `web/app/`.
- `cd client && npm run lint` (oxlint) → **33 warnings / 0 errors** — same
  pre-existing baseline count as before this REQ's changes (confirmed zero new
  warnings from any file this REQ touches).
- `cd client && npm run check:sprites` → **22/22 non-blank** (worktree's own
  `.venv` provisioned fresh with the main checkout's exact `pip freeze`
  package set, since a fresh `git worktree add` doesn't carry the gitignored
  Python env).
- `npx playwright test --list` → **131 tests parsed OK across 24 files** (130
  pre-existing + 1 new REQ-0063 `workshop.spec.ts` case), confirming nothing
  else in the suite was broken by this change's imports/syntax. NOT live-run
  this pass (same posture REQ-0052's own outcome doc already documents: the
  shared tunnel reflects only the currently-deployed build, and standing up an
  isolated local server+client instance for this worktree was judged
  out of scope for this pass) — the new scenario was hand-traced against the
  actual implementation instead.
- Full `tools/ci.sh` (`SKIP_E2E=1`, `DATABASE_URL` set) → **CI GREEN** end to end,
  re-run after every commit in this sequence.

### Commits (branch `req-0063-dismantle-system`, newest last)
- `61d79a7` (a) engine — carry per-instance quality roll `q` through every PO/SI copy site
- `5f94580` (b) sim — quality-roll range remap in `compile.cjs`
- `bc3a8f6` (c) server — the Dismantle system backend
- `344d51e` (d) tests — server coverage for the Dismantle system
- `2f03a0b` merge — `req-0052-dex-card-subwindow` (brings in REQ-0052's own 5
  commits, listed in its own outcome doc; needed for §1's card surfacing)
- `0fb3394` chore — rebuild `web/app` after the REQ-0052 merge
- `dc5b745` (e) Dex card — surface 分解値+suppression (§1)
- `992f26c` (f) Workshop client UI — the real Dismantle panel

### Merged & deployed (2026-07-07)
- master had drifted 9 commits ahead while this branch was in flight
  (REQ-0083 e2e parallelization, REQ-0085 preset-switch crash fix, REQ-0086
  Warehouse promoted to its own top-level route, REQ-0087 expedition fix) —
  merged master into `req-0063-dismantle-system` first (merge commit
  `d9e2f2c`). Conflicts were confined entirely to the checked-in `web/app/`
  build output (rehashed vite c