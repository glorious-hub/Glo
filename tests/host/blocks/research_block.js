// ---------- learning a character from the web ----------
// Genshin Impact characters come from HoYoWiki, HoYoverse's own wiki: the profile, the story and the character's own
// Korean lines (the most faithful way to show a small model how he talks). Wikipedia adds the background; for other
// characters, web pages with their lines are read. The model then sums up who he is, his personality and how he talks.
const HOYO_API='https://sg-wiki-api-static.hoyolab.com/hoyowiki';
// Korean names of the Genshin Impact characters on HoYoWiki and their pages (2026-10-29), so most are found without a
// search; inside the app a name added later is searched on HoYoWiki itself
const GENSHIN_PAGES='발레리:11828,미탸:11827,보댜니차:11702,베스나:11661,여행자(얼음):11609,알료샤:11163,오데트:11162,산드로네:10920,프루네:10624,로엔:10623,니콜:10622,린네아:10412,바르카:9342,일루가:9123,자백:9122,콜롬비나:9121,별인형·여성:9021,별인형·남성:9020,야호다:9018,두린:9017,네페르:8894,플린스:8398,아이노:8397,라우마:8396,이네파:7852,달리아:7707,스커크:7706,이파:7627,에스코피에:7624,얀사:7502,바레사:7488,유메미즈키 미즈키:7420,여행자(불):7306,남연:7301,시틀라리:7300,마비카:7299,차스카:7080,올로룬:7079,실로닌:6924,말라니:6319,카치나:6318,키니치:6317,에밀리:5714,세토스:5598,시그윈:5597,클로린드:5596,아를레키노:5149,치오리:4946,가명:4775,한운:4774,슈브르즈:4577,나비아:4576,샤를로트:4377,푸리나:4376,느비예트:4023,라이오슬리:4022,여행자(물):3997,프레미네:3964,리니:3963,리넷:3962,키라라:3719,백출:3609,카베:3608,데히야:3463,미카:3462,알하이탐:3336,요요:3335,방랑자:2968,파루잔:2967,레일라:2859,나히다:2850,캔디스:2815,사이노:2813,닐루:2812,여행자(풀):2674,도리:2269,콜레이:2268,타이나리:2265,시카노인 헤이조:2263,쿠키 시노부:2256,야란:2252,소:51,향릉:50,라이덴 쇼군:49,레이저:48,알베도:47,종려:46,중운:45,디오나:44,다이루크:43,타르탈리아:42,신염:41,노엘:40,행추:39,피슬:38,모나:37,아라타키 이토:36,바바라:35,호두:34,로자리아:33,카미사토 아야카:32,카미사토 아야토:31,설탕:30,신학:29,감우:28,진:27,베넷:26,산고노미야 코코미:25,연비:24,벤티:23,카에데하라 카즈하:22,사유:21,여행자:20,여행자(바람):19,여행자(번개):18,여행자(바위):17,토마:16,요이미야:15,엠버:14,에일로이:13,클레:12,북두:11,각청:10,케이아:9,응광:8,야에 미코:7,유라:6,고로:5,운근:4,쿠죠 사라:3,리사:2,치치:1';
const genshinPages=()=>GENSHIN_PAGES.split(',').map(x=>{const i=x.lastIndexOf(':');return {name:x.slice(0,i),id:x.slice(i+1)};});
const nameKey=s=>String(s||'').replace(/[\s·.()\[\]「」]/g,'').toLowerCase();
// reads a page: the app fetches it itself, the browser goes through the reader (pages that don't allow other sites)
const natWebs=new Map();let natWebSeq=0;
function nativeGet(url,headers,ms,sig){
  return new Promise((res,rej)=>{
    const id=NAT.webGet(url,JSON.stringify(headers||{}),ms||20000);
    if(!(id>0)){rej(new Error('web'));return;}
    const onAbort=()=>{natWebs.delete(id);rej(abortErr());};
    if(sig){if(sig.aborted){onAbort();return;}sig.addEventListener('abort',onAbort,{once:true});}
    natWebs.set(id,e=>{natWebs.delete(id);if(sig)sig.removeEventListener('abort',onAbort);if(e.ok)res(e.text||'');else rej(new Error(e.error||('HTTP '+e.status)));});
  });
}
async function webGet(url,o={}){
  if(APP&&NAT&&typeof NAT.webGet==='function')return nativeGet(url,o.headers,o.ms,o.sig);
  const r=await fetch('https://r.jina.ai/'+url,{headers:{'X-Return-Format':'text'},signal:tsig(o.sig,o.ms||20000)});
  if(!r.ok)throw new Error('HTTP '+r.status);
  return r.text();
}
const readerGet=(url,sig)=>getText('https://r.jina.ai/'+url,{headers:{'X-Return-Format':'text'},signal:tsig(sig,15000)});
const jsonIn=t=>{const a=String(t||'').indexOf('{'),b=String(t||'').lastIndexOf('}');return JSON.parse(String(t).slice(a,b+1));};
async function hoyoFind(name,sig){
  const k=nameKey(name),pages=genshinPages();
  const exact=pages.find(p=>nameKey(p.name)===k);if(exact)return exact;
  // "카즈하" is 카에데하라 카즈하: a name that ends one character's full name and no other's
  if(k.length>=2){const part=pages.filter(p=>nameKey(p.name).endsWith(k)||nameKey(p.name).startsWith(k));if(part.length===1)return part[0];}
  if(!(APP&&NAT&&typeof NAT.webGet==='function'))return null;
  try{
    const j=jsonIn(await nativeGet(HOYO_API+'/genshin/wapi/search?keyword='+encodeURIComponent(name),{'x-rpc-language':'ko-kr','x-rpc-wiki_app':'genshin'},12000,sig));
    const hit=((j.data&&j.data.list)||[]).find(x=>nameKey(x.name)===k&&x.menu&&(String(x.menu.id)==='1'||(x.menu.sub_menus||[]).some(m=>String(m.id)==='2')));
    return hit?{name:hit.name,id:String(hit.entry_page_id)}:null;
  }catch(e){if(e&&e.name==='AbortError')throw e;return null;}
}
const htmlParas=h=>String(h||'').split(/<\/p>|<br\s*\/?>/i).map(p=>stripTags(p)).filter(Boolean);
// "호감도 Lv.4 달성 후 개방", "「…」 스토리 클리어": when a line unlocks in the game, not part of it
const UNLOCK_RE=/(?:달성\s*후\s*개방|스토리\s*클리어|임무\s*완료|완료\s*후\s*개방)$/;
function hoyoParse(j){
  const page=j&&j.data&&j.data.page;if(!page||!Array.isArray(page.modules))return null;
  const comps={};
  for(const m of page.modules)for(const c of m.components||[]){try{comps[c.component_id]=comps[c.component_id]||(typeof c.data==='string'?JSON.parse(c.data):c.data);}catch(e){}}
  const info={};for(const x of (comps.baseInfo&&comps.baseInfo.list)||[])info[x.key]=stripTags((x.value||[])[0]||'');
  const story=((comps.story&&comps.story.list)||[]).map(x=>({title:x.title,text:htmlParas(x.desc).filter(p=>!UNLOCK_RE.test(p)).join(' ')}));
  const voices=((comps.voice&&comps.voice.list)||[]).map(x=>({title:String(x.title||''),text:htmlParas(x.desc).filter(p=>!UNLOCK_RE.test(p)).join(' ')})).filter(v=>v.text);
  let intro='';
  for(const m of page.modules)if(/배경|background/i.test(m.name))for(const c of m.components||[]){try{const d=typeof c.data==='string'?JSON.parse(c.data):c.data;intro=intro||htmlParas(d&&d.data||'').join(' ');}catch(e){}}
  // "캐릭터 소개 <title> 2023/08/14 …": the text itself; of the desc only its first paragraph (a letter quoted follows)
  intro=intro.replace(/^\s*캐릭터 소개\s*/,'').replace(/^.{0,80}?\d{4}\/\d{1,2}\/\d{1,2}\s*/,'');
  const desc=(htmlParas(page.desc)[0]||'').trim();
  return {id:String(page.id),name:page.name,desc,info,story,voices,intro};
}
// lines that show how he talks with someone close: greetings, small talk, about himself, about the two of you
const LINE_BUCKETS=[/첫 만남/,/잡담/,/인사|굿나잇/,/본인에 대해|에 대해 알기/,/취미|고민|좋아하는 음식|하고 싶은 이야기|흥미/,/우리에 대해|돌파의 느낌·결|선물/];
const LINE_SKIP=/전투|원소|스킬|폭발|피격|파티 가입|보물상자|HP|불능|생일|돌파의 느낌·(?:기|승|전)/;
function cutLine(t,max){t=String(t||'').replace(/\s+/g,' ').trim();if(t.length<=max)return t;const c=t.slice(0,max);const i=Math.max(c.lastIndexOf('. '),c.lastIndexOf('? '),c.lastIndexOf('! '));return (i>max*0.4?c.slice(0,i+1):c.replace(/\s+\S*$/,'')+'…').trim();}
function pickLines(voices,name){
  const ok=voices.filter(v=>v.text.length>=10&&!LINE_SKIP.test(v.title)&&!(/에 대해/.test(v.title)&&!/본인|우리|자신|알기/.test(v.title)&&!v.title.includes(name)));
  const out=[];
  for(const b of LINE_BUCKETS){const v=ok.find(x=>b.test(x.title)&&!out.includes(x));if(v)out.push(v);}
  for(const v of ok){if(out.length>=6)break;if(!out.includes(v)&&v.text.length<=90)out.push(v);}
  return out.slice(0,6).map(v=>cutLine(v.text,110));
}
// the last word of a name is what titles and pages use most ("진격의 거인 리바이" → 리바이)
const nameCore=n=>String(n||'').trim().split(/\s+/).pop();
async function wikiLearn(name,work,sig){
  const base='https://ko.wikipedia.org/w/api.php?format=json&origin=*&utf8=1&';
  const s=await getJSON(base+'action=query&list=search&srlimit=5&srsearch='+encodeURIComponent((work?work+' ':'')+name),{signal:tsig(sig,8000)});
  const k=nameKey(nameCore(name));const hit=((s.query&&s.query.search)||[]).find(h=>nameKey(h.title).includes(k));
  if(!hit)return null;
  const ex=await getJSON(base+'action=query&prop=extracts&explaintext=1&redirects=1&titles='+encodeURIComponent(hit.title),{signal:tsig(sig,10000)});
  const p=Object.values((ex.query&&ex.query.pages)||{})[0];const text=String((p&&p.extract)||'');
  const intro=text.split(/\n\s*==/)[0].replace(/\s+/g,' ').trim();
  const sec=(text.match(/==+\s*(?:성격|특징|인물|캐릭터 디자인|캐릭터)\s*==+([\s\S]*?)(?:\n\s*==|$)/)||[])[1]||'';
  return {title:hit.title,url:'https://ko.wikipedia.org/wiki/'+encodeURIComponent(hit.title.replace(/ /g,'_')),intro:cutLine(intro,520),more:cutLine(sec.replace(/\s+/g,' '),360)};
}
// other characters: their lines quoted on web pages (「…」, “…”)
const WEB_SKIP=/namu\.wiki|x\.com|twitter\.com|youtube\.com|youtu\.be|instagram\.com|tiktok\.com|facebook\.com/;
async function webLines(name,work,sig){
  const res=(await webSearch((work?work+' ':'')+name+' 대사',sig)).filter(r=>!WEB_SKIP.test(r.url)).slice(0,2);
  const lines=[],src=[];
  for(const r of res){
    try{
      const t=String(await readerGet(r.url,sig));const who=nameCore(name);let n=0;
      // only lines said by him: his name shortly before the quote
      for(const m of t.matchAll(/[「“"]([^」”"\n]{8,120})[」”"]/g)){
        const q=m[1].trim(),before=t.slice(Math.max(0,m.index-90),m.index);
        if(/[가-힣]/.test(q)&&before.includes(who)&&!lines.includes(q)){lines.push(q);n++;}
      }
      if(n)src.push({title:r.title,url:r.url});
    }catch(e){if(e&&e.name==='AbortError')throw e;}
  }
  return {lines:lines.slice(0,6).map(l=>cutLine(l,110)),src};
}
// what the lines show when the model can't sum it up: 반말 or 존댓말, and how he calls himself
function speechOf(lines){
  const s=lines.join(' ');
  const jon=(s.match(/(?:요|니다|세요|죠)[.!?~…]*(?=\s|$)/g)||[]).length,all=(s.match(/[가-힣][.!?~…]*(?=\s|$)/g)||[]).length;
  const level=!all?'':jon*3<all?'반말':jon*3>all*2?'존댓말':'반말과 존댓말을 섞어 씀';
  const me=/(?:^|\s)(?:난|나는|내가|나도|내)\s/.test(' '+s+' ')?"자기를 '나'라고 함":/(?:^|\s)(?:저는|제가|저도|제)\s/.test(' '+s+' ')?"자기를 '저'라고 함":'';
  return [level,me].filter(Boolean).join(', ');
}
const DISTILL_SYS='당신은 캐릭터 자료를 읽고 정리하는 도우미예요. 자료에 있는 내용만 쓰고 지어내지 마세요.';
function distillPrompt(ch,mat){
  return `아래 자료를 읽고 「${ch.name}」${ch.work?`(${ch.work})`:''}를 연기할 수 있게 정리해 주세요. 다른 말 없이 아래 세 줄만 쓰세요.\n정체: (누구인지 한 문장)\n성격: (성격 한 문장)\n말투: (말하는 방식 한 문장. 반말인지 존댓말인지, 자주 쓰는 말끝과 표현)\n\n[자료]\n${mat}`;
}
function parseDistill(t){
  const get=k=>{const m=String(t||'').match(new RegExp(`(?:^|\\n)\\s*[-*]?\\s*\\**${k}\\**\\s*[:：]\\s*(.+)`));return m?m[1].replace(/\*\*/g,'').replace(/^\(|\)$/g,'').trim():'';};
  const ok=v=>v&&v.length>=4&&v.length<=170&&/[가-힣]/.test(v)&&!/한 문장|자료에|정리해/.test(v);
  const r={who:get('정체'),personality:get('성격'),speech:get('말투')};
  for(const k in r)if(!ok(r[k]))r[k]='';
  return r;
}
async function distillChar(ch,mat,sig){
  await ensureEngineReady();
  if(!loaded||!W)return {};
  let out='';
  await withEngine(()=>{
    if(sig&&sig.aborted)throw abortErr();
    if(!loaded||!W)return;
    wBusy=true;
    return W.createChatCompletion(chatReq({messages:sysFix([{role:'system',content:DISTILL_SYS},{role:'user',content:distillPrompt(ch,mat)}]),
      stream:true,abortSignal:sig,max_tokens:220,temperature:0.2,top_p:0.9,top_k:24,min_p:0.08,repeat_penalty:1.05,
      onData:c=>{const d=c&&c.choices&&c.choices[0]&&c.choices[0].delta&&c.choices[0].delta.content;if(d)out+=d;}}))
      .finally(()=>{wBusy=false;});
  });
  return parseDistill(stripThink(out));
}
// looks the character up and keeps what was learned on it; says how it is going through status()
async function learnChar(ch,sig,status){
  const label=ch.name;let hoyo=null,wk=null,web=null;const src=[];
  if(!ch.work||ch.work==='원신'){
    status(`${label} 학습 중 · 공식 위키(HoYoWiki)에서 찾는 중…`);
    const f=await hoyoFind(ch.name,sig);
    if(f){
      try{hoyo=hoyoParse(jsonIn(await webGet(`${HOYO_API}/genshin/wapi/entry_page?entry_page_id=${f.id}&lang=ko-kr`,{sig,ms:20000})));}catch(e){if(e&&e.name==='AbortError')throw e;}
      if(hoyo){ch.name=hoyo.name||ch.name;ch.work='원신';src.push({title:`HoYoWiki · ${ch.name}`,url:`https://wiki.hoyolab.com/pc/genshin/entry/${f.id}?lang=ko-kr`});}
    }
  }
  status(`${label} 학습 중 · 위키백과 읽는 중…`);
  try{wk=await wikiLearn(ch.name,ch.work,sig);if(wk)src.push({title:`위키백과 · ${wk.title}`,url:wk.url});}catch(e){if(e&&e.name==='AbortError')throw e;}
  let lines=hoyo?pickLines(hoyo.voices,ch.name):[];
  if(lines.length<3){
    status(`${label} 학습 중 · 웹에서 대사 찾는 중…`);
    try{web=await webLines(ch.name,ch.work,sig);lines=lines.concat(web.lines.filter(l=>!lines.includes(l))).slice(0,6);src.push(...web.src);}catch(e){if(e&&e.name==='AbortError')throw e;}
  }
  if(!hoyo&&!wk&&!lines.length)throw new Error('NOT_FOUND');
  const facts=[];
  if(hoyo){for(const k of ['호칭','소속','생일','신의 눈'])if(hoyo.info[k])facts.push(`${k}: ${hoyo.info[k]}`);}
  // about 1,300 characters: on a phone every extra line of reading costs seconds
  const mat=[`이름: ${ch.name}${ch.work?` (${ch.work})`:''}`,facts.join(' / '),
    hoyo&&hoyo.desc&&cutLine(hoyo.desc,120),hoyo&&hoyo.intro&&cutLine(hoyo.intro,260),
    hoyo&&hoyo.story[0]&&cutLine(hoyo.story[0].text,200),wk&&cutLine(wk.intro,hoyo?380:520),wk&&cutLine(wk.more,hoyo?200:360),
    lines.length?'대사:\n'+lines.map(l=>'- '+l).join('\n'):''].filter(Boolean).join('\n');
  status(`${label} 학습 중 · 성격과 말투 정리 중…`);
  let d={};try{d=await distillChar(ch,mat,sig);}catch(e){if(e&&e.name==='AbortError')throw e;}
  const firstSentence=t=>(String(t||'').match(/^.{8,160}?[.다]\s/)||[String(t||'').slice(0,140)])[0].trim();
  ch.title=ch.name+(ch.work?` (${ch.work})`:'');
  ch.who=d.who||(hoyo&&hoyo.desc?firstSentence(hoyo.desc+' '):'')||(wk?firstSentence(wk.intro+' '):'');
  ch.personality=d.personality||'';
  ch.speech=d.speech||speechOf(lines);
  // what was read stays with it, so the model can sum it up again later (when it wasn't loaded during the lookup)
  ch.lines=lines;ch.info=facts;ch.src=src;ch.mat=mat;ch.summed=!!(d.who||d.personality||d.speech);ch.state='ready';ch.err='';ch.at=Date.now();
  return ch;
}
