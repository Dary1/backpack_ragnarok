# REQ-0352 — Reconcile `monster_pack` and connect it to serving (and rule on who owns `powerLevel`)

**Status:** Todo (cleared to implement; the one open decision — `powerLevel`
ownership — is RULED in §5, not deferred)
**Reserved:** 2026-07-31
**Slug:** monster-pack-serving-reconcile
**Origin:** REQ-0348 §4 scope note; `services/core.cjs:269`'s own warning
**Depends on:** REQ-0306 for the deploy hook, but see §5.4 — this REQ does **not**
have to wait for it. **Related:** REQ-0353 (the same root cause, other kinds).

---

## 1. Do not "just add the string"

`services/core.cjs:269` `REGISTRY_KINDS` lists 10 kinds; `routes/content.cjs:24`
`KINDS` lists 11. `monster_pack` is the odd one out, and core's comment already
says so: *"it is in routes/content.cjs KINDS TOO (monster_pack is in that list and
not this one, so its adoptions never reach serving; do not repeat that)"*.

That comment describes the gap as a simple omission. **It is no longer one.**
Measured against the live DB and live content on 2026-07-31:

| | live file `content/live/dungeon/packs.json` | adopted registry variant |
|---|---|---|
| `pack_frost_scouts` | **16** members, `powerLevel 4.5769` | **2** members, no `powerLevel` |
| `pack_rime_choir` | **16** members, `powerLevel 3.9038` | **3** members, no `powerLevel` |
| `pack_bear_and_stalker` | **15** members, `powerLevel 7` | **2** members, no `powerLevel` |
| `pack_hrimgrimnir` | **15** members, `powerLevel 9.7372` | **1** member, no `powerLevel` |

14 `monster_pack` defs exist, **all 14 adopted**, and **all 14 drifted**. Every
one still has exactly ONE variant (`variant_no=1`) — the original REQ-0184 port.
The registry has not been touched since. Everything after it went to the FILE
only:

- `9e4b5fed` REQ-0184 — the port (small packs) → file **and** registry
- `3c3a7856` REQ-0297 — `powerLevel` into live `packs.json` → file only (the
  commit message's "+ registry" means `content/registry.json`, the sha marker —
  **not** the DB registry; verified: no variant carries `powerLevel`)
- `16bbc900` REQ-0299 — recalibrate `powerLevel` → file only
- `505b1baf`, `ee0bad3d` REQ-0303 — **member edits** (fill sub-30% packs;
  frost packs → frost_giant boss + entourage) → file only
- `635d55a5` REQ-0303/0297 — recalibrate → file only

**So adding `'monster_pack'` to `REGISTRY_KINDS` today would replace every served
pack with its 1-3-member 2026-07-15 ancestor and delete `powerLevel` from all of
them.** Every dungeon encounter in the game would shrink, and
`sim/lib/level_scale.cjs:84` (`if (!Number.isFinite(powerLevel)) return 0`) would
silently turn off level scaling for every pack. A one-line change, a gutted game,
and no test would catch it — the `monster_pack` kind is not in
`tools/verify_content_registry_parity.cjs`'s `COVERED` list either (§6).

## 2. Goal

`monster_pack` adoptions reach the game, without the above.

## 3. Direction of truth: the FILE wins

The file is what the game plays, what REQ-0303 deliberately edited, and what
`autobalance_pack_powerlevel.cjs` calibrated against. The registry variants are a
2026-07-15 snapshot nobody has looked at since. So the reconciliation is
**re-port the live file's packs into the registry as new variants and adopt
them**, not the reverse. Re-use `tools/backfill_content_registry.cjs` (it already
knows the monster_pack shape) rather than writing a new porter.

## 4. Ordering — the gate must exist BEFORE the wire

1. Add `monster_pack` to `tools/verify_content_registry_parity.cjs`'s `COVERED`
   (file: `content/live/dungeon/packs.json`). It will immediately report 14
   DRIFT. **That is the point** — the instrument must show the problem before
   anything is changed.
2. Re-port + adopt (§3). The gate goes to 14 MATCH.
3. Only then add `monster_pack` to `REGISTRY_KINDS`, with the §5.3 merge.
4. A CI gate asserting the three kind lists agree (§6).

Doing 3 before 1-2 is the failure mode this whole REQ exists to prevent.

## 5. RULING — `powerLevel` is DERIVED, not authored

**The registry never stores `powerLevel`. `tools/autobalance_pack_powerlevel.cjs`
is its sole writer.**

### 5.1 Why

1. It is a pure function of other content — an all-pairs round-robin arena over
   (skills, monsters, pack membership). REQ-0297 defines it that way and
   `tools/autobalance_pack_powerlevel.cjs:11-33` describes the loop that derives
   it (mean is conserved at 0; no reference pack, no re-anchoring).
2. REQ-0306 (todo, ratified) regenerates **every** `pack.powerLevel` in one batch
   at deploy when the pack domain is dirty. A hand-authored value would be
   silently overwritten at the next deploy — the worst kind of field to put in
   front of an operator.
3. Absence is already a defined, safe state: `sim/lib/level_scale.cjs:84`
   returns effLevel 0 (no scaling, byte-identical to pre-REQ-0297) for a pack
   with no `powerLevel`.
4. Therefore today's adopted variants lacking `powerLevel` is **correct, not
   stale**. Under this ruling the only real drift in §1 is `members`.

### 5.2 What the registry DOES own for a `monster_pack`

`id`, `name`, `i18n`, `note`, `members` — the authored facts. Nothing else.
`monster_pack/1`'s schema/content-checks should reject `powerLevel` in a variant
rather than accept-and-ignore it, so the rule is enforced where it is authored,
not discovered at deploy.

### 5.3 The consequence the wiring must respect: MERGE, not REPLACE

Every other kind's overlay is `overlayMap(fileMap, registryEntries, transform)` —
a whole-entry **replace** (`services/core.cjs:345-349`). For `monster_pack` that
would drop the derived `powerLevel`. So this kind needs a merge that layers the
registry's authored fields over the file entry and leaves derived fields intact:

```js
// monster_pack is the one kind whose served entry has TWO writers: the registry
// (authored: members/name/i18n/note) and autobalance (derived: powerLevel, per
// REQ-0352 section 5). A whole-entry replace would delete the derived half and
// silently zero effLevelForPack for every pack.
monsterPackDefsById: overlayMap(fp.monsterPackDefsById, reg.monster_pack,
  (raw, base) => Object.assign({}, base, raw)),
```

`overlayMap`'s transform signature currently takes only `(entry)`; it needs the
base entry too. That is a small, contained change — and it is the whole
technical content of this REQ.

### 5.4 Relationship to REQ-0306

Independent, in either order. REQ-0306 automates *when* the deriver runs;
this REQ rules *who may write the field at all*. Doing this one first is in fact
better: REQ-0306's dirty-trigger keys off content edits, and after this REQ a
`monster_pack` edit lands in the registry where the trigger can see it as a
first-class content mutation rather than a hand-edited file.

## 6. The fourth list

The audit found three hard-coded kind lists that must agree. There is a **fourth**:
`tools/verify_content_registry_parity.cjs:39-55` `COVERED`, which also omits
`monster_pack`. That is why 14 drifted packs have been invisible. Add a CI check
that `KINDS` ⊇ `REGISTRY_KINDS` ⊇ display kinds, and that `COVERED` matches
`REGISTRY_KINDS` — one assertion, and this class of bug stops recurring. This is
the same assertion REQ-0353 wants; whichever lands first should write it.

## 7. Gates

1. `tools/verify_content_registry_parity.cjs` with `monster_pack` covered:
   14 DRIFT before the re-port, **14 MATCH after**.
2. A test that a served pack retains BOTH halves: the registry's `members` and
   the derived `powerLevel`. Assert `effLevelForPack` is non-zero for a
   calibrated pack after the overlay — the §5.3 failure mode, pinned.
3. `sim` replay goldens: the re-port must be a no-op for the sim (the registry
   is being made to match the file, so nothing the sim reads should move). A
   golden change here means the re-port was wrong.
4. `STORAGE_BACKEND=pg node server/tests/api_test.cjs`, `schedule_serving_test`,
   `content_serving_test`, and REQ-0348's `registry_overlay_test`.
5. `tools/ci.sh` full run.

## 8. Status log

- 2026-07-31 — reserved and specced into `todo/` at the user's request. The
  `powerLevel` ownership question was delegated by the user and is RULED in §5
  rather than deferred. Evidence gathered against the live DB + live content at
  `master` `e4b24dd0`.
