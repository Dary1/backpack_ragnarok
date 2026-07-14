# REQ-0172 — E2E order-independence (dismantle seed) + REQ-derived harness ports

**Reserved:** 2026-07-14 · **Slug:** e2e-order-independence-and-harness-ports
**Origin:** user directive 2026-07-14, immediately after REQ-0159 merged+deployed:
"明らかな問題を修正するREQを立てて" + the port-scheme proposal ("8000+REQ番号とか" →
refined to REQ*10 + index) + "自動化させられたりしますかね".
**Filed to:** `todo/` (cleared to implement on the same directive).

## 日本語サマリ

REQ-0159 が持ち込んだ回帰の修正 + ポート規則の機械化。(A) workshop の dismantle テストが
実行順序依存になっていた(ファイル全体なら緑、単体なら赤)。**当初これを「2つ目のクライアント
バグ」と見立てたが、それは誤りだった** — パネルは正しく再描画しており、真因は REQ-0159 の
シードが**不整合なキャンバス**を作っていたこと(在庫の home を消しながらキャンバス側の参照を
残し、エンジンが正しく home を復元していた)。(B) ハーネスのポートを **REQ番号×10+index** で
導出し、導出ヘルパ + lint + 起動前チェックで手選びの余地をなくす。

## 1. Item A — the dismantle spec was order-dependent (REQ-0159 regression) — **CLOSED**

### The symptom

REQ-0159 left the workshop dismantle spec green in full-file order and RED standalone
(`--grep`), at any worker count, and red in serial-live too. Pre-REQ-0159 it passed
standalone. `tools/ci.sh` was green — but that green was **order-dependent**, which is the
exact property REQ-0159 claimed to have retired. Owned and fixed here.

### The wrong hypothesis (recorded on purpose)

This REQ was originally filed asserting a **second real client bug**: "after the last item
is destroyed the panel keeps rendering the destroyed row". **That was wrong**, and it is
recorded here rather than quietly deleted, because it is the kind of plausible-but-false
story that gets a healthy component "fixed" and a real defect buried.

Ruled out, in order, each with evidence: a stale in-flight auto-save resurrecting the item;
`migrateState` re-injecting a legacy `loc:'inv'` PO (it de-dupes — `st.pos = st.pos.filter(...)`);
a broken store subscription (`useGameStore` is a textbook `useSyncExternalStore`);
`loadGame()` erroring or early-returning (browser console captured: no warning, no pageerror);
the served bundle (byte-identical md5 to the deployed one); worker count; and HTTP caching
of the canvas GET (adding `cache: 'no-store'` changed nothing).

### The actual mechanism (pinned)

Instrumenting the panel's own render settled it — the panel refreshes **exactly as
designed**:

```
DBGPANEL sv=0 items=e2e_dismantle_po_1:blade|p900:blade  topPos=p900:blade:grid
DBGPANEL sv=1 items=p900:blade                            <- stateVersion bumped, list shrank
```

`stateVersion` 0→1 and the inventory 2→1 across the dismantle: `loadGame()` propagated
correctly. The seed was simply producing **two** dismantlable blades where the test assumed
one.

`p900` is a blade sitting on the **squad canvas** (`pos[].loc === 'grid'`) whose **home**
lives in inventory — the REQ-0033 reference model, working as designed. REQ-0159's seed
cleared the inventory homes but left that canvas reference behind, leaving a reference with
no home, so the engine correctly **restored** p900's home on load. The dismantle removed the
seeded blade; p900 remained; the picker never went empty. In full-file order an earlier test
happened to replace the whole canvas first, so p900 was gone and it passed — luck of
ordering.

### The fix

A canvas with references but no homes is not a state the game can hold, so seed a state it
CAN: `seedDevBladePo` now builds a **clean, self-consistent canvas from scratch** instead of
deriving one from whatever the live dev profile holds. The blade is the only dismantlable
item BY CONSTRUCTION, in any order, on any box. `seedDevBladePos` (REQ-0090 multi-select)
carried the identical latent trap — restored homes would silently shift the contiguous row
indices its drag/Shift/Ctrl range assertions depend on — and is fixed the same way.

REQ-0159's guard (the picker must really empty AND the toast must really survive) is kept
intact. It is what caught this.

**No client/src change was needed.** REQ-0159's DismantlePanel toast fix stands and is live.

### Result (measured on the DEPLOYED bundle, master @ ee93a2d)

| mode | before | after |
|---|---|---|
| `E2E_PARALLEL=1`, full file | fail | **10 passed** |
| `E2E_PARALLEL=4`, standalone `--grep` | fail | **1 passed** |
| `E2E_PARALLEL=0` (serial, live API), standalone | fail | **1 passed** |

Commit: `bf1b8af`.

### Lesson (the one worth keeping)

Deriving a fixture from live state is not a shortcut, it is a coin flip: the suite's coverage
gets decided by whatever debris the profile happens to hold. REQ-0159 already caught this
once (the dismantle toast bug only reproduced when the dev profile happened to be empty) and
then walked straight into the mirror image of it. **Fixtures must be constructed, not
inherited.** That is the standing rule this REQ buys.

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
