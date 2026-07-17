# REQ-0223 — artadmin-render-seed-compare-sets: allow same-seed A/B across parameter variants

**Ratified:** 2026-07-17 — owner picked shape (c) in chat. (Status is the folder; see `ls docs/REQ/*/`.)
**Reserved:** 2026-07-16
**Slug:** artadmin-render-seed-compare-sets
**Filed under user directive** (2026-07-16, chat): 「あなたが作業している中で、こうした方良かったと
思う事はREQにしておいてください」.

## Why (friction hit twice in REQ-0187, and V4 institutionalizes the workflow)

`renders.seed` is UNIQUE per artwork. But the workflows the admin now encourages are exactly
same-seed A/B:

- REQ-0186's one-shot lock override + lightbox compare (V4) wants "same seed, two locks" —
  REQ-0187 had to burn disjoint seed ranges (501-503 strict vs 511-512 off …), so no pair in
  the evidence is a true A/B; lock effect and seed effect are confounded in every comparison.
- The user-designed revision loop (instruction → 3 seeds → findings → revised instruction)
  wants same-seed across ROUNDS to isolate the prompt delta; the REQ-0187 scythe run had to
  choose between deleting renders (destroying provenance) and changing seeds (confounding).

The constraint exists for a reason (a seed names a render within an artwork; dedupe), so this
is a schema/design decision, not a bugfix — hence draft.

## Decision (owner, 2026-07-17)

**Shape (c) — keep the constraint, add a `variant` discriminator.** `UNIQUE (artwork_id, seed)`
becomes `UNIQUE (artwork_id, seed, variant)`; a seed still names a render within an artwork, and
the one-shot lock override auto-picks the colliding seed's twin slot instead of failing with
`DUPLICATE_SEED`. Narrowest migration, smallest blast radius on the `artworks.adopted_render_id`
circular FK.

Rejected for now: (a) `params_hash` uniqueness — conceptually cleanest but forces a normalisation
ruling (which keys count, how resolved lock hashes) plus a backfill of every existing row;
(b) explicit compare-sets — best fit for the revision loop but adds a table, UI surface, and
delete semantics. Both stay on the table if (c) proves too thin; this file is the record.

**Scope answer (the "check and report" item):** `UNIQUE (artwork_id, seed)` exists ONLY on
`renders` (`server/migrations/007_artwork.sql:53`). No monster/unit render table shares it;
`sealed_seeds` (011) is an unrelated feature that merely has "seed" in the name. (c) touches
one table.

## What to do (candidate shapes, owner picked (c))
- (a) Uniqueness becomes `(artwork, seed, params_hash)` — a seed may recur when any generation
  parameter differs; lightbox groups same-seed renders as an A/B strip.
- (b) Explicit compare-sets: a render can be generated "into" a named set that suspends the
  uniqueness rule within the set; sets are first-class in the lightbox and deletable as a unit.
- (c) Keep the constraint, but make the one-shot override AUTO-pick the colliding seed's twin
  slot (seed stays, a `variant` discriminator column distinguishes) — narrowest change.
- Whichever shape: provenance stays honest (`params` already records resolved lock since
  REQ-0186 — keep every variant's params inspectable), and po.cell_fit rows must attach to the
  right variant.

## Out of scope
- Any generation-recipe change; bulk regeneration tooling; monster/unit render tables unless
  they share the same constraint (check and report).

## Gates
- Migration with a reversible path; artwork_test + artadmin e2e green including a new same-seed
  A/B spec; the V4 compare loop from REQ-0187 re-runs with a TRUE same-seed pair and is
  recorded as the demonstration.
