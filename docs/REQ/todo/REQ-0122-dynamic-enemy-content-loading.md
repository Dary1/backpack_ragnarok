# REQ-0122 — Dynamic enemy/dungeon content loading (retire the batch-002 hardcode)

> Status: **todo — ratified, cleared to implement, queued.**
> Filed 2026-07-09, split out of REQ-0077's S8 (batch-004 "The Warren
> Ascendant" live merge) by explicit user instruction, after this session
> discovered — mid-merge — that "S8: merge into `content/live/`" was not
> actually actionable: no such enemy merge point exists. Companion REQ:
> 0121 (sim implementation for still-inert verbs — separate concern).

## Background (what this session found, verified against source)

`content/live/` today holds only `live_items.json`, `live_sis.json`,
`live_tms.json`, `scenario.json`, `seasons.json` — **no enemy/skill/
dungeon file, and no mechanism for one.** There is no enemy-analogous
`tool_integrate.cjs` promotion path either (confirmed: `grep -n "enem"
tools/tool_integrate.cjs` returns nothing).

The entire live dungeon — the ONLY dungeon content the running game
actually serves — is **hardcoded** to a single directory in two places:

```
server/services/core.cjs:22:  BATCH_DIR = path.join(CONTENT_DIR, 'batches', 'batch-002-dungeon-pilot')
server/services/core.cjs:24-27: ENEMIES_PATH / SKILLS_PATH / ITEMS_PILOT_PATH / FORMATIONS_PATH (all under BATCH_DIR)
sim/dungen.cjs:49:  batchDir() { return path.join(repoRoot(), 'content', 'batches', 'batch-002-dungeon-pilot'); }
```

`server/services/core.cjs`'s `BATCH_DIR` additionally supplies
`items.json` as a **live item overlay** ("pilot items overlay live
(batch-002 demo modes)") — so this single hardcoded path is doing THREE
jobs at once: enemy roster, dungeon layout (traps/doors/chests/reward
tables), and a demo item overlay. Any fix has to account for all three,
not just enemies.

batch-004 (REQ-0077) was deliberately built WITHOUT the latter two — its
own `notes.md` states `items.json`/`entities.json` are empty by design and
`dungeon.json` is "a minimal illustrative wrapper only... provided solely
so `build_dungeon_preview.py` has valid input," explicitly out of scope
for that REQ. **This REQ is a prerequisite for batch-004 (or any future
batch) ever actually being playable, not just previewable.**

## Why this is its own REQ, not folded into REQ-0077

Swapping the hardcoded path from batch-002 to batch-004 naively would
**downgrade the live game** — batch-002's real dungeon.json (traps/doors/
chest/reward tables) and item overlay would vanish, replaced by batch-004's
placeholder 5-encounter wrapper and zero items. This is a real architecture
decision (replace vs. combine vs. make selectable) with no existing
precedent to follow, explicitly flagged to the user in-chat (2026-07-09)
rather than silently picked. User confirmed: stop, file separately.

## Scope (not yet ratified in detail — needs a design pass, this is a todo/
spec-level stub, not a full implementation sketch)

1. Decide the actual target shape: a `content/live/dungeon/` (or similar)
   directory that becomes the one real source, populated by explicitly
   "promoting" a reviewed batch into it (mirroring how items presumably
   reach `live_items.json` — check `tool_integrate.cjs`'s actual item/SI
   promotion flow first and follow the same posture rather than inventing a
   new one) — vs. a multi-batch-aware loader that can combine/select among
   `content/batches/*` directly without ever copying into `content/live/`.
   Recommend investigating the items precedent first since REQ-0077's own
   text assumed one existed for enemies too (it does not) — worth
   understanding why items got one and enemies didn't before designing.
2. `server/services/core.cjs`'s `BATCH_DIR`/`ENEMIES_PATH`/`SKILLS_PATH`/
   `ITEMS_PILOT_PATH`/`FORMATIONS_PATH`/`DUNGEON_PATH` and
   `sim/dungen.cjs`'s `batchDir()`/`enemiesPath()`/`entitiesPath()`/
   `dungeonFixedPath()` need to move off the single hardcoded literal
   together (both read the same conceptual "active batch" — keep them
   pointed at the same source, don't let them drift independently).
3. batch-002 must keep working losslessly through whatever new mechanism
   lands (it is the ONLY currently-live content; this REQ must not regress
   it) — a good acceptance bar: after this REQ, batch-002 running through
   the NEW mechanism produces byte-identical `sim/tests/goldens.cjs` output
   to today's hardcoded path.
4. Once the mechanism exists, wiring batch-004 in is a separate follow-on
   decision (needs batch-004's own missing `dungeon.json`/`items.json`
   built out for real play, which was explicitly out of REQ-0077's scope) —
   **do not silently also complete that in this REQ**; this REQ is
   "build the pipe," not "also pour batch-004 through it."

## Explicitly out of scope

- Building batch-004 a real `dungeon.json`/reward tables/`items.json` —
  separate future work, only makes sense once this REQ's mechanism exists
  to receive it.
- REQ-0121's sim implementation work (unimplemented verbs) — unrelated,
  orthogonal.
- Any change to `content/registry.json`'s schema/convention — note while
  investigating: `registry.json` today only lists `batch-001` and its
  fields (`submitted`/`approved`/`expected_rejects_confirmed`) are
  item-approval-pipeline shaped, don't obviously fit enemy batches; batch-
  002/003 aren't registered there either. Worth a look during design but
  not this REQ's problem to solve alone.

## Open questions for whoever picks this up

- Promote-by-copy (batch dir → `content/live/`, batch dir becomes historical
  record) vs. promote-by-reference (a pointer/config naming which batch dir
  is currently active, no copy)? The items precedent (once understood) should
  probably settle this by matching convention, per this project's repeated
  "one pattern, not two" preference.
- Should multiple batches ever be simultaneously live (e.g. combined enemy
  roster from batch-002 + batch-004), or is "exactly one active batch"
  (today's implicit model, just made swappable instead of hardcoded) enough
  for now? Recommend starting with swappable-single, since combining rosters
  raises its own design questions (id collisions, reward-table merging) not
  needed to unblock batch-004 specifically.

## Outcome & gate results (2026-07-12, REQ-0122 executed)

- **Design pass answers (scope item 1 + open questions):**
  - Items precedent investigated: item content promotes by COPY (approved
    entries appended into content/live/*.json at S8; batches stay as
    history). Followed the same posture: **promote-by-copy** into a new
    `content/live/dungeon/` -- the ONE live source for ALL THREE jobs the
    old hardcode was doing (enemy roster + skills, dungeon layout/entity
    templates/formations, pilot item overlay). Promote-by-reference
    (pointer file) rejected: two sourcing patterns would coexist and the
    pointer adds a mutable indirection item content does not have.
  - Exactly-one-active-batch retained (swappable-single); combining
    rosters stays future work per the REQ's own recommendation.
- **Implemented** (commit 6e1db9c): tools/promote_dungeon_batch.cjs
  (all-or-nothing byte-copy, JSON parse-validation, atomic writes,
  registry `live_dungeon` provenance with per-file sha256; REFUSES
  partial batches -- the batch-004 anti-downgrade guard, no --force);
  sim/dungen.cjs liveDungeonDir() (server core consumes it -- single
  path source, no drift); batch-002 promoted (byte-identical);
  api_test fixture mirrors accordingly; 5 new sim tests.
- **Gates:** sim 112/112; **goldens 12/12 byte-identical through the new
  mechanism (the REQ's acceptance bar)**; mock 101; tsc; engine drift;
  vocab self-test; api fs 155 + pg 155; pg_sync 4.
- **Client/e2e:** zero client-side diff (paths are server/sim-internal);
  client build + e2e skipped for this REQ with the box under a
  concurrent GPU art session (REQ-0138 spike) after two freeze incidents
  -- post-deploy smoke covers the live read paths instead
  (/api/schedule/dungeons exercises dungeon+enemies+entities+formations
  via core.cjs AND dungen.scoutingReport).
- **Not done here (explicitly out of scope, unchanged):** building
  batch-004's real dungeon.json/items.json and pouring it through the
  pipe; registry batches[] schema rework.
