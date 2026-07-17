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
- **`artadmin` e2e** — **NOT RUN.** Attempted as a regression check for the route changes and
  abandoned; see "Box contention" below. Not a listed gate for THIS phase (the same-seed A/B
  spec and the V4 UI re-run are 0223b's, since both need the client), so it does not hold
  0223a out of `built/` — but the route changes are consequently covered by `artwork_test`
  and unit-level reasoning only, NOT by a browser run. Whoever picks up 0223b runs it first,
  before touching the client: if the `?variant=` dispatch broke an existing spec, that is
  0223a's bug arriving late, not 0223b's.
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

## Box contention — the artadmin e2e could not be run, and I disrupted another session

Recorded because it cost another session a CI run and is live evidence for REQ-0231
(ci-cross-session-hygiene), which was mid-flight on this box while this REQ was worked.

I started `tools/artadmin_e2e.sh` while another session's `ci.sh` was running. Its step
`[6.5/8] admin e2e harnesses` then aborted `rc=75` — `e2e_ports.sh`'s port-busy exit — because
my harness's bringup was holding 1560-1562 at the moment its preflight looked. My run was the
most likely cause on timing. It then waited ~15 min for the box lock, never got it, and I
killed it and released the ports.

**The hole is structural, and the port-derivation rule does not close it.** `artadmin_e2e.sh`
binds its three ports (L50-62) BEFORE it reaches `e2e_run.sh` (L75), which is where the box
lock is taken. So the lock serialises the Playwright run but NOT the bringup, and two overlapping
harnesses collide in that gap. Worse, the harness hardcodes `source e2e_ports.sh 0156`, so this
is not two REQs colliding — the SAME harness run from two sessions collides with itself by
construction. The REQ-decade rule ("a port names its owner on sight") prevents collisions
BETWEEN harnesses and is silent about one harness running twice. And the loser aborts hard
(75) instead of queueing, so a port race one second wide kills a whole CI run.

Why it could not be retried: the box lock is held by a deliberate freeze fixture
(`flock … -c echo FREEZE_ACQUIRED; exec sleep infinity`, orphaned to systemd --user) belonging
to another session, so `e2e_run.sh` queues forever; and ports 1560-1562 were immediately taken
by a THIRD session (`req-0220-…`) once I released them. At least three sessions (0231, 0232,
0220) were contending for one box. Nothing of theirs was touched.

For REQ-0231: the fix this points at is taking the box lock BEFORE bringup rather than around
the Playwright run alone — the ports are the contended resource, so the lock has to cover the
bind, not just the test.

## Deploy record (2026-07-17)

- Merged to master **`8e77828`** (`--no-ff`, user go-ahead in chat: "marge and deploy"),
  together with REQ-0223b — 0223a alone would have shipped twins to a client that keys cards
  on a bare seed (duplicate React key; the operator sees one card and adopts the other), so
  the split was a bookkeeping boundary, never a shipping one.
- **Full `ci.sh`: exit 0, `CI GREEN`** — including `artwork_test` 16/16, the admin trio
  (artadmin 8/8, artinspect 1/1, contentadmin 28/28), and the scoped client e2e **187 passed**
  on the REQ-0223 decade.
- **Migration 020 was already applied** and had been live for hours before the merge, by
  construction safe: master's code never names `variant`, its inserts default to 0, and the
  widened UNIQUE is strictly more permissive. Independently confirmed — another session's CI
  ran the whole suite green against the migrated schema while this branch was still unmerged.
- **`backpack-api` restarted; `backpack-web` NOT restarted** (it is
  `python3 -m http.server --directory .../web`, so the rebuilt dist is served the moment it
  lands). The restart was gated on REQ-0233's finding that it kills the in-flight art queue:
  ComfyUI reported `queue_running: []`, `queue_pending: []` and no `art_job.py` was running,
  so nothing was in flight to lose.
- **Live verification.** Schema: `UNIQUE (artwork_id, seed, variant)` present. Dispatch edge:
  `?variant=-1` -> **400** `variant must be a non-negative integer` (the guard, on live).
  Compatibility hinge: a bare `/renders/<seed>` resolves as before. Bundle: `lightbox-strip`
  present in the served dist. Health: web 8801 = 200, api 8802 = 200, tunnel
  https://backpack-dev.qtie.jp/app/ = 200. Corpus: 963 renders / 339 artworks, **0 twins** —
  no live render moved.
- **Test junk removed.** The gate runs left 5 `e2e_ab_sword` twins in dead namespaces in the
  shared DB — the ONLY variant>0 rows in existence. Harmless to serving, but they would have
  made this REQ's own rollback path report 5 collisions and invite a future operator to treat
  test litter as A/B evidence worth protecting. Deleted (5 artworks / 7 renders, adopted refs
  NULLed first per storage.cjs's order); rollback path back to zero collisions. E2e leftovers
  are a pre-existing pattern here (125 such artworks, oldest 2026-07-14) and were left alone —
  only rows this session created were touched.

## Follow-ups filed
- **REQ-0246** (draft) — REQ-0233's family barrier restarts the real `comfyui.service` from
  `ART_ROUTE_MOCK=1` harnesses. Found running these gates; `ART_FAMILY_BARRIER=0` was needed
  for every trustworthy run above (artwork_test 12/4 -> 16/0; artadmin e2e >9 min -> 1.7 min).

## Superseded — this section described the `built/` state, kept for the record
Was: "not merged, not deployed, not accepted". All three are now done; see the deploy record
above. What remains is ACCEPTANCE: the same-seed A/B loop has been proved by CI and by a live
smoke check, but the operator has not yet run a real A/B on real art.
