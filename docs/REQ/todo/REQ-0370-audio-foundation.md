# REQ-0370 — Audio foundation: master/BGM/SE mixer + first BGM loop

## Status
built — all gates green on branch req-0370-audio-foundation; NOT merged/
deployed. Spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis
batch); ratified by user 2026-08-10; built 2026-08-11 (see Build record).

## Origin
UI gap analysis 2026-08-10 (Cowork). Finding P0-5.

## Problem (gamer-facing)
The game has no BGM anywhere — the title screen is silent, which is the single
strongest "not finished" signal a new player receives. The entire audio
surface is: circuit chimes during replay (`client/src/schedule/chimes/`),
warehouse claim SFX (`client/src/warehouse/claimSfx.ts`) and button FX
(`client/src/theme/buttonFx.ts`). Settings exposes ONE volume slider
(`settings.volumeLabel`, chime-scoped) — no master/BGM/SE split, no mute.

## Spec
1. Audio bus (`client/src/audio/bus.ts`): WebAudio gain graph — master →
   {bgm, sfx}. Route chimes, claimSfx and buttonFx through the sfx bus with NO
   audible change at default settings. ChimeEngine keeps its own internal
   logic; only its output node re-parents.
2. Settings — "Sound & Haptics" grows: master volume, BGM volume, SE volume,
   mute-all toggle. The existing chime slider folds into SE (keep the chime
   on/off checkbox as-is). Persistence follows the chimePrefs pattern
   (`client/src/schedule/chimes/chimePrefs.ts` — localStorage, per-device).
3. BGM playback: one looped track on the title/landing + one shared hall loop
   (or the same track) on the in-app routes. Start only after the first user
   gesture (browser autoplay law); pause when `document.hidden`. Asset is
   REFERENCED from the static docroot (`web/`), not bundled — the REQ-0069
   convention for redesign assets.
4. E2E silence: hard-off under `navigator.webdriver`, the particles.ts
   precedent — the suite must stay byte-identical in audio-free behavior.
5. OPEN ITEM (user decision, recorded here so the REQ is honest): no music
   asset exists in the repo. Deliverables 1-2 (bus + mixer UI) land regardless
   and are fully testable with existing SFX. Deliverable 3 ships with
   whatever first track the user provides/approves; a placeholder loop is NOT
   to be committed without explicit user approval.

## Gates
- Mixer: SE slider scales claim SFX; mute kills chimes+SFX (+BGM when wired);
  settings persist across reload.
- With a track present: title plays after first gesture; route changes do not
  restart the loop; reduced-motion setting does NOT affect audio.
- e2e suite runs silent (webdriver gate) and green. CI green.

## Out of scope
Per-hall unique scores, adaptive/combat music, audio content pipeline.

## Build record (req-0370-audio-foundation @ server worktree)
Built 2026-08-11 by Cowork session (user ratified BGM approach in chat:
「BGMは、AI生成で。外部サービスまたはサーバ上のモデルを使用」 2026-08-10).

### Decisions
- OPEN ITEM resolved: the first track is AI-GENERATED on llmlocal
  (MusicGen-small, facebook/musicgen-small via transformers, CPU-only so the
  GPU stays with the art pipeline -- the REQ-0158/queue interlock is not
  touched). Two candidates were auditioned; the user picked candidate B
  ("viking saga: low choir hum, cello drone, frame drum"). Committed as
  `web/redesign/assets/bgm_main_loop.wav` (28.4s, 32 kHz mono, tail->head
  1.5s crossfade for a seamless AudioBufferSourceNode loop; WAV because
  mp3/aac encoder padding audibly gaps a decoded-buffer loop).
- Title and hall scenes share this one track for now (spec explicitly
  allows it); `client/src/audio/bgm.ts` TRACKS is the single switch point
  for a later split.
- The chime-scoped volume slider was REMOVED from Settings (folded into
  the SE slider per spec item 2). `chimePrefs.volume` persists as the
  chime-internal mix level (default 0.35) under the SE bus; the chime
  on/off and haptics checkboxes are untouched.
- Mixer defaults master=1 / sfx=1 / bgm=0.6 / muted=false: unity on the
  SE path is what makes "no audible change at default settings" literal.

### What landed (commits on branch req-0370-audio-foundation)
- f8a5e82d code: audio bus (client/src/audio/bus.ts: one shared
  AudioContext, master->{bgm,sfx}), mixer prefs
  (audioPrefs.ts, localStorage `bp.audio.prefs` + same-tab
  AUDIO_PREFS_EVENT, chimePrefs pattern), Settings mixer UI
  (master/BGM/SE sliders + mute-all; testids settings-master-volume /
  settings-bgm-volume / settings-se-volume / settings-mute-toggle), BGM
  player (bgm.ts: first-gesture start, document.hidden true-pause with
  offset resume, navigator.webdriver hard-off, same-track route changes
  never restart, missing asset -> silence), re-parenting of chimes /
  claim SFX / button FX onto the sfx bus (each keeps a private-context
  fallback when WebAudio is absent; ChimeEngine.dispose no longer closes
  the shared context).
- 29e5ff46 ci-scope: `client/src/audio` declared (public surface).
- e51845da asset: bgm_main_loop.wav (candidate B) + bgm.ts .wav paths.
- f5c8ac8e dist rebuild (web/app) matching the ci receipt tree fb8c61b1.

### Gate results
- check_audio_prefs.mjs (new ci stage [5.85/7]): all assertions pass --
  defaults unity master/sfx + sub-unity bgm; normaliser clamps NaN/Inf/
  out-of-range and falls back field-wise on malformed storage.
- audio-mixer.spec.ts (new): mixer renders, defaults sane, persists to
  bp.audio.prefs, survives reload, mute round-trips, old
  settings-chimes-volume testid gone. chimes-settings.spec.ts updated for
  the folded slider.
- E2E silence: initBgm() returns before installing ANY listener under
  navigator.webdriver; buttonFx/particles gates unchanged; ChimeEngine
  behaviour logic untouched (only its output parent changed).
- Reduced-motion: motionPrefs is never consulted by the audio path.
- Full tools/ci.sh on the branch (pg stages included, [7/7] scoped
  hermetic e2e on a port-desk decade): CI GREEN, 374s; receipt written
  for tree fb8c61b1 (= commit f5c8ac8e). audio-mixer.spec.ts and the
  updated chimes-settings.spec.ts both pass inside the suite.
- NOT verified on live (built, not merged): title BGM audibly playing
  after first gesture in a real browser -- that check happens at
  merge/deploy time per the REQ-management state model. The asset URL
  (/redesign/assets/bgm_main_loop.wav) is served by the existing static
  docroot with zero server changes.

### Outcome
todo -> built. Merge/deploy NOT done; content_deploy_runbook does not
apply (no game-content registry change), but the master merge must
coordinate with the live hot-reload per PROJECT.md.
