#!/usr/bin/env node
// client/scripts/preview_unit_skin.mjs -- REQ-0180 VISUAL preview (not a gate).
// Renders a board mock of BEFORE (plain) vs AFTER (unit_skin SET -> devornate
// silhouette) using the SAME compositeSkin the board uses and the SAME resolve
// chain (resolveUnitSkinKey -> unit_skin.bpskin -> resolveBpSkin -> compositeSkin)
// and the SAME placement formula BoardRenderer uses. PNG via Node zlib only.
import { createServer } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(__dirname, '..');
const REPO = path.resolve(CLIENT, '..');
const OUTDIR = path.join(REPO, 'web', 'preview', 'bpskins-req0180');
const CELL = 72, PAD = 16, COLS = 6, ROWS = 5;

let CRC;
function crc32(b){ if(!CRC){CRC=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;CRC[n]=c>>>0;}} let c=0xffffffff;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return (c^0xffffffff)>>>0; }
function u32(n){return Buffer.from([(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255]);}
function chunk(t,d){const tt=Buffer.from(t,'ascii');const body=Buffer.concat([tt,d]);return Buffer.concat([u32(d.length),body,u32(crc32(body))]);}
function encodePNG(W,H,rgba){const sig=Buffer.from([137,80,78,71,13,10,26,10]);const ihdr=Buffer.concat([u32(W),u32(H),Buffer.from([8,6,0,0,0])]);const stride=W*4;const raw=Buffer.alloc((stride+1)*H);for(let y=0;y<H;y++){raw[y*(stride+1)]=0;Buffer.from(rgba.buffer,rgba.byteOffset+y*stride,stride).copy(raw,y*(stride+1)+1);}return Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);}
const hex=(h)=>{h=h.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];};

function mkBuf(W,H,bg){const buf=new Uint8Array(W*H*4);const[br,bg2,bb]=hex(bg);for(let i=0;i<W*H;i++){buf[i*4]=br;buf[i*4+1]=bg2;buf[i*4+2]=bb;buf[i*4+3]=255;}return buf;}
function blend(buf,W,x,y,r,g,b,a){if(x<0||y<0||x>=W)return;const i=(y*W+x)*4;if(i<0||i+3>=buf.length)return;const af=a/255;buf[i]=Math.round(buf[i]*(1-af)+r*af);buf[i+1]=Math.round(buf[i+1]*(1-af)+g*af);buf[i+2]=Math.round(buf[i+2]*(1-af)+b*af);buf[i+3]=255;}
function rect(buf,W,H,x0,y0,w,h,r,g,b,a){for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)if(x>=0&&y>=0&&x<W&&y<H)blend(buf,W,x,y,r,g,b,a);}
function disc(buf,W,H,cx,cy,rad,r,g,b,a){for(let y=cy-rad;y<=cy+rad;y++)for(let x=cx-rad;x<=cx+rad;x++){const d=Math.hypot(x-cx,y-cy);if(d<=rad&&x>=0&&y>=0&&x<W&&y<H)blend(buf,W,x,y,r,g,b,a);}}
function ring(buf,W,H,cx,cy,rad,wd,r,g,b,a){for(let y=cy-rad-wd;y<=cy+rad+wd;y++)for(let x=cx-rad-wd;x<=cx+rad+wd;x++){const d=Math.hypot(x-cx,y-cy);if(Math.abs(d-rad)<=wd&&x>=0&&y>=0&&x<W&&y<H)blend(buf,W,x,y,r,g,b,a);}}

async function main(){
  const server=await createServer({root:CLIENT,logLevel:'error',server:{middlewareMode:true,hmr:false},appType:'custom'});
  try{
    const comp=await server.ssrLoadModule('/src/board/skin/composite.ts');
    const reg=await server.ssrLoadModule('/src/board/skin/skinRegistry.ts');
    const res=await server.ssrLoadModule('/src/board/skin/bpSkinResolve.ts');
    const us=await server.ssrLoadModule('/src/board/skin/unitSkinRegistry.ts');
    const defs=reg.loadSkinDefs(JSON.parse(fs.readFileSync(path.join(REPO,'content','live','live_bpskins.json'),'utf8')));
    const sets=us.loadUnitSkinDefs(JSON.parse(fs.readFileSync(path.join(REPO,'content','live','live_unit_skins.json'),'utf8')));
    const units=JSON.parse(fs.readFileSync(path.join(REPO,'content','live','live_units.json'),'utf8'));
    const unitDef=Object.fromEntries((units.entries||[]).map(e=>[e.id,e]));
    // three representative BPs (roster units -> their default set -> devornate)
    const BPS=[
      { unit:'elf',   color:'#e9b64d', origin:[1,1], shape:[[0,0],[1,0],[2,0],[2,1]], off:[0,0] },   // L-tetromino
      { unit:'dwarf', color:'#7ac0d6', origin:[1,3], shape:[[0,0],[0,1],[1,0],[1,1],[2,0],[2,1]], off:[1,0] }, // 2x3
      { unit:'thief', color:'#c98fe0', origin:[4,4], shape:[[0,0]], off:[0,0] },                       // 1x1
    ];
    const W=PAD*2+COLS*CELL, H=PAD*2+ROWS*CELL;
    const cx=(c)=>PAD+(c-1)*CELL+CELL/2, cy=(r)=>PAD+(r-1)*CELL+CELL/2;

    function render(withSkin){
      const buf=mkBuf(W,H,'#0f1216');
      // base grid
      for(let r=1;r<=ROWS;r++)for(let c=1;c<=COLS;c++){rect(buf,W,H,PAD+(c-1)*CELL,PAD+(r-1)*CELL,CELL,CELL,25,25,25,255);}
      for(const bp of BPS){
        const cells=bp.shape.map(([dr,dc])=>[bp.origin[0]+dr,bp.origin[1]+dc]);
        const cset=new Set(cells.map(([r,c])=>r+','+c));
        const [cr,cg,cb]=hex(bp.color);
        // canvas BP-color tint on owned cells (alpha 0.26), like BoardRenderer
        for(const [r,c] of cells) rect(buf,W,H,PAD+(c-1)*CELL,PAD+(r-1)*CELL,CELL,CELL,cr,cg,cb,66);
        // silhouette skin (AFTER only)
        if(withSkin){
          const key=us.resolveUnitSkinKey(null, unitDef[bp.unit]?.unit_skin);
          us.setUnitSkinDefs(sets);
          const set=us.getUnitSkinDef(key);
          const rung=res.resolveBpSkin({unitSetSkinId:set?.bpskin}, id=>id in defs);
          const def=rung.skinId?defs[rung.skinId]:null;
          if(def){
            const cmp=comp.compositeSkin(cells,def,'#000000',{cellPx:CELL,margin:1});
            const ox=PAD+(cmp.c0-cmp.margin-1)*CELL, oy=PAD+(cmp.r0-cmp.margin-1)*CELL;
            for(let y=0;y<cmp.height;y++)for(let x=0;x<cmp.width;x++){const si=y*cmp.width+x;if(cmp.rs[si]){blend(buf,W,ox+x,oy+y,cmp.rgba[si*4],cmp.rgba[si*4+1],cmp.rgba[si*4+2],255);}}
          }
        }
        // outline (edges w/o neighbor), 3px, bp.color -- on top
        for(const [r,c] of cells){const x=PAD+(c-1)*CELL,y=PAD+(r-1)*CELL;
          if(!cset.has((r-1)+','+c))rect(buf,W,H,x,y,CELL,3,cr,cg,cb,255);
          if(!cset.has((r+1)+','+c))rect(buf,W,H,x,y+CELL-3,CELL,3,cr,cg,cb,255);
          if(!cset.has(r+','+(c-1)))rect(buf,W,H,x,y,3,CELL,cr,cg,cb,255);
          if(!cset.has(r+','+(c+1)))rect(buf,W,H,x+CELL-3,y,3,CELL,cr,cg,cb,255);}
        // unit core disc + cyan ring
        const uc=[bp.origin[0]+bp.off[0],bp.origin[1]+bp.off[1]];
        disc(buf,W,H,cx(uc[1])|0,cy(uc[0])|0,22,14,13,11,235);
        ring(buf,W,H,cx(uc[1])|0,cy(uc[0])|0,22,1,89,214,214,235);
      }
      return buf;
    }
    fs.mkdirSync(OUTDIR,{recursive:true});
    const before=render(false), after=render(true);
    // side-by-side with a divider
    const GAP=18, GW=W*2+GAP, GH=H;
    const grid=mkBuf(GW,GH,'#0f1216');
    const put=(src,ox)=>{for(let y=0;y<H;y++)for(let x=0;x<W;x++){const s=(y*W+x)*4,d=(y*GW+(ox+x))*4;grid[d]=src[s];grid[d+1]=src[s+1];grid[d+2]=src[s+2];grid[d+3]=255;}};
    put(before,0); put(after,W+GAP);
    fs.writeFileSync(path.join(OUTDIR,'board_before.png'),encodePNG(W,H,before));
    fs.writeFileSync(path.join(OUTDIR,'board_after.png'),encodePNG(W,H,after));
    fs.writeFileSync(path.join(OUTDIR,'board_before_after.png'),encodePNG(GW,GH,grid));
    console.log('wrote', path.join(OUTDIR,'board_before_after.png'), GW+'x'+GH);
    console.log('sets used:', BPS.map(b=>b.unit+'->'+us.resolveUnitSkinKey(null,unitDef[b.unit]?.unit_skin)).join(', '));
  } finally { await server.close(); }
}
main().catch(e=>{console.error(e);process.exit(1);});
