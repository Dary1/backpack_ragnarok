# REQ-0353 — LIVE DEFECT: 44 monsters are missing their REQ-0299 flavor skills in-game

**Status:** Todo (cleared; this is a defect report with a measured symptom, not a
design question)
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

## 9. Status log

- 2026-07-31 — reserved and specced into `todo/`. Filed unprompted: it is a live
  defect found while investigating REQ-0352, and leaving it in chat only would
  have lost it. Evidence gathered against the live DB + live content at `master`
  `e4b24dd0`; no code change of mine is involved (REQ-0348 was byte-parity
  verified against this same data).
