// Runs the page's learning code against the real web (the model step is left out): what Glok would learn about
// a character, and the raw answers kept as fixtures for offline tests.
import fs from 'node:fs';
const OUT = 'ci-logs';
fs.mkdirSync(`${OUT}/fx`, { recursive: true });
const learnSrc = fs.readFileSync('blocks/learn_block.js', 'utf8');
const researchSrc = fs.readFileSync('blocks/research_block.js', 'utf8');
// the page helpers the blocks use
const helpers = `
const tsig=(sig,ms)=>{const t=AbortSignal.timeout(ms);return (sig&&AbortSignal.any)?AbortSignal.any([sig,t]):t;};
async function getJSON(u,o){const r=await fetch(u,o);if(!r.ok)throw new Error(String(r.status));return r.json();}
async function getText(u,o){const r=await fetch(u,o);if(!r.ok)throw new Error(String(r.status));return r.text();}
const stripTags=s=>(s||'').replace(/<[^>]+>/g,'').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&#0?39;/g,"'").replace(/&nbsp;/g,' ').replace(/\\s+/g,' ').trim();
const abortErr=()=>Object.assign(new Error('aborted'),{name:'AbortError'});
const stripThink=s=>s;
const APP=false,NAT=null;let loaded=null,W=null,wBusy=false;
const ensureEngineReady=async()=>{};const withEngine=async f=>f();const chatReq=o=>o;const sysFix=m=>m;
const uid=()=>Math.random().toString(36).slice(2);
const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
function realUrl(href){try{const u=new URL(href);if(/(^|\\.)duckduckgo\\.com$/.test(u.hostname)){const t=u.pathname.startsWith('/l/')&&u.searchParams.get('uddg');if(!t)return null;const r=new URL(t);return /(^|\\.)duckduckgo\\.com$/.test(r.hostname)?null:r.href;}if(/(^|\\.)jina\\.ai$/.test(u.hostname))return null;return u.href;}catch(e){return null;}}
function parseResults(mdText){const re=/\\[([^\\]\\n]{1,300})\\]\\((https?:\\/\\/[^)\\s]+)\\)/g;const out=[];const seen=new Set();let m;while((m=re.exec(mdText))){const url=realUrl(m[2]);if(!url||seen.has(url))continue;seen.add(url);out.push({title:m[1].replace(/[*_\`#]/g,'').trim(),url,snippet:''});}return out.filter(r=>r.title.length>2);}
async function webSearch(q,sig){const t=await getText('https://r.jina.ai/https://html.duckduckgo.com/html/?q='+encodeURIComponent(q),{signal:tsig(sig,15000)});return parseResults(t).slice(0,5);}
`;
const api = new Function(helpers + learnSrc + researchSrc + ';return {interpret,absorb,emptyLearn,learnChar,hoyoFind,hoyoParse,wikiLearn,webLines,pickLines,speechOf,distillPrompt,jsonIn,webGet,HOYO_API};')();
const log = [];
const say = s => { console.log(s); log.push(s); };
// keep the raw answers for offline tests
const realFetch = globalThis.fetch;
let fx = 0;
globalThis.fetch = async (u, o) => {
  const r = await realFetch(u, o);
  const body = await r.clone().text();
  fs.writeFileSync(`${OUT}/fx/${String(++fx).padStart(2, '0')}.txt`, `${u}\n${r.status}\n${body}`);
  return r;
};
for (const text of ['넌 이제부터 내 게이 남자친구인 라이오슬리야. 원신 라이오슬리의 말투를 학습하고 실제로 라이오슬리가 된것처럼 굴어.', '원신 카즈하처럼 말해줘', '진격의 거인 리바이 말투 학습해']) {
  const L = api.emptyLearn();
  const got = api.absorb(L, api.interpret(text));
  say(`\n### ${text}\nfacts: ${got.facts.map(f => f.key + '=' + f.value).join(' | ')}\nchars: ${got.chars.map(c => c.title).join(' | ')}`);
  for (const ch of got.chars) {
    const t0 = Date.now();
    try {
      await api.learnChar(ch, null, s => say('  · ' + s));
      say(`learned in ${Date.now() - t0} ms: ${ch.title}\n  who: ${ch.who}\n  speech(rule): ${ch.speech}\n  info: ${(ch.info || []).join(' / ')}\n  src: ${ch.src.map(s => s.title + ' <' + s.url + '>').join(' | ')}\n  lines:\n${ch.lines.map(l => '   - ' + l).join('\n')}`);
    } catch (e) { say(`failed: ${e.message}`); }
  }
}
fs.writeFileSync(`${OUT}/summary.txt`, log.join('\n') + '\n');
