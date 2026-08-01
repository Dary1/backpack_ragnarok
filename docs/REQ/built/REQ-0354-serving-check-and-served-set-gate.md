# REQ-0354 — A `serving` check tag in contentadmin, and a "served set == passing set" gate

**Status:** Built (all gates green; awaiting merge/deploy + user acceptance)
**Reserved:** 2026-07-31
**Slug:** serving-check-and-served-set-gate
**Origin:** user proposal, 2026-07-31 chat — *"contentadmin がタグを出力していますよね。あそこ
に、参照されるべきものなのに何もしていないとかのテスト結果を出して、その結果が通っていない
状態で live に出力されていたらオカシイ、とかにできませんか？"* — plus the user's ruling to
carry the live-file sha for staleness.
**Depends on:** nothing. **Related:** REQ-0352, REQ-0353 (this REQ is the mechanism
that would have caught both; those two are the data they left behind).

---

## 1. Problem

Three distinct "adopted but inert" conditions exist on live today and none is
visible where the operator works:

| condition | live count (2026-07-31) | today's visibility |
|---|---|---|
| **NOT WIRED** — the kind is not in `services/core.cjs:269` `REGISTRY_KINDS`, so adoption can never reach the game | `monster_pack`, 14 defs | none |
| **DRIFT** — adopted variant ≠ live-file entry | 44 `monster_def` + 1 `gacha_pack` | a deploy-time CLI nobody runs |
| **MISSING** — a live-file entity with no `content_def` at all | 64 `skill_def` | same CLI |

`tools/verify_content_registry_parity.cjs` detects DRIFT/MISSING correctly and
ends with `STOP: surface to the user`. It has been printing that to nobody: it is
a deploy-time tool, and `tools/ci.sh` runs only its DB-free *classifier unit
test*. The instrument was never the problem — its placement was.

## 2. The right home: the existing check-row pipeline

`runChecks()` (`server/services/content_checks.cjs:694`) returns
`{ checks: [{name, ok, applicable, detail}], overall, ran_at }`. The client
already renders those rows generically:
`client/src/contentadmin/ContentAdminPage.tsx:437` maps `machine_check.checks`,
`VariantCard.tsx:84` and `Workspace.tsx:210` read them, `dex/RegistryBadge.tsx`
shows the verdict. **Adding one row needs zero client work.**

There is also precedent for a row that is NOT from the pure runner:
`routes/content.cjs:161` `withDbTierChecks()` appends `artSlotCheck`'s row after
the fact and recomputes `overall`. The `serving` row follows that same
appended-tier shape.

DB-freeness is preservable: the row needs (a) the serving kind list — a constant
— and (b) the live-file entry for this `system_name`. `integrateCheck` already
reads `content/live` via `contentLiveManifest()`, so this adds no new dependency
class.

## 3. THE STALENESS TRAP — and the sha that closes it

**This is the part that makes the difference between a fix and a re-run of the
same bug.**

Every existing check is a pure function of the variant's **own** data. Variants
are immutable, so a stored result stays true forever. That is why persisting
`machine_check` is safe today.

A serving/drift check is a function of **the variant AND the live files**. The
files change without the variant changing. So a naively-stored `PASS` goes
silently false — *exactly the failure mode this REQ exists to eliminate*, rebuilt
inside the checking mechanism itself.

**Ruling (user, 2026-07-31): carry the live-file sha.** The check result records
the sha256 of the live file it was computed against; on read, a mismatch against
the current sha renders as **STALE** — a third state, neither PASS nor FAIL.

Both halves already exist in the tree:

- `contentLiveManifest(root)` (`content_checks.cjs:573`) already returns
  `{relative_path -> sha256}` for everything under `content/live`. The check
  needs one entry from it, not a new mechanism.
- The "computed against this sha" marker is an established idiom here:
  REQ-0297's `powerlevel_calibrated_from` is the same pattern, and REQ-0306's
  dirty-trigger is built on comparing it. This is consistent with, not novel to,
  the codebase.

STALE must be visually distinct from PASS. A stale green is worse than a red,
because it is the state that produced REQ-0353.

## 4. RULING — `serving` must NOT feed `overall`

Non-obvious and load-bearing, so it is stated before the design:

`routes/content.cjs:348-350` gates **adoption** on `overall === 'FAIL'` → 409
`NEEDS_OVERRIDE`. And per REQ-0155's design the DB is the source of truth:
adoption is followed by an export into `content/`. **So a freshly adopted variant
legitimately differs from the live file until the export lands.**

If the `serving` row fed `overall`, every normal adoption would 409, operators
would learn to always send `override: true`, and that flag also bypasses
`schema_vocab` / `engine_types` / `integrate` / `formation_fill`. The tag would
have made the real checks weaker.

So: **`serving` is advisory. It renders as a row, it drives the gate in §6, and
it never changes `overall`.** Implementation: an explicit `advisory: true` flag
on the row, and both `overall` computations
(`content_checks.cjs:707`, `routes/content.cjs:164`) skip advisory rows.
Do NOT express this by abusing `applicable: false` — that field means "this check
does not apply to this kind", which is a different fact and is shown differently.

## 5. Where each of the three conditions belongs

| condition | surface | why |
|---|---|---|
| **DRIFT** | per-variant `serving` row, with the §3 sha | genuinely a property of *this* variant vs *this* file. The main event. |
| **NOT WIRED** | **per-kind banner**, not a per-def row | a property of the KIND. 14 identical red rows across 14 variant cards adds no information and buries the DRIFT reds that do. |
| **MISSING** | per-kind corpus report row (`skill_def: 64 in files, absent from the registry`) | **cannot be a variant tag — there is no variant to hang it on.** This is the one the user's phrasing points at most directly, and the one the tag mechanism structurally cannot carry. |

The NOT WIRED banner-vs-row call is a contentadmin UX judgement; ruled as above
for the reason given, and it is a cheap flip if the owner prefers otherwise.

## 6. The gate — the half that actually enforces

A tag makes drift *visible*; visibility is what already failed. The invariant:

> **the set of entities the game serves == the set whose `serving` check passes**

as a CI/deploy assertion. That one line catches all three conditions in §1, and
also the kind-list disagreement the audit found — there are **four** hard-coded
kind lists that must agree and today they do not:

- `routes/content.cjs:24` `KINDS` — 11
- `services/core.cjs:269` `REGISTRY_KINDS` — 10
- `lib/content.cjs:312` display sections — 5 (a legitimate subset, post-REQ-0348)
- `tools/verify_content_registry_parity.cjs:39-55` `COVERED` — omits `monster_pack`

Assert `KINDS ⊇ REGISTRY_KINDS ⊇ display`, and `COVERED == REGISTRY_KINDS`.
REQ-0352 §6 and REQ-0353 §6 both want this; whichever lands first writes it and
the others reference it.

## 7. Rulings

1. **Carry the live-file sha; mismatch = STALE, a third state.** (user)
2. **`serving` is advisory and never feeds `overall`** — §4.
3. **NOT WIRED is a per-kind banner; MISSING is a per-kind report row; only
   DRIFT is a per-variant tag** — §5.
4. **The gate is the enforcement; the tag is the visibility.** Ship both or
   neither — a tag alone repeats REQ-0353's history.

## 8. Scope

**In:** `server/services/content_checks.cjs` (the `serving` check + sha),
`server/routes/content.cjs` (append the row, advisory-aware `overall`, the
per-kind banner/report data on the list endpoints),
`client/src/contentadmin/*` (STALE styling + banner + report row),
`tools/verify_content_registry_parity.cjs` (`COVERED` completeness), a CI stage
for §6.
**Out:** reconciling the actual drifted data (REQ-0352, REQ-0353 — this REQ makes
them *visible*, it does not fix them); any schema change; the `powerLevel`
ownership question (ruled in REQ-0352 §5).

## 9. Gates

1. Against live data as it stands, the new tag must light up **exactly** the
   conditions §1 lists: 14 NOT WIRED, 45 DRIFT, 64 MISSING. Anything else means
   the check disagrees with `verify_content_registry_parity.cjs`, and one of the
   two is wrong.
2. **Staleness has teeth:** compute the row, then mutate a live file, then read
   again without re-running checks — must report STALE, not PASS. This is the
   §3 trap, pinned.
3. **Adoption is not blocked:** adopt a fresh variant that differs from the live
   file — must succeed WITHOUT `override:true` (the §4 ruling). If this test is
   ever "fixed" by adding the override, the tag has broken the real checks.
4. The §6 gate fails on today's tree and passes once REQ-0352/0353 land — it is
   allowed (expected) to be red until then, so land it behind a flag or land it
   after them. Record which.
5. `tools/ci.sh` full run; contentadmin e2e (`tools/content_admin_e2e.sh`).

## 10. Risk

The moment this ships, ~58 defs go red/amber in contentadmin at once. That is
correct and is the point, but it is also the classic moment a team decides the
new check is "too noisy" and mutes it. Land it together with, or immediately
before, the REQ-0352/0353 reconciliations so the red is short-lived and visibly
actionable rather than ambient.

## 11. Status log

- 2026-07-31 — reserved and specced into `todo/` at the user's request. The
  live-file-sha staleness marker is the user's ruling; §4 (advisory, never feeds
  `overall`) was found while checking the adoption gate and is the correction
  that keeps the tag from weakening the existing checks. Evidence gathered
  against the live DB + live content at `master` `e4b24dd0`.
- 2026-08-01 — built on `req-0354-serving-check-and-served-set-gate` (code
  `9e029881`, tree == CI receipt `5e8144fc`). REQ-0352/0353 landed between spec
  and build; premise deltas + gate reinterpretation recorded in §12. Moved
  `todo -> built`.

---

## 12. Build record (2026-08-01)

**Code:** `9e029881` on `req-0354-serving-check-and-served-set-gate`
(tree `5e8144fc` == the CI receipt). Full diff: +270/-29 across
`server/services/content_checks.cjs`, `server/routes/content.cjs`,
`tools/verify_content_registry_parity.cjs`, `tools/release.sh`, `tools/ci.sh`,
`server/tests/serving_check_test.cjs` (new), `server/tests/contentagg_test.cjs`,
and the contentadmin client (api types, VariantCard, ContentAdminPage, css).

**The world moved between spec and build.** This REQ was specced 2026-07-31
against `e4b24dd0`; REQ-0352 and REQ-0353 landed and deployed 2026-08-01
(merge order 0348 -> 0352 -> 0353), which changed three of this spec's premises:

1. §1's three live conditions (14 NOT WIRED / 45 DRIFT / 64 MISSING) were
   **reconciled before this build** — live parity is now MATCH=413, all other
   counts 0. Gate 1's exact-count assertion is therefore unreproducible as
   written; its intent ("the tag agrees with the parity tool") was verified
   instead — see gates below.
2. §6's kind-list assertions were landed by REQ-0352 as
   `server/tests/kind_lists_agree_test.cjs` (this REQ references it, per the
   spec's own "whichever lands first writes it" clause), including
   `COVERED == REGISTRY_KINDS` — so the §8 "COVERED completeness" item was
   already done.
3. Gate 4's flag question resolved itself: with 0352/0353 landed the §6 gate
   is green on today's tree, so it lands **UNFLAGGED** (recorded in
   `tools/release.sh`'s comment).

**What this REQ therefore built** (the §5/§7 mechanism, unchanged):

- `serving` check row (content_checks.cjs `servingCheck`): DRIFT-vs-live-files
  per variant, kind->file mapping required from the parity tool's `COVERED`
  (never re-derived; kind_lists_agree_test pins it to REGISTRY_KINDS).
  `advisory: true` — never feeds `overall` (§4), enforced by the ONE rule
  `overallOf()` used by both computations (runChecks + the appended tier).
- §3 ruling: the row carries `live_files[] = {file, sha256}`;
  `annotateServingStaleness()` re-hashes on READ (def detail, public meta) and
  a mismatch renders `stale: true` -> the client shows **STALE** (dotted gold,
  deliberately neither the pass green nor the fail red).
- §5 split: NOT WIRED = kind-level banner; MISSING = kind-level report row
  (both from `serving_report` on the list endpoint); only DRIFT is per-variant.
- §6 gate: `verify_content_registry_parity.cjs --strict` (`strictOk`):
  DRIFT / MISSING-IN-REGISTRY / UNADOPTED all block. Wired into
  `tools/release.sh` (the REQ-0353 gate slot, now strict) — the release path
  is the enforcement point; `ci.sh` gets the DB-free stage [4.657/7].

**Gates:**

1. (reinterpreted, see above) Live agreement probe: for all 413 parity rows,
   `servingCheck(adopted)` verdict == parity verdict — **agree=413,
   disagree=0**. The three original conditions are pinned by DB-free fixtures
   instead (serving_check_test: DRIFT names fields; MISSING wording;
   NOT WIRED honest n/a; monster_pack derived-strip never false-drifts).
2. **Staleness has teeth — green.** serving_check_test: computed PASS row,
   mutated the live file, re-annotated WITHOUT re-running -> STALE, not PASS.
3. **Adoption not blocked — green.** overallOf unit half (failing advisory row
   -> overall PASS) + route level: contentadmin e2e adopts a fresh def (absent
   from live files, serving row FAIL) without override — 28/28 passed.
4. Landed **unflagged**; green on today's tree: live
   `--strict` run = MATCH=413 DRIFT=0 MISSING=0 UNADOPTED=0, **STRICT OK**.
5. Full `tools/ci.sh` CI_SCOPE=both: **CI GREEN** (346.9 s), receipt written
   (tree `5e8144fc`). contentadmin e2e 28 passed; client build tsc clean,
   lint 0 errors.

**§10 risk note, updated:** the predicted ~58 red/amber wave cannot happen —
0352/0353 landed first, so the tag arrives on an already-clean corpus and reds
only appear when NEW drift is introduced (which is exactly when they should).

## Deploy record (2026-08-01)

- Merged to master as `1009b500` (--no-ff; web/app resolved to the pre-merge
  master dist -- both sides carried CI dist rebuilds -- and regenerated by the
  release right after; stray `bot/pnpm-lock.yaml` dropped).
- Released via the combined `tools/release.sh` run on the merged master
  (`/tmp/rel_final.log`, shared with the REQ-0355/0356/0357 wrap-up session,
  EXIT=0): **the very first thing that run printed was this REQ's own
  `--strict` gate passing on live** (MATCH=413 DRIFT=0 MISSING=0 UNADOPTED=0,
  STRICT OK) -- the section-6 enforcement is now demonstrably ON the release
  path. Full CI GREEN (365 s), receipt tree `1e8f7139`, dist committed
  `4c1cd6ec`, pushed to origin.
- `backpack-api` restarted 10:12 UTC; backpack-web / backpack-tunnel active.
- Live verification: local :8802 and https://backpack-dev.qtie.jp both serve
  `/api/content` 200; `/api/content/frost_gnoll/meta` 200 with machine_check
  (existing variants grow their `serving` row on next recheck/ingest, by
  design -- stored rows are immutable history until re-annotated).
- Deployed; `built -> done` awaits user acceptance.
