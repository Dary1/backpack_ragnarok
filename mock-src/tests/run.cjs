// backpack_ragnarok mock v0.5 — operation-emulation test suite (node)
// Primary test gate per user directive: emulate operations against the pure engine.
'use strict';
const Engine=require('./engine.js');
const Data=require('./data.js');
let pass=0,fail=0;
function T(name,fn){
  try{fn();console.log('PASS  '+name);pass++;}
  catch(e){console.log('FAIL  '+name+' — '+e.message);fail++;}
}
function eq(a,b,msg){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||'')+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function ok(v,msg){if(!v)throw new Error(msg||'expected truthy');}
function fresh(){const st=Data.makeState();return {st,E:Engine.create(Data.ITEMS,Data.SI_DEFS,Data.LAYOUT,Data.TREES)};}

T('initial state integrity: no overlaps, all POs legally placed',()=>{
  const {st,E}=fresh();
  for(const p of st.pos.filter(p=>p.loc==='grid')){
    const chk=E.canPlacePO(st,p.uid,p.rot,p.cell);
    ok(chk.ok,p.id+' illegal: '+chk.why);
  }
  ok(E.assembly(st),'longsword should be assembled initially');
});

T('socket/tag matrix: whetstone rejected by Bone edge (jaw), accepted by Metal edge (dagger)',()=>{
  const {st,E}=fresh();
  const jawEdge=E.sockets(st).find(s=>s.host==='p7'&&s.t==='edge');
  const dagEdge=E.sockets(st).find(s=>s.host==='p5'&&s.t==='edge');
  const r1=E.seatSI(st,'a3',jawEdge.skey);
  ok(!r1.ok&&r1.why.includes('lacks tag Metal'),'jaw should reject whetstone: '+r1.why);
  ok(E.seatSI(st,'a3',dagEdge.skey).ok,'dagger should accept whetstone');
});

T('socket/tag matrix: arrowhead (no req) fits Bone edge; poison fits Bone coat; type mismatch rejected',()=>{
  const {st,E}=fresh();
  const jawEdge=E.sockets(st).find(s=>s.host==='p7'&&s.t==='edge');
  const jawCoat=E.sockets(st).find(s=>s.host==='p7'&&s.t==='coat');
  ok(E.seatSI(st,'a4',jawEdge.skey).ok,'arrowhead should fit jaw edge');
  ok(E.seatSI(st,'a5',jawCoat.skey).ok,'poison should fit jaw coat');
  const r=E.seatSI(st,'a1',E.sockets(st).find(s=>s.host==='p5'&&s.t==='edge').skey);
  ok(!r.ok&&r.why.includes('socket type'),'gem into edge must fail on TYPE');
});

T('gem socket occupancy: frost rejected while ruby seated; accepted after stow; self-reseat allowed',()=>{
  const {st,E}=fresh();
  const pommel=()=>E.sockets(st).find(s=>s.host==='p2'&&s.t==='gem');
  const r1=E.seatSI(st,'a6',pommel().skey);
  ok(!r1.ok&&r1.why==='socket occupied','frost must be blocked by ruby');
  ok(E.seatSI(st,'a1',pommel().skey).ok,'ruby re-seating onto its own socket must be OK (self-occupancy fix)');
  E.stowSI(st,'a1');
  ok(E.seatSI(st,'a6',pommel().skey).ok,'frost fits after ruby stowed');
});

T('guard lifecycle: stow → reseat → auto-unseat on disassembly (regression for invisible-guard bug)',()=>{
  const {st,E}=fresh();
  E.stowSI(st,'a2');
  eq(st.sis.find(a=>a.id==='acc_guard').host,'inv','guard stowed');
  ok(E.seatSI(st,'a2','bond').ok,'guard reseats on bond');
  st.linked=false;
  ok(E.movePO(st,'p2','inv').ok,'hilt stowed (unlinked)');
  E.unseatOrphans(st);
  eq(st.sis.find(a=>a.id==='acc_guard').host,'inv','guard auto-unseated when bond broke');
});

T('rotation: inventory rotate free; blocked in-place rotate fails with reason',()=>{
  const {st,E}=fresh();
  ok(E.rotatePO(st,'p8').ok,'inv rotate');
  eq(st.pos.find(p=>p.uid==='p8').rot,1);
  const r=E.rotatePO(st,'p5'); // dagger vertical at [4,3]; horizontal needs dead (4,4)
  ok(!r.ok&&r.why==='Dead Space','dagger in-place rotate should fail on Dead Space, got: '+(r.why||'ok'));
});

T('PO moves: stow herb, place oil; spanning/linker/dead rejections',()=>{
  const {st,E}=fresh();
  ok(E.movePO(st,'p6','inv').ok);
  ok(E.movePO(st,'p8',[5,2]).ok,'oil into gamma');
  // bring delta beside gamma so a horizontal 1x2 can attempt to span two BPs
  ok(E.moveBP(st,'delta',[4,4]).ok,'delta next to gamma');
  ok(E.movePO(st,'p5','inv').ok,'stow dagger (frees (5,3))');
  ok(E.rotatePO(st,'p8').ok,'oil rotates in place to horizontal (cells freed by dagger stow)');
  ok(E.movePO(st,'p7','inv').ok,'stow jaw (frees delta cells)');
  const spans=E.movePO(st,'p8',[5,3]); // cells (5,4) delta + (5,3) gamma
  ok(!spans.ok&&spans.why==='spans two BPs','span reject: '+spans.why);
  const onLinker=E.movePO(st,'p8',[4,2]);
  ok(!onLinker.ok,'linker cell reject');
  const dead=E.movePO(st,'p8',[3,4]);
  ok(!dead.ok&&dead.why==='Dead Space','dead space reject: '+dead.why);
});

T('linked assembly moves as one (guard stays); unlinked moves blade alone (hilt stays visible/placed)',()=>{
  const {st,E}=fresh();
  ok(E.movePO(st,'p5','inv').ok,'stow dagger to free gamma column 3');
  ok(E.moveAssembly(st,[4,3]).ok,'linked move of whole longsword into gamma col 3');
  eq(st.pos.find(p=>p.uid==='p1').cell,[4,3],'blade moved');
  eq(st.pos.find(p=>p.uid==='p2').cell,[6,3],'hilt moved with blade');
  eq(st.sis.find(a=>a.id==='acc_guard').host,'bond','guard stayed seated');
  // unlinked: blade alone to inventory; hilt must remain placed
  st.linked=false;
  ok(E.movePO(st,'p1','inv').ok);
  eq(st.pos.find(p=>p.uid==='p2').loc,'grid','hilt remains on canvas');
  eq(st.sis.find(a=>a.id==='acc_guard').host,'inv','guard unseated');
});

T('assembly to inventory stows both parts',()=>{
  const {st,E}=fresh();
  ok(E.moveAssembly(st,'inv').ok);
  eq(st.pos.find(p=>p.uid==='p1').loc,'inv');
  eq(st.pos.find(p=>p.uid==='p2').loc,'inv');
});

T('BP move: delta relocates, contents shift, beams recompute (links break/dud)',()=>{
  const {st,E}=fresh();
  let beams=E.traceBeams(st);
  ok(beams.find(b=>b.from==='gamma'&&b.dir===2).to==='delta','initial gamma→delta link');
  ok(E.moveBP(st,'delta',[5,4]).ok,'delta 2x2 to origin (5,4)');
  eq(st.bps.find(b=>b.id==='delta').origin,[5,4]);
  const jaw=st.pos.find(p=>p.uid==='p7');
  eq(jaw.cell,[5,4],'jaw shifted with its BP');
  beams=E.traceBeams(st);
  eq(beams.find(b=>b.from==='gamma'&&b.dir===2).to,null,'gamma dir2 now a dud');
  eq(beams.find(b=>b.from==='delta').to,null,'delta dir6 now a dud');
});

T('BP move rejections: overlap and out-of-canvas',()=>{
  const {st,E}=fresh();
  const r1=E.canMoveBP(st,'delta',[1,4]);
  ok(!r1.ok&&r1.why==='overlaps another BP',r1.why);
  // REQ-0031 Phase B (8x8 grid): out-of-canvas origin derived from
  // Data.LAYOUT (not hardcoded 6x6) so this test stays correct regardless
  // of grid size -- ROWS+1/COLS+1 is guaranteed outside the canvas.
  const r2=E.canMoveBP(st,'delta',[Data.LAYOUT.ROWS+1,Data.LAYOUT.COLS+1]);
  ok(!r2.ok&&r2.why==='outside canvas',r2.why);
});

T('grid chemistry: Ignite fires when Flame and Oil become adjacent',()=>{
  const {st,E}=fresh();
  ok(!E.combos(st).some(c=>c.name==='Ignite'),'no Ignite initially (oil in inventory)');
  ok(E.movePO(st,'p6','inv').ok,'stow herb');
  ok(E.movePO(st,'p5','inv').ok,'stow dagger');
  ok(E.movePO(st,'p8',[5,2]).ok,'oil into gamma (5,2)-(6,2)');
  ok(!E.combos(st).some(c=>c.name==='Ignite'),'still none: flame is in alpha');
  ok(E.movePO(st,'p3','inv').ok&&E.movePO(st,'p3',[5,3]).ok,'flame beside oil');
  ok(E.combos(st).some(c=>c.name==='Ignite'),'Ignite fires');
});

// ---------------------------------------------------------------------
// Hierarchy-walk tests (REQ-0022 batch 3/4). hasTag() is exercised directly
// with SYNTHETIC trees (not real vocab.json data) so these tests don't
// depend on/pollute actual content -- per the plan's own preference for
// unit-testing the shared helper in isolation. Today's real po_tags/
// socket_tags trees are fully degenerate (every node a root), so these
// synthetic fixtures are the only place actual multi-level hierarchy
// containment is exercised end-to-end.
T('hierarchy: child tag satisfies ancestor-gated check',()=>{
  const tree={TestWeapon:null,TestSword:'TestWeapon'};
  // an item tagged only with the child (TestSword) satisfies a check for
  // the ancestor (TestWeapon) ...
  ok(Engine.hasTag(['TestSword'],'TestWeapon',tree),
     'TestSword should satisfy a TestWeapon-gated check (child->ancestor)');
  // ... and symmetrically, an item tagged only with the ancestor
  // (TestWeapon) satisfies a check for the descendant (TestSword), per the
  // ground truth's SYMMETRIC "same tag, or tag within the hierarchy" rule.
  ok(Engine.hasTag(['TestWeapon'],'TestSword',tree),
     'TestWeapon should satisfy a TestSword-gated check (ancestor->child)');
});

T('hierarchy: PO tag and Socket tag namespaces never cross-match',()=>{
  // "Metal" is a real coincidental name shared by both real namespaces today
  // (po_tags has it as a former element; socket_tags has it as a former
  // socket tag) -- exercise that exact collision with synthetic trees shaped
  // the same way, to prove hasTag() never conflates the two even when the
  // tag STRING is identical, because the tree argument scopes the walk.
  const poTree={Metal:null,Flame:null};
  const socketTree={Metal:null,Bone:null};
  // an item tagged 'Metal' in the po_tags sense must not satisfy a
  // socket-tree-scoped 'Metal' check (and vice versa) -- these tests pass
  // the SAME tag list against DIFFERENT trees and confirm the tree argument
  // is what the containment check is actually scoped by. Since both trees
  // here are degenerate, cross-namespace non-interference reduces to: the
  // caller must always pass the correct tree, and hasTag() has no way to
  // silently pick the wrong one (no shared/global tree state).
  ok(Engine.hasTag(['Metal'],'Metal',poTree),'Metal should match itself within po tree');
  ok(Engine.hasTag(['Metal'],'Metal',socketTree),'Metal should match itself within socket tree');
  // A tag that's a PO-tree descendant of some node must not accidentally
  // satisfy a same-named lookup in the socket tree with a DIFFERENT parent
  // (proves the parent-chain walk is tree-scoped, not global): give "Metal"
  // a parent in the po tree only, and confirm the socket tree (where Metal
  // is a root with no such parent) does not inherit that relationship.
  const poTreeWithParent={Ore:null,Metal:'Ore'};
  const socketTreeNoParent={Metal:null,Bone:null};
  ok(Engine.hasTag(['Metal'],'Ore',poTreeWithParent),
     'in the po tree, Metal (child of Ore) should satisfy an Ore-gated check');
  ok(!Engine.hasTag(['Metal'],'Ore',socketTreeNoParent),
     'the socket tree has no "Ore" node/relationship -- must not match at all');
});

T('hierarchy: unrelated sibling tags do not match',()=>{
  const tree={TestWeapon:null,TestSword:'TestWeapon',TestShield:'TestWeapon'};
  // TestSword and TestShield are siblings (same parent, TestWeapon) with no
  // ancestor/descendant relationship to EACH OTHER -- a check for one must
  // not be satisfied by the other.
  ok(!Engine.hasTag(['TestSword'],'TestShield',tree),
     'TestSword must not satisfy a TestShield-gated check (unrelated siblings)');
  ok(!Engine.hasTag(['TestShield'],'TestSword',tree),
     'TestShield must not satisfy a TestSword-gated check (unrelated siblings)');
  // also confirm two flat/degenerate (no relation at all) root tags don't match
  const flatTree={Flame:null,Frost:null};
  ok(!Engine.hasTag(['Flame'],'Frost',flatTree),'Flame must not satisfy a Frost-gated check');
});

// ---------------------------------------------------------------------
// Connection Port tests (REQ-0023). A small synthetic 2-BP fixture (two
// 2x2 BPs, "north" rows 1-2 and "south" rows 3-4, both cols 1-2, sharing a
// north/south border at row2|row3) with synthetic ITEMS is used instead of
// the shared game scenario, so each test's placement/adjacency intent is
// self-contained and doesn't depend on (or risk colliding with) the live
// roster's layout. No linkers needed for these checks -- linker.dirs:[].
function portFixture(){
  const ITEMS={
    port_owner:{name:'Port Owner',tags:['Sender'],shape:[[0,0]],icon:'icon-x',sockets:[],
      ports:[{tiles:[[1,0]],tag:'Target'}]}, // port aims one cell straight down (external)
    partner_match:{name:'Partner Match',tags:['Target'],shape:[[0,0]],icon:'icon-x',sockets:[]},
    partner_unrelated:{name:'Partner Unrelated',tags:['Unrelated'],shape:[[0,0]],icon:'icon-x',sockets:[]},
    partner_child:{name:'Partner Child',tags:['ChildOfTarget'],shape:[[0,0]],icon:'icon-x',sockets:[]},
  };
  const SI_DEFS={};
  const LAYOUT={ROWS:4,COLS:2};
  function freshState(){
    return {
      linked:true,
      bps:[
        {id:'north',name:'North',color:'#888',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],linker:{off:[0,0],dirs:[]}},
        {id:'south',name:'South',color:'#888',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[3,1],linker:{off:[0,0],dirs:[]}},
      ],
      pos:[],
      sis:[],
    };
  }
  return {ITEMS,SI_DEFS,LAYOUT,freshState};
}

T('Connection Port: tile reached but partner tag unrelated -> no connection',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,freshState}=portFixture();
  // po_tags tree: Target and Unrelated are unrelated roots (no hierarchy edge).
  const poTree={Sender:null,Target:null,Unrelated:null};
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,{po:poTree});
  const st=freshState();
  st.pos.push({uid:'owner',id:'port_owner',loc:'grid',cell:[1,1],rot:0}); // port tile targets [2,1]
  st.pos.push({uid:'partner',id:'partner_unrelated',loc:'grid',cell:[2,1],rot:0}); // occupies the port's target tile, same BP
  const conns=E.connectionsFrom(st,st.pos.find(p=>p.uid==='owner'));
  ok(conns.length===0,'tile is reached (partner sits on the port target tile) but tag is unrelated -- must NOT connect: '+JSON.stringify(conns));
});

T('Connection Port: port tag matches a partner via hierarchy (synthetic child tag)',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,freshState}=portFixture();
  // ChildOfTarget is a hierarchy descendant of Target -- per the ground-truth
  // "same tag, or tag within the hierarchy" rule, a partner tagged only with
  // the CHILD must still satisfy a port searching for the ANCESTOR tag.
  const poTree={Sender:null,Target:null,ChildOfTarget:'Target'};
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,{po:poTree});
  const st=freshState();
  st.pos.push({uid:'owner',id:'port_owner',loc:'grid',cell:[1,1],rot:0}); // port tile targets [2,1]
  st.pos.push({uid:'partner',id:'partner_child',loc:'grid',cell:[2,1],rot:0}); // tagged ChildOfTarget, same BP
  const conns=E.connectionsFrom(st,st.pos.find(p=>p.uid==='owner'));
  ok(conns.length===1&&conns[0].tag==='Target'&&conns[0].partner.uid==='partner','port tagged Target should connect to a partner tagged only the child ChildOfTarget, via hierarchy: '+JSON.stringify(conns.map(c=>({tag:c.tag,partner:c.partner&&c.partner.uid}))));
});

T('Connection Port: cross-BP still blocked even with a matching tag',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,freshState}=portFixture();
  const poTree={Sender:null,Target:null};
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,{po:poTree});
  const st=freshState();
  // owner at north's bottom row [2,1]; port tile targets [3,1], which is
  // SOUTH's top row -- a different BP, even though the tile arithmetic
  // lands exactly on an occupied, correctly-tagged partner cell.
  st.pos.push({uid:'owner',id:'port_owner',loc:'grid',cell:[2,1],rot:0});
  st.pos.push({uid:'partner',id:'partner_match',loc:'grid',cell:[3,1],rot:0});
  const conns=E.connectionsFrom(st,st.pos.find(p=>p.uid==='owner'));
  ok(conns.length===0,'partner has the matching tag AND sits on the port target tile, but is in a DIFFERENT BP -- must NOT connect (same-BP guard, REQ-0023): '+JSON.stringify(conns));
  // sanity/control: the identical setup entirely WITHIN one BP (south's own
  // 2x2) DOES connect, proving the rejection above is specifically the
  // cross-BP guard and not some other fixture mistake.
  const st2=freshState();
  st2.pos.push({uid:'owner2',id:'port_owner',loc:'grid',cell:[3,1],rot:0}); // south top row; port targets [4,1]
  st2.pos.push({uid:'partner2',id:'partner_match',loc:'grid',cell:[4,1],rot:0}); // south bottom row, same BP
  const conns2=E.connectionsFrom(st2,st2.pos.find(p=>p.uid==='owner2'));
  ok(conns2.length===1&&conns2[0].partner.uid==='partner2','control case (same BP) should connect: '+JSON.stringify(conns2.map(c=>({tag:c.tag,partner:c.partner&&c.partner.uid}))));
});

// ---------------------------------------------------------------------
// Inventory model tests (REQ-0030 Phase 1). Pages are independent 5x
// containers, same ROWS x COLS as canvas (Data.LAYOUT, 6x6 here). Most
// tests use the live fresh() fixture (canvas untouched, inventory pages
// start empty) and place freshly-defined PO/SI instances directly into a
// page's pos[]/sis[] arrays (mirroring how the real client will do it: a
// PO "enters" a page by existing in that page's pos[] before any
// invMovePO/invCanPlacePO call is made -- these functions place/validate
// an EXISTING record's cell, they don't create new inventory items from
// thin air, matching how movePO/canPlacePO also expect the PO to already
// be a member of st.pos).
//
// A couple of tests need an inventory-resident BP (to test PO-on-BP
// containment, BP transfer, and linker dormancy) -- for those, a small
// synthetic single-BP fixture (invBPFixture) is used so the fixture's BP
// shape/linker/origin are self-contained and don't depend on the live
// roster's specific layout.
function invBPFixture(){
  const ITEMS={
    small_po:{name:'Small PO',tags:[],shape:[[0,0]],icon:'icon-x',sockets:[
      {t:'gem',tags:['Metal'],ax:0.5,ay:0.5},
    ]},
    wide_po:{name:'Wide PO',tags:[],shape:[[0,0],[0,1]],icon:'icon-x',sockets:[]},
  };
  const SI_DEFS={
    small_si:{name:'Small SI',slot:'gem',reqTags:[]},
  };
  const LAYOUT={ROWS:6,COLS:6};
  const TREES={po:{},socket:{}};
  function freshState(){
    return {
      linked:true,bps:[],pos:[],sis:[],
      inv:{pages:[{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]}]},
    };
  }
  return {ITEMS,SI_DEFS,LAYOUT,TREES,freshState};
}

T('inventory: makeState() carries 5 independent empty pages, same dims as canvas',()=>{
  const {st}=fresh();
  ok(st.inv&&Array.isArray(st.inv.pages)&&st.inv.pages.length===5,'5 pages expected');
  for(const pg of st.inv.pages){
    eq(pg.bps,[],'page starts with no BPs');
    eq(pg.pos,[],'page starts with no POs');
    eq(pg.sis,[],'page starts with no SIs');
  }
});

T('inventory: free PO placement legality -- bounds, PO-PO collision, BP-overlap rejection',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.pos.push({uid:'x1',id:'small_po',loc:'grid',cell:[1,1],rot:0});
  // out of bounds
  const oob=E.invCanPlacePO(st,0,'x1',0,[7,1]);
  ok(!oob.ok&&oob.why==='outside page','out-of-bounds rejected: '+JSON.stringify(oob));
  // free placement in open space is legal
  ok(E.invCanPlacePO(st,0,'x1',0,[2,2]).ok,'free placement on empty page cell should be legal');
  // PO-PO collision: place a second PO at [3,3], then try to move x1 onto it
  pg.pos.push({uid:'x2',id:'small_po',loc:'grid',cell:[3,3],rot:0});
  const coll=E.invCanPlacePO(st,0,'x1',0,[3,3]);
  ok(!coll.ok&&coll.why==='occupied','PO-PO collision rejected: '+JSON.stringify(coll));
  // BP overlap: add a BP covering [5,5]-[6,6], then a free PO must not overlap it partially
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[5,5],linker:{off:[0,0],dirs:[]}});
  const straddle=E.invCanPlacePO(st,0,'x1',0,[5,4]); // wide_po-like span would straddle; use x1 (1x1) landing exactly on the BP edge cell instead:
  // a 1x1 PO landing fully on the BP is actually the CONTAINMENT case (legal) -- to test "free PO must not overlap a BP"
  // we need a PO whose shape straddles being partly free and partly on the BP. Use wide_po (2 cells horizontal).
  pg.pos.push({uid:'x3',id:'wide_po',loc:'grid',cell:[10,10],rot:0}); // parked far away initially (invalid cell tolerated since we only canPlace-check, never validate at push time)
  const partial=E.invCanPlacePO(st,0,'x3',0,[5,4]); // cells [5,4](free) and [5,5](on bpA) -- straddles page-space vs BP
  ok(!partial.ok,'PO partially overlapping a BP (straddling free space and BP) must be rejected: '+JSON.stringify(partial));
});

T('inventory: PO fully-inside-one-BP containment law (accept inside, reject straddling edge, reject spanning two BPs)',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],linker:{off:[0,0],dirs:[]}});
  pg.bps.push({id:'bpB',name:'BP B',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,3],linker:{off:[0,0],dirs:[]}});
  pg.pos.push({uid:'w1',id:'wide_po',loc:'grid',cell:[1,1],rot:0});
  // fully inside bpA: [1,1] covers cells (1,1)-(1,2), both inside bpA (cols 1-2) -- accept
  ok(E.invCanPlacePO(st,0,'w1',0,[1,1]).ok,'wide_po fully inside bpA should be accepted');
  // straddling bpA's edge: anchor [1,2] -> cells (1,2) inside bpA, (1,3) inside bpB -- two different BPs
  const spans=E.invCanPlacePO(st,0,'w1',0,[1,2]);
  ok(!spans.ok&&spans.why==='spans two BPs','wide_po straddling bpA/bpB edge should be rejected: '+JSON.stringify(spans));
  // spanning BP edge into free space: anchor [1,0] is out of bounds (col 0); use anchor [2,2] -> row2 is free space (bpA is only row1), so
  // cells (2,2) free,(2,3) free -- both free, legal (not a containment case at all); instead test straddle-into-free directly:
  // anchor [1,1] but shift bpA to only occupy row1 col1 (shrink) -- reuse existing single-cell edge case instead:
  const single=invBPFixtureSingleCellEdge(E);
  ok(single.ok,'single-cell straddle sub-check ran');
});
function invBPFixtureSingleCellEdge(E){
  // A BP occupying only cell (1,1); a wide_po anchored at (1,1) covers (1,1)[on BP] and (1,2)[free space] --
  // must be rejected (straddles BP edge into open page space, not "fully inside").
  const ITEMS={wide_po:{name:'Wide PO',tags:[],shape:[[0,0],[0,1]],icon:'icon-x',sockets:[]}};
  const st={linked:true,bps:[],pos:[],sis:[],inv:{pages:[{bps:[{id:'bpX',name:'BP X',color:'#fff',shape:[[0,0]],origin:[1,1],linker:{off:[0,0],dirs:[]}}],pos:[{uid:'w9',id:'wide_po',loc:'grid',cell:[5,5],rot:0}],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]}]}};
  const E2=Engine.create(ITEMS,{},{ROWS:6,COLS:6},{po:{},socket:{}});
  const r=E2.invCanPlacePO(st,0,'w9',0,[1,1]);
  return {ok:(!r.ok&&r.why==='straddles BP edge')};
}

T('inventory: free SI 1-cell occupancy + collision with PO/BP/SI',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],linker:{off:[0,0],dirs:[]}});
  pg.pos.push({uid:'p1',id:'small_po',loc:'grid',cell:[3,3],rot:0});
  pg.sis.push({uid:'s1',id:'small_si',host:'inv'});
  pg.sis.push({uid:'s2',id:'small_si',host:{page:0,cell:[4,4]}});
  // out of bounds
  ok(!E.invCanPlaceSI(st,0,'s1',[0,0]).ok,'out of bounds rejected');
  // collision with BP
  const onBp=E.invCanPlaceSI(st,0,'s1',[1,1]);
  ok(!onBp.ok&&onBp.why==='BP-overlap','SI landing on a BP cell must be rejected: '+JSON.stringify(onBp));
  // collision with PO
  const onPo=E.invCanPlaceSI(st,0,'s1',[3,3]);
  ok(!onPo.ok&&onPo.why==='occupied','SI landing on a PO cell must be rejected: '+JSON.stringify(onPo));
  // collision with another free SI
  const onSi=E.invCanPlaceSI(st,0,'s1',[4,4]);
  ok(!onSi.ok&&onSi.why==='occupied','SI landing on another free SI cell must be rejected: '+JSON.stringify(onSi));
  // legal empty cell
  ok(E.invCanPlaceSI(st,0,'s1',[5,5]).ok,'empty page cell should accept the free SI');
  ok(E.invMoveSI(st,0,'s1',[5,5]).ok);
  eq(st.inv.pages[0].sis.find(a=>a.uid==='s1').host,{page:0,cell:[5,5]},'free SI host records page+cell');
});

T('inventory: SI seat/unseat on an inventory-BP-hosted PO',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],linker:{off:[0,0],dirs:[]}});
  pg.pos.push({uid:'p1',id:'small_po',loc:'grid',cell:[1,1],rot:0}); // fully inside bpA, has a gem socket
  pg.sis.push({uid:'s1',id:'small_si',host:'inv'});
  const skey=E.pageSockets(st,0).find(s=>s.host==='p1').skey;
  ok(E.invSeatSI(st,0,'s1',skey).ok,'seat onto inventory-BP-hosted PO socket');
  eq(st.inv.pages[0].sis.find(a=>a.uid==='s1').host,{po:'p1',si:0});
  ok(E.invStowSI(st,0,'s1').ok,'unseat back to inv');
  eq(st.inv.pages[0].sis.find(a=>a.uid==='s1').host,'inv');
});

T('inventory: SI seat/unseat on a free-placed PO (resolved ambiguity: free-placed POs DO accept SIs)',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  // no BP at all in this page -- p1 is entirely free-placed
  pg.pos.push({uid:'p1',id:'small_po',loc:'grid',cell:[2,2],rot:0});
  pg.sis.push({uid:'s1',id:'small_si',host:'inv'});
  const skey=E.pageSockets(st,0).find(s=>s.host==='p1').skey;
  ok(E.invSeatSI(st,0,'s1',skey).ok,'free-placed PO (no host BP) should still accept SI seating');
  eq(st.inv.pages[0].sis.find(a=>a.uid==='s1').host,{po:'p1',si:0});
});

T('inventory BP transfer: canvas -> page carries POs+SIs with origin remap; rejects on target collision',()=>{
  const {st,E}=fresh();
  // delta (2x2 @ [4,5]) hosts p7 (beast_jaw, cells [4,6],[5,5],[5,6]); a2 guard is on 'bond', not on delta -- use p7's own sockets instead.
  // Seat the arrowhead (a4) onto beast_jaw's edge socket first, so we can verify it travels with the transfer.
  const jawEdge=E.sockets(st).find(s=>s.host==='p7'&&s.t==='edge');
  ok(E.seatSI(st,'a4',jawEdge.skey).ok,'arrowhead seated onto jaw edge (pre-transfer)');
  const before=JSON.stringify(E.cellsOf(st,st.pos.find(p=>p.uid==='p7')));
  ok(E.transferBP(st,{loc:'canvas'},{loc:'inv',page:0},'delta',[1,1]).ok,'delta transfers from canvas to page 1 at [1,1]');
  eq(st.bps.some(b=>b.id==='delta'),false,'delta no longer on canvas');
  const pg=st.inv.pages[0];
  const movedBp=pg.bps.find(b=>b.id==='delta');
  ok(!!movedBp,'delta now present in page 1');
  eq(movedBp.origin,[1,1]);
  const jaw=pg.pos.find(p=>p.uid==='p7');
  ok(!!jaw,'jaw (p7) moved into the page along with its BP');
  // origin shifted by [1,1]-[4,5] = [-3,-4]; verify absolute cells shifted by the same delta
  const afterCells=E.cellsOfIn(jaw);
  const beforeCells=JSON.parse(before);
  const expectCells=beforeCells.map(([r,c])=>[r-3,c-4]);
  eq(afterCells,expectCells,'jaw cells shifted by the same delta as its BP (origin remap)');
  const seatedArrow=pg.sis.find(a=>a.uid==='a4');
  ok(!!seatedArrow&&seatedArrow.host&&seatedArrow.host.po==='p7','arrowhead SI travelled into the page with its host PO, host ref unchanged');
  eq(st.sis.some(a=>a.uid==='a4'),false,'arrowhead no longer listed in canvas sis[]');
  // now collide: try transferring gamma on top of delta's new position in the SAME page
  const gammaChk=E.canTransferBP(st,{loc:'canvas'},{loc:'inv',page:0},'gamma',[1,1]);
  ok(!gammaChk.ok,'transferring gamma onto delta\'s occupied page cells should be rejected: '+JSON.stringify(gammaChk));
  eq(st.bps.some(b=>b.id==='gamma'),true,'gamma must remain on canvas -- rejected transfer must not partially move state');
});

T('inventory BP transfer: page -> canvas reverse carries contents back',()=>{
  const {st,E}=fresh();
  ok(E.transferBP(st,{loc:'canvas'},{loc:'inv',page:2},'delta',[1,1]).ok,'delta to page 3 first');
  ok(E.transferBP(st,{loc:'inv',page:2},{loc:'canvas'},'delta',[4,5]).ok,'delta back to canvas at its original spot');
  ok(st.bps.some(b=>b.id==='delta'),'delta back on canvas');
  eq(st.bps.find(b=>b.id==='delta').origin,[4,5]);
  const jaw=st.pos.find(p=>p.uid==='p7');
  eq(jaw.loc,'grid');
  eq(jaw.cell,[4,5],'jaw restored to its original absolute cell (round-trip origin remap)');
  ok(st.inv.pages[2].bps.length===0&&st.inv.pages[2].pos.length===0,'page 3 empty again after the BP left');
});

T('inventory BP transfer: page -> page carries contents',()=>{
  const {st,E}=fresh();
  ok(E.transferBP(st,{loc:'canvas'},{loc:'inv',page:0},'delta',[1,1]).ok);
  ok(E.transferBP(st,{loc:'inv',page:0},{loc:'inv',page:3},'delta',[2,2]).ok,'page1 -> page4');
  eq(st.inv.pages[0].bps.length,0,'page1 empty after leaving');
  const movedBp=st.inv.pages[3].bps.find(b=>b.id==='delta');
  ok(!!movedBp);
  eq(movedBp.origin,[2,2]);
  const jaw=st.inv.pages[3].pos.find(p=>p.uid==='p7');
  ok(!!jaw,'jaw present in page4');
  eq(E.cellsOfIn(jaw),[[2,3],[3,2],[3,3]],'jaw cells recomputed for the new page4 origin');
});

T('inventory: linker dormancy -- a linker-bearing BP transferred into a page emits nothing from traceBeams',()=>{
  const {st,E}=fresh();
  const beamsBefore=E.traceBeams(st);
  ok(beamsBefore.some(b=>b.from==='delta'),'sanity: delta contributes a beam while on canvas');
  ok(E.transferBP(st,{loc:'canvas'},{loc:'inv',page:0},'delta',[1,1]).ok);
  const beamsAfter=E.traceBeams(st);
  ok(!beamsAfter.some(b=>b.from==='delta'),'delta must contribute NO beam once it is in an inventory page');
  ok(!beamsAfter.some(b=>b.to==='delta'),'no other BP\'s beam should resolve TO delta while it is dormant in inventory');
  // and it must not appear in connections/combos either (both scoped to st.bps/st.pos, same guarantee)
  const conns=E.allConnections(st);
  ok(!conns.some(c=>c.from.uid==='p7'||c.to.uid==='p7'),'jaw (now in inventory with delta) contributes no connections');
});

T('inventory: rotation of a free-placed PO',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.pos.push({uid:'w1',id:'wide_po',loc:'grid',cell:[3,3],rot:0}); // horizontal, cells (3,3)-(3,4)
  ok(E.invRotatePO(st,0,'w1').ok,'free-placed PO rotates in the open page');
  eq(pg.pos.find(p=>p.uid==='w1').rot,1);
  eq(E.cellsOfIn(pg.pos.find(p=>p.uid==='w1')).length,2,'still a 2-cell footprint after rotation');
  // blocked rotate: pin a neighbor so the rotated footprint collides
  pg.pos.push({uid:'w2',id:'wide_po',loc:'grid',cell:[10,10],rot:0});
  // force w1 back to rot0 at [5,5] (cells (5,5)-(5,6)), place w2 at (6,5) so a vertical rotation would collide
  pg.pos.find(p=>p.uid==='w1').rot=0;pg.pos.find(p=>p.uid==='w1').cell=[5,5];
  pg.pos.find(p=>p.uid==='w2').cell=[6,5];pg.pos.find(p=>p.uid==='w2').rot=0;
  const blocked=E.invRotatePO(st,0,'w1');
  ok(!blocked.ok,'rotate into an occupied cell should be rejected: '+JSON.stringify(blocked));
});

T('inventory: 5-page bounds/independence -- identical coordinates on different pages do not collide',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  for(let i=0;i<5;i++)st.inv.pages[i].pos.push({uid:'q'+i,id:'small_po',loc:'grid',cell:[2,2],rot:0});
  // same [2,2] cell used on every page -- each page is independent, so each PO's OWN placement there must be legal
  for(let i=0;i<5;i++){
    const chk=E.invCanPlacePO(st,i,'q'+i,0,[2,2]);
    ok(chk.ok,'page '+i+' should independently accept its own PO at the SAME coordinate another page also uses: '+JSON.stringify(chk));
  }
  // bounds: page index range sanity (5 pages, 0..4) -- out-of-range page access should not silently succeed
  ok(st.inv.pages.length===5&&st.inv.pages[4]!==undefined&&st.inv.pages[5]===undefined,'exactly 5 pages, 0-indexed 0..4');
  // out-of-bounds cell rejected on every page independently
  for(let i=0;i<5;i++){
    const oob=E.invCanPlacePO(st,i,'q'+i,0,[0,0]);
    ok(!oob.ok&&oob.why==='outside page','page '+i+' should reject an out-of-bounds cell');
  }
});

T('migrateState: legacy list-inventory (loc:\'inv\' POs, host:\'inv\' SIs) -> first-fit page 1 placement',()=>{
  const {st:legacy,E}=fresh();
  // sanity on the fixture's actual legacy shape (found in mock-src/data.js SCENARIO):
  // p8 (oil_flask) is loc:'inv',cell:null; a3/a4/a5/a6 are host:'inv'.
  eq(legacy.pos.find(p=>p.uid==='p8').loc,'inv');
  eq(legacy.pos.find(p=>p.uid==='p8').cell,null);
  ok(['a3','a4','a5','a6'].every(u=>legacy.sis.find(a=>a.uid===u).host==='inv'),'4 legacy stowed SIs (host:inv) present in the fixture');
  delete legacy.inv; // simulate an OLDER saved profile that predates st.inv entirely
  const migrated=E.migrateState(legacy);
  ok(migrated!==legacy,'migrateState must not mutate its input');
  ok(!legacy.inv,'original legacy object left untouched (no inv field added to it)');
  ok(migrated.inv&&migrated.inv.pages.length===5,'migrated state has the 5-page inventory');
  // oil_flask (PO) should now be spatially placed on page 1 (index 0), no longer in the flat pos[] list
  ok(!migrated.pos.some(p=>p.uid==='p8'),'oil_flask no longer sits in the flat legacy pos[] list');
  const placedOil=migrated.inv.pages[0].pos.find(p=>p.uid==='p8');
  ok(!!placedOil,'oil_flask migrated onto page 1');
  eq(placedOil.loc,'grid');
  ok(Array.isArray(placedOil.cell)&&placedOil.cell.length===2,'oil_flask has a concrete [row,col] cell after migration');
  // legality: the migrated placement must itself be legal per invCanPlacePO (first-fit never places illegally)
  const reCheck=E.invCanPlacePO(migrated,0,'p8',placedOil.rot,placedOil.cell);
  // re-run against a clone excluding p8 itself (invCanPlacePO already excludes the uid internally)
  ok(reCheck.ok,'first-fit placement must itself be legal: '+JSON.stringify(reCheck));
  // the 4 legacy SIs should now be free-placed 1x1 on page 1 (or overflow pages), never left as bare host:'inv'
  ok(!migrated.sis.some(a=>['a3','a4','a5','a6'].includes(a.uid)),'legacy stowed SIs no longer sit as flat host:inv entries');
  for(const uid of ['a3','a4','a5','a6']){
    const found=migrated.inv.pages.flatMap(pg=>pg.sis).find(a=>a.uid===uid);
    ok(!!found,'SI '+uid+' migrated into some page');
    ok(found.host&&typeof found.host==='object'&&Array.isArray(found.host.cell),'SI '+uid+' has a free {page,cell} host after migration: '+JSON.stringify(found.host));
  }
  // canvas-placed POs/BPs and seated SIs (a1 gem, a2 guard) must be untouched by migration
  eq(migrated.bps.length,legacy.bps.length,'canvas BPs unchanged');
  ok(migrated.pos.some(p=>p.uid==='p1'&&p.loc==='grid'),'canvas-placed blade untouched');
  eq(migrated.sis.find(a=>a.uid==='a1').host,{po:'p2',si:0},'seated gem (a1) untouched by migration');
  eq(migrated.sis.find(a=>a.uid==='a2').host,'bond','bonded guard (a2) untouched by migration');
});

console.log('----------------------------------');
console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
