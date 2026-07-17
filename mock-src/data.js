// backpack_ragnarok — GENERATED data.js (do not hand-edit; regenerate via tool_gen_data.cjs v7)
// Source: live_items.json + live_sis.json + scenario.json
// Generated: 2026-07-16T19:14:27.979Z
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory();
  else root.GameData=factory();
})(typeof self!=='undefined'?self:globalThis,function(){
'use strict';
function makeEmptyInventory(){
  const pages=[];
  for(let i=0;i<5;i++)pages.push({bps:[],pos:[],sis:[],tms:[]});
  return {pages,names:['1','2','3','4','5']};
}
function makeEmptySquadSlot(){
  return {linked:true,bps:[],pos:[],sis:[]};
}
function makeSquadsMeta(){
  return {active:0,names:['Squad 1','Squad 2','Squad 3','Squad 4','Squad 5'],
    store:[null,makeEmptySquadSlot(),makeEmptySquadSlot(),makeEmptySquadSlot(),makeEmptySquadSlot()]};
}
const LAYOUT={"ROWS":8,"COLS":8};
const TREES={
 "po": {
  "Weapon": null,
  "WeaponPart": "Weapon",
  "Shield": null,
  "Rune": null,
  "Reagent": null,
  "Relic": null,
  "Curse": null,
  "Flame": null,
  "Frost": null,
  "Oil": null,
  "Poison": null,
  "Beast": null,
  "Metal": null,
  "Wood": null
 },
 "socket": {
  "gem": null,
  "edge": null,
  "coat": null,
  "bond": null,
  "Metal": null,
  "Bone": null
 }
};
const ITEMS={
 "blade": {
  "name": "Longsword Blade",
  "name_ja": "ロングソードの刀身",
  "tags": [
   "WeaponPart",
   "Metal"
  ],
  "rarity": "Common",
  "shape": [
   [
    0,
    0
   ],
   [
    1,
    0
   ]
  ],
  "icon": "icon-blade",
  "sockets": [
   {
    "t": "edge",
    "tags": [
     "Metal"
    ],
    "ax": 0.5,
    "ay": 0.38
   }
  ],
  "eff": "Every 1.8–2.2s: Strike 22–38 (when assembled).",
  "eff_en": "Every 1.8–2.2s: Strike 22–38 (when assembled).",
  "eff_ja": "1.8〜2.2秒ごとに: 22〜38 ダメージ（組み立て時のみ）。",
  "flavor": "Inert alone; sings when it finds its hilt.",
  "flavor_ja": "それ単体では沈黙している。柄を見つけたときだけ歌う。",
  "stretch": true
 },
 "hilt": {
  "name": "Sword Hilt",
  "name_ja": "剣の柄",
  "tags": [
   "WeaponPart",
   "Metal",
   "Wood"
  ],
  "rarity": "Common",
  "shape": [
   [
    0,
    0
   ]
  ],
  "icon": "icon-hilt",
  "sockets": [
   {
    "t": "gem",
    "tags": [
     "Metal"
    ],
    "ax": 0.5,
    "ay": 0.81
   }
  ],
  "eff": "",
  "eff_en": "",
  "eff_ja": "",
  "flavor": "A pommel waiting for a stone.",
  "flavor_ja": "石を待つ、柄頭。",
  "stretch": true
 },
 "flame_tablet": {
  "name": "Flame Rune Tablet",
  "name_ja": "炎のルーンタブレット",
  "tags": [
   "Rune",
   "Flame"
  ],
  "rarity": "Uncommon",
  "shape": [
   [
    0,
    0
   ],
   [
    1,
    0
   ]
  ],
  "icon": "icon-flame_tablet",
  "sockets": [],
  "eff": "Adjacent Weapon: Apply 4–8 Burn on hit. Adjacent Oil: Burn applications x2.",
  "eff_en": "Adjacent Weapon: Apply 4–8 Burn on hit. Adjacent Oil: Burn applications x2.",
  "eff_ja": "隣接するWeapon: 命中時に 火傷 4〜8 付与。 隣接するOil: 火傷 付与量 ×2。",
  "flavor": "A shard of Muspelheim litany.",
  "flavor_ja": "ムスペルヘイムの経文が刻まれた欠片。",
  "ports": [
   {
    "tiles": [
     [
      0,
      -1
     ],
     [
      1,
      -1
     ]
    ],
    "tag": "Weapon"
   },
   {
    "tiles": [
     [
      0,
      -1
     ],
     [
      1,
      -1
     ]
    ],
    "tag": "Oil"
   }
  ]
 },
 "oil_flask": {
  "name": "Oil Flask",
  "name_ja": "油の小瓶",
  "tags": [
   "Reagent",
   "Oil"
  ],
  "rarity": "Common",
  "shape": [
   [
    0,
    0
   ],
   [
    1,
    0
   ]
  ],
  "icon": "icon-oil_flask2",
  "sockets": [],
  "eff": "Adjacent Flame: Burn applications x2.",
  "eff_en": "Adjacent Flame: Burn applications x2.",
  "eff_ja": "隣接するFlame: 火傷 付与量 ×2。",
  "flavor": "Slow gold that loves a spark.",
  "flavor_ja": "火花を愛する、粘る黄金。",
  "ports": [
   {
    "tiles": [
     [
      0,
      1
     ],
     [
      1,
      1
     ]
    ],
    "tag": "Flame"
   }
  ]
 },
 "dagger": {
  "name": "Dagger",
  "name_ja": "ダガー",
  "tags": [
   "Weapon",
   "Metal"
  ],
  "rarity": "Common",
  "shape": [
   [
    0,
    0
   ],
   [
    1,
    0
   ]
  ],
  "icon": "icon-dagger2",
  "sockets": [
   {
    "t": "edge",
    "tags": [
     "Metal"
    ],
    "ax": 0.62,
    "ay": 0.24
   },
   {
    "t": "coat",
    "tags": [
     "Metal"
    ],
    "ax": 0.38,
    "ay": 0.52
   }
  ],
  "eff": "Every 0.9–1.2s: Strike 7–11.",
  "eff_en": "Every 0.9–1.2s: Strike 7–11.",
  "eff_ja": "0.9〜1.2秒ごとに: 7〜11 ダメージ。",
  "flavor": "Quick, honest work.",
  "flavor_ja": "速く、そして正直な仕事。"
 },
 "herb_pouch": {
  "name": "Herb Satchel",
  "name_ja": "薬草の巾着",
  "tags": [
   "Relic"
  ],
  "rarity": "Common",
  "shape": [
   [
    0,
    0
   ],
   [
    1,
    0
   ]
  ],
  "icon": "icon-herb_satchel",
  "sockets": [],
  "eff": "Every 1.8–2.2s: Heal this BP 4–8.",
  "eff_en": "Every 1.8–2.2s: Heal this BP 4–8.",
  "eff_ja": "1.8〜2.2秒ごとに: このBPを 4〜8 回復。",
  "flavor": "Smells like a meadow that survived.",
  "flavor_ja": "生き残った草原の匂いがする。"
 },
 "tower_shield": {
  "name": "Tower Shield",
  "name_ja": "タワーシールド",
  "tags": [
   "Shield",
   "Metal"
  ],
  "rarity": "Uncommon",
  "shape": [
   [
    0,
    0
   ],
   [
    0,
    1
   ],
   [
    1,
    0
   ],
   [
    1,
    1
   ]
  ],
  "icon": "icon-tower_shield",
  "sockets": [],
  "eff": "Battle start: Block 26–46.",
  "eff_en": "Battle start: Block 26–46.",
  "eff_ja": "戦闘開始時: ブロック 26〜46。",
  "flavor": "A wall that agreed to travel.",
  "flavor_ja": "旅に出ることを了承した、壁。"
 },
 "beast_jaw": {
  "name": "Beast Jaw",
  "name_ja": "獣の顎",
  "tags": [
   "Weapon",
   "Beast"
  ],
  "rarity": "Uncommon",
  "shape": [
   [
    0,
    1
   ],
   [
    1,
    0
   ],
   [
    1,
    1
   ]
  ],
  "icon": "icon-beast_jaw",
  "sockets": [
   {
    "t": "edge",
    "tags": [
     "Bone"
    ],
    "ax": 0.72,
    "ay": 0.3
   },
   {
    "t": "coat",
    "tags": [
     "Bone"
    ],
    "ax": 0.3,
    "ay": 0.72
   }
  ],
  "eff": "Every 1.4–1.7s: Strike 13–23. +4–8 damage per other Beast element in this BP.",
  "eff_en": "Every 1.4–1.7s: Strike 13–23. +4–8 damage per other Beast element in this BP.",
  "eff_ja": "1.4〜1.7秒ごとに: 13〜23 ダメージ。 このBP内の他の Beast（属性）ごとに ダメージ +4〜8。",
  "flavor": "It still remembers how to bite.",
  "flavor_ja": "噛み方を、まだ覚えている。"
 }
};
const SI_DEFS={
 "acc_gem": {
  "name": "Ruby Gem",
  "name_ja": "ルビーの宝石",
  "slot": "gem",
  "reqTags": [],
  "icon": "icon-acc_gem",
  "rarity": "Uncommon",
  "eff": "+4–8 damage to the host.",
  "eff_en": "+4–8 damage to the host.",
  "eff_ja": "装備先に ダメージ +4〜8。",
  "flavor": "Fits any gem socket.",
  "flavor_ja": "どんな宝石ソケットにも合う。"
 },
 "acc_frost": {
  "name": "Frost Orb",
  "name_ja": "フロストオーブ",
  "slot": "gem",
  "reqTags": [],
  "icon": "icon-frost_orb",
  "rarity": "Uncommon",
  "eff": "On host PO hit: Apply 4–8 Chill.",
  "eff_en": "On host PO hit: Apply 4–8 Chill.",
  "eff_ja": "装備先POが命中した時: 氷結 4〜8 付与。",
  "flavor": "Cold that keeps its promises.",
  "flavor_ja": "約束を守る、冷気。"
 },
 "acc_whet": {
  "name": "Whetstone",
  "name_ja": "砥石",
  "slot": "edge",
  "reqTags": [
   "Metal"
  ],
  "icon": "icon-whetstone",
  "rarity": "Common",
  "eff": "+4–8 damage to the host.",
  "eff_en": "+4–8 damage to the host.",
  "eff_ja": "装備先に ダメージ +4〜8。",
  "flavor": "Requires a Metal edge socket.",
  "flavor_ja": "金属の刃ソケットが必要。"
 },
 "acc_arrow": {
  "name": "Arrowhead",
  "name_ja": "鏃",
  "slot": "edge",
  "reqTags": [],
  "icon": "icon-acc_arrowhead",
  "rarity": "Common",
  "eff": "+2–4 damage to the host.",
  "eff_en": "+2–4 damage to the host.",
  "eff_ja": "装備先に ダメージ +2〜4。",
  "flavor": "Fits any edge socket.",
  "flavor_ja": "どんな刃ソケットにも合う。"
 },
 "acc_poison": {
  "name": "Poison Coat",
  "name_ja": "毒コート",
  "slot": "coat",
  "reqTags": [],
  "icon": "icon-poison_vial",
  "rarity": "Common",
  "eff": "On host PO hit: Apply 2–4 Poison.",
  "eff_en": "On host PO hit: Apply 2–4 Poison.",
  "eff_ja": "装備先POが命中した時: 毒 2〜4 付与。",
  "flavor": "Coat sockets exist only on Weapons.",
  "flavor_ja": "コートソケットは武器にしか存在しない。"
 },
 "acc_guard": {
  "name": "Guard (Tsuba)",
  "name_ja": "鍔",
  "slot": "bond",
  "reqTags": [],
  "icon": "icon-acc_guard",
  "rarity": "Uncommon",
  "eff": "On host PO hit: Block 4–8.",
  "eff_en": "On host PO hit: Block 4–8.",
  "eff_ja": "装備先POが命中した時: ブロック 4〜8。",
  "flavor": "Unseats if disassembled.",
  "flavor_ja": "分解されれば、外れ落ちる。"
 }
};
const UNITS={
 "elf": {
  "id": "elf",
  "name": "Elf",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-elf",
  "connection_shape": "bishop",
  "i18n": {
   "ja": {
    "name": "エルフ"
   }
  },
  "name_ja": "エルフ"
 },
 "dwarf": {
  "id": "dwarf",
  "name": "Dwarf",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-dwarf",
  "connection_shape": "rook",
  "i18n": {
   "ja": {
    "name": "ドワーフ"
   }
  },
  "name_ja": "ドワーフ"
 },
 "thief": {
  "id": "thief",
  "name": "Thief",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-thief",
  "connection_shape": "chess_knight_move",
  "i18n": {
   "ja": {
    "name": "シーフ"
   }
  },
  "name_ja": "シーフ"
 },
 "angel": {
  "id": "angel",
  "name": "Angel",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-angel",
  "connection_shape": "queen",
  "i18n": {
   "ja": {
    "name": "エンジェル"
   }
  },
  "name_ja": "エンジェル"
 },
 "shieldmaiden": {
  "id": "shieldmaiden",
  "name": "Shieldmaiden",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-shieldmaiden",
  "connection_shape": "backward_line",
  "i18n": {
   "ja": {
    "name": "シールドメイデン"
   }
  },
  "name_ja": "シールドメイデン"
 },
 "priest": {
  "id": "priest",
  "name": "Priest",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-priest",
  "connection_shape": "queen",
  "i18n": {
   "ja": {
    "name": "プリースト"
   }
  },
  "name_ja": "プリースト"
 },
 "littleprincess": {
  "id": "littleprincess",
  "name": "Little Princess",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-princess",
  "connection_shape": "queen",
  "i18n": {
   "ja": {
    "name": "リトルプリンセス"
   }
  },
  "name_ja": "リトルプリンセス"
 },
 "princess": {
  "id": "princess",
  "name": "Princess",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-princess",
  "connection_shape": "queen",
  "i18n": {
   "ja": {
    "name": "プリンセス"
   }
  },
  "name_ja": "プリンセス"
 },
 "lightcavalry": {
  "id": "lightcavalry",
  "name": "Light Cavalry",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-lightcavalry",
  "connection_shape": "lance",
  "i18n": {
   "ja": {
    "name": "軽騎兵"
   }
  },
  "name_ja": "軽騎兵"
 },
 "berserker": {
  "id": "berserker",
  "name": "Berserker",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-berserker",
  "connection_shape": "none",
  "i18n": {
   "ja": {
    "name": "バーサーカー"
   }
  },
  "name_ja": "バーサーカー"
 },
 "watcher": {
  "id": "watcher",
  "name": "Watcher",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-watcher",
  "connection_shape": "queen_2",
  "i18n": {
   "ja": {
    "name": "ウォッチャー"
   }
  },
  "name_ja": "ウォッチャー"
 },
 "squire": {
  "id": "squire",
  "name": "Squire",
  "rarity": "Common",
  "icon": "units-002-roster-flux2:unit-squire",
  "connection_shape": "rook_3",
  "i18n": {
   "ja": {
    "name": "スクワイア"
   }
  },
  "name_ja": "スクワイア"
 },
 "alchemist": {
  "id": "alchemist",
  "i18n": {
   "ja": {
    "name": "錬金術師"
   }
  },
  "icon": "units003_alchemist",
  "name": "Alchemist",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       2,
       3
      ],
      "t": "add_on_hit_status",
      "status": "Poison"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "s": [
     4,
     5
    ],
    "t": "every_secs"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "A splash of something that keeps bubbling.",
  "rarity": "Common",
  "flavor_ja": "ぐつぐつ、まだ何か煮えている。",
  "connection_shape": "queen_2",
  "name_ja": "錬金術師"
 },
 "bard": {
  "id": "bard",
  "i18n": {
   "ja": {
    "name": "吟遊詩人"
   }
  },
  "icon": "units003_bard",
  "name": "Bard",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       2,
       3
      ],
      "t": "haste"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "t": "on_connected_unit_attack"
   },
   "capacity": [
    3,
    4
   ]
  },
  "flavor": "Every swing keeps the beat.",
  "rarity": "Common",
  "flavor_ja": "その一振り、リズムを刻む。",
  "connection_shape": "rook_3",
  "name_ja": "吟遊詩人"
 },
 "cleric": {
  "id": "cleric",
  "i18n": {
   "ja": {
    "name": "聖職者"
   }
  },
  "icon": "units003_cleric",
  "name": "Cleric",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "t": "cleanse"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "t": "on_heal_done"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "Mercy answers mercy.",
  "rarity": "Common",
  "flavor_ja": "慈悲は慈悲を呼ぶ。",
  "connection_shape": "queen_2",
  "name_ja": "聖職者"
 },
 "darkelf": {
  "id": "darkelf",
  "i18n": {
   "ja": {
    "name": "ダークエルフ"
   }
  },
  "icon": "units003_darkelf",
  "name": "Dark Elf",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       2,
       3
      ],
      "t": "add_on_hit_status",
      "status": "Weakness"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "s": [
     3,
     4
    ],
    "t": "every_secs"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "Her gaze saps the strong.",
  "rarity": "Rare",
  "flavor_ja": "その眼差しが強者を蝕む。",
  "connection_shape": "bishop",
  "name_ja": "ダークエルフ"
 },
 "darkknight": {
  "id": "darkknight",
  "i18n": {
   "ja": {
    "name": "ダークナイト"
   }
  },
  "icon": "units003_darkknight",
  "name": "Dark Knight",
  "charge": {
   "gain": "count",
   "spend": "passive_per_stack",
   "effects": [
    {
     "verb": {
      "t": "buff_self",
      "pct": [
       0.5,
       0.8
      ]
     },
     "target": "self"
    }
   ],
   "trigger": {
    "t": "OnBPBeenHit"
   },
   "capacity": [
    12,
    18
   ]
  },
  "flavor": "Pain is fuel.",
  "rarity": "Common",
  "flavor_ja": "痛みこそ我が糧。",
  "connection_shape": "none",
  "name_ja": "ダークナイト"
 },
 "dragonknight": {
  "id": "dragonknight",
  "i18n": {
   "ja": {
    "name": "竜騎士"
   }
  },
  "icon": "units003_dragonknight",
  "name": "Dragon Knight",
  "charge": {
   "gain": "damage",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       15,
       25
      ],
      "t": "multi_strike",
      "hits": [
       3,
       4
      ]
     },
     "target": "self"
    },
    {
     "verb": {
      "n": [
       3,
       4
      ],
      "t": "add_on_hit_status",
      "status": "Burn"
     },
     "target": "self"
    }
   ],
   "trigger": {
    "t": "on_damage_dealt"
   },
   "capacity": [
    80,
    120
   ]
  },
  "flavor": "The breath that ends sieges.",
  "rarity": "Relic",
  "flavor_ja": "攻城を終わらせる吐息。",
  "connection_shape": "queen",
  "name_ja": "竜騎士"
 },
 "druid": {
  "id": "druid",
  "i18n": {
   "ja": {
    "name": "ドルイド"
   }
  },
  "icon": "units003_druid",
  "name": "Druid",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       2,
       3
      ],
      "t": "apply_status",
      "status": "Regen"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "s": [
     3,
     4
    ],
    "t": "every_secs"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "The grove tends its own.",
  "rarity": "Common",
  "flavor_ja": "森は己の者を癒す。",
  "connection_shape": "queen_2",
  "name_ja": "ドルイド"
 },
 "fairy": {
  "id": "fairy",
  "i18n": {
   "ja": {
    "name": "妖精"
   }
  },
  "icon": "units003_fairy",
  "name": "Fairy",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       3,
       5
      ],
      "t": "heal_bp"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "s": [
     2,
     3
    ],
    "t": "every_secs"
   },
   "capacity": [
    1,
    2
   ]
  },
  "flavor": "A flit, a giggle, a little mending.",
  "rarity": "Common",
  "flavor_ja": "ひらり、くすくす、ちょっとの手当て。",
  "connection_shape": "queen_2",
  "name_ja": "妖精"
 },
 "gladiator": {
  "id": "gladiator",
  "i18n": {
   "ja": {
    "name": "剣闘士"
   }
  },
  "icon": "units003_gladiator",
  "name": "Gladiator",
  "charge": {
   "gain": "count",
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
   ],
   "trigger": {
    "t": "on_connected_unit_attack"
   },
   "capacity": [
    5,
    8
   ]
  },
  "flavor": "The crowd roars; he answers.",
  "rarity": "Common",
  "flavor_ja": "歓声が上がれば、応えるまで。",
  "connection_shape": "queen_2",
  "name_ja": "剣闘士"
 },
 "hero": {
  "id": "hero",
  "i18n": {
   "ja": {
    "name": "勇者"
   }
  },
  "icon": "units003_hero",
  "name": "Hero",
  "charge": {
   "gain": "damage",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "t": "fire_items",
      "tag": "Weapon"
     },
     "target": "self"
    }
   ],
   "trigger": {
    "t": "on_damage_dealt"
   },
   "capacity": [
    40,
    60
   ]
  },
  "flavor": "One more push!",
  "rarity": "Common",
  "flavor_ja": "もう一押しだ！",
  "connection_shape": "queen",
  "name_ja": "勇者"
 },
 "icequeen": {
  "id": "icequeen",
  "i18n": {
   "ja": {
    "name": "氷の女王"
   }
  },
  "icon": "units003_icequeen",
  "name": "Ice Queen",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       3,
       4
      ],
      "t": "add_on_hit_status",
      "status": "Chill"
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
   ],
   "trigger": {
    "s": [
     3,
     4
    ],
    "t": "every_secs"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "Winter obeys only her.",
  "rarity": "Rare",
  "flavor_ja": "冬は彼女にのみ従う。",
  "connection_shape": "rook",
  "name_ja": "氷の女王"
 },
 "jester": {
  "id": "jester",
  "i18n": {
   "ja": {
    "name": "道化師"
   }
  },
  "icon": "units003_jester",
  "name": "Jester",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       1,
       2
      ],
      "t": "grant_charge"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "t": "on_connected_unit_spend"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "Round and round the mischief goes.",
  "rarity": "Uncommon",
  "flavor_ja": "悪戯はぐるぐる巡る。",
  "connection_shape": "shougi_keima_move",
  "name_ja": "道化師"
 },
 "king": {
  "id": "king",
  "i18n": {
   "ja": {
    "name": "王"
   }
  },
  "icon": "units003_king",
  "name": "King",
  "charge": {
   "gain": "count",
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
      "n": [
       1,
       1
      ],
      "t": "grant_charge"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "s": [
     4,
     6
    ],
    "t": "every_secs"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "The realm rises at his word.",
  "rarity": "Relic",
  "flavor_ja": "王の一言に国が立つ。",
  "connection_shape": "queen",
  "name_ja": "王"
 },
 "knight": {
  "id": "knight",
  "i18n": {
   "ja": {
    "name": "騎士"
   }
  },
  "icon": "units003_knight",
  "name": "Knight",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       8,
       12
      ],
      "t": "block"
     },
     "target": "self"
    }
   ],
   "trigger": {
    "t": "OnBPBeenHit"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "None pass the line.",
  "rarity": "Common",
  "flavor_ja": "この線は誰も越えさせぬ。",
  "connection_shape": "rook",
  "name_ja": "騎士"
 },
 "miko": {
  "id": "miko",
  "i18n": {
   "ja": {
    "name": "巫女"
   }
  },
  "icon": "units003_miko",
  "name": "Shrine Maiden",
  "charge": {
   "gain": "count",
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
      "n": [
       4,
       6
      ],
      "t": "heal_bp"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "s": [
     4,
     5
    ],
    "t": "every_secs"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "Purification along the sacred diagonal.",
  "rarity": "Uncommon",
  "flavor_ja": "聖なる対角に祓いを。",
  "connection_shape": "bishop",
  "name_ja": "巫女"
 },
 "monk": {
  "id": "monk",
  "i18n": {
   "ja": {
    "name": "武僧"
   }
  },
  "icon": "units003_monk",
  "name": "Monk",
  "charge": {
   "gain": "count",
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
   ],
   "trigger": {
    "t": "OnHit"
   },
   "capacity": [
    6,
    10
   ]
  },
  "flavor": "Each strike, deeper calm.",
  "rarity": "Common",
  "flavor_ja": "一打ごとに深まる静寂。",
  "connection_shape": "queen_2",
  "name_ja": "武僧"
 },
 "ninja": {
  "id": "ninja",
  "i18n": {
   "ja": {
    "name": "忍者"
   }
  },
  "icon": "units003_ninja",
  "name": "Ninja",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       15,
       25
      ],
      "t": "strike"
     },
     "target": "self"
    }
   ],
   "trigger": {
    "t": "on_connected_unit_bp_been_hit"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "Harm my ward, meet the shadow.",
  "rarity": "Uncommon",
  "flavor_ja": "我が主を害さば、影が応える。",
  "connection_shape": "lance",
  "name_ja": "忍者"
 },
 "orc": {
  "id": "orc",
  "i18n": {
   "ja": {
    "name": "オーク"
   }
  },
  "icon": "units003_orc",
  "name": "Orc",
  "charge": {
   "gain": "damage",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       2,
       3
      ],
      "t": "haste"
     },
     "target": "self"
    }
   ],
   "trigger": {
    "t": "on_damage_dealt"
   },
   "capacity": [
    40,
    60
   ]
  },
  "flavor": "Blood wakes the war-song.",
  "rarity": "Uncommon",
  "flavor_ja": "血が戦の歌を呼び覚ます。",
  "connection_shape": "rook",
  "name_ja": "オーク"
 },
 "paladin": {
  "id": "paladin",
  "i18n": {
   "ja": {
    "name": "聖騎士"
   }
  },
  "icon": "units003_paladin",
  "name": "Paladin",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       8,
       12
      ],
      "t": "grant_shield"
     },
     "target": "bp_connected_lowest_hp"
    }
   ],
   "trigger": {
    "t": "on_heal_done"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "Faith made a wall.",
  "rarity": "Rare",
  "flavor_ja": "信仰が壁となる。",
  "connection_shape": "queen_2",
  "name_ja": "聖騎士"
 },
 "pirate": {
  "id": "pirate",
  "i18n": {
   "ja": {
    "name": "海賊"
   }
  },
  "icon": "units003_pirate",
  "name": "Pirate",
  "charge": {
   "gain": "damage",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       6,
       10
      ],
      "t": "heal_bp"
     },
     "target": "self"
    }
   ],
   "trigger": {
    "t": "on_damage_dealt"
   },
   "capacity": [
    30,
    50
   ]
  },
  "flavor": "Every hit fills the coffers... and the wounds.",
  "rarity": "Common",
  "flavor_ja": "一撃ごとに財宝と傷が満ちる。",
  "connection_shape": "queen",
  "name_ja": "海賊"
 },
 "plaguedoctor": {
  "id": "plaguedoctor",
  "i18n": {
   "ja": {
    "name": "ペスト医師"
   }
  },
  "icon": "units003_plaguedoctor",
  "name": "Plague Doctor",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       1,
       2
      ],
      "t": "amp_status",
      "status": "Poison"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "t": "on_status_applied"
   },
   "capacity": [
    3,
    4
   ]
  },
  "flavor": "Let the miasma do its work.",
  "rarity": "Uncommon",
  "flavor_ja": "瘴気に仕事をさせよう。",
  "connection_shape": "queen_2",
  "name_ja": "ペスト医師"
 },
 "ranger": {
  "id": "ranger",
  "i18n": {
   "ja": {
    "name": "レンジャー"
   }
  },
  "icon": "units003_ranger",
  "name": "Ranger",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "t": "bonus_vs_status",
      "pct": [
       20,
       30
      ],
      "status": "any"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "t": "on_connected_unit_attack"
   },
   "capacity": [
    3,
    4
   ]
  },
  "flavor": "She calls the weak point.",
  "rarity": "Uncommon",
  "flavor_ja": "彼女が弱点を告げる。",
  "connection_shape": "rook_3",
  "name_ja": "レンジャー"
 },
 "samurai": {
  "id": "samurai",
  "i18n": {
   "ja": {
    "name": "侍"
   }
  },
  "icon": "units003_samurai",
  "name": "Samurai",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       6,
       10
      ],
      "t": "block"
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
   ],
   "trigger": {
    "t": "OnBPBeenHit"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "Strike him, and the blade answers itself.",
  "rarity": "Rare",
  "flavor_ja": "斬れば、刃が自ら返す。",
  "connection_shape": "rook",
  "name_ja": "侍"
 },
 "shaman": {
  "id": "shaman",
  "i18n": {
   "ja": {
    "name": "シャーマン"
   }
  },
  "icon": "units003_shaman",
  "name": "Shaman",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       1,
       2
      ],
      "t": "grant_charge"
     },
     "target": "units_connected"
    },
    {
     "verb": {
      "n": [
       1,
       2
      ],
      "t": "apply_status",
      "status": "Regen"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "s": [
     4,
     5
    ],
    "t": "every_secs"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "The ancestors lend their breath.",
  "rarity": "Uncommon",
  "flavor_ja": "祖霊が息吹を貸す。",
  "connection_shape": "queen_2",
  "name_ja": "シャーマン"
 },
 "sorceress": {
  "id": "sorceress",
  "i18n": {
   "ja": {
    "name": "炎術師"
   }
  },
  "icon": "units003_sorceress",
  "name": "Sorceress",
  "charge": {
   "gain": "damage",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       18,
       28
      ],
      "t": "multi_strike",
      "hits": [
       2,
       3
      ]
     },
     "target": "self"
    },
    {
     "verb": {
      "n": [
       3,
       4
      ],
      "t": "add_on_hit_status",
      "status": "Burn"
     },
     "target": "self"
    }
   ],
   "trigger": {
    "t": "on_damage_dealt"
   },
   "capacity": [
    60,
    90
   ]
  },
  "flavor": "Embers become an inferno.",
  "rarity": "Rare",
  "flavor_ja": "残り火が業火となる。",
  "connection_shape": "queen",
  "name_ja": "炎術師"
 },
 "valkyrie": {
  "id": "valkyrie",
  "i18n": {
   "ja": {
    "name": "ヴァルキュリア"
   }
  },
  "icon": "units003_valkyrie",
  "name": "Valkyrie",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       10,
       15
      ],
      "t": "grant_shield"
     },
     "target": "bp_connected"
    },
    {
     "verb": {
      "n": [
       5,
       8
      ],
      "t": "heal_bp"
     },
     "target": "bp_connected"
    }
   ],
   "trigger": {
    "t": "on_connected_unit_bp_been_hit"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "She lifts the fallen mid-battle.",
  "rarity": "Rare",
  "flavor_ja": "戦場のただ中で倒れし者を掬い上げる。",
  "connection_shape": "chess_knight_move",
  "name_ja": "ヴァルキュリア"
 },
 "vampire": {
  "id": "vampire",
  "i18n": {
   "ja": {
    "name": "吸血鬼"
   }
  },
  "icon": "units003_vampire",
  "name": "Vampire Lord",
  "charge": {
   "gain": "count",
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
   ],
   "trigger": {
    "t": "on_connected_unit_attack"
   },
   "capacity": [
    3,
    4
   ]
  },
  "flavor": "The court drinks deep at his command.",
  "rarity": "Relic",
  "flavor_ja": "宮廷は主の命で深く飲む。",
  "connection_shape": "chess_knight_move",
  "name_ja": "吸血鬼"
 },
 "werewolf": {
  "id": "werewolf",
  "i18n": {
   "ja": {
    "name": "人狼"
   }
  },
  "icon": "units003_werewolf",
  "name": "Werewolf",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       2,
       3
      ],
      "t": "haste"
     },
     "target": "self"
    },
    {
     "verb": {
      "t": "buff_self",
      "pct": [
       2,
       3
      ]
     },
     "target": "self"
    }
   ],
   "trigger": {
    "t": "on_kill"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "The kill only sharpens the hunger.",
  "rarity": "Uncommon",
  "flavor_ja": "殺しは飢えを研ぎ澄ますだけ。",
  "connection_shape": "chess_knight_move",
  "name_ja": "人狼"
 },
 "witch": {
  "id": "witch",
  "i18n": {
   "ja": {
    "name": "魔女"
   }
  },
  "icon": "units003_witch",
  "name": "Witch",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       2,
       3
      ],
      "t": "add_on_hit_status",
      "status": "Burn"
     },
     "target": "units_connected"
    }
   ],
   "trigger": {
    "s": [
     3,
     4
    ],
    "t": "every_secs"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "A hex stitched into every strike.",
  "rarity": "Uncommon",
  "flavor_ja": "一撃ごとに呪いを縫い込む。",
  "connection_shape": "bishop",
  "name_ja": "魔女"
 },
 "wizard": {
  "id": "wizard",
  "i18n": {
   "ja": {
    "name": "魔法使い"
   }
  },
  "icon": "units003_wizard",
  "name": "Wizard",
  "charge": {
   "gain": "count",
   "spend": "fire_on_full",
   "effects": [
    {
     "verb": {
      "n": [
       2,
       3
      ],
      "t": "advance_cooldown"
     },
     "target": "bp_connected_max_cooldown_item"
    }
   ],
   "trigger": {
    "s": [
     4,
     5
    ],
    "t": "every_secs"
   },
   "capacity": [
    2,
    3
   ]
  },
  "flavor": "Time bends around the old man's staff.",
  "rarity": "Rare",
  "flavor_ja": "老翁の杖の周りで時が歪む。",
  "connection_shape": "bishop",
  "name_ja": "魔法使い"
 }
};
const CONN_SHAPES={
 "queen": {
  "ja": "クイーン",
  "kind": "ray",
  "dirs": [
   0,
   1,
   2,
   3,
   4,
   5,
   6,
   7
  ],
  "range": null,
  "pierce": false,
  "note": "8-direction rays, unlimited. The pre-pivot Linker default."
 },
 "queen_2": {
  "ja": "クイーン(射程2)",
  "kind": "ray",
  "dirs": [
   0,
   1,
   2,
   3,
   4,
   5,
   6,
   7
  ],
  "range": 2,
  "pierce": false,
  "note": "8-direction rays, range 2. REQ-0149 Watcher (user ruling 2026-07-13: range 1 made connection nearly impossible)."
 },
 "rook": {
  "ja": "飛車",
  "kind": "ray",
  "dirs": [
   0,
   2,
   4,
   6
  ],
  "range": null,
  "pierce": false,
  "note": "Orthogonal rays, unlimited."
 },
 "rook_3": {
  "ja": "飛車(射程3)",
  "kind": "ray",
  "dirs": [
   0,
   2,
   4,
   6
  ],
  "range": 3,
  "pierce": false,
  "note": "Orthogonal rays, range 3. REQ-0149 Squire (user ruling 2026-07-13)."
 },
 "bishop": {
  "ja": "角",
  "kind": "ray",
  "dirs": [
   1,
   3,
   5,
   7
  ],
  "range": null,
  "pierce": false,
  "note": "Diagonal rays, unlimited."
 },
 "lance": {
  "ja": "香",
  "kind": "ray",
  "dirs": [
   0
  ],
  "range": null,
  "pierce": false,
  "note": "Forward ray, unlimited. forward = DIRS[0] = N (orientation ruling)."
 },
 "backward_line": {
  "ja": "後方直線",
  "kind": "ray",
  "dirs": [
   4
  ],
  "range": null,
  "pierce": false,
  "note": "Backward ray, unlimited. REQ-0149 Shieldmaiden — she is the front line and guards what stands behind her. The mirror of lance (Light Cavalry)."
 },
 "adjacency": {
  "ja": "隣接",
  "kind": "ray",
  "dirs": [
   0,
   2,
   4,
   6
  ],
  "range": 1,
  "pierce": false,
  "note": "Rook ray with range 1. Part of the user's ORIGINAL ratified vocabulary (2026-07-12), but NO roster-001 unit uses it — kept because the user ratified it, not because a def needs it."
 },
 "none": {
  "ja": "接続なし",
  "kind": "none",
  "dirs": [],
  "range": 0,
  "pierce": false,
  "note": "Unit forms no links."
 },
 "chess_knight_move": {
  "ja": "チェス・ナイトの動き",
  "kind": "offset",
  "offsets": [
   [
    -2,
    -1
   ],
   [
    -2,
    1
   ],
   [
    -1,
    -2
   ],
   [
    -1,
    2
   ],
   [
    1,
    -2
   ],
   [
    1,
    2
   ],
   [
    2,
    -1
   ],
   [
    2,
    1
   ]
  ],
  "range": null,
  "pierce": null,
  "note": "Chess knight: 8 fixed offsets, jumps. `range` and `pierce` are INVALID on offset shapes (user ruling 2026-07-14). Renamed from `knight` on 2026-07-14: the id named a PIECE and the ja label said 桂, but the offsets were the chess set. Keima and knight are different MOVEMENTS and now carry different ids. These are movement names; they have nothing to do with unit names."
 },
 "shougi_keima_move": {
  "ja": "将棋・桂馬の動き",
  "kind": "offset",
  "offsets": [
   [
    -2,
    -1
   ],
   [
    -2,
    1
   ]
  ],
  "range": null,
  "pierce": null,
  "note": "Shougi keima: 2 fixed FORWARD offsets, jumps. forward = row-1 = N per the orientation ruling. RESERVED by user ruling 2026-07-14 -- registered as vocabulary; no roster-001 unit uses it and the engine may leave it unimplemented. `range` and `pierce` are INVALID on offset shapes."
 }
};
const SCENARIO={
 "linked": true,
 "bps": [
  {
   "id": "alpha",
   "name": "BP Alpha",
   "color": "#BF9000",
   "shape": [
    [
     0,
     0
    ],
    [
     0,
     1
    ],
    [
     1,
     0
    ],
    [
     1,
     1
    ],
    [
     2,
     0
    ],
    [
     2,
     1
    ]
   ],
   "origin": [
    1,
    1
   ],
   "hpMax": 90,
   "unit": {
    "id": "dwarf",
    "off": [
     2,
     1
    ]
   }
  },
  {
   "id": "beta",
   "name": "BP Beta",
   "color": "#F1C232",
   "shape": [
    [
     0,
     0
    ],
    [
     0,
     1
    ],
    [
     0,
     2
    ],
    [
     1,
     0
    ],
    [
     1,
     1
    ],
    [
     1,
     2
    ]
   ],
   "origin": [
    1,
    4
   ],
   "hpMax": 90,
   "unit": {
    "id": "elf",
    "off": [
     0,
     0
    ]
   }
  },
  {
   "id": "gamma",
   "name": "BP Gamma",
   "color": "#E8DE33",
   "shape": [
    [
     0,
     0
    ],
    [
     0,
     1
    ],
    [
     1,
     0
    ],
    [
     1,
     1
    ],
    [
     2,
     0
    ],
    [
     2,
     1
    ]
   ],
   "origin": [
    4,
    2
   ],
   "hpMax": 90,
   "unit": {
    "id": "angel",
    "off": [
     0,
     0
    ]
   }
  },
  {
   "id": "delta",
   "name": "BP Delta",
   "color": "#9A5B18",
   "shape": [
    [
     0,
     0
    ],
    [
     0,
     1
    ],
    [
     1,
     0
    ],
    [
     1,
     1
    ]
   ],
   "origin": [
    4,
    5
   ],
   "hpMax": 60,
   "unit": {
    "id": "lightcavalry",
    "off": [
     0,
     0
    ]
   }
  }
 ],
 "pos": [
  {
   "uid": "p1",
   "id": "blade",
   "loc": "grid",
   "cell": [
    1,
    1
   ],
   "rot": 0
  },
  {
   "uid": "p2",
   "id": "hilt",
   "loc": "grid",
   "cell": [
    3,
    1
   ],
   "rot": 0
  },
  {
   "uid": "p3",
   "id": "flame_tablet",
   "loc": "grid",
   "cell": [
    1,
    2
   ],
   "rot": 0
  },
  {
   "uid": "p4",
   "id": "tower_shield",
   "loc": "grid",
   "cell": [
    1,
    5
   ],
   "rot": 0
  },
  {
   "uid": "p5",
   "id": "dagger",
   "loc": "grid",
   "cell": [
    4,
    3
   ],
   "rot": 0
  },
  {
   "uid": "p6",
   "id": "herb_pouch",
   "loc": "grid",
   "cell": [
    5,
    2
   ],
   "rot": 0
  },
  {
   "uid": "p7",
   "id": "beast_jaw",
   "loc": "grid",
   "cell": [
    4,
    5
   ],
   "rot": 0
  },
  {
   "uid": "p8",
   "id": "oil_flask",
   "loc": "inv",
   "cell": null,
   "rot": 0
  }
 ],
 "sis": [
  {
   "uid": "a1",
   "id": "acc_gem",
   "host": {
    "po": "p2",
    "si": 0
   }
  },
  {
   "uid": "a2",
   "id": "acc_guard",
   "host": "bond"
  },
  {
   "uid": "a3",
   "id": "acc_whet",
   "host": "inv"
  },
  {
   "uid": "a4",
   "id": "acc_arrow",
   "host": "inv"
  },
  {
   "uid": "a5",
   "id": "acc_poison",
   "host": "inv"
  },
  {
   "uid": "a6",
   "id": "acc_frost",
   "host": "inv"
  }
 ]
};
function makeState(){
 const st=JSON.parse(JSON.stringify(SCENARIO));
 st.inv=makeEmptyInventory();
 st.presets=makeSquadsMeta();
 return st;
}
return {LAYOUT,ITEMS,SI_DEFS,TREES,UNITS,CONN_SHAPES,makeState};
});
