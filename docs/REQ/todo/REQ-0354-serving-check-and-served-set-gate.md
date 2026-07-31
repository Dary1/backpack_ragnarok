# REQ-0354 — A `serving` check tag in contentadmin, and a "served set == passing set" gate

**Status:** Todo (cleared; all decisions ruled in §7)
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
