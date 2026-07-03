#!/usr/bin/env node
// tool_gen_data.cjs — generates data.js (GameData UMD module) from live JSON + scenario.json.
// Usage: node tool_gen_data.cjs <vocab> <items> <sis> <scenario.json> <out data.js>
//
// v7 changes (REQ-0030 Phase 1, inventory model):
//   - makeState() now ALSO returns an `inv` field: {pages:[5 x {bps:[],pos:[],
//     sis:[]}]} -- 5 independent, initially-EMPTY inventory pages (same grid
//     dimensions as canvas, per REQ-0030 orchestrator default). This is
//     purely additive: legacy consumers reading only linked/bps/pos/sis off
//     the returned state are unaffected; engine.js's canvas code paths never
//     look at st.inv. Migrating an OLDER saved state (no `inv` field, and/or
//     legacy loc:'inv'/host:'inv' list-inventory entries) is handled by
//     Engine.create(...).migrateState(oldState), not here -- this generator
//     only controls the FRESH/default scenario shape.
//
// v6 changes (REQ-0023 follow-up, WeaponPart<Weapon hierarchy edge):
//   - vocabPath is now actually loaded (previously destructured but unused)
//     and its po_tags/socket_tags parent-maps are passed through into data.js
//     as TREES = {po, socket}, so Engine.create() call sites (mock-src/ui.js,
//     mock-src/tests/run.cjs) can wire the REAL content/vocab.json hierarchy
//     into the engine instead of implicitly defaulting to degenerate {} trees.
//
// v5 changes (REQ-0023):
//   - ITEMS/SI_DEFS entries now carry "ports" (array of {tiles,tag}) instead of
//     the old flat "conn" (array of [x,y] tiles, no tag). Content JSON was
//     migrated by tools/migrate_connection_ports.cjs; this generator just passes
//     e.ports through unchanged (was e.conn previously).
//
// v4 changes (REQ-0022 batch 3/4):
//   - ITEMS entries now carry "tags" (ordered array, tags[0]=former type,
//     tags[1..]=former elements in original order) instead of separate
//     "type"/"el" fields. Content JSON (live_items.json / draft.json) was
//     migrated by tools/migrate_tag_hierarchy.cjs; this generator just passes
//     e.tags through unchanged.
//
// v3 changes:
//   - ITEMS/SI_DEFS entries now also carry: name_ja, eff_en, eff_ja (rendered via
//     eff_render.cjs render(effect,locale), all effects joined with ' '), flavor,
//     flavor_ja, and "ports" (passed through for POs, when present; REQ-0023 conn->ports).
//   - Legacy "eff" field is kept = eff_en, for backward compat with existing UI code.
'use strict';
const fs = require('fs');
const path = require('path');
const { render } = require('./eff_render.cjs');

function loadJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

// Joins all effect renderings (in the given locale) with a single space.
function renderEffJoined(effects, locale) {
  return (effects || []).map(function (e) { return render(e, locale); }).join(' ');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 5) {
    console.error('Usage: node tool_gen_data.cjs <vocab> <items> <sis> <scenario.json> <out data.js>');
    process.exit(1);
  }
  const [vocabPath, itemsPath, sisPath, scenarioPath, outPath] = args;
  const vocab = loadJSON(vocabPath);
  const items = loadJSON(itemsPath);
  const sis = loadJSON(sisPath);
  const scenario = loadJSON(scenarioPath);

  const itemEntries = items.entries || [];
  const siEntries = sis.entries || [];

  if (!scenario.layout || !Number.isInteger(scenario.layout.ROWS) || !Number.isInteger(scenario.layout.COLS)) {
    console.error('scenario.json missing layout.{ROWS,COLS}');
    process.exit(1);
  }
  const LAYOUT = { ROWS: scenario.layout.ROWS, COLS: scenario.layout.COLS };

  // Build ITEMS map
  const ITEMS = {};
  for (const e of itemEntries) {
    const eff_en = renderEffJoined(e.effects, 'en');
    const eff_ja = renderEffJoined(e.effects, 'ja');
    const rec = {
      name: e.name,
      name_ja: e.name_ja,
      // tags[0] is always the former type-tag; remaining entries are former
      // elements -- see REQ-0022 batch 3/4. Passed through as-is from the
      // migrated content JSON (content already stores tags, not type/el).
      tags: e.tags,
      rarity: e.rarity,
      shape: e.shape,
      icon: e.icon,
      sockets: e.sockets || [],
      eff: eff_en, // legacy field, kept = eff_en for backward compat
      eff_en,
      eff_ja,
      flavor: e.flavor,
      flavor_ja: e.flavor_ja,
    };
    if (e.stretch) rec.stretch = e.stretch;
    if (e.ports !== undefined) rec.ports = e.ports;
    ITEMS[e.id] = rec;
  }

  // Build SI_DEFS map
  const SI_DEFS = {};
  for (const e of siEntries) {
    const eff_en = renderEffJoined(e.effects, 'en');
    const eff_ja = renderEffJoined(e.effects, 'ja');
    SI_DEFS[e.id] = {
      name: e.name,
      name_ja: e.name_ja,
      slot: e.slot,
      reqTags: e.reqTags || [],
      icon: e.icon,
      rarity: e.rarity,
      eff: eff_en, // legacy field, kept = eff_en for backward compat
      eff_en,
      eff_ja,
      flavor: e.flavor,
      flavor_ja: e.flavor_ja,
    };
    if (e.ports !== undefined) SI_DEFS[e.id].ports = e.ports;
  }

  // makeState payload = deep copy of scenario minus "layout"
  const scenarioForState = JSON.parse(JSON.stringify(scenario));
  delete scenarioForState.layout;

  const banner = '// backpack_ragnarok — GENERATED data.js (do not hand-edit; regenerate via tool_gen_data.cjs v7)\n' +
    '// Source: ' + path.basename(itemsPath) + ' + ' + path.basename(sisPath) + ' + ' + path.basename(scenarioPath) + '\n' +
    '// Generated: ' + new Date().toISOString() + '\n';

  const src = banner +
    "(function(root,factory){\n" +
    "  if(typeof module!=='undefined'&&module.exports)module.exports=factory();\n" +
    "  else root.GameData=factory();\n" +
    "})(typeof self!=='undefined'?self:globalThis,function(){\n" +
    "'use strict';\n" +
    "function makeEmptyInventory(){\n" + // REQ-0030 Phase 1: 5 independent empty pages,
    "  const pages=[];\n" +               // same grid dims as canvas (page-local [row,col]).
    "  for(let i=0;i<5;i++)pages.push({bps:[],pos:[],sis:[]});\n" +
    "  return {pages,names:['1','2','3','4','5']};\n" + // REQ-0031 Phase B: default page display names
    "}\n" +
    // REQ-0031 Phase B: 5 presets, slot 0 (active) carries the scenario's
    // actual content (supplied by makeState() below, matching how
    // engine.js's own makePresetsMeta()/switchPreset() treat the active
    // slot -- store[0] stays null since preset 0's content lives at the
    // top-level st.{linked,bps,pos,sis} fields, never duplicated into
    // store), presets 1-4 start EMPTY (no BPs -- "new presets start
    // empty", REQ-0031 preset model decision).
    "function makeEmptyPresetSlot(){\n" +
    "  return {linked:true,bps:[],pos:[],sis:[]};\n" +
    "}\n" +
    "function makePresetsMeta(){\n" +
    "  return {active:0,names:['Preset 1','Preset 2','Preset 3','Preset 4','Preset 5'],\n" +
    "    store:[null,makeEmptyPresetSlot(),makeEmptyPresetSlot(),makeEmptyPresetSlot(),makeEmptyPresetSlot()]};\n" +
    "}\n" +
    "const LAYOUT=" + JSON.stringify(LAYOUT) + ";\n" +
    "const TREES=" + JSON.stringify({po: vocab.po_tags || {}, socket: vocab.socket_tags || {}}, null, 1) + ";\n" +
    "const ITEMS=" + JSON.stringify(ITEMS, null, 1) + ";\n" +
    "const SI_DEFS=" + JSON.stringify(SI_DEFS, null, 1) + ";\n" +
    "const SCENARIO=" + JSON.stringify(scenarioForState, null, 1) + ";\n" +
    "function makeState(){\n" +
    " const st=JSON.parse(JSON.stringify(SCENARIO));\n" +
    " st.inv=makeEmptyInventory();\n" + // REQ-0030 Phase 1: 5 empty pages, see banner note above
    " st.presets=makePresetsMeta();\n" + // REQ-0031 Phase B: 5 presets, slot 0 = this scenario's content (implicit -- see makePresetsMeta note above)
    " return st;\n" +
    "}\n" +
    "return {LAYOUT,ITEMS,SI_DEFS,TREES,makeState};\n" +
    "});\n";

  fs.writeFileSync(outPath, src);
  console.log('Wrote ' + outPath + ' — ' + Object.keys(ITEMS).length + ' items, ' + Object.keys(SI_DEFS).length + ' sis, LAYOUT=' + JSON.stringify(LAYOUT));
}

main();
