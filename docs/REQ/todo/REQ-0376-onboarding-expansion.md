# REQ-0376 — Onboarding beyond the canvas: hall cards + in-game glossary + dry rules

## Status
todo — spec by Cowork session 2026-08-10 (gamer-lens UI gap analysis batch);
ratified by user 2026-08-10, chat: 「では、それらを全て、TODOのREQとして書き出してください」.

## Origin
UI gap analysis 2026-08-10 (Cowork). Finding P1-7, absorbing the report's
clarity notes 1 (sortie/schedule roles), 2 (rules buried in flavor copy) and
4 (ᚠ literacy).

## Problem (gamer-facing)
First-run guidance exists ONLY on the canvas: the 5-step tour + 3 contextual
hints (`client/src/guide/guideModel.ts`), and the Settings replay re-runs just
that. Every concept a new player actually gets wrong lives elsewhere and is
explained nowhere: expeditions auto-repeat in real time; the destination is
drawn at random from the attack level; warehouse spoils rot in 7 days; every
trade burns 8%; a claimed/placed item is final; ᚠ is the currency. Those
rules exist only inside flavor prose ("ash has no owner", "the stone shelf
will not wait") — atmospheric, but there is no dry statement of law anywhere,
and no glossary despite the proper-noun load (Canvas/BP/PO/SI/Unit/Squad/
Troop/TM/LRDST). The schedule page also never says "this is the watching
hall; departures happen in Sortie" — the CTA exists
(`SchedulePage.tsx:262/288`) but the role split is unstated.

## Spec
1. Hall cards: on FIRST visit to schedule / sortie / warehouse / market /
   workshop, one dismissible card (non-modal, the ContextualHint visual
   family) stating that hall's 3-4 laws in plain language, both locales.
   Persistence: extend `GuidePersisted` with per-hall seen flags — the same
   client-only `state.guide` field riding the auto-save PUT (REQ-0141
   precedent), preserving its guarantee: a returning profile's saved canvas
   is never rewritten just by shipping this (flags write on first dismiss).
2. Glossary: a "Terms" tab in the Dex (the reference surface; coexists with
   the draft REQ-0227/0228 dex plans) — a static chrome-i18n'd list: each
   closed-vocabulary noun in one sentence, plus the dry rules block
   (auto-repeat, random draw, 7-day decay, 8% burn, receipt finality, ᚠ).
   Content i18n NOT involved — this is chrome text at the barrel.
3. Settings "Replay the guide" becomes "Replay all guidance": clears the tour
   AND the hall-card flags.
4. Schedule empty/awaiting states gain the one role-clarifying line
   ("Expeditions are watched here — departures are ordered in Sortie.").

## Gates
- Fresh-profile e2e: first schedule visit shows the card; dismiss; reload —
  never again. Each hall independently.
- Returning-profile guarantee: a profile without `state.guide` gains no field
  until a card is dismissed (byte-unchanged save otherwise) — the REQ-0141
  gate re-asserted.
- Glossary tab renders complete in en and ja; dex existing tabs/selectors
  unchanged.
- CI green.

## Out of scope
Interactive per-hall tutorials, video, reworking the canvas tour, content-
pipeline i18n.
