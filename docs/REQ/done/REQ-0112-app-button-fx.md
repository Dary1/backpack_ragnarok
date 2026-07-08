# REQ-0112 — app-wide button FX: hover glow+sound, click inner-light+sound (color-driven, bulk)

State: **done** — FF-merged to master @ `e610635` (rebuilt on current master d36f7a8 after it advanced) and deployed live 2026-07-08 to https://backpack-dev.qtie.jp/app/ (backpack-web static; no restart). e2e unaffected (layer no-ops under navigator.webdriver). Colour bucketing + hover glow + click inner-light flash + WAV decode verified headless; live gold-CTA hover glow captured.
Scope: the LIVE client `client/` (served as `web/app`, https://backpack-dev.qtie.jp/app/).

## Goal (user)
Every button on /app/:
- **hover** → glows + plays a sound (the `--focus-ring` look they liked, colorized);
- **click** → light enters inside the button + plays a sound.
Glow color and click sound are chosen by the **button's own colour**. Changing a
button's base colour is allowed if needed. **Must use a single bulk mechanism —
no per-button copy-paste.**

## Investigation (done)
- Buttons are class-based `<button class="btn|btn-forge|btn-ghost|…">` across 28
  files, plus many page-specific button classes (schedule-/dex-/workshop-/…) that
  do NOT encode colour. ⇒ colour must be read from **computed style**, not class.
- App mounts in `src/main.tsx` (single hook point). Vite `base:'/app/'`,
  outDir `../web/app`, no `public/` dir yet.
- Precedent: `landing/particles.ts` gates decorative FX off under
  `navigator.webdriver` / `prefers-reduced-motion` / low cores — follow it.
- e2e has **no** assertions on box-shadow/filter/animation/audio ⇒ FX is safe;
  still gate fully off under webdriver so e2e is byte-identical in behaviour.

## Design — one global layer (`src/theme/buttonFx.ts`, imported once in main.tsx)
- Document-delegated `pointerover` (hover) and `pointerdown/click`; targets
  `button, .btn` (covers all). No per-button edits (the "bulk mechanism").
- **Colour bucket** from `getComputedStyle`: sample background (if opaque) else
  border else text → HSL → bucket: gold / ember / blood / frost / neutral
  (low-sat night-iron → gold structural glow, the design's "focus voice").
- **Hover** → `filter: drop-shadow(0 0 7px var(--fx-glow))` (additive; does not
  fight each button's own :hover box-shadow) + a soft colour-flavoured tick.
- **Click** → inset light flash keyframe `fxClickFlash` (light "enters inside"),
  colourised, + a colour-keyed WAV.
- **Sounds**: license-clean WAVs generated on-server via modal synthesis (no
  downloads), one per bucket, in `client/public/sfx/` → `/app/sfx/*.wav`:
  gold=latch, ember, frost, blood, iron(neutral). Decoded to AudioBuffers,
  played via BufferSource; best-effort; **off under webdriver**, respects
  reduced-motion for the flash.
- Base colours unchanged (colour detection makes that unnecessary); the option
  remains if a specific button reads wrong.

## Plan
1. Generate the WAV set → client/public/sfx/.
2. buttonFx.ts + CSS (mjolnir.css) + import in main.tsx.
3. pnpm install (worktree) → `pnpm build` (tsc -b && vite build → web/app) →
   e2e smoke/baseline green.
4. Commit src + public/sfx + built web/app; FF-merge; deploy; verify live.

## Verification / gates
- typecheck+build clean; e2e baseline green; 0 console errors on /app/; WAVs 200;
  hover glow + click flash + sound confirmed (headless where possible).
