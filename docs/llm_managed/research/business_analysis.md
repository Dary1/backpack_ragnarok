> [REQ-0123 terminology update, 2026-07-12] Squad = ex-Unit (canvas owner) / ex-Preset; Troop = ex-Party; Unit = ex-Linker (character piece). Verbatim pre-rename user quotes may survive unchanged.

# Business Analysis — "Influencers Buy the Season-End Boss" Monetization Model

> Status: **analysis memo** (LLM-authored critique, requested by the user 2026-07-07).
> NOT a golden / NOT a ratified ruling. The monetization itself remains TENTATIVE and
> out of scope per `docs/worldview_ragnarok_tentative.md` ("assume no monetization").
> Written in English per the project language policy; original delivered in Japanese in chat.

## 0. Premise check (against repository documents)

The only primary source is `docs/worldview_ragnarok_tentative.md`, which defines the model
as **"Pay to Kill (glorify of death) players"**: buyers purchase enemy monsters that appear
at the season-end Ragnarok and receive a detailed report of what their monster did (who it
killed); the primary buyer motivation is influencers bragging on social media. Its status is
TENTATIVE / out of scope. PROJECT.md states "Monetization: none assumed" and that
`economy.md` is deliberately empty. Therefore "full business commitment" is not a documented
fact; this report is a stress test **assuming** full commitment.

## 1. Prime factorization

**What is actually being sold is not an in-game item.** Decomposed, the product is:
(a) a **role in the world's story** (the season-end demon king), (b) **narrative rights**
(the kill report = first-party material for social media posts), and (c) a **fan-mobilization
device** (fans flow into the game to fight — or be killed by — their oshi's boss). This is
not consumer monetization; it is effectively a **B2B advertising / content-production
transaction**. With creator ad spending around $44B in 2026 and performance-based deals now
the norm, a product that can be justified in ROI terms (video material + fan mobilization +
a unique war story) fits the current market.

**Payer and player are separated.** Players never pay → zero pay-to-win suspicion → trust
becomes an asset. "Only the demon king pays" is itself a marketing copy. For market contrast:
Crowd Control has proven "many viewers pay small amounts to attack one streamer" (70k+
creators). This model is the **exact inversion** — one large payer attacks many players — so
the novelty is real. But the inversion also runs against the market's dominant flow
(companies **pay** creators), so persuading creators to pay is the single largest friction.

**The fit with the game's existing design is unusually good — and that is a merit, not a
coincidence.**

1. The REQ-0005 asymmetric-combat decision (enemies are HP + skills only, no backpacks)
   makes bosses "flat, easily tunable data" — the **ideal format for productization**.
2. The deterministic seeded server sim + lazy settlement + replay + run LOG (human-readable
   text / raw JSONL, shipped in REQ-0045) means the **kill report is an almost-implemented
   byproduct**, and fairness is auditable.
3. Devotion is a voluntary full-loss ritual: the only ones who can be killed are those who
   climbed onto the altar themselves — a **structural defense** built into the worldview
   against the standard outrage template ("the rich pay to kill other people's characters").
4. In Norse myth, Ragnarok is a battle the gods **lose**. Expectation management for a
   "losing event" is done on the mythology side, pre-breaking the skeleton of the complaint
   "the boss is unfairly strong". The killed side gets a permanent ranking entry and their
   name in a famous person's report — **the victim also receives a reward**. A monetization
   design where every troop's incentives line up is rare.

**Hidden society-side lever: oshi-katsu (fandom) culture.** Buyers need not be limited to
individual influencers. If a fandom can **crowdfund the summoning of their oshi as the demon
king** (aggregated superchat-like payments), the payer base expands from "hundreds of
creators" to "millions of fans", and the monetization event itself becomes a user-acquisition
device (new signups to fight the oshi). This monetization=UA self-reinforcing loop is the
model's largest upside factor.

## 2. Critique: is full commitment sound?

Strengths: differentiation, purity of worldview integration, technical readiness, ethical
defenses. The weakness is structural: all revenue rides on **revenue = #buyers × unit price
× seasons/year** — low frequency, few buyers, high variance. Realistic early pricing sits in
a creator's "video production budget" range (¥50k–500k per boss); at 4 seasons × 5–20 bosses
that is a few million yen per year — survivable for a solo dev on self-hosted infra, but a
low ceiling as a business. The **chicken-and-egg problem** is heavy: influencers pay only
when the game is already culturally visible, so season 1 inevitably means comped invitations
(zero revenue). House-made bosses must exist as a fallback for buyer-less seasons. Add
novelty decay (will they still buy in season 3?), dependence on specific influencers, and the
fact that the game is currently invite-only at friend scale — this model merely **prices the
attention the game itself must first earn**; it does not generate attention. One design rule
must hold: never let payment amount buy boss strength. Sell presence, identity, spectacle,
and the report; cap power by design (the ranking measures activity, not victory, so this is
consistent).

Conclusion: full commitment is **correct as a design axiom and brand, fragile as a
standalone financial plan**. The watershed is whether the fan-crowdfunding extension (same
essence — selling a role — wider payer base) is designed in from the start.

## 3. Success probability

Definition of success: within 2 years of public launch, non-acquaintance external buyers
purchase paid bosses for 3+ consecutive seasons, and monetization revenue exceeds operating
costs (= established as a repeatable new monetization model).

| Factor | Description | P |
|---|---|---|
| P1 | Game launches publicly and builds a community of thousands of MAU | 0.35 |
| P2 | Seasons + Ragnarok land as a "losing event people want to watch" | 0.70 |
| P3 | First external paid buyer appears (comped → paid conversion) | 0.60 |
| P4 | 3+ consecutive seasons of purchases (novelty decay survived) | 0.50 |
| P5 | Revenue exceeds operating costs (low cost base helps) | 0.70 |
| P6 | No derailment by outrage/regulation (no paid RNG; full-loss is voluntary) | 0.90 |

**Overall: 0.35 × 0.70 × 0.60 × 0.50 × 0.70 × 0.90 ≈ 4.6% ≒ ~5%**

Conditional on the game itself succeeding (P1 given): **~13%**. With the fan-crowdfunding
extension (P3→0.75, P4→0.60, P5→0.80): conditional **~22%**, overall **~8%**.

How to read this: the dominant term is not a flaw in the monetization model but **P1 — does
the game hit at all**. A conditional 13–22% is actually high as a base rate for a genuinely
new monetization primitive. And because the current policy assumes zero monetization until
Ragnarok implementation, the carrying cost of this bet is near zero. As **"a cheap-to-hold,
theme-coherent, high-upside long shot"**, declaring full commitment is rational — provided
season-1 comped summonings and the fan-crowdfunding second stage are in the blueprint from
day one.

## Sources

- Repo: `docs/worldview_ragnarok_tentative.md`, `docs/REQ/REQ-0005-asymmetric-combat-decision.md`, `PROJECT.md`
- [Creator ad spending reaches $44 billion in 2026 (eciks)](https://eciks.org/10180-71452-influencer-marketing-44-billion-creator-partnerships)
- [Influencer Marketing Benchmark Report 2026 (Influencer Marketing Hub)](https://influencermarketinghub.com/influencer-marketing-benchmark-report/)
- [Crowd Control — TechCrunch](https://techcrunch.com/2023/05/01/crowd-control-interactive-stream/)
