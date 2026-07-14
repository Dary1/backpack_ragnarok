# REQ-0128b — unit-connection-mechanics (engine + client)

**Status:** todo — **all NINE decisions are CLOSED** (user rulings 2026-07-13 + 2026-07-14).
Ratified and cleared to implement.
**Split from:** REQ-0128 (2026-07-13), per the PROJECT.md multi-phase rule. The
vocabulary half shipped as **REQ-0128a** (`content/vocab.json`: `connection_shapes`,
`connection_model`, `orientation`). This file makes those entries do something.
**Slug:** unit-connection-mechanics
**Ordering:** independent of the rename program (user ruling 2026-07-12); lands after
REQ-0124 so it is built in the new vocabulary.

## The model (REQ-0128a, ratified 2026-07-13)

Engine compass, `mock-src/engine.js:571` — `[row, col]`, row increases **downward**:
`DIRS = {0:N[-1,0], 1:NE, 2:E[0,1], 3:SE, 4:S[1,0], 5:SW, 6:W[0,-1], 7:NW}`

**Board orientation:** 前方 = the battlefield cell with the **lower Y** (up)
→ **forward = row−1 = `DIRS[0]` = N.**

**Every shape is `{dirs, range, pierce}`.** `adjacency` is not a concept — it is a ray
with `range: 1`. `knight` is the sole offset shape (it jumps).

| shape | ja | dirs | range | pierce |
|---|---|---|---|---|
| `queen` | クイーン | `0-7` | ∞ | false |
| `queen_2` | クイーン(射程2) | `0-7` | **2** | false |
| `rook` | 飛車 | `0,2,4,6` | ∞ | false |
| `rook_3` | 飛車(射程3) | `0,2,4,6` | **3** | false |
| `bishop` | 角 | `1,3,5,7` | ∞ | false |
| `lance` | 香 | `0` | ∞ | false |
| `backward_line` | 後方直線 | `4` | ∞ | false |
| `adjacency` | 隣接 | `0,2,4,6` | 1 | false |
| `chess_knight_move` | チェス・ナイトの動き | *(8 offsets, jumps)* | n/a | n/a |
| `shougi_keima_move` | 将棋・桂馬の動き | *(2 fwd offsets, jumps)* | n/a | n/a |
| `none` | 接続なし | — | 0 | — |

## Rulings (user, 2026-07-13) — the five decisions, closed

1. **Ray occlusion — rays do NOT pierce.** A ray is stopped by an occupied cell. This
   **reverses the old Linker beam behaviour** (which passed over everything until the
   first Linker), so `traceBeams` must gain an occlusion mode — it is not a drop-in.
   `pierce` is a **field from day one** so a future piercing shape is a *data* change,
   not an engine change (*"あとで貫通するものが出るかもしれません"*).
2. **`adjacency` = a range-limited ray**, not an offset concept. This **deletes the
   whole offset-shape category** (and with it the unit-cell vs BP-footprint question,
   and the separate offset-rotation machinery). Only `knight` survives as an offset.
3. **Scope: canvas-local** — connections resolve within one Squad only.
4. **Kits** — not here. REQ-0149 owns them.
5. **Board orientation** — forward = lower Y = up = `DIRS[0]` = N.

## Scope

- **Engine.** Connection resolution in the sim:
  - **One walker for every shape.** `{dirs, range, pierce}` — step along each `dir`,
    stop after `range` cells (`null` = to the board edge), stop at an occupied cell
    unless `pierce`. Link if the landed cell holds a Unit (Unit-to-Unit).
  - `knight` — fixed-offset lookup, no walk, no occlusion.
  - Link-graph construction; mutual-link detection; one-sided links are legal.
  - **Occlusion:** what occupies a cell for the purpose of stopping a ray — any BP/PO
    cell, or only Units? The ruling says "does not pierce"; the *occluder set* is an
    implementation detail this REQ must state explicitly in code and tests, and it must
    be the same set the client overlay draws. **Do not leave this implicit.**
  - **Rotation.** `rotateBP` already rotates `linker.dirs` by `+2 (mod 8)` under the
    `[r,c] -> [c,-r]` transform (engine.js:230-256), so **every ray shape rotates for
    free** — a direct benefit of ruling 2 collapsing offsets into rays. **`knight`
    still needs its own rotation** (its 8 offsets are rotation-sensitive).
  - `range` is invariant under rotation; only `dirs` rotate.
- **Client.** Connection overlays: shape preview on placement, established-link
  rendering, and **the occlusion must be visible** — an opaque ray that silently stops
  behind a BP is a P2 disaster if the UI does not show where it died. Overlay art is
  data-driven (unit icon golden G2 — never baked into icons).
- **Content schema.** `connection_shape` on unit defs (schema only; def authoring is
  REQ-0130 / REQ-0149).

## Consequences flagged to other REQs

- **REQ-0149 Watcher — RESOLVED 2026-07-13.** Flagged as a range-1 problem; the user
  rerouted the kit to **`queen`, range 2**. `adjacency_lr` was removed from the
  dictionary (orphaned).
- **REQ-0149 Squire — RESOLVED 2026-07-13.** Rerouted to **`rook`, range 3**
  (`rook_3`). `forward_1` removed from the dictionary (orphaned).
- **Every roster-001 shape is now assigned.** No unit def blocks this REQ.
- **Ray occlusion reverses shipped behaviour.** Any existing content or test that
  relies on beams passing over BPs/POs will change meaning. Audit before implementing.

## Rescued prior art (from REQ-0061, 供養 2026-07-12)

The pulse-walk law set of REQ-0048/0061 is the deterministic baseline this REQ must
either ADOPT for Unit Links or EXPLICITLY RETIRE, law by law — **silence is not
allowed**: `PULSE_CAP`; the visited-set; the hop budget. (REQ-0149 G6 — the Berserker's
uncapped +0.1%/stack — is the live instance of why `PULSE_CAP` exists.)

## Gates

- One walker implements all nine ray shapes from `{dirs, range, pierce}` — no
  per-shape special cases except `knight`.
- Unit tests per shape: rays, range limits, **occlusion**, `pierce` (via a test-only
  piercing shape, proving the flag works before a real one needs it), first-hit,
  one-sided vs mutual links, canvas-local scope.
- **Rotation tests:** all ray shapes under all four BP rotations, plus `knight`.
- The occluder set is stated explicitly and matches what the client overlay draws.
- The REQ-0061 law set is adopted or retired law by law, in writing.
- Engine tests + vocab self-test green; e2e green (`pnpm run e2e` / `tools/e2e_run.sh`).
- No def authoring in this REQ.

---

## Rulings (user, 2026-07-14) — the two items this REQ left OPEN are now CLOSED

This REQ shipped with two questions it refused to answer by inference, and one gate it
refused to close by silence. All three are settled.

### 6. Occluder set — **UNITS ONLY**

> *This REQ (above): "**Occlusion:** what occupies a cell for the purpose of stopping a
> ray — any BP/PO cell, or only Units? ... **Do not leave this implicit.**"*

**Ruling: only Units block a ray.** BP and PO cells are **transparent** — a ray passes
straight over them. A ray without `pierce` stops at the **first Unit** on it and links it.

Consequences:

- **`traceBeams` does NOT need a general occlusion mode.** The old Linker beam behaviour
  (pass over everything until the first Linker) *is* this behaviour, with Unit substituted
  for Linker. The "reverses shipped behaviour / not a drop-in" warning above is **withdrawn**:
  first-hit semantics survive intact.
- The client overlay draws rays stopping at Units, not at backpack edges. The "opaque ray
  that silently stops behind a BP" P2 hazard **does not arise** — nothing hides behind a BP.
- The occluder set is now stated in `content/vocab.json.connection_model.occluder_set`, so
  engine and client read it from one place.

### 7. `pierce` semantics — **link EVERY Unit within range**

`pierce: false` (default) = first-hit: stop at the first Unit and link it.
`pierce: true` = the ray is **not stopped**; it links **every Unit within `range`**.

`range: 0` or `null` = unlimited (to the board edge). `range` and `pierce` are **INVALID on
offset shapes** — an offset shape jumps, so there is nothing to stop and nothing to pass.

A piercing shape is therefore a **multi-link** shape, and is strong. It is registered as a
field, not as a shipped shape: **no roster-001 unit pierces.** The gate below still demands
a test-only piercing shape, so the flag is proven before a real one needs it.

### 8. `keima` and `knight` are **different movements** — split by id

The dictionary carried one entry, `knight`, whose id named a *piece*, whose `ja` said 「桂」,
and whose offsets were the **chess** set. Those are two different movements wearing one name.

- `knight` → **`chess_knight_move`** — 8 offsets, ja 「チェス・ナイトの動き」. REQ-0149's Thief
  is explicitly *"(chess knight)"*, so the Thief keeps this movement; only the id changed.
- **`shougi_keima_move`** — NEW, 2 **forward** offsets `[-2,-1] [-2,1]` (forward = N per the
  orientation ruling), ja 「将棋・桂馬の動き」. **RESERVED**: registered as vocabulary, used by
  no roster-001 unit, and the engine **may leave it unimplemented** for now.

User, 2026-07-14: *「keima と knight は別の動きをします。だからあえて、keima/knight と言ってます。
これは動きの話であって、ユニット名とは関係ありません。」* — these are **movement** names. They are
not unit names and must never be read as unit names.

### 9. The REQ-0061 pulse-walk law set — **RETIRED, law by law**

> *This REQ (above): "The pulse-walk law set of REQ-0048/0061 is the deterministic baseline
> this REQ must either ADOPT for Unit Links or EXPLICITLY RETIRE, law by law — **silence is
> not allowed**."*

**Ruling: propagation does not exist for Unit Links.** A link is a **static graph edge**:
"A is connected to B". A Unit **does not relay** anything it receives. There is no pulse
object, and therefore nothing for the law set to govern.

| law | fate |
|---|---|
| `PULSE_CAP` (2/s per origin, + `pulse_fizzle`) | **RETIRED** — no pulses to rate-limit. Charge **capacity** is the rate limit: firing costs charge, so a loop cannot run free. |
| visited-set (no revisit within one pulse) | **RETIRED** — no pulse walks a graph, so nothing can revisit. Mutual links cannot echo because nothing propagates. |
| hop budget (`hopsLeft`, H=3) | **RETIRED** — there are no hops. |
| hop latency (0.15 s) | **RETIRED** — no wave travels, so nothing needs to visibly travel. Event ordering is per-Unit charge resolution, not a wave. |
| `link_pulse {t,from,to,hop,origin}` replay event | **RETIRED** for Units. |

**Chaining is still expressible — but only two ways, and both cost something:**

1. `grant_charge` → `units_connected` — a Unit spends its own full charge to fill a
   neighbour's. This is the **only** transfer, and it is an **effect verb**, not a free relay.
2. A receiver-side charge trigger (`on_connected_unit_spend`, `on_connected_unit_attack`,
   `on_connected_unit_bp_been_hit`) — the neighbour charges *because it watched*, on its own
   capacity, at its own cost.

Both routes are **gated by capacity**, which is why no cap law is needed. This is the whole
point of the ruling: one flow economy instead of two.

**The REQ-0061 8-type connective axis (delay / divider / junction / toggle / terminal /
amplifier / splitter / condenser) is RETIRED with it (供養).** Every one of those was a
definition of *what a Unit does to a pulse passing through it* (`amplifier: +1 hopsLeft`;
`condenser: merge pulses within Δt`; `terminal: absorb, do not relay`). With no pulse, they
have no referent. They are **not** re-derived as charge verbs.

### ⚠ Consequence — REQ-0149 G6 is now UNOWNED

This REQ argued that the Berserker's uncapped `+0.1% damage per stack` (REQ-0149 **G6**, OPEN)
was *"the live instance of why `PULSE_CAP` exists"*. **PULSE_CAP is now retired, so that
backstop is gone.** G6 no longer has a law standing behind it. `passive_per_stack` never
consumes charge, so `capacity` does not cap it either. **G6 needs a real cap, ruled by the
user, and nothing in the engine will catch it if it does not get one.**

## Vocabulary shipped for these rulings

`content/vocab.json` **v13** (commit on this branch):
`connection_model.occluder_set`, `connection_model.pierce`, `connection_model.propagation`,
`connection_shapes.chess_knight_move`, `connection_shapes.shougi_keima_move`, and the
`deprecated` block (`pulse`, `on_link_pulse`, `buff_linked` — **deprecated, not deleted**:
`content/s4_boards/s4_fixture_items.json` and `tools/self_test_vocab.cjs` still use them,
and removing them must re-baseline the S4 sim gate. That removal is a **code REQ**, not this
one.)

## Gates — amended 2026-07-14

- ~~The REQ-0061 law set is adopted or retired law by law, in writing.~~ **DONE — §9 above.**
- ~~The occluder set is stated explicitly~~ **DONE — §6; it lives in `vocab.connection_model`.**
- Occlusion tests assert the ruling: a ray passes **over** BP and PO cells and stops **only**
  at a Unit.
- `pierce` is proven by a test-only piercing shape (no roster unit pierces) and asserts
  **multi-link**: every Unit in range, not just the first past the blocker.
- The walker must reject `range`/`pierce` on offset shapes rather than silently ignore them.
- `shougi_keima_move` may ship **unimplemented**, but the vocabulary entry must not be dropped.
- **No pulse machinery in the Unit link path.** A test asserts a Unit does not relay.
