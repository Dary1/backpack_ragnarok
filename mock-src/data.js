// backpack_ragnarok — GENERATED data.js (do not hand-edit; regenerate via tool_gen_data.cjs v7)
// Source: live_items.json + live_sis.json + scenario.json
// Generated: 2026-07-14T01:38:53.227Z
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
