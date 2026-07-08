# REQ-0048 — Linker Combat Effects v1 (Pulse + Resonance)

- **Status**: DESIGN RATIFIED by user ("all green", 2026-07-06) — implementation QUEUED
- Fills the seats item_spec §4/§7 reserved (`On Link pulse` trigger, "linked BP" target).
  Glossary rule honored: "Items come first; Linker applications follow" — items exist
  (vocab v5, live content), so this REQ now defines Linker applications.
- Supersedes combat_spec v0.3 **OQ8** ("links have NO combat effect") upon implementation.

## User spec
Consultant review (2026-07-06, chat) identified the dormant Linker as the project's
largest design debt: the golden's core fantasy ("watch the circuit ignite") had no
mechanical presence in combat (`sim/combat.cjs` consumes no link facts — verified).
Proposal of two v1 mechanisms + one deferred was ratified "all green". User also asked
for an expanded idea pool (recorded in §5, NOT ratified).

## Ratified vocabulary / schema growth (design events, user-approved 2026-07-06)
- `content/vocab.json` **triggers** += `on_link_pulse`
- **verbs** += `pulse` (no `n`), `buff_linked` (params: `stat`, `n`, `tag`, `dir`: `out|in|mutual`)
- Effect **cond** values += `linked_in` / `linked_out` / `mutual` (schema growth, mirrors
  the existing `assembled` cond pattern; compile-time boolean per host BP)

## Design

### Mechanism A — Pulse (trigger forwarding; the circuit)
- **Emit**: any effect may carry `verb {t:'pulse'}`. When it fires (any trigger:
  `every_secs` "spark" items, `on_bp_damaged` retaliation nets, `battle_start` openers —
  all free combinations, no extra vocab), the host BP's Linker emits one pulse along
  ALL its established outgoing links (fan-out allowed).
- **Propagate**: pulses hop automatically through receiving BPs' linkers (chains work
  without a spark in every BP). Per-pulse state: `{origin, visitedBpUids, hopsLeft}`.
  Anti-infinite (research-doc CR-8 failsafe, formalized): visited set = no revisit within
  one pulse; hop budget **[TUNABLE H=3]**; mutual links never echo back (visited).
- **Hop latency [TUNABLE 0.15s]**: deterministic event ordering + the monitor shows the
  wave travel. Rate guard **[TUNABLE PULSE_CAP = 2 pulses/sec per origin linker]**,
  excess dropped with a `pulse_fizzle` log line (DoS/balance guard, like step budget).
- **Receive**: on arrival at a live BP, every hosted PO with trigger `on_link_pulse`
  fires its verbs. Strike-type payloads fire their normal ray via their own
  `attack_profile` (whole §2–4 ray pipeline reused — pulses cause visible extra rays);
  block/heal/Regen payloads apply to the host BP. `every_secs` schedules are NOT reset.
- **Mode gating**: a payload fires only if its `modes` matches the current context
  (consistent with §6.2; non-matching payloads stay paused, never bank). Under
  REQ-0049 layered encounters this yields detection/unlock circuits for free.
- **Death**: a destroyed BP's linker is inert (no send/receive/relay); in-flight pulses
  to it fizzle. Static link graph + liveness check at arrival (no mid-run relink, ever).

### Mechanism B — Resonance (link-scoped passive buffs; near-zero runtime cost)
- `buff_linked` (trigger `passive`) buffs qualifying-tag POs in linked BPs, direction
  per `dir`: `out` (receiver side), `in` (sender side), `mutual` (mutual pairs only).
- Folded entirely at compile (link graph is static once placement locks) as fold pass 3
  after `buff_adjacent`. Mutual pairs multiply resonance contributions by
  **[TUNABLE MUTUAL_RESONANCE_MULT = 1.5]** — the first real payoff for spending two
  beam directions on each other ("allowed, not always optimal" finally has a price tag).

### Mechanism C — Lifeline (damage/heal routing) — **DEFERRED to v1.1**
Redirect X% of ray damage from linked BP to self / `on_bp_damaged → heal_bp(linked)`.
Invasive to `dealHit`; wait for A/B field data.

### Sim / engine integration
- Sim stays runtime-dependency-free (REQ-0047 frozen contract #6): the beam first-hit
  scan is **re-implemented inside sim** from snapshot data (bps' linker cell + dirs),
  with an engine↔sim **parity test** on shared fixtures (must match `traceBeams`).
- Compile additions: linkGraph (directed edges), cond booleans, resonance fold.
- Replay events (spectate contract §1.5): `link_pulse {t,from,to,hop,origin}`,
  `pulse_fizzle {reason}`; payload rays carry `cause:"pulse"` for monitor coloring.
- Client: beam/pulse animation on the existing monitor; Dex effect renderer gains
  wording for the two new verbs (eff_render.cjs).

### Balance guardrails
- Payload `n` bands authored BELOW `every_secs` equivalents (they multiply with circuit
  size). S4 (REQ-0050) must measure: circuit amplification factor (linked vs link-less
  same board) — warn above **[TUNABLE 2.5×]**; pulse rate cap hit frequency; hop-depth
  distribution.
- Starter jobs (REQ-0051) are linker-less by user design → the first linker'd BP
  (first gacha pull; guest seeds cover it) is the deliberate "circuit unlock" beat.

## §5 Idea pool — **RATIFIED wholesale by user ("All Green", 2026-07-06)**
> Each item still requires its own spec/REQ before build; the guardrails in item 8
> are binding immediately. A second, broader brainstorm batch was delivered in chat
> the same day (selection pending).
1. **Capacitor/Overcharge**: `on_link_pulse: gain charge` + `every_secs: strike n×charges,
   reset` — burst rhythm builds (slow spender fed by fast sparks).
2. **Resonant Pair exclusives**: effects gated on `cond:mutual` that synchronize the pair
   (twin volley: both BPs' next rays fire at the same t / share one entry cell).
3. **Long-haul bonus**: pulse payload (or resonance) +X% per canvas cell the beam
   traverses — rewards placing linked BPs far apart; spatial tension vs compact packing;
   legible (the long beam is visible).
4. **Ring circuit**: closed loops (A→B→C→A) detected at compile grant a loop-wide
   passive (e.g. pulses inside the ring get +1 hop). Rings cost beam directions —
   a high-skill construction goal.
5. **Pulse imprinting**: a spark can dye its pulse with a status; downstream strike
   payloads add `apply_status` of that dye — "circuit coloring" combo axis.
6. **Linker types** (schema seat already reserved): Amplifier (+1 hop on pass-through),
   Splitter (re-fans a received pulse even without payloads), Condenser (merges pulses
   arriving within Δt into one boosted fire). A second content axis; pairs with
   Weathervane/Tuner economy (REQ-0053).
7. **Cadence coupling**: Haste/Chill do NOT affect hop latency (ruled here for
   legibility) — but a linker-type or relic that does is a possible rule-breaker item.
8. Guardrails (standing): no link↔field-ray direction interaction (illegible);
   no mid-run relinking; all pulse randomness confined to seeded sub-streams.

## Pack assignment (user ruling 2026-07-06; catalog = REQ-0062)
Spark/payload PO families debut in the **Ember Pack** (multi-direction standard
linker BP + spark/payload bonus slots — the circuit-starter bundle); the same POs
also enter normal dungeon drop tables in their content batch.

## Test plan (gates before DONE)
- sim: pulse propagation (chain/fan-out/cycle/visited/hop budget/cap), resonance fold
  values, cond booleans, mode-gated payloads, destroyed-BP fizzle, determinism goldens
  (same seed ⇒ byte-identical JSONL incl. new events), engine↔sim beam parity.
- engine: none (engine untouched; beams already exist).
- server: schedule/monitor passthrough of new event kinds.
- client: E2E monitor renders pulse animation + colored payload rays; Dex renders new
  verbs; tsc/lint/build.
- S4 (once REQ-0050 lands): amplification + hop metrics wired.

## Gate results & outcome (2026-07-09, branch `req-0048-linker-effects-v1`)

Implemented in server worktree `~/backpack_ragnarok_worktrees/req-0048-linker-effects-v1`.
Commits:
- `975c7de` sim core — pulse propagation (fan-out, visited/mutual-echo guard, hop
  budget H=3, hop latency 0.15s, PULSE_CAP 2/s + pulse_fizzle, mode-gated
  on_link_pulse payloads, dead-BP fizzle) + resonance fold pass 3 (MUTUAL 1.5) +
  linked_in/out/mutual cond flags + replay events link_pulse/pulse_fizzle/
  pulse_payload + tunables; +8 sim tests.
- `3a94caa` backend — vocab growth (trigger on_link_pulse; verbs pulse,
  buff_linked); eff_render EN+JA wording; engine↔sim beam parity test.
- `ebbb705` client — MonitorRenderer pulse visuals (gold circuit-ignite pulse per
  hop; gold-tinted payload rays) + run-log lines; compile.cjs linkEdges type fix.
- `17efa1a` client e2e — pulse monitor spec + __monitorDebug seam
  (pulseCounts/applyTestEvents) + vite dist rebuild.

Gate matrix:
- sim tests: PASS (83) — chain/fan-out, visited/mutual no-echo, hop budget,
  rate-cap fizzle, mode gating, dead-target fizzle, resonance fold, cond flags.
- sim replay goldens: PASS (12) — byte-identical (linker-less/pulse-less unchanged).
- engine↔sim beam parity: PASS — sim linkEdges == engine.js traceBeams (live fixture).
- mock-src engine tests: PASS (101). server tsc: PASS. engine type-drift: PASS.
- server api tests (files backend): PASS (153).
- client tsc -b + vite build + oxlint: PASS (0 errors).
- client E2E (pulse monitor): PASS — REQ-0048 spec green against the LIVE API with
  the worktree build served on a side port; global-teardown restored the live
  profile + content byte-identically (sha match=true).
- server api tests (pg backend): NOT run in worktree (pg module absent from the
  minimal worktree root deps; this REQ does not touch storage — expected to pass
  as on master given a pg env).
- full E2E regression suite (135 specs): NOT run to completion — shared e2e-rig
  `:8803` proxy contention (a persistent proxy collides with Playwright's
  hardcoded `:8803` webServer). Feature spec is green and the change is additive
  (new event cases + a debug seam + vocab/eff_render entries); recommend a
  full-suite run at the next clear rig window before deploy.

Supersedes combat_spec v0.3 OQ8 ("links have no combat effect").
NOTE: pulse CONTENT (spark/payload POs) debuts later in the Ember Pack (REQ-0062);
S4 amplification/hop metrics are wired by REQ-0050.
