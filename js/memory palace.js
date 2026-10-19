(function(){
'use strict';

/* ============================================================
   常量定义
   ============================================================ */
const ROOMS=[
  {id:'social', seal:'亲', name:'社交关系'},
  {id:'emotion', seal:'情', name:'情感偏好'},
  {id:'place', seal:'地', name:'地理位置'},
  {id:'habit', seal:'常', name:'日常习惯'},
  {id:'event', seal:'事', name:'重要事件'},
  {id:'speech', seal:'言', name:'说话方式'},
  {id:'taboo', seal:'忌', name:'禁忌雷区'},
  {id:'keep', seal:'物', name:'珍藏之物'},
  {id:'wish', seal:'愿', name:'愿望梦想'},
  {id:'past', seal:'昔', name:'身世过往'},
  {id:'taste', seal:'味', name:'饮食口味'},
  {id:'secret', seal:'密', name:'秘密'}
];
const MOODS={'甜蜜':'#f2799a','安心':'#f2a98e','酸涩':'#be9ad0','刺痛':'#b04f6c','平淡':'#d8c0c8'};
const TIER=['遗忘','淡忘','依稀','记得','牢记','刻骨铭心'];
const GRP=[
  {n:'刻骨铭心', c:'#dd5c82'},
  {n:'牢记',     c:'#ec7a98'},
  {n:'记得',     c:'#f39bb0'},
  {n:'依稀',     c:'#f7bccb'},
  {n:'遗忘',     c:'#f0e4e8'}
];
const RING_COLORS=['#dd5c82','#ec7a98','#f39bb0','#f7bccb','#f0e4e8'];

/* 记忆 app 的 type -> 宫殿房间 */
const TYPE_ROOM={
  '重要事件':'event','事件':'event','约定':'event','承诺':'event',
  '用户偏好':'habit','偏好':'habit','习惯':'habit','日常':'habit',
  '情感':'emotion','情感关系':'emotion','关系':'emotion','态度':'emotion',
  '社交':'social','社交关系':'social','朋友':'social','家人':'social','人际':'social',
  '地点':'place','地理位置':'place','位置':'place','城市':'place',
  '说话方式':'speech','语言':'speech','口头禅':'speech','表达':'speech',
  '禁忌':'taboo','雷区':'taboo','不喜欢':'taboo','反感':'taboo',
  '珍藏':'keep','物品':'keep','纪念':'keep','礼物':'keep',
  '愿望':'wish','梦想':'wish','目标':'wish','期待':'wish',
  '身世':'past','过往':'past','经历':'past','背景':'past','过去':'past',
  '饮食':'taste','口味':'taste','食物':'taste','喜欢吃的':'taste',
  '秘密':'secret','隐私':'secret'
};

/* ============================================================
   工具函数
   ============================================================ */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>'mem_'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const clone=o=>JSON.parse(JSON.stringify(o));
const roomOf=id=>ROOMS.find(r=>r.id===id)||ROOMS[4];
const roomOfType=type=>{
  const t=String(type||'').trim();
  if(TYPE_ROOM[t])return TYPE_ROOM[t];
  for(const k in TYPE_ROOM){ if(t.indexOf(k)!==-1||k.indexOf(t)!==-1)return TYPE_ROOM[k]; }
  return 'event';
};
const grpOf=imp=>{
  if(imp>=5)return 0; if(imp>=4)return 1; if(imp>=3)return 2; if(imp>=1)return 3; return 4;
};

/* ============================================================
   IndexedDB 工具：直接读写真实存储
   ============================================================ */
// 版本无关打开：已存在的库（任意版本）直接用；不存在时按 v1 建库并补存储。
// 这样即使实际版本和这里写的不一致，也不会 VersionError 导致读不到角色/记忆。
function openDB(name,_version,upgrade){
  return new Promise(resolve=>{
    try{
      const req=indexedDB.open(name);
      req.onupgradeneeded=e=>{ try{ upgrade&&upgrade(e.target.result,e.target.transaction); }catch(_){} };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>resolve(null);
      req.onblocked=()=>resolve(null);
    }catch(e){ resolve(null); }
  });
}
function dbGet(db,store,key){
  return new Promise(resolve=>{
    if(!db){resolve(null);return;}
    try{
      const r=db.transaction(store,'readonly').objectStore(store).get(key);
      r.onsuccess=()=>resolve(r.result||null);
      r.onerror=()=>resolve(null);
    }catch(e){ resolve(null); }
  });
}
function dbGetAll(db,store){
  return new Promise(resolve=>{
    if(!db){resolve([]);return;}
    try{
      const r=db.transaction(store,'readonly').objectStore(store).getAll();
      r.onsuccess=()=>resolve(r.result||[]);
      r.onerror=()=>resolve([]);
    }catch(e){ resolve([]); }
  });
}
function dbPut(db,store,val){
  return new Promise(resolve=>{
    if(!db){resolve(false);return;}
    try{
      const tx=db.transaction(store,'readwrite');
      tx.objectStore(store).put(val);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=()=>resolve(false);
    }catch(e){ resolve(false); }
  });
}
function openCharDB(){
  return openDB('nano_characters_db',1,db=>{
    if(!db.objectStoreNames.contains('characters'))db.createObjectStore('characters',{keyPath:'id'});
  });
}
function openMemDB(){
  return openDB('nano_vector_memory_db',5,db=>{
    if(!db.objectStoreNames.contains('memories')){
      const s=db.createObjectStore('memories',{keyPath:'id'});
      try{s.createIndex('chatId','chatId',{unique:false});}catch(e){}
    }
    if(!db.objectStoreNames.contains('config'))db.createObjectStore('config',{keyPath:'key'});
    if(!db.objectStoreNames.contains('chat_state'))db.createObjectStore('chat_state',{keyPath:'chatId'});
    if(!db.objectStoreNames.contains('chat_messages'))db.createObjectStore('chat_messages',{keyPath:'chatId'});
  });
}

function readCurrentUser(){
  try{
    const keys=['nano_mask_data','nano_home_data','peach_home_data'];
    for(const k of keys){
      const raw=localStorage.getItem(k);
      if(raw){
        const d=JSON.parse(raw);
        if(d&&Array.isArray(d.masks)){
          return (d.masks||[]).find(m=>m.id===d.currentMaskId)||null;
        }
      }
    }
  }catch(e){}
  return null;
}

/* ============================================================
   数据映射
   ============================================================ */
function memTags(it){
  const arr=[];
  if(it&&it.type)arr.push(it.type);
  if(it&&Array.isArray(it.tags))it.tags.forEach(t=>{if(t&&arr.indexOf(t)===-1)arr.push(t);});
  return arr.slice(0,10);
}
function mapItemToMem(it){
  return {
    id:it.id||uid(),
    room:roomOfType(it.type),
    text:it.content||it.text||'',
    tags:memTags(it),
    date:it.date||it.time||'',
    mood:it.mood||'平淡',
    imp:(typeof it.importance==='number')?it.importance:3,
    _type:it.type||roomOf(it.room).name,
    _raw:it
  };
}
async function loadHearts(memDb,charId,charName){
  const rec=await dbGet(memDb,'chat_messages',charId);
  const msgs=(rec&&Array.isArray(rec.messages))?rec.messages:[];
  return msgs.filter(m=>m&&m.heart&&(m.heart.subject||m.heart.thought)).map(m=>({
    id:m.id||uid(),
    subject:m.heart.subject||'',
    thought:m.heart.thought||'',
    time:m.time||'',
    ts:m.ts||0,
    text:m.text||'',
    from:charName||''
  }));
}

/* ============================================================
   状态
   ============================================================ */
let S={chars:[]};
let charDb=null, memDb=null;
let curId=null, W=null;
let F={room:'',q:''};
let dirty=false;
let activeIndex=0;
let listShowAll=false;
const LIST_LIMIT=20;

const cur=()=>S.chars.find(c=>c.id===curId);
function markDirty(){dirty=true;renderSaveState();}
function markClean(){dirty=false;renderSaveState();}

/* ============================================================
   统计
   ============================================================ */
function stats(c){
  const g=[0,0,0,0,0];
  (c.mems||[]).forEach(m=>g[grpOf(m.imp)]++);
  return {g,total:c.mems.length,active:c.mems.length-g[4]};
}

/* ============================================================
   首页渲染
   ============================================================ */
function charInitial(c){
  const s=String(c.name||'?').trim();
  return esc(s.slice(0,1)||'?');
}
function renderCarousel(){
  const c=$('#carousel');
  if(!S.chars.length){
    c.innerHTML='<div class="empty" style="flex:1">还没有角色。<br>请先在角色库中创建角色。</div>';
    return;
  }
  c.innerHTML=S.chars.map((ch,i)=>{
    const st=stats(ch);
    const bgStyle=ch.avatar
      ? `style="background-image:url('${String(ch.avatar).replace(/'/g,'%27')}');background-size:cover;background-position:center"`
      : '';
    const bgInner=ch.avatar?'':charInitial(ch);
    return `<div class="char-card${i===activeIndex?' active':''}" data-index="${i}" data-id="${ch.id}">
      <div class="avatar-bg" ${bgStyle}>${bgInner}</div>
      <div class="card-info">
        <b>${esc(ch.name)}${ch.bound?' · 绑定':''}</b>
        <small>${esc(ch.desc||'还没有简介')}</small>
        <div class="mini-stats">
          <span>记忆 ${st.active} 条</span>
          ${st.g[0]?`<span>刻骨 ${st.g[0]}</span>`:''}
          ${(ch.hearts||[]).length?`<span>心声 ${ch.hearts.length}</span>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(()=>{
    const cards=c.querySelectorAll('.char-card');
    if(cards[activeIndex]){
      const card=cards[activeIndex];
      c.scrollTo({left:card.offsetLeft-(c.clientWidth-card.clientWidth)/2,behavior:'auto'});
    }
  });
}

function setActiveCard(i){
  activeIndex=i;
  document.querySelectorAll('.char-card').forEach((el,idx)=>el.classList.toggle('active',idx===i));
}

/* ============================================================
   内页
   ============================================================ */
function showPage(name){
  $('#pageSelect').hidden=name!=='select';
  $('#pagePalace').hidden=name!=='palace';
  window.scrollTo(0,0);
}

function enter(id){
  curId=id;W=clone(cur());F={room:'',q:''};$('#q').value='';
  dirty=false;
  showPage('palace');renderPalace();
}

function goSelect(){
  closeSheet();curId=null;W=null;dirty=false;
  showPage('select');renderCarousel();
}

function ringSvg(g,total){
  const R=42,C=2*Math.PI*R;
  let off=0,s=`<circle cx="54" cy="54" r="${R}" fill="none" stroke="#f7eaee" stroke-width="10"/>`;
  if(total){
    g.forEach((n,i)=>{
      if(!n)return;
      const len=C*n/total,vis=Math.max(len-2.5,1);
      s+=`<circle cx="54" cy="54" r="${R}" fill="none" stroke="${RING_COLORS[i]}" stroke-width="10" stroke-dasharray="${vis.toFixed(2)} ${(C-vis).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 54 54)" stroke-linecap="round"/>`;
      off+=len;
    });
  }
  return `<svg viewBox="0 0 108 108" aria-hidden="true">${s}</svg>`;
}

function renderStats(){
  const st=stats(W);
  const active=st.active;
  const legend=GRP.map((g,i)=>`<div><i style="background:${g.c}"></i>${g.n}<em>${st.g[i]}</em></div>`).join('');
  $('#statsCard').innerHTML=
    `<div class="stats-row">
      <div class="ring-wrap">${ringSvg(st.g,st.total)}<div class="ring-mid"><b>${active}</b><span>条记忆</span></div></div>
      <div class="legend">${legend}</div>
    </div>
    <div class="stats-note">${st.total?`共 ${st.total} 条记忆，其中 ${st.g[4]} 条已遗忘`:'还没有记忆，先存入第一条吧'} · 心声 ${(W.hearts||[]).length} 条</div>
    <div class="stats-note" style="margin-top:6px">★ 重要程度越高，角色越会牢记（4★ 以上每次对话都会带上）。</div>`;
}

function renderRails(){
  const rc={};
  W.mems.forEach(m=>{rc[m.room]=(rc[m.room]||0)+1;});
  const starCount=W.mems.filter(m=>m.imp>=4).length;
  if(F.room&&F.room!=='__star4'&&!rc[F.room])F.room='';
  if(F.room==='__star4'&&!starCount)F.room='';
  let h=`<button class="chip${F.room?'':' on'}" type="button" data-room="">全部 ${W.mems.length}</button>`;
  ROOMS.forEach(r=>{if(rc[r.id])h+=`<button class="chip${F.room===r.id?' on':''}" type="button" data-room="${r.id}">${r.seal} ${r.name} ${rc[r.id]}</button>`;});
  if(starCount)h+=`<button class="chip star-chip${F.room==='__star4'?' on':''}" type="button" data-room="__star4">★ 重要 4★+ ${starCount}</button>`;
  $('#roomRail').innerHTML=h;
}

function filtered(){
  const q=F.q.trim().toLowerCase();
  return W.mems.filter(m=>{
    if(F.room==='__star4'){ if(!(Number(m.imp)>=4))return false; }
    else if(F.room&&m.room!==F.room)return false;
    if(q&&!(m.text+' '+m.tags.join(' ')+' '+(m.date||'')+' '+roomOf(m.room).name).toLowerCase().includes(q))return false;
    return true;
  });
}

function fmtDate(d){
  if(!d)return '';
  try{
    const dt=new Date(d);
    if(isNaN(dt.getTime()))return d;
    return (dt.getMonth()+1)+'月'+dt.getDate()+'日';
  }catch(e){return d;}
}

function renderList(){
  const list=filtered();
  if(!W.mems.length){
    $('#list').innerHTML='<div class="empty">这里还没有记忆。<br>点击下方“存入记忆”，写下第一条。</div>';return;
  }
  if(!list.length){
    $('#list').innerHTML='<div class="empty">没有符合条件的记忆。<br>试试清除筛选或搜索。</div>';return;
  }
  const over=list.length>LIST_LIMIT;
  const shown=(over&&!listShowAll)?list.slice(0,LIST_LIMIT):list;
  let html=shown.map(m=>{
    const r=roomOf(m.room);
    const stars=Array.from({length:5},(_,i)=>`<span class="star${i<m.imp?' on':''}" data-act="star" data-id="${m.id}" data-v="${i+1}">★</span>`).join('');
    return `<div class="tl-item${m.imp===0?' forgot':''}" data-id="${m.id}" data-imp="${m.imp}">
      <div class="tl-body">
        <div class="tl-head">
          <span class="seal">${r.seal}</span>
          <span class="room-name">${r.name}</span>
          <span>${esc(m.mood)}</span>
          ${m.date?`<span class="when">${esc(fmtDate(m.date))}</span>`:''}
        </div>
        <p class="tl-text">${esc(m.text)}</p>
        <div class="tl-tags">${m.tags.map(t=>`<span>#${esc(t)}</span>`).join('')}</div>
        <div class="tl-controls">
          <div class="stars">${stars}<span class="label">${TIER[m.imp]}</span></div>
          <div class="tl-actions">
            <button class="fade" data-act="fade" data-id="${m.id}">任其淡去</button>
            <button class="focus" data-act="focus" data-id="${m.id}">着重记忆</button>
            <button data-act="edit" data-id="${m.id}">编辑</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  if(over){
    html+=`<button class="list-more" type="button" data-act="toggle-more">${listShowAll?'收起（仅显示前 '+LIST_LIMIT+' 条）':'展开全部 · 共 '+list.length+' 条'}</button>`;
  }
  $('#list').innerHTML=html;
}

function renderSaveState(){
  const btn=$('#btnSave');
  if(!W)return;
  if(dirty){
    btn.innerHTML='保存修改<span class="dot-mark"></span>';
    btn.classList.add('primary');
  }else{
    btn.textContent='保存修改';
    btn.classList.remove('primary');
  }
}

function renderPalace(){
  $('#topName').textContent=W.name;
  renderStats();renderRails();renderList();renderSaveState();
}

/* ============================================================
   保存：写回真实记忆库，并刷新角色记忆
   ============================================================ */
function applyMemToItem(m,orig,ch){
  const tags=(Array.isArray(m.tags)?m.tags:[]).filter(Boolean);
  const type=tags[0]||m._type||roomOf(m.room).name;
  const base=orig?clone(orig):{};
  base.id=orig?orig.id:(m.id||uid());
  base.type=type;
  base.content=m.text;
  base.importance=m.imp;
  if(tags.length>1)base.tags=tags.slice(1); else if(base.tags!==undefined)delete base.tags;
  if(!base.chatId)base.chatId=ch.id;
  if(!base.relatedChar)base.relatedChar=ch.name;
  if(!base.date)base.date=new Date().toISOString();
  if(!base.source)base.source='manual';
  if(typeof base.hasVector!=='boolean')base.hasVector=false;
  return base;
}

function notifyMemoryUpdated(charId){
  const msg={type:'NANO_MEMORY_UPDATED',chatId:charId};
  try{ if(window.parent!==window)window.parent.postMessage(msg,'*'); }catch(e){}
  try{ window.dispatchEvent(new CustomEvent('NANO_MEMORY_UPDATED',{detail:msg})); }catch(e){}
}

async function saveAll(){
  const ch=cur();
  if(!ch)return;
  const origList=Array.isArray(ch._rawList)?ch._rawList:[];
  const origById={};
  origList.forEach(it=>{if(it&&!it.groupId)origById[it.id]=it;});
  const groups=origList.filter(it=>it&&it.groupId);
  const rebuilt=W.mems.map(m=>applyMemToItem(m,origById[m.id]||null,ch));
  const out=rebuilt.concat(groups);
  const ok=await dbPut(memDb,'config',{key:'memlist_'+ch.id,value:out});
  if(!ok){toast('保存失败，请重试');return;}
  ch._rawList=out;
  ch.mems=clone(W.mems);
  W.hearts=ch.hearts;
  markClean();
  renderPalace();
  notifyMemoryUpdated(ch.id);
  toast('已保存，角色记忆已刷新');
}

/* ============================================================
   弹层
   ============================================================ */
const overlay=$('#overlay'),sheet=$('#sheet');
function openSheet(html){
  sheet.innerHTML='<div class="handle"></div>'+html;
  overlay.classList.add('show');
  document.body.style.overflow='hidden';
  sheet.scrollTop=0;
}
function closeSheet(){
  overlay.classList.remove('show');
  document.body.style.overflow='';
}
overlay.addEventListener('click',e=>{if(e.target===overlay)closeSheet();});

let toastTimer;
function toast(t){
  const el=$('#toast');el.textContent=t;el.classList.add('show');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2000);
}

/* ============================================================
   编辑记忆（含删除）
   ============================================================ */
function openForm(id){
  const m=id?W.mems.find(x=>x.id===id):null;
  const roomPick=ROOMS.map(r=>`<button class="chip${(m?m.room:'event')===r.id?' on':''}" type="button" data-pick="room" data-v="${r.id}">${r.seal} ${r.name}</button>`).join('');
  const moodPick=Object.keys(MOODS).map(k=>`<button class="chip${(m?m.mood:'甜蜜')===k?' on':''}" type="button" data-pick="mood" data-v="${k}">${k}</button>`).join('');
  openSheet(`
    <div class="sheet-head"><h3>${m?'编辑记忆':'存入记忆'}</h3><button class="close" data-act="close">×</button></div>
    <div class="sub">${m?'修改这段记忆的内容与重要程度':'写下 TA 会记得的一段'}</div>
    <div class="field"><label>记忆内容</label><textarea id="fText" placeholder="写下这段记忆……">${esc(m?m.text:'')}</textarea><div class="hint" id="fErr" style="color:#c0556f"></div></div>
    <div class="field"><label>标签（第一个标签会成为记忆分类，用空格或逗号隔开）</label><input type="text" id="fTags" placeholder="例如：重要事件 老家 桂花 九月" value="${esc(m?m.tags.join(' '):'')}"></div>
    <div class="field"><label>发生的时间</label><input type="text" id="fDate" placeholder="例如：去年夏天" value="${esc(m?m.date:'')}"></div>
    <div class="field"><label>放入房间</label><div class="pick" id="roomPick">${roomPick}</div></div>
    <div class="field"><label>当时的心情</label><div class="pick" id="moodPick">${moodPick}</div></div>
    <div class="field"><label>重要程度</label>
      <div class="pick" id="impPick">${[0,1,2,3,4,5].map(v=>`<button class="chip${(m?m.imp:3)===v?' on':''}" type="button" data-pick="imp" data-v="${v}">${v} · ${TIER[v]}</button>`).join('')}</div>
      <div class="hint">0 = 遗忘，TA 不会再提起；5 = 刻骨铭心。4★ 以上角色每次对话都会牢记。</div>
    </div>
    <div style="display:flex;gap:10px;margin-top:22px">
      ${m?`<button class="btn" style="flex:1;border-radius:14px;padding:12px;border:1px solid #f5d8de;background:#fff;color:#c0556f;font-weight:600" data-act="del">删除</button>`:''}
      <button class="btn" style="flex:1;border-radius:14px;padding:12px;border:1px solid var(--line);background:#fff;color:#85606c" data-act="close">取消</button>
      <button class="btn primary" style="flex:1;border-radius:14px;padding:12px;background:var(--deep);color:#fff;border:none;font-weight:600" data-act="save">${m?'完成修改':'存入'}</button>
    </div>
  `);
  sheet._draft={id:m?m.id:'',room:m?m.room:'event',mood:m?m.mood:'甜蜜',imp:m?m.imp:3};
  sheet._delArmed=false;
}

function saveForm(){
  const d=sheet._draft;
  const text=$('#fText').value.trim();
  if(!text){$('#fErr').textContent='请先写下记忆内容';return;}
  const seen={},tags=[];
  $('#fTags').value.split(/[\s,，、#]+/).forEach(t=>{if(t&&!seen[t]){seen[t]=1;tags.push(t);}});
  const date=$('#fDate').value.trim();
  const base={room:d.room,text,tags:tags.slice(0,8),date,mood:d.mood,imp:+d.imp};
  if(d.id)W.mems=W.mems.map(m=>m.id===d.id?Object.assign({id:m.id},base,{_type:m._type,_raw:m._raw}):m);
  else W.mems.push(Object.assign({id:uid()},base));
  markDirty();closeSheet();renderPalace();
  toast('已修改，记得点“保存修改”');
}

/* ============================================================
   历史心声
   ============================================================ */
function openHearts(){
  const raw=(W.hearts||[]).slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  // 去重：同样的心声只保留一条（按正文去重，正文为空时按主题），保留时间最新的一条
  const _seen={};
  const list=raw.filter(h=>{
    const k=String(h.thought||'').trim() || String(h.subject||'').trim();
    if(!k) return false;
    if(_seen[k]) return false;
    _seen[k]=1; return true;
  });
  const body=list.length?list.map(h=>`
    <div class="heart-item">
      <div class="heart-subject">${esc(h.subject||'此刻')}</div>
      <div class="heart-thought">${esc(h.thought||'')}</div>
      <div class="heart-meta">${h.time?esc(fmtDate(h.time)||h.time):''}${h.time?' · ':''}${esc(h.time||'')}</div>
    </div>`).join(''):'<div class="empty">TA 还没有留下过心声。</div>';
  openSheet(`
    <div class="sheet-head"><h3>历史心声</h3><button class="close" data-act="close">×</button></div>
    <div class="sub">${esc(W.name)} 藏在心里的独白（共 ${list.length} 条）</div>
    <div class="heart-list">${body}</div>
  `);
}

/* ============================================================
   事件绑定
   ============================================================ */
const carousel=$('#carousel');
carousel.addEventListener('scroll',()=>{
  const cards=[...carousel.querySelectorAll('.char-card')];
  if(!cards.length)return;
  const center=carousel.scrollLeft+carousel.clientWidth/2;
  let min=Infinity,idx=0;
  cards.forEach((c,i)=>{
    const cardCenter=c.offsetLeft+c.clientWidth/2;
    const dist=Math.abs(cardCenter-center);
    if(dist<min){min=dist;idx=i;}
  });
  if(idx!==activeIndex)setActiveCard(idx);
},{passive:true});

carousel.addEventListener('click',e=>{
  const card=e.target.closest('.char-card');if(!card)return;
  const idx=+card.getAttribute('data-index');
  if(idx===activeIndex){
    enter(card.getAttribute('data-id'));
  }else{
    setActiveCard(idx);
    const c=carousel;
    c.scrollTo({left:card.offsetLeft-(c.clientWidth-card.clientWidth)/2,behavior:'smooth'});
  }
});

$('#btnPick').addEventListener('click',()=>{
  const cards=carousel.querySelectorAll('.char-card');
  if(!cards.length){toast('还没有角色');return;}
  const card=cards[activeIndex];
  if(card)enter(card.getAttribute('data-id'));
});

/* 首页标题绑定返回逻辑 */
$('#brandTitle').addEventListener('click',()=>{
  if(window.parent!==window){
    window.parent.postMessage({type:'closeFullscreen'},'*');
  }else{
    history.back();
  }
});

$('#btnBack').addEventListener('click',()=>{
  if(dirty){openLeaveConfirm();}else{goSelect();}
});

$('#q').addEventListener('input',e=>{F.q=e.target.value;listShowAll=false;renderList();});

$('#roomRail').addEventListener('click',e=>{
  const b=e.target.closest('[data-room]');if(!b)return;
  F.room=b.getAttribute('data-room');listShowAll=false;renderRails();renderList();
});

$('#list').addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;
  const act=b.getAttribute('data-act'),id=b.getAttribute('data-id');
  if(act==='toggle-more'){listShowAll=!listShowAll;renderList();return;}
  const m=W.mems.find(x=>x.id===id);if(!m)return;
  if(act==='star'){
    const v=+b.getAttribute('data-v');
    m.imp=m.imp===v?0:v;
    markDirty();renderPalace();
  }else if(act==='fade'){
    m.imp=0;
    markDirty();renderPalace();
    toast('这段记忆已被遗忘');
  }else if(act==='focus'){
    m.imp=5;
    markDirty();renderPalace();
    toast('已刻骨铭心');
  }else if(act==='edit'){
    openForm(id);
  }
});

$('#btnAdd').addEventListener('click',()=>openForm(''));
$('#btnSave').addEventListener('click',()=>{
  if(!dirty){toast('没有需要保存的修改');return;}
  saveAll();
});

// 历史心声按钮（注入到底部操作区）
(function(){
  const ba=document.querySelector('.bottom-actions');
  if(!ba)return;
  const b=document.createElement('button');
  b.className='btn';b.id='btnHearts';b.type='button';b.textContent='历史心声';
  b.addEventListener('click',openHearts);
  ba.insertBefore(b,ba.firstChild);
})();

sheet.addEventListener('click',e=>{
  const b=e.target.closest('[data-act]');if(!b)return;
  const act=b.getAttribute('data-act');
  if(act==='close'){closeSheet();return;}
  if(act==='save'){saveForm();return;}
  if(act==='del'){
    if(!sheet._delArmed){
      sheet._delArmed=true;
      b.textContent='再点一次确认删除';
      b.style.background='#c0556f';
      b.style.color='#fff';
      return;
    }
    const d=sheet._draft;
    if(d&&d.id){
      W.mems=W.mems.filter(x=>x.id!==d.id);
      markDirty();closeSheet();renderPalace();
      toast('记忆已删除，记得点“保存修改”');
    }
    return;
  }
  if(act==='leave-save'){saveAll().then(goSelect);return;}
  if(act==='leave-drop'){goSelect();return;}
});
sheet.addEventListener('click',e=>{
  const b=e.target.closest('[data-pick]');if(!b)return;
  const key=b.getAttribute('data-pick'),v=b.getAttribute('data-v');
  sheet._draft[key]=isNaN(v)?v:+v;
  b.parentNode.querySelectorAll('.chip').forEach(c=>c.classList.toggle('on',c===b));
});

function openLeaveConfirm(){
  openSheet(`
    <div class="sheet-head"><h3>有未保存的修改</h3><button class="close" data-act="close">×</button></div>
    <div class="sub" style="margin-bottom:16px">现在离开的话，TA 的记忆不会改变。</div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn primary" style="border-radius:14px;padding:13px;background:var(--deep);color:#fff;border:none;font-weight:600" data-act="leave-save">保存并返回</button>
      <button class="btn" style="border-radius:14px;padding:13px;border:1px solid var(--line);background:#fff;color:#c0556f" data-act="leave-drop">放弃修改</button>
      <button class="btn" style="border-radius:14px;padding:13px;border:1px solid var(--line);background:#fff;color:#85606c" data-act="close">继续编辑</button>
    </div>
  `);
}

/* ============================================================
   启动
   ============================================================ */
async function boot(){
  charDb=await openCharDB();
  memDb=await openMemDB();
  if(!charDb||!memDb){toast('无法读取角色/记忆库');renderCarousel();return;}
  const chars=await dbGetAll(charDb,'characters');
  const user=readCurrentUser();
  const maskId=user&&user.id;
  const list=chars.filter(c=>c&&c.id&&c.name).filter(c=>{
    // 纳米（助手）不进入记忆宫殿
    const id=String(c.id||'').toLowerCase(), nm=String(c.name||'').trim();
    if(id==='nano'||id.indexOf('nano_')===0||id.indexOf('assistant')!==-1) return false;
    if(c.isNano||c.isAssistant) return false;
    if(nm==='纳米'||nm==='娜娜'||nm==='Nano') return false;
    // 用户隔离：只显示当前人设绑定的角色 / 本人生成的小号，不同 user 之间不互通
    if(maskId!=null&&maskId!==''){
      if(c.bindUser!=null&&String(c.bindUser)===String(maskId)) return true;
      if(c.isAltProbe&&c.altOriginId){
        const origin=chars.find(x=>x&&x.id===c.altOriginId);
        if(origin&&origin.bindUser!=null&&String(origin.bindUser)===String(maskId)) return true;
      }
      return false;
    }
    return true;
  });
  // 绑定到当前 user 的角色排在最前
  list.sort((a,b)=>{
    const ab=(maskId&&String(a.bindUser)===String(maskId))?0:1;
    const bb=(maskId&&String(b.bindUser)===String(maskId))?0:1;
    if(ab!==bb)return ab-bb;
    return String(a.name).localeCompare(String(b.name),'zh');
  });
  S.chars=[];
  // 大号 / 小号 记忆互通：小号不再是独立卡片，其记忆并入大号记忆库
  const visible=list.filter(c=>!(c.isAltProbe&&c.altOriginId));
  for(const c of visible){
    let rawList=[];
    if(window.NanoMemLink&&window.NanoMemLink.readList){
      rawList=await window.NanoMemLink.readList(c.id);
    }else{
      const rec=await dbGet(memDb,'config','memlist_'+c.id);
      rawList=(rec&&Array.isArray(rec.value))?rec.value:[];
    }
    if(!Array.isArray(rawList))rawList=[];
    const mems=rawList.filter(it=>it&&!it.groupId).map(mapItemToMem);
    let hearts=await loadHearts(memDb,c.id,c.name);
    // 合并该角色名下所有小号的历史心声
    try{
      if(window.NanoMemLink&&window.NanoMemLink.familyIds){
        const fids=(await window.NanoMemLink.familyIds(c.id))||[];
        for(const aid of fids){
          if(String(aid)===String(c.id))continue;
          const hs=await loadHearts(memDb,aid,c.name);
          if(hs.length)hearts=hearts.concat(hs);
        }
      }
    }catch(e){}
    S.chars.push({
      id:c.id,name:c.name,avatar:c.avatar||'',
      desc:String(c.setting||c.desc||c.persona||'').replace(/\s+/g,' ').slice(0,42),
      bound:!!(maskId&&c.bindUser===maskId),
      mems,hearts,_rawList:rawList
    });
  }
  if(activeIndex>=S.chars.length)activeIndex=0;
  renderCarousel();
}

// 从角色库/记忆页刷新返回时，重新拉取
window.addEventListener('message',e=>{
  const d=e.data;
  if(d&&(d.type==='contactsDataUpdated'||d.type==='NANO_MEMORY_UPDATED')){
    // 如果在首页则重载角色；内页则保留当前编辑
    if($('#pagePalace').hidden)boot();
  }
});
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&$('#pagePalace').hidden)boot();
});

boot();

})();
