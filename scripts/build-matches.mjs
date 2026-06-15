// build-matches.mjs — discover every published FIFA Post-Match Summary from the
// match-report hub, rate each with the SHIPPED core.js, and write matches.json.
// Runs server-side (GitHub Action) so there's no browser CORS limit.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require    = createRequire(import.meta.url);
const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');          // repo root
const CORE_JS    = path.join(ROOT, 'core.js');
const OUT        = path.join(ROOT, 'matches.json');

const HUB  = 'https://www.fifatrainingcentre.com/en/fifa-world-cup-2026/match-report-hub.php';
const BASE = 'https://www.fifatrainingcentre.com/media/native/tournaments/fifa-world-cup/2026/';
const UA   = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

/* ---- load the shipped core.js in Node (same shim the test harness uses) ---- */
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
function loadPR(){
  globalThis.window = globalThis;
  globalThis.pdfjsLib = pdfjsLib;
  vm.runInThisContext(fs.readFileSync(CORE_JS, 'utf8'), { filename: 'core.js' });
  if(!globalThis.window.PR || typeof globalThis.window.PR.parseMatch !== 'function')
    throw new Error('core.js did not define window.PR.parseMatch');
  return globalThis.window.PR;
}

/* ---- discover the PMSR PDFs listed on the hub page ---- */
async function discover(){
  const res = await fetch(HUB, { headers:{ 'User-Agent': UA } });
  if(!res.ok) throw new Error('hub fetch failed: HTTP '+res.status);
  const html = await res.text();
  const byNum = new Map();
  const re = /PMSR[^"'<>]*?\.pdf/gi;              // matches both full-path and bare-filename forms
  let m;
  while((m = re.exec(html))){
    const file = m[0].split('/').pop().trim();     // basename only
    const num  = (file.match(/M(\d{2,3})/i) || [])[1];
    if(!num || byNum.has(num)) continue;
    byNum.set(num, { num, file, url: BASE + encodeURI(file) });
  }
  return [...byNum.values()].sort((a,b)=> a.num.localeCompare(b.num));
}

/* ---- main ---- */
const PR = loadPR();
const found = await discover();
console.log(`discovered ${found.length} match report(s) on the hub`);
if(found.length === 0) throw new Error('no PMSR links found on the hub — aborting (not overwriting matches.json)');

const matches = [];
for(const f of found){
  try{
    const r = await fetch(f.url, { headers:{ 'User-Agent': UA } });
    if(!r.ok) throw new Error('HTTP '+r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    const M = await PR.parseMatch(buf);
    const { _motm, ...clean } = M;
    matches.push({ _m: f.num, ...clean });
    console.log(`  M${f.num}  ${M.teamA} ${M.scoreA}-${M.scoreB} ${M.teamB}  (${M.home.players.length}+${M.away.players.length})`);
  }catch(e){
    console.warn(`  M${f.num}  SKIPPED — ${e.message}`);
  }
}
matches.sort((a,b)=> a._m.localeCompare(b._m));
const out = matches.map(({_m, ...rest}) => rest);   // drop the sort-only field

// safety: never shrink the published set due to a transient fetch/parse failure
let existing = [];
try{ existing = JSON.parse(fs.readFileSync(OUT,'utf8')); }catch(_){}
if(out.length === 0) throw new Error('parsed 0 matches — aborting write');
if(Array.isArray(existing) && out.length < existing.length)
  throw new Error(`parsed ${out.length} < existing ${existing.length} — likely a transient failure, not writing`);

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`\nwrote ${OUT} — ${out.length} matches (${(fs.statSync(OUT).size/1024).toFixed(0)} KB)`);
