# REQ-0353 — LIVE DEFECT: 44 monsters are missing their REQ-0299 flavor skills in-game

**Status:** Built (all gates green; DB reconciliation applied to live; release.sh gate awaits merge)
**Reserved:** 2026-07-31
**Slug:** registry-live-file-drift-live-defect
**Origin:** found while specifying REQ-0352; the standing drift gate was run and
is RED
**Related:** REQ-0352 (same root cause, the `monster_pack` half), REQ-0351.

---

## 1. Symptom, measured

`tools/verify_content_registry_parity.cjs` — the tool whose own header calls it
*"the standing drift check the deploy runs on LIVE before the cutover restart"* —
run against the live DB and live content on 2026-07-31:

```
totals: MATCH=283 DRIFT=45 MISSING-IN-REGISTRY=64 UNADOPTED=0
DRIFT DETECTED -- a live-file entry diverges from its adopted registry variant. STOP: surface to the user.
```

- **45 DRIFT** = 44 × `monster_def` (field: `skills`) + 1 × `gacha_pack arsenal`
  (field: `pool`)
- **64 MISSING-IN-REGISTRY** = `skill_def`s that exist in the live files and have
  no `content_def` at all (`troll_regeneration`, `orc_cleaving_riposte`,
  `medusa_stone_gaze`, … — the REQ-0299 flavor-skill set)

`monster_def` **is** registry-served (`services/core.cjs:269`), so for this kind
the registry WINS and the file loses. Confirmed end-to-end against a warm
snapshot:

```
frost_gnoll   LIVE FILE  skills: ["gnoll_claw","gnoll_snap"]
              REGISTRY   skills: ["gnoll_claw"]
              SERVED     skills: ["gnoll_claw"]      <- what the game uses
```

**`gnoll_snap` — and its 43 siblings — never reach the game.** REQ-0299 added 44
flavor skills to the live files; the registry never received them; the registry
is what is served. The content exists in the repo and is inert in play.

(Note the cold/warm subtlety when reproducing: before the boot snapshot warms,
`getScheduleContent()` returns the FILE version, so a naive probe reports the
file value and looks fine. `await core.refreshRegistryData()` first.)

## 2. Why nothing caught it

The drift gate is a **deploy-time tool**, not a CI stage. `tools/ci.sh` runs
`DATABASE_URL= node server/tests/verify_content_registry_parity_test.cjs` — the
unit test of the *classifier*, deliberately DB-free. Nothing runs the tool
against live data on a schedule, so its "STOP: surface to the user" has been
printing to nobody.

## 3. Root cause

The registry and the live content files are **two writable sources for the same
data**, and the sync between them is manual. Three of the last four content REQs
wrote only one side:

- REQ-0299 added flavor skills to the files; no `content_def` was created →
  64 MISSING, and 44 `monster_def.skills` DRIFT as a consequence
- REQ-0303 edited `packs.json` members directly → REQ-0352's 14 drifts
- REQ-0297/0303 recalibrated `powerLevel` into the file → correct, and REQ-0352
  §5 rules that this one is *supposed* to be file-side only

## 4. Scope

**In:** reconciling the 45 DRIFT + 64 MISSING (direction per §5); making the
drift gate impossible to not-run (§6). **Out:** `monster_pack` (REQ-0352); the
`invalidateServedContent` collapse (REQ-0351); any schema change.

## 5. Direction of truth: the FILE wins, again

Same argument as REQ-0352 §3 — the files are what the content REQs actually
edited and what the balance tooling calibrated against. So: create the 64
missing `skill_def` content_defs, re-port the 44 `monster_def`s and
`gacha_pack arsenal` from the live files as new variants, adopt them.
`tools/backfill_content_registry.cjs` already does this shape of work.

**Do not "fix" it by removing `monster_def` from `REGISTRY_KINDS`.** That would
make the game serve files again and mask the problem; registry-first serving is
REQ-0176/0178's ratified design.

## 6. Make the gate unmissable

Pick one, and record which:

- **(a)** run `verify_content_registry_parity.cjs` as a real deploy step
  (`tools/release.sh` / the deploy checklist), failing the deploy on DRIFT.
  Matches the tool's stated purpose. **Recommended.**
- **(b)** additionally, a scheduled/`--check`-style run so drift is noticed
  between deploys rather than at one.

Also add the kind-list agreement assertion REQ-0352 §6 describes — `COVERED` in
the parity tool is a fourth hard-coded kind list and it omits `monster_pack`,
which is why REQ-0352's 14 drifts never showed up in the numbers above either.

## 7. Gates

1. `tools/verify_content_registry_parity.cjs` against live: **0 DRIFT,
   0 MISSING-IN-REGISTRY**.
2. A gameplay assertion that the reconciliation actually landed: `frost_gnoll`'s
   served skills include `gnoll_snap`. Pick 2-3 more from the 44.
3. `sim` replay goldens WILL move — 44 monsters gain skills they did not have in
   play. That is the intended behaviour change; rebaseline deliberately and say
   so in the commit, do not wave it through.
4. `STORAGE_BACKEND=pg node server/tests/api_test.cjs` + the serving trio.
5. `tools/ci.sh` full run.

## 8. Risk note

This is the largest behaviour change of the three REQs in this family: 44
monsters gain a skill each. It should ship alone, with the golden rebaseline as
its own commit, and it wants a balance look after — the flavor skills were
calibrated for by REQ-0299/0303's `powerLevel` runs, which were computed from the
FILES, i.e. from the roster that includes these skills. So post-fix the game
should match what the calibration already assumed — but that is a claim to
verify, not to assert.

## 8b. Addendum (2026-08-01, found by REQ-0352): the `dungeon` kind is drifted too

REQ-0352's COVERED completion (gimic + dungeon joined the parity tool per the
shared section-6 gate) measured against live: **3 `dungeon` DRIFT, field
`baseDifficulty`** (niflheim_depths=1, grave_hollows=15, beastreach_wilds=16 in
the file; ABSENT from every adopted variant). gimic is 4/4 MATCH.

Same root cause as this REQ: REQ-0293/0295 sim-calibrated `baseDifficulty`
into `content/live/dungeon/dungeons.json` only (tool:
`tools/calibrate_base_difficulty.cjs`); the registry variants are the REQ-0185
port and never received it; `dungeon` IS registry-served, so **the calibrated
difficulty is not in effect live** — every dungeon runs at the neutral g=1.0.

Resolution belongs HERE, and needs one ruling first: is `baseDifficulty`
authored (re-port file→registry, REQ-0353-style) or derived like
monster_pack.powerLevel (REQ-0352 section 5: calibration-tool-owned, file-side
only — in which case the dungeon overlay must become a MERGE like
monster_pack's, or the field still never serves)? The powerLevel precedent
argues derived; either way parity-green must coincide with the value actually
reaching the sim, not precede it.

## 8c. Rulings (user, 2026-08-01)

- **Section 8b — `baseDifficulty` is AUTHORED.** User ruling, verbatim intent:
  baseDifficulty is a FIXED value the dungeon owns; monster_pack.powerLevel is
  the investigated/derived one; the pack level at spawn = baseDifficulty −
  powerLevel. So baseDifficulty re-ports file→registry like any authored field
  (no dungeon-overlay MERGE; the powerLevel precedent does NOT extend to it).
- **Section 6 — choice (a).** The parity tool runs inside `tools/release.sh`
  against the live DB; DRIFT fails the release, and a missing `server/.env`
  also fails it (a gate skippable by absent credentials is the not-run gate
  this REQ exists to fix). (b) scheduled runs: not added; can be added later
  if drift that bypasses the deploy path ever appears.

## 10. Build record (2026-08-01)

Branch `req-0353-registry-live-file-drift-live-defect`, stacked on
`req-0352-monster-pack-serving-reconcile` (its COVERED completion is what makes
the dungeon drift measurable; merge order is therefore 0348 -> 0352 -> 0353).
Commits: 12f7dfe2 (`--note` for reconcile provenance), 8fb53260 (release.sh
drift gate, section 6a), f7e949d0 (rulings recorded).

**What was applied to the LIVE DB** (via the existing tools; no schema change):
1. INSERT-ONLY backfill pass -> the 64 missing `skill_def` content_defs
   created + adopted (machine checks: 63 schema_vocab ok; the 1 FAIL is
   `e2e_faildef`, the deliberately-invalid e2e fixture -- pre-existing posture,
   backfill never blocks on live-by-definition content).
2. `--reconcile-kind monster_def` -> 44 re-ported v1->v2 + adopted (field:
   skills), checks PASS.
3. `--reconcile-kind gacha_pack` -> `arsenal` v1->v2 (field: pool); 3 match;
   4 foreign defs skipped (parity-MATCH, admin-created, correctly untouched).
4. `--reconcile-kind dungeon` -> 3 re-ported v1->v2 (field: baseDifficulty),
   per the 8c ruling (authored).

**Gates (section 7):**
1. Parity vs live: before MATCH=301 DRIFT=48 MISSING=64; after
   **MATCH=413 DRIFT=0 MISSING-IN-REGISTRY=0 UNADOPTED=0** (PARITY OK).
2. Served probe (post `refreshRegistryData()`): `frost_gnoll` serves
   `["gnoll_claw","gnoll_snap"]`; troll/medusa/behemoth serve
   `troll_regeneration` / `medusa_stone_gaze` / `behemoth_last_stand`; all
   64 flavor `skill_def`s resolve in `skillDefsById`; dungeons serve
   baseDifficulty 1 / 15 / 16. (Spec gate 2 named `lich_phylactery_chill`
   informally; the real lich flavor skill `lich_undying_will` serves.)
3. Sim replay goldens: **unchanged** (12 cases OK) -- the section-7 prediction
   that they would move was wrong in a good way: the sim reads the FILES, which
   have carried the flavor skills since REQ-0299, so the goldens (and the
   REQ-0299/0303 powerLevel calibration) already assumed this roster. The fix
   moves the SERVED game onto what the goldens already were. This verifies the
   section-8 balance claim rather than asserting it; no rebaseline needed.
4. `STORAGE_BACKEND=pg api_test`: 229 passed / 0 failed. Serving trio
   (content_serving 9, schedule_serving 13, registry_overlay) green on pg.
5. Full `tools/ci.sh` (CI_SCOPE=both): **CI GREEN**, 337 s, receipt written
   (tree 673d4861).

**Live-behaviour note:** monster_def/dungeon are wired registry kinds, so the
DB re-port is live at the next registry refresh/restart -- 44 monsters gain
their flavor skill and the 3 dungeons their calibrated baseDifficulty without
a code deploy. That IS the defect fix (gate 3 shows play now matches what the
balance work already assumed). The release.sh gate (8fb53260) ships with the
normal merge train.

## 9. Status log

- 2026-07-31 — reserved and specced into `todo/`. Filed unprompted: it is a live
  defect found while investigating REQ-0352, and leaving it in chat only would
  have lost it. Evidence gathered against the live DB + live content at `master`
  `e4b24dd0`; no code change of mine is involved (REQ-0348 was byte-parity
  verified against this same data).

## Deploy record (2026-08-01)

- Merged to master as 27e8afbd (merge order REQ-0348 -> REQ-0352 -> REQ-0353).
- `tools/release.sh` on the merged master: the NEW REQ-0353 drift gate ran
  FIRST on the release path and passed (MATCH=413 DRIFT=0 MISSING=0), full CI
  GREEN (343 s), dist unchanged, receipt written (tree 855262cd).
- Pushed e4b24dd0..27e8afbd (push gate accepted the receipt);
  `backpack-api` restarted 03:49Z; backpack-web / backpack-tunnel active.
- Live verification: `/api/content` on 127.0.0.1:8802 AND
  https://backpack-dev.qtie.jp serves frost_gnoll `["gnoll_claw","gnoll_snap"]`,
  troll/medusa/behemoth flavor skills, and `monster_skills.gnoll_snap` resolves
  with i18n names. Deployed; `built -> done` awaits user acceptance.
