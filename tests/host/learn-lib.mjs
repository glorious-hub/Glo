// The page's learning code (tests/host/blocks, the same text as in Glok.html) with the few page helpers it uses.
import fs from 'node:fs';
const dir = new URL('./blocks/', import.meta.url);
const helpers = `
const tsig=(sig,ms)=>{const t=AbortSignal.timeout(ms);return (sig&&AbortSignal.any)?AbortSignal.any([sig,t]):t;};
async function getJSON(u,o){const r=await fetch(u,o);if(!r.ok)throw new Error(String(r.status));return r.json();}
async function getText(u,o){const r=await fetch(u,o);if(!r.ok)throw new Error(String(r.status));return r.text();}
const stripTags=s=>(s||'').replace(/<[^>]+>/g,'').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&#0?39;/g,"'").replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();
const abortErr=()=>Object.assign(new Error('aborted'),{name:'AbortError'});
const stripThink=s=>String(s||'').replace(/<think>[\\s\\S]*?<\\/think>/g,'');
const APP=false,NAT=null;let loaded=null,W=null,wBusy=false;
const ensureEngineReady=async()=>{};const withEngine=async f=>f();const chatReq=o=>o;const sysFix=m=>m;
let __uid=0;const uid=()=>'u'+(++__uid);
const __store={};const localStorage={getItem:k=>__store[k]??null,setItem:(k,v)=>{__store[k]=v;},removeItem:k=>{delete __store[k];}};
function realUrl(href){try{const u=new URL(href);if(/(^|\\.)duckduckgo\\.com$/.test(u.hostname)){const t=u.pathname.startsWith('/l/')&&u.searchParams.get('uddg');if(!t)return null;const r=new URL(t);return /(^|\\.)duckduckgo\\.com$/.test(r.hostname)?null:r.href;}if(/(^|\\.)jina\\.ai$/.test(u.hostname))return null;return u.href;}catch(e){return null;}}
function parseResults(mdText){const re=/\\[([^\\]\\n]{1,300})\\]\\((https?:\\/\\/[^)\\s]+)\\)/g;const out=[];const seen=new Set();let m;while((m=re.exec(mdText))){const url=realUrl(m[2]);if(!url||seen.has(url))continue;seen.add(url);out.push({title:m[1].replace(/[*_\`#]/g,'').trim(),url,snippet:''});}return out.filter(r=>r.title.length>2);}
async function webSearch(q,sig){const t=await getText('https://r.jina.ai/https://html.duckduckgo.com/html/?q='+encodeURIComponent(q),{signal:tsig(sig,15000)});return parseResults(t).slice(0,5);}
`;
export function loadLearning() {
  const src = fs.readFileSync(new URL('learn_block.js', dir), 'utf8') + '\n' + fs.readFileSync(new URL('research_block.js', dir), 'utf8');
  return new Function(helpers + src + `;return {interpret,absorb,emptyLearn,learnChar,parseDistill,distillPrompt,DISTILL_SYS,charBlock,
    systemText:L=>{LRN=L;return systemText();},cutLine,speechOf};`)();
}
// the app's casual cut: two sentences (34+ characters), not inside an open quote
export function cut2(full) {
  let acc = '';
  for (const ch of String(full || '')) {
    acc += ch;
    const t = acc.trim();
    if (t.length < 22 || !/[.!?~♡♥]\s*$/.test(t)) continue;
    const s = t.split(/[.!?~]+\s*/).filter(Boolean).length;
    if (s >= 2 && t.length >= 34) return t;
  }
  return acc.trim();
}
