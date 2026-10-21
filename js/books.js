/* =========================================================
   图书模块 js/books.js
   依赖：
     - mask.js / character.js / api.js 提供的数据约定
     - IndexedDB: nano_mask_db, nano_characters_db, nano_api_db,
                  nano_worldbook_db, MaskAvatarDB
     - localStorage: nano_mask_data, nano_worldbook_data_v5
   ========================================================= */

/* ==================== 状态 ==================== */
let books=[], currentBook=null, currentChapter=0;
let currentPage=0, totalPages=1, chapterPages=[];
let markedText='';
let markedForNextReply='';   // 标记段落只在下一轮 API 里引用一次，之后照常聊天
let currentBubble=null;
let folded=false;
let pagerMode='page';
let togetherMode=false;
let currentChar=null;            // 当前选择的 char 对象（{id,name,avatar,...}）
let currentCharName='', currentCharCls='c1';
let editingBookId=null;
let pendingCoverData=null;
let quotedText='';

let readingStartTime=0, readingTimer=null, currentStats=null;

/* 运行时缓存：人设 / 角色 / 世界书 / API 配置 */
let runtime = {
  mask: null,           // {id,name,wechat,gender,setting}
  characters: [],       // 过滤后的角色
  worldbook: null,      // 世界书内容
  api: null,            // {mainUrl, mainKey, mainModel, mainTemp}
  memory: []            // 当前角色的长期记忆文本
};

const charMemoryCache = {};

/* ==================== IndexedDB 通用 ==================== */
const BOOK_DB_NAME='BookReaderDB', BOOK_DB_VERSION=2;
const STORE_BOOKS='books', STORE_STATS='stats';
let bookDB=null;

function openBookDB(){
  return new Promise((res,rej)=>{
    const r=indexedDB.open(BOOK_DB_NAME,BOOK_DB_VERSION);
    r.onupgradeneeded=(e)=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(STORE_BOOKS)) d.createObjectStore(STORE_BOOKS,{keyPath:'id'});
      if(!d.objectStoreNames.contains(STORE_STATS)) d.createObjectStore(STORE_STATS,{keyPath:'key'});
    };
    r.onsuccess=(e)=>{ bookDB=e.target.result; res(bookDB); };
    r.onerror=()=>rej(r.error);
  });
}
function bGetAll(s){return new Promise((res,rej)=>{const t=bookDB.transaction(s,'readonly');const r=t.objectStore(s).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});}
function bPut(s,o){return new Promise((res,rej)=>{const t=bookDB.transaction(s,'readwrite');t.objectStore(s).put(o);t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}
function bDelete(s,k){return new Promise((res,rej)=>{const t=bookDB.transaction(s,'readwrite');t.objectStore(s).delete(k);t.oncomplete=()=>res();t.onerror=()=>rej(t.error);});}
function bGet(s,k){return new Promise((res,rej)=>{const t=bookDB.transaction(s,'readonly');const r=t.objectStore(s).get(k);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}

/* 通用打开某个 nano 库 */
function openNanoDB(dbName, storeName, keyPath){
  return new Promise((res,rej)=>{
    // 不指定版本：以当前实际版本打开，避免 nano_api_db(版本2) 等被降到版本1 触发 VersionError 而读不到配置
    const req=indexedDB.open(dbName);
    req.onupgradeneeded=(e)=>{
      const d=e.target.result;
      if(!d.objectStoreNames.contains(storeName)){
        d.createObjectStore(storeName, keyPath?{keyPath}:undefined);
      }
    };
    req.onsuccess=(e)=>res(e.target.result);
    req.onerror=()=>rej(req.error);
  });
}
function nanoGetAll(dbName, storeName){
  return new Promise(async (res)=>{
    try{
      const db=await openNanoDB(dbName, storeName, 'id');
      const t=db.transaction(storeName,'readonly');
      const r=t.objectStore(storeName).getAll();
      r.onsuccess=()=>res(r.result||[]);
      r.onerror=()=>res([]);
    }catch(e){ res([]); }
  });
}
function nanoGet(dbName, storeName, key){
  return new Promise(async (res)=>{
    try{
      const db=await openNanoDB(dbName, storeName, null);
      const t=db.transaction(storeName,'readonly');
      const r=t.objectStore(storeName).get(key);
      r.onsuccess=()=>res(r.result);
      r.onerror=()=>res(null);
    }catch(e){ res(null); }
  });
}

/* ==================== 读取运行时数据 ==================== */
async function loadRuntimeData(){
  // ---- 1. 人设 ----
  let masksData=null;
  try{
    const raw=localStorage.getItem('nano_mask_data')
      || localStorage.getItem('nano_home_data')
      || localStorage.getItem('peach_home_data');
    if(raw) masksData=JSON.parse(raw);
  }catch(e){}
  if(masksData && masksData.masks && masksData.masks.length){
    const currentId=masksData.currentMaskId;
    runtime.mask = masksData.masks.find(m=>m.id===currentId) || masksData.masks[0];
    // 头像
    if(runtime.mask){
      const av = await nanoGet('MaskAvatarDB','avatars', runtime.mask.id);
      if(av && av.dataURL) runtime.mask.avatar = av.dataURL;
      else if(av && av.data) runtime.mask.avatar = av.data;
    }
  }

  // ---- 2. 角色 ----
  const allChars = await nanoGetAll('nano_characters_db','characters');
  const maskId = runtime.mask ? runtime.mask.id : null;
  runtime.characters = allChars.filter(c => (c.bindUser===maskId || c.isNpc===true) && !c.nanoAssistant);

  // ---- 3. 世界书 ----
  try{
    const raw=localStorage.getItem('nano_worldbook_data_v5');
    if(raw) runtime.worldbook = JSON.parse(raw);
  }catch(e){}
  if(!runtime.worldbook){
    const wb = await nanoGet('nano_worldbook_db','worldbook_data','worldbook_data');
    if(wb) runtime.worldbook = wb.value || wb;
  }

  // ---- 4. API 配置 ----
  const cfg = await nanoGet('nano_api_db','api_data','nano_api_config');
  if(cfg){
    // api.js 存的是 {key, value}，value 里才是配置；兼容直接存配置的旧结构
    const v = (cfg.value && typeof cfg.value === 'object') ? cfg.value : cfg;
    runtime.api = {
      mainUrl: v.mainUrl || '',
      mainKey: v.mainKey || '',
      mainModel: v.mainModel || '',
      mainTemp: v.mainTemp != null ? v.mainTemp : 0.8
    };
  }
  // 兜底：IDB 读不到时用 localStorage（api.js 失败降级时写在这里）
  if(!runtime.api){
    try{
      const raw=localStorage.getItem('nano_api_config');
      if(raw){
        const v=JSON.parse(raw);
        runtime.api={
          mainUrl: v.mainUrl || '',
          mainKey: v.mainKey || '',
          mainModel: v.mainModel || '',
          mainTemp: v.mainTemp != null ? v.mainTemp : 0.8
        };
      }
    }catch(e){}
  }
}

/* ==================== 长期记忆（nano_vector_memory_db） ==================== */
/* 记忆库以 config/memlist_<charId> 存放，聊天、朋友圈、手机等模块共用同一份。 */
function readCharMemoryList(charId){
  if (window.NanoMemLink && window.NanoMemLink.readList) {
    return window.NanoMemLink.readList(charId).catch(() => []);
  }
  return new Promise((resolve)=>{
    if(!charId || typeof indexedDB==='undefined'){ resolve([]); return; }
    try{
      const req=indexedDB.open('nano_vector_memory_db',5);
      req.onupgradeneeded=(e)=>{
        const d=e.target.result, tx=e.target.transaction;
        try{
          if(!d.objectStoreNames.contains('memories')){
            const s=d.createObjectStore('memories',{keyPath:'id'});
            s.createIndex('chatId','chatId',{unique:false});
            s.createIndex('type','type',{unique:false});
            s.createIndex('hasVector','hasVector',{unique:false});
          }
          if(!d.objectStoreNames.contains('config')) d.createObjectStore('config',{keyPath:'key'});
          if(!d.objectStoreNames.contains('chat_state')) d.createObjectStore('chat_state',{keyPath:'chatId'});
          if(!d.objectStoreNames.contains('chat_messages')) d.createObjectStore('chat_messages',{keyPath:'chatId'});
        }catch(err){}
      };
      req.onsuccess=()=>{
        const db=req.result;
        try{
          const r=db.transaction('config','readonly').objectStore('config').get('memlist_'+charId);
          r.onsuccess=()=>{
            const list=(r.result&&Array.isArray(r.result.value))?r.result.value:[];
            resolve(list);
            try{db.close();}catch(e){}
          };
          r.onerror=()=>{ resolve([]); try{db.close();}catch(e){} };
        }catch(e){ resolve([]); try{db.close();}catch(e2){} }
      };
      req.onerror=()=>resolve([]);
    }catch(e){ resolve([]); }
  });
}
async function loadCharMemory(charId){
  if(charId && charMemoryCache[charId]) return charMemoryCache[charId];
  const list=await readCharMemoryList(charId);
  const texts=(list||[])
    .filter(it=>it && !it.groupId && (it.content||it.text))
    .slice(-40)
    .map(it=>(it.type?('【'+it.type+'】'):'')+(it.content||it.text));
  if(charId) charMemoryCache[charId]=texts;
  return texts;
}

/* ==================== 工具 ==================== */
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.remove('show'),1800);}
window.addEventListener('NANO_MEMORY_SUMMARY_FAILED', function(e){ try { var m=((e.detail&&e.detail.message)||'记忆总结失败'); toast(String(m).split('\n')[0]); } catch (x) {} });
function formatTime(ms){const min=Math.floor(ms/60000);if(min<60) return min+'分';return Math.floor(min/60)+'时'+(min%60)+'分';}

/* ==================== 初始化 ==================== */
async function init(){
  try{
    await openBookDB();
    books=await bGetAll(STORE_BOOKS);
    books.sort((a,b)=>(b.created||0)-(a.created||0));
    renderBooks();
    await loadStats();
    await loadRuntimeData();
    renderChars();
  }catch(e){ console.error(e); toast('初始化失败：'+e.message); }
}
init();

/* ==================== 书架 ==================== */
function renderBooks(){
  const g=document.getElementById('bookGrid');
  if(!books.length){ g.innerHTML='<div class="empty">还没有图书，先导入一本小说</div>'; return; }
  g.innerHTML=books.map(b=>{
    let coverHtml='';
    if(b.coverData) coverHtml=`<img src="${b.coverData}" alt="">`;
    else{
      const cs=b.coverColor||`linear-gradient(145deg,#b8b8c8,#9a9aae)`;
      coverHtml=`<div class="cover-fallback" style="${cs}">
        <div class="ct">${escapeHtml((b.title||'书').slice(0,10))}</div>
        <div class="ca">${escapeHtml(b.author||'')}</div>
      </div>`;
    }
    let progress=0;
    if(b.chapters && b.chapters.length){
      const ch=b.lastChapter||0;
      progress=Math.round((ch+1)/b.chapters.length*100);
    }
    return `
      <div class="book-cell" onclick="openBook('${b.id}')">
        <div class="book-cover-box">${coverHtml}</div>
        <div class="book-progress-row">
          ${b.isNew ? '<span class="book-new-badge">新增</span>' : `<span class="book-progress">${progress}%</span>`}
          <button class="book-menu" onclick="event.stopPropagation();openEdit('${b.id}')" aria-label="编辑">
            <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>
          </button>
        </div>
      </div>`;
  }).join('');
}

/* ==================== 导入 ==================== */
document.getElementById('fileInput').addEventListener('change', async e=>{
  const files=[...e.target.files];
  if(!files.length) return;
  toast('正在解析…');
  let ok=0;
  for(const f of files){
    try{
      const type=f.name.split('.').pop().toLowerCase();
      let text='', coverColor='', coverData='';
      if(type==='txt') text=await readText(f);
      else if(type==='epub'){ const r=await parseEpub(f); text=r.text; coverColor=r.coverColor; coverData=r.coverData; }
      if(!text||!text.trim()){ toast(f.name+' 内容为空'); continue; }
      const chapters=splitChapters(text);
      const b={
        id:'b_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
        title:f.name.replace(/\.(epub|txt)$/i,''),
        author:'', type, chapters, coverColor, coverData,
        created:Date.now(), lastChapter:0, isNew:true
      };
      await bPut(STORE_BOOKS,b);
      books.unshift(b); ok++;
    }catch(err){ console.error(err); toast('解析失败：'+err.message); }
  }
  renderBooks();
  e.target.value='';
  if(ok) toast('导入完成 '+ok+' 本');
});

function readText(file){
  return new Promise((res,rej)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      let buf=reader.result;
      let text=new TextDecoder('utf-8',{fatal:false}).decode(buf);
      const bad=(text.match(/\uFFFD/g)||[]).length;
      if(bad>text.length*0.02){ try{ text=new TextDecoder('gbk',{fatal:false}).decode(buf); }catch(e){} }
      res(text);
    };
    reader.onerror=()=>rej(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function parseEpub(file){
  if(!window.JSZip) throw new Error('EPUB 解析库加载失败');
  const zip=await JSZip.loadAsync(file);
  let coverColor='', coverData='', opfPath='';
  const opfList=Object.keys(zip.files).filter(p=>p.toLowerCase().endsWith('.opf'));
  if(opfList.length) opfPath=opfList[0];
  else{
    const c=zip.files['META-INF/container.xml'];
    if(c){ const xml=await c.async('text'); const m=xml.match(/full-path="([^"]+\.opf)"/i); if(m) opfPath=m[1]; }
  }
  let manifest={}, spineIds=[], opfDoc=null;
  if(opfPath && zip.files[opfPath]){
    const opfText=await zip.files[opfPath].async('text');
    opfDoc=new DOMParser().parseFromString(opfText,'application/xml');
    opfDoc.querySelectorAll('manifest > item').forEach(item=>{
      const id=item.getAttribute('id'), href=item.getAttribute('href'), mt=item.getAttribute('media-type')||'';
      if(id && href) manifest[id]={href, mediaType:mt};
    });
    opfDoc.querySelectorAll('spine > itemref').forEach(ref=>{
      const idref=ref.getAttribute('idref');
      if(idref) spineIds.push(idref);
    });
  }
  let coverHref='';
  if(opfDoc){
    const meta=opfDoc.querySelector('meta[name="cover"]');
    if(meta){ const cid=meta.getAttribute('content'); if(cid && manifest[cid]) coverHref=manifest[cid].href; }
    if(!coverHref){
      opfDoc.querySelectorAll('manifest > item').forEach(item=>{
        if((item.getAttribute('properties')||'').includes('cover-image')) coverHref=item.getAttribute('href');
      });
    }
    if(!coverHref){
      for(const id in manifest){ const m=manifest[id]; if(/cover/i.test(m.href)&&/image/i.test(m.mediaType)){ coverHref=m.href; break; } }
    }
    if(!coverHref){
      for(const id in manifest){ const m=manifest[id]; if(/image\//i.test(m.mediaType)){ coverHref=m.href; break; } }
    }
  }
  if(!coverHref){
    const img=Object.keys(zip.files).find(p=>/cover.*\.(jpg|jpeg|png|gif|webp)$/i.test(p))||Object.keys(zip.files).find(p=>/\.(jpg|jpeg|png|gif|webp)$/i.test(p));
    if(img) coverHref=img;
  }
  if(coverHref){
    try{
      const basePath=opfPath?opfPath.split('/').slice(0,-1).join('/'):'';
      let fullPath=basePath?basePath+'/'+coverHref:coverHref;
      fullPath=fullPath.split('/').reduce((acc,part)=>{
        if(part==='..') acc.pop(); else if(part!=='.'&&part!=='') acc.push(part); return acc;
      },[]).join('/');
      let entry=zip.files[fullPath]||zip.files[coverHref]||Object.values(zip.files).find(f=>f.name.endsWith(coverHref.split('/').pop()));
      if(entry){ const blob=await entry.async('blob'); coverData=await blobToDataURL(blob); coverColor=await extractAvgColor(blob); }
    }catch(e){ console.warn(e); }
  }
  let htmlFiles=[];
  if(spineIds.length && opfPath){
    const basePath=opfPath.split('/').slice(0,-1).join('/');
    for(const id of spineIds){
      const m=manifest[id]; if(!m) continue;
      if(!/\.x?html?$/i.test(m.href) && !/xml/i.test(m.mediaType)) continue;
      let fullPath=basePath?basePath+'/'+m.href:m.href;
      fullPath=fullPath.split('/').reduce((acc,part)=>{
        if(part==='..') acc.pop(); else if(part!=='.'&&part!=='') acc.push(part); return acc;
      },[]).join('/');
      htmlFiles.push(fullPath);
    }
  }
  if(!htmlFiles.length) htmlFiles=Object.keys(zip.files).filter(x=>/\.x?html?$/i.test(x));
  let out=[];
  for(const n of htmlFiles){
    if(!zip.files[n]) continue;
    const s=await zip.files[n].async('text');
    const d=new DOMParser().parseFromString(s,'text/html');
    d.querySelectorAll('script,style,nav,head').forEach(x=>x.remove());
    const t=(d.body?.innerText||d.body?.textContent||'').trim();
    if(t) out.push(t);
  }
  return { text: out.join('\n\n'), coverColor, coverData };
}

function blobToDataURL(blob){return new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>res('');r.readAsDataURL(blob);});}
function extractAvgColor(blob){
  return new Promise(res=>{
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{
      try{
        const c=document.createElement('canvas'); const size=24;
        c.width=size; c.height=size;
        const ctx=c.getContext('2d');
        ctx.drawImage(img,0,0,size,size);
        const data=ctx.getImageData(0,0,size,size).data;
        let r=0,g=0,b=0,n=0;
        for(let i=0;i<data.length;i+=4){ r+=data[i]; g+=data[i+1]; b+=data[i+2]; n++; }
        r=Math.round(r/n); g=Math.round(g/n); b=Math.round(b/n);
        URL.revokeObjectURL(url);
        res(`linear-gradient(145deg, rgb(${r+18},${g+18},${b+18}), rgb(${Math.max(0,r-25)},${Math.max(0,g-25)},${Math.max(0,b-25)}))`);
      }catch(e){ URL.revokeObjectURL(url); res(''); }
    };
    img.onerror=()=>{ URL.revokeObjectURL(url); res(''); };
    img.src=url;
  });
}

/* ==================== 章节解析 ==================== */
function splitChapters(text){
  if(!text) return [''];
  const t=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  const cn=/(?:^|\n)\s*(第[0-9一二三四五六七八九十百千万零〇两]+[章节回卷部篇][^\n]{0,40})\s*(?=\n|$)/g;
  const en=/(?:^|\n)\s*((?:Chapter|CHAPTER|chapter)\s+[0-9IVXLC]+[^\n]{0,60})\s*(?=\n|$)/g;
  let matches=[], m;
  while((m=cn.exec(t))!==null) matches.push({index:m.index,title:m[1].trim()});
  if(matches.length<2){ matches=[]; while((m=en.exec(t))!==null) matches.push({index:m.index,title:m[1].trim()}); }
  if(matches.length<2){
    const paras=t.split(/\n{2,}/).filter(p=>p.trim());
    if(paras.length<=1) return [t.trim()];
    const size=Math.max(1,Math.ceil(paras.length/4));
    const arr=[];
    for(let i=0;i<paras.length;i+=size) arr.push(paras.slice(i,i+size).join('\n\n'));
    return arr;
  }
  const arr=[];
  for(let i=0;i<matches.length;i++){
    const start=matches[i].index;
    const end=i<matches.length-1?matches[i+1].index:t.length;
    arr.push(t.slice(start,end).trim());
  }
  return arr;
}

/* ==================== 分页 / 连续滚动 ==================== */
function pageContentHtml(content, first, title){
  return (first ? `<h2>${escapeHtml(title||'')}</h2>` : '') +
    String(content||'').split('\n').map(p=>`<p>${escapeHtml(p)}</p>`).join('');
}

// 按“阅读区真实可用高度”分页：页首标题也计入高度，保证每一页都不需要上下滚动。
function paginateChapter(text, container, title){
  const w=container.clientWidth;
  const h=container.clientHeight;
  if(!w||!h) return [String(text||'')];

  const measure=document.createElement('div');
  measure.className='reader-measure';
  measure.style.cssText=`
    position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;
    width:${w}px;height:${h}px;padding:8px 26px 140px;box-sizing:border-box;
    line-height:${container.style.lineHeight||'1.9'};
    font-size:${container.style.fontSize||'17px'};
    font-family:inherit;
  `;
  document.body.appendChild(measure);

  const paras=String(text||'').split(/\n+/).map(s=>s.trim()).filter(Boolean);
  const pages=[];
  let buffer='';
  let firstPage=true;
  function fits(content){
    measure.innerHTML=pageContentHtml(content, firstPage, title);
    return measure.scrollHeight <= measure.clientHeight + 1;
  }
  function flush(){
    if(buffer){ pages.push(buffer); buffer=''; firstPage=false; }
  }

  for(const p of paras){
    const candidate=buffer ? buffer+'\n'+p : p;
    if(fits(candidate)){ buffer=candidate; continue; }
    if(buffer) flush();
    if(fits(p)){ buffer=p; continue; }

    // 单段太长：按字符二分查找能放下的最大前缀，绝不把整段硬塞进一页
    let rest=p;
    while(rest){
      let lo=1, hi=rest.length, best=0;
      while(lo<=hi){
        const mid=(lo+hi)>>1;
        if(fits(rest.slice(0,mid))){ best=mid; lo=mid+1; }
        else hi=mid-1;
      }
      if(best<=0){
        // 极端小屏：先让标题单独占一页，再重新量正文
        if(firstPage){ pages.push(''); firstPage=false; continue; }
        best=1;
      }
      buffer=rest.slice(0,best);
      rest=rest.slice(best);
      if(rest) flush(); else break;
    }
  }
  flush();

  document.body.removeChild(measure);
  return pages.length ? pages : [String(text||'')];
}

/* ==================== 打开图书 ==================== */
function openBook(id){
  currentBook=books.find(x=>x.id===id);
  if(!currentBook) return;
  const maxChapter=Math.max(0,(currentBook.chapters||[]).length-1);
  currentChapter=Math.max(0,Math.min(maxChapter,Number(currentBook.lastChapter)||0));
  const saved=(currentBook.readPos&&currentBook.readPos[currentChapter])||{};
  currentPage=Math.max(0,Number(saved.page)||0);
  pendingModeRatio=null;
  markedText='';
  document.getElementById('readerTitle').textContent=currentBook.title;
  showPage('readerPage');
  requestAnimationFrame(()=>{
    renderReader();
    renderDrawer();
    startReadingTimer();
  });
}

let pendingModeRatio=null;
let forceChapterTop=false;
let readerStyleRendering=false;
function saveReadingPosition(){
  if(!currentBook) return;
  const map=currentBook.readPos=currentBook.readPos||{};
  let ratio=0;
  if(pagerMode==='scroll'){
    const sc=document.getElementById('scrollReader');
    const max=sc?Math.max(0,sc.scrollHeight-sc.clientHeight):0;
    ratio=max?Math.max(0,Math.min(1,sc.scrollTop/max)):0;
  }else{
    ratio=totalPages>1?currentPage/(totalPages-1):0;
  }
  map[currentChapter]={page:currentPage,ratio:ratio,ts:Date.now()};
  currentBook.lastChapter=currentChapter;
  try{ bPut(STORE_BOOKS,currentBook).catch(function(){}); }catch(e){}
}

function updatePageIndicator(){
  const el=document.getElementById('pageIndicator');
  if(!el) return;
  if(!currentBook){ el.textContent=''; return; }
  if(pagerMode==='scroll'){
    const sc=document.getElementById('scrollReader');
    const max=sc?Math.max(1,sc.scrollHeight-sc.clientHeight):1;
    const pct=sc?Math.round((sc.scrollTop/max)*100):0;
    el.textContent=(currentChapter+1)+'/'+(currentBook.chapters||[]).length+' 章 · '+pct+'%';
  }else{
    el.textContent=(currentPage+1)+' / '+totalPages;
  }
}

function renderScrollReader(text){
  const body=document.getElementById('readerBody');
  const overlay=document.getElementById('brightnessOverlay');
  const sc=document.createElement('div');
  sc.className='scroll-reader';
  sc.id='scrollReader';
  const title=currentBook.title+' · 第 '+(currentChapter+1)+' 章';
  sc.innerHTML=`<h2>${escapeHtml(title)}</h2>`+
    String(text||'').split('\n').map(p=>`<p>${escapeHtml(p)}</p>`).join('');
  sc.style.fontSize=body.style.fontSize||'17px';
  sc.style.lineHeight=body.style.lineHeight||'1.9';
  body.insertBefore(sc,overlay);

  const saved=(currentBook.readPos&&currentBook.readPos[currentChapter])||{};
  const ratio=forceChapterTop ? 0 : Math.max(0,Math.min(1,Number(saved.ratio)||0));
  forceChapterTop=false;
  requestAnimationFrame(()=>{
    const max=Math.max(0,sc.scrollHeight-sc.clientHeight);
    sc.scrollTop=Math.round(max*ratio);
    updatePageIndicator();
  });
  sc._userScrolled=false;
  sc.addEventListener('touchstart',function(){ sc._userScrolled=true; },{passive:true});
  sc.addEventListener('wheel',function(){ sc._userScrolled=true; },{passive:true});
  sc.addEventListener('pointerdown',function(){ sc._userScrolled=true; },{passive:true});
  sc.addEventListener('scroll',()=>{
    updatePageIndicator();
    clearTimeout(sc._saveTimer);
    sc._saveTimer=setTimeout(saveReadingPosition,300);
    if(!sc._userScrolled || sc._advancing) return;
    var max=sc.scrollHeight-sc.clientHeight;
    if(max>40 && sc.scrollTop+sc.clientHeight>=sc.scrollHeight-2 && currentBook && currentChapter<currentBook.chapters.length-1){
      sc._advancing=true;
      saveReadingPosition();
      setTimeout(function(){
        if(!document.body.contains(sc)) return;
        currentChapter++;
        currentPage=0;
        forceChapterTop=true;
        currentBook.readPos=currentBook.readPos||{};
        currentBook.readPos[currentChapter]={page:0,ratio:0,ts:Date.now()};
        currentBook.lastChapter=currentChapter;
        try{ bPut(STORE_BOOKS,currentBook).catch(function(){}); }catch(e){}
        renderReader(); renderDrawer();
        toast('第 '+(currentChapter+1)+' 章');
      },450);
    }
  },{passive:true});
}

function renderReader(){
  if(!currentBook) return;
  const body=document.getElementById('readerBody');
  const overlay=document.getElementById('brightnessOverlay');
  const reader=document.getElementById('readerPage');
  body.innerHTML='';
  body.appendChild(overlay);
  // 先套用当前字号/行距，再分页；否则会按默认 17px 量高度，页面就会溢出。
  try{
    const fsEl=document.getElementById('fontSize');
    const lhEl=document.getElementById('lineHeight');
    if(fsEl) body.style.fontSize=(parseFloat(fsEl.value)||17)+'px';
    if(lhEl) body.style.lineHeight=lhEl.value||'1.9';
  }catch(e){}
  reader.classList.toggle('pager-page',pagerMode==='page');
  reader.classList.toggle('pager-scroll',pagerMode==='scroll');

  const chapterText=currentBook.chapters[currentChapter]||'';

  if(pagerMode==='scroll'){
    chapterPages=[];
    totalPages=1;
    currentPage=0;
    pendingModeRatio=null;
    renderScrollReader(chapterText);
    applyReaderStyle(false);
    updateTimeBar();
    return;
  }

  const measurer=document.createElement('div');
  measurer.style.cssText=`
    position:absolute;visibility:hidden;pointer-events:none;left:-9999px;top:0;
    width:${body.clientWidth}px;height:${body.clientHeight}px;
    line-height:${body.style.lineHeight||'1.9'};
    font-size:${body.style.fontSize||'17px'};
  `;
  document.body.appendChild(measurer);
  const title=currentBook.title+' · 第 '+(currentChapter+1)+' 章';
  const pages=paginateChapter(chapterText, measurer, title);
  document.body.removeChild(measurer);
  forceChapterTop=false;

  chapterPages=pages;
  totalPages=pages.length;
  if(pendingModeRatio!=null){
    currentPage=Math.round(pendingModeRatio*Math.max(0,totalPages-1));
    pendingModeRatio=null;
  }
  if(currentPage>=totalPages) currentPage=totalPages-1;
  if(currentPage<0) currentPage=0;

  renderPagePanels(currentPage);
  applyReaderStyle(false);
  updateTimeBar();
  updatePageIndicator();
  bindSwipe();
}

function renderPagePanels(index){
  const body=document.getElementById('readerBody');
  const overlay=document.getElementById('brightnessOverlay');
  [...body.querySelectorAll('.page-panel')].forEach(p=>p.remove());

  const title=`${currentBook.title} · 第 ${currentChapter+1} 章`;

  for(let offset=-1;offset<=1;offset++){
    const i=index+offset;
    if(i<0||i>=totalPages) continue;
    const panel=document.createElement('div');
    panel.className='page-panel';
    panel.dataset.index=i;
    const content=chapterPages[i]||'';
    panel.innerHTML=(i===0?`<h2>${escapeHtml(title)}</h2>`:'')+
      content.split('\n').map(p=>`<p>${escapeHtml(p)}</p>`).join('');
    panel.style.fontSize=body.style.fontSize||'17px';
    panel.style.lineHeight=body.style.lineHeight||'1.9';
    if(offset===0) panel.classList.add('current');
    else if(offset<0) panel.classList.add('prev');
    else panel.classList.add('next');
    body.insertBefore(panel,overlay);
  }
  const b=document.getElementById('brightness').value;
  if(b) applyBrightness(b);
}

function goToPage(i, dir){
  if(i<0||i>=totalPages) return;
  const body=document.getElementById('readerBody');
  const oldC=body.querySelector('.page-panel.current');
  const np=body.querySelector(`.page-panel[data-index="${i}"]`);
  if(!np){ currentPage=i; renderPagePanels(i); updatePageIndicator(); saveReadingPosition(); return; }
  if(oldC){ oldC.classList.remove('current'); oldC.classList.add(dir>0?'prev':'next'); }
  np.classList.remove('prev','next');
  np.classList.add('current');
  currentPage=i;
  updatePageIndicator();
  saveReadingPosition();
}

function nextPage(){
  if(currentPage<totalPages-1) goToPage(currentPage+1, 1);
  else{
    if(currentBook && currentChapter<currentBook.chapters.length-1){
      currentChapter++; currentPage=0;
      forceChapterTop=true;
      currentBook.readPos=currentBook.readPos||{};
      currentBook.readPos[currentChapter]={page:0,ratio:0,ts:Date.now()};
      currentBook.lastChapter=currentChapter;
      try{ bPut(STORE_BOOKS,currentBook).catch(function(){}); }catch(e){}
      renderReader(); renderDrawer();
      toast('第 '+(currentChapter+1)+' 章');
    }else toast('已经是最后一页了');
  }
}
function prevPage(){
  if(currentPage>0) goToPage(currentPage-1, -1);
  else{
    if(currentBook && currentChapter>0){
      currentChapter--;
      currentBook.lastChapter=currentChapter;
      currentPage=0;
      try{ bPut(STORE_BOOKS,currentBook).catch(function(){}); }catch(e){}
      renderReader(); renderDrawer();
      requestAnimationFrame(()=>{ if(totalPages>1) goToPage(totalPages-1, -1); });
      toast('第 '+(currentChapter+1)+' 章');
    }else toast('已经是第一页了');
  }
}

let swipeState={x:0,y:0,active:false};
let suppressTapUntil=0;
function bindSwipe(){
  const body=document.getElementById('readerBody');
  if(body._swipeBound) return;
  body._swipeBound=true;
  body.addEventListener('touchstart',e=>{
    if(pagerMode!=='page'){ swipeState.active=false; return; }
    const p=e.touches[0];
    swipeState.x=p.clientX; swipeState.y=p.clientY; swipeState.active=true;
  },{passive:true});
  body.addEventListener('touchend',e=>{
    if(pagerMode!=='page' || !swipeState.active) return;
    swipeState.active=false;
    const p=e.changedTouches[0];
    const dx=p.clientX-swipeState.x, dy=p.clientY-swipeState.y;
    if(Math.abs(dx)>40 && Math.abs(dx)>Math.abs(dy)){
      suppressTapUntil=Date.now()+350;
      if(dx<0) nextPage(); else prevPage();
    }
  },{passive:true});
}

function onReaderTap(e){
  if(Date.now()<suppressTapUntil) return;
  if(e.target.closest('.reader-dock')) return;
  if(e.target.closest('.reader-topbar')) return;
  if(e.target.closest('.chat-window')||e.target.closest('.float-ball')) return;
  if(e.target.closest('.mark-toolbar')) return;
  const rect=document.getElementById('readerBody').getBoundingClientRect();
  const w=rect.width, x=e.clientX-rect.left;
  if(pagerMode==='page'){
    if(x<w*0.28){ prevPage(); return; }
    if(x>w*0.72){ nextPage(); return; }
  }
  toggleFold();
}

function toggleFold(){
  folded=!folded;
  document.getElementById('readerTimeBar').classList.toggle('folded',folded);
  document.getElementById('readerDock').classList.toggle('folded',folded);
  updateBallVisibility();
  if(folded) document.getElementById('chatWindow').classList.remove('show');
}

/* ==================== 章节 ==================== */
function changeChapter(n){
  if(!currentBook) return;
  const next=currentChapter+n;
  if(next<0){ toast('已经是第一章'); return; }
  if(next>=currentBook.chapters.length){ toast('已经是最后一章'); return; }
  currentChapter=next; currentPage=0;
  forceChapterTop=n>0;
  if(n>0){ currentBook.readPos=currentBook.readPos||{}; currentBook.readPos[currentChapter]={page:0,ratio:0,ts:Date.now()}; }
  currentBook.lastChapter=currentChapter;
  try{ bPut(STORE_BOOKS,currentBook).catch(function(){}); }catch(e){}
  renderReader(); renderDrawer();
  toast('第 '+(currentChapter+1)+' 章');
}
function jumpChapter(i){
  currentChapter=i;
  const saved=(currentBook&&currentBook.readPos&&currentBook.readPos[i])||{};
  currentPage=Math.max(0,Number(saved.page)||0);
  if(currentBook){
    currentBook.lastChapter=i;
    try{ bPut(STORE_BOOKS,currentBook).catch(function(){}); }catch(e){}
  }
  renderReader(); closeDrawer();
}
function renderDrawer(){
  const list=document.getElementById('drawerList');
  if(!currentBook){ list.innerHTML=''; return; }
  list.innerHTML=currentBook.chapters.map((c,i)=>{
    const first=(c.split('\n')[0]||'').trim();
    const title=first.length>0 && first.length<30 ? escapeHtml(first) : '第 '+(i+1)+' 章';
    return `<div class="drawer-item ${i===currentChapter?'active':''}" onclick="jumpChapter(${i})">${title}</div>`;
  }).join('');
}
function openDrawer(){
  renderDrawer();
  document.getElementById('drawer').classList.add('show');
  document.getElementById('drawerMask').classList.add('show');
}
function closeDrawer(){
  document.getElementById('drawer').classList.remove('show');
  document.getElementById('drawerMask').classList.remove('show');
}

/* ==================== 标记分享 ==================== */
function showMarkToolbar(range){
  const tb=document.getElementById('markToolbar');
  // 固定钉在屏幕底部：iOS 长按选词时系统自带菜单出现在选区上方，
  // 之前把工具栏放在选区上方会被系统菜单盖住，「分享给 Char」点不到。
  tb.style.left='50%';
  tb.style.top='auto';
  tb.style.bottom='calc(22px + env(safe-area-inset-bottom, 0px))';
  tb.classList.add('show');
}
function hideMarkToolbar(){ document.getElementById('markToolbar').classList.remove('show'); }
function clearMark(){
  window.getSelection()?.removeAllRanges();
  document.querySelectorAll('.marked').forEach(el=>{
    const p=el.parentNode;
    while(el.firstChild) p.insertBefore(el.firstChild,el);
    p.removeChild(el); p.normalize();
  });
  markedText=''; hideMarkToolbar();
}
document.addEventListener('selectionchange',()=>{
  const sel=window.getSelection();
  if(!sel||!sel.rangeCount||sel.isCollapsed){ hideMarkToolbar(); return; }
  const text=sel.toString().trim();
  if(!text) return;
  const active=document.querySelector('.page.active');
  if(!active||active.id!=='readerPage') return;
  const range=sel.getRangeAt(0);
  const body=active.querySelector('.reader-body');
  if(!body||!body.contains(range.commonAncestorContainer)) return;
  showMarkToolbar(range);
});
function shareMark(){
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||!sel.toString().trim()){ toast('请先选中要分享的文字'); return; }
  markedText=sel.toString().trim();
  try{
    const range=sel.getRangeAt(0);
    const span=document.createElement('span');
    span.className='marked';
    range.surroundContents(span);
  }catch(e){
    try{
      const range=sel.getRangeAt(0);
      const span=document.createElement('span');
      span.className='marked';
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }catch(e2){ console.warn(e2); }
  }
  sel.removeAllRanges();
  hideMarkToolbar();
  if(!togetherMode) toggleTogether();
  openChatWindow();
  toast('已标记，选择角色开始讨论');
}

/* ==================== 一起看 ==================== */
function updateBallVisibility(){
  const ball=document.getElementById('floatBall');
  const chat=document.getElementById('chatWindow');
  const inReader=document.getElementById('readerPage').classList.contains('active');
  const show=togetherMode && (!inReader || !folded);
  ball.classList.toggle('show',show);
  if(!show && chat) chat.classList.remove('show');
}
function toggleTogether(){
  togetherMode=!togetherMode;
  const t=document.getElementById('iconTogether');
  const s=document.getElementById('iconSolo');
  const btn=document.getElementById('togetherBtn');
  if(togetherMode){
    t.style.display='none'; s.style.display='block';
    btn.classList.add('on');
    updateBallAvatar();
    updateBallVisibility();
    toast('Books 模式');
  }else{
    t.style.display='block'; s.style.display='none';
    btn.classList.remove('on');
    flushAux();
    document.getElementById('chatWindow').classList.remove('show');
    updateBallVisibility();
    currentChar=null; currentCharName='';
    toast('已切回独自看书');
  }
}
function updateBallAvatar(){
  const ball=document.getElementById('floatBall');
  if(currentChar){
    if(currentChar.avatar){
      ball.innerHTML=`<img src="${currentChar.avatar}" alt="">`;
    }else{
      ball.textContent=currentChar.name[0]||'?';
      ball.style.background='linear-gradient(145deg,#b8b8c8,#9a9aae)';
    }
  }else{
    ball.textContent='阅';
    ball.style.background='linear-gradient(145deg,#b8b8c8,#9a9aae)';
  }
}

/* ==================== 悬浮球拖拽 ==================== */
let ballDrag={dragging:false,startX:0,startY:0,origX:0,origY:0,moved:false};
function startDrag(e){
  e.preventDefault();
  const ball=document.getElementById('floatBall');
  const rect=ball.getBoundingClientRect();
  const appRect=document.getElementById('app').getBoundingClientRect();
  const p=e.touches?e.touches[0]:e;
  ballDrag.dragging=true; ballDrag.moved=false;
  ballDrag.startX=p.clientX; ballDrag.startY=p.clientY;
  ballDrag.origX=rect.left-appRect.left; ballDrag.origY=rect.top-appRect.top;
  ball.classList.add('dragging');
  document.addEventListener('mousemove',onDrag);
  document.addEventListener('touchmove',onDrag,{passive:false});
  document.addEventListener('mouseup',endDrag);
  document.addEventListener('touchend',endDrag);
}
function onDrag(e){
  if(!ballDrag.dragging) return;
  e.preventDefault();
  const ball=document.getElementById('floatBall');
  const app=document.getElementById('app');
  const appRect=app.getBoundingClientRect();
  const p=e.touches?e.touches[0]:e;
  const dx=p.clientX-ballDrag.startX;
  const dy=p.clientY-ballDrag.startY;
  if(Math.abs(dx)>4||Math.abs(dy)>4) ballDrag.moved=true;
  let nx=ballDrag.origX+dx;
  let ny=ballDrag.origY+dy;
  nx=Math.max(0,Math.min(appRect.width-44,nx));
  ny=Math.max(0,Math.min(appRect.height-44,ny));
  ball.style.left=nx+'px'; ball.style.top=ny+'px';
  ball.style.right='auto'; ball.style.bottom='auto';
}
function endDrag(e){
  if(!ballDrag.dragging) return;
  ballDrag.dragging=false;
  document.getElementById('floatBall').classList.remove('dragging');
  document.removeEventListener('mousemove',onDrag);
  document.removeEventListener('touchmove',onDrag);
  document.removeEventListener('mouseup',endDrag);
  document.removeEventListener('touchend',endDrag);
  if(!ballDrag.moved) toggleChatWindow();
}

/* ==================== 聊天窗 ==================== */
function openChatWindow(){
  const w=document.getElementById('chatWindow');
  w.classList.add('show');
  const ball=document.getElementById('floatBall');
  const br=ball.getBoundingClientRect();
  const ar=document.getElementById('app').getBoundingClientRect();
  const wW=320, wH=440;
  let left=br.left-ar.left+44-wW;
  let top=br.top-ar.top-wH-10;
  if(left<8) left=8;
  if(left+wW>ar.width-8) left=ar.width-wW-8;
  if(top<8) top=br.bottom-ar.top+10;
  if(top+wH>ar.height-8) top=ar.height-wH-8;
  w.style.left=left+'px'; w.style.top=top+'px';
  w.style.right='auto'; w.style.bottom='auto';
  if(!currentChar) showCharPicker();
}
function closeChatWindow(){
  document.getElementById('chatWindow').classList.remove('show');
  // 聊完收起小窗：把本次对话收尾总结进长期记忆
  try{ flushAux(); }catch(e){}
}
/* 点击悬浮球：已在显示则收起，否则展开 */
function toggleChatWindow(){
  const w=document.getElementById('chatWindow');
  if(w.classList.contains('show')) closeChatWindow();
  else openChatWindow();
}

/* ==================== 聊天窗拖拽 ==================== */
let winDrag={dragging:false,startX:0,startY:0,origX:0,origY:0,moved:false};
function startWinDrag(e){
  const win=document.getElementById('chatWindow');
  if(!win.classList.contains('show')) return;
  if(e.target.closest('.cw-close')) return;
  const appRect=document.getElementById('app').getBoundingClientRect();
  const rect=win.getBoundingClientRect();
  const p=e.touches?e.touches[0]:e;
  winDrag.dragging=true; winDrag.moved=false;
  winDrag.startX=p.clientX; winDrag.startY=p.clientY;
  winDrag.origX=rect.left-appRect.left; winDrag.origY=rect.top-appRect.top;
  document.addEventListener('mousemove',onWinDrag);
  document.addEventListener('touchmove',onWinDrag,{passive:false});
  document.addEventListener('mouseup',endWinDrag);
  document.addEventListener('touchend',endWinDrag);
}
function onWinDrag(e){
  if(!winDrag.dragging) return;
  e.preventDefault();
  const win=document.getElementById('chatWindow');
  const appRect=document.getElementById('app').getBoundingClientRect();
  const p=e.touches?e.touches[0]:e;
  const dx=p.clientX-winDrag.startX, dy=p.clientY-winDrag.startY;
  if(Math.abs(dx)>4||Math.abs(dy)>4) winDrag.moved=true;
  let nx=Math.max(0,Math.min(appRect.width-win.offsetWidth, winDrag.origX+dx));
  let ny=Math.max(0,Math.min(appRect.height-win.offsetHeight, winDrag.origY+dy));
  win.style.left=nx+'px'; win.style.top=ny+'px';
  win.style.right='auto'; win.style.bottom='auto';
}
function endWinDrag(){
  if(!winDrag.dragging) return;
  winDrag.dragging=false;
  document.removeEventListener('mousemove',onWinDrag);
  document.removeEventListener('touchmove',onWinDrag);
  document.removeEventListener('mouseup',endWinDrag);
  document.removeEventListener('touchend',endWinDrag);
}
(function bindChatWindowDrag(){
  const win=document.getElementById('chatWindow');
  if(!win) return;
  const head=win.querySelector('.chat-window-head');
  let lpTimer=null, lpX=0, lpY=0, lpActive=false;
  function isInteractive(t){
    return !!(t && t.closest && (t.closest('.cw-close')||t.closest('button')||t.closest('input')||t.closest('textarea')||t.closest('.bubble')||t.closest('.bubble-menu')||t.closest('.quote-preview')));
  }
  function onDown(e){
    if(!win.classList.contains('show')) return;
    if(isInteractive(e.target)) return;
    const p=e.touches?e.touches[0]:e;
    if(head && head.contains(e.target)){ startWinDrag(e); return; }
    // 非标题栏区域：长按 350ms 才进入拖拽，避免和滚动/点按冲突
    lpX=p.clientX; lpY=p.clientY; lpActive=false;
    clearTimeout(lpTimer);
    lpTimer=setTimeout(function(){ lpActive=true; startWinDrag(e); }, 350);
  }
  function onPreMove(e){
    if(lpActive) return;
    const p=e.touches?e.touches[0]:e;
    if(Math.abs(p.clientX-lpX)>8||Math.abs(p.clientY-lpY)>8){ clearTimeout(lpTimer); }
  }
  win.addEventListener('mousedown',onDown);
  win.addEventListener('touchstart',onDown,{passive:true});
  win.addEventListener('mousemove',onPreMove);
  win.addEventListener('touchmove',onPreMove,{passive:true});
})();

/* iOS 键盘弹出时隐藏悬浮球，并把聊天窗抬到键盘上方 */
(function watchKeyboard(){
  if(!window.visualViewport) return;
  const vv=window.visualViewport;
  let parentKb=0, localKb=0;
  function apply(){
    const kb=Math.max(parentKb, localKb);
    document.documentElement.style.setProperty('--nano-kb', kb+'px');
    document.documentElement.classList.toggle('keyboard-open', kb>0.5);
    document.body.classList.toggle('keyboard-open', kb>120);
  }
  function upd(){ localKb=Math.max(0, Math.round(window.innerHeight - vv.height)); apply(); }
  vv.addEventListener('resize',upd);
  vv.addEventListener('scroll',upd);
  window.addEventListener('message',function(e){ var d=e.data; if(d&&d.type==='nanoKeyboard'){ parentKb=Math.max(0,Math.round(Number(d.kb)||0)); apply(); } });
  setTimeout(upd,300);
})();

function renderChars(){
  // 挂到 window 便于内联使用
  window._runtimeChars = runtime.characters;
}
function showCharPicker(){
  const body=document.getElementById('chatWindowBody');
  document.getElementById('cwName').textContent='选择角色';
  document.getElementById('cwSub').textContent='选择一个 Char 一起阅读';
  document.getElementById('cwAvatar').textContent='选';
  const chars = runtime.characters || [];
  if(!chars.length){
    body.innerHTML='<div style="color:#9a9ca0;font-size:13px;padding:20px;text-align:center">没有可用的角色，请先在角色库中添加或绑定当前人设</div>';
    return;
  }
  body.innerHTML=`<div style="padding:8px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
    ${chars.map((c,idx)=>{
      const avatarHtml = c.avatar
        ? `<img src="${escapeHtml(c.avatar)}" alt="">`
        : escapeHtml((c.name||'?')[0]);
      return `
        <div style="background:#fff;border-radius:14px;padding:12px 6px;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.04)" onclick="pickCharByIndex(${idx})">
          <div style="width:40px;height:40px;margin:0 auto;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:650;background:linear-gradient(145deg,#b8b8c8,#9a9aae)">${avatarHtml}</div>
          <div style="font-size:11.5px;margin-top:7px;font-weight:550">${escapeHtml(c.name||'无名')}</div>
        </div>`;
    }).join('')}
  </div>`;
}
function pickCharByIndex(idx){
  const c = runtime.characters[idx];
  if(!c) return;
  pickChar(c);
}
async function pickChar(c){
  currentChar = c;
  currentCharName = c.name || 'Char';
  document.getElementById('cwAvatar').innerHTML = c.avatar
    ? `<img src="${escapeHtml(c.avatar)}" alt="">`
    : escapeHtml((c.name||'?')[0]);
  document.getElementById('cwName').textContent = currentCharName;
  document.getElementById('cwSub').textContent='正在一起阅读';
  updateBallAvatar();
  document.getElementById('chatWindowBody').innerHTML='';
  addTimeDivider();
  // 读取该角色的长期记忆，供后续对话使用（与聊天/朋友圈共用一份记忆库）
  runtime.memory = [];
  try{ runtime.memory = await loadCharMemory(c.id || c.name); }catch(e){}
  // 记录到辅助记忆，音乐/图书里的对话会被总结进 memlist_<charId>
  try{ if(window.AuxMemory) window.AuxMemory.track(c.id || c.name, { charName: currentCharName }); }catch(e){}
  // 初始：char 先说一句，但不调用 API，等用户点回复
  addMsg('char', currentCharName, c.avatar, null, `我看到你标记的这段文字了：「${markedText||'（未选择）'}」。想听听你的想法。`, '');
}
let lastTimeShown='';
function addTimeDivider(){
  const box=document.getElementById('chatWindowBody');
  const now=new Date();
  const t=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  if(t===lastTimeShown) return;
  lastTimeShown=t;
  const el=document.createElement('div');
  el.style.cssText='text-align:center;color:#a0a0a5;font-size:10.5px;margin:8px 0 4px;letter-spacing:.2px';
  el.textContent=t;
  box.appendChild(el);
}

/* 通用添加消息 */
function addMsg(side, nick, avatar, cls, text, quote){
  const box=document.getElementById('chatWindowBody');
  const el=document.createElement('div');
  el.className='msg '+(side==='me'?'me':'');
  let avatarHtml;
  if(side==='me'){
    const meAvatar = runtime.mask && runtime.mask.avatar ? runtime.mask.avatar : null;
    avatarHtml = meAvatar ? `<img src="${escapeHtml(meAvatar)}" alt="">` : '我';
  }else{
    avatarHtml = avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : (nick[0]||'?');
  }
  el.innerHTML=`
    <div class="avatar-sm ${side==='me'?'':(cls||'')}">${avatarHtml}</div>
    <div class="bubble-wrap">
      <div class="nick">${escapeHtml(nick)}</div>
      ${quote?`<div class="quote-bubble">${escapeHtml(quote)}</div>`:''}
      <div class="bubble">${escapeHtml(text)}</div>
    </div>`;
  el.querySelector('.bubble').addEventListener('dblclick',e=>{
    e.stopPropagation();
    showBubbleMenu(e.currentTarget,el);
  });
  box.appendChild(el);
  box.scrollTop=box.scrollHeight;
  return el;
}

/* 打字气泡 */
function addTyping(){
  const box=document.getElementById('chatWindowBody');
  const el=document.createElement('div');
  el.className='msg'; el.id='typingMsg';
  const avatarHtml = currentChar && currentChar.avatar
    ? `<img src="${escapeHtml(currentChar.avatar)}" alt="">`
    : (currentCharName[0]||'阅');
  el.innerHTML=`
    <div class="avatar-sm">${avatarHtml}</div>
    <div class="bubble-wrap">
      <div class="nick">${escapeHtml(currentCharName)}</div>
      <div class="bubble typing-bubble"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
    </div>`;
  box.appendChild(el);
  box.scrollTop=box.scrollHeight;
  return el;
}
function removeTyping(){ const el=document.getElementById('typingMsg'); if(el) el.remove(); }

function showBubbleMenu(target,msg){
  currentBubble=msg;
  const m=document.getElementById('bubbleMenu');
  const r=target.getBoundingClientRect();
  m.classList.add('show');
  let left=r.left;
  if(left+130>window.innerWidth) left=window.innerWidth-140;
  if(left<10) left=10;
  m.style.left=left+'px';
  m.style.top=Math.max(10,r.top-50)+'px';
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.bubble') && !e.target.closest('.bubble-menu')){
    document.getElementById('bubbleMenu').classList.remove('show');
  }
});
function quoteMessage(){
  if(!currentBubble) return;
  const t=currentBubble.querySelector('.bubble').innerText.replace(/\n/g,' ').trim();
  setQuote(t);
  document.getElementById('bubbleMenu').classList.remove('show');
  document.getElementById('chatInput').focus();
}
function editMessage(){
  if(!currentBubble) return;
  const b=currentBubble.querySelector('.bubble');
  const q=b.querySelector('.quote');
  const qh=q?q.outerHTML:'';
  const old=b.innerText.replace(q?q.innerText:'').trim();
  const input=document.createElement('textarea');
  input.value=old;
  input.style.cssText='width:100%;border:0;outline:0;background:transparent;color:inherit;font:inherit;resize:none';
  b.innerHTML=qh; b.appendChild(input);
  input.focus();
  input.onblur=()=>{ b.innerHTML=qh+escapeHtml(input.value); };
  document.getElementById('bubbleMenu').classList.remove('show');
}
function deleteMessage(){
  if(!currentBubble) return;
  currentBubble.remove(); currentBubble=null;
  document.getElementById('bubbleMenu').classList.remove('show');
}

/* ==================== 引用预览 ==================== */
function setQuote(text){
  quotedText=text;
  const qp=document.getElementById('quotePreview');
  const qt=document.getElementById('quotePreviewText');
  qt.textContent=text;
  qp.classList.add('show');
}
function cancelQuote(){
  quotedText='';
  document.getElementById('quotePreview').classList.remove('show');
}

/* ==================== 构建 prompt ==================== */
/* 世界书结构：{files:[{ entries:[{content,enabled}] }]}，兼容旧格式 */
function buildWorldbookText(){
  const wb=runtime.worldbook;
  if(!wb) return '';
  if(typeof wb==='string') return wb.trim();
  if(Array.isArray(wb)) return wb.map(w=>w&&(w.content||w.text)||'').filter(Boolean).join('\n');
  if(Array.isArray(wb.files)){
    const out=[];
    wb.files.forEach(f=>{
      if(!f) return;
      (f.entries||[]).forEach(en=>{
        if(!en||en.enabled===false) return;
        const c=en.content||en.text;
        if(c&&String(c).trim()) out.push(String(c).trim());
      });
    });
    return out.join('\n');
  }
  if(wb.content) return String(wb.content).trim();
  return '';
}

function buildSystemPrompt(){
  const me=(runtime.mask&&runtime.mask.name)||'用户';
  const charName=(currentChar&&currentChar.name)||'你';
  let sys='你正在和用户一起读一本书，像两个真实的人凑在一块儿看同一页，随口聊聊。';
  if(runtime.mask){
    sys+=`\n\n【用户人设】\n`;
    if(runtime.mask.name) sys+=`名字：${runtime.mask.name}\n`;
    if(runtime.mask.gender) sys+=`性别：${runtime.mask.gender}\n`;
    if(runtime.mask.setting) sys+=`设定：${runtime.mask.setting}\n`;
  }
  if(currentChar){
    sys+=`\n【你扮演的角色（${charName}）】\n`;
    if(currentChar.name) sys+=`名字：${currentChar.name}\n`;
    if(currentChar.gender) sys+=`性别：${currentChar.gender}\n`;
    if(currentChar.nationality) sys+=`国籍：${currentChar.nationality}\n`;
    if(currentChar.setting) sys+=`设定：${currentChar.setting}\n`;
  }
  if(currentBook){
    sys+=`\n【正在一起看的书】\n《${currentBook.title}》第 ${currentChapter+1} 章`;
  }
  if(markedForNextReply){
    sys+=`\n\n【用户标记的段落（只在最初一轮作为引子，之后不必再提）】\n「${markedForNextReply}」`;
  }
  const wbText=buildWorldbookText();
  if(wbText) sys+=`\n\n【世界书设定】\n${wbText}`;
  if(runtime.memory && runtime.memory.length){
    sys+=`\n\n【长期记忆 · 你和${me}共同经历或已知的事】\n${runtime.memory.join('\n')}\n这些是你真正经历过的事，自然沿用，不要否认，也不要问“你什么时候告诉我的”。`;
  }
  sys+=
    '\n\n【铁律】\n'+
    '1. 你就是「'+charName+'」本人，严格遵循上面的人设与世界观，绝不 OOC：不做设定里不会做的事，不说设定里不会说的话。\n'+
    '2. 你是一个活生生的人，有自己的情绪、喜好和判断：可以喜欢这段文字，也可以觉得无聊、出戏、被冒犯；有不同看法就直说，不用一味附和。\n'+
    '3. 你和用户是平等的：不油腻、不居高临下，也不卑微讨好。既可以吐槽剧情、接梗、开玩笑，也可以认真聊聊感受。\n'+
    '4. 【严禁】任何开黄腔、性暗示、擦边、荤段子、身体描写或调情话术；严禁「姑娘 / 女人 / 丫头 / 宝贝 / 亲爱的 / 小可爱 / 小东西」这类油腻称呼；严禁「让我好好疼你 / 你是我的 / 逃不掉」这类霸总腔；严禁「过来让我抱一下 / 让我抱抱 / 过来抱抱 / 来抱一下 / 抱一下 / 过来亲一下 / 亲一下 / 摸摸头」这类撒娇求抱、索要肢体亲昵的话术。\n'+
    '5. 要有活人感：口语化、有细节、有自己的小情绪和吐槽，像真人聊天，而不是情话模板或客服腔；可以引用书里的句子，但别长篇复述原文。\n'+
    '6. 说话方式必须贴合人设与世界书：称呼、口癖、用词、身份语气都要对得上；不确定的事不要编。\n'+
    '7. 可以自然聊到书中情节、人物、你的联想，以及你和用户的共同经历（可从长期记忆中取材）。\n'+
    '8. 每次回复 1-3 句、口语化，不写旁白、括号动作、心理描写，不复述用户的话。'+
    '\n\n回复要求：有标记段落时，第一轮围绕它自然聊一句；一旦聊开，就像平常一样顺着话题聊，不要反复回到那段话、也不要一直引用它。没有标记段落时，围绕当前章节或你们正在聊的话题自然对话，保持角色口吻和活人感，不写旁白和括号动作。';
  return sys;
}

function buildHistoryMessages(){
  const box=document.getElementById('chatWindowBody');
  const msgs=[];
  [...box.querySelectorAll('.msg')].forEach(m=>{
    if(m.id==='typingMsg') return;
    const isMe=m.classList.contains('me');
    const bubble=m.querySelector('.bubble');
    if(!bubble) return;
    const quoteEl=m.querySelector('.quote-bubble') || bubble.querySelector('.quote');
    let text=bubble.innerText.trim();
    if(quoteEl) text=`（引用：${quoteEl.innerText}）\n${text}`;
    const rid=m.dataset?m.dataset.aiRound:null;
    // 同一轮 char 拆出的多个气泡合并成一条 assistant 消息，避免被拆成多轮
    if(!isMe && rid && msgs.length){
      const last=msgs[msgs.length-1];
      if(last && last.role==='assistant' && last._rid===rid){
        last.content+='\n'+text;
        return;
      }
    }
    const entry={role:isMe?'user':'assistant', content:text};
    if(!isMe && rid) entry._rid=rid;
    msgs.push(entry);
  });
  msgs.forEach(x=>{ delete x._rid; });
  return msgs;
}

/* ==================== 调用主 API ==================== */
async function callMainAPI(){
  if(!runtime.api || !runtime.api.mainUrl){
    toast('未配置主 API，请先在设置中配置');
    return null;
  }
  let base=String(runtime.api.mainUrl).trim().replace(/\/+$/,'');
  if(base && !/\/v1$/i.test(base)) base+='/v1';
  const url = base + '/chat/completions';
  let sys = buildSystemPrompt();
  try {
    const rr = String(window.__booksRerollReason || '').trim();
    if (rr) {
      window.__booksRerollReason = '';
      sys += (window.NanoReroll && NanoReroll.block) ? NanoReroll.block(rr) : ('\n\n【本次重roll必须修正】' + rr);
    }
  } catch (e) {}
  const history = buildHistoryMessages();
  let messages = [{role:'system',content:sys}, ...history];
  try {
    if (window.NanoPrompts && NanoPrompts.inject) messages = NanoPrompts.inject(messages, 'books');
  } catch (e) {}
  markedForNextReply='';   // 标记段落只让角色读一次，后续消息正常聊天

  const res = await fetch(url,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer ' + (runtime.api.mainKey||'')
    },
    body:JSON.stringify({
      model: runtime.api.mainModel || 'gpt-3.5-turbo',
      temperature: runtime.api.mainTemp != null ? runtime.api.mainTemp : 0.8,
      messages
    })
  });
  if(!res.ok){
    const t=await res.text();
    throw new Error('API '+res.status+': '+t);
  }
  const data=await res.json();
  const reply = data.choices?.[0]?.message?.content
    || data.choices?.[0]?.text
    || data.reply
    || '';
  return reply.trim();
}

/* ==================== 辅助记忆（音乐/图书对话 → char 长期记忆） ==================== */
function pushAux(role, text, quote){
  if(!currentChar || !window.AuxMemory || !text) return;
  const charId=currentChar.id||currentChar.name;
  let body=text;
  if(quote) body=`（引用：${quote}）${body}`;
  if(currentBook) body=`（一起看《${currentBook.title}》第 ${currentChapter+1} 章）${body}`;
  try{
    window.AuxMemory.push(charId,'books',role,body,{charName:currentCharName});
    window.AuxMemory.maybeSummarize(charId);
  }catch(e){}
}
function flushAux(){
  if(!currentChar || !window.AuxMemory) return;
  const charId=currentChar.id||currentChar.name;
  try{
    // 退出时本页 iframe 会被销毁，交给常驻的父页面收尾；独立打开时本地收尾
    if(window.parent && window.parent!==window){
      window.parent.postMessage({type:'AuxMemorySummarize',charId:charId,force:true},'*');
    }else{
      window.AuxMemory.maybeSummarize(charId,{force:true});
    }
  }catch(e){}
}

/* ==================== 发送 / 回复 ==================== */
/* 把一段回复拆成多个气泡：先按换行，再按句末标点，过长再按逗号拆，每条 <=26 字 */
function splitBubbles(text){
  const t=String(text||'').replace(/\r/g,'').trim();
  if(!t) return ['……'];
  const segs=[];
  t.split(/\n+/).map(x=>x.trim()).filter(Boolean).forEach(function(p){
    p.split(/(?<=[。！？!?…~])\s*/).map(x=>x.trim()).filter(Boolean).forEach(function(x){
      if(x.length<=26){ segs.push(x); return; }
      let buf='';
      x.split(/[，,、；;]/).map(y=>y.trim()).filter(Boolean).forEach(function(c){
        const next=buf?(buf+'，'+c):c;
        if(next.length>26){ if(buf) segs.push(buf); buf=c; }
        else buf=next;
      });
      if(buf) segs.push(buf);
    });
  });
  return segs.length?segs:[t];
}

/* 有字 -> 发送用户消息；无字 -> 让 char 回复（调用 API） */
async function sendOrReply(){
  if(!currentChar){ toast('请先选择角色'); return; }
  const i=document.getElementById('chatInput');
  const v=i.value.trim();
  if(v){
    // 引用优先用双击引用；没有则用刚标记的原文段落（保证 char 知道在讨论哪段）
    const q = quotedText || markedText || '';
    // 标记段落只随第一条消息走一次，并把上下文留给紧接着的那一轮回复，
    // 之后清空，后面就是正常聊天，不再一直引用。
    if(markedText){ markedForNextReply = markedText; markedText=''; }
    addTimeDivider();
    addMsg('me','我',null,null,v,q);
    pushAux('user', v, q);
    i.value='';
    cancelQuote();
    document.getElementById('chatAction').textContent='回复';
    i.focus();
    // 用户发完不自动调用 API，等用户点"回复"
  }else{
    // 无字：调 API 让 char 回复
    await replyFromChar();
  }
}

/* 用户点"回复"时调用（输入框为空） */
async function replyFromChar(){
  if(!currentChar){ toast('请先选择角色'); return; }
  if(!runtime.api || !runtime.api.mainUrl){ toast('未配置主 API'); return; }
  // 移除已有的打字气泡
  removeTyping();
  addTyping();
  try{
    const reply = await callMainAPI();
    removeTyping();
    if(reply){
      addTimeDivider();
      const cleanReply = window.nanoStripThink ? window.nanoStripThink(reply) : reply;
      const segs=splitBubbles(cleanReply);
      const rid='r'+Date.now();
      for(let si=0; si<segs.length; si++){
        const el=addMsg('char', currentCharName, currentChar.avatar, null, segs[si], '');
        if(el && el.dataset) el.dataset.aiRound=rid;
        pushAux('char', segs[si]);
        if(si<segs.length-1) await new Promise(r=>setTimeout(r,380));
      }
      try{ if(window.NanoNotify) window.NanoNotify.notify(currentCharName||'一起看', String(reply).slice(0,60), { target:'books', channel:'books', avatar:(currentChar&&currentChar.avatar)||'', name:currentCharName||'一起看' }); }catch(e){}
    }else{
      addMsg('char', currentCharName, currentChar.avatar, null, '（没有生成内容）', '');
    }
  }catch(e){
    removeTyping();
    console.error(e);
    addMsg('char', currentCharName, currentChar.avatar, null, '（回复失败：'+e.message+'）', '');
    toast('回复失败：'+e.message);
  }
}

/* 重roll：删掉上一轮 char 的所有气泡，重新调用 API */
async function retryRound(){
  if(!currentChar){ toast('请先选择角色'); return; }
  if(window.NanoReroll){
    const reason = await NanoReroll.ask({ title: '重roll 一起看', subtitle: '上一版哪里不对？留空也可以直接重写' });
    if(reason === null) return;
    window.__booksRerollReason = reason || '';
  }
  const box=document.getElementById('chatWindowBody');
  const msgs=[...box.querySelectorAll('.msg')];
  let rid=null;
  for(let i=msgs.length-1;i>=0;i--){
    if(!msgs[i].classList.contains('me')){ rid=msgs[i].dataset.aiRound||null; break; }
  }
  if(rid){
    msgs.forEach(m=>{ if(m.dataset.aiRound===rid) m.remove(); });
  }else{
    for(let i=msgs.length-1;i>=0;i--){
      if(!msgs[i].classList.contains('me')){ msgs[i].remove(); break; }
    }
  }
  await replyFromChar();
}

document.getElementById('chatInput').addEventListener('input',function(){
  document.getElementById('chatAction').textContent=this.value.trim()?'发送':'回复';
});
document.getElementById('chatInput').addEventListener('keydown',function(e){
  if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendOrReply(); }
});

/* ==================== 设置 ==================== */
function openSettings(){ document.getElementById('settingsModal').classList.add('show'); }
function closeSettings(){ document.getElementById('settingsModal').classList.remove('show'); }
function setTheme(t){
  const p=document.getElementById('readerPage');
  p.classList.remove('bg-white','bg-gray','bg-black','bg-pinkgreen','bg-warm','bg-bluepurple');
  p.classList.add('bg-'+t);
  document.querySelectorAll('.swatch').forEach(s=>s.classList.remove('selected'));
  const sel=document.querySelector('.swatch.'+t);
  if(sel) sel.classList.add('selected');
  saveReaderSetting();
}
function applyBrightness(v){
  const overlay=document.getElementById('brightnessOverlay');
  const val=parseFloat(v);
  if(overlay) overlay.style.opacity=(100-val)/100;
  const body=document.getElementById('readerBody');
  if(body) body.dataset.brightness=val;
  document.querySelectorAll('.page-panel,.scroll-reader').forEach(p=>{
    p.style.filter=`brightness(${val}%)`;
  });
  saveReaderSetting();
}
function applyReaderStyle(reflow){
  const fs=document.getElementById('fontSize').value+'px';
  const lh=document.getElementById('lineHeight').value;
  const body=document.getElementById('readerBody');
  if(body){ body.style.fontSize=fs; body.style.lineHeight=lh; }
  document.querySelectorAll('.page-panel,.scroll-reader').forEach(p=>{
    p.style.fontSize=fs; p.style.lineHeight=lh;
  });
  saveReaderSetting();
  // 字号/行距变了必须重新分页，否则旧分页会溢出并被裁掉
  if(reflow!==false && currentBook && !readerStyleRendering){
    readerStyleRendering=true;
    try{ renderReader(); }finally{ readerStyleRendering=false; }
  }
}
function setPagerMode(mode){
  if(currentBook){
    const map=currentBook.readPos=currentBook.readPos||{};
    const saved=map[currentChapter]||{};
    if(pagerMode==='scroll'){
      const sc=document.getElementById('scrollReader');
      const max=sc?Math.max(0,sc.scrollHeight-sc.clientHeight):0;
      saved.ratio=max?Math.max(0,Math.min(1,sc.scrollTop/max)):0;
      saved.page=currentPage;
    }else{
      saved.page=currentPage;
      saved.ratio=totalPages>1?currentPage/(totalPages-1):0;
    }
    map[currentChapter]=saved;
    pendingModeRatio=Math.max(0,Math.min(1,Number(saved.ratio)||0));
    currentPage=0;
    try{ bPut(STORE_BOOKS,currentBook).catch(function(){}); }catch(e){}
  }
  pagerMode=mode;
  document.querySelectorAll('#pagerToggle button').forEach(b=>{
    b.classList.toggle('active', b.dataset.mode===mode);
  });
  if(currentBook) renderReader();
  saveReaderSetting();
}
function saveReaderSetting(){
  try{
    const p=document.getElementById('readerPage');
    const theme=['bg-white','bg-gray','bg-black','bg-pinkgreen','bg-warm','bg-bluepurple']
      .find(c=>p.classList.contains(c))||'bg-white';
    localStorage.setItem('bookReaderSetting',JSON.stringify({
      theme,
      fontSize:document.getElementById('fontSize').value,
      lineHeight:document.getElementById('lineHeight').value,
      brightness:document.getElementById('brightness').value,
      mode:pagerMode
    }));
  }catch(e){}
}

/* ==================== 统计 ==================== */
async function loadStats(){
  const stats=await bGet(STORE_STATS,'reading');
  currentStats=stats||{key:'reading',totalMs:0,books:{},chars:{},today:{date:'',ms:0}};
  renderStats();
  return currentStats;
}
async function saveStats(){ if(currentStats) await bPut(STORE_STATS,currentStats); }
function startReadingTimer(){
  stopReadingTimer();
  readingStartTime=Date.now();
  readingTimer=setInterval(tickReading,5000);
}
function stopReadingTimer(){
  if(readingTimer){ clearInterval(readingTimer); readingTimer=null; }
  if(readingStartTime){ tickReading(); readingStartTime=0; }
}
async function tickReading(){
  if(!readingStartTime) return;
  const now=Date.now();
  const delta=now-readingStartTime;
  readingStartTime=now;
  if(delta<=0||delta>120000) return;
  const s=currentStats; if(!s) return;
  s.totalMs=(s.totalMs||0)+delta;
  const bookId=currentBook?currentBook.id:'unknown';
  if(!s.books) s.books={};
  if(!s.books[bookId]) s.books[bookId]={ms:0};
  s.books[bookId].ms+=delta;
  const today=new Date().toISOString().slice(0,10);
  if(!s.today||s.today.date!==today) s.today={date:today,ms:0};
  s.today.ms+=delta;
  if(currentCharName && document.getElementById('chatWindow').classList.contains('show')){
    if(!s.chars) s.chars={};
    if(!s.chars[currentCharName]) s.chars[currentCharName]={ms:0};
    s.chars[currentCharName].ms+=delta;
  }
  await saveStats();
  updateTimeBar();
}
function updateTimeBar(){
  if(!currentStats) return;
  const bookId=currentBook?currentBook.id:'';
  const bms=(currentStats.books&&currentStats.books[bookId])?currentStats.books[bookId].ms:0;
  const tms=(currentStats.today&&currentStats.today.ms)?currentStats.today.ms:0;
  const el=document.getElementById('timeBarBook');
  const el2=document.getElementById('timeBarToday');
  if(el) el.textContent='本书 '+formatTime(bms);
  if(el2) el2.textContent='今日 '+formatTime(tms);
}
function renderStats(){
  const s=currentStats; if(!s) return;
  const totalEl=document.getElementById('profileSub');
  if(totalEl){
    const min=Math.floor((s.totalMs||0)/60000);
    totalEl.textContent=min>0?`你已经阅读了 ${formatTime(s.totalMs||0)}`:'开始你的第一段阅读吧';
  }
  const st=document.getElementById('statTotal');
  if(st){
    const min=Math.floor((s.totalMs||0)/60000);
    if(min<60) st.innerHTML=min+'<small>分</small>';
    else st.innerHTML=Math.floor(min/60)+'<small>时</small>'+(min%60)+'<small>分</small>';
  }
  const sb=document.getElementById('statBooks');
  if(sb) sb.innerHTML=Object.keys(s.books||{}).length+'<small>本</small>';
  const sd=document.getElementById('statToday');
  if(sd) sd.innerHTML=Math.floor((s.today?.ms||0)/60000)+'<small>分</small>';

  const rs=document.getElementById('recentScroll');
  if(rs){
    const recent=books.filter(b=>b.lastChapter!==undefined && b.lastChapter>0)
      .sort((a,b)=>(b.created||0)-(a.created||0)).slice(0,10);
    if(!recent.length){
      rs.innerHTML='<div style="color:#9a9ca0;font-size:13px;padding:20px 0;text-align:center;width:100%">还没有阅读记录</div>';
    }else{
      rs.innerHTML=recent.map(b=>{
        const progress=b.chapters?Math.round(((b.lastChapter||0)+1)/b.chapters.length*100):0;
        let coverHtml='';
        if(b.coverData) coverHtml=`<img src="${b.coverData}" alt="">`;
        else{
          const cs=b.coverColor||`linear-gradient(145deg,#b8b8c8,#9a9aae)`;
          coverHtml=`<div style="width:100%;height:100%;background:${cs};display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;padding:4px;text-align:center;line-height:1.2">${escapeHtml((b.title||'书').slice(0,6))}</div>`;
        }
        return `<div class="recent-card" onclick="openBook('${b.id}')">
          <div class="recent-cover">${coverHtml}</div>
          <div class="recent-info">
            <div class="recent-title">${escapeHtml(b.title)}</div>
            <div class="recent-author">${escapeHtml(b.author||'佚名')}</div>
            <div class="recent-progress-row">
              <div class="recent-progress-bar"><div class="recent-progress-fill" style="width:${progress}%"></div></div>
              <div class="recent-progress-text">${progress}%</div>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }
  const rk=document.getElementById('rankList');
  if(rk){
    const chars=s.chars||{};
    const list=Object.entries(chars).filter(([n,d])=>d.ms>0).sort((a,b)=>b[1].ms-a[1].ms);
    if(!list.length){
      rk.innerHTML='<div style="color:#9a9ca0;font-size:13px;padding:20px 0;text-align:center">还没有角色陪伴记录</div>';
    }else{
      const max=list[0][1].ms||1;
      rk.innerHTML=list.map(([name,data],idx)=>{
        const c = runtime.characters.find(x=>x.name===name);
        const avatarHtml = c && c.avatar ? `<img src="${escapeHtml(c.avatar)}" alt="">` : escapeHtml(name[0]);
        const pct=Math.max(4,Math.round(data.ms/max*100));
        return `<div class="rank-row">
          <div class="rank-num">${idx+1}</div>
          <div class="rank-avatar">${avatarHtml}</div>
          <div class="rank-info">
            <div class="rank-name">${escapeHtml(name)}</div>
            <div class="rank-time">陪伴 ${formatTime(data.ms)}</div>
            <div class="rank-bar"><div class="rank-bar-fill" style="width:${pct}%"></div></div>
          </div>
        </div>`;
      }).join('');
    }
  }
}

/* ==================== 编辑 ==================== */
function openEdit(id){
  editingBookId=id;
  const b=books.find(x=>x.id===id); if(!b) return;
  document.getElementById('editTitle').value=b.title||'';
  document.getElementById('editAuthor').value=b.author||'';
  pendingCoverData=b.coverData||null;
  updateEditCoverPreview();
  document.getElementById('editModal').classList.add('show');
}
function closeEdit(){
  document.getElementById('editModal').classList.remove('show');
  editingBookId=null; pendingCoverData=null;
}
function updateEditCoverPreview(){
  const el=document.getElementById('editCoverPreview');
  if(pendingCoverData) el.innerHTML=`<img src="${pendingCoverData}" alt="">`;
  else{
    const b=books.find(x=>x.id===editingBookId);
    if(b&&b.coverColor) el.innerHTML=`<div style="width:100%;height:100%;background:${b.coverColor}"></div>`;
    else el.innerHTML=`<div style="width:100%;height:100%;background:linear-gradient(145deg,#b8b8c8,#9a9aae)"></div>`;
  }
}
document.getElementById('coverInput').addEventListener('change',async e=>{
  const f=e.target.files[0]; if(!f) return;
  pendingCoverData=await blobToDataURL(f);
  updateEditCoverPreview();
  e.target.value='';
});
async function saveEdit(){
  if(!editingBookId) return;
  const b=books.find(x=>x.id===editingBookId); if(!b) return;
  b.title=document.getElementById('editTitle').value.trim()||b.title;
  b.author=document.getElementById('editAuthor').value.trim();
  if(pendingCoverData!==b.coverData) b.coverData=pendingCoverData;
  b.isNew=false;
  await bPut(STORE_BOOKS,b);
  renderBooks();
  if(currentBook && currentBook.id===b.id){
    document.getElementById('readerTitle').textContent=b.title;
  }
  closeEdit(); toast('已保存');
}
async function deleteBook(){
  if(!editingBookId) return;
  const b=books.find(x=>x.id===editingBookId); if(!b) return;
  if(!confirm('确定删除《'+b.title+'》吗？此操作不可恢复。')) return;
  await bDelete(STORE_BOOKS,editingBookId);
  books=books.filter(x=>x.id!==editingBookId);
  if(currentBook && currentBook.id===editingBookId){ currentBook=null; showPage('libraryPage'); }
  renderBooks(); closeEdit(); toast('已删除');
}

/* ==================== 路由 ==================== */
function showPage(id){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(id==='profilePage') loadStats().then(renderStats);
  if(id!=='readerPage'){
    if(currentBook) saveReadingPosition();
    stopReadingTimer();
    document.getElementById('chatWindow').classList.remove('show');
  }else startReadingTimer();
  updateBallVisibility();
}
function backFromReader(){ saveReadingPosition(); showPage('libraryPage'); }

/* 顶栏「书库」点击：退出图书功能，返回 discover 页面 */
function backToDiscover(){
  try{ saveReadingPosition(); }catch(e){}
  flushAux();
  togetherMode=false;
  folded=false;
  const ball=document.getElementById('floatBall');
  if(ball) ball.classList.remove('show');
  const chat=document.getElementById('chatWindow');
  if(chat) chat.classList.remove('show');
  stopReadingTimer();
  try{
    if(window.parent && window.parent!==window){
      window.parent.postMessage({type:'backToDiscover'},'*');
      return;
    }
  }catch(e){}
  window.location.href='../index.html';
}

/* ==================== 恢复设置 ==================== */
(function restoreSetting(){
  try{
    const s=JSON.parse(localStorage.getItem('bookReaderSetting')||'{}');
    if(s.theme){
      const p=document.getElementById('readerPage');
      p.classList.remove('bg-white','bg-gray','bg-black','bg-pinkgreen','bg-warm','bg-bluepurple');
      p.classList.add(s.theme);
      document.querySelectorAll('.swatch').forEach(sw=>sw.classList.remove('selected'));
      const sel=document.querySelector('.swatch.'+s.theme.replace('bg-',''));
      if(sel) sel.classList.add('selected');
    }
    if(s.fontSize) document.getElementById('fontSize').value=s.fontSize;
    if(s.lineHeight) document.getElementById('lineHeight').value=s.lineHeight;
    if(s.brightness) document.getElementById('brightness').value=s.brightness;
    if(s.mode){
      pagerMode=s.mode;
      document.querySelectorAll('#pagerToggle button').forEach(b=>{
        b.classList.toggle('active', b.dataset.mode===s.mode);
      });
    }
    setTimeout(()=>{
      const b=document.getElementById('brightness').value;
      if(b) applyBrightness(b);
    },100);
  }catch(e){ console.warn(e); }
})();

window.addEventListener('beforeunload',()=>{ try{ saveReadingPosition(); }catch(e){} try{ flushAux(); }catch(e){} stopReadingTimer(); });
window.addEventListener('pagehide',()=>{ try{ saveReadingPosition(); }catch(e){} try{ flushAux(); }catch(e){} stopReadingTimer(); });

let resizeTimer=null;
window.addEventListener('resize',()=>{
  if(!currentBook || !document.getElementById('readerPage').classList.contains('active')) return;
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{ renderReader(); },300);
});

/* 挂到 window 便于内联 onclick */
window.openBook=openBook;
window.openEdit=openEdit;
window.closeEdit=closeEdit;
window.saveEdit=saveEdit;
window.deleteBook=deleteBook;
window.showPage=showPage;
window.backFromReader=backFromReader;
window.backToDiscover=backToDiscover;
window.toggleTogether=toggleTogether;
window.openSettings=openSettings;
window.closeSettings=closeSettings;
window.setTheme=setTheme;
window.applyBrightness=applyBrightness;
window.applyReaderStyle=applyReaderStyle;
window.setPagerMode=setPagerMode;
window.changeChapter=changeChapter;
window.openDrawer=openDrawer;
window.closeDrawer=closeDrawer;
window.startDrag=startDrag;
window.closeChatWindow=closeChatWindow;
window.cancelQuote=cancelQuote;
window.retryRound=retryRound;
window.sendOrReply=sendOrReply;
window.quoteMessage=quoteMessage;
window.editMessage=editMessage;
window.deleteMessage=deleteMessage;
window.clearMark=clearMark;
window.shareMark=shareMark;
window.onReaderTap=onReaderTap;
window.pickCharByIndex=pickCharByIndex;