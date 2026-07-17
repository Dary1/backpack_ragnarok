# REQ-0196 — instance-roll-pct-container: the per-instance roll-fulfillment CONTAINER (definition only)

**Reserved:** 2026-07-16
**Slug:** instance-roll-pct-container
**Requested by:** user, 2026-07-16 (chat), while directing REQ-0195 (market):
"データ上存在せず、パフォーマンスに問題がありそうであれば、instance化時に計算されるように、
REQを上げてください。あなたは逆算して、marketが必要とするデータの定義を行い、定義を編集する
権限を与えます。(入れ物だけを作る権限)"
**Status:** draft — the CONTAINER definition below is ratified by that delegation; the
VALUES that fill it are blocked on REQ-0190 §6 (distribution / granularity / back-compat
/ scope rulings). Nothing here may invent a number.

## 1. What the market needs (worked backwards, per the delegation)

The market (REQ-0195) renders, per listed drop instance, the fraction of the def's
min→max performance band the instance fulfills: **min = 0%, max = 100%**. Computing that
fraction at market-read time would re-derive rolled stats on every browse; the user ruled
it must instead be **computed ONCE at instance-creation time (instance化時) and stored on
the instance**.

## 2. The container, defined

One semantic across every kind: `pct ∈ [0,1]`, the instance's aggregate position inside
its def-declared rolled band(s); 0 = every rolled stat at its minimum, 1 = every rolled
stat at its maximum. Minted once, travels with the instance forever (trades never
re-roll it — REQ-0063 already fixed that law for q; REQ-0195 extends it to BP payloads).

| kind | container | status |
|---|---|---|
| po | the existing per-instance `q` (REQ-0063) IS the container: sim applies q to every ranged effect, so pct ≡ q | ALREADY LIVE — no change |
| si | same as po (`q` minted by the same rollQuality path) | ALREADY LIVE — no change |
| unit (BP) | NEW optional field on the BP instance: `roll: { pct: number }` — minted inside rollPackBp() at gacha time, persisted with the BP (storage chokepoint), carried verbatim through warehouse delivery / market settlement / squad moves | CONTAINER DEFINED HERE; value model BLOCKED on REQ-0190 |
| tm | stackable currency, no rolled performance | N/A by definition |

Absence contract: an instance WITHOUT the container (every BP rolled before REQ-0190
lands, plus whatever REQ-0190 §6.3 rules for back-compat) reads as "unmeasured" —
consumers MUST render an explicit unmeasured state, never 0% (user ruling 2026-07-16,
REQ-0195 §3.2).

## 3. What this REQ does NOT do (the "入れ物だけ" line)

- Does NOT choose the distribution, granularity, or per-stat aggregation weights for
  unit rolls — REQ-0190 §6 owns every one of those rulings.
- Does NOT backfill or re-roll existing instances (REQ-0190 §6.3).
- Does NOT add UI beyond what REQ-0195 already ships against the container.

## 4. Implementation, when unblocked

rollPackBp() computes each REQ-0190-declared range roll from its dedicated sub-stream
(sealed-seed law), then sets `roll.pct` as the aggregate before returning the instance;
shared/dto.ts documents the field; sim/dex read the instance value per REQ-0190 §5.

## 5. Consumers on record

- REQ-0195 market: listing DTO `rollPct` = po/si q | bp.roll?.pct | null.
- Future: dex detail (def range vs held value), workshop result modal (REQ-0190 §6.4).

## 6. Status log

- 2026-07-16 reserved (f62f269); container definition written under the user's
  delegation; parked in draft/, blocked on REQ-0190 §6.
