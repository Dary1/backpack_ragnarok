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
    return {pages};
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
  function containerOf(st,locRef){
    return locRef.loc==='canvas'?st:page(st,locRef.page);
  }
  function bpFrom(container,bpId){return container.bps.find(b=>b.id===bpId);}

  // canTransferBP(st,from,to,bpId,origin): pure (no mutation) legality
  // check for transferring BP `bpId` from container `from` to container
  // `to`, landing at `origin` [row,col] within `to`. Reuses the target
  // container's OWN placement rule (invCanPlaceBP for a page target,
  // canMoveBP's overlap/bounds logic inlined for a canvas target) so a
  // canvas target still enforces canvas's simpler rule (no free-placed
  // items to avoid there -- POs on canvas always belong to a BP already).
  function canTransferBP(st,from,to,bpId,origin){
    const src=containerOf(st,from);
    const bp=bpFrom(src,bpId);
    if(!bp)return {ok:false,why:'BP not found in source container'};
    if(to.loc==='canvas'){
      const newCells=bp.shape.map(([dr,dc])=>[origin[0]+dr,origin[1]+dc]);
      const others=new Set();
      for(const ob of st.bps){for(const [r,c] of bpCellsIn(ob))others.add(key(r,c));}
      for(const [r,c] of newCells){
        if(r<1||r>ROWS||c<1||c>COLS)return {ok:false,cells:newCells,why:'outside canvas'};
        if(others.has(key(r,c)))return {ok:false,cells:newCells,why:'overlaps another BP'};
      }
      return {ok:true,cells:newCells};
    }
    // target is a page: contents traveling with the BP must be excluded
    // from the target's own overlap check (they don't exist there YET,
    // but conceptually they don't collide with themselves).
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
  // legality is checked FIRST via canTransferBP, before any splice, so a
  // rejected transfer never partially moves contents.
  function transferBP(st,from,to,bpId,origin){
    const chk=canTransferBP(st,from,to,bpId,origin);
    if(!chk.ok)return chk;
    const src=containerOf(st,from),dst=containerOf(st,to);
    const bp=bpFrom(src,bpId);
    const inside=src.pos.filter(p=>poInBPIn(p,bp));
    const insideUids=new Set(inside.map(p=>p.uid));
    const insideSis=src.sis.filter(a=>a.host&&a.host.po&&insideUids.has(a.host.po));
    const dr=origin[0]-bp.origin[0],dc=origin[1]-bp.origin[1];
    // splice BP out of src, shift+push into dst
    src.bps=src.bps.filter(b=>b.id!==bpId);
    bp.origin=origin;
    dst.bps.push(bp);
    // splice contained POs out of src.pos, shift cell, push into dst.pos
    src.pos=src.pos.filter(p=>!insideUids.has(p.uid));
    for(const p of inside)p.cell=[p.cell[0]+dr,p.cell[1]+dc];
    dst.pos.push(...inside);
    // splice their seated SIs out of src.sis, push into dst.sis (host
    // untouched -- it names the PO by uid, which is unaffected by the move)
    src.sis=src.sis.filter(a=>!(a.host&&a.host.po&&insideUids.has(a.host.po)));
    dst.sis.push(...insideSis);
    // if the destination is canvas, run unseatOrphans since e.g. a moved
    // blade/hilt pair might now (dis)qualify for the 'bond' assembly seat;
    // inventory containers have no 'bond' concept (see pageSockets note).
    if(to.loc==='canvas')unseatOrphans(st);
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
  function migrateState(oldState){
    const st=JSON.parse(JSON.stringify(oldState)); // never mutate the input
    if(!st.inv)st.inv=emptyInventory();
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
        pageIdx++; // this page is full for this shape -- try the next page
      }
      if(!placedOn)break; // all 5 pages full -- item stays as legacy loc:'inv' (never dropped)
      p.loc='grid';p.cell=placedOn.cell;
      st.inv.pages[placedOn.pageIdx].pos.push(p);
      migratedPOUids.add(p.uid);
    }
    // Remove ONLY the successfully-migrated entries from st.pos; any
    // un-fittable leftovers (all 5 pages full) simply remain in st.pos with
    // their original loc:'inv',cell:null -- never silently dropped.
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
  return {connTargets,portTargets,connectionsFrom,allConnections,contactPairs,rotOffsets,shapeInfo,bpCells,linkerCell,cellBPMap,linkerMap,cellsOf,occupancy,
          canPlacePO,movePO,rotatePO,canMoveBP,moveBP,poInBP,assembly,canPlaceAssembly,moveAssembly,
          sockets,hostOk,seatSI,stowSI,unseatOrphans,combos,traceBeams,DIRS,key,
          // Inventory model (REQ-0030 Phase 1) -- additive exports only.
          PAGE_COUNT,emptyInventory,invCanPlacePO,invMovePO,invRotatePO,invCanPlaceSI,invMoveSI,
          pageSockets,invSeatSI,invStowSI,invCanPlaceBP,invMoveBP,poInBPIn,cellsOfIn,cellBPMapIn,
          invOccupancy,canTransferBP,transferBP,migrateState};
}
return {create,rotOffsets,hasTag,ancestorsOf,tagsRelated};
});
