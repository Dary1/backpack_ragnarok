// backpack_ragnarok mock v0.5 — operation-emulation test suite (node)
// Primary test gate per user directive: emulate operations against the pure engine.
'use strict';
const Engine=require('./engine.js');
const Data=require('./data.js');
let pass=0,fail=0;
function T(name,fn){ const __t0 = Date.now();
  try{fn();console.log('PASS  '+name+clk(name,__t0));pass++;}
  catch(e){console.log('FAIL  '+name+' — '+e.message);fail++;}
}
function eq(a,b,msg){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error((msg||'')+' expected '+JSON.stringify(b)+' got '+JSON.stringify(a));}
function ok(v,msg){if(!v)throw new Error(msg||'expected truthy');}
function fresh(){const st=Data.makeState();return {st,E:Engine.create(Data.ITEMS,Data.SI_DEFS,Data.LAYOUT,Data.TREES,Data.UNITS,Data.CONN_SHAPES)};}

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

T('PO moves: stow herb, place oil; spanning/unit/dead rejections',()=>{
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
  const onUnit=E.movePO(st,'p8',[4,2]);
  ok(!onUnit.ok,'unit cell reject');
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
  // REQ-0170: delta carries the Light Cavalry -- `lance`, a SINGLE forward (N) ray.
  // Its beam is therefore its Unit's, not a rolled dirs array, and what the ray sees
  // is a pure function of where the bag is standing. Capture it, move the bag, and
  // assert the recomputation.
  const deltaBefore=beams.find(b=>b.from==='delta');
  ok(E.moveBP(st,'delta',[5,4]).ok,'delta 2x2 to origin (5,4)');
  eq(st.bps.find(b=>b.id==='delta').origin,[5,4]);
  const jaw=st.pos.find(p=>p.uid==='p7');
  eq(jaw.cell,[5,4],'jaw shifted with its BP');
  beams=E.traceBeams(st);
  eq(beams.find(b=>b.from==='gamma'&&b.dir===2).to,null,'gamma dir2 now a dud');
  const deltaAfter=beams.find(b=>b.from==='delta');
  eq(deltaAfter.dir,0,"delta's only ray is the lance's forward (N) ray -- the Unit's shape, not the BP's");
  ok((deltaBefore?deltaBefore.to:null)!==(deltaAfter?deltaAfter.to:null),'moving the bag re-resolves what its Unit\'s ray can see (was '+JSON.stringify(deltaBefore?deltaBefore.to:null)+', now '+JSON.stringify(deltaAfter.to)+')');
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


T("REQ-0051 fixed PO: movePO refuses move and stow, rotatePO refuses, record unchanged",()=>{
  const {st,E}=fresh();
  const tgt=st.pos.find(p=>p.loc==="grid"&&p.id!=="blade"&&p.id!=="hilt");
  ok(tgt,"a grid PO exists to pin");
  tgt.fixed=true;
  const beforeCell=JSON.stringify(tgt.cell), beforeRot=tgt.rot;
  const m1=E.movePO(st,tgt.uid,[7,7]);
  ok(!m1.ok&&m1.why==="fixed","movePO to a cell refused: "+JSON.stringify(m1));
  const m2=E.movePO(st,tgt.uid,"inv");
  ok(!m2.ok&&m2.why==="fixed","movePO stow refused: "+JSON.stringify(m2));
  const r1=E.rotatePO(st,tgt.uid);
  ok(!r1.ok&&r1.why==="fixed","rotatePO refused: "+JSON.stringify(r1));
  eq(JSON.stringify(tgt.cell),beforeCell,"cell unchanged after refusals");
  eq(tgt.rot,beforeRot,"rot unchanged after refusals");
  delete tgt.fixed;
  const r2=E.rotatePO(st,tgt.uid);
  ok(r2.ok||r2.why!=="fixed","without fixed, rotate is no longer refused as fixed: "+JSON.stringify(r2));
});

T("REQ-0051 fixed PO: inventory-page move/rotate refused",()=>{
  const E=Engine.create({t:{shape:[[0,0]]}},{},{ROWS:8,COLS:8},{po:{},socket:{}});
  const st={linked:true,bps:[],pos:[],sis:[],inv:{pages:[
    {bps:[],pos:[{uid:"ifx",id:"t",loc:"grid",cell:[1,1],rot:0,fixed:true}],sis:[],tms:[]},
    {bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]}
  ],names:["1","2","3","4","5"]}};
  const im=E.invMovePO(st,0,"ifx",[3,3]);
  ok(!im.ok&&im.why==="fixed","invMovePO refuses a fixed PO: "+JSON.stringify(im));
  const ir=E.invRotatePO(st,0,"ifx");
  ok(!ir.ok&&ir.why==="fixed","invRotatePO refuses a fixed PO: "+JSON.stringify(ir));
});

T("REQ-0051 fixed PO: migrateState preserves fixed on canvas reference, home stays unpinned",()=>{
  const E=Engine.create({t:{shape:[[0,0]]}},{},{ROWS:8,COLS:8},{po:{},socket:{}});
  const legacy={linked:true,
    bps:[{id:"b",name:"B",color:"#fff",shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],linker:{off:[0,0],dirs:[]}}],
    pos:[{uid:"fx",id:"t",loc:"grid",cell:[1,2],rot:0,fixed:true}],sis:[]};
  const mig=E.migrateState(legacy);
  const ref=mig.pos.find(p=>p.uid==="fx");
  ok(ref&&ref.fixed===true,"canvas reference keeps fixed:true through migrateState");
  const home=E.homeLocationOf(mig,"fx");
  ok(home,"fixed PO received an inventory home");
  ok(!home.record.fixed,"home record is NOT pinned (only the canvas reference is)");
});

T("REQ-0051 fixed PO: the containing squad is still discardable (deleteSquad not blocked)",()=>{
  const {st,E}=fresh();
  const tgt=st.pos.find(p=>p.loc==="grid"&&p.id!=="blade"&&p.id!=="hilt");
  tgt.fixed=true;
  const before=st.presets.names.length;
  const r=E.deleteSquad(st,0);
  ok(r.ok,"deleteSquad succeeds even with a fixed PO on the active canvas: "+JSON.stringify(r));
  ok(st.presets.names.length===before-1,"squad count decreased by one");
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
// roster's layout. No units needed for these checks -- unit.dirs:[].
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
        {id:'north',name:'North',color:'#888',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],unit:{id:'berserker',off:[0,0]}},
        {id:'south',name:'South',color:'#888',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[3,1],unit:{id:'berserker',off:[0,0]}},
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
// containment, BP transfer, and unit dormancy) -- for those, a small
// synthetic single-BP fixture (invBPFixture) is used so the fixture's BP
// shape/unit/origin are self-contained and don't depend on the live
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
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[5,5],unit:{id:'berserker',off:[0,0]}});
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
  // REQ-0092: dummy unit off:[1,0] (row 2 of each BP's own shape) is
  // deliberately NOT [0,0] here -- this test only exercises row 1 cells
  // ((1,1)-(1,3)), and [0,0] would put the unit cell exactly where w1
  // is asserted to legally land, now that invCanPlaceCells enforces the
  // unit-cell reservation (see canvas_spec.md's Unit section).
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],unit:{id:'berserker',off:[1,0]}});
  pg.bps.push({id:'bpB',name:'BP B',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,3],unit:{id:'berserker',off:[1,0]}});
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
  // REQ-0092: off:[10,10] is a deliberately OUT-OF-SHAPE placeholder -- bpX's
  // real shape is a single cell ([0,0] only), so there is no second cell to
  // park an inert dummy unit on; pointing it far outside the 6x6 grid this
  // sub-engine uses guarantees it can never coincide with (1,1)/(1,2), the
  // only two cells this check exercises.
  const ITEMS={wide_po:{name:'Wide PO',tags:[],shape:[[0,0],[0,1]],icon:'icon-x',sockets:[]}};
  const st={linked:true,bps:[],pos:[],sis:[],inv:{pages:[{bps:[{id:'bpX',name:'BP X',color:'#fff',shape:[[0,0]],origin:[1,1],unit:{id:'berserker',off:[10,10]}}],pos:[{uid:'w9',id:'wide_po',loc:'grid',cell:[5,5],rot:0}],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]}]}};
  const E2=Engine.create(ITEMS,{},{ROWS:6,COLS:6},{po:{},socket:{}});
  const r=E2.invCanPlacePO(st,0,'w9',0,[1,1]);
  return {ok:(!r.ok&&r.why==='straddles BP edge')};
}

T('REQ-0092 inventory: invCanPlacePO rejects a page-resident BP\'s own unit cell (mirrors canvas\'s Unit-cell rule)',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  // bpA's unit sits at local off [0,0] -- i.e. absolute cell (1,1), its
  // own origin/top-left cell -- exactly like a real BP authored with the
  // Unit at its first shape cell (a completely ordinary, unremarkable
  // authoring choice; nothing here is a degenerate/edge-case shape).
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],unit:{id:'berserker',off:[0,0]}});
  // small_po (1x1) -- NOT wide_po -- so each anchor below tests exactly
  // one cell, isolating the unit-cell rule from the separate BP-
  // containment/straddle rules already covered above.
  pg.pos.push({uid:'w1',id:'small_po',loc:'grid',cell:[3,3],rot:0});
  // BUG (pre-fix): invCanPlaceCells never built a unit map for inventory
  // pages at all (unlike canPlaceCells on canvas), so a PO could land
  // directly on the BP's own unit cell -- exactly the placement warehouse
  // claim's client-side first-fit (firstFitPlace, WarehousePage.tsx) or a
  // manual drag could produce. w1 anchored at [1,1] covers ONLY the unit
  // cell.
  const onUnit=E.invCanPlacePO(st,0,'w1',0,[1,1]);
  ok(!onUnit.ok&&onUnit.why==='Unit cell','PO landing on a page-resident BP\'s unit cell must be rejected: '+JSON.stringify(onUnit));
  // Sanity: the cell immediately to the right of the unit ((1,2), still
  // fully inside bpA) remains perfectly legal -- this is a unit-specific
  // carve-out, not a blanket "can't place inside this BP at all" regression.
  const beside=E.invCanPlacePO(st,0,'w1',0,[1,2]);
  ok(beside.ok,'a non-unit cell fully inside the same BP must still be legal: '+JSON.stringify(beside));
  // invMovePO (the actual mutator firstFitPlace calls) must refuse too, and
  // must leave w1 exactly where it started (all-or-nothing, no partial move).
  const before=JSON.parse(JSON.stringify(pg.pos.find(p=>p.uid==='w1')));
  const mv=E.invMovePO(st,0,'w1',[1,1]);
  ok(!mv.ok,'invMovePO must also refuse a unit-cell destination');
  eq(pg.pos.find(p=>p.uid==='w1'),before,'w1 unchanged after a refused move onto the unit cell');
});

T('inventory: free SI 1-cell occupancy + collision with PO/BP/SI',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],unit:{id:'berserker',off:[0,0]}});
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
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],unit:{id:'berserker',off:[0,0]}});
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

T('REQ-0033 BP transfer canvas -> inv: removes the CURRENT squad\'s BP reference + nested PO/SI references; home(s) untouched',()=>{
  const {st:legacy,E}=fresh();
  const migrated=E.migrateState(legacy);
  const jawEdge=E.sockets(migrated).find(s=>s.host==='p7'&&s.t==='edge');
  ok(E.createRef(migrated,'si','a4',{host:{po:'p7',si:jawEdge.si}}).ok,'arrowhead referenced+seated onto jaw edge (pre-removal)');
  const homeDeltaBefore=JSON.parse(JSON.stringify(E.homeLocationOf(migrated,'delta').record));
  const homeJawBefore=JSON.parse(JSON.stringify(E.homeLocationOf(migrated,'p7').record));
  const r=E.transferBP(migrated,{loc:'canvas'},{loc:'inv',page:0},'delta',[1,1]);
  ok(r.ok,'canvas->inv transfer (reference removal) should succeed: '+JSON.stringify(r));
  eq(migrated.bps.some(b=>b.id==='delta'),false,'delta reference removed from current squad canvas');
  eq(migrated.pos.some(p=>p.uid==='p7'),false,'jaw (p7) reference removed along with its BP');
  eq(migrated.sis.some(a=>a.uid==='a4'),false,'arrowhead reference removed (was seated on the removed jaw reference)');
  // homes MUST be completely untouched -- "drop cell irrelevant" (spec)
  eq(E.homeLocationOf(migrated,'delta').record,homeDeltaBefore,'delta HOME untouched by reference removal');
  eq(E.homeLocationOf(migrated,'p7').record,homeJawBefore,'jaw HOME untouched by reference removal');
  ok(!!E.homeLocationOf(migrated,'a4'),'arrowhead SI still has a home somewhere in inventory');
  ok(E.checkUidInvariant(migrated).ok,'invariant holds after reference removal');
  // yellow/usage must now show delta/p7 as unused by ANY squad
  eq(E.usageOf(migrated,'delta'),[],'delta has zero references anywhere after removal');
  eq(E.usageOf(migrated,'p7'),[],'jaw has zero references anywhere after removal');
});

T('REQ-0033 BP transfer inv -> canvas: creates a BP reference + nested PO/SI references at the new origin; home(s) untouched; red rule on re-reference',()=>{
  const {st:legacy,E}=fresh();
  const migrated=E.migrateState(legacy);
  ok(E.transferBP(migrated,{loc:'canvas'},{loc:'inv',page:2},'delta',[1,1]).ok,'first remove delta\'s reference from the current squad (target page is irrelevant to a removal)');
  const homePage=E.homeLocationOf(migrated,'delta').page;
  const homeBefore=JSON.parse(JSON.stringify(E.homeLocationOf(migrated,'delta').record));
  const r=E.transferBP(migrated,{loc:'inv',page:homePage},{loc:'canvas'},'delta',[6,5]);
  ok(r.ok,'inv->canvas transfer (reference creation) should succeed: '+JSON.stringify(r));
  ok(migrated.bps.some(b=>b.id==='delta'),'delta reference now back on the current squad\'s canvas');
  eq(migrated.bps.find(b=>b.id==='delta').origin,[6,5],'new reference uses the requested origin');
  const jawRef=migrated.pos.find(p=>p.uid==='p7');
  ok(!!jawRef,'jaw (p7) reference recreated alongside delta');
  eq(jawRef.cell,[6,5],'jaw reference cell recomputed relative to the NEW origin (home arrangement preserved)');
  // home must be untouched by the reference-creation (still sitting wherever migrateState first-fit it)
  eq(E.homeLocationOf(migrated,'delta').record,homeBefore,'delta HOME untouched by reference creation');
  ok(E.checkUidInvariant(migrated).ok,'invariant holds after reference creation');
  // red rule: referencing the SAME uid into the SAME (current) squad again must fail
  const dup=E.transferBP(migrated,{loc:'inv',page:homePage},{loc:'canvas'},'delta',[1,1]);
  ok(!dup.ok,'re-referencing delta into the squad that already references it must be rejected (red rule): '+JSON.stringify(dup));
  ok(migrated.bps.some(b=>b.id==='delta'&&JSON.stringify(b.origin)===JSON.stringify([6,5])),'rejected re-reference must not have moved/duplicated the existing one');
});

T('REQ-0033 BP transfer inv-page -> inv-page: stays a PHYSICAL home move (byte-identical to pre-REQ-0033 behavior)',()=>{
  const {st:legacy,E}=fresh();
  const migrated=E.migrateState(legacy);
  // first pull delta's reference off the current squad's canvas, so its
  // home page is the only place it exists (page<->page is a pure home
  // relocation and never needs to consult/alter any squad's reference).
  ok(E.transferBP(migrated,{loc:'canvas'},{loc:'inv',page:0},'delta',[1,1]).ok);
  const homePage=E.homeLocationOf(migrated,'delta').page;
  ok(E.transferBP(migrated,{loc:'inv',page:homePage},{loc:'inv',page:3},'delta',[2,2]).ok,'page->page physical move');
  eq(st_pagesEmptyOfBP(migrated,homePage,'delta'),true,'origin page no longer holds delta\'s home');
  const movedBp=migrated.inv.pages[3].bps.find(b=>b.id==='delta');
  ok(!!movedBp,'delta home now present in page 4');
  eq(movedBp.origin,[2,2]);
  const jaw=migrated.inv.pages[3].pos.find(p=>p.uid==='p7');
  ok(!!jaw,'jaw (p7) home present in page 4 (travelled with its BP home, same as pre-REQ-0033)');
  eq(E.cellsOfIn(jaw),[[2,3],[3,2],[3,3]],'jaw home cells recomputed for the new page4 origin');
  ok(E.checkUidInvariant(migrated).ok,'invariant holds after a pure home relocation');
});
function st_pagesEmptyOfBP(st,pageIdx,bpId){
  return !st.inv.pages[pageIdx].bps.some(b=>b.id===bpId);
}

T('inventory: unit dormancy -- a unit-bearing BP transferred into a page emits nothing from traceBeams',()=>{
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


// =======================================================================
// Squad model tests (REQ-0031 Phase B). Engine API: makeSquadsMeta,
// emptySquadSlot, switchSquad, addSquad, renameSquad, renameInvPage,
// invPageNames, checkUidInvariant. All additive on top of the canvas/
// inventory model above -- st.linked/bps/pos/sis remains the ACTIVE
// squad's canvas exactly as before squads existed.
// =======================================================================

T('presets: makeState() carries 5 squads, slot 0 active with scenario content, 1-4 empty',()=>{
  const {st}=fresh();
  ok(st.presets&&st.presets.active===0,'squad 0 active by default');
  eq(st.presets.names,['Squad 1','Squad 2','Squad 3','Squad 4','Squad 5']);
  eq(st.presets.store.length,5,'5 squad slots');
  ok(st.presets.store[0]===null,'active slot (0) has no store entry -- content lives at top level');
  for(let i=1;i<5;i++){
    const slot=st.presets.store[i];
    ok(slot&&slot.bps.length===0&&slot.pos.length===0&&slot.sis.length===0,'squad '+i+' starts empty (no BPs -- physical items never pre-populated)');
  }
  // sanity: squad 0's "content" IS the scenario's live canvas (bps non-empty)
  ok(st.bps.length>0,'active squad (0) carries the real scenario BPs');
});

T('presets: switchSquad preserves BOTH configurations across a round trip',()=>{
  const {st,E}=fresh();
  const origBps=JSON.parse(JSON.stringify(st.bps));
  const origPos=JSON.parse(JSON.stringify(st.pos));
  const origSis=JSON.parse(JSON.stringify(st.sis));
  const origLinked=st.linked;
  ok(E.switchSquad(st,1).ok,'switch to squad 1');
  eq(st.presets.active,1);
  ok(st.bps.length===0&&st.pos.length===0&&st.sis.length===0,'squad 1 (empty) now live at top level');
  eq(st.presets.store[0],{linked:origLinked,bps:origBps,pos:origPos,sis:origSis},'squad 0 fully preserved in store[0]');
  ok(st.presets.store[1]===null,'newly-active slot (1) has no store entry');
  ok(E.switchSquad(st,0).ok,'switch back to squad 0');
  eq(st.presets.active,0);
  eq(st.bps,origBps,'squad 0 bps restored exactly');
  eq(st.pos,origPos,'squad 0 pos restored exactly');
  eq(st.sis,origSis,'squad 0 sis restored exactly');
  eq(st.linked,origLinked,'squad 0 linked flag restored exactly');
  ok(st.presets.store[1].bps.length===0&&st.presets.store[1].pos.length===0,'squad 1 (still empty) correctly preserved in store[1]');
  ok(st.presets.store[0]===null,'active slot (0, restored) has no store entry again');
});

T('presets: switchSquad is a no-op (still ok:true) when already active; rejects out-of-range',()=>{
  const {st,E}=fresh();
  const before=JSON.stringify(st.bps);
  ok(E.switchSquad(st,0).ok,'switching to the already-active squad succeeds trivially');
  eq(st.presets.active,0);
  eq(JSON.stringify(st.bps),before,'no mutation from a same-squad switch');
  const bad=E.switchSquad(st,99);
  ok(!bad.ok&&bad.why==='squad index out of range','out-of-range squad index rejected');
  const bad2=E.switchSquad(st,-1);
  ok(!bad2.ok,'negative squad index rejected');
});

T('REQ-0085: switchSquad self-heals a corrupted (stray-null) non-active slot instead of throwing',()=>{
  const {st,E}=fresh();
  // Simulate the wild corruption this REQ fixes: some non-active store
  // slot is null even though it is not the active squad (should never
  // happen via the public API -- addSquad/switchSquad/reorderSquad/
  // deleteSquad all maintain "exactly one null, at active" -- but a
  // stray null WAS observed in a live profile with no reconstructable
  // cause, so the engine must tolerate it defensively rather than trust
  // the invariant blindly). Before this fix, switching into slot 2 threw
  // `Cannot read properties of null (reading 'linked')` -- an uncaught
  // exception inside the click handler that made the tab look like it
  // simply did nothing, and left store[0] wrongly non-null besides.
  st.presets.store[2]=null;
  const r=E.switchSquad(st,2);
  ok(r.ok,'switching into a corrupted (null) slot succeeds instead of throwing');
  eq(st.presets.active,2,'active advanced to the requested slot');
  ok(st.linked===true&&st.bps.length===0&&st.pos.length===0&&st.sis.length===0,'corrupted slot self-heals to a fresh EMPTY squad (nothing to recover -- a null slot never had real content)');
  ok(st.presets.store[2]===null,'newly-active slot (2) correctly has no store entry');
  ok(st.presets.store[0]!==null&&Array.isArray(st.presets.store[0].bps),'previously-active slot (0) correctly holds the outgoing snapshot -- invariant restored, not just the crash avoided');
  // and it keeps working going forward (not a one-shot patch)
  ok(E.switchSquad(st,0).ok,'switching back out of the healed slot still works');
  eq(st.presets.active,0);
});

T('REQ-0085: reorderSquad tolerates a stray-null non-active slot elsewhere in store[] without throwing or propagating it',()=>{
  const {st,E}=fresh();
  st.presets.store[3]=null; // corrupt a slot NOT otherwise involved in the reorder below
  const r=E.reorderSquad(st,1,4);
  ok(r.ok,'reorderSquad does not throw with a stray null elsewhere in store[]');
  st.presets.store.forEach((slot,i)=>{
    if(i===st.presets.active){ok(slot===null,'active slot ('+i+') has no store entry');}
    else {ok(slot&&Array.isArray(slot.bps)&&Array.isArray(slot.pos)&&Array.isArray(slot.sis),'slot '+i+' is a real (possibly healed) squad object, not a stray null');}
  });
});

T('REQ-0085: deleteSquad tolerates a stray-null non-active slot elsewhere in store[] without throwing or propagating it',()=>{
  const {st,E}=fresh();
  st.presets.store[3]=null; // corrupt a slot NOT involved in the delete below
  const r=E.deleteSquad(st,2);
  ok(r.ok,'deleteSquad does not throw with a stray null elsewhere in store[]');
  st.presets.store.forEach((slot,i)=>{
    if(i===st.presets.active){ok(slot===null,'active slot ('+i+') has no store entry');}
    else {ok(slot&&Array.isArray(slot.bps),'slot '+i+' is a real (possibly healed) squad object, not a stray null');}
  });
});

T('presets: addSquad appends an EMPTY squad (no BPs/POs/SIs) and grows names[]',()=>{
  const {st,E}=fresh();
  const before=st.presets.store.length;
  const r=E.addSquad(st);
  ok(r.ok&&r.index===before,'addSquad returns the new 0-based index');
  eq(st.presets.store.length,before+1);
  eq(st.presets.names.length,before+1);
  eq(st.presets.names[before],'Squad '+(before+1),'default name "Squad N"');
  const added=st.presets.store[before];
  ok(added.bps.length===0&&added.pos.length===0&&added.sis.length===0,'new squad starts empty');
  // custom name variant
  const r2=E.addSquad(st,'Boss Fight');
  eq(st.presets.names[st.presets.names.length-1],'Boss Fight','custom name honored');
});

T('presets: renameSquad sets names[n] for either the active or an inactive slot',()=>{
  const {st,E}=fresh();
  ok(E.renameSquad(st,0,'Main Loadout').ok,'rename the currently-active squad');
  eq(st.presets.names[0],'Main Loadout');
  ok(E.renameSquad(st,2,'PvP Build').ok,'rename an inactive squad');
  eq(st.presets.names[2],'PvP Build');
  const bad=E.renameSquad(st,99,'Nope');
  ok(!bad.ok,'out-of-range squad rename rejected');
});

T('presets: renaming survives a switchSquad (names[] independent of active/store split)',()=>{
  const {st,E}=fresh();
  E.renameSquad(st,0,'Main');
  E.renameSquad(st,1,'Alt');
  E.switchSquad(st,1);
  eq(st.presets.names,['Main','Alt','Squad 3','Squad 4','Squad 5'],'names array untouched by switching which squad is active');
  E.switchSquad(st,0);
  eq(st.presets.names[0],'Main');
  eq(st.presets.names[1],'Alt');
});

T('inventory: renameInvPage sets st.inv.names[n]; defaults to "1".."5"',()=>{
  const {st,E}=fresh();
  eq(E.invPageNames(st),['1','2','3','4','5'],'default page names');
  ok(E.renameInvPage(st,3,'Materials').ok);
  eq(st.inv.names[3],'Materials');
  eq(E.invPageNames(st)[3],'Materials');
  const bad=E.renameInvPage(st,99,'Nope');
  ok(!bad.ok,'out-of-range page rename rejected');
});

T('inventory: renameInvPage materializes names[] defensively on a state built without one',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState(); // this fixture's inv has no `names` field at all
  ok(!st.inv.names,'fixture sanity: no names field yet');
  ok(E.renameInvPage(st,0,'Consumables').ok);
  eq(st.inv.names.length,5,'names[] materialized to full PAGE_COUNT length');
  eq(st.inv.names[0],'Consumables');
  eq(st.inv.names[1],'2','untouched slots fall back to default "N"');
});

T('REQ-0033 uid invariant: home-duplication across inventory pages is caught; a uid shared by MULTIPLE squads is NOT a violation',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  const r1=E.checkUidInvariant(migrated);
  eq(r1,{ok:true,duplicates:[]},'freshly migrated state satisfies the invariant');
  // legitimate sharing: reference alpha (and its home-contained POs,
  // including p3/flame_tablet) into a second, currently-empty squad --
  // this must NOT be flagged (it is exactly the yellow/shared case the
  // reference model exists to allow).
  E.switchSquad(migrated,1);
  const alphaPage=E.homeLocationOf(migrated,'alpha').page;
  ok(E.transferBP(migrated,{loc:'inv',page:alphaPage},{loc:'canvas'},'alpha',[1,1]).ok,'alpha (+contents) referenced into squad 1 too');
  E.switchSquad(migrated,0);
  ok(E.checkUidInvariant(migrated).ok,'sharing the same uid across two DIFFERENT squads is legal, not a duplicate');
  ok(E.usageOf(migrated,'p3').length===2,'sanity: p3 (home-contained in alpha) is indeed referenced by 2 squads now');
  // real violation: inject a duplicate HOME record (same uid appearing
  // twice across st.inv.pages) -- simulates a hypothetical bug where an
  // item's home got copied instead of moved.
  const dupHome=JSON.parse(JSON.stringify(migrated.inv.pages[0].pos[0]));
  migrated.inv.pages[1].pos.push(dupHome);
  const r2=E.checkUidInvariant(migrated);
  ok(!r2.ok&&r2.duplicates.includes('po:'+dupHome.uid),'duplicate HOME across two inventory pages is caught: '+JSON.stringify(r2));
});

T('REQ-0033 uid invariant: a duplicate REFERENCE within the SAME squad\'s own canvas is caught',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  ok(E.checkUidInvariant(migrated).ok,'sanity: migrated state starts clean');
  // Inject a bogus SECOND reference to an already-referenced uid into the
  // CURRENT squad's own canvas (bypassing createRef's red-rule gate --
  // simulates a hypothetical bug in some future call site).
  const dupRef=JSON.parse(JSON.stringify(migrated.pos.find(p=>p.uid==='p1')));
  dupRef.cell=[8,8];
  migrated.pos.push(dupRef);
  const r=E.checkUidInvariant(migrated);
  ok(!r.ok&&r.duplicates.some(d=>d.startsWith('po:p1@squad')),'two references to the SAME uid within one squad\'s canvas is caught: '+JSON.stringify(r));
});

T('presets: uid non-duplication invariant -- switchSquad never creates a duplicate',()=>{
  const {st,E}=fresh();
  E.switchSquad(st,1);
  ok(E.checkUidInvariant(st).ok,'invariant holds after switching to an empty squad');
  E.switchSquad(st,0);
  ok(E.checkUidInvariant(st).ok,'invariant holds after switching back');
});


T('migrateState: pre-squad legacy save gets 5 squads (slot 0 = its own canvas, 1-4 empty) and inv.names',()=>{
  const {st:legacy}=fresh();
  delete legacy.presets;
  delete legacy.inv.names;
  const legacyBps=JSON.parse(JSON.stringify(legacy.bps));
  const migrated=Engine.create(Data.ITEMS,Data.SI_DEFS,Data.LAYOUT,Data.TREES).migrateState(legacy);
  ok(migrated.presets&&migrated.presets.active===0,'migrated state has an active squad 0');
  eq(migrated.presets.names,['Squad 1','Squad 2','Squad 3','Squad 4','Squad 5']);
  eq(migrated.presets.store.length,5);
  ok(migrated.presets.store[0]===null,'active slot has no store entry');
  for(let i=1;i<5;i++)ok(migrated.presets.store[i].bps.length===0,'migrated squad '+i+' is empty');
  eq(migrated.bps,legacyBps,'the legacy canvas itself becomes squad 0 (active) content, untouched');
  eq(migrated.inv.names,['1','2','3','4','5'],'inv.names materialized to defaults');
  ok(Engine.create(Data.ITEMS,Data.SI_DEFS,Data.LAYOUT,Data.TREES).checkUidInvariant(migrated).ok,'migrated state satisfies the uid invariant');
});

T('migrateState: a state that ALREADY has squads/inv.names is left alone (idempotent)',()=>{
  const {st,E}=fresh();
  E.renameSquad(st,0,'Custom Name');
  E.renameInvPage(st,0,'Custom Page');
  const migrated=E.migrateState(st);
  eq(migrated.presets.names[0],'Custom Name','pre-existing squad name not clobbered by migration');
  eq(migrated.inv.names[0],'Custom Page','pre-existing inv page name not clobbered by migration');
});

// =======================================================================
// REQ-0033 reference model tests. Inventory is MASTER: every uid has
// exactly one HOME in st.inv.pages; the active squad's canvas (st.bps/
// pos/sis) and every inactive squad's store[i] snapshot hold REFERENCES
// (byte-identical record shape to a home record -- canPlacePO/movePO/
// cellsOf/sockets/traceBeams/combos/switchSquad all keep working
// unmodified against them). See docs/REQ/REQ-0033-inventory-reference-
// model.md's "Engine design" section for the adopted spec this suite
// exercises.
// =======================================================================

T('REQ-0033 red rule: placing (referencing) an item already used by the CURRENT squad is refused; allowed into a DIFFERENT squad',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  // p3 (flame_tablet) is already referenced by the active squad (0) --
  // referencing it again into squad 0 must fail (red rule).
  eq(E.usedByCurrent(migrated,'p3'),true,'sanity: p3 already used by current squad');
  const dup=E.createRef(migrated,'po','p3',{cell:[7,7],rot:0});
  ok(!dup.ok&&dup.why==='already referenced by current squad','re-referencing p3 into its OWN current squad is refused: '+JSON.stringify(dup));
  // remove it from squad 0, switch to an empty squad, referencing it
  // THERE is allowed (no red rule violation -- different squad).
  ok(E.removeRef(migrated,'po','p3').ok);
  E.switchSquad(migrated,1);
  // squad 1 has no BPs of its own yet -- bring alpha along so there is a
  // legal cell to drop p3 onto (canvas requires BP infrastructure).
  const alphaPage=E.homeLocationOf(migrated,'alpha').page;
  ok(E.transferBP(migrated,{loc:'inv',page:alphaPage},{loc:'canvas'},'alpha',[1,1]).ok);
  ok(E.removeRef(migrated,'po','p3').ok,'p3 arrived nested under alpha -- remove that automatic reference first');
  const r=E.createRef(migrated,'po','p3',{cell:[1,2],rot:0});
  ok(r.ok,'referencing p3 into a DIFFERENT (currently-active) squad is allowed: '+JSON.stringify(r));
  ok(E.checkUidInvariant(migrated).ok);
});

T('REQ-0033 yellow data: an item referenced by an OTHER squad is flagged yellow (and canvasYellow when it also sits on the current canvas); clears when that reference is removed',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  let tints=E.tintSets(migrated);
  ok(!tints.yellow.has('p3'),'p3 not yellow yet -- only referenced by the current squad so far');
  // reference alpha (brings p1/p2/p3) into squad 1 too
  E.switchSquad(migrated,1);
  const alphaPage=E.homeLocationOf(migrated,'alpha').page;
  ok(E.transferBP(migrated,{loc:'inv',page:alphaPage},{loc:'canvas'},'alpha',[1,1]).ok);
  E.switchSquad(migrated,0);
  tints=E.tintSets(migrated);
  ok(tints.yellow.has('p3'),'p3 now used by squad 1 too -- yellow from squad 0\'s perspective');
  ok(tints.red.has('p3'),'p3 is ALSO used by the current squad (0) -- red too (not mutually exclusive)');
  ok(tints.canvasYellow.has('p3'),'p3 sits on the CURRENT canvas and is shared -- canvasYellow set too');
  ok(!tints.yellow.has('p4'),'p4 (tower_shield, only ever in squad 0) must not be yellow');
  // remove squad 1's reference to alpha (and its nested contents) -- yellow must clear
  E.switchSquad(migrated,1);
  ok(E.transferBP(migrated,{loc:'canvas'},{loc:'inv',page:alphaPage},'alpha',[1,1]).ok);
  E.switchSquad(migrated,0);
  tints=E.tintSets(migrated);
  ok(!tints.yellow.has('p3'),'p3 no longer shared once squad 1\'s reference is removed -- yellow clears');
  ok(!tints.canvasYellow.has('p3'),'canvasYellow clears too');
  ok(tints.red.has('p3'),'p3 remains red (still used by the current squad itself)');
});

T('REQ-0033 canvas -> inv removes ONLY the reference; the home (and its arrangement) is completely untouched',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  const homeBefore=JSON.parse(JSON.stringify(E.homeLocationOf(migrated,'p4').record));
  ok(E.removeRef(migrated,'po','p4').ok,'remove tower_shield\'s reference from the current squad');
  eq(migrated.pos.some(p=>p.uid==='p4'),false,'no longer referenced by current squad canvas');
  eq(E.homeLocationOf(migrated,'p4').record,homeBefore,'home untouched -- same page, same cell, same rot');
  eq(E.usageOf(migrated,'p4'),[],'p4 now used by no squad at all');
  ok(E.checkUidInvariant(migrated).ok);
});

T('REQ-0033 BP exclusion set: a BP with 2 contained POs, 1 already used by current squad, arrives with only the other; SIs follow their (included) PO; the excluded PO\'s own SI stays behind',()=>{
  // Synthetic fixture: a 2-cell "box" BP containing two 1x1 POs side by
  // side, each with a gem socket + a seated SI, PLUS a separate small
  // "parking" BP elsewhere on the same page -- lets pA hold an
  // independent reference (on the parking BP) while box/pB stay
  // untouched, isolating the exclusion rule from the live scenario's
  // specific geometry.
  const ITEMS={
    box_po:{name:'Box PO',tags:[],shape:[[0,0]],icon:'icon-x',sockets:[{t:'gem',tags:[],ax:0.5,ay:0.5}]},
  };
  const SI_DEFS={gem_si:{name:'Gem SI',slot:'gem',reqTags:[]}};
  const LAYOUT={ROWS:8,COLS:8};
  const TREES={po:{},socket:{}};
  // REQ-0273 deliberate fixture update: the original 2-cell box put pA ON the
  // box's own unit cell [1,1] -- an ILLEGAL placement the canvas law has
  // always refused ('Unit cell') and one migrateState v4 now repairs at read
  // time (relocating pA and thereby dissolving the exclusion this test
  // exists to prove). A 3-cell box holds the unit AND both POs legally; every
  // assertion below is unchanged, including pA's would-be nested slot [3,4].
  const bp={id:'box',name:'Box',color:'#fff',shape:[[0,0],[0,1],[0,2]],origin:[1,1],unit:{id:'berserker',off:[0,0]}};
  const parking={id:'parking',name:'Parking',color:'#fff',shape:[[0,0],[0,1]],origin:[5,5],unit:{id:'berserker',off:[0,1]}};
  const st={
    linked:true,
    bps:[bp,parking],
    pos:[
      {uid:'pA',id:'box_po',loc:'grid',cell:[1,2],rot:0},
      {uid:'pB',id:'box_po',loc:'grid',cell:[1,3],rot:0},
    ],
    sis:[
      {uid:'sA',id:'gem_si',host:{po:'pA',si:0}},
      {uid:'sB',id:'gem_si',host:{po:'pB',si:0}},
    ],
    inv:{pages:[{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]}]},
    presets:{active:0,names:['Squad 1','Squad 2'],store:[null,{linked:true,bps:[],pos:[],sis:[]}]},
  };
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const migrated=E.migrateState(st); // gives box/parking/pA/pB/sA/sB inventory homes, current canvas keeps its references
  // Remove box's reference (cascades: drops pA/pB/sA/sB references too),
  // keep parking (empty BP, no contents) referenced -- then re-reference
  // pA alone onto parking's single free cell, so pA is "already used by
  // current squad" while pB/box are not.
  const boxPage=E.homeLocationOf(migrated,'box').page;
  ok(E.transferBP(migrated,{loc:'canvas'},{loc:'inv',page:boxPage},'box',[1,1]).ok,'remove box\'s reference (cascades: drops pA/pB/sA/sB references too)');
  eq(migrated.pos.length,0,'canvas fully cleared of box\'s former contents');
  ok(migrated.bps.some(b=>b.id==='parking'),'sanity: parking BP is still referenced (untouched by removing box)');
  ok(E.createRef(migrated,'po','pA',{cell:[5,5],rot:0}).ok,'pA independently re-referenced onto the parking BP\'s cell');
  const brs=E.bpReferenceSet(migrated,'box');
  eq(brs.pos,['pB'],'only pB (not already used) is included');
  eq(brs.excluded,['pA'],'pA (already used by current squad) is excluded');
  eq(brs.sis,['sB'],'sB (seated on the INCLUDED pB) follows');
  ok(!brs.sis.includes('sA'),'sA (seated on the EXCLUDED pA) does not travel');
  // now actually perform the transfer and confirm the resulting canvas state
  const r=E.transferBP(migrated,{loc:'inv',page:boxPage},{loc:'canvas'},'box',[3,3]);
  ok(r.ok,'box reference created with exclusion: '+JSON.stringify(r));
  ok(migrated.pos.some(p=>p.uid==='pB'),'pB reference now on canvas');
  ok(!migrated.pos.some(p=>p.uid==='pA'&&JSON.stringify(p.cell)===JSON.stringify([3,4])),'pA was NOT re-added at the box\'s new nested slot (it stayed at its own independent reference)');
  eq(migrated.pos.find(p=>p.uid==='pA').cell,[5,5],'pA\'s pre-existing independent reference (on parking) is undisturbed');
  ok(migrated.sis.some(a=>a.uid==='sB'),'sB reference travelled with pB');
  ok(!migrated.sis.some(a=>a.uid==='sA'),'sA (excluded PO\'s SI) did not travel -- stays un-referenced');
  ok(E.checkUidInvariant(migrated).ok);
});

T('REQ-0033 squad-owned SI seat divergence: the SAME SI uid can be seated in one squad and stowed (or seated elsewhere) in another, independently',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  // a1 (ruby gem) is seated on p2 (hilt) in the current (active) squad.
  eq(migrated.sis.find(a=>a.uid==='a1').host,{po:'p2',si:0},'sanity: a1 seated on hilt in squad 0');
  // reference beta (which contains p4/tower_shield with a gem socket) into
  // squad 1, then reference a1 there too but leave it STOWED (host:'inv')
  // -- independent of squad 0's seating.
  E.switchSquad(migrated,1);
  const betaPage=E.homeLocationOf(migrated,'beta').page;
  ok(E.transferBP(migrated,{loc:'inv',page:betaPage},{loc:'canvas'},'beta',[1,1]).ok);
  const cr=E.createRef(migrated,'si','a1',{host:'inv'});
  ok(cr.ok,'a1 referenced into squad 1, left stowed: '+JSON.stringify(cr));
  eq(migrated.sis.find(a=>a.uid==='a1').host,'inv','squad 1\'s OWN reference to a1 starts stowed');
  E.switchSquad(migrated,0);
  eq(migrated.sis.find(a=>a.uid==='a1').host,{po:'p2',si:0},'squad 0\'s reference to a1 is STILL seated on the hilt -- unaffected by squad 1\'s stowed copy');
  ok(E.checkUidInvariant(migrated).ok,'invariant holds despite the same uid having two independent seat states');
});

T('REQ-0033 isSquadIndependent: positive (no shared uids) and negative (shares a uid with another squad) cases',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  ok(E.isSquadIndependent(migrated,0),'squad 0 alone (no other squad references anything yet) is independent');
  ok(E.isSquadIndependent(migrated,1),'empty squad 1 is vacuously independent');
  // make squad 1 share alpha (+contents) with squad 0 -- both become non-independent
  E.switchSquad(migrated,1);
  const alphaPage=E.homeLocationOf(migrated,'alpha').page;
  ok(E.transferBP(migrated,{loc:'inv',page:alphaPage},{loc:'canvas'},'alpha',[1,1]).ok);
  ok(!E.isSquadIndependent(migrated,1),'squad 1 now shares alpha/p1/p2/p3 with squad 0 -- NOT independent');
  E.switchSquad(migrated,0);
  ok(!E.isSquadIndependent(migrated,0),'squad 0 is likewise no longer independent (symmetric sharing)');
  // gamma/delta/p5/p6/p7 were never touched -- squad 0 still independent
  // WITH RESPECT to those uids individually is not what isSquadIndependent
  // reports (it is whole-squad), so instead verify a THIRD, still-
  // untouched squad remains independent.
  ok(E.isSquadIndependent(migrated,2),'squad 2 (never referenced anything) remains independent');
});

T('REQ-0041 isSquadDeployable: true iff the squad canvas has >=1 BP -- a SEPARATE predicate from isSquadIndependent',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  // Squad 0 is the freshly-migrated ACTIVE squad -- the fixture's
  // top-level st.bps still holds alpha/beta/gamma/delta at this point
  // (migrateState references them in place, does not move them out of
  // the active squad's own canvas), so squad 0 has >=1 BP.
  ok(E.isSquadDeployable(migrated,0),'squad 0 (has BPs on the active canvas) is deployable');
  // Every OTHER squad starts completely empty post-migration (REQ-0031:
  // "new squads start empty") -- 0 BPs, hence NOT deployable, even
  // though (per the test immediately above) an empty squad IS vacuously
  // independent. This is the crux of "combine, don't conflate": an empty
  // squad passes isSquadIndependent but must fail isSquadDeployable.
  ok(!E.isSquadDeployable(migrated,1),'empty squad 1 has 0 BPs -- NOT deployable despite being vacuously independent');
  ok(E.isSquadIndependent(migrated,1),'(sanity) squad 1 is still independent -- isSquadDeployable is a SEPARATE, additional gate');
  // Move a BP into squad 1 via the SAME transferBP path the independence
  // test above uses -- squad 1 should become deployable the moment it
  // has >=1 BP, regardless of independence status.
  E.switchSquad(migrated,1);
  const betaPage=E.homeLocationOf(migrated,'beta').page;
  ok(E.transferBP(migrated,{loc:'inv',page:betaPage},{loc:'canvas'},'beta',[1,1]).ok);
  ok(E.isSquadDeployable(migrated,1),'squad 1 now has a BP (beta) -- deployable');
  // Out-of-range / no-squads-at-all inputs must never throw.
  ok(!E.isSquadDeployable({bps:[],pos:[],sis:[]},0),'a bare canvas-shaped object with no st.presets at all must not throw (squadCanvasOf returns null)');
});

T('REQ-0033 checkUidInvariant: catches home-duplication and per-squad reference duplication, accepts legitimate cross-squad sharing (covered above); sanity on a totally fresh un-migrated fixture (no st.inv) never throws',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState(); // no st.presets at all
  const r=E.checkUidInvariant(st);
  eq(r,{ok:true,duplicates:[]},'a state with no squads/home items at all trivially satisfies the invariant');
});

T('REQ-0033 migrateState v3: canvas-physical scenario -> homed + referenced, arrangement byte-preserved, idempotent',()=>{
  const {st:legacy,E}=fresh();
  const beforeBps=JSON.parse(JSON.stringify(legacy.bps));
  const beforePos=JSON.parse(JSON.stringify(legacy.pos.filter(p=>p.loc==='grid')));
  const migrated=E.migrateState(legacy);
  ok(migrated!==legacy,'migrateState must not mutate its input');
  // every canvas-resident uid now has a home
  for(const p of beforePos){
    const home=E.homeLocationOf(migrated,p.uid);
    ok(!!home&&home.kind==='po','PO '+p.uid+' has an inventory home after v3 migration');
  }
  for(const bp of beforeBps){
    const home=E.homeLocationOf(migrated,bp.id);
    ok(!!home&&home.kind==='bp','BP '+bp.id+' has an inventory home after v3 migration');
  }
  // arrangement byte-preserved: the CANVAS reference still shows the exact
  // same cells/origins as before migration (only "is this the sole copy"
  // changed, not the visible layout).
  eq(migrated.bps,beforeBps,'canvas BP references are byte-identical to the pre-migration physical layout');
  eq(migrated.pos.filter(p=>p.loc==='grid'),beforePos,'canvas PO references are byte-identical to the pre-migration physical layout');
  ok(E.checkUidInvariant(migrated).ok,'migrated state satisfies the reference-model invariant');
  // idempotence: migrating an already-v3 state again changes nothing
  // structurally relevant (every uid already has a home, so the second
  // pass homes nothing new).
  const migratedTwice=E.migrateState(migrated);
  eq(migratedTwice.bps,migrated.bps,'second migration pass leaves canvas BPs unchanged');
  eq(migratedTwice.pos,migrated.pos,'second migration pass leaves canvas POs unchanged');
  eq(migratedTwice.inv,migrated.inv,'second migration pass leaves inventory homes unchanged (idempotent)');
  ok(E.checkUidInvariant(migratedTwice).ok);
});

T('REQ-0033 switchSquad with references: swapping which squad is active is indifferent to reference-vs-home (structural swap only, unaffected by REQ-0033)',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  const origBps=JSON.parse(JSON.stringify(migrated.bps));
  const origPos=JSON.parse(JSON.stringify(migrated.pos));
  ok(E.switchSquad(migrated,1).ok);
  ok(migrated.bps.length===0&&migrated.pos.length===0,'squad 1 (empty) now live -- no references at all');
  ok(E.switchSquad(migrated,0).ok);
  eq(migrated.bps,origBps,'squad 0\'s references restored exactly across the round trip');
  eq(migrated.pos,origPos,'squad 0\'s PO references restored exactly');
  // homes were never touched by any of this
  ok(E.checkUidInvariant(migrated).ok);
  for(const p of origPos)ok(!!E.homeLocationOf(migrated,p.uid),'PO '+p.uid+' still has its home after switching back and forth');
});

T('REQ-0033 inv <-> inv stays physical (no reference/exclusion logic applies to a pure home relocation)',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0],[0,1],[1,0],[1,1]],origin:[1,1],unit:{id:'berserker',off:[0,0]}});
  pg.pos.push({uid:'w1',id:'wide_po',loc:'grid',cell:[1,1],rot:0});
  ok(E.transferBP(st,{loc:'inv',page:0},{loc:'inv',page:2},'bpA',[3,3]).ok,'page1 -> page3, pure home move');
  eq(st.inv.pages[0].bps.length,0,'origin page empty');
  const moved=st.inv.pages[2].bps.find(b=>b.id==='bpA');
  ok(!!moved);
  eq(moved.origin,[3,3]);
  const w1=st.inv.pages[2].pos.find(p=>p.uid==='w1');
  ok(!!w1,'w1 (home-contained PO) travelled with its BP\'s home');
});

T('REQ-0033 unit dormancy unaffected: a unit-bearing BP still contributes nothing to traceBeams while its home sits in an inventory page, REGARDLESS of whether any squad currently references it',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  const beamsBefore=E.traceBeams(migrated);
  ok(beamsBefore.some(b=>b.from==='delta'),'sanity: delta contributes a beam while referenced on the current canvas');
  ok(E.removeRef(migrated,'po','p7').ok,'remove nested jaw reference first (poInBPIn needs delta\'s own reference footprint, independent check)');
  ok(E.removeRef(migrated,'bp','delta').ok,'remove delta\'s reference entirely -- it now exists ONLY as a home, referenced by no squad');
  eq(E.usageOf(migrated,'delta'),[],'delta is referenced by zero squads');
  const beamsAfter=E.traceBeams(migrated);
  ok(!beamsAfter.some(b=>b.from==='delta'||b.to==='delta'),'delta (home-only, unreferenced by any squad) contributes nothing to traceBeams');
  const conns=E.allConnections(migrated);
  ok(!conns.some(c=>c.from.uid==='p7'||c.to.uid==='p7'),'jaw (home-only, unreferenced) contributes no connections');
});

T('REQ-0033 perf smoke: tintSets/usageOf stay fast at SQUAD_COUNT scale with the live scenario\'s item count',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  // reference every BP into every squad (worst case: everything shared
  // with everything) to maximize usageOf's scan work per uid.
  for(let i=1;i<5;i++){
    E.switchSquad(migrated,i);
    for(const bpId of ['alpha','beta','gamma']){
      if(E.usedByCurrent(migrated,bpId))continue;
      const home=E.homeLocationOf(migrated,bpId);
      if(home)E.transferBP(migrated,{loc:'inv',page:home.page},{loc:'canvas'},bpId,[1,1+3*i]);
    }
  }
  E.switchSquad(migrated,0);
  const t0=Date.now();
  for(let i=0;i<200;i++)E.tintSets(migrated);
  const elapsed=Date.now()-t0;
  ok(elapsed<1000,'200x tintSets() over a 5-squad, multiply-shared scenario should stay well under 1s (got '+elapsed+'ms) -- confirms on-demand computation (no caching) is fast enough at this scale');
});

T('REQ-0033 usedByCurrent/usedByOthers as standalone predicates match usageOf exactly',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  eq(E.usedByCurrent(migrated,'p1'),true);
  eq(E.usedByOthers(migrated,'p1'),false);
  E.switchSquad(migrated,1);
  const alphaPage=E.homeLocationOf(migrated,'alpha').page;
  ok(E.transferBP(migrated,{loc:'inv',page:alphaPage},{loc:'canvas'},'alpha',[1,1]).ok);
  eq(E.usedByCurrent(migrated,'p1'),true,'p1 used by squad 1 (now current)');
  eq(E.usedByOthers(migrated,'p1'),true,'p1 ALSO used by squad 0 (an other squad)');
  E.switchSquad(migrated,0);
  eq(E.usedByCurrent(migrated,'p1'),true,'p1 used by squad 0 (current again)');
  eq(E.usedByOthers(migrated,'p1'),true,'p1 also used by squad 1 (now an other)');
  eq(E.usedByCurrent(migrated,'p4'),true,'p4 (tower_shield) only ever referenced by squad 0');
  eq(E.usedByOthers(migrated,'p4'),false,'p4 not shared with anyone');
});

T('REQ-0033 createRef rejects a uid with no home at all (defensive: not reachable via normal client flow, but must fail cleanly not throw)',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  const r=E.createRef(migrated,'po','no-such-uid',{cell:[1,1],rot:0});
  ok(!r.ok&&r.why==='no home','referencing a nonexistent uid fails cleanly: '+JSON.stringify(r));
  eq(migrated.pos.some(p=>p.uid==='no-such-uid'),false,'nothing was pushed onto canvas');
});

T('REQ-0033 red rule applies identically to a bare SI reference (not just POs/BPs)',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  // a1 (ruby) is already referenced (seated on p2/hilt) by the current squad.
  eq(E.usedByCurrent(migrated,'a1'),true);
  const dup=E.createRef(migrated,'si','a1',{host:'inv'});
  ok(!dup.ok&&dup.why==='already referenced by current squad','re-referencing a1 (an SI) into its own current squad is refused');
});

T('REQ-0033 bpReferenceSet happy path: no exclusions when the current squad does not yet use any of the BP\'s contents',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,1); // empty squad -- references none of alpha's contents yet
  const brs=E.bpReferenceSet(migrated,'alpha');
  ok(brs.ok);
  eq(brs.excluded,[],'nothing excluded -- squad 1 has no prior references at all');
  eq(new Set(brs.pos),new Set(['p1','p2','p3']),'all 3 home-contained POs included');
});

T('REQ-0033 tintSets on a synthetic canvas-only fixture with no st.inv/st.presets never throws and reports empty sets',()=>{
  const st={linked:true,bps:[],pos:[],sis:[]};
  const E=Engine.create(Data.ITEMS,Data.SI_DEFS,Data.LAYOUT,Data.TREES);
  const t=E.tintSets(st);
  eq([...t.red],[]);
  eq([...t.yellow],[]);
  eq([...t.canvasYellow],[]);
  ok(E.isSquadIndependent(st,0),'no squads at all -- vacuously independent');
});


// =======================================================================
// REQ-0032: tab reorder (squads + inventory pages) and squad trash
// delete. Per REQ-0033 (which landed after REQ-0032 was speced and
// supersedes its "first-fit physical return" paragraph): squads hold
// REFERENCES into the shared inventory, so deleteSquad only ever drops
// a squad's reference set -- inventory homes/items are NEVER touched.
// =======================================================================

T('REQ-0032 reorderSquad: moving a squad RIGHT across the active squad shifts active left to keep pointing at the same squad',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,2); // active=2 ("Squad 3")
  const namesBefore=migrated.presets.names.slice();
  ok(E.reorderSquad(migrated,0,3).ok,'move squad 0 to index 3, straddling active(2)');
  // squad 0 (name 'Squad 1') moved from before active to at/after active
  // -> active shifts LEFT by one (2->1), still identifying "Squad 3".
  eq(migrated.presets.active,1,'active index shifted left to keep tracking Squad 3');
  eq(migrated.presets.names[1],namesBefore[2],'the squad at the new active index is still "Squad 3" by name');
  // expected name order after splice(0,1)+splice(3,0,moved): [P2,P3,P4,P1,P5]
  eq(migrated.presets.names,[namesBefore[1],namesBefore[2],namesBefore[3],namesBefore[0],namesBefore[4]]);
  ok(E.checkUidInvariant(migrated).ok);
});

T('REQ-0032 reorderSquad: moving a squad LEFT across the active squad shifts active right to keep pointing at the same squad',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,1); // active=1 ("Squad 2")
  const namesBefore=migrated.presets.names.slice();
  ok(E.reorderSquad(migrated,3,0).ok,'move squad 3 to index 0, straddling active(1) from the other side');
  // squad 3 moved from AFTER active to AT/BEFORE active -> active shifts RIGHT by one (1->2).
  eq(migrated.presets.active,2,'active index shifted right to keep tracking Squad 2');
  eq(migrated.presets.names[2],namesBefore[1],'the squad at the new active index is still "Squad 2" by name');
  eq(migrated.presets.names,[namesBefore[3],namesBefore[0],namesBefore[1],namesBefore[2],namesBefore[4]]);
  ok(E.checkUidInvariant(migrated).ok);
});

T('REQ-0032 reorderSquad: moving the ACTIVE squad itself -- active follows it to the destination index',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  // active is squad 0 by default -- give it a distinguishing rename so we can identify it post-move.
  E.renameSquad(migrated,0,'MyActive');
  ok(E.reorderSquad(migrated,0,3).ok,'move the active squad itself from 0 to 3');
  eq(migrated.presets.active,3,'active follows the moved squad to its new index');
  eq(migrated.presets.names[3],'MyActive');
  // its actual canvas content (p1..p8 etc, since it was squad 0 = the live scenario) must still be the live top-level fields
  ok(migrated.pos.some(p=>p.uid==='p3'),'the moved-and-still-active squad\'s content is still the live canvas');
  ok(E.checkUidInvariant(migrated).ok);
});

T('REQ-0032 reorderSquad: a move entirely on ONE side of active never shifts active',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,4); // active=4, last slot
  const namesBefore=migrated.presets.names.slice();
  ok(E.reorderSquad(migrated,0,1).ok,'swap-ish move entirely among indices 0/1, both before active(4)');
  eq(migrated.presets.active,4,'active untouched -- move never crossed it');
  eq(migrated.presets.names,[namesBefore[1],namesBefore[0],namesBefore[2],namesBefore[3],namesBefore[4]]);
});

T('REQ-0032 reorderSquad: squad content (store slot) moves as a SQUAD with its name, not just the label',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,1);
  const alphaPage=E.homeLocationOf(migrated,'alpha').page;
  ok(E.transferBP(migrated,{loc:'inv',page:alphaPage},{loc:'canvas'},'alpha',[1,1]).ok,'squad 1 now references alpha (+ contents)');
  E.renameSquad(migrated,1,'HasAlpha');
  E.switchSquad(migrated,0); // squad 1's content now lives in store[1]
  ok(E.reorderSquad(migrated,1,4).ok,'move squad 1 (HasAlpha, currently inactive) to the end');
  eq(migrated.presets.names[4],'HasAlpha');
  ok(migrated.presets.store[4].bps.some(b=>b.id==='alpha'),'the alpha reference moved WITH its squad to slot 4, not left behind');
  eq(migrated.presets.store[1],null===migrated.presets.store[1]?null:migrated.presets.store[1],'sanity no-op');
  ok(E.checkUidInvariant(migrated).ok);
});

T('REQ-0032 reorderSquad: rejects out-of-range indices and no-ops on from===to',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  const before=JSON.stringify(migrated.presets);
  const bad1=E.reorderSquad(migrated,0,99);
  ok(!bad1.ok,'to index out of range rejected');
  const bad2=E.reorderSquad(migrated,-1,2);
  ok(!bad2.ok,'from index out of range rejected');
  eq(JSON.stringify(migrated.presets),before,'rejected calls never mutate state');
  ok(E.reorderSquad(migrated,2,2).ok,'from===to is a no-op success');
  eq(JSON.stringify(migrated.presets),before,'no-op leaves state byte-identical');
});

T('REQ-0032 reorderInvPage: moving a page RIGHT across the active page (client-side index rule mirrored here on inv.pages)',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  // Manually distribute recognizable markers across pages 0-3 (names) so we
  // can track identity through the reorder independent of content.
  migrated.inv.names=['Alpha','Bravo','Charlie','Delta','Echo'];
  const namesBefore=migrated.inv.names.slice();
  const activeInvPage=1; // simulate the client's activeInvPage tracking 'Bravo'
  ok(E.reorderInvPage(migrated,0,3).ok,'move page 0 to index 3, straddling activeInvPage(1)');
  // mirror of reorderSquadIndex, applied by hand (client owns this, but we verify the same rule produces a correct result)
  const newActive=(0<activeInvPage&&3>=activeInvPage)?activeInvPage-1:activeInvPage;
  eq(newActive,0,'the mirrored index rule points at 0');
  eq(migrated.inv.names[newActive],'Bravo','page at the recomputed active index is still Bravo by name');
  eq(migrated.inv.names,['Bravo','Charlie','Delta','Alpha','Echo']);
});

T('REQ-0032 reorderInvPage: moving the page currently marked active (client concept) -- names/content track the destination',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  migrated.inv.names=['Alpha','Bravo','Charlie','Delta','Echo'];
  ok(E.reorderInvPage(migrated,1,4).ok,'move page 1 (Bravo) to the end');
  eq(migrated.inv.names,['Alpha','Charlie','Delta','Echo','Bravo']);
  // "active follows" is the client's job (activeInvPage=1 -> 4); assert the
  // engine-side data the client would read at index 4 is indeed Bravo's.
  eq(migrated.inv.names[4],'Bravo');
});

T('REQ-0032 reorderInvPage: page contents (items/BPs/homes) move WITH the page, not left behind',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  // everything currently homes on page 0 (see fixture audit) -- move page 0
  // (holding alpha/beta/gamma/delta + p1-p8 + a1-a6) to index 2.
  const page0Before=JSON.parse(JSON.stringify(migrated.inv.pages[0]));
  // expected page contents after the move: identical EXCEPT free-placed
  // SIs' embedded host.page is correctly rewritten 0->2 (see the dedicated
  // host.page remap test below for that behavior in isolation).
  const expected=JSON.parse(JSON.stringify(page0Before));
  for(const a of expected.sis){if(a.host&&typeof a.host==='object'&&'page' in a.host)a.host.page=2;}
  ok(E.reorderInvPage(migrated,0,2).ok);
  eq(migrated.inv.pages[2],expected,'the full page object (bps/pos/sis) landed intact at its new index, host.page corrected');
  eq(migrated.inv.pages[0].pos.length,0,'the page that used to be at 0 (previously empty page 1) is now at 0, still empty');
  ok(E.checkUidInvariant(migrated).ok,'moving inventory pages never disturbs the home/reference invariant');
  ok(E.homeLocationOf(migrated,'alpha').page===2,'homeLocationOf finds alpha at its NEW page index (live scan, self-correcting)');
});

T('REQ-0032 reorderInvPage: embedded free-placed-SI host.page is remapped to the item\'s new page index',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  // a free-placed (unseated) SI home record on page 1, matching the shape
  // migrateCanvasToReferencesV3 produces: {uid,id,host:{page,cell}}.
  st.inv.pages[1].sis.push({uid:'freeSi1',id:'small_si',host:{page:1,cell:[2,2]}});
  ok(E.reorderInvPage(st,1,3).ok,'move page 1 (holding freeSi1) to index 3');
  const moved=st.inv.pages[3].sis.find(a=>a.uid==='freeSi1');
  ok(moved,'the SI home record moved to page 3 with its page');
  eq(moved.host.page,3,'host.page was rewritten to match the SI\'s actual new page index');
  eq(moved.host.cell,[2,2],'cell untouched by the reorder (only the page number changed)');
});

T('REQ-0032 reorderInvPage: rejects out-of-range indices and no-ops on from===to; materializes names[] defensively',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=invBPFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState(); // this fixture's inv has no `names` field at all
  const bad1=E.reorderInvPage(st,0,99);
  ok(!bad1.ok,'to index out of range rejected');
  const bad2=E.reorderInvPage(st,-1,2);
  ok(!bad2.ok,'from index out of range rejected');
  ok(E.reorderInvPage(st,2,2).ok,'from===to is a no-op success');
  ok(E.reorderInvPage(st,0,1).ok,'a real move materializes names[] defensively');
  eq(st.inv.names.length,5,'names[] materialized to full PAGE_COUNT length even though the fixture never had one');
});

T('REQ-0032 deleteSquad: deleting a NON-active squad leaves active pointing at the SAME squad (index shifts left if deleted-before)',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,2); // active=2 ("Squad 3")
  const activeName=migrated.presets.names[2];
  ok(E.deleteSquad(migrated,0).ok,'delete squad 0 (before active)');
  eq(migrated.presets.names.length,4);
  eq(migrated.presets.active,1,'active shifted left by one since the deleted slot was before it');
  eq(migrated.presets.names[1],activeName,'active index still identifies the SAME squad (Squad 3) by name');
  ok(E.checkUidInvariant(migrated).ok);
});

T('REQ-0032 deleteSquad: deleting the ACTIVE squad lands on the nearest remaining tab (same index if occupied)',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,1); // active=1 ("Squad 2"), NOT the last slot
  const namesBefore=migrated.presets.names.slice();
  ok(E.deleteSquad(migrated,1).ok,'delete the active squad itself');
  eq(migrated.presets.names.length,4);
  eq(migrated.presets.active,1,'lands on the SAME index -- the squad that used to be at 2 (Squad 3) now occupies it');
  eq(migrated.presets.names[1],namesBefore[2],'index 1 now shows what used to be Squad 3 (nearest remaining tab)');
});

T('REQ-0032 deleteSquad: deleting the ACTIVE squad when it was the LAST slot falls back to the new last index',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,4); // active=4, the LAST slot
  const namesBefore=migrated.presets.names.slice();
  ok(E.deleteSquad(migrated,4).ok,'delete the active squad, which was the last slot');
  eq(migrated.presets.names.length,4);
  eq(migrated.presets.active,3,'lands on the new last index (3) -- there is no slot 4 anymore');
  eq(migrated.presets.names[3],namesBefore[3],'index 3 still shows the squad that was already there (Squad 4)');
});

T('REQ-0032 deleteSquad: refuses to delete the LAST remaining squad -- state completely unchanged',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  // collapse down to exactly 1 squad first
  ok(E.deleteSquad(migrated,4).ok);
  ok(E.deleteSquad(migrated,3).ok);
  ok(E.deleteSquad(migrated,2).ok);
  ok(E.deleteSquad(migrated,1).ok);
  eq(migrated.presets.names.length,1,'sanity: down to exactly 1 squad');
  const before=JSON.stringify(migrated.presets);
  const beforeInv=JSON.stringify(migrated.inv);
  const r=E.deleteSquad(migrated,0);
  ok(!r.ok,'refused: cannot delete the last remaining squad');
  eq(JSON.stringify(migrated.presets),before,'squads completely unchanged by the refused call');
  eq(JSON.stringify(migrated.inv),beforeInv,'inventory completely unchanged too');
});

T('REQ-0032 deleteSquad: drops ONLY the squad\'s reference set -- inventory items/homes are COMPLETELY untouched (REQ-0033 supersedes physical first-fit-return)',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,1);
  const alphaPage=E.homeLocationOf(migrated,'alpha').page;
  ok(E.transferBP(migrated,{loc:'inv',page:alphaPage},{loc:'canvas'},'alpha',[1,1]).ok,'squad 1 references alpha (+contents: p1,p2 -- p3 excluded, already used by squad 0)');
  const invBefore=JSON.parse(JSON.stringify(migrated.inv));
  ok(E.usageOf(migrated,'alpha').includes(1),'sanity: squad 1 uses alpha before delete');
  E.switchSquad(migrated,0);
  ok(E.deleteSquad(migrated,1).ok,'delete squad 1 (non-active, holds the alpha reference)');
  eq(JSON.parse(JSON.stringify(migrated.inv)),invBefore,'inventory (all homes, all items, all positions) is BYTE-IDENTICAL after the delete');
  ok(!E.usageOf(migrated,'alpha').includes(1),'alpha\'s reference from the deleted squad is simply gone (usageOf no longer includes any slot holding it, since squad 1 doesn\'t exist anymore)');
  ok(E.checkUidInvariant(migrated).ok);
});

T('REQ-0032 tint recompute after REORDER: a red/yellow-tinted item\'s tint state survives a reorder of unrelated squads',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,1);
  const alphaPage=E.homeLocationOf(migrated,'alpha').page;
  ok(E.transferBP(migrated,{loc:'inv',page:alphaPage},{loc:'canvas'},'alpha',[1,1]).ok,'squad 1 shares alpha/p1/p2 with squad 0');
  E.switchSquad(migrated,0);
  const tintsBefore=E.tintSets(migrated);
  ok(tintsBefore.yellow.has('p1')&&tintsBefore.yellow.has('alpha'),'sanity: p1/alpha yellow (shared with squad 1) before reorder');
  // reorder squads 3 and 4 (both unrelated to the sharing between 0 and 1) -- must not disturb tint state at all.
  ok(E.reorderSquad(migrated,3,4).ok);
  const tintsAfter=E.tintSets(migrated);
  eq([...tintsAfter.red].sort(),[...tintsBefore.red].sort(),'red set unchanged by an unrelated reorder');
  eq([...tintsAfter.yellow].sort(),[...tintsBefore.yellow].sort(),'yellow set unchanged by an unrelated reorder');
  ok(tintsAfter.yellow.has('p1')&&tintsAfter.yellow.has('alpha'),'p1/alpha still correctly yellow after the reorder');
});

T('REQ-0032 tint recompute after DELETE: a deleted squad\'s tint contribution disappears without affecting other squads\' tint state',()=>{
  const {st,E}=fresh();
  const migrated=E.migrateState(st);
  E.switchSquad(migrated,1);
  const alphaPage=E.homeLocationOf(migrated,'alpha').page;
  ok(E.transferBP(migrated,{loc:'inv',page:alphaPage},{loc:'canvas'},'alpha',[1,1]).ok,'squad 1 shares alpha/p1/p2 with squad 0');
  // also give squad 2 its own INDEPENDENT reference, unrelated to the alpha sharing, to prove it survives untouched.
  E.switchSquad(migrated,2);
  const deltaPage=E.homeLocationOf(migrated,'delta').page;
  ok(E.transferBP(migrated,{loc:'inv',page:deltaPage},{loc:'canvas'},'delta',[1,1]).ok,'squad 2 independently references delta');
  E.switchSquad(migrated,0);
  ok(E.tintSets(migrated).yellow.has('delta'),'sanity: delta yellow too (shared between squad 0-home and squad 2 reference)');
  ok(E.deleteSquad(migrated,1).ok,'delete squad 1 -- drops the alpha/p1/p2 sharing entirely');
  const tints=E.tintSets(migrated);
  ok(!tints.yellow.has('p1'),'p1 no longer yellow -- its only OTHER reference (squad 1) is gone');
  ok(!tints.yellow.has('alpha'),'alpha no longer yellow either');
  ok(tints.red.has('p1')&&tints.red.has('alpha'),'p1/alpha remain red -- still used by the current squad (0) itself, home untouched');
  // delta's sharing (with the surviving squad 2, renumbered after the splice) must be unaffected.
  ok(tints.yellow.has('delta'),'delta STILL yellow -- its sharing with the surviving squad (now at index 1 post-splice) is untouched by an unrelated squad\'s deletion');
  ok(E.checkUidInvariant(migrated).ok);
});

// ---------------------------------------------------------------------
// REQ-0042: TM (Transmutator) model tests. Reuses invBPFixture()'s small
// ITEMS/LAYOUT shape (same pattern as the free-SI occupancy tests above)
// but each freshState() page needs tms:[] added by hand here since
// invBPFixture()'s own freshState() predates REQ-0042 (byte-identical to
// the pre-existing fixture, tms:[] appended) -- this ALSO exercises the
// exact "old-shaped page" case migrateStateV2's backfill loop is meant to
// repair, see the dedicated migrateState test below for that path
// specifically.
function tmFixture(){
  const base=invBPFixture();
  function freshState(){
    const st=base.freshState();
    for(const pg of st.inv.pages)pg.tms=[];
    return st;
  }
  return {...base,freshState};
}

T('REQ-0042 TM: place onto an empty page cell',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const chk=E.tmCanPlace(st,0,'t1',[5,5]);
  ok(chk.ok,'empty cell should accept a fresh TM stack: '+JSON.stringify(chk));
  const mv=E.tmMove(st,0,'t1',[5,5],'lrdst',10);
  ok(mv.ok,'tmMove with idIfNew/qtyIfNew should mint a fresh stack: '+JSON.stringify(mv));
  const rec=st.inv.pages[0].tms.find(t=>t.uid==='t1');
  ok(rec&&rec.id==='lrdst'&&rec.qty===10,'fresh stack minted with correct id/qty: '+JSON.stringify(rec));
  eq(rec.cell,[5,5],'fresh stack cell recorded');
});

T('REQ-0042 TM: 1x1 footprint collides with BP/PO/SI/another-id-TM exactly like a free SI',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.bps.push({id:'bpA',name:'BP A',color:'#fff',shape:[[0,0]],origin:[1,1],unit:{id:'berserker',off:[0,0]}});
  pg.pos.push({uid:'p1',id:'small_po',loc:'grid',cell:[3,3],rot:0});
  pg.sis.push({uid:'s2',id:'small_si',host:{page:0,cell:[4,4]}});
  pg.tms.push({uid:'t1',id:'lrdst',qty:5,cell:[6,6]});
  ok(!E.tmCanPlace(st,0,'t9',[0,0]).ok,'out of bounds rejected');
  const onBp=E.tmCanPlace(st,0,'t9',[1,1]);
  ok(!onBp.ok&&onBp.why==='BP-overlap','TM landing on a BP cell must be rejected: '+JSON.stringify(onBp));
  const onPo=E.tmCanPlace(st,0,'t9',[3,3]);
  ok(!onPo.ok&&onPo.why==='occupied','TM landing on a PO cell must be rejected: '+JSON.stringify(onPo));
  const onSi=E.tmCanPlace(st,0,'t9',[4,4]);
  ok(!onSi.ok&&onSi.why==='occupied','TM landing on a free SI cell must be rejected: '+JSON.stringify(onSi));
  const onOtherIdTm=E.tmCanPlace(st,0,'t9',[6,6]);
  ok(!onOtherIdTm.ok&&onOtherIdTm.why==='occupied','TM landing on a DIFFERENT-id TM stack must be rejected: '+JSON.stringify(onOtherIdTm));
  ok(E.tmCanPlace(st,0,'t9',[5,5]).ok,'empty page cell should accept the TM');
});

T('REQ-0042 TM: move relocates an existing stack (no merge) when the destination is empty',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  st.inv.pages[0].tms.push({uid:'t1',id:'lrdst',qty:5,cell:[2,2]});
  const mv=E.tmMove(st,0,'t1',[5,5]);
  ok(mv.ok,'move to an empty cell should succeed: '+JSON.stringify(mv));
  const rec=st.inv.pages[0].tms.find(t=>t.uid==='t1');
  eq(rec.cell,[5,5],'stack relocated');
  eq(rec.qty,5,'qty unchanged by a plain move');
  eq(st.inv.pages[0].tms.length,1,'still exactly one stack -- no merge happened');
});

T('REQ-0042 TM: drop onto an existing SAME-id stack MERGES quantities -- destination uid survives, dragged uid discarded',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.tms.push({uid:'dest1',id:'lrdst',qty:7,cell:[5,5]});
  pg.tms.push({uid:'dragged1',id:'lrdst',qty:3,cell:[2,2]});
  const chk=E.tmCanPlace(st,0,'dragged1',[5,5]);
  ok(chk.ok&&chk.mergeInto==='dest1','same-id drop reports a merge target: '+JSON.stringify(chk));
  const mv=E.tmMove(st,0,'dragged1',[5,5]);
  ok(mv.ok&&mv.mergedInto==='dest1','tmMove performs the merge: '+JSON.stringify(mv));
  eq(pg.tms.length,1,'exactly one stack survives the merge');
  const survivor=pg.tms[0];
  eq(survivor.uid,'dest1','the DESTINATION stack uid survives (documented judgment call)');
  eq(survivor.qty,10,'quantities summed (7+3)');
  ok(!pg.tms.find(t=>t.uid==='dragged1'),'the dragged uid record is gone entirely');
});

T('REQ-0042 TM: tmMove with a BRAND NEW uid (no prior tms[] record -- the grant/reward/gacha-mint/claim-merge shape) merges into an existing same-id stack on first placement',()=>{
  // Regression test for a real bug caught by E2E coverage of the
  // warehouse TM-claim-merge flow (client/e2e/workshop.spec.ts): the
  // test above pre-seeds BOTH 'dest1' and 'dragged1' as EXISTING tms[]
  // records before merging them, which never exercises the actual shape
  // every real call site uses (WarehouseTab.tsx's firstFitOrMergeTM,
  // WorkshopPage.tsx's refund path) -- a freshly-claimed/granted/minted
  // uid that has NEVER been in tms[] before, merging on its very first
  // tmMove call via idIfNew/qtyIfNew. tmMove used to check "does uid
  // already have a rec" BEFORE checking chk.mergeInto, so this exact
  // shape always minted a duplicate stack instead of merging.
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.tms.push({uid:'existing1',id:'lrdst',qty:50,cell:[5,5]});
  const chk=E.tmCanPlace(st,0,'brand_new_uid',[5,5],undefined,'lrdst');
  ok(chk.ok&&chk.mergeInto==='existing1','brand-new uid landing on an existing stack reports a merge target: '+JSON.stringify(chk));
  const mv=E.tmMove(st,0,'brand_new_uid',[5,5],'lrdst',25);
  ok(mv.ok&&mv.mergedInto==='existing1','tmMove merges a brand-new uid into the existing stack rather than minting a duplicate: '+JSON.stringify(mv));
  eq(pg.tms.length,1,'exactly one stack -- no duplicate minted');
  eq(pg.tms[0].uid,'existing1','the pre-existing stack uid survives');
  eq(pg.tms[0].qty,75,'quantities summed (50+25)');
  ok(!pg.tms.find(t=>t.uid==='brand_new_uid'),'no stray brand_new_uid record was ever left behind');
});

T('REQ-0042 TM: drop onto a DIFFERENT-id stack is a plain collision, not a merge',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.tms.push({uid:'dest1',id:'other_tm',qty:7,cell:[5,5]});
  pg.tms.push({uid:'dragged1',id:'lrdst',qty:3,cell:[2,2]});
  const chk=E.tmCanPlace(st,0,'dragged1',[5,5]);
  ok(!chk.ok&&chk.why==='occupied','different-id drop is rejected as occupied, not merged: '+JSON.stringify(chk));
});

T('REQ-0042 spendTM: sufficient balance drains largest-stack-first within one page',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.tms.push({uid:'big',id:'lrdst',qty:20,cell:[1,1]});
  pg.tms.push({uid:'small',id:'lrdst',qty:5,cell:[2,2]});
  const res=E.spendTM(st,0,'lrdst',22);
  ok(res.ok,'spend of 22 against a 25 total should succeed: '+JSON.stringify(res));
  const big=pg.tms.find(t=>t.uid==='big');
  const small=pg.tms.find(t=>t.uid==='small');
  ok(!big,'the LARGEST stack is drained FIRST and fully consumed (20 of the 22 spent)');
  ok(small&&small.qty===3,'remaining 2 spent from the smaller stack, 3 left: '+JSON.stringify(small));
});

T('REQ-0042 spendTM: insufficient balance fails cleanly with NO partial mutation',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  const pg=st.inv.pages[0];
  pg.tms.push({uid:'big',id:'lrdst',qty:5,cell:[1,1]});
  pg.tms.push({uid:'small',id:'lrdst',qty:3,cell:[2,2]});
  const before=JSON.parse(JSON.stringify(pg.tms));
  const res=E.spendTM(st,0,'lrdst',100);
  ok(!res.ok&&res.why==='insufficient','spend of 100 against an 8 total must fail: '+JSON.stringify(res));
  eq(pg.tms,before,'page tms[] completely unchanged after a failed spend -- no partial mutation');
});

T('REQ-0042 migrateState: an old-shaped page (no .tms key at all) is defensively backfilled with tms:[]',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  // Deliberately OMIT tms from every page -- simulates a save persisted
  // before REQ-0042 shipped (post-REQ-0030 page shape {bps,pos,sis} only).
  const oldSt={
    linked:true,bps:[],pos:[],sis:[],
    inv:{pages:[{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]},{bps:[],pos:[],sis:[]}]},
  };
  ok(!Array.isArray(oldSt.inv.pages[0].tms),'sanity: fixture truly has no .tms key pre-migration');
  const migrated=E.migrateState(oldSt);
  for(let i=0;i<5;i++){
    ok(Array.isArray(migrated.inv.pages[i].tms),'page '+i+' gets a backfilled tms:[] array');
    eq(migrated.inv.pages[i].tms,[],'backfilled tms[] starts empty');
  }
  // idempotent: migrating an already-migrated state must leave tms[] alone.
  migrated.inv.pages[0].tms.push({uid:'t1',id:'lrdst',qty:1,cell:[1,1]});
  const migratedAgain=E.migrateState(migrated);
  eq(migratedAgain.inv.pages[0].tms,[{uid:'t1',id:'lrdst',qty:1,cell:[1,1]}],'a second migrateState call must not disturb existing tms[] contents');
});

T('REQ-0042 checkUidInvariant: catches a duplicate TM uid across two pages',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  ok(E.checkUidInvariant(st).ok,'sanity: fresh empty state has no invariant violation');
  st.inv.pages[0].tms.push({uid:'dupe',id:'lrdst',qty:1,cell:[1,1]});
  st.inv.pages[1].tms.push({uid:'dupe',id:'lrdst',qty:1,cell:[1,1]});
  const audit=E.checkUidInvariant(st);
  ok(!audit.ok,'duplicate TM uid across two pages must be caught');
  ok(audit.duplicates.includes('tm:dupe'),'duplicates list names the tm:-tagged uid: '+JSON.stringify(audit.duplicates));
});

T('REQ-0042 checkUidInvariant: a TM uid and a PO uid sharing the same literal string do NOT collide (independent tag namespaces, matches existing po/bp/si behavior)',()=>{
  const {ITEMS,SI_DEFS,LAYOUT,TREES,freshState}=tmFixture();
  const E=Engine.create(ITEMS,SI_DEFS,LAYOUT,TREES);
  const st=freshState();
  st.inv.pages[0].pos.push({uid:'shared1',id:'small_po',loc:'grid',cell:[1,1],rot:0});
  st.inv.pages[0].tms.push({uid:'shared1',id:'lrdst',qty:1,cell:[2,2]});
  ok(E.checkUidInvariant(st).ok,'a PO and a TM sharing the same uid string is NOT flagged -- independent tag namespaces');
});


// =====================================================================
// REQ-0045 (a2): BP rotation (canRotateBP/rotateBP canvas,
// invCanRotateBP/invRotateBP inventory). A genuine physical 90-degree-CW
// rotation of the whole BP: shape (about its own bbox), unit cell +
// dirs (+2 mod 8), and every contained PO's cell + rot (+1 mod 4).
// =====================================================================
function rotateFixtureItems(){
  return { test_po:{name:'Test PO',tags:[],shape:[[0,0]],icon:'icon-x',sockets:[]} };
}

T('REQ-0045 rotateBP: canvas -- an L-shaped BP with an off-center unit and one contained PO rotates correctly (cell/dir remapping)',()=>{
  const E=Engine.create(rotateFixtureItems(),{},{ROWS:8,COLS:8},{po:{},socket:{}},Data.UNITS,Data.CONN_SHAPES);
  const st={
    linked:true,
    bps:[{id:'lshape',name:'L',color:'#fff',shape:[[0,0],[1,0],[2,0],[2,1]],origin:[2,2],unit:{id:'angel',off:[2,1]}}],
    pos:[{uid:'p1',id:'test_po',loc:'grid',cell:[4,3],rot:0}], // sits on the shape's foot cell (local [2,1] -> absolute [4,3])
    sis:[],
  };
  const before=JSON.parse(JSON.stringify(st));
  const r=E.rotateBP(st,'lshape');
  ok(r.ok,'rotation of an unobstructed BP must succeed: '+JSON.stringify(r));
  const bp=st.bps[0];
  // Shape: [r,c]->[c,-r] then renormalized. Original offsets
  // [[0,0],[1,0],[2,0],[2,1]] -> raw rotated [[0,0],[0,-1],[0,-2],[1,-2]]
  // -> min row 0, min col -2 -> renormalized [[0,2],[0,1],[0,0],[1,0]].
  eq(bp.shape,[[0,2],[0,1],[0,0],[1,0]],'shape rotated 90deg CW about its own bbox');
  // Unit off [2,1] -> raw rotated [1,-2] -> renormalized (same mr=0,mc=-2) -> [1,0].
  eq(bp.unit.off,[1,0],'unit cell rotates WITH the shape (same renormalization delta)');
  // Dirs [0,2] (N,E) -> +2 mod 8 -> [2,4] (E,S).
  eq(E.connShapeOf(bp).dirs,[0,1,2,3,4,5,6,7],'REQ-0170: the rays do NOT rotate with the bag -- a connection shape is the UNIT\'s, and its dirs are board-absolute (vocab.orientation). Rotating the BP moves the seat, not the compass.');
  eq(bp.origin,[2,2],'BP origin itself does not move during an in-place rotation');
  // The contained PO sat on the foot cell (local [2,1], absolute [4,3]);
  // after rotation the foot is now at local [1,0] -> absolute [3,2]; the
  // PO travels there, and its own rot advances 0->1 (matching rotatePO's
  // own +1 mod 4 convention).
  const po=st.pos.find(p=>p.uid==='p1');
  eq(po.cell,[3,2],'contained PO cell remapped through the same rotation transform');
  eq(po.rot,1,'contained PO rot advances by 1 (mod 4), same amount the BP itself turned');
  ok(JSON.stringify(st)!==JSON.stringify(before),'sanity: state actually changed');
});

T('REQ-0045 rotateBP: canvas -- 4x rotate returns to the EXACT original state (shape, PO cell/rot, unit cell/dir) -- identity',()=>{
  const E=Engine.create(rotateFixtureItems(),{},{ROWS:8,COLS:8},{po:{},socket:{}},Data.UNITS,Data.CONN_SHAPES);
  const st={
    linked:true,
    bps:[{id:'lshape',name:'L',color:'#fff',shape:[[0,0],[1,0],[2,0],[2,1]],origin:[2,2],unit:{id:'angel',off:[2,1]}}],
    pos:[{uid:'p1',id:'test_po',loc:'grid',cell:[4,3],rot:0}],
    sis:[],
  };
  const original=JSON.parse(JSON.stringify(st));
  for(let i=0;i<4;i++){
    const r=E.rotateBP(st,'lshape');
    ok(r.ok,'rotation '+(i+1)+' of 4 must succeed (BP has room to turn freely): '+JSON.stringify(r));
  }
  eq(st.bps[0].shape,original.bps[0].shape,'shape identical after 4x rotation');
  eq(st.bps[0].unit,original.bps[0].unit,'unit identity+seat identical after 4x rotation');
  eq(st.bps[0].origin,original.bps[0].origin,'origin identical after 4x rotation');
  eq(st.pos[0].cell,original.pos[0].cell,'contained PO cell identical after 4x rotation');
  eq(st.pos[0].rot,original.pos[0].rot,'contained PO rot identical after 4x rotation (1+1+1+1=4 mod 4=0)');
});

T('REQ-0045 canRotateBP: canvas -- blocked when the rotated footprint would overlap another BP; state completely unchanged on refusal',()=>{
  const E=Engine.create(rotateFixtureItems(),{},{ROWS:8,COLS:8},{po:{},socket:{}},Data.UNITS,Data.CONN_SHAPES);
  const st={
    linked:true,
    bps:[
      {id:'lshape',name:'L',color:'#fff',shape:[[0,0],[1,0],[2,0],[2,1]],origin:[2,2],unit:{id:'berserker',off:[0,0]}},
      // Sits exactly on a cell the rotated footprint will need (see the
      // shape-rotation test above: rotated absolute cells are origin+
      // [[0,2],[0,1],[0,0],[1,0]] = (2,4),(2,3),(2,2),(3,2)).
      {id:'blocker',name:'B',color:'#000',shape:[[0,0]],origin:[2,4],unit:{id:'berserker',off:[0,0]}},
    ],
    pos:[],sis:[],
  };
  const before=JSON.parse(JSON.stringify(st));
  const chk=E.canRotateBP(st,'lshape');
  ok(!chk.ok&&chk.why==='overlaps another BP','rotation into an occupied cell must be refused: '+JSON.stringify(chk));
  const r=E.rotateBP(st,'lshape');
  ok(!r.ok,'rotateBP must also refuse (delegates to canRotateBP)');
  eq(st,before,'state completely unchanged after a refused rotation (all-or-nothing, matches moveBP discipline)');
});

T('REQ-0045 canRotateBP: canvas -- blocked when rotation would push the shape outside canvas bounds',()=>{
  const E=Engine.create(rotateFixtureItems(),{},{ROWS:8,COLS:8},{po:{},socket:{}},Data.UNITS,Data.CONN_SHAPES);
  // A 1x4 horizontal bar with its origin at the top-right corner: rotating
  // to vertical needs 4 rows downward, which fits (8 rows) -- instead
  // place it so the rotated vertical bar would run past row 8.
  const st={
    linked:true,
    bps:[{id:'bar',name:'Bar',color:'#fff',shape:[[0,0],[0,1],[0,2],[0,3]],origin:[6,1],unit:{id:'berserker',off:[0,0]}}],
    pos:[],sis:[],
  };
  const chk=E.canRotateBP(st,'bar');
  ok(!chk.ok&&chk.why==='outside canvas','rotating a 4-long bar from row 6 would run to row 9, past ROWS=8: '+JSON.stringify(chk));
});

T('REQ-0045 invRotateBP: inventory page -- same math as canvas, contained PO travels, free-item occupancy excludes the BP\'s OWN contents',()=>{
  const E=Engine.create(rotateFixtureItems(),{},{ROWS:8,COLS:8},{po:{},socket:{}},Data.UNITS,Data.CONN_SHAPES);
  const st={
    linked:true,bps:[],pos:[],sis:[],
    inv:{pages:[
      {bps:[{id:'inv_l',name:'IL',color:'#fff',shape:[[0,0],[1,0],[2,0],[2,1]],origin:[2,2],unit:{id:'angel',off:[2,1]}}],
       pos:[{uid:'ip1',id:'test_po',loc:'grid',cell:[4,3],rot:0}],sis:[],tms:[]},
      {bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},
    ],names:['1','2','3','4','5']},
  };
  const chk=E.invCanRotateBP(st,0,'inv_l');
  ok(chk.ok,'unobstructed inventory rotation must be legal (BP OWN contained PO must not self-block): '+JSON.stringify(chk));
  const r=E.invRotateBP(st,0,'inv_l');
  ok(r.ok,'inventory rotation commit succeeds');
  const bp=st.inv.pages[0].bps[0];
  eq(bp.shape,[[0,2],[0,1],[0,0],[1,0]],'inventory BP shape rotates identically to the canvas math');
  eq(bp.unit.off,[1,0],'inventory unit SEAT rotates identically to the canvas path (and, per REQ-0170, its rays do not rotate at all)');
  const po=st.inv.pages[0].pos.find(p=>p.uid==='ip1');
  eq(po.cell,[3,2],'inventory contained PO cell remapped identically');
  eq(po.rot,1,'inventory contained PO rot advances identically');
});

T('REQ-0045 invCanRotateBP: inventory page -- blocked by an UNRELATED free-placed PO (occupancy check still applies to non-owned items)',()=>{
  const E=Engine.create(rotateFixtureItems(),{},{ROWS:8,COLS:8},{po:{},socket:{}},Data.UNITS,Data.CONN_SHAPES);
  const st={
    linked:true,bps:[],pos:[],sis:[],
    inv:{pages:[
      {bps:[{id:'inv_l',name:'IL',color:'#fff',shape:[[0,0],[1,0],[2,0],[2,1]],origin:[2,2],unit:{id:'berserker',off:[0,0]}}],
       // Foreign free PO sitting exactly on a cell the rotated footprint needs (absolute (2,4), per the shape-rotation math above).
       pos:[{uid:'foreign',id:'test_po',loc:'grid',cell:[2,4],rot:0}],sis:[],tms:[]},
      {bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},{bps:[],pos:[],sis:[],tms:[]},
    ],names:['1','2','3','4','5']},
  };
  const before=JSON.parse(JSON.stringify(st));
  const chk=E.invCanRotateBP(st,0,'inv_l');
  ok(!chk.ok&&chk.why==='overlaps free-placed item','a genuinely foreign free PO must still block rotation: '+JSON.stringify(chk));
  const r=E.invRotateBP(st,0,'inv_l');
  ok(!r.ok,'commit refused too');
  eq(st,before,'state completely unchanged after a refused inventory rotation');
});


// =====================================================================
// REQ-0170 / REQ-0128b: the connection-shape walker.
//
// The ratified model in five rules -- every one of them tested below against a
// SYNTHETIC registry (so the test pins the WALKER, not today's roster):
//   ray shapes walk `dirs` at most `range` cells (0/null = unlimited);
//   the occluder set is UNITS ONLY (BP and PO cells are transparent);
//   pierce:false links the first Unit met, pierce:true links every Unit in range;
//   offset shapes link the Unit standing on each offset cell (no range, no pierce);
//   `none` forms no links.
// =====================================================================
(function(){
  const SHAPES={
    east:      {kind:'ray',   dirs:[2], range:null, pierce:false},
    east_r2:   {kind:'ray',   dirs:[2], range:2,    pierce:false},
    east_pierce:{kind:'ray',  dirs:[2], range:null, pierce:true},
    queen:     {kind:'ray',   dirs:[0,1,2,3,4,5,6,7], range:null, pierce:false},
    knight:    {kind:'offset',offsets:[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]},
    quiet:     {kind:'none',  dirs:[]},
  };
  const UNITS={};
  for(const k of Object.keys(SHAPES))UNITS['u_'+k]={name:k,rarity:'Common',icon:'',connection_shape:k};
  const ITEMS={brick:{name:'Brick',shape:[[0,0]],tags:[],rarity:'Common',icon:'icon-x',sockets:[]}};
  const E=Engine.create(ITEMS,{},{ROWS:8,COLS:8},{po:{},socket:{}},UNITS,SHAPES);
  // a 1x1 BP whose single cell IS the unit seat -- the cleanest possible geometry
  const cell=(id,shape,origin)=>({id,name:id,color:'#fff',shape:[[0,0]],origin,unit:{id:'u_'+shape,off:[0,0]},hpMax:50});
  const st=(bps,pos)=>({linked:true,bps,pos:pos||[],sis:[]});

  T('REQ-0170 walker: an unlimited ray links the FIRST Unit on it and stops there',()=>{
    const s=st([cell('A','east',[1,1]),cell('B','east',[1,4]),cell('C','east',[1,7])]);
    const beams=E.traceBeams(s).filter(b=>b.from==='A');
    eq(beams.length,1,'east ray = exactly one beam');
    eq(beams[0].to,'B','A links B (nearer), not C');
    eq(beams[0].tos,['B'],'and only B -- pierce is off');
  });

  T('REQ-0170 walker: range caps the reach (a Unit 3 cells away is out of a range-2 ray)',()=>{
    const near=E.traceBeams(st([cell('A','east_r2',[1,1]),cell('B','east',[1,3])])).find(b=>b.from==='A');
    eq(near.to,'B','2 cells away is INSIDE range 2');
    const far=E.traceBeams(st([cell('A','east_r2',[1,1]),cell('B','east',[1,4])])).find(b=>b.from==='A');
    eq(far.to,null,'3 cells away is OUT of range 2 -- the ray simply ends');
    eq(far.path.length,2,'and it walked exactly 2 cells before ending');
  });

  T('REQ-0170 walker: pierce links EVERY Unit in range, not just the first',()=>{
    const b=E.traceBeams(st([cell('A','east_pierce',[1,1]),cell('B','east',[1,4]),cell('C','east',[1,7])])).find(x=>x.from==='A');
    eq(b.tos,['B','C'],'both Units on the ray are linked');
    eq(b.to,'B','`to` stays the FIRST hit -- every pre-REQ-0170 consumer keeps working');
  });

  T('REQ-0170 walker: the occluder set is UNITS ONLY -- a BP cell and a PO do NOT stop a ray',()=>{
    // A wide BP whose unit seat is far from the ray, plus a PO sitting ON the ray.
    const wide={id:'W',name:'W',color:'#fff',shape:[[0,0],[0,1],[0,2]],origin:[1,3],unit:{id:'u_quiet',off:[0,2]},hpMax:50};
    const s=st([cell('A','east',[1,1]),wide,cell('C','east',[1,7])],
               [{uid:'po1',id:'brick',loc:'grid',cell:[1,3],rot:0}]);
    const b=E.traceBeams(s).find(x=>x.from==='A');
    // W's own BP cells [1,3],[1,4] and the PO on [1,3] are all ON the ray, and W's
    // unit seat sits at [1,5]. Transparent cells mean the ray reaches the SEAT first.
    eq(b.to,'W','the ray passes through BP cells and a PO, and stops at the first UNIT (W\'s seat)');
  });

  T('REQ-0170 walker: an offset (knight) shape links the Unit on the jump cell -- and nothing else',()=>{
    const s=st([cell('A','knight',[3,3]),cell('B','quiet',[1,4]),cell('C','quiet',[3,6])]);
    const beams=E.traceBeams(s).filter(b=>b.from==='A');
    eq(beams.length,8,'one beam per legal offset (all 8 land on the 8x8 board from [3,3])');
    const hit=beams.filter(b=>b.to);
    eq(hit.length,1,'exactly one jump cell holds a Unit');
    eq(hit[0].to,'B','[3,3] + [-2,1] = [1,4] -> B');
    eq(hit[0].dir,null,'an offset link has no compass direction');
    eq(hit[0].offset,[-2,1],'and it reports the jump it made');
    ok(!beams.some(b=>b.to==='C'),'C is 3 cells east -- reachable by no knight offset');
  });

  T('REQ-0170 walker: offsets outside the board are dropped, never clamped',()=>{
    const beams=E.traceBeams(st([cell('A','knight',[1,1])])).filter(b=>b.from==='A');
    eq(beams.length,2,'from the corner only 2 of the 8 knight offsets stay on the board');
  });

  T('REQ-0170 walker: `none` forms no links at all (Berserker)',()=>{
    const beams=E.traceBeams(st([cell('A','quiet',[1,1]),cell('B','east',[1,4])])).filter(b=>b.from==='A');
    eq(beams.length,0,'a connection_shape of none emits no beam whatsoever');
  });

  T('REQ-0170 walker: mutual is symmetric and survives pierce',()=>{
    const beams=E.traceBeams(st([cell('A','queen',[1,1]),cell('B','queen',[1,4])]));
    const ab=beams.find(b=>b.from==='A'&&b.to==='B');
    const ba=beams.find(b=>b.from==='B'&&b.to==='A');
    ok(ab&&ab.mutual,'A->B is mutual');
    ok(ba&&ba.mutual,'B->A is mutual');
  });

  T('REQ-0170 walker: a BP whose unit id is unknown to the registry forms no links (and does not throw)',()=>{
    const orphan={id:'X',name:'X',color:'#fff',shape:[[0,0]],origin:[1,1],unit:{id:'u_ghost',off:[0,0]},hpMax:50};
    const beams=E.traceBeams(st([orphan,cell('B','east',[1,4])]));
    eq(beams.filter(b=>b.from==='X').length,0,'missing data is a non-event: no rays, no exception');
    eq(E.connShapeOf(orphan),null,'and connShapeOf says so plainly');
  });
})();


// ---------------------------------------------------------------------------
// REQ-0209 -- locked starter units: a locked BP's interior is fully immutable
// (every cell uniformly fixed; SI seat/unseat refused; only whole-BP ops --
// move/rotate/transfer/discard -- remain legal).
(function(){
  const at=(b,c)=>b.shape.some(([dr,dc])=>b.origin[0]+dr===c[0]&&b.origin[1]+dc===c[1]);

  T('REQ-0209 canvas: PO placement into a locked BP is refused, legal again unlocked',()=>{
    const {st,E}=fresh();
    const p5=st.pos.find(x=>x.uid==='p5');
    const bp=st.bps.find(b=>at(b,p5.cell));
    const hilt=st.pos.find(x=>x.id==='hilt');
    let anchor=null;
    for(const [dr,dc] of bp.shape){
      const cell=[bp.origin[0]+dr,bp.origin[1]+dc];
      if(E.canPlacePO(st,hilt.uid,hilt.rot,cell).ok){anchor=cell;break;}
    }
    ok(anchor,'fixture: a free cell exists in the target BP');
    bp.locked=true;
    const r=E.movePO(st,hilt.uid,anchor);
    ok(!r.ok&&r.why==='locked unit','refused: '+r.why);
    bp.locked=false;
    ok(E.movePO(st,hilt.uid,anchor).ok,'same placement legal once unlocked');
  });

  T('REQ-0209 canvas: SI seat and unseat refused on a PO inside a locked BP',()=>{
    const {st,E}=fresh();
    const p5=st.pos.find(x=>x.uid==='p5');
    const bp=st.bps.find(b=>at(b,p5.cell));
    const edge=E.sockets(st).find(s=>s.host==='p5'&&s.t==='edge');
    bp.locked=true;
    const r=E.seatSI(st,'a3',edge.skey);
    ok(!r.ok&&r.why==='locked unit','seat refused: '+r.why);
    bp.locked=false;
    ok(E.seatSI(st,'a3',edge.skey).ok,'seat legal once unlocked');
    bp.locked=true;
    const r2=E.stowSI(st,'a3');
    ok(!r2.ok&&r2.why==='locked unit','unseat refused: '+r2.why);
  });

  // REQ-0290 -- the lock predicate is now EXPORTED so the client's affordance
  // layer (seat X / fixed-PO padlock / locked-SI refusal) can ask the engine
  // instead of re-deriving cellBPMap -> bp.locked for itself. These tests pin
  // the export to the BEHAVIOUR it is supposed to mirror -- the refusal the
  // engine already performs -- rather than to a second copy of its logic, so a
  // future change to either one cannot drift them apart silently. That matters
  // more than usual here: tools/check_engine_types.cjs does not cover these two
  // members (its member scanner skips doc-comment-prefixed declarations, so its
  // "49 declared members verified" excludes them), which makes this suite their
  // only mechanical gate.
  T('REQ-0290 canvas: exported poInLockedBP agrees with seatSI/stowSI\'s own refusal, both ways',()=>{
    const {st,E}=fresh();
    const p5=st.pos.find(x=>x.uid==='p5');
    const bp=st.bps.find(b=>at(b,p5.cell));
    const edge=E.sockets(st).find(s=>s.host==='p5'&&s.t==='edge');
    ok(typeof E.poInLockedBP==='function','poInLockedBP is exported');
    // unlocked: predicate false AND the seat the predicate speaks for succeeds
    eq(E.poInLockedBP(st,p5),false,'unlocked BP -> false');
    ok(E.seatSI(st,'a3',edge.skey).ok,'and the seat itself is allowed');
    // locked: predicate true AND the matching op is refused with why:'locked unit'
    bp.locked=true;
    eq(E.poInLockedBP(st,p5),true,'locked BP -> true');
    const r=E.stowSI(st,'a3');
    ok(!r.ok&&r.why==='locked unit','and the unseat it speaks for is refused: '+r.why);
    // a PO that is not on the grid is never "in" a locked BP
    const inv=st.pos.find(x=>x.loc!=='grid');
    if(inv)eq(E.poInLockedBP(st,inv),false,'non-grid PO -> false');
    eq(E.poInLockedBP(st,null),false,'missing PO -> false, never a throw');
  });

  T('REQ-0290 page: exported poInLockedBPIn is the same law, one page instead of the canvas',()=>{
    const {st:raw,E}=fresh();
    const st=E.migrateState(raw);
    const p5c=st.pos.find(x=>x.uid==='p5');
    const bpRef=st.bps.find(b=>at(b,p5c.cell));
    let homeBp=null,homePg=-1;
    st.inv.pages.forEach((pg,i)=>{const b=pg.bps.find(x=>x.id===bpRef.id);if(b){homeBp=b;homePg=i;}});
    ok(homeBp,'fixture: home BP found');
    const container=st.inv.pages[homePg];
    const inside=container.pos.filter(p=>p.loc==='grid'&&E.poInBPIn(p,homeBp));
    ok(inside.length,'fixture: the home BP contains at least one PO');
    ok(typeof E.poInLockedBPIn==='function','poInLockedBPIn is exported');
    homeBp.locked=false;
    for(const p of inside)eq(E.poInLockedBPIn(container,p),false,p.uid+' unlocked -> false');
    homeBp.locked=true;
    for(const p of inside)eq(E.poInLockedBPIn(container,p),true,p.uid+' locked -> true');
    // a PO on the SAME page but outside the locked BP is unaffected
    const outside=container.pos.find(p=>p.loc==='grid'&&!E.poInBPIn(p,homeBp));
    if(outside)eq(E.poInLockedBPIn(container,outside),false,'PO outside the locked BP -> false');
    eq(E.poInLockedBPIn(container,null),false,'missing PO -> false, never a throw');
  });

  T('REQ-0290 parity: canvas and page predicates answer identically for the SAME locked BP',()=>{
    const {st:raw,E}=fresh();
    const st=E.migrateState(raw);
    const p5=st.pos.find(x=>x.uid==='p5');
    const bpRef=st.bps.find(b=>at(b,p5.cell));
    let homeBp=null,homePg=-1;
    st.inv.pages.forEach((pg,i)=>{const b=pg.bps.find(x=>x.id===bpRef.id);if(b){homeBp=b;homePg=i;}});
    ok(homeBp,'fixture: home BP found');
    const container=st.inv.pages[homePg];
    const homePo=container.pos.find(p=>p.loc==='grid'&&E.poInBPIn(p,homeBp));
    ok(homePo,'fixture: a PO inside the home BP');
    for(const locked of [false,true,false]){
      bpRef.locked=locked;homeBp.locked=locked;
      eq(E.poInLockedBP(st,p5),locked,'canvas @locked='+locked);
      eq(E.poInLockedBPIn(container,homePo),locked,'page @locked='+locked);
      eq(E.poInLockedBP(st,p5),E.poInLockedBPIn(container,homePo),'canvas/page parity @locked='+locked);
    }
  });

  T('REQ-0209 canvas: BP rotation legality is UNAFFECTED by the lock (rotation-only rule)',()=>{
    const {st,E}=fresh();
    const p5=st.pos.find(x=>x.uid==='p5');
    const bp=st.bps.find(b=>at(b,p5.cell));
    const before=E.canRotateBP(st,bp.id).ok;
    bp.locked=true;
    eq(E.canRotateBP(st,bp.id).ok,before,'locked changes nothing for rotateBP legality');
    if(before)ok(E.rotateBP(st,bp.id).ok,'and the rotation itself commits');
  });

  T('REQ-0209 refs: fixed/locked survive the reference walk; bare fixed-PO ref ops refused',()=>{
    const {st:raw,E}=fresh();
    const st=E.migrateState(raw);
    const p5=st.pos.find(x=>x.uid==='p5');
    ok(p5,'fixture: p5 on canvas after migration');
    const bpRef=st.bps.find(b=>at(b,p5.cell));
    p5.fixed=true;bpRef.locked=true;
    let homeBp=null,homePo=null,homePg=-1;
    st.inv.pages.forEach((pg,i)=>{const b=pg.bps.find(x=>x.id===bpRef.id);if(b){homeBp=b;homePg=i;homePo=pg.pos.find(x=>x.uid==='p5');}});
    ok(homeBp&&homePo,'fixture: home records found');
    homeBp.locked=true;homePo.fixed=true;
    const rr=E.removeRef(st,'po','p5');
    ok(!rr.ok&&rr.why==='fixed','bare fixed-PO ref removal refused');
    const origin=[bpRef.origin[0],bpRef.origin[1]];
    ok(E.transferBP(st,{loc:'canvas'},{loc:'inv',page:homePg},bpRef.id,origin).ok,'wholesale BP removal stays legal');
    ok(!st.pos.find(x=>x.uid==='p5'),'nested fixed PO ref left with its BP');
    const cr=E.createRef(st,'po','p5',{cell:origin});
    ok(!cr.ok&&cr.why==='fixed','bare fixed-PO ref creation refused');
    const back=E.transferBP(st,{loc:'inv',page:homePg},{loc:'canvas'},bpRef.id,origin);
    ok(back.ok,'re-adding the BP to canvas: '+(back.why||''));
    const nb=st.bps.find(b=>b.id===bpRef.id),np=st.pos.find(x=>x.uid==='p5');
    ok(nb&&nb.locked===true,'locked survived the new BP reference');
    ok(np&&np.fixed===true,'fixed survived the new PO reference');
  });

  T('REQ-0209 page: PO placement + SI seat/unseat refused inside a locked page-resident BP',()=>{
    const {st:raw,E}=fresh();
    const st=E.migrateState(raw);
    const p5c=st.pos.find(x=>x.uid==='p5');
    const bpRef=st.bps.find(b=>at(b,p5c.cell));
    let homeBp=null,homePg=-1;
    st.inv.pages.forEach((pg,i)=>{const b=pg.bps.find(x=>x.id===bpRef.id);if(b){homeBp=b;homePg=i;}});
    ok(homeBp,'fixture: home BP found');
    homeBp.locked=true;
    const container=st.inv.pages[homePg];
    // PO placement into the locked BP (page side): find any same-page PO
    // outside the BP with an anchor that is LEGAL while unlocked, then
    // assert the lock alone flips it to refusal.
    homeBp.locked=false;
    let cand=null;
    for(const p of container.pos){
      if(p.loc!=='grid'||E.poInBPIn(p,homeBp))continue;
      for(const [dr,dc] of homeBp.shape){
        const cell=[homeBp.origin[0]+dr,homeBp.origin[1]+dc];
        if(E.invCanPlacePO(st,homePg,p.uid,p.rot,cell).ok){cand={uid:p.uid,rot:p.rot,cell};break;}
      }
      if(cand)break;
    }
    ok(cand,'fixture: an unlocked-legal in-BP anchor exists for some same-page PO');
    homeBp.locked=true;
    const pchk=E.invCanPlacePO(st,homePg,cand.uid,cand.rot,cand.cell);
    ok(!pchk.ok&&pchk.why==='locked unit','the lock alone refuses it: '+pchk.why);
    // SI seat/unseat (page side): bring a3's home record onto this page.
    let siPg=-1;st.inv.pages.forEach((pg,i)=>{if(pg.sis.find(x=>x.uid==='a3'))siPg=i;});
    ok(siPg>=0,'fixture: a3 homed somewhere');
    if(siPg!==homePg){
      const srcPg=st.inv.pages[siPg];
      const a=srcPg.sis.find(x=>x.uid==='a3');
      srcPg.sis=srcPg.sis.filter(x=>x.uid!=='a3');
      container.sis.push(a);
    }
    const sock=E.pageSockets(st,homePg).find(s=>s.host==='p5'&&s.t==='edge');
    ok(sock,'fixture: p5 edge socket visible on its home page');
    const r=E.invSeatSI(st,homePg,'a3',sock.skey);
    ok(!r.ok&&r.why==='locked unit','page seat refused: '+r.why);
    homeBp.locked=false;
    ok(E.invSeatSI(st,homePg,'a3',sock.skey).ok,'seat legal once unlocked');
    homeBp.locked=true;
    const r2=E.invStowSI(st,homePg,'a3');
    ok(!r2.ok&&r2.why==='locked unit','page unseat refused: '+r2.why);
    // page-side BP rotation stays available (rotation-only rule, page twin)
    const before=E.invCanRotateBP(st,homePg,homeBp.id).ok;
    homeBp.locked=false;
    eq(E.invCanRotateBP(st,homePg,homeBp.id).ok,before,'locked changes nothing for invRotateBP legality');
  });
})();


// ---------------------------------------------------------------------------
// REQ-0273: migrateState v4 -- READ-time normalization of the PO-on-unit-cell
// poison (see normalizeUnitCellOverlapsV4's own comment for the producers).
// ---------------------------------------------------------------------------
(function(){
  const BP={id:'tbp',name:'T',color:'#8a8a8a',shape:[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]],origin:[1,1],unit:{id:'dwarf',off:[2,1]}}; // unit cell [3,2]
  function base(){
    const {st,E}=(function(){const st=Data.makeState();return {st,E:Engine.create(Data.ITEMS,Data.SI_DEFS,Data.LAYOUT,Data.TREES,Data.UNITS,Data.CONN_SHAPES)};})();
    const m=E.migrateState(st);
    m.inv.pages[0].bps.push(JSON.parse(JSON.stringify(BP)));
    return {m,E};
  }
  T('REQ-0273 v4: poisoned PO on a page unit cell relocates at read time, idempotently',()=>{
    const {m,E}=base();
    m.inv.pages[0].pos.push({uid:'px',id:'hilt',loc:'grid',cell:[3,2],rot:0}); // ON the unit cell
    const st2=E.migrateState(m);
    const px=st2.inv.pages[0].pos.find(p=>p.uid==='px');
    ok(px,'px stays on page 0 (room exists)');
    ok(!(px.cell[0]===3&&px.cell[1]===2),'moved off the unit cell');
    ok(E.invCanPlacePO(st2,0,'px',0,px.cell).ok,'relocated placement is engine-legal');
    const st3=E.migrateState(st2);
    eq(st3.inv.pages[0].pos.find(p=>p.uid==='px').cell,px.cell,'second migrate is a no-op for px');
  });
  T('REQ-0273 v4: overflow to the next page carries the seated SI along',()=>{
    const {m,E}=base();
    const pg0=m.inv.pages[0];
    pg0.pos.push({uid:'pd',id:'dagger',loc:'grid',cell:[2,2],rot:0}); // cells [2,2]+[3,2] -- unit cell hit
    const siId=Object.keys(Data.SI_DEFS)[0];
    pg0.sis.push({uid:'sa',id:siId,host:{po:'pd',si:0}});
    for(let r=1;r<=8;r++)for(let c=1;c<=8;c++){
      if((r===3&&c===2)||(r===2&&c===2))continue;
      pg0.pos.push({uid:'f'+r+'_'+c,id:'hilt',loc:'grid',cell:[r,c],rot:0});
    }
    const st2=E.migrateState(m);
    ok(!st2.inv.pages[0].pos.find(p=>p.uid==='pd'),'pd left page 0 (no legal spot there)');
    const pd=st2.inv.pages[1].pos.find(p=>p.uid==='pd');
    ok(pd,'pd landed on page 1');
    eq(pd.cell,[1,1],'first-fit top-left on the empty page');
    ok(st2.inv.pages[1].sis.find(a=>a.uid==='sa'),'seated SI travelled with its PO');
    ok(!st2.inv.pages[0].sis.find(a=>a.uid==='sa'),'...and left page 0');
  });
  T('REQ-0273 v4: nowhere fits -> the PO stays put (degraded render beats data loss)',()=>{
    const {m,E}=base();
    const pg0=m.inv.pages[0];
    pg0.pos.push({uid:'pd',id:'dagger',loc:'grid',cell:[2,2],rot:0});
    for(let r=1;r<=8;r++)for(let c=1;c<=8;c++){
      if((r===3&&c===2)||(r===2&&c===2))continue;
      pg0.pos.push({uid:'f0_'+r+'_'+c,id:'hilt',loc:'grid',cell:[r,c],rot:0});
    }
    for(let pi=1;pi<m.inv.pages.length;pi++)
      for(let r=1;r<=8;r++)for(let c=1;c<=8;c++)
        m.inv.pages[pi].pos.push({uid:'f'+pi+'_'+r+'_'+c,id:'hilt',loc:'grid',cell:[r,c],rot:0});
    const st2=E.migrateState(m);
    const pd=st2.inv.pages[0].pos.find(p=>p.uid==='pd');
    ok(pd,'pd never deleted');
    eq(pd.cell,[2,2],'pd untouched when no page can host it');
  });
  T('REQ-0273 v4: clean states are untouched (pass is a no-op)',()=>{
    const {m,E}=base();
    m.inv.pages[0].pos.push({uid:'pl',id:'hilt',loc:'grid',cell:[5,5],rot:0}); // legal free spot
    const st2=E.migrateState(m);
    const st3=E.migrateState(st2);
    eq(JSON.stringify(st3),JSON.stringify(E.migrateState(st3)),'fixpoint after one pass');
    eq(st2.inv.pages[0].pos.find(p=>p.uid==='pl').cell,[5,5],'legal PO never moved');
  });
})();

console.log('----------------------------------');
console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);

// ---- REQ-0334: per-test timing ----------------------------------------
// Hoisted on purpose -- see tools/lib/test_clock.cjs and the sibling suites:
// T() runs at module scope, so a  here would be in the temporal dead
// zone;  +  hoist, and the require is deferred to first call.
var __clock;
function clk(name, t0) {
  return (__clock || (__clock = require('../../tools/lib/test_clock.cjs')(__filename))).clk(name, t0);
}
