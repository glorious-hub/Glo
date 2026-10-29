// HoYoWiki through the Jina reader (what the page can use without the app's help): search and entry, Korean by URL only
import fs from 'node:fs';
const OUT = 'ci-logs';
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'https://appassets.androidplatform.net';
const enc = encodeURIComponent;
const API = 'https://sg-wiki-api-static.hoyolab.com/hoyowiki';
const targets = [
  ['search-lang-direct', `${API}/genshin/wapi/search?keyword=${enc('라이오슬리')}&lang=ko-kr`],
  ['search-lang-jina', `https://r.jina.ai/${API}/genshin/wapi/search?keyword=${enc('라이오슬리')}&lang=ko-kr`],
  ['entry-lang-jina', `https://r.jina.ai/${API}/genshin/wapi/entry_page?entry_page_id=4022&lang=ko-kr`],
  ['search-lang-jina-neuv', `https://r.jina.ai/${API}/genshin/wapi/search?keyword=${enc('느비예트')}&lang=ko-kr`],
  ['hsr-search-lang-jina', `https://r.jina.ai/${API}/hsr/wapi/search?keyword=${enc('단항')}&lang=ko-kr`],
  ['jina-json-header', `https://r.jina.ai/${API}/genshin/wapi/entry_page?entry_page_id=4022&lang=ko-kr`, { 'X-Return-Format': 'text' }],
];
const lines = [];
const say = s => { console.log(s); lines.push(s); };
for (const [label, url, extra] of targets) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: { Origin: ORIGIN, ...(extra || {}) }, signal: AbortSignal.timeout(45000) });
    const body = await r.text();
    fs.writeFileSync(`${OUT}/${label}.txt`, body);
    const ko = (body.match(/[가-힣]/g) || []).length;
    say(`${label}\tstatus=${r.status}\tms=${Date.now() - t0}\tbytes=${body.length}\thangul=${ko}\tallow-origin=${r.headers.get('access-control-allow-origin')}\thead=${body.slice(0, 200).replace(/\s+/g, ' ')}`);
  } catch (e) {
    say(`${label}\tERR ${e.name} ${e.message}\tms=${Date.now() - t0}`);
  }
}
fs.writeFileSync(`${OUT}/summary.txt`, lines.join('\n') + '\n');
