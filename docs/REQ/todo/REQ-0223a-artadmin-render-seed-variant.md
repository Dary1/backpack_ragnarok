# REQ-0223a — artadmin-render-seed-variant: allow same-seed A/B across parameter variants (schema/server)

**Ratified:** 2026-07-17 — owner picked shape (c) in chat. (Status is the folder; see `ls docs/REQ/*/`.)
**Split:** 2026-07-17 — the client half became REQ-0223b (PROJECT.md multi-phase rule: phases
that can hold different statuses become independent files). This file is the SERVER phase:
schema, storage, routes, `artwork_test`. It is complete; 0223b is not, hence the split.
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

## What was done

**Migration** `server/migrations/020_render_variant.sql` — `renders` gains
`variant integer NOT NULL DEFAULT 0` (CHECK >= 0); `UNIQUE (artwork_id, seed)` widens to
`UNIQUE (artwork_id, seed, variant)`; index `renders_artwork_seed_idx (artwork_id, seed,
variant)` names the A/B strip's read pattern. Idempotent; applied and re-run clean.
The circular FK `artworks.adopted_render_id -> renders.id` (007) is untouched — it keys on
`renders.id`, so widening the UNIQUE cannot reach it. A twin is a separate row, hence
separately adoptable, and "the adopted render is undeletable" still names exactly one.

**variant 0 is the compatibility hinge.** Every pre-existing render is variant 0 and the
column defaults to 0, so a bare seed still means the render it always named. This is what
kept the change narrow, and it mattered more than the REQ anticipated — see the finding below.

**Storage** `server/storage_art.cjs` — `createRender(.., {twin})` allocates `MAX(variant)+1`
over the `(artwork, seed)` inside the same INSERT, for the same read-then-write reason as the
existing auto-seed. Without `twin`, a render lands on variant 0, so ordinary dedupe is exactly
the constraint it always was: an accidental re-press still errors. `listRenders` orders
`(seed, variant)` so twins arrive adjacent and slot-ordered. Seed-addressed reads/writes take
an optional variant defaulting to 0.

**Routes** `server/routes/art.cjs` — the one-shot lock override now AUTO-PICKS the twin slot.
That is the actual fix: burning one seed at two locks is the override's stated purpose, and it
died on DUPLICATE_SEED. `{twin:true}` in the generate body says the same thing explicitly for
the prompt-revision loop, which carries no lock override to infer it from. Variant rides in
`?variant=`, validated once at the dispatch edge (a malformed one 400s rather than reaching a
handler as NaN and reading as a 404 "no such seed").

## Finding — the REQ under-described the cost, and why (c) still held

`seed` was not merely a DB key: it was the ADDRESSING key of the whole art-admin API. Six
handlers (`repack`, `cutout`, `delete`, `cancel`, `inspect`, `serve`, plus adopt-by-seed)
resolved a render with `renders.find(r => r.seed === seed)`. Relaxing seed uniqueness is
precisely what those `.find()`s assume cannot happen, so EVERY candidate shape — (a)
params_hash and (b) compare-sets no less than (c) — would have made them silently return an
arbitrary member of an A/B pair. Silently: the wrong image, no error. The addressing problem
was inherent to the REQ, not to the shape chosen, and none of the three sidestepped it.

What (c) bought was the cheap answer to it: because a twin is a NEW slot on the SAME seed and
slot 0 is the default, "a bare seed means variant 0" resolves the ambiguity without moving any
route onto `renders.id`. Under (a) or (b) there is no such default — two rows with one seed are
peers, so every seed-addressed route would have needed a real re-addressing pass first. The
narrowness of (c) turned out to be load-bearing rather than incidental. Recording this because
the decision looked like a close call and, on the evidence, was not.

The six `.find()`s are pinned to a variant in this phase; the equivalent client-side assumption
is REQ-0223b's subject.

## Gate results

- **Migration reversible path** — GREEN. Documented in `020_render_variant.sql`. Deliberately
  NOT unconditional: narrowing back to `UNIQUE (artwork_id, seed)` is illegal while any twin
  exists, so the rollback first REPORTS the collisions and makes the operator choose (re-seed
  = keep images, lose the pairing; delete = destroy evidence). Silently deleting an operator's
  A/B to satisfy a constraint would destroy the provenance this REQ exists to protect. An
  adopted twin is refused by 007's RESTRICT FK, correctly.
- **`artwork_test`** — GREEN, 16 passed / 0 failed (was 11 before this REQ; 5 added): twin
  allocation stacks slots without touching the seed; dedupe survives for the accidental
  re-press; a bare seed still resolves variant 0 through the legacy call shape while twins
  address and adopt independently; `listRenders` keeps twins adjacent; and **'REQ-0223 TRUE
  same-seed A/B'** — one seed, two locks, both provenances intact, the pair REQ-0187 could not
  produce.
- **`artadmin` e2e** — regression check for the route changes (this phase ships no new spec;
  the same-seed A/B spec and the V4 UI re-run are 0223b's gate, since both need the client).
- **V4 compare loop re-run** — deferred to REQ-0223b: it is an OPERATOR loop and needs the
  lightbox A/B strip. The storage/queue-level pair is proved here by `artwork_test`.

## Commits (branch `req-0223-artadmin-render-seed-compare-sets`)

- `8196ed1` docs(REQ-0223): record owner decision — shape (c) variant discriminator
- `ad066fb` docs(REQ-0223): draft -> todo (ratified, cleared to implement)
- `b4703d7` feat(REQ-0223): variant discriminator — same-seed A/B renders
- `f59a919` test(REQ-0223): same-seed A/B gate in artwork_test

## Out of scope
- Any generation-recipe change; bulk regeneration tooling; monster/unit render tables unless
  they share the same constraint — CHECKED: they do not. `UNIQUE (artwork_id, seed)` existed
  only on `renders` (`007_artwork.sql:53`). `sealed_seeds` (011) is an unrelated feature that
  merely has "seed" in the name. (c) touched one table.
- The artadmin client and its e2e — REQ-0223b.
- Retiring the derived-seed convention (`seed + 100000`, REQ-0192/0193). It overlaps
  conceptually with twins; it works; collapsing them is its own REQ. Noted, not acted on.

## Not yet done (why this is `built/`, not `done/`)
Not merged to master, not deployed, not accepted. Migration 020 IS applied to the shared
supabase-db — additive and migration-first safe by construction: old code never names
`variant`, so its inserts default to 0, and the widened UNIQUE is strictly more permissive than
the one it replaced, so nothing old code did became illegal. The branch is unmerged and the
live `backpack-api` still runs master's code.
