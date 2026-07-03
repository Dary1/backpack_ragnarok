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
function fresh(){const st=Data.makeState();return {st,E:Engine.create(Data.ITEMS,Data.SI_DEFS,Data.LAYOUT)};}

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
  const r2=E.canMoveBP(st,'delta',[6,6]);
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

console.log('----------------------------------');
console.log(pass+' passed, '+fail+' failed');
process.exit(fail?1:0);
