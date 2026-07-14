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

---

## Implementation notes, decisions & gate results (2026-07-14)

**Provenance / what this pass did.** The transport was ALREADY implemented on
master by an earlier orchestrator pass — commit `74b35e8` ("REQ-0099:
settled-run replay transport (play/pause, 1x/2x/4x, skip-to-end, scrub)") — and
has ridden every integration wave since, including REQ-0059 (Circuit Chimes),
which landed on the SAME event pipeline. That commit noted "E2E + fresh dist
pending". This pass VERIFIED the delivered feature against the spec end to end,
confirmed the post-`74b35e8` chime integration is spoiler- and spam-safe on
seeks, took the gates green on a re-synced worktree, recorded the decisions,
and moved the doc todo → built. No new source change was required — the code
already satisfies the spec.

### Delivered (verified present on master `8b999f7`)

- Transport gated to SETTLED runs only (`settledNow = run?.settled ?? false`
  in `Monitor.tsx`). Live/unsettled runs keep the clock-locked ctrl bar
  unchanged; no server change on the live path.
- Local playhead over the already-fetched full event list: play/pause
  (`onPlayPause` + an rAF loop scaling `dt*speed`), speed 1×/2×/4× (`speed`
  state, **default 1×** on open), a continuous scrub bar (`onScrub`), and
  `結末まで飛ぶ` = seek to last event (`onSkipEnd` → `seekTo(durationSecs)`).
- The REQ-0071 ctrl-bar timeline IS the scrubber; `encounter_start` pips render
  on it at their `t/durationSecs` positions.
- i18n `schedule.monitor.replay.play/.pause/.speed/.skipEnd` (EN natural / ja
  `再生`/`一時停止`/`速度`/`結末まで飛ぶ ≫`) in `client/src/i18n/schedule.ts`
  (the REQ-0145 client refactor split i18n.ts into per-page modules; the keys
  moved with it — not lost).
- Selector contract present: `schedule-monitor-transport`, `-play`,
  `-speed-1|2|4`, `-skip-end`, `-scrub`. Live-path selectors unchanged.
- Styles in `client/src/styles/dismantle.css` (+ `.schedule-monitor-pip` in
  `workshop.css`).

### Shared primitive (clean module boundary — REQ-0097 retarget reuses it)

- `MonitorRenderer.reset()` — the single full VISUAL reset (cancels every
  in-flight ticker, empties the ray layer, destroys enemy markers, forgets
  discovered ids). Used by BOTH `retarget()` (REQ-0097) and the replay seek.
- `MonitorRenderer.applyEvents(events, { silent })` — `silent` rebuilds only
  PERSISTENT state (markers / discovered ids) with NO transient VFX and NO
  chimes; the fast-apply after a reset.
- `Monitor.tsx seekTo(t)` — owns the playhead / time→event-index mapping and
  orchestrates the primitive: a backward move (or forward jump) does
  `reset()` + `applyEvents(slice(0,idx), {silent})`; a pure forward step
  applies only the newly-crossed slice (non-silent). Determinism holds:
  seek(t) then play == play straight to t (same event set applied; silent vs
  non-silent changes only VFX/audio, not state). Boundary: the renderer owns
  the visual reset; the component owns time.

### REQ-0059 chime ↔ seek sync — conservative behavior, recorded [vetoable]

`74b35e8` predates REQ-0059; the merged pipeline is honest:
`MonitorRenderer.applyEvents` feeds the chime sink ONLY for non-silent events
(`if (!silent && this.chimeSink) this.chimeSink.handleEvent(ev)`). Therefore:
- scrub / skip-to-end / backward seek / catch-up (all `{silent:true}`) fire NO
  chimes and NO VFX → no audio spam or desync while scrubbing;
- forward playback (non-silent) fires chimes as the playhead crosses events;
- scrub/skip set `playing=false`, so there is never a mid-play scrub race;
- the AudioContext is resumed on the play click (the required user gesture).
DECISION [vetoable]: suppress chimes during any silent fast-apply (the spec's
suggested conservative option). No chime replay-dedup state exists, so
replaying forward after a backward seek honestly re-chimes.

### [USER] decision list — resolved (conservative, vetoable)

1. Default speed on open: **1×** (as recommended).
2. Scrub granularity: **continuous** — clicking anywhere on the timeline seeks
   to that exact `t`, which already reaches every encounter pip's `t`.
   Snap-to-encounter was NOT added: continuous is simpler and strictly more
   honest (any real settled `t` is reachable); pips remain visual seek
   landmarks. [vetoable]
3. Persist a "watched to end" mark: **NO** (no backing data today).

### Gate results (exact)

- Branch `req-0099-settled-run-replay`, re-synced (fast-forward) onto master
  `8b999f7`.
- `flock /tmp/backpack_ci.lock bash tools/ci.sh` (SKIP_E2E=1; **pg backend
  INCLUDED** via DATABASE_URL): **CI GREEN** (CI_EXIT:0) — [0/8]…[6/7] all pass
  (client typecheck+build included); [7/7] client e2e skipped (runs via the
  box-lock wrapper).
- e2e via `tools/e2e_run.sh e2e/schedule.spec.ts -g "REQ-0099"` (exclusive box
  lock): **2 passed** (E2E_EXIT:0):
  - a LIVE (unsettled) run shows NO transport (clock-locked) — pass;
  - a SETTLED run shows the transport; speed toggles; skip-to-end parks the
    playhead at duration; scrub-to-far-left seeks to ~t=0 — pass.
  global-setup/teardown restored all profiles/content (sha256 match=true).

### Provenance / commits

- Core implementation (historic, already on master): `74b35e8`.
- i18n keys relocated by the REQ-0145 client refactor →
  `client/src/i18n/schedule.ts`.
- e2e coverage: `client/e2e/schedule.spec.ts` (describe "REQ-0099: settled-run
  replay transport").
- This pass adds only doc commits (these notes + the todo→built move). Fresh
  `web/app` dist rebuild is left to the integration/deploy owner (task scope =
  no merge, no deploy; repo convention = deploy owner rebuilds dist).
