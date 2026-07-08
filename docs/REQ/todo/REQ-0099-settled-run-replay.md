# REQ-0099 — Settled-run replay player (playback controls)

- **Status**: DRAFT (原案) — awaiting owner review (2026-07-08). Part of the
  Expedition 大改修 series (see REQ-0097 §Series). Mock element: the monitor ctrl
  bar's `⏸` / `1× 2× 4×` / `結末まで飛ぶ`. Home = REQ-0097's shared center monitor.
- **Origin**: REQ-0071 omitted playback because "replay pacing is SERVER
  wall-clock … pausing/fast-forward/skip have no honest implementation" — TRUE for
  a LIVE run (REQ-0045 spectator contract: a client may never see past the run
  clock). This REQ scopes playback to **SETTLED runs only**, where the full
  deterministic JSONL already exists (REQ-0036/0045), making scrub/speed/skip
  honest and spoiler-free.

## Design

- **Gate**: the transport appears ONLY when the run is settled (`run.settled`, or
  result ≠ `incomplete` AND clock past duration). While a run is LIVE/unsettled the
  ctrl bar stays clock-locked exactly as today — no change to the live path, no
  server change.
- **Client (local playhead over the full event list)**: the monitor already
  fetches and holds the event stream (REQ-0036 diff-render; REQ-0045 Log tab reads
  `visibleEvents`). For a settled run, drive a LOCAL playhead:
  - transport: play / pause; speed 1× / 2× / 4× (scales the local tick → event-time
    mapping); a scrub bar (seek to any `t`: reset to t=0 / nearest keyframe then
    fast-apply the diff-render up to `t`); `結末まで飛ぶ` = seek to the last event.
  - the REQ-0071 ctrl-bar timeline becomes the scrubber; its encounter pips become
    seek targets.
- **Shared primitive**: the `seek(t)` / full-reset capability is the SAME reset
  REQ-0097's `retarget` needs — build once, share (coordinate ordering).
- **Honesty**: settled replays are deterministic and complete → scrubbing only ever
  shows real, already-settled state; nothing is revealed that the run didn't
  produce. Live runs are untouched.

## i18n

`schedule.monitor.replay.play` / `.pause` / `.speed` / `.skipEnd`
(EN natural / ja mock copy: 結末まで飛ぶ, etc.).

## Selector contract

New: `schedule-monitor-transport`, `schedule-monitor-play`,
`schedule-monitor-speed-1|2|4`, `schedule-monitor-skip-end`,
`schedule-monitor-scrub`. Live-path selectors unchanged.

## [USER] decision list

1. Default speed on open (1× recommended).
2. Scrub granularity: continuous vs snap-to-encounter.
3. Persist a "watched to end" mark? Likely NO (no backing data today).

## Dependencies

- REQ-0097 (the transport lives in the shared center ctrl bar). Could be prototyped
  on the current nested monitor if 0097 slips, but its final home is the center
  pane. Reuses `MonitorRenderer` diff-render + the shared `seek/reset` primitive.

## Test plan (gates before DONE)

- client E2E: settle a run (backdate) → transport visible; play advances the clock;
  2× advances ~2× faster; scrub to mid shows mid state; skip-to-end shows the
  settled summary; a LIVE (unsettled) run shows NO transport (clock-locked).
- guard: seek determinism — seek to `t` then play forward == play straight to `t`.
- `tsc -b` clean; fresh dist committed. No server change.
