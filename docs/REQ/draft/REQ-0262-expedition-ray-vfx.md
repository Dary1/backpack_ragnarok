# REQ-0262 — expedition-ray-vfx: the ray becomes a drawn projectile with identity, a trail, and a rationed impact

**Status:** draft — spec written, BLOCKED on user review. Three things need the user before work may
start: (1) §8 — the ratified glow law (`styleguide.html` §6.0: *"同時発光源は ≤ 3/画面"*) and the ratified
combat model collide head-on. **Measured: up to 19 rays are in flight simultaneously and 47% of them
end in an all-field nova.** No implementation can honour both; §8 proposes a resolution and the user
must pick. (2) §10 — `styleguide.html` §6.6 names **戦闘再生 (combat playback)** *by name* as a thing
that must not even be CONSTRUCTED under `prefers-reduced-motion`. A full-screen battle monitor whose
entire point is motion cannot obey that literally; §10 proposes a reading and the user must confirm.
(3) §11 — the 5th-bounce nova is not a climax, it is **72.2% of all ray damage** (measured); the VFX
this REQ specifies deliberately de-emphasises it, which is a design call.
**Reserved:** 2026-07-18
**Slug:** expedition-ray-vfx
**Branch:** req-expedition-spec (spec only)
**Requested by:** user, 2026-07-18 — spec items (g), (h), (i).
**Depends on:** **REQ-0257** (ray-flight-entity) — HARD. This REQ draws §10 of that REQ's event
schema and invents no event of its own. **REQ-0261** (expedition-formation-render) — HARD, and twice:
its `ExpeditionRenderer` is the scene this draws into, and its **server-side roster widening**
(`instanceId`/`at`/`fieldCells`/`masked`) is the only thing that lets (h) highlight a struck
instance's cell shape at all (§7.2). **REQ-0260** (§9.3) owns the clock this interpolates against.
**Blocks:** REQ-0264 (art-ray-hit-vfx-kind) — §9's seam is its landing surface.
**Source brief:** `docs/llm_managed/2026-07-18-expedition-redefinition-brief.md` §0 Q1, §3 C2/C4, §6.

## 1. Goal

Spec items (g), (h), (i). Three things:

- **(g)** The ray shows a **trail** and advances 1 diagonal per 4 ticks (0.04s) = **25
  diagonal-steps/sec**, drawn 「再生側が許すならヌルヌル動くように」 — *smoothly, if the playback side
  allows*. So: interpolate between diagonals with rAF; do **not** gate the renderer to 25Hz.
- **(h)** An impact highlights **both** the struck cell **and** the struck instance's **cell shape**,
  briefly (「一瞬」).
- **(i)** One ray line + one hit effect **for now**, behind a **swappable seam** so art can replace
  them per-skill later.

And one thing the user did not ask for but the code forces: **rays now have identity.** REQ-0257
makes them live entities that interleave, and the renderer's single-slot ray state cannot survive
that (§6).

**Out of scope, explicitly:** HP bars, cooldown overlays, charge rings, monster skill badges — all
REQ-0263. Static composition — REQ-0261. The tick loop — REQ-0256. Ray physics — REQ-0257.

## 2. The rulings that authorize this

Ruling **Q1**, verbatim: **シムを全面tick化** — *"Ray flight is PHYSICAL and changes combat results."*

Spec item **(g)**, per brief §6, verbatim:

> Ray VFX (g,h,i): trail + 25 diagonal-steps/sec, interpolated smoothly when the display allows
> (rAF, not a 25Hz gate). Impact highlights BOTH the struck cell AND the struck instance's cell
> SHAPE (h). One ray line + one hit effect for now, but behind a swappable seam (i) -> art REQ-0264.

Ruling **C4**, verbatim: *"**#/expedition plays the sim clock 1:1 (realtime, tick-accurate).**"* — the
reason §5.2 locks the head to `t` and never to a tween timer.

## 3. Verified current state — every row read, not assumed

| fact | source | evidence |
|---|---|---|
| `ray_fire` carries **no skill id and no element** | measured, golden-A | golden-A field set: `seq,t,ev,src,field,entry,dir,pen,aoe` — §9 depends on this. **`cause` is a different story — see the three rows below: it IS on `ray_fire`, just not on any path golden-A takes.** |
| **`telegraph` DOES carry `skill`** | measured, golden-A | field set: `seq,t,ev,src,skill,edge,fires_at` — §9.3: the sim already has the skill id in scope at fire time |
| `ray_hit` carries **no cell** | measured, golden-A | `{"seq":23,"t":18,"ev":"ray_hit","dst":"beta","amount":11.36,"bounce_mult":1,"hp_after":78.64}` — §7.1: only the ray knows where it hit |
| `ray_hit_all` carries **no cell** | measured, golden-A | `{"seq":33,"t":1.09,"ev":"ray_hit_all","bounce_mult":2.5,"hits":[…]}` |
| the small monitor pulses a **hardcoded** cell for the nova | `MonitorRenderer.ts:746-755` (0240) | `case 'ray_hit_all': … this.pulseCell('N9')` — its own comment: *"No specific cell carried on these two event kinds today"* |
| `cause` **IS stamped on ray events — by the CHARGE path** | `sim/lib/encounter.cjs:62,79` | `for (const re of rayEvents) events.push(Object.assign({ t, seq: heap.nextSeq(), cause: 'charge' }, re));` — `rayEvents` comes straight from `fireSkillRay`, so **`ray_fire`/`ray_hit`/… all carry `cause:'charge'`** on the `chargeStrike` (`:62`) and `fireItems` (`:79`) paths. This row previously cited only `:119`/`:136`, which are **`unit_charge_transfer`/`unit_charge_shieldbreak` — NOT ray events.** The ray sites were missed. |
| `cause:'pulse'` is stamped on **exactly two events, NEITHER a ray event** | `sim/lib/encounter.cjs:447,452` | `pulse_payload` (`:447`) and `apply_status` (`:452`). **No ray event is ever stamped `cause:'pulse'`** — grep `cause:` over `sim/` returns 6 sites: `:62`, `:79` (ray, `'charge'`), `:119`, `:136` (charge bookkeeping, not rays), `:447`, `:452` (pulse, not rays). |
| **`MonitorRenderer`'s gold pulse-ray branch is DEAD CODE** | `MonitorRenderer.ts:616` (0240) | `case 'ray_step': { … const pulseRay = ev.cause === 'pulse'; … animateStep(path, pulseRay ? 0xffd166 : 0x59d6d6) }` — `pulseRay` **can never be true**, because no `ray_step` is ever stamped `cause:'pulse'` (row above). The gold tint has never rendered. **NOTE: this REQ previously cited `:718`; the correct line is `:616`** (`:718` is inside `reset()`). §9.2. |
| `cause` appears on **ZERO events of golden-A** — and §8.5 of REQ-0256 says why | measured, golden-A | golden-A takes no charge path **because the goldens build no charge manager at all**: `sim/tests/goldens.cjs:63` omits `unitDefsById`, so `UNIT_DEFS = {}` and `chargeBps` is empty. **In PRODUCTION it is live** — `server/services/runs.cjs:83-91` passes it and **42 of 54 live units carry a `charge` block** (REQ-0263 §5.5). **Golden-A's field set is therefore NOT the wire's field set**; do not author against it alone. |
| ray cells are raw `[row,col]` NUMBER TUPLES | `fieldGeometry.ts:23-34` + BUG#4 postmortem | `RawCell = [number, number]`; a `"M9"` string is only ever an entity LABEL |
| `STEP_ANIM_MS = 200` is the decoration REQ-0257 deletes | `MonitorRenderer.ts:34` | `const STEP_ANIM_MS = 200; // per ray_step segment` |
| the expedition clock is rAF-driven and reads `t` | REQ-0260 §9.3 | `simElapsedSecs = (Date.now() - Date.parse(run.startedAt)) / 1000`; *"reads `t`. never `pt`."* |
| settled playback has **0.5/1/2/4× + scrub** | REQ-0260 §10 | §5.2's pure-function-of-clock design is what makes 4× and backward scrub free |
| `RayMonitor` has **no reduced-motion guard** | `fx.js:88-283` | `REDUCED` (defined `:4`, honoured by `initParticles` at `:8`) is referenced **zero times** inside `RayMonitor`; `requestAnimationFrame(tick)` runs unconditionally at `:275` |
| `RayMonitor` exceeds the blur ceiling **3×** | `fx.js:209,219,240` | `shadowBlur = 10` (trail), `14` (head), `18` (hit flash) — the ceiling is **8** |
| `RayMonitor` ACCUMULATES its clock | `fx.js:268-270` | `const dt = …; t += dt;` — the exact pattern REQ-0256 §10.3 forbids (`t` must be COMPUTED) |
| `RayMonitor`'s nova is a **full-plane** wash, 1.1s | `fx.js:245-258` | `createRadialGradient(...paneW*0.7)` + `fillRect(x0, oy, paneW, ROWS*cell)`, `novas.filter(f => t - f.t < 1.1)`, `globalAlpha = a * 0.55` |
| `RayMonitor` draws the **ENTIRE** traversed path, not a trail | `fx.js:211-216` | `for (let i = 0; i < n; i++)` from index 0 — a full-length streak |

### 3.1 A framing error in the task brief, corrected

The task brief says: *"`client/src/schedule/MonitorRenderer.ts` (742 lines — read fully; note `:160`
`currentRayField` …)"*. **Those are two different files.** Measured:

| file | lines | has `currentRayField`? |
|---|---|---|
| `req-expedition-spec` worktree (pre-0240) | **742** | **NO** — zero occurrences |
| `req-0240-monitor-redesign-pacing` branch | **852** | **YES** — `:160-162` |

`currentRayField` is a REQ-0240 addition. Since REQ-0255 merges 0240, **the file this REQ edits is the
852-line version**, and every line number below is that file's. REQ-0257 §11.1 cites the 0240 branch
and is correct; the task framing conflates the two. Anyone applying `:160` to the 742-line file will
edit the wrong line.

## 4. MEASURED — what the VFX must actually survive

**Method:** replayed `batch002/golden-A` through `combat.runDungeon` with the golden harness's exact
fixture loading (`sim/tests/goldens.cjs:22-39`), then derived each ray's flight window under
REQ-0257's physics (`diagonals × RAY_TICKS_PER_DIAGONAL × TICK_SECS` = `cells × 4 × 0.01`).

**This independently reproduces REQ-0257 §4.1 exactly** — 330 events; `ray_fire` 36; `ray_step` 109
carrying 1017 cells; `ray_hit_all` 17; `ray_hit` 21 — so its numbers are confirmed, not trusted.

New numbers this REQ needs and REQ-0257 did not measure:

```
flight per ray:   min 0.04s  |  median 1.48s  |  mean 1.130s  |  max 2.68s
run ray span:     t=0.90 -> t=24.50  =  23.60s
MAX simultaneous rays in flight:  19          (at t=1.98)
share of ray-span time with >3 rays in flight:  13.0%
concurrency distribution (% of ray-span time):
  0:80.5%  1:5.0%  2:0.8%  3:0.7%  4:0.7%  5:0.8%  6:0.5%  7:0.4%  8:0.3%  9:0.8%
  10:1.2%  11:1.2%  12:0.5%  13:0.5%  14:1.5%  15:0.1%  16:0.3%  17:0.2%  18:3.6%  19:0.4%
novas: 17 of 36 rays = 47%
nova inter-arrival: min 0.01s | median 0.08s | max 0.41s
MAX novas landing inside RayMonitor's own 1.1s nova lifetime:  14
ray damage: direct ray_hit = 284.7 | nova ray_hit_all = 740.2 | ray_aoe = 0.0
  -> the nova is 72.2% of all ray damage
```

**Five consequences, each of which shapes a section below:**

1. **19 simultaneous rays vs a budget of 3.** §6.0's glow law is exceeded **6.3×** at peak. §8.
2. **Rays are BURSTY, not steady.** 80.5% of the ray span has *zero* rays in flight; the peak is 19.
   So the conflict is not a constant overdraw to be tuned away — it is a spike that a *static* budget
   cannot absorb and only a *priority rule* can. §8.
3. **The nova is not "twice a second".** Its mean rate over the ray span is 0.72/s, but its **median
   inter-arrival is 0.08s** and **14** can land inside one 1.1s window. It arrives in volleys. §11.
4. **The nova is the main gun** (72.2% of ray damage), not a climax. §11.
5. **`ray_hit` carries no cell, so the trail is not decoration — it is the only positional source
   for (h).** §7.1.

> **Caveat, stated rather than buried:** these are ONE golden on ONE content batch (batch-002),
> measured against **today's** pre-REQ-0256/0257 fire times. REQ-0256 requantizes every fire time and
> REQ-0257 changes which rays exist to be counted, so the exact numbers will move. **The order of
> magnitude will not** — flight time is `cells × 0.04s` and the cell counts are geometry, which §9 of
> REQ-0257 confirms survives verbatim. Re-measure after 0257 lands (§14 gate 1).

## 5. (g) The trail and the interpolation — exactly

### 5.1 What is interpolated, over what duration, with what easing

**What:** the **ray head's pixel position** on its plane — nothing else. Not its colour, not its
width, not its alpha, not the trail's shape. One 2-vector.

**Between what:** the cell centres of two consecutive `ray_advance` events **for the same `ray` id**.
Per REQ-0257 §10.1, `ray_advance` is `{t, seq, ev:'ray_advance', ray, cell:[r,c], bounces}`, emitted
once per diagonal at the tick the ray arrives on that cell.

**Over what duration:** `RAY_TICKS_PER_DIAGONAL × TICK_SECS` = `4 × 0.01` = **40ms** — but **the
duration is never used as a timer**. It is a consequence, not an input. §5.2.

**With what easing: LINEAR. No easing.** Justified, because this is the one place a reflex
"ease-out everything" would be actively wrong:

- **A ray is a physical projectile at constant speed.** REQ-0257 §5 does not specify a tick count; it
  specifies a **rate**, and pins it with an assertion: `1 / (RAY_TICKS_PER_DIAGONAL * TICK_SECS) === 25`.
  25 diagonal-steps/sec is a *velocity*. Easing is, by definition, a velocity that varies. An eased
  ray would render a constant-velocity object as an accelerating one — the picture would contradict
  the model it is drawing.
- **Easing at 40ms is a 25Hz stutter, not smoothness.** Ease-out within each diagonal means the head
  decelerates into every cell and snaps out of it — **25 times a second**. The user asked for
  「ヌルヌル」 (*smooth/fluid*); per-diagonal easing produces the exact opposite, a visible pulsing.
  Linear interpolation across diagonal boundaries is what makes 25 discrete positions read as one
  continuous glide.
- **§6.0's 120–180ms ease-out law does not apply here.** Its subject is 遷移 — *transitions*: a state
  change between two resting states (hover on/off, panel open/closed). A projectile in flight has no
  resting states; it is never "settling". Applying a transition law to ballistics is a category
  error, and §7.3 shows where that law *does* apply on this screen (the impact highlight, which IS a
  state change).
- **A bounce is not a decision point either.** combat_spec §2.2 (confirmed unchanged by REQ-0257 §9)
  makes reflection a **direction flip**, not a speed change. So there is no ease-in/ease-out at
  bounces: the head turns a hard corner at constant speed. The trail draws the corner as a **V, not a
  curve** (§5.3).

### 5.2 How the head stays locked to the sim clock — drift made structurally impossible

**The head position is a PURE FUNCTION of the clock. There is no tween object, no elapsed
accumulator, no per-ray timer, no `setInterval`.**

```
// evaluated fresh every rAF frame, for every live ray
headPos(ray, clock):
    n     = the last ray_advance of `ray` with t <= clock          // cached cursor, not a rescan
    next  = the first ray_advance of `ray` with t >  clock
    if next == null:  return centre(n.cell)                        // CLAMP -- never extrapolate
    alpha = (clock - n.t) / (next.t - n.t)                         // exact; both t are tick-quantized
    return lerp(centre(n.cell), centre(next.cell), clamp01(alpha))
```

`clock` is REQ-0260 §9.3's `simElapsedSecs`. Four properties fall out, and they are the whole reason
for this shape:

1. **Drift cannot accumulate, because nothing accumulates.** A dropped frame, a backgrounded tab, a
   GPU stall, a 200ms GC pause — the next frame recomputes `headPos` from `clock` and lands exactly
   where the sim says the ray is. **The visual head cannot desynchronise from the authoritative
   position, because it is not tracking it — it is derived from it.** This is REQ-0256 §10.3's
   ruling (*"`t` is COMPUTED, never ACCUMULATED"*) applied on the client side of the same wire.
   **`RayMonitor` does the opposite** (`fx.js:270`: `t += dt`) and is therefore not portable here —
   another of its violations (§3) not to inherit.
2. **Speed controls and scrubbing are free.** REQ-0260 §10 gives settled playback 0.5/1/2/4× and a
   clickable scrub, including **backward**. A tween-based head would need cancel/rebuild logic per
   ray per seek; a pure function needs none — change `clock`, the head is correct. Backward scrub
   works without a special case.
3. **Extrapolation is FORBIDDEN.** When the client's event buffer ends (`next == null`), the head
   **clamps** at `n.cell`. It must not extrapolate along `dir`. Rationale: the ray may bounce, hit,
   or die on the very next diagonal; extrapolating would draw the head *through* a wall or *past* a
   target and then snap back when the truth arrives. **A clamp costs at most one diagonal of stall
   (40ms), which is imperceptible; a snap-back is not.** Under `?clock=sim` the server already
   `t`-gates events (REQ-0260 §9.2), so this is the normal end-of-buffer condition on every live
   frame, not an error path.
4. **`alpha` is exact.** Both `n.t` and `next.t` are tick-quantized multiples of `TICK_SECS`
   (REQ-0256's invariant), so `next.t - n.t` is exactly `0.04` for a straight diagonal — no float
   surprise, and `alpha` is a clean 0..1 ramp.

**The renderer is NOT gated to 25Hz** (brief §6, verbatim: *"rAF, not a 25Hz gate"*). The server
emits truth at 25Hz; the client draws at whatever rAF gives it. REQ-0257 §10.1 states the split and
this is the client half of it.

### 5.3 The trail

```
EXP_TRAIL_DIAGONALS = 6          // 6 diagonals = 0.24s of flight = 240px at EXP_CELL=40
```

- The trail is a polyline through the **cell centres of the last `EXP_TRAIL_DIAGONALS` diagonals**
  behind the head, plus the interpolated head itself as its leading vertex.
- **Alpha ramps head(1.0) -> tail(0)** across the polyline. Width is constant.
- **It breaks at bounces into a V.** A `ray_bounce` vertex is a hard corner (§5.1); the polyline
  passes through it without smoothing. A spark at the bounce vertex is permitted **and does not
  glow** (§8, R1) — `RayMonitor`'s gold bounce ring (`fx.js:226-233`) is a non-glowing `stroke`
  already and is the one part of it that ports unchanged.
- **Bounded length is the point, and it is measured.** `RayMonitor` draws the **entire** traversed
  path from index 0 (`fx.js:211`). At an average 28.25 diagonals per ray (§4) that is a streak across
  the whole plane; at the measured peak of **19 simultaneous rays** it is 19 full-plane streaks and
  the plane becomes a ball of yarn. 6 diagonals is long enough to read direction and speed at a
  glance, short enough that 19 of them remain 19 legible darts.
- **Why a count of diagonals and not a duration in ms:** at a constant 25 diagonals/sec they are the
  same quantity (`6 diagonals === 240ms`), so the choice looks free — and diagonals win for two
  reasons. The trail must break at **bounces**, which are counted in diagonals, not milliseconds; and
  under REQ-0260 §10's 4× playback a trail of 240ms of *wall clock* would be 24 diagonals of *ray*
  and would smear, while 6 diagonals stays 6 diagonals at every speed. The player is reading the ray,
  not the wall.
- **The trail does not glow.** §8.

## 6. Ray identity and lifecycle — REQ-0257's names, not new ones

### 6.1 `currentRayField` breaks, and it breaks quietly

`MonitorRenderer.ts:160-162` (0240 branch), verbatim:

```ts
  /** REQ-0240: the field the most recent ray_fire targeted -- ray_hit carries
   * no field, so damage numbers read their side from here. */
  private currentRayField: 'player' | 'enemy' = 'enemy';
```

Set at `:706` (`case 'ray_fire'`), read at `:735` (`ray_hit` -> `floatDamage`) and `:743`
(`ray_aoe` -> `floatDamage`). **It is a single slot holding "the most recent ray".** That is sound
today for exactly one reason: rays are instantaneous, so a `ray_fire` and all of its consequences are
adjacent in the log and no second ray can interleave between them.

REQ-0257 destroys that premise, and §4 measures how badly: **at t=1.98 there are 19 rays in the
air.** Their events interleave. "The most recent `ray_fire`" then names a *different* ray than the one
whose `ray_hit` is being handled, and every damage number is attributed to whichever side fired most
recently. **It fails silently** — a number still appears, on a plausible-looking plane, so nothing
throws and nothing looks broken.

**Fix, per REQ-0257 §10.1: `Map<rayId, RayVisual>`, populated at `ray_fire`, read by every
`ray`-tagged event.** `currentRayField` is deleted, not repaired.

### 6.2 The lifecycle, keyed on REQ-0257's events

REQ-0257 §10.1 adds `ray` (the `IBattleRay.id`) to **every** ray event and calls it *"NEW and
non-negotiable"*. This REQ consumes that schema **verbatim and invents nothing**:

| REQ-0257 event | fields (its §10.1) | what this REQ does |
|---|---|---|
| `ray_fire` | `{t, seq, ev, ray, src, field, entry, dir, pen, aoe}` | **SPAWN.** `rays.set(ev.ray, {id, field: ev.field, entry, dir, advances: [], bounceIdx: new Set(), alive: true, lastT: ev.t})`. The **`field` is stored PER RAY** — this is the line that replaces `currentRayField`. Nothing is drawn yet: per REQ-0257 §12.2 the ray does not move on its fire tick. |
| `ray_advance` | `{t, seq, ev, ray, cell, bounces}` | **ADVANCE.** `push({t, cell, bounces})`. This array IS the trail and the interpolation source (§5). `cell` is a raw `[row,col]` tuple (`fieldGeometry.ts:23-34`) — **never** `.trim()` it (§13). |
| `ray_bounce` | `{t, seq, ev, ray, at, new_dir, bounce}` | **BOUNCE.** Mark the vertex index for the V-break + non-glowing spark (§5.3). |
| `ray_hit` | `{t, seq, ev, ray, dst, amount, bounce_mult, hp_after}` | **IMPACT.** §7. |
| `ray_aoe` | `{t, seq, ev, ray, center, radius, hits}` | **IMPACT** (splash). `center` IS a cell — the one impact event that carries its own position. |
| `ray_hit_all` | `{t, seq, ev, ray, bounce_mult, hits}` | **NOVA.** §11. |
| `ray_end` / `ray_abort` | `{t, seq, ev, ray, reason, steps}` | **END.** `alive = false`; the trail fades over `EXP_TRAIL_DIAGONALS` worth of clock, then the entry is dropped. |

**No parallel vocabulary is introduced.** The one thing this REQ adds is a client-side struct
(`RayVisual`), which is not a wire name.

### 6.3 Reaping — bounded under a malformed log

`ray_end` is the normal reaper. But a renderer must not leak on a log that lacks one:

```
EXP_RAY_REAP_SECS = 21        // > REQ-0257 s5.1 worst case: 512 diagonals x 0.04s = 20.48s
```

Any ray whose `lastT` is older than `clock - EXP_RAY_REAP_SECS` is dropped regardless of `alive`.
**21 is derived, not picked:** REQ-0257 §5.1 states the retained `RAY_STEP_BUDGET = 512`, now counted
in diagonals, is *"2048 ticks = 20.48 seconds of flight"*. A reap threshold below that would erase a
legitimately aborting ray mid-flight — the exact event the budget exists to make visible.

### 6.4 Reset, retarget, scrub

`MonitorRenderer.reset()` already cancels every ticker and purges the ray layer, and exists because
*"an in-flight self-removing tick can never fire against an already-cleared/destroyed graphic after a
retarget or a replay seek"* (its own doc comment). **The ray map joins that purge.** On a backward
scrub the map is rebuilt from events; because §5.2 makes the head a pure function of the clock, no
per-ray teardown is needed — only the map's contents must match the events applied so far.

## 7. (h) The impact — both halves, and what each one costs

### 7.1 The struck CELL — and why (h) is impossible without §6

**Measured: `ray_hit` carries NO cell.** Its full field set is
`seq,t,ev,dst,amount,bounce_mult,hp_after` and `dst` is an entity **label**, not a position
(`fieldGeometry.ts:29-34` is explicit: *"A `"M9"`-style STRING id is only ever used for entity/actor
LABELS … never for a position"*).

So the struck cell is **not in the hit event**. It is `rays.get(ev.ray).advances[last].cell` — the
cell the ray was standing on when it hit. **This is the load-bearing reason REQ-0257's `ray` id is
non-negotiable for this REQ**: without it, spec item (h)'s first half — *highlight the struck cell* —
has no data source at all. The current renderer's answer is `pulseCell('N9')`, a hardcoded constant
(`:746-755`), which is not a location but an apology.

`ray_aoe` is the exception: it carries `center`, a real cell. Use it directly.

**Spec:**
```
EXP_IMPACT_CELL_MS = 150        // inside s6.0's 120-180ms transition band
```
A **non-glowing** fill of the struck cell, 150ms, ease-out, then gone. One cell, `EXP_CELL` square.

### 7.2 The struck INSTANCE's CELL SHAPE — and its hard dependency

(h)'s second half needs `dst` -> an instance -> that instance's footprint cells.

**Player side (`dst` = a BP id, e.g. `"beta"`):** the BP is in the local squad store (REQ-0261 §7.3's
join). Its shape -> **`computeFootprintCells(shape, rot)`** (`client/src/render/itemCard.ts:71`) ->
cells -> plane pixels at `EXP_CELL`. This is the same pure helper `BoardRenderer` and
`MonitorRenderer` already call (REQ-0261 §4.3), so the highlight is byte-aligned with the composition
it highlights.

**Enemy side (`dst` = an instance label, e.g. `"frost_gnoll#0"`):** **this cannot be drawn today.**
REQ-0261 §8.4 is the authority and §4 of this REQ confirms its evidence by measurement:
`ray_hit_all.hits[]` really does carry `{"dst":"frost_gnoll#0"}` while `buildRoster` really does emit
`id: def.id` (= `"frost_gnoll"`). Two namespaces. **REQ-0261 §8.2's roster widening
(`instanceId` + `fieldCells`) is the fix and this REQ hard-depends on it** — not on REQ-0261's
renderer, on its **server change**.

**Honour REQ-0261 §8.5 structurally: read `fieldCells`, NEVER `footprint`.** The `[fh, fw]`
height-first convention is real (`shared/content_validate.cjs:472-479`), and a cell list cannot be
transposed. This REQ therefore never touches `footprint` for geometry, and the transpose bug cannot
occur in it by construction rather than by care.

**Masked instances degrade honestly.** `maskLabel` (`sim/lib/replay.cjs:21-23`) returns `'?'` while
masked. `dst === '?'` resolves to no instance, so **only the struck cell is highlighted and the shape
highlight is skipped.** Half of (h), which is the honest half — the alternative would be inventing a
shape for an entity the player has not discovered, which is a spoiler and a lie at once.

**Spec:**
```
EXP_IMPACT_SHAPE_MS = 150       // same band, same curve as the cell -- they are one event
```
A **non-glowing** outline + light fill over every cell of the instance's footprint, 150ms, ease-out.

### 7.3 The durations, against the two laws that disagree

The styleguide states two numbers that both plausibly govern an impact, and they are an order of
magnitude apart:

| law | text | scope |
|---|---|---|
| §6.0 | 「遷移は **120–180ms** ease-out」 | 遷移 = **transitions** — a state change between resting states |
| §6.1 ④ | 「④ 命中の光 hit flash once … 拡大しながら退色 ・ **~0.7s** ・ 実体は canvas 描画(§6.4 RayMonitor)」 | a one-shot canvas **effect** |

**They are not in conflict; they govern different things — and this REQ needs both:**

- The **cell highlight and the shape highlight are transitions** — they say "this thing is, for a
  moment, in a struck state". They take **150ms**, the band's midpoint. The user's 「一瞬」 is
  precisely this band.
- The **hit glow is §6.1 ④**, the sanctioned "instant of a hit".

**But ④'s ~0.7s does not survive contact with the measured content, and this REQ shortens it:**

```
EXP_IMPACT_GLOW_MS = 180        // NOT 700
```

**Justification.** §6.1's ~0.7s was authored against `RayMonitor`, a **scripted demo with hardcoded
packs** — the brief says so itself: *"port its LOOK, not its code (it is a scripted mock with
hardcoded packs and no real data)"* — in which hits are rare set-pieces. Measured reality (§4): **17
novas with a median inter-arrival of 0.08s, plus 21 direct hits.** A 700ms decay at 0.08s spacing
means **~9 overlapping glows from novas alone** — a permanent wash, which is not a "flash" and
defeats the rationing §6.0 exists to enforce. At 180ms — the top of the transition band, so still a
legal number under the *other* law — a hit reads as a snap, §8's budget becomes achievable, and the
glow still outlasts the 150ms highlight it accompanies so the hit still pops.

**This is a deviation from a ratified number (§6.1's ~0.7s) and is flagged as one.** It is folded
into §8's ruling request rather than taken unilaterally.

### 7.4 Blur

```
EXP_GLOW_BLUR_MAX = 8           // s6.0: "外発光は blur <= 8px(等倍)・1要素1色"
```
`RayMonitor`'s 10 / 14 / 18 (`fx.js:209,219,240`) are **not ported**. One colour per element, per the
same clause.

## 8. THE GLOW BUDGET CONFLICT — **USER RULING REQUIRED**

### 8.1 The two ratified things that collide

**The visual law**, `styleguide.html` §6.0, verbatim:

> 発光は4つの瞬間のみ — ①焦点(hover/選択) ②伝説級以上の顕現 ③生存する連結ビーム ④命中の瞬間。
> 静止テキスト・待機パネルは光らせない。
> 外発光は blur ≤ 8px(等倍)・1要素1色。パネルは内影のみ。**同時発光源は ≤ 3/画面。**

**The combat model**, ratified by Q1 and specified by REQ-0257.

**The collision, measured (§4), not argued:**

| | budget | measured peak | over |
|---|---|---|---|
| simultaneous glow sources | **≤ 3** | **19** rays in flight | **6.3×** |
| | | + up to **14** novas inside one 1.1s window | |

13.0% of the ray span exceeds 3 rays in flight. **This is not a tuning problem.** No choice of
colour, blur or duration makes 19 concurrent objects into 3. Either the objects do not glow, or the
budget does not hold.

### 8.2 The resolution this REQ proposes

Four rules. **R1 is not a compromise — it is what §6.1 already says**, and that is the key insight:

- **R1 — trails and heads DO NOT GLOW.** §6.1 rations glow to four moments: ①focus ②legendary+
  manifestation ③live link beam ④the instant of a hit. **"A projectile in flight" is not one of
  them.** A ray in flight is not a hover, not a manifestation, not a link beam, and not a hit — it is
  the 0.04-second interval *between* hits. So `RayMonitor` glowing its trail (`shadowBlur=10`) and its
  head (`shadowBlur=14`) is **not licensed by §6.1 at all**; it is the reference implementation
  exceeding the law it was built to demonstrate. Making trails flat is obedience, not sacrifice, and
  it removes 19 of the 19 over-budget sources at a stroke.
- **R2 — glow is rationed to IMPACTS, and hard-capped at 3.**
  ```
  EXP_GLOW_BUDGET = 3            // s6.0: "同時発光源は <= 3/画面"
  ```
  At most 3 impact glows live at once. On a 4th, **cull by priority**:
  `ray_hit_all` (nova) > `ray_hit` (direct) > `ray_aoe` (splash); ties break most-recent-first.
  **A culled impact still draws its non-glowing cell + shape highlight (§7).** So no hit ever becomes
  invisible — only its *glow* is dropped. The read survives; the budget holds.
- **R3 — a nova does not glow per victim.** A nova hits N occupants (`hits[]`); glowing each would be
  N sources from one event. **One** glow at the ray's terminal cell, plus **non-glowing** shape
  highlights on every victim. §11.
- **R4 — blur ≤ 8px, one colour per element** (§7.4). `RayMonitor`'s 10/14/18 are not ported.

**Budget arithmetic after R1–R4:** trails 0 + heads 0 + impacts ≤3 = **≤3.** The law holds — on this
screen, in the measured worst case.

### 8.3 Why this still needs a ruling

**R2 culls.** In a burst, some hits will not get their ④命中の光. That is either:

- **fine** — §6.0's "≤3" is a *budget*, and culling is simply how a budget is enforced; or
- **a violation** — §6.1 ④ says *the instant of a hit* glows, and here some instants do not.

**An LLM should not decide which.** §6.0 and §6.1 are the user's visual law and they do not
anticipate 19 concurrent projectiles. Options:

- **Option A — CULL (recommended, and what this REQ specifies).** Glow ≤3, priority nova > hit >
  aoe, culled hits keep their non-glowing highlight. Honours §6.0 exactly as written. Cost: in a
  volley, some hits flash without glowing. Implementable today, no styleguide edit.
- **Option B — RAISE the budget for `#/expedition`.** Declare the expedition an explicit exception:
  §6.0's ≤3 was authored for the *app's* screens (panels, cards, hovers, one ambient loop), not for a
  battle monitor. Amend §6.0 with an expedition clause (e.g. ≤8). **Requires the user to edit the
  visual law**; an LLM may not amend a ratified golden.
- **Option C — redefine "glow source" as the whole ray layer** (one canvas, one composite = 1
  source). Legalistic; it satisfies the letter and abandons the intent. **Not recommended**, recorded
  so the option is not rediscovered later as though it were new.

**Also folded into this ruling:** §7.3's shortening of §6.1 ④ from **~0.7s to 180ms**. It is the same
question at a different scale — a ratified number that a measured event rate makes untenable.

### 8.4 A REQ-gap this REQ found and cannot close alone

REQ-0261 §4.4 defers the Backpacks **link beams** (`traceBeams`) to **this REQ**, with the reasoning:
*"a LIVE link beam is one of §6.0's four sanctioned glows and belongs with the VFX budget"*. The
reasoning is right — ③生存する連結ビーム is a glow, and beams are **persistent**, so a troop with many
linked Units burns budget continuously, before a single ray is fired.

**But beams are in none of the user's spec items (g)/(h)/(i).** So REQ-0261 deferred them to a REQ
whose scope does not contain them. **This REQ declares beams OUT** and records the gap rather than
silently absorbing work the user did not ask for or silently dropping work a sibling REQ handed over.
Two honest resolutions, for the user or the orchestrator:

1. beams are **not drawn** on the expedition (the simplest reading of (d): the plane shows
   composition, and REQ-0261 §4.4 already drops every other interactive affordance); or
2. beams get their own REQ, which must then answer §8.3's budget question a second time — because
   a persistent ③ glow and a rationed ④ glow compete for the same ≤3.

**Recommendation: (1).** It needs no ruling, no budget, and no new REQ, and it is consistent with
REQ-0261 §4.4's own list of things a spectator plane does not draw.

## 9. (i) The swappable seam

### 9.1 What the seam must key on — and the blocker

The user's (i): one ray line + one hit effect **now**, swappable **per-skill** later.

**Measured blocker: `ray_fire` carries no skill id.** Its golden-A field set is
`seq,t,ev,src,field,entry,dir,pen,aoe`. There is no `skill` and no `element`. **So the seam cannot
key on skill id today**, and (i)'s "later" is gated on a sim change, not on art.

**`cause` is the exception, and §9.2 spends it.** It is absent from golden-A but **present on the
wire**: `encounter.cjs:62,79` stamp `cause:'charge'` onto every event `fireSkillRay` emits on the
charge paths, and those paths are live in production for **42 of 54 units** (§3, REQ-0263 §5.5).
Golden-A cannot show it because the goldens build no charge manager (`goldens.cjs:63` omits
`unitDefsById`). **Reading the wire's shape off golden-A is what produced this REQ's one fictional
claim** (§9.2); the lesson is in §3's rows, not only in the correction.

**The three candidate keys, judged:**

| candidate | on the wire? | verdict |
|---|---|---|
| **`skill` id** | **no** (but see §9.3) | **ADOPTED as the key.** It is the identity art is authored against. |
| `element` | no | **Rejected.** Not a field on a skill def at all — measured, a live skill def is `{trigger, verb, attack_profile, modes}` (`goldens.cjs:37-39`). There is nothing to key on. |
| `attack_profile` | partially (`pen`, `aoe` are on `ray_fire`) | **Rejected.** It is a *struct* (pen/aoe/bounce_budget), not an identity. Two unrelated skills sharing `pen:2` would be forced to share art, making "every 2-pen ray looks alike" a design rule by accident. Attack profile is *ballistics*; art follows *identity*. |

**Why `skill` id despite the blocker:** it is the same key REQ-0265 will use for monster skill icons
(skills are addressed by id in `content/live/dungeon/skills.json` — measured, 81 entries). One key for
both art REQs, or two vocabularies for one concept.

### 9.2 The seam's shape

```ts
// client/src/expedition/rayVfx.ts -- NEW
export interface RayVfxKey {
  skill: string | null;      // ray_fire.skill -- NOT on the wire yet (s9.3). null until REQ-0264.
  cause: string | null;      // ray_fire.cause -- ON THE WIRE TODAY as 'charge' (encounter.cjs:62,79),
                             //   null otherwise. Live in production, absent from golden-A (s3).
                             //   REQ-0263 s7 adds further values; it does not introduce the field.
  pen: number;               // ray_fire.pen  -- on the wire today
  aoe: number;               // ray_fire.aoe  -- on the wire today
  field: 'player' | 'enemy'; // ray_fire.field -- on the wire today
}

export interface RayVfxStyle {
  trailColor: number;  trailWidth: number;  trailDiagonals: number;
  headRadius: number;
  impactColor: number; impactGlowMs: number; impactGlowBlur: number;
}

export interface RayVfxProvider {
  styleFor(key: RayVfxKey): RayVfxStyle;
}
```

**Ships now: `DefaultRayVfx`** — one implementation, which **ignores every field of the key** and
returns one constant style, except for **one branch on `cause === 'charge'`**, which is the seam's
proof-of-shape: it demonstrates that the seam *can* vary a ray by a wire field, using a field that
really does vary.

**This branch was re-based, and the correction matters more than the branch does.** The first draft
claimed `DefaultRayVfx` *"preserves the `cause === 'pulse'` gold branch … using the one wire field
that varies today"*, i.e. that it was carrying a live production behaviour across to the expedition.
**That was fiction, in both halves:**

- **`cause:'pulse'` is never stamped on a ray event.** It exists on exactly two events —
  `pulse_payload` (`encounter.cjs:447`) and `apply_status` (`:452`) — and neither is a ray. So
  `MonitorRenderer.ts:616`'s `case 'ray_step': const pulseRay = ev.cause === 'pulse'` **is dead code
  and always has been.** The gold tint has never once rendered. **Nobody preserves a live behaviour
  by copying it, because there is no live behaviour there to preserve** — porting it would have
  carried dead code into a new file and dressed it up as a requirement.
- **The wire field that DOES vary on rays is `cause:'charge'`** (`encounter.cjs:62,79`, §3), stamped
  onto every event `fireSkillRay` produces on the charge-strike and charge-fire paths. It is **live
  in production** — 42 of 54 live units carry a `charge` block and `runs.cjs:83-91` passes the defs
  (REQ-0263 §5.5) — and **invisible to golden-A**, which builds no charge manager (`goldens.cjs:63`).
  That combination is exactly why the first draft got it wrong: it read golden-A's field set, saw no
  `cause`, and reasoned about the wire from a log that cannot show it.

```ts
// DefaultRayVfx -- the ONE branch, on a field that is real
styleFor(key: RayVfxKey): RayVfxStyle {
  return key.cause === 'charge' ? EXP_RAY_STYLE_CHARGE : EXP_RAY_STYLE_DEFAULT;
}
```

**Do not port `MonitorRenderer.ts:616`'s `pulseRay` branch.** It is dead on the small monitor too;
deleting it there is a separate, trivial cleanup and **is not in this REQ's scope** (§13) — this REQ
only declines to inherit it. Recorded so the next reader does not "restore" it as a lost feature.

**A `cause`-keyed branch is a stopgap, not the design.** §9.1 adopts `skill` id as the real key; it
is not on the wire yet (§9.3) and REQ-0264 is what supplies it. `cause` is what lets the seam prove
its shape **today**, on a live field, instead of shipping a provider whose interface has never once
been exercised by a value that varies.

**This is deliberately the `chargeRing.ts` pattern** (REQ-0125a): finish the drawing, ship it inert,
and let the follow-up REQ change *arguments*, not *structure*. `chargeRing.ts:28-30` states the
pattern in its own words — *"REQ-0129 supplies the real value; when it does, it changes ONE argument
at the call site and this module needs no edit"* — and REQ-0263 §5.1 audits how well that promise
held. The seam here is designed to keep it: **REQ-0264 registers a provider; nothing else moves.**

### 9.3 What REQ-0264 must add, and the evidence it is cheap

**Add `skill` to `ray_fire`.** One field. And this is not new information the sim must invent:

**Measured — `telegraph` ALREADY carries it:** field set `seq,t,ev,src,skill,edge,fires_at`. The sim
has the skill id in hand at telegraph time, and `fires_at` is *the timestamp of the very fire this
REQ wants labelled*. So `skill` is already computed, already serialised, already on the wire — just
on the event 0.6s before the one that needs it (`TELEGRAPH_LEAD_SECS`, combat_spec §4.5).

Correlating `telegraph` -> `ray_fire` client-side (join on `src` + `fires_at === ray_fire.t`) is
**possible and must not be done**: measured, golden-A has **35 telegraphs for 36 ray_fires**, so the
join is already incomplete on real data, and a heuristic join that silently misses one ray in
thirty-six is worse than no key at all. **Put `skill` on `ray_fire`.**

> **Finding for REQ-0264, recorded here because this REQ measured it:** the 35-vs-36 gap means one
> ray fires with no telegraph. That is not necessarily a bug (a reactive/charge fire has nothing to
> telegraph), but it is the kind of asymmetry that makes event-join heuristics rot. Not this REQ's to
> chase.

## 10. Reduced motion — **USER RULING REQUIRED**

### 10.1 The law names this screen explicitly

`styleguide.html` §6.6, verbatim:

> OS/ブラウザで動きを減らす設定の利用者には、動きを**二段構え**で退ける。①CSS共通の
> `@media (prefers-reduced-motion: reduce)` が全 `animation`/`transition` を 0.001s に短絡
> (ui.css・mjolnir.css)。②粒子・視差・**戦闘再生など**JS生成のものは `fx.js`/`particles.ts` が
> **生成自体を行わない**(rAFループを起動しない)。

**戦闘再生 — "combat playback" — is named, by name, in tier ②.** This screen *is* 戦闘再生. A literal
reading says: do not start the rAF loop. Which blanks a full-screen battle monitor the user just
asked for.

**And the ratified reference violates its own rule.** Measured (§3): `fx.js:4` defines `REDUCED`;
`initParticles` honours it at `:8` (`if (REDUCED) return;`); **`RayMonitor` (`:88-283`) never
references it** and calls `requestAnimationFrame(tick)` unconditionally at `:275`. So the styleguide's
own 戦闘再生 demo runs at full motion under `prefers-reduced-motion`, today, on the mock. **Reported;
fixing `fx.js` is out of scope** (it is a mock, and the brief says port its look, not its code).

### 10.2 The reading this REQ proposes

**Tier ② forbids constructing JS *effects*. It does not forbid rendering *state*.**

That distinction is doing real work, not lawyering. §6.6's own examples — 粒子 (particles), 視差
(parallax) — are things JS *generates*: they exist only because a script invented them. **A ray's
position at time T is not generated; it is read from the authoritative log.** What JS generates here
is (a) the *tween between two positions* and (b) the *glow*. Those are the effects. Those stop.

**Under `prefers-reduced-motion: reduce`, `#/expedition` becomes a STATE VIEW, not a playback:**

| rule | behaviour |
|---|---|
| **RM-1** | **No rAF loop is started.** REQ-0260 §9.3's `useExpeditionClock` must not call `requestAnimationFrame`. |
| **RM-2** | The clock cursor advances on a **250ms `setInterval`**; the scene redraws discretely per fire. This satisfies §6.6's literal words — *"rAFループを起動しない"* — and its intent: 250ms is above the ~200ms perceptual band, so the result reads as **discrete updates, not motion**. |
| **RM-3** | **Rays do not fly.** No interpolation (§5.2 is not evaluated), no head, no trail gradient. A ray in flight draws as a **static full-path polyline** for its physical flight window, then disappears. This is state: the ray IS on the field during that window. |
| **RM-4** | **No glow, no flash, no nova wash.** An impact marks its struck cell + shape with a **static outline** for exactly one cursor step. Constructed as a redraw, never as an animation. |
| **RM-5** | REQ-0263's HP bars / cooldown overlays / charge rings render **identically** — they are state, and §6.6 has never applied to them. |

**Why not "instant-jump the ray to impact, no trail":** it was considered and is worse. It destroys
the one thing flight *adds* — REQ-0257 §8.5's observation that the +150% terminator is now
**telegraphed by the ray's own visible trajectory**. A reduced-motion user would lose the information,
not just the animation. RM-3's static full path keeps the trajectory legible while removing every
moving pixel.

### 10.3 Why the user must rule

**This is an INTERPRETATION of a ratified law that names this exact screen.** The honest alternatives:

- **Option A (recommended, specified above).** Reduced motion = discrete state view at 4Hz. The
  battle is watchable, nothing moves smoothly, no effect is constructed.
- **Option B — literal §6.6.** The expedition refuses to play: it renders the static formation and
  offers the settled result / a "play anyway" opt-in. Maximally obedient; arguably useless, and it
  denies a user with a vestibular preference the feature entirely rather than adapting it.
- **Option C — amend §6.6** to scope 戦闘再生 to *mock* playback and give the expedition its own
  clause. Requires a user edit to the visual law.

**A cannot be adopted unilaterally**, because §6.6 does not say "reduce the motion of combat
playback" — it says combat playback must not be generated. Option A is a reading; the user owns it.

## 11. The nova at its measured rate — and a REPORTED balance finding

### 11.1 The mock is calibrated for an event that does not exist

`RayMonitor` treats the 5th-bounce nova as a rare climax: a **full-plane radial gradient**, alpha
0.55, **1.1s** lifetime (`fx.js:245-258`). Measured reality (§4):

- **47%** of rays (17/36) reach it — *the median outcome*, not an edge case.
- median inter-arrival **0.08s**; **14** novas can land inside one 1.1s nova lifetime.
- it delivers **740.2** of 1024.9 total ray damage = **72.2%**.

Porting the mock's nova literally means **14 stacked full-plane gradients at alpha 0.55** — the plane
saturates to a solid orange wash for seconds at a time, and the single most important event in the
combat model becomes indistinguishable from the background.

**There is also a safety dimension, and it should not be discovered later.** 14 full-plane luminance
flashes inside 1.1s is ≈**12.7 Hz**. WCAG 2.3.1's general flash threshold is **3 flashes per second**
over a large area; 12.7 Hz sits squarely inside the 3–55 Hz photosensitive band. A full-plane
orange/white wash at that rate is a genuine seizure-risk pattern, not merely an ugly one. **This is
an argument for §11.2 that does not depend on taste.**

### 11.2 What the nova looks like when it happens in volleys

- **Not a full-plane wash.** A **shockwave ring** expanding from the ray's **terminal cell** — which
  is now knowable: `rays.get(ev.ray).advances[last].cell` (§7.1). The current renderer's
  `pulseCell('N9')` hardcode dies here.
- **`EXP_IMPACT_GLOW_MS = 180`** (§7.3), **one** glow source (§8 R3), counted against
  `EXP_GLOW_BUDGET`.
- **Every victim in `hits[]` gets a non-glowing 150ms shape highlight** (§7.2). The victims are the
  information; the ring is the punctuation.
- **Nova coalescing:**
  ```
  EXP_NOVA_COALESCE_MS = 180     // == EXP_IMPACT_GLOW_MS: coalesce within one nova's own lifetime
  ```
  Novas landing within `EXP_NOVA_COALESCE_MS` **on the same field** draw **ONE** shockwave (at the
  most recent nova's terminal cell) and **merge their victim highlight sets**. Rationale: at a 0.08s
  median gap, "how many novas landed" is not information a human can extract — it is a strobe. **Who
  got hit** is information, and coalescing preserves all of it. 14 rings become 1 ring and 14 sets of
  victim highlights, and nothing true is lost.
- **Precedent, and its limit.** REQ-0240 already coalesces same-target hits
  (`detectCoalesceGroups`, `pacing.cjs:62-89`), so coalescing is a ratified idea here, not an
  invention. **But `pacing.cjs` cannot be reused**: C4 rules that `#/expedition` ignores `pt` and the
  pacing layer entirely, and REQ-0260 §9.2 shows the pacing gate is *server-side*. So the expedition
  does its **own** coalescing, **in the renderer, on the sim clock**. Same idea, different layer, and
  the duplication is forced by C4 rather than chosen.

### 11.3 The balance finding — REPORTED, explicitly NOT fixed here

`combat_spec` §10 specifies, as an S4 measure:

> **Ray sanity (new):** distribution of bounce counts and 5th-bounce all-field triggers; flag skills
> that near-always reach the +150% all-field terminator (**a balance smell**).

**Measured on batch-002/golden-A, on today's content, before REQ-0256 or REQ-0257 change anything:**

```
bounce histogram: {1:18, 2:18, 3:18, 4:17, 5:17}
17 of 36 rays (47%) reach bounce 5 and nova
nova damage 740.2 vs direct 284.7  ->  the terminator is 72.2% of all ray damage
```

**The gate the user specified would fire on the user's current content today.** Rays essentially never
stop early: 18 rays bounce at least once and 17 of those ride all the way to bounce 5.

**This REQ does not fix it and must not.** It is a renderer; re-balancing here would be a content
change hidden inside a VFX diff. REQ-0257 §14.3 already rules the same way (*"Report the before/after
distribution to the user as a finding. Do not tune anything"*), and this REQ concurs and adds the
presentational half of the finding:

> **The VFX cannot honestly present the nova as a climax, because it is not one.** Designing it as a
> rare set-piece — which is what §6.4's `RayMonitor` does, and what the brief tells us to port the
> look of — would actively misinform the player about how their damage is actually being dealt. §11.2
> deliberately makes the nova *punctuation*, not *spectacle*. **If the balance changes so that the
> nova becomes rare, §11.2 should be revisited** — the VFX is calibrated to a measured rate, and that
> is a dependency on content, recorded here so it is not forgotten.

This is a **finding for the user**, delivered with REQ-0257's. Neither REQ acts on it.

## 12. The RawCell contract — inherited, and non-negotiable

REQ-0261 §7.2 hands this REQ a debt it must not default on. `fieldGeometry.ts:36-60`'s BUG#4
postmortem, verbatim in the part that matters:

> sim/combat.cjs's actual ray_fire/ray_bounce/ray_step events carry `entry`/`at`/`path[]` as raw
> **`[row,col]` NUMBER TUPLES, never strings** … *"TypeError: e.trim is not a function"* … Since
> Monitor.tsx's poll effect only advances `lastEventIndexRef` AFTER applyEvents() returns
> successfully, this exception fired again on **EVERY subsequent ~2s poll tick forever** … pegging
> the render thread in a **permanent crash-loop**.

**Three binding consequences for this REQ, which owns the event loop REQ-0261 only touched:**

1. **`ray_advance.cell` is a `RawCell`, not a string.** REQ-0257 §11.4 confirms: *"`ray_advance`'s
   `cell` is the same raw `[row, col]` NUMBER TUPLE. The contract is unchanged; only the field name
   moves."* Import `RawCell` and `cellIdToXY` from `fieldGeometry.ts`. **Do not re-implement
   `colLetterToIndex`** — a third copy is a third place for BUG#4.
2. **The cursor must NOT gate on success.** This is the corollary REQ-0261 §7.2 explicitly assigns to
   REQ-0262: *"the expedition's event application must not gate its cursor on success … Advance the
   cursor first, or wrap per-event."* The crash-loop's *severity* came entirely from the cursor
   never advancing past the bad event. **Spec: `applyOneEvent` is wrapped per-event in try/catch; the
   cursor advances unconditionally; a throwing event is counted and logged once, never retried.**
   `MonitorRenderer.addTicker` already models exactly this posture (`try { done = step(); } catch {
   done = true; }`) — a renderer must never be the thing that takes the page down.
3. **An unknown `ray` id is not an error.** A `ray_advance` for a ray with no `ray_fire` in the buffer
   (a scrub landing mid-flight, a truncated tail) draws nothing and does not throw. Same posture as
   `cellIdToColRow`'s `{col:1,row:1}` fallback: degrade, never die.

## 13. Scope

**In:**

1. `client/src/expedition/rayVfx.ts` — **NEW.** §9's `RayVfxKey` / `RayVfxStyle` / `RayVfxProvider`
   + `DefaultRayVfx` (one style, plus §9.2's single `cause === 'charge'` branch — a REAL wire field
   (`encounter.cjs:62,79`), unlike the `cause === 'pulse'` branch this REQ's first draft proposed to
   "preserve", which is dead code at `MonitorRenderer.ts:616` and never rendered).
2. `client/src/expedition/ExpeditionRayLayer.ts` — **NEW.** The `Map<rayId, RayVisual>` (§6), the
   pure-function head (§5.2), the bounded trail (§5.3), the impact/nova effects (§7, §11.2), the
   glow budget + priority cull (§8 R2), the reaper (§6.3). Draws into REQ-0261's `ExpeditionRenderer`
   scene graph.
3. `client/src/expedition/expeditionGeom.ts` — the §5/§7/§8/§11 constants join REQ-0260's module:
   `EXP_TRAIL_DIAGONALS=6`, `EXP_IMPACT_CELL_MS=150`, `EXP_IMPACT_SHAPE_MS=150`,
   `EXP_IMPACT_GLOW_MS=180`, `EXP_GLOW_BLUR_MAX=8`, `EXP_GLOW_BUDGET=3`, `EXP_NOVA_COALESCE_MS=180`,
   `EXP_RAY_REAP_SECS=21`.
4. `client/src/expedition/useExpeditionClock.ts` — REQ-0260 §9.3's hook gains the §10 reduced-motion
   branch (RM-1/RM-2: no rAF; a 250ms cursor).
5. `client/src/schedule/MonitorRenderer.ts` **(the 852-line 0240 version — §3.1)** — REQ-0257 §11.1's
   edits, which this REQ inherits because it owns the ray loop: `STEP_ANIM_MS` deleted;
   `ray_step` -> `ray_advance`; **`currentRayField` deleted** in favour of a per-ray field map (§6.1).
   The small monitor keeps its dev-grade look — 「今ある画面は放置して」 — this is a correctness fix, not
   a redesign.

**Out:**

- **HP bars, cooldown overlays, charge rings, passive flashes, monster skill badges** — REQ-0263.
- **`skill` on `ray_fire`** (§9.3) and **any art** — REQ-0264. The seam ships inert.
- **Link beams** — §8.4. REQ-0261 §4.4 deferred them here; they are in none of (g)/(h)/(i). Declared
  OUT with a recommendation, not silently absorbed.
- **Re-balancing the 47% nova rate** (§11.3). A finding, not a fix.
- **Fixing `fx.js`'s `RayMonitor`** (§3, §10.1) — it is a mock; the brief says port its look, not its
  code. Its violations are reported, not repaired.
- **The enemy roster widening** (`instanceId`/`fieldCells`) — REQ-0261 §8.2 owns it. This REQ
  hard-depends on it and does not duplicate it.
- **Touching `pacing.cjs` / `shared/pacing.json`** — REQ-0257 §11.2 owns the `ray_advance` entries.
  C4 keeps the expedition out of the pacing layer entirely.
- **`docs/user_managed/*`** — forbidden, and nothing here needs it.

## 14. Gates

**E2E ports (rule: `5000 + REQ*10 + index`): `7620` static / `7621` api / `7622` proxy.** Reserved by
the numbering rule and machine-enforced by `tools/check_e2e_ports.cjs`. **Per ruling Q2
(「e2eを通す必要はない」) E2E is NOT a gate for this program, so no harness is built and the decade is
left unused** — the same posture REQ-0257 §15 takes with 7570-7572 and REQ-0261 §13 with 7610-7612.

Gates that DO apply:

1. **Re-measure §4 against REQ-0257's real output.** §4's concurrency/nova numbers are derived from
   *today's* fire times. After 0257 lands, recount `MAX simultaneous rays` and the nova rate from real
   `ray_advance`/`ray_hit_all` events. **If the peak concurrency is still >3, §8's ruling stands as
   specified; if 0256/0257 somehow collapsed it to ≤3, §8 is moot and must be revisited rather than
   shipped on stale evidence.**
2. **The head is a pure function of the clock.** Given a fixed event list, `headPos(ray, t)` returns
   identical output for identical `t`, called in any order, any number of times. **Pin backward
   scrub explicitly:** evaluate `t` descending and assert the same positions as ascending. This is the
   test that would catch anyone reintroducing an accumulator.
3. **No accumulator exists.** A grep gate over `client/src/expedition/`: zero `+= dt`, zero
   `elapsed +=`, zero `performance.now()` used as a ray clock. (`RayMonitor`'s `t += dt` is the
   anti-pattern being fenced out.)
4. **Interleaving is representable.** Two rays in flight on opposite maps, their events interleaved;
   assert each hit's damage number lands on its OWN ray's field. **This test is unrepresentable
   today** and is the direct regression guard for §6.1 — it is REQ-0257 §16.6's acceptance criterion,
   asserted on the renderer.
5. **Glow budget holds.** Feed the golden-A event stream (post-0257) and assert the count of live
   glow sources never exceeds `EXP_GLOW_BUDGET` on any frame. **This gate fails on a naive port of
   `RayMonitor` and is the whole point of §8.**
6. **Blur ceiling.** Grep gate: no `shadowBlur`/`GlowFilter` value > `EXP_GLOW_BLUR_MAX` in
   `client/src/expedition/`. Pins §7.4 against a copy-paste of `fx.js`'s 10/14/18.
7. **Reduced motion constructs nothing.** With `prefers-reduced-motion: reduce`, assert
   `requestAnimationFrame` is **never called** by the expedition modules (spy/stub), and that no
   glow/flash Graphics is constructed. This is §6.6 tier ②'s literal requirement, and the gate
   `fx.js`'s `RayMonitor` would fail today (§3, §10.1).
8. **Trail is bounded.** For a 28-diagonal ray, the trail polyline never exceeds
   `EXP_TRAIL_DIAGONALS + 1` vertices — at any playback speed (0.5/1/2/4×). Pins §5.3's
   diagonals-not-milliseconds choice.
9. **RawCell contract.** `ray_advance.cell` handled as a tuple; a malformed cell draws at the
   fallback and **does not throw**; a throwing event does **not** stall the cursor (§12).
10. `pnpm exec tsc --noEmit` + lint.

## 15. Acceptance criteria

1. A ray's head advances **exactly** 25 diagonals/sec against the sim clock, interpolated smoothly at
   rAF rate, with **no easing** (§5.1) — verified by sampling `headPos` at 1/240s intervals and
   asserting constant speed within a diagonal and across a diagonal boundary.
2. **The head never drifts.** After an artificially stalled frame (simulate a 500ms gap), the head is
   exactly where `clock` says, not 500ms behind (§5.2).
3. Backward scrub and 4× playback produce correct head positions with no per-ray teardown (§5.2).
4. **Two interleaved in-flight rays on opposite maps each attribute their own hits.**
   `currentRayField` appears nowhere: `grep -rn "currentRayField"` returns zero hits (§6.1).
5. Every ray event is correlated by `ray`; a `ray_advance` for an unknown ray draws nothing and does
   not throw (§12.3).
6. An impact highlights **both** the struck cell **and** the struck instance's cell shape for 150ms
   (§7). For a **masked** instance, the cell alone is highlighted and nothing throws (§7.2).
7. The struck cell is derived from the **ray's own last `ray_advance`**, never from a hardcoded cell.
   `grep -rn "'N9'"` returns zero hits in `client/src/expedition/` (§7.1).
8. The instance shape is derived from `fieldCells` (enemy) / `computeFootprintCells` (player).
   `grep` shows `client/src/expedition/` never reads `footprint` for geometry (§7.2, REQ-0261 §8.5).
9. **Glow sources never exceed 3**, blur never exceeds 8, one colour per element — asserted over a
   full golden-A replay (§8, §14.5, §14.6).
10. A culled impact still shows its non-glowing highlight — **no hit is ever invisible** (§8 R2).
11. Under `prefers-reduced-motion`, **no rAF loop is started and no glow/flash object is
    constructed**; the battle remains watchable as a 4Hz state view (§10, §14.7).
12. 14 novas inside 1.1s draw **one** shockwave per coalesce window and **14 sets** of victim
    highlights — never 14 stacked full-plane gradients (§11.2).
13. `DefaultRayVfx` is the only provider; swapping in a stub provider changes the ray's look with
    **no change to `ExpeditionRayLayer`** (§9.2) — the seam is proven by exercise, not by assertion.
14. **The user has ruled on §8 (the glow budget), §10 (reduced motion), and §7.3's shortening of
    §6.1 ④ from ~0.7s to 180ms.** Implementation does not start before then.

## 16. Corrections to the brief, the task framing, and the source

| claim | reality | evidence |
|---|---|---|
| task: *"`MonitorRenderer.ts` (742 lines … note `:160` `currentRayField`)"* | **Two different files.** The 742-line worktree version has **zero** `currentRayField`; it exists only on the 852-line `req-0240` version at `:160-162`. REQ-0255 merges 0240, so the 852-line file is the target. | §3.1 |
| brief §6 / task: *"§6.4's `RayMonitor` … is the ratified reference implementation … port its LOOK"* | Its look is calibrated for a **scripted mock**. Ported literally it yields 19 glowing full-plane streaks and 14 stacked novas. It also violates §6.0 (blur 10/14/18 vs ≤8), violates §6.6 (**no** reduced-motion guard on the one thing §6.6 names by name), and **accumulates its clock** (`t += dt`), which REQ-0256 §10.3 forbids. | §3, §5.2, §10.1, §11.1 |
| task: *"the 5th-bounce nova … `RayMonitor` treats the nova as a rare climax"* — implied fix is presentational | Correct, and worse than stated: the nova is **72.2% of all ray damage** (740.2 vs 284.7, measured). It is the **main damage channel**, not a climax. | §4, §11.1 |
| task: *"a sibling agent measured 47% of rays (17/36) reach it"* | **CONFIRMED by independent replay.** Also confirmed: 330 events, 36 `ray_fire`, 109 `ray_step`/1017 cells, 17 `ray_hit_all`, 21 `ray_hit`. REQ-0257 §4.1 is sound. | §4 |
| task: *"what the nova looks like when it happens twice a second"* | **Understates the burst and overstates the average.** Mean 0.72 novas/s over the ray span; **median inter-arrival 0.08s**; up to **14** inside one 1.1s window. Novas arrive in volleys, not at a steady 2Hz — which is why §11.2 coalesces rather than merely shortens. | §4, §11.2 |
| brief §6 (silent) | **`ray_hit` carries no cell.** (h) is therefore impossible without REQ-0257's `ray` id — the struck cell exists only on the ray's own `ray_advance` trail. The current renderer hardcodes `pulseCell('N9')`. | §3, §7.1 |
| brief §6 (silent) | **`ray_fire` carries no `skill` and no `element`.** (i)'s "swappable per-skill" is blocked on a sim change, not on art. **`telegraph` already carries `skill`** — the field exists, on the wrong event. **`cause` IS on `ray_fire`** (`encounter.cjs:62,79`, `'charge'`) and is what §9.2's seam branches on. | §3, §9.1, §9.3 |
| task/this REQ's own first draft: *"`DefaultRayVfx` preserves the `cause === 'pulse'` gold branch, the one wire field that varies today"* | **FALSE, both halves.** `cause:'pulse'` is stamped on exactly two events (`encounter.cjs:447,452`) and **neither is a ray event**, so `MonitorRenderer.ts:616`'s `pulseRay` branch is **dead code that has never rendered** — there is no live behaviour there to preserve. The ray-bearing `cause` is `'charge'` (`:62,79`). Seam re-based onto it. | §3, §9.2 |
| brief §6 (silent) | **§6.0's ≤3 glow budget and the combat model are irreconcilable** at a measured 19 concurrent rays. Neither the brief nor the styleguide anticipates this. | §4, §8 |
| brief §6 (silent) | **§6.6 names 戦闘再生 explicitly** in tier ②. A full-screen battle monitor cannot obey it literally, and the brief does not notice that its own §6 quotes the rule while specifying the screen that breaks it. | §10.1 |
| REQ-0261 §4.4 | Defers **link beams** to REQ-0262 — but beams are in none of (g)/(h)/(i). A deferral to a REQ whose scope excludes it. Declared OUT here, with a recommendation. | §8.4 |
| REQ-0257 §11.1: *"`:746-755` `case 'ray_hit_all'` -> `pulseCell('N9')` **unchanged**"* | **Should NOT stay unchanged on the expedition.** Once every event carries `ray`, the nova's origin is knowable (the ray's last `ray_advance`), so the `'N9'` hardcode is obsolete *because of REQ-0257's own change*. 0257 is right for the small monitor and this REQ supersedes it for `#/expedition`. | §7.1, §11.2 |
| REQ-0257 §8.5: *"REQ-0262 should surface [the telegraphed terminator]"* | **Accepted and specified** — §5.3's bounded trail plus §10.2's RM-3 both preserve the trajectory that telegraphs the nova. Recorded so the hand-off is not lost. | §5.3, §10.2 |
| `combat_spec` §10's own "balance smell" gate | **Would fire on the user's current content today**, before any REQ in this program lands: 47% terminator rate, 72.2% of ray damage. Reported jointly with REQ-0257 §14.3. **Not fixed here.** | §11.3 |
