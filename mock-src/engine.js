// backpack_ragnarok mock — pure engine (no DOM). Runs in browser (window.Engine) and node (module.exports).
(function(root,factory){
  if(typeof module!=='undefined'&&module.exports)module.exports=factory();
  else root.Engine=factory();
})(typeof self!=='undefined'?self:globalThis,function(){
'use strict';
function rotOffsets(base,k){
  let off=base.map(o=>[o[0],o[1]]);
  for(let i=0;i<(k%4+4)%4;i++)off=off.map(([r,c])=>[c,-r]);
  const mr=Math.min(...off.map(o=>o[0])),mc=Math.min(...off.map(o=>o[1]));
  return off.map(([r,c])=>[r-mr,c-mc]);
}

// ---------------------------------------------------------------------
// Hierarchy-walk helper (REQ-0022 batch 3/4).
//
// ONE shared mechanism used by BOTH the PO Tag tree and the Socket Type
// tree (two SEPARATE, independent namespaces that never cross-match --
// user ruling Q1=B). Each tree is a flat parent-map: { tagName: parentName
// | null }, null/absent meaning a root. Today both content/vocab.json
// trees (po_tags, socket_tags) are fully DEGENERATE (every node a root),
// so containment below only ever succeeds via exact string equality --
// zero behavior change from the old flat-array membership checks. A future
// non-degenerate tree (e.g. "Sword" parented under "Weapon") would then
// let ancestor/descendant checks succeed without any call-site changes.
//
// ancestorsOf(tree, tag): [tag, tag's parent, tag's grandparent, ...] up
// to (and stopping at) the first root.
function ancestorsOf(tree, tag){
  const chain=[tag];
  let cur=tag,guard=0;
  while(tree && Object.prototype.hasOwnProperty.call(tree,cur) && tree[cur]!=null && guard<1000){
    cur=tree[cur];
    chain.push(cur);
    guard++;
  }
  return chain;
}

// tagsRelated(tree, tagA, tagB): true if tagA===tagB, or tagA is an
// ancestor of tagB, or tagB is an ancestor of tagA (true hierarchy
// containment, either direction, along the SAME lineage/tree). This is
// the symmetric "same tag, or tag within the hierarchy" rule from the
// ground-truth glossary.
function tagsRelated(tree, tagA, tagB){
  if(tagA===tagB)return true;
  const chainA=ancestorsOf(tree,tagA);
  if(chainA.includes(tagB))return true;
  const chainB=ancestorsOf(tree,tagB);
  if(chainB.includes(tagA))return true;
  return false;
}

// hasTag(tagList, targetTag, tree): does `tagList` (an item's/socket's own
// tag array) satisfy a check for `targetTag`, per the tree's hierarchy?
// True if ANY tag in tagList is tagsRelated to targetTag within `tree`.
// `tree` must be the specific namespace's parent-map (po_tags or
// socket_tags) -- callers must NEVER pass the wrong tree, since the two
// namespaces never cross-match (Q1=B). Degenerate/missing tree ({} or
// undefined) reduces this to plain array-membership (exact match only).
function hasTag(tagList, targetTag, tree){
  const list=tagList||[];
  const t=tree||{};
  return list.some(tag=>tagsRelated(t,tag,targetTag));
}

function create(ITEMS,SI_DEFS,layout,trees){
  // trees: optional {po:{tag:parent|null,...}, socket:{tag:parent|null,...}}.
  // Defaults to fully degenerate (empty parent-maps) -- i.e. today's actual
  // vocab.json content -- so existing call sites Engine.create(ITEMS,SI_DEFS,
  // LAYOUT) keep working unchanged with exact-match-only tag semantics.
  const poTree=(trees&&trees.po)||{};
  const socketTree=(trees&&trees.socket)||{};
  const ROWS=layout.ROWS,COLS=layout.COLS;
  const key=(r,c)=>r+','+c;
  const shapeInfo=(id,rot)=>{
    const off=rotOffsets(ITEMS[id].shape,rot);
    return {off,h:Math.max(...off.map(o=>o[0]))+1,w:Math.max(...off.map(o=>o[1]))+1};
  };
  const bpCells=bp=>bp.shape.map(([dr,dc])=>[bp.origin[0]+dr,bp.origin[1]+dc]);
  const linkerCell=bp=>[bp.origin[0]+bp.linker.off[0],bp.origin[1]+bp.linker.off[1]];
  const cellBPMap=st=>{const m={};for(const bp of st.bps)for(const [r,c] of bpCells(bp))m[key(r,c)]=bp.id;return m;};
  const linkerMap=st=>{const m={};for(const bp of st.bps)m[key(...linkerCell(bp))]=bp.id;return m;};
  const poByUid=(st,u)=>st.pos.find(p=>p.uid===u);
  const cellsOf=(st,p)=>{
    if(p.loc!=='grid')return [];
    return shapeInfo(p.id,p.rot).off.map(([r,c])=>[p.cell[0]+r,p.cell[1]+c]);
  };
  const occupancy=(st,excl)=>{
    const ex=excl||[],m={};
    for(const p of st.pos){
      if(p.loc!=='grid'||ex.includes(p.uid))continue;
      for(const [r,c] of cellsOf(st,p))m[key(r,c)]=p.uid;
    }
    return m;
  };
  function canPlaceCells(st,cells,exclUids){
    const cbp=cellBPMap(st),lk=linkerMap(st),occ=occupancy(st,exclUids);
    let bp=null;
    for(const [r,c] of cells){
      if(r<1||r>ROWS||c<1||c>COLS)return {ok:false,cells,why:'outside canvas'};
      const b=cbp[key(r,c)];
      if(!b)return {ok:false,cells,why:'Dead Space'};
      if(bp&&b!==bp)return {ok:false,cells,why:'spans two BPs'};
      bp=b;
      if(lk[key(r,c)])return {ok:false,cells,why:'Linker cell'};
      if(occ[key(r,c)])return {ok:false,cells,why:'occupied'};
    }
    return {ok:true,cells,bp};
  }
  const canPlacePO=(st,uid,rot,anchor)=>{
    const p=poByUid(st,uid);
    const off=shapeInfo(p.id,rot).off;
    return canPlaceCells(st,off.map(([r,c])=>[anchor[0]+r,anchor[1]+c]),[uid]);
  };
  function movePO(st,uid,anchor){ // anchor==='inv' stows
    const p=poByUid(st,uid);
    if(anchor==='inv'){p.loc='inv';p.cell=null;unseatOrphans(st);return {ok:true};}
    const chk=canPlacePO(st,uid,p.rot,anchor);
    if(!chk.ok)return chk;
    p.loc='grid';p.cell=anchor;unseatOrphans(st);return {ok:true};
  }
  function rotatePO(st,uid){ // dblclick CW; in place if placed
    const p=poByUid(st,uid);
    const nr=(p.rot+1)%4;
    if(p.loc==='inv'){p.rot=nr;return {ok:true};}
    const chk=canPlacePO(st,uid,nr,p.cell);
    if(chk.ok){p.rot=nr;unseatOrphans(st);return {ok:true};}
    return chk;
  }
  const bpById=(st,id)=>st.bps.find(b=>b.id===id);
  // bpHpMax(st,bpId): read-only accessor for a BP's authored max-HP field
  // (REQ-0036 P1-A). Returns bp.hpMax if present, else undefined. Pure read,
  // NO mutation, NO combat/HP-mutation logic here -- this is only a read
  // surface for sim/combat.cjs; the engine itself has no combat/HP-mutation
  // logic and never will (combat lives entirely in sim/combat.cjs).
  const bpHpMax=(st,bpId)=>{const bp=bpById(st,bpId);return bp?bp.hpMax:undefined;};
  function canMoveBP(st,bpId,origin){
    const bp=bpById(st,bpId);
    const newCells=bp.shape.map(([dr,dc])=>[origin[0]+dr,origin[1]+dc]);
    const others=new Set();
    for(const ob of st.bps){if(ob.id===bpId)continue;for(const [r,c] of bpCells(ob))others.add(key(r,c));}
    for(const [r,c] of newCells){
      if(r<1||r>ROWS||c<1||c>COLS)return {ok:false,cells:newCells,why:'outside canvas'};
      if(others.has(key(r,c)))return {ok:false,cells:newCells,why:'overlaps another BP'};
    }
    return {ok:true,cells:newCells};
  }
  function poInBP(st,p,bp){
    if(p.loc!=='grid')return false;
    const set=new Set(bpCells(bp).map(([r,c])=>key(r,c)));
    return cellsOf(st,p).every(([r,c])=>set.has(key(r,c)));
  }
  function moveBP(st,bpId,origin){
    const bp=bpById(st,bpId);
    const chk=canMoveBP(st,bpId,origin);
    if(!chk.ok)return chk;
    const dr=origin[0]-bp.origin[0],dc=origin[1]-bp.origin[1];
    const inside=st.pos.filter(p=>poInBP(st,p,bp));
    bp.origin=origin;
    for(const p of inside)p.cell=[p.cell[0]+dr,p.cell[1]+dc];
    return {ok:true};
  }
  function assembly(st){
    const b=st.pos.find(p=>p.id==='blade'&&p.loc==='grid');
    const h=st.pos.find(p=>p.id==='hilt'&&p.loc==='grid');
    if(!b||!h||b.rot%4!==0)return null;
    const bc=cellsOf(st,b),bottom=bc[bc.length-1],cbp=cellBPMap(st);
    if(h.cell[0]===bottom[0]+1&&h.cell[1]===bottom[1]&&cbp[key(...h.cell)]===cbp[key(...bottom)])
      return {blade:b,hilt:h,bp:cbp[key(...h.cell)],cells:bc.concat([h.cell]),anchor:b.cell};
    return null;
  }
  function canPlaceAssembly(st,anchor){
    const asm=assembly(st);
    if(!asm)return {ok:false,cells:[],why:'not assembled'};
    const cells=[[anchor[0],anchor[1]],[anchor[0]+1,anchor[1]],[anchor[0]+2,anchor[1]]];
    return canPlaceCells(st,cells,[asm.blade.uid,asm.hilt.uid]);
  }
  function moveAssembly(st,anchor){ // anchor==='inv' stows both parts
    const asm=assembly(st);
    if(!asm)return {ok:false,why:'not assembled'};
    if(anchor==='inv'){
      asm.blade.loc='inv';asm.blade.cell=null;
      asm.hilt.loc='inv';asm.hilt.cell=null;
      unseatOrphans(st);return {ok:true};
    }
    const chk=canPlaceAssembly(st,anchor);
    if(!chk.ok)return chk;
    asm.blade.cell=[anchor[0],anchor[1]];
    asm.hilt.cell=[anchor[0]+2,anchor[1]];
    unseatOrphans(st);return {ok:true};
  }
  function sockets(st){
    const out=[];
    for(const p of st.pos){
      if(p.loc!=='grid')continue;
      const def=ITEMS[p.id];
      (def.sockets||[]).forEach((s,si)=>{
        const seated=st.sis.find(a=>a.host&&a.host.po===p.uid&&a.host.si===si);
        out.push({skey:p.uid+':'+si,host:p.uid,si,t:s.t,tags:s.tags||[],siUid:seated?seated.uid:null,ax:s.ax,ay:s.ay});
      });
    }
    const asm=assembly(st);
    if(asm){
      const seated=st.sis.find(a=>a.host==='bond');
      out.push({skey:'bond',host:'bond',si:0,t:'bond',tags:['Metal'],siUid:seated?seated.uid:null});
    }
    return out;
  }
  function hostOk(st,siUid,sock){
    const a=st.sis.find(x=>x.uid===siUid),d=SI_DEFS[a.id];
    if(sock.t!==d.slot)return {ok:false,why:'socket type '+sock.t+' ≠ '+d.slot};
    if(sock.siUid&&sock.siUid!==siUid)return {ok:false,why:'socket occupied'};
    // Tag matching is hierarchical (Socket Type tree, REQ-0022 batch 3/4):
    // a required tag is satisfied if the socket carries that exact tag OR a
    // tag within the SAME socket_tags hierarchy (never the po_tags tree).
    // Degenerate tree today => exact-match only, same as the old .includes().
    for(const t of (d.reqTags||[]))
      if(!hasTag(sock.tags,t,socketTree))return {ok:false,why:'socket lacks tag '+t+' (has: '+(sock.tags.join(', ')||'none')+')'};
    return {ok:true};
  }
  function seatSI(st,siUid,skey){
    const sock=sockets(st).find(s=>s.skey===skey);
    if(!sock)return {ok:false,why:'no such socket'};
    const v=hostOk(st,siUid,sock);
    if(!v.ok)return v;
    const a=st.sis.find(x=>x.uid===siUid);
    a.host=sock.host==='bond'?'bond':{po:sock.host,si:sock.si};
    return {ok:true};
  }
  function stowSI(st,siUid){st.sis.find(x=>x.uid===siUid).host='inv';return {ok:true};}
  function unseatOrphans(st){
    const asm=assembly(st);
    for(const a of st.sis){
      if(a.host==='bond'&&!asm)a.host='inv';
      if(a.host&&a.host.po){const p=poByUid(st,a.host.po);if(!p||p.loc!=='grid')a.host='inv';}
    }
  }
  function adjacent(A,B){
    for(const [r1,c1] of A)for(const [r2,c2] of B)
      if(Math.abs(r1-r2)+Math.abs(c1-c2)===1)return true;
    return false;
  }

  // ---------------------------------------------------------------------
  // Connection Port model (REQ-0023).
  //
  // A PO's `ports` (content field, replacing the old flat `conn`) is an
  // array of {tiles:[[dr,dc],...], tag}. `tiles` are EXTERNAL target cells
  // (outside the PO's own shape, orthogonally adjacent, negative offsets
  // allowed), expressed in the SAME unrotated/unnormalized coordinate frame
  // as `shape` -- i.e. identical convention to the old `conn` field, just
  // grouped per-tag instead of being one flat list. `tag` is the PO Tag
  // (po_tags tree) this port is searching for on a partner PO.
  //
  // portTargets(st,p): for a placed PO p, returns one entry per port:
  // {tag, tiles:[[r,c],...]} with `tiles` rotated (same rotation transform
  // as connTargets used to apply to the old flat conn list) and translated
  // to absolute canvas coordinates. Used by the UI for the ◇ target-tile
  // markers/tooltips, and by connectionsFrom() below for resolution.
  function portTargets(st,p){
    const def=ITEMS[p.id];
    if(p.loc!=='grid'||!def.ports||!def.ports.length)return [];
    let sh=def.shape.map(o=>[o[0],o[1]]);
    for(let i=0;i<(p.rot%4+4)%4;i++)sh=sh.map(([r,c])=>[c,-r]);
    const mr=Math.min(...sh.map(o=>o[0])),mc=Math.min(...sh.map(o=>o[1]));
    return def.ports.map(port=>{
      let cn=port.tiles.map(o=>[o[0],o[1]]);
      for(let i=0;i<(p.rot%4+4)%4;i++)cn=cn.map(([r,c])=>[c,-r]);
      return {tag:port.tag,tiles:cn.map(([r,c])=>[r-mr+p.cell[0],c-mc+p.cell[1]])};
    });
  }
  // Back-compat/UI convenience: every target tile across every port of a PO,
  // flattened (no tag), matching the old connTargets() shape exactly -- the
  // ◇ marker rendering only ever needed tile positions, not tags.
  function connTargets(st,p){
    return portTargets(st,p).flatMap(port=>port.tiles);
  }

  // connectionsFrom(st,p): established connections FROM PO p (p is the port
  // owner/"sender"; per REQ-0023 the port belongs to the sender and the
  // relation is directional -- mutuality is not required). Returns
  // [{tag, tile:[r,c], partner:<PO>}...], one entry per (port, landed tile,
  // partner) triple where:
  //   - the port's tile lands on a cell occupied by `partner`
  //   - `partner` is in the SAME BP as `p` (guard retained from REQ-0022;
  //     ports can never connect across BPs even if the tile arithmetic
  //     would otherwise land inside a neighboring BP's footprint)
  //   - `partner` has a tag equal to, or hierarchy-related to (via the
  //     PO Tag tree, poTree), the port's tag
  function connectionsFrom(st,p){
    if(p.loc!=='grid')return [];
    const cbp=cellBPMap(st),placed=st.pos.filter(q=>q.loc==='grid'&&q.uid!==p.uid);
    const bpOfP=cbp[key(...cellsOf(st,p)[0])];
    const out=[];
    for(const port of portTargets(st,p)){
      for(const [tr,tc] of port.tiles){
        for(const partner of placed){
          const partnerCells=cellsOf(st,partner);
          const landed=partnerCells.some(([r,c])=>r===tr&&c===tc);
          if(!landed)continue;
          if(cbp[key(...partnerCells[0])]!==bpOfP)continue; // never across BPs
          const partnerTags=ITEMS[partner.id].tags;
          if(!hasTag(partnerTags,port.tag,poTree))continue;
          out.push({tag:port.tag,tile:[tr,tc],partner});
        }
      }
    }
    return out;
  }
  // allConnections(st): every established connection on the board, as
  // {from:<PO>, to:<PO>, tag, tile}. Directional (one entry per sender-port
  // hit; mutual connections between two ported POs each produce their own
  // entries, not merged).
  function allConnections(st){
    const out=[];
    for(const p of st.pos){
      if(p.loc!=='grid')continue;
      for(const c of connectionsFrom(st,p))out.push({from:p,to:c.partner,tag:c.tag,tile:c.tile});
    }
    return out;
  }
  function contactPairs(A,B){
    const out=[];
    for(const a of A)for(const b of B)
      if(Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])===1)out.push([a,b]);
    return out;
  }

  // Declarative combo-recipe table (REQ-0023): recipes no longer hard-code
  // which PO owns which tag by inspecting both sides ad hoc -- each recipe
  // just names the OWNER tag (the tag the connection's sender/from-PO must
  // have) and the PORT tag it must have connected via (which, by
  // connectionsFrom()'s own contract, is already tag-matched against the
  // partner -- so "port tag X" means "connected to a partner tagged X").
  // This is a mechanical unpacking of the old combos() hard-coded checks:
  //   old: fl = PO tagged Flame; oil = PO tagged Oil; connected(fl,oil) -> Ignite
  //   new: any established connection whose sender has tag Flame and whose
  //        port tag is Oil -> Ignite (the partner is guaranteed tagged Oil
  //        by connectionsFrom()'s tag-hierarchy check already).
  // "blade" (tags: [WeaponPart, Metal]) now matches a Weapon-tagged port via
  // the po_tags hierarchy walk (WeaponPart < Weapon, content/vocab.json) --
  // no item-id special case is needed anymore. Before that hierarchy edge
  // existed, blade could only match through a narrow LEGACY_ID_ALIAS keyed
  // on the literal id 'blade'; that alias (and its partnerMatchesPortTag
  // wrapper) has been removed now that the real hierarchy produces the same
  // result via plain hasTag()/tagsRelated() (REQ-0023 follow-up, user-approved).
  const COMBO_RECIPES=[
    {name:'Ignite',ownerTag:'Flame',portTag:'Oil',
     desc:'Flame + Oil connected → Burn applications ×2.'},
    {name:'Flaming Blade',ownerTag:'Flame',portTag:'Weapon',
     desc:'Flame connected to a Weapon → adds Burn on hit.'},
  ];
  function combos(st){
    const out=[],cbp=cellBPMap(st),placed=st.pos.filter(p=>p.loc==='grid');
    const asm=assembly(st);
    if(asm)out.push({name:'Assembled: Longsword',cells:asm.cells,desc:'Blade + Hilt flush-joined → Strike 10 / 4 ticks.'});

    // General connection-based combo resolution (REQ-0023): a port's tiles
    // landing on a partner requires the partner to carry the port's tag,
    // per the PO Tag hierarchy walk (hasTag()/poTree) -- no item-id special
    // case remains (see the LEGACY_ID_ALIAS removal note above).
    for(const recipe of COMBO_RECIPES){
      // group every landed tile by the connected (uidA,uidB) pair, so a PO
      // whose port has multiple target tiles (e.g. a 2-tile port) still
      // renders a diamond marker on EACH landed tile (matches the old
      // combos() behavior, which collected all hit() tiles into one pairs[]
      // per combo instance) while only emitting ONE combo entry per pair.
      //
      // BIDIRECTIONAL by design: the old pre-REQ-0023 code detected e.g.
      // "Ignite" from EITHER side's conn (`hit(ta,cb).concat(hit(tb,ca))`),
      // with no notion of which PO "owned" the check. Under the port model
      // each side now owns its OWN port with its OWN tag (flame_tablet: a
      // port tagged Oil, searching for an Oil partner; oil_flask: a port
      // tagged Flame, searching for a Flame partner) -- both represent the
      // same recipe from opposite ends. So a recipe matches a connection
      // where EITHER (owner has ownerTag AND port tagged portTag) OR
      // (owner has portTag AND port tagged ownerTag) -- i.e. or across the
      // recipe's two tag roles -- and tiles from both directions are
      // merged into one combo entry per connected pair (exactly like the
      // old concat()).
      const roles=[[recipe.ownerTag,recipe.portTag],[recipe.portTag,recipe.ownerTag]];
      const byPair=new Map();
      for(const [needOwnerTag,needPortTag] of roles){
        for(const p of placed){
          if(!hasTag(ITEMS[p.id].tags,needOwnerTag,poTree))continue;
          const bpOfP=cbp[key(...cellsOf(st,p)[0])];
          for(const port of portTargets(st,p)){
            if(port.tag!==needPortTag)continue;
            for(const [tr,tc] of port.tiles){
              for(const partner of placed){
                if(partner.uid===p.uid)continue;
                const partnerCells=cellsOf(st,partner);
                if(!partnerCells.some(([r,c])=>r===tr&&c===tc))continue;
                if(cbp[key(...partnerCells[0])]!==bpOfP)continue; // never across BPs
                if(!hasTag(ITEMS[partner.id].tags,needPortTag,poTree))continue;
                const k=[p.uid,partner.uid].sort().join('|');
                if(!byPair.has(k))byPair.set(k,{a:p,b:partner,tiles:[]});
                const rec=byPair.get(k);
                if(!rec.tiles.some(([r,c])=>r===tr&&c===tc))rec.tiles.push([tr,tc]);
              }
            }
          }
        }
      }
      for(const rec of byPair.values()){
        const cells=cellsOf(st,rec.a).concat(cellsOf(st,rec.b));
        out.push({name:recipe.name,cells,pairs:rec.tiles,desc:recipe.desc});
      }
    }

    for(const bp of st.bps){
      const beasts=placed.filter(p=>hasTag(ITEMS[p.id].tags,'Beast',poTree)&&cbp[key(...cellsOf(st,p)[0])]===bp.id);
      if(beasts.length>=2)out.push({name:'Pack Instinct',cells:beasts.flatMap(p=>cellsOf(st,p)),desc:beasts.length+' Beast POs in '+bp.name+' → each +2 damage per other.'});
    }
    return out;
  }
  const DIRS={0:[-1,0],1:[-1,1],2:[0,1],3:[1,1],4:[1,0],5:[1,-1],6:[0,-1],7:[-1,-1]};
  function traceBeams(st){
    const lk=linkerMap(st),beams=[];
    for(const bp of st.bps)for(const d of bp.linker.dirs){
      let [r,c]=linkerCell(bp);const path=[];let to=null;
      while(true){
        r+=DIRS[d][0];c+=DIRS[d][1];
        if(r<1||r>ROWS||c<1||c>COLS)break;
        path.push([r,c]);
        if(lk[key(r,c)]){to=lk[key(r,c)];break;}
      }
      beams.push({from:bp.id,dir:d,path,to});
    }
    for(const bm of beams)bm.mutual=!!(bm.to&&beams.some(o=>o.from===bm.to&&o.to===bm.from));
    return beams;
  }

  // =======================================================================
  // Inventory model (REQ-0030 Phase 1).
  //
  // ADDITIVE ONLY: everything above this point (canvas state/API) is
  // byte-for-byte unchanged. The inventory is 5 independent PAGES, each
  // shaped exactly like a page-scoped "canvas": st.inv.pages[n] = {bps:[],
  // pos:[], sis:[]}, mirroring the top-level st.{bps,pos,sis} arrays field-
  // for-field. This means a BP transfer between canvas and a page (or
  // between two pages) is a structural move: splice the BP object out of
  // one container's bps[] and into another's, remap the contained POs'
  // absolute cell (same dr/dc technique as moveBP), and splice/keep the
  // POs' own pos[]/sis[] entries in lockstep -- no new "origin" bookkeeping
  // field is needed because uid/skey references inside `sis[].host` (e.g.
  // {po:uid,si:index}) stay valid across the move: they name the PO by
  // uid, not by container, so moving the PO's pos[] entry and its seated
  // sis[] entries into the same target container's arrays is sufficient.
  //
  // Page grid dimensions == canvas (ROWS x COLS), per REQ-0030 orchestrator
  // default. All cell/anchor arguments below are [row,col], SAME convention
  // as the rest of this file (canvas is the convention authority).
  //
  // Key mechanical DIFFERENCE from canvas placement (canPlaceCells):
  //   - Canvas requires EVERY PO cell to land on some BP ("Dead Space" is
  //     illegal for POs) -- a BP is mandatory infrastructure.
  //   - Inventory pages allow POs to be free-placed directly on the empty
  //     grid (no BP) OR fully inside exactly one BP (same containment law
  //     as canvas: fully inside ONE BP, never straddling two). A free PO
  //     must not overlap ANY BP footprint (partial overlap is illegal --
  //     it must be either fully outside every BP, or fully inside one).
  // So invCanPlaceCells() below is a distinct function from canPlaceCells(),
  // not a parameterization of it -- the "no BP found" branch is legal here
  // (free placement) whereas on canvas it is the 'Dead Space' rejection.
  const PAGE_COUNT=5;

  // Fresh, empty inventory (5 independent pages). Used by migrateState()
  // below (for a legacy state with no st.inv at all) and exposed on the
  // engine instance so any other caller can obtain a correctly-shaped
  // empty inventory without hand-rolling the page array shape. NOTE:
  // mock-src/data.js's makeState() does NOT call this -- data.js loads
  // before engine.js in the mock HTML build order (index.template.html),
  // so it carries its own tiny inline equivalent (makeEmptyInventory() in
  // tool_gen_data.cjs) instead of depending on Engine at data-definition
  // time; the two independently produce the identical {pages:[5 x {bps:
  // [],pos:[],sis:[]}]} shape.
  function emptyInventory(){
    const pages=[];
    for(let i=0;i<PAGE_COUNT;i++)pages.push({bps:[],pos:[],sis:[]});
    return {pages,names:defaultPageNames()};
  }

  // Default inventory page display names ("1".."5", PAGE_COUNT-long).
  // Kept as a function (not a module-level constant) since PAGE_COUNT is
  // itself a `const` above but this keeps the two visibly coupled at the
  // call site.
  function defaultPageNames(){
    const out=[];
    for(let i=0;i<PAGE_COUNT;i++)out.push(String(i+1));
    return out;
  }

  // invPageNames(st): the live names array, defaulting defensively for any
  // st.inv built without one (older hand-rolled fixtures/tests, or a
  // migrated state -- see migrateState below). Never mutates st.inv itself
  // here (renameInvPage is the only mutator) -- this is a pure read helper.
  function invPageNames(st){
    return (st.inv && Array.isArray(st.inv.names)) ? st.inv.names : defaultPageNames();
  }

  // renameInvPage(st,n,name): sets inventory page n's (0-based) display
  // name. Materializes st.inv.names if it was missing/short (defensive --
  // same reasoning as invPageNames above: a state built before this field
  // existed should not crash on first rename, it should just adopt the
  // default names array and then apply the one requested change).
  function renameInvPage(st,n,name){
    if(!st.inv)return {ok:false,why:'no inventory'};
    if(!(n>=0&&n<PAGE_COUNT))return {ok:false,why:'page index out of range'};
    if(!Array.isArray(st.inv.names)||st.inv.names.length!==PAGE_COUNT)st.inv.names=defaultPageNames();
    st.inv.names[n]=String(name);
    return {ok:true};
  }

  // reorderInvPage(st,from,to): moves inventory page `from` to index `to`
  // (0-based, same splice-out/splice-in semantics as reorderPreset). The
  // page's ENTIRE contents ({bps,pos,sis}) and its display name move
  // together as one unit -- st.inv.pages and st.inv.names are permuted in
  // lockstep so page N's name always still describes page N's contents
  // after the move.
  //
  // Page-index-sensitive embedded data audit (REQ-0032): st.inv.pages[]
  // entries are read live everywhere (homeLocationOf/allHomeUids/page()
  // all scan st.inv.pages fresh, so simply permuting the array keeps
  // those correct with no further work) EXCEPT ONE spot -- a free-placed
  // (unseated) SI's own home record embeds its page index directly, as
  // `host:{page:<idx>,cell:[r,c]}` (see invMoveSI and migrateCanvasTo-
  // ReferencesV3). That embedded `page` number is written on every free-
  // placed SI home but is not currently read back by any legality check
  // (invOccupancy only reads `.cell`) -- still, it is live, addressable
  // state describing "which page this SI lives on", so it must be
  // corrected to the item's NEW page index after a reorder, exactly like
  // its surrounding page array slot, or it would silently go stale and
  // mislead any future/external consumer. This function walks every page
  // AFTER the splice and rewrites `host.page` to match the item's actual
  // (new) page index; every other record shape (POs, BPs, seated-SI
  // {po,si} hosts, stowed 'inv' sentinel) carries no page-index field at
  // all, so nothing else needs remapping.
  //
  // Caller contract: `activeInvPage` (which inventory tab is currently
  // shown) is CLIENT-side UI state, not part of engine `st` -- this
  // function does not know or care which page is "active"; the client
  // (store.ts) is responsible for applying the identical index-shift rule
  // (reorderPresetIndex's logic, generalized) to its own activeInvPage
  // field after a successful call here, mirroring the preset active-index
  // rule on the inventory-page axis.
  function reorderInvPage(st,from,to){
    if(!st.inv)return {ok:false,why:'no inventory'};
    if(!(from>=0&&from<PAGE_COUNT))return {ok:false,why:'from index out of range'};
    if(!(to>=0&&to<PAGE_COUNT))return {ok:false,why:'to index out of range'};
    if(from===to)return {ok:true};
    if(!Array.isArray(st.inv.names)||st.inv.names.length!==PAGE_COUNT)st.inv.names=defaultPageNames();
    const pages=st.inv.pages.slice();
    const names=st.inv.names.slice();
    const [movedPage]=pages.splice(from,1);
    pages.splice(to,0,movedPage);
    const [movedName]=names.splice(from,1);
    names.splice(to,0,movedName);
    // Fix up embedded page-index data (see doc above) to match each SI's
    // ACTUAL post-move page index.
    for(let i=0;i<pages.length;i++){
      for(const a of pages[i].sis){
        if(a.host&&typeof a.host==='object'&&'page' in a.host)a.host.page=i;
      }
    }
    st.inv.pages=pages;
    st.inv.names=names;
    return {ok:true};
  }

  function page(st,n){return st.inv.pages[n];}

  // bpCellsIn/occupancyIn/cellsOfIn: same math as the canvas bpCells/
  // cellsOf/occupancy helpers above, just parameterized over an explicit
  // POs/BPs array pair (a "container": either the canvas st itself, via
  // {bps:st.bps,pos:st.pos}, or one st.inv.pages[n]) instead of being
  // hard-wired to st.bps/st.pos. Coordinates are [row,col], page-local
  // (each page has its own independent ROWS x COLS grid, same size as
  // canvas per REQ-0030 default).
  const bpCellsIn=bp=>bpCells(bp); // shape math is container-independent
  function cellsOfIn(p){
    if(p.loc!=='grid')return [];
    return shapeInfo(p.id,p.rot).off.map(([r,c])=>[p.cell[0]+r,p.cell[1]+c]);
  }
  function cellBPMapIn(container){
    const m={};
    for(const bp of container.bps)for(const [r,c] of bpCellsIn(bp))m[key(r,c)]=bp.id;
    return m;
  }
  // occupancy from POs (their footprint cells) AND free-placed SIs (each
  // exactly 1 cell, per REQ-0030 orchestrator default) already in the page.
  function invOccupancy(container,exclUids){
    const ex=exclUids||[],m={};
    for(const p of container.pos){
      if(p.loc!=='grid'||ex.includes(p.uid))continue;
      for(const [r,c] of cellsOfIn(p))m[key(r,c)]=p.uid;
    }
    for(const a of (container.sis||[])){
      if(!a.host||typeof a.host!=='object'||!('cell' in a.host))continue; // free-placed SI marker
      if(ex.includes(a.uid))continue;
      const [r,c]=a.host.cell;
      m[key(r,c)]=a.uid;
    }
    return m;
  }
  // invCanPlaceCells: legality of `cells` (already-translated absolute
  // [row,col] cells) within one page container. Unlike canPlaceCells
  // (canvas), landing on NO BP is legal here (free placement); landing on
  // a BP requires ALL cells in the SAME BP (containment law, still shared
  // with canvas).
  function invCanPlaceCells(container,cells,exclUids){
    const cbp=cellBPMapIn(container),occ=invOccupancy(container,exclUids);
    let bp=null,anyBp=false;
    for(const [r,c] of cells){
      if(r<1||r>ROWS||c<1||c>COLS)return {ok:false,cells,why:'outside page'};
      const b=cbp[key(r,c)];
      if(b){
        anyBp=true;
        if(bp&&b!==bp)return {ok:false,cells,why:'spans two BPs'};
        bp=b;
      }
      if(occ[key(r,c)])return {ok:false,cells,why:'occupied'};
    }
    if(anyBp){
      // must be FULLY inside the one BP found -- re-check every cell
      // belongs to that same bp (catches partial-overlap: some cells on
      // the BP, others free-floating outside it).
      for(const [r,c] of cells)if(cbp[key(r,c)]!==bp)return {ok:false,cells,why:'straddles BP edge'};
    }
    return {ok:true,cells,bp};
  }
  const poByUidIn=(container,u)=>container.pos.find(p=>p.uid===u);

  // invCanPlacePO(st,page,uid,rot,anchor): pure legality check for placing/
  // moving PO `uid` (already present in page `page`'s pos[]) at rotation
  // `rot`, anchored at [row,col] `anchor`. Usable by the client for drag
  // previews (no mutation).
  function invCanPlacePO(st,pg,uid,rot,anchor){
    const container=page(st,pg);
    const p=poByUidIn(container,uid);
    const off=shapeInfo(p.id,rot).off;
    return invCanPlaceCells(container,off.map(([r,c])=>[anchor[0]+r,anchor[1]+c]),[uid]);
  }
  // invMovePO: mutates. `anchor==='inv'` has no meaning inside a page (a
  // page IS an inventory container already) -- callers wanting to remove a
  // PO from a page entirely should use transferBP or drop the PO via a
  // higher-level "delete/unplace" op; movePO-in-page always requires a
  // concrete [row,col] anchor.
  function invMovePO(st,pg,uid,anchor){
    const chk=invCanPlacePO(st,pg,uid,page(st,pg).pos.find(p=>p.uid===uid).rot,anchor);
    if(!chk.ok)return chk;
    const p=poByUidIn(page(st,pg),uid);
    p.loc='grid';p.cell=anchor;
    return {ok:true};
  }
  // invRotatePO: dblclick-CW equivalent inside a page (mirrors rotatePO).
  function invRotatePO(st,pg,uid){
    const p=poByUidIn(page(st,pg),uid);
    const nr=(p.rot+1)%4;
    const chk=invCanPlacePO(st,pg,uid,nr,p.cell);
    if(!chk.ok)return chk;
    p.rot=nr;
    return {ok:true};
  }

  // invCanPlaceSI(st,page,uid,anchor): free-placed SI footprint is ALWAYS
  // 1x1 (REQ-0030 orchestrator default), regardless of the SI's def --
  // socketed SIs (seated on a PO's socket) occupy no cell at all (same as
  // canvas). `anchor` is the single [row,col] cell.
  //
  // Resolved ambiguity (see report): the spec's BP-overlap law ("if a PO
  // overlaps a BP it must fit entirely within that BP; a free-placed PO
  // must not overlap any BP") is stated for POs. A free-placed SI is
  // simpler (it is never "mounted on" a BP the way a PO can be -- there is
  // no partial/full containment distinction for a single cell) -- default:
  // a free-placed SI may NEVER land on a BP cell at all (a BP is occupied
  // infrastructure a bare SI cannot sit on top of). This is a plain
  // per-cell check, not a reuse of invCanPlaceCells' containment logic
  // (which would wrongly treat "1 cell inside a BP" as trivially "fully
  // inside" and accept it).
  function invCanPlaceSI(st,pg,uid,anchor,exclUids){
    const container=page(st,pg);
    const [r,c]=anchor;
    const ex=exclUids||[uid];
    if(r<1||r>ROWS||c<1||c>COLS)return {ok:false,cells:[anchor],why:'outside page'};
    const cbp=cellBPMapIn(container);
    if(cbp[key(r,c)])return {ok:false,cells:[anchor],why:'BP-overlap'};
    const occ=invOccupancy(container,ex);
    if(occ[key(r,c)])return {ok:false,cells:[anchor],why:'occupied'};
    return {ok:true,cells:[anchor]};
  }
  function invMoveSI(st,pg,uid,anchor){
    const chk=invCanPlaceSI(st,pg,uid,anchor,[uid]);
    if(!chk.ok)return chk;
    const a=page(st,pg).sis.find(x=>x.uid===uid);
    a.host={page:pg,cell:anchor};
    return {ok:true};
  }

  // pageSockets(st,page): every open/filled socket of every PO placed in
  // this page, same shape as sockets(st) (canvas). Assemblies (blade+hilt
  // "bond" joint) are a canvas-only mechanic in the current roster (no
  // equivalent construct is specced for inventory pages), so no 'bond'
  // pseudo-socket is emitted here -- resolved ambiguity (see report).
  function pageSockets(st,pg){
    const container=page(st,pg);
    const out=[];
    for(const p of container.pos){
      if(p.loc!=='grid')continue;
      const def=ITEMS[p.id];
      (def.sockets||[]).forEach((s,si)=>{
        const seated=container.sis.find(a=>a.host&&a.host.po===p.uid&&a.host.si===si);
        out.push({skey:p.uid+':'+si,host:p.uid,si,t:s.t,tags:s.tags||[],siUid:seated?seated.uid:null,ax:s.ax,ay:s.ay});
      });
    }
    return out;
  }
  // invSeatSI/invStowSI: seat/unseat an SI onto a PO's socket WITHIN a
  // page. Works for both a PO free-placed directly in the page and a PO
  // hosted on an inventory BP (both are just "POs in this page's pos[]" --
  // no distinction needed). Resolved ambiguity (see report): spec is
  // silent on whether a free-placed (no-BP) PO accepts SI seating; default
  // is YES (an inventory PO can be equipped/unequipped regardless of
  // whether it currently sits on an inventory BP), matching "SI seat/
  // unseat also works inside the inventory" (spec item 4) which does not
  // condition on BP presence.
  function invSeatSI(st,pg,siUid,skey){
    const container=page(st,pg);
    const sock=pageSockets(st,pg).find(s=>s.skey===skey);
    if(!sock)return {ok:false,why:'no such socket'};
    const a=container.sis.find(x=>x.uid===siUid);
    if(!a)return {ok:false,why:'no such SI in this page'};
    const d=SI_DEFS[a.id];
    if(sock.t!==d.slot)return {ok:false,why:'socket type '+sock.t+' ≠ '+d.slot};
    if(sock.siUid&&sock.siUid!==siUid)return {ok:false,why:'socket occupied'};
    for(const t of (d.reqTags||[]))
      if(!hasTag(sock.tags,t,socketTree))return {ok:false,why:'socket lacks tag '+t+' (has: '+(sock.tags.join(', ')||'none')+')'};
    a.host={po:sock.host,si:sock.si};
    return {ok:true};
  }
  function invStowSI(st,pg,siUid){
    const a=page(st,pg).sis.find(x=>x.uid===siUid);
    if(!a)return {ok:false,why:'no such SI in this page'};
    a.host='inv'; // stowed-within-page sentinel; distinct from a free-placed {page,cell} host
    return {ok:true};
  }

  // invCanPlaceBP(st,page,bpId,origin): legality for placing/moving an
  // entire BP within one page. Must fit in bounds, must not overlap any
  // OTHER BP already in the page, and (page-specific, since a page can
  // already have free-placed POs/SIs sitting where canvas never would at
  // BP-placement time) must not overlap any free-placed PO or free-placed
  // SI already in the page either. POs/SIs that are themselves CONTENTS of
  // this same BP (i.e. traveling with it) are excluded from the overlap
  // check via exclUids.
  function invCanPlaceBP(st,pg,bpId,origin,exclUids){
    const container=page(st,pg);
    const bp=container.bps.find(b=>b.id===bpId);
    const newCells=bp.shape.map(([dr,dc])=>[origin[0]+dr,origin[1]+dc]);
    const ex=exclUids||[];
    const others=new Set();
    for(const ob of container.bps){if(ob.id===bpId)continue;for(const [r,c] of bpCellsIn(ob))others.add(key(r,c));}
    const occ=invOccupancy(container,ex);
    for(const [r,c] of newCells){
      if(r<1||r>ROWS||c<1||c>COLS)return {ok:false,cells:newCells,why:'outside page'};
      if(others.has(key(r,c)))return {ok:false,cells:newCells,why:'overlaps another BP'};
      if(occ[key(r,c)])return {ok:false,cells:newCells,why:'overlaps free-placed item'};
    }
    return {ok:true,cells:newCells};
  }
  function poInBPIn(p,bp){
    if(p.loc!=='grid')return false;
    const set=new Set(bpCellsIn(bp).map(([r,c])=>key(r,c)));
    return cellsOfIn(p).every(([r,c])=>set.has(key(r,c)));
  }
  // invMoveBP: relocate a BP within its OWN page (no cross-container
  // transfer -- see transferBP below for canvas<->page / page<->page).
  // Mirrors moveBP(): contents (POs fully inside the BP) shift by the same
  // dr/dc; their seated SIs need no change (host references the PO uid,
  // unaffected by the PO's cell moving).
  function invMoveBP(st,pg,bpId,origin){
    const container=page(st,pg);
    const bp=container.bps.find(b=>b.id===bpId);
    const inside=container.pos.filter(p=>poInBPIn(p,bp));
    const chk=invCanPlaceBP(st,pg,bpId,origin,inside.map(p=>p.uid));
    if(!chk.ok)return chk;
    const dr=origin[0]-bp.origin[0],dc=origin[1]-bp.origin[1];
    bp.origin=origin;
    for(const p of inside)p.cell=[p.cell[0]+dr,p.cell[1]+dc];
    return {ok:true};
  }

  // ---------------------------------------------------------------------
  // BP transfer: canvas<->page and page<->page. Dragging a BP moves it
  // WITH all contents -- every PO fully inside its footprint, and every SI
  // seated on one of those POs' sockets (their `host` needs no rewriting,
  // only their container array membership changes, since host keys PO by
  // uid). This is why the inv/canvas containers deliberately mirror each
  // other's {bps,pos,sis} shape: a transfer is nothing more than "splice
  // these 3 kinds of records out of container A's arrays, into container
  // B's arrays, and shift the moved POs' absolute [row,col] cell by the
  // BP's new-origin-minus-old-origin delta" -- the SAME arithmetic
  // moveBP/invMoveBP already use for an in-place BP move, just crossing a
  // container boundary too.
  //
  // Location descriptor shape: {loc:'canvas'} | {loc:'inv', page:N}
  // (N is 0-based page index, 0..4). Chosen over per-record container refs
  // (e.g. tagging every BP/PO/SI with its own {loc,page}) because it keeps
  // ALL existing canvas code paths byte-identical: st.bps/st.pos/st.sis
  // stay flat arrays with the OLD record shape (no new fields), and the
  // "which container is this record in" question is answered by which
  // array it currently lives in, not by a field on the record itself.
  // =======================================================================
  // Reference model core (REQ-0033 Phase 1).
  //
  // Inventory is MASTER: every uid (PO/BP/SI) has exactly ONE home record,
  // living in st.inv.pages[n].{pos,bps,sis}. A "reference" is a SEPARATE
  // record, SAME uid, SAME shape as the home record (a PO reference is
  // {uid,id,loc,cell,rot}; a BP reference is the usual {id,name,color,
  // shape,origin,linker} object; an SI reference is {uid,id,host}) living
  // in a preset's canvas -- st.{bps,pos,sis} for the ACTIVE preset, or
  // st.presets.store[i].{bps,pos,sis} for an inactive one. This is why
  // NOTHING about canPlacePO/movePO/cellsOf/sockets/traceBeams/combos/
  // switchPreset needs to change: they only ever read/write "whichever
  // array the record currently lives in" and were always agnostic to
  // whether that record was the sole copy of a uid or one of several.
  //
  // A uid may have AT MOST ONE reference per preset (that preset's own
  // canvas), but the SAME uid may be simultaneously referenced by several
  // DIFFERENT presets -- each such reference is an independent record with
  // its own cell/rot/origin/host, so e.g. an SI can be seated in preset A
  // and stowed in preset B at the same time ("preset owns its SI seat
  // state after creation").
  //
  // usageOf(st,uid): every preset index (0-based) that currently holds a
  // reference to `uid`, scanning the ACTIVE preset's top-level fields
  // (st.bps/pos/sis) for st.presets.active, and every OTHER preset's
  // store[i] snapshot for the rest. Deliberately recomputed on demand
  // (never cached/stored) -- REQ-0033 orchestrator direction: "prefer
  // computing from active canvas + presets.store on demand over stored
  // duplication" -- at this scale (PRESET_COUNT=5, a few dozen placed
  // items) a full preset scan is microseconds; see the perf note on
  // tintSets below for the measurement.
  function presetCanvasOf(st,idx){
    return idx===st.presets.active?{bps:st.bps,pos:st.pos,sis:st.sis}:(st.presets.store[idx]||{bps:[],pos:[],sis:[]});
  }
  function presetCount(st){return st.presets?st.presets.store.length:0;}
  function usageOf(st,uid){
    if(!st.presets)return [];
    const out=[];
    for(let i=0;i<presetCount(st);i++){
      const c=presetCanvasOf(st,i);
      const hit=c.pos.some(p=>p.uid===uid)||c.bps.some(b=>b.id===uid)||c.sis.some(a=>a.uid===uid);
      if(hit)out.push(i);
    }
    return out;
  }
  // usedByCurrent/usedByOthers: convenience predicates over usageOf(), the
  // direct engine-level building blocks behind the red/yellow rules (spec
  // items 2-3). "Current" means st.presets.active.
  function usedByCurrent(st,uid){
    if(!st.presets)return false;
    return usageOf(st,uid).includes(st.presets.active);
  }
  function usedByOthers(st,uid){
    if(!st.presets)return false;
    const active=st.presets.active;
    return usageOf(st,uid).some(i=>i!==active);
  }
  // Every uid (PO/BP/SI) that currently has a HOME in the shared inventory
  // -- the universe tintSets()/isUnitIndependent() need to scan. Canvas-
  // only synthetic fixtures (tests that hand-build a `st` with no st.inv at
  // all) simply produce an empty universe -- these queries then correctly
  // report empty red/yellow sets rather than throwing.
  function allHomeUids(st){
    const out=[];
    if(!st.inv)return out;
    for(const pg of st.inv.pages){
      for(const p of pg.pos)out.push(p.uid);
      for(const b of pg.bps)out.push(b.id);
      for(const a of pg.sis)out.push(a.uid);
    }
    return out;
  }
  // tintSets(st): {red,yellow,canvasYellow} -- all Sets of uid strings.
  //   red: every uid referenced by the CURRENT preset (spec item 2) --
  //     shown in the INVENTORY with the red "already used here" tint, and
  //     also the set the red rule (createRef) itself refuses to duplicate.
  //   yellow: every uid used by at least one OTHER preset (spec item 3) --
  //     shown in the INVENTORY with the yellow "shared elsewhere" tint.
  //     NOT mutually exclusive with red: a uid can be referenced by the
  //     current preset AND by another preset at the same time (red wins
  //     visually in the inventory per spec's red-vs-yellow framing, but
  //     both booleans are exposed here -- rendering policy is a Phase 2
  //     concern, not this function's).
  //   canvasYellow: the subset of `red` that is ALSO in `yellow` -- i.e.
  //     uids sitting on the CURRENT canvas right now that are shared with
  //     some other preset ("the same yellow indicator also shows on the
  //     Preset(canvas) display", spec item 3).
  // Perf: O(PRESET_COUNT x items-per-preset) per uid tested x number of
  // home uids scanned = O(homes x presets x canvas-size), i.e. a handful
  // of presets times a few dozen items -- comfortably sub-millisecond at
  // this game's scale; no caching/index maintenance is warranted (measured
  // via the perf smoke test in run.cjs).
  function tintSets(st){
    const red=new Set(),yellow=new Set();
    for(const uid of allHomeUids(st)){
      const usage=usageOf(st,uid);
      if(!usage.length)continue;
      const cur=st.presets&&usage.includes(st.presets.active);
      const others=usage.some(i=>!st.presets||i!==st.presets.active);
      if(cur)red.add(uid);
      if(others)yellow.add(uid);
    }
    const canvasYellow=new Set([...red].filter(u=>yellow.has(u)));
    return {red,yellow,canvasYellow};
  }
  // isUnitIndependent(st,n): true iff preset n's referenced uids share NO
  // uid with any OTHER preset -- "a Preset containing ZERO yellow-tinted
  // items is an independent Unit" (spec item 5), phrased as a direct
  // per-preset predicate rather than requiring the caller to intersect
  // tintSets() themselves. Empty presets are vacuously independent.
  function isUnitIndependent(st,n){
    if(!st.presets)return true;
    const mine=presetCanvasOf(st,n);
    const mineUids=new Set([...mine.pos.map(p=>p.uid),...mine.bps.map(b=>b.id),...mine.sis.map(a=>a.uid)]);
    if(!mineUids.size)return true;
    for(let i=0;i<presetCount(st);i++){
      if(i===n)continue;
      const other=presetCanvasOf(st,i);
      for(const p of other.pos)if(mineUids.has(p.uid))return false;
      for(const b of other.bps)if(mineUids.has(b.id))return false;
      for(const a of other.sis)if(mineUids.has(a.uid))return false;
    }
    return true;
  }

  // homeLocationOf(st,uid): {page,kind,record} locating uid's ONE home
  // record in st.inv.pages, or null if it has no home (not yet migrated,
  // or a synthetic test fixture with no st.inv). kind: 'po'|'bp'|'si'.
  function homeLocationOf(st,uid){
    if(!st.inv)return null;
    for(let pg=0;pg<st.inv.pages.length;pg++){
      const c=st.inv.pages[pg];
      const p=c.pos.find(x=>x.uid===uid);
      if(p)return {page:pg,kind:'po',record:p};
      const b=c.bps.find(x=>x.id===uid);
      if(b)return {page:pg,kind:'bp',record:b};
      const a=c.sis.find(x=>x.uid===uid);
      if(a)return {page:pg,kind:'si',record:a};
    }
    return null;
  }

  // createRef(st,kind,uid,placement): creates a REFERENCE to a home item
  // in the CURRENT preset's canvas (st.pos/bps/sis). Refuses (red rule) if
  // the current preset already holds a reference to this uid. The home
  // record is left untouched in st.inv.pages. `placement` shape depends on
  // `kind`:
  //   'po': {cell,rot} (or 'inv' meaning "no canvas presence" -- but a
  //     bare createRef is only ever called to PLACE onto canvas, so
  //     'inv' is not a valid placement here; use removeRef to go back).
  //   'bp': {origin} -- contents are NOT handled here (see
  //     bpReferenceSet/transferBP for the nested-content walk).
  //   'si': {host} -- typically {po:refUid,si:index} (seating onto an
  //     ALREADY-referenced PO's socket) or 'inv' (a bare stowed reference,
  //     e.g. an SI referenced onto the canvas without being seated yet --
  //     not currently reachable from the client's own drag UX, but kept
  //     legal at the engine level since nothing else requires it be seated
  //     immediately).
  // Returns {ok:false,why:'already referenced by current preset'} (the red
  // rule) or {ok:false,why:'no home'} if uid has no home record at all.
  function createRef(st,kind,uid,placement){
    if(usedByCurrent(st,uid))return {ok:false,why:'already referenced by current preset'};
    const home=homeLocationOf(st,uid);
    if(!home||home.kind!==kind)return {ok:false,why:'no home'};
    if(kind==='po'){
      const src=home.record;
      const ref={uid:src.uid,id:src.id,loc:'grid',cell:placement.cell,rot:(placement.rot!=null?placement.rot:src.rot)};
      // Validate canvas placement legality (bounds/BP-containment/overlap)
      // the SAME way movePO always has -- push first (canPlacePO needs the
      // uid present in st.pos to compute its own-uid exclusion correctly,
      // same chicken-and-egg the client's previewCrossBoardPO workaround
      // exists for today), then roll back on rejection so a failed
      // reference creation leaves st untouched, matching transferBP's
      // "fails cleanly" contract.
      st.pos.push(ref);
      const chk=canPlacePO(st,uid,ref.rot,ref.cell);
      if(!chk.ok){st.pos.pop();return chk;}
      return {ok:true,ref};
    }
    if(kind==='bp'){
      const src=home.record;
      const ref={id:src.id,name:src.name,color:src.color,shape:src.shape,origin:placement.origin,linker:src.linker};
      st.bps.push(ref);
      return {ok:true,ref};
    }
    if(kind==='si'){
      const src=home.record;
      const ref={uid:src.uid,id:src.id,host:'inv'};
      st.sis.push(ref);
      if(placement.host&&placement.host!=='inv'){
        const skey=placement.host==='bond'?'bond':(placement.host.po+':'+placement.host.si);
        const seat=seatSI(st,uid,skey);
        if(!seat.ok){st.sis.pop();return seat;}
      }
      return {ok:true,ref};
    }
    return {ok:false,why:'unknown kind'};
  }

  // removeRef(st,kind,uid): removes the CURRENT preset's reference to uid
  // (if any) from st.pos/bps/sis. The home record is NEVER touched -- the
  // item stays exactly where it already is in inventory (canvas->inv drag
  // under the reference model: "drop cell irrelevant", spec + engine
  // design section). A no-op {ok:true,removed:false} if the current
  // preset holds no such reference (nothing to remove is not an error).
  function removeRef(st,kind,uid){
    if(kind==='po'){
      const idx=st.pos.findIndex(p=>p.uid===uid);
      if(idx===-1)return {ok:true,removed:false};
      st.pos.splice(idx,1);
      st.sis=st.sis.filter(a=>!(a.host&&typeof a.host==='object'&&a.host.po===uid));
      unseatOrphans(st);
      return {ok:true,removed:true};
    }
    if(kind==='bp'){
      const idx=st.bps.findIndex(b=>b.id===uid);
      if(idx===-1)return {ok:true,removed:false};
      st.bps.splice(idx,1);
      return {ok:true,removed:true};
    }
    if(kind==='si'){
      const idx=st.sis.findIndex(a=>a.uid===uid);
      if(idx===-1)return {ok:true,removed:false};
      st.sis.splice(idx,1);
      return {ok:true,removed:true};
    }
    return {ok:false,why:'unknown kind'};
  }

  // bpReferenceSet(st,bpUid): given a BP's uid (its home, wherever it
  // currently sits in st.inv.pages), computes the nested reference set a
  // canvas reference-creation must bring along: {bp:uid, pos:[uid,...],
  // sis:[uid,...], excluded:[uid,...]}. Containment ("which POs are inside
  // this BP") is evaluated against the HOME page (poInBPIn against the
  // home BP's own origin/shape in its home container) -- the home
  // placement is the only page-independent source of truth for "is this
  // PO inside this BP", since canvas references get their OWN origin
  // (spec: "preset keeps its OWN SI seat assignments... after creation",
  // same principle extends to "which POs travel" being decided once, at
  // reference-creation time, from the home arrangement).
  //   pos: home-contained POs NOT already referenced by the current preset.
  //   excluded: home-contained POs that ARE already referenced by the
  //     current preset (spec item 4 -- these are the ones left behind).
  //   sis: SIs seated on any INCLUDED (non-excluded) PO. An excluded PO's
  //     own seated SI does NOT travel (test: "excluded PO's SI stays") --
  //     it simply remains un-referenced by this operation (the SI's home
  //     is untouched either way; only whether a NEW reference is created
  //     for it is affected).
  function bpReferenceSet(st,bpUid){
    const home=homeLocationOf(st,bpUid);
    if(!home||home.kind!=='bp')return {ok:false,why:'no home'};
    const container=st.inv.pages[home.page];
    const bp=home.record;
    const contained=container.pos.filter(p=>poInBPIn(p,bp));
    const pos=[],excluded=[];
    for(const p of contained){
      if(usedByCurrent(st,p.uid))excluded.push(p.uid);
      else pos.push(p.uid);
    }
    const includedSet=new Set(pos);
    const sis=container.sis.filter(a=>a.host&&typeof a.host==='object'&&a.host.po&&includedSet.has(a.host.po)).map(a=>a.uid);
    return {ok:true,bp:bpUid,pos,sis,excluded};
  }

  // ---------------------------------------------------------------------
  // BP transfer under the reference model (REQ-0033 Phase 1).
  //
  // Three distinct cases, dispatched on {from.loc,to.loc}:
  //   inv -> canvas: REFERENCE creation with exclusions (spec item 4).
  //     The BP's home stays in st.inv.pages[from.page] untouched; the
  //     CURRENT preset (`to` must be {loc:'canvas'}) gets a NEW BP
  //     reference at `origin`, plus new PO/SI references for
  //     bpReferenceSet()'s non-excluded contents (placed at the SAME
  //     relative cell offset from the new origin as their home records
  //     have from the BP's home origin -- i.e. the arrangement is
  //     preserved, just translated to the new origin, exactly like the
  //     old physical transferBP's dr/dc shift).
  //   canvas -> inv: REFERENCE removal. Removes the CURRENT preset's BP
  //     reference and every PO/SI reference it brought along (their own
  //     current-preset references, i.e. removeRef('po'/'si') for each
  //     nested uid still referenced by the current preset). The home
  //     record(s) are never touched; `to.page`/`origin` are IGNORED (spec:
  //     "drop cell irrelevant"). `from` must be {loc:'canvas'}.
  //   inv -> inv (page<->page): PHYSICAL home move, byte-identical to the
  //     REQ-0030 behavior (splice the BP's home + its home-contained POs/
  //     SIs from one page's arrays into another's, shifting cells by the
  //     origin delta) -- inventory pages hold homes, not references, so
  //     moving a BP between two pages is still a real relocation of the
  //     one-and-only home record, same as before this REQ.
  // canvas -> canvas is not a reachable case via this function (a single
  // active preset's canvas is the only "canvas" container that exists at
  // a time; moving a reference from one preset to another is expressed as
  // removeRef in the source preset + createRef in the destination preset
  // after switchPreset, not a single transferBP call).
  function bpFrom(container,bpId){return container.bps.find(b=>b.id===bpId);}
  function canTransferBP(st,from,to,bpId,origin){
    if(from.loc==='inv'&&to.loc==='inv'){
      return canTransferBPPhysical(st,from,to,bpId,origin);
    }
    if(from.loc==='inv'&&to.loc==='canvas'){
      const home=homeLocationOf(st,bpId);
      if(!home||home.kind!=='bp'||home.page!==from.page)return {ok:false,why:'BP not found in source container'};
      if(usedByCurrent(st,bpId))return {ok:false,why:'already referenced by current preset'};
      const bp=home.record;
      const newCells=bp.shape.map(([dr,dc])=>[origin[0]+dr,origin[1]+dc]);
      const others=new Set();
      for(const ob of st.bps){for(const [r,c] of bpCellsIn(ob))others.add(key(r,c));}
      for(const [r,c] of newCells){
        if(r<1||r>ROWS||c<1||c>COLS)return {ok:false,cells:newCells,why:'outside canvas'};
        if(others.has(key(r,c)))return {ok:false,cells:newCells,why:'overlaps another BP'};
      }
      return {ok:true,cells:newCells};
    }
    if(from.loc==='canvas'&&to.loc==='inv'){
      const idx=st.bps.findIndex(b=>b.id===bpId);
      if(idx===-1)return {ok:false,why:'BP not found in source container'};
      return {ok:true,cells:bpCellsIn(st.bps[idx])};
    }
    return {ok:false,why:'unsupported transfer'};
  }
  function canTransferBPPhysical(st,from,to,bpId,origin){
    const src=page(st,from.page);
    const bp=bpFrom(src,bpId);
    if(!bp)return {ok:false,why:'BP not found in source container'};
    const inside=src.pos.filter(p=>poInBPIn(p,bp));
    const tmpContainer={bps:page(st,to.page).bps,pos:page(st,to.page).pos,sis:page(st,to.page).sis};
    const newCells=bp.shape.map(([dr,dc])=>[origin[0]+dr,origin[1]+dc]);
    const others=new Set();
    for(const ob of tmpContainer.bps){for(const [r,c] of bpCellsIn(ob))others.add(key(r,c));}
    const occ=invOccupancy(tmpContainer,inside.map(p=>p.uid));
    for(const [r,c] of newCells){
      if(r<1||r>ROWS||c<1||c>COLS)return {ok:false,cells:newCells,why:'outside page'};
      if(others.has(key(r,c)))return {ok:false,cells:newCells,why:'overlaps another BP'};
      if(occ[key(r,c)])return {ok:false,cells:newCells,why:'overlaps free-placed item'};
    }
    return {ok:true,cells:newCells};
  }

  // transferBP: mutates. Fails CLEANLY (state untouched) when illegal --
  // legality is checked FIRST via canTransferBP, before any mutation.
  function transferBP(st,from,to,bpId,origin){
    const chk=canTransferBP(st,from,to,bpId,origin);
    if(!chk.ok)return chk;
    if(from.loc==='inv'&&to.loc==='inv')return transferBPPhysical(st,from,to,bpId,origin);
    if(from.loc==='inv'&&to.loc==='canvas')return transferBPCreateRef(st,from,bpId,origin);
    if(from.loc==='canvas'&&to.loc==='inv')return transferBPRemoveRef(st,bpId);
    return {ok:false,why:'unsupported transfer'};
  }
  function transferBPCreateRef(st,from,bpId,origin){
    const home=homeLocationOf(st,bpId);
    const bp=home.record;
    const dr=origin[0]-bp.origin[0],dc=origin[1]-bp.origin[1];
    const nested=bpReferenceSet(st,bpId);
    const bpRef=createRef(st,'bp',bpId,{origin});
    for(const uid of nested.pos){
      const poHome=homeLocationOf(st,uid).record;
      createRef(st,'po',uid,{cell:[poHome.cell[0]+dr,poHome.cell[1]+dc],rot:poHome.rot});
    }
    for(const uid of nested.sis){
      const siHome=homeLocationOf(st,uid).record;
      createRef(st,'si',uid,{host:siHome.host});
    }
    unseatOrphans(st);
    return bpRef;
  }
  function transferBPRemoveRef(st,bpId){
    const bpRefIdx=st.bps.findIndex(b=>b.id===bpId);
    const bpRef=st.bps[bpRefIdx];
    // every PO reference currently on canvas that is contained within this
    // BP reference's OWN footprint (its canvas origin/shape, NOT the home
    // one) is nested content that arrived with it -- remove those
    // references too (their homes are untouched).
    const nestedUids=st.pos.filter(p=>poInBPIn(p,bpRef)).map(p=>p.uid);
    for(const uid of nestedUids)removeRef(st,'po',uid);
    removeRef(st,'bp',bpId);
    return {ok:true};
  }
  function transferBPPhysical(st,from,to,bpId,origin){
    const src=page(st,from.page),dst=page(st,to.page);
    const bp=bpFrom(src,bpId);
    const inside=src.pos.filter(p=>poInBPIn(p,bp));
    const insideUids=new Set(inside.map(p=>p.uid));
    const insideSis=src.sis.filter(a=>a.host&&a.host.po&&insideUids.has(a.host.po));
    const dr=origin[0]-bp.origin[0],dc=origin[1]-bp.origin[1];
    src.bps=src.bps.filter(b=>b.id!==bpId);
    bp.origin=origin;
    dst.bps.push(bp);
    src.pos=src.pos.filter(p=>!insideUids.has(p.uid));
    for(const p of inside)p.cell=[p.cell[0]+dr,p.cell[1]+dc];
    dst.pos.push(...inside);
    src.sis=src.sis.filter(a=>!(a.host&&a.host.po&&insideUids.has(a.host.po)));
    dst.sis.push(...insideSis);
    return {ok:true};
  }

  // linkStateInv (dormancy helper): NO new traceBeams/connections variant
  // is added for pages -- Linker dormancy (spec item 7) is enforced simply
  // by traceBeams/connectionsFrom/allConnections/combos continuing to
  // iterate ONLY st.bps/st.pos (the canvas arrays), never st.inv.pages[].
  // A BP sitting in an inventory page is, structurally, not a member of
  // st.bps at all while it's there -- so it is automatically invisible to
  // every canvas-only computation with ZERO extra guard code. This is
  // verified by an explicit test (a linker-bearing BP transferred into a
  // page must contribute nothing to traceBeams()).

  // migrateState(oldState): accepts the LEGACY shape and returns a NEW
  // state object with a populated st.inv (does not mutate oldState).
  // Legacy representation found in this codebase (see report):
  //   - Legacy "inventory" was never spatial -- it was implicit LIST
  //     membership via existing sentinel fields, not a separate list
  //     structure:
  //       * unplaced PO: a st.pos[] entry with loc==='inv', cell===null
  //         (rot preserved).
  //       * unplaced/unseated SI: a st.sis[] entry with host==='inv'
  //         (string sentinel, unrelated to any page/cell).
  //   - Canvas-placed POs/BPs and seated SIs are untouched by migration.
  // migrateState() first-fit places legacy unplaced POs (in st.pos order),
  // THEN legacy unplaced SIs (in st.sis order, as free 1x1 placements),
  // onto page 1 (index 0) -- per REQ-0030 orchestrator default ("POs
  // first, then SIs"). If page 1 fills up, remaining items overflow onto
  // page 2, page 3, ... (still first-fit, still deterministic scan order
  // row-major top-left-to-bottom-right) rather than being silently
  // dropped -- resolved ambiguity (see report): the REQ text says "onto
  // page 1" without specifying overflow behavior; dropping items on
  // migration would be a silent data-loss bug, so overflow-to-next-page is
  // the safe interpretation.
  // firstFitBPOrigin(container,shape): like firstFitCell, but for placing
  // a whole NEW BP's own footprint (a BP does not need to land "inside"
  // another BP the way a PO does -- it needs bounds-fit, no overlap with
  // an EXISTING BP, and no overlap with any free-placed PO/SI already in
  // the page). Used only by migrateState v3 to find a first-fit home
  // origin for a canvas-resident BP with no home yet. Deliberately a
  // separate scan from firstFitCell (which enforces invCanPlaceCells'
  // PO-in-BP containment law -- wrong rule for placing a BP itself).
  function firstFitBPOrigin(container,shape){
    const others=new Set();
    for(const ob of container.bps)for(const [r,c] of bpCellsIn(ob))others.add(key(r,c));
    const occ=invOccupancy(container,[]);
    for(let r=1;r<=ROWS;r++){
      for(let c=1;c<=COLS;c++){
        const cells=shape.map(([dr,dc])=>[r+dr,c+dc]);
        let good=true;
        for(const [cr,cc] of cells){
          if(cr<1||cr>ROWS||cc<1||cc>COLS){good=false;break;}
          if(others.has(key(cr,cc))){good=false;break;}
          if(occ[key(cr,cc)]){good=false;break;}
        }
        if(good)return [r,c];
      }
    }
    return null;
  }
  function firstFitCell(container,shapeOff){
    for(let r=1;r<=ROWS;r++){
      for(let c=1;c<=COLS;c++){
        const cells=shapeOff.map(([dr,dc])=>[r+dr,c+dc]);
        if(invCanPlaceCells(container,cells,[]).ok)return [r,c];
      }
    }
    return null;
  }
  function firstFitSICell(container){
    const cbp=cellBPMapIn(container),occ=invOccupancy(container,[]);
    for(let r=1;r<=ROWS;r++){
      for(let c=1;c<=COLS;c++){
        if(cbp[key(r,c)])continue; // SIs never land on a BP cell (see invCanPlaceSI)
        if(!occ[key(r,c)])return [r,c];
      }
    }
    return null;
  }

  // =======================================================================
  // Preset model (REQ-0031 Phase B).
  //
  // ADDITIVE, on top of the canvas/inventory model above: st.{linked,bps,
  // pos,sis} continues to be THE ACTIVE preset's canvas -- every existing
  // canvas function (movePO, moveBP, traceBeams, combos, ...) keeps reading
  ///writing those same top-level fields, completely unaware presets exist
  // at all. `st.presets = {active, names, store}` sits alongside:
  //   - active: 0-based index of which preset is CURRENTLY live at the
  //     top-level st.{linked,bps,pos,sis} fields.
  //   - names: display names, one per preset, PRESET_COUNT-long by default
  //     ("Preset 1".."Preset 5") but grows by 1 with every addPreset().
  //   - store: one slot per preset, PRESET_COUNT/names-length-long.
  //     store[active] is ALWAYS null (that preset's content lives at the
  //     top level, not duplicated here) -- every OTHER index holds a plain
  //     {linked,bps,pos,sis} snapshot object for that inactive preset.
  //
  // switchPreset(st,n) is the ONLY mutator that moves content between the
  // top level and store[]; it is atomic (both directions happen in one
  // call, never leaving a half-swapped state even if this function were
  // to throw mid-way -- it does not, since neither step can fail: n is
  // range-checked up front and the swap itself is unconditional object
  // reassignment, not a legality-gated placement).
  //
  // Physicality (REQ-0031 preset model decision, flagged to the user): a
  // uid (PO or SI) lives in EXACTLY ONE place across the shared inventory
  // (st.inv.pages[]) and every preset (the active top-level fields, plus
  // every inactive store[] snapshot) at all times. This falls out
  // constructively rather than needing active enforcement: new presets
  // ALWAYS start empty (addPreset below never copies/shares any uid), and
  // the only way an item ever reaches a preset's canvas is by a normal
  // drag from the shared inventory (or another preset's canvas, via the
  // shared inventory) using the SAME movePO/moveBP/transferBP mutators
  // presets never bypass. checkUidInvariant() below is a read-only auditor
  // for this invariant, used by tests (and available to any future caller
  // wanting to assert the invariant still holds after a sequence of
  // mutations) -- it is not itself part of the mutation path.
  const PRESET_COUNT=5;

  function defaultPresetNames(n){
    const out=[];
    for(let i=0;i<n;i++)out.push('Preset '+(i+1));
    return out;
  }

  // emptyPresetSlot(): a fresh, EMPTY preset snapshot -- {linked:true,
  // bps:[],pos:[],sis:[]}, same shape as the top-level canvas fields.
  // "New presets start empty (BPs are physical too)" (REQ-0031) -- no
  // items/BPs are ever copied into a newly-added preset.
  function emptyPresetSlot(){
    return {linked:true,bps:[],pos:[],sis:[]};
  }

  // makePresetsMeta(count): a fresh {active:0,names:[...],store:[...]}
  // block for `count` presets, slot 0 (the default active one) has
  // store[0]=null (its content lives at the top level, supplied by the
  // caller -- see makeState()'s own construction), every other slot holds
  // an empty preset snapshot.
  function makePresetsMeta(count){
    const names=defaultPresetNames(count);
    const store=[];
    for(let i=0;i<count;i++)store.push(i===0?null:emptyPresetSlot());
    return {active:0,names,store};
  }

  // switchPreset(st,n): atomic swap of the ACTIVE preset's top-level
  // canvas fields (st.linked/bps/pos/sis) with store[n]'s snapshot --
  // st.presets.active becomes n. Both configurations (the one being
  // switched OUT and the one being switched IN) are fully preserved: the
  // outgoing active canvas is written into store[oldActive] (never
  // discarded), and the incoming store[n] snapshot becomes the new live
  // top-level fields (store[n] is then set to null, since that preset's
  // content now lives at the top level like every other active preset
  // always does). A no-op (still {ok:true}) if n is already the active
  // preset.
  function switchPreset(st,n){
    if(!st.presets)return {ok:false,why:'no presets'};
    const meta=st.presets;
    if(!(n>=0&&n<meta.store.length))return {ok:false,why:'preset index out of range'};
    if(n===meta.active)return {ok:true};
    const outgoing={linked:st.linked,bps:st.bps,pos:st.pos,sis:st.sis};
    const incoming=meta.store[n];
    meta.store[meta.active]=outgoing;
    st.linked=incoming.linked;st.bps=incoming.bps;st.pos=incoming.pos;st.sis=incoming.sis;
    meta.store[n]=null;
    meta.active=n;
    unseatOrphans(st);
    return {ok:true};
  }

  // addPreset(st,name?): appends a brand-new EMPTY preset (never copies
  // any content/uid from anywhere -- "Preset+ appends a preset", REQ-0031)
  // to st.presets.store, and a matching entry to st.presets.names
  // (defaults to "Preset N" where N is the new 1-based slot number).
  // Returns the new preset's 0-based index so callers (e.g. the client's
  // "Preset+" button) can immediately switchPreset() to it.
  function addPreset(st,name){
    if(!st.presets)return {ok:false,why:'no presets'};
    const meta=st.presets;
    const idx=meta.store.length;
    meta.store.push(emptyPresetSlot());
    meta.names.push(name?String(name):('Preset '+(idx+1)));
    return {ok:true,index:idx};
  }

  // renamePreset(st,n,name): sets preset n's (0-based) display name. Works
  // for the active preset or any stored one identically (names[] is
  // independent of which slot is currently active).
  function renamePreset(st,n,name){
    if(!st.presets)return {ok:false,why:'no presets'};
    const meta=st.presets;
    if(!(n>=0&&n<meta.names.length))return {ok:false,why:'preset index out of range'};
    meta.names[n]=String(name);
    return {ok:true};
  }

  // ---------------------------------------------------------------------
  // reorderPreset/deletePreset (REQ-0032). Both operate on the FULL
  // logical array of preset slots -- names[] and a "materialized" store[]
  // where the active slot's real content (which normally lives at the
  // top-level st.linked/bps/pos/sis fields, not in store[active]) is
  // substituted in for the splice/slice, then the result is re-split back
  // into {top-level fields, store[], active} exactly like switchPreset
  // already does. This means the preset's store/names/reference-set data
  // always "moves as a unit" for free -- there is no separate per-index
  // bookkeeping to keep in sync, because usageOf/tintSets/homeLocationOf
  // etc. are ALL live scans over st.presets.store (via presetCanvasOf)
  // rather than anything cached by index; once the arrays are correctly
  // permuted, every derived query is automatically correct on the next
  // call (no invalidation step needed).
  //
  // active-index adjustment rule (shared by both reorder directions):
  //   - if the moved slot (`from`) IS the active preset, active simply
  //     FOLLOWS it to `to` (the same preset is still "the one that's
  //     live", just relabeled to a new position).
  //   - otherwise, active only shifts by one slot if `from` and `to`
  //     straddle it (i.e. the splice pulled the active slot's neighbors
  //     across it): moving a preset from BEFORE active to AT/AFTER active
  //     shifts active left by one (its old neighbors closed the gap);
  //     moving a preset from AFTER active to AT/BEFORE active shifts
  //     active right by one. A move entirely on one side of active (both
  //     `from` and `to` less than active, or both greater) never touches
  //     active's index at all -- the preset active still identifies is
  //     unaffected either way.
  function reorderPresetIndex(active,from,to){
    if(from===active)return to;
    if(from<active&&to>=active)return active-1;
    if(from>active&&to<=active)return active+1;
    return active;
  }
  // materializePresets(st): the logical store[] with the active slot's
  // real snapshot substituted in (a plain {linked,bps,pos,sis} object --
  // NOT a reference to the live top-level fields, since callers below
  // reassign the top-level fields separately after the splice).
  function materializePresets(st){
    const meta=st.presets;
    return meta.store.map((slot,i)=>i===meta.active?{linked:st.linked,bps:st.bps,pos:st.pos,sis:st.sis}:slot);
  }
  // splitBackPresets(st,slots,names,active): the inverse of
  // materializePresets -- writes `slots`/`names`/`active` back into
  // st.presets/top-level fields, restoring store[active]=null and copying
  // the active slot's snapshot fields onto st.linked/bps/pos/sis (same
  // shape switchPreset already produces).
  function splitBackPresets(st,slots,names,active){
    const activeSlot=slots[active];
    st.linked=activeSlot.linked;st.bps=activeSlot.bps;st.pos=activeSlot.pos;st.sis=activeSlot.sis;
    const store=slots.map((slot,i)=>i===active?null:slot);
    st.presets={active,names,store};
  }
  // reorderPreset(st,from,to): moves preset slot `from` to index `to`
  // (both 0-based; `to` is the DESTINATION index in the post-move array,
  // i.e. same "splice one out, splice it back in at `to`" semantics as
  // Array.prototype.splice used twice -- NOT "insert before/after"
  // ambiguity, see the reorder tests for concrete before/after arrays).
  // The preset's entire slot (store content + its own names[] entry)
  // moves together as a unit. No-op (still {ok:true}) if from===to.
  function reorderPreset(st,from,to){
    if(!st.presets)return {ok:false,why:'no presets'};
    const meta=st.presets;
    const len=meta.store.length;
    if(!(from>=0&&from<len))return {ok:false,why:'from index out of range'};
    if(!(to>=0&&to<len))return {ok:false,why:'to index out of range'};
    if(from===to)return {ok:true};
    const slots=materializePresets(st);
    const names=meta.names.slice();
    const [movedSlot]=slots.splice(from,1);
    slots.splice(to,0,movedSlot);
    const [movedName]=names.splice(from,1);
    names.splice(to,0,movedName);
    const newActive=reorderPresetIndex(meta.active,from,to);
    splitBackPresets(st,slots,names,newActive);
    return {ok:true};
  }

  // deletePreset(st,n): removes preset `n` ENTIRELY -- its reference set
  // (store slot) and its names[] entry both vanish. Refuses (returns
  // {ok:false}, does NOT mutate st at all) when n is the last remaining
  // preset (must always keep at least 1). Per REQ-0033's reference model
  // (which supersedes REQ-0032's original "first-fit physical return"
  // paragraph -- presets hold REFERENCES into inventory, not physical
  // copies), deleting a preset's reference set never touches st.inv: every
  // uid the deleted preset referenced simply loses that one reference;
  // its inventory home (and every OTHER preset's own reference to the
  // same uid, if shared/yellow) is completely untouched.
  //
  // nearest-remaining-tab rule (when the ACTIVE preset is the one
  // deleted): prefer the SAME index in the post-splice (shorter) array if
  // one still exists there (i.e. we deleted somewhere before the end --
  // the preset that used to be at n+1 slides into n, so landing back on
  // index n now shows "the next tab over", a sensible default for a
  // trash-drop gesture where the user's attention stays roughly where
  // it was); otherwise (n was the LAST slot) fall back to the new last
  // index (post-splice length - 1). Deleting a NON-active preset leaves
  // active pointing at the SAME preset it did before, index-shifted left
  // by one if the deleted slot was before it (straddle rule, same idea as
  // reorderPresetIndex above but for a pure removal rather than a move).
  function deletePreset(st,n){
    if(!st.presets)return {ok:false,why:'no presets'};
    const meta=st.presets;
    const len=meta.store.length;
    if(!(n>=0&&n<len))return {ok:false,why:'preset index out of range'};
    if(len<=1)return {ok:false,why:'cannot delete the last remaining preset'};
    const slots=materializePresets(st);
    const names=meta.names.slice();
    slots.splice(n,1);
    names.splice(n,1);
    const newLen=slots.length;
    let newActive;
    if(n===meta.active){
      newActive=Math.min(n,newLen-1); // same index if still occupied, else new last index
    } else if(n<meta.active){
      newActive=meta.active-1;
    } else {
      newActive=meta.active;
    }
    splitBackPresets(st,slots,names,newActive);
    return {ok:true};
  }

  // checkUidInvariant(st): read-only auditor for the "one uid, exactly one
  // place" physicality rule (REQ-0031 preset model decision). Scans every
  // PO/SI uid across: the shared inventory (st.inv.pages[].pos/sis), the
  // ACTIVE preset's canvas (st.pos/st.sis), and every INACTIVE preset's
  // stored snapshot (st.presets.store[i].pos/sis, i!==active). Returns
  // {ok:true} if every uid appears exactly once across all of those
  // locations combined, else {ok:false,why,duplicates:[uid,...]} naming
  // every uid that appears 2+ times (an empty `duplicates` list with
  // ok:false never happens -- ok is false if and only if duplicates is
  // non-empty). Does NOT check for "missing" uids (an item deleted
  // outright is not this invariant's concern) -- only duplication.
  // checkUidInvariant(st): read-only auditor for the REQ-0033 reference
  // model invariant (replaces the REQ-0031 "uid lives in exactly one place"
  // physicality rule):
  //   - every uid (PO/BP/SI) has a HOME exactly once across st.inv.pages.
  //   - every preset (the active top-level fields, plus every inactive
  //     store[i] snapshot) holds AT MOST ONE reference to any given uid.
  // Returns {ok:true} when both hold, else {ok:false,why,duplicates:[...]}
  // -- `duplicates` entries are 'po:<uid>'/'bp:<uid>'/'si:<uid>' tagged
  // strings (same convention as REQ-0031's checker) naming every home
  // that appears 2+ times AND every (uid) that has 2+ references within
  // the SAME preset. A uid referenced by several DIFFERENT presets is NOT
  // a violation (that is the yellow/shared case, not a duplicate) -- only
  // >1 reference to the same uid WITHIN one preset's own canvas counts.
  function checkUidInvariant(st){
    const homeSeen=new Map(); // uid -> count, across st.inv.pages only
    const bumpHome=(uid)=>homeSeen.set(uid,(homeSeen.get(uid)||0)+1);
    if(st.inv){
      for(const pg of st.inv.pages){
        for(const p of pg.pos)bumpHome('po:'+p.uid);
        for(const b of pg.bps)bumpHome('bp:'+b.id);
        for(const a of pg.sis)bumpHome('si:'+a.uid);
      }
    }
    const duplicates=[...homeSeen.entries()].filter(([,c])=>c>1).map(([uid])=>uid);
    // per-preset reference duplication: within ONE preset's own canvas,
    // the same uid must never appear twice (that would mean two
    // independent references to the same item coexisting in one preset,
    // which createRef's red-rule check is specifically designed to
    // prevent -- this audits that no OTHER code path ever violated it).
    if(st.presets){
      for(let i=0;i<presetCount(st);i++){
        const c=presetCanvasOf(st,i);
        const seen=new Map();
        const bump=(tag)=>seen.set(tag,(seen.get(tag)||0)+1);
        for(const p of c.pos)bump('po:'+p.uid);
        for(const b of c.bps)bump('bp:'+b.id);
        for(const a of c.sis)bump('si:'+a.uid);
        for(const [tag,cnt] of seen.entries())if(cnt>1)duplicates.push(tag+'@preset'+i);
      }
    }
    if(duplicates.length)return {ok:false,why:'uid(s) violate the home/reference invariant',duplicates};
    return {ok:true,duplicates:[]};
  }

  // migrateState v3 (REQ-0033): rebuilds any older-shaped saved state into
  // the reference model. Chains through the EXISTING v1/v2 migration path
  // first (unchanged -- legacy loc:'inv'/host:'inv' list-membership items
  // still become spatial inventory homes exactly as before, and a
  // pre-preset save still gets its 5-preset scaffold), THEN performs the
  // v3 step: any uid CURRENTLY sitting physically on a canvas (the active
  // top-level fields OR any preset's store[i] snapshot) is, under the old
  // model, its own sole copy -- v3 gives each such uid a first-fit
  // INVENTORY home (same firstFitCell/firstFitSICell scan already used for
  // legacy list-membership items) and REPLACES the physical canvas record
  // with a reference (same uid, same cell/rot/origin/host -- the visible
  // arrangement is byte-preserved, only its "am I the only copy" status
  // changes). BPs get inventory homes first (so their contained POs' BP-
  // containment/home page is well-defined), then POs, then SIs.
  //
  // Idempotent: a state that has ALREADY been through v3 (every canvas-
  // resident uid already has a home in st.inv.pages) leaves every record
  // untouched -- the "does uid already have a home" check below is exactly
  // what makes a second migrateState() call a no-op for those uids.
  function migrateState(oldState){
    const st=migrateStateV2(oldState);
    migrateCanvasToReferencesV3(st);
    return st;
  }
  // migrateStateV2: the REQ-0030/0031 legacy-shape migration, extracted
  // unchanged (byte-identical logic) so v3 can chain through it via a
  // plain function call instead of duplicating it inline.
  function migrateStateV2(oldState){
    const st=JSON.parse(JSON.stringify(oldState)); // never mutate the input
    if(!st.inv)st.inv=emptyInventory();
    if(!Array.isArray(st.inv.names)||st.inv.names.length!==PAGE_COUNT)st.inv.names=defaultPageNames();
    if(!st.presets)st.presets=makePresetsMeta(PRESET_COUNT);
    const legacyPOs=st.pos.filter(p=>p.loc==='inv');
    const legacySIs=st.sis.filter(a=>a.host==='inv');
    const migratedPOUids=new Set(),migratedSIUids=new Set();
    let pageIdx=0;
    for(const p of legacyPOs){
      let placedOn=null;
      while(pageIdx<PAGE_COUNT){
        const container=st.inv.pages[pageIdx];
        const cell=firstFitCell(container,shapeInfo(p.id,p.rot).off);
        if(cell){placedOn={pageIdx,cell};break;}
        pageIdx++;
      }
      if(!placedOn)break;
      p.loc='grid';p.cell=placedOn.cell;
      st.inv.pages[placedOn.pageIdx].pos.push(p);
      migratedPOUids.add(p.uid);
    }
    st.pos=st.pos.filter(p=>!migratedPOUids.has(p.uid));
    pageIdx=0;
    for(const a of legacySIs){
      let placedOn=null;
      while(pageIdx<PAGE_COUNT){
        const container=st.inv.pages[pageIdx];
        const cell=firstFitSICell(container);
        if(cell){placedOn={pageIdx,cell};break;}
        pageIdx++;
      }
      if(!placedOn)break;
      a.host={page:placedOn.pageIdx,cell:placedOn.cell};
      st.inv.pages[placedOn.pageIdx].sis.push(a);
      migratedSIUids.add(a.uid);
    }
    st.sis=st.sis.filter(a=>!migratedSIUids.has(a.uid));
    return st;
  }
  // migrateCanvasToReferencesV3: MUTATES `st` in place (st is already a
  // fresh deep clone by the time migrateState calls this, via
  // migrateStateV2's own JSON round-trip -- no separate clone needed
  // here). Walks every preset's canvas (active top-level fields, plus
  // every store[i] snapshot) exactly once, giving each not-yet-homed
  // canvas-resident uid a first-fit inventory home and leaving its canvas
  // record in place AS a reference (no further edit needed to the record
  // itself -- a physical record and a reference record are byte-identical
  // in shape; only the bookkeeping of "does a home exist elsewhere"
  // changes). Order: BPs first, then POs, then SIs.
  function migrateCanvasToReferencesV3(st){
    // migrateCanvasToReferencesV3: MUTATES `st` in place (st is already a
    // fresh deep clone by the time migrateState calls this, via
    // migrateStateV2's own JSON round-trip). Walks every preset's canvas
    // (active top-level fields, plus every store[i] snapshot) exactly
    // once, giving each not-yet-homed canvas-resident uid a first-fit
    // inventory home and leaving its canvas record in place AS a
    // reference (a physical record and a reference record are byte-
    // identical in shape; only the bookkeeping of "does a home exist
    // elsewhere" changes).
    //
    // Critical correctness requirement: a BP and the POs it physically
    // contained ON CANVAS must be homed TOGETHER, at the SAME relative
    // offsets, on the SAME page -- otherwise bpReferenceSet()'s home-page
    // containment check (poInBPIn against the home record) would see them
    // as unrelated once migrated (the BP homed on one page, its former
    // contents homed on a totally different page/cell by an independent
    // first-fit scan). So BPs are migrated as a UNIT with their canvas-
    // contained POs and those POs' seated SIs -- mirroring the exact
    // splice-and-shift arithmetic transferBPPhysical/the old transferBP
    // already use for a same-model page<->page move, just landing in a
    // freshly chosen home page/origin instead of a caller-specified one.
    // Any PO that was NOT inside a BP on canvas (a free-placed PO -- not
    // reachable via the current client UX, since canvas always requires a
    // BP host, but tolerated defensively) is homed independently as its
    // own free-placed inventory item. SIs not seated on any BP-contained
    // PO (e.g. the 'bond' assembly guard) are homed independently as
    // free-placed 1x1 items.
    const canvases=[];
    canvases.push({bps:st.bps,pos:st.pos,sis:st.sis});
    if(st.presets){
      st.presets.store.forEach((snap,i)=>{
        if(i===st.presets.active)return;
        if(snap)canvases.push(snap);
      });
    }
    const homedBP=new Set(),homedPO=new Set(),homedSI=new Set();
    for(const pg of st.inv.pages){
      for(const b of pg.bps)homedBP.add(b.id);
      for(const p of pg.pos)homedPO.add(p.uid);
      for(const a of pg.sis)homedSI.add(a.uid);
    }
    let pageIdx=0;
    for(const c of canvases){
      for(const bp of c.bps){
        if(homedBP.has(bp.id))continue;
        const inside=c.pos.filter(p=>!homedPO.has(p.uid)&&poInBPIn(p,bp));
        const insideUids=new Set(inside.map(p=>p.uid));
        const insideSis=c.sis.filter(a=>a.host&&typeof a.host==='object'&&a.host.po&&insideUids.has(a.host.po));
        let placedOn=null;
        while(pageIdx<PAGE_COUNT){
          const container=st.inv.pages[pageIdx];
          const cell=firstFitBPOrigin(container,bp.shape);
          if(cell){placedOn={pageIdx,cell};break;}
          pageIdx++;
        }
        if(!placedOn)continue; // all pages full -- leave un-homed (never silently drop the reference itself)
        const dr=placedOn.cell[0]-bp.origin[0],dc=placedOn.cell[1]-bp.origin[1];
        const homeBp=JSON.parse(JSON.stringify(bp));
        homeBp.origin=placedOn.cell;
        st.inv.pages[placedOn.pageIdx].bps.push(homeBp);
        homedBP.add(bp.id);
        for(const p of inside){
          st.inv.pages[placedOn.pageIdx].pos.push({uid:p.uid,id:p.id,loc:'grid',cell:[p.cell[0]+dr,p.cell[1]+dc],rot:p.rot});
          homedPO.add(p.uid);
        }
        for(const a of insideSis){
          st.inv.pages[placedOn.pageIdx].sis.push({uid:a.uid,id:a.id,host:{po:a.host.po,si:a.host.si}});
          homedSI.add(a.uid);
        }
      }
    }
    pageIdx=0;
    for(const c of canvases){
      for(const p of c.pos){
        if(homedPO.has(p.uid))continue;
        if(p.loc!=='grid')continue; // no cell to derive a shape-preserving home from
        let placedOn=null;
        while(pageIdx<PAGE_COUNT){
          const container=st.inv.pages[pageIdx];
          const cell=firstFitCell(container,shapeInfo(p.id,p.rot).off);
          if(cell){placedOn={pageIdx,cell};break;}
          pageIdx++;
        }
        if(!placedOn)continue;
        st.inv.pages[placedOn.pageIdx].pos.push({uid:p.uid,id:p.id,loc:'grid',cell:placedOn.cell,rot:p.rot});
        homedPO.add(p.uid);
      }
    }
    pageIdx=0;
    for(const c of canvases){
      for(const a of c.sis){
        if(homedSI.has(a.uid))continue;
        let placedOn=null;
        while(pageIdx<PAGE_COUNT){
          const container=st.inv.pages[pageIdx];
          const cell=firstFitSICell(container);
          if(cell){placedOn={pageIdx,cell};break;}
          pageIdx++;
        }
        if(!placedOn)continue;
        st.inv.pages[placedOn.pageIdx].sis.push({uid:a.uid,id:a.id,host:{page:placedOn.pageIdx,cell:placedOn.cell}});
        homedSI.add(a.uid);
      }
    }
  }
  return {connTargets,portTargets,connectionsFrom,allConnections,contactPairs,rotOffsets,shapeInfo,bpCells,bpHpMax,linkerCell,cellBPMap,linkerMap,cellsOf,occupancy,
          canPlacePO,movePO,rotatePO,canMoveBP,moveBP,poInBP,assembly,canPlaceAssembly,moveAssembly,
          sockets,hostOk,seatSI,stowSI,unseatOrphans,combos,traceBeams,DIRS,key,
          // Inventory model (REQ-0030 Phase 1) -- additive exports only.
          PAGE_COUNT,emptyInventory,invCanPlacePO,invMovePO,invRotatePO,invCanPlaceSI,invMoveSI,
          pageSockets,invSeatSI,invStowSI,invCanPlaceBP,invMoveBP,poInBPIn,cellsOfIn,cellBPMapIn,
          invOccupancy,canTransferBP,transferBP,migrateState,
          // Preset model (REQ-0031 Phase B) -- additive exports only.
          PRESET_COUNT,makePresetsMeta,emptyPresetSlot,switchPreset,addPreset,renamePreset,
          renameInvPage,invPageNames,checkUidInvariant,
          // Reference model (REQ-0033 Phase 1) -- additive exports only.
          usageOf,usedByCurrent,usedByOthers,tintSets,isUnitIndependent,bpReferenceSet,
          createRef,removeRef,homeLocationOf,
          // Tab reorder + preset trash-delete (REQ-0032) -- additive exports only.
          reorderPreset,deletePreset,reorderInvPage};
}
return {create,rotOffsets,hasTag,ancestorsOf,tagsRelated};
});
