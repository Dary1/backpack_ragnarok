# REQ-0017: Seconds/Ranges, Conn-Target Semantics, Icon Provenance & Fable Art, Coverage Metric

- **Status**: Completed; batch-001 v3 staged for S7
- **Date**: 2026-07-02

## User verdicts applied
1. **Ticks abolished → seconds with decimals.** Trigger `every_secs {s:[lo,hi]}` — the
   interval itself is a per-drop roll range (e.g. 「1.4〜1.7秒ごとに: 13〜23 ダメージ」).
   1 tick mapped to 0.5s; dps (per-second) warning ceilings replace dpt.
2. **conn semantics corrected**: conn = EXTERNAL target tiles (outside the shape,
   orthogonally adjacent, negative offsets allowed) that the item's tag-connection
   reaches — receivers declare nothing. Engine v0.7 (directional hit test), validator
   (conn∉shape+adjacent), mock viz: hollow gold ◇ on target tiles, filled orange ◆
   when a connection lands. E.g. hoarfrost_creep's empty L-notch is its mouth.
3. **Icon provenance investigated — user's suspicion CONFIRMED**: the well-received
   early icons (v1–v4 sprites) were drawn BEFORE the model policy, i.e. by **Fable**
   (default inheritance); the two rejected batches were Sonnet (icons5) then Opus
   (icons5b). Fix: **icon art is now drawn directly by the orchestrator (Fable),
   inline, no subagent** — small batches make this affordable; art_golden §5 updated.
   All 6 Frost icons redrawn by orchestrator with render-and-look loop; own gate
   iterated glacier_cleaver twice.
4. **Frost Nail as standalone Weapon — reason**: Opus drafted it as a Part, but the
   assembly system currently only defines the blade+hilt pair; a counterpart-less
   part would be permanently inert, so it was flattened at S2-fix. Queued: Parts
   family generalization (e.g. Icebrand assembly) — then it can become a part again.
5. **Per-cell draw coverage is now measured** (cairosvg rasterization in
   tool_art_check): <20% ERROR, <30% needs justification, ~40% target. It immediately
   caught real failures (old crown outer cells 3.1%, nail tip 13.4%). Current batch:
   all cells ≥30% except hoarfrost BR 36.3%→PASS band; worst legacy cells (blade 28%,
   hilt 29%, dagger 25/28%) recorded as legacy-justified pending future redraw.

## State
S2/S3 green (6+1 expected-reject), 12/12 engine tests vs generated data, mock v0.7 &
preview v3 live. Fable token usage note: icon drawing moved to orchestrator = the one
sanctioned Fable-heavy activity (user-approved trade for quality).
