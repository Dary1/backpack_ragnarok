# REQ-0101 — styleguide.html §07: live Motion & FX catalogue

Branch: `req-0101-styleguide-fx-catalogue` (off `master` @ fc415bf)
Commits: `f3e13e5`→`250bf3e` (§07 catalogue) · `e51803a`→`7dcb19f` (rev2) · `de4c7d0`→`8a9e2e8` (rev3) — rebased onto current master; `web/redesign/styleguide.html` only
State: **done** — rebased onto master, FF-merged to master @ `8a9e2e8`, and deployed live 2026-07-08 via backpack-web (127.0.0.1:8801) / https://backpack-dev.qtie.jp/redesign/styleguide.html . Static file server (`python -m http.server` rooted at `web/`), so the merge is served with no restart. The main checkout's uncommitted art/content WIP was left untouched.

## Goal
The MJÖLNIR styleguide documented palette/type/components well, but §07
"モーション原理" was only six prose rules — none of the ~20 CSS animations,
the four `fx.js` effects, or the client-side (React) effects were shown or
explained. Enrich the styleguide so every motion/effect used across the site
is demonstrated **live and in place**, each captioned with what it does, when
it fires, its timing/easing, and its source file.

## Decisions (user, 2026-07-08)
- Scope: **comprehensive** — mock design system *and* the shipped client
  (React) effects.
- Delivery: **worktree + REQ** — work committed on a branch for user review /
  merge (main checkout is hands-off; it also carries unrelated uncommitted
  art WIP that was left untouched).

## What changed
Only `web/redesign/styleguide.html`. Sections 01–06, 08, 09 are byte-for-byte
unchanged; header/footer bumped v1.0 → v1.1 with a "改訂 2026-07-08" chip.
§07 rebuilt as **モーション & エフェクト — live catalogue**:

- **7.0 原則** — the original six glow-discipline rules, kept verbatim.
- **7.1 発光の4瞬間** — focus-ring, legendary/mythic rarity glow, living
  `beamflow` beam, hit-flash (the four sanctioned glows).
- **7.2 常在ループ** — auroradrift, glint, pressPulse, mbob, pulse, shim,
  sksweep, placePulse, ascend.
- **7.3 登場・一過性** — rise (staggered), lbxT/lbxB letterbox, toastin,
  logIn, stampin. Each has a **再生 (replay)** button.
- **7.4 JS駆動 (fx.js)** — initParticles (ember + snow, live canvas), countUp
  (button), initParallax (pointer-reactive), and a full-width **RayMonitor**
  battle-playback canvas with a synchronized log + speed/pause controls.
- **7.5 クライアント実装 (index.css / TS)** — claim flash→fadeout **with an
  audible port of `playClaimChime()`**, tab-claim-pulse, refused-shake, plus a
  note covering the sprite→PixiJS pipeline and the particle-port gating.
- **7.6 リデュースモーション** — how it's handled (CSS blanket short-circuit +
  JS generation gating) with an illustrative freeze toggle.

## Implementation notes
- Every `@keyframes` a demo needs is **mirrored** into the page's `<style>`
  (each annotated with its source file) so the styleguide is self-contained;
  the source files remain the definition of record.
- fx.js is loaded via `<script src="assets/fx.js">`; demos are wired in a
  small IIFE (replay, log-append, particles, countUp, parallax, RayMonitor
  controls, claim chime, reduced-motion toggle). fx.js already no-ops under
  `prefers-reduced-motion`.
- The claim chime is an inline re-implementation of `warehouse/claimSfx.ts`
  (sine A5 880 → E6 1318.51 Hz, ~200 ms, exponential envelope).

## Verification
- Rendered headless (server Playwright 1.61.1 / chromium-1228, 1120px wide,
  full-page): **0 console errors, 0 page errors**.
- Structure: 9 `<section>` balanced, 3 `<script>` balanced, 7.0–7.6 present,
  v1.0 → v1.1 (2/2), tags `</body></html>` intact.
- Visual: header/chips correct, §01–06 intact, all galleries animate (ember
  particles, countUp → 24,680, RayMonitor rays+nova, glows, letterbox reveal,
  勝利 stamp, etc.). Screenshots archived at `/tmp/sgpatch/shot*.png` (server).

## Preview & deploy
- Preview now: the rendered screenshots (shared with the user in-session).
- The dev tunnel serves the **master** docroot, so to see it live at
  `https://backpack-dev.qtie.jp/redesign/styleguide.html`, merge the branch:
  from `~/backpack_ragnarok` (clean tree) → `git merge req-0101-styleguide-fx-catalogue`.
  Coordinate first: the main checkout currently has uncommitted art/content WIP.

## Open item / follow-up
Mock canon (§04 toast) specifies a **Gjallarhorn SFX on Rare+ loot**, but the
shipped client has no audio-asset pipeline and currently substitutes the
synthesized two-note claim chime (`claimSfx.ts`, REQ-0091). §7.5 flags this as
"要調整"; a follow-up REQ should either author the horn asset or update canon.

## Revision 2 (2026-07-08b) — commit `e51803a`
Follow-up user requests, applied to the same branch:
- **Buttons — 発動 effect on click, no bounce.** `.btn` / `.preset` / `.replay`
  emit a gold spark burst at the click point (`btnFire` keyframe; JS spawns a
  `.btn-fire` node). The press-down bounce is removed
  (`.btn:active{ transform:none }` overrides ui.css). Scoped to the styleguide;
  propagating it to shipped `ui.css` would be a separate REQ.
- **Bars auto-animate.** §04 bars grow their fill 0 → set value on load
  (`barGrow`) and carry a continuous sheen (`shim`).
- **Season wheel 0 → set value.** Wedges draw progressively via a staggered
  `stroke-dashoffset` reveal (`wheelDraw`, `pathLength=1`).
- **§06 モチーフ指針 deleted** wholesale (per request). Sections renumbered
  07/08/09 → 06/07/08 and all orphaned (§6)/(§7)/(§8) cross-refs fixed.
  Re-verified headless: 0 console errors, 8 balanced sections, contiguous
  numbering, no dangling §-refs; bars caught mid-grow and wheel mid-draw in an
  early-frame capture; button spark captured on click.

⚠ **Removed safety content**: deleting §06 also removed the ADL "Hate on
Display" taboo guidance (black sun / Sonnenrad, single Othala, SS-runes,
Wolfsangel, Celtic cross, 14/88, etc.). It no longer lives anywhere in the
styleguide. If the team wants it retained, recommend a separate design-safety
note. Flagging, not blocking.

## Revision 3 (2026-07-08c) — commit `de4c7d0`
User request: hover + click SFX on all samples; hover + click FX on all clickables.
- **SFX (synthesized, no assets).** Soft hover tick + a two-blip click sound
  (Web Audio, same best-effort posture as `claimSfx.ts`), wired by event
  delegation to every sample (buttons, chips, rarity boxes, item cards, toast,
  tooltip, bars, swatches, nav rail). Hover tick is throttled + once-per-element;
  the generic click sound skips 受領 (which keeps its own claim chime).
- **Click FX everywhere.** The `btnFire` spark now fires on all clickables
  (`.btn`/`.replay`/`.preset`/`.icard`/`.rail a.nav`), not just buttons. Verified
  by DOM probe: .icard/.btn/.preset/.replay each append a spark on click.
- **Hover FX everywhere.** Universal hover-brightness accent added to all
  clickables (on top of their existing per-component hovers).
- Audio can only start after the first user gesture (browser autoplay policy),
  so a hover before any click is silent by design. 0 console/page errors.

## Non-goals
No changes to ui.css / fx.js / client code; no new assets; sections other than
§07 (and the version strings) untouched.
