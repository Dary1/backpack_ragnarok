# REQ-0370 — Audio foundation: master/BGM/SE mixer + first BGM loop

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

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
