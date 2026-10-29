// What came out: the learned characters and the replies as the app would show them.
import fs from 'node:fs';
import { cut2 } from './learn-lib.mjs';
const OUT = process.argv[2] || 'ci-logs';
const label = process.argv[3] || '';
const learned = JSON.parse(fs.readFileSync(`${OUT}/learned.json`, 'utf8'));
const distill = JSON.parse(fs.readFileSync(`${OUT}/out-distill.json`, 'utf8'));
const chat = JSON.parse(fs.readFileSync(`${OUT}/out-chat.json`, 'utf8'));
const req = JSON.parse(fs.readFileSync(`${OUT}/req-chat.json`, 'utf8'));
const lines = [`model ${label}: load ${Math.round(chat.load_ms)} ms, peak ${Math.round(chat.vm_hwm_kb / 1024)} MB`];
for (const { key, L } of learned) {
  lines.push(`\n=== ${key}`);
  for (const f of L.facts) lines.push(`fact  ${f.key}: ${f.value}`);
  for (const c of L.chars) {
    const r = distill.replies.find(x => x.name === `${key}:${c.id}`);
    lines.push(`char  ${c.title}  [${c.state}${c.summed ? ', summed up by the model' : ', rules only'}]`, `  who: ${c.who}`, `  personality: ${c.personality}`, `  speech: ${c.speech}`,
      `  lines: ${c.lines.length}`, `  model said: ${(r ? r.text : '').replace(/\n/g, ' / ')}`, r ? `  (${r.n_prompt}+${r.n_gen} tokens, ${Math.round(r.prompt_ms + r.gen_ms)} ms)` : '');
  }
  for (const r of chat.replies.filter(x => x.name.startsWith(key + ':'))) {
    const q = req.find(x => x.name === r.name);
    const casual = q && q.max_tokens <= 64;
    const shown = casual ? cut2(r.text) : r.text.trim();
    lines.push(`R ${r.name} ${r.seed}: ${shown.replace(/\n+/g, ' ')}   (${Math.round(r.prompt_ms + r.gen_ms)} ms)`);
  }
}
fs.writeFileSync(`${OUT}/summary.txt`, lines.join('\n') + '\n');
console.log(lines.join('\n'));
