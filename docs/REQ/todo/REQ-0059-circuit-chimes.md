> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# REQ-0059 — Circuit Chimes (+ mobile haptics)

- **Status**: ADOPTED by user (2026-07-06, 「素晴らしい」; haptics user-ordered) —
  implementation QUEUED
- Origin: brainstorm batch 2 item 13. Every build gets a deterministic audio
  signature — "your circuit's ignition jingle" — because the replay stream already
  carries everything needed. Pure event consumer; ZERO sim change.

## User spec
「素晴らしい。REQに起こしてください。スマホならバイブレーションも。」

## Design
- **Mapping (deterministic, from replay events)**:
  - `link_pulse` hop → tone; **pitch by beam direction 0–7** (8-tone scale, one
    octave; direction IS the melody — canvas layout composes the tune).
  - payload `ray_fire (cause:pulse)` → chord color by verb (strike/major,
    apply_status/minor, block-heal/suspended).
  - `ray_bounce` → light percussion tick, count-scaled; 5th-bounce all-field →
    cymbal + brief silence (the nuke gets a beat of respect).
  - `bp_destroyed`/`will_fire` (REQ-0056) → low chord / last-breath arpeggio.
  - dye/hop lenses (REQ-0054) → timbre variation (dyed pulses sound "colored").
- **Engine**: client-only, WebAudio (Tone.js is already an allowed dependency
  pattern); synthesizes from the SAME event stream the monitor animates — perfect
  sync, replays sound identical every time (determinism made audible).
- **Haptics (mobile, user-ordered)**: `navigator.vibrate` patterns mirroring the
  pulse rhythm (hop=short, payload=medium, 5-bounce/boss death=long); feature-
  detected, silently absent elsewhere; independent toggle.
- **Controls**: settings — chimes on/off (default ON at low mix volume), haptics
  on/off, volume; respects platform reduced-motion/mute conventions; OFF during
  background tabs (rAF throttling lesson — audio must not desync: schedule from
  event timestamps, not frame callbacks).
- **Social tie-ins**: sealed-seed comparison (REQ-0058) plays both timelines'
  chimes on hover; a build's jingle is a shareable identity artifact ("hear my
  ignition") — no extra feature needed, the monitor replay IS the player.

## Test plan
- squad: event→note mapping table (pure function, snapshot-tested), timestamp
  scheduling (no frame dependence).
- E2E: toggle on/off, no console errors headless (audio context mocked), settings
  persistence, vibrate called with expected patterns under a mocked navigator.
- manual gate: one replay listened on desktop + one on phone (haptics) before DONE.
