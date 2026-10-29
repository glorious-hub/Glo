// HoYoWiki: finding a character's page by name and reading it in Korean (headers, methods, and what CORS allows)
import fs from 'node:fs';
const OUT = 'ci-logs';
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'https://appassets.androidplatform.net';
const enc = encodeURIComponent;
const H = { 'x-rpc-language': 'ko-kr', 'x-rpc-wiki_app': 'genshin', 'Content-Type': 'application/json', Referer: 'https://wiki.hoyolab.com/', Origin: 'https://wiki.hoyolab.com' };
const targets = [
  ['list-static-post', 'https://sg-wiki-api-static.hoyolab.com/hoyowiki/genshin/wapi/get_entry_page_list', { method: 'POST', headers: H, body: JSON.stringify({ filters: [], menu_id: '2', page_num: 1, page_size: 30, use_es: true }) }],
  ['list-api-post', 'https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/get_entry_page_list', { method: 'POST', headers: H, body: JSON.stringify({ filters: [], menu_id: '2', page_num: 1, page_size: 30, use_es: true }) }],
  ['search-post', 'https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/search', { method: 'POST', headers: H, body: JSON.stringify({ keyword: '라이오슬리', page_num: 1, page_size: 10 }) }],
  ['search-get-static', `https://sg-wiki-api-static.hoyolab.com/hoyowiki/genshin/wapi/search?keyword=${enc('라이오슬리')}`, { headers: H }],
  ['entry-nohdr', 'https://sg-wiki-api-static.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=4022', {}],
  ['entry-langparam', 'https://sg-wiki-api-static.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=4022&lang=ko-kr', {}],
  ['entry-hdr-apporigin', 'https://sg-wiki-api-static.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=4022', { headers: { 'x-rpc-language': 'ko-kr', 'x-rpc-wiki_app': 'genshin', Origin: ORIGIN } }],
  ['entry-via-jina', 'https://r.jina.ai/https://sg-wiki-api-static.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=4022', { headers: { Origin: ORIGIN } }],
  ['hsr-list', 'https://sg-wiki-api-static.hoyolab.com/hoyowiki/hsr/wapi/get_entry_page_list', { method: 'POST', headers: { ...H, 'x-rpc-wiki_app': 'hsr' }, body: JSON.stringify({ filters: [], menu_id: '104', page_num: 1, page_size: 30, use_es: true }) }],
  ['wiki-search-wrio', `https://ko.wikipedia.org/w/api.php?format=json&origin=*&utf8=1&action=query&list=search&srlimit=5&srsearch=${enc('원신 라이오슬리')}`, { headers: { Origin: ORIGIN } }],
  ['jina-naver-lines', 'https://r.jina.ai/https://m.blog.naver.com/PostView.naver?blogId=shinhwa4466&logNo=223963806170', { headers: { Origin: ORIGIN } }],
];
const lines = [];
const say = s => { console.log(s); lines.push(s); };
for (const [label, url, opt] of targets) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: opt.method || 'GET', headers: opt.headers || {}, body: opt.body, signal: AbortSignal.timeout(45000) });
    const body = await r.text();
    fs.writeFileSync(`${OUT}/${label}.txt`, body);
    const ko = (body.match(/[가-힣]/g) || []).length;
    say(`${label}\tstatus=${r.status}\tms=${Date.now() - t0}\tbytes=${body.length}\thangul=${ko}\tallow-origin=${r.headers.get('access-control-allow-origin')}\thead=${body.slice(0, 160).replace(/\s+/g, ' ')}`);
  } catch (e) {
    say(`${label}\tERR ${e.name} ${e.message}\tms=${Date.now() - t0}`);
  }
}
fs.writeFileSync(`${OUT}/summary.txt`, lines.join('\n') + '\n');
