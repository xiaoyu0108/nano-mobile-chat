/* ============ Halo 全局状态 ============ */
const EMOJIS = ['❤️','😂','🔥','👏','😮','😭','👍','🎉'];

const S = {
  liveTags:[
    {name:'全部'},
    {name:'深夜聊天',desc:'深夜的陪伴、情绪、暧昧与私密话题，氛围亲密，可以大胆直白'},
    {name:'电影',desc:'电影、剧集、角色、结局与幕后讨论'},
    {name:'音乐',desc:'歌单、专辑、现场、耳机里的故事'},
    {name:'日常',desc:'日常琐碎、心情、生活分享与闲聊'},
    {name:'18+',desc:'成人向露骨板块：性、身体、情欲、重口玩梗，允许大胆直白（不写违法内容）'}
  ],
  groupTags:[{name:'电影'},{name:'音乐'},{name:'游戏'},{name:'创作'}],
  liveTopic:'全部',
  liveRooms:[], groups:[], mode:'single',
  currentRoom:null, currentGroup:null, chatFrom:'dmHome',
  dmTab:'friend',
  roomLog:[], audience:[], gifts:{},
  roomRecaps:{},
  interactedLives:[], myOwnLives:[], myGroups:[],
  micState:'idle', cohostPresent:false,
  hostCards:[], hostCardIndex:0,
  myReplays:[],
  liveQuote:null, chatQuote:null,
  chatLog:{},
  dmFriends:[], dmStrangers:[],
  dmPinned:[], dmDeleted:[],
  gallery:[],
  profileTab:'live',
  identity:{name:'我',handle:'@me',avatarLetter:'我',avatarImage:null,cover:null,setting:'',gender:'',maskId:null},
  aliases:[], activeAliasId:'main',
  collapsed:false,
  bgRefreshing:false,
  history:['liveHome'],
  _realChars:[],
  _worldbook:null,
  _apiReady:false,
  _apiModel:'',
  _mask:null,
  charMasks:[],
  dmBusy:{},
  groupBusy:{},
  _dmFriendsPersist:[],
  _dmStrangersPersist:[]
};

const DIVERSITY_NOTE='主播与观众群体要多元：可出现男主播、女主播、女观众、男观众，不同年龄/地区/身份，不要默认全是女性或同一种人。';
const GIFT_KINDS=[
  {name:'星星',value:1,svg:'<path d="M12 3l2.6 5.6 6.1.6-4.6 4 1.4 6-5.5-3.2L6.5 19l1.4-6-4.6-4 6.1-.6z"/>'},
  {name:'花束',value:9,svg:'<circle cx="12" cy="8" r="3"/><path d="M12 11v9"/><path d="M12 15c-2.6 0-4-1.6-4-3.6M12 18c2.6 0 4-1.6 4-3.6"/>'},
  {name:'月亮',value:29,svg:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'},
  {name:'爱心',value:5,svg:'<path d="M12 20s-7-4.4-9-8.8A4.6 4.6 0 0 1 12 8a4.6 4.6 0 0 1 9 3.2C19 15.6 12 20 12 20z"/>'},
  {name:'啤酒',value:19,svg:'<path d="M6 8h9v11H6z"/><path d="M15 10h2a2 2 0 0 1 0 5h-2"/>'},
  {name:'火箭',value:188,svg:'<path d="M5 15c3-8 9-11 14-11 0 5-3 11-11 14l-3-3z"/><path d="M9 19l-4 1 1-4"/>'},
  {name:'皇冠',value:99,svg:'<path d="M4 18h16l-1.5-9-4 3L12 6 9.5 12l-4-3z"/>'},
  {name:'钻戒',value:520,svg:'<circle cx="12" cy="15" r="5"/><path d="M9 6h6l2 4H7z"/>'}
];
function giftSvg(name){
  const g=(GIFT_KINDS||[]).find(x=>x.name===name);
  return g?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">'+g.svg+'</svg>':'';
}

const FOREIGN_CHARS = [];
const CN_AUDIENCE = [];
const CN_TEXTS = [];
const FRIEND_POOL = [];
const FAN_POOL = [];

function $(id){return document.getElementById(id)}
function nowHM(){const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}
function nowMin(){return Math.floor(Date.now()/60000)}
function rand(a){return a[Math.floor(Math.random()*a.length)]}
function rnd(n){return Math.floor(Math.random()*n)}
function sampleUnique(arr,n){return [...arr].sort(()=>Math.random()-.5).slice(0,n)}
function randomFans(n=8){return sampleUnique(FAN_POOL,n)}
function normalizeGroupFans(g){if(!g._randomizedFans){g.fans=randomFans(8+rnd(5));g.members=Math.max(g.members||1,g.fans.length+1);g._randomizedFans=true}}
function getFriendNames(){return (S.dmFriends||[]).map(x=>x.name)}
try{ if(window.NanoRefresh) window.NanoRefresh.define({ id:'halo', name:'Halo', url:'halo.html', title:'Halo' }); }catch(e){}

async function startBgRefresh(){
  if(S.bgRefreshing) return;
  const page=(document.querySelector('.page.active')||{}).id||'dmHome';
  if(page==='liveHome'){ openLiveRefreshSheet(); return; }
  if(page==='dmHome'){ openDMRefreshSheet(); return; }

  S.bgRefreshing=true;
  const bar=$('bgRefreshBar'),txt=$('bgRefreshText');
  bar.classList.add('show');txt.textContent='正在刷新…';
  try{
    let msg='';
    try{ if(window.NanoRefresh) NanoRefresh.start({ key:'halo', label:'刷新' }); }catch(e){}
    if(page==='liveRoom')       msg=await refreshRoomViaAI();
    else if(page==='groupHome') msg=await refreshGroupViaAI();
    else                        msg=await refreshDMViaAI();
    txt.textContent='刷新完成';
    showToast(msg||'刷新完成');
    try{ if(window.NanoRefresh) NanoRefresh.success(msg||'刷新完成', { key:'halo' }); }catch(e){}
  }catch(e){
    if(isAliasChanged(e)){ txt.textContent='已切换身份'; showToast('已切换身份，本次生成已丢弃'); }
    else { txt.textContent='刷新失败'; haloFail('刷新失败',e); try{ if(window.NanoRefresh) NanoRefresh.fail(e, { key:'halo' }); }catch(err){} }
  }finally{
    setTimeout(()=>{bar.classList.remove('show');S.bgRefreshing=false;},900);
  }
}

/* ---- 直播刷新：先选 char，再一次性生成 char + 3 个陌生人的直播（只刷新当前 tag） ---- */
function openLiveRefreshSheet(){
  let modal=$('haloLiveRefreshModal');
  if(!modal){
    modal=document.createElement('div');modal.className='modal';modal.id='haloLiveRefreshModal';
    modal.innerHTML='<div class="sheet"><div class="grab"></div><h2>刷新直播</h2><div class="muted small" style="padding:0 0 8px">选择要开播的角色（可多选），同时会生成 3 个陌生人的直播。只刷新当前话题「<b id="haloLiveRefreshTag"></b>」下的直播，其他话题不受影响。</div><div id="haloLiveRefreshList" style="max-height:44vh;overflow:auto;margin-bottom:8px"></div><button class="primary-wide" onclick="doLiveRefreshFromSheet()">生成直播</button><button class="secondary-wide" onclick="closeLiveRefreshSheet()">取消</button></div>';
    document.body.appendChild(modal);
  }
  if($('haloLiveRefreshTag')) $('haloLiveRefreshTag').textContent=S.liveTopic||'全部';
  renderLiveRefreshList();modal.classList.add('show');
}
let _liveRefreshSel={};
function renderLiveRefreshList(){
  const box=$('haloLiveRefreshList');if(!box)return;
  const chars=(S._realChars||[]);
  _liveRefreshSel={};
  box.innerHTML=chars.length?chars.map(c=>`<button class="sub-row" data-name="${esc(c.name)}" onclick="toggleLiveRefreshPick(this)">
      <div class="sub-av"${avStyle(c.avatar)}>${imgOk(c.avatar)?'':esc(c.avatarLetter||c.name.charAt(0))}</div>
      <div class="sub-info"><div class="sub-name">${esc(c.name)}</div><div class="sub-desc">${esc(c.desc||'角色')}</div></div>
      <span class="sub-go">选择</span></button>`).join(''):'<div class="muted small" style="text-align:center;padding:12px 0">角色库里还没有 char，将只生成陌生人直播。</div>';
}
function toggleLiveRefreshPick(el){
  const n=el.dataset.name;if(!n)return;
  if(_liveRefreshSel[n]){delete _liveRefreshSel[n];el.querySelector('.sub-go').textContent='选择';el.style.background='';}
  else{_liveRefreshSel[n]=true;el.querySelector('.sub-go').textContent='已选';el.style.background='var(--surface2)';}
}
function closeLiveRefreshSheet(){const m=$('haloLiveRefreshModal');if(m)m.classList.remove('show')}
async function doLiveRefreshFromSheet(){
  const names=Object.keys(_liveRefreshSel);
  closeLiveRefreshSheet();
  if(S.bgRefreshing) return;
  S.bgRefreshing=true;
  const bar=$('bgRefreshBar'),txt=$('bgRefreshText');
  bar.classList.add('show');txt.textContent='正在刷新…';
  try{ if(window.NanoRefresh) NanoRefresh.start({ key:'halo-live', label:'刷新直播' }); }catch(e){}
  try{ const msg=await refreshLiveViaAI(names); txt.textContent='刷新完成'; showToast(msg); try{ if(window.NanoRefresh) NanoRefresh.success(msg, { key:'halo-live' }); }catch(e){} }
  catch(e){ txt.textContent='刷新失败'; haloFail('刷新失败',e); try{ if(window.NanoRefresh) NanoRefresh.fail(e, { key:'halo-live' }); }catch(err){} }
  finally{ setTimeout(()=>{bar.classList.remove('show');S.bgRefreshing=false;},900); }
}
/* 私聊刷新：先选 char（可多选）；不选则只生成 6 条陌生人私信 */
function openDMRefreshSheet(){
  let modal=$('haloDMRefreshModal');
  if(!modal){
    modal=document.createElement('div');modal.className='modal';modal.id='haloDMRefreshModal';
    modal.innerHTML='<div class="sheet"><div class="grab"></div><h2>刷新私聊</h2><div class="muted small" style="padding:0 0 8px">选择要发消息的 char（可多选）：会为你选的 char + 4 位全新陌生人生成私信；不选则只生成 6 条陌生人私信。每次只调用一次 API。</div><div id="haloDMRefreshList" style="max-height:44vh;overflow:auto;margin-bottom:8px"></div><button class="primary-wide" onclick="doDMRefreshFromSheet()">生成私信</button><button class="secondary-wide" onclick="closeDMRefreshSheet()">取消</button></div>';
    document.body.appendChild(modal);
  }
  renderDMRefreshList();modal.classList.add('show');
}
let _dmRefreshSel={};
function renderDMRefreshList(){
  const box=$('haloDMRefreshList');if(!box)return;
  const list=(S.dmFriends||[]);
  _dmRefreshSel={};
  box.innerHTML=list.length?list.map(d=>`<button class="sub-row" data-name="${esc(d.name)}" onclick="toggleDMRefreshPick(this)">
      <div class="sub-av"${avStyle(d.avatar)}>${imgOk(d.avatar)?'':esc(d.avatarLetter||String(d.name).charAt(0))}</div>
      <div class="sub-info"><div class="sub-name">${esc(d.name)}</div><div class="sub-desc">${d.isStreamer?'主播':'char'}</div></div>
      <span class="sub-go">选择</span></button>`).join(''):'<div class="muted small" style="text-align:center;padding:12px 0">还没有好友 char，将只生成陌生人私信。</div>';
}
function toggleDMRefreshPick(el){
  const n=el.dataset.name;if(!n)return;
  if(_dmRefreshSel[n]){delete _dmRefreshSel[n];el.querySelector('.sub-go').textContent='选择';el.style.background='';}
  else{_dmRefreshSel[n]=true;el.querySelector('.sub-go').textContent='已选';el.style.background='var(--surface2)';}
}
function closeDMRefreshSheet(){const m=$('haloDMRefreshModal');if(m)m.classList.remove('show')}
async function doDMRefreshFromSheet(){
  const names=Object.keys(_dmRefreshSel);
  closeDMRefreshSheet();
  if(S.bgRefreshing) return;
  S.bgRefreshing=true;
  const bar=$('bgRefreshBar'),txt=$('bgRefreshText');
  bar.classList.add('show');txt.textContent='正在刷新…';
  try{ if(window.NanoRefresh) NanoRefresh.start({ key:'halo-dm', label:'刷新私信' }); }catch(e){}
  try{ const msg=await refreshDMViaAI(names); txt.textContent='刷新完成'; showToast(msg); try{ if(window.NanoRefresh) NanoRefresh.success(msg, { key:'halo-dm' }); }catch(e){} }
  catch(e){ txt.textContent='刷新失败'; haloFail('刷新失败',e); try{ if(window.NanoRefresh) NanoRefresh.fail(e, { key:'halo-dm' }); }catch(err){} }
  finally{ setTimeout(()=>{bar.classList.remove('show');S.bgRefreshing=false;},900); }
}
async function refreshLiveViaAI(selectedNames){
  if(!S._apiReady||typeof HaloData==='undefined') throw new Error('未配置主 API');
  const genAlias=S.activeAliasId;
  const scopeTags=(S.liveTopic==='全部')
    ? S.liveTags.filter(t=>t.name!=='全部')
    : S.liveTags.filter(t=>t.name===S.liveTopic);
  if(!scopeTags.length) scopeTags.push({name:'日常',desc:''});
  const scopeNames=scopeTags.map(t=>t.name);
  const chosen=(selectedNames||[]).map(n=>({name:n,char:charByName(n)})).filter(x=>x.name);
  const tagLines=scopeTags.map(t=>t.name+(tagDescOf(t.name)?('（'+tagDescOf(t.name)+'）'):'')).join('、');
  const sys='你在生成直播平台的直播房间，并为主播房间生成初始内容。\n'
    +'房间的标题/话题/简介必须严格贴合所给【板块描述】，不能跑题。\n'
    +'只输出 JSON：{"lives":[{"host":"主播名","title":"标题(8-16字)","topic":"话题","dual":true或false,"intro":"一句话简介","stranger":true或false,"cards":[{"who":"A","narration":"2-3句画面/动作描写","speech":"主播台词，简短"}],"barrage":[{"name":"观众网名","text":"弹幕"}]}]}。\n'
    +'话题必须从这些板块里选：'+tagLines+'。\n'
    +'每个房间都必须给出 cards（主播房间 1-2 条、陌生人房间 1 条）和 6-8 条弹幕，内容严格贴合该板块描述与房间简介；stranger 标记普通用户房间。\n'
    +'弹幕风向多元（夸奖/挑刺/粗俗/玩梗/提问），不要使用用户或主播的名字，也不要替用户发言。';
  let usr='';
  if(chosen.length) usr+='要为这些主播各生成一个房间（含初始卡片和弹幕）：'+chosen.map(x=>x.name+(x.char&&x.char.setting?('（人设：'+String(x.char.setting).slice(0,300)+'）'):'')).join('；')+'\n';
  usr+='再生成 3 个普通用户的房间（stranger=true）。';
  const obj=await HaloData.callMainJSON([{role:'system',content:sys},{role:'user',content:usr}],{temperature:1.05});
  const lives=Array.isArray(obj&&obj.lives)?obj.lives:[];
  if(!lives.length) throw new Error('AI 没有返回直播内容');
  assertSameAlias(genAlias);
  // 只清理当前 tag 范围内旧的“生成”直播，其他 tag 不受影响
  S.liveRooms=(S.liveRooms||[]).filter(r=>!(r.gen&&scopeNames.indexOf(r.topic)>-1));
  let count=0;
  lives.forEach((L,i)=>{
    const host=String(L&&L.host||'').slice(0,20); if(!host) return;
    const c=charByName(host);
    const stranger=!!(L.stranger)&&!c;
    const topic=scopeNames.indexOf(String(L.topic))>-1?String(L.topic):scopeNames[i%scopeNames.length];
    const cards=(Array.isArray(L&&L.cards)?L.cards:[]).map(cc=>({who:String((cc&&cc.who)||'A').slice(0,2),narration:String((cc&&cc.narration)||'').trim(),speech:String((cc&&cc.speech)||'').trim()})).filter(cc=>cc.narration||cc.speech);
    const banned=[host,currentIdentity().name].filter(Boolean);
    const barrage=(Array.isArray(L&&L.barrage)?L.barrage:[]).map(b=>({name:String((b&&b.name)||'').slice(0,20),text:String((b&&b.text)||'').trim()})).filter(b=>b.text&&banned.indexOf(b.name)<0).map(b=>({name:b.name||rand(CN_AUDIENCE)||'',text:b.text}));
    S.liveRooms.unshift({
      id:Date.now()+i,title:String(L.title||'随便聊聊').slice(0,30),topic,
      desc:String(L.intro||'').slice(0,120),
      viewers:String(stranger?(30+Math.floor(Math.random()*600)):(200+Math.floor(Math.random()*3000))),
      dual:!!L.dual,hostName:host,hostAvatar:host.charAt(0),hostAvatarImage:c?c.avatar:null,gen:true,stranger,
      cards,barrage
    });
    count++;
  });
  if(!count) throw new Error('AI 返回的直播无法解析');
  // 若当前正有直播间（含小窗），同步刷新它的内页内容，仍只用了这一次 API
  if(S.currentRoom){
    const fresh=(S.liveRooms||[]).find(r=>r.gen&&(String(r.id)===String(S.currentRoom.id)||r.hostName===S.currentRoom.hostName));
    if(fresh){
      S.currentRoom=fresh;
      if(Array.isArray(fresh.cards)&&fresh.cards.length) S.hostCards=fresh.cards.slice();
      if(Array.isArray(fresh.barrage)&&fresh.barrage.length){
        S.audience=fresh.barrage.slice();
        const bb=$('barrageBox');
        if(bb&&document.getElementById('liveRoom').classList.contains('active')){bb.innerHTML='';renderRoom();}
      }
    }
  }
  saveHaloState();renderLive();
  return '刷新完成，新增 '+count+' 个直播（已含初始卡片/弹幕）';
}
async function refreshRoomViaAI(){
  if(!S.currentRoom) throw new Error('当前不在直播间');
  await refreshRoom();
  return '直播内容已刷新（主播卡片 + 弹幕）';
}

/* ---- 私聊页：一次 API，所选 char + 4 陌生人或 6 陌生人（读取我的马甲人设） ---- */
async function refreshDMViaAI(selectedNames){
  if(!S._apiReady||typeof HaloData==='undefined') throw new Error('未配置主 API');
  const genAlias=S.activeAliasId;
  const chosenNames=(selectedNames||[]).filter(Boolean);
  const friends=chosenNames.length
    ? chosenNames.map(n=>dmMeta(n)).filter(Boolean)
    : [];
  const strangerCount=chosenNames.length?4:6;
  const me=currentIdentity();
  const mySetting=currentUserSetting();
  const contacts=friends.map(t=>{
    const c=charByName(t.name);
    const note=t.setting?('（人设：'+String(t.setting).slice(0,300)+'）'):(c&&c.setting?('（人设：'+String(c.setting).slice(0,300)+'）'):'');
    const log=(S.chatLog[t.name]||[]).slice(-8).map(m=>`${m.who==='user'?'用户':t.name}：${m.text||m.foreign||''}`).join('\n')||'（还没有聊天记录）';
    return '【'+t.name+'】'+note+'\n最近记录：\n'+log;
  }).join('\n\n');
  const aliasNote=(S.activeAliasId&&S.activeAliasId!=='main')
    ? ('\n【用户身份】用户现在用的是小号「'+me.name+'」，人设：'+(mySetting||'无')+'，个签：'+(me.signature||'无')+'。所有收件人都【不认识】TA，不允许说认识TA、不允许提起其他身份；他们的消息必须明显是针对这个新身份（'+me.name+'）来的。')
    : ('\n【用户身份】用户的人设：'+(mySetting||'无')+'，个签：'+(me.signature||'无')+'。消息要贴合这个人的身份与兴趣。');
  const sys='你在模拟一个社交 App 的私信刷新。硬性要求：\n'
    +(friends.length?'1) 为下面每个已有联系人生成 1-2 条新消息（像真人连发几条短句，每条单独一行），语气必须严格符合他的人设。若某个 char 的人设决定TA此刻不会主动发消息，可以跳过该联系人，在 JSON 里给该条 "skip":true。\n':'')
    +'2) 创造 '+strangerCount+' 位【全新】的陌生人（中文网名，绝不能与已有联系人重名），为每人写一段 30-80 字的【马甲人设】（身份、性格、为什么会来找用户），并各生成 1-2 条与【用户身份】强相关、与马甲人设完全一致的开场私信，不要写空泛套话。\n'
    +'3) 【仅偶尔】大多数刷新都不要安排小号。只有当个别 char 的人设适合偷偷摸摸、且大约三成概率时，才让最多 1 位新陌生人其实是某个已有 char 的「小号/马甲」，用来在陌生人里伪装试探用户；若这样请加 "maskOf":"该 char 的名字"，表面人设写在 persona 里。小号通常绝不会主动暴露真实身份，也不要每轮都出现。\n'
    +'3.5) 支持陌生人【主动】加用户好友/微信：不必等用户开口，自然时可以主动提出（例如“加个微信吧/我加你了”），并在该消息末尾加 [加好友]（系统会向用户发起好友申请，用户在 Meet 同意后即可私聊）；偶尔出现即可。\n'
    +'4) 最多让 1 位已有联系人（好友/主播）邀请用户去看一场TA感兴趣的直播：在该联系人条目加 "liveInvite":{"title":"标题","topic":"话题","intro":"一句简介","card":{"narration":"2-3句画面描写","speech":"主播台词"},"barrage":[{"name":"观众网名","text":"弹幕"}]}；话题要与这个人设相关，弹幕 6-10 条。其他联系人不要带 liveInvite。\n'
    +DIVERSITY_NOTE+'\n'
    +aliasNote
    +'\n只输出 JSON：{"messages":[{"name":"联系人名","persona":"仅新陌生人需要，旧联系人可空","texts":["消息1","消息2"],"isNew":true或false,"skip":true或false,"maskOf":"可选，仅当此新陌生人是某 char 的小号时填该 char 名字","liveInvite":"可选，仅限 1 位已有联系人"}]}。已有联系人的 name 必须完全一致。';
  const obj=await HaloData.callMainJSON([{role:'system',content:sys},{role:'user',content:contacts||('（没有已选联系人，只需要创造 '+strangerCount+' 位全新陌生人）')}],{temperature:1.0});
  const arr=(obj&&Array.isArray(obj.messages))?obj.messages:[];
  if(!arr.length) throw new Error('AI 没有返回消息内容');
  assertSameAlias(genAlias);
  // 每次刷新都换成全新陌生人：清掉旧普通陌生人（保留角色马甲），并删除其聊天记录
  (S.dmStrangers||[]).filter(x=>x&&!x.isCharMask).forEach(x=>{delete S.chatLog[x.name];});
  S.dmStrangers=(S.dmStrangers||[]).filter(x=>x&&x.isCharMask);
  let count=0;let inviteUsed=false;
  arr.forEach(item=>{
    if(item&&item.skip) return;
    const nm=String(item&&item.name||'').trim();
    if(!nm) return;
    let t=(S.dmFriends||[]).find(x=>x.name===nm)||(S.dmStrangers||[]).find(x=>x.name===nm);
    if(!t){
      t={name:nm,prev:'',time:'刚刚',unread:true,avatarLetter:nm.charAt(0),isCharMask:false,persona:String(item.persona||'').trim()};
      if(!S.chatLog[nm]) S.chatLog[nm]=[];
      S.dmStrangers.push(t);
      // char 的小号（马甲）试探：链接到原 char，后续回复走马甲逻辑，可被识破
      const ownerName=String(item.maskOf||'').trim();
      const owner=ownerName?(charByName(ownerName)||(S._realChars||[]).find(c=>c.name===ownerName)):null;
      const probingCount=(S.charMasks||[]).filter(mk=>mk&&mk.status==='probing').length;
      if(owner&&probingCount<2&&Math.random()<0.5){
        const maskId='cm_'+Date.now()+'_'+rnd(999);
        S.charMasks=(S.charMasks||[]);
        S.charMasks.push({id:maskId,charId:owner.id,charName:owner.name,charAvatar:owner.avatar||null,
          alias:{name:nm,handle:'@'+String(nm).toLowerCase(),avatarLetter:String(nm).charAt(0).toUpperCase(),avatarImage:null},
          setting:String(item.persona||'').trim(),motive:'想试探用户是否认得出自己',createdAt:Date.now(),status:'probing',revealedAs:null});
        t.isCharMask=true;t.maskId=maskId;t.maskOwner=owner.name;
      }
    }
    const texts=Array.isArray(item.texts)?item.texts:[item.text];
    texts.map(x=>String(x==null?'':x).trim()).filter(Boolean).forEach(tx=>{ count+=pushSplitChat(nm,'member',tx,nm); });
    const m=dmMeta(nm); const log=S.chatLog[nm]||[]; const last=log[log.length-1];
    if(m&&last){m.prev=last.text||last.foreign||m.prev;m.time='刚刚';m.unread=true;m.at=nowMin();}
    // 好友/char 邀请我观看 TA 感兴趣的直播（沿用本次 API 结果，不再额外调用）
    if(!inviteUsed && item.liveInvite && (S.dmFriends||[]).some(x=>x.name===nm)){
      const li=item.liveInvite||{};
      const cards=[li.card?{who:'A',narration:String(li.card.narration||'').trim(),speech:String(li.card.speech||'').trim()}:null].filter(x=>x&&(x.narration||x.speech));
      const barrage=(Array.isArray(li.barrage)?li.barrage:[]).map(b=>({name:String(b&&b.name||'').slice(0,20),text:String(b&&b.text||'').trim()})).filter(b=>b.text);
      if(cards.length||barrage.length){
        const tagNames=S.liveTags.filter(t=>t.name!=='全部').map(t=>t.name);
        const topic=tagNames.indexOf(String(li.topic))>-1?String(li.topic):(tagNames[0]||'日常');
        const meta2=dmMeta(nm)||{};
        const room={id:Date.now()+Math.floor(Math.random()*1000),title:String(li.title||(nm+' 想看的直播')).slice(0,30),topic,
          desc:String(li.intro||'').slice(0,120),viewers:String(100+Math.floor(Math.random()*1500)),dual:false,
          hostName:nm,hostAvatar:String(nm).charAt(0),hostAvatarImage:meta2.avatar||null,gen:true,cards,barrage};
        S.liveRooms.unshift(room);
        const lg=S.chatLog[nm]||(S.chatLog[nm]=[]);
        lg.push({kind:'share',status:'pending',who:'other',name:nm,text:nm+' 邀请你去看这场直播：「'+room.title+'」',
          share:{id:room.id,title:room.title,topic:room.topic,host:nm,desc:room.desc,cards:cards.slice(0,2),audience:barrage.slice(0,6),sharedAt:Date.now()},
          roomId:room.id,time:nowHM(),at:nowMin()});
        if(meta2){meta2.prev='邀请你看直播：'+room.title;meta2.time='刚刚';meta2.unread=true;meta2.at=nowMin();}
        inviteUsed=true;
      }
    }
  });
  if(!count) throw new Error('AI 返回的消息无法匹配到任何联系人');
  saveHaloState();renderDM();
  if(S.currentGroup&&S.currentGroup.isDM&&S.chatLog[S.currentGroup.name]) renderChat();
  return '刷新完成，'+count+' 条新消息（含全新陌生人）';
}

/* ---- 群聊页：一次 API 刷新群聊 ---- */
async function refreshGroupViaAI(){
  const groups=(S.groups||[]).slice(0,6);
  if(!groups.length) throw new Error('还没有群聊，先在群聊页创建一个群');
  return await generateGroupMessages(groups);
}
async function generateGroupMessages(groups){
  const list=(groups||[]).filter(Boolean);
  if(!list.length) throw new Error('没有可刷新的群聊');
  if(!S._apiReady||typeof HaloData==='undefined') throw new Error('未配置主 API');
  const genAlias=S.activeAliasId;
  const blocks=list.map(g=>{
    normalizeGroupFans(g);
    const anti=['阴阳怪气','键盘侠','带节奏的','路人黑'];
    const memberPool=[...new Set([...(g.admins||[]).filter(a=>charByName(a)),...(g.fans||[]),anti[0],anti[1]])].slice(0,12);
    g._memberPool=memberPool;
    const log=(S.chatLog[g.name]||[]).slice(-16).map(m=>`${m.who==='user'?'用户':(m.name||'成员')}：${m.text||m.foreign||''}`).join('\n')||'（还没有聊天记录）';
    const userDir=(S.chatLog[g.name]||[]).filter(m=>m.who==='user').slice(-3).map(m=>m.text||'').filter(Boolean).join(' / ')||'（用户还没发言）';
    const charNote=(g.admins||[]).map(a=>charByName(a)).filter(Boolean).slice(0,2).map(c=>`${c.name}的人设：${String(c.setting||'').slice(0,200)}`).join('；');
    const adminChars=(g.admins||[]).map(a=>charByName(a)).filter(Boolean).map(c=>c.name);
    return `【群：${g.name}】\n群简介：${g.desc||'（无简介）'}\n话题标签：${g.topic||''}\n管理员（只有这些人是管理员）：${adminChars.join('、')||'（无，禁止任何人自称管理员/群主）'}\n成员：${memberPool.join('、')}\n用户个签：${currentIdentity().signature||'无'}\n${charNote?'（'+charNote+'）\n':''}用户最近发言方向：${userDir}\n最近聊天：\n${log}`;
  }).join('\n\n');
  const aliasNote=(S.activeAliasId&&S.activeAliasId!=='main')
    ? ('\n※ 用户现在用的是新身份「'+currentIdentity().name+'」，群成员都不认识TA，请像对待一个新成员一样，不要称呼TA旧名字、不要说认识TA。')
    : '';
  const sys='你在模拟一个社交 App 的群聊。硬性要求：\n1) 每个群的聊天必须围绕该群的【群简介】和【用户最近发言方向】展开，严禁跑题、严禁聊与该群无关的内容。\n2) 成员多元：有喜欢/支持用户的粉丝，也有黑粉（挑刺、阴阳怪气、带节奏、唱反调），以及路人；性别身份也要多样（男女都有）。黑粉的名字用成员列表里的“阴阳怪气/键盘侠”等。\n3) 为下列每个群各生成【至少 10 条】新消息，由不同成员交替发言，像真人群聊，简短、每条单独一行。\n4) 【管理员】管理员是群主手动设置的，只有每个群【管理员】列表里的人才是管理员。列表为空时本轮不要出现任何管理员相关发言，也禁止任何人自称管理/群主；列表非空时，管理员本轮至少发言一次、语气更有分量，其他成员会提及或回应其管理身份。列表外的人一律不得自称、也不得被当成管理员。\n5) 角色人设与身份要立体，不要每轮同一个腔调。'+DIVERSITY_NOTE+aliasNote+'\n只输出 JSON：{"groups":[{"group":"群名","msgs":[{"name":"成员名","text":"消息"}]}]}。成员名必须是该群给出的成员之一，群名必须完全一致。';
  const obj=await HaloData.callMainJSON([{role:'system',content:sys},{role:'user',content:blocks}],{temperature:1.0});
  const arr=(obj&&Array.isArray(obj.groups))?obj.groups:[];
  if(!arr.length) throw new Error('AI 没有返回群消息内容');
  assertSameAlias(genAlias);
  let count=0;
  arr.forEach(item=>{
    const g=list.find(x=>x.name===item.group)||list.find(x=>x.name===String(item&&item.group||'').trim());
    if(!g) return;
    const memberPool=g._memberPool||[];
    (Array.isArray(item.msgs)?item.msgs:[]).forEach(m=>{
      const tx=String(m&&m.text||'').trim(); if(!tx) return;
      let sp=String(m&&m.name||'').trim();
      if(memberPool.length&&memberPool.indexOf(sp)<0) sp=rand(memberPool);
      if(!sp) sp=rand(memberPool)||'成员';
      count+=pushSplitChat(g.name,'member',tx,sp);
    });
    const log=S.chatLog[g.name]||[]; const last=log[log.length-1];
    if(last){g.last=last.text||last.foreign||g.last;g.time='刚刚';g.unread=(g.unread||0)+1;}
    delete g._memberPool;
  });
  if(!count) throw new Error('AI 返回的群消息无法匹配到任何群');
  saveHaloState();renderGroupList();
  if(S.currentGroup&&list.some(x=>x.name===S.currentGroup.name)) renderChat();
  return '刷新完成，'+count+' 条群消息';
}
async function groupReply(name){
  if(S.groupBusy&&S.groupBusy[name]) return;
  S.groupBusy=S.groupBusy||{};S.groupBusy[name]=true;
  renderChat();
  try{
    const g=(S.groups||[]).find(x=>x.name===name);
    if(!S.chatLog[name]) S.chatLog[name]=[];
    await generateGroupMessages(g?[g]:[]);
    try{
      const last=(S.chatLog[name]||[]).slice(-1)[0]||{};
      if(window.NanoNotify) NanoNotify.notify(name||'群聊', last.text||last.foreign||'新的群消息', { target:'halo', channel:'halo' });
    }catch(e){}
  }catch(e){
    haloFail('群聊回复失败',e);
  }finally{
    S.groupBusy[name]=false;
    if(S.currentGroup&&S.currentGroup.name===name) renderChat();
  }
}

/* ============ 加入其他人的粉丝群 ============ */
let _discoverGroups=[];
async function openDiscoverGroups(){
  let modal=$('haloDiscoverGroupsModal');
  if(!modal){
    modal=document.createElement('div');modal.className='modal';modal.id='haloDiscoverGroupsModal';
    modal.innerHTML='<div class="sheet"><div class="grab"></div><h2>加入粉丝群</h2><div id="haloDiscoverGroupsList" style="max-height:50vh;overflow:auto;margin-bottom:8px"></div><button class="secondary-wide" onclick="closeDiscoverGroups()">关闭</button></div>';
    document.body.appendChild(modal);
  }
  const box=$('haloDiscoverGroupsList');
  if(box) box.innerHTML='<div class="muted small" style="text-align:center;padding:16px 0">正在为你寻找群聊…</div>';
  modal.classList.add('show');
  try{ _discoverGroups=await fetchDiscoverGroups(); renderDiscoverGroups(); }
  catch(e){ if(box) box.innerHTML='<div class="muted small" style="text-align:center;padding:16px 0">获取失败，请重试</div>'; haloFail('获取群聊失败',e); }
}
function closeDiscoverGroups(){const m=$('haloDiscoverGroupsModal');if(m)m.classList.remove('show')}
async function fetchDiscoverGroups(){
  if(!S._apiReady||typeof HaloData==='undefined') throw new Error('未配置主 API');
  const joined=(S.groups||[]).map(g=>g.name);
  const chars=(S._realChars||[]).slice(0,6).map(c=>c.name);
  const sys='你在生成一个粉丝群广场。生成 4 个可以被加入的粉丝群。只输出 JSON：{"groups":[{"name":"群名","topic":"话题","desc":"群简介(一句)","members":数字,"owner":"群主/明星的名字"}]}。群名要有趣、像真实粉丝群。';
  const usr='已加入的群（不要重复）：'+(joined.join('、')||'无')+'。可用的角色/明星：'+(chars.join('、')||'无')+'。话题可选：'+S.groupTags.map(t=>t.name).join('、')+'。';
  const obj=await HaloData.callMainJSON([{role:'system',content:sys},{role:'user',content:usr}],{temperature:1.0});
  const arr=(obj&&Array.isArray(obj.groups))?obj.groups:[];
  const list=arr.filter(g=>g&&String(g.name||'').trim()&&joined.indexOf(String(g.name).trim())<0).slice(0,4);
  if(!list.length) throw new Error('AI 没有返回可加入的群聊');
  return list;
}
function renderDiscoverGroups(){
  const box=$('haloDiscoverGroupsList');if(!box)return;
  if(!_discoverGroups.length){box.innerHTML='<div class="muted small" style="text-align:center;padding:16px 0">暂时没有可加入的群聊。</div>';return;}
  box.innerHTML=_discoverGroups.map((g,i)=>`
    <div class="sub-row" style="cursor:default">
      <div class="sub-av">${esc(String(g.name||'群').charAt(0))}</div>
      <div class="sub-info"><div class="sub-name">${esc(String(g.name||'群'))}</div><div class="sub-desc">${esc(String(g.desc||''))} · ${Number(g.members)||0} 成员 · 群主 ${esc(String(g.owner||'未知'))}</div></div>
      <button style="flex:none;padding:7px 12px;border-radius:999px;background:var(--surface2);color:var(--text);font-size:11px;font-weight:700" onclick="joinDiscoveredGroup(${i})">加入</button>
    </div>`).join('');
}
function joinDiscoveredGroup(i){
  const g=_discoverGroups[i];if(!g)return;
  const name=String(g.name||'').trim();if(!name)return;
  if((S.groups||[]).some(x=>x.name===name)){showToast('已经加入过了');return;}
  const fans=randomFans(8+rnd(6));
  const group={id:Date.now(),name,desc:String(g.desc||'一个粉丝群。'),topic:String(g.topic||'创作'),
    members:Number(g.members)||(fans.length+1),joined:true,last:'你加入了群聊',time:'刚刚',unread:0,
    admins:[currentIdentity().name||'我'],fans,foreign:sampleUnique(FOREIGN_CHARS,3),_randomizedFans:true};
  S.groups.unshift(group);
  S.myGroups.unshift({name,members:group.members,admin:(group.admins[0]||'—'),last:'你加入了群聊',time:'刚刚',unread:0});
  S.chatLog[name]=[{who:'system',name:'System',text:'你加入了群聊「'+name+'」',time:nowHM(),at:nowMin()}];
  saveHaloState();renderGroupList();renderMine();
  closeDiscoverGroups();showToast('已加入 '+name);
}

/* ============ 私聊设置（独立页面） ============ */
// 把「我的微信号」（取自人设 Mask）告诉陌生人/联系人 → 对方发来 Meet 好友申请
function giveWechatHalo(name){
  if(!name)return;
  let owner='';
  try{ const md=JSON.parse(localStorage.getItem('nano_mask_data')||localStorage.getItem('nano_home_data')||'null'); if(md&&md.currentMaskId!=null) owner=String(md.currentMaskId); }catch(e){}
  let wx='';
  try{
    const md2=JSON.parse(localStorage.getItem('nano_mask_data')||localStorage.getItem('nano_home_data')||'null');
    if(md2&&Array.isArray(md2.masks)){ const me=md2.masks.find(x=>String(x.id)===owner); if(me&&me.wechat&&me.wechat!=='未设置') wx=me.wechat; }
  }catch(e){}
  if(!wx){ showToast('请先在「人设(Mask)」里设置你的微信号'); return; }
  const meta=dmMeta(name)||{};
  let all=[]; try{ all=JSON.parse(localStorage.getItem('nano_friend_requests')||'[]')||[]; }catch(e){}
  if(all.some(x=>x&&x.status==='pending'&&x.source==='halo'&&x.name===name)){ showToast('已经把微信号告诉过 TA 了'); return; }
  all.push({ id:'fr_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6), owner:owner, name:name, avatar:meta.avatar||'', source:'halo', app:'halo', setting:String(meta.persona||meta.setting||''), requestNote:'通过微信号加你', ts:Date.now(), status:'pending' });
  try{ localStorage.setItem('nano_friend_requests', JSON.stringify(all.slice(-400))); }catch(e){}
  showToast('已把微信号告诉 TA，TA 会来加你（去 Meet 同意）');
  try{ if(window.parent&&window.parent!==window) window.parent.postMessage({type:'homeDataUpdated'},'*'); }catch(e){}
}

function openDmSettings(name){
  if(!name)return;
  S._dmSettingsName=name;
  const pg=document.getElementById('dmSettings');if(pg)pg.dataset.name=name;
  if(S.history[S.history.length-1]!=='dmSettings') S.history.push('dmSettings');
  openPage('dmSettings',false);
}
function closeDmSettings(){
  if(document.getElementById('dmSettings')&&document.getElementById('dmSettings').classList.contains('active')) goBack();
}
function renderDmSettings(){
  const pg=document.getElementById('dmSettings');
  const name=(pg&&pg.dataset.name)||S._dmSettingsName;
  S._dmSettingsName=name;
  const box=$('dmSettingsBody');if(!box)return;
  if(!name){box.innerHTML='<div class="mine-empty">没有打开的会话</div>';return;}
  const meta=dmMeta(name)||{};
  const char=charByName(name);
  const isStranger=(S.dmStrangers||[]).some(x=>x.name===name);
  const isStreamer=!!meta.isStreamer;
  const av=meta.avatar;
  $('dmSettingsName').textContent=name;
  box.innerHTML=`
    <div class="dm-set-av-wrap">
      <div class="dm-set-av"${avStyle(av)}>${imgOk(av)?'':esc(meta.avatarLetter||String(name).charAt(0))}</div>
      <div class="dm-set-av-actions">
        <button class="pillmini" onclick="openGalleryPicker('${esc(name)}')">从图库选</button>
        <button class="pillmini" onclick="dmSetAvatarFile()">上传图片</button>
        <button class="pillmini" onclick="letContactPickAvatar('${esc(name)}')">让ta自己选</button>
      </div>
    </div>
    <div class="settings-item"><div><div class="label">昵称</div><div class="desc">${esc(name)}</div></div><button class="pill-action" onclick="editDmProfile()">修改</button></div>
    <div class="settings-item"><div><div class="label">人设</div><div class="desc">${esc(String(meta.persona||meta.setting||(char&&char.setting)||'（无）').slice(0,80))}</div></div><button class="pill-action" onclick="editDmProfile()">修改</button></div>
    ${isStranger?'<button class="secondary-wide" style="margin-top:10px" onclick="saveStrangerAsFriend()">存为好友</button>':''}
    ${isStranger?`<button class="secondary-wide" style="margin-top:10px;color:var(--accent)" onclick="giveWechatHalo('${esc(name)}')">把微信号告诉 TA（TA 会来加你）</button>`:''}
    ${isStreamer?`<button class="secondary-wide" style="margin-top:10px" onclick="inviteStreamerLive('${esc(name)}')">邀请 TA 开播</button>`:''}
    <button class="secondary-wide" style="margin-top:10px;color:var(--accent)" onclick="clearCurrentDm()">清空本会话记录</button>
    <button class="secondary-wide" style="margin-top:10px;color:var(--accent)" onclick="deleteDmContact()">删除联系人</button>
  `;
}
function deleteDmContact(){
  const name=S._dmSettingsName;if(!name)return;
  haloConfirm('删除联系人「'+name+'」？聊天记录会一起删除。',()=>{
    delete S.chatLog[name];
    S.dmDeleted=(S.dmDeleted||[]).filter(x=>x!==name);S.dmDeleted.push(name);
    S.dmFriends=(S.dmFriends||[]).filter(x=>x.name!==name);
    S.dmStrangers=(S.dmStrangers||[]).filter(x=>x.name!==name);
    S.charMasks=(S.charMasks||[]).filter(m=>!(m.alias&&m.alias.name===name));
    S._dmSettingsName=null;
    saveHaloState();renderDM();
    S.history=['dmHome'];openPage('dmHome',false);
    showToast('已删除联系人');
  },'删除');
}
function editDmProfile(){
  const name=S._dmSettingsName;if(!name)return;
  const meta=dmMeta(name)||{};
  const char=charByName(name);
  openEditDialog({
    title:'修改资料',
    saveText:'保存',
    fields:[
      {label:'昵称',value:name},
      {label:'头像字母（1 个字符，可选）',value:meta.avatarLetter||String(name).charAt(0)},
      {label:'人设',value:meta.persona||meta.setting||(char&&char.setting)||'',multiline:true,placeholder:'身份、性格、说话方式…'}
    ],
    onSave:(v)=>{
      const nn=(v[0]||'').trim()||name;
      const letter=(v[1]||'').trim();
      const persona=(v[2]||'').trim();
      renameDm(name,nn,letter,persona);
    }
  });
}
function renameDm(oldName,newName,letter,persona){
  const fix=(arr)=>{(arr||[]).forEach(x=>{
    if(x&&x.name===oldName){
      x.name=newName;
      if(letter){x.avatarLetter=letter.charAt(0).toUpperCase();x.avatar=null;}
      if(persona){x.persona=persona;x.setting=persona;}
    }
  });};
  fix(S.dmStrangers);fix(S.dmFriends);
  if(oldName!==newName&&S.chatLog[oldName]){S.chatLog[newName]=S.chatLog[oldName];delete S.chatLog[oldName];}
  (S.charMasks||[]).forEach(mk=>{if(mk&&mk.alias&&mk.alias.name===oldName)mk.alias.name=newName;});
  if(S.currentGroup&&S.currentGroup.name===oldName)S.currentGroup.name=newName;
  if(S._dmSettingsName===oldName)S._dmSettingsName=newName;
  saveHaloState();renderDM();renderChat();renderDmSettings();showToast('资料已更新');
}
function saveStrangerAsFriend(){
  const name=S._dmSettingsName;if(!name)return;
  const idx=(S.dmStrangers||[]).findIndex(x=>x.name===name);
  if(idx<0){showToast('已经是好友');return;}
  const s=S.dmStrangers.splice(idx,1)[0];
  s.isCharMask=false;
  S.dmFriends.push(s);
  saveHaloState();renderDM();renderDmSettings();showToast('已存为好友');
}
function clearCurrentDm(){
  const name=S._dmSettingsName;if(!name)return;
  S.chatLog[name]=[];
  const meta=dmMeta(name); if(meta){meta.prev='';meta.unread=false;}
  saveHaloState();renderChat();renderDM();renderDmSettings();showToast('已清空与 '+name+' 的聊天记录');
}
function dmSetAvatarFile(){
  const name=S._dmSettingsName;if(!name)return;
  const input=document.createElement('input');input.type='file';input.accept='image/*';
  input.onchange=()=>{const f=input.files&&input.files[0];if(!f)return;const r=new FileReader();
    r.onload=()=>{const meta=dmMeta(name);if(meta){meta.avatar=String(r.result);}
      (S.liveRooms||[]).forEach(x=>{if(x.hostName===name)x.hostAvatarImage=String(r.result);});
      saveHaloState();renderDM();renderDmSettings();showToast('头像已更新');};
    r.readAsDataURL(f);};
  input.click();
}
function letContactPickAvatar(name){
  if(!(S.gallery||[]).length){showToast('图库还没有照片，先去设置里上传');return;}
  const src=rand(S.gallery);
  const meta=dmMeta(name);if(meta){meta.avatar=src;}
  (S.liveRooms||[]).forEach(x=>{if(x.hostName===name)x.hostAvatarImage=src;});
  if(S.currentRoom&&S.currentRoom.hostName===name)S.currentRoom.hostAvatarImage=src;
  saveHaloState();renderDM();renderDmSettings();showToast(name+' 从你的图库里选了一张头像');
}

/* ============ 主播好友：添加当前直播间的主播 / 让ta开播 ============ */
function addCurrentStreamer(){
  const r=S.currentRoom;
  if(!r){showToast('先进入一个直播间');return;}
  const name=String(r.hostName||'').trim();
  if(!name){showToast('这个主播还没有名字');return;}
  closeActionSheet();
  if((S.dmFriends||[]).some(x=>x.name===name)){showToast('已经是好友了');openChat(name,'dm');return;}
  const c=charByName(name);
  // 记住你们在直播间里的互动，之后私聊会带上这段记忆
  const mine=(S.audience||[]).filter(x=>x.mine&&x.text).slice(-8).map(x=>x.text);
  const cardLines=(S.hostCards||[]).slice(0,2).map(x=>x.speech||x.narration).filter(Boolean);
  const liveMemory={title:r.title||'',topic:r.topic||'',desc:r.desc||'',hostSaid:cardLines,myChat:mine,at:nowMin()};
  S.dmFriends.push({name:name,isStreamer:true,fromLive:true,
    setting:(c&&c.setting)||r.desc||'',persona:(c&&c.setting)||'',
    avatar:(c&&c.avatar)||r.hostAvatarImage||null,
    avatarLetter:(c&&c.avatarLetter)||name.charAt(0),
    prev:'你们在直播间认识',time:'刚刚',unread:false,liveMemory:liveMemory});
  if(!S.chatLog[name]) S.chatLog[name]=[];
  S.chatLog[name].push({who:'system',name:'System',text:'你在「'+(r.title||r.topic||'直播')+'」的直播间添加了主播 '+name+'，TA 记得你们的互动',time:nowHM(),at:nowMin()});
  saveHaloState();renderDM();
  showToast('已添加主播 '+name+'，TA 记得你们的互动');
  openChat(name,'dm');
}
/* 第一步：只发一张「邀请开播」卡，不调用 API */
function inviteStreamerLive(name){
  if(!name)return;
  if(!S.chatLog[name]) S.chatLog[name]=[];
  const exists=(S.chatLog[name]||[]).some(m=>m.kind==='live-invite'&&m.status==='pending');
  if(exists){closeDmSettings();openChat(name,'dm');showToast('已经有待回复的邀请');return;}
  S.chatLog[name].push({who:'user',name:currentIdentity().name||'You',kind:'live-invite',status:'pending',target:name,
    text:'你邀请 '+name+' 开一场直播',time:nowHM(),at:nowMin()});
  const meta=dmMeta(name);if(meta){meta.prev='你邀请 '+name+' 开播';meta.time='刚刚';meta.unread=false;meta.at=nowMin();}
  closeDmSettings();saveHaloState();renderDM();openChat(name,'dm');
  showToast('已发出开播邀请，点卡片「回复」等 TA 回应');
}
/* 第二步：点「回复」才调用一次 API，让 TA 开播并发来直播邀请卡 */
async function respondLiveInvite(name,idx){
  const log=S.chatLog[name]||[];const m=log[idx];
  if(!m||m.kind!=='live-invite'||m.status!=='pending')return;
  m.status='replied';
  renderChat();
  await requestStreamerLive(name);
}
async function requestStreamerLive(name){
  if(!name)return;
  if(!S._apiReady||typeof HaloData==='undefined'){haloFail('开播失败',new Error('未配置主 API'));return;}
  const meta=dmMeta(name)||{};const char=charByName(name);
  const setting=meta.setting||(char&&char.setting)||'';
  const tags=S.liveTags.filter(t=>t.name!=='全部').map(t=>t.name+(tagDescOf(t.name)?('（'+tagDescOf(t.name)+'）'):'')).join('、');
  try{
    const sys='主播「'+name+'」要开一场直播，请生成房间与初始内容。只输出 JSON：{"title":"标题(8-16字)","topic":"话题","dual":true或false,"intro":"一句话简介","cards":[{"who":"A","narration":"2-3句画面/动作描写","speech":"主播台词"}],"barrage":[{"name":"观众网名","text":"弹幕"}]}。'
      +'话题从这些板块选：'+tags+'。弹幕 8-16 条，风向多元。'+DIVERSITY_NOTE
      +'弹幕不要使用用户或主播的名字。';
    const obj=await HaloData.callMainJSON([{role:'system',content:sys},{role:'user',content:'主播人设：'+(setting||'（无）')+'\n用户个签：'+(currentIdentity().signature||'无')}],{temperature:1.05});
    const tagNames=S.liveTags.filter(t=>t.name!=='全部').map(t=>t.name);
    const topic=tagNames.indexOf(String(obj.topic))>-1?String(obj.topic):(tagNames[0]||'日常');
    const banned=[name,currentIdentity().name].filter(Boolean);
    const cards=(Array.isArray(obj.cards)?obj.cards:[]).map(c=>({who:String((c&&c.who)||'A').slice(0,2),narration:String((c&&c.narration)||'').trim(),speech:String((c&&c.speech)||'').trim()})).filter(c=>c.narration||c.speech);
    const barrage=(Array.isArray(obj.barrage)?obj.barrage:[]).map(b=>({name:String((b&&b.name)||'').slice(0,20),text:String((b&&b.text)||'').trim()})).filter(b=>b.text&&banned.indexOf(b.name)<0).map(b=>({name:b.name||rand(CN_AUDIENCE)||'',text:b.text}));
    if(!cards.length&&!barrage.length) throw new Error('AI 未返回有效的直播内容');
    const r={id:Date.now(),title:String(obj.title||(name+' 的直播')).slice(0,30),topic,desc:String(obj.intro||'').slice(0,120),
      viewers:String(100+Math.floor(Math.random()*2000)),dual:!!obj.dual,hostName:name,
      hostAvatar:String(name).charAt(0),hostAvatarImage:meta.avatar||(char&&char.avatar)||null,gen:true,cards,barrage};
    S.liveRooms.unshift(r);
    const log=S.chatLog[name]||(S.chatLog[name]=[]);
    log.push({kind:'share',status:'pending',who:'other',name:name,text:name+' 开播了：「'+r.title+'」',
      share:{id:r.id,title:r.title,topic:r.topic,host:name,desc:r.desc,cards:cards.slice(0,2),audience:barrage.slice(0,6),sharedAt:Date.now()},
      roomId:r.id,time:nowHM(),at:nowMin()});
    const m=dmMeta(name);if(m){m.prev='开播邀请：'+r.title;m.time='刚刚';m.unread=true;m.at=nowMin();}
    saveHaloState();renderDM();
    if(!S.currentGroup||S.currentGroup.name!==name)openChat(name,'dm');
    else renderChat();
    showToast(name+' 已开播，点卡片「去看」进入');
  }catch(e){
    haloFail('让ta开播失败',e);
  }
}

/* ============ 图库 & 个签 ============ */
function openGallerySheet(){
  let modal=$('haloGalleryModal');
  if(!modal){
    modal=document.createElement('div');modal.className='modal';modal.id='haloGalleryModal';
    modal.innerHTML='<div class="sheet"><div class="grab"></div><h2>我的图库</h2><div id="haloGalleryGrid" style="max-height:46vh;overflow:auto;margin-bottom:10px"></div><button class="secondary-wide" onclick="document.getElementById(\'haloGalleryInput\').click()">＋ 上传照片</button><input id="haloGalleryInput" type="file" accept="image/*" multiple style="display:none" onchange="addGalleryFiles(this.files)"><button class="secondary-wide" style="margin-top:8px" onclick="closeGallerySheet()">关闭</button></div>';
    document.body.appendChild(modal);
  }
  renderGallerySheet();modal.classList.add('show');
}
function closeGallerySheet(){const m=$('haloGalleryModal');if(m)m.classList.remove('show')}
function renderGallerySheet(){
  const box=$('haloGalleryGrid');if(!box)return;
  const g=S.gallery||[];
  box.innerHTML='<div class="gallery-grid">'+g.map((src,i)=>`<div class="gallery-item"><img src="${esc(src)}" alt=""><button class="gallery-del" onclick="removeGalleryPhoto(${i})">×</button></div>`).join('')+(g.length?'':'<div class="muted small" style="padding:12px 0">还没有照片，点下面上传。</div>')+'</div>';
}
function addGalleryFiles(files){
  if(!files||!files.length)return;
  Array.prototype.forEach.call(files,f=>{
    if(!/^image\//.test(f.type))return;
    const r=new FileReader();
    r.onload=()=>{ S.gallery.push(String(r.result)); saveHaloState(); renderGallerySheet(); };
    r.readAsDataURL(f);
  });
  showToast('已加入图库');
}
function removeGalleryPhoto(i){ (S.gallery||[]).splice(i,1); saveHaloState(); renderGallerySheet(); }
function openGalleryPicker(name){
  if(!(S.gallery||[]).length){ showToast('图库还没有照片，先去设置里上传'); return; }
  let modal=$('haloGalleryPicker');
  if(!modal){
    modal=document.createElement('div');modal.className='modal';modal.id='haloGalleryPicker';
    modal.innerHTML='<div class="sheet"><div class="grab"></div><h2>为主播选头像</h2><div id="haloGalleryPickerGrid" style="max-height:46vh;overflow:auto;margin-bottom:8px"></div><button class="secondary-wide" onclick="closeGalleryPicker()">取消</button></div>';
    document.body.appendChild(modal);
  }
  modal.dataset.name=name||'';
  const box=$('haloGalleryPickerGrid');
  box.innerHTML='<div class="gallery-grid">'+(S.gallery||[]).map((src,i)=>`<button class="gallery-item" onclick="pickGalleryForStreamer(${i})"><img src="${esc(src)}" alt=""></button>`).join('')+'</div>';
  modal.classList.add('show');
}
function closeGalleryPicker(){const m=$('haloGalleryPicker');if(m)m.classList.remove('show')}
function pickGalleryForStreamer(i){
  const m=$('haloGalleryPicker');const name=(m&&m.dataset.name)||S._dmSettingsName;const src=(S.gallery||[])[i];
  if(!name||!src){return;}
  const meta=dmMeta(name);
  if(meta){meta.avatar=src;}
  (S.liveRooms||[]).forEach(r=>{if(r.hostName===name)r.hostAvatarImage=src;});
  if(S.currentRoom&&S.currentRoom.hostName===name)S.currentRoom.hostAvatarImage=src;
  saveHaloState();closeGalleryPicker();renderDM();renderDmSettings();
  if(S.currentRoom)renderRoom();
  showToast(name+' 换上了新头像');
}
function editSignature(){
  const id=currentIdentity();
  openEditDialog({
    title:'编辑个签',
    fields:[{label:'个签（其他人会读取这段内容）',value:id.signature||'',multiline:true,placeholder:'一句介绍自己的话'}],
    onSave:(v)=>{
      id.signature=(v[0]||'').trim();
      if(S.activeAliasId==='main'){try{localStorage.setItem('nanoSignature',id.signature);}catch(e){}}
      try{localStorage.setItem('nanoAliases',JSON.stringify(S.aliases));}catch(e){}
      renderMine();saveHaloState();showToast('个签已更新');
    }
  });
}

/* ============ 分页面清空数据 ============ */
let _clearSel={dm:{},grp:{}};
function openClearSheet(){
  let modal=$('haloClearModal');
  if(!modal){
    modal=document.createElement('div');modal.className='modal';modal.id='haloClearModal';
    modal.innerHTML='<div class="sheet"><div class="grab"></div><h2>清空数据</h2><div id="haloClearBody" style="max-height:56vh;overflow:auto;margin-bottom:8px"></div><button class="secondary-wide" onclick="closeClearSheet()">关闭</button></div>';
    document.body.appendChild(modal);
  }
  renderClearSheet();modal.classList.add('show');
}
function closeClearSheet(){const m=$('haloClearModal');if(m)m.classList.remove('show')}
function renderClearSheet(){
  const body=$('haloClearBody');if(!body)return;
  const friends=(S.dmFriends||[]).map(x=>x.name);
  const strangers=(S.dmStrangers||[]).map(x=>x.name);
  const groups=(S.groups||[]).map(x=>x.name);
  let html='';
  html+='<div class="mine-group-title">直播</div>';
  html+='<div class="muted small" style="padding:0 2px 8px">清空所有直播，包含“我开过的 / 我互动过的 / 回放”。</div>';
  html+='<button class="secondary-wide" style="color:var(--accent)" onclick="clearLiveRecords()">清空直播记录</button>';
  html+='<div class="mine-group-title" style="margin-top:12px">私聊</div>';
  const dmNames=friends.concat(strangers);
  html+=dmNames.length?dmNames.map(n=>{const on=_clearSel.dm[n]?'✓':'';return `<button class="sub-row" data-kind="dm" data-name="${esc(n)}" onclick="toggleClearSel(this)"><div class="sub-av">${esc(String(n).charAt(0))}</div><div class="sub-info"><div class="sub-name">${esc(n)}</div><div class="sub-desc">${strangers.indexOf(n)>-1?'陌生人':'好友'}</div></div><span class="sub-go">${on||'选择'}</span></button>`}).join(''):'<div class="muted small" style="text-align:center;padding:8px 0">没有私聊</div>';
  html+='<button class="secondary-wide" style="color:var(--accent);margin-top:6px" onclick="clearSelectedDm()">清空所选私聊</button>';
  html+='<div class="mine-group-title" style="margin-top:12px">群聊</div>';
  html+=groups.length?groups.map(n=>{const on=_clearSel.grp[n]?'✓':'';return `<button class="sub-row" data-kind="grp" data-name="${esc(n)}" onclick="toggleClearSel(this)"><div class="sub-av">${esc(String(n).charAt(0))}</div><div class="sub-info"><div class="sub-name">${esc(n)}</div></div><span class="sub-go">${on||'选择'}</span></button>`}).join(''):'<div class="muted small" style="text-align:center;padding:8px 0">没有群聊</div>';
  html+='<button class="secondary-wide" style="color:var(--accent);margin-top:6px" onclick="clearSelectedGrp()">清空所选群聊记录</button>';
  html+='<div class="mine-group-title" style="margin-top:14px">全部</div>';
  html+='<button class="secondary-wide" style="color:var(--accent)" onclick="clearAllData()">清空全部 Halo 记录</button>';
  body.innerHTML=html;
}
/* ============ 通用编辑弹窗 / 确认弹窗（美化，不用原生 prompt/confirm） ============ */
function openEditDialog(opts){
  const o=opts||{};
  let modal=$('haloEditModal');
  if(!modal){
    modal=document.createElement('div');modal.className='modal';modal.id='haloEditModal';
    modal.innerHTML='<div class="sheet"><div class="grab"></div><h2 id="haloEditTitle"></h2><div id="haloEditFields"></div><button class="primary-wide" id="haloEditSave"></button><button class="secondary-wide" onclick="closeEditDialog()">取消</button></div>';
    document.body.appendChild(modal);
  }
  $('haloEditTitle').textContent=o.title||'编辑';
  const fields=o.fields||[];
  const box=$('haloEditFields');
  box.innerHTML=fields.map((f,i)=>f.multiline
    ? `<label class="edit-label">${esc(f.label||'')}</label><textarea class="edit-input" data-i="${i}" rows="4" placeholder="${esc(f.placeholder||'')}">${esc(f.value||'')}</textarea>`
    : `<label class="edit-label">${esc(f.label||'')}</label><input class="edit-input" data-i="${i}" placeholder="${esc(f.placeholder||'')}" value="${esc(f.value||'')}">`
  ).join('');
  const save=$('haloEditSave');save.textContent=o.saveText||'保存';
  save.onclick=()=>{
    const vals=fields.map((f,i)=>{const el=box.querySelector('[data-i="'+i+'"]');return el?el.value:'';});
    closeEditDialog();
    try{o.onSave&&o.onSave(vals);}catch(e){console.warn('[Halo] 编辑保存失败:',e);}
  };
  modal.classList.add('show');
}
function closeEditDialog(){const m=$('haloEditModal');if(m)m.classList.remove('show')}
function haloConfirm(message,onOk,okText){
  let modal=$('haloConfirmModal');
  if(!modal){
    modal=document.createElement('div');modal.className='modal';modal.id='haloConfirmModal';
    modal.innerHTML='<div class="sheet"><div class="grab"></div><h2>确认</h2><div id="haloConfirmMsg" class="admin-only-note" style="padding:2px 0 12px"></div><button class="secondary-wide" id="haloConfirmOk" style="color:var(--accent)"></button><button class="secondary-wide" onclick="closeConfirmModal()">取消</button></div>';
    document.body.appendChild(modal);
  }
  $('haloConfirmMsg').textContent=message||'';
  const ok=$('haloConfirmOk');ok.textContent=okText||'确定';
  ok.onclick=()=>{closeConfirmModal();try{onOk&&onOk();}catch(e){console.warn('[Halo] 确认操作失败:',e);}};
  modal.classList.add('show');
}
function closeConfirmModal(){const m=$('haloConfirmModal');if(m)m.classList.remove('show')}

function toggleClearSel(el){
  const kind=el.dataset.kind, name=el.dataset.name;
  if(!kind||!name) return;
  _clearSel[kind]=_clearSel[kind]||{};
  if(_clearSel[kind][name]) delete _clearSel[kind][name]; else _clearSel[kind][name]=true;
  const go=el.querySelector('.sub-go'); if(go) go.textContent=_clearSel[kind][name]?'✓':'选择';
}
function clearLiveRecords(){
  const ids={};
  (S.myOwnLives||[]).forEach(r=>{ids[String(r.id)]=1});
  (S.interactedLives||[]).forEach(r=>{ids[String(r.id)]=1});
  S.liveRooms=(S.liveRooms||[]).filter(r=>!r.gen&&!ids[String(r.id)]);
  S.interactedLives=[];S.myOwnLives=[];S.myReplays=[];
  saveHaloState();renderLive();renderMine();
  if($('haloClearModal')&&$('haloClearModal').classList.contains('show')) renderClearSheet();
  showToast('已清空直播记录');
}
function clearSelectedDm(){
  const names=Object.keys(_clearSel.dm||{});
  if(!names.length){showToast('还没有选择私聊');return;}
  names.forEach(n=>{
    delete S.chatLog[n];
    const meta=dmMeta(n);
    if(meta&&meta.isCharMask){
      S.charMasks=(S.charMasks||[]).filter(m=>m&&m.alias&&m.alias.name!==n);
      S.dmStrangers=(S.dmStrangers||[]).filter(x=>x&&x.name!==n);
    }else if(meta){ meta.prev=''; meta.unread=false; }
  });
  _clearSel.dm={};saveHaloState();renderDM();
  if($('haloClearModal')&&$('haloClearModal').classList.contains('show')) renderClearSheet();
  showToast('已清空所选私聊');
}
function clearSelectedGrp(){
  const names=Object.keys(_clearSel.grp||{});
  if(!names.length){showToast('还没有选择群聊');return;}
  names.forEach(n=>{
    delete S.chatLog[n];
    const g=(S.groups||[]).find(x=>x.name===n); if(g){g.last='';g.time='';g.unread=0;}
  });
  _clearSel.grp={};saveHaloState();renderGroupList();
  if($('haloClearModal')&&$('haloClearModal').classList.contains('show')) renderClearSheet();
  showToast('已清空所选群聊记录');
}

/* ============ 通用：头像 / 身份 ============ */
function imgOk(img){
  if(!img) return false;
  const s=String(img);
  return s.length>50 || /^(https?:|data:|blob:)/i.test(s);
}
function avStyle(img){
  if(!imgOk(img)) return '';
  return ` style="background-image:url('${String(img).replace(/["'()\\\s]/g,'')}');background-size:cover;background-position:center"`;
}
function indexByName(list){const m={};(list||[]).forEach(x=>{if(x&&x.name)m[x.name]=x});return m}
function charByName(name){return (S._realChars||[]).find(c=>c.name===name)||null}
function dmMeta(name){return (S.dmFriends||[]).find(x=>x.name===name)||(S.dmStrangers||[]).find(x=>x.name===name)||null}
function markChatRead(name){
  const m=dmMeta(name);
  if(m&&m.unread){m.unread=false;saveHaloState();renderDM();}
}
/* 把一段回复按换行拆成多个气泡 */
// 陌生人/联系人发来 [加好友] → 写入 Meet 好友申请（绑定当前 user）
function nanoRequestFriendHalo(name){
  try{
    if(!name) return;
    const meta=dmMeta(name)||{};
    let owner='';
    try{ const md=JSON.parse(localStorage.getItem('nano_mask_data')||localStorage.getItem('nano_home_data')||'null'); if(md){ if(md.currentMaskId!=null) owner=String(md.currentMaskId); else if(Array.isArray(md.masks)&&md.masks.length) owner=String(md.masks[0].id||''); } }catch(e){}
    const all=JSON.parse(localStorage.getItem('nano_friend_requests')||'[]')||[];
    if(all.some(x=>x&&x.status==='pending'&&x.source==='halo'&&x.name===name)) return;
    all.push({ id:'fr_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,6), owner:owner, name:name, avatar:meta.avatar||'', source:'halo', app:'halo', setting:String(meta.persona||meta.setting||''), requestNote:'在 Halo 加你', ts:Date.now(), status:'pending' });
    localStorage.setItem('nano_friend_requests', JSON.stringify(all.slice(-400)));
    try{ if(window.parent&&window.parent!==window) window.parent.postMessage({type:'homeDataUpdated'},'*'); }catch(e){}
  }catch(e){}
}
// 判断来信是否表达「想加你好友/微信」的意图
function haloAddIntent(t){
  t=String(t||'');
  if(/\[(?:加好友|加微信|加我|申请加好友)\]/i.test(t)) return true;
  return /(加|添加|发)(?:个|一下|你|你的|个你)?(?:的)?(?:好友|微信|联系方式|微信好友)|我(已经)?加(你|上你|你了)|加上你|想(要)?加(你|一下)|加一下你|加你个/.test(t);
}
function pushSplitChat(name,who,text,speaker){
  let raw=String(text==null?'':text).replace(/\r/g,'');
  if(who!=='user' && haloAddIntent(raw)){
    try{ nanoRequestFriendHalo(name); }catch(e){}
    raw=raw.replace(/\[(?:加好友|加微信|加我|申请加好友)\]/gi,'');
  }
  raw=raw.trim();
  if(!raw) return 0;
  const parts=raw.split('\n').map(s=>s.trim()).filter(Boolean);
  const list=parts.length?parts:[raw];
  list.forEach(p=>pushChat(name,{who:who,name:speaker||name,text:p,time:nowHM(),at:nowMin()}));
  const last=list[list.length-1];
  const meta=dmMeta(name);
  if(meta){meta.prev=last;meta.time='刚刚';meta.at=nowMin();if(who!=='user')meta.unread=true;}
  const g=(S.groups||[]).find(x=>x.name===name);
  if(g){g.last=last;g.time='刚刚';}
  return list.length;
}
function aiErrorDetail(e){
  const m=String((e&&e.message)||e||'未知错误');
  if(!S._apiReady||/未配置主 API/.test(m)) return '未配置主 API：请到「设置 → API」填写主 API 的 URL / Key / 模型。';
  if(/缺少 Key/.test(m)) return '主 API 缺少 Key：请在「设置 → API」补全。';
  if(/API \d+/.test(m)) return '主 API 返回错误：'+m;
  if(/abort|timeout|超时/i.test(m)) return '请求超时：主 API 在 45 秒内没有响应，请检查网络或服务是否在线。';
  if(/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(m)) return '无法连接主 API：地址不可达或网络错误。请检查 URL 是否正确、服务是否启动。';
  if(/JSON|Unexpected token/i.test(m)) return 'AI 返回的内容不是有效 JSON，无法解析。可能是模型不支持 JSON 输出或返回被截断。';
  if(/未返回/.test(m)) return 'AI 没有返回内容：' + m;
  return m;
}
function errorCodeOf(e){
  const m=String((e&&e.message)||e||'');
  const hit=m.match(/\b(\d{3})\b/);
  if(hit) return hit[1];
  if(/Failed to fetch|NetworkError|fetch failed|Load failed/i.test(m)) return '504';
  if(/timeout|超时|abort/i.test(m)) return '504';
  if(/未配置主 API|缺少 Key/.test(m)) return '401';
  if(/JSON|未返回/.test(m)) return '422';
  return '500';
}
function openErrorModal(title,detail){
  let m=$('haloErrorModal');
  if(!m){
    m=document.createElement('div');m.className='modal';m.id='haloErrorModal';
    m.innerHTML='<div class="sheet"><div class="grab"></div><h2 id="haloErrTitle"></h2><div id="haloErrBody" class="admin-only-note" style="padding:2px 0 14px;white-space:pre-wrap;line-height:1.7"></div><button class="secondary-wide" onclick="closeErrorModal()">我知道了</button></div>';
    document.body.appendChild(m);
  }
  $('haloErrTitle').textContent=title||'出错了';
  $('haloErrBody').textContent=detail||'';
  m.classList.add('show');
}
function closeErrorModal(){const m=$('haloErrorModal');if(m)m.classList.remove('show')}
function haloFail(prefix,e){
  const detail=aiErrorDetail(e);
  const code=errorCodeOf(e);
  console.warn('[Halo]',prefix,code,detail,e);
  openErrorModal(prefix+' · '+code, detail);
  showToast(prefix);
}
function currentUserSetting(){
  const id=currentIdentity();
  return id.setting || id.bio || '';
}

/* ============ Halo 自有记录持久化 ============ */
function thinDmList(list){
  return (list||[]).map(d=>({
    name:d.name,prev:d.prev,time:d.time,unread:!!d.unread,
    charId:d.charId||null,avatarLetter:d.avatarLetter||null,
    avatar:(d.avatar && String(d.avatar).length<=300)?d.avatar:null,
    isCharMask:!!d.isCharMask,maskId:d.maskId||null,maskOwner:d.maskOwner||null,
    revealedAs:d.revealedAs||null,foreign:d.foreign||null,tag:d.tag||null,
    persona:String(d.persona||'').slice(0,300),
    isStreamer:!!d.isStreamer,setting:String(d.setting||'').slice(0,600),
    fromLive:!!d.fromLive,liveMemory:d.liveMemory||null,chatCount:Number(d.chatCount)||0
  }));
}
function thinRecaps(map){
  const src=map||{};const out={};
  Object.keys(src).slice(-20).forEach(k=>{
    const r=src[k]||{};
    out[k]={id:r.id,title:r.title,topic:r.topic,desc:r.desc,hostName:r.hostName,at:r.at,
      cards:(r.cards||[]).slice(0,4),log:(r.log||[]).slice(-80),audience:(r.audience||[]).slice(-40),giftMap:r.giftMap||{}};
  });
  return out;
}
/* ============ 持久化：IndexedDB（按马甲隔离，退出不丢） ============ */
const HALO_DB='nano_halo_db',HALO_STORE='halo_state',HALO_LEGACY='nanoHaloState_v1';
function haloDbOpen(){
  return new Promise((res,rej)=>{
    if(typeof indexedDB==='undefined'){rej(new Error('no idb'));return;}
    const r=indexedDB.open(HALO_DB,1);
    r.onupgradeneeded=e=>{const db=e.target.result;if(!db.objectStoreNames.contains(HALO_STORE))db.createObjectStore(HALO_STORE,{keyPath:'key'});};
    r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);
  });
}
function haloIdbGet(key){
  return haloDbOpen().then(db=>new Promise(res=>{
    try{const q=db.transaction(HALO_STORE,'readonly').objectStore(HALO_STORE).get(key);
      q.onsuccess=()=>{db.close();res(q.result?q.result.value:null);};
      q.onerror=()=>{db.close();res(null);};}catch(e){try{db.close()}catch(_){ }res(null);}
  })).catch(()=>null);
}
function haloIdbPut(key,value){
  return haloDbOpen().then(db=>new Promise(res=>{
    try{const q=db.transaction(HALO_STORE,'readwrite').objectStore(HALO_STORE).put({key:key,value:value});
      q.onsuccess=()=>{db.close();res(true);};q.onerror=()=>{db.close();res(false);};}catch(e){try{db.close()}catch(_){ }res(false);}
  })).catch(()=>false);
}
function haloIdbDel(key){
  return haloDbOpen().then(db=>new Promise(res=>{
    try{const q=db.transaction(HALO_STORE,'readwrite').objectStore(HALO_STORE).delete(key);
      q.onsuccess=()=>{db.close();res(true);};q.onerror=()=>{db.close();res(false);};}catch(e){try{db.close()}catch(_){ }res(false);}
  })).catch(()=>false);
}
function haloStateKey(){return 'state:'+(S.activeAliasId||'main');}
function emptyHaloData(){
  S.chatLog={};S.charMasks=[];S.myReplays=[];S.liveRooms=[];S.myOwnLives=[];S.interactedLives=[];
  S.groups=[];S.myGroups=[];S._dmFriendsPersist=[];S._dmStrangersPersist=[];S.dmPinned=[];S.dmDeleted=[];S.gallery=[];S.roomRecaps={};
}
function applyHaloData(d){
  if(!d||typeof d!=='object')return;
  if(d.chatLog&&typeof d.chatLog==='object')S.chatLog=d.chatLog;
  if(Array.isArray(d.charMasks))S.charMasks=d.charMasks;
  if(Array.isArray(d.myReplays))S.myReplays=d.myReplays;
  if(Array.isArray(d.liveRooms))S.liveRooms=d.liveRooms;
  if(Array.isArray(d.myOwnLives))S.myOwnLives=d.myOwnLives;
  if(Array.isArray(d.interactedLives))S.interactedLives=d.interactedLives;
  if(Array.isArray(d.groups))S.groups=d.groups;
  if(Array.isArray(d.myGroups))S.myGroups=d.myGroups;
  if(Array.isArray(d.dmFriends))S._dmFriendsPersist=d.dmFriends;
  if(Array.isArray(d.dmStrangers))S._dmStrangersPersist=d.dmStrangers;
  if(Array.isArray(d.dmPinned))S.dmPinned=d.dmPinned;
  if(Array.isArray(d.dmDeleted))S.dmDeleted=d.dmDeleted;
  if(Array.isArray(d.gallery))S.gallery=d.gallery;
  if(d.roomRecaps&&typeof d.roomRecaps==='object')S.roomRecaps=d.roomRecaps;
}
async function loadHaloState(){
  emptyHaloData();
  let d=await haloIdbGet(haloStateKey());
  if(!d&&(S.activeAliasId||'main')==='main'){
    try{const raw=localStorage.getItem(HALO_LEGACY);if(raw){d=JSON.parse(raw);localStorage.removeItem(HALO_LEGACY);}}catch(e){}
  }
  if(!d){
    try{const all=JSON.parse(localStorage.getItem('nanoHaloFallback_v1')||'{}');if(all[haloStateKey()])d=all[haloStateKey()];}catch(e){}
  }
  applyHaloData(d);
}
let _saveTimer=null,_savePending=false,_saveWarned=false;
function boundedStateSnapshot(){
  const chatLog={};
  Object.keys(S.chatLog||{}).forEach(k=>{
    chatLog[k]=(S.chatLog[k]||[]).slice(-120).map(m=>{
      if(m&&m.share){
        const s=m.share||{};
        return Object.assign({},m,{share:{
          id:s.id,title:s.title,topic:s.topic,host:s.host,sharedAt:s.sharedAt,
          desc:String(s.desc||'').slice(0,200),
          cards:(s.cards||[]).slice(0,2).map(c=>({who:c.who,narration:String(c.narration||'').slice(0,200),speech:String(c.speech||'').slice(0,300)})),
          audience:(s.audience||[]).slice(-4)
        }});
      }
      return m;
    });
  });
  const replays=(S.myReplays||[]).slice(0,10).map(r=>Object.assign({},r,{
    log:(r.log||[]).slice(-60),audience:(r.audience||[]).slice(-60)
  }));
  return {
    chatLog,charMasks:S.charMasks,myReplays:replays,liveRooms:(S.liveRooms||[]).slice(0,60),
    myOwnLives:S.myOwnLives,interactedLives:S.interactedLives,groups:S.groups,myGroups:S.myGroups,
    dmFriends:thinDmList(S.dmFriends),dmStrangers:thinDmList(S.dmStrangers),
    dmPinned:S.dmPinned,dmDeleted:S.dmDeleted,gallery:(S.gallery||[]).slice(0,40),
    roomRecaps:thinRecaps(S.roomRecaps)
  };
}
function saveHaloState(){
  _savePending=true;
  clearTimeout(_saveTimer);
  _saveTimer=setTimeout(flushHaloState,250);
}
function flushHaloState(){
  if(!_savePending)return;
  _savePending=false;
  clearTimeout(_saveTimer);
  persistNow();
}
function persistNow(){
  const key=haloStateKey();
  let snap;
  try{snap=boundedStateSnapshot();}catch(e){return;}
  haloIdbPut(key,snap).then(ok=>{if(!ok)persistHaloFallback(key,snap)});
}
function persistHaloFallback(key,snap){
  try{
    const all=JSON.parse(localStorage.getItem('nanoHaloFallback_v1')||'{}');
    all[key]=snap;localStorage.setItem('nanoHaloFallback_v1',JSON.stringify(all));
  }catch(e){
    if(!_saveWarned){_saveWarned=true;console.warn('[Halo] 持久化失败（IndexedDB 与 localStorage 都不可用）:',e);}
  }
}
try{
  window.addEventListener('pagehide',()=>{if(_savePending)flushHaloState()});
  window.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&_savePending)flushHaloState()});
}catch(e){}

/* ============ 真实数据接入 ============ */
async function syncIdentity(){
  if (typeof HaloData === 'undefined') return;
  const mask = HaloData.currentMask();
  if (!mask) return;
  S._mask = mask;
  S.identity.name         = mask.name || S.identity.name;
  S.identity.handle       = mask.wechat ? '@' + mask.wechat : (mask.handle || S.identity.handle);
  S.identity.avatarLetter = (mask.name || 'X').charAt(0).toUpperCase();
  S.identity.setting      = mask.setting || '';
  S.identity.gender       = mask.gender || '';
  S.identity.maskId       = mask.id;
  try{
    const url = await HaloData.getAvatarFromDB(mask.id);
    S.identity.avatarImage = url || null;
  }catch(e){ S.identity.avatarImage = null; }
}

async function applyRealData(){
  if (typeof HaloData === 'undefined') {
    console.warn('[Halo] HaloData 未加载，使用默认演示数据');
    return;
  }

  try {
    // ---- 0. 本地记录 ----
    await loadHaloState();

    // ---- 1. 人设 / 马甲：同步头像与昵称 ----
    await syncIdentity();

    // ---- 2. 角色：填 charSheet 候选 + 好友列表 ----
    const chars = await HaloData.visibleCharacters();
    S._realChars = (chars || []).map(c => {
      const raw = c.avatar ? String(c.avatar) : '';
      const isImg = !!raw && (raw.length > 50 || /^(https?:|data:|blob:)/i.test(raw));
      return {
        name:      c.name || 'Unnamed',
        desc:      c.setting ? String(c.setting).slice(0, 40) : (c.gender || '角色'),
        setting:   c.setting || '',
        gender:    c.gender || '',
        avatar:    isImg ? raw : null,
        avatarLetter: (!isImg && raw ? raw.charAt(0) : (c.name || '?').charAt(0)).toUpperCase(),
        id:        c.id,
        isNpc:     !!c.isNpc,
        bindUser:  c.bindUser,
        worldbookBindings: c.worldbookBindings || [],
      };
    });

    if (S._realChars.length) {
      const persisted = indexByName(S._dmFriendsPersist);
      const deleted = S.dmDeleted||[];
      const fromChars = S._realChars.filter(c=>deleted.indexOf(c.name)<0).slice(0, 8).map(c => {
        const log = S.chatLog[c.name] || [];
        const last = log.length ? log[log.length-1] : null;
        const p = persisted[c.name] || {};
        return {
          name: c.name, charId: c.id, avatar: c.avatar, avatarLetter: c.avatarLetter||c.name.charAt(0).toUpperCase(),
          desc: c.desc, isChar: true,
          prev: p.prev || (last ? (last.text || last.foreign || '开始聊天') : c.desc),
          time: p.time || '刚刚', unread: !!p.unread
        };
      });
      // 补回不在角色库里的好友记录（例如角色马甲假身份）
      const extras = (S._dmFriendsPersist || []).filter(f => deleted.indexOf(f.name)<0 && !fromChars.some(x => x.name === f.name));
      S.dmFriends = sortByPin(fromChars.concat(extras.map(f => Object.assign({}, f, { isChar: !!f.charId }))));
    } else if ((S._dmFriendsPersist || []).length) {
      // 角色库为空时，仍还原已保存的好友列表，避免会话记录凭空消失
      S.dmFriends = sortByPin(S._dmFriendsPersist.filter(f=>(S.dmDeleted||[]).indexOf(f.name)<0).map(f => Object.assign({}, f, { isChar: !!f.charId })));
    }

    // 直播房间的主播头像尽量对齐角色库
    S.liveRooms.forEach(r => {
      const c = charByName(r.hostName);
      if (c && c.avatar) r.hostAvatarImage = c.avatar;
    });

    // ---- 3. 世界书 ----
    S._worldbook = await HaloData.readWorldbook();

    // ---- 4. API：验证主 API 是否配好 ----
    const cfg = await HaloData.readApiConfig();
    if (cfg && cfg.main && cfg.main.url && cfg.main.key) {
      S._apiReady = true;
      S._apiModel = cfg.main.model;
      console.log('[Halo] 主 API 就绪:', cfg.main.model, '@', cfg.main.url);
    } else {
      S._apiReady = false;
      console.warn('[Halo] 主 API 未配置，AI 回复会回退到本地随机文案');
    }

    // ---- 5. 角色马甲：把尚未出现的马甲铺进陌生人列表 ----
    if (S._dmStrangersPersist && S._dmStrangersPersist.length) {
      S.dmStrangers = S._dmStrangersPersist.slice();
    }
    restoreCharMaskStrangers();

    // ---- 6. 重新渲染 ----
    renderLive(); renderDM(); renderGroupList(); renderMine(); renderChat();
    if (S.currentRoom) renderRoom();
  } catch (e) {
    console.warn('[Halo] applyRealData 出错:', e);
  }
}

/* ============ 初始化 ============ */
function init(){
  S.liveRooms=[];
  S.groups=[];
  S.interactedLives=[];
  S.myOwnLives=[];
  S.myGroups=[];
  S.myReplays=[];
  S.chatLog={};
  S.dmFriends=[];
  S.dmStrangers=[];
  loadProfile();
  renderLiveTopics(); renderLive(); renderDM(); renderGroupList(); renderCreateChoices();
  renderChat(); renderGroupSettings(); updateDarkSwitches(); renderMine();
  buildBarrageMenuEmojis();
  initMiniDrag();
  updateLiveHomeBackDot();
  navTo('liveHome',false);
  installHaloInterop();
  applyRealData();
}
function allPages(){return [...document.querySelectorAll('.page')]}
function openPage(id,push=true){
  allPages().forEach(p=>p.classList.remove('active'));
  $(id).classList.add('active');
  const isNav=['liveHome','dmHome','groupHome','meHome'].includes(id);
  $('bottomNav').classList.toggle('hidden',!isNav);
  if(push && S.history[S.history.length-1]!==id) S.history.push(id);
  if(id==='liveRoom'){renderRoom()}
  if(id==='summary'){renderSummary()}
  if(id==='groupChat'){renderChatHeader();renderChat();updateChatSendIcon()}
  if(id==='groupSettings'){renderGroupSettings()}
  if(id==='dmSettings'){renderDmSettings()}
  if(id==='meHome'){renderMine()}
  requestAnimationFrame(clampMini);
  window.scrollTo(0,0);
}
function goBack(){
  if(S.history.length>1){
    S.history.pop();
    let prev=S.history[S.history.length-1];
    if(prev==='liveRoom') prev='liveHome';
    openPage(prev,false);
  }else openPage('liveHome',false);
}
// 右滑返回：按 Halo 内部历史回退；已在底部导航根页时返回 false，交给主框架关闭整个应用
window.__nanoInternalBack = function(){
  try {
    if (S.history.length > 1) { goBack(); return true; }
  } catch (e) {}
  return false;
};
function goHomeFromSummary(){
  S.history=['liveHome'];openPage('liveHome',false);
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page==='liveHome'));
}
function navTo(id,push=true){
  openPage(id,push);
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page===id));
  updateLiveHomeBackDot();
}
function showToast(t){const el=$('toast');el.textContent=t;el.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>el.classList.remove('show'),1800)}

function updateLiveHomeBackDot(){
  const el=$('liveHomeBackDot');if(!el)return;
  el.parentElement.classList.toggle('has-mini',S.collapsed);
}

/* ============ 首页直播列表 ============ */
function renderLiveTopics(){
  const list=S.liveTags.map(t=>{
    const isActive=t.name===S.liveTopic;
    const canDelete=t.name!=='全部';
    return `<button class="topic ${isActive?'active':''}" data-name="${esc(t.name)}" title="${esc(t.desc||'')}" onclick="selectLiveTopic(this.dataset.name)">
      <span>${esc(t.name)}</span>
      ${canDelete?`<span class="del" data-name="${esc(t.name)}" onclick="event.stopPropagation();deleteLiveTopic(this.dataset.name)">×</span>`:''}
    </button>`;
  }).join('');
  $('liveTopics').innerHTML=list+`<button class="topic add" onclick="openTagModal('live')">＋</button>`;
}
function deleteLiveTopic(name){
  S.liveTags=S.liveTags.filter(x=>x.name!==name);
  if(S.liveTopic===name) S.liveTopic='全部';
  renderLiveTopics(); renderLive();showToast('已删除话题');
}
function renderCreateChoices(){
  $('liveCreateTopics').innerHTML=S.liveTags.filter(x=>x.name!=='全部').map((t,i)=>`<button class="choice ${i===0?'active':''}" data-topic="${esc(t.name)}" onclick="pickChoice(this)">${esc(t.name)}</button>`).join('');
  $('groupCreateTopics').innerHTML=S.groupTags.map((t,i)=>`<button class="choice ${i===0?'active':''}" data-topic="${esc(t.name)}" onclick="pickChoice(this)">${esc(t.name)}</button>`).join('');
}
function pickChoice(el){el.parentElement.querySelectorAll('.choice').forEach(x=>x.classList.remove('active'));el.classList.add('active')}
function chooseMode(m){S.mode=m;$('singleMode').classList.toggle('active',m==='single');$('dualMode').classList.toggle('active',m==='dual')}
function selectLiveTopic(t){S.liveTopic=t;renderLiveTopics();renderLive()}

function renderLive(){
  let data=S.liveTopic==='全部'?S.liveRooms:S.liveRooms.filter(x=>x.topic===S.liveTopic);
  if(!data.length){
    $('liveFeed').innerHTML=`<div style="padding:50px 5px;text-align:center;color:var(--muted);font-size:13px">这个话题暂时没有直播。</div>`;
    return;
  }
  $('liveFeed').innerHTML=data.map(r=>{
    const hostImg = r.hostAvatarImage || (charByName(r.hostName)?.avatar) || null;
    const cover = r.cover ? `<img src="${esc(r.cover)}" alt="">` : (hostImg ? `<img src="${esc(hostImg)}" alt="">` : `<div class="cover-fallback">${esc((r.hostAvatar||r.hostName||'L').slice(0,2))}</div>`);
    return `
    <button class="feed-card" onclick="watchLive('${r.id}')">
      <div class="feed-cover">
        ${cover}
        <div class="fade"></div>
        <span class="feed-badge"><i></i>LIVE</span>
        <div class="cover-title">${esc(r.title)}</div>
        <span class="feed-viewers">${esc(r.viewers||'0')} 在线</span>
      </div>
      <div class="feed-info">
        <div class="feed-avatar"${avStyle(hostImg)}>${hostImg?'':esc(r.hostAvatar||r.hostName?.charAt(0)||'L')}</div>
        <div class="feed-meta">
          <div class="feed-host-name">@${esc(r.hostName||'host')}</div>
          <div class="feed-sub">${r.dual?'双人直播':'单人直播'} · 正在聊「${esc(r.topic)}」</div>
        </div>
        <span class="feed-topic-pill">${esc(r.topic)}</span>
      </div>
    </button>`;
  }).join('');
}

/* ============ 直播间 ============ */
function watchLive(id, host=false, fromSelf=false){
  // 叉叉结束过的直播：再点进去看「直播总结」，而不是空白内页
  const recap=S.roomRecaps&&S.roomRecaps[String(id)];
  if(recap){ openRoomRecap(String(id)); return; }
  S.currentRoom=(S.liveRooms.concat(S.interactedLives,S.myOwnLives).find(x=>String(x.id)===String(id)))||S.liveRooms[0];
  if(!S.currentRoom){showToast('直播不存在');return;}
  S.isHost=!!host;
  S.roomLog=[];S.gifts={};S.micState='idle';S.liveQuote=null;
  S.cohostPresent=!!S.currentRoom.dual;
  S.hostCardIndex=0;
  S.audience=[];
  S.hostCards=[];
  if(!host && !fromSelf){
    if(!S.interactedLives.some(x=>String(x.id)===String(id))){
      S.interactedLives.unshift({...S.currentRoom,id:id});
    }
  }
  S.collapsed=false;$('miniLive').classList.remove('show');
  const bb=$('barrageBox'); if(bb) bb.innerHTML='';
  // 展示首页刷新时已生成的初始卡片/弹幕
  S.hostCards=Array.isArray(S.currentRoom.cards)?S.currentRoom.cards.slice():[];
  S.audience=Array.isArray(S.currentRoom.barrage)?S.currentRoom.barrage.slice():[];
  if(S.currentRoom.userCard) S.hostCards=[S.currentRoom.userCard];
  updateLiveQuoteBar();openPage('liveRoom');
  updateLiveHomeBackDot();
  renderRoom();
  // 没有预生成内容时才补一次，避免进去一片空白（有内容的房间不会额外调用 API）
  if(!S.hostCards.length && !S.audience.length && !S.isHost){
    refreshRoom().catch(e=>{ if(!isAliasChanged(e)) haloFail('直播内容生成失败',e); });
  }
}
function openRoomRecap(id){
  const rc=S.roomRecaps&&S.roomRecaps[String(id)];
  if(!rc){showToast('这场直播没有记录');return;}
  S.currentRoom={id:rc.id,title:rc.title,topic:rc.topic,desc:rc.desc,hostName:rc.hostName,dual:false};
  S.hostCards=(rc.cards||[]).slice();
  S.roomLog=(rc.log||[]).slice();
  S.audience=(rc.audience||[]).slice();
  S.gifts=Object.assign({},rc.giftMap||{});
  S.isHost=false;S.cohostPresent=false;S.collapsed=false;S.micState='idle';
  const mini=$('miniLive');if(mini)mini.classList.remove('show');
  const bb=$('barrageBox'); if(bb) bb.innerHTML='';
  S.history=['liveHome','summary'];openPage('summary',false);
  updateLiveHomeBackDot();
}
function renderRoom(){
  const r=S.currentRoom;if(!r)return;
  const hostChar=charByName(r.hostName);
  const me=currentIdentity();
  const coHostName=r.cohostName||'';
  let primary,secondary=null,nameText='',modeText='';
  if(S.isHost){
    primary={av:me.avatarImage,text:(me.name||'YOU').slice(0,2)};
    if(S.cohostPresent){const cc=charByName(coHostName);secondary={av:cc&&cc.avatar?cc.avatar:null,text:(coHostName||'CH').charAt(0)};}
    nameText=S.cohostPresent?((me.name||'You')+' + '+(coHostName||'Char')):(me.name||'You');
    modeText=S.cohostPresent?'YOU + CHAR':'SOLO';
  }else{
    primary={av:(hostChar&&hostChar.avatar)||r.hostAvatarImage||null,text:(r.hostName||'H').charAt(0)};
    if(r.dual||S.cohostPresent) secondary={av:null,text:(coHostName||'B').charAt(0)};
    nameText=(r.hostName||'主播')+((r.dual||S.cohostPresent)?(' + '+(coHostName||'嘉宾')):'');
    modeText=(r.dual||S.cohostPresent)?'DUO':'SOLO';
  }
  $('roomTopic').textContent='LIVE / '+r.topic;
  $('roomMode').textContent=modeText;
  $('roomHostName').textContent=nameText;
  $('roomViewers').textContent=(r.viewers||'0')+' watching';
  const avTag=(o,cls)=>`<div class="avatar${cls?' '+cls:''}"${avStyle(o.av)}>${imgOk(o.av)?'':`<span>${esc(o.text)}</span>`}</div>`;
  $('roomIdentity').innerHTML=avTag(primary)+(secondary?avTag(secondary,'dual'):'');
  $('roomInput').placeholder=isOnStage()?'写下这一刻的内容…':'发一条弹幕…';
  renderHostCard();renderBarrage();updateMiniLive();
}

/* ===== 直播开摄像头（只有自己开播时可开；默认关；按钮在右上角） ===== */
let liveCamStream=null, liveCamOn=false, liveCamTimer=null;
function liveNowHM(){const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function setupLiveCamera(){
  const page=document.getElementById('liveRoom');
  const host=!!(S.isHost && page && page.classList.contains('active'));
  if(!host){ removeLiveCameraUI(); return; }
  let btn=document.getElementById('liveCamBtn');
  if(!btn){
    btn=document.createElement('button'); btn.id='liveCamBtn'; btn.title='开/关摄像头';
    btn.style.cssText='position:fixed;right:14px;top:14px;z-index:70;width:40px;height:40px;border-radius:50%;border:0;background:rgba(255,255,255,.94);box-shadow:0 4px 14px rgba(0,0,0,.2);display:grid;place-items:center;color:#111';
    btn.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>';
    btn.addEventListener('click',function(){ toggleLiveCamera(); });
    document.body.appendChild(btn);
  }
  if(liveCamOn) attachLiveVideo();
}
// 摄像头画面放在「主播区」（host-card 正文里，主播气泡下方），不遮挡输入框和弹幕
function attachLiveVideo(){
  const body=document.getElementById('hostCardBody'); if(!body) return;
  let pv=document.getElementById('liveCamPreview');
  if(!pv){
    pv=document.createElement('video'); pv.id='liveCamPreview'; pv.autoplay=true; pv.muted=true; pv.playsInline=true;
    pv.style.cssText='width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:14px;background:#000;margin-top:10px;display:block;box-shadow:0 6px 18px rgba(0,0,0,.25)';
  }
  if(pv.parentNode!==body) body.appendChild(pv);
  if(liveCamStream) pv.srcObject=liveCamStream;
}
function closeLiveCamera(){
  liveCamOn=false;
  try{ if(liveCamTimer){clearInterval(liveCamTimer);} }catch(e){} liveCamTimer=null;
  try{ if(liveCamStream){liveCamStream.getTracks().forEach(function(t){try{t.stop();}catch(e){}});} }catch(e){} liveCamStream=null;
  const pv=document.getElementById('liveCamPreview'); if(pv){try{pv.srcObject=null;}catch(e){} pv.remove();}
  const b=document.getElementById('liveCamBtn'); if(b) b.style.background='rgba(255,255,255,.94)';
}
function removeLiveCameraUI(){
  closeLiveCamera();
  const b=document.getElementById('liveCamBtn'); if(b) b.remove();
}
async function toggleLiveCamera(){
  if(liveCamOn){ closeLiveCamera(); showToast('已关闭摄像头'); return; }
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){ showToast('设备不支持摄像头'); return; }
  try{
    liveCamStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false});
    liveCamOn=true;
    attachLiveVideo();
    const b=document.getElementById('liveCamBtn'); if(b) b.style.background='#ffd0dd';
    showToast('已开启摄像头');
    setTimeout(liveCamTick,3000);
    if(liveCamTimer) clearInterval(liveCamTimer);
    liveCamTimer=setInterval(liveCamTick,25000);
  }catch(e){ showToast('开启摄像头失败（需授权）'); }
}
async function liveCamTick(){
  if(!liveCamOn||!liveCamStream) return;
  const v=document.getElementById('liveCamPreview');
  if(!v||!v.videoWidth) return;
  const w=480,h=Math.round(v.videoHeight*(w/v.videoWidth));
  const c=document.createElement('canvas'); c.width=w; c.height=h;
  try{ c.getContext('2d').drawImage(v,0,0,w,h);}catch(e){return;}
  const dataURL=c.toDataURL('image/jpeg',0.6);
  const names=(S.audience||[]).map(function(x){return x&&x.name;}).filter(function(n){return n&&n!=='系统'&&n!=='你';});
  const viewer=names.length?names[Math.floor(Math.random()*names.length)]:'观众';
  const vc=charByName(viewer);
  const me=currentIdentity();
  let sys='你正在看一场直播，主播「'+(me.name||'用户')+'」开着摄像头。你是弹幕观众「'+viewer+'」';
  if(vc&&vc.setting) sys+='，'+String(vc.setting).slice(0,300);
  sys+='。看到直播画面，发一条自然、口语的弹幕短评（10-30 字），可以夸、吐槽、起哄、好奇，别像旁白，不要引号。只输出这一句。';
  try{
    const raw=await callMainAPI([
      {role:'system',content:sys},
      {role:'user',content:[{type:'text',text:'这是主播此刻的直播画面。'},{type:'image_url',image_url:{url:dataURL}}]}
    ],{temperature:0.95, extra:{max_tokens:120}});
    const text=(raw&&raw.choices&&raw.choices[0]&&raw.choices[0].message&&raw.choices[0].message.content||'').trim();
    if(text){
      try{ (S.audience=S.audience||[]).push({name:viewer,text:text.slice(0,60),time:liveNowHM()}); renderBarrage(); }catch(e){}
    }
  }catch(e){ showToast('弹幕识别失败：'+((e&&e.message)||e)); }
}
window.toggleLiveCamera=toggleLiveCamera;

function cohostCardLabel(who){
  if(who==='B') return 'B / CO-HOST';
  if(who==='C') return 'C / GUEST';
  return S.cohostPresent?'A / HOST':'HOST / LIVE';
}
function renderHostCard(){
  const cards=S.hostCards||[];
  if(!cards.length){
    $('hostCardWho').textContent=S.cohostPresent?'A / HOST':'HOST / LIVE';
    $('hostCardNav').style.display='none';
    $('hostCardNarration').textContent='';
    $('hostCardSpeech').textContent='';
    $('hostCardBody').scrollTop=0;
    updateMiniLive();
    return;
  }
  if(S.hostCardIndex>=cards.length) S.hostCardIndex=0;
  const c=cards[S.hostCardIndex];
  $('hostCardWho').textContent = cohostCardLabel(c.who);
  const nav=$('hostCardNav');
  if(cards.length>1){nav.style.display='flex';$('hostCardPg').textContent=(S.hostCardIndex+1)+' / '+cards.length;}
  else nav.style.display='none';
  $('hostCardNarration').textContent=c.narration||'';
  $('hostCardSpeech').textContent=c.speech||'';
  $('hostCardBody').scrollTop=0;
  updateMiniLive();
}
function prevHostCard(){if(S.hostCards.length<2)return;S.hostCardIndex=(S.hostCardIndex-1+S.hostCards.length)%S.hostCards.length;renderHostCard();}
function nextHostCard(){if(S.hostCards.length<2)return;S.hostCardIndex=(S.hostCardIndex+1)%S.hostCards.length;renderHostCard();}

function renderBarrage(){
  const box=$('barrageBox');
  const existing=box.querySelectorAll('.barrage').length;
  const list=S.audience.slice(existing);
  if(!list.length){updateMiniLive();return;}
  const frag=document.createDocumentFragment();
  list.forEach((x,offset)=>{
    const idx=existing+offset;
    const d=document.createElement('div');
    let cls='barrage';
    if(x.mine)cls+=' mine';
    if(x.gift)cls+=' gift-barrage';
    if(x.system)cls+=' system-barrage';
    d.className=cls;d.dataset.idx=idx;
    let inner='';
    if(x.quote) inner+=`<span class="quote">${esc(x.quote.name)}：${esc(x.quote.text)}</span>`;
    inner+=`<span class="bn">${esc(x.name)}</span><span class="bt">${esc(x.text)}</span>`;
    if(x.reacts&&Object.keys(x.reacts).length){
      inner+='<span class="reacts">'+Object.entries(x.reacts).map(([e,n])=>`<span>${e}${n>1?' '+n:''}</span>`).join('')+'</span>';
    }
    d.innerHTML=inner;
    d.addEventListener('dblclick',ev=>{ev.stopPropagation();startQuoteBarrage(idx);});
    d.addEventListener('click',ev=>{ev.stopPropagation();openBarrageMenu(ev,idx,'live');});
    frag.appendChild(d);
  });
  box.appendChild(frag);
  requestAnimationFrame(()=>{box.scrollTop=box.scrollHeight});
  updateMiniLive();
}
function scrollBarrageTop(){const box=$('barrageBox');box.scrollTop=0;showToast('已查看最早弹幕')}

/* 通用菜单：直播弹幕 + 聊天共用 DOM，但函数分离 */
let menuTargetIdx=null, menuMode='live';

function buildBarrageMenuEmojis(){
  $('bmEmojis').innerHTML=EMOJIS.map(e=>`<button onclick="onMenuEmoji('${e}')">${e}</button>`).join('');
}
function openBarrageMenu(ev,idx,mode='live'){
  // 直播弹幕菜单
  menuMode='live';
  menuTargetIdx=idx;
  chatMenuTarget=null;
  $('bmEmojis').innerHTML=EMOJIS.map(e=>`<button onclick="reactBarrage('${e}')">${e}</button>`).join('');
  $('bmActions').innerHTML=`<button onclick="menuQuoteBarrage()">引用</button><button onclick="closeBarrageMenu()">取消</button>`;
  showMenuAt(ev);
}
function closeBarrageMenu(){
  $('barrageMenu').classList.remove('show');
  menuTargetIdx=null;
  chatMenuTarget=null;
  menuMode='live';
}
function showMenuAt(ev){
  const m=$('barrageMenu');
  m.classList.add('show');
  const rect=m.getBoundingClientRect();
  let x=ev.clientX-rect.width/2, y=ev.clientY-rect.height-14;
  if(y<8) y=ev.clientY+20;
  x=Math.max(8,Math.min(x,window.innerWidth-rect.width-8));
  m.style.left=x+'px'; m.style.top=y+'px';
}
function onMenuEmoji(e){
  if(menuMode==='chat' && chatMenuTarget) reactChatMsg(e);
  else reactBarrage(e);
}
function reactBarrage(e){
  if(menuTargetIdx==null)return;
  const x=S.audience[menuTargetIdx];if(!x)return;
  if(!x.reacts)x.reacts={};
  x.reacts[e]=(x.reacts[e]||0)+1;
  const box=$('barrageBox');
  const el=box.querySelector(`.barrage[data-idx="${menuTargetIdx}"]`);
  if(el){
    let reacts=el.querySelector('.reacts');
    if(!reacts){reacts=document.createElement('span');reacts.className='reacts';el.appendChild(reacts);}
    reacts.innerHTML=Object.entries(x.reacts).map(([ee,n])=>`<span>${ee}${n>1?' '+n:''}</span>`).join('');
  }
  closeBarrageMenu();
}
function startQuoteBarrage(idx){
  const x=S.audience[idx];if(!x)return;
  S.liveQuote={name:x.name,text:x.text};
  closeBarrageMenu();updateLiveQuoteBar();
  $('roomInput').focus();showToast('已引用，输入内容后发送');
}
function menuQuoteBarrage(){
  if(menuMode==='chat') quoteChatMsg();
  else if(menuTargetIdx!=null) startQuoteBarrage(menuTargetIdx);
}
function updateLiveQuoteBar(){
  const bar=$('liveQuoteBar');
  if(S.liveQuote){bar.classList.add('show');bar.innerHTML=`引用 <b>${esc(S.liveQuote.name)}</b>：${esc(S.liveQuote.text)}`;}
  else bar.classList.remove('show');
}
function clearLiveQuote(){S.liveQuote=null;updateLiveQuoteBar();}

function isOnStage(){return S.isHost || S.micState==='approved';}
function sendLiveInput(){ if(isOnStage()) sendHostContent(); else sendBarrage(); }
function sendBarrage(){
  const input=$('roomInput');const t=input.value.trim();if(!t)return;
  const item={name:'我',text:t,mine:true};
  if(S.liveQuote){item.quote={name:S.liveQuote.name,text:S.liveQuote.text};clearLiveQuote();}
  S.audience.push(item);
  input.value='';renderBarrage();showToast('弹幕已发送');
}
function sendHostContent(){
  const input=$('roomInput');const t=input.value.trim();if(!t)return;
  const narration=looksNarration(t)?t:'';
  const speech=looksNarration(t)?'':t;
  const me=currentIdentity();
  if(S.isHost){
    S.hostCards[0]={who:'A',narration,speech};
  }else{
    // 上麦的嘉宾：单独一张嘉宾卡片，不动主播自己的卡
    S.hostCards[2]={who:'C',name:me.name,narration,speech};
  }
  S.roomLog.push({who:'user',kind:narration?'narration':'speech',text:t});
  clearLiveQuote();input.value='';
  if(S.hostCardIndex>=S.hostCards.length) S.hostCardIndex=0;
  renderHostCard();showToast('已更新主播卡');
}
function assertSameAlias(genAlias){ if(S.activeAliasId!==genAlias) throw new Error('__alias_changed__'); }
function isAliasChanged(e){ return String((e&&e.message)||e||'')==='__alias_changed__'; }
function tagDescOf(name){
  const t=(S.liveTags||[]).find(x=>x.name===name&&x.desc);
  if(t&&t.desc) return String(t.desc);
  if(/18|成人|r18|色|污|涩|重口/i.test(String(name||''))) return '成人向露骨板块：性、身体、情欲、重口玩梗，允许大胆直白（不写违法内容）';
  return '';
}
/* 按直播间标题/话题/简介 + 板块描述 + 主播人设，生成主播卡片 + 弹幕
   mode: 'both' 生成卡片+弹幕；'barrage' 只生成弹幕（自己单人直播时） */
async function generateRoomContent(mode){
  mode=mode||'both';
  const r=S.currentRoom||{};
  const tagDesc=tagDescOf(r.topic);
  const hostChar=S.isHost?null:charByName(r.hostName);
  const hostName=S.isHost?(currentIdentity().name||'我'):(r.hostName||'主播');
  const hostSetting=S.isHost?currentUserSetting():((hostChar&&hostChar.setting)||'');
  const recentCards=(S.hostCards||[]).slice(-2).map(c=>(c.who||'A')+'：'+(c.narration||'')+' '+(c.speech||'')).filter(Boolean).join('\n');
  const recentBarrage=(S.audience||[]).slice(-12).filter(x=>!x.gift&&x.text).map(x=>(x.mine?'我（用户）':x.name)+'：'+x.text).join('\n');
  // 读取用户发过的话：既包括弹幕，也包括上麦后作为主播卡片说的内容
  const myBarrage=(S.audience||[]).filter(x=>x.mine&&x.text).slice(-6).map(x=>x.text);
  const myHost=(S.roomLog||[]).filter(m=>m.who==='user'&&m.text).slice(-6).map(m=>m.text);
  const mySaid=myBarrage.concat(myHost).slice(-8).map(x=>'“'+x+'”').join(' ');
  const sys=[];
  sys.push('你在模拟一个成人向、灰色地带的直播平台（风控低，可以大胆、暧昧、露骨、粗俗、玩梗，但不写违法内容）。');
  sys.push('必须严格按照给定的【板块描述】【直播标题】【话题】【简介】和主播人设来生成，不能跑题、不能生成与板块主题无关的内容。');
  if(mode==='both') sys.push('主播卡片：主播之间互动，也会回应弹幕区的其他观众——不只是回应某一个人。narration 用 2-3 句画面/动作/氛围描写；speech 是主播实际说的话，可以稍长（1-3 句），口语化、有来有回。');
  else sys.push('本次只生成弹幕，不要生成或修改主播卡片（cards 返回空数组）。');
  sys.push('弹幕：一次生成 12-20 条（绝对不少于 8 条），来自不同观众，风向多元——有夸奖、有挑刺骂声、有粗俗直白、有打趣玩梗、有提问、有求主播互动，紧扣板块与简介。');
  sys.push('【必须读用户最新发言】生成前先理解用户刚发的弹幕/主播卡片内容；主播卡片和弹幕都要针对性地回应或接住用户的话，不能无视。');
  sys.push('弹幕必须先回应用户刚发的弹幕/卡片内容（如果有）。');
  sys.push(DIVERSITY_NOTE);
  sys.push('【严禁】不要使用用户/主播的名字作为观众名，也不要替用户发弹幕；观众名前缀不能出现用户的身份名。');
  sys.push('礼物最多 1-2 个，可以为空。');
  sys.push('只输出 JSON，不要 markdown：{"cards":[{"who":"A","narration":"...","speech":"..."}],"barrage":[{"name":"观众网名","text":"弹幕内容"}],"gifts":[{"name":"观众网名","gift":"星星","value":1}]}');
  if(mode==='both') sys.push(S.cohostPresent?'这是双人直播：cards 必须给出 A 和 B 两条。':'这是单人直播：cards 只给 A 一条。');
  if(hostSetting) sys.push('【主播人设 · 严格遵守】\n'+String(hostSetting).slice(0,1400));
  if(S.isHost) sys.push('【主播就是你（用户）】你以「'+hostName+'」的身份主播，你的设定：'+(currentUserSetting()||'无')+'。卡片里的 A 代表你。');
  else sys.push('【主播】「'+hostName+'」是这场直播的主播。');
  if(hostChar&&hostChar.worldbookBindings&&S._worldbook){ const wb=HaloData.buildWorldbookText(S._worldbook,hostChar,recentCards+'\n'+recentBarrage); if(wb) sys.push('【世界书】\n'+wb); }
  if(!S.isHost&&hostChar&&hostChar.id&&!(S.activeAliasId&&S.activeAliasId!=='main')){ try{const mem=await HaloData.readMemoryText(hostChar.id,10); if(mem) sys.push('【长期记忆】\n'+mem);}catch(e){} }
  if(S.activeAliasId&&S.activeAliasId!=='main') sys.push('观众现在用的是小号「'+currentIdentity().name+'」，不要提及TA的其他身份，也不要说认识TA。');
  const usr='【板块】'+(r.topic||'')+(tagDesc?('（'+tagDesc+'）'):'')
    +'\n直播标题：'+(r.title||'')+'\n简介：'+(r.desc||'')
    +'\n用户个签：'+(currentIdentity().signature||'无')
    +(mySaid?('\n\n用户刚发的弹幕/话：'+mySaid):'')
    +(recentCards?('\n\n最近的直播内容：\n'+recentCards):'')
    +(recentBarrage?('\n\n最近的弹幕：\n'+recentBarrage):'');
  const obj=await HaloData.callMainJSON([{role:'system',content:sys.join('\n\n')},{role:'user',content:usr}],{temperature:1.05});
  const cards=(mode==='both'&&Array.isArray(obj&&obj.cards)?obj.cards:[])
    .map(c=>({who:String((c&&c.who)||'A').slice(0,2),narration:String((c&&c.narration)||'').trim(),speech:String((c&&c.speech)||'').trim()}))
    .filter(c=>c.narration||c.speech);
  const banned=[hostName,currentIdentity().name].filter(Boolean);
  const barrage=(Array.isArray(obj&&obj.barrage)?obj.barrage:[])
    .map(b=>({name:String((b&&b.name)||'').slice(0,20),text:String((b&&b.text)||'').trim()}))
    .filter(b=>b.text&&banned.indexOf(b.name)<0)
    .map(b=>({name:b.name||rand(CN_AUDIENCE)||'',text:b.text}));
  const gifts=(Array.isArray(obj&&obj.gifts)?obj.gifts:[]).slice(0,2)
    .map(g=>({name:String((g&&g.name)||'观众').slice(0,20),gift:String((g&&g.gift)||'星星').slice(0,10),value:Number(g&&g.value)||1}))
    .filter(g=>banned.indexOf(g.name)<0);
  return {cards,barrage,gifts};
}
async function refreshRoom(){
  if(!S.currentRoom) return false;
  S._lastRoomError=null;
  if(!S._apiReady||typeof HaloData==='undefined'){ const e=new Error('未配置主 API'); S._lastRoomError=e; throw e; }
  const genAlias=S.activeAliasId;
  const soloOwn=S.isHost&&!S.cohostPresent;
  const g=await generateRoomContent(soloOwn?'barrage':'both');
  assertSameAlias(genAlias);
  if(!g.cards.length&&!g.barrage.length){ const e=new Error('AI 未返回有效的直播内容'); S._lastRoomError=e; throw e; }
  if(g.cards.length){ S.hostCards=g.cards; S.hostCardIndex=0; g.cards.forEach(c=>S.roomLog.push({who:S.isHost?'user':'char',kind:'narration',text:c.narration},{who:S.isHost?'user':'char',kind:'speech',text:c.speech})); }
  g.barrage.forEach(b=>S.audience.push({name:b.name,text:b.text,time:nowHM()}));
  g.gifts.forEach(gt=>{ S.gifts[gt.name]=(S.gifts[gt.name]||0)+gt.value; S.audience.push({name:gt.name,text:'送出了 '+gt.gift,gift:true,time:nowHM()}); flyGift(gt.name,gt.gift,gt.value); });
  renderHostCard(); renderBarrage();
  return true;
}
function flyGift(who,name,value){
  const layer=$('giftFlyLayer');if(!layer)return;
  const el=document.createElement('div');
  el.className='gift-fly';
  el.innerHTML=`<span class="gv">${giftSvg(name)||''}${value}</span>${esc(who)} 送出 ${esc(name)}`;
  const top = 70 + Math.random()*Math.max(60, layer.clientHeight-200);
  el.style.top = top+'px';layer.appendChild(el);
  setTimeout(()=>{if(el.parentNode)el.parentNode.removeChild(el)},7200);
}
let giftAmbientTimer=null;
function endLive(){
  clearInterval(giftAmbientTimer);
  const r=S.currentRoom;
  if(r){
    // 直播总结（任何房间都生成，保证非空）
    let log=[...(S.roomLog||[])];
    const cards=(S.hostCards||[]).slice(0,4);
    if(!log.length && cards.length){
      cards.forEach(c=>{
        if(c.narration) log.push({who:'char',kind:'narration',text:c.narration});
        if(c.speech) log.push({who:'char',kind:'speech',text:c.speech});
      });
    }
    if(!log.length && !(S.audience||[]).length){
      log.push({who:'char',kind:'narration',text:'这场直播很快就结束了，但你们还是在这里待了一会儿。'});
    }
    S.roomRecaps=S.roomRecaps||{};
    S.roomRecaps[String(r.id)]={
      id:String(r.id),title:r.title||'',topic:r.topic||'',desc:r.desc||'',
      hostName:S.isHost?(currentIdentity().name||''):(r.hostName||''),
      cards,log,audience:[...(S.audience||[])].slice(-40),giftMap:{...(S.gifts||{})},at:nowMin()
    };
    if(S.isHost){
      if(!(S.myOwnLives||[]).some(x=>String(x.id)===String(r.id))) S.myOwnLives.unshift(Object.assign({},r));
      S.myReplays.unshift({
        id:'r'+Date.now(),
        title:(r.title||'这场直播')+' · 完整回放',
        meta:log.length+' 条对话 / '+(S.audience||[]).length+' 条弹幕 · 刚刚',
        dur:Math.max(1,Math.round((log.length+(S.audience||[]).length)*0.4))+':00',
        log,audience:[...(S.audience||[])],giftMap:{...(S.gifts||{})}
      });
    }
    // 让总结页展示这一场（保留标题等）
    S.currentRoom={id:r.id,title:r.title,topic:r.topic,desc:r.desc,hostName:r.hostName,dual:false};
    S.hostCards=cards;S.roomLog=log;S.audience=[...(S.audience||[])];
  }
  S.isHost=false;S.cohostPresent=false;S.micState='idle';
  S.collapsed=false;$('miniLive').classList.remove('show');
  S.history=['liveHome','summary'];openPage('summary',false);
  updateLiveHomeBackDot();
  renderMine();
  saveHaloState();
}

/* ============ 小窗 ============ */
function collapseLive(){
  if(!S.currentRoom) return;
  S.collapsed=true;
  S.history=['liveHome'];
  openPage('liveHome',false);
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page==='liveHome'));
  updateMiniLive();
  const mini=$('miniLive');
  mini.classList.add('show');
  mini.style.right='14px';
  mini.style.bottom='calc(0px + 92px)';
  mini.style.left='auto';mini.style.top='auto';
  requestAnimationFrame(clampMini);
  updateLiveHomeBackDot();
  showToast('已折叠为小窗，可拖动');
}
function expandLive(){
  S.collapsed=false;
  $('miniLive').classList.remove('show');
  S.history=['liveHome','liveRoom'];
  openPage('liveRoom',false);
  updateLiveHomeBackDot();
  showToast('已展开直播间');
}
function exitLiveFromMini(){
  // 小窗上的叉叉 = 结束这场直播，之后点进去看总结
  const mini=$('miniLive');if(mini)mini.classList.remove('show');
  endLive();
  return;
}
function updateMiniLive(){
  if(!S.collapsed||!S.currentRoom) return;
  const r=S.currentRoom;
  $('miniTitle').textContent=(r.title||'Live');
  const c=S.hostCards[S.hostCardIndex]||{};
  const last=S.audience.slice(-1)[0]||{};
  $('miniBody').innerHTML=`${esc((c.speech||c.narration||'').slice(0,48))}<br><span style="color:var(--soft)">${esc(last.name||'')}：${esc(last.text||'')}</span>`;
}
function clampMini(){
  const mini=$('miniLive');if(!mini) return;
  const rect=mini.getBoundingClientRect();
  const app=$('app').getBoundingClientRect();
  if(mini.style.left && mini.style.left!=='auto'){
    const maxL=app.width-rect.width-8;
    const maxT=app.height-rect.height-8;
    const nl=Math.max(8,Math.min(rect.left-app.left,maxL));
    const nt=Math.max(8,Math.min(rect.top-app.top,maxT));
    mini.style.left=nl+'px';mini.style.top=nt+'px';
  }
}
function initMiniDrag(){
  const mini=$('miniLive');
  let dragging=false,sx=0,sy=0,ox=0,oy=0;
  const onDown=(e)=>{
    const t=e.touches?e.touches[0]:e;
    if(e.target.closest('button')) return;
    dragging=true;mini.classList.add('dragging');
    const r=mini.getBoundingClientRect();
    const app=$('app').getBoundingClientRect();
    sx=t.clientX;sy=t.clientY;ox=r.left-app.left;oy=r.top-app.top;
    mini.style.right='auto';mini.style.bottom='auto';
    mini.style.left=ox+'px';mini.style.top=oy+'px';
    e.preventDefault();
  };
  const onMove=(e)=>{
    if(!dragging)return;
    const t=e.touches?e.touches[0]:e;
    const app=$('app').getBoundingClientRect();
    const dx=t.clientX-sx,dy=t.clientY-sy;
    let nl=ox+dx,nt=oy+dy;
    const maxL=app.width-mini.offsetWidth-8;
    const maxT=app.height-mini.offsetHeight-8;
    nl=Math.max(8,Math.min(nl,maxL));
    nt=Math.max(8,Math.min(nt,maxT));
    mini.style.left=nl+'px';mini.style.top=nt+'px';
    e.preventDefault();
  };
  const onUp=()=>{
    if(!dragging)return;
    dragging=false;mini.classList.remove('dragging');
    const r=mini.getBoundingClientRect();
    const app=$('app').getBoundingClientRect();
    const leftZone=(r.left-app.left)+r.width/2 < app.width/2;
    const targetLeft=leftZone?12:(app.width-r.width-12);
    mini.style.transition='left .22s ease';
    mini.style.left=targetLeft+'px';
    setTimeout(()=>{mini.style.transition='';},260);
  };
  mini.addEventListener('mousedown',onDown);
  mini.addEventListener('touchstart',onDown,{passive:false});
  window.addEventListener('mousemove',onMove);
  window.addEventListener('touchmove',onMove,{passive:false});
  window.addEventListener('mouseup',onUp);
  window.addEventListener('touchend',onUp);
}

/* ============ 操作面板 ============ */
function openActionSheet(){$('actionSheet').classList.add('show')}
function closeActionSheet(){$('actionSheet').classList.remove('show')}
function openSubSheet(id){
  closeActionSheet();
  if(id==='dmSheet')renderDMSheet();
  if(id==='charSheet')renderCharSheet();
  if(id==='micSheet')renderMicSheet();
  if(id==='shareSheet')renderShareSheet();
  $(id).classList.add('show');
}
function closeSubSheet(id){$(id).classList.remove('show')}

function renderDMSheet(){
  const list=Object.keys(S.chatLog).slice(0,8);
  if(!list.length){
    $('dmSheetList').innerHTML=`<div class="muted small" style="text-align:center;padding:14px 0">还没有可以私聊的对象。</div>`;
    return;
  }
  $('dmSheetList').innerHTML=list.map(name=>{
    const log=S.chatLog[name]||[];
    const prev=log.length? (log[log.length-1].text||log[log.length-1].foreign||'…') : '还没有聊天';
    const meta=(S.dmFriends||[]).find(x=>x.name===name)||(S.dmStrangers||[]).find(x=>x.name===name)||{};
    return `<button class="sub-row" data-name="${esc(name)}" onclick="pickDM(this.dataset.name)">
      <div class="sub-av"${avStyle(meta.avatar)}>${imgOk(meta.avatar)?'':esc(name.charAt(0))}</div>
      <div class="sub-info"><div class="sub-name">${esc(name)}</div><div class="sub-desc">${esc(prev)}</div></div>
      <span class="sub-go">私聊</span>
    </button>`;
  }).join('');
}
function pickDM(name){
  closeSubSheet('dmSheet');
  if(!S.chatLog[name]) S.chatLog[name]=[];
  const meta=(S.dmFriends||[]).find(x=>x.name===name)||(S.dmStrangers||[]).find(x=>x.name===name)||{};
  S.currentGroup={name:name,members:'1',topic:'私聊',desc:'来自直播间的私聊',isDM:true,
    charId:meta.charId||null,avatar:meta.avatar||null,isCharMask:!!meta.isCharMask,
    maskId:meta.maskId||null,maskOwner:meta.maskOwner||null,revealedAs:meta.revealedAs||null};
  S.chatFrom='liveRoom';openPage('groupChat');
}
function renderCharSheet(){
  const chars=(S._realChars||[]);
  if(!chars.length){
    $('charSheetList').innerHTML=`<div class="muted small" style="text-align:center;padding:14px 0">角色库里还没有可邀请的 char。</div>`;
    return;
  }
  $('charSheetList').innerHTML=chars.map(c=>`
    <button class="sub-row" data-name="${esc(c.name)}" onclick="inviteChar(this.dataset.name)">
      <div class="sub-av"${avStyle(c.avatar)}>${imgOk(c.avatar)?'':esc(c.avatarLetter||c.name.charAt(0))}</div>
      <div class="sub-info"><div class="sub-name">${esc(c.name)}</div><div class="sub-desc">${esc(c.desc)}</div></div>
      <span class="sub-go">邀请</span>
    </button>`).join('');
}
function inviteChar(name){
  closeSubSheet('charSheet');
  if(!S.isHost){showToast('只有主播可以邀请 char');return}
  makeRoomDual('CH', name);
  S.audience.push({name:'系统',text:`已邀请 ${name} 加入双人直播`,system:true});
  if(!S.chatLog[name]) S.chatLog[name]=[];
  S.chatLog[name].push({who:'system',kind:'invite',name:'System',text:`${currentIdentity().name} 邀请你一起直播`,invited:name,status:'pending',time:nowHM(),at:nowMin()});
  renderBarrage();renderHostCard();showToast(`已邀请 ${name}`);
}
function makeRoomDual(tag,name){
  if(!S.currentRoom) return;
  S.currentRoom.dual=true;S.cohostPresent=true;
  if(name) S.currentRoom.cohostName=name;
  if(S.hostCards.length<2){
    S.hostCards.push({who:'B',name:name||'嘉宾',narration:'TA稍微坐直了一点，目光落在镜头上。',speech:'大家好，我也在这里。'});
  }else if(name){
    S.hostCards[1].name=name;
    S.hostCards[1].speech = `我是 ${name}。`;
  }
  renderRoom();
}
function renderMicSheet(){
  const map={
    idle:'你还没有提交申请。',
    pending:'申请已提交，等待主播回应…（点刷新查看结果）',
    approved:'主播已同意你上麦，你已经在主播位，发言会进入主播卡。',
    rejected:'主播暂时没有同意你的上麦申请。'
  };
  $('micStatus').textContent=map[S.micState]||map.idle;
  const btn=$('micApplyBtn');
  if(S.micState==='pending'){btn.textContent='刷新查看结果';btn.onclick=refreshMic;}
  else if(S.micState==='idle'||S.micState==='rejected'){btn.textContent='申请上麦';btn.onclick=applyMic;}
  else{btn.textContent='已上麦';btn.onclick=()=>{};}
}
function applyMic(){
  S.micState='pending';
  S.audience.push({name:'系统',text:'你提交了上麦申请，等待主播回应',system:true});
  renderBarrage();renderMicSheet();showToast('已提交申请');
}
function refreshMic(){
  const ok=Math.random()>0.35;
  if(ok){
    S.micState='approved';makeRoomDual('ME');
    S.audience.push({name:'系统',text:'主播同意了你的上麦申请',system:true});
    showToast('主播同意了，你已上麦');
  }else{
    S.micState='rejected';
    S.audience.push({name:'系统',text:'主播暂时没有同意你的上麦申请',system:true});
    showToast('主播暂时没同意');
  }
  renderBarrage();renderMicSheet();renderHostCard();
}
function sendGift(name,value){
  const who=currentIdentity().name||'我';
  S.gifts[who]=(S.gifts[who]||0)+value;
  S.audience.push({name:who,text:`送出了 ${name}`,gift:true,mine:true});
  closeSubSheet('giftSheet');renderBarrage();flyGift(who,name,value);
  showToast(`你送出了 ${name}`);
}

/* ============ 分享 ============ */
function openShareSheet(){ renderShareSheet(); $('shareSheet').classList.add('show'); }
function isGroupName(name){return (S.groups||[]).some(g=>g&&g.name===name);}
function renderShareSheet(){
  const friends=S.dmFriends||[];
  const groups=S.groups||[];
  const rows=[];
  friends.forEach(d=>{
    const log=S.chatLog[d.name]||[];
    const last=log.length?(log[log.length-1].text||log[log.length-1].foreign||'已开始聊天'):'还没有聊天';
    rows.push(`<button class="sub-row" onclick="shareTo('${esc(d.name)}')">
      <div class="sub-av"${avStyle(d.avatar)}>${imgOk(d.avatar)?'':esc(d.avatarLetter||d.name.charAt(0))}</div>
      <div class="sub-info"><div class="sub-name">${esc(d.name)}</div><div class="sub-desc">好友 · ${esc(last)}</div></div>
      <span class="sub-go">分享</span></button>`);
  });
  groups.forEach(g=>{
    rows.push(`<button class="sub-row" onclick="shareTo('${esc(g.name)}')">
      <div class="sub-av">${esc(String(g.name).charAt(0))}</div>
      <div class="sub-info"><div class="sub-name">${esc(g.name)}</div><div class="sub-desc">群聊 · ${esc(g.topic||'')}</div></div>
      <span class="sub-go">分享</span></button>`);
  });
  $('shareList').innerHTML=rows.length?rows.join(''):`<div class="muted small" style="text-align:center;padding:14px 0">暂时没有可分享的好友或群聊。</div>`;
}
/* 直播总结分享：独立全局弹窗（可从总结页打开），好友 + 群聊都能选 */
function openRecapShareSheet(){
  let modal=$('haloRecapShareModal');
  if(!modal){
    modal=document.createElement('div');modal.className='modal';modal.id='haloRecapShareModal';
    modal.innerHTML='<div class="sheet"><div class="grab"></div><h2>分享这场直播总结</h2><div id="haloRecapShareList" style="max-height:50vh;overflow:auto;margin-bottom:8px"></div><button class="secondary-wide" onclick="closeRecapShareSheet()">取消</button></div>';
    document.body.appendChild(modal);
  }
  const box=$('haloRecapShareList');
  const friends=S.dmFriends||[];const groups=S.groups||[];
  const rows=[];
  friends.forEach(d=>rows.push(`<button class="sub-row" onclick="shareToTarget('${esc(d.name)}','dm')"><div class="sub-av"${avStyle(d.avatar)}>${imgOk(d.avatar)?'':esc(d.avatarLetter||d.name.charAt(0))}</div><div class="sub-info"><div class="sub-name">${esc(d.name)}</div><div class="sub-desc">好友</div></div><span class="sub-go">分享</span></button>`));
  groups.forEach(g=>rows.push(`<button class="sub-row" onclick="shareToTarget('${esc(g.name)}','group')"><div class="sub-av">${esc(String(g.name).charAt(0))}</div><div class="sub-info"><div class="sub-name">${esc(g.name)}</div><div class="sub-desc">群聊 · ${esc(g.topic||'')}</div></div><span class="sub-go">分享</span></button>`));
  if(box) box.innerHTML=rows.length?rows.join(''):`<div class="muted small" style="text-align:center;padding:14px 0">还没有可分享的好友或群聊。</div>`;
  modal.classList.add('show');
}
function closeRecapShareSheet(){const m=$('haloRecapShareModal');if(m)m.classList.remove('show')}
function shareTo(name){ closeSubSheet('shareSheet'); shareToTarget(name, isGroupName(name)?'group':'dm'); }
function shareToTarget(name,type){
  closeRecapShareSheet();
  if(!name)return;
  const r=S.currentRoom||{};
  const snapshot={
    id:r.id,title:r.title||'这场直播',topic:r.topic||'直播',desc:r.desc||'',host:r.hostName||currentIdentity().name,
    cards:JSON.parse(JSON.stringify(S.hostCards||[])),
    audience:(S.audience||[]).slice(-8).map(x=>({name:x.name,text:x.text,gift:!!x.gift})),
    sharedAt:Date.now()
  };
  const isGroup=type==='group'||isGroupName(name);
  if(!S.chatLog[name])S.chatLog[name]=[];
  S.chatLog[name].push({who:'user',name:currentIdentity().name||'You',kind:'share',status:'pending',roomId:r.id,text:'分享了直播「'+snapshot.title+'」',share:snapshot,time:nowHM(),at:nowMin()});
  if(isGroup){ const g=(S.groups||[]).find(x=>x.name===name); if(g){g.last='分享了直播「'+snapshot.title+'」';g.time='刚刚';} renderGroupList(); }
  else { const f=(S.dmFriends||[]).find(x=>x.name===name); if(f){f.prev='分享了直播「'+snapshot.title+'」';f.time='刚刚';f.at=nowMin();f.unread=false;} renderDM(); }
  saveHaloState();
  openChat(name,isGroup?'group':'dm');
  showToast('已分享到 '+name+'，点卡片「回复/查看回应」看反应');
}
async function respondShare(chatName,idx){
  const log=S.chatLog[chatName]||[],m=log[idx];
  if(!m||m.status!=='pending')return;
  if(!S._apiReady||typeof HaloData==='undefined'){ haloFail('查看回应失败',new Error('未配置主 API')); return; }
  const snap=m.share||{};
  const isGroup=isGroupName(chatName);
  const shareText='直播标题：'+(snap.title||'')
    +'\n话题：'+(snap.topic||'')
    +'\n简介：'+(snap.desc||'')
    +'\n主播片段：'+((snap.cards||[]).map(c=>c.speech||c.narration).filter(Boolean).join(' / ')||'（无）');
  m.status='replied';
  renderChat();
  try{
    if(isGroup){
      const g=(S.groups||[]).find(x=>x.name===chatName)||{};
      normalizeGroupFans(g);
      const members=[...new Set([...(g.admins||[]),...(g.fans||[]),'阴阳怪气','键盘侠'])].slice(0,10);
      const sys='你在模拟群聊「'+chatName+'」（群简介：'+(g.desc||'无')+'）。有人分享了一场直播。请生成 3-6 条不同成员的反应：有人看好、有人挑刺、有人玩梗、有人追问，简短、每条单独一行。所有人都不得自称管理员或群主。'
        +'只输出 JSON：{"msgs":[{"name":"成员名","text":"消息"}]}，name 必须是这些成员之一：'+members.join('、')+'。';
      const obj=await HaloData.callMainJSON([{role:'system',content:sys},{role:'user',content:shareText}],{temperature:1.0});
      const msgs=(obj&&Array.isArray(obj.msgs))?obj.msgs:[];
      if(!msgs.length) throw new Error('AI 未返回内容');
      msgs.forEach(mm=>{
        const tx=String(mm&&mm.text||'').trim(); if(!tx)return;
        let sp=String(mm&&mm.name||'').trim();
        if(members.length&&members.indexOf(sp)<0) sp=rand(members);
        pushSplitChat(chatName,'member',tx,sp||'成员');
      });
      const lg=S.chatLog[chatName]||[];const last=lg[lg.length-1];
      if(g&&last){g.last=last.text||g.last;g.time='刚刚';g.unread=(g.unread||0)+1;}
      showToast(chatName+' 有人回应了');
    }else{
      const char=charByName(chatName); const target=dmMeta(chatName)||{};
      const setting=target.setting||(char&&char.setting)||'';
      const sys='你是「'+chatName+'」。对方刚把一场直播分享给你。根据你的人设和直播内容，生成 1-2 条你的回应（像真人发消息，可拆成多条短句、每条单独一行）：可以评价这场直播，也可以顺势把话题聊下去。不要旁白、不要暴露 AI 身份。';
      const usr='你的人设：'+(setting||'（无）')+'\n'+shareText;
      const txt=String(await HaloData.callMainText([{role:'system',content:sys},{role:'user',content:usr}],{temperature:0.95})||'').trim();
      if(!txt) throw new Error('AI 未返回内容');
      pushSplitChat(chatName,'other',txt,chatName);
      const meta=dmMeta(chatName);if(meta){const lg=S.chatLog[chatName]||[];const last=lg[lg.length-1];if(last){meta.prev=last.text||meta.prev;meta.time='刚刚';meta.unread=true;meta.at=nowMin();}}
      showToast(chatName+' 已回复');
    }
  }catch(e){
    m.status='pending';
    haloFail('查看回应失败',e);
  }
  renderChat();renderDM();renderGroupList();saveHaloState();
}
function watchSharedRoom(roomId,idx){
  const name=S.currentGroup?.name||'';const m=S.chatLog[name]?.[idx];if(m)m.status='replied';
  const r=S.liveRooms.concat(S.interactedLives,S.myOwnLives).find(x=>String(x.id)===String(roomId));
  if(r)watchLive(r.id,false,true);else showToast('这场直播已结束');
}

/* ============ 总结 ============ */
function renderSummary(){
  const r=S.currentRoom||{title:'这场直播'};
  $('summarySub').textContent=`${r.title} · ${S.roomLog.length} 条对话 · ${S.audience.length} 条观众记录`;
  $('statLines').textContent=S.roomLog.length;
  $('statBarrage').textContent=S.audience.length;
  $('statGifts').textContent=Object.values(S.gifts).reduce((a,b)=>a+b,0);
  $('summaryLog').innerHTML=[
    ...S.roomLog.map(x=>`<div class="summary-line"><span class="label">${x.who==='user'?'U / YOU':'C / CHAR'} · ${x.kind}</span>${esc(x.text)}</div>`),
    ...S.audience.map(x=>`<div class="summary-line"><span class="label">AUDIENCE · ${esc(x.name)}</span>${esc(x.text)}</div>`)
  ].join('');
  const ranks=Object.entries(S.gifts).sort((a,b)=>b[1]-a[1]);
  $('giftRanking').innerHTML=ranks.length?ranks.map((x,i)=>`<div class="rank"><div class="person"><b>${i+1}</b><span>${esc(x[0])}</span></div><span class="coin">${x[1]} points</span></div>`).join(''):`<div class="muted small" style="padding:14px 0">这场还没有收到礼物。</div>`;
}

/* ============ 私聊 tab ============ */
function switchDMTab(tab){
  S.dmTab=tab;
  document.querySelectorAll('#dmTabs .dm-tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));
  renderDM();
}
function renderDM(){
  const list=S.dmTab==='friend'?S.dmFriends:S.dmStrangers;
  if(!list.length){
    $('dmList').innerHTML=`<div class="mine-empty" style="padding:46px 12px;text-align:center;color:var(--muted);font-size:13px">${S.dmTab==='friend'?'还没有好友私聊。绑定角色后会出现在这里。':'还没有陌生人私信。'}</div>`;
    return;
  }
  $('dmList').innerHTML=list.map(d=>{
    const img=imgOk(d.avatar)?d.avatar:'';
    return `
    <div class="swipe-row">
      <div class="swipe-actions">
        <button onclick="swipePin('dm',this.parentNode.parentNode)">置顶</button>
        <button class="sw-del" onclick="swipeDelete('dm',this.parentNode.parentNode)">删除</button>
      </div>
      <button class="msg-row swipe-body" data-name="${esc(d.name)}" onclick="openChat(this.dataset.name,'dm')">
        <div class="msg-avatar"${avStyle(img)}>${img?'':esc(d.avatarLetter||String(d.name||'?').charAt(0))}</div>
        <div class="msg-info">
          <div class="msg-name">${esc(d.name)}${d.isStreamer?'<span class="msg-tag">主播</span>':''}${d.foreign?`<span class="msg-tag">${esc(d.foreign)}</span>`:''}${d.tag?`<span class="msg-tag">${esc(d.tag)}</span>`:''}${d.isCharMask?`<span class="msg-tag">陌生人</span>`:''}${d.revealedAs?`<span class="msg-tag">已识破</span>`:''}</div>
          <div class="msg-prev">${esc(d.prev)}</div>
        </div>
        <div class="msg-meta"><span>${esc(d.time)}</span>${d.unread?'<span class="udot"></span>':''}</div>
      </button>
    </div>`;
  }).join('');
  bindSwipe($('dmList'));
}
function renderGroupList(){
  if(!S.groups.length){
    $('groupList').innerHTML=`<div class="mine-empty" style="padding:26px 12px;text-align:center;color:var(--muted);font-size:13px">还没有群聊，点下方按钮建一个。</div>`;
    return;
  }
  $('groupList').innerHTML=S.groups.map(g=>`
    <div class="swipe-row">
      <div class="swipe-actions">
        <button onclick="swipePin('group',this.parentNode.parentNode)">置顶</button>
        <button class="sw-del" onclick="swipeDelete('group',this.parentNode.parentNode)">删除</button>
      </div>
      <button class="msg-row swipe-body" data-name="${esc(g.name)}" onclick="openChat(this.dataset.name,'group')">
        <div class="msg-avatar">${esc(g.name.charAt(0))}</div>
        <div class="msg-info"><div class="msg-name">${esc(g.name)}</div><div class="msg-prev">${esc(g.last)}</div></div>
        <div class="msg-meta"><span>${esc(g.time)}</span>${g.unread>0?'<span class="udot"></span>':''}</div>
      </button>
    </div>`).join('');
  bindSwipe($('groupList'));
}
/* 左滑：置顶 / 删除 */
function bindSwipe(container){
  if(!container||container.dataset.swipeBound)return;
  container.dataset.swipeBound='1';
  let body=null,sx=0,dx=0,dragging=false;
  container.addEventListener('pointerdown',e=>{
    const b=e.target.closest('.swipe-body');
    if(!b)return; body=b; sx=e.clientX; dx=0; dragging=true; body.style.transition='';
  });
  window.addEventListener('pointermove',e=>{ if(!dragging||!body)return; dx=e.clientX-sx; if(dx<0) body.style.transform='translateX('+Math.max(-150,dx)+'px)'; });
  window.addEventListener('pointerup',()=>{ if(!dragging||!body)return; dragging=false; body.style.transition=''; body.style.transform='translateX('+(dx<-40?-140:0)+'px)'; });
  window.addEventListener('pointercancel',()=>{ if(!dragging||!body)return; dragging=false; body.style.transition=''; body.style.transform='translateX(0)'; });
}
function closeSwipeRows(){document.querySelectorAll('.swipe-body').forEach(b=>{b.style.transform='translateX(0)'})}
function swipeRowName(rowEl){const b=rowEl&&(rowEl.classList&&rowEl.classList.contains('swipe-row')?rowEl:rowEl.closest?.('.swipe-row'));const body=b&&b.querySelector('.swipe-body');return body?body.dataset.name:''}
function swipePin(kind,rowEl){
  const name=swipeRowName(rowEl);if(!name)return;closeSwipeRows();
  if(kind==='dm'){
    S.dmPinned=(S.dmPinned||[]).filter(x=>x!==name);S.dmPinned.unshift(name);
    S.dmFriends=sortByPin(S.dmFriends||[]);renderDM();
  }else{
    const i=(S.groups||[]).findIndex(x=>x.name===name);
    if(i>0){const [g]=S.groups.splice(i,1);S.groups.unshift(g);}
    renderGroupList();
  }
  saveHaloState();showToast('已置顶');
}
function swipeDelete(kind,rowEl){
  const name=swipeRowName(rowEl);if(!name)return;closeSwipeRows();
  if(kind==='dm'){
    haloConfirm('删除与「'+name+'」的聊天记录？',()=>{
      delete S.chatLog[name];
      S.dmDeleted=(S.dmDeleted||[]).filter(x=>x!==name);S.dmDeleted.push(name);
      S.dmFriends=(S.dmFriends||[]).filter(x=>x.name!==name);
      S.dmStrangers=(S.dmStrangers||[]).filter(x=>x.name!==name);
      S.charMasks=(S.charMasks||[]).filter(m=>!(m.alias&&m.alias.name===name));
      renderDM();saveHaloState();showToast('已删除');
    },'删除');
  }else{
    haloConfirm('删除群聊「'+name+'」？聊天记录也会删除。',()=>{
      S.groups=(S.groups||[]).filter(x=>x.name!==name);
      S.myGroups=(S.myGroups||[]).filter(x=>x.name!==name);
      delete S.chatLog[name];
      renderGroupList();renderMine();saveHaloState();showToast('已删除');
    },'删除');
  }
}
function sortByPin(list){
  const pin=S.dmPinned||[];
  return (list||[]).slice().sort((a,b)=>{
    const ia=pin.indexOf(a.name),ib=pin.indexOf(b.name);
    if(ia>=0||ib>=0){ if(ia<0)return 1; if(ib<0)return -1; return ia-ib; }
    return (b.at||b.lastAt||0)-(a.at||a.lastAt||0);
  });
}
function touchDm(name){ const m=dmMeta(name); if(m)m.at=nowMin(); }
function openChat(name,type){
  const meta=(S.dmFriends||[]).find(x=>x.name===name)||(S.dmStrangers||[]).find(x=>x.name===name)||{};
  if(type==='group'){
    S.currentGroup=S.groups.find(x=>x.name===name)||{name:name,members:'1',topic:'群聊',desc:'',isDM:false};
  }else{
    S.currentGroup={name:name,members:'1',topic:'私聊',desc:'私聊',isDM:true,
      charId:meta.charId||null,avatar:meta.avatar||null,isCharMask:!!meta.isCharMask,
      maskId:meta.maskId||null,maskOwner:meta.maskOwner||null,revealedAs:meta.revealedAs||null};
  }
  S.chatFrom=(type==='group')?'groupHome':'dmHome';
  if(!S.chatLog[name]) S.chatLog[name]=[];
  S.chatQuote=null;updateChatQuoteBar();
  openPage('groupChat');
}
function chatBack(){openPage(S.chatFrom||'dmHome')}
function onChatMore(){
  const g=S.currentGroup;
  if(g&&g.isDM){ openDmSettings(g.name); }
  else{openPage('groupSettings');}
}
function renderChatHeader(){
  const g=S.currentGroup||S.groups[0];
  $('chatName').textContent=g.name;
  const sub=g.isDM
    ? (g.isCharMask?(g.revealedAs?('马甲已识破 · '+g.revealedAs):'陌生人 · 来路不明'):'私聊')
    : `${g.members} members · ${g.topic}`;
  $('chatMembers').textContent=sub;
  const logo=$('chatLogo');
  const av=imgOk(g.avatar)?g.avatar:null;
  if(av){logo.style.backgroundImage=`url('${String(av).replace(/["'()\\\s]/g,'')}')`;logo.style.backgroundSize='cover';logo.style.backgroundPosition='center';logo.textContent='';}
  else{logo.style.backgroundImage='';logo.textContent=(g.name||'?').charAt(0);}
  const title=$('chatName');title.style.cursor='';title.onclick=null;
  $('settingGroupName').textContent=g.name;
  $('settingGroupDesc').textContent=g.desc;
}
/* ======== 聊天渲染（气泡单击/双击都弹菜单） ======== */
function renderChat(){
  const name=S.currentGroup?.name||'';
  const log=S.chatLog[name]||[];
  let html='',lastShownMin=null;
  log.forEach((m,i)=>{
    const at=m.at||0;
    if(lastShownMin===null || (at-lastShownMin)>=5){
      html+=`<div class="time-sep">${esc(m.time||nowHM())}</div>`;
      lastShownMin=at;
    }
    if(m.kind==='live-invite'){
      const done=m.status!=='pending';
      html+=`<div class="message mine">
        <div class="card-msg">
          <div class="c-title">开播邀请</div>
          <div class="c-desc">${esc(m.text)}</div>
          <div class="c-actions">
            <button class="primary" ${done?'disabled':''} data-name="${esc(m.target||name)}" onclick="respondLiveInvite(this.dataset.name,${i})">${done?'已回复':'回复'}</button>
          </div>
        </div>
      </div>`;
      return;
    }
    if(m.kind==='invite'){
      const done=m.status!=='pending';
      html+=`<div class="message">
        <div class="card-msg">
          <div class="c-title">双人直播邀请</div>
          <div class="c-desc">${esc(m.text)}</div>
          <div class="c-actions">
            <button class="primary" ${done?'disabled':''} data-name="${esc(name)}" onclick="respondInvite(this.dataset.name,${i},'accept')">回复</button>
            <button ${done?'disabled':''} data-name="${esc(name)}" onclick="respondInvite(this.dataset.name,${i},'reject')">忽略</button>
          </div>
        </div>
      </div>`;
      return;
    }
    if(m.kind==='share'){
      const done=m.status!=='pending';
      const isMine=m.who==='user';
      html+=`<div class="message ${isMine?'mine':''}">
        <div class="card-msg share-card">
          <div class="c-title">直播分享</div>
          <div class="c-desc">${esc(m.text)}</div>
          <div class="live-mini">
            <span class="live-dot"></span>
            <div><b>${esc(m.share?.title||'直播')}</b><br><span>@${esc(m.share?.host||'host')} · ${esc(m.share?.topic||'')}</span></div>
          </div>
          <div class="c-actions">
            ${isMine
              ? `<button ${done?'disabled':''} data-name="${esc(name)}" onclick="respondShare(this.dataset.name,${i})">查看回应</button>`
              : `<button class="primary" ${done?'disabled':''} data-name="${esc(name)}" onclick="respondShare(this.dataset.name,${i})">回复</button>`}
            ${m.roomId?`<button ${done?'disabled':''} onclick="watchSharedRoom('${esc(String(m.roomId))}',${i})">去看</button>`:''}
          </div>
        </div>
      </div>`;
      return;
    }
    const isMine=m.who==='user';
    let inner='';
    if(m.quote) inner+=`<span class="quote">${esc(m.quote.name)}：${esc(m.quote.text)}</span>`;
    if(m.foreign||m.trans){
      inner+=`<div class="foreign">${esc(m.foreign||'')}</div>`;
      if(m.trans) inner+=`<div class="trans">${esc(m.trans)}</div>`;
    }else inner+=esc(m.text||'');
    let reactsHtml='';
    if(m.reacts&&Object.keys(m.reacts).length){
      reactsHtml='<div class="reacts">'+Object.entries(m.reacts).map(([e,n])=>`<span>${e}${n>1?' '+n:''}</span>`).join('')+'</div>';
    }
    let senderHtml='';
    if(!isMine){
      const g=S.currentGroup||{};
      const isAdmin=!g.isDM && Array.isArray(g.admins) && g.admins.includes(m.name);
      senderHtml=`<div class="sender">${esc(m.name||'')}${isAdmin?'<span class="admin-badge">管理员</span>':''}</div>`;
    }
    html+=`<div class="message ${isMine?'mine':''}">
      ${senderHtml}
      <div class="bubble" data-chat="${esc(name)}" data-idx="${i}">${inner}</div>
      ${reactsHtml}
    </div>`;
  });
  if(S.dmBusy[name]||(S.groupBusy&&S.groupBusy[name])) html+=`<div class="message"><div class="sender">${esc(name)}</div><div class="bubble typing">正在输入…</div></div>`;
  const box=$('chatMessages');
  box.innerHTML=html;
  // 用事件委托绑定单击/双击
  box.onclick=(ev)=>{
    const b=ev.target.closest('.bubble');
    if(!b) return;
    ev.stopPropagation();
    openChatMenu(b.dataset.chat, parseInt(b.dataset.idx,10), ev);
  };
  box.ondblclick=(ev)=>{
    const b=ev.target.closest('.bubble');
    if(!b) return;
    ev.stopPropagation();
    openChatMenu(b.dataset.chat, parseInt(b.dataset.idx,10), ev);
  };
  requestAnimationFrame(()=>{const el=$('chatScroll');el.scrollTop=el.scrollHeight});
  if(S.currentGroup&&S.currentGroup.isDM) markChatRead(S.currentGroup.name);
}

/* ======== 聊天气泡菜单（独立于直播弹幕） ======== */
let chatMenuTarget=null;
function openChatMenu(chatName, idx, ev){
  const msg=S.chatLog[chatName]?.[idx];
  if(!msg) return;
  chatMenuTarget={chatName,idx};
  menuMode='chat';
  menuTargetIdx=null;

  $('bmEmojis').innerHTML=EMOJIS.map(e=>`<button onclick="reactChatMsg('${e}')">${e}</button>`).join('');
  const acts=$('bmActions');
  acts.innerHTML =
    `<button onclick="quoteChatMsg()">引用</button>` +
    `<button class="danger-action" onclick="deleteChatMsg()">删除</button>` +
    `<button onclick="closeChatMenu()">取消</button>`;

  showMenuAt(ev);
}
function closeChatMenu(){
  chatMenuTarget=null;
  $('barrageMenu').classList.remove('show');
}
function reactChatMsg(e){
  if(!chatMenuTarget) return;
  const {chatName,idx}=chatMenuTarget;
  const m=S.chatLog[chatName]?.[idx]; if(!m) return;
  if(!m.reacts) m.reacts={};
  m.reacts[e]=(m.reacts[e]||0)+1;
  closeChatMenu();
  renderChat();
}
function quoteChatMsg(){
  if(!chatMenuTarget) return;
  const {chatName,idx}=chatMenuTarget;
  const m=S.chatLog[chatName]?.[idx]; if(!m) return;
  S.chatQuote={name:m.name||'消息',text:m.text||m.foreign||''};
  closeChatMenu();
  updateChatQuoteBar();
  $('chatInput')?.focus();
  showToast('已引用，输入内容后发送');
}
function deleteChatMsg(){
  if(!chatMenuTarget) return;
  const {chatName,idx}=chatMenuTarget;
  const m=S.chatLog[chatName]?.[idx]; if(!m) return;
  S.chatLog[chatName].splice(idx,1);
  closeChatMenu();
  renderChat();saveHaloState();
  showToast('消息已删除');
}

function updateChatSendIcon(){
  const has=($('chatInput')?.value||'').trim().length>0;
  const icon=$('chatSendIcon');if(!icon)return;
  if(has){
    icon.setAttribute('fill','currentColor');icon.removeAttribute('stroke');
    icon.innerHTML='<path d="M3.4 20.4l17.4-8.4c.8-.4.8-1.6 0-2L3.4 1.6c-.7-.3-1.5.2-1.4 1l1 6.2c.1.6.5 1 1.1 1.1l8.4 1.1-8.4 1.1c-.6.1-1 .5-1.1 1.1l-1 6.2c-.1.8.7 1.3 1.4 1z"/>';
  }else{
    icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.9');
    icon.innerHTML='<path d="M9 14l-4-4 4-4"/><path d="M5 10h9a5 5 0 0 1 5 5v3"/>';
  }
}
function onChatSend(){
  const v=($('chatInput')?.value||'').trim();
  if(v){ sendChat(); return; }
  const name=S.currentGroup?.name||'';
  if(!name){ showToast('还没有打开会话'); return; }
  if(S.currentGroup&&S.currentGroup.isDM) dmReply(name);
  else groupReply(name);
}
function updateChatQuoteBar(){
  const bar=$('chatQuoteBar');
  if(S.chatQuote){bar.classList.add('show');bar.innerHTML=`引用 <b>${esc(S.chatQuote.name)}</b>：${esc(S.chatQuote.text)}<span class="qx" onclick="clearChatQuote()">×</span>`;}
  else bar.classList.remove('show');
}
function clearChatQuote(){S.chatQuote=null;updateChatQuoteBar();}

function respondInvite(chatName,idx,action){
  const log=S.chatLog[chatName]||[];const m=log[idx];
  if(!m||m.status!=='pending')return;
  if(action==='accept'){
    m.status='accepted';
    log.push({who:'system',name:'System',text:'你接受了邀请，稍后会在直播里见到你',time:nowHM(),at:nowMin()});
    showToast('已接受邀请');
  }else{
    m.status='rejected';
    log.push({who:'system',name:'System',text:'你忽略了这次邀请',time:nowHM(),at:nowMin()});
    showToast('已忽略');
  }
  renderChat();saveHaloState();
}
function pushChat(name,msg){
  if(!S.chatLog[name]) S.chatLog[name]=[];
  S.chatLog[name].push(msg);
  saveHaloState();
}
function sendChat(){
  const i=$('chatInput'),t=i.value.trim();if(!t)return;
  const name=S.currentGroup?.name||'';
  if(!S.chatLog[name]) S.chatLog[name]=[];
  const msg={who:'user',name:currentIdentity().name||'You',text:t,time:nowHM(),at:nowMin()};
  if(S.chatQuote){msg.quote={name:S.chatQuote.name,text:S.chatQuote.text};clearChatQuote();}
  S.chatLog[name].push(msg);
  // 列表预览显示最新一条
  const meta=dmMeta(name);
  if(meta){meta.prev=t;meta.time='刚刚';meta.unread=false;meta.at=nowMin();}
  const g=(S.groups||[]).find(x=>x.name===name);
  if(g){g.last=t;g.time='刚刚';g.unread=0;}
  i.value='';updateChatSendIcon();renderChat();renderDM();renderGroupList();saveHaloState();
}

/* ---- 上下文：角色人设 + 世界书 + 长期记忆 + 我方人设（尊重马甲） ---- */
async function buildCharContext(char, recentText){
  const ctx={setting:'',worldbook:'',memory:'',userSetting:currentUserSetting(),userName:currentIdentity().name||'你'};
  if(!char) return ctx;
  if(char.setting) ctx.setting=String(char.setting);
  try{ ctx.worldbook = HaloData.buildWorldbookText(S._worldbook,char,recentText)||''; }catch(e){}
  try{
    if(char.id && !(S.activeAliasId&&S.activeAliasId!=='main')) ctx.memory = await HaloData.readMemoryText(char.id,16);
  }catch(e){}
  return ctx;
}
function dmLogMessages(name){
  return (S.chatLog[name]||[]).filter(m=>m.text||m.foreign).slice(-14).map(m=>({
    role:m.who==='user'?'user':'assistant',
    content:m.text||m.foreign||''
  }));
}
async function dmReply(name){
  if(S.dmBusy[name]) return;
  const target=dmMeta(name)||{};
  S.dmBusy[name]=true; renderChat();
  try{
    if(target.isCharMask) await charMaskReply(name,target);
    else await charDmReply(name,target);
    markChatRead(name);
    try{
      const last=(S.chatLog[name]||[]).slice(-1)[0]||{};
      if(window.NanoNotify) NanoNotify.notify(name||'Halo', last.text||last.foreign||'新的私信', { target:'halo', channel:'halo' });
    }catch(e){}
  }catch(e){
    haloFail('回复生成失败',e);
  }finally{
    S.dmBusy[name]=false; renderChat();
  }
}
async function charDmReply(name,target){
  const char = target.charId ? ((S._realChars||[]).find(c=>c.id===target.charId)||charByName(name)) : (charByName(name)||((target.persona||target.setting)?{name:name,setting:(target.persona||target.setting)}:null));
  if (!S._apiReady || typeof HaloData === 'undefined') throw new Error('未配置主 API');
  const recent = dmLogMessages(name).map(m=>m.content).join('\n');
  const ctx = await buildCharContext(char, recent);
  const meta=dmMeta(name)||{};
  const chatCount=(meta.chatCount||0)+1;
  if(meta) meta.chatCount=chatCount;
  const stage=chatCount<=2?'刚认识':(chatCount<=8?'慢慢眼熟':(chatCount<=20?'比较熟悉':'已经是很熟的人'));
  const sys=[];
  sys.push(`你是「${name}」，一个有血有肉、多面而真实的人，正在和「${ctx.userName}」私聊。你们已经来往过 ${chatCount} 轮。`);
  sys.push('【硬设定】下面依次是【角色人设】【世界书】【对方设定】【长期记忆】，都是你这个人的真实设定，优先级高于任何通用聊天风格。');
  if(ctx.setting) sys.push('【角色人设 · 必须严格遵守】\n'+ctx.setting.slice(0,1800));
  sys.push('【不要脸谱化】人设只是一面，不是全部：你有好的一面也有缺点，会累、会敷衍、会开玩笑、会改变想法。随着聊天推进，你对对方的认知、态度、定位应当逐渐变化（更熟、更戒备、或好感/反感），不要每轮都用同一句简介、同一个腔调重复自己。');
  sys.push('【关系阶段】你们目前：'+stage+'（已来往 '+chatCount+' 轮）。请让说话的分寸、称呼、态度与这个阶段相符，并允许它随对话继续变化。');
  if(ctx.worldbook) sys.push('【世界书】\n'+ctx.worldbook);
  if(ctx.userSetting) sys.push('【对方设定】\n'+ctx.userSetting.slice(0,1200));
  { const sg=currentIdentity().signature; if(sg) sys.push('【对方个签】'+sg.slice(0,200)); }
  if(S.activeAliasId&&S.activeAliasId!=='main') sys.push(`【重要】对方现在用的身份是「${ctx.userName}」，这是TA此刻的身份；不要提起任何其他身份或真名，也不要试图拆穿。`);
  if(ctx.memory) sys.push('【长期记忆 · 你与对方共同经历或被告知过的事】\n'+ctx.memory+'\n以上记忆要当作你真正经历或被告知过的事，自然沿用，不要否认，不要问“你什么时候告诉我的”。');
  const isStrangerCase=(S.activeAliasId&&S.activeAliasId!=='main') || !char;
  if(isStrangerCase) sys.push('【对待陌生人】对方对你来说是陌生人，态度请按你人设自然来：人设冷淡/戒备就疏离，人设友好/热情也可以正常聊天——不要无条件凶或刻意拒绝。只有当对方反复纠缠、越界、追问隐私时，才按人设表现出不耐烦。');
  if(target&&target.fromLive&&target.liveMemory){
    const lm=target.liveMemory||{};
    const parts=[];
    if(lm.title) parts.push('直播「'+lm.title+'」'+(lm.topic?('（'+lm.topic+'）'):''));
    if(lm.hostSaid&&lm.hostSaid.length) parts.push('你当时说过：'+lm.hostSaid.slice(0,3).join(' / '));
    if(lm.myChat&&lm.myChat.length) parts.push('TA 当时发的弹幕：'+lm.myChat.slice(0,6).join(' / '));
    sys.push('【你们认识的经过】你和对方是在你的直播间里认识的，你记得这些互动：\n'+parts.join('\n')+'\n可以自然地提起，不要装作不认识。');
  }
  sys.push('【说话方式】像真人在微信里发消息：把你要说的话拆成 1-4 条短消息，每条单独一行，口语化；不要旁白、不要动作描写、不要 markdown、不要暴露 AI 身份。');
  const raw = String(await HaloData.callMainText([{role:'system',content:sys.join('\n\n')},...dmLogMessages(name)],{temperature:0.9})||'').trim();
  if(!raw) throw new Error('AI 未返回内容');
  pushSplitChat(name,'member',raw,name);
  touchDm(name);S.dmFriends=sortByPin(S.dmFriends||[]);S.dmStrangers=sortByPin(S.dmStrangers||[]);renderDM();
}

/* ============ 群设置 ============ */
function renderGroupSettings(){
  const g=S.currentGroup||S.groups[0];if(!g)return;
  normalizeGroupFans(g);
  $('settingGroupName').textContent=g.name;$('settingGroupDesc').textContent=g.desc||'';
  const admins=g.admins||[];
  const head='<div class="admin-only-note">群简介：'+esc(g.desc||'（无）')+'</div>'
    +'<div style="display:flex;gap:8px;margin:6px 0 10px">'
    +'<button class="secondary-wide" style="height:38px" onclick="editGroupDesc()">编辑群简介</button>'
    +'<button class="secondary-wide" style="height:38px;color:var(--accent)" onclick="deleteCurrentGroup()">删除群聊</button></div>'
    +'<div class="admin-only-note">邀请 char 入群：只有被邀请的 char 才会出现在群里并发言；普通粉丝不会自动包含任何 char。</div>';
  $('adminList').innerHTML=head+
    (S.dmFriends||[]).map(f=>{const on=admins.includes(f.name);return `<div class="admin-char-row"><div class="a-dot">${esc(f.name.charAt(0))}</div><div class="a-main"><div class="a-name">${esc(f.name)}</div><div class="a-role">${on?'已邀请 · 群成员':'好友 · char'}</div></div><button class="pill-action ${on?'danger':''}" data-name="${esc(f.name)}" onclick="toggleAdmin(this.dataset.name)">${on?'移出群聊':'邀请入群'}</button></div>`}).join('');
  const invited=(admins||[]).filter(a=>charByName(a));
  $('memberList').innerHTML=invited.map(f=>`<div class="settings-item"><div><div class="label">${esc(f)}<span class="admin-badge">管理员</span></div><div class="desc">已邀请的 char</div></div></div>`).join('')
    +(g.fans||[]).slice(0,12).map(f=>`<div class="settings-item"><div><div class="label">${esc(f)}</div><div class="desc">随机粉丝</div></div></div>`).join('');
}
function editGroupDesc(){
  const g=S.currentGroup;if(!g)return;
  openEditDialog({
    title:'编辑群简介',
    fields:[{label:'群简介（之后群聊内容会围绕它生成）',value:g.desc||'',multiline:true,placeholder:'例如：一起讨论新番与同人创作'}],
    onSave:(v)=>{g.desc=(v[0]||'').trim();renderGroupSettings();saveHaloState();showToast('群简介已更新');}
  });
}
function deleteCurrentGroup(){
  const g=S.currentGroup;if(!g)return;
  haloConfirm('删除群聊「'+g.name+'」？聊天记录会一起删除。',()=>{
    S.groups=(S.groups||[]).filter(x=>x.name!==g.name);
    S.myGroups=(S.myGroups||[]).filter(x=>x.name!==g.name);
    delete S.chatLog[g.name];
    S.currentGroup=null;saveHaloState();renderGroupList();renderMine();
    S.history=['groupHome'];openPage('groupHome',false);showToast('已删除群聊');
  },'删除');
}
function toggleAdmin(name){
  const g=S.currentGroup;if(!g)return;
  if(!getFriendNames().includes(name)){showToast('只能设置好友 / char');return}
  if(!g.admins)g.admins=[];
  const i=g.admins.indexOf(name);
  if(i>=0)g.admins.splice(i,1);else g.admins.push(name);
  renderGroupSettings();showToast(i>=0?'已移除管理员':'已设为管理员');saveHaloState();
}
function createGroup(){
  const name=$('groupName').value.trim()||'New Space',desc=$('groupDesc').value.trim()||'一个刚刚创建的群聊。';
  const topic=document.querySelector('#groupCreateTopics .choice.active')?.dataset?.topic||'创作';
  const fans=randomFans(9);const admin=currentIdentity().name||'我';
  const g={id:Date.now(),name,desc,topic,members:fans.length+1,joined:true,last:'群聊已创建',time:'刚刚',unread:0,admins:admin?[admin]:[],fans,foreign:sampleUnique(FOREIGN_CHARS,3),_randomizedFans:true};
  S.groups.unshift(g);S.myGroups.unshift({name:name,members:g.members,admin:admin||'—',last:'群聊已创建',time:'刚刚',unread:0});
  S.currentGroup=g;S.chatFrom='groupHome';S.chatLog[name]=[];openPage('groupChat');renderGroupList();renderMine();saveHaloState();
}
function startLive(){
  const title=$('liveTitle').value.trim()||'今晚聊点什么？',desc=$('liveDesc').value.trim()||'一场刚刚开始的直播。';
  const topic=document.querySelector('#liveCreateTopics .choice.active')?.dataset?.topic||'深夜聊天';
  const dual = S.mode==='dual';
  const r={id:Date.now(),title,topic,desc,viewers:'1',dual,hostName:currentIdentity().name,hostAvatar:currentIdentity().avatarLetter,hostAvatarImage:currentIdentity().avatarImage||null,cover:currentIdentity().cover||''};
  S.liveRooms.unshift(r);S.myOwnLives.unshift(r);S.currentRoom=r;
  watchLive(r.id,true,true);
  if(dual) makeRoomDual('CH');
  renderMine();saveHaloState();
}

/* ============ 我的页面 ============ */
function switchProfileTab(tab){
  S.profileTab=tab;
  document.querySelectorAll('.profile-tab').forEach(x=>x.classList.toggle('active',x.dataset.ptab===tab));
  renderMine();
}
function currentIdentity(){
  if(S.activeAliasId==='main') return S.identity;
  return S.aliases.find(a=>a.id===S.activeAliasId)||S.identity;
}
function renderMine(){
  const id=currentIdentity();
  $('profileHandle').textContent=id.name;
  $('profileUsername').textContent=id.handle;
  const sig=$('profileSignature');
  if(sig) sig.textContent=id.signature?('“'+id.signature+'”'):'点击设置个签';
  const av=$('profileAvatar');
  if(id.avatarImage){av.style.backgroundImage=`url(${id.avatarImage})`;av.style.backgroundSize='cover';av.style.backgroundPosition='center';av.textContent='';}
  else{av.style.backgroundImage='';av.textContent=id.avatarLetter;}
  const cov=$('profileCover');
  if(id.cover){cov.style.backgroundImage=`url(${id.cover})`;cov.style.backgroundSize='cover';cov.style.backgroundPosition='center';}
  else{cov.style.backgroundImage='';}

  const el=$('profileBody');
  if(S.profileTab==='live'){
    let html='';
    html+='<div class="mine-group-title">我开过的直播</div>';
    html+=S.myOwnLives.length?S.myOwnLives.map(r=>mineLiveRow(r,true)).join(''):'<div class="mine-empty">还没有自己开过直播</div>';
    html+='<div class="mine-group-title">我互动过的直播</div>';
    html+=S.interactedLives.length?S.interactedLives.map(r=>mineLiveRow(r,false)).join(''):'<div class="mine-empty">还没有互动过的直播</div>';
    el.innerHTML=html;
  } else if(S.profileTab==='groups'){
    el.innerHTML=S.myGroups.length?S.myGroups.map(g=>`
      <button class="mine-row" onclick="openMyGroup('${esc(g.name)}')">
        <div class="mine-thumb round">${esc(g.name.charAt(0))}</div>
        <div class="mine-info"><div class="mine-title">${esc(g.name)}</div>
        <div class="mine-meta">${g.members} 成员 · 群主 ${esc(g.admin)}</div></div>
      </button>`).join(''):`<div class="mine-empty">还没有粉丝群</div>`;
  } else {
    el.innerHTML=S.myReplays.length?S.myReplays.map((r,i)=>`
      <div class="mine-row">
        <div class="mine-thumb" onclick="openReplay(${i})"><span class="mine-dur">${esc(r.dur)}</span></div>
        <div class="mine-info" onclick="openReplay(${i})">
          <div class="mine-title">${esc(r.title)}</div>
          <div class="mine-meta">${esc(r.meta)}</div>
        </div>
        <button class="mine-del" onclick="deleteReplay(${i})" aria-label="删除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>
        </button>
      </div>`).join(''):`<div class="mine-empty">还没有回放</div>`;
  }
}
function mineLiveRow(r,isOwn){
  return `
    <div class="mine-row">
      <div class="mine-thumb" onclick="watchLive('${r.id}',${isOwn},true)">
        <span class="mine-dur">${isOwn?'OWN':'HIST'}</span>
      </div>
      <div class="mine-info" onclick="watchLive('${r.id}',${isOwn},true)">
        <div class="mine-title">${esc(r.title)}</div>
        <div class="mine-meta">${esc(r.topic)} · ${esc(r.viewers)} 观看 · ${r.dual?'双人':'单人'}</div>
      </div>
      <button class="mine-del" onclick="deleteLive('${r.id}',${isOwn})" aria-label="删除">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>
      </button>
    </div>`;
}
function deleteLive(id,isOwn){
  if(isOwn){
    S.myOwnLives=S.myOwnLives.filter(x=>String(x.id)!==String(id));
    S.liveRooms=S.liveRooms.filter(x=>String(x.id)!==String(id));
  }else S.interactedLives=S.interactedLives.filter(x=>String(x.id)!==String(id));
  renderMine();saveHaloState();showToast('已删除');
}
function deleteReplay(i){ S.myReplays.splice(i,1);renderMine();saveHaloState();showToast('已删除回放'); }
function openAliasSwitcher(){
  const rows=[aliasRowHtml('main',S.identity,'主身份')];
  S.aliases.forEach(a=>rows.push(aliasRowHtml(a.id,a,'马甲')));
  if(!S.aliases.length) rows.push(`<div class="muted small" style="text-align:center;padding:8px 0">还没有马甲，点「＋ Alias」创建一个。</div>`);
  $('aliasList').innerHTML=rows.join('');
  $('aliasModal').classList.add('show');
}
function aliasRowHtml(id,data,label){
  const active=S.activeAliasId===id;
  return `<div class="alias-row ${active?'active':''}">
    <div class="a-av"${avStyle(data.avatarImage)}>${imgOk(data.avatarImage)?'':esc(data.avatarLetter||data.name.charAt(0))}</div>
    <div class="a-info" style="cursor:pointer" onclick="switchAlias('${id}')"><div class="a-name">${esc(data.name)}${active?' · 当前':''}</div><div class="a-desc">${esc(label)} · ${esc(data.handle||'')}</div></div>
    ${id!=='main'?`<button class="pill-action" style="flex:none;padding:6px 11px;border-radius:999px;font-size:11px;font-weight:800;background:var(--surface2);color:var(--text);border:1px solid var(--line)" onclick="editAlias('${id}')">编辑</button><button class="pill-action danger" style="flex:none;padding:6px 11px;border-radius:999px;font-size:11px;font-weight:800" onclick="deleteAlias('${id}')">删除</button>`:''}
  </div>`;
}
function deleteAlias(id){
  if(!id||id==='main')return;
  const a=(S.aliases||[]).find(x=>x.id===id);if(!a)return;
  haloConfirm('删除马甲「'+a.name+'」？该马甲下的 Halo 记录也会一起删除。',async()=>{
    try{ await haloIdbDel('state:'+id); }catch(e){}
    try{ const all=JSON.parse(localStorage.getItem('nanoHaloFallback_v1')||'{}'); delete all['state:'+id]; localStorage.setItem('nanoHaloFallback_v1',JSON.stringify(all)); }catch(e){}
    S.aliases=(S.aliases||[]).filter(x=>x.id!==id);
    try{ localStorage.setItem('nanoAliases',JSON.stringify(S.aliases)); }catch(e){}
    if(S.activeAliasId===id){
      S.activeAliasId='main';
      try{ localStorage.setItem('nanoHaloActiveAlias','main'); }catch(e){}
      closeAliasSwitcher();
      S.currentRoom=null;S.currentGroup=null;S.history=['liveHome'];
      await applyRealData();
      renderLiveTopics();renderLive();renderDM();renderGroupList();renderMine();renderChat();renderGroupSettings();
      navTo('liveHome',false);
    }else{
      openAliasSwitcher();
    }
    showToast('已删除马甲');
  },'删除');
}
async function switchAlias(id){
  id=id||'main';
  if(S.activeAliasId===id){closeAliasSwitcher();return;}
  _savePending=false;clearTimeout(_saveTimer);persistNow();
  S.activeAliasId=id;
  try{localStorage.setItem('nanoHaloActiveAlias',id);}catch(e){}
  closeAliasSwitcher();
  S.currentRoom=null;S.currentGroup=null;S.history=['liveHome'];
  await applyRealData();
  renderLiveTopics();renderLive();renderDM();renderGroupList();renderMine();renderChat();renderGroupSettings();
  navTo('liveHome',false);
  showToast('已切换到「'+currentIdentity().name+'」，各页面数据已刷新');
}
function editAlias(id){
  if(id==='main'){showToast('主身份人设来自「人设 / Mask」页面，请到那里修改');return;}
  const a=(S.aliases||[]).find(x=>x.id===id);if(!a)return;
  openEditDialog({
    title:'编辑马甲',
    saveText:'保存马甲',
    fields:[
      {label:'马甲昵称',value:a.name||'',placeholder:'例如：夜行客'},
      {label:'马甲设定（char 只会看到这个人设）',value:a.bio||a.setting||'',multiline:true,placeholder:'身份、性格、说话方式、背景…'}
    ],
    onSave:(v)=>{
      const name=(v[0]||'').trim();
      const bio=(v[1]||'').trim();
      a.name=name||a.name;
      a.handle='@'+a.name.toLowerCase().replace(/\s+/g,'');
      a.avatarLetter=a.name.charAt(0).toUpperCase();
      a.bio=bio;a.setting=bio;
      try{localStorage.setItem('nanoAliases',JSON.stringify(S.aliases));}catch(e){}
      renderMine();renderDM();renderChat();renderLive();
      if(S.activeAliasId===id)saveHaloState();
      showToast('马甲已更新');
    }
  });
}
function closeAliasSwitcher(){$('aliasModal').classList.remove('show')}
function openMyGroup(name){
  S.currentGroup=S.groups.find(x=>x.name===name)||{name:name,members:'1',topic:'粉丝群',desc:'我的粉丝群',admins:['You'],fans:[],foreign:FOREIGN_CHARS.slice(0,3)};
  S.chatFrom='meHome';if(!S.chatLog[name]) S.chatLog[name]=[];openPage('groupChat');
}
function openReplay(i){
  const r=S.myReplays[i];if(!r)return;
  S.roomLog=r.log||[];S.audience=r.audience||[];S.gifts=r.giftMap||{};
  S.currentRoom={title:r.title};
  S.history=['liveHome','summary'];openPage('summary',false);
}
function editCover(){
  const input=document.createElement('input');input.type='file';input.accept='image/*';
  input.onchange=(e)=>{const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=()=>{const id=currentIdentity();id.cover=reader.result;if(S.activeAliasId==='main')localStorage.setItem('nanoCover',reader.result);saveHaloState();renderMine();showToast('封面已更新');};
    reader.readAsDataURL(f);
  };
  input.click();
}
function editAvatar(){
  if(S.activeAliasId==='main' && S._mask){ haloOpenApp('mask.html','Mask'); showToast('主身份头像来自人设，已为你打开人设页'); return; }
  $('avatarModal').classList.add('show');
  const p=$('avatarPreview'),id=currentIdentity();
  if(id.avatarImage){p.style.backgroundImage=`url(${id.avatarImage})`;p.classList.add('has-img');p.textContent='';}
  else{p.style.backgroundImage='';p.classList.remove('has-img');p.textContent=id.avatarLetter;}
}
function closeAvatarModal(){$('avatarModal').classList.remove('show')}
function pickAvatarFile(){
  const input=document.createElement('input');input.type='file';input.accept='image/*';
  input.onchange=e=>{const f=e.target.files[0];if(!f)return;
    const reader=new FileReader();
    reader.onload=()=>{const id=currentIdentity();id.avatarImage=reader.result;if(S.activeAliasId==='main')localStorage.setItem('nanoAvatarImg',reader.result);saveHaloState();closeAvatarModal();renderMine();showToast('头像已更新');};
    reader.readAsDataURL(f);
  };
  input.click();
}
function pickAvatarLetter(){
  openEditDialog({
    title:'设置头像字母',
    fields:[{label:'头像字母',value:currentIdentity().avatarLetter||'',placeholder:'1 个字母或字符'}],
    onSave:(v)=>{
      const letter=(v[0]||'').trim();if(!letter)return;
      const id=currentIdentity();
      id.avatarLetter=letter.charAt(0).toUpperCase();id.avatarImage=null;
      if(S.activeAliasId==='main'){localStorage.removeItem('nanoAvatarImg');localStorage.setItem('nanoAvatar',id.avatarLetter);}
      saveHaloState();closeAvatarModal();renderMine();
    }
  });
}
function editName(){
  if(S.activeAliasId==='main' && S._mask){ haloOpenApp('mask.html','Mask'); showToast('主身份昵称来自人设，已为你打开人设页'); return; }
  openEditDialog({
    title:'修改昵称',
    fields:[{label:'昵称',value:currentIdentity().name||'',placeholder:'你的昵称'}],
    onSave:(v)=>{
      const name=(v[0]||'').trim();if(!name)return;
      const id=currentIdentity();
      id.name=name;id.handle='@'+name.toLowerCase().replace(/\s+/g,'');
      if(S.activeAliasId==='main'){localStorage.setItem('nanoName',id.name);localStorage.setItem('nanoHandle',id.handle);}
      saveHaloState();renderMine();
    }
  });
}
function loadProfile(){
  if(localStorage.getItem('nanoName')) S.identity.name=localStorage.getItem('nanoName');
  if(localStorage.getItem('nanoHandle')) S.identity.handle=localStorage.getItem('nanoHandle');
  if(localStorage.getItem('nanoAvatar')) S.identity.avatarLetter=localStorage.getItem('nanoAvatar');
  if(localStorage.getItem('nanoAvatarImg')) S.identity.avatarImage=localStorage.getItem('nanoAvatarImg');
  if(localStorage.getItem('nanoCover')) S.identity.cover=localStorage.getItem('nanoCover');
  if(localStorage.getItem('nanoSignature')) S.identity.signature=localStorage.getItem('nanoSignature');
  try{const a=JSON.parse(localStorage.getItem('nanoAliases')||'[]');if(Array.isArray(a))S.aliases=a;}catch(e){}
  const act=localStorage.getItem('nanoHaloActiveAlias');
  if(act && (act==='main'||(S.aliases||[]).some(a=>a&&a.id===act))) S.activeAliasId=act;
}
function saveAlias(){
  const n=$('aliasName').value.trim()||'新的我';
  const bio=$('aliasBio').value.trim();
  const a={id:'a'+Date.now(),name:n,handle:'@'+n.toLowerCase().replace(/\s+/g,''),avatarLetter:n.charAt(0).toUpperCase(),avatarImage:null,cover:null,bio,setting:bio};
  S.aliases.push(a);localStorage.setItem('nanoAliases',JSON.stringify(S.aliases));
  $('aliasName').value='';$('aliasBio').value='';
  saveHaloState();openPage('meHome');showToast('马甲已保存');
}

/* ============ 设置 ============ */
function toggleDark(){
  document.body.classList.toggle('dark');
  localStorage.setItem('nanoDark',document.body.classList.contains('dark')?'1':'0');
  updateDarkSwitches();
}
function updateDarkSwitches(){
  const on=document.body.classList.contains('dark');
  if($('darkSwitch2'))$('darkSwitch2').classList.toggle('on',on);
}
function clearAllData(){
  haloConfirm('确定清空 Halo 的直播、陌生人、私聊与群聊记录吗？角色库和人设不会被删除。',async()=>{
  // 只清理 Halo 自己的记录，不动人设/角色库/API/其他 App 的数据
  try{ await haloIdbDel(haloStateKey()); }catch(e){}
  try{ const all=JSON.parse(localStorage.getItem('nanoHaloFallback_v1')||'{}'); delete all[haloStateKey()]; localStorage.setItem('nanoHaloFallback_v1',JSON.stringify(all)); }catch(e){}
  S.liveRooms=[];S.interactedLives=[];S.myOwnLives=[];S.myReplays=[];
  S.dmStrangers=[];S.charMasks=[];S.chatLog={};
  S._dmFriendsPersist=[];S._dmStrangersPersist=[];S.dmBusy={};S.groupBusy={};S.dmPinned=[];S.dmDeleted=[];S.roomRecaps={};
  (S.groups||[]).forEach(g=>{g.last='';g.time='';g.unread=0});
  (S.myGroups||[]).forEach(g=>{g.last='';g.time='';g.unread=0});
  S.currentRoom=null;S.currentGroup=null;
  S.roomLog=[];S.audience=[];S.gifts={};
  S.liveTopic='全部';
  _clearSel={dm:{},grp:{}};_liveRefreshSel={};
  closeClearSheet();
  renderLiveTopics();renderLive();renderDM();renderGroupList();renderMine();renderChat();
  renderClearSheet();
  showToast('已清空 Halo 的聊天与直播记录');
  _savePending=false;clearTimeout(_saveTimer);persistNow();
  navTo('liveHome',false);
  await applyRealData();
  },'清空');
}

/* ============ 其他 ============ */
function openTagModal(type){
  const modal=document.createElement('div');modal.className='modal show';modal.id='tagModal';
  modal.innerHTML=`<div class="sheet"><div class="grab"></div><h2>添加话题</h2><input id="tagName" placeholder="话题名称"><textarea id="tagDesc" placeholder="可选描述。"></textarea><button class="primary-wide" onclick="saveTag('${type}')">添加话题</button><button class="secondary-wide" onclick="document.getElementById('tagModal').remove()">取消</button></div>`;
  document.body.appendChild(modal);
}
function saveTag(type){
  const n=$('tagName').value.trim();if(!n){showToast('请输入话题名称');return}
  const d=$('tagDesc').value.trim();const arr=type==='live'?S.liveTags:S.groupTags;
  if(arr.some(x=>x.name===n)){showToast('这个话题已经存在');return}
  arr.push({name:n,desc:d});document.getElementById('tagModal').remove();
  if(type==='live'){S.liveTopic=n;renderLiveTopics();renderLive()}else{renderCreateChoices()}
  showToast('话题已添加');
}
function looksNarration(v){return /[「『“"]/.test(v)===false && (v.length>18 || /他|她|房间|看向|沉默|抬眼|低头|笑了|安静/.test(v))}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

/* ============================================================
   与其他 App 互通：postMessage 协议 + 外部数据变更重同步
   ============================================================ */
function haloInFrame(){return !!(window.parent&&window.parent!==window)}
function haloPost(msg){try{if(haloInFrame())window.parent.postMessage(msg,'*')}catch(e){}}
function haloOpenApp(url,title){haloPost({type:'openFullscreen',url:url,title:title||'',showBack:true,source:'halo'})}
function haloGoDiscover(){
  // 用 closeFullscreen 让主框架直接回到 discover（并恢复底部导航栏），
  // 避免再叠一层 openFullscreen 导致底栏消失、需要按两次返回。
  if(haloInFrame()){ haloPost({type:'closeFullscreen'}); }
  else { try{ location.href='../index.html'; }catch(e){} }
}
function notifyHalo(title,body,app){
  try{if(window.NanoNotify&&NanoNotify.enabled())NanoNotify.notify(title,body,{app:'halo',channel:'halo',target:'halo'})}catch(e){}
}
function installHaloInterop(){
  if(window.__haloInteropInstalled)return;
  window.__haloInteropInstalled=true;
  try{
    window.addEventListener('message',(ev)=>{
      const d=ev&&ev.data;if(!d||!d.type)return;
      if(d.type==='currentMaskChanged'||d.type==='homeDataUpdated'||d.type==='contactsDataUpdated'){
        clearTimeout(window.__haloResyncT);
        window.__haloResyncT=setTimeout(()=>{syncIdentity().then(()=>{renderMine();renderDM();renderChat();})},300);
      }
    });
  }catch(e){}
  // 直播间操作面板：新增「加主播」入口
  const grid=document.querySelector('#actionSheet .action-grid');
  if(grid&&!$('haloAddStreamerAction')){
    const b=document.createElement('button');
    b.className='action-item';b.id='haloAddStreamerAction';
    b.innerHTML='<span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10" cy="8" r="3"/><path d="M4 20a6 6 0 0 1 12 0"/><path d="M18 8v6"/><path d="M15 11h6"/></svg></span>加主播';
    b.onclick=()=>{addCurrentStreamer()};
    grid.appendChild(b);
  }
  // 设置页：与其他 App 互通入口
  const sg=document.querySelector('#appSettings .settings-group');
  if(sg&&!$('haloInteropGroup')){
    const title=document.createElement('div');
    title.className='settings-group-title';title.id='haloInteropGroup';title.textContent='与其他 App 互通';
    sg.appendChild(title);
    [['人设 / 面具','编辑当前人设与马甲','mask.html'],
     ['角色库','管理绑定的 char','character.html'],
     ['世界书','查看绑定的世界设定','worldbook.html'],
     ['记忆库','查看长期记忆','memory.html']].forEach(([label,desc,url])=>{
      const row=document.createElement('div');row.className='settings-item';
      row.innerHTML=`<div><div class="label">${label}</div><div class="desc">${desc}</div></div>`;
      const btn=document.createElement('button');btn.className='pill-action';btn.textContent='打开';
      btn.onclick=()=>haloOpenApp(url,label);
      row.appendChild(btn);sg.appendChild(row);
    });
    [['我的个签','一句话介绍自己，其他人会读取',editSignature],
     ['图库','上传照片，可给主播换头像',openGallerySheet]].forEach(([label,desc,fn])=>{
      const row=document.createElement('div');row.className='settings-item';
      row.innerHTML=`<div><div class="label">${label}</div><div class="desc">${desc}</div></div>`;
      const btn=document.createElement('button');btn.className='pill-action';btn.textContent='编辑';
      btn.onclick=fn;
      row.appendChild(btn);sg.appendChild(row);
    });
  }
  // 私聊 / 我的：个签展示元素
  const uname=$('profileUsername');
  if(uname&&!$('profileSignature')){
    const d=document.createElement('div');d.id='profileSignature';d.className='profile-signature';
    d.onclick=editSignature;uname.after(d);
  }
  // 私聊设置：独立页面
  if(!$('dmSettings')){
    const pg=document.createElement('div');pg.className='page';pg.id='dmSettings';
    pg.innerHTML='<div class="scroll"><div class="topbar"><button class="iconbtn" onclick="goBack()"><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M15 5l-7 7 7 7"/></svg></button><div><div class="eyebrow">DM / SETTINGS</div><div class="title" id="dmSettingsName">私聊设置</div></div></div><div class="page-inner" id="dmSettingsBody"></div></div>';
    (document.getElementById('liveHome')?.parentNode||document.body).appendChild(pg);
  }
  // 直播总结页：分享这场（可发给好友分析）
  const sumStat=document.querySelector('#summary .summary-stat');
  if(sumStat&&!$('haloShareRecapBtn')){
    const b=document.createElement('button');
    b.className='secondary-wide';b.id='haloShareRecapBtn';b.style.marginTop='10px';
    b.textContent='分享这场直播总结';
    b.onclick=()=>openRecapShareSheet();
    sumStat.after(b);
  }
  // 礼物：用 SVG 图标重排
  const giftGrid=$('giftSheet')&&$('giftSheet').querySelector('.gift-grid');
  if(giftGrid){
    giftGrid.innerHTML=GIFT_KINDS.map(gg=>`<button class="gift" onclick="sendGift('${gg.name}',${gg.value})"><span class="gico">${giftSvg(gg.name)}</span>${gg.name} · ${gg.value}</button>`).join('');
  }
  // 群聊页：加入其他人的粉丝群
  const createGroupBtn=document.querySelector('#groupHome .page-inner button.secondary-wide');
  if(createGroupBtn&&!$('haloJoinGroupBtn')){
    const b=document.createElement('button');
    b.className='secondary-wide';b.id='haloJoinGroupBtn';b.style.marginTop='10px';
    b.textContent='＋ 加入其他人的粉丝群';
    b.onclick=openDiscoverGroups;
    createGroupBtn.after(b);
  }
  // 设置页「清空本地数据」改为分页面清空
  const dangerBtn=document.querySelector('#appSettings button.pill-action.danger');
  if(dangerBtn&&dangerBtn.getAttribute('onclick')==='clearAllData()'){
    dangerBtn.removeAttribute('onclick');dangerBtn.textContent='清空数据…';dangerBtn.onclick=openClearSheet;
  }
}

/* ============================================================
   角色马甲：char 给自己建立假身份，来试探 user
   ============================================================ */
function charMaskStrangerEntry(m){
  const log=S.chatLog[m.alias.name]||[];
  const last=log.length?log[log.length-1]:null;
  return {
    name:m.alias.name,prev:last?(last.text||last.foreign||'…'):'你好，在吗？',
    time:'刚刚',unread:true,avatar:m.alias.avatarImage||null,
    avatarLetter:m.alias.avatarLetter||String(m.alias.name||'?').charAt(0),
    isCharMask:true,maskId:m.id,maskOwner:m.charName,revealedAs:m.revealedAs||null
  };
}
function restoreCharMaskStrangers(){
  (S.charMasks||[]).forEach(m=>{
    if(!m||!m.alias||m.status==='closed')return;
    const hit=(S.dmStrangers||[]).findIndex(x=>x&&x.name===m.alias.name);
    if(hit<0) S.dmStrangers=(S.dmStrangers||[]).concat([charMaskStrangerEntry(m)]);
    else S.dmStrangers[hit].revealedAs=m.revealedAs||S.dmStrangers[hit].revealedAs||null;
  });
}
function isIdentityGuess(text,charName){
  const t=String(text||'');if(!t)return false;
  if(charName&&t.includes(charName))return true;
  return /是不是你|是你吧|我认出你了|别装了|你就是|冒充|露馅|我猜到|小号吧|是你的马甲/.test(t);
}
async function charMaskReply(name,target){
  const m=(S.charMasks||[]).find(x=>x.id===target.maskId)||(S.charMasks||[]).find(x=>x.alias.name===name);
  if(!m){await charDmReply(name,target);return}
  const char=(S._realChars||[]).find(c=>String(c.id)===String(m.charId))||charByName(m.charName);
  const recent=dmLogMessages(name).map(x=>x.content).join('\n');
  const msgs=dmLogMessages(name);
  const lastUser=([...msgs].reverse().find(x=>x.role==='user')||{}).content||'';
  if(!S._apiReady) throw new Error('未配置主 API');
  const ctx=await buildCharContext(char,recent);
  const revealed=m.status==='revealed';
  const suspected=!revealed && isIdentityGuess(lastUser,m.charName);
  const onAlias=!!(S.activeAliasId&&S.activeAliasId!=='main');
  const sys=[];
  if(revealed){
    sys.push(`你是「${m.charName}」。你之前用马甲「${name}」试探用户，现在身份已经被识破，你只能以真实身份继续和「${ctx.userName}」聊天。`);
    if(ctx.setting)sys.push('【你真实的人设】\n'+ctx.setting.slice(0,1600));
  }else{
    sys.push(`你在扮演一个陌生人「${name}」和「${ctx.userName}」私聊。表面人设：${m.setting||'一个普通网友'}。`);
    sys.push(`你的真实身份是「${m.charName}」。真实动机：${m.motive||'试探用户'}。`);
    if(onAlias){
      sys.push('【你并不认识对方】你眼里TA只是一个陌生网友。你隐约怀疑：这个陌生人会不会其实是真正的用户「'+(S.identity.name||'user')+'」在用另一个小号/马甲？你的试探就是围绕这个怀疑展开，但绝不能直接说破，也不能热情讨好。');
    }else{
      sys.push('你用这个马甲是为了试探用户是否认得出你（用户就是「'+(S.identity.name||'user')+'」本人）。');
    }
    sys.push(`【绝不暴露】你是${m.charName}这件事必须始终藏着：即使被怀疑，也要像正常人一样否认、装傻、岔开或反问，绝不主动承认、绝不暗示。只有对方非常笃定地直接点名你就是${m.charName}、并且你本人也愿意摊牌时，才可以承认；否则一直伪装。`);
    if(suspected)sys.push('【对方在怀疑你】对方的话里带着怀疑。默认继续否认/装傻/岔开；不要主动承认，也不要既否认又暗示。只有在极少数你觉得没必要再演的情况下，才在整条回复最前面加 [REVEAL] 后承认真实身份。');
    if(ctx.setting)sys.push('（你真实的人设，仅用于把握性格底色，不要直接说出来）\n'+ctx.setting.slice(0,1400));
  }
  sys.push('【对待陌生人】对方是陌生人，戒备可以有，但态度要符合你（马甲）的人设：人设冷淡就疏离，人设外向就不必刻意凶。只有对方反复纠缠、越界时才明显不耐烦；马甲被识破时按人设决定是否承认。');
  if(ctx.worldbook)sys.push('【世界书】\n'+ctx.worldbook);
  if(ctx.userSetting)sys.push('【对方设定】\n'+ctx.userSetting.slice(0,1000));
  { const sg=currentIdentity().signature; if(sg) sys.push('【对方个签】'+sg.slice(0,200)); }
  if(S.activeAliasId&&S.activeAliasId!=='main')sys.push(`【重要】对方现在用的身份是「${ctx.userName}」，不要提起其他身份或真名，也不要拆穿。`);
  if(ctx.memory)sys.push('【长期记忆】\n'+ctx.memory);
  sys.push('【输出】像真人在微信里发私信：把话拆成 1-4 条短消息，每条单独一行，口语化。若你决定承认真实身份，请在整条回复最前面加上 [REVEAL] 标记（只在真的承认时使用）。不要旁白、不要 markdown。');
  let txt=String(await HaloData.callMainText([{role:'system',content:sys.join('\n\n')},...msgs],{temperature:0.95})||'').trim();
  if(!txt) throw new Error('AI 未返回内容');
  let didReveal=false;
  if(/^\s*\[REVEAL\]/i.test(txt)){didReveal=true;txt=txt.replace(/^\s*\[REVEAL\]\s*/i,'').trim();}
  pushSplitChat(name,'member',txt||'……',name);
  touchDm(name);S.dmFriends=sortByPin(S.dmFriends||[]);S.dmStrangers=sortByPin(S.dmStrangers||[]);renderDM();
  if(didReveal&&m.status!=='revealed'){
    m.status='revealed';m.revealedAs=m.charName;
    pushChat(name,{who:'system',name:'System',kind:'reveal',text:`「${name}」承认了自己是 ${m.charName} 的马甲`,time:nowHM(),at:nowMin()});
    const s=(S.dmStrangers||[]).find(x=>x.name===name);if(s)s.revealedAs=m.charName;
    const f=(S.dmFriends||[]).find(x=>x.name===name);if(f)f.revealedAs=m.charName;
    saveHaloState();renderDM();
    showToast(m.charName+' 的马甲被识破了');
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  if(localStorage.getItem('nanoDark')==='1')document.body.classList.add('dark');
  init();
});
/* ============================================================
   Halo 数据层：读取 mask / character / api 数据
   依赖：无（纯原生 IndexedDB + localStorage）
   ============================================================ */

const HaloData = (() => {
  /* ---------- IndexedDB 通用工具 ---------- */
  function openDB(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = (e) => {
        if (typeof upgrade === 'function') upgrade(e.target.result, e);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* 打开 DB 时始终提供 upgrade：避免在目标 DB 尚未创建时以空库占位，
     导致 mask/character/api/worldbook 等页面因为版本相同而拿不到 store。 */
  function idbGetAll(dbName, storeName, version = 1, upgrade = null) {
    return openDB(dbName, version, upgrade).then((db) => new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve([]); return; }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => { db.close(); resolve(req.result || []); };
      req.onerror  = () => { db.close(); reject(req.error); };
    }));
  }

  function idbGet(dbName, storeName, key, version = 1, upgrade = null) {
    return openDB(dbName, version, upgrade).then((db) => new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(storeName)) { db.close(); resolve(undefined); return; }
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror  = () => { db.close(); reject(req.error); };
    }));
  }

  function idbPut(dbName, storeName, value, version = 1) {
    return openDB(dbName, version, (db) => {
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    }).then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror  = () => { db.close(); reject(req.error); };
    }));
  }

  /* ============================================================
     1. mask.js —— 人设 / user 信息
     ============================================================ */
  const MASK_KEYS = ['nano_mask_data', 'nano_home_data', 'peach_home_data'];

  function readMasks() {
    let raw = null, usedKey = null;
    for (const k of MASK_KEYS) {
      const v = localStorage.getItem(k);
      if (v) { raw = v; usedKey = k; break; }
    }
    if (!raw) return { masks: [], currentMaskId: null, _source: null };
    try {
      const data = JSON.parse(raw);
      return {
        masks: Array.isArray(data.masks) ? data.masks : [],
        currentMaskId: data.currentMaskId || (data.masks?.[0]?.id ?? null),
        _source: usedKey,
      };
    } catch (e) {
      console.warn('[HaloData] 解析人设数据失败:', e);
      return { masks: [], currentMaskId: null, _source: usedKey };
    }
  }

  function currentMask() {
    const { masks, currentMaskId } = readMasks();
    return masks.find(m => m.id === currentMaskId) || masks[0] || null;
  }

  /* 人设头像：IndexedDB MaskAvatarDB → avatars 表 */
  function ensureAvatarStore(db) {
    if (!db.objectStoreNames.contains('avatars')) db.createObjectStore('avatars', { keyPath: 'id' });
  }

  function getAvatarFromDB(id) {
    return idbGet('MaskAvatarDB', 'avatars', id, 1, ensureAvatarStore).then((rec) => {
      if (!rec) return null;
      // 兼容 {dataURL} / {data} / 直接字符串 三种存法
      if (typeof rec === 'string') return rec;
      return rec.dataURL || rec.data || rec.url || null;
    }).catch((e) => {
      console.warn('[HaloData] 读取人设头像失败:', e);
      return null;
    });
  }

  /* 人设备份：IndexedDB nano_mask_db → mask_data 表（key = 'data'） */
  function readMaskBackup() {
    const upgrade = (db) => {
      if (!db.objectStoreNames.contains('mask_data')) db.createObjectStore('mask_data', { keyPath: 'key' });
    };
    return idbGet('nano_mask_db', 'mask_data', 'data', 1, upgrade)
      .then((rec) => (rec && rec.value !== undefined ? rec.value : rec) || null)
      .catch((e) => {
        console.warn('[HaloData] 读取人设备份失败:', e);
        return null;
      });
  }

  /* ============================================================
     2. character.js —— char 信息 / 角色
     ============================================================ */
  function ensureCharacterStore(db) {
    if (!db.objectStoreNames.contains('characters')) db.createObjectStore('characters', { keyPath: 'id' });
  }

  function readCharacters() {
    return idbGetAll('nano_characters_db', 'characters', 1, ensureCharacterStore)
      .then((list) => Array.isArray(list) ? list : [])
      .catch((e) => {
        console.warn('[HaloData] 读取角色列表失败:', e);
        return [];
      });
  }

  /* 过滤：只保留 bindUser === 当前人设id 或 isNpc === true 的角色 */
  function filterCharacters(chars, maskId) {
    return (chars || []).filter((c) =>
      c && !c.nanoAssistant && (c.bindUser === maskId || c.isNpc === true)
    );
  }

  function visibleCharacters() {
    const mask = currentMask();
    const maskId = mask ? mask.id : null;
    return readCharacters().then((chars) => filterCharacters(chars, maskId));
  }

  /* 世界书：localStorage nano_worldbook_data_v5 / IndexedDB nano_worldbook_db → worldbook_data */
  function ensureWorldbookStore(db) {
    if (!db.objectStoreNames.contains('worldbook_data')) db.createObjectStore('worldbook_data', { keyPath: 'key' });
  }

  function readWorldbook() {
    const raw = localStorage.getItem('nano_worldbook_data_v5');
    if (raw) {
      try {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.files)) return Promise.resolve(d);
      } catch (e) { console.warn('[HaloData] 解析世界书(localStorage)失败:', e); }
    }
    return idbGet('nano_worldbook_db', 'worldbook_data', 'data', 1, ensureWorldbookStore)
      .then((rec) => (rec && rec.value && Array.isArray(rec.value.files)) ? rec.value : null)
      .catch((e) => {
        console.warn('[HaloData] 读取世界书(IndexedDB)失败:', e);
        return null;
      });
  }

  /* 世界书文本：全局整本 + 绑定到该角色的整本；条目按常驻 / 关键词命中 */
  function buildWorldbookText(wb, char, recentText) {
    if (!wb || !Array.isArray(wb.files)) return '';
    const c = char || {};
    const bindIds = {};
    (c.worldbookBindings || []).forEach((b) => { if (b && b.id) bindIds[String(b.id)] = true; });
    const idCands = [c.id, c.name].filter(Boolean).map(String);
    const lower = String(recentText || '').toLowerCase();
    const out = [];
    wb.files.forEach((f) => {
      if (!f) return;
      if ((f.scope || 'global') === 'local') {
        const bound = bindIds[String(f.id)] ||
          (Array.isArray(f.boundCharacters) && f.boundCharacters.some((b) => idCands.indexOf(String(b)) > -1));
        if (!bound) return;
      }
      (f.entries || []).forEach((en) => {
        if (!en || en.enabled === false) return;
        const content = String(en.content || '').trim();
        if (!content) return;
        const kws = String(en.keywords || '').trim();
        if (en.permanent !== true && en.keywordEnabled !== false && kws) {
          const hit = kws.split(/[,，、；\s]+/).filter(Boolean).some((k) => lower.indexOf(k.toLowerCase()) > -1);
          if (!hit) return;
        }
        out.push((en.title ? '【' + en.title + '】\n' : '') + content);
      });
    });
    let txt = out.join('\n\n');
    if (txt.length > 2600) txt = txt.slice(0, 2600) + '…';
    return txt;
  }

  function readWorldbookText(char, recentText) {
    return readWorldbook().then((wb) => buildWorldbookText(wb, char, recentText));
  }

  /* ============================================================
     3. api.js —— 主 API 配置
     全部配置：IndexedDB nano_api_db → api_data 表（keyPath = key），条目结构 {key, value}
     ============================================================ */
  function ensureApiStore(db) {
    if (!db.objectStoreNames.contains('api_data')) db.createObjectStore('api_data', { keyPath: 'key' });
    if (!db.objectStoreNames.contains('emoji_data')) db.createObjectStore('emoji_data', { keyPath: 'key' });
  }

  function readAllApiData() {
    return idbGetAll('nano_api_db', 'api_data', 2, ensureApiStore).catch((e) => {
      console.warn('[HaloData] 读取 API 数据失败:', e);
      return [];
    });
  }

  /* 把 IndexedDB 里的 [{key, value}] 转成 {key: value} 映射（兼容纯值写入） */
  function apiListToMap(list) {
    const map = {};
    (list || []).forEach((item) => {
      if (item && item.key) {
        map[item.key] = (item.value !== undefined) ? item.value : item;
      }
    });
    return map;
  }

  function readApiConfigLocal() {
    try {
      const raw = localStorage.getItem('nano_api_config');
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function readApiConfig() {
    return readAllApiData().then((list) => {
      const map = apiListToMap(list);
      let config = map['nano_api_config'] || null;
      if (!config || !config.mainUrl) config = readApiConfigLocal() || config;
      const presets = map['nano_api_presets_data'] || null;
      // 主 API 未单独保存时，回退到 main_ 预设
      if ((!config || !config.mainUrl) && presets && presets.main_ && presets.main_.url) {
        config = { mainUrl: presets.main_.url, mainKey: presets.main_.key, mainModel: presets.main_.model, mainTemp: presets.main_.temp };
      }
      return {
        raw: map,
        config,
        presets,
        assign: map['nano_api_assign'] || null,
        main: config ? {
          url:   config.mainUrl   || '',
          key:   config.mainKey   || '',
          model: config.mainModel || (presets && presets.main_ && presets.main_.model) || '',
          temp:  config.mainTemp,
        } : null,
      };
    });
  }

  /* 本地调试时把 localhost 换成当前访问的局域网 IP */
  function resolveApiHost(rawUrl) {
    try {
      const s = String(rawUrl || '').trim();
      if (!s) return s;
      const u = new URL(s);
      const host = u.hostname;
      const cur = window.location.hostname;
      const isLan = cur && (/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(cur) || /^10\./.test(cur) || /^192\.168\./.test(cur) || /^172\.(1[6-9]|2\d|3[01])\./.test(cur) || /\.local$/.test(cur));
      // 仅当页面也在本地/局域网时才把 localhost 换成当前主机，公网域名下保留原地址
      if ((host === 'localhost' || host === '127.0.0.1' || host === '[::1]') && isLan) {
        u.hostname = cur;
      }
      return u.toString();
    } catch (e) { return rawUrl; }
  }

  /* 统一补全 /v1，避免出现 /v1/v1 */
  function toV1Base(u) {
    let s = String(u || '').trim().replace(/\/+$/, '');
    if (!/\/v1$/i.test(s)) s = s + '/v1';
    return s;
  }

  /* ============================================================
     调用主 API：POST {base}/v1/chat/completions
     ============================================================ */
  async function callMainAPI(messages, options = {}) {
    const cfg = await readApiConfig();
    if (!cfg.main || !cfg.main.url) throw new Error('未配置主 API (nano_api_config)');
    if (!cfg.main.key) throw new Error('主 API 缺少 Key');

    const url = toV1Base(resolveApiHost(cfg.main.url)) + '/chat/completions';
    let chatMessages = messages;
    try {
      if (window.NanoPrompts && NanoPrompts.inject) chatMessages = NanoPrompts.inject(messages, 'social', { keepFormat: true });
    } catch (e) {}
    const body = {
      model: cfg.main.model,
      temperature: options.temperature ?? cfg.main.temp ?? 0.8,
      messages: chatMessages,
      stream: false,
      ...(options.extra || {}),
    };

    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), options.timeout || 45000) : null;
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.main.key,
        },
        body: JSON.stringify(body),
        signal: ctrl ? ctrl.signal : undefined,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`API ${res.status}（模型 ${cfg.main.model||'未设置'} @ ${url}）：${txt.slice(0, 200)}`);
    }
    return res.json();
  }

  /* 只取文本 */
  async function callMainText(messages, options = {}) {
    const data = await callMainAPI(messages, options);
    return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  }

  /* 只取 JSON（自动剥离 markdown 代码块） */
  async function callMainJSON(messages, options = {}) {
    const raw = await callMainText(messages, options);
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('AI 未返回 JSON');
    return JSON.parse(m[0]);
  }

  /* ============================================================
     4. memory.js —— 长期记忆（nano_vector_memory_db v5 → config store）
     ============================================================ */
  function memoryOpenDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no idb')); return; }
      const req = indexedDB.open('nano_vector_memory_db', 5);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('memories')) {
          const s = db.createObjectStore('memories', { keyPath: 'id' });
          s.createIndex('chatId', 'chatId', { unique: false });
          s.createIndex('type', 'type', { unique: false });
          s.createIndex('hasVector', 'hasVector', { unique: false });
        }
        if (!db.objectStoreNames.contains('config')) db.createObjectStore('config', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('chat_state')) db.createObjectStore('chat_state', { keyPath: 'chatId' });
        if (!db.objectStoreNames.contains('chat_messages')) db.createObjectStore('chat_messages', { keyPath: 'chatId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function readMemory(chatId, limit = 16) {
    if (!chatId) return Promise.resolve([]);
    if (window.NanoMemLink && window.NanoMemLink.readList) {
      return window.NanoMemLink.readList(chatId)
        .then((list) => (list || []).filter((it) => it && !it.groupId))
        .catch(() => []);
    }
    return memoryOpenDB().then((db) => new Promise((resolve) => {
      try {
        const r = db.transaction('config', 'readonly').objectStore('config').get('memlist_' + chatId);
        r.onsuccess = () => {
          db.close();
          const rec = r.result;
          const list = (rec && Array.isArray(rec.value)) ? rec.value : [];
          resolve(list.filter((it) => it && !it.groupId));
        };
        r.onerror = () => { db.close(); resolve([]); };
      } catch (e) { try { db.close(); } catch (e2) {} resolve([]); }
    })).catch(() => []);
  }

  function readMemoryText(chatId, limit = 16) {
    return readMemory(chatId, limit).then((list) =>
      list.slice(-(limit || 16)).map((it) => '· ' + (it.content || it.text || '')).filter((s) => s !== '· ').join('\n')
    );
  }

  /* ============================================================
     公开接口
     ============================================================ */
  return {
    /* mask */
    readMasks,
    currentMask,
    getAvatarFromDB,
    readMaskBackup,
    /* character */
    readCharacters,
    filterCharacters,
    visibleCharacters,
    readWorldbook,
    buildWorldbookText,
    readWorldbookText,
    /* api */
    readAllApiData,
    readApiConfig,
    callMainAPI,
    callMainText,
    callMainJSON,
    resolveApiHost,
    toV1Base,
    /* memory */
    readMemory,
    readMemoryText,
    /* 工具 */
    idbGet,
    idbGetAll,
    idbPut,
  };
})();