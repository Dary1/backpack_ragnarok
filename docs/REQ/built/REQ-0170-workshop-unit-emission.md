# REQ-0170 — workshop-unit-emission

**Status:** todo — cleared by the user (chat 2026-07-14). Supersedes nothing; CONSUMES
REQ-0128b (engine connection mechanics), which is implemented on this branch.
**Reserved:** 2026-07-14
**Slug:** workshop-unit-emission
**Source:** user chat 2026-07-14 — *「BPがユニットという概念になった関係で、排出されたBPが
陳腐化しました。既存のユーザーのプロフィールから陳腐化されたデータを削除し、WorkShopが
ユニットを排出するようにさせてください。」*

## 0. Ruling log (user, binding — append only)

| Date | Question | Ruling |
|---|---|---|
| 2026-07-14 | What does a Workshop roll emit? | **A roster Unit** (REQ-0149's 12 kits) **plus the BP that is its inventory.** The pool must be **pack-dependent by design** — different packs emit different units. For now every unit may drop from the one common pack; the pool is DATA, not code. **Pack management belongs in the content admin screen → REQ-0171.** |
| 2026-07-14 | connection_shape in the engine | **Implement REQ-0128b on this branch** — `{dirs, range, pierce}` + offset shapes. All 12 kits must be emittable, none held back. |
| 2026-07-14 | Obsolete-data purge scope | **Delete every BP that carries no Unit identity**, together with the POs/SIs inside it, from the canvas, every Squad snapshot and every inventory page. Currency (TMs) and free items survive. |
| 2026-07-14 | `unit-elf` has no adopted render | **Adopt the lowest-seed render.** |

## 1. Why (the obsolescence, stated exactly)

`gacha.cjs rollCommonBp()` mints `{uid, shape, linker:{off,dirs}, hpMax, cellCount}` — a
random polyomino with a random cell stamped as the Unit seat and **1–3 uniformly random
compass directions**. That was the pre-pivot *Linker*: an anonymous beam emitter whose
behaviour was rolled, not authored.

After the REQ-0123 pivot a **Unit is a character** (elf, dwarf, …) with an authored
identity, art, rarity and a **`connection_shape` drawn from the ratified vocabulary**
(`vocab.json` v13). A random `dirs` array is not a Unit and can never become one — no
migration can invent an identity that was never rolled. **Every BP now in the database is
therefore obsolete**, not just the gacha-minted ones: `bp.linker` is a dead field.

Counted on master (PG, 2026-07-14): **1419 profiles / 4326 BPs**, of which 1554 are
gacha-minted, 2772 seeded — **0 carry a Unit identity.**

## 2. Scope

### 2.1 Data model — `bp.linker` → `bp.unit`

    -  linker: { off: [r,c], dirs: number[] }      // rolled beams, no identity
    +  unit:   { id: string,  off: [r,c] }         // WHICH unit, and where it sits

`dirs` **does not survive in any form.** A Unit's rays are resolved at walk time from its
def's `connection_shape` — the def is the source of truth, so a balance change to a shape
reaches every BP already in every profile. The 1:1 BP:Unit law (glossary) is now
structurally enforced: a BP without `unit` cannot be minted and cannot be loaded.

**Rotation consequence (new, and a real behaviour change):** rotating a BP rotates its
shape, its contained POs and `unit.off` — but **NOT the connection shape.** Ray directions
are **board-absolute** (`vocab.orientation`: forward = N = `DIRS[0]`, a fact about the
battlefield, not about the backpack). The old `dirs.map(d => (d+2)%8)` rotation is deleted.
A `lance` unit points at the enemy no matter how its owner packs the bag.

### 2.2 Engine — REQ-0128b, implemented (`mock-src/engine.js` + `sim/lib/compile.cjs`)

`traceBeams()` is generalized from "one unlimited first-hit ray per dir" to the ratified
model:

- ray shapes: walk `dirs`, at most `range` cells (`0`/`null` = unlimited, to the board edge);
- **occluder set = Units only** — BP and PO cells are transparent;
- `pierce:false` links the FIRST Unit on the ray; `pierce:true` links EVERY Unit in range;
- offset shapes (`chess_knight_move`, `shougi_keima_move`) link the Unit at each offset —
  `range`/`pierce` are invalid on them and are rejected;
- `none` forms no links;
- connections stay **canvas-local** (Squad-scoped) — unchanged;
- **no propagation** — a link is a static edge; no PULSE_CAP, visited-set or hop budget is
  introduced (they are retired and stay retired).

Beam record keeps its shape (`{from, dir, path, to, mutual}`) and gains `tos: string[]` so
a piercing ray can report every Unit it linked; `to` remains the first hit, so every
existing consumer (BoardRenderer, linkTrace, BeamTracePanel, MonitorRenderer,
sim/compile.cjs) keeps working. No roster unit uses `pierce:true` today — the code path
ships with tests, not with live behaviour.

The engine gains an injected Unit registry: `Engine.create(ITEMS, SI_DEFS, layout, trees,
UNITS, SHAPES)`. Both new params default to `{}` — an engine with no registry forms no
links and still renders, drags and plays (same failure policy as `unitIcon.ts`).

### 2.3 Content — `unit/1` defs go live (REQ-0149's 12 kits)

`content/live/live_units.json` (`schema: unit/1`, the target REQ-0130/REQ-0154 named):
`id / name / rarity / icon / connection_shape / flavor / i18n.ja`.

**`charge` and `effects` are deliberately ABSENT.** The grammar is frozen but the engine
has **no charge AST and no effect evaluator for units** — writing the fields would be
writing fiction into a live target. They are the next REQ, and the kits' remaining content
gaps (REQ-0149 G2/G5/G6/G12/G13) are still open and still the user's to close. What ships
here is exactly what is decided AND implementable: identity, art, rarity, and the
connection shape.

`icon` is a **free reference** to an artwork `system_name` (REQ-0149 G14: Princess and
Little Princess share one artwork). The validator must not assert `icon == "icon-" + id`.

Validation: `validateBody` gains a `unit` kind (ALLOWED_KEYS + closed vocab:
`connection_shape ∈ vocab.connection_shapes`, `rarity ∈ vocab.rarities`, mandatory
`i18n.ja`), so a bad def is refused at the gate rather than at the board.

### 2.4 Emission — the pack is DATA (`content/live/live_packs.json`)

    { schema: "gacha_pack/1", entries: [
      { id: "common_bp", cost: 10, cells: [6,8], hp_per_cell: 15,
        pool: [ {unit: "elf", weight: 1}, ... x12 ] } ] }

`startGachaRoll(playerId, kind, canvas)` looks `kind` up in the pack table instead of
hard-coding `'common_bp'`; `rollUnit(pack, seed)` rolls the polyomino (unchanged
random-walk), draws a unit from the **weighted pool**, and seats it on a cell of the
polyomino. Everything else about the two-phase roll — the seeded RNG, the pending row,
the strict `uid-present AND balance-dropped` finalize — is untouched, because none of it
was wrong.

**This REQ ships exactly one pack** (all 12, equal weight), which is what the user asked
for. It ships it as a row in a table so that REQ-0171 can put a CRUD screen on top of it
without a rewrite.

### 2.5 Art — the icons reach the board

`unitIconRasters()` (REQ-0125a's deliberately empty manifest) is populated from the served
unit defs: `{key: unitIconKey(id), url: '/api/art/<icon>'}` — the existing PUBLIC adopted-
render route. The fallback chain is untouched; a 404 still falls through to the legacy
glyph. `unit-elf` gets its lowest-seed render adopted (ruling) so all 12 kits have art.

### 2.6 The purge (`tools/migrations/`)

One idempotent script, `--dry-run` first, over the PG `profiles` table (and the files
backend, same code path via `storage.cjs`):

1. From `canvas`, every `canvas.presets.store[]` snapshot and every `inv.pages[]`: drop
   each BP with no `unit`, plus every PO whose cells fall inside it and every SI seated on
   those POs.
2. Delete every `gacha_pending` row (each one describes a `rolled` BP in the dead shape).
3. **Re-seed** any profile left with zero BPs from the new `scenario.json` starter, so that
   a purged profile lands in exactly the state a fresh profile gets — playable — rather
   than in a state no code path has ever produced (an empty board). TMs/currency and free
   inventory items are NEVER touched.
4. `content/live/scenario.json` itself is re-authored: its 4 starter BPs carry real Units.

## 3. Non-goals

- Unit `charge` / `effects` execution (the AST, the triggers, the verbs). Frozen in vocab,
  unimplemented in the engine; a code REQ of its own.
- Unit sockets (REQ-0163, unratified).
- Skins (REQ-0126), themed packs beyond the one common pack (REQ-0062 / REQ-0171).
- Balance. The pool is uniform because nothing has ruled otherwise.

## 4. Gates

- `tools/ci.sh` green (sim goldens, mock tests, server tsc, vocab self-test, api fs+pg,
  client build, engine-type check).
- e2e via `tools/e2e_run.sh` (exclusive box lock; never `playwright test` directly).
- New tests: connection-shape walker (range / pierce / offsets / occluder-set / `none`),
  `unit/1` validator, weighted pool roll determinism, migration idempotence + dry-run.
- Purge verified against the real DB: **zero BPs without `unit` remain** in 1419 profiles.
- Manual pass on backpack-dev: roll in the Workshop → a named Unit with its art and its
  connection shape appears; its rays render on the board.

## 9. Outcome (2026-07-14) — BUILT, merged, deployed; awaiting user acceptance

**Merged** `9fb2d81` into master; deployed to backpack-dev (backpack-api restarted; client
bundle rebuilt into `web/app`). Follow-up fix `314cf9a` (see below).

### What shipped

| | |
|---|---|
| Engine | REQ-0128b's walker: `{dirs, range, pierce}` + offset shapes; occluder set = **Units only**; no propagation. `bp.linker` → `bp.unit {id, off}`. Rays resolve through the DEF, so a content change reaches every saved BP. |
| Rotation | **Behaviour change:** rotating a BP no longer rotates its rays. Directions are board-absolute (`vocab.orientation`). The seat rotates; the compass does not. |
| Content | `live_units.json` (12 kits) + `live_packs.json` (1 pack: all 12, uniform, cost 10). `unit-elf`'s lowest-seed render (101) adopted → 11 icons cover all 12 defs. |
| Emission | `rollPackBp()`: a weighted draw from the pack's pool + the BP that is its inventory. Pack resolved from content, not hard-coded. Two-phase pending/finalize untouched. |
| Purge | **LIVE namespace: 405 profiles, 1620 BPs, ZERO without a Unit.** Across all namespaces the apply run removed 4456 BPs / 3488 POs, unseated 159 SIs, reseeded 1554 profiles. Second run: 0 changes (idempotent). Pre-purge backup: `~/backups/profiles_pre_req0170_20260714_030000.json`. 1205 non-live test rows then pruned with the REQ-0089 tool. |
| Gates | `tools/ci.sh` **CI GREEN** (incl. the new `check_units.cjs` step). e2e **159 passed / 0 failed**. |

### Deliberately NOT shipped (and why)

- **`charge` / `effects` on unit defs.** The grammar is frozen (vocab v13); the engine has
  no charge AST. Writing the fields would be writing fiction into a live target. REQ-0149's
  own content gaps (G2/G5/G6/G12/G13) remain the user's to close, and they are what blocks
  the kits, not this REQ.
- **`sockets`** — removed by user ruling; REQ-0163 owns it, unratified.
- **The sim's `pulse` verb / `on_link_pulse`** — deprecated in vocab, still used by
  `s4_fixture_items.json` and the self-test. Removing them re-baselines the S4 gate
  (REQ-0050) and is its own REQ.

### Agent-defined, flagged for the user

- **`rarity: Common` on all 12.** The one pack that ships is the common pack. Nothing has
  ruled on unit rarity; if rarity is meant to gate the pool, that is a design event.
- **Uniform pool weights.** Nothing has ruled otherwise.
- **Re-seed on purge (user-approved).** A profile left with zero BPs gets the starter
  scenario, so it lands where a fresh profile lands rather than in a state no code path has
  ever produced.
- **Starter roster** (dwarf/elf/angel/lightcavalry) — four different shapes on a first boot,
  so the player sees that rays belong to the character, not to the bag.

### The bug the gates could not catch (`314cf9a`)

Deployed green; every Unit still wore the legacy glyph. PixiJS picks its image decoder from
the URL **extension**, and `/api/art/<system_name>` has none — so each portrait "decoded to
an empty texture" and was skipped. REQ-0125a's fallback chain absorbed it exactly as
designed: no throw, no red, no art. The route now accepts an optional `.png`, `unitArtUrl`
appends it, `sprites.ts` names `loadParser` explicitly, and `check_unit_icon.mjs` asserts the
extension. **The lesson worth keeping: a fallback chain that never fails loudly needs a test
that asserts the HAPPY path was taken, not just that the sad path did not crash.**

### Open for the user

- The dev player's LRDST balance is **0** (it was 0 before this REQ too), so the Roll button
  is disabled. A grant is an operational action, not a code one — say the word.

### Ordering lesson (found while verifying, 2026-07-14)

**The purge must run AFTER e2e, not before.** The suite's global-setup/teardown backs up and
restores the LIVE profile, and it seeds squads through the API — so an e2e run performed
after the purge put unit-less BPs back into live profiles (20 BPs across 33 profiles, from
a stale pre-REQ-0170 profile backup that teardown restored). Nothing was broken by this
(the board's guards skip a unit-less BP rather than crashing), but it is exactly the kind of
"the migration ran and the data came back" trap worth writing down.

Re-run after e2e, verified clean: **LIVE namespace = 505 profiles / 2344 BPs / ZERO without
a Unit.** The migration is idempotent, so re-running it is always safe.

### Live acceptance (2026-07-14)

Rolled on backpack-dev: **Thief** — portrait, `COMMON`, `chess_knight_move (Jump (8 cells))`,
6 cells / HP 90, seat D2, and **Rays: —** (a knight jump has no compass ray, and the modal
says so instead of inventing one). The BP persisted as
`{"unit": {"id": "thief", "off": [1,3]}}`; balance 999 → 989. 999 LRDST was granted to the
signed-in player via the REQ-0042 warehouse route (an operational action, at the user's
request).
