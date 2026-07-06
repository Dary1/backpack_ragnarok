# REQ-0078 — Reactive trigger taxonomy (OnHit / OnBeenHit family)

Branch: `req-0078-onhit-taxonomy` (off `master` @ 674b0af).

Replaces the single `host_on_hit` trigger with a structured reactive-trigger
family derived from the entity-containment hierarchy, and makes reactive
triggers actually FIRE in the encounter sim (previously inert — see
`sim/README.md` scope note #17). Adds monster/enemy reactive procs.

## Background (verified against source)
- `host_on_hit` was declared `socket_item_only` in `content/vocab.json` and
  renders "On host hit:" / "装備先が命中した時" (`tools/eff_render.cjs`). It is an
  **offensive** proc: an SI fires when its **host PO lands a hit**. Confirmed
  against `content/live/live_sis.json` — Frost Orb→`apply_status Chill`, Poison
  Coat→`apply_status Poison`, Guard (Tsuba)→`block`.
- The **defensive** "when attacked" case is a *different* trigger,
  `on_bp_damaged` ("このBPが被弾した時"; provenance: Cactus "when attacked, add
  Spikes").
- `runEncounter` currently schedules/fires **only** `every_secs`; all reactive
  triggers are inert. SIs are not even compiled into the sim snapshot
  (`compile.cjs` handles BPs + grid POs only), so no reactive proc has ever
  fired in the sim.

## Entity hierarchy (the derivation basis)
`Unit ⊇ BP ⊇ PO ⊇ SI`. A BP owns exactly one `Linker` (`BPLinker`). An
`EnemySkill` belongs to a Monster, and a **Monster is a flat Unit** (no
BP/PO/SI/Linker). **HP exists only at BP** (Backpack-as-HP) **and Unit** (its
BP aggregate) — PO/SI/Linker carry no HP.

## Triggers (this REQ — replaces `host_on_hit`)
Two axes. **Offensive** `…Hit` = *dealt* damage (与えた); **defensive**
`…BeenHit` = *received* damage (受けた). Scope = which container's combat event
the effect listens to. **Attachability is derived**: a trigger is legal for an
owner iff the owner *has* that container.

| Trigger | Fires when | Attachable to |
|---|---|---|
| `OnHit` | the owner effect's own verb deals damage | SI, PO, Linker, EnemySkill |
| `OnPOHit` *(was `host_on_hit`)* | the owner's host PO deals damage | SI |
| `OnBPHierarchyHit` | any member of the owner's BP deals damage | SI, PO, Linker |
| `OnUnitHit` | any member of the owner's Unit deals damage | SI, PO, Linker, EnemySkill |
| `OnBPBeenHit` | the owner's BP receives damage | SI, PO, Linker |
| `OnUnitBeenHit` | the owner's Unit receives damage | SI, PO, Linker, EnemySkill |

Offensive nesting (for an SI): `OnHit`(self) ⊂ `OnPOHit`(host PO) ⊂
`OnBPHierarchyHit`(BP) ⊂ `OnUnitHit`(Unit). Defensive: `OnBPBeenHit` ⊂
`OnUnitBeenHit` — there are no sub-BP defensive triggers (nothing below BP has
HP).

**Monster mapping.** An `EnemySkill` may only use `OnHit` / `OnUnitHit` /
`OnUnitBeenHit` (a monster has no host PO or BP). This supersedes the earlier
"`host_on_hit` on the monster side" framing: a monster's "react on dealing
damage" = `OnUnitHit` (or `OnHit`); "react on being hit" = `OnUnitBeenHit`.

## Locked interpretations (OQ-style; documented, vetoable)
- **OQ-A — damage scope.** "deals/receives damage" counts direct
  `strike`/`multi_strike` hits **including AOE splash sub-hits** (per OQ19
  per-sub-hit semantics). It **excludes** DoT status ticks (Burn/Poison/Regen),
  reflected/Spikes damage, and 0-damage / detection-mode hits — keeps firing
  bounded and prevents feedback loops.
- **OQ-B — `OnHit` vs `OnUnitHit`.** `OnHit` fires only from the owner effect's
  **own** damaging verb; `OnUnitHit` fires from **any** unit member's damaging
  verb. They coincide for a single-skill monster.
- **OQ-C — cascade guard.** Reactive procs are **depth-1**: a reactive proc's
  own damage does **not** fire further reactive procs; at most one proc per
  originating direct-hit event. Mirrors legacy Spikes "consumed per hit".
- **OQ-D — RNG isolation.** Each reactive firing draws from a dedicated
  `reactive/<trigger>/<ownerUid>/<t>` RNG sub-stream, isolated from `…/ray`,
  `…/dmg`, `…/timing`, so existing golden streams are unperturbed.

## Dispatch model — `causedBy`

Reactive triggers resolve through a single dispatch pass, not per-site ad-hoc
branches. Every direct-hit resolution publishes a **`causedBy` context** that
carries the full "who dealt / who received, through what" chain, e.g.:

    causedBy = {
      kind: 'hit',                                  // a direct strike/multi_strike landing
      attacker: { effectUid, ownerId, po?, bp?, unit },   // damage source
      defender: { actor, bp?, unit },                     // damage target
      amount, verb, t,
      reactive: false, depth: 0,                    // OQ-C cascade guard
    }

On each hit the dispatcher walks the live effect-bearers and fires a trigger iff
its predicate over `causedBy` holds. Every predicate is a graph-trace *from*
`causedBy`, so "does this event reach me?" is answered dynamically rather than by
a precomputed per-owner flag:

- `OnHit` <= owner effect is `causedBy.attacker.effect`.
- `OnPOHit` <= owner SI host PO == `causedBy.attacker.po`.
- `OnBPHierarchyHit` <= owner BP == `causedBy.attacker.bp`.
- `OnUnitHit` <= owner Unit == `causedBy.attacker.unit`.
- `OnBPBeenHit` <= owner BP == `causedBy.defender.bp`.
- `OnUnitBeenHit` <= owner Unit == `causedBy.defender.unit`.
- (REQ-0079) `OnLinkDestinationHit` <= owner Linker beam destination BP ==
  `causedBy.attacker.bp`; `OnLinkDestinationBeenHit` <= ... == `causedBy.defender.bp`.

OQ-C is enforced here: a reactive proc republishes its own damage with
`reactive:true, depth:1`, and the dispatcher does not re-dispatch reactive procs
for any `causedBy` already flagged `reactive` (depth-1 only).

## Scope & phasing
**Phase 1 (this REQ):**
1. **Vocab** (`content/vocab.json`, bump `version`): remove `host_on_hit`; add
   the 6 triggers; replace `trigger_domains` with per-target validity
   (SI / PO / Linker / EnemySkill) plus an `offensive`/`defensive` axis.
   **No new verb** — reactive triggers reuse existing verbs.
2. **Types** (`shared/engine.d.ts`): trigger-name union; add optional
   `effects?: Effect[]` to `BPLinker` so a Linker can bear effects.
3. **Render** (`tools/eff_render.cjs`): EN + JA strings for the 6 triggers;
   remove `host_on_hit` (keep a one-release alias if any tool still emits it).
4. **Sim** (`sim/lib/{encounter,skills}.cjs`): a reactive-firing pass at
   hit-resolution. Wire the **enemy/EnemySkill** side fully
   (`OnHit`/`OnUnitHit` offensive, `OnUnitBeenHit` defensive) and the
   **player-PO** side where compiled data already exists
   (`OnHit`/`OnBPHierarchyHit`/`OnUnitHit`/`OnBPBeenHit`/`OnUnitBeenHit`),
   per OQ-A..D.
5. **SI side (`OnPOHit`)** requires compiling SIs into the snapshot
   (`compile.cjs`); included if low-risk, else split as **Phase 1b**.
   Determinism-safe either way (SIs are absent from the sim today).
6. **Content**: rename the 3 `host_on_hit` SIs in `content/live/live_sis.json`
   to `OnPOHit`.
7. **Docs/tests**: update `tools/self_test_vocab.cjs` +
   `server/tests/api_test.cjs` vocab lists; rewrite `sim/README.md` note #17.

**Phase 2 (REQ-0079):** Linker-only **destination** triggers
`OnLinkDestinationHit` / `OnLinkDestinationBeenHit`, resolved from `causedBy`
against the linker's `Beam.to` BP. `OnLinkOrigin*` intentionally NOT added —
redundant with `OnBPHierarchyHit`/`OnBPBeenHit` (a link's origin is the linker's
own BP).

## Determinism contract
Existing goldens (`sim/tests/goldens/replay_hashes.json`) MUST stay
byte-identical. Guaranteed because (a) no existing enemy content uses the new
triggers, (b) SIs are not compiled into the sim, (c) reactive RNG is drawn from
isolated sub-streams. New coverage lands only as **new** fixtures/hashes.

## Test plan
- Unit (`sim/tests/run.cjs`): each trigger fires on its own event and no other;
  OQ-A exclusions (no proc on DoT/reflect/0-dmg); OQ-C depth-1; attachability
  validation rejects illegal (owner, trigger) pairs.
- Golden: `node sim/tests/goldens.cjs` unchanged; add new monster fixtures
  (an enemy with `OnUnitBeenHit` retaliation + `OnUnitHit` proc) and
  `npm run goldens:gen` only the added hashes.
- Vocab self-test + API vocab list green (`npm run test:quick`).
