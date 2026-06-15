/* ===================================================================
   PMSR Player Ratings — parser + v4.4 weighted-action model
   Parser ports the validated Python extraction (Y-row / X-column buckets).
   Model constants calibrated on 3 reference-rated matches (BRA-MAR, USA-PAR,
   CAN-BIH) via recalibrate.py — leave-one-match-out CV MAE 0.32, 86% within 0.5.
   =================================================================== */
window.PR = (function(){
'use strict';

/* ---------- LOCKED MODEL ---------- */
const POS_W = {
 DF:{lb:.85,tidy:.40,btw:.05,off:.03,recv:.03,act:.02,prog:.70,take:.60,tkl:1.10,blk:1.0,intc:1.0,clr:.40,aer:1.05,pdir:.15,pind:.06},
 MF:{lb:.80,tidy:.12,btw:.11,off:.06,recv:.07,act:.025,prog:.70,take:.70,tkl:0.90,blk:.70,intc:.80,clr:.40,aer:.60,pdir:.26,pind:.12},
 FW:{lb:.72,tidy:.10,btw:.06,off:.035,recv:.08,act:.02,prog:.70,take:.90,tkl:0.70,blk:.50,intc:.50,clr:.30,aer:.50,pdir:.20,pind:.08}
};
const POS_CAL = { DF:{par:6.159,slope:0.0216}, MF:{par:5.190,slope:0.0743}, FW:{par:5.812,slope:0.0678} };
const num = v => (v==null||isNaN(v))?0:+v;

function featScore(p,pos){
  const w=POS_W[pos]||POS_W.MF, g=k=>num(p[k]);
  let s = w.lb*g('lb_comp');
  s += w.tidy*g('pass_comp')*Math.max(0,(g('pass_pct')-85)/10);
  s += w.btw*g('in_between');
  s += w.off*g('offers') + w.recv*g('offers_recv');
  s += w.act*g('pass_att');
  s += w.prog*g('ball_prog') + w.take*g('take_ons');
  s += w.tkl*g('tackles_won') + w.blk*g('blocks') + w.intc*g('intercept') + w.clr*g('clearances');
  s += w.aer*g('aerial_won');
  s += w.pdir*g('press_dir') + w.pind*g('press_indir');
  return s;
}
function goalBonus(p){ return Math.min(1.8, 1.0*num(p.goals)); }
function resultAdj(r){ return r>0?0.30 : r<0?-0.30 : 0; }   // r = goal difference for this team

function ratePlayer(p, pos, gd){
  const adj=resultAdj(gd);
  if(pos==='GK'){
    const sp=num(p.save_pct), dist=Math.max(40,Math.min(95,num(p.pass_pct)||65)), faced=num(p.faced);
    let r = 4.755 + 1.561*(sp/100) + 0.386*((dist-65)/30) + 0.0612*faced + adj;
    return clampRound(Math.max(5.0,r));
  }
  const feat=featScore(p,pos);
  let r = (POS_CAL[pos].par) + (POS_CAL[pos].slope)*feat + goalBonus(p) + adj;
  r = Math.max(5.0, r);
  if(num(p.goals)>0) r = Math.max(7.0, r);     // scorer floor
  return clampRound(r);
}
const clampRound = r => Math.round(Math.min(10, Math.max(5, r))*10)/10;

function teamAggregate(players){   // minutes-weighted mean ×10, rounded
  let wsum=0, w=0;
  players.forEach(p=>{ const m=Math.max(1,num(p.min))/90; wsum += p.rating*m; w+=m; });
  return w? Math.round((wsum/w)*10) : 0;
}

/* ---------- PDF table extraction ---------- */
const DIST=["pass_att","pass_comp","pass_pct","switches","cross_att","cross_comp","lb_att","lb_comp","lb_pct","ball_prog","take_ons","step_ins","shots","goals"];
const OFFER=["offers","in_front","in_between","out_to_in","in_to_out","in_behind","no_move","offers_recv"];
const DEFN=["tackles_made","tackles_won","blocks","intercept","press_dir","press_indir","aerial_won","phys_won","contests_won","clearances","loose_ball","pushing_on","pushing_press","regains","interrupted"];

function rowsByY(items, tol){
  tol=tol||3; const b={};
  items.forEach(it=>{ const k=Math.round(it.y/tol); (b[k]=b[k]||[]).push(it); });
  return Object.keys(b).map(k=>mergeCells(b[k].sort((a,c)=>a.x-c.x))).sort((A,B)=>B[0].y-A[0].y);
}
// pdf.js fragments text into per-glyph items; merge adjacent ones into word/number cells
function mergeCells(rowItems){
  const cells=[]; let cur=null;
  rowItems.forEach(it=>{
    const w=it.width||(it.str.length*4.5);
    if(cur){
      const gap = it.x - (cur.x + cur.w);
      if(gap < 8){ cur.str += (gap>2.3?' ':'') + it.str; cur.w = it.x + w - cur.x; return; }
    }
    cur={ str:it.str, x:it.x, y:it.y, w:w }; cells.push(cur);
  });
  cells.forEach(c=>c.str=c.str.trim());
  return cells;
}
// derive column centers = x positions present in many rows
function deriveCenters(dataRows){
  const counts={};
  dataRows.forEach(r=>r.forEach(t=>{ const k=Math.round(t.x/6)*6; counts[k]=(counts[k]||0)+1; }));
  const thresh=Math.max(2, dataRows.length*0.4);
  let centers=Object.keys(counts).map(Number).filter(x=>counts[x]>=thresh).sort((a,b)=>a-b);
  // merge centers within 12px
  const merged=[]; centers.forEach(c=>{ if(merged.length && c-merged[merged.length-1]<14) return; merged.push(c); });
  return merged;
}
function splitVals(str){ // "83%" -> 83 ; "12 / 4" -> [12,4]
  return String(str).replace(/%/g,'').split('/').map(s=>s.trim()).filter(s=>/^-?\d+(\.\d+)?$/.test(s)).map(Number);
}
// extract player rows from a stat page's items, mapping to `cols`
function extractTable(items, cols){
  const body=items.filter(i=>i.y>0); // keep all; header filtered by row test
  const rows=rowsByY(body);
  // candidate data rows: start with a squad number then a name
  const dataRows=[];
  rows.forEach(r=>{
    const toks=r.map(t=>t.str.trim());
    if(!toks.length) return;
    if(!/^\d+$/.test(toks[0])) return;
    const name=r.filter(t=>t.x<195 && /[A-Za-z]/.test(t.str)).map(t=>t.str.trim()).join(' ');
    if(!name) return;
    // value tokens to the right
    const valToks=[];
    r.filter(t=>t.x>=195).forEach(t=>{ splitVals(t.str).forEach((v,i,arr)=>{
      // for "a / b" keep both at ~same x (slightly offset so order holds)
      valToks.push({x:t.x + i*0.01, v});
    }); });
    dataRows.push({num:toks[0], name, valToks});
  });
  // map values to columns by order if counts match, else snap to centers
  const centers=deriveCenters(dataRows.map(d=>d.valToks));
  const out={};
  dataRows.forEach(d=>{
    const rec={};
    if(d.valToks.length===cols.length){
      d.valToks.sort((a,b)=>a.x-b.x).forEach((t,i)=>rec[cols[i]]=t.v);
    } else if(centers.length>=cols.length){
      d.valToks.forEach(t=>{ // nearest center index
        let bi=0,bd=1e9; centers.forEach((c,i)=>{const dd=Math.abs(c-t.x); if(dd<bd){bd=dd;bi=i;}});
        if(bi<cols.length && rec[cols[bi]]==null) rec[cols[bi]]=t.v;
      });
      cols.forEach(c=>{ if(rec[c]==null) rec[c]=0; });
    } else {
      d.valToks.sort((a,b)=>a.x-b.x).forEach((t,i)=>{ if(i<cols.length) rec[cols[i]]=t.v; });
    }
    out[d.num]={name:d.name, rec};
  });
  return out;
}

/* ---------- page discovery ---------- */
async function loadPages(pdf){
  const pages=[];
  for(let n=1;n<=pdf.numPages;n++){
    const pg=await pdf.getPage(n);
    const tc=await pg.getTextContent();
    const items=tc.items.map(i=>({str:clean(i.str), x:i.transform[4], y:i.transform[5], width:i.width})).filter(i=>i.str.trim()!=='');
    pages.push({n, items, head:items.slice(0,6).map(i=>i.str).join(' ').trim()});
  }
  return pages;
}
const clean = s => String(s).replace(/[\u0000-\u001f]/g,"");   // pdf.js renders ligatures (ff,fi) as control chars
// match a data-table page by a reliable keyword + team; require a "#" header to skip section dividers
function findPage(pages, keyword, team, requireHash){
  if(requireHash===undefined) requireHash=true;
  const K=keyword.toUpperCase(), T=team.toUpperCase();
  for(const p of pages){
    const top=p.items.slice(0,30).map(i=>i.str).join(' ').toUpperCase();
    const hasHash=p.items.slice(0,26).some(i=>i.str.trim()==='#');
    if((!requireHash || hasHash) && top.includes(K) && top.includes(T)) return p;
  }
  return null;
}

const norm = s => String(s).toUpperCase().replace(/[^A-Z]/g,'');
/* ---------- goalkeeper goal-prevention (faced + save%) ---------- */
function gkStats(pages, team){
  const p=findPage(pages,"Goal Prevention",team,false); if(!p) return {faced:0,save_pct:0};
  const it=p.items;
  // label-anchored: each value is the most recent integer appearing just before its label
  // (robust to extra numbers on the page; the "first two integers" heuristic is the fallback)
  let faced=0, sp=0, lastInt=null;
  for(let i=0;i<it.length;i++){
    const s=it[i].str.trim();
    if(/^\d+$/.test(s)){ lastInt=+s; continue; }
    if(!faced && /Total Attempts on Goal|^Faced$/i.test(s) && lastInt!=null) faced=lastInt;
    if(!sp && (/^Save$/i.test(s) || /Save\s*%/i.test(s)) && lastInt!=null) sp=lastInt;  // title "Save %" comes first
  }
  if(!faced || !sp){                                   // fallback to the leading two integers
    const ints=it.filter(x=>/^\d+$/.test(x.str.trim())).map(x=>+x.str.trim());
    if(!faced) faced=ints[0]||0;
    if(!sp) sp=ints[1]||0;
  }
  if(sp>100 || sp<0) sp=0;
  return {faced, save_pct:sp};
}

/* ---------- lineup: positions + minutes from raw page-1 items ---------- */
function rawRows(items, tol){ tol=tol||3.2; const b={};
  items.forEach(it=>{ const k=Math.round(it.y/tol); (b[k]=b[k]||[]).push(it); });
  return Object.keys(b).map(k=>b[k].sort((a,c)=>a.x-c.x)).sort((A,B)=>B[0].y-A[0].y);
}
function lineupInfo(pages, names){
  const p=pages.find(pg=>/Match Summary - Teams/i.test(pg.head)) || pages[1];
  const roster=[];
  if(p){
    const subMarks=p.items.filter(i=>/SUBSTITUTES/i.test(i.str));
    // one roster entry per position token; window items by x to isolate that player
    // (home and away lineups share page rows, so we must not merge across columns)
    p.items.filter(t=>/^(GK|DF|MF|FW)$/.test(t.str.trim())).forEach(pt=>{
      const near=p.items.filter(i=> Math.abs(i.y-pt.y)<3.2 && Math.abs(i.x-pt.x)<150);
      const nameCell=mergeCells(near.filter(t=>/[A-Za-z]/.test(t.str) && !/^(GK|DF|MF|FW)$/.test(t.str.trim())).sort((a,b)=>a.x-b.x))
                      .map(c=>c.str).join(' ').trim();
      if(!nameCell || nameCell.length<2) return;
      const mins=near.filter(t=>/^\d+\+?\d*'$/.test(t.str.trim())).map(t=>parseInt(t.str));
      // starter = above the nearest-column SUBSTITUTES marker (pdf.js y is bottom-up → higher y = higher on page)
      const col=subMarks.slice().sort((a,b)=>Math.abs(a.x-pt.x)-Math.abs(b.x-pt.x))[0];
      const starter = col? pt.y > col.y-1 : true;
      roster.push({pos:pt.str.trim(), name:nameCell, nameN:norm(nameCell), mins, starter});
    });
  }
  // sub on-times for off-time pairing
  const subOn=roster.filter(e=>!e.starter && e.mins.length).map(e=>Math.min(...e.mins));
  const info={};
  names.forEach(name=>{
    const nN=norm(name), last=name.split(' ').slice(-1)[0].toUpperCase();
    // best roster match: exact norm, else shares last name & first initial, else last name
    let e = roster.find(r=>r.nameN===nN)
         || roster.find(r=>r.nameN.endsWith(norm(last)) && r.nameN[0]===nN[0])
         || roster.find(r=>r.nameN.includes(norm(last)) || nN.includes(r.nameN));
    if(!e){ info[name]={pos:'MF',min:90,starter:true}; return; }
    let min;
    if(e.starter){ const off=e.mins.find(m=>subOn.includes(m)); min = off||90; }
    else { min = e.mins.length? Math.max(1,90-Math.min(...e.mins)) : 20; }
    info[name]={pos:e.pos, min, starter:e.starter};
  });
  return info;
}

/* ---------- assemble a match ---------- */
async function parseMatch(arrayBuffer){
  const pdf=await pdfjsLib.getDocument({data:arrayBuffer}).promise;
  const pages=await loadPages(pdf);
  // match meta from page 1 (index0)
  const head=pages[0].items.map(i=>i.str).join(' ');
  const m=head.match(/^\s*(.+?)\s+(\d+)\s*-\s*(\d+)\s+([A-Za-z].+?)\s+(?:Group|Match|\d|$)/);
  let teamA='Home',teamB='Away',scoreA=0,scoreB=0;
  if(m){ teamA=m[1].trim(); scoreA=+m[2]; scoreB=+m[3]; teamB=m[4].trim(); }
  const dateM=head.match(/(\d{1,2}\s+\w+\s+20\d\d)/); const date=dateM?dateM[1]:'';
  const venM=head.match(/([A-Z][\w/.'’ -]*?Stadium)/);
  let venue=venM?venM[1].replace(/\s+/g,' ').trim():'';
  venue=venue.replace(/^Kick\s*O\w*\s+/i,'').replace(/^\d[\d:]*\s+/,'').trim();

  function buildTeam(team, gd){
    const distP=findPage(pages,"Distributions",team);
    if(!distP) throw new Error('Could not find the "In Possession - Distributions" page for '+team+' — is this a FIFA Post-Match Summary Report?');
    const dist=extractTable(distP.items, DIST);
    const offP=findPage(pages,"Receptions",team);
    const off=offP?extractTable(offP.items, OFFER):{};
    const defP=findPage(pages,"Out of Possession",team);
    const defn=defP?extractTable(defP.items, DEFN):{};
    const gk=gkStats(pages, team);
    const names=Object.values(dist).map(d=>d.name);
    const line=lineupInfo(pages, names);
    const players=[];
    Object.keys(dist).forEach(numk=>{
      const name=dist[numk].name;
      const p={...dist[numk].rec};
      if(off[numk]) Object.assign(p, off[numk].rec);
      if(defn[numk]) Object.assign(p, defn[numk].rec);
      const li=line[name]||{pos:'MF',min:90,starter:true};
      p.name=name; p.num=numk; p.pos=li.pos; p.min=li.min; p.starter=li.starter;
      if(p.pos==='GK'){ p.faced=gk.faced; p.save_pct=gk.save_pct; }
      p.rating=ratePlayer(p, p.pos, gd);
      players.push(p);
    });
    players.forEach(p=>p.feat = p.pos==='GK'?null:featScore(p,p.pos));
    return {name:team, players, agg:teamAggregate(players)};
  }
  const gd=scoreA-scoreB;
  return { teamA, teamB, scoreA, scoreB, date, venue,
           home:buildTeam(teamA, gd), away:buildTeam(teamB, -gd) };
}

return { parseMatch, ratePlayer, featScore, teamAggregate, POS_W, POS_CAL };
})();
