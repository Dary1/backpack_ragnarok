// backpack_ragnarok — GENERATED data.js (do not hand-edit; regenerate via tool_gen_data.cjs v3)
// Source: live_items.json + live_sis.json + scenario.json
// Generated: 2026-07-03T10:47:10.977Z
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory();
  else root.GameData=factory();
})(typeof self!=='undefined'?self:globalThis,function(){
'use strict';
const LAYOUT={"ROWS":6,"COLS":6};
const ITEMS={
 "blade": {
  "name": "Longsword Blade",
  "name_ja": "ロングソードの刀身",
  "type": "WeaponPart",
  "el": [
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
  "type": "WeaponPart",
  "el": [
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
  "type": "Rune",
  "el": [
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
  "conn": [
   [
    0,
    -1
   ],
   [
    1,
    -1
   ]
  ]
 },
 "oil_flask": {
  "name": "Oil Flask",
  "name_ja": "油の小瓶",
  "type": "Reagent",
  "el": [
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
  "conn": [
   [
    0,
    1
   ],
   [
    1,
    1
   ]
  ]
 },
 "dagger": {
  "name": "Dagger",
  "name_ja": "ダガー",
  "type": "Weapon",
  "el": [
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
  "type": "Relic",
  "el": [],
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
  "type": "Shield",
  "el": [
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
  "type": "Weapon",
  "el": [
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
  "eff": "On host hit: Apply 4–8 Chill.",
  "eff_en": "On host hit: Apply 4–8 Chill.",
  "eff_ja": "装備先が命中した時: 氷結 4〜8 付与。",
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
  "eff": "On host hit: Apply 2–4 Poison.",
  "eff_en": "On host hit: Apply 2–4 Poison.",
  "eff_ja": "装備先が命中した時: 毒 2〜4 付与。",
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
  "eff": "On host hit: Block 4–8.",
  "eff_en": "On host hit: Block 4–8.",
  "eff_ja": "装備先が命中した時: ブロック 4〜8。",
  "flavor": "Unseats if disassembled.",
  "flavor_ja": "分解されれば、外れ落ちる。"
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
   "linker": {
    "off": [
     2,
     1
    ],
    "dirs": [
     1,
     4
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
   "linker": {
    "off": [
     0,
     0
    ],
    "dirs": [
     5
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
   "linker": {
    "off": [
     0,
     0
    ],
    "dirs": [
     2,
     3
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
   "linker": {
    "off": [
     0,
     0
    ],
    "dirs": [
     6
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
 return JSON.parse(JSON.stringify(SCENARIO));
}
return {LAYOUT,ITEMS,SI_DEFS,makeState};
});
