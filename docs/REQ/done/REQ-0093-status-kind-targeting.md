# REQ-0093 — Status-kind targeting for `status_immune` / `bonus_vs_status`

> Status: **done — merged to master, deployed, live.**
> Implemented on branch `req-0093-status-kind-targeting` (commit `67fc334`,
> worktree `~/backpack_ragnarok_worktrees/req-0093-status-kind-targeting`).
> Merged into `master` on the main checkout (`~/backpack_ragnarok`) as a
> **fast-forward** to merge commit `2b20165` ("Merge master (REQ-0095..
> REQ-0106) into req-0093-status-kind-targeting" — made in the feature
> worktree first, master then fast-forwarded onto it, matching this
> project's established convention e.g. REQ-0092). `backpack-api.service`
> restarted 2026-07-08 19:03:53 UTC to load it; confirmed healthy
> (`GET /api/health` → `{"ok":true,"version":"0.1.0"}`, clean startup log,
> no errors). `backpack-web`/`backpack-tunnel` needed no restart (no
> web/client files touched by this REQ).
>
> **Revision 2 (same day): open questions resolved, implemented.** User
> answered all four blocking questions below (see "Resolved decisions").
> All cleared as the REQ's own proposed design (Rev.1) — no design changes
> resulted. Implemented per the "Implementation sketch" below with two
> scope notes flagged during build (see "Build notes / discrepancies").
>
> **Revision 3 (same day): merge + deploy.** Master had moved 17 commits
> ahead (REQ-0095 through REQ-0106) since this branch forked at `e1f0bdf` —
> notably REQ-0095 (player-side reactive dispatch, "OnHit taxonomy Phase
> 1b") touched `sim/lib/compile.cjs`, `sim/lib/encounter.cjs`, and
> `sim/tests/run.cjs`, the same three files this REQ also modified. Merged
> master into the feature branch first (`git merge master`, resolved via
> git's `ort` strategy with **zero conflicts** — the two REQs' edits landed
> in non-overlapping regions of each shared file); reran the full gate
> suite post-merge (74/74 `sim/tests/run.cjs`, byte-identical
> `sim/tests/goldens.cjs`) before touching master at all. The main
> checkout (`~/backpack_ragnarok`, otherwise HANDS-OFF per PROJECT.md) had
> unrelated REQ-0077 Rev.2 WIP sitting uncommitted (a different, larger
> vocab v7 touching the same `content/vocab.json`, plus
> `build_dungeon_preview.py`, batch-004 content, art proposals) — user
> confirmed (in-chat) to `git stash push -u` it out of the way rather than
> fold it in or hand-resolve a conflict; parked as
> `stash@{0}: "REQ-0077 Rev.2 WIP ... parked ahead of REQ-0093 merge,
> 2026-07-09"` on the main checkout, fully recoverable via `git stash pop`
> whenever REQ-0077 itself is picked up for its own merge. Then master
> fast-forwarded cleanly onto the (now master-inclusive) feature branch tip
> and gates were re-run a third time directly on master to confirm the
> fast-forward itself introduced nothing new.
>
> **Note on this file's status-folder transitions:** PROJECT.md's REQ
> policy prescribes `git mv`, one move per commit. Per commit `bc45ddd`
> ("docs: untrack + remove docs/ from repo — single-sourced on Cowork FS"),
> `docs/REQ/` is now deliberately un-git'd and FS-only — this predates and
> resolves the git-mv-unavailable flag Rev.0 of this file raised. This
> file moved `draft/ → built/ → done/` as plain filesystem moves (no git
> commit backs either), narrated here instead.
> Numbered 2026-07-07. **Renumbered twice, same day, before anyone else read
> it**: first drafted as REQ-0091 after scanning all `docs/REQ/*` folders
> (highest then was REQ-0090) — but a concurrent orchestrator session had,
> in the same window, independently claimed 0091 for an unrelated warehouse
> UI feature (`docs/REQ/reserved/REQ-0091-warehouse-claim-feedback.md`, a
> real stub, not a mistake to clean up). A second rescan turned up yet
> another concurrent claim, REQ-0092 (`docs/REQ/draft/REQ-0092-onhit-phase1b-player-si.md`
> — the REQ-0078-predicted Phase 1b follow-up). Landed here at **0093** after
> that second rescan found nothing higher. This is the exact collision mode
> PROJECT.md and REQ-0077's own header already warned about — evidently live
> and active this session, twice over. No dead-duplicate file was left
> behind for the 0091 misnumbering since nothing ever referenced it outside
> this same turn; renamed via plain filesystem move on the FS-side mount
> (no `.git` was detected there from this session's sandbox — `git rev-parse
> --is-inside-work-tree` failed at the mount boundary — so this rename could
> **not** go through `git mv` as PROJECT.md's REQ policy prescribes; flagged
> here rather than silently glossed over).
>
> **Revision 1 (same day, user feedback):** buff/debuff-only granularity was
> rejected as insufficient ("buff/debuffの粒度で十分ではないです。ちゃんと
> 作りこんでください"). Redesigned below to expose the full existing
> `STATUS_KIND` mechanical-kind axis alongside polarity, not just polarity
> alone. See "Proposed design" for the reworked, single-field, 9-value
> version.

## Background

REQ-0077 Rev.2 added two new verbs to `content/vocab.json` (v6→v7):
`status_immune` (`{"t":"status_immune","status":"Poison"}`, flat immunity)
and `bonus_vs_status` (`{"t":"bonus_vs_status","status":"Weakness","n":[3,5]}`,
bonus damage vs. a target already carrying that status). Both take exactly
**one literal status name** in their `status` field.

User question (in-chat, this session): can the targeted status be specified
*hierarchically* — e.g. "Status (root) → buff/debuff → Poison/Burn" — rather
than one name at a time?

**Verified against source, not guessed** (hard_sessions.md's own standing
lesson): no such hierarchy exists in `content/vocab.json` — `"statuses"` is a
flat array, no kind/polarity metadata attached at the content layer. A real
classification DOES exist, but in engine code, not content data —
`sim/lib/status.cjs`:

```js
const STATUS_KIND = {
  Burn: 'dot', Poison: 'dot', Chill: 'cadence_slow', Regen: 'hot',
  Spikes: 'onhit_reflect', Stun: 'suspend', Weakness: 'dmg_reduce', Haste: 'cadence_fast',
};
const DEBUFF_STATUSES = new Set(['Burn', 'Poison', 'Chill', 'Weakness', 'Stun']);
const BUFF_STATUSES = new Set(['Regen', 'Spikes', 'Haste']);
```

Two **independent, parallel, flat** classifications live here, both in
engine code, both already re-exported through the `sim/combat.cjs` facade,
neither ever referenced by any content-authoring surface:
- **Polarity** (`DEBUFF_STATUSES`/`BUFF_STATUSES`): 2 buckets — debuff (5:
  Burn/Poison/Chill/Weakness/Stun) / buff (3: Regen/Spikes/Haste). Coarse.
- **Mechanical kind** (`STATUS_KIND`): 7 buckets — `dot` (2: Burn, Poison),
  `hot` (1: Regen), `cadence_slow` (1: Chill), `cadence_fast` (1: Haste),
  `onhit_reflect` (1: Spikes), `suspend` (1: Stun), `dmg_reduce` (1:
  Weakness). Finer — every kind is a singleton today **except `dot`**, which
  is the one bucket that actually groups more than one status (Burn +
  Poison) and is therefore the one place this finer axis adds real,
  distinct expressive value beyond just naming a status directly (e.g. "bonus
  vs anything currently burning or poisoned," or "immune to all DoTs," as one
  rule instead of two).

**User feedback on the first draft (Rev.0 of this REQ):** buff/debuff alone
was rejected as too coarse — correctly: with only 2 statuses per kind on
average and one kind (`dot`) already at 2, exposing polarity alone leaves
the *useful* grouping (`dot`) unreachable. This revision exposes **both**
axes through one mechanism (see below), not polarity only.

**Also verified while checking this (important, previously undisclosed
scope fact, unchanged from Rev.0):** `status_immune` and `bonus_vs_status` —
and the other three REQ-0077 Rev.2 additions (`buff_self`, `damage_reduction`,
the `on_hp_below` trigger) — have **zero implementation in the sim engine
today**. Precise grep of `sim/`, `shared/`, `server/` for each exact
verb/trigger string returns nothing; `sim/lib/skills.cjs`'s actual verb
dispatch (both the normal-fire path and the REQ-0078 reactive-proc path)
only has cases for `strike` / `multi_strike` / `apply_status` /
`add_on_hit_status` / `lifesteal`. They exist purely as declared vocab +
authored batch-004 content (S1-lite). Of the ten batch-004 Rev.2/3
passive/reactive skills, only three (green_slime's Corrosive Touch, lich's
Life Drain, goblin's Cornered Snarl — all built from pre-existing,
already-wired verbs) would actually do anything if run through today's real
combat sim; the other seven are inert data until implemented. **This REQ
necessarily includes first-time sim implementation for
`status_immune`/`bonus_vs_status`** (you cannot "extend the targeting" of a
verb that does not run yet) — `buff_self` / `damage_reduction` /
`on_hp_below` implementation is explicitly **out of scope here**.

## Proposed design (Rev.1 — full axis, not polarity-only)

**Schema (additive, backward-compatible):** a `status_immune` or
`bonus_vs_status` verb object carries **exactly one of** two mutually
exclusive fields:
- `status: "<Name>"` — existing literal form, unchanged. All 4 currently
  authored uses in batch-004 (skeleton/minotaur `status_immune`,
  dire_wolf/griffin `bonus_vs_status`) keep working with no edits.
- `status_kind: "<keyword>"` — **new**, resolves against a *class* of
  statuses rather than one name. The keyword is **one closed list of 9
  values covering both existing engine axes**, not polarity alone:
  - polarity family (2): `buff`, `debuff`
  - mechanical family (7): `dot`, `hot`, `cadence_slow`, `cadence_fast`,
    `onhit_reflect`, `suspend`, `dmg_reduce`

  One field, one flat closed vocabulary, two internal lookup tables behind
  it — kept as a single field (not two separate fields for polarity vs.
  mechanism) so a content author makes exactly one choice, not two
  potentially-conflicting ones. Resolution logic picks the table by which
  family the keyword belongs to:
  ```js
  function resolveStatusKind(keyword) {
    if (keyword === 'debuff') return DEBUFF_STATUSES;         // reuse, no dup
    if (keyword === 'buff')   return BUFF_STATUSES;           // reuse, no dup
    // mechanical family: filter STATUS_KIND, still reuse-only, no dup
    return new Set(Object.keys(STATUS_KIND).filter(s => STATUS_KIND[s] === keyword));
  }
  ```
  All 9 keywords, all resolution tables, are 100% reused from
  `sim/lib/status.cjs` — nothing new is classified anywhere; this REQ only
  exposes the classification that already exists, in full, to content.

This still mirrors existing shape conventions rather than inventing a new
pattern: `verb.n` already varies between "a legacy scalar int and a v2
`[lo,hi]` range" per `eff_render.cjs`'s `fmtNum`; and `modes` was
deliberately added as **a sibling closed-vocab axis, not an overload of an
existing field** ("separate vocabulary, same pattern" — combat_spec_draft.md
S6.1, re: `po_tags` vs Socket Types). `status_kind` follows that same
"parallel field, not overloaded field" house style, rather than making
`status` polymorphic.

**Vocab addition:** `content/vocab.json` gains a new closed list
`"status_kinds": ["buff", "debuff", "dot", "hot", "cadence_slow",
"cadence_fast", "onhit_reflect", "suspend", "dmg_reduce"]` — **metadata
declaring the legal keyword values only**. It does **not** duplicate which
named statuses fall into which kind; that membership mapping stays the
single source of truth in `sim/lib/status.cjs`'s existing `STATUS_KIND` /
`DEBUFF_STATUSES` / `BUFF_STATUSES`, referenced at resolution time, never
copied into content data.

**Resolution (sim):** wherever `status_immune`/`bonus_vs_status` get
implemented (`sim/lib/skills.cjs`, alongside the REQ-0078-style
reactive/passive dispatch), a `status_kind` reference resolves via
`resolveStatusKind()` above against the live status bag. No new
engine-side classification — reuse only, per the anti-duplication posture
this project already applies elsewhere (one storage chokepoint, one frozen
facade per subsystem, now: one classification source for "what kind of
status is this").

**Rendering (`tools/eff_render.cjs`, currently has no cases for either verb
at all — also part of this REQ):** literal form renders as today's plan
("immune: Poison" / "bonus vs Weakness" EN, equivalent JA); `status_kind`
form renders per-keyword, e.g.:
- `debuff` → "immune: all debuffs" / "全ての衰弱効果に免疫"
- `dot` → "bonus vs anything burning/poisoned" / "継続ダメージ状態の相手に追加ダメージ"
- `cadence_slow` → "immune: Chill" (today a singleton, same output as
  naming it directly — kept for forward-compatibility if a second
  cadence-slowing status is ever added)

The batch-004 preview tool (`tools/build_dungeon_preview.py`) gets the
equivalent update so all forms preview correctly.

**`status_immune` + a `buff`-family keyword is a legal but odd combination**
(why would a monster refuse being buffed?) — not disallowed by this design,
just flagged as an edge case nobody is expected to actually author. Left
alone rather than hard-restricted, matching this vocab's general lack of
inter-field legality restrictions elsewhere.

## Explicitly out of scope (this REQ)

1. `buff_self`, `damage_reduction`, `on_hp_below` sim implementation —
   still pure data/content-only after this REQ; a separate, already-flagged
   gap (see REQ-0077 Rev.2/3 notes), not addressed here.
2. `tool_validate.cjs` (does not exist — REQ-0081) — the new `status_kind`
   shape gets the same "hand-checked, no validator gate" treatment as
   everything else pending that tool.
3. Retrofitting batch-004's existing 4 literal-status uses to the new
   `status_kind` form — they're each intentionally a specific named status
   (skeleton=Poison, minotaur=Chill, dire_wolf/griffin=Weakness), not a
   class. `status_kind` is for *future* content that wants class-level
   targeting, not a retrofit of REQ-0077's batch.
4. Growing `STATUS_KIND`/`DEBUFF_STATUSES`/`BUFF_STATUSES` themselves (e.g.
   splitting `dot` further, or adding a new mechanical kind) — this REQ only
   exposes the classification that exists today; changing the classification
   itself is a separate, later design event if new statuses ever warrant it.

## Implementation sketch (for whoever picks this up out of `todo/`)

1. `content/vocab.json`: bump version; add the 9-value `"status_kinds"`
   list; provenance entry citing this REQ.
2. `sim/lib/skills.cjs` (+ `status.cjs` import): implement `status_immune`
   (battle_start-fold: mark actor immune to the named status or every
   status in the resolved kind-Set; suppress matching `apply_status` calls
   against an immune actor) and `bonus_vs_status` (on damage resolution,
   check target's live status bag for the named status, or for any status
   in the resolved kind-Set, and add the bonus before the hit is applied).
   Both read `status` XOR `status_kind` off the verb, via `resolveStatusKind()`.
3. `tools/eff_render.cjs`: add EN+JA cases for both verbs, both field forms,
   with the per-keyword phrasing table above (9 keywords + the literal form).
4. `tools/build_dungeon_preview.py`: mirror the same phrasing.
5. `sim/tests/run.cjs`: unit coverage — literal-name immune/bonus behaves as
   today; each of the 9 `status_kind` keywords resolves to the exact
   expected Set (spot-check `dot` resolves to {Burn, Poison} specifically,
   the one non-singleton case); golden hashes regenerated only for
   genuinely new fixtures (existing goldens must stay byte-identical — no
   live content uses these verbs yet).
6. `tools/self_test_vocab.cjs`: extend the per-verb fixture builder
   (`buildEffectForVerb`) to cover both verbs, both field forms, and at
   least one polarity + one mechanical keyword each.

## Open questions for the user — RESOLVED (Rev.2, in-chat this session)

- **Resolved Rev.1:** expose the full 9-keyword axis (polarity + mechanical),
  not polarity alone.
- **Field shape:** sibling-field approach (`status_kind` alongside `status`,
  not a polymorphic `status`) — confirmed, matches `modes`-style house
  convention. **Implemented as proposed, no change.**
- **`status_immune` + `buff`-family keyword:** left as a harmless, allowed,
  unused-in-practice edge case — confirmed, not schema-disallowed.
  **Implemented as proposed, no change.**
- **Sim implementation timing:** do it now, in this REQ, alongside the
  status_kind targeting work — confirmed. **Implemented: see "Implementation
  log" below.**
- **Mechanical-kind bucket granularity:** leave the existing 7 buckets as-is
  (no pre-emptive splitting of `dot` or others) — confirmed. **No change to
  `STATUS_KIND` itself; this REQ only exposes it, per its own out-of-scope
  item 4.**

## Implementation log (Rev.2)

Commit `67fc334`, branch `req-0093-status-kind-targeting`, worktree
`~/backpack_ragnarok_worktrees/req-0093-status-kind-targeting`. 10 files
changed (360 insertions, 18 deletions): `content/vocab.json`,
`sim/combat.cjs`, `sim/lib/{compile,encounter,packs,skills,status}.cjs`,
`sim/tests/run.cjs`, `tools/eff_render.cjs`, `tools/self_test_vocab.cjs`.
Followed the "Implementation sketch" section's 6 steps essentially as
written; `resolveStatusKind()` landed in `sim/lib/status.cjs` exactly as
sketched. Full diff and commit message (itself a detailed changelog) are
the authoritative record; summary:

- **vocab**: v6→v7, `status_immune`/`bonus_vs_status` verbs + `n`-ranged
  param for the latter, closed `status_kinds` 9-value list, provenance
  entries for all three additions.
- **sim**: `resolveStatusKind`/`resolveVerbStatusSet`/
  `foldBattleStartStatusVerbs` in `status.cjs` (pure reuse of
  `STATUS_KIND`/`DEBUFF_STATUSES`/`BUFF_STATUSES`, zero new classification
  data); `applyStatus` gained one `bag._immune` chokepoint check covering
  every existing call site uniformly. First-time `battle_start` fold wired
  into `compile.cjs` (per-BP, from that BP's placed POs' effects),
  `packs.cjs` (per-enemy, from its own skills), and `encounter.cjs`
  (trap/door/chest entities, same mechanism). `bonusVsStatusAmount()` in
  `skills.cjs` rolls the bonus fresh per hit (direct/splash/multi_strike
  sub-hits) against the target's LIVE status bag, threaded through
  `fireSkillRay`'s `attacker.bonusVsStatus` at all four `fireSkillRay`
  call sites in `encounter.cjs` (player-side fire, enemy-side fire,
  reactive OnUnitBeenHit retaliation, trap-timeout volley). Reactive
  offensive riders (`applyReactiveVerbToTarget`, REQ-0078's OnHit/OnUnitHit
  path) are **not** wired for `bonus_vs_status` — scoped out to keep the
  blast radius contained; not required by this REQ's own implementation
  sketch.
- **rendering**: `tools/eff_render.cjs` EN+JA cases for both verbs, both
  field forms; 9-keyword phrase tables (singletons phrased by mechanism,
  e.g. "anything chilled", not by hardcoding today's one member name, so
  phrasing survives a future second status landing in the same bucket).
- **tests**: `tools/self_test_vocab.cjs` extended with literal-form default
  fixtures for both verbs (via the existing per-verb loop) plus 4 dedicated
  status_kind-form fixtures (`debuff` + `dot`, one polarity + one
  mechanical keyword, for each verb). `sim/tests/run.cjs` gained 8 new
  tests: all 9 `resolveStatusKind` keywords incl. the `dot`={Burn,Poison}
  spot-check; literal + status_kind `status_immune` suppression through the
  real `applyStatus` chokepoint; literal + status_kind `bonus_vs_status`
  damage bonus incl. a non-matching-status negative case and multi_strike
  per-sub-hit independence; compile-time fold correctness for BOTH the
  enemy path (`compileEnemyPack`) and the player path
  (`compileUnitSnapshot`), each verified to also engage the real
  `applyStatus`/damage chokepoints end-to-end, not just to produce the
  right intermediate Set/list shape.

### Gate results
- `node sim/tests/run.cjs`: **71/71 PASS** (63 pre-existing + 8 new).
- `node sim/tests/goldens.cjs`: **byte-identical**, 12 cases — expected and
  required, since no live content uses either verb yet (per this REQ's own
  scope).
- `node tools/self_test_vocab.cjs`: green except the 2 checks that were
  already failing before this REQ (the `tool_validate.cjs`-dependent
  checks — that tool does not exist anywhere in this project, a
  pre-existing gap tracked separately as REQ-0081, called out in
  `self_test_vocab.cjs`'s own file header). Every verb (incl. both new
  ones, both field forms) rendered correctly in EN+JA; no unhandled-verb
  fallthroughs.

### Build notes / discrepancies (flagged, not glossed over)

1. **This REQ's vocab addition is independent of REQ-0077 Rev.2's own
   vocab bump.** Master (commit `e1f0bdf`, this REQ's worktree base) is
   still at vocab v6 — REQ-0077 Rev.2's v6→v7 diff (which also declared
   `status_immune`/`bonus_vs_status`, alongside `buff_self`/
   `damage_reduction`/an `on_hp_below` trigger) exists only as an
   **uncommitted** change in the main checkout (`~/backpack_ragnarok`,
   HANDS-OFF per PROJECT.md), never landed. Pulling that diff in whole
   would have left `buff_self`/`damage_reduction`/`on_hp_below` half-wired
   (no `eff_render.cjs` case, breaking `self_test_vocab.cjs`'s per-verb
   render loop for verbs this REQ doesn't touch) or required implementing
   unrelated scope. This REQ instead adds `status_immune`/`bonus_vs_status`
   to vocab **independently**, also bumping to v7. The two v7s are **not**
   identical and will conflict if/when REQ-0077 Rev.2's own work is
   eventually committed — a rebase concern for whoever picks that up, not
   solved here. Shape-compatible (both use the same verb names/fields), so
   the eventual reconciliation should be mechanical.
2. **`tools/build_dungeon_preview.py` mirror step (implementation sketch
   item 4) was skipped.** The committed (master) version of this file has
   no verb-rendering / `eff_render.cjs` integration at all to mirror into —
   that capability only exists as a separate, also-uncommitted REQ-0077
   WIP diff in the main checkout (~190 lines), out of reach of this
   worktree. `tools/eff_render.cjs` (the actual shared renderer, used by
   `self_test_vocab.cjs` and any tool that requires it) is fully updated;
   the preview tool mirror is deferred to whenever REQ-0077's own work
   lands and brings that capability to master.
3. **`content/batches/batch-004-*` (skeleton/minotaur/dire_wolf/griffin
   literal-status examples this REQ's Background section cites) is itself
   uncommitted**, not part of master. This REQ's own scope item 3
   ("retrofitting batch-004... not addressed here") is therefore moot in
   practice for this worktree — there was nothing committed to retrofit.
