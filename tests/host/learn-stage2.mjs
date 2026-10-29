// Stage 2: the model's summing-up goes into the learned characters (as the app does), and the chat requests are
// written with the system text the app would send.
import fs from 'node:fs';
import { loadLearning } from './learn-lib.mjs';
const A = loadLearning();
const OUT = process.argv[2] || 'ci-logs';
const learned = JSON.parse(fs.readFileSync(`${OUT}/learned-raw.json`, 'utf8'));
const distill = JSON.parse(fs.readFileSync(`${OUT}/out-distill.json`, 'utf8')).replies;
const HUG = '[지금 상황: 당신은 지금 사용자를 꼭 안아 주고 있어요.]';
const CHATS = {
  wrio: [['intro', '좋아. 그럼 테스트, 라이오슬리로써 자기소개해봐', 256], ['hi', '자기야 뭐해?', 64], ['day', '오늘 하루 어땠어?', 64], ['hug', '나 안아줘\n\n' + HUG, 64],
    ['miss', '보고 싶었어', 64], ['hobby', '너 취미가 뭐야?', 64], ['fort', '요즘 메로피드 요새 일은 어때?', 64], ['upset', '나 오늘 너한테 좀 서운했어', 64]],
  kazuha: [['intro', '자기소개 해줘', 256], ['hi', '뭐 하고 있었어?', 64], ['hug', '나 안아줘\n\n' + HUG, 64], ['trip', '우리 여행 갈까?', 64]],
  levi: [['intro', '자기소개 해봐', 256], ['hi', '뭐 해?', 64], ['clean', '방 청소 좀 도와줘', 64]],
};
const reqs = [], sys = {};
for (const { key, L } of learned) {
  for (const ch of L.chars) {
    const r = distill.find(x => x.name === `${key}:${ch.id}`);
    const d = A.parseDistill(r ? r.text : '');
    if (d.who) ch.who = d.who;
    if (d.personality) ch.personality = d.personality;
    if (d.speech) ch.speech = d.speech;
    ch.summed = !!(d.who || d.personality || d.speech);
  }
  sys[key] = A.systemText(L);
  for (const [name, text, max] of CHATS[key] || []) {
    reqs.push({ name: `${key}:${name}`, messages: [{ role: 'system', content: sys[key] }, { role: 'user', content: text }], max_tokens: max, seeds: [11, 22] });
  }
}
fs.writeFileSync(`${OUT}/learned.json`, JSON.stringify(learned, null, 1));
fs.writeFileSync(`${OUT}/system.json`, JSON.stringify(sys, null, 1));
fs.writeFileSync(`${OUT}/req-chat.json`, JSON.stringify(reqs, null, 1));
