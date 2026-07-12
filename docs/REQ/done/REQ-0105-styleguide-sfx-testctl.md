# REQ-0105 — styleguide: forge/frost SFX retune + interactive test controls

Branch: `req-0105-styleguide-sfx-testctl` (off `master` @ 8a9e2e8)
Commit: `e30ac8a` — `web/redesign/styleguide.html` only (+103 / −31)
State: **done** — FF-merged to master @ `e30ac8a` and deployed live 2026-07-08 via backpack-web (127.0.0.1:8801) / https://backpack-dev.qtie.jp/redesign/styleguide.html . Static server, no restart. Main-checkout art/content WIP left untouched.

## Why
User feedback: the interaction SFX (plain sine/triangle beeps from REQ-0101 rev3)
did not fit the MJÖLNIR taste. Also requested: test buttons for anything that
can't be verified without one (bars, and the audio).

## What changed (styleguide.html only)
- **SFX redesigned to the taste** (still synthesized, Web Audio, no assets):
  - `hoverSfx` — a cold iron/frost **tick**: bandpassed decaying noise (5.4kHz)
    + two faint high partials (3.18k/6.3k). Very soft.
  - `clickSfx` — a **forge strike**: noise contact transient (2.4kHz) + low iron
    body (150Hz triangle, lowpassed) + an inharmonic "gold ring" (274Hz ×1, ×2.76,
    ×5.18, lowpassed). Weighty, metallic, short.
  - New helpers `tone()` / `noiseHit()`; the old `blip()` is removed.
- **Test controls (things that need a button to verify):**
  - §04 bars: per-bar **▼/▲** buttons (`data-bar`/`data-d`) raise/lower the value
    ±12% (clamped) with a `width` transition (.45s) and a live % readout — the
    fill animation can now be driven on demand. (Kept the on-load grow + sheen.)
  - §04 season wheel: **再描画 ↻** button re-runs the 0→value wedge draw.
  - §06 new **6.7 効果音テスト** with **ホバー音 / クリック音** audition buttons
    (`data-sfx`), routed in the click handler (and excluded from the generic
    click sound to avoid doubling). 受領チャイム stays in §6.5.

## Verification (headless, server Playwright)
- 0 console/page errors.
- Offline-render (OfflineAudioContext) of the two designs: **hover peak 0.031 /
  rms 0.0038**, **click peak 0.215 / rms 0.0152** — audible, good hover≪click
  contrast, non-clipping.
- DOM: 再描画 → 12 wedges; bar ▲/▼ dur 64%→76%→52% with the % label tracking.
- Live serve check (:8801 & tunnel): 1015 lines, `data-sfx`×2, 6 `barbtn`,
  `noiseHit` present, old `blip` gone.

## Notes / follow-ups
- SFX are still **procedural** (consistent with the no-audio-asset convention;
  `claimSfx.ts`). Timbres/volumes (hover 3.18k/6.3k, click 274Hz partials, gains)
  are easy to retune if the taste needs nudging.
- The shipped React client still uses the plain claim chime only; propagating
  these forge/frost UI SFX into the live client would be a separate REQ (needs an
  interaction-sound layer + reduced-motion/settings gating).
- Branch + worktree removed after merge; server scratch cleaned.
