# REQ-0172 — E2E order-independence (dismantle panel stale-refresh) + REQ-derived harness ports

**Reserved:** 2026-07-14 · **Slug:** e2e-order-independence-and-harness-ports
**Origin:** user directive 2026-07-14, immediately after REQ-0159 merged+deployed:
"明らかな問題を修正するREQを立てて" + the port-scheme proposal ("8000+REQ番号とか" →
refined to REQ*10 + index) + "自動化させられたりしますかね".
**Filed to:** `todo/` (cleared to implement on the same directive).

## 日本語サマリ

REQ-0159 のライブ検証中に2件出た。(1) **REQ-0159 が持ち込んだ回帰**: workshop の
dismantle テストが実行順序依存になった(ファイル全体なら緑、単体 `--grep` なら赤)。
その原因は (2) **2つ目の実クライアントバグ**: 最後の1個を分解した後、パネルが破棄済みの
行を表示し続ける(サーバは正しく空、クライアントの picker が1行残る)。ci.sh は緑だが
**その緑が順序依存**であり、REQ-0159 が掲げた「CI GREEN は文字通り緑」を満たしていない。
併せて (3) ハーネスのポートを **REQ番号×10+index** で導出する規則にし、手で選ぶ余地を
なくす(導出ヘルパ + lint + 起動前チェックで機械化)。

## 1. Item A — the dismantle panel does not refresh after destroying the LAST item

### Evidence (measured 2026-07-14, master @ ee93a2d, deployed bundle index-DxF_qldb.js)

Instrumented run of `workshop.spec.ts --grep "dismantle flow"`, immediately after the
success toast appears:

```
DBG server inv page pos counts: 0,0,0,0,0     <- server: the item IS gone (correct)
DBG server page0 uids:                        <- empty
DBG picker rows: 1                            <- client: still rendering the destroyed row
```

So: `POST /api/dismantle` → 200 (4 ms). The server removes the PO. `confirmDismantle()`
then `await loadGame()`. `loadGame()` runs with **no error and no early return** (browser
console captured: no `canvas load failed` warning, no pageerror), and it ends in
`notifyStateChanged()` → `setSnapshot({...snapshot, stateVersion: +1})`. `DismantlePanel`
subscribes via `useGameStore()` = `useSyncExternalStore`, and its list is
`useMemo(() => collectDismantlable(snapshot.state), [snapshot.state, snapshot.stateVersion])`.

Every link in that chain looks correct, and yet the row survives. **The mechanism is not
yet pinned** — that is this REQ's first job, and it must be pinned before anything is
changed. Do NOT "fix" this by forcing a re-render (a `key` bump, an extra `useEffect`, a
poll): that hides whichever link is actually broken.

Leads worth checking first, cheapest first:
- Is `collectDismantlable` reading a **stale `state.inv`**? `loadGame` mutates `st.inv`
  in place on the SAME `GameState` object. `snapshot.state` is documented as "a STABLE
  reference for the app's whole lifetime" (DismantlePanel.tsx:100), which is exactly why
  `stateVersion` is in the memo deps. Confirm `stateVersion` actually reaches THIS
  component's render (log it).
- Does `useSyncExternalStore`'s `getSnapshot`/`subscribe` in `store/core.ts` notify on
  this particular `setSnapshot`? Confirm the component re-renders at all after loadGame.
- `engine.migrateState(rawCanvas)` — does it return an inv that still contains the item
  (i.e. is the client's copy re-hydrated from something stale)?

### Why it presented as order-dependent, and why that is the real damage

REQ-0159 changed the seed to clear every inventory page so the blade is the ONLY
dismantlable item — deliberately forcing the "dismantle the last item" path, because that
is the path the REQ-0159 toast bug lived on. That made the path **guaranteed** instead of
**accidental** — and it promptly walked into this second bug.

- **Pre-REQ-0159** the seed APPENDED to the live dev profile, so the picker still had the
  other dev items after the dismantle; the test only needed the one row to disappear, and
  the panel apparently refreshes fine in that case.
- **Post-REQ-0159** the picker must go EMPTY, and it does not.
- In a **full-file** run something else (an unrelated later snapshot change, e.g. the
  auto-save status flipping) happens to re-render the panel in time, so it passes.
  Standalone (`--grep`), nothing does, so it fails.

Net: `tools/ci.sh` is green, but **that green is order-dependent** — the exact property
REQ-0159 claimed to have retired. This is a REQ-0159 regression, owned here.

### Scope A

1. **Pin the mechanism** (above) with evidence, before touching code.
2. **Fix the client** so the panel reflects the post-dismantle state unconditionally.
   The fix must be the mechanism's, with its own test — not a re-render nudge.
3. **The e2e test must pass STANDALONE**, not only in file order:
   `pnpm run e2e workshop.spec.ts --grep "dismantle flow"` green on its own, at
   `E2E_PARALLEL` = unset / 1 / 4. Order-independence is the acceptance bar, not "ci is
   green".
4. Keep REQ-0159's guard intact (the picker must really go empty AND the toast must
   really survive). It is doing its job — it caught this.

## 2. Item B — REQ-derived harness ports (user proposal, 2026-07-14)

### The defect

`tools/artadmin_e2e.sh` and `tools/content_admin_e2e.sh` both hardcoded 8921/8922/8923.
Harmless while each harness was only ever run BY HAND, one at a time (REQ-0156/0157) —
fatal the moment REQ-0159's new `ci.sh [6.5/8]` step ran all three back-to-back: the
second could not bind while the first's processes were still coming down, its proxy never
came up, and all 3 contentadmin specs died on `ECONNREFUSED :8923`. REQ-0159 patched it
by hand (content_admin → 8931-8933). Hand-picked ports collide eventually; that patch is
a band-aid, not the rule.

### The rule (user's proposal, refined)

    PORT = <REQ number> * 10 + <index 0-9>

Each REQ owns exactly one decade, so two REQs can never collide by construction, and a
port names its owner on sight. Index convention: **0 = static, 1 = api, 2 = proxy**.

    REQ-0152 (art_inspect)  -> 1520 / 1521 / 1522
    REQ-0156 (artadmin)     -> 1560 / 1561 / 1562
    REQ-0157 (contentadmin) -> 1570 / 1571 / 1572

The user's first suggestion was `8000 + REQ`, which gives only ONE port per REQ while each
harness needs three — adjacent REQs (0156→8156, 0157→8157) would overlap. The `*10`
stride is the same idea with room for the whole harness.

Constraints: valid REQ range **0103-6553** (below → the decade dips under the privileged
1024 line; above → it overruns 65535). Sits well under Linux's ephemeral range
(32768-60999), so it never collides with a random client socket either.

NOT covered: the shared permanent services keep their fixed, well-known ports and are not
REQ-scoped — `backpack-web` 8801, `backpack-api` 8802, the e2e local proxy 8803, and the
REQ-0083 fleet at 8810+.

### Scope B — and it must be AUTOMATED, not merely documented (user: 自動化)

A rule that lives only in prose rots. Three levels, all required:

1. **Derivation helper** `tools/e2e_ports.sh`: each harness declares its REQ number ONCE
   and sources the helper; no port literal survives in any harness.
   `source "$(dirname "$0")/e2e_ports.sh" 0156` → exports STATICPORT/APIPORT/PROXYPORT.
   Keeps the existing `${VAR:-<derived>}` override seam (derived = the DEFAULT).
   Validates the REQ number against the 0103-6553 range and fails loudly outside it.
2. **Enforcement** `tools/check_e2e_ports.*`, wired into `ci.sh` EARLY (cheap, fails
   fast): scans the harnesses for port literals outside their own REQ's decade and fails
   the build. The rule is then machine-checked, not remembered.
3. **Fail-fast preflight** in the helper: verify each derived port is free before
   starting anything, and abort with `port 1562 busy (REQ-0156) -- aborting` instead of
   letting the specs die 40 lines later on ECONNREFUSED. That single line is what the
   REQ-0159 ci failure should have printed.

Migrate all three harnesses (8911-8913 / 8921-8923 / 8931-8933 → 1520s / 1560s / 1570s)
and delete REQ-0159's hand-picked band.

## 3. Item C — PROJECT.md rule text

PROJECT.md is user-owned (LLM agents must not edit it). The rule text for the port scheme
has been handed to the user to paste; this REQ does not touch PROJECT.md.

## 4. Frozen contract

- Item A may touch `client/src/schedule/DismantlePanel.tsx` and/or `client/src/store/*`
  ONLY as far as the pinned mechanism requires, plus its test. No unrelated UI work.
- Item B touches `tools/*` and `client/e2e/*.config.ts` only.
- REQ-0156's `ALLOW_DEV_CLEAR` gate stays untouchable.
- e2e stays serialized through `tools/e2e_run.sh`'s box lock.
- No `test.skip` / `test.fail` / serial-mode quarantine to reach green.

## 5. Acceptance criteria

- **Order-independence**: the dismantle spec passes STANDALONE (`--grep`) and in full-file
  order, at `E2E_PARALLEL` unset / 1 / 4. Two consecutive full default-suite runs at
  0 failed / 0 flaky.
- The class-A mechanism is documented with evidence (what was actually stale, and why),
  and the fix is that mechanism's — not a forced re-render.
- `bash tools/ci.sh` exits 0 end-to-end, harness step green.
- No port literal remains in any harness; `check_e2e_ports` fails a deliberately
  out-of-decade port (prove the guard has teeth, don't just assert it does).
- Chaining all three harnesses back-to-back is green from a cold box AND immediately
  after each other.

## Execution log & amendments

(to be written during implementation)
