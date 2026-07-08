# REQ-0079 — Linker link-destination reactive triggers

Branch: developed on `req-0078-onhit-taxonomy` (extends REQ-0078; split to its
own branch when 0078 merges). **Depends on REQ-0078** (reactive dispatch +
`causedBy`).

## Summary
Two **Linker-only** reactive triggers that let a Linker react to combat events
at the **destination** end of the beam it emits — the connected partner BP.
A link thus becomes a conduit for cross-BP reactions.

## Model (verified against source)
A BP's `Linker` (`BPLinker{off,dirs}`) emits `Beam{from,dir,path,to,mutual}`s
(`shared/engine.d.ts`; `mock-src/engine.js` `linkerCell`/`linkerMap`). A link is
directed: **origin = `Beam.from`** (the linker's own BP); **destination =
`Beam.to`** (the BP the beam reaches; `null` if it flies off canvas).

## Triggers
| Trigger | Fires when | Attachable |
|---|---|---|
| `OnLinkDestinationHit` | the linker's destination BP **deals** damage | Linker |
| `OnLinkDestinationBeenHit` | the linker's destination BP **receives** damage | Linker |

`…Hit` = dealt (与), `…BeenHit` = received (被), per REQ-0078.

**Origin triggers intentionally omitted.** `OnLinkOriginHit` /
`OnLinkOriginBeenHit` would duplicate REQ-0078's `OnBPHierarchyHit` /
`OnBPBeenHit` (a link's origin is the linker's own BP), so they are not defined.
(Confirmed with product.)

## Semantics (confirmed)
- **Destination granularity = BP** — the connected partner BP dealing/receiving
  damage, not a specific partner PO.
- **`causedBy`-driven** (REQ-0078 dispatch): on each hit the linker fires iff its
  beam destination BP == `causedBy.attacker.bp` (`…Hit`) or
  `causedBy.defender.bp` (`…BeenHit`). Whether an event reaches the linker is
  decided by tracing `causedBy` against the live beam map at event time — no
  static precomputed "fires?" flag. (Per product direction.)
- **Unconnected linker** (`Beam.to === null`): no destination ⇒ never fires.
- **Multiple beams/destinations**: fires if **any** current destination BP
  matches `causedBy` ("any" scope, matching the hierarchy triggers' "なんらか").
- **Mutual links (A↔B)**: from A's linker origin=A, destination=B, so A's
  `OnLinkDestinationBeenHit` fires when **B** is hit (react to the linked
  partner's damage); B's linker sees the mirror. Symmetric.

## Scope
- Vocab: 2 triggers under a `linker_only` domain (offensive + defensive).
- Types/render: trigger union; `eff_render.cjs` EN/JA strings.
- Sim: destination predicates in REQ-0078's dispatcher; the snapshot must expose
  a live beam / `linkerMap` so a linker can resolve its destination BP from
  `causedBy` at event time.
- Tests: mutual A↔B fixture (B hit ⇒ A linker `OnLinkDestinationBeenHit`);
  unconnected linker never fires; existing goldens unaffected (new fixtures only).

## Open (confirm during impl) -- RESOLVED
- The sim snapshot is static per encounter (no in-combat re-placement), so the
  destination map is frozen at compile time. **Confirmed correct**: re-read
  the full sim (`sim/lib/*.cjs`) looking for any BP-reposition mutator
  reachable from `runEncounter`/`runDungeon` -- none exists. `linkDests` is
  computed once in `compileUnitSnapshot` and never invalidated thereafter.

## New locked interpretations (OQ-style; documented, vetoable)
Two design points REQ-0079's spec left implicit (trigger *conditions* were
fully specified; verb-*targeting* on fire was not, since no player-side
reactive dispatch of any kind existed yet to set a precedent for the Linker
case specifically). Both re-use REQ-0078's own OQ-F convention rather than
inventing a new one:
- **OQ-G -- `OnLinkDestinationHit` targeting.** The offensive rider applies
  to the struck target via the SAME `applyReactiveVerbToTarget` used for the
  enemy `OnHit`/`OnUnitHit` rider: `apply_status`/`strike`/`multi_strike` hit
  the struck enemy; `lifesteal` heals the Linker's OWN (origin) BP, not the
  destination. `block`/`heal_bp` self-buff riders remain out of scope, same
  as OQ-F's own Phase-1b carve-out.
- **OQ-H -- `OnLinkDestinationBeenHit` targeting.** Fires a counter-ray FROM
  the Linker's own (origin) BP's field cells AT the enemy field -- the same
  shape as the enemy's `OnUnitBeenHit` retaliation, one level removed (a
  third-party BP reacts on behalf of its linked partner, rather than the
  struck entity retaliating for itself).

## Implementation status -- landed (branch `req-0079-linker-destination-triggers`, off `master` @ `bc45ddd`)

**Scope-widening discovery.** REQ-0078's own write-up lists "Linker-as-
effect-bearer (needs `BPLinker.effects` in `shared/engine.d.ts` + compile)"
under **Deferred to Phase 1b**, and says that work "also unblocks REQ-0079."
Re-reading the merged REQ-0078 code (`sim/lib/{compile,encounter,skills}.cjs`)
confirmed Phase 1b had NOT landed: `BPLinker` had no `effects` field,
`compile.cjs` dropped `linker` entirely when folding a BP into the snapshot,
and there was no player-side reactive-dispatch pathway at all (only the
ENEMY side fires `reactive_proc`s; REQ-0078's "Dispatch model -- `causedBy`"
section is a design note -- no literal `causedBy` object exists anywhere in
the sim). This REQ's implementation therefore includes that Phase 1b
prerequisite, scoped narrowly to just what the two Linker triggers need
(not general PO/SI player-side parity with the enemy side, which remains
its own, still-deferred piece of work).

**Landed:**
1. **Vocab/types/render:** `OnLinkDestinationHit`/`OnLinkDestinationBeenHit`
   added to `content/vocab.json` (v6->v7), `trigger_domains` restricted to
   `["Linker"]` for both. `BPLinker.effects?: any[]` added to
   `shared/engine.d.ts` (untyped, matching ItemDef/SIDef's own convention).
   EN/JA strings in `tools/eff_render.cjs`.
2. **Sim compile (`sim/lib/compile.cjs`):** `localTraceBeams`/
   `localLinkerCell`/`linkDestsByBp` -- a local, pre-compile reimplementation
   of `mock-src/engine.js`'s `linkerCell`/`traceBeams` (verified bit-for-bit
   against `Engine.create(...).traceBeams()` on the real
   `content/live/scenario.json`). Each compiled BP now carries `linkDests`
   (destination BP id(s), frozen at compile time) and `linkerEffects`
   (deep-copied verbatim).
3. **Sim reactive-firing (`sim/lib/encounter.cjs`):** `OnLinkDestinationHit`
   fires an offensive rider (via the existing `applyReactiveVerbToTarget`)
   when the Linker's destination BP deals a direct hit; `OnLinkDestinationBeenHit`
   fires a counter-ray from the Linker's own BP when the destination BP takes
   one. Both depth-1, isolated `reactive/OnLinkDestination*/...` RNG streams.
4. **Tests (`sim/tests/run.cjs`, +4):** compile-time `linkDests` vs. real
   `traceBeams` ground truth; offensive firing (synthetic guaranteed-hit
   weapon); defensive firing, ground-truth-checked BOTH directions in one run
   (fires iff its own destination set was actually hit -- not just "any hit
   anywhere"); unconnected linker never fires either trigger despite
   confirmed real combat activity on its own BP.
5. **Docs:** `sim/README.md` scope note #17 rewritten.

**Determinism:** existing goldens byte-identical (`sim/tests/goldens.cjs`,
12/12) -- guaranteed by construction, since no pre-existing content has
`BPLinker.effects`, so none of the new code paths can activate for any
existing fixture.

**Gates (`SKIP_PG=1 SKIP_CLIENT=1 SKIP_E2E=1 bash tools/ci.sh`):** sim 67/0
(63 baseline + 4 new), goldens 12/12 identical, mock-src 97/0, typecheck
clean, `check_engine_types` OK (49 members), server api (files backend)
134/0. `CI GREEN`. Client build/e2e and the Postgres api pass were not run
(no client-side or server-storage code touched; consistent with what
`test:quick` itself skips). `tools/self_test_vocab.cjs` (not part of
`tools/ci.sh`) has its own pre-existing, documented 2-failure gap
(`tool_validate.cjs` was never built -- confirmed identical on `master`,
unrelated to this REQ) and has no Linker-fixture concept at all, so it
neither exercises nor is broken by the new triggers.

**Known limitations (inherited, not introduced):**
- BP ids are not namespaced across a multi-unit party
  (`sim/tests/run.cjs`'s `fourUnitSnapshots()` reuses one scenario 4x, so
  four different BPs all named e.g. "beta" would coexist); this REQ's
  destination-matching is by id string, so it inherits the same latent
  cross-unit id-collision class already present in
  `playerActorsInSameBpAs`. Real content is expected to use distinct ids per
  unit. This REQ's own tests use a single-unit party specifically to avoid
  the confound.
- General player-side (PO/SI) reactive firing for the original REQ-0078
  6-trigger taxonomy, and `OnPOHit` specifically, remain deferred (need SI
  compilation into the snapshot) -- unchanged by this REQ.
- No live content authored using these triggers (REQ-0079's own scope is the
  mechanism only, not new live SIs/items) -- fixtures live only in
  `sim/tests/run.cjs`.

**Environment note (unrelated to this REQ, flagging for visibility):**
PROJECT.md's Dependencies section states pnpm-only, `--frozen-lockfile`,
never npm/`package-lock.json`. The actual server checkout (`master` and
every existing worktree, including the one this REQ branched from) uses
npm with committed `package-lock.json` files in `/`, `client/`, `server/` --
no `pnpm-lock.yaml` exists anywhere in the repo. Worked around by running
`npm ci` (root + `server/`) to provision gates; did not attempt to migrate
the repo to pnpm (out of scope). Flagging in case this is a stale doc vs.
intentional drift worth reconciling.

**Not yet done (this session):** merging `req-0079-linker-destination-triggers`
into `master` on the live server -- PROJECT.md's HANDS-OFF policy requires
coordinating with the user before any edit/merge/restart of the main
checkout, so the branch is left committed and gate-green, unmerged, awaiting
that go-ahead.
