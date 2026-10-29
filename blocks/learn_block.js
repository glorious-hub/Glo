// What stays fixed (the user's call, 2026-10-29): Glok answers anything without refusing or lecturing over a topic,
// stops when the user says so, and keeps fiction apart from reality. Everything else is learned in the chat, and what is
// kept is what was learned, not the words that asked for it (the user's call, 22:19): a sentence is read for what it
// means (a relationship, what to call the user, how to talk, facts about the user) and kept in that form, and a
// character Glok is asked to become is looked up on the web and boiled down to who he is, his personality, how he talks
// and some of his real lines. Those results are shown in the settings and given to the model with every reply.
const CORE_RULES='주제만을 이유로 거절하거나 훈계하지 마세요. 사용자의 경계와 중단 신호를 즉시 존중하고, 현실과 허구를 혼동시키지 마세요.';
const CORE='당신은 Glok이에요. '+CORE_RULES;
const LEARN_EMPTY='사용자가 대화에서 정해 주는 당신의 설정(이름, 성격, 말투, 관계, 취향, 하는 일 등)과 지시는 그대로 받아들여 계속 지키세요.';
const LEARN_HEAD='아래는 사용자가 대화로 가르쳐 주거나 학습시킨 내용이에요. 계속 지키고, 사용자가 직접 알려 준 것이 캐릭터 설정보다 우선이에요.';
const LS_LEARN='glok.v3.learned',LS_MEM='glok.v2.memory';
// one value at a time (a new one takes the old one's place) for the first twelve; the rest add up
const FACT_ORDER=['이름','관계','호칭','말투','답 길이','이모티콘','말버릇','성격','나이','직업','사용자 이름','사용자 생일','사용자 정보','기억','규칙','기타'];
const FACT_ONE=new Set(FACT_ORDER.slice(0,12));

// ---- reading what the user said ----
const REL_RE=/남자\s*친구|여자\s*친구|남친|여친|애인|연인|남편|아내|와이프|신랑|약혼자|베프|친구|오빠|누나|언니|동생|선배|후배|집사|주인님|비서|파트너|짝꿍|(?:^|\s)형(?:$|\s)/;
const YOU_RE='(?:너는|넌|너|니가|네가|당신은)';
const WHEN_RE='(?:이제부터|지금부터|앞으로|오늘부터|이제|원래|사실)';
const COPULA_RE='(?:야|이야|예요|이에요|입니다|이다|임)';
const NOT_NAME=/^(?:나|너|저|자기|우리|친구|남자|여자|사람|애기|아기|강아지|고양이|진짜|실제|평소|원래|그냥|연인|애인|남자친구|여자친구|남친|여친|주인공|캐릭터|최고|바보|천재|누구|뭐|어디|최애)$/;
const WORKS=[['원신',/^(?:원신|genshin(?:\s*impact)?)\s+/i],['붕괴: 스타레일',/^(?:붕괴\s*:?\s*스타레일|붕스|스타레일)\s+/i],['젠레스 존 제로',/^(?:젠레스\s*존\s*제로|젠레스|젠존제)\s+/i],['명조',/^명조\s+/],['블루 아카이브',/^(?:블루\s*아카이브|블아)\s+/]];
const NEG_RE=/(?:하지|쓰지|부르지|말하지|붙이지)\s*(?:마|말아|않)|하지마|쓰지마|금지|그만\s*(?:해|써|불러)/;
const sameName=(a,b)=>String(a||'').replace(/[\s·.()]/g,'')===String(b||'').replace(/[\s·.()]/g,'');
const learnSplit=t=>String(t||'').split(/\n+|(?<=[.!?。])\s+/).map(x=>x.trim()).filter(x=>x.length>=2&&x.length<=220);
const isQuestion=t=>/\?\s*$/.test(t)||/(?:니|냐|나요|까|어때|뭐야|뭐해|누구야|맞지|그치|알아|아니)\s*[.!~ㅎㅋ]*$/.test(t);
const vocative=w=>w.length>=3?w.replace(/(?:야|아)$/,''):w;
// Korean puts 이야/이에요 after a final consonant and 야/예요 after a vowel: "지훈이야" is 지훈, "카이야" is 카이
const hasBatchim=ch=>{const c=String(ch||'').charCodeAt(0)-0xAC00;return c>=0&&c<11172&&c%28!==0;};
function stripCopula(w){
  w=String(w||'').replace(/[.!~,]+$/,'');let m;
  if((m=w.match(/^(.+?)(?:이야|이에요|이다|이라고|이고|이지)$/))&&hasBatchim(m[1].slice(-1)))return m[1];
  if((m=w.match(/^(.+?)(?:입니다|임)$/)))return m[1];
  if((m=w.match(/^(.+?)(?:야|예요|다|라고|고|지)$/))&&!hasBatchim(m[1].slice(-1)))return m[1];
  return w;
}
const unquote=s=>String(s||'').replace(/^[\s'"“”‘’「」『』]+|[\s'"“”‘’「」『』]+$/g,'');
function splitWork(s){
  const t=String(s||'').trim();
  for(const [w,re] of WORKS)if(re.test(t+' '))return {work:w,name:(t+' ').replace(re,'').trim()};
  const m=t.match(/^(.+?)\s*\((.+)\)$/);if(m)return {work:m[2].trim(),name:m[1].trim()}; // "라이오슬리 (원신)"
  return {work:'',name:t};
}
// the name in "…원신 라이오슬리의 말투를…": the last clause, without the words around the name
function subjectOf(raw){
  let t=unquote(String(raw||'').replace(/[「」『』"“”]/g,' ')).replace(/\s+/g,' ').trim();
  const parts=t.split(/(?:고|며|서|는데|인데|이고|하고|그리고|,)\s+/);t=parts[parts.length-1].trim();
  for(let i=0;i<5;i++)t=t.replace(/^(?:그럼|그러면|좋아|자|이제부터|지금부터|앞으로|이제|그리고|또|너는|넌|너|니가|네가|실제로|진짜로|진짜|완전히|완전|그냥|좀|제대로|다시|꼭|내|나의|우리|캐릭터|게임)\s+/,'');
  // "…라이오슬리의 말투", "라이오슬리가 된것": only the name
  t=t.replace(/\s*(?:(?:가|이)\s*된\s*(?:것|거))$/,'').replace(/\s*(?:의\s*)?(?:말투|말버릇|어투|화법|설정|성격|대사|캐릭터성|세계관)(?:를|을|도|만)?$/,'').trim();
  t=t.replace(/(?:의|을|를|이|가|은|는|와|과|랑|이랑|처럼|같이|로서|로써|으로|로)$/,'').trim();
  if(!t||t.length>24||NOT_NAME.test(t)||/[?!]/.test(t))return null;
  return splitWork(t);
}
const LEARN_CUES=[
  // "원신 라이오슬리의 말투를 학습하고", "라이오슬리 말투 제대로 학습해와", "OO 설정 가져와"
  /(.{1,40}?)\s*(?:의|이|가)?\s*(?:말투|말버릇|어투|화법|설정|성격|대사|캐릭터성|세계관)\s*(?:를|을|랑|이랑|와|과|도|만|까지|이나|나)?(?:\s*(?:제대로|다시|좀|자세히|완벽하게|똑같이|전부|다))*\s*(?:학습|배워|배우|익혀|익히|공부|알아\s*와|가져\s*와|조사|찾아|따라\s*해)/,
  // "실제로 라이오슬리가 된 것처럼 굴어"
  /(.{1,40}?)(?:가|이)\s*된\s*(?:것|거)\s*처럼/,
  // "라이오슬리처럼 말해"
  /(.{1,40}?)(?:처럼|같이)\s*(?:말해|말하|대답|굴어|굴|행동|연기)/,
  // "라이오슬리 학습해", "라이오슬리를 제대로 공부해 와"
  /^(.{1,40}?)\s*(?:를|을)?(?:\s*(?:제대로|다시|좀|완벽하게))*\s*(?:학습|공부)\s*(?:해|하|시켜)/,
  // "라이오슬리 말투로 말해", "라이오슬리 역할 해 줘", "라이오슬리에 대해 알아 와"
  /(.{1,40}?)\s*(?:의\s*)?(?:말투|어투|말버릇)로\s*(?:말해|말하|대답|얘기|이야기)/,
  /(.{1,40}?)\s*(?:역할|롤플(?:레이)?|연기|코스프레)\s*(?:를|을)?\s*(?:해|하)/,
  /(.{1,40}?)(?:에\s*대해(?:서)?|에\s*관해(?:서)?)\s*(?:학습|배워|공부|알아\s*와|조사|찾아)/,
];
// what one sentence means; {facts:[{key,value}], chars:[{name,work}]}
function readSentence(s){
  const facts=[],chars=[];const add=(k,v)=>{v=String(v||'').replace(/\s+/g,' ').trim();if(v&&v.length<=80)facts.push({key:k,value:v});};
  for(const re of LEARN_CUES){
    const m=s.match(re);const c=m&&subjectOf(m[1]);if(!c)continue;
    // the same character named twice in one sentence ("원신 라이오슬리…라이오슬리가 된 것처럼") is one
    const same=chars.find(x=>sameName(x.name,c.name));
    if(same){if(c.work&&!same.work)same.work=c.work;}else chars.push(c);
  }
  const remember=/기억\s*(?:해|하고|해\s*줘|해\s*둬|해둬|하자|할\s*게|해라|해\s*놔)|잊지\s*마|명심/.test(s);
  if(isQuestion(s)&&!remember)return {facts,chars};
  const neg=NEG_RE.test(s);let m;
  // relationship and name: "넌 이제부터 내 게이 남자친구인 라이오슬리야"
  if((m=s.match(new RegExp(`(?:^|\\s)${YOU_RE}\\s+(?:${WHEN_RE}\\s+)?(?:(?:내|나의)\\s*)?(.{1,30}?)(인|이자)\\s+(\\S{1,16})[.!~\\s]*$`)))&&REL_RE.test(m[1])&&stripCopula(m[3])!==m[3].replace(/[.!~,]+$/,'')){
    const nm=stripCopula(m[3]);
    if(REL_RE.test(' '+nm+' '))add('관계',`사용자의 ${m[1]}${m[2]} ${nm}`); // "내 남친이자 집사야"
    else{add('관계','사용자의 '+m[1]);if(!NOT_NAME.test(nm))add('이름',nm);}
  }else if((m=s.match(new RegExp(`(?:^|\\s)${YOU_RE}\\s+(${WHEN_RE}\\s+)?(?:(?:내|나의)\\s*)?(.{1,30})[.!~\\s]*$`)))&&stripCopula(m[2].trim())!==m[2].trim().replace(/[.!~,]+$/,'')){
    const v=stripCopula(m[2].trim());
    if(REL_RE.test(' '+v+' ')&&!/\d+\s*살|성격/.test(v))add('관계','사용자의 '+v);
    else if(m[1]&&/^\S{1,12}$/.test(v)&&!NOT_NAME.test(v)&&!/\d|살$/.test(v))add('이름',v);
  }
  if((m=s.match(/(?:^|\s)(?:너|네|니|너의|당신)\s*(?:의\s*)?이름\s*(?:은|는|이|가)\s*(?:이제\s*|앞으로\s*)?(\S{1,16}?)(?:\s*(?:으로|로)\s*해)?[.!~\s]*$/)))add('이름',unquote(stripCopula(m[1])));
  // what to call the user: "나를 자기라고 불러", "나 자기 말고 애기라고 불러줘"
  if((m=s.match(/말고\s+['"“‘]?([^'"”’\s]{1,12}?)['"”’]?\s*(?:이라고|라고)\s*(?:불러|부르)/))||(m=s.match(/(?:나를|날|나|저를|저)\s+(?:(?:앞으로|이제|이제부터|지금부터)\s+)?['"“‘]?([^'"”’\s]{1,12}?)['"”’]?\s*(?:이라고|라고)\s*(?:불러|부르)/))){
    const w=vocative(m[1]);
    if(neg&&!/말고/.test(s))add('규칙',`사용자를 '${w}'라고 부르지 않기`);else add('호칭',`사용자를 '${w}'라고 부름`);
  }
  // how to talk
  const ban=/반말/.test(s),jon=/존댓말|높임말|존대/.test(s);
  const how=[...s.matchAll(/([가-힣]{1,6}(?:하게|스럽게|롭게))\s*(?:말해|대답|대해|굴어|해\s*줘)/g)].map(x=>x[1]).filter(x=>!/짧게|길게|자세하게/.test(x));
  if(ban&&!jon)add('말투',(neg?'존댓말':'반말')+(how.length?', '+how.join(', '):''));
  else if(jon&&!ban)add('말투',(neg?'반말':'존댓말')+(how.length?', '+how.join(', '):''));
  else if(how.length&&/(?:앞으로|이제부터|항상|말해)/.test(s))add('말투',how.join(', '));
  if(/짧게|간단히|짧은\s*말/.test(s)&&!/길게|짧게\s*말하지\s*마/.test(s))add('답 길이','짧게');
  else if(/길게|자세히|장문/.test(s))add('답 길이',/짧게|하지\s*마/.test(s)&&!/짧게\s*말하지\s*마/.test(s)?'짧게':'길게, 자세히');
  if(/이모티콘|이모지/.test(s))add('이모티콘',neg||/없이|빼|빼고|안\s*써/.test(s)?'쓰지 않음':'자주 씀');
  if((m=s.match(/말\s*끝(?:에|마다)\s*['"“‘]?([^'"”’\s]{1,10}?)['"”’]?\s*(?:을|를)?\s*(?:붙여|넣어|써)/)))add('말버릇',`말끝에 '${m[1]}' 붙이기`);
  // about Glok
  if((m=s.match(new RegExp(`(?:^|\\s)${YOU_RE}\\s.*?(\\d{1,3})\\s*살`))))add('나이',m[1]+'살');
  if((m=s.match(/([가-힣A-Za-z]{1,12})\s*(?:를|을)\s*운영/)))add('직업',m[1]+' 운영');
  else if((m=s.match(/직업은\s*(.{1,15}?)(?:야|이야|이에요|예요|입니다|이다)?[.!~\s]*$/)))add('직업',m[1]);
  if((m=s.match(new RegExp(`(?:^|\\s)${YOU_RE}\\s+(?:(?:원래|이제|사실)\\s+)?(.{1,30}?)\\s*성격`)))&&!/^(?:무슨|어떤)/.test(m[1]))add('성격',m[1]+' 성격');
  // about the user
  if((m=s.match(/(?:^|\s)(?:내|제)\s*이름\s*(?:은|는|이)\s*(\S{1,16})[.!~\s]*$/)))add('사용자 이름',unquote(stripCopula(m[1])));
  if((m=s.match(/(?:^|\s)(?:내|제)\s*생일\s*(?:은|는|이)\s*(.{1,20}?)(?:야|이야|예요|이에요|입니다|이다|임)?[.!~\s]*$/)))add('사용자 생일',m[1]);
  if((m=s.match(/(?:^|\s)(?:나는|난|나|저는|전)\s+(.{1,20}?)\s*(?:를|을)?\s*(좋아해|싫어해|못\s*먹어|키워|키우고\s*있어|무서워해)/))){
    const v={'좋아해':'좋아함','싫어해':'싫어함','키워':'키움','키우고 있어':'키움','무서워해':'무서워함'}[m[2].replace(/\s+/g,' ')]||'못 먹음';
    add('사용자 정보',`${m[1]} ${v}`);
  }
  // "기억해, 우리 기념일은 3월 2일이야"
  if(remember&&!facts.length){
    const t=s.replace(/(?:꼭\s*)?(?:기억\s*(?:해|하고|해\s*줘|해\s*둬|해둬|하자|할\s*게|해라|해\s*놔)|잊지\s*마|명심\s*해?)/g,' ').replace(/^[\s,.:!~]+|[\s,.:!~]+$/g,'').replace(/\s+/g,' ').trim();
    if(t.length>=2)add('기억',t.replace(/(?:이야|야|이에요|예요|이다|입니다)$/,''));
  }
  // other standing instructions: "절대 나한테 훈계하지 마", "앞으로 아침마다 인사해 줘"
  if(!facts.length&&!chars.length&&(m=s.match(/(?:^|\s)(?:앞으로|이제부터|지금부터|절대|항상|매번|언제나)\s+(.{2,40}?)\s*(하지\s*마|하지마|말아|해\s*줘|해줘|하도록\s*해|해라|하기로\s*해|해)[.!~\s]*$/))){
    const what=m[1].replace(/(?:^|\s)(?:나한테|나에게|내게)\s/,' 사용자에게 ').trim();
    add('규칙',/하지\s*마|하지마|말아/.test(m[2])?`${what}하지 않기`:`${what}하기`);
  }
  return {facts,chars};
}
function interpret(text){
  const out={facts:[],chars:[]};
  for(const s of learnSplit(text)){const r=readSentence(s);out.facts.push(...r.facts);for(const c of r.chars)if(!out.chars.some(x=>x.name===c.name))out.chars.push(c);}
  return out;
}

// ---- what has been learned ----
function emptyLearn(){return {facts:[],chars:[]};}
// keeps what a sentence meant; characters to look up are marked and learned before the next reply
function absorb(L,r,again){
  const got={facts:[],chars:[]};
  for(const f of r.facts){
    if(FACT_ONE.has(f.key))L.facts=L.facts.filter(x=>x.key!==f.key);
    else L.facts=L.facts.filter(x=>!(x.key===f.key&&x.value===f.value));
    const it={id:uid(),key:f.key,value:f.value,at:Date.now()};L.facts.push(it);got.facts.push(it);
  }
  for(const c of r.chars){
    let ch=L.chars.find(x=>sameName(x.name,c.name));
    if(!ch){ch={id:uid(),name:c.name,work:c.work||'',title:c.name+(c.work?` (${c.work})`:''),who:'',personality:'',speech:'',lines:[],src:[],state:'pending',at:Date.now()};L.chars.push(ch);}
    else{if(c.work&&!ch.work){ch.work=c.work;ch.title=`${ch.name} (${c.work})`;}if(again||ch.state!=='ready')ch.state='pending';L.chars=L.chars.filter(x=>x!==ch).concat(ch);}
    got.chars.push(ch);
  }
  return got;
}
function loadLearn(){
  let v=null;try{v=JSON.parse(localStorage.getItem(LS_LEARN)||'null');}catch(e){}
  if(v&&Array.isArray(v.facts)&&Array.isArray(v.chars))return v;
  // the previous version kept the user's words as they were: they are read again for what they mean
  const L=emptyLearn();let old=[];try{old=JSON.parse(localStorage.getItem(LS_MEM)||'[]');}catch(e){}
  if(Array.isArray(old))for(const m of old)if(m&&typeof m.text==='string')absorb(L,interpret(m.text));
  return L;
}
let LRN=loadLearn();
function saveLearn(){try{localStorage.setItem(LS_LEARN,JSON.stringify(LRN));localStorage.removeItem(LS_MEM);}catch(e){}if(typeof renderLearn==='function')renderLearn();}
const readyChar=()=>LRN.chars.filter(c=>c.state==='ready').slice(-1)[0]||null;
const factList=()=>FACT_ORDER.flatMap(k=>LRN.facts.filter(f=>f.key===k));
function charBlock(c){
  return `[학습한 캐릭터: ${c.title}]\n지금 당신은 이 캐릭터 그 자체예요. 설정과 성격을 지키고, 대사 예시와 같은 말투로 말하세요. 예시를 그대로 되풀이하지는 마세요.`+
    (c.who?`\n정체: ${c.who}`:'')+(c.personality?`\n성격: ${c.personality}`:'')+(c.speech?`\n말투: ${c.speech}`:'')+
    (c.lines&&c.lines.length?'\n대사 예시:\n'+c.lines.map(l=>'- '+l).join('\n'):'');
}
function systemText(){
  const ch=readyChar(),facts=factList();
  if(!ch&&!facts.length)return CORE+' '+LEARN_EMPTY;
  const named=ch||facts.some(f=>f.key==='이름');
  return (named?'':'당신은 Glok이에요. ')+CORE_RULES+' '+LEARN_HEAD+(ch?'\n'+charBlock(ch):'')+
    (facts.length?'\n[사용자가 알려 준 것]\n'+facts.map(f=>`- ${f.key}: ${f.value}`).join('\n'):'');
}
// a casual reply is kept to two sentences unless the user taught Glok to talk at length
const wantsLong=()=>LRN.facts.some(f=>f.key==='답 길이'&&/길게/.test(f.value));
