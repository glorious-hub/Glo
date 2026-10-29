// HoYoWiki character lists (Korean names and page ids) for Genshin and Star Rail, and one Star Rail page
import fs from 'node:fs';
const OUT = 'ci-logs';
fs.mkdirSync(OUT, { recursive: true });
const API = 'https://sg-wiki-api-static.hoyolab.com/hoyowiki';
const lines = [];
const say = s => { console.log(s); lines.push(s); };
async function list(app, menu) {
  const H = { 'x-rpc-language': 'ko-kr', 'x-rpc-wiki_app': app, 'Content-Type': 'application/json', Referer: 'https://wiki.hoyolab.com/', Origin: 'https://wiki.hoyolab.com' };
  const all = [];
  for (let p = 1; p < 20; p++) {
    const r = await fetch(`${API}/${app}/wapi/get_entry_page_list`, { method: 'POST', headers: H, body: JSON.stringify({ filters: [], menu_id: menu, page_num: p, page_size: 50, use_es: true }) });
    const j = await r.json();
    const l = (j.data && j.data.list) || [];
    all.push(...l.map(x => ({ id: x.entry_page_id, name: x.name })));
    if (l.length < 50) break;
  }
  say(`${app} menu ${menu}: ${all.length} entries`);
  return all;
}
const g = await list('genshin', '2');
const h = await list('hsr', '104');
fs.writeFileSync(`${OUT}/genshin-characters.json`, JSON.stringify(g));
fs.writeFileSync(`${OUT}/hsr-characters.json`, JSON.stringify(h));
// one Star Rail character page in Korean: which modules hold the profile and the voice lines
const first = h.find(x => /단항/.test(x.name)) || h[0];
const r = await fetch(`${API}/hsr/wapi/entry_page?entry_page_id=${first.id}&lang=ko-kr`);
const t = await r.text();
fs.writeFileSync(`${OUT}/hsr-entry.json`, t);
try {
  const page = JSON.parse(t).data.page;
  say(`hsr entry ${first.id} ${page.name}: ` + page.modules.map(m => `${m.name}[${m.components.map(c => c.component_id).join(',')}]`).join(' '));
} catch (e) { say('hsr entry parse failed ' + t.slice(0, 200)); }
fs.writeFileSync(`${OUT}/summary.txt`, lines.join('\n') + '\n');
