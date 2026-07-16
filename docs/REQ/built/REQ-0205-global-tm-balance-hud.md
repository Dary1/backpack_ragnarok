# REQ-0205 — Global TM-balance HUD (held currencies visible on every page)

## State log
- 2026-07-16 reserved (stub).
- 2026-07-17 spec written; reserved -> todo (user-directed, cleared to implement
  immediately -- built on the same branch as REQ-0204, the 0195/0196 precedent).

## Problem / directive
User directive (2026-07-16): 所持TMをグローバルに表示 — the player's held TM
(Transmutator currency) balances must be visible APP-WIDE, not only inside the
market/workshop pages (SellPane already sums them for its own picker, but that
sum is invisible from every other route). REQ-0204 just made the registry
multi-currency, so a persistent held-balance readout is now genuinely useful.

## Change (client presentation only; additive)
- NEW client/src/TmHud.tsx: a compact currency strip. Self-subscribes to the
  store via useGameStore() (the same chrome-subscription pattern CanvasStatsChip
  uses -- a fresh snapshot object per stateVersion bump re-renders it, so the
  strip tracks balance mutations without prop plumbing). It:
  - sums held qty per TM id across every inventory page
    (state.inv.pages[].tms[]) -- the SAME reduction market/SellPane.tsx uses;
  - renders in LIVE TM REGISTRY ORDER (Object.keys(gameData.TMS), which is built
    id-keyed in content/live/live_tms.json entry order), ONE chip per HELD TM
    (total qty > 0): the sprite icon (dexIcons iconDataUrl(def.icon)) + the def's
    short label + '×N', with a locale-aware `title` tooltip of the full name
    (i18n.ja.name in ja, name in en);
  - EMPTY STATE: hold nothing -> return null (no empty chrome).
- client/src/Header.tsx: mount <TmHud/> in the app-wide HUD bar (between the
  title and the existing .header-controls). Header is the natural home -- App.tsx
  renders it on EVERY non-landing route (canvas/#market/#schedule/#warehouse/
  #workshop/#dex/... all go through it), so one mount = app-wide.
- client/src/styles/base.css: append a REQ-0205 section (.tm-hud / .tm-hud-chip /
  .tm-hud-ico / .tm-hud-short / .tm-hud-qty) in the existing header-chrome idiom
  (base.css owns .app-header / .header-controls / .data-source-badge). Later-wins
  cascade, same convention as the rest of the file.
- client/src/i18n/common.ts: + 'hud.tmAria' (en+ja) for the strip's aria-label
  (the shell-chrome i18n domain; the per-TM tooltip text itself is CONTENT i18n
  read from the served TM def, not a chrome key). en/ja parity kept.
- e2e: one content-agnostic test in client/e2e/market.spec.ts (cheapest correct
  home -- it already seeds an lrdst balance via devBuyerCanvas + loads a page):
  seed lrdst, load the app, assert [data-testid=tm-hud-chip][data-tm-id=lrdst]
  shows the qty; and that it persists after switching to another route (proving
  it is global chrome, not a market-local widget).

## Non-goals
- No new balance source of truth -- reads the same state.inv the market reads.
- No landing-route HUD (landing is a full-bleed title screen with no header).
- No effect/spend UI -- display only.

## Gates
- pnpm -C client run build (tsc -b + vite) GREEN.
- market.spec.ts (holds the HUD test) green at the combined final gate.

## Host component
The HUD is hosted in **client/src/Header.tsx** (the app-wide slim HUD bar), mounted
between the `<h1>` title and `.header-controls`. App.tsx renders Header on every
non-landing route, so one mount covers canvas/#market/#schedule/#warehouse/#workshop/
#dex/... . It self-subscribes via useGameStore() (CanvasStatsChip chrome pattern).

## Gate results (2026-07-17)
- Implementation commit: c40551d (TmHud.tsx, Header.tsx, i18n/common.ts,
  styles/base.css, e2e/market.spec.ts HUD test).
- client build (tsc -b + vite): GREEN (typechecks TmHud + Header + the new
  hud.tmAria key).
- i18n EN/JA parity: common.ts 16/16 keys, no mismatch (hud.tmAria on both sides).
- market e2e (holds the HUD test + the REQ-0204 5-TM updates): 18 passed
  (43.3s), 0 failed. Test 18 (HUD REQ-0205) asserts the lrdst chip shows x20 on
  #/market AND persists after routing to #/schedule (proving app-wide chrome).
  Test 11 (WIRE tms[]) + test 15 (currency-sell multi-TM) pass under the fleet's
  overlaid 5-TM content, confirming the REQ-0204 fleet overlay works.
- global-teardown restored the dev profile + content/live (sha256 match=true) --
  no live-state pollution from the run.
