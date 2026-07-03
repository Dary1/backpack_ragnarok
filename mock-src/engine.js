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
  // "blade" keeps its pre-existing special-case Weapon-alias for Flaming
  // Blade: blade's own tags are [WeaponPart, Metal] (no Weapon tag), but the
  // OLD code already treated `a.id==='blade'` as Weapon-equivalent for this
  // one recipe (`(hasTag(da.tags,'Weapon',poTree)||a.id==='blade')`). That
  // special case is not expressible purely via tags/ports (it is keyed on
  // item id, not on any tag), so it is preserved here VERBATIM as a documented
  // recipe-level exception rather than silently dropped or reinterpreted.
  const COMBO_RECIPES=[
    {name:'Ignite',ownerTag:'Flame',portTag:'Oil',
     desc:'Flame + Oil connected → Burn applications ×2.'},
    {name:'Flaming Blade',ownerTag:'Flame',portTag:'Weapon',
     desc:'Flame connected to a Weapon → adds Burn on hit.'},
  ];
  // legacyIdAlias: pre-port-model special case, kept VERBATIM rather than
  // dropped or reinterpreted. Before REQ-0023, combos() treated the item id
  // "blade" as Weapon-equivalent for the Flaming Blade recipe specifically
  // (`(hasTag(da.tags,'Weapon',poTree)||a.id==='blade')`), even though
  // blade's own declared tags are [WeaponPart, Metal] -- no Weapon tag, and
  // today's po_tags tree is degenerate (no WeaponPart->Weapon hierarchy
  // edge), so a pure tag-hierarchy connection check can never match blade
  // for a Weapon-tagged port. This is NOT expressible as a tagged port
  // (it's keyed on item id, not a tag), so it is preserved as a narrow,
  // documented, recipe-scoped alias table rather than silently changing
  // this combo's behavior. Keyed by [recipeName][portTag] -> extra id that
  // counts as a match for that port tag, alongside the normal tag-hierarchy
  // check (which still governs every other partner).
  const LEGACY_ID_ALIAS={'Flaming Blade':{'Weapon':['blade']}};
  function partnerMatchesPortTag(recipeName,portTag,partner){
    if(hasTag(ITEMS[partner.id].tags,portTag,poTree))return true;
    const aliases=(LEGACY_ID_ALIAS[recipeName]||{})[portTag]||[];
    return aliases.includes(partner.id);
  }
  function combos(st){
    const out=[],cbp=cellBPMap(st),placed=st.pos.filter(p=>p.loc==='grid');
    const asm=assembly(st);
    if(asm)out.push({name:'Assembled: Longsword',cells:asm.cells,desc:'Blade + Hilt flush-joined → Strike 10 / 4 ticks.'});

    // General connection-based combo resolution (REQ-0023): a port's tiles
    // landing on a partner normally requires the partner to carry the
    // port's tag (checked inside connectionsFrom(), via the PO Tag
    // hierarchy walk). The "blade" legacy alias above is the one
    // pre-existing exception that bypasses connectionsFrom()'s strict tag
    // check -- for that single case only, we re-scan port hits directly
    // instead of trusting allConnections()'s already-tag-filtered list.
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
                if(!partnerMatchesPortTag(recipe.name,needPortTag,partner))continue;
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
  return {connTargets,portTargets,connectionsFrom,allConnections,contactPairs,rotOffsets,shapeInfo,bpCells,linkerCell,cellBPMap,linkerMap,cellsOf,occupancy,
          canPlacePO,movePO,rotatePO,canMoveBP,moveBP,poInBP,assembly,canPlaceAssembly,moveAssembly,
          sockets,hostOk,seatSI,stowSI,unseatOrphans,combos,traceBeams,DIRS,key};
}
return {create,rotOffsets,hasTag,ancestorsOf,tagsRelated};
});
