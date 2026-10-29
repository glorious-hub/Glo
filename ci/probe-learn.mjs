// What the app can read on the web to learn a character: each source is fetched as the app would (from its own
// origin, so CORS matters), and the start of what comes back is kept for reading.
import fs from 'node:fs';
const OUT = 'ci-logs';
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'https://appassets.androidplatform.net';
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const enc = encodeURIComponent;
const name = '라이오슬리';
const targets = [
  ['wiki-search', `https://ko.wikipedia.org/w/api.php?format=json&origin=*&utf8=1&action=query&list=search&srlimit=5&srsearch=${enc(name)}`],
  ['wiki-full', `https://ko.wikipedia.org/w/api.php?format=json&origin=*&utf8=1&action=query&prop=extracts&explaintext=1&redirects=1&titles=${enc('라이오슬리 (원신)')}`],
  ['jina-namu-main', `https://r.jina.ai/https://namu.wiki/w/${enc(name)}`],
  ['jina-namu-lines', `https://r.jina.ai/https://namu.wiki/w/${enc(name + '/대사')}`],
  ['direct-namu-main', `https://namu.wiki/w/${enc(name)}`, { ua: true }],
  ['jina-ddg-lines', `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${enc(name + ' 대사')}`],
  ['jina-ddg-style', `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${enc('원신 ' + name + ' 말투 성격')}`],
  ['jina-gamedot', `https://r.jina.ai/https://genshin.gamedot.org/?mid=wiki&view=${enc(name)}`],
  ['hoyowiki-entry', 'https://sg-wiki-api-static.hoyolab.com/hoyowiki/genshin/wapi/entry_page?entry_page_id=4022', { headers: { 'x-rpc-language': 'ko-kr', 'x-rpc-wiki_app': 'genshin' } }],
  ['hoyowiki-search', `https://sg-wiki-api.hoyolab.com/hoyowiki/genshin/wapi/search?keyword=${enc(name)}`, { headers: { 'x-rpc-language': 'ko-kr', 'x-rpc-wiki_app': 'genshin' } }],
  ['jina-hoyowiki-page', 'https://r.jina.ai/https://wiki.hoyolab.com/pc/genshin/entry/4022?lang=ko-kr'],
  ['fandom-voice', 'https://genshin-impact.fandom.com/api.php?action=parse&page=Wriothesley/Voice-Overs&format=json&origin=*&prop=wikitext'],
  ['fandom-voice-ko', 'https://genshin-impact.fandom.com/api.php?action=parse&page=Wriothesley/Voice-Overs/Korean&format=json&origin=*&prop=wikitext'],
];
const lines = [];
const say = s => { console.log(s); lines.push(s); };
for (const [label, url, opt = {}] of targets) {
  const headers = { Origin: ORIGIN, ...(opt.headers || {}) };
  if (opt.ua) headers['User-Agent'] = UA;
  const t0 = Date.now();
  let pre = '';
  if (opt.headers) {
    try {
      const p = await fetch(url, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': Object.keys(opt.headers).join(',') }, signal: AbortSignal.timeout(20000) });
      pre = ` preflight=${p.status} allow-origin=${p.headers.get('access-control-allow-origin')} allow-headers=${p.headers.get('access-control-allow-headers')}`;
    } catch (e) { pre = ` preflight=ERR ${e.message}`; }
  }
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(45000) });
    const body = await r.text();
    fs.writeFileSync(`${OUT}/${label}.txt`, body);
    const ko = (body.match(/[가-힣]/g) || []).length;
    say(`${label}\tstatus=${r.status}\tms=${Date.now() - t0}\tbytes=${body.length}\thangul=${ko}\tallow-origin=${r.headers.get('access-control-allow-origin')}\ttype=${r.headers.get('content-type')}${pre}`);
  } catch (e) {
    say(`${label}\tERR ${e.name} ${e.message}\tms=${Date.now() - t0}${pre}`);
  }
}
fs.writeFileSync(`${OUT}/summary.txt`, lines.join('\n') + '\n');
