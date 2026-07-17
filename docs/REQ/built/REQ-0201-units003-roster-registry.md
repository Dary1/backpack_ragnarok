# REQ-0201 - Units003 Roster Registry

**Status:** Spec written; REQ file lands in `todo/`. This branch carries the SPEC + one small
code delta only; the registry/adoption/data phase runs POST-MERGE, orchestrator-driven (s6).
**Reserved:** 2026-07-16
**Slug:** units003-roster-registry
**Branch:** req-0201-units003-roster-registry
**Depends on:** **REQ-0200** (unit charge engine: vocab v14->v15, `validateCharge` in
`shared/content_validate.cjs`, `renderCharge`, the runtime engine) — **MUST MERGE FIRST**
(merge order 0200 -> 0201); REQ-0170/0171 (`unit_def` + `gacha_pack` as content-data-registry
kinds; `content/live/live_units.json`); REQ-0155/0157/0164/0173 (content-data registry +
contentadmin UX); REQ-0151/0152 (artwork registry + inspection kits); REQ-0129 (charge grammar
freeze + the triggers/targets delegation).
**Paired:** REQ-0202 (bp-packs-units003 — themed BP packs that expose this roster).

## 1. Goal
Ship the **units003 batch — 30 new Units** as content-data registry entries (kind `unit_def`,
schema `unit/1`), **one variant each**, taken verbatim from the ratified kit sheet (s3). Each
unit is adopted after the four machine checks + a separate-agent advisory review; its **ARTWORK
facet** is the artadmin system_name **`units003_<id>`**. For this batch the **adopt decision is
delegated to the agent/orchestrator** under the user's 2026-07-16 directive 「採用をあなたが決め」.
This REQ file is the **design payload of record** + the ingest-time validator delta (s7); the
actual registration and adoption are executed post-merge by the orchestrator (s6).

### 1.1 Art status snapshot (at spec time, 2026-07-16/17)
**24 of 30** units003 artworks are **ADOPTED** in artadmin as `units003_<id>` (rendered,
inspected, adopted). The remaining **6** are pending render completion. Recorded prompt-adjust
example: **plaguedoctor** was **re-prompted for a proper beak mask** — the first renders read as
a plain hood, and the illustration-first golden wants the recognizable plague-doctor beak; this
is a normal "reroll by changing the PROMPT, not the seed" pass (pipeline §7.2), NOT a kit change.
The 6-of-30 art gap does **not** block this REQ: a unit's DATA facet and ARTWORK facet are
adopted independently (pipeline §7.3), and each def carries `icon = units003_<id>` regardless of
whether that artwork render is adopted yet. Data adoption can lead; artwork catches up per-unit.

## 2. Provenance / delegation chain (nothing here is a NEW user ruling)
Every new vocabulary entry the kit sheet uses is **AGENT-DEFINED**, never a user ruling, under a
standing delegation — so a machine's design choice is never mistaken for the user's:
- **Triggers / targets** delegated to the agent **2026-07-14 (REQ-0129)** — targets verbatim
  「後は、私に聞かないで、必要になったらあなたが定義してください」, triggers 「targetと同じく私に委任」.
- **Verbs** delegated **2026-07-16 chat** 「必要な動詞はじゃんじゃんあなたの意思で追加して」.
- **Adoption for this batch** delegated **2026-07-16** 「採用をあなたが決め」 — the orchestrator
  makes the adopt call after the advisory review, no per-unit user sign-off.
The new vocab those delegations produced (s3.1) is **implemented by REQ-0200** (vocab v15); this
REQ is its first and only design consumer (the 30 kits). The doc strings in s3.1 are the verbatim
source REQ-0200 copied into `content/vocab.json`.

## 3. The kit sheet — units003 (THE design payload of record, 30 units)
One `unit_def` variant per entry. Fields: `id / name / rarity / connection_shape / i18n /
flavor(+_ja) / charge / design_note`. `design_note` is authoring-only (the def `brief`, dropped
from the served entry); `charge` is the REQ-0200 charge AST; `connection_shape` is a key of
`vocab.connection_shapes`. Embedded in full so this file is the single source the post-merge
registration reads from:

```json
[
  {
    "id": "alchemist",
    "name": "Alchemist",
    "rarity": "Common",
    "connection_shape": "queen_2",
    "i18n": {
      "ja": {
        "name": "錬金術師"
      }
    },
    "flavor": "A splash of something that keeps bubbling.",
    "flavor_ja": "ぐつぐつ、まだ何か煮えている。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          4,
          5
        ]
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "add_on_hit_status",
            "status": "Poison",
            "n": [
              2,
              3
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Drop beside an attacker to turn its hits into a poison source; DoT enabler."
  },
  {
    "id": "bard",
    "name": "Bard",
    "rarity": "Common",
    "connection_shape": "rook_3",
    "i18n": {
      "ja": {
        "name": "吟遊詩人"
      }
    },
    "flavor": "Every swing keeps the beat.",
    "flavor_ja": "その一振り、リズムを刻む。",
    "charge": {
      "trigger": {
        "t": "on_connected_unit_attack"
      },
      "gain": "count",
      "capacity": [
        3,
        4
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "haste",
            "n": [
              2,
              3
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "In-line with a busy attacker: rewards their swings with a speed song."
  },
  {
    "id": "cleric",
    "name": "Cleric",
    "rarity": "Common",
    "connection_shape": "queen_2",
    "i18n": {
      "ja": {
        "name": "聖職者"
      }
    },
    "flavor": "Mercy answers mercy.",
    "flavor_ja": "慈悲は慈悲を呼ぶ。",
    "charge": {
      "trigger": {
        "t": "on_heal_done"
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "cleanse"
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Pair with any healing item; each heal cascades into a cleanse for nearby allies."
  },
  {
    "id": "darkelf",
    "name": "Dark Elf",
    "rarity": "Rare",
    "connection_shape": "bishop",
    "i18n": {
      "ja": {
        "name": "ダークエルフ"
      }
    },
    "flavor": "Her gaze saps the strong.",
    "flavor_ja": "その眼差しが強者を蝕む。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          3,
          4
        ]
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "add_on_hit_status",
            "status": "Weakness",
            "n": [
              2,
              3
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Diagonal curse lane; softens foes for whatever hitter shares her diagonal."
  },
  {
    "id": "darkknight",
    "name": "Dark Knight",
    "rarity": "Common",
    "connection_shape": "none",
    "i18n": {
      "ja": {
        "name": "ダークナイト"
      }
    },
    "flavor": "Pain is fuel.",
    "flavor_ja": "痛みこそ我が糧。",
    "charge": {
      "trigger": {
        "t": "OnBPBeenHit"
      },
      "gain": "count",
      "capacity": [
        12,
        18
      ],
      "spend": "passive_per_stack",
      "effects": [
        {
          "verb": {
            "t": "buff_self",
            "pct": [
              0.1,
              0.2
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Self-contained Berserker cousin; needs no links, grows the more it is hit."
  },
  {
    "id": "dragonknight",
    "name": "Dragon Knight",
    "rarity": "Relic",
    "connection_shape": "queen",
    "i18n": {
      "ja": {
        "name": "竜騎士"
      }
    },
    "flavor": "The breath that ends sieges.",
    "flavor_ja": "攻城を終わらせる吐息。",
    "charge": {
      "trigger": {
        "t": "on_damage_dealt"
      },
      "gain": "damage",
      "capacity": [
        80,
        120
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "multi_strike",
            "n": [
              15,
              25
            ],
            "hits": [
              3,
              4
            ]
          },
          "target": "self"
        },
        {
          "verb": {
            "t": "add_on_hit_status",
            "status": "Burn",
            "n": [
              3,
              4
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Heavy self-carry; a big weapon host charges the breath, which also ignites."
  },
  {
    "id": "druid",
    "name": "Druid",
    "rarity": "Common",
    "connection_shape": "queen_2",
    "i18n": {
      "ja": {
        "name": "ドルイド"
      }
    },
    "flavor": "The grove tends its own.",
    "flavor_ja": "森は己の者を癒す。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          3,
          4
        ]
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "apply_status",
            "status": "Regen",
            "n": [
              2,
              3
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Passive regen aura for the support cluster."
  },
  {
    "id": "fairy",
    "name": "Fairy",
    "rarity": "Common",
    "connection_shape": "queen_2",
    "i18n": {
      "ja": {
        "name": "妖精"
      }
    },
    "flavor": "A flit, a giggle, a little mending.",
    "flavor_ja": "ひらり、くすくす、ちょっとの手当て。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          2,
          3
        ]
      },
      "gain": "count",
      "capacity": [
        1,
        2
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "heal_bp",
            "n": [
              3,
              5
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Cheap frequent trickle-heal; feeds cleric/paladin on_heal_done chains."
  },
  {
    "id": "gladiator",
    "name": "Gladiator",
    "rarity": "Common",
    "connection_shape": "queen_2",
    "i18n": {
      "ja": {
        "name": "剣闘士"
      }
    },
    "flavor": "The crowd roars; he answers.",
    "flavor_ja": "歓声が上がれば、応えるまで。",
    "charge": {
      "trigger": {
        "t": "on_connected_unit_attack"
      },
      "gain": "count",
      "capacity": [
        5,
        8
      ],
      "spend": "passive_per_stack",
      "effects": [
        {
          "verb": {
            "t": "buff_self",
            "pct": [
              1,
              2
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Ramps his own damage while nearby allies swing; wants a busy formation."
  },
  {
    "id": "hero",
    "name": "Hero",
    "rarity": "Common",
    "connection_shape": "queen",
    "i18n": {
      "ja": {
        "name": "勇者"
      }
    },
    "flavor": "One more push!",
    "flavor_ja": "もう一押しだ！",
    "charge": {
      "trigger": {
        "t": "on_damage_dealt"
      },
      "gain": "damage",
      "capacity": [
        40,
        60
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "fire_items",
            "tag": "Weapon"
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Converts sustained damage into a weapon re-fire; self-burst carry."
  },
  {
    "id": "icequeen",
    "name": "Ice Queen",
    "rarity": "Rare",
    "connection_shape": "rook",
    "i18n": {
      "ja": {
        "name": "氷の女王"
      }
    },
    "flavor": "Winter obeys only her.",
    "flavor_ja": "冬は彼女にのみ従う。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          3,
          4
        ]
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "add_on_hit_status",
            "status": "Chill",
            "n": [
              3,
              4
            ]
          },
          "target": "units_connected"
        },
        {
          "verb": {
            "t": "status_immune",
            "status": "Chill"
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Long lanes make the team's hits chill enemies while the team itself ignores Chill."
  },
  {
    "id": "jester",
    "name": "Jester",
    "rarity": "Uncommon",
    "connection_shape": "shougi_keima_move",
    "i18n": {
      "ja": {
        "name": "道化師"
      }
    },
    "flavor": "Round and round the mischief goes.",
    "flavor_ja": "悪戯はぐるぐる巡る。",
    "charge": {
      "trigger": {
        "t": "on_connected_unit_spend"
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "grant_charge",
            "n": [
              1,
              2
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Keima offset finds a spender and feeds charge back — chains spend loops with king."
  },
  {
    "id": "king",
    "name": "King",
    "rarity": "Relic",
    "connection_shape": "queen",
    "i18n": {
      "ja": {
        "name": "王"
      }
    },
    "flavor": "The realm rises at his word.",
    "flavor_ja": "王の一言に国が立つ。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          4,
          6
        ]
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "buff_linked",
            "pct": [
              8,
              12
            ]
          },
          "target": "units_connected"
        },
        {
          "verb": {
            "t": "grant_charge",
            "n": [
              1,
              1
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Central throne; radiates a damage buff + charge to all 8 directions. Wants max links."
  },
  {
    "id": "knight",
    "name": "Knight",
    "rarity": "Common",
    "connection_shape": "rook",
    "i18n": {
      "ja": {
        "name": "騎士"
      }
    },
    "flavor": "None pass the line.",
    "flavor_ja": "この線は誰も越えさせぬ。",
    "charge": {
      "trigger": {
        "t": "OnBPBeenHit"
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "block",
            "n": [
              8,
              12
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Simple orthogonal tank; blocks after taking hits."
  },
  {
    "id": "miko",
    "name": "Shrine Maiden",
    "rarity": "Uncommon",
    "connection_shape": "bishop",
    "i18n": {
      "ja": {
        "name": "巫女"
      }
    },
    "flavor": "Purification along the sacred diagonal.",
    "flavor_ja": "聖なる対角に祓いを。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          4,
          5
        ]
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "cleanse"
          },
          "target": "units_connected"
        },
        {
          "verb": {
            "t": "heal_bp",
            "n": [
              4,
              6
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Diagonal support; cleanses and heals allies on her diagonals."
  },
  {
    "id": "monk",
    "name": "Monk",
    "rarity": "Common",
    "connection_shape": "queen_2",
    "i18n": {
      "ja": {
        "name": "武僧"
      }
    },
    "flavor": "Each strike, deeper calm.",
    "flavor_ja": "一打ごとに深まる静寂。",
    "charge": {
      "trigger": {
        "t": "OnHit"
      },
      "gain": "count",
      "capacity": [
        6,
        10
      ],
      "spend": "passive_per_stack",
      "effects": [
        {
          "verb": {
            "t": "damage_reduction",
            "pct": [
              1,
              2
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Turns his own attacks into standing defense; wants a fast self-weapon."
  },
  {
    "id": "ninja",
    "name": "Ninja",
    "rarity": "Uncommon",
    "connection_shape": "lance",
    "i18n": {
      "ja": {
        "name": "忍者"
      }
    },
    "flavor": "Harm my ward, meet the shadow.",
    "flavor_ja": "我が主を害さば、影が応える。",
    "charge": {
      "trigger": {
        "t": "on_connected_unit_bp_been_hit"
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "strike",
            "n": [
              15,
              25
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Lance payoff — sits behind an ally; assassinates when that front ally is hit."
  },
  {
    "id": "orc",
    "name": "Orc",
    "rarity": "Uncommon",
    "connection_shape": "rook",
    "i18n": {
      "ja": {
        "name": "オーク"
      }
    },
    "flavor": "Blood wakes the war-song.",
    "flavor_ja": "血が戦の歌を呼び覚ます。",
    "charge": {
      "trigger": {
        "t": "on_damage_dealt"
      },
      "gain": "damage",
      "capacity": [
        40,
        60
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "haste",
            "n": [
              2,
              3
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Damage output loops into attack speed; self-sufficient frenzy bruiser."
  },
  {
    "id": "paladin",
    "name": "Paladin",
    "rarity": "Rare",
    "connection_shape": "queen_2",
    "i18n": {
      "ja": {
        "name": "聖騎士"
      }
    },
    "flavor": "Faith made a wall.",
    "flavor_ja": "信仰が壁となる。",
    "charge": {
      "trigger": {
        "t": "on_heal_done"
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "grant_shield",
            "n": [
              8,
              12
            ]
          },
          "target": "bp_connected_lowest_hp"
        }
      ]
    },
    "design_note": "Turns healing into shields funneled to the most hurt neighbor; pairs with cleric/fairy."
  },
  {
    "id": "pirate",
    "name": "Pirate",
    "rarity": "Common",
    "connection_shape": "queen",
    "i18n": {
      "ja": {
        "name": "海賊"
      }
    },
    "flavor": "Every hit fills the coffers... and the wounds.",
    "flavor_ja": "一撃ごとに財宝と傷が満ちる。",
    "charge": {
      "trigger": {
        "t": "on_damage_dealt"
      },
      "gain": "damage",
      "capacity": [
        30,
        50
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "heal_bp",
            "n": [
              6,
              10
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Sustained attacker that plunders its own healing from damage dealt."
  },
  {
    "id": "plaguedoctor",
    "name": "Plague Doctor",
    "rarity": "Uncommon",
    "connection_shape": "queen_2",
    "i18n": {
      "ja": {
        "name": "ペスト医師"
      }
    },
    "flavor": "Let the miasma do its work.",
    "flavor_ja": "瘴気に仕事をさせよう。",
    "charge": {
      "trigger": {
        "t": "on_status_applied"
      },
      "gain": "count",
      "capacity": [
        3,
        4
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "amp_status",
            "status": "Poison",
            "n": [
              1,
              2
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Status payoff — near a poisoner (alchemist/witch), each application feeds an amp; DoT core."
  },
  {
    "id": "ranger",
    "name": "Ranger",
    "rarity": "Uncommon",
    "connection_shape": "rook_3",
    "i18n": {
      "ja": {
        "name": "レンジャー"
      }
    },
    "flavor": "She calls the weak point.",
    "flavor_ja": "彼女が弱点を告げる。",
    "charge": {
      "trigger": {
        "t": "on_connected_unit_attack"
      },
      "gain": "count",
      "capacity": [
        3,
        4
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "bonus_vs_status",
            "status": "any",
            "pct": [
              20,
              30
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "In-line allies deal bonus damage to already-afflicted foes; pairs with any DoT enabler."
  },
  {
    "id": "samurai",
    "name": "Samurai",
    "rarity": "Rare",
    "connection_shape": "rook",
    "i18n": {
      "ja": {
        "name": "侍"
      }
    },
    "flavor": "Strike him, and the blade answers itself.",
    "flavor_ja": "斬れば、刃が自ら返す。",
    "charge": {
      "trigger": {
        "t": "OnBPBeenHit"
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "block",
            "n": [
              6,
              10
            ]
          },
          "target": "self"
        },
        {
          "verb": {
            "t": "reflect_damage",
            "pct": [
              25,
              35
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Orthogonal counter-tank; block + thorns whenever struck."
  },
  {
    "id": "shaman",
    "name": "Shaman",
    "rarity": "Uncommon",
    "connection_shape": "queen_2",
    "i18n": {
      "ja": {
        "name": "シャーマン"
      }
    },
    "flavor": "The ancestors lend their breath.",
    "flavor_ja": "祖霊が息吹を貸す。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          4,
          5
        ]
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "grant_charge",
            "n": [
              1,
              2
            ]
          },
          "target": "units_connected"
        },
        {
          "verb": {
            "t": "apply_status",
            "status": "Regen",
            "n": [
              1,
              2
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Support totem; feeds charge + regen to the nearby cluster."
  },
  {
    "id": "sorceress",
    "name": "Sorceress",
    "rarity": "Rare",
    "connection_shape": "queen",
    "i18n": {
      "ja": {
        "name": "炎術師"
      }
    },
    "flavor": "Embers become an inferno.",
    "flavor_ja": "残り火が業火となる。",
    "charge": {
      "trigger": {
        "t": "on_damage_dealt"
      },
      "gain": "damage",
      "capacity": [
        60,
        90
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "multi_strike",
            "n": [
              18,
              28
            ],
            "hits": [
              2,
              3
            ]
          },
          "target": "self"
        },
        {
          "verb": {
            "t": "add_on_hit_status",
            "status": "Burn",
            "n": [
              3,
              4
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Ramps to a fiery multi-hit that ignites; wants steady chip damage to charge."
  },
  {
    "id": "valkyrie",
    "name": "Valkyrie",
    "rarity": "Rare",
    "connection_shape": "chess_knight_move",
    "i18n": {
      "ja": {
        "name": "ヴァルキュリア"
      }
    },
    "flavor": "She lifts the fallen mid-battle.",
    "flavor_ja": "戦場のただ中で倒れし者を掬い上げる。",
    "charge": {
      "trigger": {
        "t": "on_connected_unit_bp_been_hit"
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "grant_shield",
            "n": [
              10,
              15
            ]
          },
          "target": "bp_connected"
        },
        {
          "verb": {
            "t": "heal_bp",
            "n": [
              5,
              8
            ]
          },
          "target": "bp_connected"
        }
      ]
    },
    "design_note": "Knight-leap reaches distant allies; rescues whoever gets hit with shield + heal."
  },
  {
    "id": "vampire",
    "name": "Vampire Lord",
    "rarity": "Relic",
    "connection_shape": "chess_knight_move",
    "i18n": {
      "ja": {
        "name": "吸血鬼"
      }
    },
    "flavor": "The court drinks deep at his command.",
    "flavor_ja": "宮廷は主の命で深く飲む。",
    "charge": {
      "trigger": {
        "t": "on_connected_unit_attack"
      },
      "gain": "count",
      "capacity": [
        3,
        4
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "grant_lifesteal",
            "pct": [
              15,
              25
            ],
            "dur_s": [
              4,
              6
            ]
          },
          "target": "units_connected"
        },
        {
          "verb": {
            "t": "buff_self",
            "pct": [
              3,
              5
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Grants blood-thirst to linked attackers; a leap-placed sustain engine for a whole formation."
  },
  {
    "id": "werewolf",
    "name": "Werewolf",
    "rarity": "Uncommon",
    "connection_shape": "chess_knight_move",
    "i18n": {
      "ja": {
        "name": "人狼"
      }
    },
    "flavor": "The kill only sharpens the hunger.",
    "flavor_ja": "殺しは飢えを研ぎ澄ますだけ。",
    "charge": {
      "trigger": {
        "t": "on_kill"
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "haste",
            "n": [
              2,
              3
            ]
          },
          "target": "self"
        },
        {
          "verb": {
            "t": "buff_self",
            "pct": [
              8,
              12
            ]
          },
          "target": "self"
        }
      ]
    },
    "design_note": "Snowballs off kills — faster and stronger each time it finishes a foe."
  },
  {
    "id": "witch",
    "name": "Witch",
    "rarity": "Uncommon",
    "connection_shape": "bishop",
    "i18n": {
      "ja": {
        "name": "魔女"
      }
    },
    "flavor": "A hex stitched into every strike.",
    "flavor_ja": "一撃ごとに呪いを縫い込む。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          3,
          4
        ]
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "add_on_hit_status",
            "status": "Burn",
            "n": [
              2,
              3
            ]
          },
          "target": "units_connected"
        }
      ]
    },
    "design_note": "Diagonal hex; grants Burn-on-hit to allies on her diagonals — feeds plaguedoctor/ranger."
  },
  {
    "id": "wizard",
    "name": "Wizard",
    "rarity": "Rare",
    "connection_shape": "bishop",
    "i18n": {
      "ja": {
        "name": "魔法使い"
      }
    },
    "flavor": "Time bends around the old man's staff.",
    "flavor_ja": "老翁の杖の周りで時が歪む。",
    "charge": {
      "trigger": {
        "t": "every_secs",
        "s": [
          4,
          5
        ]
      },
      "gain": "count",
      "capacity": [
        2,
        3
      ],
      "spend": "fire_on_full",
      "effects": [
        {
          "verb": {
            "t": "advance_cooldown",
            "n": [
              2,
              3
            ]
          },
          "target": "bp_connected_max_cooldown_item"
        }
      ]
    },
    "design_note": "Watcher's big cousin — sharply advances the slowest item on a diagonal ally; loves clunky high-cooldown backpacks."
  }
]
```

### 3.1 New vocabulary the kits introduce (AGENT-DEFINED; implemented by REQ-0200 as vocab v15)
Embedded verbatim from the ratified `units003_new_vocab.json`. These are the ONLY additions the
30 kits require on top of the frozen v14 grammar; REQ-0200 landed them (top-level `triggers`/
`verbs`, `charge.targets`, and the pct/hits/"any"/`dur_s`/po_tag param conventions):

```json
{
  "_doc": "units003 (REQ-0201) new vocabulary — AGENT-DEFINED under user delegations: triggers/targets delegated 2026-07-14 (REQ-0129), verbs delegated 2026-07-16 chat (「必要な動詞はじゃんじゃんあなたの意思で追加して」). Implemented by REQ-0200.",
  "verbs": {
    "grant_lifesteal": {
      "doc": "AGENT-DEFINED 2026-07-16 (REQ-0201 kit sheet). Attach lifesteal to the target Unit's items for dur_s seconds: pct of damage their items deal returns as healing to that Unit's BP. Params: pct [lo,hi], dur_s [lo,hi].",
      "used_by": [
        "vampire"
      ]
    }
  },
  "triggers": {
    "on_heal_done": {
      "doc": "AGENT-DEFINED 2026-07-16. Fires each time an item on this Unit's BP resolves a heal. Loop invariant: on_heal_done charge effects must not themselves heal (reviewer-held rule, REQ-0201).",
      "used_by": [
        "cleric",
        "paladin"
      ]
    },
    "on_status_applied": {
      "doc": "AGENT-DEFINED 2026-07-16. Fires each time an item on this Unit's BP applies a status to an enemy (incl. add_on_hit_status landing).",
      "used_by": [
        "plaguedoctor"
      ]
    },
    "on_kill": {
      "doc": "AGENT-DEFINED 2026-07-16. Fires once per enemy destroyed by an attack originating from this Unit's BP (one event per death, never per-hit).",
      "used_by": [
        "werewolf"
      ]
    }
  },
  "targets": {
    "bp_connected_lowest_hp": {
      "doc": "AGENT-DEFINED 2026-07-16. The BP of the linked Unit with the lowest current HP (ties: nearest link, then lowest cell index).",
      "used_by": [
        "paladin"
      ]
    }
  },
  "verb_param_extensions": {
    "multi_strike.hits": "[lo,hi] range — number of hits (unit charge context).",
    "bonus_vs_status.status_any": "bonus_vs_status accepts status \"any\" = any afflicted status (ranger).",
    "fire_items.tag": "optional po_tag filter (existing convention from REQ-0149 Shieldmaiden/Light Cavalry).",
    "pct_params": "pct [lo,hi] = percent points on buff_self / buff_linked / damage_reduction / reflect_damage / bonus_vs_status / grant_lifesteal."
  }
}
```

## 4. S1 reviewer adjustments (design review, recorded)
The kit sheet above is **post-review**; the S1 (separate-agent) design review made these
canonicalizations before ratification, recorded here for provenance:
- **Rarity canonicalization** to the four `vocab.rarities` tokens: **monk -> Common**,
  **druid -> Common**, **jester -> Uncommon** (the draft had off-vocabulary rarity words; every
  rarity must be one of Common/Uncommon/Rare/Relic or `schema_vocab` FAILs).
- **`adjacency` -> `queen_2`** for the melee-support cluster: the draft used `adjacency`
  (range-1 all-directions); ratified to **`queen_2`** (the Watcher range-1 precedent, REQ-0170)
  so the support units read links on the established 2-cell radial shape rather than a bespoke
  adjacency key. (`adjacency` remains a legal shape; the review chose `queen_2` for consistency.)
- **`grant_lifesteal` gains a `dur_s` param**: lifesteal is a *timed* grant (pct of item damage
  returns as healing for `dur_s` seconds), so the verb carries `pct:[lo,hi]` AND `dur_s:[lo,hi]`
  (vampire). Recorded in the new-vocab `verb_param_extensions`; enforced by REQ-0200's
  `validateCharge`.

## 5. Dependency — REQ-0200 merges first, register against the RESTARTED api
> **INTEGRATION UPDATE (integration-units003):** 0200 has now been merged BEFORE 0201 on the
> integration branch, so `charge` IS a legal, deep-validated `unit_def` field here (vocab v15,
> `validateCharge` wired into `validateUnitEntry`). The pre-0200 caveats below are retained as the
> branch-authoring record; the post-merge test truth is in §7.
`unit/1` entries in this batch carry a `charge` block. On this branch (pre-0200) `charge` is not
a legal unit field yet (it is not in `UNIT_ALLOWED_KEYS`), and neither the top-level vocab nor
`validateCharge` know the new triggers/verbs/targets. Therefore:
- **REQ-0200 must merge first** (vocab v15 + `validateCharge` wired into `validateUnitEntry` +
  `renderCharge`). Merge order is **0200 -> 0201**.
- Registration/adoption happens against the **RESTARTED** `contentadmin`/api process (so it loads
  the merged v15 vocab and the charge-aware validator). Registering a charge-bearing variant
  before the restart would FAIL machine checks on the unknown `charge` field.

## 6. Execution plan (POST-MERGE, orchestrator-driven, via the contentadmin HTTP API)
The registry/data phase is **not** executed on this branch. After 0200+0201 merge and the api
restarts, the orchestrator runs, **per unit** (routes in `server/routes/content.cjs`):
1. **POST `/api/content/defs`** — create the `unit_def` def (`system_name` = the unit `id`,
   `kind=unit_def`, `schema_ref=unit/1`, `brief` = the kit `design_note`).
2. **PATCH `/api/content/defs/<id>`** — set `artwork_ref = units003_<id>` (validated against the
   artworks table; the artwork facet).
3. **POST `/api/content/defs/<id>/variants`** — one variant, `data` = the FULL `unit/1` entry
   (incl. `id`, `icon` = `units003_<id>`, `charge`); `provenance` = `{ model:
   "claude-opus-4-8", prompt: "units003 kit design S1" }`. **The four machine checks auto-run**
   on POST (`schema_vocab` — now incl. the deepened `validateUnitEntry`, s7 — / `engine_types` /
   `gen_data` / `integrate` n-a).
4. **POST `/api/content/defs/<id>/variants/1/review`** — the separate-agent advisory review
   (Opus-class, **mandatory rationale**, never binding; pipeline §7.5).
5. **POST `/api/content/defs/<id>/adopt`** — adopt variant 1 (the agent's call, s2). A machine
   FAIL is adoptable only behind `override:true`; none is expected.
6. Adoption **exports** the adopted variant to `content/registry_exports/unit_def/` (the export
   STEP; `CONTENT_EXPORT_GIT`-gated git/live-merge is the DEPLOY step, pipeline §7.4).
Then the **deploy step** merges the exports into `content/live/live_units.json` via the integrate
conventions, and **`tools/check_units.cjs`** gates the merged live file (roster grows 12 -> 42).

## 7. Code delta THIS branch — deepen the `unit_def` machine check
`server/services/content_checks.cjs`, in the `unit_def` `schema_vocab` dialect: in addition to
the existing `checkEffects(...)` call, run **`validateUnitEntry(data, vocab)`** from
`shared/content_validate.cjs` (catch -> `errs.push(e.message)`), **guarded on `data.id` present**
(only a full registry variant carries the whole entry). This is the SAME executable validator the
`check_units.cjs` live gate runs, so a variant's full `unit/1` entry — incl. its `charge` block —
is machine-checked **at INGEST time** (on `POST .../variants`), not only later at the live gate.
Reuse, not a second copy: two definitions of "a legal unit entry" would drift, and the drift
would be invisible (same doctrine as REQ-0171's `validatePackEntry` reuse).

**Coupling RESOLVED (integration-units003; merge order 0200 -> 0201 COMPLETE).**
`validateUnitEntry` KNOWS the `charge` grammar now that **REQ-0200** has added `charge` to
`UNIT_ALLOWED_KEYS` and wired `validateCharge` into `validateBody('unit')`. A charge-bearing
variant is therefore no longer an **unknown field**: a **legal** charge block (the units003
alchemist kit) is deep-checked against the charge AST and **ACCEPTED**, and an **illegal** one
(unknown trigger / bad capacity / illegal spend) is rejected by that AST. The server test on the
integration branch pins this post-merge truth (see the "Test added" bullets, updated below).
_History (pre-0200 REQ-0201 branch): the same charge-bearing variant was correctly rejected as an
unknown field (`unknown field "charge" ...`); that temporary state is retired on integration._

**Test added** — `server/tests/content_checks_unit_deep_test.cjs` (mirrors the existing
`content_checks_dialect_test.cjs` harness), wired into `tools/ci.sh` step **[4.665]**:
- minimal legal unit entry (charge-less) **PASS**;
- variant missing `i18n.ja.name` **FAIL** on `schema_vocab` (proves `validateUnitEntry` is wired
  — the base `schema_vocab` check does not look at i18n);
- charge-bearing variant with a **legal** charge block **PASS** — the charge AST deep-validates it
  (post-0200 truth; on the pre-0200 branch this asserted the unknown-field rejection instead);
- illegal-charge (garbage trigger) **FAIL** — asserts the deep charge-AST message
  (`... is not a charge-legal trigger`), a reject by the AST, not by unknown-field;
- **guard**: an id-less partial record is NOT forced through `validateUnitEntry`;
- **regression**: the 12 live roster `unit_def`s still PASS the deepened check.

## 8. Gates (this branch, worktree; server-only delta)
Run under `node v24` (nvm), worktree provisioned with `pnpm install --frozen-lockfile` (root +
`server/`; store warm). The delta touches only `server/services/content_checks.cjs`, the new
server test, and `tools/ci.sh` — **no client/sim/content change** — so the pertinent gates are:
- **NEW `content_checks_unit_deep_test.cjs`: 6 passed / 0 failed.**
- **`content_checks_dialect_test.cjs` (same module, regression): 24 passed / 0 failed** — incl.
  the 12 live `unit_def`s and the 3 live `gacha_pack`s still PASS.
- **server api tests (files backend) `api_test.cjs`: 185 passed / 0 failed** (1500 assertions) —
  unchanged from the REQ-0200 baseline.
- **`tools/check_units.cjs`: ALL GREEN** (12 defs / 3 packs / 0 failures) — the live gate the
  ingest check mirrors.
- **`tools/self_test_vocab.cjs`: ALL GREEN** (26 verbs / 12 of 12 triggers) — the pre-0200 vocab,
  correct for this branch.
- **`sim/tests/run.cjs`: 111 passed / 1 failed** — the single red is **pre-existing and unrelated**
  to this delta (`REQ-0122 lossless promotion invariant`: a `content/live/dungeon/dungeon.json`
  sha256-vs-registry-provenance drift). Confirmed independent by re-running with this branch's
  edits stashed: still 111/1. **Not fixed here** (out of scope; different subsystem).

**Honest CI caveat.** `SKIP_PG=1 SKIP_E2E=1 bash tools/ci.sh` aborts at step **[1] sim tests**
because of that pre-existing REQ-0122 red (`set -e`), before reaching the server/content steps.
The full client build ([6]) was **not** run (client node_modules not provisioned; the delta is
server-only). The gates above were therefore run **directly and targeted**, stated honestly.
The **pg-backend** content-registry tests (`content_test.cjs` etc., which exercise the POST
variant -> machine-check -> adopt flow this REQ's delta sits inside) need `DATABASE_URL` and were
**not run** here per the hard rule against disturbing the live DB/services; they are expected
green (no fixture carries `charge`, so the deepened check is inert on them until 0201's data lands).

## 9. Lifecycle note
This REQ file lands in **`docs/REQ/todo/`**, not `built/`: the SPEC + code delta are complete on
this branch, but the **registry/adoption/data phase (s6) runs POST-MERGE**, orchestrator-driven,
against the restarted api. The file stays in `todo/` carrying this note until that data phase
completes; only then does it advance.


## Data phase — EXECUTED 2026-07-17 (orchestrator, post-merge)

- 30 content_defs (kind unit_def) created; artwork_ref linked to units003_<id> (all 30
  artworks adopted from 4-seed galleries; plaguedoctor re-prompted for the beak mask and
  re-adopted from the second gallery — the prompt-adjust example this REQ predicted).
- 30 variants ingested (provenance: claude-opus-4-8 S1 design, reviewer-amended);
  machine checks: 30/30 PASS. Separate-agent advisory reviews (claude-opus-4-8,
  mandatory rationale) recorded on every variant — shaman via its own follow-up round
  after a transcription gap; its concern produced an adoption-time amendment.
- Adoption-time reviewer amendments (recorded in the review rationales):
  darkknight buff_self pct [0.1,0.2]->[0.5,0.8] (dead-kit fix); werewolf buff_self
  pct [8,12]->[2,3] (uncapped kill-snowball softened); shaman grant_charge n [1,2]->[1,1]
  (Uncommon exceeded the Relic king); jester keeps shougi_keima_move as a deliberate
  narrow-placement gamble (engine implements offset shapes generically — verified).
- All 30 adopted + exported to content/registry_exports/unit_def/, then live-merged:
  live_units.json 12->42, data.js regenerated, check_units ALL GREEN
  (30 charge blocks validated via validateCharge). Deploy commit 68050f4.
- DEVIATION (honest): ingest ran against the pre-restart API process (old in-memory
  validators; shallow unit_def checks) because an unrelated art batch from a concurrent
  session occupies the art_jobs queue and a restart would kill it. Deep validation is
  nevertheless guaranteed: units003_acceptance 30/30 (validateUnitEntry+validateCharge,
  v15) and check_units on the merged live file (30/30) both ran green on the merged code.
  Post-restart, variants can be re-checked via the REQ-0157 recheck endpoint.
