# REQ-0042 — Workshop (BP Gacha) + LRDST Currency + Stacking + BP Move Handle

- **Status**: DONE (2026-07-05)

## User spec (verbatim intent)
1. Main nav gains **工房 (Workshop)**. Workshop offers **Common BP gacha**: costs 10×
   "LinkerRandomDirectionShuffleTransmutator" (**LRDST**) — a currency item that is
   also a Transmutator (no use-effect yet). Transmutators are STACKABLE. Give the dev
   player 999 in inventory; dungeon rewards can drop LRDST; guest accounts get 100
   auto-granted at creation.
2. Inventory AND Canvas: BPs full of POs must still be draggable as a whole — add a
   "move(+)" emoji handle at each BP's TOP-LEFT.

## Design
- **TM (Transmutator) item kind**: new stackable record {uid, id:'lrdst', qty, cell}
  in inventory pages (page shape gains tms:[]; inventory-only v1 — no canvas role,
  takes no effect). 1×1 footprint, same free-cell collision rules as free SI. Drag
  onto a same-id stack MERGES quantities; no split UI v1. Engine API: tm place/move/
  merge/spend(st, id, qty) + tests. Content: lrdst def in live (type root
  `Transmutator` added to po_tags? NO — TM is its own kind, not a PO; define in a new
  content/live/live_tms.json with i18n + icon ref; ICON REQUIRED FIRST per the new
  illustration-first law — a simple swirl/die glyph drawn before wiring).
- **Gacha (two-phase, mirrors claim)**: POST /api/workshop/gacha {kind:'common_bp'} →
  server verifies last-saved LRDST balance ≥10, rolls a BP instance (seeded server
  RNG: random polyomino 4–6 cells, random linker cell + 1–3 dirs, hpMax=15×cells,
  minted uid), records pending {uid, cost}, returns it; CLIENT deducts 10 from its
  stack + first-fit places the BP + pulse (reuse receive flow) + auto-save; server
  finalizes on PUT (balance reduced AND uid present), lazy-reverts abandoned rolls.
  Insufficient funds → 409 + disabled button client-side.
- **Grants**: guest creation seeds initial profile with a 100× lrdst stack (page 1);
  dev player: 999× granted to WAREHOUSE (avoids dual-writer clobber of live client
  state — user claims once; claim first-fit MERGES into an existing stack if present).
- **Rewards**: sim reward accrual adds LRDST rolls (tunable: 1–3 per non-boss
  encounter clear, 5–10 boss) → warehouse rows with qty; claim merges stacks.
- **BP move handle**: "✥/➕-style move emoji badge" rendered at each BP's top-left
  cell on BOTH boards, above PO art; dragging the badge = whole-BP move (same code
  path as linker-grab); badge is the only interactive px (eventMode rules respected).

## Gate
Engine tests (stack/merge/spend/gacha-shapes), server tests (gacha two-phase, grants,
reward qty, finalize/revert), E2E (gacha flow with pulse, insufficient funds, handle
drag on full BP both boards, guest 100 auto-grant), all suites green, pages 200.

## Outcome (2026-07-05) — DONE

Implemented in full on `~/backpack_ragnarok` (192.168.0.6) across 8 commits (7
lettered units (a)-(g) + one extra split within (g) for the final dist rebuild,
mirroring REQ-0041's own precedent of a dedicated dist-rebuild commit). Working
tree clean, all gates green (independently re-verified by the orchestrator, not
just the implementing subagent — see verification notes below).

**Commits** (newest last):
- `0e69102` (a) LRDST icon + content + /api/content wiring + Dex catalog display
- `900dcc4` (b) engine TM (Transmutator) kind -- place/move/merge/spend + tests
- `b6b990c` (c) Workshop gacha server -- two-phase roll, seeded polyomino, grantTmQty
- `748f0c8` (d) Workshop client UI -- #/workshop route, Common BP gacha card
- `94617c1` (e) grants + rewards -- guest 100x seed, real dev 999x grant, LRDST
  dungeon rewards, TM claim-merge
- `1e62264` (f) BP move handle -- always-visible top-left badge on both boards
- `113b69e` (g) E2E coverage for workshop/gacha/LRDST/move-handle + 3 real bugs
  found and fixed during E2E development
- `d7cf5b5` (g) final dist rebuild reflecting commits (c) through (g)

**Icon**: hand-drawn `icon-lrdst` (swirling die/prism glyph, frost palette
`#7ecbe8/#d7ecf7/#5aa9c9/#a5dcef/#f2fbff/#2b2016/#59d6d6`), added into NEW
`content/sprite_all_v11.svg` (v10 untouched, all consumers repointed). Fit-check:
non-blank (6857 alpha px at check resolution), aspect_ok=yes. `check:sprites`
independently re-run by the orchestrator: **22/22 PASS** (was 21).

**Engine (b)**: page shape gained `tms:[]` ({uid,id,qty,cell}); tmCanPlace/tmMove/
firstFitTMCell/spendTM added; migrateState + checkUidInvariant cover tms. spendTM
is page-scoped (documented judgment call, matches every other page-scoped engine
mutator) and consumes largest-stack-first. One real bug (tmMove minting a
duplicate stack instead of merging for a brand-new uid) found and fixed during
E2E work in commit 113b69e.

**Gacha (c)**: two-phase POST /api/workshop/gacha mirrors the REQ-0041 warehouse
claim pattern exactly (pending record -> client places+auto-saves -> server
finalizes on PUT requiring balance-delta AND minted uid present; lazy revert of
abandoned rolls). Shape roll: random-walk polyomino, 4-6 cells, retry cap 2000,
verified connected/deterministic under a fixed seed across 2000 sample rolls.
Linker = random polyomino cell + 1-3 random directions. hpMax = 15 x cellCount.
Cost = 10 LRDST (per spec). Uses a parallel `gacha_pending` store rather than
reusing the warehouse-claim row shape directly (justified: the two pending
records carry genuinely different fields -- rolled shape/linker/hpMax vs. a
plain itemId+qty).

**Grants (e)**: guest creation (server/cli_invite.cjs + the shared fresh-profile
constructor) seeds a `tms:[{id:'lrdst',qty:100}]` stack on inventory page 1, ONLY
on brand-new profiles. Verified independently by the orchestrator via a real
guest mint + headless boot: Workshop page read "Balance: 100 LRDST".
Dev grant: performed as a REAL one-time op against the live running
`backpack-api` service via `POST /api/admin/warehouse/grant {tm:'lrdst',qty:999}`.
Independently re-verified by the orchestrator via `GET /api/warehouse`:
`{"qty":999,"kind":"tm","itemId":"lrdst","status":"claimable",
"itemUid":"wh_c26d0a20fde7d614","playerId":"dev",...}`. This is a real warehouse
row awaiting claim by the user in the live UI -- not test data.

**Rewards (e)**: sim/combat.cjs reward accrual gains named-constant LRDST drops:
1-3 per cleared non-boss encounter, 5-10 per cleared boss encounter (uniform
random within range). Land as warehouse rows with qty; claiming a TM row merges
into an existing matching-id inventory stack (else first-fit new stack). One
real bug found+fixed: merged TM claims were never finalizing server-side because
the finalize check looked only for the newly-granted uid, which a same-id merge
legitimately discards (destination stack's uid persists) -- fixed in commit
113b69e. A second real bug found+fixed: the guest 100x seed originally hardcoded
cell [1,1], which is normally already occupied by scenario starter content on a
fresh profile -- fixed to use the engine's free-cell first-fit instead.

**Move handle (f)**: "✥" badge at each BP's top-left cell, both boards, rendered
above PO art, only the badge is pointer-interactive (eventMode='none' elsewhere
per house convention), pointerdown on the badge enters the existing linker-grab
whole-BP-move code path. Verified against a BP fully covered by POs (the exact
scenario the handle exists for).

**Tests** (before -> after): engine 80->91, sim 41->43, server 81->89 (both file
and pg storage modes -- orchestrator independently re-ran both: 89/89 PASS each;
note the pg run requires `DATABASE_URL` to be sourced from server/.env into the
shell env, since it is normally only injected via the systemd unit's
EnvironmentFile= -- a plain ad hoc `STORAGE_BACKEND=pg node tests/api_test.cjs`
without sourcing .env first will spuriously fail on every pg write; this is an
environment-invocation detail, not a code defect), E2E 71->78 (new
`client/e2e/workshop.spec.ts`, 7 scenarios). `check:sprites` 21->22 PASS
(orchestrator re-verified). tsc clean, client build clean, all deployed pages
(app/health/content/preview + public tunnel) return 200 per the implementing
subagent's report (not independently re-curled by the orchestrator).

**Deviations from literal spec text** (all judgment calls, documented in code):
TM merge E2E coverage uses repeated warehouse claims rather than pointer-drag,
since no TM board sprite exists anywhere (TM is inventory-only by design, so
there is nothing to drag-and-drop onto on a rendered board in the current UI --
the engine-level drag-merge itself IS covered by engine unit tests in (b));
spendTM is page-scoped; TM merge keeps the destination stack's uid; gacha uses a
parallel pending store; 8 total commits instead of 7 (separate dist-rebuild
commit, matching REQ-0041 precedent).

Note: this repo's `docs/` tree (this file, PROJECT.md) lives ONLY on the
orchestrator-side FS, not in the git-tracked code repo on 192.168.0.6 (confirmed:
no `docs/` directory exists anywhere in that repo's history) -- so this Outcome
section had to be appended from the orchestrator side after the implementing
subagent's SSH-only session completed, since it had no path to this file.
