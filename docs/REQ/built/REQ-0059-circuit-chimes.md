> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Unit (character piece). Verbatim pre-rename user quotes may survive unchanged.

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

---

## Implementation log (2026-07-14) — req-0059-circuit-chimes

**Status:** BUILT (client-only). Zero sim/server change. Not merged/deployed
(integration owner handles that).

### What shipped
- `client/src/schedule/chimes/chimeMapping.ts` — the pure, deterministic
  `eventToChime(ApiRunEvent) -> ChimeInstruction | null` mapping (+ tuning
  helpers, haptic patterns, `ChimeSink` seam). This is the determinism
  contract ("same build, identical jingle every replay"); unit-gated.
- `client/src/schedule/chimes/ChimeEngine.ts` — feature-detected WebAudio
  scheduler + `navigator.vibrate` haptics driver. Notes ride the
  AudioContext clock (not frame callbacks); playback gated OFF while
  `document.hidden`. Implements `ChimeSink`.
- `client/src/schedule/chimes/chimePrefs.ts` — localStorage prefs
  (chimes/haptics/volume) + reduced-motion-aware default + change event.
- `client/src/schedule/MonitorRenderer.ts` — feeds every NON-silent event
  to the chime sink (same gate as transient VFX ⇒ perfect A/V sync);
  audio wrapped in its own try/catch so it can never break visuals.
- `client/src/schedule/Monitor.tsx` — owns the engine (create on mount,
  attach to renderer, live-update prefs via CHIME_PREFS_EVENT/storage,
  `resume()` on the Play gesture, dispose on unmount, `chimeStats` seam).
- `client/src/Settings.tsx` + `client/src/i18n/settings.ts` — "Sound &
  Haptics" section: chimes on/off (default ON), haptics on/off, volume;
  en + ja strings.
- `client/scripts/check_chime_mapping.mjs` — pure-function unit gate
  (vite ssrLoadModule rig), wired into `tools/ci.sh` as step [5.8/7].
- `client/e2e/chimes-settings.spec.ts` — settings toggles exist + persist.

### Mapping table implemented (deterministic)
| Replay event | Chime | Haptic |
|---|---|---|
| `link_pulse` (hop) | tone; pitch = beam direction 0–7 → 8-tone (C major) one-octave scale; dyed→triangle, hop-lens→square timbre | short `[10]` |
| `ray_hit` (cause:pulse, strike) | major triad (C3 root) | medium `[25]` |
| `apply_status` (cause:pulse) | minor triad | medium `[25]` |
| `pulse_payload` (heal/block) | suspended triad | medium `[25]` |
| `ray_bounce` (bounce 1–4) | percussion tick, count-scaled | — |
| `ray_hit_all` (5th-bounce all-field) | cymbal + 220ms enforced silence | long `[70]` |
| death (hp_after≤0 on pulse hit) / `bp_destroyed` | low chord | `[90]` |
| `will_fire` (REQ-0056) | last-breath arpeggio | `[15,20,15,20,40]` |
| non-pulse strikes, `ray_step`, `progress`, … | silent | — |

### [ORCH default, vetoable] decisions
1. **No Tone.js dependency.** Spec allows it, but raw WebAudio covers the
   needed voices with zero lockfile churn on a moving master. Conservative.
2. **link_pulse pitch is derived from link-edge identity `from>to`**, not a
   geometric 0–7 direction: the sim's `link_pulse` event carries no `dir`
   and zero sim change is mandated. Each directed link edge gets one fixed
   scale degree ⇒ canvas topology composes the tune, identical every replay
   (faithful to "direction IS the melody"). Payload `ray_fire` events, which
   DO carry a geometric `dir`, use it directly.
3. **Chord colour realized on the verb-bearing payload event** (`ray_hit`/
   `apply_status`/`pulse_payload`, all `cause:'pulse'`), not on `ray_fire`
   which carries no verb — one correctly-coloured chord per payload, no sim
   change. The pulse `ray_fire`/`ray_step` onset stays silent.
4. **`bp_destroyed`/`will_fire`/dye/hopBonus are future-proofed**: the sim
   does not emit them today (REQ-0056 draft, REQ-0054 superseded). The
   mapping handles them (and derives death from `hp_after≤0`), so they light
   up automatically if/when those REQs land — unit-tested via synthetic
   events, no sim change.
5. **reduced-motion** suppresses chimes by default on a first visit only;
   an explicit saved toggle always wins.

### Gate results (worktree, post-`git merge master d51b1d6`)
- `flock /tmp/backpack_ci.lock env SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh` →
  **CI GREEN** (all steps incl. new [5.8/7] circuit-chime mapping:
  "check_chime_mapping: all assertions pass"; sim 110/0 walker etc.;
  client tsc + vite build clean). SKIP_PG: change is client-only, no server/
  DB touch; the deterministic suite (sim/mock-src/server-files/typecheck/
  build) is fully green.
- e2e `chimes-settings.spec.ts` (against this worktree's build, box-locked,
  live profile backed up/restored sha256 match) → **1 passed**.
- Regression: `schedule.spec.ts -g "monitor"` (my ChimeEngine now also runs
  on the replay pipeline) → **6 passed** (incl. REQ-0048 injected pulse
  events). No new failures attributable to this REQ.

### Commits (branch `req-0059-circuit-chimes`)
- `20ecf16` — feature (client-only replay audio + haptics + settings + gate).
- `64a45ff` — merge master (d51b1d6) into the branch (clean, no conflicts).
- (this log append + `git mv todo → built` follow as their own commits.)
