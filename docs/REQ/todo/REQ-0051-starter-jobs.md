> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0051 — Starter Jobs (four fixed 5×5 linker-less BPs)

- **Status**: USER-DESIGNED (2026-07-06) — implementation QUEUED. This REQ is the
  first docs capture of the user's plan (previously undocumented); it is the
  "right arm of the tutorial" (user's words) and the solo-play enabler.

## User spec (verbatim design, 2026-07-06)
- Grant every new player **four 5×5 BPs WITHOUT Linkers** at profile creation.
- Each comes pre-filled with **4 different fixed POs** that **cannot be moved** —
  four distinct "starter jobs".
- Each starter BP occupies one inventory page (pages 1–4).
- Players use them while convenient, then **discard** them when outgrown.
- Result: a solo player can field 4 squads immediately, progressing regardless of any
  other player's activity.
- 1-squad runs remain possible but clear only low levels with matching rewards —
  the 4-job grant is the intended on-ramp, not a hard requirement.

### Ruling addendum (user, 2026-07-06 — BINDING design philosophy)
The IDEAL endgame shape is: **one player concentrates their assets into ONE
strongest squad and plays in a troop of players.** Fielding up to 4 squads solo is a
RELIEF measure for solo players — it must never be presented or balanced as best
practice. Starter jobs are the relief's on-ramp; UI copy, tutorials and reward
curves must nudge toward troop play + single-squad mastery as players graduate.
(Same ruling rejected cross-squad Formation Links: coupling squads too tightly would
promote solo multi-boxing over cooperation.)

## Design

### Job roster (plain names per art_golden; [ORCH proposals, vetoable])
| id | job | fixed PO kit (4) | teaches |
|---|---|---|---|
| job_guard | Guard | block/Spikes-leaning kit | Backpack-as-HP, formation tanking |
| job_arms | Arms | weapon DPS kit | every_secs cadence, rays/bounces |
| job_mend | Mend | Regen/heal/cleanse kit | statuses, attrition & the H-curve |
| job_scout | Scout | detection + unlock kit (lockpick/spyglass line) | modes; layered-encounter value (REQ-0049) from run 1 |
Kits reuse live/batch-002 items where possible; gaps become a mini content batch
through the normal S0–S8 pipeline. **Dependency**: pilot utility item icons (S5,
still open) block job_scout's kit.

### Mechanics
- **Fixed placements**: placement records gain `fixed: true` — engine refuses move/
  rotate/remove for fixed POs (new engine capability + tests). Everything else about
  the BP is normal (exclusivity, deploy gating, reference model).
- **Free practice cells [ORCH addition, vetoable]**: each starter BP keeps 2–3 empty
  cells so the very first looted PO can be placed/rotated on a safe sandbox without
  waiting for the first owned BP.
- **Power ceiling** (graduation pressure): starter POs have no sockets and no
  connection ports; starter BP `hpMax` is an authored override
  **[TUNABLE 120]** — NOT the 15×cells formula (15×25=375 would out-tank every
  gacha BP and invert the power curve; authored-override capability comes with VX-1's
  `hpMax` field, already live).
- **Grant**: once per profile, same genuine-freshness gate as the Weathervane seed
  (REQ-0042 pattern). Four squads pre-seeded ("Job: Guard" … one job BP each,
  centered) so the first room deploy is 4 clicks.
- **Discard & regrant**: discard = normal BP delete; each job is **re-grantable free,
  once [TUNABLE]** via a claim endpoint — prevents new players bricking themselves;
  further regrants refused (409).
- **Linker-less on purpose** (user design): the first gacha BP (guest Weathervane
  seed covers ~10 pulls) is the deliberate "circuit unlock" beat — REQ-0048's
  mechanics stay invisible until the player holds their first linker.

### Tutorial integration
- Each job gets a **Dex job card** (archetype explanation, suggested formation slot);
  tutorial text lives in Dex, opened via REQ-0052 subwindows at first-touch moments
  (first deploy → job card; first trap survived → Scout card; first linker'd BP →
  Linker chapter). No modal-script tutorial is built or maintained.
- Graduation prompt [ORCH, vetoable]: when a crafted/gacha BP first out-stats a job
  BP on the same squad, surface a gentle "outgrown?" hint on the job squad tab.

### Dual use
The four job canvases are committed to `content/s4_boards/` as S4 reference fixtures
(REQ-0050) — the tutorial loadout and the balance baseline stay the same artifact.

## Test plan (gates before DONE)
- engine: `fixed` flag refusals (move/rotate/remove/transfer), migrateState back-compat.
- server: grant idempotency (files+pg), regrant once-then-409, squad seeding shape.
- sim: none (starter BPs are ordinary content to the sim).
- client E2E: fresh-guest first-run flow (invite → 4 job squads visible → create room
  → deploy 4 squads → run settles → claim), fixed-PO drag refusal UX, discard+regrant.
- S4: inaugural baseline includes the four job boards (REQ-0050).
- i18n: ja names/flavors for jobs and kits.
