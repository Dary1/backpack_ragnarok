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
function create(ITEMS,ACC_DEFS,layout){
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
        const acc=st.accs.find(a=>a.host&&a.host.po===p.uid&&a.host.si===si);
        out.push({skey:p.uid+':'+si,host:p.uid,si,t:s.t,tags:s.tags||[],accUid:acc?acc.uid:null,ax:s.ax,ay:s.ay});
      });
    }
    const asm=assembly(st);
    if(asm){
      const acc=st.accs.find(a=>a.host==='bond');
      out.push({skey:'bond',host:'bond',si:0,t:'bond',tags:['Metal'],accUid:acc?acc.uid:null});
    }
    return out;
  }
  function hostOk(st,accUid,sock){
    const a=st.accs.find(x=>x.uid===accUid),d=ACC_DEFS[a.id];
    if(sock.t!==d.slot)return {ok:false,why:'socket type '+sock.t+' ≠ '+d.slot};
    if(sock.accUid&&sock.accUid!==accUid)return {ok:false,why:'socket occupied'};
    for(const t of (d.reqTags||[]))
      if(!sock.tags.includes(t))return {ok:false,why:'socket lacks tag '+t+' (has: '+(sock.tags.join(', ')||'none')+')'};
    return {ok:true};
  }
  function seatAcc(st,accUid,skey){
    const sock=sockets(st).find(s=>s.skey===skey);
    if(!sock)return {ok:false,why:'no such socket'};
    const v=hostOk(st,accUid,sock);
    if(!v.ok)return v;
    const a=st.accs.find(x=>x.uid===accUid);
    a.host=sock.host==='bond'?'bond':{po:sock.host,si:sock.si};
    return {ok:true};
  }
  function stowAcc(st,accUid){st.accs.find(x=>x.uid===accUid).host='inv';return {ok:true};}
  function unseatOrphans(st){
    const asm=assembly(st);
    for(const a of st.accs){
      if(a.host==='bond'&&!asm)a.host='inv';
      if(a.host&&a.host.po){const p=poByUid(st,a.host.po);if(!p||p.loc!=='grid')a.host='inv';}
    }
  }
  function adjacent(A,B){
    for(const [r1,c1] of A)for(const [r2,c2] of B)
      if(Math.abs(r1-r2)+Math.abs(c1-c2)===1)return true;
    return false;
  }
  // conn = EXTERNAL target tiles this item's tag-connection reaches (directional)
  function connTargets(st,p){
    const def=ITEMS[p.id];
    if(p.loc!=='grid'||!def.conn||!def.conn.length)return [];
    let sh=def.shape.map(o=>[o[0],o[1]]),cn=def.conn.map(o=>[o[0],o[1]]);
    for(let i=0;i<(p.rot%4+4)%4;i++){sh=sh.map(([r,c])=>[c,-r]);cn=cn.map(([r,c])=>[c,-r]);}
    const mr=Math.min(...sh.map(o=>o[0])),mc=Math.min(...sh.map(o=>o[1]));
    return cn.map(([r,c])=>[r-mr+p.cell[0],c-mc+p.cell[1]]);
  }
  function contactPairs(A,B){
    const out=[];
    for(const a of A)for(const b of B)
      if(Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])===1)out.push([a,b]);
    return out;
  }
  function combos(st){
    const out=[],cbp=cellBPMap(st),placed=st.pos.filter(p=>p.loc==='grid');
    const asm=assembly(st);
    if(asm)out.push({name:'Assembled: Longsword',cells:asm.cells,desc:'Blade + Hilt flush-joined → Strike 10 / 4 ticks.'});
    for(const a of placed)for(const b of placed){
      if(a.uid>=b.uid)continue;
      const ca=cellsOf(st,a),cb=cellsOf(st,b);
      if(cbp[key(...ca[0])]!==cbp[key(...cb[0])])continue;
      const ta=connTargets(st,a),tb=connTargets(st,b);
      const hit=(T,cells)=>T.filter(t=>cells.some(c=>c[0]===t[0]&&c[1]===t[1]));
      const pairs=hit(ta,cb).concat(hit(tb,ca)); // target tiles that landed on the partner
      if(!pairs.length)continue;
      const da=ITEMS[a.id],db=ITEMS[b.id];
      const fl=da.el.includes('Flame')?a:(db.el.includes('Flame')?b:null);
      const oil=da.el.includes('Oil')?a:(db.el.includes('Oil')?b:null);
      if(fl&&oil&&fl!==oil)out.push({name:'Ignite',cells:ca.concat(cb),pairs,desc:'Flame + Oil connected → Burn applications ×2.'});
      const wep=(da.type==='Weapon'||a.id==='blade')?a:((db.type==='Weapon'||b.id==='blade')?b:null);
      if(fl&&wep&&fl!==wep)out.push({name:'Flaming Blade',cells:ca.concat(cb),pairs,desc:'Flame connected to a Weapon → adds Burn on hit.'});
    }
    for(const bp of st.bps){
      const beasts=placed.filter(p=>ITEMS[p.id].el.includes('Beast')&&cbp[key(...cellsOf(st,p)[0])]===bp.id);
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
  return {connTargets,contactPairs,rotOffsets,shapeInfo,bpCells,linkerCell,cellBPMap,linkerMap,cellsOf,occupancy,
          canPlacePO,movePO,rotatePO,canMoveBP,moveBP,poInBP,assembly,canPlaceAssembly,moveAssembly,
          sockets,hostOk,seatAcc,stowAcc,unseatOrphans,combos,traceBeams,DIRS,key};
}
return {create,rotOffsets};
});
