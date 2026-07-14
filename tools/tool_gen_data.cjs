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

// REQ-0038: content entries now carry a formal i18n.ja.{name,flavor} map
// instead of flat name_ja/flavor_ja fields (see tools/migrate_i18n.cjs).
// This baked-data.js generator still emits FLAT name_ja/flavor_ja fields
// on ITEMS/SI_DEFS records (mock-src/ui.js's gameDataFromApiContent() and
// client/src/api.ts both read that flat shape) -- jaName()/jaFlavor()
// read the new i18n map first, falling back to a legacy _ja field only
// for defensiveness against a not-yet-migrated fixture/content file.
function jaName(e) {
  return (e.i18n && e.i18n.ja && e.i18n.ja.name !== undefined) ? e.i18n.ja.name : e.name_ja;
}
function jaFlavor(e) {
  return (e.i18n && e.i18n.ja && e.i18n.ja.flavor !== undefined) ? e.i18n.ja.flavor : e.flavor_ja;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 5) {
    console.error('Usage: node tool_gen_data.cjs <vocab> <items> <sis> <scenario.json> <out data.js> [units.json]');
    process.exit(1);
  }
  const [vocabPath, itemsPath, sisPath, scenarioPath, outPath, unitsPath] = args;
  const vocab = loadJSON(vocabPath);
  const items = loadJSON(itemsPath);
  const sis = loadJSON(sisPath);
  const scenario = loadJSON(scenarioPath);
  // REQ-0170: the Unit registries get baked in alongside ITEMS/SI_DEFS, because the
  // mock and the sim resolve a BP's rays through them exactly as the live client
  // does. `units.json` is optional so a caller that predates this REQ still works
  // (it then bakes UNITS={} -- an honest "this build knows no units", not a crash).
  const units = unitsPath ? loadJSON(unitsPath) : { entries: [] };

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
      name_ja: jaName(e),
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
      flavor_ja: jaFlavor(e),
    };
    if (e.stretch) rec.stretch = e.stretch;
    if (e.ports !== undefined) rec.ports = e.ports;
    ITEMS[e.id] = rec;
  }

  // REQ-0170: UNITS -- the unit/1 defs, keyed by id. Baked whole (a unit def is
  // small and carries no effects AST to render), so the mock's engine resolves the
  // same connection shapes the server's does.
  const UNITS = {};
  for (const e of (units.entries || [])) {
    UNITS[e.id] = Object.assign({}, e, { name_ja: jaName(e), flavor_ja: jaFlavor(e) });
  }
  const CONN_SHAPES = vocab.connection_shapes || {};

  // Build SI_DEFS map
  const SI_DEFS = {};
  for (const e of siEntries) {
    const eff_en = renderEffJoined(e.effects, 'en');
    const eff_ja = renderEffJoined(e.effects, 'ja');
    SI_DEFS[e.id] = {
      name: e.name,
      name_ja: jaName(e),
      slot: e.slot,
      reqTags: e.reqTags || [],
      icon: e.icon,
      rarity: e.rarity,
      eff: eff_en, // legacy field, kept = eff_en for backward compat
      eff_en,
      eff_ja,
      flavor: e.flavor,
      flavor_ja: jaFlavor(e),
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
    "  for(let i=0;i<5;i++)pages.push({bps:[],pos:[],sis:[],tms:[]});\n" +
    "  return {pages,names:['1','2','3','4','5']};\n" + // REQ-0031 Phase B: default page display names
    "}\n" +
    // REQ-0031 Phase B: 5 squads, slot 0 (active) carries the scenario's
    // actual content (supplied by makeState() below, matching how
    // engine.js's own makeSquadsMeta()/switchSquad() treat the active
    // slot -- store[0] stays null since squad 0's content lives at the
    // top-level st.{linked,bps,pos,sis} fields, never duplicated into
    // store), squads 1-4 start EMPTY (no BPs -- "new squads start
    // empty", REQ-0031 squad model decision).
    "function makeEmptySquadSlot(){\n" +
    "  return {linked:true,bps:[],pos:[],sis:[]};\n" +
    "}\n" +
    "function makeSquadsMeta(){\n" +
    "  return {active:0,names:['Squad 1','Squad 2','Squad 3','Squad 4','Squad 5'],\n" +
    "    store:[null,makeEmptySquadSlot(),makeEmptySquadSlot(),makeEmptySquadSlot(),makeEmptySquadSlot()]};\n" +
    "}\n" +
    "const LAYOUT=" + JSON.stringify(LAYOUT) + ";\n" +
    "const TREES=" + JSON.stringify({po: vocab.po_tags || {}, socket: vocab.socket_tags || {}}, null, 1) + ";\n" +
    "const ITEMS=" + JSON.stringify(ITEMS, null, 1) + ";\n" +
    "const SI_DEFS=" + JSON.stringify(SI_DEFS, null, 1) + ";\n" +
    "const UNITS=" + JSON.stringify(UNITS, null, 1) + ";\n" +
    "const CONN_SHAPES=" + JSON.stringify(CONN_SHAPES, null, 1) + ";\n" +
    "const SCENARIO=" + JSON.stringify(scenarioForState, null, 1) + ";\n" +
    "function makeState(){\n" +
    " const st=JSON.parse(JSON.stringify(SCENARIO));\n" +
    " st.inv=makeEmptyInventory();\n" + // REQ-0030 Phase 1: 5 empty pages, see banner note above
    " st.presets=makeSquadsMeta();\n" + // REQ-0031 Phase B: 5 squads, slot 0 = this scenario's content (implicit -- see makeSquadsMeta note above)
    " return st;\n" +
    "}\n" +
    "return {LAYOUT,ITEMS,SI_DEFS,TREES,UNITS,CONN_SHAPES,makeState};\n" +
    "});\n";

  fs.writeFileSync(outPath, src);
  console.log('Wrote ' + outPath + ' — ' + Object.keys(ITEMS).length + ' items, ' + Object.keys(SI_DEFS).length + ' sis, ' + Object.keys(UNITS).length + ' units, LAYOUT=' + JSON.stringify(LAYOUT));
}

main();
