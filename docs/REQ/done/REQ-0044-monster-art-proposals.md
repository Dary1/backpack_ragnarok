# REQ-0044 — Monster Art Proposals (illustration-first round 1)

- **Status**: CLOSED (2026-07-06) — Round 1 ALL REJECTED by user (quality too low).
  User directive: use DreamShaper on the server GPU (8GB) — then ORDERED the R2 art
  task STOPPED and taken OUTSIDE this session ("当セッション外で処理します").
  ORCHESTRATOR MUST NOT work on monster art until the user hands results back.
  Untracked web/preview/monsters-002/ on the server may be the user's external work —
  DO NOT TOUCH. Footprint rule captured for whenever art returns: scale cell shapes
  by NAME-implied size (bat clearly small, wolf smallish, ice dragon VERY large),
  not by drawn canvas size; derivation happens from accepted art.
- Gallery live: /preview/monsters-001/ (#1–#8, commit 2d61e77; art only, no stats).
- Orchestrator review: coherent style; strongest = #2 Golem, #4 Archer, #5 Shaman,
  #6 Turtle; weaker (likely round 2, orchestrator-drawn per provenance rule) =
  #1 Wolf (dog-like), #3 Bat (moth-ish), #7 Bear (too round/cute), #8 Wyrm
  (too sparse for boss scale). User is the gate; footprints derived only from
  accepted numbers.

## User rulings
- batch-002 enemies' footprints are far too small (field 26×18; 3×3 "large" ⇒ rays
  over-reflect). Do NOT pick sizes first: **illustration-first** (art_golden v3.4) —
  draw art with plain names/concepts, present a NUMBERED gallery; user returns
  accepted numbers; footprints (irregular allowed, BP-style collision) are derived
  from the accepted art afterwards.
- All non-monster content also gets icons FIRST from now on (e.g. REQ-0042 LRDST).

## Round 1 plan
- ~8 proposals, plain names (frost theme continuity): Ice Wolf, Frost Golem, Snow
  Bat, Frost Archer, Ice Shaman, Glacier Turtle, Frost Bear, Ice Wyrm (boss-scale).
- Large silhouettes (intended footprint scale ~4×3 up to ~8×6 — sized for a 26×18
  field; final footprints derived post-approval).
- Gallery at /preview/monsters-001/ with numbers, name, intended scale note.
- Provenance caution (REQ-0017): agent-drawn ITEM icons were rejected twice
  historically; monster illustrations are a new class and the USER is the quality
  gate here — proposals drafted by Opus with a render-and-look loop; orchestrator
  reviews before presenting; if the round is rejected wholesale, orchestrator draws
  round 2 inline (Fable).
- Existing batch-002 enemies keep placeholder art/footprints until replaced by
  approved art (footprint re-derivation = follow-up REQ after user's numbers).
