# REQ-0143 — overlay-accessibility

**Status:** todo
**Reserved:** 2026-07-12
**Slug:** overlay-accessibility
**Origin:** 2026-07-12 UI/UX + AI-pipeline review session; user verdict **ALL GREEN**.
**Reference:** `docs/llm_managed/backpack_skin_pipeline.md` (BS-G1 overlays are
renderer-drawn and skin-independent; BS-G2 legibility floor — band width and
contrast budget OPEN), `docs/llm_managed/unit_icon_pipeline.md` (G4 64 px rule),
`docs/user_managed/game_golden.md` (Ragnarok Frame slow-mo).

## Goal

BS-G1 makes the renderer the single enforcement point for every gameplay
signal — use that. One accessibility pass over renderer overlays, plus the
measurement harness that settles BS-G2's open numbers.

## Scope

1. **Colorblind-safe palettes** for team/enemy tint, element tints, damage
   state, charge UI: validate under deuteranopia/protanopia/tritanopia
   simulation; never encode meaning in hue alone (add shape/pattern cues).
2. **Reduced-motion setting** covering the Ragnarok Frame slow-mo, beam
   animations, and charge pulses; honor it app-wide (`prefers-reduced-motion`
   as default seed, explicit toggle in Settings).
3. **Extend G4 discipline to overlays:** automated contrast measurement
   (relative-luminance delta) of overlay-on-skin composites at board scale
   (64 px/cell) across the skin validation shape suite. This harness EMITS the
   numeric recommendation for BS-G2's border band width (px at 256/cell) and
   fill contrast budget — the decision method the user ratified 2026-07-12;
   the final numbers remain a user ratification on this REQ's output.

## Non-goals

No skin-side changes (skins stay cosmetic-only); no full WCAG audit of menu
chrome (worthy, separate); no rebalance of art_golden coverage rules.

## Gates

- CVD simulation screenshots reviewed; palette passes hue-independence check.
- Settings toggle e2e (`pnpm run e2e`).
- Harness outputs BS-G2 numbers + gallery; user ratifies the numbers.

---

## Implementation record (REQ-0143 — built 2026-07-14)

**Branch:** `req-0143-overlay-accessibility` (worktree off master `80b21f3`).
**Status:** built. **This REQ STAYS in `built/` after merge** — see the OPEN
USER RATIFICATION item below (BS-G2's final numbers are the user's call on the
harness output).

### 1. Colourblind-safe overlay palette
`client/src/board/overlayPalette.ts` is the single source of truth for every
renderer-drawn gameplay-signal overlay colour + its non-hue cue (BS-G1: the
renderer is the sole enforcement point; skins can never carry these). Colours are
drawn from the **Okabe-Ito / Wong (2011)** colourblind-safe qualitative palette.
Every meaning group also declares a non-hue cue so meaning is never in hue alone:

| group | states → colour (Okabe-Ito) + cue | was |
|---|---|---|
| usage wash | selfSquad = vermillion `#d55e00` (hatch-diagonal); otherSquad = blue `#0072b2` (hatch-dots) | red `0xff3b3b` / yellow `0xffd23b` (both warm; collapse under deuteranopia) |
| drop-target | ok = bluish-green `#009e73` (ring-solid); bad = vermillion `#d55e00` (ring-dashed) | green `#5cb573` / red `#c05050` (red/green confusion) |
| combat side | team = blue `#0072b2`; enemy = vermillion `#d55e00` | (not drawn yet) |
| element | fire=vermillion / water=blue / nature=bluish-green / arc=reddish-purple, each a distinct glyph | (not drawn yet) |
| damage | damaged = orange `#e69f00` (crack-light); critical = vermillion `#d55e00` (crack-heavy) | (not drawn yet) |
| charge | fill = sky-blue `#56b4e9`; ready = orange `#e69f00`; the arc SWEEP is the non-hue channel (G7) | (accent only) |

The renderer (`BoardRenderer.ts`) consumes the palette for the two overlays that
exist today — the REQ-0030 usage wash and the placement-validity target — both
recoloured to CVD-colour-separable pairs (harness-proven ΔE 26.3 / 28.3 under all
three sims). The remaining groups are defined centrally and drawn when combat /
elements / damage land (BS-G1). The chain-link delete **button** `#c05050` is left
as-is: UI chrome, explicit non-goal (no menu WCAG audit).

### 2. Reduced-motion setting
`client/src/a11y/motionPrefs.ts` mirrors REQ-0059's chimePrefs (localStorage
`bp.a11y.prefs`, same-tab change event, pure Node-testable normaliser). It seeds
from `prefers-reduced-motion: reduce` (and `navigator.webdriver`, so e2e keeps
REQ-0113's behaviour); an explicit **Settings → Accessibility** toggle overrides
the seed. It OWNS the `:root[data-motion]` gate REQ-0113 introduced inline in
main.tsx — so every decorative CSS motion is now controlled by this one toggle
app-wide — and adds `:root[data-reduced-motion]`. `getReducedMotion()` is the
synchronous accessor the Pixi renderer / the future Ragnarok Frame slow-mo, beam
animation and charge pulses consult. i18n.ja added for all new strings.

### 3. Measurement harness (extends G4 to overlays)
`client/scripts/overlay_a11y_harness.mjs`, wired as ci step **[5.9d]**. Builds on
REQ-0126's deterministic compositor over the same shape suite at board scale
(64 px/cell). Two jobs: (a) CVD hue-independence — deuteranopia/protanopia/
tritanopia standard sRGB matrices on each overlay-on-skin composite, CIELAB ΔE
within each group; a group passes iff every pair is separable by simulated colour
OR a distinct non-hue cue, and it reports which pairs RELY on the cue
(load-bearing) as the honest hue-independence evidence. (b) relative-luminance /
WCAG contrast at 64 px/cell → the BS-G2 numbers. Deterministic: numbers computed
twice and a golden hash pins the whole result (`numbersHash 69b99885…`, identical
across three runs). Gallery + verdict → `web/preview/overlay-a11y-req0143/`.

### ⚠ OPEN — USER RATIFICATION (BS-G2 final numbers)
The harness EMITS the recommendation below; the **final BS-G2 numbers are a user
ratification of this output** (the decision method the user ratified 2026-07-12).
**Because this item is open, REQ-0143 stays in `built/` after merge.**

- **Border band width: 12 px @ 256/cell** (= 3 px at board scale 64/cell). The
  measured minimum for a clean welt ring on the whole suite at ≥3:1 welt/fill is
  6 px @256 (1.5 board px); the recommendation adds 1 board-px anti-alias headroom
  (G4 64 px rule). Welt/fill contrast at the recommendation: 3.71:1.
- **Fill contrast budget: ≥ 3.0:1** (WCAG 1.4.11 non-text / graphical-object
  minimum) of the fill vs item art. Implied fill relative-luminance band:
  **[0.1122, 0.2836]** (keeps both a dark `#0e0d0b` and a light `#f2fbff` item
  tone at ≥3:1). Finding: both current programmer-art dev skins sit BELOW the band
  (neutral fill L=0.032; devornate L=0.068 — too dark, fill-vs-item-dark 1.51 /
  2.18); real UGC/AI skins should target the band. Dev skins are placeholder
  cosmetics, so this is EMITTED as advice, not enforced as a gate.

### Decisions [ORCH default, vetoable]
1. Palette basis = Okabe-Ito / Wong (2011) — the de-facto standard CVD-safe set.
2. `usage.otherSquad` recoloured yellow → blue so the DRAWN overlays are
   CVD-colour-separable rather than depending on an unrendered hatch. Declared
   shape cues remain for the not-yet-drawn overlays (element, damage) where they
   are load-bearing.
3. Reduced-motion OWNS the REQ-0113 `data-motion` gate (one source of truth)
   rather than adding a parallel flag.
4. BS-G2 fill-budget standard = WCAG 1.4.11 (3:1), the right standard for a
   graphical object over a background.
5. Renderer wiring limited to the two overlays drawn today; team/enemy/element/
   damage defined centrally, drawn when combat lands (BS-G1).
6. `web/preview` output + the built dist (`web/app`) are NOT committed
   (regenerated), matching REQ-0126's convention.

### Gate results (exact)
- `overlay_a11y_harness`: **ALL GREEN**, deterministic (numbersHash `69b99885…`,
  golden match ×3).
- client typecheck + build (`tsc -b && vite build`): **green**.
- `check_bpskin` (REQ-0126 sibling, unaffected): **green**.
- **`tools/ci.sh` (flock, SKIP_PG=1): CI GREEN, CI_RC=0** — 178/178 e2e passed,
  0 failed. SKIP_PG only skips the Postgres api pass + admin-e2e trio, which are
  unrelated (this REQ touches no server/pg code) and needed DB creds not present
  in the implementation session; every DB-free gate + the full default e2e suite
  ran green.
- e2e `reduced-motion.spec.ts`: **pass** (toggle exists, persists to localStorage,
  flips `data-motion` / `data-reduced-motion` app-wide).

### Files
- new: `client/src/board/overlayPalette.ts`, `client/src/a11y/motionPrefs.ts`,
  `client/scripts/overlay_a11y_harness.mjs`,
  `client/scripts/overlay_a11y_harness.golden.json`,
  `client/e2e/reduced-motion.spec.ts`.
- edited: `client/src/main.tsx`, `client/src/Settings.tsx`,
  `client/src/i18n/settings.ts`, `client/src/board/BoardRenderer.ts`, `tools/ci.sh`.

### Commits
- code: `b9bbb42`
- todo→built move: this commit.

---

## Merge & deploy record (wave-8 integration, final -- 2026-07-14)

- **Merge:** `git merge --no-ff` of `req-0143-overlay-accessibility` (tip
  `a75912f`) into master -> merge commit **`7bf4196`**. Clean merge (ort
  strategy), **zero conflicts** (merge-base was master HEAD `38c646d`; branch 3
  commits ahead, master 0 ahead). Board move already carried on the branch:
  `docs/REQ/todo/REQ-0143-*` deleted, `docs/REQ/built/REQ-0143-*` added.
- **Release gate** (`flock /tmp/backpack_ci.lock bash tools/release.sh`, FULL --
  `DATABASE_URL` sourced from `server/.env`, **no SKIP_PG**): CI **GREEN,
  CI_RC=0**. This run closes the builder`'s SKIP_PG gap: the Postgres api pass
  ([5]-[5.46], incl. REQ-0144 moderation) AND the admin harness trio ([6.5]
  artadmin 4/4 + art_inspect + contentadmin) both ran and passed. Server code is
  untouched, as expected -> all green. overlay a11y harness **[5.9d]** green
  (numbersHash `69b99885...`, golden match). client typecheck + build green.
  Default e2e suite [7]: **178 passed / 0 failed**, incl. `reduced-motion.spec.ts`.
  Dist rebuilt + committed -> **`3b142d2`**.
  - Note: the first release attempt aborted on a single `artadmin.spec.ts:113`
    `page.goto` 20s-timeout flake -- a documented admin-trio timing flake (see
    REQ-0141 wave-7 record, identical failure). Isolated serial rerun of the
    artadmin harness: **4/4 green (58.0s)**, confirming a flake; the re-run
    release was fully green (artadmin 4/4 again). This REQ touches no admin/server
    code.
- **Deploy:** `systemctl --user restart backpack-api backpack-web` -> both
  **active**. HTTP: `8801 /app/` = **200**, `8802 /api/health` = **200**.
- **Post-deploy full e2e** (sanctioned wrapper `pnpm run e2e`, whole-box locked,
  `E2E_GPU=1 E2E_PARALLEL=4`, base `http://127.0.0.1:8803`): **178 passed / 0
  failed** (3.3m), incl. `reduced-motion.spec.ts:15` (REQ-0143) green. No flakes
  this run; global-teardown restored live profile/content state.
- **Final master HEAD:** `3b142d2` (dist rebuild) <- `7bf4196` (merge) <-
  `a75912f`.
- **STAYS in `built/`:** the BS-G2 numbers (border band **12 px @256/cell**;
  fill contrast budget **>=3:1**, implied fill-L band **[0.1122, 0.2836]**)
  remain an EXPLICIT OPEN **user ratification** of the harness output -- not a
  machine gate. Worktree `~/backpack_ragnarok_worktrees/req-0143-overlay-accessibility`
  kept.

### WARNING -- USER ATTENTION (open)
- **Ratify the BS-G2 numbers**: border band **12 px @256/cell** (= 3 board px @
  64/cell); fill contrast budget **>=3.0:1** (WCAG 1.4.11). Both current
  programmer-art dev skins sit BELOW the fill-L band (emitted as advice, not
  enforced). On ratification, `git mv` REQ-0143 `built/ -> done/`.
