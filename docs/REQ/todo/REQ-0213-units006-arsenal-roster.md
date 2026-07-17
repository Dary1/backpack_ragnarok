# REQ-0213 — units006 arsenal roster: 9 art-first units onto the file tier + Arsenal pack

**Ratified:** 2026-07-17 (user, chat): item-art adoption sweep + 「採用artを
選択して、新しくユニットとして効果を設計し、Content Data Registry に追加して
いってください」. The 9 unit defs are ALREADY designed, ingested, reviewed and
ADOPTED in the Content Data Registry (source llm claude-fable-5, machine_check
PASS, advisory review recorded, variant 1 each): war_horn, golden_apple,
hourglass, living_anvil, battle_standard, ancient_grimoire, mana_crystal,
giant_shuriken, enchanted_lantern. Icons are the items005 artworks adopted the
same day (art-first design).

## Why a code REQ at all

Registry adoption alone does NOT serve a NEW id: lib/content.cjs
computeRegistryData() resolves adopted data only for names already present in
the FILE payload (`Object.keys(payload.units)`) — the overlay is
registry-beats-file, not registry-union-file. A brand-new unit id therefore
needs its entry in content/live/live_units.json (and a pack that can emit it)
before the registry copy can take over.

## What

- Append the 9 adopted unit entries to content/live/live_units.json, each
  byte-identical to its adopted registry variant data (parity posture:
  the registry copy must classify `equal`, never `drifted`).
- New gacha pack `arsenal` in content/live/live_packs.json:
  Arsenal Pack / 兵装のパック, cost 16, cells [6,8], cost_tm lrdst,
  hp_per_cell 15, pool: enchanted_lantern 6, golden_apple 5, mana_crystal 5,
  war_horn 3, hourglass 3, living_anvil 3, battle_standard 2,
  ancient_grimoire 2, giant_shuriken 2.
- Gates: tools/check_units.cjs, self_test_vocab, full ci.sh.

## Out of scope

- The 3 verb-blocked units (powder_keg, cursed_doll, battle_pickaxe) — they
  ship WITH their verbs in REQ-0212-charge-verb-expansion.
- Any vocab change (this REQ uses attested verbs/targets/triggers only).

## Gate results (2026-07-17)

- check_units: ALL GREEN (51 defs) - self_test_vocab: ALL GREEN - full ci.sh:
  every suite green through the admin trio (artadmin 6/6, artinspect 1/1,
  contentadmin 28/28); default client e2e **186 passed / 1 failed**
  (long-press-rename). The failure is NOT this REQ's: it re-passes **3/3 in
  isolation** post-reboot, and the ci run coincided with the box-wide memory
  thrash that froze llmlocal minutes later (see the incident record below).
- Incident (2026-07-17 ~05:45 UTC): llmlocal froze mid-multi-session load;
  NO oom-kill in kernel/oomd logs -- swap-thrash starvation. Root cause is
  structural: warm ComfyUI holds ~11 GB host RSS that /free cannot return
  (REQ-0158's own scope note), and the art queue alternates generation and
  birefnet mattes (12 GB), so the steady state was ~23 GB = the whole box;
  any other session's normal work tipped it. Mitigations applied same day:
  comfyui.service MemoryMax=14G + MemorySwapMax=1G, watchdog
  RSS_RESTART_MB=6000. Family-grouped queue scheduling is the follow-up REQ.
