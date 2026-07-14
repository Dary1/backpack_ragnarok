# REQ-0163 — unit-sockets

**Status:** draft — **DEMOTED here by user ruling 2026-07-14.** The one-socket concept
is NOT part of the ratified `unit/1` schema. It is not cleared to implement, and no unit
def may carry `sockets` until this REQ is ratified.
**Reserved:** 2026-07-14
**Slug:** unit-sockets
**Origin:** rescued from REQ-0054 (Linker Sockets / Lens SIs, 供養 2026-07-12), which had
been folded into REQ-0130 and then into `unit_icon_pipeline.md` §4.
**Blocks nothing.** REQ-0149 (roster 001) can author all 12 defs without it.

## Why this REQ exists

REQ-0054 was **ADOPTED by the user on 2026-07-06** — *「採用です」* — and then **never
implemented**. The Linker entity it hung off was deleted by the Unit pivot (REQ-0123), so
the concept was rescued into REQ-0130, and from there absorbed into the unit def pipeline
sketch as a schema field.

On 2026-07-14 the user pulled it back out: **draft に格下げ.** It is a real adopted idea
with no home, and it should sit in one — visibly unratified — rather than ride along inside
a schema that is otherwise ratified.

## What survives from REQ-0054

**The mechanism, and only the mechanism.**

- A unit def may carry **ONE socket**. Seating, rejection and hierarchy matching reuse the
  existing `sockets(st)` machinery **verbatim** — that reuse was the whole reason the
  original was adopted, and it is still true. SIs seat and unseat on a Unit exactly as they
  do on any other host.
- The pack ruling survives: equipment SIs would debut inside **themed BP packs**
  (REQ-0062 / Prism Pack lineage — the pack teaches the mechanic by construction).

## What is DEAD — do not resurrect it

**All three launch lenses died on 2026-07-14**, when the user retired pulse propagation
(REQ-0128b §9). Every one of them was defined in terms of a pulse:

| lens | why it is dead |
|---|---|
| `hop_lens` | *"emitted/relayed pulses get `hopsLeft +1`"* — there are no pulses and no hops. |
| `dye_lens_burn` | *"imprints Burn on the pulse; downstream strike payloads add `apply_status`"* — there is no pulse to imprint and no downstream to carry it. |
| `guard_lens` | fires on `on_pulse_emit` — that trigger has no referent. |

`on_pulse_emit` was **never added to the vocabulary**, so nothing has to be removed. The
`lens` **socket tag was never added either** — `socket_tags` is `gem / edge / coat / bond /
Metal / Bone`. There is no cleanup debt. There is also no lens family: **it must be designed
from scratch in the charge grammar**, or the socket ships with a different SI family entirely.

## Open decisions (need a user ruling before todo)

1. **Does a Unit get a socket at all?** The user has *not* re-affirmed the 2026-07-06
   adoption under the post-pivot design. Demoting it here is the opposite of affirming it.
   The alternative — Unit identity comes from **charge + connection shape only** — is a
   coherent design, and simpler.
2. **Socket tag naming.** `lens` is a pulse-era word for a pulse-era family that no longer
   exists. If Units get sockets, the tag should probably be an equipment word. The user
   deferred this rather than deciding it.
3. **What does the SI family DO?** With the lens trio dead, there is no launch content. The
   family has to be re-derived against `charge` (REQ-0129 v13) — e.g. SIs that change
   `capacity`, change `gain`, or add a `charge.trigger`. **None of that is designed.**
4. **One socket, or zero-or-one?** REQ-0054 said exactly one. Whether every Unit has one, or
   only some defs declare one, was never asked.

## Scope (once ratified)

- Schema: `sockets` returns to the `unit/1` schema (it was **removed** on 2026-07-14).
- Engine: `sockets(st)` seating/rejection on a Unit host; one-socket cap; `migrateState`
  back-compat.
- Content: a launch SI family, designed in the charge grammar.
- Dex: the seated SI renders on the unit's card.

## Gates

- The user re-affirms (or kills) the 2026-07-06 adoption **under the post-pivot design**.
  The old *「採用です」* was given for a Linker that no longer exists and does not carry over.
- No `sockets` field is authored on any unit def before that ruling.
- If adopted: seating/rejection matrix tests, one-socket cap, and a launch family that
  needs **zero** pulse vocabulary.

## Outcome

_(to be filled at close)_
