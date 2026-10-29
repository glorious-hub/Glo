// Stage 1: the user's words are read and the characters looked up on the real web; the summing-up requests for the
// model are written for runchat.
import fs from 'node:fs';
import { loadLearning } from './learn-lib.mjs';
const A = loadLearning();
const OUT = process.argv[2] || 'ci-logs';
fs.mkdirSync(OUT, { recursive: true });
const SCENES = [
  { key: 'wrio', teach: ['넌 이제부터 내 게이 남자친구인 라이오슬리야. 원신 라이오슬리의 말투를 학습하고 실제로 라이오슬리가 된것처럼 굴어.', '라이오슬리 말투 제대로 학습해와'] },
  { key: 'kazuha', teach: ['원신 카즈하처럼 말해줘', '너는 내 남자친구야', '나를 자기라고 불러'] },
  { key: 'levi', teach: ['진격의 거인 리바이 말투 학습해', '너는 내 남자친구야'] },
];
const learned = [], reqs = [], log = [];
for (const sc of SCENES) {
  const L = A.emptyLearn();
  for (const t of sc.teach) A.absorb(L, A.interpret(t), true);
  for (const ch of L.chars.filter(c => c.state === 'pending')) {
    const t0 = Date.now();
    let mat = '';
    // the model step is run separately: learnChar is given a stand-in that keeps the request
    try {
      await A.learnChar(ch, null, s => log.push(`${sc.key}: ${s}`));
    } catch (e) { log.push(`${sc.key}: failed ${e.message}`); }
    log.push(`${sc.key}: ${ch.title} looked up in ${Date.now() - t0} ms, ${ch.lines.length} lines, sources ${ch.src.map(s => s.title).join(' | ')}`);
  }
  learned.push({ key: sc.key, L });
}
fs.writeFileSync(`${OUT}/learned-raw.json`, JSON.stringify(learned, null, 1));
fs.writeFileSync(`${OUT}/stage1.txt`, log.join('\n') + '\n');
console.log(log.join('\n'));
// the summing-up the app asks the model for, one per character
for (const { key, L } of learned) for (const ch of L.chars) if (ch.mat) {
  reqs.push({ name: `${key}:${ch.id}`, messages: [{ role: 'system', content: A.DISTILL_SYS }, { role: 'user', content: A.distillPrompt(ch, ch.mat) }],
    max_tokens: 220, temperature: 0.2, top_p: 0.9, top_k: 24, min_p: 0.08, repeat_penalty: 1.05, seeds: [11] });
}
fs.writeFileSync(`${OUT}/req-distill.json`, JSON.stringify(reqs, null, 1));
