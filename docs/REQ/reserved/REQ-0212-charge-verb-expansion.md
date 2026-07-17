# REQ-0212 — charge-verb expansion: charge_strike / transfer_status / shield_break (+3 art-first units)

**Ratified:** 2026-07-17 (user, chat): 「必要な動詞はじゃんじゃんあなたの意思で
追加して、REQを立てて、サブエージェント(Opus4.8に実装させてしまって構いません)」
— under the standing verbs/targets/triggers delegation recorded in
content/vocab.json (user 2026-07-14 「後は、私に聞かないで、必要になったら
あなたが定義してください」). All three verbs are AGENT-DEFINED and must be
labelled so in vocab provenance.

## What — three new charge-effect verbs (vocab v16)

1. `charge_strike` `{n:[lo,hi]}` — on spend, deal `n × stacks_spent` damage
   (one hit) from the host BP. Only meaningful under `fire_on_full` (stacks
   at spend == rolled capacity); under other spends validation must REJECT it.
   Design carrier: **powder_keg** (OnBPBeenHit / gain count / cap [10,15] /
   fire_on_full / charge_strike {n:[4,6]} -> self).
2. `transfer_status` `{n:[lo,hi]}` — move up to n NEGATIVE statuses
   (Burn/Poison/Chill/Stun/Weakness — the non-beneficial status_kinds) from
   the host BP hierarchy onto the enemy squad; each moved status keeps its
   remaining stacks/duration. Design carrier: **cursed_doll**
   (on_status_applied / gain count / cap [2,3] / fire_on_full /
   transfer_status {n:[1,2]} -> self).
3. `shield_break` `{n:[lo,hi]}` — remove up to n points of the enemy's
   active block/shield pool (no damage; floor at 0). Design carrier:
   **battle_pickaxe** (on_connected_unit_attack / gain count / cap [3,4] /
   fire_on_full / shield_break {n:[10,15]} -> self).

## Where (the REQ-0200 pattern, verb-for-verb)

- content/vocab.json: verbs list + charge.effect_verbs entries (AGENT-DEFINED
  labels, version bump, deprecated untouched).
- shared/content_validate.cjs: param schemas (n range), the
  charge_strike×fire_on_full-only rule in validateCharge().
- sim/lib/unit_charge.cjs: runtime for all three (grounded in the real
  combat model: damage entry point, status store, enemy block pool).
- tools/eff_render.cjs: renderCharge() lines for all three (ja+en).
- tools/self_test_vocab.cjs: one fixture per verb (the REQ-0081 coverage
  gate must hold them honest).
- sim tests: unit-context fixtures proving each verb's end-to-end effect in
  combat.runDungeon (damage lands, statuses actually move, block actually
  drops), plus validation rejections (charge_strike under passive_per_stack).

## Then — the three carrier units (content, same REQ)

- Ingest+review+adopt the 3 unit defs into the Content Data Registry
  (source llm, machine_check must PASS against the NEW vocab).
- Append the 3 entries to content/live/live_units.json byte-identical to the
  adopted registry data, and extend the `arsenal` pack pool (REQ-0213) with:
  powder_keg weight 2, cursed_doll weight 2, battle_pickaxe weight 3.
  If REQ-0213 is not yet merged when this lands, rebase on it — the pack
  must exist first; coordinate via master.

## Gates

Full ci.sh green in this worktree (sim, goldens, self_test_vocab, check_units,
server files+pg, client, admin trio, default e2e). Icons: the artworks
items005_powder_keg / items005_cursed_doll / items005_battle_pickaxe are
already adopted; no art work in this REQ.

## Out of scope

- Any enemy-side (monster skill) use of these verbs; enemy dialect is
  REQ-0161 territory.
- Forecast changes: these are player-side unit verbs; the enemy-facing
  pressure model does not read them.
