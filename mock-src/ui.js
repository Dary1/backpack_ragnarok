// backpack_ragnarok mock v0.5 — UI layer (browser only; all logic lives in engine.js)
(function(){
'use strict';
const {LAYOUT,ITEMS,ACC_DEFS}=GameData;
const E=Engine.create(ITEMS,ACC_DEFS,LAYOUT);
const state=GameData.makeState();
const ROWS=LAYOUT.ROWS,COLS=LAYOUT.COLS;
const CELL=80,PAD=38,INVX=PAD+COLS*CELL+34,INVY=PAD,INVW=200,INVCOL=2,INVBOX=92;
const SOCK_GLYPH={gem:'◆',edge:'▷',coat:'●',bond:'▭'};
const ARROWS={0:'↑',1:'↗',2:'→',3:'↘',4:'↓',5:'↙',6:'←',7:'↖'};
const key=E.key,cx=c=>PAD+(c-1)*CELL+CELL/2,cy=r=>PAD+(r-1)*CELL+CELL/2;
const LANG={cur:'ja'};
const T=(d,f)=>LANG.cur==='ja'?(d[f+'_ja']||d[f]):d[f];
const EFF=d=>LANG.cur==='ja'?(d.eff_ja||d.eff):(d.eff_en||d.eff);
const NS='http://www.w3.org/2000/svg';
function el(n,att,parent){const e=document.createElementNS(NS,n);for(const k in att)e.setAttribute(k,att[k]);if(parent)parent.appendChild(e);return e;}
function mapPt(k,x,y,W0,H0){k=k%4;if(k===0)return [x,y];if(k===1)return [H0-y,x];if(k===2)return [W0-x,H0-y];return [y,W0-x];}
const W=PAD*2+COLS*CELL+INVW+42,H=PAD*2+ROWS*CELL;
const svg=el('svg',{width:W,height:H,viewBox:'0 0 '+W+' '+H});
document.getElementById('canvasWrap').appendChild(svg);
const defs=el('defs',{},svg);
const mk=(id,color)=>{const m=el('marker',{id,viewBox:'0 0 10 10',refX:8,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'},defs);el('path',{d:'M0,0 L10,5 L0,10 z',fill:color},m);};
mk('arr','#59d6d6');mk('arrDud','#6a6a6a');
const gBase=el('g',{},svg),gBeams=el('g',{},svg),gItems=el('g',{},svg),gSock=el('g',{},svg),
      gLinkers=el('g',{},svg),gChain=el('g',{},svg),gInvFrame=el('g',{},svg),gInv=el('g',{},svg),
      gTarget=el('g',{'pointer-events':'none'},svg),gCarry=el('g',{'pointer-events':'none'},svg);
el('rect',{x:INVX-10,y:INVY-10,width:INVW+20,height:ROWS*CELL+20,rx:10,fill:'#171512',stroke:'#3a342a','stroke-width':1.5},gInvFrame);
el('text',{x:INVX+INVW/2,y:INVY+12,'text-anchor':'middle',fill:'#c9bd9c','font-size':13,'font-weight':'bold'},gInvFrame).textContent='INVENTORY';
el('text',{x:INVX+INVW/2,y:INVY+28,'text-anchor':'middle',fill:'#6f675a','font-size':10.5},gInvFrame).textContent='items parked here take no effect';

const tooltip=document.getElementById('tooltip');
function showTip(html,ev){tooltip.innerHTML=html;tooltip.style.display='block';moveTip(ev);}
function moveTip(ev){const m=16;let x=ev.clientX+m,y=ev.clientY+m;
  const r=tooltip.getBoundingClientRect();
  if(x+r.width>innerWidth-8)x=ev.clientX-r.width-m;if(y+r.height>innerHeight-8)y=ev.clientY-r.height-m;
  tooltip.style.left=x+'px';tooltip.style.top=y+'px';}
function hideTip(){tooltip.style.display='none';}
function hover(g,html){g.addEventListener('mousemove',moveTip);
  g.addEventListener('mouseenter',e=>showTip(typeof html==='function'?html():html,e));
  g.addEventListener('mouseleave',hideTip);}
function poTip(p){
  const d=ITEMS[p.id],si=E.shapeInfo(p.id,p.rot);
  let s='<h3>'+T(d,'name')+' <span class="r-'+d.rarity+'" style="font-size:12px">'+d.rarity+'</span></h3>'+
  '<div class="shape">'+si.h+'×'+si.w+' (rot '+(p.rot%4*90)+'°) · '+d.type+(d.el.length?' · tags: '+d.el.join(', '):'')+'</div>'+
  '<div class="eff">'+EFF(d)+'</div>';
  const hosted=state.accs.filter(a=>a.host&&a.host.po===p.uid);
  if(hosted.length)s+='<div class="eff ok">Seated: '+hosted.map(a=>ACC_DEFS[a.id].name).join(', ')+'</div>';
  return s;
}
function accTip(a,host){
  const d=ACC_DEFS[a.id];
  return '<h3>'+T(d,'name')+' <span class="r-'+d.rarity+'" style="font-size:12px">'+d.rarity+'</span></h3>'+
  '<div class="shape">Accessory · slot: '+d.slot+' '+SOCK_GLYPH[d.slot]+(d.reqTags.length?' · needs socket tags: '+d.reqTags.join(', '):' · no tag requirement')+(host?' · on '+host:'')+'</div>'+
  '<div class="eff">'+EFF(d)+'</div>';
}
const poByUid=u=>state.pos.find(p=>p.uid===u);
const bpById=id=>state.bps.find(b=>b.id===id);
function poBox(p){const {w,h}=E.shapeInfo(p.id,p.rot);
  return {x:PAD+(p.cell[1]-1)*CELL,y:PAD+(p.cell[0]-1)*CELL,w:w*CELL,h:h*CELL};}
function outlinePath(cells){
  const set=new Set(cells.map(([r,c])=>key(r,c)));let d='';
  for(const [r,c] of cells){
    const x=PAD+(c-1)*CELL,y=PAD+(r-1)*CELL;
    if(!set.has(key(r-1,c)))d+='M'+x+','+y+' h'+CELL+' ';
    if(!set.has(key(r+1,c)))d+='M'+x+','+(y+CELL)+' h'+CELL+' ';
    if(!set.has(key(r,c-1)))d+='M'+x+','+y+' v'+CELL+' ';
    if(!set.has(key(r,c+1)))d+='M'+(x+CELL)+','+y+' v'+CELL+' ';
  }
  return d;
}
function drawPOArt(p,parent,x,y){ // art only, at pixel (x,y), rotation-aware
  const {w,h}=E.shapeInfo(p.id,p.rot);
  const {w:cw,h:ch}=E.shapeInfo(p.id,0),W0=cw*CELL,H0=ch*CELL,k=p.rot%4;
  const tr=['translate('+x+','+y+')','translate('+(x+w*CELL)+','+y+') rotate(90)',
            'translate('+(x+w*CELL)+','+(y+h*CELL)+') rotate(180)','translate('+x+','+(y+h*CELL)+') rotate(270)'][k];
  const inner=el('g',{transform:tr},parent);
  const d=ITEMS[p.id];
  if(d.stretch)el('use',{href:'#'+d.icon,x:W0*0.10,y:4,width:W0*0.80,height:H0-8},inner);
  else el('use',{href:'#'+d.icon,x:W0*0.06,y:H0*0.05,width:W0*0.88,height:H0*0.90},inner);
}
let carry=null;
function renderAll(){
  E.unseatOrphans(state);
  gBase.innerHTML='';gBeams.innerHTML='';gItems.innerHTML='';gSock.innerHTML='';
  gLinkers.innerHTML='';gChain.innerHTML='';gInv.innerHTML='';gTarget.innerHTML='';
  const hiddenBP=(carry&&carry.armed&&carry.kind==='bp')?carry.bpId:null;
  const cbp=E.cellBPMap(state);
  // axis labels
  for(let c=1;c<=COLS;c++)el('text',{x:cx(c),y:PAD-16,fill:'#6f675a','text-anchor':'middle','font-size':12},gBase).textContent=String.fromCharCode(64+c);
  for(let r=1;r<=ROWS;r++)el('text',{x:PAD-16,y:cy(r)+4,fill:'#6f675a','text-anchor':'middle','font-size':12},gBase).textContent=r;
  // cells
  for(let r=1;r<=ROWS;r++)for(let c=1;c<=COLS;c++){
    const id=cbp[key(r,c)],bp=id&&id!==hiddenBP?bpById(id):null;
    el('rect',{x:PAD+(c-1)*CELL,y:PAD+(r-1)*CELL,width:CELL,height:CELL,rx:3,
      fill:bp?bp.color:'#191919','fill-opacity':bp?0.26:1,stroke:bp?bp.color:'#242424','stroke-opacity':bp?0.35:1,'stroke-width':1},gBase);
  }
  const occ=E.occupancy(state);
  const lkm=E.linkerMap(state);
  for(const bp of state.bps){
    if(bp.id===hiddenBP)continue;
    const cells=E.bpCells(bp);
    el('path',{d:outlinePath(cells),stroke:bp.color,'stroke-width':3,fill:'none','stroke-linecap':'square'},gBase);
    const r0=Math.min(...cells.map(c=>c[0])),c0=Math.min(...cells.filter(c=>c[0]===r0).map(c=>c[1]));
    el('text',{x:PAD+(c0-1)*CELL+4,y:PAD+(r0-1)*CELL-6,fill:bp.color,'font-size':12,'font-weight':'bold'},gBase).textContent=bp.name+' · HP '+(cells.length*5);
    // empty cells are BP grab handles
    for(const [r,c] of cells){
      if(occ[key(r,c)]||lkm[key(r,c)])continue;
      const hit=el('rect',{x:PAD+(c-1)*CELL,y:PAD+(r-1)*CELL,width:CELL,height:CELL,fill:'transparent',cursor:'grab'},gBase);
      hit.addEventListener('pointerdown',e=>startCarry(e,'bp',bp.id));
      hover(hit,'<h3>'+bp.name+'</h3><div class="eff">Empty Cell — drag here (or the Linker) to move the whole BP with its contents.</div>');
    }
  }
  // beams
  for(const bm of E.traceBeams(state)){
    if(bm.from===hiddenBP||bm.to===hiddenBP)continue;
    const bp=bpById(bm.from),lc=E.linkerCell(bp);
    let x0=cx(lc[1]),y0=cy(lc[0]),x1,y1;
    if(bm.to){
      const last=bm.path[bm.path.length-1];x1=cx(last[1]);y1=cy(last[0]);
      const L=Math.hypot(x1-x0,y1-y0),ux=(x1-x0)/L,uy=(y1-y0)/L;
      x0+=ux*28;y0+=uy*28;x1-=ux*26;y1-=uy*26;
      let px=0,py=0;if(bm.mutual){px=-uy*5;py=ux*5;}
      el('line',{x1:x0+px,y1:y0+py,x2:x1+px,y2:y1+py,stroke:'#59d6d6','stroke-width':3,'marker-end':'url(#arr)',class:'beam-flow','stroke-opacity':.95},gBeams);
    }else{
      const dv=E.DIRS[bm.dir],vl=Math.hypot(dv[1],dv[0]),ux=dv[1]/vl,uy=dv[0]/vl;
      const b={x0:PAD,y0:PAD,x1:PAD+COLS*CELL,y1:PAD+ROWS*CELL};
      let t=Infinity;
      if(ux>0)t=Math.min(t,(b.x1-x0)/ux);if(ux<0)t=Math.min(t,(b.x0-x0)/ux);
      if(uy>0)t=Math.min(t,(b.y1-y0)/uy);if(uy<0)t=Math.min(t,(b.y0-y0)/uy);
      x1=x0+ux*t;y1=y0+uy*t;x0+=ux*28;y0+=uy*28;
      el('line',{x1:x0,y1:y0,x2:x1+ux*8,y2:y1+uy*8,stroke:'#6a6a6a','stroke-width':2,'marker-end':'url(#arrDud)','stroke-dasharray':'3 6','stroke-opacity':.7},gBeams);
      el('text',{x:x1+ux*20,y:y1+uy*20+4,fill:'#6a6a6a','font-size':15,'text-anchor':'middle'},gBeams).textContent='×';
    }
  }
  // combos & items
  const cs=E.combos(state),comboSet=new Set();
  if(document.getElementById('tgCombos').checked)cs.forEach(c=>c.cells.forEach(([r,cc])=>comboSet.add(key(r,cc))));
  const asm=E.assembly(state);
  const carriedUids=carry&&carry.armed?(carry.kind==='po'?[carry.uid]:carry.kind==='asm'?[asm?asm.blade.uid:null,asm?asm.hilt.uid:null].filter(Boolean):[]):[];
  const mergeSword=asm&&state.linked&&!carriedUids.length;
  for(const p of state.pos){
    if(p.loc!=='grid')continue;
    if(carriedUids.includes(p.uid))continue;
    if(hiddenBP&&E.poInBP(state,p,bpById(hiddenBP)))continue;
    if(mergeSword&&(p.uid===asm.blade.uid||p.uid===asm.hilt.uid))continue;
    const g=el('g',{cursor:'grab'},gItems);
    for(const [r,c] of E.cellsOf(state,p)){
      const hl=comboSet.has(key(r,c));
      el('rect',{x:PAD+(c-1)*CELL+3,y:PAD+(r-1)*CELL+3,width:CELL-6,height:CELL-6,rx:6,fill:'#000','fill-opacity':.22,
        stroke:hl?'#f5a93b':'#00000000','stroke-width':2},g);
    }
    const box=poBox(p);
    drawPOArt(p,g,box.x,box.y);
    for(const [r,c] of E.connTargets(state,p)){
      if(r<1||r>ROWS||c<1||c>COLS)continue;
      const nx=cx(c),ny=cy(r);
      el('path',{d:'M'+nx+','+(ny-8)+' L'+(nx+8)+','+ny+' L'+nx+','+(ny+8)+' L'+(nx-8)+','+ny+' Z',
        fill:'none',stroke:'#e9b64d','stroke-width':1.5,'stroke-dasharray':'3 2','stroke-opacity':.8,'pointer-events':'none'},gTarget);
    }
    hover(g,()=>poTip(p));
    g.addEventListener('pointerdown',e=>startCarry(e,carry?'':(state.linked&&asm&&(p.uid===asm.blade.uid||p.uid===asm.hilt.uid))?'asm':'po',p.uid));
    g.addEventListener('dblclick',()=>{if(carry)return;const r=E.rotatePO(state,p.uid);if(r.ok)renderAll();else flash(r.cells);});
  }
  if(mergeSword){
    const bx=poBox(asm.blade),hx=poBox(asm.hilt);
    const g=el('g',{cursor:'grab'},gItems);
    for(const [r,c] of asm.cells){
      const hl=comboSet.has(key(r,c));
      el('rect',{x:PAD+(c-1)*CELL+3,y:PAD+(r-1)*CELL+3,width:CELL-6,height:CELL-6,rx:6,fill:'#000','fill-opacity':.22,
        stroke:hl?'#f5a93b':'#00000000','stroke-width':2},g);
    }
    el('path',{d:outlinePath(asm.cells),stroke:'#d7dfe6','stroke-width':1.5,'stroke-dasharray':'2 4',fill:'none','stroke-opacity':.9},g);
    el('use',{href:'#icon-blade',x:bx.x+bx.w*0.10,y:bx.y+6,width:bx.w*0.80,height:bx.h-6},g);
    el('use',{href:'#icon-hilt',x:hx.x+hx.w*0.10,y:hx.y,width:hx.w*0.80,height:hx.h-8},g);

    hover(g,'<h3>Longsword <span style="font-size:12px;color:#d7dfe6">assembled · linked</span></h3><div class="eff">Strike 10 / 4 ticks. Drag moves Blade+Hilt together (guard stays). Use the chain button to unlink. Double-click rotates the Blade.</div>');
    g.addEventListener('pointerdown',e=>startCarry(e,'asm',asm.blade.uid));
    g.addEventListener('dblclick',()=>{if(carry)return;const r=E.rotatePO(state,asm.blade.uid);if(r.ok)renderAll();else flash(r.cells);});
  }
  // active connections: filled diamonds on target tiles that landed
  if(document.getElementById('tgCombos').checked)
    for(const c of cs)if(c.pairs)
      for(const t of c.pairs){
        const nx=cx(t[1]),ny=cy(t[0]);
        el('path',{d:'M'+nx+','+(ny-9)+' L'+(nx+9)+','+ny+' L'+nx+','+(ny+9)+' L'+(nx-9)+','+ny+' Z',
          fill:'#f5a93b','fill-opacity':.65,stroke:'#2b2016','stroke-width':1.5,'pointer-events':'none'},gItems);
      }
  // chain-link toggle button (top-right of the assembly)
  if(asm&&!carriedUids.length&&!(hiddenBP&&E.poInBP(state,asm.blade,bpById(hiddenBP)))){
    const rs=asm.cells.map(c=>c[0]),csn=asm.cells.map(c=>c[1]);
    const x=PAD+Math.max(...csn)*CELL-2,y=PAD+(Math.min(...rs)-1)*CELL+2;
    const g=el('g',{cursor:'pointer'},gChain);
    el('circle',{cx:x,cy:y,r:11,fill:'#0e0d0b',stroke:state.linked?'#59d6d6':'#7a7568','stroke-width':2},g);
    const col=state.linked?'#59d6d6':'#7a7568';
    el('circle',{cx:x-3.5,cy:y,r:3.2,fill:'none',stroke:col,'stroke-width':2},g);
    el('circle',{cx:x+3.5,cy:y,r:3.2,fill:'none',stroke:col,'stroke-width':2},g);
    if(!state.linked)el('line',{x1:x-6,y1:y+6,x2:x+6,y2:y-6,stroke:'#c05050','stroke-width':2},g);
    hover(g,()=>state.linked?
      '<h3>Chain: LINKED</h3><div class="eff">Bond matched — Blade and Hilt move as one (guard stays seated). Click to unlink and move parts separately.</div>':
      '<h3>Chain: UNLINKED</h3><div class="eff">Parts move separately (moving a part apart breaks the bond; the guard unseats). Click to link.</div>');
    g.addEventListener('pointerdown',e=>e.stopPropagation());
    g.addEventListener('click',e=>{e.stopPropagation();state.linked=!state.linked;renderAll();});
  }
  // linkers
  for(const bp of state.bps){
    if(bp.id===hiddenBP)continue;
    const lc=E.linkerCell(bp),x=cx(lc[1]),y=cy(lc[0]);
    const g=el('g',{cursor:'grab'},gLinkers);
    el('circle',{cx:x,cy:y,r:26,fill:'#0e0d0b','fill-opacity':.55,stroke:'#59d6d6','stroke-opacity':.5},g);
    el('use',{href:'#icon-linker_core',x:x-22,y:y-22,width:44,height:44},g);
    for(const d of bp.linker.dirs){
      const ang=(d*45-90)*Math.PI/180;
      el('circle',{cx:x+Math.cos(ang)*30,cy:y+Math.sin(ang)*30,r:4,fill:'#59d6d6'},g);
    }
    hover(g,()=>{
      const txt=E.traceBeams(state).filter(z=>z.from===bp.id).map(z=>{
        const t=z.to?('links '+z.to.toUpperCase()+(z.mutual?' (mutual)':'')):'dud — flies off the canvas';
        return 'dir '+z.dir+' '+ARROWS[z.dir]+' → '+t;}).join('<br>');
      return '<h3>BP Linker</h3><div class="shape">one per BP · drag to move the whole BP</div><div class="eff">'+txt+'</div>';});
    g.addEventListener('pointerdown',e=>startCarry(e,'bp',bp.id));
  }
  // sockets (diegetic)
  for(const s of E.sockets(state)){
    let x,y;
    if(s.host==='bond'){
      if(!asm)continue;
      x=cx(asm.hilt.cell[1]);y=PAD+(asm.hilt.cell[0]-1)*CELL;
      if(hiddenBP&&cbp[key(...asm.hilt.cell)]===hiddenBP)continue;
    }else{
      const p=poByUid(s.host);
      if(hiddenBP&&E.poInBP(state,p,bpById(hiddenBP)))continue;
      if(carriedUids.includes(p.uid))continue;
      const box=poBox(p),{w:cw,h:ch}=E.shapeInfo(p.id,0),W0=cw*CELL,H0=ch*CELL;
      const [mx,my]=mapPt(p.rot%4,s.ax*W0,s.ay*H0,W0,H0);
      x=box.x+mx;y=box.y+my;
    }
    if(s.accUid&&!(carry&&carry.armed&&carry.kind==='acc'&&carry.uid===s.accUid)){
      const a=state.accs.find(z=>z.uid===s.accUid);
      const g=el('g',{cursor:'grab'},gSock);
      if(a.id==='acc_guard'){
        el('rect',{x:x-23,y:y-7,width:46,height:14,rx:6,fill:'#b08340',stroke:'#2b2016','stroke-width':2.5},g);
        el('circle',{cx:x-12,cy:y,r:2.2,fill:'#e9b64d'},g);
        el('circle',{cx:x+12,cy:y,r:2.2,fill:'#e9b64d'},g);
      }else el('use',{href:'#'+ACC_DEFS[a.id].icon,x:x-12,y:y-12,width:24,height:24},g);
      el('circle',{cx:x,cy:y,r:15,fill:'transparent'},g);
      hover(g,()=>accTip(a,s.host==='bond'?'Blade–Hilt bond':ITEMS[poByUid(s.host).id].name));
      g.addEventListener('pointerdown',e=>startCarry(e,'acc',a.uid));
    }else if(!s.accUid){
      const g=el('g',{},gSock);
      if(s.t==='bond')el('rect',{x:x-23,y:y-7,width:46,height:14,rx:6,fill:'none',stroke:'#b08340','stroke-width':1.5,'stroke-dasharray':'3 3','stroke-opacity':.8},g);
      else{
        el('circle',{cx:x,cy:y,r:9,fill:'#0e0d0b','fill-opacity':.5,stroke:'#b08340','stroke-width':1.5,'stroke-dasharray':'3 3','stroke-opacity':.8},g);
        el('text',{x:x,y:y+3.5,'text-anchor':'middle','font-size':9,fill:'#b08340'},g).textContent=SOCK_GLYPH[s.t];
      }
      hover(g,'<h3>Empty '+s.t+' socket '+SOCK_GLYPH[s.t]+'</h3><div class="shape">socket tags: '+(s.tags.join(', ')||'none')+'</div><div class="eff">Accepts '+s.t+'-type accessories whose required tags are all present here.</div>');
    }
  }
  // inventory
  let slot=0;
  const entries=[...state.pos.filter(p=>p.loc==='inv').map(o=>({kind:'po',o})),
                 ...state.accs.filter(a=>a.host==='inv').map(o=>({kind:'acc',o}))];
  for(const en of entries){
    if(carry&&carry.armed&&carry.uid===en.o.uid)continue;
    const col=slot%INVCOL,row=Math.floor(slot/INVCOL);slot++;
    const bx=INVX+col*(INVBOX+6),by=INVY+40+row*(INVBOX+6);
    const g=el('g',{cursor:'grab'},gInv);
    el('rect',{x:bx,y:by,width:INVBOX,height:INVBOX,rx:8,fill:'#1e1b16',stroke:'#3a342a'},g);
    if(en.kind==='po'){
      const p=en.o,{w,h}=E.shapeInfo(p.id,p.rot);
      const sc=Math.min(66/(w*CELL),66/(h*CELL)),dw=w*CELL*sc,dh=h*CELL*sc;
      const ig=el('g',{transform:'translate('+(bx+(INVBOX-dw)/2)+','+(by+(INVBOX-dh)/2)+') scale('+sc+')'},g);
      drawPOArt(p,ig,0,0);
      hover(g,()=>poTip(p));
      g.addEventListener('pointerdown',e=>startCarry(e,'po',p.uid));
      g.addEventListener('dblclick',()=>{if(carry)return;E.rotatePO(state,p.uid);renderAll();});
    }else{
      const a=en.o;
      el('use',{href:'#'+ACC_DEFS[a.id].icon,x:bx+INVBOX/2-20,y:by+INVBOX/2-22,width:40,height:40},g);
      el('text',{x:bx+INVBOX/2,y:by+INVBOX-8,'text-anchor':'middle','font-size':9.5,fill:'#9a917f'},g).textContent=T(ACC_DEFS[a.id],'name')+' '+SOCK_GLYPH[ACC_DEFS[a.id].slot];
      hover(g,()=>accTip(a,null));
      g.addEventListener('pointerdown',e=>startCarry(e,'acc',a.uid));
    }
  }
  // panels
  document.getElementById('comboList').innerHTML=cs.length?cs.map(c=>'<li><b class="combo-chip">'+c.name+'</b> — '+c.desc+'</li>').join(''):'<li style="color:var(--dim)">none — try placing Flame next to Oil</li>';
  const cbp2=E.cellBPMap(state);
  document.getElementById('bpList').innerHTML=state.bps.map(b=>{
    const n=state.pos.filter(p=>p.loc==='grid'&&cbp2[key(...E.cellsOf(state,p)[0])]===b.id).length;
    return '<li><b style="color:'+b.color+'">'+b.name+'</b> — '+E.bpCells(b).length+' cells · HP '+(E.bpCells(b).length*5)+' <span class="tag">Linker ['+b.linker.dirs.join(',')+']</span><span class="tag">'+n+' POs</span></li>';}).join('');
  document.getElementById('linkList').innerHTML=E.traceBeams(state).map(bm=>{
    const A=bm.from.toUpperCase();
    if(bm.to&&bm.mutual)return '<li><span class="mut">⇄ MUTUAL</span> '+A+' dir '+bm.dir+' '+ARROWS[bm.dir]+' → '+bm.to.toUpperCase()+'</li>';
    if(bm.to)return '<li>→ '+A+' dir '+bm.dir+' '+ARROWS[bm.dir]+' links '+bm.to.toUpperCase()+'</li>';
    return '<li class="dudt">× '+A+' dir '+bm.dir+' '+ARROWS[bm.dir]+' — dud (flies off canvas)</li>';}).join('');
}
function flash(cells){
  for(const [r,c] of (cells||[])){
    if(r<1||r>ROWS||c<1||c>COLS)continue;
    const f=el('rect',{x:PAD+(c-1)*CELL+2,y:PAD+(r-1)*CELL+2,width:CELL-4,height:CELL-4,rx:6,fill:'none',stroke:'#c05050','stroke-width':3},gTarget);
    setTimeout(()=>f.remove(),350);
  }
}
function svgPt(e){const r=svg.getBoundingClientRect();return {x:(e.clientX-r.left)*(W/r.width),y:(e.clientY-r.top)*(H/r.height)};}
function cellAt(pt){return [Math.floor((pt.y-PAD)/CELL)+1,Math.floor((pt.x-PAD)/CELL)+1];}
function startCarry(e,kind,uid){
  if(carry||!kind)return;
  // NOTE: no preventDefault — it would suppress derived click/dblclick (rotation)
  const pt=svgPt(e),cell=cellAt(pt);
  const c={kind,uid,sx:e.clientX,sy:e.clientY,armed:false,drop:null};
  if(kind==='po'){const p=poByUid(uid);c.grabOff=p.loc==='grid'?[cell[0]-p.cell[0],cell[1]-p.cell[1]]:[0,0];}
  if(kind==='asm'){const asm=E.assembly(state);c.grabOff=[cell[0]-asm.anchor[0],cell[1]-asm.anchor[1]];}
  if(kind==='bp'){const bp=bpById(uid);c.bpId=uid;c.grabOff=[cell[0]-bp.origin[0],cell[1]-bp.origin[1]];}
  carry=c;
}
svg.addEventListener('pointermove',e=>{
  if(!carry)return;
  if(!carry.armed){
    if(Math.hypot(e.clientX-carry.sx,e.clientY-carry.sy)<5)return;
    carry.armed=true;hideTip();renderAll();
  }
  const pt=svgPt(e),cell=cellAt(pt),overInv=pt.x>INVX-14;
  gCarry.innerHTML='';gTarget.innerHTML='';
  const paint=(cells,ok)=>{for(const [r,c] of cells){
    if(r<1||r>ROWS||c<1||c>COLS)continue;
    el('rect',{x:PAD+(c-1)*CELL+2,y:PAD+(r-1)*CELL+2,width:CELL-4,height:CELL-4,rx:6,
      fill:ok?'#5cb573':'#c05050','fill-opacity':.25,stroke:ok?'#5cb573':'#c05050','stroke-width':2},gTarget);}};
  if(carry.kind==='po'){
    const p=poByUid(carry.uid);
    const anchor=[cell[0]-carry.grabOff[0],cell[1]-carry.grabOff[1]];
    if(overInv){carry.drop={type:'inv'};}
    else{
      const chk=E.canPlacePO(state,p.uid,p.rot,anchor);
      carry.drop=chk.ok?{type:'grid',anchor}:null;
      paint(chk.cells,chk.ok);
    }
    const {w,h}=E.shapeInfo(p.id,p.rot);
    const gh=el('g',{opacity:.75},gCarry);
    drawPOArt(p,gh,pt.x-w*CELL/2,pt.y-h*CELL/2);
  }else if(carry.kind==='asm'){
    const asm=E.assembly(state);
    const anchor=[cell[0]-carry.grabOff[0],cell[1]-carry.grabOff[1]];
    if(overInv){carry.drop={type:'inv'};}
    else{
      const chk=E.canPlaceAssembly(state,anchor);
      carry.drop=chk.ok?{type:'grid',anchor}:null;
      paint(chk.cells,chk.ok);
    }
    const gh=el('g',{opacity:.75},gCarry);
    el('use',{href:'#icon-blade',x:pt.x-32,y:pt.y-110,width:64,height:150},gh);
    el('use',{href:'#icon-hilt',x:pt.x-32,y:pt.y+40,width:64,height:66},gh);
  }else if(carry.kind==='bp'){
    const bp=bpById(carry.bpId);
    const origin=[cell[0]-carry.grabOff[0],cell[1]-carry.grabOff[1]];
    if(overInv){carry.drop=null;}
    else{
      const chk=E.canMoveBP(state,carry.bpId,origin);
      carry.drop=chk.ok?{type:'bp',origin}:null;
      paint(chk.cells,chk.ok);
      const gh=el('g',{opacity:.5},gCarry);
      for(const [r,c] of chk.cells)
        if(r>=1&&r<=ROWS&&c>=1&&c<=COLS)
          el('rect',{x:PAD+(c-1)*CELL+4,y:PAD+(r-1)*CELL+4,width:CELL-8,height:CELL-8,rx:6,fill:bp.color,'fill-opacity':.4},gh);
    }
  }else if(carry.kind==='acc'){
    const a=state.accs.find(z=>z.uid===carry.uid);
    let best=null,bd=26;
    for(const s of E.sockets(state)){
      let x,y;
      const asm=E.assembly(state);
      if(s.host==='bond'){if(!asm)continue;x=cx(asm.hilt.cell[1]);y=PAD+(asm.hilt.cell[0]-1)*CELL;}
      else{const p=poByUid(s.host);const box=poBox(p),{w:cw,h:ch}=E.shapeInfo(p.id,0);
        const [mx,my]=mapPt(p.rot%4,s.ax*cw*CELL,s.ay*ch*CELL,cw*CELL,ch*CELL);x=box.x+mx;y=box.y+my;}
      const v=E.hostOk(state,carry.uid,s),dist=Math.hypot(x-pt.x,y-pt.y);
      el('circle',{cx:x,cy:y,r:12,fill:'none',stroke:v.ok?'#5cb573':'#c05050','stroke-width':2,'stroke-opacity':dist<bd?1:.55},gTarget);
      if(dist<bd){bd=dist;best={s,v};}
    }
    carry.drop=overInv?{type:'inv'}:(best&&best.v.ok?{type:'sock',skey:best.s.skey}:null);
    if(best)showTip('<h3>'+ACC_DEFS[a.id].name+' → '+best.s.t+' '+SOCK_GLYPH[best.s.t]+'</h3><div class="eff '+(best.v.ok?'ok':'bad')+'">'+(best.v.ok?'MATCH: type & socket tags OK':'NO: '+best.v.why)+'</div>',e);
    el('use',{href:'#'+ACC_DEFS[a.id].icon,x:pt.x-16,y:pt.y-16,width:32,height:32,opacity:.85},gCarry);
  }
});
window.addEventListener('pointerup',()=>{
  if(!carry)return;
  if(!carry.armed){carry=null;return;} // plain click: keep DOM so dblclick can fire
  const c=carry;carry=null;
  if(c.kind==='po'&&c.drop)E.movePO(state,c.uid,c.drop.type==='inv'?'inv':c.drop.anchor);
  else if(c.kind==='asm'&&c.drop)E.moveAssembly(state,c.drop.type==='inv'?'inv':c.drop.anchor);
  else if(c.kind==='bp'&&c.drop)E.moveBP(state,c.bpId,c.drop.origin);
  else if(c.kind==='acc'){
    if(c.drop&&c.drop.type==='sock')E.seatAcc(state,c.uid,c.drop.skey);
    else if(c.drop&&c.drop.type==='inv')E.stowAcc(state,c.uid);
  }
  gCarry.innerHTML='';gTarget.innerHTML='';hideTip();renderAll();
});
window.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&carry){carry=null;gCarry.innerHTML='';gTarget.innerHTML='';renderAll();}
  if((e.key==='r'||e.key==='R')&&carry&&carry.kind==='po')poByUid(carry.uid).rot=(poByUid(carry.uid).rot+1)%4;
});
const langBtn=document.getElementById('langBtn');
if(langBtn)langBtn.addEventListener('click',()=>{
  LANG.cur=LANG.cur==='ja'?'en':'ja';
  document.body.classList.toggle('lang-en',LANG.cur==='en');
  langBtn.textContent=LANG.cur==='ja'?'\uD83C\uDDEC\uD83C\uDDE7 EN':'\uD83C\uDDEF\uD83C\uDDF5 \u65E5\u672C\u8A9E';
  renderAll();
});
document.getElementById('tgBeams').addEventListener('change',e=>gBeams.setAttribute('visibility',e.target.checked?'visible':'hidden'));
document.getElementById('tgCombos').addEventListener('change',renderAll);
renderAll();
})();
