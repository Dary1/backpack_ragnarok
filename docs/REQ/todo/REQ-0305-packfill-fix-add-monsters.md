# REQ-0305 - Fix <30% monster_packs (add monsters to >=30%) + flip formation-fill gate to hard

**Status:** todo (RATIFIED 2026-07-24; params user-confirmed). Follow-up to REQ-0298 (fill inspection) +
REQ-0300 (30% admincontent warning). GOLDEN-SAFE now that REQ-0301 decoupled the determinism goldens.

## The decision
Monster_packs whose formation fills < 30% of the placeable area (384 cells) are INVALID (gimic exempt).
REQ-0298/0300 detect + warn. This REQ FIXES the failing packs and makes the rule a HARD gate going forward.
User-confirmed params (2026-07-24): boss packs get "boss + entourage" (bosses are NOT exempt -- add minions);
"add monsters until >= 30% is reached"; 30% of the 384-cell placeable area is the threshold.

## The 10 failing packs (REQ-0298 inspection snapshot; may shift on current master after REQ-0299)
frost_scouts 0.5%, rime_choir 0.8%, bear_and_stalker 1.3%, hrimgrimnir(boss) 2.3%, grave_shamble 12.5%,
grave_legion 15.6%, wild_hunt 15.6%, venom_nest 16.7%, petrifying_court 16.7%, greenskin_warband 16.7%.
(demon_gate 31.2%, bone_court/titan_ridge 37.5%, deep_tide 41.7% already PASS.)

## Deliverables
1. Add themed monsters (same-roster enemies) to each failing pack until fillFrac >= 30% (>= 115 cells), placing
   members at non-overlapping `at` cells within the placeable area B2:Y17. hrimgrimnir + other boss packs: add
   an entourage of themed minions around the boss to reach 30%.
2. Re-run tools/inspect_pack_formation.cjs --report -> all packs PASS.
3. Re-run the REQ-0297 powerLevel auto-adjuster (tools/autobalance_pack_powerlevel.cjs --emit): the packs are
   now denser -> their combat power changed -> powerLevel must be regenerated (the dirty-trigger self-heal).
4. Flip tools/inspect_pack_formation.cjs --gate to HARD in tools/ci.sh (remove the advisory-only; exit 1 on any
   monster_pack < 30%) so sparse packs are forbidden going forward.
5. Deploy the content (packs.json batch+live+registry surgical sync + regenerated powerLevel), api mtime-reload.

## Ordering / dependency (IMPORTANT)
Edits packs.json + enemies.json, which the IN-FLIGHT parallel REQ-0299 (monster-pack flavor skills) also edits.
Do this AFTER req-0299 lands, on CURRENT master, to avoid content conflicts. REQ-0301 makes it golden-safe
(no replay rebaseline needed).

## Acceptance
- inspect_pack_formation --report: all 14 packs >= 30%; --gate (hard) exit 0; ci.sh hard gate green.
- powerLevel regenerated (auto-adjuster) + fill inspection green; goldens byte-identical; api/sim green; deployed.

## Gate results
_(on build)_
