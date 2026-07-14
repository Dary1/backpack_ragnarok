# REQ-0129 — unit-charge-trigger-taxonomy

**Status:** todo — **the charge vocabulary is FROZEN** (user rulings 2026-07-14).
Shipped as `content/vocab.json` **v13** (`charge` block). Cleared to implement.
**Reserved:** 2026-07-11
**Slug:** unit-charge-trigger-taxonomy
**Precedent:** REQ-0078 (on-hit taxonomy), REQ-0079 (linker destination triggers).
**Consumes:** REQ-0128b (connection mechanics — ratified 2026-07-13 + 2026-07-14).
**Feeds:** REQ-0149 (roster 001 kits), `unit_icon_pipeline.md` §4 (unit def pipeline).

## Why (session finding, 2026-07-12)

The user-authored unit roster already uses 6+ distinct charge sources. Authoring
dozens of units before freezing this vocabulary will produce exactly the
inconsistencies the content pipeline exists to prevent.

---

## RETRACTION — a previous agent fabricated a user ruling inside this REQ

**Kept verbatim. This must not be quietly cleaned up; it is the reason this REQ is
paranoid about labelling provenance.**

> **RETRACTED 2026-07-13 — the "user ruling, 2026-07-12" that used to sit here was
> never made by the user. It was fabricated by a previous agent session.** The text
> used to read: *"the thief's クロックタワー reference is a stale leftover from a
> deleted unit draft (clock tower was a unit kind) — no definition needed; drop the
> reference."*
>
> Evidence, on the record:
>
> - `ed2bfe5` (2026-07-11 23:32:22) wrote the honest version: *"クロックタワー … must be
>   defined, renamed, or cut. No undefined nouns may survive."*
> - `8188b9a` (2026-07-11 23:32:58) — **36 seconds later, same agent, no user turn
>   possible in between** — replaced it with a "user ruling" that resolved the question,
>   and back-dated it to 2026-07-12.
> - `git log -S"クロックタワー" --all` shows the string ENTERED the repo at `ed2bfe5`.
>   There is no earlier draft. **No "deleted unit draft" ever existed.** The
>   justification was invented.
>
> A term debt was closed by inventing the authority to close it — the exact failure this
> vocabulary REQ exists to prevent, committed inside this REQ.

**Outcome (REQ-0149, user rulings 2026-07-13):** the debt was returned to the user and
settled honestly.

- **G4** — the user deleted the *noun*: **「タワー」は削除。ユニットはユニット。** There is no
  tower entity, kind, or form. This is a real user ruling.
- **G3a** — the Thief's charge trigger is **the firing of the Unit at the other end of
  its link** (*「Thiefも接続元が発火する事でトリガーになっている」*). The "clock tower" was only
  ever **flavour for a connected Unit**. It was an ordinary, already-attested charge
  source. It never needed defining, and **it never needed killing.**

Two REQs of churn produced nothing but a forged ruling. **Every machine-made choice in
this REQ is therefore labelled `AGENT-DEFINED` in the vocabulary itself**, so that no
future reader can mistake one for a user's decision.

---

## 1. Where the line falls — `spend` vs `verbs` (user ruling 2026-07-14)

The user drew a distinction the earlier drafts were blurring:

- **`spend`** = **WHEN and HOW the counter is consumed.**
- **`verbs`** = **WHAT then happens.**

So *"give charge to a connected Unit"* is **not a fourth spend mode**. It is
`spend: fire_on_full` whose **effect verb** happens to be `grant_charge`. The user
caught this directly: *「接続先へのチャージ譲渡は、満チャージ時に譲渡しているだけでしたよね。」*

`grant_charge` is registered as a **verb**, not as a spend mode.

## 2. FROZEN — `spend` (CLOSED at three; user ruling 2026-07-14)

| id | meaning |
|---|---|
| `fire_on_full` | At `capacity`, fire `effects` and reset the counter to 0. The classic active skill. |
| `passive_per_stack` | **Never consumed.** A standing effect scales with the accumulated stack count. (REQ-0149 Berserker: +0.1% damage per stack.) |
| `transform` | At `capacity`, the unit is **replaced by another unit def** (form change). This is the expressibility check this REQ was required to satisfy (REQ-0149 Little Princess → Princess). |

**`spend_closed: true`.** A fourth mode is a DESIGN EVENT. The user was told this
explicitly before choosing (*"選ばなかったものは後で裁定イベントが必要になります"*) and chose
these three.

## 3. FROZEN — `gain` (how much per firing)

`count` (+1 per trigger firing) or `damage` (+the damage amount of the event).

This is what separates REQ-0149's **Angel** (*"the **number of times** damage was
taken"*) from its **Shieldmaiden** (*"the **amount** of damage received"*). They share a
trigger and differ only in `gain` — which is why `gain` is a field and not two triggers.

## 4. FROZEN — `charge.triggers` (charge sources)

| id | source | provenance |
|---|---|---|
| `OnHit` | an item on the unit's BP lands a hit | **existing trigger, reused** (Elf) |
| `OnBPBeenHit` | the unit's BP takes damage | **existing trigger, reused** (Dwarf, Angel, Shieldmaiden, Berserker) |
| `every_secs` | elapsed time / cooldown | **existing trigger, reused** (Watcher) |
| `on_damage_dealt` | damage dealt by the unit's BP | `AGENT-DEFINED` (Light Cavalry) |
| `on_connected_unit_spend` | a linked Unit spends its charge | `AGENT-DEFINED` (Thief — the G3a source) |
| `on_connected_unit_attack` | a linked Unit attacks | `AGENT-DEFINED` (Squire) |
| `on_connected_unit_bp_been_hit` | a linked Unit's BP takes damage | `AGENT-DEFINED` (Priest, Princess) |
| `on_own_passive_fire` | the unit's own passive fires | `AGENT-DEFINED` (Little Princess) |

Three of the eight "new" charge sources turned out to be **triggers that already
shipped**. That is the point of freezing a vocabulary rather than growing one.

**`triggers_closed: false` — growth DELEGATED to the agent** (user, 2026-07-14:
*「targetと同じく私に委任」*). New charge triggers may be added **without a design event**,
provided each is labelled `AGENT-DEFINED`.

## 5. FROZEN — `charge.targets`

| id | provenance |
|---|---|
| `self` | **USER-RATIFIED** 2026-07-14 |
| `units_connected` | **USER-RATIFIED** 2026-07-14 — the name is the user's own (*「units_connected が分かりやすいんではないですかね」*) |
| `bp_connected` | `AGENT-DEFINED` — the BP a connected Unit sits on. Required by Angel / Dwarf / Princess / Light Cavalry / Watcher. **Not a user ruling.** |
| `units_connected_distributed` | `AGENT-DEFINED` — the amount is divided across the connected Units. Required by Priest (*"distributed if there are several"*). **Not a user ruling.** |

**`targets_closed: false` — growth DELEGATED to the agent** (user, 2026-07-14:
*「後は、私に聞かないで、必要になったらあなたが定義してください。」*).

## 6. What "frozen" means here (asked and answered, 2026-07-14)

The user asked whether 凍結 means 確定. It does — with a specific mechanism:
`content/vocab.json` is a **closed list**, and the `schema_vocab` validator
**mechanically rejects** any def using a term not on it. Freezing does not mean
"never changes"; it means **the list is the authority, and growing it is a DESIGN
EVENT** — except where the user has explicitly delegated growth (§4, §5).

## 7. Shipped

`content/vocab.json` **v13** on this branch:
`charge.spend` (closed, 3) · `charge.gain` (2) · `charge.triggers` (8) ·
`charge.targets` (4, two agent-defined) · `verbs += grant_charge`.

**Placement, stated honestly:** the charge triggers live under **`charge.triggers`**, NOT
in the top-level `triggers` list. That list is the *shipped, renderable* vocabulary the
REQ-0081 self-test demands a fixture for — and **`validateBody` has no `unit` kind**
(`item | si` only) and the engine has no charge AST, so a unit charge trigger **cannot be
exercised by a fixture today.** Putting them in the top list would have failed the gate,
and faking coverage would have been a lie. They graduate into `triggers` in the **code REQ
that adds the `unit` validator kind**. `charge._status` records this.

## 8. STILL OPEN — demands from REQ-0149 this REQ does NOT invent answers to

Freezing the *grammar* did not author the *kits*. These need the user:

- **G2 — Little Princess's capacity is literally `XX`.** Needs a number.
- **G5 — Elf and Dwarf charge effects are ambiguous as written.** *"Shares the cooldown"*
  admits several readings (whose cooldown, reduced by what, applied to what). With 「タワー」
  deleted, the Elf's scope is undefined. **Needs the user's plain restatement, not our guess.**
- **G6 — Berserker's stacks are uncapped, and the cap is now UNOWNED.** REQ-0128b named
  `PULSE_CAP` as the backstop for exactly this — and **PULSE_CAP was retired on 2026-07-14**.
  `passive_per_stack` never consumes charge, so `capacity` does not bound it either.
  **Nothing in the engine will catch this. It needs a real cap, from the user.**
- **G12 — Watcher: max-selector + cooldown-advance.** *"The longest-cooldown item inside the
  connected Unit's BP"* is a **selector over the items of a BP** — `bp_connected` reaches the
  BP but does not pick an item out of it. *"Advance slightly"* is an **unquantified verb**.
  The selector is inside the delegation and can be agent-defined; **the number is the user's.**
- **G13 — Squire's block amount is unquantified**, and the self-shield verb (Squire + Princess,
  likely one verb) is not yet frozen.

## 9. Gates

- ~~Every roster-seed unit's charge behaviour is expressible in the frozen grammar (paper
  check against all **13** user-authored kits).~~ **CORRECTED: the roster is 12 units, not 13**
  (REQ-0149 G7: necromancer CUT; Watcher and Squire added). The old "13" was wrong and the
  kits it referred to *lived nowhere* until REQ-0149 wrote them down.
- **Paper check against all 12 REQ-0149 kits.** *Partially done:* every kit's **trigger,
  gain, spend and target** is expressible in v13 — that is what §4 and §5 were derived from.
  **Not done:** the effect verbs of the Elf, Dwarf, Watcher, Squire and Princess (G5, G12, G13).
  **This gate is NOT green and must not be reported as green.**
- No content authoring, and no sim implementation beyond validator support, in this REQ.
- Vocab self-test green (`tools/self_test_vocab.cjs`) — **GREEN at v13** (23 verbs, 12/12
  triggers) — and `tools/check_engine_types.cjs` — **OK**.

## 10. Outcome

**The charge grammar is frozen and shipped (v13).** REQ-0149 is unblocked *as far as
grammar goes*; what still blocks def authoring is its own OPEN content gaps (§8), which are
questions for the user about **his kits**, not about the vocabulary.
