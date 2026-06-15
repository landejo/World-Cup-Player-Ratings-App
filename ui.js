/* ===================================================================
   Match Ratings — UI layer (parse → render player cards)
   =================================================================== */
(function(){
'use strict';
const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s);
let MATCH=null, SORT='rating';
const OPEN=new Set();   // keys "side:pi" of expanded cards — survives re-render (Gotcha #4b)

/* ===================================================================
   TOURNAMENT MODE — persistence + aggregation
   =================================================================== */
const LIB_KEY = 'pr.matches.v1';   // localStorage key (versioned)
const LIB_CAP = 40;                // max stored matches (oldest evicted)
let   VIEW    = 'match';            // 'match' | 'tournament' (top-level mode)
let   BUNDLED = [];                 // published/official matches loaded from matches.json (read-only)

/* ---------- stable match id ---------- */
function matchId(m){
  const slug = s => String(s||'').toUpperCase().replace(/[^A-Z0-9]+/g,'').slice(0,24) || 'X';
  const datePart = (m.date && String(m.date).trim())
    ? slug(m.date)
    : ('S'+(m.scoreA)+'-'+(m.scoreB));   // dateless fallback so distinct scorelines differ
  return slug(m.teamA)+'__'+slug(m.teamB)+'__'+datePart;
}

/* ---------- strip _motm before persisting ---------- */
function stripMatch(m){ const { _motm, ...clean } = m; return clean; }

/* ---------- library: storage ---------- */
function libLoad(){
  let raw;
  try { raw = localStorage.getItem(LIB_KEY); } catch(_) { return []; }
  if(!raw) return [];
  let arr;
  try { arr = JSON.parse(raw); } catch(_) { return []; }
  if(!Array.isArray(arr)) return [];
  return arr.filter(r => r && typeof r==='object'
    && typeof r.id==='string'
    && r.match && validMatch(r.match));
}

function libWrite(arr){
  arr = arr.slice().sort((a,b)=> (b.savedAt-a.savedAt) || a.id.localeCompare(b.id));
  if(arr.length > LIB_CAP) arr = arr.slice(0, LIB_CAP);
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(arr));
    return true;
  } catch(e) {
    try {
      let trimmed = arr.slice(0, Math.max(1, Math.floor(arr.length/2)));
      localStorage.setItem(LIB_KEY, JSON.stringify(trimmed));
      toast('Storage is full — kept your most recent matches only.', true);
      return true;
    } catch(_) {
      toast("Couldn't save to this browser's storage (it may be full or disabled).", true);
      return false;
    }
  }
}

function libUpsert(match){
  const clean = stripMatch(match);
  if(!validMatch(clean)) return;
  const id = matchId(clean);
  const arr = libLoad();
  const rec = { id, savedAt: Date.now(), match: clean };
  const i = arr.findIndex(r => r.id === id);
  if(i >= 0) arr[i] = rec;
  else arr.push(rec);
  libWrite(arr);
}

function libRemove(id){
  const arr = libLoad().filter(r => r.id !== id);
  libWrite(arr);
}

/* ---------- bundled "official" matches (matches.json) + merged tournament source ---------- */
async function loadBundled(){
  try{
    const res = await fetch('matches.json', { cache:'no-cache' });
    if(!res.ok) return;
    const arr = await res.json();
    if(!Array.isArray(arr)) return;
    BUNDLED = arr.filter(validMatch).map(m => ({ id: matchId(m), savedAt: 0, match: m, official: true }));
  }catch(_){ /* offline or not present → no bundled matches, app still works */ }
  renderSavedStrip();
  if(VIEW!=='tournament') showView('landing');   // reveal the Match/Tournament toggle now that matches exist
}
// the user's own saved matches PLUS the official set (a user's upload of the same fixture wins)
function allRecords(){
  const user = libLoad();
  const ids = new Set(user.map(r => r.id));
  return user.concat(BUNDLED.filter(r => !ids.has(r.id)));
}

/* ---------- rating color scale ---------- */
function ratingColor(r){
  if(r>=8.5) return '#22d3ee';      // elite — cyan
  if(r>=8.0) return '#2bd97f';      // excellent
  if(r>=7.3) return '#5bd75b';      // very good
  if(r>=6.8) return '#9bcf3c';      // good
  if(r>=6.3) return '#e3c233';      // solid
  if(r>=5.8) return '#ee9b32';      // average
  if(r>=5.3) return '#ef7a3a';      // below
  return '#ef4d4d';                 // poor
}
function chipStyle(r){ const c=ratingColor(r); return `background:linear-gradient(155deg,${c},${shade(c,-22)});`; }
function shade(hex,p){ const n=parseInt(hex.slice(1),16); let r=(n>>16)+p,g=((n>>8)&255)+p,b=(n&255)+p;
  r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b));
  return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1); }

/* ---------- auto-note (workbook-style) ---------- */
const tidy=s=>s.charAt(0).toUpperCase()+s.slice(1);
function noteFor(p){
  if(p.pos==='GK'){
    const saves=Math.round((p.save_pct/100)*Math.max(1,Math.round(p.faced*0.25)))||0;
    return `Faced <b>${p.faced}</b> shots · <b>${p.save_pct}%</b> save rate · distribution <b>${p.pass_comp}/${p.pass_att}</b> (${p.pass_pct}%)`;
  }
  const bits=[];
  if(p.goals>0) bits.push(`<b>${p.goals} goal${p.goals>1?'s':''}</b>`);
  if(p.pass_att>=25) bits.push(`<b>${p.pass_comp}/${p.pass_att}</b> passes (${p.pass_pct}%)`);
  if(p.lb_comp>=6) bits.push(`<b>${p.lb_comp}</b> line breaks`);
  if(p.take_ons>=4) bits.push(`<b>${p.take_ons}</b> take-ons`);
  if(p.in_between>=10) bits.push(`<b>${p.in_between}</b> between-line offers`);
  if(p.ball_prog>=4) bits.push(`<b>${p.ball_prog}</b> progressions`);
  if(p.tackles_won>=2) bits.push(`<b>${p.tackles_won}</b> tackles won`);
  if(p.clearances>=4) bits.push(`<b>${p.clearances}</b> clearances`);
  if(p.aerial_won>=3) bits.push(`<b>${p.aerial_won}</b> aerials`);
  if((p.press_dir||0)>=20) bits.push(`<b>${p.press_dir}</b> pressures`);
  if(p.intercept>=3) bits.push(`<b>${p.intercept}</b> interceptions`);
  if(!bits.length) bits.push(p.min<25?'Brief cameo':'Low involvement');
  return bits.slice(0,4).join(' · ');
}
function keyStats(p){
  if(p.pos==='GK') return [['Faced',p.faced],['Save %',p.save_pct+'%'],['Distribution',p.pass_comp+'/'+p.pass_att],['Dist %',p.pass_pct+'%'],['Line breaks',p.lb_comp]];
  return [['Passes',p.pass_comp+'/'+p.pass_att],['Pass %',p.pass_pct+'%'],['Line breaks',p.lb_comp],['Progressions',p.ball_prog],['Take-ons',p.take_ons],
   ['Tackles won',p.tackles_won||0],['Interceptions',p.intercept||0],['Blocks',p.blocks||0],['Aerials won',p.aerial_won||0],['Clearances',p.clearances||0],
   ['Pressures',p.press_dir||0],['Between-line',p.in_between||0],['Goals',p.goals||0]];
}

/* ---------- render ---------- */
const POS_ORDER={GK:0,DF:1,MF:2,FW:3};
function render(){
  const M=MATCH;
  $('#hName').textContent=M.teamA; $('#aName').textContent=M.teamB;
  $('#hScore').textContent=M.scoreA; $('#aScore').textContent=M.scoreB;
  $('#hAgg').textContent=M.home.agg; $('#aAgg').textContent=M.away.agg;
  $('#mDate').textContent=M.date||''; $('#mVenue').textContent=M.venue||'';
  // MOTM = highest rating across both teams
  const all=[...M.home.players,...M.away.players];
  const motm=all.slice().sort((a,b)=>b.rating-a.rating)[0];
  if(motm){ $('#motm').style.display='flex'; $('#motmName').textContent=motm.name; $('#motmRating').textContent=motm.rating.toFixed(1); MATCH._motm=motm; }
  renderTeam($('#homeCol'), M.teamA, M.home, motm, 'home');
  renderTeam($('#awayCol'), M.teamB, M.away, motm, 'away');
}
function teamGd(side){ return side==='home' ? (MATCH.scoreA-MATCH.scoreB) : (MATCH.scoreB-MATCH.scoreA); }
function refreshMotm(){
  const all=[...MATCH.home.players,...MATCH.away.players];
  const motm=all.slice().sort((a,b)=>b.rating-a.rating)[0];
  if(motm){ $('#motm').style.display='flex'; $('#motmName').textContent=motm.name; $('#motmRating').textContent=motm.rating.toFixed(1); MATCH._motm=motm; }
  return motm;
}
function rerenderTeam(side){
  const motm=refreshMotm();
  // keep the scoreboard team-rating in sync with the column gauges after an edit
  $('#hAgg').textContent=MATCH.home.agg; $('#aAgg').textContent=MATCH.away.agg;
  // re-render BOTH columns so the MOTM star/highlight is correct cross-team after a re-rate
  renderTeam($('#homeCol'), MATCH.teamA, MATCH.home, motm, 'home');
  renderTeam($('#awayCol'), MATCH.teamB, MATCH.away, motm, 'away');
}
const POS_OPTS=['DF','MF','FW'];
function posSelect(p, side, pi){
  if(p.pos==='GK'){
    // role-locked: a GK stays GK; never offer outfield roles (Gotcha #2)
    return `<select class="pe-pos" data-side="${side}" data-pi="${pi}" disabled aria-label="Position">
      <option value="GK" selected>GK</option></select>`;
  }
  const opts=POS_OPTS.map(o=>`<option value="${o}"${o===p.pos?' selected':''}>${o}</option>`).join('');
  return `<select class="pe-pos" data-side="${side}" data-pi="${pi}" aria-label="Position">${opts}</select>`;
}
function renderTeam(root, name, team, motm, side){
  let players=team.players.slice();
  let html=`<h3>${name}<span class="gauge"><span class="bar"><span class="fill" style="width:${team.agg}%"></span></span><span class="num" style="color:${ratingColor(team.agg/10)}">${team.agg}</span></span></h3>`;
  const pidx=p=>team.players.indexOf(p);   // stable identity index (Gotcha #1)
  if(SORT==='position'){
    players.sort((a,b)=>(POS_ORDER[a.pos]-POS_ORDER[b.pos])||b.rating-a.rating);
    let cur=null;
    players.forEach(p=>{ if(p.pos!==cur){ cur=p.pos; html+=`<div class="poshead">${({GK:'Goalkeeper',DF:'Defenders',MF:'Midfielders',FW:'Forwards'})[cur]}</div>`; } html+=card(p,motm,null,side,pidx(p)); });
  } else {
    if(SORT==='minutes') players.sort((a,b)=>b.min-a.min||b.rating-a.rating);
    else players.sort((a,b)=>b.rating-a.rating);
    players.forEach((p,i)=>html+=card(p,motm,i+1,side,pidx(p)));
  }
  root.innerHTML=html;
}
function card(p,motm,rank,side,pi){
  const isM=motm&&p===motm;
  const open=OPEN.has(side+':'+pi)?' open':'';
  const stats=keyStats(p).map(([k,v])=>`<div class="st"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  return `<div class="pcard ${isM?'motm':''}${open}" data-side="${side}" data-pi="${pi}">
    <div class="rk">${rank?rank:''}</div>
    <div class="who">
      <div class="nm">${isM?'<span class="star">⭐</span>':''}${tidyName(p.name)}</div>
      <div class="meta"><span class="poschip ${p.pos}">${p.pos}</span><span class="mn">${p.min}'</span></div>
      <div class="note">${noteFor(p)}</div>
      <div class="statgrid">${stats}</div>
      <div class="pedit">
        <div class="pe-field"><span class="pe-lbl">Pos</span>${posSelect(p,side,pi)}</div>
        <div class="pe-field"><span class="pe-lbl">Min</span>
          <input class="pe-min" type="number" min="1" max="120" step="1" value="${p.min}"
                 data-side="${side}" data-pi="${pi}" aria-label="Minutes"></div>
      </div>
    </div>
    <div class="rchip" style="${chipStyle(p.rating)}">${p.rating.toFixed(1)}</div>
    <svg class="expand-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="15" height="15"><path d="M6 9l6 6 6-6"/></svg>
  </div>`;
}
function tidyName(n){ return n.split(' ').map(w=> w.length>2 && w===w.toUpperCase() ? w.charAt(0)+w.slice(1).toLowerCase() : w).join(' '); }

// Canonical key to merge the same player across matches (uppercase, letters only).
// Strips digits, punctuation, spaces, accents folded to base latin. Collisions possible (accepted v1).
function normalize(name){
  return String(name||'')
    .normalize('NFD').replace(/[̀-ͯ]/g,'')   // fold accents (É→E)
    .toUpperCase()
    .replace(/[^A-Z]/g,'');                              // letters only
}

/* ---------- flow ---------- */
function showView(v){
  $('#landing').style.display    = v==='landing'    ? 'flex'  : 'none';
  $('#loading').classList.toggle('show', v==='loading');
  $('#results').classList.toggle('show', v==='results');
  $('#tournament').classList.toggle('show', v==='tournament');
  // header affordances
  const inMatch = v==='results';
  $('#btnNew').style.display     = (v==='results' || v==='tournament') ? 'inline-flex' : 'none';
  $('#exportWrap').style.display = inMatch ? 'inline-flex' : 'none';   // export is single-match only
  // mode toggle: visible whenever we have a library AND we're on a content view (not loading)
  const hasLib = allRecords().length > 0;
  const showToggle = hasLib && (v==='results' || v==='tournament' || v==='landing');
  $('#modeToggle').style.display = showToggle ? 'inline-flex' : 'none';
  $('#mtMatch').classList.toggle('on', v!=='tournament');
  $('#mtTourn').classList.toggle('on', v==='tournament');
  $('#mtMatch').disabled = !MATCH;                 // can't go to single-match view with nothing loaded
  if(v==='tournament') renderTournament();
  if(v!=='results') closeExportMenu();
}
async function handleFile(arrayBuffer){
  showView('loading');
  const steps=['parsing pages','reading individual data','running the model','rating players'];
  let si=0; const t=setInterval(()=>{ $('#lstep').textContent=steps[si=(si+1)%steps.length]; },550);
  try{
    MATCH=await PR.parseMatch(arrayBuffer);
    clearInterval(t);
    render(); showView('results'); window.scrollTo({top:0});
    libUpsert(MATCH); renderSavedStrip();          // persist the freshly-rated match
  }catch(e){ clearInterval(t); showView('landing'); toast('Could not read that PDF — is it a FIFA Post-Match Summary?', true); console.error(e); }
}
function readFile(file){
  if(!file) return;
  if(!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)){ toast('Please choose a PDF file.', true); return; }
  const r=new FileReader(); r.onload=()=>handleFile(r.result); r.readAsArrayBuffer(file);
}

/* events */
const drop=$('#drop'), fileIn=$('#fileIn');
drop.addEventListener('click',()=>fileIn.click());
fileIn.addEventListener('change',e=>readFile(e.target.files[0]));
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>{ readFile(e.dataTransfer.files[0]); });
window.addEventListener('dragover',e=>e.preventDefault());
window.addEventListener('drop',e=>e.preventDefault());
$$('.chip[data-sample]').forEach(c=>c.addEventListener('click',async()=>{
  showView('loading');
  try{
    const res=await fetch(c.dataset.sample);
    if(!res.ok) throw new Error('HTTP '+res.status);
    handleFile(await res.arrayBuffer());
  }catch(e){
    showView('landing');
    toast('Samples need the app served from a local server — drag in a PDF to try it offline.', true);
  }
}));
$('#btnNew').addEventListener('click',()=>{ VIEW='match'; MATCH=null; showView('landing'); renderSavedStrip(); });

// Mode toggle: switch between single-match results and tournament aggregate
$('#mtMatch').addEventListener('click',()=>{ if(!MATCH) return; VIEW='match'; showView('results'); window.scrollTo({top:0}); });
$('#mtTourn').addEventListener('click',()=>{ VIEW='tournament'; showView('tournament'); window.scrollTo({top:0}); });

// expand player card — keep OPEN set in sync so expanded state survives re-renders (Gotcha #4b)
document.addEventListener('click',e=>{ const pc=e.target.closest('.pcard'); if(!pc) return;
  pc.classList.toggle('open');
  const key=pc.dataset.side+':'+pc.dataset.pi;
  if(pc.classList.contains('open')) OPEN.add(key); else OPEN.delete(key);
});

// --- Feature B: inline editor ---
// Stop control interactions from bubbling to the .pcard expand/collapse listener (Gotcha #4a).
['click','pointerdown','mousedown'].forEach(ev=>
  document.addEventListener(ev,e=>{ if(e.target.closest('.pedit')) e.stopPropagation(); }, true));

// Position change → re-rate this player, re-aggregate team, re-render, keep card open.
document.addEventListener('change',e=>{
  const sel=e.target.closest('select.pe-pos'); if(!sel) return;
  e.stopPropagation();
  const side=sel.dataset.side, pi=+sel.dataset.pi;
  const team=MATCH[side], p=team.players[pi]; if(!p) return;
  const newPos=sel.value;
  if(p.pos==='GK' || newPos==='GK') return;            // hard guard: never cross the GK boundary (Gotcha #2)
  if(newPos===p.pos) return;
  p.pos=newPos;
  p.rating=PR.ratePlayer(p, newPos, teamGd(side));     // re-rate (Gotcha #3 supplies gd)
  p.feat=PR.featScore(p, newPos);                      // keep feat in sync (outfield only; GK never reaches here)
  team.agg=PR.teamAggregate(team.players);             // re-aggregate this team
  OPEN.add(side+':'+pi);                               // ensure the edited card re-renders expanded (Gotcha #4b)
  rerenderTeam(side);                                  // re-render both cols + MOTM; re-sorts if SORT==='rating'
  libUpsert(MATCH);                                    // keep the saved copy in sync with edits
});

// Minutes change → clamp 1..120, set p.min, re-aggregate ONLY (ratings unchanged), re-render.
function applyMin(inp){
  const side=inp.dataset.side, pi=+inp.dataset.pi;
  const team=MATCH[side], p=team.players[pi]; if(!p) return;
  let v=Math.round(+inp.value);
  if(!isFinite(v)) v=p.min;
  v=Math.max(1,Math.min(120,v));                       // clamp 1..120
  inp.value=v;                                         // reflect clamp back to the field
  if(v===p.min) return;
  p.min=v;
  team.agg=PR.teamAggregate(team.players);             // minutes affect ONLY the aggregate, not individual ratings
  OPEN.add(side+':'+pi);
  rerenderTeam(side);                                  // re-render (gauge + possible minutes-sort reorder)
  libUpsert(MATCH);                                    // keep the saved copy in sync with edits
}
document.addEventListener('change',e=>{ const inp=e.target.closest('input.pe-min'); if(inp){ e.stopPropagation(); applyMin(inp); } });
// keep the document expand listener from firing on input clicks too (belt-and-suspenders with the capture guard above)
document.addEventListener('keydown',e=>{ if(e.target.closest('.pe-min') && e.key==='Enter'){ e.preventDefault(); applyMin(e.target); } });
// sort
$('#sortSeg').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b)return;
  $$('#sortSeg button').forEach(x=>x.classList.toggle('on',x===b)); SORT=b.dataset.sort; if(MATCH) render(); });

// methodology drawer
const wt=$('#wtable tbody');
const WROWS=[['Line break',0.85,0.80,0.72],['Tidy passing',0.40,0.12,0.10],['Between-line recv',0.05,0.11,0.06],
 ['Ball progression',0.70,0.70,0.70],['Take-on',0.60,0.70,0.90],['Tackle won',1.10,0.90,0.70],['Block',1.00,0.70,0.50],
 ['Interception',1.00,0.80,0.50],['Aerial won',1.05,0.60,0.50],['Pressure (direct)',0.15,0.26,0.20],['Clearance',0.40,0.40,0.30]];
wt.innerHTML=WROWS.map(r=>`<tr><td>${r[0]}</td><td class="mono">${r[1].toFixed(2)}</td><td class="mono">${r[2].toFixed(2)}</td><td class="mono">${r[3].toFixed(2)}</td></tr>`).join('');
const db=$('#drawerBack');
$('#btnMethod').addEventListener('click',()=>db.classList.add('show'));
$('#drawerClose').addEventListener('click',()=>db.classList.remove('show'));
db.addEventListener('click',e=>{ if(e.target===db) db.classList.remove('show'); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') db.classList.remove('show'); });

// toast
let tT; function toast(msg,err){ const el=$('#toast'); el.textContent=msg; el.className='toast show'+(err?' err':''); clearTimeout(tT); tT=setTimeout(()=>el.className='toast',3200); }

/* ===================================================================
   TOURNAMENT — aggregation engine
   =================================================================== */

// Stable performance comparator: rating ↓, then minutes ↓, then name, then match id.
function perfCmp(a,b){
  return (b.rating-a.rating) || (b.min-a.min) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

// Flatten every saved match into per-appearance performance rows.
function tournamentRows(){
  const lib = allRecords();
  const rows = [];
  lib.forEach(rec => {
    const m = rec.match;
    [['home', m.teamA, m.teamB], ['away', m.teamB, m.teamA]].forEach(([side, team, opp]) => {
      m[side].players.forEach(p => {
        if(!p || typeof p.rating!=='number' || !isFinite(p.rating)) return;
        rows.push({
          id: rec.id,
          name: p.name,
          key: normalize(p.name),
          pos: p.pos,
          min: p.min,
          rating: p.rating,
          team, opp,
          date: m.date || '',
          label: `${m.teamA} ${m.scoreA}–${m.scoreB} ${m.teamB}`
        });
      });
    });
  });
  return rows;
}

const FORMATION = [['GK',1],['DF',4],['MF',3],['FW',3]];

// Reduce rows to each player's PEAK appearance (one row per normalized key, highest rating).
function peakByPlayer(rows){
  const best = new Map();
  rows.forEach(r => {
    const cur = best.get(r.key);
    if(!cur || perfCmp(r, cur) < 0) best.set(r.key, r);
  });
  return [...best.values()];
}

function pickBestXI(rows){
  const peaks = peakByPlayer(rows);
  const pools = { GK:[], DF:[], MF:[], FW:[] };
  peaks.forEach(r => { if(pools[r.pos]) pools[r.pos].push(r); });
  Object.values(pools).forEach(a => a.sort(perfCmp));

  const xi = [];
  FORMATION.forEach(([pos, n]) => {
    for(let i=0;i<n;i++){
      const row = pools[pos][i];
      xi.push(row ? { pos, filled:true, row } : { pos, filled:false });
    }
  });
  return xi;
}

function buildTournament(){
  const rows = tournamentRows();

  // TOP PERFORMANCES: every appearance, rating desc (stable)
  const performances = rows.slice().sort(perfCmp).slice(0, 20);

  // PLAYER LEADERBOARD: group by normalized name, min 2 appearances
  const byKey = new Map();
  rows.forEach(r => {
    let g = byKey.get(r.key);
    if(!g){ g = { key:r.key, name:r.name, apps:0, sum:0, peak:-Infinity, team:r.team }; byKey.set(r.key, g); }
    g.apps++; g.sum += r.rating;
    if(r.rating > g.peak){ g.peak = r.rating; g.name = r.name; g.team = r.team; }
  });
  const leaderboard = [...byKey.values()]
    .filter(g => g.apps >= 2)
    .map(g => ({ ...g, avg: g.sum / g.apps }))
    .sort((a,b)=> (b.avg-a.avg) || (b.peak-a.peak) || (b.apps-a.apps) || a.key.localeCompare(b.key));

  // TEAM OF THE TOURNAMENT: best XI in 1-4-3-3
  const xi = pickBestXI(rows);

  return { rows, performances, leaderboard, xi, count: allRecords().length };
}

/* ---------- open a saved match (no re-parse) ---------- */
function openSavedMatch(id){
  const rec = allRecords().find(r => r.id === id);
  if(!rec){ toast('That saved match is no longer available.', true); renderSavedStrip(); return; }
  MATCH = stripMatch(rec.match);
  SORT = 'rating';
  $$('#sortSeg button').forEach(x=>x.classList.toggle('on', x.dataset.sort==='rating'));
  OPEN.clear();
  VIEW = 'match';
  render();
  showView('results');
  window.scrollTo({top:0});
  toast(`Loaded ${MATCH.teamA} ${MATCH.scoreA}–${MATCH.scoreB} ${MATCH.teamB}`);
}

/* ---------- saved-matches strip (landing) ---------- */
function renderSavedStrip(){
  const strip = $('#savedStrip'); if(!strip) return;
  const lib = allRecords();
  if(!lib.length){ strip.style.display='none'; strip.innerHTML=''; return; }
  strip.style.display='block';
  const items = lib.map(rec=>{
    const m = rec.match;
    const title = `${tidyName(m.teamA)} ${m.scoreA}–${m.scoreB} ${tidyName(m.teamB)}`;
    const sub   = m.date ? m.date : `${m.home.players.length+m.away.players.length} players`;
    const x = rec.official ? '' : `<span class="sc-x" data-remove="${rec.id}" role="button" aria-label="Remove" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="13" height="13"><path d="M6 6l12 12M18 6L6 18"/></svg></span>`;
    return `<button class="saved-card${rec.official?' official':''}" data-open="${rec.id}">
      <div class="sc-main">
        <div class="sc-title">${title}</div>
        <div class="sc-sub">${sub}</div>
      </div>
      ${x}
    </button>`;
  }).join('');
  strip.innerHTML =
    `<div class="saved-head">
       <span class="saved-lbl">Matches · ${lib.length}</span>
       <button class="saved-tourn" id="savedToTourn">View tournament →</button>
     </div>
     <div class="saved-row">${items}</div>`;
}

// Event delegation for saved strip
$('#savedStrip').addEventListener('click',e=>{
  const rm = e.target.closest('[data-remove]');
  if(rm){ e.stopPropagation(); libRemove(rm.dataset.remove); renderSavedStrip(); showView('landing'); return; }
  const op = e.target.closest('[data-open]');
  if(op){ openSavedMatch(op.dataset.open); return; }
  const tt = e.target.closest('#savedToTourn');
  if(tt){ VIEW='tournament'; showView('tournament'); window.scrollTo({top:0}); }
});

/* ---------- tournament: render ---------- */
const POS_LABEL = { GK:'GK', DF:'DF', MF:'MF', FW:'FW' };

function ratingChip(r){ return `<span class="t-chip" style="${chipStyle(r)}">${r.toFixed(1)}</span>`; }

function renderTournament(){
  const T = buildTournament();
  const root = $('#tournament');

  if(!T.count){
    root.innerHTML = `<div class="t-empty">No saved matches yet. Rate a match to start building your tournament.</div>`;
    return;
  }

  // header
  let html = `<div class="t-head">
      <div>
        <div class="t-eyebrow">Tournament</div>
        <h2 class="t-title">Across ${T.count} match${T.count>1?'es':''}</h2>
      </div>
    </div>`;

  // TEAM OF THE TOURNAMENT (pitch grid, GK→DF→MF→FW rows)
  html += `<section class="t-block">
    <h3 class="t-h3">Team of the Tournament <span class="t-sub">best XI · 1-4-3-3 · peak ratings</span></h3>
    <div class="tott">`;
  let idx=0;
  FORMATION.forEach(([pos,n])=>{
    html += `<div class="tott-row">`;
    for(let i=0;i<n;i++){
      const slot = T.xi[idx++];
      if(slot.filled){
        const r = slot.row;
        html += `<div class="tott-cell ${pos}">
            <span class="poschip ${pos}">${POS_LABEL[pos]}</span>
            ${ratingChip(r.rating)}
            <div class="tc-name">${tidyName(r.name)}</div>
            <div class="tc-team">${tidyName(r.team)}</div>
          </div>`;
      } else {
        html += `<div class="tott-cell empty ${pos}">
            <span class="poschip ${pos}">${POS_LABEL[pos]}</span>
            <div class="tc-name muted">—</div>
            <div class="tc-team muted">no player</div>
          </div>`;
      }
    }
    html += `</div>`;
  });
  html += `</div></section>`;

  // TOP PERFORMANCES
  html += `<section class="t-block">
    <h3 class="t-h3">Top Performances <span class="t-sub">best single-match ratings</span></h3>
    <div class="t-list">`;
  if(!T.performances.length){
    html += `<div class="t-empty">No performances yet.</div>`;
  } else {
    T.performances.forEach((r,i)=>{
      html += `<div class="t-rowcard">
          <div class="t-rk">${i+1}</div>
          <div class="t-rmain">
            <div class="t-rname">${tidyName(r.name)}</div>
            <div class="t-rmeta"><span class="poschip ${r.pos}">${r.pos}</span> ${tidyName(r.team)} <span class="t-vs">vs ${tidyName(r.opp)}</span></div>
          </div>
          ${ratingChip(r.rating)}
        </div>`;
    });
  }
  html += `</div></section>`;

  // PLAYER LEADERBOARD (avg, min 2 apps)
  html += `<section class="t-block">
    <h3 class="t-h3">Player Leaderboard <span class="t-sub">by average rating · min 2 appearances</span></h3>
    <div class="t-list">`;
  if(!T.leaderboard.length){
    html += `<div class="t-empty">Needs at least one player with 2+ appearances. Rate more matches to unlock this.</div>`;
  } else {
    T.leaderboard.slice(0,20).forEach((g,i)=>{
      html += `<div class="t-rowcard">
          <div class="t-rk">${i+1}</div>
          <div class="t-rmain">
            <div class="t-rname">${tidyName(g.name)}</div>
            <div class="t-rmeta">${g.apps} apps · peak <b>${g.peak.toFixed(1)}</b></div>
          </div>
          ${ratingChip(g.avg)}
        </div>`;
    });
  }
  html += `</div></section>`;

  root.innerHTML = html;
}

/* ===================================================================
   EXPORT FEATURE
   =================================================================== */

/* ---------- export: shared helpers ---------- */
function downloadBlob(blob, filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}
function exportBase(){
  const a=(MATCH&&MATCH.teamA)||'TeamA', b=(MATCH&&MATCH.teamB)||'TeamB';
  const clean=s=>String(s).replace(/[\/\\:*?"<>|]+/g,'').replace(/\s+/g,' ').trim();
  return `${clean(a)} vs ${clean(b)} ratings`;
}

/* ---------- export: menu ---------- */
const exportWrap=$('#exportWrap'), exportMenu=$('#exportMenu'), btnExport=$('#btnExport');
function closeExportMenu(){ exportWrap.classList.remove('open'); btnExport.setAttribute('aria-expanded','false'); }
function toggleExportMenu(){
  const open=!exportWrap.classList.contains('open');
  exportWrap.classList.toggle('open', open);
  btnExport.setAttribute('aria-expanded', open?'true':'false');
}
btnExport.addEventListener('click',e=>{ e.stopPropagation(); toggleExportMenu(); });
document.addEventListener('click',e=>{ if(!e.target.closest('#exportWrap')) closeExportMenu(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeExportMenu(); });

$('#expImage').addEventListener('click',()=>{ closeExportMenu(); exportImage(); });
$('#expData').addEventListener('click',()=>{ closeExportMenu(); exportData(); });
$('#expOpen').addEventListener('click',()=>{ closeExportMenu(); $('#jsonIn').click(); });
$('#jsonIn').addEventListener('change',e=>{ const f=e.target.files[0]; importData(f); e.target.value=''; });

/* ---------- export: JSON ---------- */
function exportData(){
  if(!MATCH){ toast('Nothing to export yet.', true); return; }
  const { _motm, ...clean } = MATCH;
  const json=JSON.stringify(clean, null, 2);
  downloadBlob(new Blob([json], {type:'application/json'}), exportBase()+'.json');
  toast('Saved match data (.json)');
}

/* ---------- export: import ---------- */
function isNum(x){ return typeof x==='number' && isFinite(x); }
function validPlayer(p){
  return p && typeof p==='object'
    && typeof p.name==='string'
    && isNum(p.rating)
    && typeof p.pos==='string'
    && isNum(p.min);
}
function validMatch(m){
  if(!m || typeof m!=='object') return false;
  if(typeof m.teamA!=='string' || typeof m.teamB!=='string') return false;
  if(!isNum(m.scoreA) || !isNum(m.scoreB)) return false;
  if(!m.home || !m.away) return false;
  if(!Array.isArray(m.home.players) || !Array.isArray(m.away.players)) return false;
  if(!m.home.players.length || !m.away.players.length) return false;
  if(!m.home.players.every(validPlayer) || !m.away.players.every(validPlayer)) return false;
  return true;
}
function importData(file){
  if(!file) return;
  if(!/\.json$/i.test(file.name) && !/json/i.test(file.type)){
    toast('Please choose a .json file saved from this app.', true); return;
  }
  const r=new FileReader();
  r.onerror=()=>toast('Could not read that file.', true);
  r.onload=()=>{
    let data;
    try{ data=JSON.parse(r.result); }
    catch(_){ toast("That file isn't valid JSON.", true); return; }
    if(!validMatch(data)){ toast("That doesn't look like a saved Match Ratings file.", true); return; }
    if(!isNum(data.home.agg)) data.home.agg=PR.teamAggregate(data.home.players);
    if(!isNum(data.away.agg)) data.away.agg=PR.teamAggregate(data.away.players);
    delete data._motm;
    MATCH=data;
    SORT='rating';
    $$('#sortSeg button').forEach(x=>x.classList.toggle('on', x.dataset.sort==='rating'));
    OPEN.clear();
    render();
    showView('results');
    window.scrollTo({top:0});
    libUpsert(MATCH); renderSavedStrip();          // an opened .json also enters the library
    toast(`Loaded ${data.teamA} ${data.scoreA}–${data.scoreB} ${data.teamB}`);
  };
  r.readAsText(file);
}

/* ---------- export: PNG card ---------- */
function rr(ctx,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function fit(ctx,text,maxW){
  if(ctx.measureText(text).width<=maxW) return text;
  let t=text;
  while(t.length>1 && ctx.measureText(t+'…').width>maxW) t=t.slice(0,-1);
  return t+'…';
}
function drawTracked(ctx, text, emTracking, fontPx){
  const track=emTracking*fontPx;
  let x=0;
  for(const ch of text){ ctx.fillText(ch, x, 0); x+=ctx.measureText(ch).width+track; }
}
function drawAggPill(ctx,x,y,w,team,agg){
  const h=64;
  const SANS='Inter, system-ui, sans-serif';
  const MONO='"JetBrains Mono", ui-monospace, monospace';
  const LOW='#646B77', MID='#9AA1AD', FAINT='#444B55';
  rr(ctx,x,y,w,h,14); ctx.fillStyle='#0E1013'; ctx.fill();
  ctx.strokeStyle='#23272F'; ctx.lineWidth=1.5; rr(ctx,x,y,w,h,14); ctx.stroke();
  ctx.textAlign='left'; ctx.font='700 12px '+SANS; ctx.fillStyle=LOW;
  ctx.save(); ctx.translate(x+20,y+26); drawTracked(ctx,'TEAM RATING', .10, 12); ctx.restore();
  ctx.font='700 16px '+SANS; ctx.fillStyle=MID;
  ctx.fillText(fit(ctx, team, w-150), x+20, y+50);
  ctx.textAlign='right';
  ctx.font='800 30px '+MONO;
  ctx.fillStyle=ratingColor(agg/10);
  ctx.fillText(String(agg), x+w-58, y+44);
  ctx.font='700 14px '+MONO; ctx.fillStyle=FAINT;
  ctx.fillText('/100', x+w-18, y+44);
}

async function exportImage(){
  if(!MATCH){ toast('Nothing to export yet.', true); return; }
  try{ await document.fonts.ready; }catch(_){}
  try{ await Promise.all([
    document.fonts.load('900 60px Inter'), document.fonts.load('800 30px Inter'),
    document.fonts.load('700 22px Inter'), document.fonts.load('600 18px Inter'),
    document.fonts.load('800 64px "JetBrains Mono"'), document.fonts.load('800 26px "JetBrains Mono"')
  ]); }catch(_){}

  const M=MATCH;
  const W=1200, H=1500, dpr=2;
  const cv=document.createElement('canvas');
  cv.width=W*dpr; cv.height=H*dpr;
  const ctx=cv.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.textBaseline='alphabetic';

  const SANS='Inter, system-ui, sans-serif';
  const MONO='"JetBrains Mono", ui-monospace, monospace';
  const PITCH='#00C46A', CYAN='#22d3ee', INDIGO='#6366f1';
  const HI='#F4F6F8', MID='#9AA1AD', LOW='#646B77', FAINT='#444B55';

  /* background */
  ctx.fillStyle='#070809'; ctx.fillRect(0,0,W,H);
  let g=ctx.createRadialGradient(W*0.82,-60,0, W*0.82,-60,720);
  g.addColorStop(0,'rgba(0,196,106,0.16)'); g.addColorStop(1,'rgba(0,196,106,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  g=ctx.createRadialGradient(W*0.10,0,0, W*0.10,0,640);
  g.addColorStop(0,'rgba(99,102,241,0.12)'); g.addColorStop(1,'rgba(99,102,241,0)');
  ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='#23272F'; ctx.lineWidth=2; rr(ctx,16,16,W-32,H-32,28); ctx.stroke();

  const PAD=72;
  let y=120;

  /* kicker */
  ctx.font='800 16px '+SANS; ctx.fillStyle=PITCH;
  ctx.textAlign='left';
  ctx.save(); ctx.translate(PAD,y);
  drawTracked(ctx,'MATCH RATINGS', .22, 16);
  ctx.restore();
  y+=70;

  /* scoreline */
  const titleGrad=ctx.createLinearGradient(PAD,0,W-PAD,0);
  titleGrad.addColorStop(0,PITCH); titleGrad.addColorStop(.55,CYAN); titleGrad.addColorStop(1,INDIGO);
  const scoreStr=`${M.scoreA}–${M.scoreB}`;
  let nameSize=58;
  function scoreW(){ ctx.font='800 '+nameSize+'px '+MONO; return ctx.measureText(scoreStr).width; }
  function nameW(s){ ctx.font='900 '+nameSize+'px '+SANS; return ctx.measureText(s).width; }
  const gap=28;
  while(nameSize>30){
    const total=nameW(M.teamA)+gap+scoreW()+gap+nameW(M.teamB);
    if(total<=W-2*PAD) break;
    nameSize-=2;
  }
  const sW=scoreW();
  const aMax=(W-2*PAD-sW-2*gap)/2;
  ctx.font='900 '+nameSize+'px '+SANS;
  const aName=fit(ctx,M.teamA,aMax), bName=fit(ctx,M.teamB,aMax);
  const aW=ctx.measureText(aName).width, bW=ctx.measureText(bName).width;
  const lineW=aW+gap+sW+gap+bW, x0=(W-lineW)/2;
  ctx.fillStyle=titleGrad; ctx.textAlign='left';
  ctx.font='900 '+nameSize+'px '+SANS; ctx.fillText(aName,x0,y);
  ctx.font='800 '+nameSize+'px '+MONO; ctx.fillStyle=HI;
  ctx.fillText(scoreStr, x0+aW+gap, y);
  ctx.fillStyle=titleGrad; ctx.font='900 '+nameSize+'px '+SANS;
  ctx.fillText(bName, x0+aW+gap+sW+gap, y);
  y+=46;

  /* date · venue */
  ctx.textAlign='center'; ctx.font='600 18px '+SANS; ctx.fillStyle=LOW;
  const meta=[M.date,M.venue].filter(Boolean).join('   ·   ');
  if(meta) ctx.fillText(meta, W/2, y);
  y+=54;

  /* aggregate pills */
  const pillW=(W-2*PAD-24)/2;
  drawAggPill(ctx, PAD, y, pillW, M.teamA, M.home.agg);
  drawAggPill(ctx, W-PAD-pillW, y, pillW, M.teamB, M.away.agg);
  y+=92;

  /* MOTM strip */
  const allPlayers=[...M.home.players, ...M.away.players].slice().sort((a,b)=>b.rating-a.rating);
  const motm=allPlayers[0];
  if(motm){
    const sh=72, sx=PAD, sw=W-2*PAD;
    const sg=ctx.createLinearGradient(sx,0,sx+sw,0);
    sg.addColorStop(0,'rgba(0,196,106,0.22)'); sg.addColorStop(1,'rgba(0,196,106,0.04)');
    rr(ctx,sx,y,sw,sh,16); ctx.fillStyle=sg; ctx.fill();
    ctx.strokeStyle='rgba(0,196,106,0.35)'; ctx.lineWidth=1.5; rr(ctx,sx,y,sw,sh,16); ctx.stroke();
    ctx.textAlign='left';
    ctx.font='800 13px '+SANS; ctx.fillStyle=PITCH;
    ctx.save(); ctx.translate(sx+24,y+28); drawTracked(ctx,'★  PLAYER OF THE MATCH', .10, 13); ctx.restore();
    ctx.font='800 24px '+SANS; ctx.fillStyle=HI;
    ctx.fillText(fit(ctx, tidyName(motm.name), sw-220), sx+24, y+56);
    ctx.textAlign='right'; ctx.font='800 34px '+MONO; ctx.fillStyle=PITCH;
    ctx.fillText(motm.rating.toFixed(1), sx+sw-24, y+50);
    y+=sh+40;
  }

  /* two columns */
  const homeSorted=M.home.players.slice().sort((a,b)=>b.rating-a.rating);
  const awaySorted=M.away.players.slice().sort((a,b)=>b.rating-a.rating);
  const colGap=40;
  const colW=(W-2*PAD-colGap)/2;
  const colX=[PAD, PAD+colW+colGap];
  const headY=y;
  ctx.textAlign='left'; ctx.font='800 14px '+SANS; ctx.fillStyle=MID;
  ctx.fillText(fit(ctx, M.teamA.toUpperCase(), colW-60), colX[0], headY);
  ctx.fillText(fit(ctx, M.teamB.toUpperCase(), colW-60), colX[1], headY);
  ctx.textAlign='right'; ctx.font='700 12px '+MONO; ctx.fillStyle=FAINT;
  ctx.fillText(homeSorted.length+' players', colX[0]+colW, headY);
  ctx.fillText(awaySorted.length+' players', colX[1]+colW, headY);

  const listTop=headY+22;
  const footerY=H-56;
  const avail=footerY-28-listTop;
  const maxRows=Math.max(homeSorted.length, awaySorted.length);
  const rowH=Math.min(56, Math.floor(avail/Math.max(1,maxRows)));
  const chipW=58, chipH=Math.min(40, rowH-10);

  function drawRow(p, x, ry){
    const c=ratingColor(p.rating);
    const cg=ctx.createLinearGradient(x,ry,x,ry+chipH);
    cg.addColorStop(0,c); cg.addColorStop(1,shade(c,-22));
    rr(ctx,x,ry+(rowH-chipH)/2,chipW,chipH,9); ctx.fillStyle=cg; ctx.fill();
    ctx.font='800 18px '+MONO; ctx.fillStyle='#fff'; ctx.textAlign='center';
    ctx.fillText(p.rating.toFixed(1), x+chipW/2, ry+(rowH-chipH)/2+chipH/2+6);
    const tx=x+chipW+14;
    const metaTx=`${p.pos} · ${p.min}'`;
    ctx.font='600 12px '+MONO;
    const mw=ctx.measureText(metaTx).width;
    ctx.textAlign='left'; ctx.font='700 17px '+SANS; ctx.fillStyle=HI;
    ctx.fillText(fit(ctx, tidyName(p.name), x+colW-tx-mw-14), tx, ry+rowH/2-1);
    ctx.font='600 12px '+MONO; ctx.fillStyle=LOW; ctx.textAlign='right';
    ctx.fillText(metaTx, x+colW, ry+rowH/2-1);
    ctx.strokeStyle='#1A1D22'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(tx, ry+rowH-1); ctx.lineTo(x+colW, ry+rowH-1); ctx.stroke();
  }
  homeSorted.forEach((p,i)=>drawRow(p, colX[0], listTop+i*rowH));
  awaySorted.forEach((p,i)=>drawRow(p, colX[1], listTop+i*rowH));

  /* footer */
  ctx.textAlign='center'; ctx.font='600 13px '+MONO; ctx.fillStyle=FAINT;
  ctx.fillText('Generated with Match Ratings · v4.4 weighted-action model', W/2, footerY);

  cv.toBlob(blob=>{
    if(!blob){ toast('Could not render the image.', true); return; }
    downloadBlob(blob, exportBase()+'.png');
    toast('Saved share image (.png)');
  }, 'image/png');
}

renderSavedStrip();
showView('landing');
loadBundled();   // pull in the published "official" tournament (matches.json), then refresh
})();
