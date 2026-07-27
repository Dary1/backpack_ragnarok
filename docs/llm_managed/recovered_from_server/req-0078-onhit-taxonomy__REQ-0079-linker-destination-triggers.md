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
(`shared/engine.d.ts`; `shared/engine.js` `linkerCell`/`linkerMap`). A link is
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

## Open (confirm during impl)
- The sim snapshot is static per encounter (no in-combat re-placement), so the
  destination map is frozen at compile time. Assumed fine; flag if wrong.
